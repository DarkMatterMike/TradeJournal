import React, { useRef, useState } from 'react';
import { Brain, Filter, X, Loader2, ChevronRight } from 'lucide-react';
import { api, fmt, pnl$, pnlC, pct } from '../api';
import { PageHead, Card, Field, Callout, Empty } from '../ui';

function BulkIntelligenceButton({ setStatus, onDone }) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const abortRef = useRef(false);

  const run = async () => {
    if (!confirm('Run AI intelligence on all days that haven\'t been analyzed yet? This will use OpenAI API credits — roughly $0.01-0.03 per day. With ~30 trade days it\'ll cost ~$0.30-0.90 total.')) return;
    setRunning(true);
    abortRef.current = false;
    setProgress({ processed: 0, remaining: '?', errors: [] });

    let totalProcessed = 0;
    let batch = 0;

    while (!abortRef.current) {
      try {
        const result = await api('/intelligence/bulk', {
          method: 'POST',
          body: JSON.stringify({ limit: 10, skip_existing: true }),
        });

        totalProcessed += result.processed;
        batch++;
        setProgress({ processed: totalProcessed, remaining: result.remaining, errors: result.errors, batch });
        setStatus(`Intelligence: ${totalProcessed} done, ${result.remaining} remaining…`);

        if (result.done || result.remaining === 0 || result.processed === 0) {
          setStatus(`Intelligence complete — ${totalProcessed} days analyzed`);
          if (onDone) onDone();
          break;
        }
        await new Promise(r => setTimeout(r, 1500));
      } catch (e) {
        setStatus('Bulk intelligence error: ' + e.message);
        break;
      }
    }
    setRunning(false);
  };

  const stop = () => { abortRef.current = true; setStatus('Stopping after current batch…'); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
      {!running
        ? <button className="btn btn--amber" onClick={run}><Brain size={13} /> Run Bulk Intelligence</button>
        : <button className="btn btn--danger" onClick={stop}><X size={13} /> Stop</button>}
      {progress && (
        <div className="mono" style={{ fontSize: 10.5, textAlign: 'right', letterSpacing: 0.5 }}>
          <span className="u" style={{ fontWeight: 700 }}>{progress.processed} ANALYZED</span>
          {progress.remaining !== '?' && <span className="muted"> · {progress.remaining} REMAINING</span>}
          {running && <span className="v" style={{ marginLeft: 8 }}><Loader2 size={10} className="spin" style={{ display: 'inline', verticalAlign: 'middle' }} /> PROCESSING…</span>}
          {progress.errors?.length > 0 && <div className="g" style={{ marginTop: 2 }}>{progress.errors.length} ERROR{progress.errors.length > 1 ? 'S' : ''}</div>}
        </div>
      )}
    </div>
  );
}

export default function IntelPage({ queryFilters, qf, runQuery, queryResult, openDay, setStatus, onBulkDone }) {
  return (
    <>
      <PageHead idx="01" eyebrow="QUERY ENGINE" title="Intelligence"
        sub="Query your trading history"
        actions={<BulkIntelligenceButton setStatus={setStatus} onDone={onBulkDone} />}
      />

      <Card idx="02" eyebrow="FILTERS" title="Query Builder" className="s1" style={{ marginTop: 26, marginBottom: 22 }}>
        <div className="field-grid field-grid--3">
          <label className="field">
            <span className="field__label">Pattern</span>
            <select className="field__input" value={queryFilters.pattern} onChange={e => qf('pattern', e.target.value)}>
              <option value="">All patterns</option>
              {['Gap and Go', 'VWAP Reclaim', 'Failed Breakout', 'Trend Day', 'Reversal Day', 'Chop Day', 'Liquidity Sweep', 'CISD', 'Power of 3', 'FVG Entry'].map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Outcome</span>
            <select className="field__input" value={queryFilters.outcome} onChange={e => qf('outcome', e.target.value)}>
              <option value="">All</option><option value="win">Winners</option><option value="loss">Losers</option>
            </select>
          </label>
          <Field label="Ticker" value={queryFilters.ticker} onChange={v => qf('ticker', v)} placeholder="MNQ, ES…" />
        </div>
        <div className="row mt8">
          <label className="field" style={{ margin: 0, minWidth: 160 }}>
            <span className="field__label">Sort</span>
            <select className="field__input" value={queryFilters.sort} onChange={e => qf('sort', e.target.value)}>
              <option value="date">Date</option><option value="pnl">Best P&L</option><option value="pnl_asc">Worst P&L</option><option value="score">Best Score</option>
            </select>
          </label>
          <button className="btn btn--primary" style={{ alignSelf: 'flex-end' }} onClick={runQuery}><Filter size={13} /> Run Query</button>
        </div>
      </Card>

      {queryResult && (
        <Card idx="03" eyebrow="RESULTS" title={`${queryResult.stats.total} Days Matched`} className="s2">
          <div className="callouts callouts--tight" style={{ marginTop: 0, marginBottom: 18 }}>
            <Callout k="Total P&L" v={queryResult.stats.total_pnl != null ? pnl$(queryResult.stats.total_pnl) : '—'}
              vColor={queryResult.stats.total_pnl > 0 ? 'var(--up)' : queryResult.stats.total_pnl < 0 ? 'var(--dn)' : undefined} />
            <Callout k="Win Rate" v={pct(queryResult.stats.win_rate)} />
            <Callout k="Avg Score" v={queryResult.stats.avg_score != null ? Math.round(queryResult.stats.avg_score) : '—'} />
            <Callout k="Days" v={queryResult.stats.total} />
          </div>
          <div className="registry">
            {queryResult.days.map((dy, i) => (
              <button key={dy.id} className="registry__row" style={{ animationDelay: `${Math.min(i * 0.03, 0.5)}s` }} onClick={() => openDay(dy.id)}>
                <span className="registry__date">{fmt(dy.trade_date)}</span>
                <span className="registry__name">{dy.tickers || dy.title || 'Untitled'}</span>
                <span className="registry__tags">{dy.ai_pattern_tags || ''}</span>
                <span className={`registry__pnl ${pnlC(dy.pnl)}`}>{dy.pnl != null ? pnl$(dy.pnl) : '—'}</span>
                <span className="scorepill registry__score-col">{dy.execution_score != null ? Math.round(dy.execution_score) : '—'}</span>
                <ChevronRight size={14} className="registry__arrow" />
              </button>
            ))}
            {queryResult.days.length === 0 && <Empty>No days matched this query.</Empty>}
          </div>
        </Card>
      )}
    </>
  );
}
