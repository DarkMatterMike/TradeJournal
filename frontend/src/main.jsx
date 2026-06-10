// ── EDGE — Trade Intelligence · App Shell ──────────────────────────────
import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import './app.css';
import { api, fmt, pnl$, pct } from './api.js';
import { Ribbon, Toast, Lightbox } from './ui.jsx';
import Dashboard from './pages/Dashboard.jsx';
import AnalyzePage from './pages/Analyze.jsx';
import DaysPage from './pages/Days.jsx';
import DetailPage from './pages/Detail.jsx';
import IntelPage from './pages/Intel.jsx';
import PatternsPage from './pages/Patterns.jsx';
import SyncPage from './pages/Sync.jsx';
import SettingsPage from './pages/Settings.jsx';

function App() {
  // ── Core state ──────────────────────────────────────
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

  // ── Calendar state ──────────────────────────────────
  const [calendarData, setCalendarData] = useState([]);
  const [calView, setCalView] = useState({ year: new Date().getFullYear(), month: new Date().getMonth() });

  // ── Analyze state ───────────────────────────────────
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
  const calPrev = () => { const dt = new Date(calView.year, calView.month - 1, 1); const v = { year: dt.getFullYear(), month: dt.getMonth() }; setCalView(v); loadCalendar(v.year, v.month); };
  const calNext = () => { const dt = new Date(calView.year, calView.month + 1, 1); const v = { year: dt.getFullYear(), month: dt.getMonth() }; setCalView(v); loadCalendar(v.year, v.month); };
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
      setStatus('Analysis complete');
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

  // ── Telemetry ribbon — built from live data ─────────
  const latest = (days || []).find(dy => dy.pnl != null) || (days || [])[0];
  const weekPnl = (days || []).slice(0, 7).reduce((a, dy) => a + (dy.pnl || 0), 0);
  const topPattern = (stats?.top_patterns || [])[0];
  const ribbonItems = [
    latest && { k: 'SESSION', v: fmt(latest.trade_date).toUpperCase() },
    ov.total_pnl != null && { k: 'NET', v: pnl$(ov.total_pnl), tone: ov.total_pnl > 0 ? 'u' : ov.total_pnl < 0 ? 'd' : '' },
    ov.total_days != null && { k: 'DAYS', v: String(ov.total_days) },
    ov.win_rate != null && { k: 'WIN RATE', v: pct(ov.win_rate), tone: 'v' },
    ov.best_day?.pnl != null && { k: 'BEST', v: pnl$(ov.best_day.pnl), tone: 'u' },
    ov.worst_day?.pnl != null && { k: 'WORST', v: pnl$(ov.worst_day.pnl), tone: 'd' },
    ov.avg_score != null && { k: 'EXEC SCORE', v: String(Math.round(ov.avg_score)), tone: 'v' },
    days?.length > 0 && { k: 'WEEK P&L', v: pnl$(weekPnl), tone: weekPnl > 0 ? 'u' : weekPnl < 0 ? 'd' : '' },
    topPattern && { k: 'PATTERN', v: topPattern.name.toUpperCase() },
    latest?.tickers && { k: 'TICKERS', v: latest.tickers.toUpperCase() },
  ].filter(Boolean);
  if (ribbonItems.length === 0) ribbonItems.push({ k: 'EDGE', v: 'TRADE INTELLIGENCE SYSTEM', tone: 'v' });

  // ── Rail nav — concept icons verbatim ───────────────
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', svg: <svg viewBox="0 0 24 24"><path d="M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10" /></svg> },
    { id: 'analyze', label: 'Analyze', svg: <svg viewBox="0 0 24 24"><path d="M13 2L4.5 13.5H11L9.5 22 19 10h-6.5L13 2z" /></svg> },
    { id: 'days', label: 'Trade Days', svg: <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg> },
    { id: 'intel', label: 'Intelligence', svg: <svg viewBox="0 0 24 24"><path d="M12 3a6 6 0 016 6c0 2.5-1.5 4-2.5 5.5-.6.9-.5 1.5-.5 2.5h-6c0-1 .1-1.6-.5-2.5C7.5 13 6 11.5 6 9a6 6 0 016-6zM9.5 20h5M10.5 22h3" /></svg> },
    { id: 'patterns', label: 'Patterns', svg: <svg viewBox="0 0 24 24"><path d="M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-6z" /></svg> },
    { id: 'sync', label: 'Tradovate Sync', svg: <svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 01-15.5 6.2M3 12a9 9 0 0115.5-6.2M3 18v-5h5M21 6v5h-5" /></svg> },
    { id: 'settings', label: 'Settings', svg: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 01-.1 1.2l2 1.6-2 3.4-2.4-1a7 7 0 01-2 1.2L14 21h-4l-.5-2.6a7 7 0 01-2-1.2l-2.4 1-2-3.4 2-1.6A7 7 0 015 12a7 7 0 01.1-1.2l-2-1.6 2-3.4 2.4 1a7 7 0 012-1.2L10 3h4l.5 2.6a7 7 0 012 1.2l2.4-1 2 3.4-2 1.6c.07.4.1.8.1 1.2z" /></svg> },
  ];

  return (
    <>
      {/* atmosphere */}
      <div className="field" aria-hidden="true" />
      <div className="grid-lines" aria-hidden="true" />

      {/* telemetry ribbon */}
      <Ribbon items={ribbonItems} />

      <div className="shell">
        {/* rail */}
        <nav className="rail">
          <div className="rail__mark">
            <svg viewBox="0 0 16 16" fill="none"><polyline points="1.5,12 5,6 8,9 11.5,3.5 14.5,6.5" stroke="#000" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          {navItems.map(n => (
            <button
              key={n.id}
              className={`rail__btn ${(page === n.id || (page === 'detail' && n.id === 'days')) ? 'on' : ''}`}
              title={n.label}
              onClick={() => { setPage(n.id); if (n.id === 'days') load(); if (n.id === 'dashboard') { loadStats(); load(); } if (n.id === 'patterns') loadPatterns(); }}
            >{n.svg}</button>
          ))}
          <div className="rail__word">EDGE — TRADE INTELLIGENCE</div>
        </nav>

        {/* main */}
        <main className="main">
          {page === 'dashboard' && <Dashboard
            stats={stats} days={days} patterns={patterns}
            calendarData={calendarData} calView={calView} calPrev={calPrev} calNext={calNext}
            openDay={openDay} setPage={setPage}
          />}

          {page === 'analyze' && <AnalyzePage
            analyzeTab={analyzeTab} setAnalyzeTab={setAnalyzeTab}
            analyzeConfig={analyzeConfig} ac={ac}
            analyzing={analyzing} runAnalysis={runAnalysis}
            analyzeResult={analyzeResult}
            history={history} historyLoading={historyLoading} loadHistory={loadHistory}
            selectedSession={selectedSession} setSelectedSession={setSelectedSession}
            openSession={openSession} deleteSession={deleteSession}
            openDay={openDay}
          />}

          {page === 'days' && <DaysPage
            days={days} q={q} setQ={setQ} load={load} newDay={newDay} openDay={openDay}
          />}

          {page === 'detail' && <DetailPage
            selected={selected} bundle={bundle} draft={draft} d={d} day={day}
            detailTab={detailTab} setDetailTab={setDetailTab}
            save={save} intelligence={intelligence} findSimilar={findSimilar} deleteDay={deleteDay}
            upload={upload} setLightbox={setLightbox} setPage={setPage} load={load} openDay={openDay} setStatus={setStatus}
          />}

          {page === 'intel' && <IntelPage
            queryFilters={queryFilters} qf={qf} runQuery={runQuery} queryResult={queryResult}
            openDay={openDay} setStatus={setStatus}
            onBulkDone={() => { load(); loadStats(); loadPatterns(); }}
          />}

          {page === 'patterns' && <PatternsPage
            patterns={patterns}
            editingPattern={editingPattern} setEditingPattern={setEditingPattern}
            patternDraft={patternDraft} setPatternDraft={setPatternDraft}
            savePattern={savePattern} deletePattern={deletePattern} createNewPattern={createNewPattern}
            qf={qf} setPage={setPage}
          />}

          {page === 'sync' && <SyncPage onOpenDay={openDay} setStatus={setStatus} />}
          {page === 'settings' && <SettingsPage setStatus={setStatus} />}
        </main>
      </div>

      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
      <Toast status={status} onClear={() => setStatus('')} />
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
