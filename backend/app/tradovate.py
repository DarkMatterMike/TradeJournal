"""
Tradovate sync — WebSocket-first approach.

The syncrequest response delivers all user entities (fills, orders, positions,
fillPairs, contracts, etc.) directly over the WebSocket in SockJS 'a' frames.
We collect everything from those frames, then map fillPairs to trade_rows.
No REST call needed for trade data.

Frame format:
  "o"           — open, respond with authorize
  "a[...]"      — array of message objects
  "h"           — heartbeat
  "c"           — closed

Message object inside 'a' frames:
  { "i": <request_id>, "s": 200, "d": { ...response_data } }   — response to our request
  { "e": "props", "d": { "users":[...], "accounts":[...], "fills":[...], ... } }  — entity push
"""

import os, json, time, logging, threading
from datetime import datetime, timezone
from typing import Optional
import httpx
from psycopg.types.json import Json
from .db import get_conn

logger = logging.getLogger(__name__)

LIVE_BASE  = 'https://live.tradovateapi.com/v1'
WS_URL     = 'wss://live.tradovateapi.com/v1/websocket'
TOKEN_TTL  = 90 * 60
RENEW_BEFORE = 15 * 60

_token_cache: dict = {
    'access_token': None,
    'expires_at': 0.0,
    'user_id': None,
}


def _has_credentials() -> bool:
    return bool(os.getenv('TRADOVATE_USERNAME') and os.getenv('TRADOVATE_PASSWORD'))


def _get_token() -> str:
    now = time.time()
    if _token_cache['access_token'] and now < (_token_cache['expires_at'] - RENEW_BEFORE):
        return _token_cache['access_token']
    if _token_cache['access_token'] and now < _token_cache['expires_at']:
        try:
            return _renew_token()
        except Exception as e:
            logger.warning(f'Token renewal failed ({e}), acquiring new')
    return _acquire_token()


def _acquire_token() -> str:
    creds = {k: v for k, v in {
        'name':       os.getenv('TRADOVATE_USERNAME', ''),
        'password':   os.getenv('TRADOVATE_PASSWORD', ''),
        'appId':      os.getenv('TRADOVATE_APP_ID', 'TradeJournal'),
        'appVersion': os.getenv('TRADOVATE_APP_VERSION', '1.0'),
        'cid':        os.getenv('TRADOVATE_CID', ''),
        'sec':        os.getenv('TRADOVATE_SEC', ''),
    }.items() if v}
    resp = httpx.post(f'{LIVE_BASE}/auth/accesstokenrequest', json=creds, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    if data.get('errorText'):
        raise RuntimeError(f'Tradovate auth failed: {data["errorText"]}')
    token = data.get('accessToken')
    if not token:
        raise RuntimeError(f'No accessToken in response: {data}')
    _token_cache['access_token'] = token
    _token_cache['expires_at']   = time.time() + TOKEN_TTL
    _token_cache['user_id']      = data.get('userId')
    logger.info(f'Tradovate token acquired, userId={_token_cache["user_id"]}')
    return token


def _renew_token() -> str:
    resp = httpx.get(f'{LIVE_BASE}/auth/renewAccessToken',
                     headers={'Authorization': f'Bearer {_token_cache["access_token"]}'}, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    if data.get('errorText'):
        raise RuntimeError(f'Renewal failed: {data["errorText"]}')
    token = data.get('accessToken')
    if not token:
        raise RuntimeError('No accessToken in renewal response')
    _token_cache['access_token'] = token
    _token_cache['expires_at']   = time.time() + TOKEN_TTL
    return token


def _rest_get(endpoint: str, params: dict = None):
    token = _get_token()
    resp = httpx.get(f'{LIVE_BASE}/{endpoint}',
                     headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
                     params=params, timeout=30)
    resp.raise_for_status()
    return resp.json()


# ── WebSocket sync — collect all entity data from syncrequest ─────────────────

def _parse_ws_frames(raw: str) -> list:
    """Parse SockJS frames. 'a[...]' contains a JSON array of message strings."""
    if not raw or raw in ('o', 'h'):
        return []
    if raw.startswith('a'):
        try:
            arr = json.loads(raw[1:])  # strip leading 'a'
            result = []
            for item in arr:
                if isinstance(item, str):
                    try:
                        result.append(json.loads(item))
                    except Exception:
                        pass
                elif isinstance(item, dict):
                    result.append(item)
            return result
        except Exception as e:
            logger.debug(f'Frame parse error: {e}, raw={raw[:100]}')
    return []


def fetch_all_entities_via_websocket(timeout: int = 45) -> dict:
    """
    Open WebSocket, authenticate, send user/syncrequest, collect ALL entity
    data pushed back in 'props' events. Returns dict of entity type -> list.

    The syncrequest response pushes back everything: fills, fillPairs, orders,
    accounts, positions, contracts, etc. We collect it all.
    """
    try:
        import websockets.sync.client as ws_sync
    except ImportError:
        raise RuntimeError('websockets library not installed. Add websockets==13.1 to requirements.txt')

    token = _get_token()
    entities: dict = {}
    auth_ok = False
    sync_sent = False
    req_id = [1]

    deadline = time.time() + timeout

    def send(ws, endpoint, body=''):
        rid = req_id[0]
        req_id[0] += 1
        msg = f'{endpoint}\n{rid}\n\n{body}'
        ws.send(msg)
        return rid

    try:
        with ws_sync.connect(WS_URL, open_timeout=10, ping_interval=None) as ws:
            while time.time() < deadline:
                try:
                    remaining = max(1, int(deadline - time.time()))
                    raw = ws.recv(timeout=min(remaining, 5))
                except TimeoutError:
                    if auth_ok and sync_sent:
                        # We've been collecting, no new data — done
                        break
                    continue

                if not raw or raw == 'h':
                    continue

                if raw == 'o':
                    # Step 1: Authenticate
                    send(ws, 'authorize', token)
                    continue

                msgs = _parse_ws_frames(raw)
                for msg in msgs:
                    if not isinstance(msg, dict):
                        continue

                    # Response to our authorize request
                    if msg.get('i') == 1 and msg.get('s') == 200:
                        auth_ok = True
                        logger.info('WS: authenticated')
                        # Step 2: Send syncrequest
                        send(ws, 'user/syncrequest', json.dumps({'users': []}))
                        sync_sent = True
                        continue

                    # Auth failed
                    if msg.get('i') == 1 and msg.get('s') != 200:
                        raise RuntimeError(f'WS auth failed: {msg}')

                    # syncrequest response — comes as direct response with all entities
                    if msg.get('i') == 2 and msg.get('s') == 200:
                        data = msg.get('d', {})
                        _collect_entities(entities, data)
                        logger.info(f'WS: syncrequest response, entity keys: {list(data.keys())}')
                        # Tradovate sends all data in this one response — we can close now
                        break

                    # Real-time 'props' push (ongoing updates)
                    if msg.get('e') == 'props':
                        data = msg.get('d', {})
                        _collect_entities(entities, data)

                else:
                    continue
                break  # break outer loop when inner loop breaks

    except Exception as e:
        logger.error(f'WebSocket error: {e}')
        raise

    logger.info(f'WS sync complete. Entity types: {list(entities.keys())}')
    return entities


def _collect_entities(store: dict, data: dict):
    """Merge entity arrays from a data dict into the store."""
    if not isinstance(data, dict):
        return
    for key, val in data.items():
        if isinstance(val, list) and val:
            if key not in store:
                store[key] = []
            # Deduplicate by id
            existing_ids = {e.get('id') for e in store[key] if isinstance(e, dict)}
            for item in val:
                if isinstance(item, dict):
                    if item.get('id') not in existing_ids:
                        store[key].append(item)
                        existing_ids.add(item.get('id'))


# ── Mapping ────────────────────────────────────────────────────────────────────

def _parse_ts(ts_str) -> Optional[datetime]:
    if not ts_str:
        return None
    for fmt in ('%Y-%m-%dT%H:%M:%S.%fZ', '%Y-%m-%dT%H:%M:%SZ', '%Y-%m-%dT%H:%M:%S'):
        try:
            return datetime.strptime(ts_str, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _map_fill_pair(fp: dict, fills_by_id: dict, contracts_by_id: dict) -> dict:
    """
    Map a fillPair + enriched fill data to a trade_row row_data dict.

    Confirmed fillPair fields from live API: id, buyFillId, sellFillId, qty, buyPrice, sellPrice
    Fill fields (from syncrequest): id, contractId, price, qty, tradeTime, orderId, etc.
    """
    buy_fill  = fills_by_id.get(fp.get('buyFillId'),  {})
    sell_fill = fills_by_id.get(fp.get('sellFillId'), {})

    # Contract
    contract_id = (buy_fill.get('contractId') or sell_fill.get('contractId') or
                   fp.get('contractId'))
    contract = contracts_by_id.get(contract_id, {})
    symbol = (contract.get('name') or contract.get('symbol') or
              buy_fill.get('contractSymbol') or sell_fill.get('contractSymbol') or
              f'contract_{contract_id}')

    # Prices — confirmed on fillPair
    buy_price  = fp.get('buyPrice')
    sell_price = fp.get('sellPrice')
    qty        = fp.get('qty') or 1

    # Timestamps — from fill records
    buy_ts  = _parse_ts(buy_fill.get('tradeTime')  or buy_fill.get('timestamp')  or buy_fill.get('createdTimestamp'))
    sell_ts = _parse_ts(sell_fill.get('tradeTime') or sell_fill.get('timestamp') or sell_fill.get('createdTimestamp'))

    # Direction: whichever fill came first is the open
    if buy_ts and sell_ts:
        if buy_ts <= sell_ts:
            side, entry_price, exit_price = 'Long',  buy_price,  sell_price
            entry_time, exit_time         = buy_ts,  sell_ts
        else:
            side, entry_price, exit_price = 'Short', sell_price, buy_price
            entry_time, exit_time         = sell_ts, buy_ts
    else:
        # No timestamps — default Long
        side, entry_price, exit_price = 'Long', buy_price, sell_price
        entry_time, exit_time = buy_ts or sell_ts, sell_ts or buy_ts

    # P&L — calculate if not on record
    pnl = fp.get('realizedPnl') or fp.get('pnl')
    if pnl is None and entry_price and exit_price:
        point_value = contract.get('valuePerPoint') or contract.get('pointValue') or 1
        direction   = 1 if side == 'Long' else -1
        pnl         = round(direction * (exit_price - entry_price) * qty * point_value, 2)

    trade_ts   = exit_time or entry_time
    trade_date = trade_ts.date().isoformat() if trade_ts else None

    return {
        'tradovate_fill_pair_id': fp.get('id'),
        'symbol':      symbol,
        'side':        side,
        'qty':         qty,
        'entry_price': entry_price,
        'exit_price':  exit_price,
        'pnl':         pnl,
        'entry_time':  entry_time.isoformat() if entry_time else None,
        'exit_time':   exit_time.isoformat()  if exit_time  else None,
        'trade_date':  trade_date,
        'source':      'tradovate_sync',
        '_raw_fp':     fp,
    }


# ── Public API ─────────────────────────────────────────────────────────────────

def get_status() -> dict:
    return {
        'configured':       _has_credentials(),
        'connected':        bool(_token_cache['access_token'] and time.time() < _token_cache['expires_at']),
        'user_id':          _token_cache.get('user_id'),
        'token_expires_in': max(0, int(_token_cache['expires_at'] - time.time())) if _token_cache['expires_at'] else 0,
    }


def get_accounts() -> list:
    data = _rest_get('account/list')
    return data if isinstance(data, list) else []


def get_cash_balance(account_id: int) -> dict:
    data = _rest_get('cashBalance/getCashBalanceSnapshot', {'accountId': account_id})
    return data if isinstance(data, dict) else {}


def sync_fills_to_journal(account_id: int) -> dict:
    """
    Full sync via WebSocket:
    1. Open WebSocket, authenticate, send user/syncrequest
    2. Collect ALL entities from the response (fillPairs, fills, contracts)
    3. Map each fillPair to a trade_row and upsert into the journal
    4. Create trading_days for new dates, recompute day stats
    """
    if not _has_credentials():
        raise RuntimeError('Tradovate credentials not configured.')

    # Fetch all entities via WebSocket
    entities = fetch_all_entities_via_websocket(timeout=45)

    fill_pairs      = entities.get('fillPairs', [])
    fills           = entities.get('fills', [])
    contracts       = entities.get('contracts', [])

    if not fill_pairs:
        entity_summary = {k: len(v) for k, v in entities.items()}
        return {
            'imported': 0, 'skipped': 0, 'days_updated': 0, 'errors': [],
            'entity_counts': entity_summary,
            'message': f'No fillPairs in WebSocket response. Entities received: {entity_summary}. '
                       'This may mean no closed trades exist in this account yet.',
        }

    fills_by_id     = {f['id']: f for f in fills if isinstance(f, dict) and f.get('id')}
    contracts_by_id = {c['id']: c for c in contracts if isinstance(c, dict) and c.get('id')}

    imported     = 0
    skipped      = 0
    errors       = []
    days_touched = set()

    with get_conn() as conn, conn.cursor() as cur:
        for fp in fill_pairs:
            try:
                row_data     = _map_fill_pair(fp, fills_by_id, contracts_by_id)
                trade_date   = row_data.get('trade_date')
                fill_pair_id = row_data.get('tradovate_fill_pair_id')

                if not fill_pair_id:
                    skipped += 1
                    continue

                # Idempotency
                cur.execute(
                    "SELECT id FROM trade_rows WHERE row_data->>'tradovate_fill_pair_id' = %s",
                    (str(fill_pair_id),)
                )
                if cur.fetchone():
                    skipped += 1
                    continue

                # Get or create trading_day
                day_id = None
                if trade_date:
                    cur.execute('SELECT id FROM trading_days WHERE trade_date = %s', (trade_date,))
                    day_row = cur.fetchone()
                    if not day_row:
                        cur.execute(
                            '''INSERT INTO trading_days (trade_date, tickers, title)
                               VALUES (%s, %s, %s)
                               ON CONFLICT (trade_date) DO NOTHING RETURNING id''',
                            (trade_date, row_data.get('symbol', ''), f'Auto-imported {trade_date}')
                        )
                        day_row = cur.fetchone()
                        if not day_row:
                            cur.execute('SELECT id FROM trading_days WHERE trade_date = %s', (trade_date,))
                            day_row = cur.fetchone()
                    if day_row:
                        day_id = day_row['id']

                cur.execute('INSERT INTO trade_rows (day_id, row_data) VALUES (%s, %s)',
                            (day_id, Json(row_data)))
                if day_id:
                    days_touched.add((day_id, trade_date))
                imported += 1

            except Exception as e:
                errors.append(f'fillPair {fp.get("id")}: {e}')
                logger.exception(f'Error processing fillPair {fp.get("id")}')

        for day_id, _ in days_touched:
            _recompute_day_stats(cur, day_id)

        conn.commit()

    return {
        'imported':     imported,
        'skipped':      skipped,
        'days_updated': len(days_touched),
        'errors':       errors,
        'entity_counts': {k: len(v) for k, v in entities.items()},
    }


def preview_fills(account_id: int) -> dict:
    """Fetch entities via WebSocket and return preview without writing to DB."""
    entities = fetch_all_entities_via_websocket(timeout=45)

    fill_pairs      = entities.get('fillPairs', [])
    fills           = entities.get('fills', [])
    contracts       = entities.get('contracts', [])

    fills_by_id     = {f['id']: f for f in fills if isinstance(f, dict) and f.get('id')}
    contracts_by_id = {c['id']: c for c in contracts if isinstance(c, dict) and c.get('id')}

    rows = []
    for fp in fill_pairs:
        try:
            rows.append(_map_fill_pair(fp, fills_by_id, contracts_by_id))
        except Exception as e:
            rows.append({'error': str(e), '_raw': fp})

    return {
        'entity_counts':  {k: len(v) for k, v in entities.items()},
        'fill_pair_count': len(fill_pairs),
        'preview':         rows[:50],
        'raw_fill_pair_sample': fill_pairs[:2],
        'raw_fill_sample':      fills[:2],
    }


def _recompute_day_stats(cur, day_id: int):
    cur.execute(
        """SELECT COUNT(*) as total,
                  SUM((row_data->>'pnl')::float) as total_pnl,
                  SUM(CASE WHEN (row_data->>'pnl')::float > 0 THEN 1 ELSE 0 END) as wins,
                  SUM(CASE WHEN (row_data->>'pnl')::float < 0 THEN 1 ELSE 0 END) as losses
           FROM trade_rows
           WHERE day_id = %s
             AND row_data->>'pnl' IS NOT NULL
             AND row_data->>'pnl' != 'null'""",
        (day_id,)
    )
    stats = cur.fetchone()
    if stats and stats['total'] > 0:
        cur.execute(
            '''UPDATE trading_days
               SET pnl=%s, num_trades=%s, win_count=%s, loss_count=%s, updated_at=NOW()
               WHERE id=%s''',
            (round(stats['total_pnl'] or 0, 2), stats['total'],
             stats['wins'] or 0, stats['losses'] or 0, day_id)
        )
