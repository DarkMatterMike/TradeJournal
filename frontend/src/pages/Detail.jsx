import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Save, Brain, Link2, Trash2, Upload, BarChart3, Zap, Loader2, ArrowUpRight, TrendingUp, TrendingDown } from 'lucide-react';
import { api, fmt, pnl$, pnlC, pct } from '../api';
import { Eyebrow, Card, Field, Verdict, Gauge, Meter, Callout, Empty } from '../ui';
import { AnalysisResultCards, HistoryCard, SimilarList, IntelPanel, TradeTable } from '../cards';

function UploadSlot({ kind, onUpload }) {
  const ref = useRef();
  const labels = { premarket: 'Premarket', trade: 'Trade', ideal: 'Ideal Setup', postmarket: 'Post-Market', csv: 'Trade CSV', other: 'Other' };
  return (
    <button className="upload-slot" onClick={() => ref.current?.click()}>
      <Upload size={15} />
      <span>{labels[kind]}</span>
      <input ref={ref} type="file" hidden accept={kind === 'csv' ? '.csv' : 'image/*,.csv'} onChange={e => { onUpload(kind, e.target.files[0]); e.target.value = ''; }} />
    </button>
  );
}

function DayAnalysesTab({ dayId, onOpenDay, setStatus }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const all = await api('/analyze/history?limit=200');
        setSessions(all.filter(s => s.day_id === dayId));
      } catch (e) {
        setStatus('Failed to load analyses: ' + e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [dayId]);

  const openSession = async (id) => {
    try {
      const data = await api(`/analyze/sessions/${id}`);
      setSelected({ ...data.session, chart_analysis: data.session.chart_analysis || {}, similar_days: data.session.similar_days || [], stats: data.session.stats || {}, recommendation: data.session.recommendation || {} });
    } catch (e) { setStatus('Failed: ' + e.message); }
  };

  if (loading) return <div className="loading-line"><Loader2 size={15} className="spin" /> LOADING ANALYSES…</div>;

  if (selected) return (
    <>
      <button className="detail-back" style={{ margin: '0 0 18px' }} onClick={() => setSelected(null)}><ChevronLeft size={14} /> Back to list</button>
      <AnalysisResultCards result={selected} onOpenDay={onOpenDay} cardIdx="03" />
    </>
  );

  if (sessions.length === 0) return <Empty icon={Zap}>No analyze sessions linked to this day yet. Use the Analyze page and select this date to link one.</Empty>;

  return (
    <div className="history-list">
      {sessions.map((s, i) => <HistoryCard key={s.id} s={s} onOpen={openSession} delay={Math.min(i * 0.05, 0.5)} />)}
    </div>
  );
}

export default function DetailPage({
  selected, bundle, draft, d, day,
  detailTab, setDetailTab,
  save, intelligence, findSimilar, deleteDay,
  upload, setLightbox, setPage, load, openDay, setStatus,
}) {
  const images = (bundle?.uploads || []).filter(u => (u.content_type || '').startsWith('image/'));
  const files = (bundle?.uploads || []).filter(u => !(u.content_type || '').startsWith('image/'));

  return (
    <>
      <button className="detail-back" onClick={() => { setPage('journal'); }}><ChevronLeft size={14} /> Back to Journal</button>

      <Eyebrow idx="01" label="SESSION DETAIL" rule right="LUXE / CAPITAL" style={{ marginTop: 18, animation: 'rise 0.5s ease both' }} />
      <div className="detail-head">
        <div>
          <div className="detail-head__date">{day ? fmt(day.trade_date) : 'New Day'}</div>
          <div className="detail-head__meta">
            {day?.tickers && <span>{day.tickers}</span>}
            {day?.strategy && <span>· {day.strategy}</span>}
            {day?.pnl != null && <span className={pnlC(day.pnl)}>· {pnl$(day.pnl)}</span>}
            {day?.execution_score != null && <span>· SCORE {Math.round(day.execution_score)}</span>}
          </div>
        </div>
        <div className="detail-head__actions">
          <button className="btn btn--primary" onClick={save}><Save size={13} /> Save</button>
          {selected && <button className="btn btn--amber" onClick={intelligence}><Brain size={13} /> Intelligence</button>}
          {selected && <button className="btn" onClick={findSimilar}><Link2 size={13} /> Similar</button>}
          {selected && <button className="btn btn--danger" onClick={deleteDay}><Trash2 size={13} /></button>}
        </div>
      </div>

      <div className="tabs">
        {[['overview', 'Overview'], ['edit', 'Edit'], ['charts', 'Charts'], ['intel', 'Intelligence'], ['similar', 'Similar Days'], ['analyses', 'Analyses']].map(([id, label]) => (
          <button key={id} className={`tab ${detailTab === id ? 'on' : ''}`} onClick={() => setDetailTab(id)}>{label}</button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {detailTab === 'overview' && day && (
        <>
          {day.pnl != null && (
            <div className="callouts" style={{ marginTop: 0, marginBottom: 26, animation: 'rise 0.5s ease 0.1s both' }}>
              <Callout k="Net P&L" v={pnl$(day.pnl)} vColor={day.pnl > 0 ? 'var(--up)' : day.pnl < 0 ? 'var(--dn)' : undefined} />
              <Callout k="Trades" v={day.num_trades ?? '—'} />
              <Callout k="Wins / Losses" v={`${day.win_count ?? '—'} / ${day.loss_count ?? '—'}`} />
              <Callout k="Exec Score" v={day.execution_score != null ? Math.round(day.execution_score) : '—'} />
            </div>
          )}

          {images.length > 0 && (
            <Card idx="02" eyebrow="EVIDENCE" title="Charts" className="s1" style={{ marginBottom: 22 }}>
              <div className="chart-grid">
                {images.map(u => (
                  <div className="chart-card" key={u.id} onClick={() => setLightbox(u.url)}>
                    <img className="chart-card__img" src={u.url} alt={u.filename} loading="lazy" />
                    <div className="chart-card__foot"><span className="chart-card__kind">{u.kind}</span><span className="chart-card__name">{u.filename}</span></div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {(day.market_bias || day.premarket_notes) && (
            <Card idx="03" eyebrow="PRE-MARKET" title="Session Prep" className="s2" style={{ marginBottom: 22 }}>
              {day.market_bias && <><div className="subhead" style={{ marginTop: 0 }}>Bias</div><p className="intel-prose">{day.market_bias}</p></>}
              {day.premarket_notes && <><div className="subhead">Notes</div><p className="intel-prose">{day.premarket_notes}</p></>}
            </Card>
          )}

          {(day.trade_notes || day.ideal_notes) && (
            <Card idx="04" eyebrow="EXECUTION" title="Trade Notes" className="s3" style={{ marginBottom: 22 }}>
              {day.trade_notes && <><div className="subhead" style={{ marginTop: 0 }}>Trades Taken</div><p className="intel-prose">{day.trade_notes}</p></>}
              {day.ideal_notes && <><div className="subhead">Ideal Trades</div><p className="intel-prose">{day.ideal_notes}</p></>}
            </Card>
          )}

          {day.ai_summary && (
            <Card idx="05" eyebrow="AI REVIEW" title="Summary" className="s4" style={{ marginBottom: 22 }}>
              <Verdict tone="volt" label="AI Summary" style={{ marginTop: 0 }}>{day.ai_summary}</Verdict>
            </Card>
          )}

          {day.lessons && (
            <Card idx="06" eyebrow="DEBRIEF" title="Lessons" style={{ marginBottom: 22 }}>
              <Verdict tone="gold" label="Carry Forward" style={{ marginTop: 0 }}>{day.lessons}</Verdict>
            </Card>
          )}
        </>
      )}
      {detailTab === 'overview' && !day && <Empty>Fill in the details on the Edit tab, then save.</Empty>}

      {/* ── EDIT ── */}
      {detailTab === 'edit' && (
        <>
          <Card idx="02" eyebrow="SESSION CONTEXT" title="Context" className="s1" style={{ marginBottom: 22 }}>
            <div className="field-grid field-grid--3">
              <Field label="Date" type="date" value={draft.trade_date} onChange={v => d('trade_date', v)} />
              <Field label="Tickers" value={draft.tickers} onChange={v => d('tickers', v)} placeholder="MNQ, ES, NQ…" />
              <Field label="Strategy" value={draft.strategy} onChange={v => d('strategy', v)} placeholder="SSMT, ORB…" />
            </div>
            <div className="field-grid field-grid--3">
              <Field label="Session" value={draft.session} onChange={v => d('session', v)} placeholder="NY AM, London…" />
              <Field label="Mood" value={draft.mood} onChange={v => d('mood', v)} placeholder="Focused, anxious…" />
              <Field label="Title" value={draft.title} onChange={v => d('title', v)} placeholder="Short label" />
            </div>
          </Card>

          <Card idx="03" eyebrow="PERFORMANCE" title="Numbers" className="s2" style={{ marginBottom: 22 }}>
            <div className="field-grid field-grid--4">
              <Field label="P&L ($)" type="number" value={draft.pnl} onChange={v => d('pnl', v ? parseFloat(v) : null)} />
              <Field label="# Trades" type="number" value={draft.num_trades} onChange={v => d('num_trades', v ? parseInt(v) : null)} />
              <Field label="Wins" type="number" value={draft.win_count} onChange={v => d('win_count', v ? parseInt(v) : null)} />
              <Field label="Losses" type="number" value={draft.loss_count} onChange={v => d('loss_count', v ? parseInt(v) : null)} />
            </div>
            <p className="field-hint">AUTO-FILLS WHEN YOU UPLOAD A TRADE CSV.</p>
          </Card>

          <Card idx="04" eyebrow="DEBRIEF" title="Notes" className="s3" style={{ marginBottom: 22 }}>
            <Field label="Market Bias" textarea value={draft.market_bias} onChange={v => d('market_bias', v)} placeholder="Directional bias before the session…" />
            <Field label="Premarket Notes" textarea value={draft.premarket_notes} onChange={v => d('premarket_notes', v)} placeholder="Key levels, overnight context…" />
            <Field label="Trades Taken" textarea value={draft.trade_notes} onChange={v => d('trade_notes', v)} placeholder="What you did — entries, exits, sizing…" />
            <Field label="Ideal Trades" textarea value={draft.ideal_notes} onChange={v => d('ideal_notes', v)} placeholder="What you should have done…" />
            <Field label="Lessons" textarea value={draft.lessons} onChange={v => d('lessons', v)} placeholder="What to carry forward…" />
            <Field label="Tags" value={draft.tags} onChange={v => d('tags', v)} placeholder="revenge-trade, A-setup, chop…" />
          </Card>
        </>
      )}

      {/* ── CHARTS ── */}
      {detailTab === 'charts' && (
        selected ? (
          <>
            <Card idx="02" eyebrow="INGEST" title="Upload" className="s1" style={{ marginBottom: 22 }}>
              <div className="upload-grid">{['premarket', 'trade', 'ideal', 'postmarket', 'csv', 'other'].map(k => <UploadSlot key={k} kind={k} onUpload={upload} />)}</div>
            </Card>
            {images.length > 0 && (
              <Card idx="03" eyebrow="EVIDENCE" title="Charts" className="s2" style={{ marginBottom: 22 }}>
                <div className="chart-grid">
                  {images.map(u => (
                    <div className="chart-card" key={u.id} onClick={() => setLightbox(u.url)}>
                      <img className="chart-card__img" src={u.url} alt={u.filename} loading="lazy" />
                      <div className="chart-card__foot"><span className="chart-card__kind">{u.kind}</span><span className="chart-card__name">{u.filename}</span></div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
            {files.length > 0 && (
              <Card idx="04" eyebrow="ATTACHMENTS" title="Files" className="s3" style={{ marginBottom: 22 }}>
                {files.map(u => (
                  <div key={u.id} className="row" style={{ padding: '8px 0', borderBottom: '1px solid var(--hairline)' }}>
                    <span className="chart-card__kind">{u.kind}</span>
                    <span style={{ fontSize: 12.5 }}>{u.filename}</span>
                    <a href={u.url} target="_blank" rel="noopener noreferrer" className="v" style={{ display: 'inline-flex' }}><ArrowUpRight size={13} /></a>
                  </div>
                ))}
              </Card>
            )}
            {bundle?.trade_rows?.length > 0 && (
              <Card idx="05" eyebrow="EXECUTION LEDGER" title="Trade Rows" className="s4">
                <div className="trade-table-wrap"><TradeTable rows={bundle.trade_rows.slice(0, 30)} /></div>
              </Card>
            )}
          </>
        ) : <Empty icon={BarChart3}>Save the day first, then upload charts.</Empty>
      )}

      {/* ── INTELLIGENCE ── */}
      {detailTab === 'intel' && day && (
        <>
          {day.execution_score != null && (
            <Card idx="02" eyebrow="AI REVIEW" title="Execution Score" className="s1" style={{ marginBottom: 22 }}>
              <div className="gauge-wrap">
                <Gauge score={day.execution_score} />
                <div className="meters">
                  <Meter label="Bias accuracy" value={day.bias_score} delay={0.4} />
                  <Meter label="Patience" value={day.patience_score} delay={0.5} />
                  <Meter label="Entry quality" value={day.entry_score} delay={0.6} />
                  <Meter label="Risk mgmt" value={day.risk_mgmt_score} delay={0.7} />
                  <Meter label="Profit taking" value={day.profit_taking_score} delay={0.8} />
                </div>
              </div>
              {(day.biggest_strength || day.biggest_mistake) && (
                <div className="exec-notes">
                  {day.biggest_strength && <Verdict tone="good" label="Strength" style={{ marginTop: 0 }}>{day.biggest_strength}</Verdict>}
                  {day.biggest_mistake && <Verdict label="Biggest Leak" style={{ marginTop: 0 }}>{day.biggest_mistake}</Verdict>}
                </div>
              )}
            </Card>
          )}

          {(day.gap_direction || day.premarket_trend) && (
            <Card idx="03" eyebrow="PRE-MARKET READ" title="Premarket Analysis" className="s2" style={{ marginBottom: 22 }}>
              <div className="intel-grid">
                {day.gap_direction && <div className="intel-item"><span className="intel-item__key">gap</span><span className="intel-item__val">{day.gap_direction}</span></div>}
                {day.premarket_trend && <div className="intel-item"><span className="intel-item__key">trend</span><span className="intel-item__val">{day.premarket_trend}</span></div>}
                {day.volume_assessment && <div className="intel-item"><span className="intel-item__key">volume</span><span className="intel-item__val">{day.volume_assessment}</span></div>}
                {day.key_levels && <div className="intel-item"><span className="intel-item__key">key levels</span><span className="intel-item__val">{day.key_levels}</span></div>}
              </div>
            </Card>
          )}

          {(day.ai_summary || day.ai_market_structure || day.ai_execution_review || bundle?.patterns?.length > 0) && (
            <Card idx="04" eyebrow="AI ANALYSIS" title="Deep Review" className="s3" style={{ marginBottom: 22 }}>
              {day.ai_summary && <Verdict tone="volt" label="AI Summary" style={{ marginTop: 0 }}>{day.ai_summary}</Verdict>}
              <IntelPanel label="Market Structure" data={day.ai_market_structure} />
              <IntelPanel label="Execution Review" data={day.ai_execution_review} />
              {bundle?.patterns?.length > 0 && (
                <>
                  <div className="subhead">Detected Patterns</div>
                  <div className="chip-list">
                    {bundle.patterns.map(p => (
                      <span className="chip" key={p.id}>
                        {p.name}
                        {p.confidence != null && <span className="v">{Math.round(p.confidence * 100)}%</span>}
                        {p.win_rate != null && <span className={pnlC(p.win_rate - 0.5)}>{pct(p.win_rate)} WR</span>}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </Card>
          )}

          {!day.ai_summary && day.execution_score == null && <Empty icon={Brain}>Click "Intelligence" to analyze this day.</Empty>}
        </>
      )}

      {/* ── SIMILAR ── */}
      {detailTab === 'similar' && (
        bundle?.similar?.length > 0
          ? <Card idx="02" eyebrow="HISTORICAL MATCH" title="Similar Days" className="s1"><SimilarList items={bundle.similar} onOpenDay={openDay} idKey="matched_day_id" scoreKey="similarity_score" /></Card>
          : <Empty icon={Link2}>No similar days found. Upload a premarket chart or run intelligence first.</Empty>
      )}

      {/* ── ANALYSES ── */}
      {detailTab === 'analyses' && selected && <DayAnalysesTab dayId={selected} onOpenDay={openDay} setStatus={setStatus} />}
    </>
  );
}
