import csv, io, json, os
from psycopg.types.json import Json
from typing import Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from .db import get_conn, init_db
from .storage import R2Storage
from .ai import analyze_chart_image_bytes, summarize_day, embed_text, has_ai

load_dotenv()
app = FastAPI(title='Trading Intelligence Database V3')
origins=[x.strip() for x in os.getenv('CORS_ORIGINS','http://localhost:5173').split(',') if x.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=True, allow_methods=['*'], allow_headers=['*'])
storage = R2Storage()

@app.on_event('startup')
def startup(): init_db()

@app.get('/health')
def health(): return {'ok': True, 'ai_enabled': has_ai(), 'r2_enabled': storage.enabled}

@app.get('/days')
def list_days(q: str='', limit:int=200):
    with get_conn() as conn, conn.cursor() as cur:
        if q:
            like=f'%{q}%'
            cur.execute('''SELECT * FROM trading_days WHERE title ILIKE %s OR tickers ILIKE %s OR tags ILIKE %s OR ai_summary ILIKE %s ORDER BY trade_date DESC LIMIT %s''',(like,like,like,like,limit))
        else:
            cur.execute('SELECT * FROM trading_days ORDER BY trade_date DESC LIMIT %s',(limit,))
        return cur.fetchall()

@app.post('/days')
def create_day(payload:dict):
    if not payload.get('trade_date'): raise HTTPException(400,'trade_date is required')
    fields=['trade_date','title','tickers','strategy','session','market_bias','premarket_notes','trade_notes','ideal_notes','lessons','tags','mood','rule_following_score','custom_fields']
    vals={k:payload.get(k, {} if k=='custom_fields' else None) for k in fields}
    vals['custom_fields'] = Json(vals.get('custom_fields') or {})
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute('''INSERT INTO trading_days (trade_date,title,tickers,strategy,session,market_bias,premarket_notes,trade_notes,ideal_notes,lessons,tags,mood,rule_following_score,custom_fields)
        VALUES (%(trade_date)s,COALESCE(%(title)s,''),COALESCE(%(tickers)s,''),COALESCE(%(strategy)s,''),COALESCE(%(session)s,''),COALESCE(%(market_bias)s,''),COALESCE(%(premarket_notes)s,''),COALESCE(%(trade_notes)s,''),COALESCE(%(ideal_notes)s,''),COALESCE(%(lessons)s,''),COALESCE(%(tags)s,''),COALESCE(%(mood)s,''),%(rule_following_score)s,%(custom_fields)s)
        ON CONFLICT (trade_date) DO UPDATE SET title=EXCLUDED.title, updated_at=NOW() RETURNING *''', vals)
        row=cur.fetchone(); conn.commit(); return row

@app.get('/days/{day_id}')
def get_day(day_id:int):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM trading_days WHERE id=%s',(day_id,)); day=cur.fetchone()
        if not day: raise HTTPException(404,'Day not found')
        cur.execute('SELECT * FROM uploads WHERE day_id=%s ORDER BY created_at DESC',(day_id,)); uploads=cur.fetchall()
        cur.execute('SELECT * FROM trade_rows WHERE day_id=%s ORDER BY id',(day_id,)); trades=cur.fetchall()
        cur.execute('''SELECT l.*, d.trade_date, d.title, d.tickers, d.ai_summary, d.tags FROM similar_day_links l JOIN trading_days d ON d.id=l.matched_day_id WHERE l.source_day_id=%s ORDER BY l.similarity_score DESC''',(day_id,)); similar=cur.fetchall()
        cur.execute('''SELECT p.*, dpl.confidence, dpl.notes FROM day_pattern_links dpl JOIN playbook_patterns p ON p.id=dpl.pattern_id WHERE dpl.day_id=%s ORDER BY dpl.confidence DESC''',(day_id,)); patterns=cur.fetchall()
        return {'day':day,'uploads':uploads,'trade_rows':trades,'similar':similar,'patterns':patterns}

@app.put('/days/{day_id}')
def update_day(day_id:int, payload:dict):
    allowed=['trade_date','title','tickers','strategy','session','market_bias','premarket_notes','trade_notes','ideal_notes','lessons','tags','mood','rule_following_score','ai_summary','ai_setup_tags','ai_market_structure','ai_execution_review','custom_fields']
    sets=[]; vals={'id':day_id}
    for k in allowed:
        if k in payload:
            sets.append(f'{k}=%({k})s'); vals[k]=Json(payload[k]) if k in ['custom_fields','ai_market_structure','ai_execution_review'] else payload[k]
    if not sets: return get_day(day_id)['day']
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"UPDATE trading_days SET {', '.join(sets)}, updated_at=NOW() WHERE id=%(id)s RETURNING *", vals)
        row=cur.fetchone(); conn.commit(); return row

@app.post('/days/{day_id}/upload')
async def upload(day_id:int, kind:str=Form(...), file:UploadFile=File(...), run_ai:bool=Form(True)):
    content = await file.read()
    if not content: raise HTTPException(400,'Empty file')
    stored = storage.put_file(day_id=day_id, kind=kind, filename=file.filename, content=content, content_type=file.content_type)
    extracted=''; ai_json={}; ai_desc=''
    if kind=='csv':
        try:
            text=content.decode('utf-8-sig', errors='replace')
            rows=list(csv.DictReader(io.StringIO(text)))
            extracted=json.dumps(rows[:500])
        except Exception as e: extracted=f'CSV parse error: {e}'
    elif run_ai and (file.content_type or '').startswith('image/'):
        ai_json=analyze_chart_image_bytes(content, kind, file.content_type or 'image/png')
        ai_desc=json.dumps(ai_json)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute('''INSERT INTO uploads(day_id,kind,filename,content_type,storage_key,url,extracted_text,ai_description,ai_json)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *''',(day_id,kind,file.filename,stored['content_type'],stored['storage_key'],stored['url'],extracted,ai_desc,Json(ai_json or {})))
        up=cur.fetchone()
        if kind=='csv' and extracted.startswith('['):
            for r in json.loads(extracted): cur.execute('INSERT INTO trade_rows(day_id,row_data) VALUES(%s,%s)',(day_id,Json(r)))
        content_for_embedding=' '.join([kind,file.filename,extracted,ai_desc])
        emb=embed_text(content_for_embedding)
        if emb: cur.execute('INSERT INTO ai_embeddings(day_id,upload_id,embedding_type,content,embedding) VALUES(%s,%s,%s,%s,%s)',(day_id,up['id'],kind,content_for_embedding,emb))
        conn.commit(); return up

@app.post('/days/{day_id}/intelligence')
def run_intelligence(day_id:int):
    bundle=get_day(day_id)
    intel=summarize_day(bundle['day'], bundle['uploads'], bundle['trade_rows'])
    text=json.dumps({'day':bundle['day'],'uploads':bundle['uploads'],'trades':bundle['trade_rows'][:100],'intel':intel}, default=str)
    emb=embed_text(text)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute('''UPDATE trading_days SET ai_summary=%s, ai_setup_tags=%s, ai_market_structure=%s, ai_execution_review=%s, lessons=CASE WHEN lessons='' THEN %s ELSE lessons END, updated_at=NOW() WHERE id=%s RETURNING *''',(
            intel.get('summary',''), intel.get('setup_tags',''), Json(intel.get('market_structure',{})), Json(intel.get('execution_review',{})), intel.get('lessons',''), day_id))
        row=cur.fetchone()
        if emb: cur.execute('INSERT INTO ai_embeddings(day_id,embedding_type,content,embedding) VALUES(%s,%s,%s,%s)',(day_id,'day_intelligence',text,emb))
        conn.commit(); return {'day':row,'intelligence':intel}

@app.post('/days/{day_id}/find-similar')
def find_similar(day_id:int, limit:int=10):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT embedding FROM ai_embeddings WHERE day_id=%s AND embedding_type IN ('premarket','day_intelligence','day') ORDER BY created_at DESC LIMIT 1",(day_id,)); base=cur.fetchone()
        if not base or base['embedding'] is None: raise HTTPException(400,'No embedding found. Upload a premarket image or run intelligence first.')
        cur.execute('''SELECT e.day_id, d.trade_date, d.title, d.tickers, d.ai_summary, d.tags, MAX(1 - (e.embedding <=> %s::vector)) AS score
          FROM ai_embeddings e JOIN trading_days d ON d.id=e.day_id WHERE e.day_id <> %s GROUP BY e.day_id,d.trade_date,d.title,d.tickers,d.ai_summary,d.tags ORDER BY score DESC LIMIT %s''',(base['embedding'],day_id,limit))
        rows=cur.fetchall()
        for r in rows:
            cur.execute('''INSERT INTO similar_day_links(source_day_id,matched_day_id,similarity_score,reason,ai_reason)
              VALUES(%s,%s,%s,%s,%s) ON CONFLICT(source_day_id,matched_day_id) DO UPDATE SET similarity_score=EXCLUDED.similarity_score, reason=EXCLUDED.reason, ai_reason=EXCLUDED.ai_reason''',
              (day_id,r['day_id'],float(r['score'] or 0),'AI vector similarity based on chart/trade/day intelligence.',Json({'method':'pgvector cosine distance'})))
        conn.commit(); return rows

@app.post('/similar-links')
def create_link(payload:dict):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute('''INSERT INTO similar_day_links(source_day_id,matched_day_id,similarity_score,reason,relationship_type,user_notes)
        VALUES(%s,%s,%s,%s,%s,%s) ON CONFLICT(source_day_id,matched_day_id) DO UPDATE SET similarity_score=EXCLUDED.similarity_score, reason=EXCLUDED.reason, relationship_type=EXCLUDED.relationship_type, user_notes=EXCLUDED.user_notes RETURNING *''',
        (payload['source_day_id'],payload['matched_day_id'],payload.get('similarity_score',1),payload.get('reason','Manual link'),payload.get('relationship_type','similar'),payload.get('user_notes','')))
        row=cur.fetchone(); conn.commit(); return row

@app.get('/patterns')
def patterns():
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM playbook_patterns ORDER BY name'); return cur.fetchall()

@app.post('/patterns')
def create_pattern(payload:dict):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute('''INSERT INTO playbook_patterns(name,description,rules,tags,custom_fields) VALUES(%s,%s,%s,%s,%s) ON CONFLICT(name) DO UPDATE SET description=EXCLUDED.description,rules=EXCLUDED.rules,tags=EXCLUDED.tags,updated_at=NOW() RETURNING *''',
        (payload['name'],payload.get('description',''),payload.get('rules',''),payload.get('tags',''),Json(payload.get('custom_fields',{}))))
        row=cur.fetchone(); conn.commit(); return row

@app.post('/days/{day_id}/patterns/{pattern_id}')
def link_pattern(day_id:int, pattern_id:int, payload:dict={}):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute('''INSERT INTO day_pattern_links(day_id,pattern_id,confidence,notes) VALUES(%s,%s,%s,%s) ON CONFLICT(day_id,pattern_id) DO UPDATE SET confidence=EXCLUDED.confidence, notes=EXCLUDED.notes RETURNING *''',(day_id,pattern_id,payload.get('confidence',1),payload.get('notes','')))
        row=cur.fetchone(); conn.commit(); return row
