import React, { useEffect, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Upload, Brain, Link2, Save, Search, Plus, ChevronRight, Sparkles, FileText, BarChart3, Calendar, Tag, X, Loader2, ArrowUpRight } from 'lucide-react';
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

/* ── Utility ─────────────────────────────── */
function formatDate(d) {
  if (!d) return '';
  const date = new Date(d + 'T00:00:00');
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function StatusToast({ status, onClear }) {
  if (!status) return null;
  const isError = status.toLowerCase().includes('fail') || status.toLowerCase().includes('error');
  const isLoading = status.includes('...') ;
  return (
    <div className={`toast ${isError ? 'toast--error' : isLoading ? 'toast--loading' : 'toast--success'}`}>
      {isLoading && <Loader2 size={14} className="spin" />}
      <span>{status}</span>
      {!isLoading && <button className="toast__close" onClick={onClear}><X size={12} /></button>}
    </div>
  );
}

/* ── Field ───────────────────────────────── */
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

/* ── Upload slot ─────────────────────────── */
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

/* ── Intelligence panel ──────────────────── */
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

  function emptyDraft() {
    return { trade_date: new Date().toISOString().slice(0, 10), title: '', tickers: '', strategy: '', session: '', market_bias: '', premarket_notes: '', trade_notes: '', ideal_notes: '', lessons: '', tags: '', mood: '' };
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

  const d = (k, v) => setDraft({ ...draft, [k]: v });
  const hasIntel = (day) => !!(day.ai_summary);

  const tabs = [
    { id: 'journal', label: 'Journal', icon: FileText },
    { id: 'charts', label: 'Charts', icon: BarChart3 },
    { id: 'intel', label: 'Intelligence', icon: Sparkles },
  ];

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
                {hasIntel(dy) && <span className="day-card__intel" title="Intelligence complete"><Sparkles size={11} /></span>}
              </div>
              <span className="day-card__ticker">{dy.tickers || dy.title || 'Untitled'}</span>
              {dy.tags && <span className="day-card__tags"><Tag size={10} />{dy.tags}</span>}
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
            <button className="btn btn--primary" onClick={save}><Save size={14} /> Save</button>
            {selected && <button className="btn btn--accent" onClick={intelligence}><Brain size={14} /> Run Intelligence</button>}
            {selected && <button className="btn btn--ghost" onClick={similar}><Link2 size={14} /> Find Similar</button>}
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
                    <div className="trade-table-wrap">
                      <TradeTable rows={bundle.trade_rows.slice(0, 30)} />
                    </div>
                  </section>
                )}
              </>
            ) : (
              <div className="empty-state">
                <BarChart3 size={32} />
                <p>Save a day first, then upload charts and trade data here.</p>
              </div>
            )}
          </div>
        )}

        {/* ── Intelligence Tab ───────── */}
        {tab === 'intel' && (
          <div className="panel intel-panel">
            {bundle ? (
              <>
                <section className="section">
                  <h3 className="section__title">AI Analysis</h3>
                  {bundle.day.ai_summary ? (
                    <div className="intel-summary">
                      <p>{bundle.day.ai_summary}</p>
                    </div>
                  ) : (
                    <div className="empty-state empty-state--compact">
                      <Brain size={24} />
                      <p>No analysis yet. Click "Run Intelligence" to generate insights from your notes and uploads.</p>
                    </div>
                  )}
                </section>

                <IntelPanel label="Market Structure" data={bundle.day.ai_market_structure} />
                <IntelPanel label="Execution Review" data={bundle.day.ai_execution_review} />

                {bundle.patterns.length > 0 && (
                  <section className="section">
                    <h3 className="section__title">Matched Patterns</h3>
                    <div className="pattern-list">
                      {bundle.patterns.map(p => (
                        <div className="pattern-chip" key={p.id}>
                          <span className="pattern-chip__name">{p.name}</span>
                          {p.confidence != null && <span className="pattern-chip__conf">{Math.round(p.confidence * 100)}%</span>}
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {bundle.similar.length > 0 && (
                  <section className="section">
                    <h3 className="section__title">Similar Days</h3>
                    <div className="similar-list">
                      {bundle.similar.map(s => (
                        <button className="similar-card" key={s.id} onClick={() => { openDay(s.matched_day_id); setTab('journal'); }}>
                          <div className="similar-card__top">
                            <span className="similar-card__date">{formatDate(s.trade_date)}</span>
                            <span className="similar-card__score">{Math.round((s.similarity_score || 0) * 100)}% match</span>
                          </div>
                          <span className="similar-card__ticker">{s.tickers} {s.title}</span>
                          <ChevronRight size={14} className="similar-card__arrow" />
                        </button>
                      ))}
                    </div>
                  </section>
                )}
              </>
            ) : (
              <div className="empty-state">
                <Sparkles size={32} />
                <p>Select or create a day to view intelligence.</p>
              </div>
            )}
          </div>
        )}
      </main>

      <StatusToast status={status} onClear={() => setStatus('')} />
    </div>
  );
}

/* ── Trade table ─────────────────────────── */
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
