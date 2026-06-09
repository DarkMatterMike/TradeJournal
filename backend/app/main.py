import csv, io, json, os, re
from contextlib import asynccontextmanager
from psycopg.types.json import Json
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from .db import get_conn, init_db
from .storage import R2Storage
from .ai import analyze_chart_image_bytes, summarize_day, embed_text, has_ai

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
        cur.execute('SELECT * FROM trading_days ORDER BY trade_date DESC LIMIT 5')
        recent = cur.fetchall()
        return {'overview': overview, 'top_patterns': top_patterns, 'recent_days': recent}

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
