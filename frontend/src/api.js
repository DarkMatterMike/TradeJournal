export const API = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

export async function api(path, opts = {}) {
  const r = await fetch(API + path, { headers: opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }, ...opts });
  if (!r.ok) { let msg = `Request failed (${r.status})`; try { const b = await r.json(); msg = b.detail || JSON.stringify(b); } catch { try { msg = await r.text(); } catch {} } throw new Error(msg); }
  return r.json();
}

export const fmt = d => { if (!d) return ''; const dt = new Date(d + 'T00:00:00'); return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); };
export const fmtLong = d => { if (!d) return ''; const dt = new Date(d + 'T00:00:00'); return dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase().replace(/,/g, ' ·'); };
export const fmtTs = ts => { if (!ts) return ''; const dt = new Date(ts); return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
export const fmtClock = ts => { if (!ts) return '—'; const dt = new Date(ts); return dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }); };
export const pnlC = v => v > 0 ? 'u' : v < 0 ? 'd' : '';
export const pnl$ = v => { if (v == null) return '—'; return (v >= 0 ? '+$' : '−$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
export const pct = v => v != null ? Math.round(v * 100) + '%' : '—';

export const TYPE_LABELS = { premarket: 'Pre-Market', postmarket: 'Post-Market', trade: 'Trade', other: 'Other' };
export const TYPE_COLORS = { premarket: 'var(--volt)', postmarket: 'var(--gold)', trade: 'var(--up)', other: 'var(--bone-3)' };
export const TYPE_BG = { premarket: 'rgba(0,229,255,0.12)', postmarket: 'rgba(255,194,75,0.12)', trade: 'rgba(0,230,118,0.12)', other: 'rgba(61,79,104,0.25)' };

export const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
