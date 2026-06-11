// ── LUXE CAPITAL · Journal — the complete catalogue ────────────────────
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { api, pnl$, pnlC, API } from '../api.js';
import { dateToWords, weekdayOf, numberWord, roman, fmtClockShort } from '../vitrine.js';

const PRODUCT_NAMES = {
  MNQ: 'Micro E-mini Nasdaq', NQ: 'E-mini Nasdaq',
  MES: 'Micro E-mini S&P', ES: 'E-mini S&P',
  MYM: 'Micro E-mini Dow', YM: 'E-mini Dow',
  M2K: 'Micro E-mini Russell', RTY: 'E-mini Russell',
};
const prodName = t => PRODUCT_NAMES[(t.product || '').toUpperCase()] || t.symbol || t.product || 'Instrument';

export default function JournalPage({ openDay, setStatus }) {
  const [rooms, setRooms] = useState(null);
  const [filter, setFilter] = useState('all');
  const [drawer, setDrawer] = useState(null); // { trade, day }
  const [drawerOpen, setDrawerOpen] = useState(false);

  const load = () => api('/journal').then(setRooms).catch(e => { setRooms([]); setStatus('Journal failed: ' + e.message); });
  useEffect(() => { load(); }, []);

  const products = useMemo(() => {
    const s = new Set();
    (rooms || []).forEach(r => (r.trades || []).forEach(t => t.product && s.add(t.product.toUpperCase())));
    return [...s].slice(0, 4);
  }, [rooms]);

  const passes = t => {
    if (filter === 'wins') return t.pnl > 0;
    if (filter === 'losses') return t.pnl < 0;
    if (filter !== 'all') return (t.product || '').toUpperCase() === filter;
    return true;
  };

  const openTrade = (trade, day) => { setDrawer({ trade, day }); requestAnimationFrame(() => setDrawerOpen(true)); };
  const closeTrade = () => { setDrawerOpen(false); setTimeout(() => setDrawer(null), 480); };

  const visible = (rooms || [])
    .map(r => ({ ...r, shown: (r.trades || []).filter(passes) }))
    .filter(r => r.shown.length > 0 || (filter === 'all' && (r.trades || []).length === 0 && r.pnl != null));

  return (
    <div>
      <div className="jrnl-head">
        <div className="over">A Complete Record of Execution</div>
        <h1 className="reveal"><span className="w"><span style={{ animationDelay: '0.3s' }}>The</span></span> <span className="w"><span style={{ animationDelay: '0.42s' }}>Journal</span></span></h1>
        <div className="sub">— every trade, catalogued by session —</div>
      </div>

      <div className="jrnl-filters">
        <button className={`vfilter ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>All Trades</button>
        <button className={`vfilter ${filter === 'wins' ? 'on' : ''}`} onClick={() => setFilter('wins')}>Wins</button>
        <button className={`vfilter ${filter === 'losses' ? 'on' : ''}`} onClick={() => setFilter('losses')}>Losses</button>
        {products.map(p => (
          <button key={p} className={`vfilter ${filter === p ? 'on' : ''}`} onClick={() => setFilter(p)}>{p}</button>
        ))}
      </div>

      {rooms === null && <div className="jrnl-empty">— retrieving the record —</div>}
      {rooms !== null && visible.length === 0 && <div className="jrnl-empty">— nothing in the catalogue under this filter —</div>}

      {visible.map((room, ri) => {
        const count = room.shown.length;
        return (
          <div className="room" key={room.id} style={{ animationDelay: `${0.15 + ri * 0.1}s` }}>
            <div className="room__head" style={{ animationDelay: `${0.15 + ri * 0.1}s` }}>
              <span className="room__title" onClick={() => openDay(room.id)} title="Open full day">{dateToWords(room.trade_date)}</span>
              <span className="room__date">{weekdayOf(room.trade_date)} · NY Session</span>
              <span className="room__rule" />
              <span className="room__count">{count ? `${numberWord(count)} trade${count === 1 ? '' : 's'}` : 'No trades'}</span>
              <span className="room__net" style={{ color: room.pnl > 0 ? 'var(--up)' : room.pnl < 0 ? 'var(--dn)' : 'var(--txt-3)' }}>{room.pnl != null ? pnl$(room.pnl) : '—'}</span>
            </div>

            {count > 0 && <>
              <div className="lot-th">
                <span>Trade</span><span>Time</span><span>Instrument</span><span>Side</span>
                <span className="r">Entry</span><span className="r">Exit</span><span className="r">Net</span>
              </div>
              {room.shown.map((t, i) => (
                <div className="lot-row" key={t.id || i} style={{ animationDelay: `${0.25 + ri * 0.1 + i * 0.05}s` }}
                  onClick={() => openTrade(t, room)}>
                  <span className="lot">{roman(i + 1)}</span>
                  <span className="time">{fmtClockShort(t.entry_time)}</span>
                  <span className="desc">{prodName(t)}<small>{t.symbol}{t.qty ? ` · ${numberWord(t.qty).toLowerCase()} contract${t.qty > 1 ? 's' : ''}` : ''}{t.notes ? ` · ${t.notes.slice(0, 48)}${t.notes.length > 48 ? '…' : ''}` : ''}</small></span>
                  <span className="side">{(t.side || '').toUpperCase()}</span>
                  <span className="px">{t.entry_price != null ? Number(t.entry_price).toFixed(2) : '—'}</span>
                  <span className="px">{t.exit_price != null ? Number(t.exit_price).toFixed(2) : '—'}</span>
                  <span className={`pnl p ${pnlC(t.pnl)}`}>{t.pnl != null ? pnl$(t.pnl).replace('+$', '+').replace('−$', '−') : '—'}</span>
                </div>
              ))}
            </>}
          </div>
        );
      })}

      <div className="colophon">
        <span className="orn">❦</span>
        All figures net of commission · Catalogued by Luxe Intelligence
      </div>

      {drawer && <TradeDrawer open={drawerOpen} trade={drawer.trade} day={drawer.day}
        onClose={closeTrade} openDay={openDay} setStatus={setStatus} onSaved={load} />}
    </div>
  );
}

/* ── Trade detail drawer ─────────────────────────────────────────────── */
function TradeDrawer({ open, trade, day, onClose, openDay, setStatus, onSaved }) {
  const [notes, setNotes] = useState(trade.notes || '');
  const [saving, setSaving] = useState(false);
  const [uploads, setUploads] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const fileRef = useRef();

  useEffect(() => {
    api('/days/' + day.id)
      .then(b => setUploads((b.uploads || []).filter(u => (u.content_type || '').startsWith('image') || /\.(png|jpe?g|webp|gif)$/i.test(u.filename || ''))))
      .catch(() => setUploads([]));
  }, [day.id]);

  const saveNotes = async () => {
    setSaving(true);
    try {
      await api('/trades/' + trade.id, { method: 'PATCH', body: JSON.stringify({ notes }) });
      setStatus('Trade notes saved');
      onSaved && onSaved();
    } catch (e) { setStatus('Save failed: ' + e.message); }
    finally { setSaving(false); }
  };

  const uploadChart = async file => {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('kind', 'trade'); fd.append('file', file); fd.append('run_ai', 'false');
      await api(`/days/${day.id}/upload`, { method: 'POST', body: fd });
      const b = await api('/days/' + day.id);
      setUploads((b.uploads || []).filter(u => (u.content_type || '').startsWith('image') || /\.(png|jpe?g|webp|gif)$/i.test(u.filename || '')));
      setStatus('Chart uploaded');
    } catch (e) { setStatus('Upload failed: ' + e.message); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const spec = [
    ['Instrument', `${prodName(trade)} (${trade.symbol || '—'})`],
    ['Side', (trade.side || '—').toUpperCase()],
    ['Quantity', trade.qty != null ? `${trade.qty} contract${trade.qty > 1 ? 's' : ''}` : '—'],
    ['Entry', trade.entry_price != null ? `${Number(trade.entry_price).toFixed(2)} · ${fmtClockShort(trade.entry_time)}` : '—'],
    ['Exit', trade.exit_price != null ? `${Number(trade.exit_price).toFixed(2)} · ${fmtClockShort(trade.exit_time)}` : '—'],
    trade.gross_pnl != null && ['Gross', pnl$(trade.gross_pnl)],
    trade.commission != null && ['Commission', '−$' + Math.abs(trade.commission).toFixed(2)],
    ['Source', trade.source === 'tradovate_csv' ? 'Tradovate · CSV' : (trade.source || 'Manual')],
  ].filter(Boolean);

  return (
    <>
      <div className={`tdrawer-back ${open ? 'on' : ''}`} onClick={onClose} />
      <aside className={`tdrawer ${open ? 'on' : ''}`}>
        <button className="tdrawer__close" onClick={onClose} title="Close">×</button>

        <div className="over">From the session of {dateToWords(day.trade_date)}</div>
        <h2>{prodName(trade)}</h2>
        <div className="when">{(trade.side || '').toUpperCase()} · {weekdayOf(day.trade_date).toUpperCase()} · ENTERED {fmtClockShort(trade.entry_time)}</div>

        <div className="tdrawer__net" style={{ color: trade.pnl > 0 ? 'var(--up)' : trade.pnl < 0 ? 'var(--dn)' : 'var(--txt)' }}>
          {trade.pnl != null ? pnl$(trade.pnl) : '—'}
        </div>

        <div className="tspec">
          {spec.map(([k, v]) => (
            <div className="tspec__row" key={k}><span className="k">{k}</span><span className="v">{v}</span></div>
          ))}
        </div>

        <div className="sec-head"><span className="num">i.</span><h3>Notes</h3><span className="rule" /></div>
        <textarea className="tnotes" value={notes} onChange={e => setNotes(e.target.value)}
          placeholder="— annotations on this trade: setup, reasoning, what the chart was saying —" />
        <button className="v-btn" style={{ marginTop: 12 }} onClick={saveNotes} disabled={saving}>
          <span>{saving ? 'Inscribing…' : 'Save Notes'}</span>
        </button>

        <div className="sec-head"><span className="num">ii.</span><h3>Charts</h3><span className="rule" /><span className="aux">{day.trade_date}</span></div>
        <div className="tcharts">
          {(uploads || []).map(u => (
            <div className="tchart" key={u.id} onClick={() => setLightbox(u.url)}>
              <img src={u.url} alt={u.filename} loading="lazy" />
              <span className="kind">{u.kind}</span>
            </div>
          ))}
          <label className="tupload">
            <span className="plus">+</span>{uploading ? 'Uploading…' : 'Add Chart'}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => uploadChart(e.target.files[0])} />
          </label>
        </div>

        <div className="tdrawer__foot">
          <button className="v-btn" onClick={() => { onClose(); openDay(day.id); }}><span>Open Full Day →</span></button>
        </div>
      </aside>

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)} style={{ zIndex: 200 }}>
          <img src={lightbox} alt="chart" />
        </div>
      )}
    </>
  );
}
