import csv, io, json, os, re
from contextlib import asynccontextmanager
from psycopg.types.json import Json
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from .db import get_conn, init_db
from .storage import R2Storage
from .ai import analyze_chart_image_bytes, summarize_day, embed_text, has_ai, generate_recommendation
from . import tradovate as tv

load_dotenv()

@asynccontextmanager
async def lifespan(app):
    init_db()
    yield

app = FastAPI(title='Trading Intelligence System', lifespan=lifespan)
origins = [x.strip() for x in os.getenv('CORS_ORIGINS', 'http://localhost:5173').split(',') if x.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=True, allow_methods=['*'], allow_headers=['*'])
storage = R2Storage()

# ── Helpers ──────────────────────────────────────────

def _extract_pnl_from_rows(rows: list) -> dict:
    """Auto-extract performance metrics from CSV trade rows."""
    pnl_keys = ['pnl', 'p&l', 'profit', 'net', 'realized', 'realizedpnl', 'profit/loss', 'profitloss', 'net_pnl', 'amount']

    total_pnl = 0.0
    wins = 0
    losses = 0
    found_pnl = False

    for row in rows:
        row_lower = {k.lower().strip().replace(' ', ''): v for k, v in row.items()}
        for pk in pnl_keys:
            pk_clean = pk.replace(' ', '')
            if pk_clean in row_lower:
                try:
                    val = re.sub(r'[,$()]', '', str(row_lower[pk_clean]).strip())
                    if not val or val == '-':
                        continue
                    num = float(val)
                    total_pnl += num
                    found_pnl = True
                    if num > 0:
                        wins += 1
                    elif num < 0:
                        losses += 1
                except (ValueError, TypeError):
                    continue
                break

    if not found_pnl:
        return {}

    num_trades = wins + losses
    return {
        'pnl': round(total_pnl, 2),
        'num_trades': num_trades,
        'win_count': wins,
        'loss_count': losses,
    }


def _auto_link_patterns(cur, day_id: int, pattern_tags: list, confidence: float = 0.85):
    """Step 3: Auto-create and link patterns from AI-detected tags."""
    if not pattern_tags:
        return

    tag_to_name = {
        'gap_and_go': 'Gap and Go', 'vwap_reclaim': 'VWAP Reclaim',
        'failed_breakout': 'Failed Breakout', 'orb_breakout': 'Opening Range Breakout',
        'orb_breakdown': 'Opening Range Breakdown', 'trend_day': 'Trend Day',
        'reversal_day': 'Reversal Day', 'chop_day': 'Chop Day',
        'liquidity_sweep': 'Liquidity Sweep', 'cisd': 'CISD',
        'power_of_3': 'Power of 3', 'fvg_entry': 'FVG Entry',
        'breakout_retest': 'Breakout Retest', 'double_top': 'Double Top',
        'double_bottom': 'Double Bottom', 'higher_low': 'Higher Low',
        'lower_high': 'Lower High',
    }

    for tag in pattern_tags:
        name = tag_to_name.get(tag, tag.replace('_', ' ').title())
        cur.execute('INSERT INTO playbook_patterns(name, description) VALUES(%s, %s) ON CONFLICT(name) DO NOTHING RETURNING id', (name, f'Auto-detected pattern: {name}'))
        row = cur.fetchone()
        if not row:
            cur.execute('SELECT id FROM playbook_patterns WHERE name=%s', (name,))
            row = cur.fetchone()
        if row:
            cur.execute('''INSERT INTO day_pattern_links(day_id, pattern_id, confidence, notes)
                VALUES(%s, %s, %s, %s) ON CONFLICT(day_id, pattern_id)
                DO UPDATE SET confidence=EXCLUDED.confidence, notes=EXCLUDED.notes''',
                (day_id, row['id'], confidence, f'AI-detected: {tag}'))


def _update_pattern_stats(cur):
    """Recompute win_rate, avg_pnl, sample_count for all patterns."""
    cur.execute('''
        UPDATE playbook_patterns p SET
            sample_count = sub.cnt,
            win_rate = sub.wr,
            avg_pnl = sub.ap,
            avg_r_multiple = sub.ar,
            updated_at = NOW()
        FROM (
            SELECT dpl.pattern_id,
                COUNT(*) AS cnt,
                AVG(CASE WHEN d.pnl > 0 THEN 1.0 WHEN d.pnl < 0 THEN 0.0 ELSE NULL END) AS wr,
                AVG(d.pnl) AS ap,
                AVG(d.r_multiple) AS ar
            FROM day_pattern_links dpl
            JOIN trading_days d ON d.id = dpl.day_id
            GROUP BY dpl.pattern_id
        ) sub WHERE p.id = sub.pattern_id
    ''')


# ── Routes ───────────────────────────────────────────

@app.get('/health')
def health():
    return {'ok': True, 'ai_enabled': has_ai(), 'r2_enabled': storage.enabled}

@app.get('/stats')
def dashboard_stats():
    """Aggregate stats for the dashboard."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute('''SELECT
            COUNT(*) as total_days,
            SUM(pnl) as total_pnl,
            AVG(pnl) as avg_pnl,
            AVG(execution_score) as avg_score,
            SUM(num_trades) as total_trades,
            SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as winning_days,
            SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) as losing_days,
            AVG(CASE WHEN pnl > 0 THEN 1.0 WHEN pnl < 0 THEN 0.0 ELSE NULL END) as win_rate,
            MAX(pnl) as best_day,
            MIN(pnl) as worst_day
            FROM trading_days''')
        overview = cur.fetchone()
        cur.execute('''SELECT p.name, p.sample_count, p.win_rate, p.avg_pnl
            FROM playbook_patterns p WHERE p.sample_count > 0
            ORDER BY p.sample_count DESC LIMIT 10''')
        top_patterns = cur.fetchall()
        cur.execute('SELECT * FROM trading_days ORDER BY trade_date DESC LIMIT 10')
        recent = cur.fetchall()
        # Equity curve — last 60 days ordered chronologically, cumulative P&L
        cur.execute('''SELECT trade_date::text, pnl
            FROM trading_days WHERE pnl IS NOT NULL
            ORDER BY trade_date ASC LIMIT 60''')
        eq_rows = cur.fetchall()
        cumulative = 0.0
        equity_curve = []
        for r in eq_rows:
            cumulative = round(cumulative + (r['pnl'] or 0), 2)
            equity_curve.append({'date': r['trade_date'], 'equity': cumulative})
        return {'overview': overview, 'top_patterns': top_patterns, 'recent_days': recent, 'equity_curve': equity_curve}

@app.get('/calendar')
def calendar_data(year: int = None, month: int = None):
    """Return trading day summaries for a calendar view.
    If year/month omitted, returns the last 13 months.
    Returns one row per trading day with just the fields needed for heatmap rendering.
    """
    with get_conn() as conn, conn.cursor() as cur:
        if year and month:
            cur.execute('''
                SELECT id, trade_date::text, pnl, num_trades, win_count, loss_count,
                       execution_score, ai_pattern_tags, tags, tickers
                FROM trading_days
                WHERE date_trunc('month', trade_date) = make_date(%s, %s, 1)
                ORDER BY trade_date ASC
            ''', (year, month))
        else:
            cur.execute('''
                SELECT id, trade_date::text, pnl, num_trades, win_count, loss_count,
                       execution_score, ai_pattern_tags, tags, tickers
                FROM trading_days
                WHERE trade_date >= (CURRENT_DATE - INTERVAL '13 months')
                ORDER BY trade_date ASC
            ''')
        return cur.fetchall()

@app.get('/days')
def list_days(q: str = '', limit: int = 200):
    with get_conn() as conn, conn.cursor() as cur:
        if q:
            like = f'%{q}%'
            cur.execute('''SELECT * FROM trading_days
                WHERE title ILIKE %s OR tickers ILIKE %s OR tags ILIKE %s
                OR ai_summary ILIKE %s OR ai_pattern_tags ILIKE %s
                ORDER BY trade_date DESC LIMIT %s''',
                (like, like, like, like, like, limit))
        else:
            cur.execute('SELECT * FROM trading_days ORDER BY trade_date DESC LIMIT %s', (limit,))
        return cur.fetchall()

@app.post('/days')
def create_day(payload: dict):
    if not payload.get('trade_date'):
        raise HTTPException(400, 'trade_date is required')
    fields = ['trade_date', 'title', 'tickers', 'strategy', 'session', 'market_bias',
              'premarket_notes', 'trade_notes', 'ideal_notes', 'lessons', 'tags', 'mood',
              'rule_following_score', 'pnl', 'num_trades', 'win_count', 'loss_count',
              'r_multiple', 'custom_fields']
    vals = {k: payload.get(k, {} if k == 'custom_fields' else None) for k in fields}
    vals['custom_fields'] = Json(vals.get('custom_fields') or {})
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute('''INSERT INTO trading_days (trade_date,title,tickers,strategy,session,market_bias,
            premarket_notes,trade_notes,ideal_notes,lessons,tags,mood,rule_following_score,
            pnl,num_trades,win_count,loss_count,r_multiple,custom_fields)
            VALUES (%(trade_date)s,COALESCE(%(title)s,''),COALESCE(%(tickers)s,''),COALESCE(%(strategy)s,''),
            COALESCE(%(session)s,''),COALESCE(%(market_bias)s,''),COALESCE(%(premarket_notes)s,''),
            COALESCE(%(trade_notes)s,''),COALESCE(%(ideal_notes)s,''),COALESCE(%(lessons)s,''),
            COALESCE(%(tags)s,''),COALESCE(%(mood)s,''),%(rule_following_score)s,
            %(pnl)s,%(num_trades)s,%(win_count)s,%(loss_count)s,%(r_multiple)s,%(custom_fields)s)
            ON CONFLICT (trade_date) DO UPDATE SET
            title=EXCLUDED.title,tickers=EXCLUDED.tickers,strategy=EXCLUDED.strategy,
            session=EXCLUDED.session,market_bias=EXCLUDED.market_bias,
            premarket_notes=EXCLUDED.premarket_notes,trade_notes=EXCLUDED.trade_notes,
            ideal_notes=EXCLUDED.ideal_notes,lessons=EXCLUDED.lessons,tags=EXCLUDED.tags,
            mood=EXCLUDED.mood,rule_following_score=EXCLUDED.rule_following_score,
            pnl=EXCLUDED.pnl,num_trades=EXCLUDED.num_trades,win_count=EXCLUDED.win_count,
            loss_count=EXCLUDED.loss_count,r_multiple=EXCLUDED.r_multiple,
            custom_fields=EXCLUDED.custom_fields,updated_at=NOW()
            RETURNING *''', vals)
        row = cur.fetchone()
        conn.commit()
        return row

@app.get('/days/{day_id}')
def get_day(day_id: int):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM trading_days WHERE id=%s', (day_id,))
        day = cur.fetchone()
        if not day:
            raise HTTPException(404, 'Day not found')
        cur.execute('SELECT * FROM uploads WHERE day_id=%s ORDER BY created_at DESC', (day_id,))
        uploads = cur.fetchall()
        cur.execute('SELECT * FROM trade_rows WHERE day_id=%s ORDER BY id', (day_id,))
        trades = cur.fetchall()
        cur.execute('''SELECT l.*, d.trade_date, d.title, d.tickers, d.ai_summary, d.tags, d.pnl, d.ai_pattern_tags
            FROM similar_day_links l JOIN trading_days d ON d.id=l.matched_day_id
            WHERE l.source_day_id=%s ORDER BY l.similarity_score DESC''', (day_id,))
        similar = cur.fetchall()
        cur.execute('''SELECT p.*, dpl.confidence, dpl.notes AS link_notes
            FROM day_pattern_links dpl JOIN playbook_patterns p ON p.id=dpl.pattern_id
            WHERE dpl.day_id=%s ORDER BY dpl.confidence DESC''', (day_id,))
        patterns = cur.fetchall()
        return {'day': day, 'uploads': uploads, 'trade_rows': trades, 'similar': similar, 'patterns': patterns}

@app.put('/days/{day_id}')
def update_day(day_id: int, payload: dict):
    allowed = ['trade_date', 'title', 'tickers', 'strategy', 'session', 'market_bias',
               'premarket_notes', 'trade_notes', 'ideal_notes', 'lessons', 'tags', 'mood',
               'rule_following_score', 'pnl', 'num_trades', 'win_count', 'loss_count',
               'r_multiple', 'ai_summary', 'ai_setup_tags', 'ai_market_structure',
               'ai_execution_review', 'custom_fields']
    json_cols = ['custom_fields', 'ai_market_structure', 'ai_execution_review']
    sets = []
    vals = {'id': day_id}
    for k in allowed:
        if k in payload:
            sets.append(f'{k}=%({k})s')
            vals[k] = Json(payload[k]) if k in json_cols else payload[k]
    if not sets:
        return get_day(day_id)['day']
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"UPDATE trading_days SET {', '.join(sets)}, updated_at=NOW() WHERE id=%(id)s RETURNING *", vals)
        row = cur.fetchone()
        conn.commit()
        return row

@app.delete('/days/{day_id}')
def delete_day(day_id: int):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute('SELECT id FROM trading_days WHERE id=%s', (day_id,))
        if not cur.fetchone():
            raise HTTPException(404, 'Day not found')
        cur.execute('DELETE FROM trading_days WHERE id=%s', (day_id,))
        conn.commit()
        return {'deleted': day_id}

# ── Upload with auto P&L extraction ─────────────────

@app.post('/days/{day_id}/upload')
async def upload(day_id: int, kind: str = Form(...), file: UploadFile = File(...), run_ai: bool = Form(True)):
    content = await file.read()
    if not content:
        raise HTTPException(400, 'Empty file')
    if not storage.enabled:
        raise HTTPException(503, 'File storage is not configured.')
    stored = storage.put_file(day_id=day_id, kind=kind, filename=file.filename, content=content, content_type=file.content_type)

    extracted = ''
    ai_json = {}
    ai_desc = ''

    if kind == 'csv':
        try:
            text = content.decode('utf-8-sig', errors='replace')
            rows = list(csv.DictReader(io.StringIO(text)))
            extracted = json.dumps(rows[:500])
        except Exception as e:
            extracted = f'CSV parse error: {e}'
    elif run_ai and (file.content_type or '').startswith('image/'):
        ai_json = analyze_chart_image_bytes(content, kind, file.content_type or 'image/png')
        ai_desc = json.dumps(ai_json)

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute('''INSERT INTO uploads(day_id,kind,filename,content_type,storage_key,url,extracted_text,ai_description,ai_json)
            VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *''',
            (day_id, kind, file.filename, stored['content_type'], stored['storage_key'],
             stored['url'], extracted, ai_desc, Json(ai_json or {})))
        up = cur.fetchone()

        # ── Auto-extract P&L from CSV ──
        if kind == 'csv' and extracted.startswith('['):
            parsed_rows = json.loads(extracted)
            for r in parsed_rows:
                cur.execute('INSERT INTO trade_rows(day_id,row_data) VALUES(%s,%s)', (day_id, Json(r)))
            metrics = _extract_pnl_from_rows(parsed_rows)
            if metrics:
                cur.execute('''UPDATE trading_days SET pnl=%s, num_trades=%s, win_count=%s, loss_count=%s, updated_at=NOW()
                    WHERE id=%s AND pnl IS NULL''',
                    (metrics.get('pnl'), metrics.get('num_trades'), metrics.get('win_count'), metrics.get('loss_count'), day_id))

        # ── Store chart analysis fields on the day ──
        if kind == 'premarket' and ai_json.get('gap_direction'):
            cur.execute('''UPDATE trading_days SET gap_direction=%s, premarket_trend=%s, volume_assessment=%s,
                key_levels=%s, likely_scenarios=%s, updated_at=NOW() WHERE id=%s''',
                (ai_json.get('gap_direction', ''), ai_json.get('premarket_trend', ''),
                 ai_json.get('volume_assessment', ''),
                 ', '.join(ai_json.get('key_levels', [])) if isinstance(ai_json.get('key_levels'), list) else str(ai_json.get('key_levels', '')),
                 ', '.join(ai_json.get('likely_scenarios', [])) if isinstance(ai_json.get('likely_scenarios'), list) else str(ai_json.get('likely_scenarios', '')),
                 day_id))

        # ── Auto-tag patterns from chart analysis ──
        chart_tags = ai_json.get('pattern_tags', [])
        if chart_tags:
            _auto_link_patterns(cur, day_id, chart_tags, confidence=0.7)

        # ── Embedding ──
        content_for_embedding = ' '.join([kind, file.filename, extracted, ai_desc])
        emb = embed_text(content_for_embedding)
        if emb:
            cur.execute('INSERT INTO ai_embeddings(day_id,upload_id,embedding_type,content,embedding) VALUES(%s,%s,%s,%s,%s)',
                (day_id, up['id'], kind, content_for_embedding, emb))

        conn.commit()

    # ── Auto-find similar days on premarket upload ──
    similar_days = []
    if kind == 'premarket' and emb:
        try:
            similar_days = find_similar(day_id, limit=5)
        except Exception:
            pass

    result = dict(up)
    result['similar_days'] = similar_days
    return result

# ── Intelligence with auto-pattern tagging ───────────

@app.post('/days/{day_id}/intelligence')
def run_intelligence(day_id: int):
    bundle = get_day(day_id)
    intel = summarize_day(bundle['day'], bundle['uploads'], bundle['trade_rows'])

    # Extract structured fields
    scores = intel.get('execution_scores', {})
    pattern_tags = intel.get('pattern_tags', [])
    pattern_tags_str = ', '.join(pattern_tags) if isinstance(pattern_tags, list) else str(pattern_tags)

    text = json.dumps({'day': bundle['day'], 'uploads': bundle['uploads'],
                       'trades': bundle['trade_rows'][:100], 'intel': intel}, default=str)
    emb = embed_text(text)

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute('''UPDATE trading_days SET
            ai_summary=%s, ai_setup_tags=%s, ai_pattern_tags=%s,
            ai_market_structure=%s, ai_execution_review=%s,
            execution_score=%s, bias_score=%s, patience_score=%s,
            entry_score=%s, risk_mgmt_score=%s, profit_taking_score=%s,
            biggest_mistake=%s, biggest_strength=%s,
            gap_direction=COALESCE(NULLIF(gap_direction,''), %s),
            premarket_trend=COALESCE(NULLIF(premarket_trend,''), %s),
            volume_assessment=COALESCE(NULLIF(volume_assessment,''), %s),
            key_levels=COALESCE(NULLIF(key_levels,''), %s),
            likely_scenarios=COALESCE(NULLIF(likely_scenarios,''), %s),
            lessons=CASE WHEN lessons='' THEN %s ELSE lessons END,
            updated_at=NOW()
            WHERE id=%s RETURNING *''', (
            intel.get('summary', ''),
            intel.get('setup_tags', pattern_tags_str),
            pattern_tags_str,
            Json(intel.get('market_structure', {})),
            Json(intel.get('execution_review', {})),
            scores.get('overall'),
            scores.get('bias'),
            scores.get('patience'),
            scores.get('entry'),
            scores.get('risk_management'),
            scores.get('profit_taking'),
            intel.get('biggest_mistake', ''),
            intel.get('biggest_strength', ''),
            intel.get('gap_direction', ''),
            intel.get('premarket_trend', ''),
            intel.get('volume_assessment', ''),
            intel.get('key_levels', ''),
            ', '.join(intel.get('likely_scenarios', [])) if isinstance(intel.get('likely_scenarios'), list) else str(intel.get('likely_scenarios', '')),
            intel.get('lessons', ''),
            day_id,
        ))
        row = cur.fetchone()

        # Step 3: Auto-link detected patterns
        _auto_link_patterns(cur, day_id, pattern_tags, confidence=0.85)

        # Recompute pattern stats
        _update_pattern_stats(cur)

        if emb:
            cur.execute('INSERT INTO ai_embeddings(day_id,embedding_type,content,embedding) VALUES(%s,%s,%s,%s)',
                (day_id, 'day_intelligence', text, emb))
        conn.commit()
        return {'day': row, 'intelligence': intel}

# ── Similar days ─────────────────────────────────────

@app.post('/days/{day_id}/find-similar')
def find_similar(day_id: int, limit: int = 10):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT embedding FROM ai_embeddings
            WHERE day_id=%s AND embedding_type IN ('premarket','day_intelligence','day')
            ORDER BY created_at DESC LIMIT 1""", (day_id,))
        base = cur.fetchone()
        if not base or base['embedding'] is None:
            raise HTTPException(400, 'No embedding found. Upload a premarket image or run intelligence first.')
        cur.execute('''SELECT e.day_id, d.trade_date, d.title, d.tickers, d.ai_summary, d.tags,
            d.pnl, d.ai_pattern_tags, d.execution_score,
            MAX(1 - (e.embedding <=> %s::vector)) AS score
            FROM ai_embeddings e JOIN trading_days d ON d.id=e.day_id
            WHERE e.day_id <> %s
            GROUP BY e.day_id,d.trade_date,d.title,d.tickers,d.ai_summary,d.tags,d.pnl,d.ai_pattern_tags,d.execution_score
            ORDER BY score DESC LIMIT %s''', (base['embedding'], day_id, limit))
        rows = cur.fetchall()
        for r in rows:
            cur.execute('''INSERT INTO similar_day_links(source_day_id,matched_day_id,similarity_score,reason,ai_reason)
                VALUES(%s,%s,%s,%s,%s) ON CONFLICT(source_day_id,matched_day_id)
                DO UPDATE SET similarity_score=EXCLUDED.similarity_score, reason=EXCLUDED.reason, ai_reason=EXCLUDED.ai_reason''',
                (day_id, r['day_id'], float(r['score'] or 0),
                 'AI vector similarity', Json({'method': 'pgvector cosine distance'})))
        conn.commit()
        return rows

# ── Step 4: Query endpoint ───────────────────────────

@app.post('/intelligence/bulk')
def bulk_intelligence(payload: dict = {}):
    """
    Run intelligence on all days that don't have an AI summary yet.
    Processes up to `limit` days per call (default 50) to avoid timeout.
    Returns counts of processed, skipped, and errors.
    Call repeatedly until remaining=0 to process all days.
    """
    if not has_ai():
        raise HTTPException(503, 'AI not configured. Set OPENAI_API_KEY.')

    limit = min(int(payload.get('limit', 50)), 100)
    skip_existing = payload.get('skip_existing', True)  # skip days already analyzed

    with get_conn() as conn, conn.cursor() as cur:
        if skip_existing:
            cur.execute('''SELECT id, trade_date FROM trading_days
                WHERE (ai_summary IS NULL OR ai_summary = '')
                ORDER BY trade_date DESC LIMIT %s''', (limit,))
        else:
            cur.execute('SELECT id, trade_date FROM trading_days ORDER BY trade_date DESC LIMIT %s', (limit,))
        days_to_process = cur.fetchall()

        # Count remaining (for progress reporting)
        cur.execute("SELECT COUNT(*) as total FROM trading_days WHERE ai_summary IS NULL OR ai_summary = ''")
        remaining_before = cur.fetchone()['total']

    processed = 0
    skipped = 0
    errors = []

    for day_row in days_to_process:
        day_id = day_row['id']
        try:
            bundle = get_day(day_id)
            intel = summarize_day(bundle['day'], bundle['uploads'], bundle['trade_rows'])

            scores = intel.get('execution_scores', {})
            pattern_tags = intel.get('pattern_tags', [])
            pattern_tags_str = ', '.join(pattern_tags) if isinstance(pattern_tags, list) else str(pattern_tags)

            text = json.dumps({'day': bundle['day'], 'intel': intel,
                               'trades': bundle['trade_rows'][:50]}, default=str)
            emb = embed_text(text)

            with get_conn() as conn, conn.cursor() as cur:
                cur.execute('''UPDATE trading_days SET
                    ai_summary=%s, ai_setup_tags=%s, ai_pattern_tags=%s,
                    ai_market_structure=%s, ai_execution_review=%s,
                    execution_score=%s, bias_score=%s, patience_score=%s,
                    entry_score=%s, risk_mgmt_score=%s, profit_taking_score=%s,
                    biggest_mistake=%s, biggest_strength=%s,
                    lessons=CASE WHEN lessons='' THEN %s ELSE lessons END,
                    updated_at=NOW()
                    WHERE id=%s''', (
                    intel.get('summary', ''),
                    intel.get('setup_tags', pattern_tags_str),
                    pattern_tags_str,
                    Json(intel.get('market_structure', {})),
                    Json(intel.get('execution_review', {})),
                    scores.get('overall'), scores.get('bias'), scores.get('patience'),
                    scores.get('entry'), scores.get('risk_management'), scores.get('profit_taking'),
                    intel.get('biggest_mistake', ''), intel.get('biggest_strength', ''),
                    intel.get('lessons', ''), day_id,
                ))

                # Auto-link patterns
                _auto_link_patterns(cur, day_id, pattern_tags, confidence=0.8)

                # Store embedding
                if emb:
                    cur.execute('DELETE FROM ai_embeddings WHERE day_id=%s AND embedding_type=%s',
                                (day_id, 'intelligence'))
                    cur.execute('INSERT INTO ai_embeddings(day_id,embedding_type,content,embedding) VALUES(%s,%s,%s,%s)',
                                (day_id, 'intelligence', text[:8000], emb))
                conn.commit()

            processed += 1

        except Exception as e:
            errors.append(f'Day {day_id} ({day_row["trade_date"]}): {str(e)[:100]}')

    remaining_after = remaining_before - processed

    return {
        'processed': processed,
        'skipped': skipped,
        'errors': errors,
        'remaining': max(0, remaining_after),
        'done': remaining_after <= 0,
    }



@app.get('/query')
def query_days(
    pattern: str = '',
    pnl_min: float = None,
    pnl_max: float = None,
    outcome: str = '',
    strategy: str = '',
    ticker: str = '',
    mood: str = '',
    date_from: str = '',
    date_to: str = '',
    min_score: float = None,
    sort: str = 'date',
    limit: int = 100,
):
    """Smart query endpoint: filter by pattern, P&L, outcome, strategy, score, etc."""
    conditions = []
    params = []

    if pattern:
        conditions.append("(ai_pattern_tags ILIKE %s OR tags ILIKE %s)")
        like = f'%{pattern}%'
        params.extend([like, like])
    if pnl_min is not None:
        conditions.append("pnl >= %s")
        params.append(pnl_min)
    if pnl_max is not None:
        conditions.append("pnl <= %s")
        params.append(pnl_max)
    if outcome == 'win':
        conditions.append("pnl > 0")
    elif outcome == 'loss':
        conditions.append("pnl < 0")
    if strategy:
        conditions.append("strategy ILIKE %s")
        params.append(f'%{strategy}%')
    if ticker:
        conditions.append("tickers ILIKE %s")
        params.append(f'%{ticker}%')
    if mood:
        conditions.append("mood ILIKE %s")
        params.append(f'%{mood}%')
    if date_from:
        conditions.append("trade_date >= %s")
        params.append(date_from)
    if date_to:
        conditions.append("trade_date <= %s")
        params.append(date_to)
    if min_score is not None:
        conditions.append("execution_score >= %s")
        params.append(min_score)

    where = 'WHERE ' + ' AND '.join(conditions) if conditions else ''

    sort_map = {
        'date': 'trade_date DESC',
        'pnl': 'pnl DESC NULLS LAST',
        'score': 'execution_score DESC NULLS LAST',
        'pnl_asc': 'pnl ASC NULLS LAST',
    }
    order = sort_map.get(sort, 'trade_date DESC')

    params.append(limit)

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f'SELECT * FROM trading_days {where} ORDER BY {order} LIMIT %s', params)
        days = cur.fetchall()

        # Also return aggregate stats for the filtered set
        if days:
            day_ids = [d['id'] for d in days]
            cur.execute('''SELECT COUNT(*) as total,
                AVG(pnl) as avg_pnl, SUM(pnl) as total_pnl,
                AVG(execution_score) as avg_score,
                SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) as losses,
                AVG(CASE WHEN pnl > 0 THEN 1.0 WHEN pnl < 0 THEN 0.0 ELSE NULL END) as win_rate
                FROM trading_days WHERE id = ANY(%s)''', (day_ids,))
            stats = cur.fetchone()
        else:
            stats = {'total': 0, 'avg_pnl': None, 'total_pnl': None, 'avg_score': None, 'wins': 0, 'losses': 0, 'win_rate': None}

        return {'days': days, 'stats': stats}

# ── Patterns with stats ─────────────────────────────

@app.get('/patterns')
def patterns():
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM playbook_patterns ORDER BY sample_count DESC, name')
        return cur.fetchall()

@app.post('/patterns')
def create_pattern(payload: dict):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute('''INSERT INTO playbook_patterns(name,description,rules,tags,custom_fields)
            VALUES(%s,%s,%s,%s,%s) ON CONFLICT(name) DO UPDATE SET
            description=EXCLUDED.description,rules=EXCLUDED.rules,tags=EXCLUDED.tags,updated_at=NOW()
            RETURNING *''',
            (payload['name'], payload.get('description', ''), payload.get('rules', ''),
             payload.get('tags', ''), Json(payload.get('custom_fields', {}))))
        row = cur.fetchone()
        conn.commit()
        return row

@app.post('/similar-links')
def create_link(payload: dict):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute('''INSERT INTO similar_day_links(source_day_id,matched_day_id,similarity_score,reason,relationship_type,user_notes)
            VALUES(%s,%s,%s,%s,%s,%s) ON CONFLICT(source_day_id,matched_day_id)
            DO UPDATE SET similarity_score=EXCLUDED.similarity_score, reason=EXCLUDED.reason,
            relationship_type=EXCLUDED.relationship_type, user_notes=EXCLUDED.user_notes RETURNING *''',
            (payload['source_day_id'], payload['matched_day_id'], payload.get('similarity_score', 1),
             payload.get('reason', 'Manual link'), payload.get('relationship_type', 'similar'),
             payload.get('user_notes', '')))
        row = cur.fetchone()
        conn.commit()
        return row

@app.post('/days/{day_id}/patterns/{pattern_id}')
def link_pattern(day_id: int, pattern_id: int, payload: dict = None):
    if payload is None:
        payload = {}
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute('''INSERT INTO day_pattern_links(day_id,pattern_id,confidence,notes)
            VALUES(%s,%s,%s,%s) ON CONFLICT(day_id,pattern_id)
            DO UPDATE SET confidence=EXCLUDED.confidence, notes=EXCLUDED.notes RETURNING *''',
            (day_id, pattern_id, payload.get('confidence', 1), payload.get('notes', '')))
        row = cur.fetchone()
        conn.commit()
        return row

# ── Pattern CRUD ─────────────────────────────────────

@app.put('/patterns/{pattern_id}')
def update_pattern(pattern_id: int, payload: dict):
    allowed = ['name', 'description', 'rules', 'tags']
    sets = []
    vals = {'id': pattern_id}
    for k in allowed:
        if k in payload:
            sets.append(f'{k}=%({k})s')
            vals[k] = payload[k]
    if not sets:
        raise HTTPException(400, 'No fields to update')
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"UPDATE playbook_patterns SET {', '.join(sets)}, updated_at=NOW() WHERE id=%(id)s RETURNING *", vals)
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, 'Pattern not found')
        conn.commit()
        return row

@app.delete('/patterns/{pattern_id}')
def delete_pattern(pattern_id: int):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute('SELECT id FROM playbook_patterns WHERE id=%s', (pattern_id,))
        if not cur.fetchone():
            raise HTTPException(404, 'Pattern not found')
        cur.execute('DELETE FROM playbook_patterns WHERE id=%s', (pattern_id,))
        conn.commit()
        return {'deleted': pattern_id}

# ── Personal Trading AI: Saved Analysis Sessions ─────

def _serialize_similar(similar_days: list) -> list:
    """Normalize similar day rows for JSON storage and API responses."""
    return [{
        'day_id': d.get('day_id') or d.get('id'),
        'trade_date': str(d.get('trade_date', '')),
        'title': d.get('title', ''),
        'tickers': d.get('tickers', ''),
        'pnl': d.get('pnl'),
        'ai_summary': d.get('ai_summary', ''),
        'ai_pattern_tags': d.get('ai_pattern_tags', ''),
        'execution_score': d.get('execution_score'),
        'lessons': d.get('lessons', ''),
        'biggest_mistake': d.get('biggest_mistake', ''),
        'similarity': float(d.get('similarity', 0)),
    } for d in similar_days]


@app.post('/analyze')
async def analyze_screenshot(
    file: UploadFile = File(...),
    analysis_type: str = Form('premarket'),
    trade_date: str = Form(None),
    day_id: int = Form(None),
    notes: str = Form(''),
    focus: str = Form(''),
    save_session: bool = Form(True),
):
    """Upload any chart screenshot for AI analysis.
    - analysis_type: premarket | postmarket | trade | other
    - trade_date: ISO date string to link to a trading day (auto-resolves day_id)
    - day_id: explicit trading day FK (overrides trade_date resolution)
    - notes: freeform notes to attach to the session
    - focus: optional free-text override injected into the AI prompt
    - save_session: set False to skip saving (one-off queries)
    """
    if not has_ai():
        raise HTTPException(503, 'AI is not configured. Set OPENAI_API_KEY.')

    valid_types = ('premarket', 'postmarket', 'trade', 'other')
    if analysis_type not in valid_types:
        raise HTTPException(400, f'analysis_type must be one of: {valid_types}')

    content = await file.read()
    if not content:
        raise HTTPException(400, 'Empty file')

    # ── Resolve day_id / trade_date ──────────────────
    resolved_day_id = day_id
    resolved_trade_date = trade_date
    try:
        with get_conn() as conn, conn.cursor() as cur:
            if not resolved_day_id and resolved_trade_date:
                cur.execute('SELECT id FROM trading_days WHERE trade_date=%s', (resolved_trade_date,))
                row = cur.fetchone()
                if row:
                    resolved_day_id = row['id']
            elif resolved_day_id and not resolved_trade_date:
                cur.execute('SELECT trade_date FROM trading_days WHERE id=%s', (resolved_day_id,))
                row = cur.fetchone()
                if row:
                    resolved_trade_date = str(row['trade_date'])
    except Exception:
        pass

    chart_analysis: dict = {}
    similar_days_raw: list = []
    stats: dict = {}
    recommendation: dict = {}
    stored_url = ''
    stored_key = ''

    # ── Step 1: Store file ───────────────────────────
    if save_session and storage.enabled:
        try:
            stored = storage.put_analyze_file(
                analysis_type=analysis_type,
                filename=file.filename or 'screenshot.png',
                content=content,
                content_type=file.content_type or 'image/png',
            )
            stored_url = stored['url']
            stored_key = stored['storage_key']
        except Exception:
            pass

    # ── Step 2: Chart AI analysis ────────────────────
    try:
        chart_analysis = analyze_chart_image_bytes(content, analysis_type, file.content_type or 'image/png', focus=focus)
    except Exception as e:
        chart_analysis = {'error': f'Chart analysis failed: {e}'}

    # ── Step 3: Embed + find similar days ────────────
    emb = None
    try:
        analysis_text = json.dumps(chart_analysis, default=str)
        emb = embed_text(analysis_text)
        if emb:
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute('''SELECT e.day_id, d.*,
                    MAX(1 - (e.embedding <=> %s::vector)) AS similarity
                    FROM ai_embeddings e JOIN trading_days d ON d.id = e.day_id
                    GROUP BY e.day_id, d.id
                    ORDER BY similarity DESC LIMIT 15''', (emb,))
                similar_days_raw = cur.fetchall()
                if similar_days_raw:
                    day_ids = [d['id'] for d in similar_days_raw]
                    cur.execute('''SELECT COUNT(*) as total, AVG(pnl) as avg_pnl, SUM(pnl) as total_pnl,
                        AVG(execution_score) as avg_score,
                        SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins,
                        SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) as losses,
                        AVG(CASE WHEN pnl > 0 THEN 1.0 WHEN pnl < 0 THEN 0.0 ELSE NULL END) as win_rate
                        FROM trading_days WHERE id = ANY(%s) AND pnl IS NOT NULL''', (day_ids,))
                    stats = cur.fetchone() or {}
                    cur.execute('''SELECT p.name, COUNT(*) as cnt FROM day_pattern_links dpl
                        JOIN playbook_patterns p ON p.id = dpl.pattern_id
                        WHERE dpl.day_id = ANY(%s) GROUP BY p.name ORDER BY cnt DESC LIMIT 5''', (day_ids,))
                    stats['common_patterns'] = cur.fetchall()
    except Exception as e:
        stats['error'] = f'Similar day search failed: {e}'

    similar_days_serialized = _serialize_similar(similar_days_raw)

    # ── Step 4: Recommendation ───────────────────────
    try:
        if similar_days_raw:
            recommendation = generate_recommendation(chart_analysis, similar_days_raw)
        else:
            recommendation = {
                'recommendation': 'No historical data to compare against yet. Log some trading days first.',
                'times_seen': 0,
            }
    except Exception as e:
        recommendation = {'recommendation': f'Recommendation failed: {e}', 'times_seen': len(similar_days_raw)}

    # ── Step 5: If premarket linked to a day, push fields + embedding ──
    if resolved_day_id and analysis_type == 'premarket' and chart_analysis.get('gap_direction'):
        try:
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute('''UPDATE trading_days SET gap_direction=%s, premarket_trend=%s, volume_assessment=%s,
                    key_levels=%s, likely_scenarios=%s, updated_at=NOW() WHERE id=%s''',
                    (chart_analysis.get('gap_direction', ''),
                     chart_analysis.get('premarket_trend', ''),
                     chart_analysis.get('volume_assessment', ''),
                     ', '.join(chart_analysis.get('key_levels', [])) if isinstance(chart_analysis.get('key_levels'), list) else str(chart_analysis.get('key_levels', '')),
                     ', '.join(chart_analysis.get('likely_scenarios', [])) if isinstance(chart_analysis.get('likely_scenarios'), list) else str(chart_analysis.get('likely_scenarios', '')),
                     resolved_day_id))
                chart_tags = chart_analysis.get('pattern_tags', [])
                if chart_tags:
                    _auto_link_patterns(cur, resolved_day_id, chart_tags, confidence=0.7)
                if emb:
                    cur.execute('INSERT INTO ai_embeddings(day_id,embedding_type,content,embedding) VALUES(%s,%s,%s,%s)',
                        (resolved_day_id, 'premarket', json.dumps(chart_analysis, default=str), emb))
                    cur.execute('''SELECT e.day_id, d.trade_date, d.title, d.tickers, d.ai_summary, d.tags,
                        d.pnl, d.ai_pattern_tags, d.execution_score,
                        MAX(1 - (e.embedding <=> %s::vector)) AS score
                        FROM ai_embeddings e JOIN trading_days d ON d.id=e.day_id
                        WHERE e.day_id <> %s
                        GROUP BY e.day_id,d.trade_date,d.title,d.tickers,d.ai_summary,d.tags,d.pnl,d.ai_pattern_tags,d.execution_score
                        ORDER BY score DESC LIMIT 5''', (emb, resolved_day_id))
                    for r in cur.fetchall():
                        cur.execute('''INSERT INTO similar_day_links(source_day_id,matched_day_id,similarity_score,reason,ai_reason)
                            VALUES(%s,%s,%s,%s,%s) ON CONFLICT(source_day_id,matched_day_id)
                            DO UPDATE SET similarity_score=EXCLUDED.similarity_score''',
                            (resolved_day_id, r['day_id'], float(r['score'] or 0),
                             'AI vector similarity (analyze session)', Json({'method': 'pgvector cosine distance'})))
                conn.commit()
        except Exception:
            pass

    # ── Step 6: Persist session ──────────────────────
    session_id = None
    if save_session:
        try:
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute('''INSERT INTO analyze_sessions
                    (analysis_type, trade_date, day_id, filename, storage_key, url,
                     chart_analysis, similar_days, stats, recommendation, notes)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id''',
                    (analysis_type,
                     resolved_trade_date or None,
                     resolved_day_id,
                     file.filename or 'screenshot.png',
                     stored_key,
                     stored_url,
                     Json(chart_analysis),
                     Json(similar_days_serialized),
                     Json({k: v for k, v in (stats or {}).items() if k != 'common_patterns'}),
                     Json(recommendation),
                     notes or ''))
                session_id = cur.fetchone()['id']
                conn.commit()
        except Exception:
            pass

    return {
        'session_id': session_id,
        'analysis_type': analysis_type,
        'trade_date': resolved_trade_date,
        'day_id': resolved_day_id,
        'url': stored_url,
        'filename': file.filename,
        'chart_analysis': chart_analysis,
        'similar_days': similar_days_serialized,
        'stats': stats,
        'recommendation': recommendation,
    }


# ── Analysis History ─────────────────────────────────

@app.get('/analyze/history')
def analyze_history(limit: int = 100, analysis_type: str = ''):
    """Return saved analysis sessions, newest first."""
    with get_conn() as conn, conn.cursor() as cur:
        if analysis_type:
            cur.execute('''SELECT id, analysis_type, trade_date, day_id, filename, url,
                chart_analysis, recommendation, notes, created_at
                FROM analyze_sessions WHERE analysis_type=%s
                ORDER BY created_at DESC LIMIT %s''', (analysis_type, limit))
        else:
            cur.execute('''SELECT id, analysis_type, trade_date, day_id, filename, url,
                chart_analysis, recommendation, notes, created_at
                FROM analyze_sessions ORDER BY created_at DESC LIMIT %s''', (limit,))
        return cur.fetchall()


@app.get('/analyze/sessions/{session_id}')
def get_analyze_session(session_id: int):
    """Return full detail for a saved analysis session."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM analyze_sessions WHERE id=%s', (session_id,))
        session = cur.fetchone()
        if not session:
            raise HTTPException(404, 'Session not found')
        day = None
        if session.get('day_id'):
            cur.execute('SELECT id, trade_date, title, tickers, pnl, ai_summary, execution_score FROM trading_days WHERE id=%s', (session['day_id'],))
            day = cur.fetchone()
        return {'session': session, 'day': day}


@app.delete('/analyze/sessions/{session_id}')
def delete_analyze_session(session_id: int):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute('SELECT id FROM analyze_sessions WHERE id=%s', (session_id,))
        if not cur.fetchone():
            raise HTTPException(404, 'Session not found')
        cur.execute('DELETE FROM analyze_sessions WHERE id=%s', (session_id,))
        conn.commit()
        return {'deleted': session_id}


@app.patch('/analyze/sessions/{session_id}')
def update_analyze_session(session_id: int, payload: dict):
    """Update notes or link a session to a day/date after the fact."""
    allowed = ['notes', 'trade_date', 'day_id']
    sets = []
    vals = {'id': session_id}
    for k in allowed:
        if k in payload:
            sets.append(f'{k}=%({k})s')
            vals[k] = payload[k]
    if not sets:
        raise HTTPException(400, 'Nothing to update')
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"UPDATE analyze_sessions SET {', '.join(sets)} WHERE id=%(id)s RETURNING *", vals)
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, 'Session not found')
        conn.commit()
        return row


# ── Tradovate OAuth ───────────────────────────────────

@app.get('/tradovate/status')
def tradovate_status():
    return tv.get_status()


@app.post('/tradovate/disconnect')
def tradovate_disconnect():
    """Clear stored OAuth token, freeing up the active session slot."""
    tv._mem_token.clear()
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM app_settings WHERE key='tradovate_oauth_token'")
            conn.commit()
    except Exception:
        pass
    return {'disconnected': True}


@app.get('/tradovate/oauth/start')
def tradovate_oauth_start():
    """Redirect browser to Tradovate authorization page."""
    from fastapi.responses import RedirectResponse
    if not tv._has_oauth_config():
        raise HTTPException(503, 'Add TRADOVATE_CLIENT_ID and TRADOVATE_CLIENT_SECRET to Railway env vars.')
    return RedirectResponse(tv.build_auth_url())


@app.get('/tradovate/oauth/callback')
def tradovate_oauth_callback(code: str = None, error: str = None, state: str = None):
    """Tradovate redirects here after user authorizes."""
    from fastapi.responses import HTMLResponse
    if error:
        return HTMLResponse(f'''<html><body style="font-family:sans-serif;padding:40px;background:#0d1117;color:#e6edf3">
            <h2 style="color:#f85149">Authorization Failed</h2><p>{error}</p>
            <p><a href="/tradovate/oauth/start" style="color:#58a6ff">Try again</a></p></body></html>''')
    if not code:
        raise HTTPException(400, 'No authorization code received.')
    try:
        token_data = tv.exchange_code_for_token(code)
        return HTMLResponse(f'''<html><body style="font-family:sans-serif;padding:40px;background:#0d1117;color:#e6edf3">
            <h2 style="color:#3fb950">&#10003; Tradovate Connected!</h2>
            <p>Your account is now authorized. Return to the journal and click <strong>List Accounts</strong> then <strong>Import Now</strong>.</p>
            <p style="color:#8b949e;font-size:13px">You can close this tab.</p>
            <script>setTimeout(()=>{{try{{window.close();}}catch(e){{}}}}, 3000);</script>
            </body></html>''')
    except Exception as e:
        return HTMLResponse(f'''<html><body style="font-family:sans-serif;padding:40px;background:#0d1117;color:#e6edf3">
            <h2 style="color:#f85149">Token Exchange Failed</h2><p>{e}</p>
            <p><a href="/tradovate/oauth/start" style="color:#58a6ff">Try again</a></p></body></html>''', status_code=500)


@app.get('/tradovate/accounts')
def tradovate_accounts():
    if not tv._has_oauth_token():
        raise HTTPException(401, 'Not authorized. Visit /tradovate/oauth/start first.')
    try:
        return tv.get_accounts()
    except Exception as e:
        raise HTTPException(502, f'Tradovate API error: {e}')


@app.get('/tradovate/balance/{account_id}')
def tradovate_balance(account_id: int):
    if not tv._has_oauth_token():
        raise HTTPException(401, 'Not authorized.')
    try:
        return tv.get_cash_balance(account_id)
    except Exception as e:
        raise HTTPException(502, f'Tradovate API error: {e}')


@app.get('/tradovate/preview/{account_id}')
def tradovate_preview(account_id: int):
    if not tv._has_oauth_token():
        raise HTTPException(401, 'Not authorized. Visit /tradovate/oauth/start first.')
    try:
        data = tv.fetch_fill_pairs(account_id)
        fill_pairs = data.get('fillPairs', [])
        fills      = data.get('fills', [])

        # fill_pairs are already fully mapped by _pair_fills_into_trades
        # Strip internal debug fields for the preview table
        preview_rows = [{k: v for k, v in fp.items() if not k.startswith('_')}
                        for fp in fill_pairs[:50]]

        return {
            'counts': {k: len(v) for k, v in data.items() if isinstance(v, list)},
            'fill_pair_count': len(fill_pairs),
            'errors': data.get('_errors', []),
            'preview': preview_rows,
            'raw_fillpair': fill_pairs[:2],
            'raw_fill': fills[:2],
        }
    except Exception as e:
        raise HTTPException(502, f'Preview failed: {e}')


@app.post('/tradovate/sync/{account_id}')
def tradovate_sync(account_id: int):
    if not tv._has_oauth_token():
        raise HTTPException(401, 'Not authorized. Visit /tradovate/oauth/start first.')
    try:
        return tv.sync_fills_to_journal(account_id)
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    except Exception as e:
        raise HTTPException(502, f'Sync failed: {e}')


# ── Tradovate CSV Import ──────────────────────────────

POINT_VALUES = {
    # MNQ / NQ
    'MNQ': 2.0, 'NQ': 20.0,
    # MES / ES
    'MES': 5.0, 'ES': 50.0,
    # MYM / YM
    'MYM': 0.5, 'YM': 5.0,
    # M2K / RTY
    'M2K': 5.0, 'RTY': 50.0,
    # CL, GC, SI, etc. — $1 default, user can correct
}

def _get_point_value(product: str) -> float:
    """Return dollar value per point for a product code."""
    prod = (product or '').strip().upper()
    for k, v in POINT_VALUES.items():
        if prod == k or prod.startswith(k):
            return v
    return 1.0


def _parse_tradovate_orders_csv(content: str, commission_per_side: float = 0.0) -> dict:
    """
    Parse a Tradovate Orders CSV export and pair fills into round-trip trades.

    CSV columns (confirmed from live export):
    orderId, Account, Order ID, B/S, Contract, Product, Product Description,
    avgPrice, filledQty, Fill Time, lastCommandId, Status, ..., Date, ...

    Strategy:
    - Keep only Filled rows with a fill price and fill time
    - Group by Product (e.g. MNQ) within the same day
    - Pair sells and buys chronologically into round trips
    - Determine direction from which side came first
    """
    reader = csv.DictReader(io.StringIO(content))
    rows = list(reader)

    # Normalize column names (strip spaces)
    def norm(r):
        return {k.strip(): v.strip() for k, v in r.items()}
    rows = [norm(r) for r in rows]

    # Keep only filled rows with price and time
    filled = []
    for r in rows:
        status = r.get('Status', '')
        price_str = r.get('avgPrice') or r.get('Avg Fill Price', '')
        fill_time_str = r.get('Fill Time', '')
        qty_str = r.get('filledQty') or r.get('Filled Qty', '')
        if 'Filled' not in status:
            continue
        if not price_str or not fill_time_str or not qty_str:
            continue
        try:
            price = float(price_str.replace(',', ''))
            qty   = float(qty_str.replace(',', ''))
        except ValueError:
            continue
        # Parse fill time: "06/09/2026 10:14:25"
        fill_dt = None
        for fmt in ('%m/%d/%Y %H:%M:%S', '%m/%d/%y %H:%M:%S'):
            try:
                from datetime import datetime, timezone
                fill_dt = datetime.strptime(fill_time_str.strip(), fmt)
                break
            except ValueError:
                continue
        if not fill_dt:
            continue

        side    = r.get('B/S', '').strip()
        product = r.get('Product', '').strip()
        contract= r.get('Contract', '').strip()

        filled.append({
            'order_id':   r.get('orderId', '').strip(),
            'side':       side,   # ' Buy' or ' Sell' (note leading space)
            'product':    product,
            'contract':   contract,
            'price':      price,
            'qty':        qty,
            'fill_dt':    fill_dt,
            'trade_date': fill_dt.strftime('%Y-%m-%d'),
        })

    # Sort by fill time
    filled.sort(key=lambda x: x['fill_dt'])

    # Group by date + product, then pair into round trips
    from collections import defaultdict
    groups = defaultdict(list)
    for f in filled:
        groups[(f['trade_date'], f['product'])].append(f)

    trades = []
    for (trade_date, product), fills in groups.items():
        point_value = _get_point_value(product)
        buys  = [f for f in fills if 'Buy'  in f['side']]
        sells = [f for f in fills if 'Sell' in f['side']]

        # Pair sells and buys using FIFO matching
        # We need to determine open vs close for each fill
        # Simple approach: sort by time, track running position
        position = 0.0
        opens = []  # stack of open fills
        paired = []

        for f in fills:
            is_buy = 'Buy' in f['side']
            qty    = f['qty']

            if position == 0:
                # Opening a new position
                opens = [{'fill': f, 'qty': qty}]
                position = qty if is_buy else -qty
            elif (position > 0 and is_buy) or (position < 0 and not is_buy):
                # Adding to existing position
                opens.append({'fill': f, 'qty': qty})
                position += qty if is_buy else -qty
            else:
                # Closing / reducing position
                remaining = qty
                while remaining > 0 and opens:
                    open_fill = opens[0]
                    match_qty = min(remaining, open_fill['qty'])

                    entry_fill = open_fill['fill']
                    exit_fill  = f
                    long_trade = position > 0

                    if long_trade:
                        entry_price = entry_fill['price']
                        exit_price  = exit_fill['price']
                    else:
                        entry_price = entry_fill['price']  # sell price (short entry)
                        exit_price  = exit_fill['price']   # buy price  (short exit)

                    direction = 1 if long_trade else -1
                    gross_pnl = round(direction * (exit_price - entry_price) * match_qty * point_value, 2)
                    # Commission: 2 sides (entry + exit) × qty × per-side rate
                    commission = round(2 * match_qty * commission_per_side, 2)
                    pnl = round(gross_pnl - commission, 2)

                    paired.append({
                        'tradovate_csv_order_ids': f"{entry_fill['order_id']}_{exit_fill['order_id']}",
                        'symbol':       entry_fill['contract'],
                        'product':      product,
                        'side':         'Long' if long_trade else 'Short',
                        'qty':          match_qty,
                        'entry_price':  entry_price,
                        'exit_price':   exit_price,
                        'gross_pnl':    gross_pnl,
                        'commission':   commission,
                        'pnl':          pnl,
                        'entry_time':   entry_fill['fill_dt'].isoformat(),
                        'exit_time':    exit_fill['fill_dt'].isoformat(),
                        'trade_date':   trade_date,
                        'point_value':  point_value,
                        'source':       'tradovate_csv',
                    })

                    open_fill['qty'] -= match_qty
                    remaining        -= match_qty
                    position         -= match_qty if long_trade else -match_qty
                    if open_fill['qty'] <= 0:
                        opens.pop(0)

                if remaining > 0:
                    # Still have unfilled close — add as new open in opposite direction
                    opens.append({'fill': f, 'qty': remaining})
                    position += remaining if is_buy else -remaining

        trades.extend(paired)

    # Summary by date
    by_date = defaultdict(list)
    for t in trades:
        by_date[t['trade_date']].append(t)

    return {
        'trades':       trades,
        'by_date':      dict(by_date),
        'total_trades': len(trades),
        'total_pnl':    round(sum(t['pnl'] for t in trades), 2),
        'dates':        sorted(by_date.keys()),
        'raw_filled_count': len(filled),
    }


@app.post('/tradovate/import-csv')
async def tradovate_import_csv(
    file: UploadFile = File(...),
    preview_only: bool = Form(False),
):
    """Parse a Tradovate Orders CSV and import round-trip trades with commission applied."""
    content = await file.read()
    try:
        text = content.decode('utf-8')
    except UnicodeDecodeError:
        text = content.decode('latin-1')

    # Load commission setting
    settings = _get_settings()
    commission_per_side = float(settings.get('commission_per_side', 0.0))

    parsed = _parse_tradovate_orders_csv(text, commission_per_side=commission_per_side)

    if preview_only:
        return {**parsed, 'preview_only': True}

    # Write to DB
    imported = 0
    skipped  = 0
    errors   = []
    days_touched = set()

    with get_conn() as conn, conn.cursor() as cur:
        for trade in parsed['trades']:
            try:
                # Idempotency key
                key = trade['tradovate_csv_order_ids']
                cur.execute(
                    "SELECT id FROM trade_rows WHERE row_data->>'tradovate_csv_order_ids'=%s",
                    (key,)
                )
                if cur.fetchone():
                    skipped += 1
                    continue

                td = trade['trade_date']
                # Get or create trading day
                cur.execute('SELECT id FROM trading_days WHERE trade_date=%s', (td,))
                day_row = cur.fetchone()
                if not day_row:
                    cur.execute(
                        'INSERT INTO trading_days (trade_date,tickers,title) VALUES (%s,%s,%s) ON CONFLICT (trade_date) DO NOTHING RETURNING id',
                        (td, trade.get('product',''), f'Auto-imported {td}')
                    )
                    day_row = cur.fetchone()
                    if not day_row:
                        cur.execute('SELECT id FROM trading_days WHERE trade_date=%s', (td,))
                        day_row = cur.fetchone()

                if day_row:
                    day_id = day_row['id']
                    cur.execute('INSERT INTO trade_rows (day_id,row_data) VALUES (%s,%s)',
                                (day_id, Json(trade)))
                    days_touched.add((day_id, td))
                    imported += 1
                else:
                    errors.append(f'Could not create day for {td}')

            except Exception as e:
                errors.append(f'Trade {trade.get("tradovate_csv_order_ids")}: {e}')

        # Recompute day stats
        for day_id, _ in days_touched:
            cur.execute(
                """UPDATE trading_days SET
                   pnl=(SELECT SUM((row_data->>'pnl')::float) FROM trade_rows
                        WHERE day_id=%s AND row_data->>'pnl' IS NOT NULL),
                   num_trades=(SELECT COUNT(*) FROM trade_rows WHERE day_id=%s),
                   win_count=(SELECT COUNT(*) FROM trade_rows WHERE day_id=%s AND (row_data->>'pnl')::float>0),
                   loss_count=(SELECT COUNT(*) FROM trade_rows WHERE day_id=%s AND (row_data->>'pnl')::float<0),
                   updated_at=NOW()
                   WHERE id=%s""",
                (day_id, day_id, day_id, day_id, day_id)
            )
        conn.commit()

    return {
        'imported':     imported,
        'skipped':      skipped,
        'days_updated': len(days_touched),
        'errors':       errors,
        'total_pnl':    parsed['total_pnl'],
        'dates':        parsed['dates'],
    }


# ── App Settings ─────────────────────────────────────

def _get_settings() -> dict:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT value FROM app_settings WHERE key='user_settings'")
        row = cur.fetchone()
        return row['value'] if row else {}

@app.get('/settings')
def get_settings():
    return _get_settings()

@app.put('/settings')
def update_settings(payload: dict):
    with get_conn() as conn, conn.cursor() as cur:
        # Merge with existing
        cur.execute("SELECT value FROM app_settings WHERE key='user_settings'")
        row = cur.fetchone()
        existing = row['value'] if row else {}
        merged = {**existing, **payload}
        cur.execute('''INSERT INTO app_settings (key, value, updated_at)
            VALUES ('user_settings', %s, NOW())
            ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()''',
            (Json(merged),))
        conn.commit()
        return merged

# ── Tradovate endpoint probe ──────────────────────────
@app.get('/tradovate/probe/{account_id}')
def tradovate_probe(account_id: int):
    """
    Hit every plausible historical data endpoint and report what each returns.
    Used to find which endpoints actually work with our OAuth token.
    """
    if not tv._has_oauth_token():
        raise HTTPException(401, 'Not authorized.')

    results = {}
    endpoints = [
        f'cashBalanceLog/list',
        f'cashBalanceLog/deps?masterid={account_id}',
        f'cashBalance/list',
        f'executionReport/list',
        f'executionReport/deps?masterid={account_id}',
        f'fill/list',
        f'fill/item?id=16137513007',  # known fillId from cashBalanceLog
        f'fill/ldeps?masterids=16137513007',
        f'fill/find?name=16137513007',
        f'fillPair/list',
        f'fillPair/item?id=16137513007',
        f'order/list',
        f'order/deps?masterid={account_id}',
        f'order/item?id=16137513007',
        f'position/list',
    ]

    # Also try Reporting API
    rpt_endpoints = [
        f'fillPair/list',
        f'fill/list',
        f'cashBalanceLog/list',
        f'cashBalanceLog/deps?masterid={account_id}',
    ]

    for ep in endpoints:
        try:
            data = tv._rest_get(ep)
            if isinstance(data, list):
                results[f'LIVE/{ep}'] = {
                    'count': len(data),
                    'sample': data[:2] if data else [],
                    'keys': list(data[0].keys()) if data else [],
                }
            else:
                results[f'LIVE/{ep}'] = {'data': data}
        except Exception as e:
            results[f'LIVE/{ep}'] = {'error': str(e)}

    for ep in rpt_endpoints:
        try:
            data = tv._rpt_get(ep)
            if isinstance(data, list):
                results[f'RPT/{ep}'] = {
                    'count': len(data),
                    'sample': data[:2] if data else [],
                    'keys': list(data[0].keys()) if data else [],
                }
            else:
                results[f'RPT/{ep}'] = {'data': data}
        except Exception as e:
            results[f'RPT/{ep}'] = {'error': str(e)}

    return results
