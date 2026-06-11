"""
Tradovate OAuth sync module.

OAuth flow:
  1. GET  /tradovate/oauth/start     → redirects browser to Tradovate auth page
  2. User authorizes → Tradovate redirects to /tradovate/oauth/callback?code=XXX
  3. Backend exchanges code for access_token + refresh_token
  4. Tokens stored in DB, used for all subsequent API calls with full historical access

Env vars (add to Railway):
  TRADOVATE_CLIENT_ID     = 14044
  TRADOVATE_CLIENT_SECRET = 7c12031d-c6ac-4e66-9f67-72a407423ca8
  TRADOVATE_REDIRECT_URI  = https://tradejournal-production-a139.up.railway.app/tradovate/oauth/callback
"""

import os, json, time, logging, urllib.parse
from datetime import datetime, timezone
from typing import Optional
import httpx
from psycopg.types.json import Json
from .db import get_conn

logger = logging.getLogger(__name__)

LIVE_BASE   = 'https://live.tradovateapi.com/v1'
OAUTH_AUTH  = 'https://trader.tradovate.com/oauth'
OAUTH_TOKEN = 'https://live.tradovateapi.com/auth/oauthtoken'

_mem_token: dict = {}


def _save_token(data: dict):
    _mem_token.update(data)
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute('''CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMPTZ DEFAULT NOW())''')
            cur.execute('''INSERT INTO app_settings (key, value, updated_at)
                VALUES ('tradovate_oauth_token', %s, NOW())
                ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()''',
                (Json(data),))
            conn.commit()
    except Exception as e:
        logger.warning(f'Could not persist token: {e}')


def _load_token() -> dict:
    if _mem_token.get('access_token'):
        return _mem_token
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT value FROM app_settings WHERE key='tradovate_oauth_token'")
            row = cur.fetchone()
            if row and row['value']:
                _mem_token.update(row['value'])
                return _mem_token
    except Exception:
        pass
    return {}


def _has_oauth_token() -> bool:
    return bool(_load_token().get('access_token'))


def _has_oauth_config() -> bool:
    return bool(os.getenv('TRADOVATE_CLIENT_ID') and os.getenv('TRADOVATE_CLIENT_SECRET'))


def _get_valid_token() -> str:
    t = _load_token()
    if not t.get('access_token'):
        raise RuntimeError('Not authorized. Visit /tradovate/oauth/start')
    if time.time() < t.get('expires_at', 0) - 300:
        return t['access_token']
    refresh = t.get('refresh_token')
    if not refresh:
        raise RuntimeError('Token expired. Re-authorize at /tradovate/oauth/start')
    return _refresh_token(refresh)


def _refresh_token(refresh_token: str) -> str:
    resp = httpx.post(OAUTH_TOKEN, data={
        'grant_type': 'refresh_token',
        'refresh_token': refresh_token,
        'client_id': os.getenv('TRADOVATE_CLIENT_ID', ''),
        'client_secret': os.getenv('TRADOVATE_CLIENT_SECRET', ''),
    }, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    if data.get('error'):
        raise RuntimeError(f'Refresh failed: {data}')
    token_data = {
        'access_token': data['access_token'],
        'refresh_token': data.get('refresh_token', refresh_token),
        'expires_at': time.time() + data.get('expires_in', 5400),
    }
    _save_token(token_data)
    return token_data['access_token']


def exchange_code_for_token(code: str) -> dict:
    resp = httpx.post(OAUTH_TOKEN, data={
        'grant_type': 'authorization_code',
        'code': code,
        'redirect_uri': os.getenv('TRADOVATE_REDIRECT_URI', ''),
        'client_id': os.getenv('TRADOVATE_CLIENT_ID', ''),
        'client_secret': os.getenv('TRADOVATE_CLIENT_SECRET', ''),
    }, timeout=15)
    logger.info(f'Token exchange: {resp.status_code} {resp.text[:300]}')
    resp.raise_for_status()
    data = resp.json()
    if data.get('error'):
        raise RuntimeError(f'Token exchange failed: {data}')
    token_data = {
        'access_token': data['access_token'],
        'refresh_token': data.get('refresh_token'),
        'expires_at': time.time() + data.get('expires_in', 5400),
        'authorized_at': time.time(),
    }
    _save_token(token_data)
    return token_data


def build_auth_url() -> str:
    params = urllib.parse.urlencode({
        'response_type': 'code',
        'client_id': os.getenv('TRADOVATE_CLIENT_ID', ''),
        'redirect_uri': os.getenv('TRADOVATE_REDIRECT_URI', ''),
        'state': 'tradejournal',
    })
    return f'{OAUTH_AUTH}?{params}'


def _rest_get(endpoint: str, params: dict = None):
    token = _get_valid_token()
    resp = httpx.get(f'{LIVE_BASE}/{endpoint}',
        headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
        params=params, timeout=30)
    resp.raise_for_status()
    return resp.json()


def get_status() -> dict:
    t = _load_token()
    has = bool(t.get('access_token'))
    return {
        'oauth_configured': _has_oauth_config(),
        'authorized': has,
        'token_expires_in': max(0, int(t.get('expires_at', 0) - time.time())) if has else 0,
        'authorized_at': t.get('authorized_at'),
    }


def get_accounts() -> list:
    data = _rest_get('account/list')
    return data if isinstance(data, list) else []


def get_cash_balance(account_id: int) -> dict:
    data = _rest_get('cashBalance/getCashBalanceSnapshot', {'accountId': account_id})
    return data if isinstance(data, dict) else {}


RPT_BASE    = 'https://rpt-live.tradovateapi.com/v1'


def _rpt_get(endpoint: str, params: dict = None):
    """Call the Tradovate Reporting API with the same OAuth token."""
    token = _get_valid_token()
    resp = httpx.get(f'{RPT_BASE}/{endpoint}',
        headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
        params=params, timeout=30)
    resp.raise_for_status()
    return resp.json()


def fetch_fill_pairs(account_id: int) -> dict:
    result = {'fillPairs': [], 'fills': [], 'contracts': [], 'orders': []}
    errors = []

    # ── Primary: cashBalanceLog → fill/item chain ─────────────────────────────
    # cashBalanceLog returns 89 records with fillId and delta per entry.
    # We collect all fillIds, batch-fetch the fill details, then reconstruct trades.
    try:
        logs = _rest_get('cashBalanceLog/list')
        if isinstance(logs, list) and logs:
            # Collect entries that have a fillId (actual trade/commission events)
            fill_ids = [str(log['fillId']) for log in logs
                        if isinstance(log, dict) and log.get('fillId')]
            fill_ids = list(dict.fromkeys(fill_ids))  # deduplicate, preserve order

            if fill_ids:
                # fill/ldeps returns 401 — use fill/item individually instead
                fills = []
                for fid in fill_ids:
                    try:
                        f = _rest_get(f'fill/item', {'id': fid})
                        if isinstance(f, dict) and f.get('id'):
                            fills.append(f)
                    except Exception as e:
                        # Also try without params
                        try:
                            f = _rest_get(f'fill/item?id={fid}')
                            if isinstance(f, dict) and f.get('id'):
                                fills.append(f)
                        except Exception:
                            pass

                if fills:
                    result['fills'] = fills
                    logger.info(f'cashBalanceLog chain: {len(logs)} logs → {len(fill_ids)} fillIds → {len(fills)} fills')

                    # Fetch contracts
                    cids = ','.join(str(f['contractId']) for f in fills
                                    if isinstance(f, dict) and f.get('contractId'))
                    if cids:
                        try:
                            contracts = _rest_get('contract/ldeps', {'masterids': cids})
                            if isinstance(contracts, list):
                                result['contracts'] = contracts
                        except Exception as e:
                            errors.append(f'contract/ldeps: {e}')

                    # Now pair fills into round trips using the cashBalanceLog delta values
                    # Build a lookup: fillId -> log entry (for delta/pnl)
                    log_by_fill = {str(log['fillId']): log for log in logs
                                   if isinstance(log, dict) and log.get('fillId')}
                    result['fillPairs'] = _pair_fills_into_trades(fills, log_by_fill, result['contracts'])
                    logger.info(f'Paired into {len(result["fillPairs"])} round-trip trades')
                else:
                    errors.append('fill/ldeps returned no fills for the fillIds from cashBalanceLog')
            else:
                errors.append('cashBalanceLog returned no entries with fillId')
        else:
            errors.append(f'cashBalanceLog/list returned: {logs!r}')
    except Exception as e:
        errors.append(f'cashBalanceLog/list: {e}')

    result['_errors'] = errors
    return result


def _pair_fills_into_trades(fills: list, log_by_fill: dict, contracts: list) -> list:
    """
    Pair individual fills into round-trip trades using FIFO matching.
    Each fill is a single execution (buy or sell). We match opens with closes
    chronologically per contract.
    """
    from collections import defaultdict

    contracts_by_id = {c['id']: c for c in contracts if isinstance(c, dict) and c.get('id')}

    def parse_ts(ts):
        if not ts:
            return None
        for fmt in ('%Y-%m-%dT%H:%M:%S.%fZ', '%Y-%m-%dT%H:%M:%SZ'):
            try:
                return datetime.strptime(ts, fmt).replace(tzinfo=timezone.utc)
            except ValueError:
                continue
        return None

    # Sort fills by timestamp
    sorted_fills = sorted(
        [f for f in fills if isinstance(f, dict) and f.get('id')],
        key=lambda f: parse_ts(f.get('timestamp') or f.get('tradeTime') or '') or datetime.min.replace(tzinfo=timezone.utc)
    )

    # Group by contractId
    by_contract = defaultdict(list)
    for f in sorted_fills:
        if f.get('contractId'):
            by_contract[f['contractId']].append(f)

    paired = []

    for contract_id, contract_fills in by_contract.items():
        contract = contracts_by_id.get(contract_id, {})
        symbol = contract.get('name') or contract.get('symbol') or f'contract_{contract_id}'
        point_value = _get_point_value(contract.get('productName') or contract.get('name') or '')

        # FIFO matching
        open_stack = []  # list of {'fill': f, 'qty': remaining_qty}
        position = 0.0

        for f in contract_fills:
            # Determine buy/sell from fill
            buy_sell = f.get('buySell') or f.get('action') or ''
            is_buy = buy_sell.lower() in ('buy', 'b') if buy_sell else None

            # Try to infer from price change direction if buySell missing
            qty = float(f.get('qty') or f.get('quantity') or 1)
            price = float(f.get('price') or f.get('tradePrice') or 0)
            fill_ts = parse_ts(f.get('timestamp') or f.get('tradeTime'))
            fill_id = str(f.get('id', ''))

            # Get P&L delta from cashBalanceLog if available
            log_entry = log_by_fill.get(fill_id, {})
            delta = float(log_entry.get('delta', 0))

            # Determine direction: if we can't get it from the fill,
            # infer from delta sign and position
            if is_buy is None:
                if position <= 0:
                    is_buy = True  # default: assume buying to open/close short
                else:
                    is_buy = False

            if position == 0 or (position > 0 and is_buy) or (position < 0 and not is_buy):
                # Opening or adding to position
                open_stack.append({'fill': f, 'qty': qty, 'price': price, 'ts': fill_ts, 'fill_id': fill_id})
                position += qty if is_buy else -qty
            else:
                # Closing position — match against opens
                remaining = qty
                while remaining > 0 and open_stack:
                    open_item = open_stack[0]
                    match_qty = min(remaining, open_item['qty'])

                    long_trade = position > 0
                    entry_price = open_item['price']
                    exit_price  = price
                    entry_ts    = open_item['ts']
                    exit_ts     = fill_ts

                    gross_pnl = round((1 if long_trade else -1) * (exit_price - entry_price) * match_qty * point_value, 2)

                    # Use log delta if available and it's a trade event
                    if abs(delta) > 0 and log_entry.get('cashChangeType') not in ('Commission', 'NewSession'):
                        net_pnl = round(delta, 2)
                    else:
                        net_pnl = gross_pnl  # commission deducted separately

                    trade_date_str = exit_ts.strftime('%Y-%m-%d') if exit_ts else None

                    paired.append({
                        'tradovate_fill_pair_id': f"{open_item['fill_id']}_{fill_id}",
                        'symbol':       symbol,
                        'side':         'Long' if long_trade else 'Short',
                        'qty':          match_qty,
                        'entry_price':  entry_price,
                        'exit_price':   exit_price,
                        'pnl':          net_pnl,
                        'gross_pnl':    gross_pnl,
                        'entry_time':   entry_ts.isoformat() if entry_ts else None,
                        'exit_time':    exit_ts.isoformat() if exit_ts else None,
                        'trade_date':   trade_date_str,
                        'source':       'tradovate_oauth',
                        '_entry_fill':  open_item['fill'],
                        '_exit_fill':   f,
                    })

                    open_item['qty'] -= match_qty
                    remaining -= match_qty
                    position -= match_qty if long_trade else -match_qty
                    if open_item['qty'] <= 0:
                        open_stack.pop(0)

                if remaining > 0:
                    open_stack.append({'fill': f, 'qty': remaining, 'price': price, 'ts': fill_ts, 'fill_id': fill_id})
                    position += remaining if is_buy else -remaining

    return paired
    try:
        fps = _rest_get('fillPair/list')
        if isinstance(fps, list):
            result['fillPairs'] = fps
            logger.info(f'fillPair/list: {len(fps)} pairs')
    except Exception as e:
        errors.append(f'fillPair/list: {e}')

    # 2. Direct fill/list
    try:
        fills = _rest_get('fill/list')
        if isinstance(fills, list):
            result['fills'] = fills
            logger.info(f'fill/list: {len(fills)} fills')
    except Exception as e:
        errors.append(f'fill/list: {e}')

    # 3. If still empty, try order/deps chain
    if not result['fillPairs'] and not result['fills']:
        logger.info('Direct lists empty, trying order chain')
        try:
            orders = _rest_get('order/deps', {'masterid': account_id})
            if isinstance(orders, list) and orders:
                result['orders'] = orders
                order_ids = ','.join(str(o['id']) for o in orders if o.get('id'))
                if order_ids:
                    try:
                        fps2 = _rest_get('fillPair/ldeps', {'masterids': order_ids})
                        if isinstance(fps2, list):
                            result['fillPairs'] = fps2
                    except Exception as e:
                        errors.append(f'fillPair/ldeps: {e}')
                    try:
                        fills2 = _rest_get('fill/ldeps', {'masterids': order_ids})
                        if isinstance(fills2, list):
                            result['fills'] = fills2
                    except Exception as e:
                        errors.append(f'fill/ldeps: {e}')
        except Exception as e:
            errors.append(f'order/deps: {e}')

    # 4. Get contracts
    all_fills = result['fills']
    if all_fills:
        cids = ','.join(str(f['contractId']) for f in all_fills
                        if isinstance(f, dict) and f.get('contractId'))
        if cids:
            try:
                contracts = _rest_get('contract/ldeps', {'masterids': cids})
                if isinstance(contracts, list):
                    result['contracts'] = contracts
            except Exception as e:
                errors.append(f'contract/ldeps: {e}')

    # 5. If we have fillPairs but no fills, get fills by fill IDs for timestamps
    if result['fillPairs'] and not result['fills']:
        fill_ids = set()
        for fp in result['fillPairs']:
            if fp.get('buyFillId'): fill_ids.add(str(fp['buyFillId']))
            if fp.get('sellFillId'): fill_ids.add(str(fp['sellFillId']))
        if fill_ids:
            try:
                fills3 = _rest_get('fill/ldeps', {'masterids': ','.join(fill_ids)})
                if isinstance(fills3, list):
                    result['fills'] = fills3
                    cids = ','.join(str(f['contractId']) for f in fills3
                                    if isinstance(f, dict) and f.get('contractId'))
                    if cids and not result['contracts']:
                        contracts = _rest_get('contract/ldeps', {'masterids': cids})
                        if isinstance(contracts, list):
                            result['contracts'] = contracts
            except Exception as e:
                errors.append(f'fill/ldeps by fill ids: {e}')

    result['_errors'] = errors
    return result


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
    buy_fill  = fills_by_id.get(fp.get('buyFillId'), {})
    sell_fill = fills_by_id.get(fp.get('sellFillId'), {})
    contract_id = buy_fill.get('contractId') or sell_fill.get('contractId') or fp.get('contractId')
    contract = contracts_by_id.get(contract_id, {})
    symbol = contract.get('name') or contract.get('symbol') or f'contract_{contract_id}'

    buy_price  = fp.get('buyPrice')
    sell_price = fp.get('sellPrice')
    qty        = fp.get('qty') or 1

    buy_ts  = _parse_ts(buy_fill.get('tradeTime') or buy_fill.get('timestamp'))
    sell_ts = _parse_ts(sell_fill.get('tradeTime') or sell_fill.get('timestamp'))

    if buy_ts and sell_ts:
        if buy_ts <= sell_ts:
            side, entry_price, exit_price, entry_time, exit_time = 'Long', buy_price, sell_price, buy_ts, sell_ts
        else:
            side, entry_price, exit_price, entry_time, exit_time = 'Short', sell_price, buy_price, sell_ts, buy_ts
    else:
        side, entry_price, exit_price = 'Long', buy_price, sell_price
        entry_time, exit_time = buy_ts or sell_ts, sell_ts or buy_ts

    pnl = fp.get('realizedPnl') or fp.get('pnl')
    if pnl is None and entry_price is not None and exit_price is not None:
        pv = contract.get('valuePerPoint') or contract.get('pointValue') or 1
        pnl = round((1 if side == 'Long' else -1) * (exit_price - entry_price) * qty * pv, 2)

    trade_ts = exit_time or entry_time
    return {
        'tradovate_fill_pair_id': fp.get('id'),
        'symbol': symbol, 'side': side, 'qty': qty,
        'entry_price': entry_price, 'exit_price': exit_price, 'pnl': pnl,
        'entry_time': entry_time.isoformat() if entry_time else None,
        'exit_time': exit_time.isoformat() if exit_time else None,
        'trade_date': trade_ts.date().isoformat() if trade_ts else None,
        'source': 'tradovate_oauth', '_raw_fp': fp,
    }


def sync_fills_to_journal(account_id: int) -> dict:
    if not _has_oauth_token():
        raise RuntimeError('Not authorized. Visit /tradovate/oauth/start')

    data = fetch_fill_pairs(account_id)
    fill_pairs = data.get('fillPairs', [])

    if not fill_pairs:
        return {'imported': 0, 'skipped': 0, 'days_updated': 0,
                'errors': data.get('_errors', []),
                'counts': {k: len(v) for k, v in data.items() if isinstance(v, list)},
                'message': f'No trades found. Errors: {data.get("_errors", [])}'}

    imported = 0; skipped = 0; errors = list(data.get('_errors', [])); days_touched = set()

    with get_conn() as conn, conn.cursor() as cur:
        for row in fill_pairs:
            try:
                # Strip internal debug fields before storing
                store_row = {k: v for k, v in row.items() if not k.startswith('_')}
                fpid = store_row.get('tradovate_fill_pair_id')
                if not fpid: skipped += 1; continue

                cur.execute("SELECT id FROM trade_rows WHERE row_data->>'tradovate_fill_pair_id'=%s", (str(fpid),))
                if cur.fetchone(): skipped += 1; continue

                day_id = None
                td = store_row.get('trade_date')
                if td:
                    cur.execute('SELECT id FROM trading_days WHERE trade_date=%s', (td,))
                    dr = cur.fetchone()
                    if not dr:
                        cur.execute('INSERT INTO trading_days (trade_date,tickers,title) VALUES (%s,%s,%s) ON CONFLICT (trade_date) DO NOTHING RETURNING id',
                                    (td, store_row.get('symbol',''), f'Auto-imported {td}'))
                        dr = cur.fetchone()
                        if not dr:
                            cur.execute('SELECT id FROM trading_days WHERE trade_date=%s', (td,))
                            dr = cur.fetchone()
                    if dr: day_id = dr['id']

                cur.execute('INSERT INTO trade_rows (day_id,row_data) VALUES (%s,%s)', (day_id, Json(store_row)))
                if day_id: days_touched.add((day_id, td))
                imported += 1
            except Exception as e:
                errors.append(f'trade {row.get("tradovate_fill_pair_id")}: {e}')

        for did, _ in days_touched:
            _recompute(cur, did)
        conn.commit()

    return {'imported': imported, 'skipped': skipped, 'days_updated': len(days_touched),
            'errors': errors, 'counts': {k: len(v) for k, v in data.items() if isinstance(v, list)}}


def _recompute(cur, day_id: int):
    cur.execute("""SELECT COUNT(*) as total, SUM((row_data->>'pnl')::float) as tp,
                          SUM(CASE WHEN (row_data->>'pnl')::float>0 THEN 1 ELSE 0 END) as w,
                          SUM(CASE WHEN (row_data->>'pnl')::float<0 THEN 1 ELSE 0 END) as l
                   FROM trade_rows WHERE day_id=%s
                     AND row_data->>'pnl' IS NOT NULL AND row_data->>'pnl'!='null'""", (day_id,))
    s = cur.fetchone()
    if s and s['total'] > 0:
        cur.execute('UPDATE trading_days SET pnl=%s,num_trades=%s,win_count=%s,loss_count=%s,updated_at=NOW() WHERE id=%s',
                    (round(s['tp'] or 0, 2), s['total'], s['w'] or 0, s['l'] or 0, day_id))


# ── Reporting API: Cash History ────────────────────────────────────────

RPT_LIVE = 'https://rpt-live.tradovateapi.com/v1'
RPT_DEMO = 'https://rpt-demo.tradovateapi.com/v1'


def fetch_cash_history_csv(start_date: str, end_date: str,
                            account_id: int = None, account_spec: str = None,
                            demo: bool = False) -> str:
    """
    Call the Tradovate Reporting API for a single ≤31-day window.
    start_date / end_date: 'MM/DD/YYYY'
    account_id: internal Tradovate ID (e.g. 845116)
    account_spec: display account number (e.g. '1681368') — preferred by reporting API
    Returns raw CSV text.
    """
    token = _get_valid_token()
    base  = RPT_DEMO if demo else RPT_LIVE

    params = [
        {'name': 'startDate', 'value': start_date},
        {'name': 'endDate',   'value': end_date},
    ]
    # Reporting API prefers the display account number (accountSpec / name)
    acct_val = account_spec or (str(account_id) if account_id else None)
    if acct_val:
        params.append({'name': 'accountId', 'value': acct_val})

    payload = {
        'name': 'Cash History',
        'params': params,
        'representationType': 'csv',
        'timezone': -360,
    }

    # Try the two most likely endpoint paths
    for path in ['getReport', 'report/getReport']:
        resp = httpx.post(
            f'{base}/{path}',
            json=payload,
            headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
            timeout=30,
        )
        logger.info(f'Cash History [{path}] {start_date}→{end_date}: {resp.status_code} — {resp.text[:200]}')
        if resp.status_code == 404:
            continue          # try next path
        if not resp.is_success:
            raise RuntimeError(f'Reporting API {resp.status_code}: {resp.text[:600]}')
        return resp.text

    raise RuntimeError(f'Reporting API: both endpoint paths returned 404. Base URL: {base}')
    return resp.text


def parse_cash_history_csv(csv_text: str) -> list[dict]:
    """
    Parse the Cash History CSV into a list of row dicts.
    Normalises column names to snake_case.
    Only returns 'Trade' rows (filters out non-trade cash events).
    """
    import csv, io
    rows = []
    reader = csv.DictReader(io.StringIO(csv_text.strip()))
    for row in reader:
        # normalise keys
        norm = {k.strip().lower().replace(' ', '_').replace('/', '_'): v.strip()
                for k, v in row.items() if k}
        rows.append(norm)
    return rows


def fetch_cash_history_range(start_iso: str, end_iso: str,
                              account_id: int = None, account_spec: str = None,
                              demo: bool = False) -> list[dict]:
    """
    Fetch Cash History for an arbitrary date range by chunking into ≤30-day windows.
    """
    from datetime import date, timedelta

    def iso_to_rpt(s: str) -> str:
        y, m, d = s.split('-')
        return f'{m}/{d}/{y}'

    start = date.fromisoformat(start_iso)
    end   = date.fromisoformat(end_iso)
    all_rows: list[dict] = []
    cursor = start

    while cursor <= end:
        chunk_end = min(cursor + timedelta(days=29), end)
        csv_text  = fetch_cash_history_csv(
            iso_to_rpt(str(cursor)),
            iso_to_rpt(str(chunk_end)),
            account_id=account_id,
            account_spec=account_spec,
            demo=demo,
        )
        chunk_rows = parse_cash_history_csv(csv_text)
        all_rows.extend(chunk_rows)
        cursor = chunk_end + timedelta(days=1)

    return all_rows


def import_cash_history(account_id: int = None, account_spec: str = None,
                         start_iso: str = None, end_iso: str = None,
                         demo: bool = False) -> dict:
    """
    Fetch Cash History, map rows → trade_rows, upsert into DB.
    Returns summary dict.
    """
    from datetime import date, timedelta
    from psycopg.types.json import Json

    if not start_iso:
        start_iso = str(date.today() - timedelta(days=90))
    if not end_iso:
        end_iso = str(date.today())

    rows = fetch_cash_history_range(start_iso, end_iso,
                                    account_id=account_id,
                                    account_spec=account_spec,
                                    demo=demo)

    imported = skipped = 0
    errors: list[str] = []
    days_touched: set = set()

    with get_conn() as conn, conn.cursor() as cur:
        for row in rows:
            try:
                # key columns (names vary slightly by account — be tolerant)
                fill_id     = row.get('fill_id') or row.get('fillid') or ''
                trade_date_raw = (row.get('trade_date') or row.get('tradedate') or
                                  row.get('date') or '')
                pnl_raw     = row.get('realized_pnl') or row.get('pnl') or row.get('realized_p&l') or '0'
                symbol      = (row.get('contract') or row.get('symbol') or '').upper()
                side        = (row.get('buy_sell') or row.get('side') or '').upper()
                qty_raw     = row.get('qty') or row.get('quantity') or '1'
                entry_price = row.get('entry_price') or row.get('avg_entry') or ''
                exit_price  = row.get('exit_price') or row.get('avg_exit') or row.get('price') or ''

                if not fill_id or not trade_date_raw:
                    skipped += 1
                    continue

                # parse date
                td = trade_date_raw.strip()
                # accept MM/DD/YYYY or YYYY-MM-DD
                if '/' in td:
                    parts = td.split('/')
                    td = f'{parts[2]}-{parts[0].zfill(2)}-{parts[1].zfill(2)}'
                td = td[:10]   # strip any trailing time

                pnl    = float(pnl_raw.replace(',', '') or 0)
                qty    = int(float(qty_raw or 1))
                ep_val = float(entry_price.replace(',', '')) if entry_price else None
                xp_val = float(exit_price.replace(',', ''))  if exit_price  else None

                # derive product root (MNQ, NQ, ES, etc.)
                product = ''
                for root in ('MNQ', 'NQ', 'MES', 'ES', 'MYM', 'YM', 'M2K', 'RTY'):
                    if symbol.startswith(root):
                        product = root
                        break

                POINT_VALUES = {'MNQ': 2, 'NQ': 20, 'MES': 5, 'ES': 50,
                                'MYM': 0.5, 'YM': 5, 'M2K': 5, 'RTY': 50}
                gross_pnl = pnl   # reporting API already gives net in some fields

                store_row = {
                    'source': 'tradovate_rpt',
                    'fill_id': fill_id,
                    'trade_date': td,
                    'symbol': symbol,
                    'product': product,
                    'side': 'LONG' if 'B' in side.upper() else 'SHORT' if 'S' in side.upper() else side,
                    'qty': qty,
                    'entry_price': ep_val,
                    'exit_price': xp_val,
                    'pnl': pnl,
                    'gross_pnl': gross_pnl,
                    'raw': row,
                }

                # deduplicate by fill_id + source
                cur.execute("""SELECT id FROM trade_rows
                               WHERE row_data->>'fill_id'=%s
                                 AND row_data->>'source'='tradovate_rpt'""",
                            (fill_id,))
                if cur.fetchone():
                    skipped += 1
                    continue

                # find or create trading_day
                cur.execute("SELECT id FROM trading_days WHERE trade_date=%s", (td,))
                dr = cur.fetchone()
                if not dr:
                    cur.execute(
                        "INSERT INTO trading_days (trade_date, tickers, updated_at) VALUES (%s,%s,NOW()) RETURNING id",
                        (td, product or symbol),
                    )
                    dr = cur.fetchone()
                day_id = dr['id']

                cur.execute('INSERT INTO trade_rows (day_id, row_data) VALUES (%s, %s)',
                            (day_id, Json(store_row)))
                days_touched.add((day_id, td))
                imported += 1

            except Exception as e:
                errors.append(f'row fill_id={row.get("fill_id", "?")}: {e}')

        for did, _ in days_touched:
            _recompute(cur, did)
        conn.commit()

    return {
        'imported': imported,
        'skipped': skipped,
        'days_updated': len(days_touched),
        'errors': errors[:20],
        'total_rows': len(rows),
    }
