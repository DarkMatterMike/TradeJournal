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

        # ── Core tables ──────────────────────────
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
          kind TEXT NOT NULL CHECK (kind IN ('premarket','trade','ideal','postmarket','csv','other')),
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
          win_rate REAL DEFAULT NULL, avg_r_multiple REAL DEFAULT NULL, sample_count INTEGER DEFAULT 0,
          avg_pnl REAL DEFAULT NULL, custom_fields JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
        );''')
        cur.execute('''
        CREATE TABLE IF NOT EXISTS day_pattern_links (
          id SERIAL PRIMARY KEY, day_id INTEGER REFERENCES trading_days(id) ON DELETE CASCADE,
          pattern_id INTEGER REFERENCES playbook_patterns(id) ON DELETE CASCADE,
          confidence REAL DEFAULT 0, notes TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(day_id, pattern_id)
        );''')

        # ── Step 1: Performance metrics + structured AI columns ──
        migrations = [
            "ALTER TABLE trading_days ADD COLUMN IF NOT EXISTS pnl REAL DEFAULT NULL",
            "ALTER TABLE trading_days ADD COLUMN IF NOT EXISTS num_trades INTEGER DEFAULT NULL",
            "ALTER TABLE trading_days ADD COLUMN IF NOT EXISTS win_count INTEGER DEFAULT NULL",
            "ALTER TABLE trading_days ADD COLUMN IF NOT EXISTS loss_count INTEGER DEFAULT NULL",
            "ALTER TABLE trading_days ADD COLUMN IF NOT EXISTS r_multiple REAL DEFAULT NULL",
            "ALTER TABLE trading_days ADD COLUMN IF NOT EXISTS execution_score REAL DEFAULT NULL",
            "ALTER TABLE trading_days ADD COLUMN IF NOT EXISTS bias_score REAL DEFAULT NULL",
            "ALTER TABLE trading_days ADD COLUMN IF NOT EXISTS patience_score REAL DEFAULT NULL",
            "ALTER TABLE trading_days ADD COLUMN IF NOT EXISTS entry_score REAL DEFAULT NULL",
            "ALTER TABLE trading_days ADD COLUMN IF NOT EXISTS risk_mgmt_score REAL DEFAULT NULL",
            "ALTER TABLE trading_days ADD COLUMN IF NOT EXISTS profit_taking_score REAL DEFAULT NULL",
            "ALTER TABLE trading_days ADD COLUMN IF NOT EXISTS biggest_mistake TEXT DEFAULT ''",
            "ALTER TABLE trading_days ADD COLUMN IF NOT EXISTS biggest_strength TEXT DEFAULT ''",
            "ALTER TABLE trading_days ADD COLUMN IF NOT EXISTS ai_pattern_tags TEXT DEFAULT ''",
            "ALTER TABLE trading_days ADD COLUMN IF NOT EXISTS gap_direction TEXT DEFAULT ''",
            "ALTER TABLE trading_days ADD COLUMN IF NOT EXISTS premarket_trend TEXT DEFAULT ''",
            "ALTER TABLE trading_days ADD COLUMN IF NOT EXISTS volume_assessment TEXT DEFAULT ''",
            "ALTER TABLE trading_days ADD COLUMN IF NOT EXISTS key_levels TEXT DEFAULT ''",
            "ALTER TABLE trading_days ADD COLUMN IF NOT EXISTS likely_scenarios TEXT DEFAULT ''",
            "ALTER TABLE playbook_patterns ADD COLUMN IF NOT EXISTS sample_count INTEGER DEFAULT 0",
            "ALTER TABLE playbook_patterns ADD COLUMN IF NOT EXISTS avg_pnl REAL DEFAULT NULL",
            "ALTER TABLE uploads DROP CONSTRAINT IF EXISTS uploads_kind_check",
            "ALTER TABLE uploads ADD CONSTRAINT uploads_kind_check CHECK (kind IN ('premarket','trade','ideal','postmarket','csv','other'))",
        ]
        for m in migrations:
            try:
                cur.execute(m)
            except Exception:
                pass

        # ── Analyze sessions ─────────────────────
        cur.execute('''\
        CREATE TABLE IF NOT EXISTS analyze_sessions (
          id SERIAL PRIMARY KEY,
          analysis_type TEXT NOT NULL DEFAULT 'premarket'
            CHECK (analysis_type IN ('premarket','postmarket','trade','other')),
          trade_date DATE DEFAULT NULL,
          day_id INTEGER REFERENCES trading_days(id) ON DELETE SET NULL,
          filename TEXT DEFAULT '',
          storage_key TEXT DEFAULT '',
          url TEXT DEFAULT '',
          chart_analysis JSONB DEFAULT '{}'::jsonb,
          similar_days JSONB DEFAULT '[]'::jsonb,
          stats JSONB DEFAULT '{}'::jsonb,
          recommendation JSONB DEFAULT '{}'::jsonb,
          notes TEXT DEFAULT '',
          created_at TIMESTAMPTZ DEFAULT NOW()
        );''')

        # ── Indexes ──────────────────────────────
        cur.execute('CREATE INDEX IF NOT EXISTS idx_analyze_date ON analyze_sessions(trade_date DESC);')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_analyze_day ON analyze_sessions(day_id);')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_uploads_day ON uploads(day_id);')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_similar_source ON similar_day_links(source_day_id);')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_days_pnl ON trading_days(pnl) WHERE pnl IS NOT NULL;')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_days_pattern_tags ON trading_days USING gin(to_tsvector(\'english\', ai_pattern_tags));')

        # ── Seed default patterns ────────────────
        default_patterns = [
            ('Gap and Go', 'Price gaps up/down and continues in the gap direction with momentum'),
            ('VWAP Reclaim', 'Price crosses back above VWAP after trading below, establishing bullish control'),
            ('Failed Breakout', 'Price breaks a key level but immediately reverses back through it'),
            ('Opening Range Breakout', 'Price breaks above or below the opening range (first 15-30 minutes) with conviction'),
            ('Opening Range Breakdown', 'Price breaks below the opening range with sustained selling'),
            ('Trend Day', 'Persistent directional move with minimal retracement throughout the session'),
            ('Reversal Day', 'Market opens in one direction then reverses and closes in the opposite direction'),
            ('Chop Day', 'Range-bound session with no clear directional bias, mean-reverting price action'),
            ('Liquidity Sweep', 'Price takes out a key high/low to grab liquidity then reverses sharply'),
            ('CISD', 'Change in State of Delivery — shift from distribution to accumulation or vice versa'),
            ('Power of 3', 'Accumulation, manipulation, distribution sequence within a session'),
            ('FVG Entry', 'Entry taken at a Fair Value Gap left by an impulsive move'),
        ]
        for name, desc in default_patterns:
            cur.execute('INSERT INTO playbook_patterns(name, description) VALUES(%s, %s) ON CONFLICT(name) DO NOTHING', (name, desc))

        conn.commit()
