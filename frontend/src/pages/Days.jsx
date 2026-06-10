import React from 'react';
import { Plus, Search, ChevronRight, Calendar } from 'lucide-react';
import { fmt, pnl$, pnlC } from '../api';
import { PageHead, Card, Empty } from '../ui';

export default function DaysPage({ days, q, setQ, load, newDay, openDay }) {
  return (
    <>
      <PageHead idx="01" eyebrow="SESSION REGISTRY" title="Trade Days"
        sub={<><b>{days.length}</b> days logged</>}
        actions={<button className="btn btn--primary" onClick={newDay}><Plus size={13} /> New Day</button>}
      />

      <div className="row" style={{ marginTop: 26, marginBottom: 22 }}>
        <div className="searchbar">
          <Search size={14} />
          <input
            placeholder="Search days, tickers, tags…"
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') load(); }}
          />
        </div>
        <button className="btn" onClick={load}>Search</button>
      </div>

      <Card idx="02" eyebrow="EXECUTION LEDGER" title="All Sessions" className="s1">
        <div className="registry">
          {days.map((dy, i) => (
            <button key={dy.id} className="registry__row" style={{ animationDelay: `${Math.min(i * 0.03, 0.6)}s` }} onClick={() => openDay(dy.id)}>
              <span className="registry__date">{fmt(dy.trade_date)}</span>
              <span className="registry__name">{dy.tickers || dy.title || 'Untitled'}</span>
              <span className="registry__tags">{dy.ai_pattern_tags || dy.tags || ''}</span>
              <span className={`registry__pnl ${pnlC(dy.pnl)}`}>{dy.pnl != null ? pnl$(dy.pnl) : '—'}</span>
              <span className="scorepill registry__score-col">{dy.execution_score != null ? Math.round(dy.execution_score) : '—'}</span>
              <ChevronRight size={14} className="registry__arrow" />
            </button>
          ))}
          {days.length === 0 && <Empty icon={Calendar}>No days logged yet. Click "New Day" to start.</Empty>}
        </div>
      </Card>
    </>
  );
}
