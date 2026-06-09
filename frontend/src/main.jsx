import React, { useEffect, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Upload, Brain, Link2, Save, Search, Plus, ChevronRight, ChevronLeft, Sparkles, FileText, BarChart3, Tag, X, Loader2, ArrowUpRight, Trash2, TrendingUp, TrendingDown, Filter, Home, Calendar, Layers, Activity, Zap, Pencil, Check, Clock, History } from 'lucide-react';
import './style.css';

const API = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

async function api(path, opts = {}) {
  const r = await fetch(API + path, { headers: opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }, ...opts });
  if (!r.ok) { let msg = `Request failed (${r.status})`; try { const b = await r.json(); msg = b.detail || JSON.stringify(b); } catch { try { msg = await r.text(); } catch {} } throw new Error(msg); }
  return r.json();
}

const fmt = d => { if (!d) return ''; const dt = new Date(d + 'T00:00:00'); return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); };
const fmtTs = ts => { if (!ts) return ''; const dt = new Date(ts); return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const pnlC = v => v > 0 ? 'positive' : v < 0 ? 'negative' : '';
const pnl$ = v => { if (v == null) return '—'; return (v >= 0 ? '+$' : '-$') + Math.abs(v).toFixed(2); };
const pct = v => v != null ? Math.round(v * 100) + '%' : '—';

const TYPE_LABELS = { premarket: 'Pre-Market', postmarket: 'Post-Market', trade: 'Trade', other: 'Other' };
const TYPE_COLORS = { premarket: 'var(--blue)', postmarket: 'var(--amber)', trade: 'var(--green)', other: 'var(--text-3)' };

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

// ── Analysis Result Cards (reused for both live result and history detail) ──
function AnalysisResultCards({ result, onOpenDay }) {
  if (!result) return null;
  const { chart_analysis, similar_days, stats, recommendation, analysis_type, trade_date, day_id, url, filename, created_at } = result;
  return <>
    {/* Header meta */}
    {(trade_date || created_at) && (
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        {analysis_type && <span className="pattern-chip" style={{ background: TYPE_COLORS[analysis_type] + '22', color: TYPE_COLORS[analysis_type], border: `1px solid ${TYPE_COLORS[analysis_type]}44` }}>{TYPE_LABELS[analysis_type] || analysis_type}</span>}
        {trade_date && <span style={{ color: 'var(--text-2)', fontSize: 13 }}>{fmt(trade_date)}</span>}
        {created_at && <span style={{ color: 'var(--text-3)', fontSize: 12 }}>{fmtTs(created_at)}</span>}
        {day_id && onOpenDay && <button className="btn btn--ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => onOpenDay(day_id)}>View Trade Day →</button>}
      </div>
    )}

    {/* Screenshot thumbnail */}
    {url && <div className="section"><img src={url} alt={filename || 'chart'} style={{ maxHeight: 280, borderRadius: 8, border: '1px solid var(--border)', display: 'block' }} /></div>}

    {/* Recommendation */}
    {recommendation && <div className="section">
      <div className="analyze-rec">
        <div className="analyze-rec__head"><Brain size={20} /><span>AI Recommendation</span></div>
        {recommendation.times_seen > 0 && <p className="analyze-rec__seen">You've seen this structure <strong>{recommendation.times_seen} times</strong>.</p>}
        <div className="stat-grid" style={{ marginBottom: 16 }}>
          <div className="stat-card"><div className="stat-card__label">Avg Result</div><div className={`stat-card__value ${pnlC(stats?.avg_pnl)}`}>{stats?.avg_pnl != null ? pnl$(stats.avg_pnl) : '—'}</div></div>
          <div className="stat-card"><div className="stat-card__label">Win Rate</div><div className="stat-card__value">{stats?.win_rate != null ? pct(stats.win_rate) : '—'}</div></div>
          <div className="stat-card"><div className="stat-card__label">Risk Level</div><div className="stat-card__value" style={{ fontSize: 18, textTransform: 'capitalize' }}>{recommendation.risk_level || '—'}</div></div>
          <div className="stat-card"><div className="stat-card__label">Similar Days</div><div className="stat-card__value">{similar_days?.length || 0}</div></div>
        </div>
        {recommendation.best_strategy && <div className="analyze-rec__row"><span className="analyze-rec__label">Best Strategy</span><p>{recommendation.best_strategy}</p></div>}
        {recommendation.most_common_mistake && <div className="analyze-rec__row"><span className="analyze-rec__label">Common Mistake</span><p>{recommendation.most_common_mistake}</p></div>}
        {recommendation.recommendation && <div className="analyze-rec__row analyze-rec__row--accent"><span className="analyze-rec__label">Recommendation</span><p>{recommendation.recommendation}</p></div>}
        {recommendation.pattern_summary && <div className="analyze-rec__row"><span className="analyze-rec__label">Pattern</span><p>{recommendation.pattern_summary}</p></div>}
      </div>
    </div>}

    {/* Chart analysis */}
    {chart_analysis && Object.keys(chart_analysis).length > 0 && <div className="section">
      <div className="section__head"><span className="section__title">Chart Analysis</span></div>
      <div className="intel-block__grid">
        {chart_analysis.gap_direction && <div className="intel-block__item"><span className="intel-block__key">gap</span><span className="intel-block__val">{chart_analysis.gap_direction}</span></div>}
        {chart_analysis.premarket_trend && <div className="intel-block__item"><span className="intel-block__key">trend</span><span className="intel-block__val">{chart_analysis.premarket_trend}</span></div>}
        {chart_analysis.directional_bias && <div className="intel-block__item"><span className="intel-block__key">bias</span><span className="intel-block__val">{chart_analysis.directional_bias}</span></div>}
        {chart_analysis.volume_assessment && <div className="intel-block__item"><span className="intel-block__key">volume</span><span className="intel-block__val">{chart_analysis.volume_assessment}</span></div>}
        {chart_analysis.market_structure?.vwap_context && <div className="intel-block__item"><span className="intel-block__key">vwap</span><span className="intel-block__val">{chart_analysis.market_structure.vwap_context}</span></div>}
        {chart_analysis.market_structure?.trend_or_chop && <div className="intel-block__item"><span className="intel-block__key">session type</span><span className="intel-block__val">{chart_analysis.market_structure.trend_or_chop}</span></div>}
      </div>
      {chart_analysis.summary && <div className="intel-summary" style={{ marginTop: 12 }}><p>{chart_analysis.summary}</p></div>}
      {chart_analysis.risk_notes && <div style={{ marginTop: 10, padding: '10px 14px', background: 'var(--amber-bg, rgba(240,176,76,0.1))', borderRadius: 6, fontSize: 13, color: 'var(--amber)' }}><strong>Risk:</strong> {chart_analysis.risk_notes}</div>}
      {chart_analysis.pattern_tags?.length > 0 && <div className="pattern-list" style={{ marginTop: 12 }}>{chart_analysis.pattern_tags.map(t => <span key={t} className="pattern-chip">{t.replace(/_/g, ' ')}</span>)}</div>}
      {chart_analysis.key_levels?.length > 0 && <div style={{ marginTop: 10, fontSize: 13, color: 'var(--text-2)' }}><strong>Key Levels: </strong>{Array.isArray(chart_analysis.key_levels) ? chart_analysis.key_levels.join(', ') : chart_analysis.key_levels}</div>}
      {chart_analysis.likely_scenarios?.length > 0 && <div style={{ marginTop: 8 }}><div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Likely Scenarios</div>{(Array.isArray(chart_analysis.likely_scenarios) ? chart_analysis.likely_scenarios : [chart_analysis.likely_scenarios]).map((s, i) => <div key={i} style={{ fontSize: 13, color: 'var(--text-2)', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>{s}</div>)}</div>}
    </div>}

    {/* Similar days */}
    {similar_days?.length > 0 && <div className="section">
      <div className="section__head"><span className="section__title">Similar Historical Days</span><span style={{ fontSize: 12, color: 'var(--text-3)' }}>Click to open</span></div>
      <div className="similar-list">{similar_days.map((s, i) => <button className="similar-card" key={i} onClick={() => { if ((s.day_id || s.id) && onOpenDay) onOpenDay(s.day_id || s.id); }}>
        <div className="similar-card__top"><span className="similar-card__date">{fmt(s.trade_date)}</span><span className="similar-card__score">{Math.round((s.similarity || 0) * 100)}%</span></div>
        <span className="similar-card__ticker">{s.tickers} {s.title}</span>
        <div className="similar-card__meta">{s.pnl != null && <span className={pnlC(s.pnl)}>{pnl$(s.pnl)}</span>}{s.ai_pattern_tags && <span style={{ color: 'var(--text-3)' }}>{s.ai_pattern_tags}</span>}</div>
        {s.lessons && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4, textAlign: 'left' }}>"{s.lessons.slice(0, 80)}{s.lessons.length > 80 ? '…' : ''}"</div>}
        <ChevronRight size={14} className="similar-card__arrow" />
      </button>)}</div>
    </div>}
  </>;
}

// ── Calendar Heatmap ─────────────────────────────────
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAYS_SHORT = ['Su','Mo','Tu','We','Th','Fr','Sa'];

function CalendarHeatmap({ calendarData, onDayClick, viewYear, viewMonth, onPrev, onNext }) {
  // Build a lookup: "YYYY-MM-DD" -> day row
  const byDate = {};
  (calendarData || []).forEach(d => { byDate[d.trade_date] = d; });

  // Compute scale: max abs pnl for color intensity
  const pnls = (calendarData || []).map(d => d.pnl).filter(v => v != null);
  const maxAbs = pnls.length ? Math.max(...pnls.map(Math.abs), 1) : 1;

  const year = viewYear;
  const month = viewMonth; // 0-indexed

  // First day of month, number of days
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Build grid: 6 rows x 7 cols
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const isoDate = (d) => `${year}-${String(month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;

  const cellColor = (day) => {
    if (!day) return 'transparent';
    const row = byDate[isoDate(day)];
    if (!row || row.pnl == null) return 'var(--surface-1)';
    const intensity = Math.min(Math.abs(row.pnl) / maxAbs, 1);
    if (row.pnl > 0) {
      // green: low intensity = muted, high = bright
      const g = Math.round(120 + intensity * 82);  // 120-202
      const r = Math.round(20 + (1 - intensity) * 40);
      const b = Math.round(80 + (1 - intensity) * 85);
      return `rgba(${r},${g},${b},${0.25 + intensity * 0.75})`;
    } else {
      const r = Math.round(180 + intensity * 52);
      const g = Math.round(30 + (1 - intensity) * 50);
      const b = Math.round(40 + (1 - intensity) * 59);
      return `rgba(${r},${g},${b},${0.25 + intensity * 0.75})`;
    }
  };

  const today = new Date();
  const isToday = (d) => d && today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;

  return (
    <div className="cal-heatmap">
      <div className="cal-heatmap__nav">
        <button className="btn btn--ghost cal-nav-btn" onClick={onPrev}><ChevronLeft size={15} /></button>
        <span className="cal-heatmap__title">{MONTHS[month]} {year}</span>
        <button className="btn btn--ghost cal-nav-btn" onClick={onNext}><ChevronRight size={15} /></button>
      </div>
      <div className="cal-heatmap__grid">
        {DAYS_SHORT.map(d => <div key={d} className="cal-heatmap__dow">{d}</div>)}
        {cells.map((day, i) => {
          const row = day ? byDate[isoDate(day)] : null;
          return (
            <div
              key={i}
              className={`cal-heatmap__cell ${day ? 'cal-heatmap__cell--active' : ''} ${isToday(day) ? 'cal-heatmap__cell--today' : ''} ${row ? 'cal-heatmap__cell--traded' : ''}`}
              style={{ background: cellColor(day) }}
              onClick={() => row && onDayClick(row.id)}
              title={row ? `${isoDate(day)}\n${row.tickers || ''}\nP&L: ${pnl$(row.pnl)}\nTrades: ${row.num_trades ?? '—'}\nScore: ${row.execution_score != null ? Math.round(row.execution_score) : '—'}` : day ? isoDate(day) : ''}
            >
              {day && <span className="cal-heatmap__day-num">{day}</span>}
              {row?.pnl != null && <span className={`cal-heatmap__pnl ${pnlC(row.pnl)}`}>{row.pnl >= 0 ? '+' : ''}{Math.round(row.pnl)}</span>}
            </div>
          );
        })}
      </div>
      <div className="cal-heatmap__legend">
        <span style={{ color: 'var(--text-3)', fontSize: 11 }}>Loss</span>
        {[-1,-0.6,-0.3,0.3,0.6,1].map(v => (
          <div key={v} style={{
            width: 16, height: 16, borderRadius: 3,
            background: v < 0
              ? `rgba(${Math.round(180+Math.abs(v)*52)},${Math.round(30+(1-Math.abs(v))*50)},${Math.round(40+(1-Math.abs(v))*59)},${0.25+Math.abs(v)*0.75})`
              : `rgba(${Math.round(20+(1-v)*40)},${Math.round(120+v*82)},${Math.round(80+(1-v)*85)},${0.25+v*0.75})`
          }} />
        ))}
        <span style={{ color: 'var(--text-3)', fontSize: 11 }}>Win</span>
      </div>
    </div>
  );
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
  const [editingPattern, setEditingPattern] = useState(null);
  const [patternDraft, setPatternDraft] = useState({});

  // ── Calendar state ────────────────────────────────
  const [calendarData, setCalendarData] = useState([]);
  const [calView, setCalView] = useState({ year: new Date().getFullYear(), month: new Date().getMonth() });

  // ── Analyze state ─────────────────────────────────
  const [analyzeTab, setAnalyzeTab] = useState('upload');   // 'upload' | 'history'
  const [analyzeResult, setAnalyzeResult] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeConfig, setAnalyzeConfig] = useState({
    analysis_type: 'premarket',
    trade_date: new Date().toISOString().slice(0, 10),
    notes: '',
    focus: '',
    link_to_day: false,
  });
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedSession, setSelectedSession] = useState(null);   // full session detail

  function emptyDraft() { return { trade_date: new Date().toISOString().slice(0, 10), title: '', tickers: '', strategy: '', session: '', market_bias: '', premarket_notes: '', trade_notes: '', ideal_notes: '', lessons: '', tags: '', mood: '', pnl: null, num_trades: null, win_count: null, loss_count: null }; }
  const d = (k, v) => setDraft({ ...draft, [k]: v });
  const qf = (k, v) => setQueryFilters({ ...queryFilters, [k]: v });
  const ac = (k, v) => setAnalyzeConfig(c => ({ ...c, [k]: v }));

  const load = async () => { try { setDays(await api('/days' + (q ? `?q=${encodeURIComponent(q)}` : ''))); } catch (e) { setStatus('Error: ' + e.message); } };
  const loadStats = async () => { try { setStats(await api('/stats')); } catch {} };
  const loadPatterns = async () => { try { setPatterns(await api('/patterns')); } catch {} };
  const loadCalendar = async (year, month0) => {
    try { setCalendarData(await api(`/calendar?year=${year}&month=${month0 + 1}`)); } catch {}
  };
  const calPrev = () => { const d = new Date(calView.year, calView.month - 1, 1); const v = { year: d.getFullYear(), month: d.getMonth() }; setCalView(v); loadCalendar(v.year, v.month); };
  const calNext = () => { const d = new Date(calView.year, calView.month + 1, 1); const v = { year: d.getFullYear(), month: d.getMonth() }; setCalView(v); loadCalendar(v.year, v.month); };
  const openDay = async (id) => { try { setSelected(id); const b = await api('/days/' + id); setBundle(b); setDraft(b.day); setPage('detail'); setDetailTab('overview'); } catch (e) { setStatus('Error: ' + e.message); } };

  const loadHistory = async () => {
    setHistoryLoading(true);
    try { setHistory(await api('/analyze/history?limit=100')); }
    catch (e) { setStatus('Failed to load history: ' + e.message); }
    finally { setHistoryLoading(false); }
  };

  const openSession = async (id) => {
    try {
      const data = await api(`/analyze/sessions/${id}`);
      const s = data.session;
      // Merge day info and normalize to same shape as live result
      setSelectedSession({
        ...s,
        chart_analysis: s.chart_analysis || {},
        similar_days: s.similar_days || [],
        stats: s.stats || {},
        recommendation: s.recommendation || {},
        day_id: s.day_id,
        trade_date: s.trade_date,
        created_at: s.created_at,
      });
    } catch (e) { setStatus('Failed to load session: ' + e.message); }
  };

  const deleteSession = async (id) => {
    if (!confirm('Delete this analysis session?')) return;
    try { await api(`/analyze/sessions/${id}`, { method: 'DELETE' }); setHistory(h => h.filter(s => s.id !== id)); if (selectedSession?.id === id) setSelectedSession(null); setStatus('Deleted'); }
    catch (e) { setStatus('Failed: ' + e.message); }
  };

  useEffect(() => { load(); loadStats(); loadPatterns(); loadCalendar(calView.year, calView.month); }, []);

  // Load history when navigating to analyze page
  useEffect(() => { if (page === 'analyze') loadHistory(); }, [page]);

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

  const runAnalysis = async (file) => {
    if (!file) return;
    try {
      setAnalyzing(true);
      setStatus('Analyzing...');
      setAnalyzeResult(null);
      setSelectedSession(null);
      const fd = new FormData();
      fd.append('file', file);
      fd.append('analysis_type', analyzeConfig.analysis_type);
      if (analyzeConfig.link_to_day && analyzeConfig.trade_date) fd.append('trade_date', analyzeConfig.trade_date);
      if (analyzeConfig.notes) fd.append('notes', analyzeConfig.notes);
      if (analyzeConfig.focus) fd.append('focus', analyzeConfig.focus);
      fd.append('save_session', 'true');
      const result = await api('/analyze', { method: 'POST', body: fd });
      setAnalyzeResult(result);
      setStatus(`Analysis saved${result.day_id ? ' · linked to ' + fmt(result.trade_date) : ''}`);
      // Refresh history list in background
      loadHistory();
    } catch (e) {
      setStatus('Analysis failed: ' + e.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const savePattern = async (id) => { try { await api('/patterns/' + id, { method: 'PUT', body: JSON.stringify(patternDraft) }); setEditingPattern(null); await loadPatterns(); setStatus('Pattern saved'); } catch (e) { setStatus('Failed: ' + e.message); } };
  const deletePattern = async (id) => { if (!confirm('Delete this pattern?')) return; try { await api('/patterns/' + id, { method: 'DELETE' }); await loadPatterns(); setStatus('Pattern deleted'); } catch (e) { setStatus('Failed: ' + e.message); } };
  const createNewPattern = async () => { const name = prompt('Pattern name:'); if (!name) return; try { await api('/patterns', { method: 'POST', body: JSON.stringify({ name, description: '' }) }); await loadPatterns(); setStatus('Pattern created'); } catch (e) { setStatus('Failed: ' + e.message); } };

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
    { id: 'sync', icon: Activity, label: 'Tradovate Sync' },
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
            <div className="section">
              <div className="section__head"><span className="section__title">Monthly Calendar</span></div>
              <CalendarHeatmap
                calendarData={calendarData}
                onDayClick={openDay}
                viewYear={calView.year}
                viewMonth={calView.month}
                onPrev={calPrev}
                onNext={calNext}
              />
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
            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div><h1 className="page-header__title">Analyze</h1><p className="page-header__sub">Chart intelligence · saved to history · linked to trade days</p></div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className={`btn ${analyzeTab === 'upload' ? 'btn--primary' : 'btn--ghost'}`} onClick={() => { setAnalyzeTab('upload'); setSelectedSession(null); }}><Zap size={14} /> Analyze</button>
                <button className={`btn ${analyzeTab === 'history' ? 'btn--primary' : 'btn--ghost'}`} onClick={() => { setAnalyzeTab('history'); setSelectedSession(null); loadHistory(); }}><History size={14} /> History {history.length > 0 && <span style={{ background: 'var(--blue)', color: '#fff', borderRadius: 10, padding: '1px 6px', fontSize: 11, marginLeft: 4 }}>{history.length}</span>}</button>
              </div>
            </div>

            {/* ── UPLOAD TAB ── */}
            {analyzeTab === 'upload' && <>
              {/* Config bar */}
              <div className="section">
                <div className="field-grid field-grid--3" style={{ marginBottom: 12 }}>
                  <label className="field">
                    <span className="field__label">Analysis Type</span>
                    <select className="field__input" value={analyzeConfig.analysis_type} onChange={e => ac('analysis_type', e.target.value)}>
                      <option value="premarket">Pre-Market — what am I looking at before open</option>
                      <option value="postmarket">Post-Market — how did the day resolve</option>
                      <option value="trade">Trade Screenshot — specific entry or exit</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                  <label className="field">
                    <span className="field__label">Link to Trade Day (optional)</span>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input type="checkbox" checked={analyzeConfig.link_to_day} onChange={e => ac('link_to_day', e.target.checked)} style={{ width: 'auto', margin: 0 }} />
                      {analyzeConfig.link_to_day
                        ? <input className="field__input" type="date" value={analyzeConfig.trade_date} onChange={e => ac('trade_date', e.target.value)} style={{ flex: 1 }} />
                        : <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Enable to attach to a day</span>}
                    </div>
                  </label>
                  <Field label="Notes (optional)" value={analyzeConfig.notes} onChange={v => ac('notes', v)} placeholder="Context, ticker, session…" />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label className="field">
                    <span className="field__label">Focus Override <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>— tell the AI what to pay special attention to</span></span>
                    <input className="field__input" value={analyzeConfig.focus} onChange={e => ac('focus', e.target.value)}
                      placeholder={
                        analyzeConfig.analysis_type === 'premarket' ? 'e.g. "focus on the FVG at 19420 and whether NQ is diverging from ES"' :
                        analyzeConfig.analysis_type === 'trade' ? 'e.g. "check if this entry was inside the 4h FVG and if liquidity was swept first"' :
                        analyzeConfig.analysis_type === 'postmarket' ? 'e.g. "did the Power of 3 play out and where was the manipulation leg"' :
                        'e.g. specific levels, patterns, or context to emphasize'
                      }
                    />
                  </label>
                </div>

                <div className="analyze-upload">
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
                    <span style={{ padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, background: TYPE_COLORS[analyzeConfig.analysis_type] + '22', color: TYPE_COLORS[analyzeConfig.analysis_type] }}>{TYPE_LABELS[analyzeConfig.analysis_type]}</span>
                    {analyzeConfig.link_to_day && analyzeConfig.trade_date && <span style={{ fontSize: 12, color: 'var(--text-2)' }}>→ {fmt(analyzeConfig.trade_date)}</span>}
                  </div>
                  <p style={{ marginTop: 8 }}>{analyzeConfig.analysis_type === 'premarket' ? 'Upload a premarket chart for AI analysis + historical match' : analyzeConfig.analysis_type === 'postmarket' ? 'Upload an EOD chart to see how the day resolved vs similar days' : analyzeConfig.analysis_type === 'trade' ? 'Upload a trade screenshot to analyze entry/exit quality' : 'Upload a chart for analysis'}</p>
                  {analyzing
                    ? <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--text-2)' }}><Loader2 size={18} className="spin" /> Analyzing…</div>
                    : <label className="btn btn--primary" style={{ cursor: 'pointer' }}>
                        <Upload size={14} /> Upload Screenshot
                        <input type="file" hidden accept="image/*" onChange={e => { runAnalysis(e.target.files[0]); e.target.value = ''; }} />
                      </label>}
                </div>
              </div>

              {/* Live result */}
              {analyzeResult && <>
                {analyzeResult.session_id && <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--text-3)' }}>Session #{analyzeResult.session_id} saved to history</div>}
                <AnalysisResultCards result={analyzeResult} onOpenDay={openDay} />
              </>}
            </>}

            {/* ── HISTORY TAB ── */}
            {analyzeTab === 'history' && <>
              {selectedSession
                ? <>
                    <button className="detail-back" onClick={() => setSelectedSession(null)}><ChevronLeft size={16} /> Back to history</button>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                      <button className="btn btn--danger" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => deleteSession(selectedSession.id)}><Trash2 size={13} /> Delete session</button>
                    </div>
                    <AnalysisResultCards result={selectedSession} onOpenDay={openDay} />
                  </>
                : <>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                      {['', 'premarket', 'postmarket', 'trade', 'other'].map(t => (
                        <button key={t} className="btn btn--ghost" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => {}}>
                          {t ? TYPE_LABELS[t] : 'All'}
                        </button>
                      ))}
                      <button className="btn btn--ghost" style={{ marginLeft: 'auto', fontSize: 12, padding: '4px 12px' }} onClick={loadHistory}><Search size={12} /> Refresh</button>
                    </div>

                    {historyLoading
                      ? <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--text-3)', padding: 32 }}><Loader2 size={16} className="spin" /> Loading history…</div>
                      : history.length === 0
                        ? <div className="empty-state"><History size={32} /><p>No analysis sessions yet. Upload a chart in the Analyze tab.</p></div>
                        : <div className="analyze-history-list">
                            {history.map(s => {
                              const ca = s.chart_analysis || {};
                              const rec = s.recommendation || {};
                              return (
                                <button key={s.id} className="history-card" onClick={() => openSession(s.id)}>
                                  {s.url && <div className="history-card__thumb"><img src={s.url} alt={s.filename} loading="lazy" /></div>}
                                  <div className="history-card__body">
                                    <div className="history-card__top">
                                      <span className="pattern-chip" style={{ background: TYPE_COLORS[s.analysis_type] + '22', color: TYPE_COLORS[s.analysis_type], fontSize: 11 }}>{TYPE_LABELS[s.analysis_type] || s.analysis_type}</span>
                                      {s.trade_date && <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{fmt(s.trade_date)}</span>}
                                      {s.day_id && <span style={{ fontSize: 11, color: 'var(--blue)' }}>linked to day</span>}
                                      <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 'auto' }}>{fmtTs(s.created_at)}</span>
                                    </div>
                                    {ca.summary && <p className="history-card__summary">{ca.summary.slice(0, 120)}{ca.summary.length > 120 ? '…' : ''}</p>}
                                    <div className="history-card__meta">
                                      {ca.directional_bias && <span className={`history-card__tag ${ca.directional_bias}`}>{ca.directional_bias}</span>}
                                      {ca.gap_direction && ca.gap_direction !== 'null' && <span className="history-card__tag">{ca.gap_direction}</span>}
                                      {ca.pattern_tags?.slice(0, 3).map(t => <span key={t} className="history-card__tag">{t.replace(/_/g, ' ')}</span>)}
                                    </div>
                                    {rec.recommendation && <p className="history-card__rec">{rec.recommendation.slice(0, 100)}{rec.recommendation.length > 100 ? '…' : ''}</p>}
                                    {s.notes && <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>{s.notes}</p>}
                                  </div>
                                  <div className="history-card__actions" onClick={e => e.stopPropagation()}>
                                    <button className="btn btn--danger" style={{ padding: '3px 7px' }} onClick={() => deleteSession(s.id)}><Trash2 size={12} /></button>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                    }
                  </>
              }
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
              {[['overview', 'Overview'], ['edit', 'Edit'], ['charts', 'Charts'], ['intel', 'Intelligence'], ['similar', 'Similar Days'], ['analyses', 'Analyses']].map(([id, label]) => (
                <button key={id} className={`detail-tab ${detailTab === id ? 'detail-tab--active' : ''}`} onClick={() => setDetailTab(id)}>{label}</button>
              ))}
            </div>

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

            {detailTab === 'similar' && <>
              {bundle?.similar?.length > 0 ? <div className="similar-list">{bundle.similar.map(s => <button className="similar-card" key={s.id} onClick={() => openDay(s.matched_day_id)}>
                <div className="similar-card__top"><span className="similar-card__date">{fmt(s.trade_date)}</span><span className="similar-card__score">{Math.round((s.similarity_score || 0) * 100)}%</span></div>
                <span className="similar-card__ticker">{s.tickers} {s.title}</span>
                <div className="similar-card__meta">{s.pnl != null && <span className={pnlC(s.pnl)}>{pnl$(s.pnl)}</span>}{s.ai_pattern_tags && <span style={{ color: 'var(--text-3)' }}>{s.ai_pattern_tags}</span>}</div>
                <ChevronRight size={14} className="similar-card__arrow" />
              </button>)}</div> : <div className="empty-state"><Link2 size={32} /><p>No similar days found. Upload a premarket chart or run intelligence first.</p></div>}
            </>}

            {/* ── ANALYSES TAB — linked analyze sessions ── */}
            {detailTab === 'analyses' && selected && <DayAnalysesTab dayId={selected} onOpenDay={openDay} setStatus={setStatus} />}
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

          {/* ── TRADOVATE SYNC ───────────── */}
          {page === 'sync' && <TradovateSyncPage onOpenDay={openDay} setStatus={setStatus} />}

        </div>
      </div>

      {lightbox && <div className="lightbox" onClick={() => setLightbox(null)}><button className="lightbox__close"><X size={20} /></button><img src={lightbox} alt="Chart" /></div>}
      <Toast status={status} onClear={() => setStatus('')} />
    </div>
  );
}

// ── Tradovate Sync Page ───────────────────────────────
function TradovateSyncPage({ onOpenDay, setStatus }) {
  const [syncStatus, setSyncStatus] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null); // full account object
  const [preview, setPreview] = useState(null);
  const [syncResult, setSyncResult] = useState(null);
  const [loading, setLoading] = useState('');

  useEffect(() => { loadStatus(); }, []);

  const loadStatus = async () => {
    try { setSyncStatus(await api('/tradovate/status')); } catch {}
  };

  const loadAccounts = async () => {
    setLoading('accounts');
    try {
      const accs = await api('/tradovate/accounts');
      setAccounts(accs);
      if (accs.length === 1) setSelectedAccount(accs[0]); // store full object
    } catch (e) { setStatus('Failed: ' + e.message); }
    finally { setLoading(''); }
  };

  const accountLabel = (acc) => acc.name || acc.nickname || acc.accountSpec || `Account ${acc.id}`;

  const runWsSync = async () => {
    setLoading('wssync');
    try {
      const result = await api('/tradovate/ws-sync', { method: 'POST', body: JSON.stringify({}) });
      setStatus(`Session loaded — ${result.status}${result.entities?.length ? ' · entities: ' + result.entities.join(', ') : ''}`);
      await loadStatus();
    } catch (e) { setStatus('WS sync failed: ' + e.message); }
    finally { setLoading(''); }
  };

  const runPreview = async () => {
    if (!selectedAccount) return;
    setLoading('preview');
    setPreview(null);
    try { setPreview(await api(`/tradovate/preview/${selectedAccount.id}`)); }
    catch (e) { setStatus('Preview failed: ' + e.message); }
    finally { setLoading(''); }
  };

  const runSync = async () => {
    if (!selectedAccount) return;
    const label = accountLabel(selectedAccount);
    if (!confirm(`Import all closed trades from Tradovate account ${label} into your journal?`)) return;
    setLoading('sync');
    setSyncResult(null);
    try {
      const result = await api(`/tradovate/sync/${selectedAccount.id}`, { method: 'POST', body: JSON.stringify({}) });
      setSyncResult(result);
      setStatus(`Sync complete — ${result.imported} imported, ${result.skipped} skipped`);
    } catch (e) { setStatus('Sync failed: ' + e.message); }
    finally { setLoading(''); }
  };

  const configured = syncStatus?.configured;
  const connected = syncStatus?.connected;

  return <>
    <div className="page-header">
      <h1 className="page-header__title">Tradovate Sync</h1>
      <p className="page-header__sub">Auto-import closed trades from your live Tradovate account</p>
    </div>

    {/* Connection status */}
    <div className="section">
      <div className="section__head"><span className="section__title">Connection</span><button className="btn btn--ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={loadStatus}>Refresh</button></div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: configured ? connected ? 'var(--green)' : 'var(--amber)' : 'var(--red)' }} />
          <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
            {!configured ? 'Credentials not configured' : connected ? `Connected · token expires in ${Math.round((syncStatus.token_expires_in || 0) / 60)}m` : 'Credentials set, not yet connected'}
          </span>
        </div>
        {configured && !connected && <button className="btn btn--primary" style={{ fontSize: 12 }} onClick={loadAccounts}>{loading === 'accounts' ? <Loader2 size={13} className="spin" /> : null} Connect & List Accounts</button>}
        {connected && accounts.length === 0 && <button className="btn btn--ghost" style={{ fontSize: 12 }} onClick={loadAccounts}>List Accounts</button>}
      </div>

      {!configured && <div style={{ marginTop: 16, padding: 16, background: 'var(--surface-0)', borderRadius: 8, border: '1px solid var(--border)' }}>
        <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 8 }}>Add these to your Railway environment variables to enable sync:</p>
        {[
          ['TRADOVATE_USERNAME', 'Your Tradovate login email/username'],
          ['TRADOVATE_PASSWORD', 'Your Tradovate password'],
          ['TRADOVATE_CID', 'Client ID from API settings in your Tradovate account'],
          ['TRADOVATE_SEC', 'Secret key from API settings'],
          ['TRADOVATE_APP_ID', 'App name you registered (e.g. "TradeJournal")'],
          ['TRADOVATE_APP_VERSION', '1.0'],
        ].map(([k, v]) => (
          <div key={k} style={{ display: 'flex', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
            <code style={{ color: 'var(--accent)', minWidth: 220 }}>{k}</code>
            <span style={{ color: 'var(--text-3)' }}>{v}</span>
          </div>
        ))}
        <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 12 }}>
          To get your CID and SEC: Log into Tradovate → top-right menu → API Access → generate an API key. Requires live account with API Access subscription (~$10/mo from Tradovate).
        </p>
      </div>}
    </div>

    {/* Account selector */}
    {accounts.length > 0 && <div className="section">
      <div className="section__head"><span className="section__title">Account</span></div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {accounts.map(acc => (
          <button key={acc.id} className={`btn ${selectedAccount?.id === acc.id ? 'btn--primary' : 'btn--ghost'}`}
            onClick={() => setSelectedAccount(acc)}>
            {accountLabel(acc)}
            {acc.accountType && <span style={{ fontSize: 11, opacity: 0.7, marginLeft: 6 }}>{acc.accountType}</span>}
          </button>
        ))}
      </div>
    </div>}

    {/* Actions */}
    {selectedAccount && <div className="section">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn--ghost" onClick={runPreview} disabled={!!loading}>
          {loading === 'preview' ? <Loader2 size={13} className="spin" /> : <Search size={13} />} Preview Trades
        </button>
        <button className="btn btn--primary" onClick={runSync} disabled={!!loading}>
          {loading === 'sync' ? <Loader2 size={13} className="spin" /> : <ArrowUpRight size={13} />} Import Now
        </button>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>
        Connects directly via WebSocket and collects your full trade history. Preview first, then import. Import is idempotent — safe to re-run.
      </p>
    </div>}

    {/* Preview results */}
    {preview && <div className="section">
      <div className="section__head"><span className="section__title">Preview — {preview.fill_pair_count} fill pairs</span></div>

      {/* Phase breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div style={{ padding: 12, background: 'var(--surface-0)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--text-2)' }}>WebSocket Phase</div>
          {preview.ws_phase?.error && <div style={{ color: 'var(--red)', marginBottom: 4 }}>Error: {preview.ws_phase.error}</div>}
          {Object.entries(preview.ws_phase?.entity_counts || {}).map(([k, v]) => (
            <div key={k} style={{ color: v > 0 ? 'var(--accent)' : 'var(--text-3)' }}>{k}: {v}</div>
          ))}
        </div>
        <div style={{ padding: 12, background: 'var(--surface-0)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--text-2)' }}>REST Phase (order/deps chain)</div>
          {preview.rest_phase?.error && <div style={{ color: 'var(--red)', marginBottom: 4 }}>Error: {preview.rest_phase.error}</div>}
          <div style={{ color: 'var(--text-2)' }}>Orders found: {preview.rest_phase?.orders_found ?? '—'}</div>
          {Object.entries(preview.rest_phase?.entity_counts || {}).map(([k, v]) => (
            <div key={k} style={{ color: v > 0 ? 'var(--green)' : 'var(--text-3)' }}>{k}: {v}</div>
          ))}
        </div>
      </div>
      {preview.fill_pair_count === 0
        ? <div className="empty-state" style={{ padding: 20 }}>
            <p>No fill pairs returned. This can happen if:</p>
            <ul style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 8, paddingLeft: 20 }}>
              <li>The account has no closed trades yet</li>
              <li>The API requires a WebSocket <code>user/syncrequest</code> to be triggered first — open Tradovate in your browser to sync the session, then retry</li>
              <li>Your API subscription is not active</li>
            </ul>
          </div>
        : <div className="trade-table-wrap"><table className="trade-table"><thead><tr>
            <th>Date</th><th>Symbol</th><th>Side</th><th>Qty</th><th>Entry</th><th>Exit</th><th>P&L</th><th>Entry Time</th>
          </tr></thead><tbody>
            {(preview.preview || []).map((r, i) => (
              <tr key={i}>
                <td>{r.trade_date}</td>
                <td style={{ fontWeight: 500 }}>{r.symbol}</td>
                <td style={{ color: r.side === 'Long' ? 'var(--green)' : 'var(--red)' }}>{r.side}</td>
                <td>{r.qty}</td>
                <td className="mono">{r.entry_price != null ? r.entry_price.toFixed(2) : '—'}</td>
                <td className="mono">{r.exit_price != null ? r.exit_price.toFixed(2) : '—'}</td>
                <td className={`mono ${pnlC(r.pnl)}`}>{r.pnl != null ? pnl$(r.pnl) : '—'}</td>
                <td style={{ fontSize: 11, color: 'var(--text-3)' }}>{r.entry_time ? fmtTs(r.entry_time) : '—'}</td>
              </tr>
            ))}
          </tbody></table></div>
      }
      {(preview.rest_phase?.raw_order_sample?.length > 0 || preview.rest_phase?.raw_fill_sample?.length > 0) && <details style={{ marginTop: 12 }}>
        <summary style={{ fontSize: 12, color: 'var(--text-3)', cursor: 'pointer' }}>Raw REST samples</summary>
        <pre style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 8, overflow: 'auto', background: 'var(--surface-0)', padding: 12, borderRadius: 6 }}>
          {JSON.stringify({
            orders: preview.rest_phase?.raw_order_sample,
            fills: preview.rest_phase?.raw_fill_sample,
            fillPairs: preview.rest_phase?.raw_fillpair_sample,
          }, null, 2)}
        </pre>
      </details>}
    </div>}

    {/* Sync result */}
    {syncResult && <div className="section">
      <div className="section__head"><span className="section__title">Sync Result</span></div>
      <div className="stat-grid">
        <div className="stat-card"><div className="stat-card__label">Imported</div><div className="stat-card__value positive">{syncResult.imported}</div></div>
        <div className="stat-card"><div className="stat-card__label">Skipped (already exists)</div><div className="stat-card__value">{syncResult.skipped}</div></div>
        <div className="stat-card"><div className="stat-card__label">Days Updated</div><div className="stat-card__value">{syncResult.days_updated}</div></div>
        <div className="stat-card"><div className="stat-card__label">Errors</div><div className={`stat-card__value ${syncResult.errors?.length ? 'negative' : ''}`}>{syncResult.errors?.length || 0}</div></div>
      </div>
      {syncResult.message && <p style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 8 }}>{syncResult.message}</p>}
      {syncResult.entity_counts && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {Object.entries(syncResult.entity_counts).map(([k, v]) => (
          <span key={k}><code style={{ color: v > 0 ? 'var(--accent)' : 'var(--text-3)' }}>{k}: {v}</code></span>
        ))}
      </div>}
      {syncResult.errors?.length > 0 && <div style={{ marginTop: 12 }}>
        <p style={{ fontSize: 12, color: 'var(--amber)', marginBottom: 6 }}>Errors:</p>
        {syncResult.errors.map((e, i) => <div key={i} style={{ fontSize: 12, color: 'var(--text-3)', padding: '3px 0' }}>{e}</div>)}
      </div>}
      {syncResult.imported > 0 && <button className="btn btn--primary" style={{ marginTop: 16 }} onClick={() => onOpenDay && window.location.reload()}>
        Go to Trade Days →
      </button>}
    </div>}
  </>;
}

// ── Day Analyses Tab — shows linked analyze sessions ──────
function DayAnalysesTab({ dayId, onOpenDay, setStatus }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // Filter history by day_id using the existing history endpoint
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

  if (loading) return <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--text-3)', padding: 32 }}><Loader2 size={16} className="spin" /> Loading analyses…</div>;

  if (selected) return <>
    <button className="detail-back" onClick={() => setSelected(null)}><ChevronLeft size={16} /> Back to list</button>
    <AnalysisResultCards result={selected} onOpenDay={onOpenDay} />
  </>;

  if (sessions.length === 0) return <div className="empty-state"><Zap size={32} /><p>No analyze sessions linked to this day yet. Use the Analyze page and select this date to link one.</p></div>;

  return <div className="analyze-history-list">
    {sessions.map(s => {
      const ca = s.chart_analysis || {};
      return (
        <button key={s.id} className="history-card" onClick={() => openSession(s.id)}>
          {s.url && <div className="history-card__thumb"><img src={s.url} alt={s.filename} loading="lazy" /></div>}
          <div className="history-card__body">
            <div className="history-card__top">
              <span className="pattern-chip" style={{ background: TYPE_COLORS[s.analysis_type] + '22', color: TYPE_COLORS[s.analysis_type], fontSize: 11 }}>{TYPE_LABELS[s.analysis_type]}</span>
              <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 'auto' }}>{fmtTs(s.created_at)}</span>
            </div>
            {ca.summary && <p className="history-card__summary">{ca.summary.slice(0, 120)}</p>}
            <div className="history-card__meta">
              {ca.directional_bias && <span className="history-card__tag">{ca.directional_bias}</span>}
              {ca.pattern_tags?.slice(0, 3).map(t => <span key={t} className="history-card__tag">{t.replace(/_/g, ' ')}</span>)}
            </div>
            {s.notes && <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>{s.notes}</p>}
          </div>
          <ChevronRight size={14} />
        </button>
      );
    })}
  </div>;
}

function TradeTable({ rows }) {
  if (!rows.length) return null;
  const keys = [...new Set(rows.flatMap(r => Object.keys(r.row_data || {})))];
  if (!keys.length) return <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: 'var(--text-2)' }}>{JSON.stringify(rows, null, 2)}</pre>;
  return <table className="trade-table"><thead><tr>{keys.map(k => <th key={k}>{k}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={r.id || i}>{keys.map(k => <td key={k}>{String(r.row_data?.[k] ?? '')}</td>)}</tr>)}</tbody></table>;
}

createRoot(document.getElementById('root')).render(<App />);
