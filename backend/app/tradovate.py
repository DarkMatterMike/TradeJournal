"""
Tradovate API sync module.

Credentials needed in Railway env vars:
  TRADOVATE_USERNAME, TRADOVATE_PASSWORD
  TRADOVATE_CID, TRADOVATE_SEC
  TRADOVATE_APP_ID (e.g. "TradeJournal"), TRADOVATE_APP_VERSION (e.g. "1.0")
"""

import os, json, time, logging, asyncio, threading
from datetime import datetime, timezone
from typing import Optional
import httpx
from psycopg.types.json import Json
from .db import get_conn

logger = logging.getLogger(__name__)

LIVE_BASE   = 'https://live.tradovateapi.com/v1'
WS_URL      = 'wss://live.tradovateapi.com/v1/websocket'
TOKEN_TTL   = 90 * 60
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
    resp = httpx.get(f'{LIVE_BASE}/auth/renewAccessToken', headers=_auth_headers(), timeout=15)
    resp.raise_for_status()
    data = resp.json()
    if data.get('errorText'):
        raise RuntimeError(f'Renewal failed: {data["errorText"]}')
    token = data.get('accessToken')
    if not token:
        raise RuntimeError('No accessToken in renewal response')
    _token_cache['access_token'] = token
    _token_cache['expires_at']   = time.time() + TOKEN_TTL
    logger.info('Tradovate token renewed')
    return token


def _auth_headers() -> dict:
    return {'Content-Type': 'application/json', 'Authorization': f'Bearer {_token_cache["access_token"]}'}


def _get(endpoint: str, params: dict = None) -> list | dict:
    token = _get_token()
    resp = httpx.get(
        f'{LIVE_BASE}/{endpoint}',
        headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {token}'},
        params=params,
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


# ── WebSocket sync-request ────────────────────────────────────────────────────
# Tradovate's REST fillPair/list only returns trades already loaded into the
# server-side entity cache for the current session. Sending a user/syncrequest
# over WebSocket forces the server to load ALL historical entities into cache,
# after which the REST endpoints return complete data.

def trigger_websocket_sync() -> dict:
    """
    Open a WebSocket connection, authenticate, send user/syncrequest,
    wait for the 'props' response that confirms entities are loaded,
    then close. This populates the server cache so REST endpoints return
    full historical data.

    Runs synchronously using websockets library (blocking, timeout 30s).
    Returns summary of what was loaded.
    """
    try:
        import websockets.sync.client as ws_sync
    except ImportError:
        # Try async fallback
        return _trigger_websocket_sync_httpx()

    token = _get_token()
    summary = {'status': 'unknown', 'entities': []}

    try:
        with ws_sync.connect(WS_URL, open_timeout=10) as ws:
            # Step 1: Tradovate sends "o" (open) frame first
            msg = ws.recv(timeout=5)
            logger.info(f'WS open frame: {msg}')

            # Step 2: Authenticate
            auth_msg = f'authorize\n1\n\n{token}'
            ws.send(auth_msg)
            resp = ws.recv(timeout=10)
            logger.info(f'WS auth response: {resp[:200]}')

            # Step 3: Send syncrequest
            sync_msg = 'user/syncrequest\n2\n\n{"users":[]}'
            ws.send(sync_msg)

            # Step 4: Collect responses until we get props (entity data)
            entity_types = set()
            deadline = time.time() + 20
            while time.time() < deadline:
                try:
                    frame = ws.recv(timeout=5)
                    if not frame or frame == 'h':  # heartbeat
                        continue
                    # Tradovate frames start with 'a' for data arrays
                    if frame.startswith('a'):
                        payload = json.loads(frame[1:])  # strip 'a' prefix
                        for item in payload:
                            if isinstance(item, dict):
                                e_type = item.get('entityType') or item.get('e')
                                if e_type:
                                    entity_types.add(e_type)
                                # Stop once we see fill or position data
                                if e_type in ('Fill', 'FillPair', 'Position', 'Order'):
                                    summary['status'] = 'synced'
                except Exception:
                    break

            summary['entities'] = list(entity_types)
            if summary['status'] != 'synced':
                summary['status'] = 'completed'  # still ok, just no fill entities this session

    except Exception as e:
        logger.warning(f'WebSocket sync failed: {e}')
        summary['status'] = f'error: {e}'

    return summary


def _trigger_websocket_sync_httpx() -> dict:
    """Fallback WebSocket trigger using httpx (less reliable but no extra deps)."""
    return {'status': 'skipped', 'reason': 'websockets library not available'}


# ── Public API ────────────────────────────────────────────────────────────────

def get_status() -> dict:
    return {
        'configured':       _has_credentials(),
        'connected':        bool(_token_cache['access_token'] and time.time() < _token_cache['expires_at']),
        'user_id':          _token_cache.get('user_id'),
        'token_expires_in': max(0, int(_token_cache['expires_at'] - time.time())) if _token_cache['expires_at'] else 0,
    }


def get_accounts() -> list:
    data = _get('account/list')
    return data if isinstance(data, list) else []


def get_cash_balance(account_id: int) -> dict:
    data = _get('cashBalance/getCashBalanceSnapshot', {'accountId': account_id})
    return data if isinstance(data, dict) else {}


def get_fill_pairs(account_id: int) -> list:
    """
    Fetch fillPair/list. Tradovate does not include accountId on these records
    for single-account users, so we include all records where accountId is
    absent or matches.
    """
    data = _get('fillPair/list')
    if not isinstance(data, list):
        return []
    result = []
    for fp in data:
        fp_acct = fp.get('accountId')
        if fp_acct is None or fp_acct == account_id:
            result.append(fp)
    return result


def get_fills(account_id: int) -> list:
    data = _get('fill/list')
    if not isinstance(data, list):
        return []
    result = []
    for f in data:
        f_acct = f.get('accountId')
        if f_acct is None or f_acct == account_id:
            result.append(f)
    return result


def get_contracts_by_ids(contract_ids: list) -> dict:
    if not contract_ids:
        return {}
    ids_str = ','.join(str(i) for i in set(contract_ids))
    try:
        data = _get('contract/ldeps', {'masterids': ids_str})
        result = {}
        if isinstance(data, list):
            for c in data:
                result[c['id']] = c
        return result
    except Exception:
        return {}


# ── Fill pair → trade row ─────────────────────────────────────────────────────
#
# Confirmed field names from live API response:
#   id, positionId, buyFillId, sellFillId, qty, buyPrice, sellPrice, active, archived
#
# Missing from API response (must derive):
#   - contractId  → fetch from fill/item using buyFillId or sellFillId
#   - timestamps  → fetch from fill records
#   - pnl         → calculate from prices and contract tick value
#   - direction   → buyFillId < sellFillId usually means long (opened with buy)

def enrich_fill_pairs(fill_pairs: list, account_id: int) -> list:
    """
    Fetch individual fill records to get contractId and timestamps,
    which are missing from fillPair objects.
    Returns fill_pairs with added _fill_buy and _fill_sell dicts.
    """
    if not fill_pairs:
        return fill_pairs

    # Collect all fill IDs we need
    fill_ids = set()
    for fp in fill_pairs:
        if fp.get('buyFillId'):
            fill_ids.add(fp['buyFillId'])
        if fp.get('sellFillId'):
            fill_ids.add(fp['sellFillId'])

    if not fill_ids:
        return fill_pairs

    # Batch fetch fills
    fills_by_id = {}
    try:
        ids_str = ','.join(str(i) for i in fill_ids)
        data = _get('fill/ldeps', {'masterids': ids_str})
        if isinstance(data, list):
            for f in data:
                fills_by_id[f['id']] = f
        else:
            # Fallback: fetch all fills and index
            all_fills = get_fills(account_id)
            for f in all_fills:
                fills_by_id[f['id']] = f
    except Exception as e:
        logger.warning(f'Could not fetch fills for enrichment: {e}')
        # Try fill/list as fallback
        try:
            all_fills = get_fills(account_id)
            for f in all_fills:
                fills_by_id[f['id']] = f
        except Exception:
            pass

    # Attach fill details to each fill pair
    enriched = []
    for fp in fill_pairs:
        fp = dict(fp)  # copy
        fp['_fill_buy']  = fills_by_id.get(fp.get('buyFillId'),  {})
        fp['_fill_sell'] = fills_by_id.get(fp.get('sellFillId'), {})
        enriched.append(fp)
    return enriched


def _parse_ts(ts_str) -> Optional[datetime]:
    if not ts_str:
        return None
    for fmt in ('%Y-%m-%dT%H:%M:%S.%fZ', '%Y-%m-%dT%H:%M:%SZ', '%Y-%m-%dT%H:%M:%S'):
        try:
            return datetime.strptime(ts_str, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _fill_pair_to_row(fp: dict, contracts: dict) -> dict:
    """
    Map a fillPair (with optional enriched _fill_buy/_fill_sell) to row_data.
    Field names confirmed from live API: id, qty, buyPrice, sellPrice, buyFillId, sellFillId
    """
    buy_fill  = fp.get('_fill_buy',  {})
    sell_fill = fp.get('_fill_sell', {})

    # Contract — from fill records (fills have contractId)
    contract_id = (buy_fill.get('contractId') or sell_fill.get('contractId') or
                   fp.get('contractId'))
    contract    = contracts.get(contract_id, {})
    symbol      = contract.get('name') or contract.get('symbol') or f'contract_{contract_id}'

    # Prices — confirmed present on fillPair
    buy_price  = fp.get('buyPrice')
    sell_price = fp.get('sellPrice')
    qty        = fp.get('qty') or 1

    # Direction: buyFillId being the "open" fill means Long
    # Tradovate: buyFillId = fill that bought, sellFillId = fill that sold
    # For a long: buy to open, sell to close → entry=buy, exit=sell
    # For a short: sell to open, buy to close → entry=sell, exit=buy
    # Use fill timestamps to determine which came first
    buy_ts  = _parse_ts(buy_fill.get('timestamp')  or buy_fill.get('createdTimestamp'))
    sell_ts = _parse_ts(sell_fill.get('timestamp') or sell_fill.get('createdTimestamp'))

    if buy_ts and sell_ts:
        side         = 'Long' if buy_ts <= sell_ts else 'Short'
        entry_time   = buy_ts  if side == 'Long' else sell_ts
        exit_time    = sell_ts if side == 'Long' else buy_ts
        entry_price  = buy_price  if side == 'Long' else sell_price
        exit_price   = sell_price if side == 'Long' else buy_price
    else:
        # No timestamps — can't determine direction definitively
        # Assume long (most common for futures day traders)
        side        = 'Long'
        entry_time  = buy_ts or sell_ts
        exit_time   = sell_ts or buy_ts
        entry_price = buy_price
        exit_price  = sell_price

    # P&L — calculate if not provided
    # Futures P&L = (exit - entry) * qty * point_value
    # Point value varies by contract; use $1 as placeholder if unknown
    pnl = fp.get('realizedPnl') or fp.get('pnl')
    if pnl is None and entry_price and exit_price:
        # Get point value from contract
        point_value = contract.get('valuePerPoint') or contract.get('pointValue') or 1
        direction   = 1 if side == 'Long' else -1
        pnl         = round(direction * (exit_price - entry_price) * qty * point_value, 2)

    trade_ts = exit_time or entry_time
    trade_date = trade_ts.date().isoformat() if trade_ts else None

    return {
        'tradovate_fill_pair_id': fp.get('id'),
        'symbol':        symbol,
        'side':          side,
        'qty':           qty,
        'entry_price':   entry_price,
        'exit_price':    exit_price,
        'pnl':           pnl,
        'entry_time':    entry_time.isoformat() if entry_time else None,
        'exit_time':     exit_time.isoformat()  if exit_time  else None,
        'trade_date':    trade_date,
        'source':        'tradovate_sync',
        '_raw':          fp,
    }


# ── Database sync ─────────────────────────────────────────────────────────────

def sync_fills_to_journal(account_id: int, run_ws_sync: bool = True) -> dict:
    """
    1. Optionally trigger WebSocket user/syncrequest to populate server cache
    2. Fetch fillPair/list
    3. Enrich each fill pair with fill-level details (contractId, timestamps)
    4. Map to trade_rows and upsert into the journal
    """
    if not _has_credentials():
        raise RuntimeError('Tradovate credentials not configured.')

    ws_result = {}
    if run_ws_sync:
        try:
            ws_result = trigger_websocket_sync()
            logger.info(f'WebSocket sync result: {ws_result}')
        except Exception as e:
            logger.warning(f'WebSocket sync skipped: {e}')
            ws_result = {'status': f'skipped: {e}'}

    fill_pairs = get_fill_pairs(account_id)

    if not fill_pairs:
        return {
            'imported': 0, 'skipped': 0, 'days_updated': 0, 'errors': [],
            'ws_sync': ws_result,
            'message': 'No fill pairs returned. The WebSocket sync was attempted but may not have loaded historical data yet. Try keeping Tradovate open in your browser and syncing again.',
        }

    # Enrich with fill-level details
    fill_pairs = enrich_fill_pairs(fill_pairs, account_id)

    # Fetch contracts
    contract_ids = [fp['_fill_buy'].get('contractId') or fp['_fill_sell'].get('contractId')
                    for fp in fill_pairs]
    contract_ids = [c for c in contract_ids if c]
    contracts    = get_contracts_by_ids(contract_ids)

    imported     = 0
    skipped      = 0
    errors       = []
    days_touched = set()

    with get_conn() as conn, conn.cursor() as cur:
        for fp in fill_pairs:
            try:
                row_data    = _fill_pair_to_row(fp, contracts)
                trade_date  = row_data.get('trade_date')
                fill_pair_id = row_data.get('tradovate_fill_pair_id')

                if not fill_pair_id:
                    skipped += 1
                    continue

                # Idempotency check
                cur.execute(
                    "SELECT id FROM trade_rows WHERE row_data->>'tradovate_fill_pair_id' = %s",
                    (str(fill_pair_id),)
                )
                if cur.fetchone():
                    skipped += 1
                    continue

                # Get or create trading_day
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
                    day_id = day_row['id'] if day_row else None
                else:
                    day_id = None

                if day_id:
                    cur.execute('INSERT INTO trade_rows (day_id, row_data) VALUES (%s, %s)',
                                (day_id, Json(row_data)))
                    days_touched.add((day_id, trade_date))
                else:
                    # No date — still store without a day link
                    cur.execute('INSERT INTO trade_rows (day_id, row_data) VALUES (%s, %s)',
                                (None, Json(row_data)))

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
        'ws_sync':      ws_result,
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
