import React, { useEffect, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Upload, Brain, Link2, Save, Search, Plus, ChevronRight, Sparkles, FileText, BarChart3, Tag, X, Loader2, ArrowUpRight, Trash2, TrendingUp, TrendingDown, Filter, Activity } from 'lucide-react';
import './style.css';

const API = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

async function api(path, opts = {}) {
  const r = await fetch(API + path, {
    headers: opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!r.ok) {
    let msg = `Request failed (${r.status})`;
    try { const body = await r.json(); msg = body.detail || JSON.stringify(body); } catch { try { msg = await r.text(); } catch {} }
    throw new Error(msg);
  }
  return r.json();
}

function formatDate(d) {
  if (!d) return '';
  const date = new Date(d + 'T00:00:00');
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function pnlClass(v) { return v > 0 ? 'positive' : v < 0 ? 'negative' : ''; }
function pnlStr(v) { if (v == null) return '—'; return (v >= 0 ? '+' : '') + v.toFixed(2); }

function StatusToast({ status, onClear }) {
  if (!status) return null;
  const isError = status.toLowerCase().includes('fail') || status.toLowerCase().includes('error');
  const isLoading = status.includes('...');
  return (
    <div className={`toast ${isError ? 'toast--error' : isLoading ? 'toast--loading' : 'toast--success'}`}>
      {isLoading && <Loader2 size={14} className="spin" />}
      <span>{status}</span>
      {!isLoading && <button className="toast__close" onClick={onClear}><X size={12} /></button>}
    </div>
  );
}

function Field({ label, value, onChange, textarea, type = 'text', placeholder }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {textarea
        ? <textarea className="field__input" value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
        : <input className="field__input" type={type} value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
      }
    </label>
  );
}

function UploadSlot({ kind, onUpload }) {
  const ref = useRef();
  const labels = { premarket: 'Premarket Chart', trade: 'Trade Screenshot', ideal: 'Ideal Setup', csv: 'Trade CSV', other: 'Other File' };
  return (
    <button className="upload-slot" onClick={() => ref.current?.click()}>
      <Upload size={16} />
      <span>{labels[kind] || kind}</span>
      <input ref={ref} type="file" hidden accept={kind === 'csv' ? '.csv' : 'image/*,.csv'} onChange={e => { onUpload(kind, e.target.files[0]); e.target.value = ''; }} />
    </button>
  );
}

/* ── Score bar ────────────────────────────── */
function ScoreBar({ label, value, max = 10 }) {
  if (value == null) return null;
  const pct = Math.min((value / max) * 100, 100);
  const color = pct >= 70 ? 'var(--green)' : pct >= 40 ? 'var(--amber)' : 'var(--red)';
  return (
    <div className="score-bar">
      <div className="score-bar__head">
        <span className="score-bar__label">{label}</span>
        <span className="score-bar__val">{value}/{max}</span>
      </div>
      <div className="score-bar__track"><div className="score-bar__fill" style={{ width: pct + '%', background: color }} /></div>
    </div>
  );
}

/* ── Metric card ─────────────────────────── */
function Metric({ label, value, sub, className = '' }) {
  return (
    <div className={`metric ${className}`}>
      <span className="metric__label">{label}</span>
      <span className="metric__value">{value}</span>
      {sub && <span className="metric__sub">{sub}</span>}
    </div>
  );
}

/* ── Intel panel ─────────────────────────── */
function IntelPanel({ label, data }) {
  if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) return null;
  const entries = typeof data === 'object' ? Object.entries(data) : [];
  return (
    <div className="intel-block">
      <h4 className="intel-block__title">{label}</h4>
      {typeof data === 'string' ? <p className="intel-block__text">{data}</p> : (
        <div className="intel-block__grid">
          {entries.map(([k, v]) => (
            <div key={k} className="intel-block__item">
              <span className="intel-block__key">{k.replace(/_/g, ' ')}</span>
              <span className="intel-block__val">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Main App ────────────────────────────── */
function App() {
  const [days, setDays] = useState([]);
  const [selected, setSelected] = useState(null);
  const [bundle, setBundle] = useState(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [tab, setTab] = useState('journal');
  const [draft, setDraft] = useState(emptyDraft());
  const [queryResult, setQueryResult] = useState(null);
  const [queryFilters, setQueryFilters] = useState({ pattern: '', outcome: '', ticker: '', pnl_min: '', pnl_max: '', min_score: '', sort: 'date' });

  function emptyDraft() {
    return { trade_date: new Date().toISOString().slice(0, 10), title: '', tickers: '', strategy: '', session: '', market_bias: '', premarket_notes: '', trade_notes: '', ideal_notes: '', lessons: '', tags: '', mood: '', pnl: null, num_trades: null, win_count: null, loss_count: null };
  }

  const load = async () => { try { setDays(await api('/days' + (q ? `?q=${encodeURIComponent(q)}` : ''))); } catch (e) { setStatus('Error loading days: ' + e.message); } };
  const openDay = async (id) => { try { setSelected(id); const b = await api('/days/' + id); setBundle(b); setDraft(b.day); } catch (e) { setStatus('Error opening day: ' + e.message); } };
  useEffect(() => { load(); }, []);

  const save = async () => {
    try {
      setStatus('Saving...');
      const row = selected ? await api('/days/' + selected, { method: 'PUT', body: JSON.stringify(draft) }) : await api('/days', { method: 'POST', body: JSON.stringify(draft) });
      setSelected(row.id); await openDay(row.id); await load(); setStatus('Saved');
    } catch (e) { setStatus('Save failed: ' + e.message); }
  };

  const upload = async (kind, file) => {
    if (!file || !selected) return;
    try {
      setStatus('Uploading...');
      const fd = new FormData(); fd.append('kind', kind); fd.append('file', file); fd.append('run_ai', 'true');
      await api(`/days/${selected}/upload`, { method: 'POST', body: fd }); await openDay(selected); setStatus('Uploaded');
    } catch (e) { setStatus('Upload failed: ' + e.message); }
  };

  const intelligence = async () => {
    try { setStatus('Running intelligence...'); await api(`/days/${selected}/intelligence`, { method: 'POST', body: JSON.stringify({}) }); await openDay(selected); await load(); setStatus('Intelligence complete'); }
    catch (e) { setStatus('Intelligence failed: ' + e.message); }
  };

  const similar = async () => {
    try { setStatus('Finding similar days...'); await api(`/days/${selected}/find-similar?limit=10`, { method: 'POST', body: JSON.stringify({}) }); await openDay(selected); setStatus('Similar days linked'); }
    catch (e) { setStatus('Similar search failed: ' + e.message); }
  };

  const deleteDay = async () => {
    if (!selected || !confirm('Delete this day and all its uploads, trades, and intelligence? This cannot be undone.')) return;
    try {
      setStatus('Deleting...');
      await api(`/days/${selected}`, { method: 'DELETE' });
      setSelected(null); setBundle(null); setDraft(emptyDraft()); await load(); setStatus('Deleted');
    } catch (e) { setStatus('Delete failed: ' + e.message); }
  };

  const runQuery = async () => {
    try {
      setStatus('Querying...');
      const params = new URLSearchParams();
      if (queryFilters.pattern) params.set('pattern', queryFilters.pattern);
      if (queryFilters.outcome) params.set('outcome', queryFilters.outcome);
      if (queryFilters.ticker) params.set('ticker', queryFilters.ticker);
      if (queryFilters.pnl_min) params.set('pnl_min', queryFilters.pnl_min);
      if (queryFilters.pnl_max) params.set('pnl_max', queryFilters.pnl_max);
      if (queryFilters.min_score) params.set('min_score', queryFilters.min_score);
      if (queryFilters.sort) params.set('sort', queryFilters.sort);
      const result = await api('/query?' + params.toString());
      setQueryResult(result);
      setStatus(`Found ${result.days.length} days`);
    } catch (e) { setStatus('Query failed: ' + e.message); }
  };

  const d = (k, v) => setDraft({ ...draft, [k]: v });
  const hasIntel = (day) => !!(day.ai_summary);
  const qf = (k, v) => setQueryFilters({ ...queryFilters, [k]: v });

  const tabs = [
    { id: 'journal', label: 'Journal', icon: FileText },
    { id: 'charts', label: 'Charts', icon: BarChart3 },
    { id: 'intel', label: 'Intelligence', icon: Sparkles },
    { id: 'query', label: 'Query', icon: Filter },
  ];

  const day = bundle?.day;

  return (
    <div className="app">
      {/* ── Sidebar ──────────────────── */}
      <aside className="sidebar">
        <div className="sidebar__head">
          <h1 className="logo">TID<span className="logo__dot">.</span></h1>
          <span className="logo__sub">Trading Intelligence</span>
        </div>

        <div className="sidebar__search">
          <Search size={14} className="sidebar__search-icon" />
          <input placeholder="Search days, tickers, tags…" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') load(); }} />
        </div>

        <button className="btn btn--new" onClick={() => { setSelected(null); setBundle(null); setDraft(emptyDraft()); setTab('journal'); }}>
          <Plus size={15} /> New Day
        </button>

        <div className="sidebar__list">
          {days.map(dy => (
            <button key={dy.id} className={`day-card ${selected === dy.id ? 'day-card--active' : ''}`} onClick={() => { openDay(dy.id); setTab('journal'); }}>
              <div className="day-card__top">
                <span className="day-card__date">{formatDate(dy.trade_date)}</span>
                <div className="day-card__badges">
                  {dy.pnl != null && <span className={`day-card__pnl ${pnlClass(dy.pnl)}`}>{pnlStr(dy.pnl)}</span>}
                  {hasIntel(dy) && <span className="day-card__intel" title="Intelligence complete"><Sparkles size={11} /></span>}
                </div>
              </div>
              <span className="day-card__ticker">{dy.tickers || dy.title || 'Untitled'}</span>
              {dy.ai_pattern_tags && <span className="day-card__tags"><Tag size={10} />{dy.ai_pattern_tags}</span>}
              {!dy.ai_pattern_tags && dy.tags && <span className="day-card__tags"><Tag size={10} />{dy.tags}</span>}
            </button>
          ))}
          {days.length === 0 && <p className="sidebar__empty">No days logged yet</p>}
        </div>
      </aside>

      {/* ── Main ─────────────────────── */}
      <main className="main">
        <div className="main__toolbar">
          <div className="tab-bar">
            {tabs.map(t => (
              <button key={t.id} className={`tab ${tab === t.id ? 'tab--active' : ''}`} onClick={() => setTab(t.id)}>
                <t.icon size={14} />{t.label}
              </button>
            ))}
          </div>
          <div className="main__actions">
            {tab !== 'query' && <button className="btn btn--primary" onClick={save}><Save size={14} /> Save</button>}
            {selected && tab !== 'query' && <button className="btn btn--accent" onClick={intelligence}><Brain size={14} /> Run Intelligence</button>}
            {selected && tab !== 'query' && <button className="btn btn--ghost" onClick={similar}><Link2 size={14} /> Find Similar</button>}
            {selected && tab !== 'query' && <button className="btn btn--danger" onClick={deleteDay}><Trash2 size={14} /></button>}
          </div>
        </div>

        {/* ── Journal Tab ────────────── */}
        {tab === 'journal' && (
          <div className="panel journal-panel">
            <section className="section">
              <h3 className="section__title">Session Context</h3>
              <div className="field-grid field-grid--3">
                <Field label="Date" type="date" value={draft.trade_date} onChange={v => d('trade_date', v)} />
                <Field label="Tickers" value={draft.tickers} onChange={v => d('tickers', v)} placeholder="MNQ, ES, NQ…" />
                <Field label="Strategy" value={draft.strategy} onChange={v => d('strategy', v)} placeholder="SSMT, ORB, breakout…" />
              </div>
              <div className="field-grid field-grid--3">
                <Field label="Session" value={draft.session} onChange={v => d('session', v)} placeholder="London, NY AM, NY PM…" />
                <Field label="Mood" value={draft.mood} onChange={v => d('mood', v)} placeholder="Focused, anxious, confident…" />
                <Field label="Title" value={draft.title} onChange={v => d('title', v)} placeholder="Short label for this day" />
              </div>
            </section>

            {/* Performance metrics row */}
            <section className="section">
              <h3 className="section__title">Performance</h3>
              <div className="field-grid field-grid--4">
                <Field label="P&L ($)" type="number" value={draft.pnl} onChange={v => d('pnl', v ? parseFloat(v) : null)} placeholder="0.00" />
                <Field label="# Trades" type="number" value={draft.num_trades} onChange={v => d('num_trades', v ? parseInt(v) : null)} placeholder="0" />
                <Field label="Wins" type="number" value={draft.win_count} onChange={v => d('win_count', v ? parseInt(v) : null)} placeholder="0" />
                <Field label="Losses" type="number" value={draft.loss_count} onChange={v => d('loss_count', v ? parseInt(v) : null)} placeholder="0" />
              </div>
              <p className="field-hint">These auto-fill when you upload a trade CSV with P&L data.</p>
            </section>

            <section className="section">
              <h3 className="section__title">Pre-Market</h3>
              <Field label="Market Bias" textarea value={draft.market_bias} onChange={v => d('market_bias', v)} placeholder="Directional bias and reasoning before the session…" />
              <Field label="Premarket Notes" textarea value={draft.premarket_notes} onChange={v => d('premarket_notes', v)} placeholder="Key levels, overnight context, news catalysts…" />
            </section>

            <section className="section">
              <h3 className="section__title">Trade Notes</h3>
              <Field label="Trades Taken" textarea value={draft.trade_notes} onChange={v => d('trade_notes', v)} placeholder="What you actually did — entries, exits, sizing…" />
              <Field label="Ideal Trades" textarea value={draft.ideal_notes} onChange={v => d('ideal_notes', v)} placeholder="What you should have done — missed setups, better exits…" />
            </section>

            <section className="section">
              <h3 className="section__title">Review</h3>
              <Field label="Lessons" textarea value={draft.lessons} onChange={v => d('lessons', v)} placeholder="What to carry forward from this session…" />
              <Field label="Tags" value={draft.tags} onChange={v => d('tags', v)} placeholder="revenge-trade, A-setup, chop, trend-day…" />
            </section>
          </div>
        )}

        {/* ── Charts Tab ────────────── */}
        {tab === 'charts' && (
          <div className="panel charts-panel">
            {selected ? (
              <>
                <section className="section">
                  <h3 className="section__title">Upload Charts & Data</h3>
                  <div className="upload-grid">
                    {['premarket', 'trade', 'ideal', 'csv', 'other'].map(k => (
                      <UploadSlot key={k} kind={k} onUpload={upload} />
                    ))}
                  </div>
                </section>
                {bundle && bundle.uploads.length > 0 && (
                  <section className="section">
                    <h3 className="section__title">Uploaded Files</h3>
                    <div className="file-list">
                      {bundle.uploads.map(u => (
                        <div className="file-card" key={u.id}>
                          <div className="file-card__head">
                            <span className="file-card__kind">{u.kind}</span>
                            <span className="file-card__name">{u.filename}</span>
                            <a className="file-card__link" href={u.url} target="_blank" rel="noopener noreferrer"><ArrowUpRight size={13} /></a>
                          </div>
                          {u.ai_description && <p className="file-card__ai">{typeof u.ai_description === 'string' ? u.ai_description.slice(0, 300) : ''}</p>}
                        </div>
                      ))}
                    </div>
                  </section>
                )}
                {bundle && bundle.trade_rows.length > 0 && (
                  <section className="section">
                    <h3 className="section__title">Trade Rows</h3>
                    <div className="trade-table-wrap"><TradeTable rows={bundle.trade_rows.slice(0, 30)} /></div>
                  </section>
                )}
              </>
            ) : (
              <div className="empty-state"><BarChart3 size={32} /><p>Save a day first, then upload charts and trade data here.</p></div>
            )}
          </div>
        )}

        {/* ── Intelligence Tab ───────── */}
        {tab === 'intel' && (
          <div className="panel intel-panel">
            {bundle ? (
              <>
                {/* Execution score card */}
                {day?.execution_score != null && (
                  <section className="section">
                    <h3 className="section__title">Execution Grade</h3>
                    <div className="exec-card">
                      <div className="exec-card__score">
                        <span className="exec-card__number">{Math.round(day.execution_score)}</span>
                        <span className="exec-card__label">overall</span>
                      </div>
                      <div className="exec-card__bars">
                        <ScoreBar label="Bias" value={day.bias_score} />
                        <ScoreBar label="Patience" value={day.patience_score} />
                        <ScoreBar label="Entry" value={day.entry_score} />
                        <ScoreBar label="Risk Management" value={day.risk_mgmt_score} />
                        <ScoreBar label="Profit Taking" value={day.profit_taking_score} />
                      </div>
                    </div>
                    {(day.biggest_mistake || day.biggest_strength) && (
                      <div className="exec-notes">
                        {day.biggest_strength && <div className="exec-note exec-note--green"><TrendingUp size={14} /><div><span className="exec-note__label">Strength</span><p>{day.biggest_strength}</p></div></div>}
                        {day.biggest_mistake && <div className="exec-note exec-note--red"><TrendingDown size={14} /><div><span className="exec-note__label">Mistake</span><p>{day.biggest_mistake}</p></div></div>}
                      </div>
                    )}
                  </section>
                )}

                {/* Performance metrics */}
                {day?.pnl != null && (
                  <section className="section">
                    <h3 className="section__title">Performance</h3>
                    <div className="metric-grid">
                      <Metric label="P&L" value={pnlStr(day.pnl)} className={pnlClass(day.pnl)} />
                      <Metric label="Trades" value={day.num_trades ?? '—'} />
                      <Metric label="Wins" value={day.win_count ?? '—'} />
                      <Metric label="Losses" value={day.loss_count ?? '—'} />
                    </div>
                  </section>
                )}

                {/* Premarket intel */}
                {(day?.gap_direction || day?.premarket_trend) && (
                  <section className="section">
                    <h3 className="section__title">Premarket Analysis</h3>
                    <div className="intel-block__grid">
                      {day.gap_direction && <div className="intel-block__item"><span className="intel-block__key">gap direction</span><span className="intel-block__val">{day.gap_direction}</span></div>}
                      {day.premarket_trend && <div className="intel-block__item"><span className="intel-block__key">premarket trend</span><span className="intel-block__val">{day.premarket_trend}</span></div>}
                      {day.volume_assessment && <div className="intel-block__item"><span className="intel-block__key">volume</span><span className="intel-block__val">{day.volume_assessment}</span></div>}
                      {day.key_levels && <div className="intel-block__item"><span className="intel-block__key">key levels</span><span className="intel-block__val">{day.key_levels}</span></div>}
                      {day.likely_scenarios && <div className="intel-block__item"><span className="intel-block__key">likely scenarios</span><span className="intel-block__val">{day.likely_scenarios}</span></div>}
                    </div>
                  </section>
                )}

                {/* AI Summary */}
                <section className="section">
                  <h3 className="section__title">AI Analysis</h3>
                  {day?.ai_summary ? (
                    <div className="intel-summary"><p>{day.ai_summary}</p></div>
                  ) : (
                    <div className="empty-state empty-state--compact"><Brain size={24} /><p>No analysis yet. Click "Run Intelligence" to generate insights.</p></div>
                  )}
                </section>

                <IntelPanel label="Market Structure" data={day?.ai_market_structure} />
                <IntelPanel label="Execution Review" data={day?.ai_execution_review} />

                {/* Pattern tags */}
                {bundle.patterns.length > 0 && (
                  <section className="section">
                    <h3 className="section__title">Detected Patterns</h3>
                    <div className="pattern-list">
                      {bundle.patterns.map(p => (
                        <div className="pattern-chip" key={p.id}>
                          <span className="pattern-chip__name">{p.name}</span>
                          {p.confidence != null && <span className="pattern-chip__conf">{Math.round(p.confidence * 100)}%</span>}
                          {p.sample_count > 0 && <span className="pattern-chip__count">{p.sample_count} days</span>}
                          {p.win_rate != null && <span className={`pattern-chip__wr ${pnlClass(p.win_rate - 0.5)}`}>{Math.round(p.win_rate * 100)}% WR</span>}
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Similar days */}
                {bundle.similar.length > 0 && (
                  <section className="section">
                    <h3 className="section__title">Similar Days</h3>
                    <div className="similar-list">
                      {bundle.similar.map(s => (
                        <button className="similar-card" key={s.id} onClick={() => { openDay(s.matched_day_id); setTab('journal'); }}>
                          <div className="similar-card__top">
                            <span className="similar-card__date">{formatDate(s.trade_date)}</span>
                            <span className="similar-card__score">{Math.round((s.similarity_score || 0) * 100)}%</span>
                          </div>
                          <span className="similar-card__ticker">{s.tickers} {s.title}</span>
                          <div className="similar-card__meta">
                            {s.pnl != null && <span className={pnlClass(s.pnl)}>{pnlStr(s.pnl)}</span>}
                            {s.ai_pattern_tags && <span className="similar-card__pats">{s.ai_pattern_tags}</span>}
                          </div>
                          <ChevronRight size={14} className="similar-card__arrow" />
                        </button>
                      ))}
                    </div>
                  </section>
                )}
              </>
            ) : (
              <div className="empty-state"><Sparkles size={32} /><p>Select or create a day to view intelligence.</p></div>
            )}
          </div>
        )}

        {/* ── Query Tab ──────────────── */}
        {tab === 'query' && (
          <div className="panel query-panel">
            <section className="section">
              <h3 className="section__title">Filter Your History</h3>
              <div className="field-grid field-grid--3">
                <label className="field">
                  <span className="field__label">Pattern</span>
                  <select className="field__input" value={queryFilters.pattern} onChange={e => qf('pattern', e.target.value)}>
                    <option value="">All patterns</option>
                    {['Gap and Go','VWAP Reclaim','Failed Breakout','Opening Range Breakout','Opening Range Breakdown','Trend Day','Reversal Day','Chop Day','Liquidity Sweep','CISD','Power of 3','FVG Entry'].map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span className="field__label">Outcome</span>
                  <select className="field__input" value={queryFilters.outcome} onChange={e => qf('outcome', e.target.value)}>
                    <option value="">All</option>
                    <option value="win">Winners</option>
                    <option value="loss">Losers</option>
                  </select>
                </label>
                <Field label="Ticker" value={queryFilters.ticker} onChange={v => qf('ticker', v)} placeholder="MNQ, ES…" />
              </div>
              <div className="field-grid field-grid--4">
                <Field label="Min P&L" type="number" value={queryFilters.pnl_min} onChange={v => qf('pnl_min', v)} placeholder="-500" />
                <Field label="Max P&L" type="number" value={queryFilters.pnl_max} onChange={v => qf('pnl_max', v)} placeholder="500" />
                <Field label="Min Score" type="number" value={queryFilters.min_score} onChange={v => qf('min_score', v)} placeholder="70" />
                <label className="field">
                  <span className="field__label">Sort by</span>
                  <select className="field__input" value={queryFilters.sort} onChange={e => qf('sort', e.target.value)}>
                    <option value="date">Date</option>
                    <option value="pnl">Best P&L</option>
                    <option value="pnl_asc">Worst P&L</option>
                    <option value="score">Best Score</option>
                  </select>
                </label>
              </div>
              <div style={{ marginTop: 12 }}>
                <button className="btn btn--accent" onClick={runQuery}><Filter size={14} /> Run Query</button>
              </div>
            </section>

            {queryResult && (
              <>
                <section className="section">
                  <h3 className="section__title">Results — {queryResult.stats.total} days</h3>
                  <div className="metric-grid">
                    <Metric label="Total P&L" value={queryResult.stats.total_pnl != null ? pnlStr(queryResult.stats.total_pnl) : '—'} className={pnlClass(queryResult.stats.total_pnl)} />
                    <Metric label="Avg P&L" value={queryResult.stats.avg_pnl != null ? pnlStr(queryResult.stats.avg_pnl) : '—'} className={pnlClass(queryResult.stats.avg_pnl)} />
                    <Metric label="Win Rate" value={queryResult.stats.win_rate != null ? Math.round(queryResult.stats.win_rate * 100) + '%' : '—'} />
                    <Metric label="Avg Score" value={queryResult.stats.avg_score != null ? Math.round(queryResult.stats.avg_score) : '—'} />
                  </div>
                </section>

                <section className="section">
                  <div className="query-results">
                    {queryResult.days.map(qd => (
                      <button className="query-row" key={qd.id} onClick={() => { setSelected(qd.id); openDay(qd.id); setTab('intel'); }}>
                        <span className="query-row__date">{formatDate(qd.trade_date)}</span>
                        <span className="query-row__ticker">{qd.tickers || qd.title || 'Untitled'}</span>
                        <span className="query-row__tags">{qd.ai_pattern_tags || qd.tags || ''}</span>
                        <span className={`query-row__pnl ${pnlClass(qd.pnl)}`}>{qd.pnl != null ? pnlStr(qd.pnl) : '—'}</span>
                        <span className="query-row__score">{qd.execution_score != null ? Math.round(qd.execution_score) : '—'}</span>
                        <ChevronRight size={14} className="query-row__arrow" />
                      </button>
                    ))}
                    {queryResult.days.length === 0 && <p className="sidebar__empty">No days match these filters.</p>}
                  </div>
                </section>
              </>
            )}
          </div>
        )}
      </main>

      <StatusToast status={status} onClear={() => setStatus('')} />
    </div>
  );
}

function TradeTable({ rows }) {
  if (!rows.length) return null;
  const allKeys = [...new Set(rows.flatMap(r => Object.keys(r.row_data || {})))];
  if (!allKeys.length) return <pre className="code-block">{JSON.stringify(rows, null, 2)}</pre>;
  return (
    <table className="trade-table">
      <thead><tr>{allKeys.map(k => <th key={k}>{k}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={r.id || i}>{allKeys.map(k => <td key={k}>{String(r.row_data?.[k] ?? '')}</td>)}</tr>)}</tbody>
    </table>
  );
}

createRoot(document.getElementById('root')).render(<App />);
