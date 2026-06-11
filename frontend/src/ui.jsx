import React, { useEffect } from 'react';
import { Loader2, X } from 'lucide-react';
import { pnl$, pnlC, MONTHS } from './api';

/* ── Eyebrow ─────────────────────────────────────── */
export function Eyebrow({ idx, label, right, rule, style }) {
  return (
    <div className="eyebrow" style={style}>
      <span className="eyebrow__idx">{idx}</span><span>{label}</span>
      {rule && <span className="eyebrow__rule" />}
      {right && <span>{right}</span>}
    </div>
  );
}

/* ── Card with registration ticks ────────────────── */
export function Card({ idx, eyebrow, title, aux, children, className = '', style }) {
  return (
    <div className={`card ${className}`} style={style}>
      <span className="tick-b" />
      {(eyebrow || title || aux) && (
        <div className="card__head">
          <div>
            {eyebrow && <div className="eyebrow" style={{ marginBottom: 6 }}><span className="eyebrow__idx">{idx}</span><span>{eyebrow}</span></div>}
            {title && <div className="card__title">{title}</div>}
          </div>
          {aux && <div className="card__aux">{aux}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

/* ── Page header ─────────────────────────────────── */
export function PageHead({ idx, eyebrow, title, sub, actions }) {
  return (
    <div className={`page-head ${actions ? 'page-head--row' : ''}`}>
      <div style={{ flex: 1, minWidth: 260 }}>
        <Eyebrow idx={idx} label={eyebrow} rule right="LUXE / CAPITAL" style={{ animation: 'rise 0.5s ease both' }} />
        <h1 className="page-head__title">{title}</h1>
        {sub && <p className="page-head__sub">{sub}</p>}
      </div>
      {actions && <div className="page-head__actions">{actions}</div>}
    </div>
  );
}

/* ── Verdict strip ───────────────────────────────── */
export function Verdict({ tone = '', label, children, style }) {
  return <div className={`verdict ${tone}`} style={style}><b>{label}</b>{children}</div>;
}

/* ── Gauge + meters ──────────────────────────────── */
export function Gauge({ score, label = 'OVERALL' }) {
  const s = score != null ? Math.max(0, Math.min(100, score)) : null;
  const sdo = s != null ? 408 - (408 * s) / 100 : 408;
  return (
    <div className="gauge">
      <svg width="150" height="150" viewBox="0 0 150 150">
        <circle className="bg" cx="75" cy="75" r="65" />
        <circle className="fg" cx="75" cy="75" r="65" style={{ '--sdo': sdo }} />
      </svg>
      <div className="gauge__num">{s != null ? Math.round(s) : '—'}<small>{label}</small></div>
    </div>
  );
}

export function Meter({ label, value, max = 10, delay = 0.9 }) {
  if (value == null) return null;
  const p = Math.min((value / max) * 100, 100);
  const c = p >= 70 ? 'var(--up)' : p >= 40 ? 'var(--gold)' : 'var(--dn)';
  return (
    <div>
      <div className="meter__row"><span>{label}</span><b>{value}/{max}</b></div>
      <div className="meter__track"><div className="meter__fill" style={{ '--w': p + '%', background: c, animationDelay: `${delay}s` }} /></div>
    </div>
  );
}

/* ── Toast ───────────────────────────────────────── */
export function Toast({ status, onClear }) {
  if (!status) return null;
  const err = status.toLowerCase().includes('fail') || status.toLowerCase().includes('error');
  const loading = status.includes('...') || status.includes('…');

  useEffect(() => {
    if (!status || loading) return;
    const t = setTimeout(onClear, 4000);
    return () => clearTimeout(t);
  }, [status, loading]);

  return (
    <div className={`toast ${err ? 'toast--error' : loading ? 'toast--loading' : 'toast--success'}`}>
      {loading && <Loader2 size={13} className="spin" />}
      <span>{status}</span>
      {!loading && <button className="toast__close" onClick={onClear}><X size={11} /></button>}
    </div>
  );
}

/* ── Field ───────────────────────────────────────── */
export function Field({ label, hint, value, onChange, textarea, type = 'text', placeholder, style }) {
  return (
    <label className="field" style={style}>
      <span className="field__label">{label}{hint && <span className="hint"> — {hint}</span>}</span>
      {textarea
        ? <textarea className="field__input" value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
        : <input className="field__input" type={type} value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} />}
    </label>
  );
}

/* ── Empty state ─────────────────────────────────── */
export function Empty({ icon: Icon, children }) {
  return <div className="empty">{Icon && <Icon size={30} />}<p>{children}</p></div>;
}

/* ── Callout (annotated stat) ────────────────────── */
export function Callout({ k, v, dim, note, noteTone = '', vColor }) {
  return (
    <div className="callout">
      <div className="callout__k">{k}</div>
      <div className="callout__v" style={vColor ? { color: vColor } : undefined}>{v}{dim && <span className="dim">{dim}</span>}</div>
      {note && <div className={`callout__note ${noteTone}`}>{note}</div>}
    </div>
  );
}

/* ── Telemetry ribbon ────────────────────────────── */
export function Ribbon({ items }) {
  const track = items.map((it, i) => (
    <span key={i}>{it.k} <b className={it.tone || ''}>{it.v}</b></span>
  ));
  return (
    <div className="ribbon">
      <div className="ribbon__track">{track}{items.map((it, i) => (
        <span key={'dup' + i}>{it.k} <b className={it.tone || ''}>{it.v}</b></span>
      ))}</div>
    </div>
  );
}

/* ── Lightbox ────────────────────────────────────── */
export function Lightbox({ src, onClose }) {
  if (!src) return null;
  return (
    <div className="lightbox" onClick={onClose}>
      <button className="lightbox__close"><X size={20} /></button>
      <img src={src} alt="Chart" />
    </div>
  );
}

/* ── P&L Surface calendar (exact concept cells) ──── */
export function CalSurface({ calendarData, onDayClick, viewYear, viewMonth, onPrev, onNext, asCard = true, idx = '04' }) {
  const byDate = {};
  (calendarData || []).forEach(d => { byDate[d.trade_date] = d; });
  const pnls = (calendarData || []).map(d => d.pnl).filter(v => v != null);
  const maxAbs = pnls.length ? Math.max(...pnls.map(Math.abs), 1) : 1;

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const isoDate = d => `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const today = new Date();
  const isToday = d => d && today.getFullYear() === viewYear && today.getMonth() === viewMonth && today.getDate() === d;

  const cellStyle = (row) => {
    if (!row || row.pnl == null) return {};
    const i = Math.min(Math.abs(row.pnl) / maxAbs, 1);
    if (row.pnl > 0) return { background: `rgba(0,230,118,${(0.12 + i * 0.3).toFixed(2)})`, borderColor: `rgba(0,230,118,${(0.22 + i * 0.28).toFixed(2)})` };
    return { background: `rgba(255,59,92,${(0.12 + i * 0.3).toFixed(2)})`, borderColor: `rgba(255,59,92,${(0.22 + i * 0.28).toFixed(2)})` };
  };

  const grid = (
    <div className="cal">
      {['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].map(d => <div key={d} className="dw">{d}</div>)}
      {cells.map((day, i) => {
        const row = day ? byDate[isoDate(day)] : null;
        if (!day) return <div key={i} className="c blank" />;
        return (
          <div key={i}
            className={`c ${row ? 't' : ''} ${isToday(day) ? 'now' : ''}`}
            style={cellStyle(row)}
            onClick={() => row && onDayClick && onDayClick(row.id)}
            title={row ? `${isoDate(day)} · ${row.tickers || ''} · ${pnl$(row.pnl)} · ${row.num_trades ?? '—'} trades` : isoDate(day)}
          >
            <span>{day}</span>
            {row?.pnl != null && <i>{row.pnl >= 0 ? '+' : '−'}{Math.abs(Math.round(row.pnl))}</i>}
          </div>
        );
      })}
    </div>
  );

  if (!asCard) return grid;

  return (
    <div className="card s3">
      <span className="tick-b" />
      <div className="card__head">
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}><span className="eyebrow__idx">{idx}</span><span>P&L SURFACE</span></div>
          <div className="card__title">{MONTHS[viewMonth]} {viewYear}</div>
        </div>
        <div className="cal-head" style={{ margin: 0 }}>
          <button className="cal-nav" onClick={onPrev}>‹</button>
          <button className="cal-nav" onClick={onNext}>›</button>
        </div>
      </div>
      {grid}
    </div>
  );
}
