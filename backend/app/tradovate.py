"""
Tradovate API sync module.

Handles:
- Token acquisition and renewal (90-min tokens, renew at 75 min)
- Account listing
- fillPair/list — round-trip closed trades (entry + exit per position)
- Mapping fills → trade_rows + auto-creating/updating trading_days
- Cash balance snapshot

Credentials needed (store in Railway env vars):
  TRADOVATE_USERNAME     — your Tradovate login
  TRADOVATE_PASSWORD     — your Tradovate password
  TRADOVATE_APP_ID       — e.g. "TradeJournal" (from API settings)
  TRADOVATE_APP_VERSION  — e.g. "1.0"
  TRADOVATE_CID          — numeric client ID from API settings
  TRADOVATE_SEC          — secret key from API settings

These are YOUR credentials, so this uses direct auth (not OAuth).
Max 2 concurrent sessions — do not call accessTokenRequest on every request.
"""

import os, json, time, logging
from datetime import datetime, timezone, timedelta
from typing import Optional
import httpx
from psycopg.types.json import Json
from .db import get_conn

logger = logging.getLogger(__name__)

LIVE_BASE = 'https://live.tradovateapi.com/v1'
TOKEN_TTL = 90 * 60          # 90 minutes in seconds
RENEW_BEFORE = 15 * 60       # Renew 15 minutes before expiry

# ── In-memory token cache (single process) ───────────────────────────────────
# Shared across all requests within the Railway process.
_token_cache: dict = {
    'access_token': None,
    'expires_at': 0.0,
    'user_id': None,
}


def _has_credentials() -> bool:
    return bool(os.getenv('TRADOVATE_USERNAME') and os.getenv('TRADOVATE_PASSWORD'))


def _get_token() -> str:
    """Return a valid access token, acquiring or renewing as needed."""
    now = time.time()

    # Still valid with margin
    if _token_cache['access_token'] and now < (_token_cache['expires_at'] - RENEW_BEFORE):
        return _token_cache['access_token']

    # Try renewal first (only if we already have a token — avoids starting a new session)
    if _token_cache['access_token'] and now < _token_cache['expires_at']:
        try:
            return _renew_token()
        except Exception as e:
            logger.warning(f'Token renewal failed ({e}), acquiring new token')

    return _acquire_token()


def _acquire_token() -> str:
    """POST to accesstokenrequest. Starts a new session (limited to 2 concurrent)."""
    creds = {
        'name': os.getenv('TRADOVATE_USERNAME', ''),
        'password': os.getenv('TRADOVATE_PASSWORD', ''),
        'appId': os.getenv('TRADOVATE_APP_ID', 'TradeJournal'),
        'appVersion': os.getenv('TRADOVATE_APP_VERSION', '1.0'),
        'cid': os.getenv('TRADOVATE_CID', ''),
        'sec': os.getenv('TRADOVATE_SEC', ''),
    }
    # Remove empty optional fields so Tradovate doesn't reject them
    creds = {k: v for k, v in creds.items() if v}

    resp = httpx.post(
        f'{LIVE_BASE}/auth/accesstokenrequest',
        json=creds,
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()

    if data.get('errorText'):
        raise RuntimeError(f'Tradovate auth failed: {data["errorText"]}')

    token = data.get('accessToken')
    if not token:
        raise RuntimeError(f'No accessToken in response: {data}')

    _token_cache['access_token'] = token
    _token_cache['expires_at'] = time.time() + TOKEN_TTL
    _token_cache['user_id'] = data.get('userId')
    logger.info(f'Tradovate token acquired, userId={_token_cache["user_id"]}')
    return token


def _renew_token() -> str:
    """GET /auth/renewAccessToken using existing token."""
    resp = httpx.get(
        f'{LIVE_BASE}/auth/renewAccessToken',
        headers=_auth_headers(),
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get('errorText'):
        raise RuntimeError(f'Renewal failed: {data["errorText"]}')
    token = data.get('accessToken')
    if not token:
        raise RuntimeError('No accessToken in renewal response')
    _token_cache['access_token'] = token
    _token_cache['expires_at'] = time.time() + TOKEN_TTL
    logger.info('Tradovate token renewed')
    return token


def _auth_headers() -> dict:
    return {
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {_token_cache["access_token"]}',
    }


def _get(endpoint: str, params: dict = None) -> list | dict:
    token = _get_token()
    resp = httpx.get(
        f'{LIVE_BASE}/{endpoint}',
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {token}',
        },
        params=params,
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


# ── Public API ────────────────────────────────────────────────────────────────

def get_status() -> dict:
    """Return connection status without starting a session."""
    return {
        'configured': _has_credentials(),
        'connected': bool(_token_cache['access_token'] and time.time() < _token_cache['expires_at']),
        'user_id': _token_cache.get('user_id'),
        'token_expires_in': max(0, int(_token_cache['expires_at'] - time.time())) if _token_cache['expires_at'] else 0,
    }


def get_accounts() -> list:
    """Return list of accounts for the authenticated user."""
    data = _get('account/list')
    return data if isinstance(data, list) else []


def get_cash_balance(account_id: int) -> dict:
    """Return current cash balance snapshot for an account."""
    data = _get('cashBalance/getCashBalanceSnapshot', {'accountId': account_id})
    return data if isinstance(data, dict) else {}


def get_fill_pairs(account_id: int) -> list:
    """
    Return closed round-trip trades (fillPair/list).
    Each fillPair represents a completed position: entry fill + exit fill.

    Tradovate sometimes omits accountId on fillPair objects (especially for
    single-account users). Strategy: include a fillPair if its accountId
    matches OR if accountId is absent (single-account assumption).
    """
    data = _get('fillPair/list')
    if not isinstance(data, list):
        return []

    filtered = []
    for fp in data:
        fp_account_id = fp.get('accountId')
        if fp_account_id is None:
            # No accountId on the record — include it (single-account user)
            filtered.append(fp)
        elif fp_account_id == account_id:
            filtered.append(fp)
    return filtered


def get_fills(account_id: int) -> list:
    """Return individual fill executions. Same accountId-absent logic as fillPairs."""
    data = _get('fill/list')
    if not isinstance(data, list):
        return []
    filtered = []
    for f in data:
        f_account_id = f.get('accountId')
        if f_account_id is None or f_account_id == account_id:
            filtered.append(f)
    return filtered


def get_contracts_by_ids(contract_ids: list[int]) -> dict:
    """Batch-fetch contract details by ID. Returns {id: contract_dict}."""
    if not contract_ids:
        return {}
    # Use /ldeps for batch loading
    ids_str = ','.join(str(i) for i in set(contract_ids))
    data = _get('contract/ldeps', {'masterids': ids_str})
    result = {}
    if isinstance(data, list):
        for c in data:
            result[c['id']] = c
    return result


# ── Fill pair → trade row mapping ────────────────────────────────────────────

def _parse_tradovate_ts(ts_str: str | None) -> datetime | None:
    """Parse Tradovate timestamp string to UTC datetime."""
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
    Convert a Tradovate fillPair object to a trade_row row_data dict.
    Stores all raw fields too so nothing is lost before we know the exact schema.
    """
    contract_id = fp.get('contractId')
    contract = contracts.get(contract_id, {})
    symbol = (contract.get('name') or contract.get('symbol') or
              fp.get('contractName') or f'contract_{contract_id}')

    # Price fields — try multiple names Tradovate may use
    buy_price  = (fp.get('buyPrice')  or fp.get('buyFillPrice')  or
                  fp.get('entryPrice') if fp.get('openSide') == 'Buy' else None)
    sell_price = (fp.get('sellPrice') or fp.get('sellFillPrice') or
                  fp.get('exitPrice')  if fp.get('openSide') == 'Sell' else None)

    # Fallback: use generic price fields
    if buy_price is None:
        buy_price = fp.get('price') or fp.get('buyFillPrice') or fp.get('entryPrice')
    if sell_price is None:
        sell_price = fp.get('sellFillPrice') or fp.get('exitPrice')

    qty = fp.get('qty') or fp.get('quantity') or fp.get('contractQty') or 1
    pnl = (fp.get('realizedPnl') or fp.get('pnl') or fp.get('gainLoss') or
           fp.get('tradePnl') or fp.get('netPnl'))

    # Timestamps — try every variant
    entry_time = _parse_tradovate_ts(
        fp.get('entryTime') or fp.get('buyTime') or fp.get('openTime') or
        fp.get('createdTimestamp') or fp.get('timestamp')
    )
    exit_time = _parse_tradovate_ts(
        fp.get('exitTime') or fp.get('sellTime') or fp.get('closeTime') or
        fp.get('tradovateTradeDate')
    )
    trade_ts = entry_time or exit_time or _parse_tradovate_ts(
        fp.get('tradovateTradeDate') or fp.get('createdTimestamp')
    )

    # Direction
    open_side = fp.get('openSide') or fp.get('side') or fp.get('buySell') or ''
    side = 'Long' if open_side in ('Buy', 'buy', 'Long', 'long', 'B') else \
           'Short' if open_side in ('Sell', 'sell', 'Short', 'short', 'S') else \
           'Long'  # default until we see a real response

    entry_price = buy_price  if side == 'Long'  else sell_price
    exit_price  = sell_price if side == 'Long'  else buy_price

    return {
        # Mapped fields
        'tradovate_fill_pair_id': fp.get('id'),
        'symbol': symbol,
        'side': side,
        'qty': qty,
        'entry_price': entry_price,
        'exit_price': exit_price,
        'pnl': pnl,
        'entry_time': entry_time.isoformat() if entry_time else None,
        'exit_time': exit_time.isoformat() if exit_time else None,
        'trade_date': trade_ts.date().isoformat() if trade_ts else None,
        'source': 'tradovate_sync',
        # Raw dump — preserves everything for future mapping refinement
        '_raw': fp,
    }


# ── Database sync logic ───────────────────────────────────────────────────────

def sync_fills_to_journal(account_id: int) -> dict:
    """
    Fetch all fillPairs for the account and upsert them into the journal.

    For each fillPair:
    1. Look up or create the trading_day for that trade_date
    2. Upsert the fill into trade_rows (keyed on tradovate_fill_pair_id)
    3. Recompute pnl/num_trades/win_count/loss_count for the day

    Returns a summary dict: {imported, skipped, days_updated, errors}
    """
    if not _has_credentials():
        raise RuntimeError('Tradovate credentials not configured. Set TRADOVATE_USERNAME, TRADOVATE_PASSWORD, TRADOVATE_CID, TRADOVATE_SEC in env vars.')

    fill_pairs = get_fill_pairs(account_id)
    if not fill_pairs:
        return {'imported': 0, 'skipped': 0, 'days_updated': 0, 'errors': [], 'message': 'No fill pairs returned — account may have no closed trades, or fillPair/list requires a sync request first. Try triggering a WebSocket user/syncrequest.'}

    # Batch-fetch contracts
    contract_ids = [fp['contractId'] for fp in fill_pairs if fp.get('contractId')]
    contracts = get_contracts_by_ids(contract_ids)

    imported = 0
    skipped = 0
    errors = []
    days_touched = set()

    with get_conn() as conn, conn.cursor() as cur:
        for fp in fill_pairs:
            try:
                row_data = _fill_pair_to_row(fp, contracts)
                trade_date = row_data.get('trade_date')
                fill_pair_id = row_data.get('tradovate_fill_pair_id')

                if not trade_date or not fill_pair_id:
                    skipped += 1
                    continue

                # Check if already imported
                cur.execute(
                    "SELECT id FROM trade_rows WHERE row_data->>'tradovate_fill_pair_id' = %s",
                    (str(fill_pair_id),)
                )
                existing = cur.fetchone()
                if existing:
                    skipped += 1
                    continue

                # Get or create the trading_day
                cur.execute('SELECT id FROM trading_days WHERE trade_date = %s', (trade_date,))
                day_row = cur.fetchone()
                if not day_row:
                    symbol = row_data.get('symbol', '')
                    cur.execute(
                        '''INSERT INTO trading_days (trade_date, tickers, title)
                           VALUES (%s, %s, %s)
                           ON CONFLICT (trade_date) DO NOTHING RETURNING id''',
                        (trade_date, symbol, f'Auto-imported {trade_date}')
                    )
                    day_row = cur.fetchone()
                    if not day_row:
                        cur.execute('SELECT id FROM trading_days WHERE trade_date = %s', (trade_date,))
                        day_row = cur.fetchone()

                day_id = day_row['id']

                # Insert the trade row
                cur.execute(
                    'INSERT INTO trade_rows (day_id, row_data) VALUES (%s, %s)',
                    (day_id, Json(row_data))
                )

                days_touched.add((day_id, trade_date))
                imported += 1

            except Exception as e:
                errors.append(f'fillPair {fp.get("id")}: {e}')
                logger.exception(f'Error processing fillPair {fp.get("id")}')

        # Recompute day-level P&L stats for all touched days
        for day_id, _ in days_touched:
            _recompute_day_stats(cur, day_id)

        conn.commit()

    return {
        'imported': imported,
        'skipped': skipped,
        'days_updated': len(days_touched),
        'errors': errors,
    }


def _recompute_day_stats(cur, day_id: int):
    """Recompute pnl, num_trades, win_count, loss_count from trade_rows for a day."""
    cur.execute(
        """SELECT
            COUNT(*) as total,
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
               SET pnl = %s, num_trades = %s, win_count = %s, loss_count = %s, updated_at = NOW()
               WHERE id = %s''',
            (
                round(stats['total_pnl'] or 0, 2),
                stats['total'],
                stats['wins'] or 0,
                stats['losses'] or 0,
                day_id,
            )
        )
