import os
import psycopg
from psycopg.rows import dict_row
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.getenv('DATABASE_URL','')

def get_conn():
    if not DATABASE_URL:
        raise RuntimeError('DATABASE_URL is missing.')
    return psycopg.connect(DATABASE_URL, row_factory=dict_row)

def init_db():
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute('CREATE EXTENSION IF NOT EXISTS vector;')
        cur.execute('''
        CREATE TABLE IF NOT EXISTS trading_days (
          id SERIAL PRIMARY KEY,
          trade_date DATE UNIQUE NOT NULL,
          title TEXT DEFAULT '', tickers TEXT DEFAULT '', strategy TEXT DEFAULT '', session TEXT DEFAULT '',
          market_bias TEXT DEFAULT '', premarket_notes TEXT DEFAULT '', trade_notes TEXT DEFAULT '', ideal_notes TEXT DEFAULT '',
          lessons TEXT DEFAULT '', tags TEXT DEFAULT '', mood TEXT DEFAULT '', rule_following_score INTEGER DEFAULT NULL,
          ai_summary TEXT DEFAULT '', ai_setup_tags TEXT DEFAULT '', ai_market_structure JSONB DEFAULT '{}'::jsonb,
          ai_execution_review JSONB DEFAULT '{}'::jsonb, custom_fields JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
        );''')
        cur.execute('''
        CREATE TABLE IF NOT EXISTS uploads (
          id SERIAL PRIMARY KEY, day_id INTEGER REFERENCES trading_days(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN ('premarket','trade','ideal','csv','other')),
          filename TEXT NOT NULL, content_type TEXT DEFAULT '', storage_provider TEXT DEFAULT 'r2',
          storage_key TEXT NOT NULL, url TEXT DEFAULT '', extracted_text TEXT DEFAULT '', ai_description TEXT DEFAULT '',
          ai_json JSONB DEFAULT '{}'::jsonb, custom_fields JSONB DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ DEFAULT NOW()
        );''')
        cur.execute('''
        CREATE TABLE IF NOT EXISTS trade_rows (
          id SERIAL PRIMARY KEY, day_id INTEGER REFERENCES trading_days(id) ON DELETE CASCADE,
          row_data JSONB NOT NULL, normalized JSONB DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ DEFAULT NOW()
        );''')
        cur.execute('''
        CREATE TABLE IF NOT EXISTS ai_embeddings (
          id SERIAL PRIMARY KEY, day_id INTEGER REFERENCES trading_days(id) ON DELETE CASCADE,
          upload_id INTEGER REFERENCES uploads(id) ON DELETE CASCADE,
          embedding_type TEXT NOT NULL, content TEXT NOT NULL, embedding vector(1536), created_at TIMESTAMPTZ DEFAULT NOW()
        );''')
        cur.execute('''
        CREATE TABLE IF NOT EXISTS similar_day_links (
          id SERIAL PRIMARY KEY,
          source_day_id INTEGER REFERENCES trading_days(id) ON DELETE CASCADE,
          matched_day_id INTEGER REFERENCES trading_days(id) ON DELETE CASCADE,
          similarity_score REAL DEFAULT 0, reason TEXT DEFAULT '', ai_reason JSONB DEFAULT '{}'::jsonb,
          relationship_type TEXT DEFAULT 'similar', user_notes TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(source_day_id, matched_day_id)
        );''')
        cur.execute('''
        CREATE TABLE IF NOT EXISTS playbook_patterns (
          id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL, description TEXT DEFAULT '', rules TEXT DEFAULT '', tags TEXT DEFAULT '',
          win_rate REAL DEFAULT NULL, avg_r_multiple REAL DEFAULT NULL, custom_fields JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
        );''')
        cur.execute('''
        CREATE TABLE IF NOT EXISTS day_pattern_links (
          id SERIAL PRIMARY KEY, day_id INTEGER REFERENCES trading_days(id) ON DELETE CASCADE,
          pattern_id INTEGER REFERENCES playbook_patterns(id) ON DELETE CASCADE,
          confidence REAL DEFAULT 0, notes TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(day_id, pattern_id)
        );''')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_days_date ON trading_days(trade_date DESC);')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_uploads_day ON uploads(day_id);')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_similar_source ON similar_day_links(source_day_id);')
        conn.commit()
