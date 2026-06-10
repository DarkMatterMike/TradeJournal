import React from 'react';
import { ChevronRight, Trash2 } from 'lucide-react';
import { fmt, fmtTs, pnl$, pnlC, pct, TYPE_LABELS, TYPE_COLORS, TYPE_BG } from './api';
import { Card, Verdict, Callout, Empty } from './ui';

export function TypeChip({ type, small }) {
  return (
    <span className="type-chip" style={{ background: TYPE_BG[type] || TYPE_BG.other, color: TYPE_COLORS[type] || TYPE_COLORS.other, fontSize: small ? 9 : undefined }}>
      {TYPE_LABELS[type] || type}
    </span>
  );
}

/* ── Similar days grid ───────────────────────────── */
export function SimilarList({ items, onOpenDay, idKey = 'day_id', scoreKey = 'similarity' }) {
  return (
    <div className="similar-list">
      {items.map((s, i) => (
        <button className="similar-card" key={i} style={{ animationDelay: `${i * 0.05}s` }}
          onClick={() => { const id = s[idKey] || s.matched_day_id || s.id; if (id && onOpenDay) onOpenDay(id); }}>
          <div className="similar-card__top">
            <span className="similar-card__date">{fmt(s.trade_date)}</span>
            <span className="similar-card__score">{Math.round((s[scoreKey] || s.similarity_score || 0) * 100)}%</span>
          </div>
          <span className="similar-card__ticker">{s.tickers} {s.title}</span>
          <div className="similar-card__meta">
            {s.pnl != null && <span className={pnlC(s.pnl)}>{pnl$(s.pnl)}</span>}
            {s.ai_pattern_tags && <span className="muted">{s.ai_pattern_tags}</span>}
          </div>
          {s.lessons && <div className="similar-card__quote">"{s.lessons.slice(0, 80)}{s.lessons.length > 80 ? '…' : ''}"</div>}
          <ChevronRight size={14} className="similar-card__arrow" />
        </button>
      ))}
    </div>
  );
}

/* ── Generic key/val intel panel ─────────────────── */
export function IntelPanel({ label, data }) {
  if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) return null;
  const entries = typeof data === 'object' ? Object.entries(data) : [];
  return (
    <div className="mt22">
      <div className="subhead">{label}</div>
      {typeof data === 'string'
        ? <p className="intel-prose">{data}</p>
        : <div className="intel-grid">
            {entries.map(([k, v]) => (
              <div key={k} className="intel-item">
                <span className="intel-item__key">{k.replace(/_/g, ' ')}</span>
                <span className="intel-item__val">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
              </div>
            ))}
          </div>}
    </div>
  );
}

/* ── Analysis result cards (live result + history detail) ── */
export function AnalysisResultCards({ result, onOpenDay, cardIdx = '02' }) {
  if (!result) return null;
  const { chart_analysis, similar_days, stats, recommendation, analysis_type, trade_date, day_id, url, filename, created_at } = result;
  const ca = chart_analysis || {};
  return (
    <>
      {(trade_date || created_at || analysis_type) && (
        <div className="row" style={{ marginBottom: 16 }}>
          {analysis_type && <TypeChip type={analysis_type} />}
          {trade_date && <span className="mono" style={{ fontSize: 11, color: 'var(--bone-2)' }}>{fmt(trade_date)}</span>}
          {created_at && <span className="mono muted" style={{ fontSize: 10 }}>{fmtTs(created_at)}</span>}
          {day_id && onOpenDay && <button className="btn btn--ghost btn--sm" onClick={() => onOpenDay(day_id)}>View Trade Day →</button>}
        </div>
      )}

      {url && (
        <div style={{ marginBottom: 22 }}>
          <img src={url} alt={filename || 'chart'} style={{ maxHeight: 280, borderRadius: 3, border: '1px solid var(--hairline-2)', display: 'block' }} />
        </div>
      )}

      {recommendation && (
        <Card idx={cardIdx} eyebrow="AI REVIEW" title="Recommendation" className="s1" style={{ marginBottom: 22 }}>
          {recommendation.times_seen > 0 && (
            <p style={{ fontSize: 13, color: 'var(--bone-2)', marginBottom: 16 }}>
              You've seen this structure <b style={{ color: 'var(--volt)' }}>{recommendation.times_seen} times</b>.
            </p>
          )}
          <div className="callouts callouts--tight" style={{ marginTop: 0, marginBottom: 18 }}>
            <Callout k="Avg Result" v={stats?.avg_pnl != null ? pnl$(stats.avg_pnl) : '—'} vColor={stats?.avg_pnl > 0 ? 'var(--up)' : stats?.avg_pnl < 0 ? 'var(--dn)' : undefined} />
            <Callout k="Win Rate" v={stats?.win_rate != null ? pct(stats.win_rate) : '—'} />
            <Callout k="Risk Level" v={(recommendation.risk_level || '—').toUpperCase()} />
            <Callout k="Similar Days" v={similar_days?.length || 0} />
          </div>
          {recommendation.best_strategy && <Verdict tone="good" label="Best Strategy" style={{ marginTop: 12 }}>{recommendation.best_strategy}</Verdict>}
          {recommendation.most_common_mistake && <Verdict label="Common Mistake" style={{ marginTop: 12 }}>{recommendation.most_common_mistake}</Verdict>}
          {recommendation.recommendation && <Verdict tone="volt" label="Recommendation" style={{ marginTop: 12 }}>{recommendation.recommendation}</Verdict>}
          {recommendation.pattern_summary && <Verdict tone="gold" label="Pattern" style={{ marginTop: 12 }}>{recommendation.pattern_summary}</Verdict>}
        </Card>
      )}

      {ca && Object.keys(ca).length > 0 && (
        <Card idx={String(Number(cardIdx) + 1).padStart(2, '0')} eyebrow="CHART READ" title="Chart Analysis" className="s2" style={{ marginBottom: 22 }}>
          <div className="intel-grid">
            {ca.gap_direction && <div className="intel-item"><span className="intel-item__key">gap</span><span className="intel-item__val">{ca.gap_direction}</span></div>}
            {ca.premarket_trend && <div className="intel-item"><span className="intel-item__key">trend</span><span className="intel-item__val">{ca.premarket_trend}</span></div>}
            {ca.directional_bias && <div className="intel-item"><span className="intel-item__key">bias</span><span className="intel-item__val">{ca.directional_bias}</span></div>}
            {ca.volume_assessment && <div className="intel-item"><span className="intel-item__key">volume</span><span className="intel-item__val">{ca.volume_assessment}</span></div>}
            {ca.market_structure?.vwap_context && <div className="intel-item"><span className="intel-item__key">vwap</span><span className="intel-item__val">{ca.market_structure.vwap_context}</span></div>}
            {ca.market_structure?.trend_or_chop && <div className="intel-item"><span className="intel-item__key">session type</span><span className="intel-item__val">{ca.market_structure.trend_or_chop}</span></div>}
          </div>
          {ca.summary && <p className="intel-prose mt16">{ca.summary}</p>}
          {ca.risk_notes && <Verdict tone="gold" label="Risk" style={{ marginTop: 16 }}>{ca.risk_notes}</Verdict>}
          {ca.pattern_tags?.length > 0 && (
            <div className="chip-list mt16">{ca.pattern_tags.map(t => <span key={t} className="chip">{t.replace(/_/g, ' ')}</span>)}</div>
          )}
          {ca.key_levels?.length > 0 && (
            <div className="mt12" style={{ fontSize: 12.5, color: 'var(--bone-2)' }}>
              <span className="mono muted" style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase' }}>Key Levels — </span>
              {Array.isArray(ca.key_levels) ? ca.key_levels.join(', ') : ca.key_levels}
            </div>
          )}
          {ca.likely_scenarios?.length > 0 && (
            <div className="mt16">
              <div className="subhead">Likely Scenarios</div>
              {(Array.isArray(ca.likely_scenarios) ? ca.likely_scenarios : [ca.likely_scenarios]).map((s, i) => (
                <div key={i} style={{ fontSize: 12.5, color: 'var(--bone-2)', padding: '7px 0', borderBottom: '1px solid var(--hairline)' }}>{s}</div>
              ))}
            </div>
          )}
        </Card>
      )}

      {similar_days?.length > 0 && (
        <Card idx={String(Number(cardIdx) + 2).padStart(2, '0')} eyebrow="HISTORICAL MATCH" title="Similar Historical Days" aux={<span className="muted">CLICK TO OPEN</span>} className="s3">
          <SimilarList items={similar_days} onOpenDay={onOpenDay} />
        </Card>
      )}
    </>
  );
}

/* ── History card (analyze sessions) ─────────────── */
export function HistoryCard({ s, onOpen, onDelete, delay = 0 }) {
  const ca = s.chart_analysis || {};
  const rec = s.recommendation || {};
  return (
    <button className="history-card" style={{ animationDelay: `${delay}s` }} onClick={() => onOpen(s.id)}>
      {s.url && <div className="history-card__thumb"><img src={s.url} alt={s.filename} loading="lazy" /></div>}
      <div className="history-card__body">
        <div className="history-card__top">
          <TypeChip type={s.analysis_type} small />
          {s.trade_date && <span className="mono" style={{ fontSize: 10.5, color: 'var(--bone-2)' }}>{fmt(s.trade_date)}</span>}
          {s.day_id && <span className="mono v" style={{ fontSize: 9.5, letterSpacing: 1 }}>LINKED TO DAY</span>}
          <span className="history-card__ts">{fmtTs(s.created_at)}</span>
        </div>
        {ca.summary && <p className="history-card__summary">{ca.summary.slice(0, 120)}{ca.summary.length > 120 ? '…' : ''}</p>}
        <div className="history-card__meta">
          {ca.directional_bias && <span className="history-card__tag">{ca.directional_bias}</span>}
          {ca.gap_direction && ca.gap_direction !== 'null' && <span className="history-card__tag">{ca.gap_direction}</span>}
          {ca.pattern_tags?.slice(0, 3).map(t => <span key={t} className="history-card__tag">{t.replace(/_/g, ' ')}</span>)}
        </div>
        {rec.recommendation && <p className="history-card__rec">{rec.recommendation.slice(0, 100)}{rec.recommendation.length > 100 ? '…' : ''}</p>}
        {s.notes && <p className="history-card__note">{s.notes}</p>}
      </div>
      {onDelete && (
        <div className="history-card__actions" onClick={e => e.stopPropagation()}>
          <button className="btn btn--danger btn--sm" onClick={() => onDelete(s.id)}><Trash2 size={12} /></button>
        </div>
      )}
    </button>
  );
}

/* ── Generic trade rows table ────────────────────── */
export function TradeTable({ rows }) {
  if (!rows.length) return null;
  const keys = [...new Set(rows.flatMap(r => Object.keys(r.row_data || {})))];
  if (!keys.length) return <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, color: 'var(--bone-2)', fontFamily: 'var(--m)' }}>{JSON.stringify(rows, null, 2)}</pre>;
  return (
    <table className="ledger">
      <thead><tr>{keys.map(k => <th key={k}>{k}</th>)}</tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.id || i} style={{ animationDelay: `${Math.min(i * 0.04, 0.8)}s` }}>
            {keys.map(k => <td key={k}>{String(r.row_data?.[k] ?? '')}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
