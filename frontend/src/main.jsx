// ── LUXE CAPITAL — Trade Intelligence · Vitrine Shell ──────────────────
import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import './legacy.css';
import './app.css';
import './vitrine.css';
import { api } from './api.js';
import { Toast, Lightbox } from './ui.jsx';
import { ordinalDayWord } from './vitrine.js';
import TodayPage from './pages/Today.jsx';
import JournalPage from './pages/Journal.jsx';
import StatsPage from './pages/Stats.jsx';
import AnalyzePage from './pages/Analyze.jsx';
import DetailPage from './pages/Detail.jsx';
import IntelPage from './pages/Intel.jsx';
import PatternsPage from './pages/Patterns.jsx';
import SyncPage from './pages/Sync.jsx';
import SettingsPage from './pages/Settings.jsx';

/* ── Ambient: WebGL ocean ─────────────────────────────────────────── */
function Ocean() {
  const ref = useRef();
  useEffect(() => {
    const OCEAN_LEVEL = 0.06;
    const cv = ref.current;
    const gl = cv.getContext('webgl', { alpha: true, premultipliedAlpha: true });
    if (!gl) { cv.remove(); return; }
    const vsrc = `attribute vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`;
    const fsrc = `
      precision mediump float;
      uniform float t; uniform vec2 res; uniform float level;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        vec2 u = f*f*(3.-2.*f);
        return mix(mix(hash(i), hash(i+vec2(1.,0.)), u.x),
                   mix(hash(i+vec2(0.,1.)), hash(i+vec2(1.,1.)), u.x), u.y);
      }
      void main(){
        vec2 uv = gl_FragCoord.xy / res;
        vec3 mint = vec3(0.553, 0.961, 0.784);
        float a = 0.0;
        for (int i = 0; i < 3; i++) {
          float fi = float(i);
          float speed = 0.055 + fi * 0.02;
          float baseY = 0.16 + fi * 0.21;
          float y = baseY
            + sin(uv.x * (5.0 + fi*1.8) + t * speed * 6.2831 + fi*2.3) * (0.022 + fi*0.01)
            + sin(uv.x * (11.0 - fi*2.0) - t * speed * 4.4 + fi*5.1) * 0.011
            + (noise(vec2(uv.x * 3.0 + t * speed * 1.6, fi * 7.0)) - 0.5) * 0.05;
          float d = uv.y - y;
          float crest = exp(-abs(d) * 110.0) * 0.55;
          float body  = smoothstep(0.02, -0.4, d) * 0.30;
          a += (crest + body) * (1.0 - fi * 0.3);
        }
        a += noise(uv * vec2(90.0, 30.0) + vec2(t*0.4, 0.)) * 0.05 * smoothstep(0.6, 0.0, uv.y);
        a *= smoothstep(1.0, 0.3, uv.y);
        a = min(a, 1.0) * level;
        gl_FragColor = vec4(mint * a, a);
      }`;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vsrc));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fsrc));
    gl.linkProgram(prog); gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uT = gl.getUniformLocation(prog, 't');
    const uR = gl.getUniformLocation(prog, 'res');
    const uL = gl.getUniformLocation(prog, 'level');
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const size = () => {
      const dpr = Math.min(devicePixelRatio || 1, 1.5);
      cv.width = innerWidth * dpr;
      cv.height = innerHeight * 0.32 * dpr;
      gl.viewport(0, 0, cv.width, cv.height);
    };
    size();
    addEventListener('resize', size);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf;
    const frame = now => {
      gl.uniform1f(uT, reduce ? 0 : now * 0.001);
      gl.uniform2f(uR, cv.width, cv.height);
      gl.uniform1f(uL, OCEAN_LEVEL);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!reduce) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); removeEventListener('resize', size); };
  }, []);
  return <canvas id="ocean" ref={ref} aria-hidden="true" />;
}

/* ── Ambient: drifting dust motes ─────────────────────────────────── */
function Dust() {
  const motes = useRef(
    Array.from({ length: 14 }, () => ({
      left: Math.random() * 100,
      top: 20 + Math.random() * 80,
      o: (0.1 + Math.random() * 0.3).toFixed(2),
      dx: (Math.random() * 60 - 30) + 'px',
      dur: (14 + Math.random() * 18) + 's',
      delay: (-Math.random() * 20) + 's',
    }))
  ).current;
  return (
    <div className="dust" aria-hidden="true">
      {motes.map((m, i) => (
        <i key={i} style={{ left: m.left + '%', top: m.top + '%', '--o': m.o, '--dx': m.dx, animationDuration: m.dur, animationDelay: m.delay }} />
      ))}
    </div>
  );
}

/* ── Ambient: parallax ghost word ─────────────────────────────────── */
function Ghost({ word }) {
  const ref = useRef();
  useEffect(() => {
    const onMove = e => {
      if (!ref.current) return;
      const dx = (e.clientX / innerWidth - 0.5) * 40;
      const dy = (e.clientY / innerHeight - 0.5) * 26;
      ref.current.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    };
    addEventListener('mousemove', onMove);
    return () => removeEventListener('mousemove', onMove);
  }, []);
  return <div className="ghost-word" ref={ref} aria-hidden="true">{word}</div>;
}

function App() {
  // ── Core state ──────────────────────────────────────
  const [page, setPage] = useState('today');
  const [pageKey, setPageKey] = useState(0); // remount to replay entrance choreography
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
  const [analyzeTab, setAnalyzeTab] = useState('upload');
  const [analyzeResult, setAnalyzeResult] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeConfig, setAnalyzeConfig] = useState({
    analysis_type: 'premarket',
    trade_date: new Date().toISOString().slice(0, 10),
    notes: '', focus: '', link_to_day: false,
  });
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedSession, setSelectedSession] = useState(null);

  function emptyDraft() { return { trade_date: new Date().toISOString().slice(0, 10), title: '', tickers: '', strategy: '', session: '', market_bias: '', premarket_notes: '', trade_notes: '', ideal_notes: '', lessons: '', tags: '', mood: '', pnl: null, num_trades: null, win_count: null, loss_count: null }; }
  const d = (k, v) => setDraft({ ...draft, [k]: v });
  const qf = (k, v) => setQueryFilters({ ...queryFilters, [k]: v });
  const ac = (k, v) => setAnalyzeConfig(c => ({ ...c, [k]: v }));

  const load = async () => { try { setDays(await api('/days' + (q ? `?q=${encodeURIComponent(q)}` : ''))); } catch (e) { setStatus('Error: ' + e.message); } };
  const loadStats = async () => { try { setStats(await api('/stats')); } catch {} };
  const loadPatterns = async () => { try { setPatterns(await api('/patterns')); } catch {} };
  const loadCalendar = async (year, month0) => { try { setCalendarData(await api(`/calendar?year=${year}&month=${month0 + 1}`)); } catch {} };
  const calPrev = () => { const dt = new Date(calView.year, calView.month - 1, 1); const v = { year: dt.getFullYear(), month: dt.getMonth() }; setCalView(v); loadCalendar(v.year, v.month); };
  const calNext = () => { const dt = new Date(calView.year, calView.month + 1, 1); const v = { year: dt.getFullYear(), month: dt.getMonth() }; setCalView(v); loadCalendar(v.year, v.month); };
  const openDay = async (id) => { try { setSelected(id); const b = await api('/days/' + id); setBundle(b); setDraft(b.day); switchPage('detail'); setDetailTab('overview'); } catch (e) { setStatus('Error: ' + e.message); } };

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
      setSelectedSession({
        ...s,
        chart_analysis: s.chart_analysis || {},
        similar_days: s.similar_days || [],
        stats: s.stats || {},
        recommendation: s.recommendation || {},
        day_id: s.day_id, trade_date: s.trade_date, created_at: s.created_at,
      });
    } catch (e) { setStatus('Failed to load session: ' + e.message); }
  };

  const deleteSession = async (id) => {
    if (!confirm('Delete this analysis session?')) return;
    try { await api(`/analyze/sessions/${id}`, { method: 'DELETE' }); setHistory(h => h.filter(s => s.id !== id)); if (selectedSession?.id === id) setSelectedSession(null); setStatus('Deleted'); }
    catch (e) { setStatus('Failed: ' + e.message); }
  };

  useEffect(() => { load(); loadStats(); loadPatterns(); loadCalendar(calView.year, calView.month); }, []);
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
  const deleteDay = async () => { if (!selected || !confirm('Delete this day and all data?')) return; try { await api(`/days/${selected}`, { method: 'DELETE' }); setSelected(null); setBundle(null); switchPage('journal'); await load(); await loadStats(); setStatus('Deleted'); } catch (e) { setStatus('Failed: ' + e.message); } };
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

  const newDay = () => { setSelected(null); setBundle(null); setDraft(emptyDraft()); switchPage('detail'); setDetailTab('edit'); };
  const day = bundle?.day;

  // ── Build / unbuild page transitions ────────────────
  const [leaving, setLeaving] = useState(false);
  const switchPage = (p) => {
    if (p === page || leaving) return;
    setLeaving(true);                       // the room unbuilds…
    setTimeout(() => {
      setPage(p);
      setPageKey(k => k + 1);               // …and the next one builds
      if (p === 'journal' || p === 'today') load();
      if (p === 'today' || p === 'stats') loadStats();
      if (p === 'patterns') loadPatterns();
      if (p === 'stats') loadCalendar(calView.year, calView.month);
      window.scrollTo({ top: 0 });
      setLeaving(false);
    }, 560);
  };

  // ghost word follows the room
  const latestDay = (days || [])[0];
  const ghostWords = {
    today: latestDay ? ordinalDayWord(Number((latestDay.trade_date || '').split('-')[2] || 1)) : 'Luxe',
    journal: 'Journal', stats: 'Record', analyze: 'Analyze',
    intel: 'Inquiry', patterns: 'Edge', sync: 'Ledger', settings: 'House', detail: 'Session',
  };

  const NAV = [
    ['today', 'Today'], ['journal', 'Journal'], ['stats', 'Statistics'],
    ['analyze', 'Analyze'], ['intel', 'Intelligence'], ['patterns', 'Patterns'],
    ['sync', 'Sync'], ['settings', 'Settings'],
  ];

  const todayStr = new Date().toLocaleDateString('en-US', { weekday: 'short', month: '2-digit', day: '2-digit' }).toUpperCase().replace(',', '');

  return (
    <>
      {/* atmosphere */}
      <Ocean />
      <Dust />
      <Ghost word={ghostWords[page] || 'Luxe'} />
      <div className="vignette" aria-hidden="true" />


      <div className="lc-shell">
        <nav className="lc-top">
          <div className="wm" onClick={() => switchPage('today')} style={{ cursor: 'pointer' }}>Luxe <i>Capital</i></div>
          <div className="links">
            {NAV.map(([id, label]) => (
              <a key={id} className={(page === id || (page === 'detail' && id === 'journal')) ? 'on' : ''}
                onClick={() => switchPage(id)}>{label}</a>
            ))}
          </div>
          <div className="lc-date">{todayStr} · NY</div>
        </nav>

        <main className={`lc-main ${leaving ? 'page-out' : ''}`} key={pageKey}>
          {page === 'today' && <TodayPage stats={stats} days={days} openDay={openDay} goPage={switchPage} />}

          {page === 'journal' && <JournalPage openDay={openDay} setStatus={setStatus} />}

          {page === 'stats' && <StatsPage stats={stats}
            calendarData={calendarData} calView={calView} calPrev={calPrev} calNext={calNext}
            openDay={openDay} />}

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

          {page === 'detail' && <DetailPage
            selected={selected} bundle={bundle} draft={draft} d={d} day={day}
            detailTab={detailTab} setDetailTab={setDetailTab}
            save={save} intelligence={intelligence} findSimilar={findSimilar} deleteDay={deleteDay}
            upload={upload} setLightbox={setLightbox} setPage={switchPage} load={load} openDay={openDay} setStatus={setStatus}
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
            qf={qf} setPage={switchPage}
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
