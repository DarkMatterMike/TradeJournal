// ── EDGE — Patterns Page ───────────────────────────────────────────────
import React from 'react';
import { pnlC, pnl$, pct } from '../api.js';
import { Card, PageHead, Empty } from '../ui.jsx';

export default function PatternsPage({
  patterns, editingPattern, setEditingPattern, patternDraft, setPatternDraft,
  savePattern, deletePattern, createNewPattern, qf, setPage,
}) {
  const wrTone = (wr) => wr == null ? '' : wr >= 0.7 ? 'u' : wr >= 0.55 ? 'g' : 'd';

  return <>
    <PageHead
      idx="01"
      eyebrow="PATTERN ARCHIVE"
      title="Pattern Library"
      sub={`${patterns.length} pattern${patterns.length === 1 ? '' : 's'} tracked across your trading history`}
      actions={<button className="btn primary" onClick={createNewPattern}>+ NEW PATTERN</button>}
    />

    <Card idx="02" eyebrow="EDGE INDEX" title="Tracked Patterns" className="s2">
      {patterns.length === 0 && <Empty>No patterns yet. Run intelligence on trade days, or create one manually.</Empty>}
      {patterns.length > 0 && (
        <table className="ledger">
          <thead>
            <tr>
              <th>PATTERN</th>
              <th>DAYS</th>
              <th>WIN RATE</th>
              <th>AVG P&L</th>
              <th>DESCRIPTION</th>
              <th style={{ width: 110, textAlign: 'right' }}>OPS</th>
            </tr>
          </thead>
          <tbody>
            {patterns.map((p, i) => editingPattern === p.id ? (
              <tr key={p.id} style={{ animationDelay: `${0.04 * i}s` }}>
                <td><input className="field__input" style={{ padding: '6px 9px', fontSize: 13 }} value={patternDraft.name || ''} onChange={e => setPatternDraft({ ...patternDraft, name: e.target.value })} /></td>
                <td className="mono">{p.sample_count || 0}</td>
                <td className={`mono ${wrTone(p.win_rate)}`}>{p.win_rate != null ? pct(p.win_rate) : '—'}</td>
                <td className={`mono ${pnlC(p.avg_pnl)}`}>{p.avg_pnl != null ? pnl$(p.avg_pnl) : '—'}</td>
                <td><input className="field__input" style={{ padding: '6px 9px', fontSize: 12, width: '100%' }} value={patternDraft.description || ''} onChange={e => setPatternDraft({ ...patternDraft, description: e.target.value })} /></td>
                <td style={{ textAlign: 'right' }}>
                  <div className="row" style={{ justifyContent: 'flex-end' }}>
                    <button className="btn primary sm" onClick={() => savePattern(p.id)}>SAVE</button>
                    <button className="btn ghost sm" onClick={() => setEditingPattern(null)}>✕</button>
                  </div>
                </td>
              </tr>
            ) : (
              <tr key={p.id} style={{ animationDelay: `${0.04 * i}s` }}>
                <td style={{ fontWeight: 600, color: 'var(--bone)', cursor: 'pointer' }} onClick={() => { qf('pattern', p.name); setPage('intel'); }}>{p.name}</td>
                <td className="mono">{p.sample_count || 0}</td>
                <td className={`mono ${wrTone(p.win_rate)}`}>{p.win_rate != null ? pct(p.win_rate) : '—'}</td>
                <td className={`mono ${pnlC(p.avg_pnl)}`}>{p.avg_pnl != null ? pnl$(p.avg_pnl) : '—'}</td>
                <td className="muted" style={{ fontSize: 12.5, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(p.description || '').slice(0, 80)}</td>
                <td style={{ textAlign: 'right' }}>
                  <div className="row" style={{ justifyContent: 'flex-end' }}>
                    <button className="btn ghost sm" onClick={() => { setEditingPattern(p.id); setPatternDraft({ name: p.name, description: p.description, rules: p.rules, tags: p.tags }); }}>EDIT</button>
                    <button className="btn danger sm" onClick={() => deletePattern(p.id)}>DEL</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted" style={{ fontSize: 11.5, marginTop: 12, letterSpacing: '0.04em' }}>
        Click a pattern name to query all days where it was detected.
      </p>
    </Card>
  </>;
}
