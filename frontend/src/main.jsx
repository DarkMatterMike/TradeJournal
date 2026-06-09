import React, { useEffect, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Upload, Brain, Link2, Save, Search, Plus, ChevronRight, ChevronLeft, Sparkles, FileText, BarChart3, Tag, X, Loader2, ArrowUpRight, Trash2, TrendingUp, TrendingDown, Filter, Home, Calendar, Layers, Activity, Zap, Pencil, Check } from 'lucide-react';
import './style.css';

const API = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

async function api(path, opts = {}) {
  const r = await fetch(API + path, { headers: opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }, ...opts });
  if (!r.ok) { let msg = `Request failed (${r.status})`; try { const b = await r.json(); msg = b.detail || JSON.stringify(b); } catch { try { msg = await r.text(); } catch {} } throw new Error(msg); }
  return r.json();
}

const fmt = d => { if (!d) return ''; const dt = new Date(d + 'T00:00:00'); return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); };
const pnlC = v => v > 0 ? 'positive' : v < 0 ? 'negative' : '';
const pnl$ = v => { if (v == null) return '—'; return (v >= 0 ? '+$' : '-$') + Math.abs(v).toFixed(2); };
const pct = v => v != null ? Math.round(v * 100) + '%' : '—';

function Toast({ status, onClear }) {
  if (!status) return null;
  const err = status.toLowerCase().includes('fail') || status.toLowerCase().includes('error');
  const loading = status.includes('...');
  return <div className={`toast ${err ? 'toast--error' : loading ? 'toast--loading' : 'toast--success'}`}>{loading && <Loader2 size={14} className="spin" />}<span>{status}</span>{!loading && <button className="toast__close" onClick={onClear}><X size={12} /></button>}</div>;
}
function Field({ label, value, onChange, textarea, type = 'text', placeholder }) {
  return <label className="field"><span className="field__label">{label}</span>{textarea ? <textarea className="field__input" value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} /> : <input className="field__input" type={type} value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} />}</label>;
}
function ScoreBar({ label, value, max = 10 }) {
  if (value == null) return null;
  const p = Math.min((value / max) * 100, 100);
  const c = p >= 70 ? 'var(--green)' : p >= 40 ? 'var(--amber)' : 'var(--red)';
  return <div><div className="score-bar__head"><span className="score-bar__label">{label}</span><span className="score-bar__val">{value}/{max}</span></div><div className="score-bar__track"><div className="score-bar__fill" style={{ width: p + '%', background: c }} /></div></div>;
}
function IntelPanel({ label, data }) {
  if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) return null;
  const entries = typeof data === 'object' ? Object.entries(data) : [];
  return <div className="intel-block"><h4 className="intel-block__title">{label}</h4>{typeof data === 'string' ? <p>{data}</p> : <div className="intel-block__grid">{entries.map(([k, v]) => <div key={k} className="intel-block__item"><span className="intel-block__key">{k.replace(/_/g, ' ')}</span><span className="intel-block__val">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span></div>)}</div>}</div>;
}
function UploadSlot({ kind, onUpload }) {
  const ref = useRef();
  const labels = { premarket: 'Premarket', trade: 'Trade', ideal: 'Ideal Setup', postmarket: 'Post-Market', csv: 'Trade CSV', other: 'Other' };
  return <button className="upload-slot" onClick={() => ref.current?.click()}><Upload size={16} /><span>{labels[kind]}</span><input ref={ref} type="file" hidden accept={kind === 'csv' ? '.csv' : 'image/*,.csv'} onChange={e => { onUpload(kind, e.target.files[0]); e.target.value = ''; }} /></button>;
}

function App() {
  const [page, setPage] = useState('dashboard');
  const [days, setDays] = useState([]);
  const [stats, setStats] = useState(null);
  const [patterns, setPatterns] = useState([]);
  const [selected, setSelected] = useState(null);
  const [bundle, setBundle] = useState(null);
  const [draft, setDraft] = useState(emptyDraft());
  const [detailTab, setDetailTab] = useState('overview');
  const [status, setStatus] = useState('');
  const [lightbox, setLightbox] = useState(null);
  const [queryFilters, setQueryFilters] = useState({ pattern: '', outcome: '', ticker: '', sort: 'date' });
  const [queryResult, setQueryResult] = useState(null);
  const [q, setQ] = useState('');
  const [analyzeResult, setAnalyzeResult] = useState(null);
  const [editingPattern, setEditingPattern] = useState(null);
  const [patternDraft, setPatternDraft] = useState({});

  function emptyDraft() { return { trade_date: new Date().toISOString().slice(0, 10), title: '', tickers: '', strategy: '', session: '', market_bias: '', premarket_notes: '', trade_notes: '', ideal_notes: '', lessons: '', tags: '', mood: '', pnl: null, num_trades: null, win_count: null, loss_count: null }; }
  const d = (k, v) => setDraft({ ...draft, [k]: v });
  const qf = (k, v) => setQueryFilters({ ...queryFilters, [k]: v });

  const load = async () => { try { setDays(await api('/days' + (q ? `?q=${encodeURIComponent(q)}` : ''))); } catch (e) { setStatus('Error: ' + e.message); } };
  const loadStats = async () => { try { setStats(await api('/stats')); } catch {} };
  const loadPatterns = async () => { try { setPatterns(await api('/patterns')); } catch {} };
  const openDay = async (id) => { try { setSelected(id); const b = await api('/days/' + id); setBundle(b); setDraft(b.day); setPage('detail'); setDetailTab('overview'); } catch (e) { setStatus('Error: ' + e.message); } };

  useEffect(() => { load(); loadStats(); loadPatterns(); }, []);

  const save = async () => { try { setStatus('Saving...'); const row = selected ? await api('/days/' + selected, { method: 'PUT', body: JSON.stringify(draft) }) : await api('/days', { method: 'POST', body: JSON.stringify(draft) }); setSelected(row.id); await openDay(row.id); await load(); await loadStats(); setStatus('Saved'); } catch (e) { setStatus('Save failed: ' + e.message); } };

  const upload = async (kind, file) => {
    if (!file || !selected) return;
    try {
      setStatus('Uploading & analyzing...');
      const fd = new FormData(); fd.append('kind', kind); fd.append('file', file); fd.append('run_ai', 'true');
      const result = await api(`/days/${selected}/upload`, { method: 'POST', body: fd });
      await openDay(selected);
      if (result.similar_days?.length > 0) { setStatus(`Uploaded — found ${result.similar_days.length} similar days`); setDetailTab('similar'); }
      else { setStatus('Uploaded'); }
    } catch (e) { setStatus('Upload failed: ' + e.message); }
  };

  const intelligence = async () => { try { setStatus('Running intelligence...'); await api(`/days/${selected}/intelligence`, { method: 'POST', body: JSON.stringify({}) }); await openDay(selected); await load(); await loadStats(); await loadPatterns(); setStatus('Intelligence complete'); } catch (e) { setStatus('Failed: ' + e.message); } };
  const findSimilar = async () => { try { setStatus('Finding similar days...'); await api(`/days/${selected}/find-similar?limit=10`, { method: 'POST', body: JSON.stringify({}) }); await openDay(selected); setDetailTab('similar'); setStatus('Done'); } catch (e) { setStatus('Failed: ' + e.message); } };
  const deleteDay = async () => { if (!selected || !confirm('Delete this day and all data?')) return; try { await api(`/days/${selected}`, { method: 'DELETE' }); setSelected(null); setBundle(null); setPage('days'); await load(); await loadStats(); setStatus('Deleted'); } catch (e) { setStatus('Failed: ' + e.message); } };
  const runQuery = async () => { try { setStatus('Querying...'); const p = new URLSearchParams(); Object.entries(queryFilters).forEach(([k, v]) => { if (v) p.set(k, v); }); const r = await api('/query?' + p.toString()); setQueryResult(r); setStatus(`Found ${r.days.length} days`); } catch (e) { setStatus('Failed: ' + e.message); } };

  const analyzePremarket = async (file) => {
    if (!file) return;
    try {
      setStatus('Analyzing premarket...');
      setAnalyzeResult(null);
      const fd = new FormData(); fd.append('file', file);
      const result = await api('/analyze', { method: 'POST', body: fd });
      setAnalyzeResult(result);
      setStatus('Analysis complete');
    } catch (e) { setStatus('Analysis failed: ' + e.message); }
  };

  const savePattern = async (id) => {
    try {
      await api('/patterns/' + id, { method: 'PUT', body: JSON.stringify(patternDraft) });
      setEditingPattern(null); await loadPatterns(); setStatus('Pattern saved');
    } catch (e) { setStatus('Failed: ' + e.message); }
  };
  const deletePattern = async (id) => {
    if (!confirm('Delete this pattern?')) return;
    try { await api('/patterns/' + id, { method: 'DELETE' }); await loadPatterns(); setStatus('Pattern deleted'); } catch (e) { setStatus('Failed: ' + e.message); }
  };
  const createNewPattern = async () => {
    const name = prompt('Pattern name:');
    if (!name) return;
    try { await api('/patterns', { method: 'POST', body: JSON.stringify({ name, description: '' }) }); await loadPatterns(); setStatus('Pattern created'); } catch (e) { setStatus('Failed: ' + e.message); }
  };

  const newDay = () => { setSelected(null); setBundle(null); setDraft(emptyDraft()); setPage('detail'); setDetailTab('edit'); };
  const day = bundle?.day;
  const ov = stats?.overview || {};
  const images = (bundle?.uploads || []).filter(u => (u.content_type || '').startsWith('image/'));

  const navItems = [
    { id: 'dashboard', icon: Home, label: 'Dashboard' },
    { id: 'analyze', icon: Zap, label: 'Analyze' },
    { id: 'days', icon: Calendar, label: 'Trade Days' },
    { id: 'intel', icon: Sparkles, label: 'Intelligence' },
    { id: 'patterns', icon: Layers, label: 'Patterns' },
  ];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <div className="sidebar__logo"><span className="sidebar__logo-dot" /> Trading Intelligence</div>
          <div className="sidebar__sub">Pattern recognition system</div>
        </div>
        <nav className="sidebar__nav">
          {navItems.map(n => <button key={n.id} className={`nav-item ${(page === n.id || (page === 'detail' && n.id === 'days')) ? 'nav-item--active' : ''}`} onClick={() => { setPage(n.id); if (n.id === 'days') load(); if (n.id === 'dashboard') loadStats(); if (n.id === 'patterns') loadPatterns(); }}><n.icon size={18} />{n.label}</button>)}
        </nav>
        <div className="sidebar__foot">Neon + R2 + Railway</div>
      </aside>

      <div className="page">
        <div className="page__inner">

          {/* ── DASHBOARD ────────────── */}
          {page === 'dashboard' && <>
            <div className="page-header"><h1 className="page-header__title">Welcome back</h1><p className="page-header__sub">Your trading performance at a glance</p></div>
            <div className="stat-grid">
              <div className="stat-card"><div className="stat-card__label">Total P&L</div><div className={`stat-card__value ${pnlC(ov.total_pnl)}`}>{ov.total_pnl != null ? pnl$(ov.total_pnl) : '—'}</div></div>
              <div className="stat-card"><div className="stat-card__label">Win Rate</div><div className="stat-card__value">{pct(ov.win_rate)}</div>{ov.winning_days != null && <div className="stat-card__delta stat-card__delta--up">{ov.winning_days}W / {ov.losing_days}L</div>}</div>
              <div className="stat-card"><div className="stat-card__label">Avg Score</div><div className="stat-card__value">{ov.avg_score != null ? Math.round(ov.avg_score) : '—'}</div></div>
              <div className="stat-card"><div className="stat-card__label">Days Logged</div><div className="stat-card__value">{ov.total_days || 0}</div></div>
            </div>

            <div className="section">
              <div className="section__head"><span className="section__title">Recent Days</span><span className="section__link" onClick={() => setPage('days')}>View all</span></div>
              <div className="day-list">
                {(stats?.recent_days || []).map(dy => <button key={dy.id} className="day-row" onClick={() => openDay(dy.id)}><span className="day-row__date">{fmt(dy.trade_date)}</span><span className="day-row__ticker">{dy.tickers || dy.title || 'Untitled'}</span><span className="day-row__tags">{dy.ai_pattern_tags || dy.tags || ''}</span><span className={`day-row__pnl ${pnlC(dy.pnl)}`}>{dy.pnl != null ? pnl$(dy.pnl) : '—'}</span><span className="day-row__score">{dy.execution_score != null ? Math.round(dy.execution_score) : '—'}</span><ChevronRight size={14} className="day-row__arrow" /></button>)}
              </div>
            </div>

            {(stats?.top_patterns || []).length > 0 && <div className="section">
              <div className="section__head"><span className="section__title">Top Patterns</span><span className="section__link" onClick={() => setPage('patterns')}>View all</span></div>
              <table className="pattern-table"><thead><tr><th>Pattern</th><th>Days</th><th>Win Rate</th><th>Avg P&L</th></tr></thead><tbody>
                {stats.top_patterns.map(p => <tr key={p.name}><td style={{ fontWeight: 500 }}>{p.name}</td><td className="mono">{p.sample_count}</td><td className={`mono ${pnlC((p.win_rate || 0) - 0.5)}`}>{pct(p.win_rate)}</td><td className={`mono ${pnlC(p.avg_pnl)}`}>{p.avg_pnl != null ? pnl$(p.avg_pnl) : '—'}</td></tr>)}
              </tbody></table>
            </div>}
          </>}

          {/* ── ANALYZE ─────────────── */}
          {page === 'analyze' && <>
            <div className="page-header"><h1 className="page-header__title">Analyze Premarket</h1><p className="page-header__sub">Upload today's chart and get intelligence from your history</p></div>
            <div className="section">
              <div className="analyze-upload">
                <Zap size={28} />
                <p>Drop a premarket screenshot to analyze</p>
                <label className="btn btn--primary" style={{ cursor: 'pointer' }}>
                  <Upload size={14} /> Upload Screenshot
                  <input type="file" hidden accept="image/*" onChange={e => { analyzePremarket(e.target.files[0]); e.target.value = ''; }} />
                </label>
              </div>
            </div>

            {analyzeResult && <>
              {/* Recommendation card */}
              {analyzeResult.recommendation && <div className="section">
                <div className="analyze-rec">
                  <div className="analyze-rec__head">
                    <Brain size={20} />
                    <span>Trading AI Recommendation</span>
                  </div>
                  {analyzeResult.recommendation.times_seen > 0 && <p className="analyze-rec__seen">You've seen this structure <strong>{analyzeResult.recommendation.times_seen} times</strong>.</p>}
                  <div className="stat-grid" style={{ marginBottom: 16 }}>
                    <div className="stat-card"><div className="stat-card__label">Avg Result</div><div className={`stat-card__value ${pnlC(analyzeResult.stats?.avg_pnl)}`}>{analyzeResult.stats?.avg_pnl != null ? pnl$(analyzeResult.stats.avg_pnl) : '—'}</div></div>
                    <div className="stat-card"><div className="stat-card__label">Win Rate</div><div className="stat-card__value">{analyzeResult.stats?.win_rate != null ? pct(analyzeResult.stats.win_rate) : '—'}</div></div>
                    <div className="stat-card"><div className="stat-card__label">Risk Level</div><div className="stat-card__value" style={{ fontSize: 20, textTransform: 'capitalize' }}>{analyzeResult.recommendation.risk_level || '—'}</div></div>
                  </div>
                  {analyzeResult.recommendation.best_strategy && <div className="analyze-rec__row"><span className="analyze-rec__label">Best Strategy</span><p>{analyzeResult.recommendation.best_strategy}</p></div>}
                  {analyzeResult.recommendation.most_common_mistake && <div className="analyze-rec__row"><span className="analyze-rec__label">Common Mistake</span><p>{analyzeResult.recommendation.most_common_mistake}</p></div>}
                  {analyzeResult.recommendation.recommendation && <div className="analyze-rec__row analyze-rec__row--accent"><span className="analyze-rec__label">Recommendation</span><p>{analyzeResult.recommendation.recommendation}</p></div>}
                  {analyzeResult.recommendation.pattern_summary && <div className="analyze-rec__row"><span className="analyze-rec__label">Pattern</span><p>{analyzeResult.recommendation.pattern_summary}</p></div>}
                </div>
              </div>}

              {/* Chart analysis */}
              {analyzeResult.chart_analysis && <div className="section"><div className="section__head"><span className="section__title">Chart Analysis</span></div>
                <div className="intel-block__grid">
                  {analyzeResult.chart_analysis.gap_direction && <div className="intel-block__item"><span className="intel-block__key">gap</span><span className="intel-block__val">{analyzeResult.chart_analysis.gap_direction}</span></div>}
                  {analyzeResult.chart_analysis.premarket_trend && <div className="intel-block__item"><span className="intel-block__key">trend</span><span className="intel-block__val">{analyzeResult.chart_analysis.premarket_trend}</span></div>}
                  {analyzeResult.chart_analysis.directional_bias && <div className="intel-block__item"><span className="intel-block__key">bias</span><span className="intel-block__val">{analyzeResult.chart_analysis.directional_bias}</span></div>}
                  {analyzeResult.chart_analysis.volume_assessment && <div className="intel-block__item"><span className="intel-block__key">volume</span><span className="intel-block__val">{analyzeResult.chart_analysis.volume_assessment}</span></div>}
                </div>
                {analyzeResult.chart_analysis.summary && <div className="intel-summary" style={{ marginTop: 12 }}><p>{analyzeResult.chart_analysis.summary}</p></div>}
              </div>}

              {/* Similar days from analysis */}
              {analyzeResult.similar_days?.length > 0 && <div className="section"><div className="section__head"><span className="section__title">Similar Historical Days</span></div>
                <div className="similar-list">{analyzeResult.similar_days.map((s, i) => <button className="similar-card" key={i} onClick={() => { if (s.day_id) openDay(s.day_id); }}>
                  <div className="similar-card__top"><span className="similar-card__date">{fmt(s.trade_date)}</span><span className="similar-card__score">{Math.round((s.similarity || 0) * 100)}%</span></div>
                  <span className="similar-card__ticker">{s.tickers} {s.title}</span>
                  <div className="similar-card__meta">{s.pnl != null && <span className={pnlC(s.pnl)}>{pnl$(s.pnl)}</span>}{s.ai_pattern_tags && <span style={{ color: 'var(--text-3)' }}>{s.ai_pattern_tags}</span>}</div>
                  <ChevronRight size={14} className="similar-card__arrow" />
                </button>)}</div>
              </div>}
            </>}
          </>}

          {/* ── DAYS LIST ────────────── */}
          {page === 'days' && <>
            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div><h1 className="page-header__title">Trade Days</h1><p className="page-header__sub">{days.length} days logged</p></div>
              <button className="btn btn--primary" onClick={newDay}><Plus size={15} /> New Day</button>
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '0 12px' }}>
                <Search size={14} style={{ color: 'var(--text-3)' }} />
                <input style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', padding: '10px 0', color: 'var(--text-1)', fontSize: '13px' }} placeholder="Search days, tickers, tags…" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') load(); }} />
              </div>
              <button className="btn btn--secondary" onClick={load}>Search</button>
            </div>
            <div className="day-list">
              {days.map(dy => <button key={dy.id} className="day-row" onClick={() => openDay(dy.id)}><span className="day-row__date">{fmt(dy.trade_date)}</span><span className="day-row__ticker">{dy.tickers || dy.title || 'Untitled'}</span><span className="day-row__tags">{dy.ai_pattern_tags || dy.tags || ''}</span><span className={`day-row__pnl ${pnlC(dy.pnl)}`}>{dy.pnl != null ? pnl$(dy.pnl) : '—'}</span><span className="day-row__score">{dy.execution_score != null ? Math.round(dy.execution_score) : ''}</span><ChevronRight size={14} className="day-row__arrow" /></button>)}
              {days.length === 0 && <div className="empty-state"><Calendar size={32} /><p>No days logged yet. Click "New Day" to start.</p></div>}
            </div>
          </>}

          {/* ── DAY DETAIL ───────────── */}
          {page === 'detail' && <>
            <button className="detail-back" onClick={() => { setPage('days'); load(); }}><ChevronLeft size={16} /> Back to days</button>

            <div className="detail-header">
              <div className="detail-header__left">
                <div className="detail-header__date">{day ? fmt(day.trade_date) : 'New Day'}</div>
                <div className="detail-header__meta">
                  {day?.tickers && <span>{day.tickers}</span>}
                  {day?.strategy && <span>· {day.strategy}</span>}
                  {day?.pnl != null && <span className={pnlC(day.pnl)}>· {pnl$(day.pnl)}</span>}
                  {day?.execution_score != null && <span>· Score: {Math.round(day.execution_score)}</span>}
                </div>
              </div>
              <div className="detail-header__actions">
                <button className="btn btn--primary" onClick={save}><Save size={14} /> Save</button>
                {selected && <button className="btn btn--amber" onClick={intelligence}><Brain size={14} /> Intelligence</button>}
                {selected && <button className="btn btn--ghost" onClick={findSimilar}><Link2 size={14} /> Similar</button>}
                {selected && <button className="btn btn--danger" onClick={deleteDay}><Trash2 size={14} /></button>}
              </div>
            </div>

            <div className="detail-tabs">
              {[['overview', 'Overview'], ['edit', 'Edit'], ['charts', 'Charts'], ['intel', 'Intelligence'], ['similar', 'Similar Days']].map(([id, label]) => (
                <button key={id} className={`detail-tab ${detailTab === id ? 'detail-tab--active' : ''}`} onClick={() => setDetailTab(id)}>{label}</button>
              ))}
            </div>

            {/* Overview */}
            {detailTab === 'overview' && day && <>
              {day.pnl != null && <div className="stat-grid">
                <div className="stat-card"><div className="stat-card__label">P&L</div><div className={`stat-card__value ${pnlC(day.pnl)}`}>{pnl$(day.pnl)}</div></div>
                <div className="stat-card"><div className="stat-card__label">Trades</div><div className="stat-card__value">{day.num_trades ?? '—'}</div></div>
                <div className="stat-card"><div className="stat-card__label">Wins</div><div className="stat-card__value">{day.win_count ?? '—'}</div></div>
                <div className="stat-card"><div className="stat-card__label">Score</div><div className="stat-card__value">{day.execution_score != null ? Math.round(day.execution_score) : '—'}</div></div>
              </div>}

              {images.length > 0 && <div className="section"><div className="section__head"><span className="section__title">Charts</span></div>
                <div className="chart-grid">{images.map(u => <div className="chart-card" key={u.id} onClick={() => setLightbox(u.url)}><img className="chart-card__img" src={u.url} alt={u.filename} loading="lazy" /><div className="chart-card__foot"><span className="chart-card__kind">{u.kind}</span><span className="chart-card__name">{u.filename}</span></div></div>)}</div>
              </div>}

              {(day.market_bias || day.premarket_notes) && <div className="section"><div className="section__head"><span className="section__title">Pre-Market</span></div>
                {day.market_bias && <div style={{ marginBottom: 12 }}><div className="field__label" style={{ marginBottom: 4 }}>Bias</div><p>{day.market_bias}</p></div>}
                {day.premarket_notes && <div><div className="field__label" style={{ marginBottom: 4 }}>Notes</div><p>{day.premarket_notes}</p></div>}
              </div>}

              {(day.trade_notes || day.ideal_notes) && <div className="section"><div className="section__head"><span className="section__title">Trade Notes</span></div>
                {day.trade_notes && <div style={{ marginBottom: 12 }}><div className="field__label" style={{ marginBottom: 4 }}>Trades Taken</div><p>{day.trade_notes}</p></div>}
                {day.ideal_notes && <div><div className="field__label" style={{ marginBottom: 4 }}>Ideal Trades</div><p>{day.ideal_notes}</p></div>}
              </div>}

              {day.ai_summary && <div className="section"><div className="section__head"><span className="section__title">AI Summary</span></div><div className="intel-summary"><p>{day.ai_summary}</p></div></div>}

              {day.lessons && <div className="section"><div className="section__head"><span className="section__title">Lessons</span></div><p>{day.lessons}</p></div>}
            </>}
            {detailTab === 'overview' && !day && <div className="empty-state"><p>Fill in the details on the Edit tab, then save.</p></div>}

            {/* Edit */}
            {detailTab === 'edit' && <>
              <div className="section"><h3 className="section__title" style={{ marginBottom: 14 }}>Session Context</h3>
                <div className="field-grid field-grid--3"><Field label="Date" type="date" value={draft.trade_date} onChange={v => d('trade_date', v)} /><Field label="Tickers" value={draft.tickers} onChange={v => d('tickers', v)} placeholder="MNQ, ES, NQ…" /><Field label="Strategy" value={draft.strategy} onChange={v => d('strategy', v)} placeholder="SSMT, ORB…" /></div>
                <div className="field-grid field-grid--3"><Field label="Session" value={draft.session} onChange={v => d('session', v)} placeholder="NY AM, London…" /><Field label="Mood" value={draft.mood} onChange={v => d('mood', v)} placeholder="Focused, anxious…" /><Field label="Title" value={draft.title} onChange={v => d('title', v)} placeholder="Short label" /></div>
              </div>
              <div className="section"><h3 className="section__title" style={{ marginBottom: 14 }}>Performance</h3>
                <div className="field-grid field-grid--4"><Field label="P&L ($)" type="number" value={draft.pnl} onChange={v => d('pnl', v ? parseFloat(v) : null)} /><Field label="# Trades" type="number" value={draft.num_trades} onChange={v => d('num_trades', v ? parseInt(v) : null)} /><Field label="Wins" type="number" value={draft.win_count} onChange={v => d('win_count', v ? parseInt(v) : null)} /><Field label="Losses" type="number" value={draft.loss_count} onChange={v => d('loss_count', v ? parseInt(v) : null)} /></div>
                <p className="field-hint">Auto-fills when you upload a trade CSV.</p>
              </div>
              <div className="section"><h3 className="section__title" style={{ marginBottom: 14 }}>Notes</h3>
                <Field label="Market Bias" textarea value={draft.market_bias} onChange={v => d('market_bias', v)} placeholder="Directional bias before the session…" />
                <Field label="Premarket Notes" textarea value={draft.premarket_notes} onChange={v => d('premarket_notes', v)} placeholder="Key levels, overnight context…" />
                <Field label="Trades Taken" textarea value={draft.trade_notes} onChange={v => d('trade_notes', v)} placeholder="What you did — entries, exits, sizing…" />
                <Field label="Ideal Trades" textarea value={draft.ideal_notes} onChange={v => d('ideal_notes', v)} placeholder="What you should have done…" />
                <Field label="Lessons" textarea value={draft.lessons} onChange={v => d('lessons', v)} placeholder="What to carry forward…" />
                <Field label="Tags" value={draft.tags} onChange={v => d('tags', v)} placeholder="revenge-trade, A-setup, chop…" />
              </div>
            </>}

            {/* Charts */}
            {detailTab === 'charts' && <>
              {selected ? <>
                <div className="section"><div className="section__head"><span className="section__title">Upload</span></div>
                  <div className="upload-grid">{['premarket', 'trade', 'ideal', 'postmarket', 'csv', 'other'].map(k => <UploadSlot key={k} kind={k} onUpload={upload} />)}</div>
                </div>
                {images.length > 0 && <div className="section"><div className="section__head"><span className="section__title">Charts</span></div>
                  <div className="chart-grid">{images.map(u => <div className="chart-card" key={u.id} onClick={() => setLightbox(u.url)}><img className="chart-card__img" src={u.url} alt={u.filename} loading="lazy" /><div className="chart-card__foot"><span className="chart-card__kind">{u.kind}</span><span className="chart-card__name">{u.filename}</span></div></div>)}</div>
                </div>}
                {bundle?.uploads?.filter(u => !(u.content_type || '').startsWith('image/')).length > 0 && <div className="section"><div className="section__head"><span className="section__title">Files</span></div>
                  {bundle.uploads.filter(u => !(u.content_type || '').startsWith('image/')).map(u => <div key={u.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 0' }}><span className="chart-card__kind">{u.kind}</span><span>{u.filename}</span><a href={u.url} target="_blank" rel="noopener noreferrer"><ArrowUpRight size={13} /></a></div>)}
                </div>}
                {bundle?.trade_rows?.length > 0 && <div className="section"><div className="section__head"><span className="section__title">Trade Rows</span></div><div className="trade-table-wrap"><TradeTable rows={bundle.trade_rows.slice(0, 30)} /></div></div>}
              </> : <div className="empty-state"><BarChart3 size={32} /><p>Save the day first, then upload charts.</p></div>}
            </>}

            {/* Intelligence */}
            {detailTab === 'intel' && day && <>
              {day.execution_score != null && <div className="section">
                <div className="exec-card">
                  <div className="exec-card__score"><span className="exec-card__number">{Math.round(day.execution_score)}</span><span className="exec-card__label">overall</span></div>
                  <div className="exec-card__bars"><ScoreBar label="Bias" value={day.bias_score} /><ScoreBar label="Patience" value={day.patience_score} /><ScoreBar label="Entry" value={day.entry_score} /><ScoreBar label="Risk Mgmt" value={day.risk_mgmt_score} /><ScoreBar label="Profit Taking" value={day.profit_taking_score} /></div>
                </div>
                {(day.biggest_strength || day.biggest_mistake) && <div className="exec-notes">
                  {day.biggest_strength && <div className="exec-note exec-note--green"><TrendingUp size={14} /><div><span className="exec-note__label">Strength</span><p>{day.biggest_strength}</p></div></div>}
                  {day.biggest_mistake && <div className="exec-note exec-note--red"><TrendingDown size={14} /><div><span className="exec-note__label">Mistake</span><p>{day.biggest_mistake}</p></div></div>}
                </div>}
              </div>}
              {(day.gap_direction || day.premarket_trend) && <div className="section"><div className="section__head"><span className="section__title">Premarket Analysis</span></div>
                <div className="intel-block__grid">
                  {day.gap_direction && <div className="intel-block__item"><span className="intel-block__key">gap</span><span className="intel-block__val">{day.gap_direction}</span></div>}
                  {day.premarket_trend && <div className="intel-block__item"><span className="intel-block__key">trend</span><span className="intel-block__val">{day.premarket_trend}</span></div>}
                  {day.volume_assessment && <div className="intel-block__item"><span className="intel-block__key">volume</span><span className="intel-block__val">{day.volume_assessment}</span></div>}
                  {day.key_levels && <div className="intel-block__item"><span className="intel-block__key">key levels</span><span className="intel-block__val">{day.key_levels}</span></div>}
                </div>
              </div>}
              {day.ai_summary && <div className="section"><div className="section__head"><span className="section__title">AI Analysis</span></div><div className="intel-summary"><p>{day.ai_summary}</p></div></div>}
              <IntelPanel label="Market Structure" data={day.ai_market_structure} />
              <IntelPanel label="Execution Review" data={day.ai_execution_review} />
              {bundle?.patterns?.length > 0 && <div className="section"><div className="section__head"><span className="section__title">Detected Patterns</span></div>
                <div className="pattern-list">{bundle.patterns.map(p => <div className="pattern-chip" key={p.id}><span className="pattern-chip__name">{p.name}</span>{p.confidence != null && <span className="pattern-chip__conf">{Math.round(p.confidence * 100)}%</span>}{p.win_rate != null && <span className={`pattern-chip__wr ${pnlC(p.win_rate - 0.5)}`}>{pct(p.win_rate)} WR</span>}</div>)}</div>
              </div>}
              {!day.ai_summary && !day.execution_score && <div className="empty-state"><Brain size={32} /><p>Click "Intelligence" to analyze this day.</p></div>}
            </>}

            {/* Similar Days */}
            {detailTab === 'similar' && <>
              {bundle?.similar?.length > 0 ? <div className="similar-list">{bundle.similar.map(s => <button className="similar-card" key={s.id} onClick={() => openDay(s.matched_day_id)}>
                <div className="similar-card__top"><span className="similar-card__date">{fmt(s.trade_date)}</span><span className="similar-card__score">{Math.round((s.similarity_score || 0) * 100)}%</span></div>
                <span className="similar-card__ticker">{s.tickers} {s.title}</span>
                <div className="similar-card__meta">{s.pnl != null && <span className={pnlC(s.pnl)}>{pnl$(s.pnl)}</span>}{s.ai_pattern_tags && <span style={{ color: 'var(--text-3)' }}>{s.ai_pattern_tags}</span>}</div>
                <ChevronRight size={14} className="similar-card__arrow" />
              </button>)}</div> : <div className="empty-state"><Link2 size={32} /><p>No similar days found. Upload a premarket chart or run intelligence first.</p></div>}
            </>}
          </>}

          {/* ── INTELLIGENCE ──────────── */}
          {page === 'intel' && <>
            <div className="page-header"><h1 className="page-header__title">Intelligence</h1><p className="page-header__sub">Query your trading history</p></div>
            <div className="section">
              <div className="field-grid field-grid--3">
                <label className="field"><span className="field__label">Pattern</span><select className="field__input" value={queryFilters.pattern} onChange={e => qf('pattern', e.target.value)}><option value="">All patterns</option>{['Gap and Go', 'VWAP Reclaim', 'Failed Breakout', 'Trend Day', 'Reversal Day', 'Chop Day', 'Liquidity Sweep', 'CISD', 'Power of 3', 'FVG Entry'].map(p => <option key={p} value={p}>{p}</option>)}</select></label>
                <label className="field"><span className="field__label">Outcome</span><select className="field__input" value={queryFilters.outcome} onChange={e => qf('outcome', e.target.value)}><option value="">All</option><option value="win">Winners</option><option value="loss">Losers</option></select></label>
                <Field label="Ticker" value={queryFilters.ticker} onChange={v => qf('ticker', v)} placeholder="MNQ, ES…" />
              </div>
              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                <label className="field" style={{ margin: 0, minWidth: 140 }}><span className="field__label">Sort</span><select className="field__input" value={queryFilters.sort} onChange={e => qf('sort', e.target.value)}><option value="date">Date</option><option value="pnl">Best P&L</option><option value="pnl_asc">Worst P&L</option><option value="score">Best Score</option></select></label>
                <button className="btn btn--primary" style={{ alignSelf: 'flex-end' }} onClick={runQuery}><Filter size={14} /> Run Query</button>
              </div>
            </div>
            {queryResult && <>
              <div className="stat-grid">
                <div className="stat-card"><div className="stat-card__label">Total P&L</div><div className={`stat-card__value ${pnlC(queryResult.stats.total_pnl)}`}>{queryResult.stats.total_pnl != null ? pnl$(queryResult.stats.total_pnl) : '—'}</div></div>
                <div className="stat-card"><div className="stat-card__label">Win Rate</div><div className="stat-card__value">{pct(queryResult.stats.win_rate)}</div></div>
                <div className="stat-card"><div className="stat-card__label">Avg Score</div><div className="stat-card__value">{queryResult.stats.avg_score != null ? Math.round(queryResult.stats.avg_score) : '—'}</div></div>
                <div className="stat-card"><div className="stat-card__label">Days</div><div className="stat-card__value">{queryResult.stats.total}</div></div>
              </div>
              <div className="day-list">{queryResult.days.map(dy => <button key={dy.id} className="day-row" onClick={() => openDay(dy.id)}><span className="day-row__date">{fmt(dy.trade_date)}</span><span className="day-row__ticker">{dy.tickers || dy.title || 'Untitled'}</span><span className="day-row__tags">{dy.ai_pattern_tags || ''}</span><span className={`day-row__pnl ${pnlC(dy.pnl)}`}>{dy.pnl != null ? pnl$(dy.pnl) : '—'}</span><span className="day-row__score">{dy.execution_score != null ? Math.round(dy.execution_score) : ''}</span><ChevronRight size={14} className="day-row__arrow" /></button>)}</div>
            </>}
          </>}

          {/* ── PATTERNS ─────────────── */}
          {page === 'patterns' && <>
            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div><h1 className="page-header__title">Pattern Library</h1><p className="page-header__sub">{patterns.length} patterns tracked</p></div>
              <button className="btn btn--primary" onClick={createNewPattern}><Plus size={14} /> New Pattern</button>
            </div>
            <table className="pattern-table"><thead><tr><th>Pattern</th><th>Days</th><th>Win Rate</th><th>Avg P&L</th><th>Description</th><th style={{ width: 80 }}></th></tr></thead><tbody>
              {patterns.map(p => editingPattern === p.id ? (
                <tr key={p.id}>
                  <td><input className="field__input" style={{ padding: '6px 8px', fontSize: 13 }} value={patternDraft.name || ''} onChange={e => setPatternDraft({ ...patternDraft, name: e.target.value })} /></td>
                  <td className="mono">{p.sample_count || 0}</td>
                  <td className={`mono ${pnlC((p.win_rate || 0) - 0.5)}`}>{p.win_rate != null ? pct(p.win_rate) : '—'}</td>
                  <td className={`mono ${pnlC(p.avg_pnl)}`}>{p.avg_pnl != null ? pnl$(p.avg_pnl) : '—'}</td>
                  <td><input className="field__input" style={{ padding: '6px 8px', fontSize: 12, width: '100%' }} value={patternDraft.description || ''} onChange={e => setPatternDraft({ ...patternDraft, description: e.target.value })} /></td>
                  <td><div style={{ display: 'flex', gap: 4 }}><button className="btn btn--primary" style={{ padding: '4px 8px' }} onClick={() => savePattern(p.id)}><Check size={13} /></button><button className="btn btn--ghost" style={{ padding: '4px 8px' }} onClick={() => setEditingPattern(null)}><X size={13} /></button></div></td>
                </tr>
              ) : (
                <tr key={p.id}>
                  <td style={{ fontWeight: 500, cursor: 'pointer' }} onClick={() => { qf('pattern', p.name); setPage('intel'); }}>{p.name}</td>
                  <td className="mono">{p.sample_count || 0}</td>
                  <td className={`mono ${pnlC((p.win_rate || 0) - 0.5)}`}>{p.win_rate != null ? pct(p.win_rate) : '—'}</td>
                  <td className={`mono ${pnlC(p.avg_pnl)}`}>{p.avg_pnl != null ? pnl$(p.avg_pnl) : '—'}</td>
                  <td style={{ color: 'var(--text-2)', fontSize: '12.5px' }}>{(p.description || '').slice(0, 80)}</td>
                  <td><div style={{ display: 'flex', gap: 4 }}><button className="btn btn--ghost" style={{ padding: '4px 8px' }} onClick={() => { setEditingPattern(p.id); setPatternDraft({ name: p.name, description: p.description, rules: p.rules, tags: p.tags }); }}><Pencil size={13} /></button><button className="btn btn--danger" style={{ padding: '4px 8px' }} onClick={() => deletePattern(p.id)}><Trash2 size={13} /></button></div></td>
                </tr>
              ))}
            </tbody></table>
          </>}
        </div>
      </div>

      {lightbox && <div className="lightbox" onClick={() => setLightbox(null)}><button className="lightbox__close"><X size={20} /></button><img src={lightbox} alt="Chart" /></div>}
      <Toast status={status} onClear={() => setStatus('')} />
    </div>
  );
}

function TradeTable({ rows }) {
  if (!rows.length) return null;
  const keys = [...new Set(rows.flatMap(r => Object.keys(r.row_data || {})))];
  if (!keys.length) return <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: 'var(--text-2)' }}>{JSON.stringify(rows, null, 2)}</pre>;
  return <table className="trade-table"><thead><tr>{keys.map(k => <th key={k}>{k}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={r.id || i}>{keys.map(k => <td key={k}>{String(r.row_data?.[k] ?? '')}</td>)}</tr>)}</tbody></table>;
}

createRoot(document.getElementById('root')).render(<App />);
