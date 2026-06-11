// ── LUXE CAPITAL · Statistics — a retrospective ────────────────────────
import React, { useEffect, useRef, useMemo } from 'react';
import { pnl$, MONTHS } from '../api.js';
import { numberWord, dateToWords, curvePath } from '../vitrine.js';

function CountUp({ target, prefix = '', suffix = '', className }) {
  const ref = useRef();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const t0 = performance.now() + 450, dur = 1900;
    let raf;
    const tick = now => {
      const t = Math.min(Math.max((now - t0) / dur, 0), 1);
      const e = 1 - Math.pow(1 - t, 4);
      el.textContent = prefix + Math.round((target || 0) * e).toLocaleString() + suffix;
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, prefix, suffix]);
  return <div ref={ref} className={className}>{prefix}0{suffix}</div>;
}

export default function StatsPage({ stats, calendarData, calView, calPrev, calNext, openDay }) {
  const ov = stats?.overview || {};
  const eq = stats?.equity_curve || [];
  const patterns = stats?.top_patterns || [];

  const curve = useMemo(() => curvePath(eq.map(p => p.equity), 1000, 240, 18), [eq]);

  // calendar grid
  const year = calView.year, month = calView.month;
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const byDate = {};
  (calendarData || []).forEach(d => { byDate[d.trade_date] = d; });
  const todayIso = new Date().toISOString().slice(0, 10);
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ d, iso, rec: byDate[iso] });
  }

  const greenDays = ov.winning_days || 0;
  const totalDays = ov.total_days || 0;
  const greenPct = totalDays ? Math.round((greenDays / totalDays) * 100) : 0;

  return (
    <div>
      <div className="retro-head">
        <div className="over">The Collected Record · MMXXVI</div>
        <h1 className="reveal">
          <span className="w"><span style={{ animationDelay: '0.3s' }}>A</span></span>{' '}
          <span className="w"><span style={{ animationDelay: '0.42s' }}>Retrospective</span></span>
        </h1>
        <div className="sub">— {totalDays ? `${numberWord(totalDays).toLowerCase()} sessions, considered as a body of work` : 'the record awaits its first entries'} —</div>
      </div>

      <div className="figures">
        <div className="figure" style={{ animationDelay: '0.25s' }}>
          <div className="k">Realized, All Time</div>
          <CountUp className={`v ${ov.total_pnl > 0 ? 'u' : ''}`} target={Math.round(ov.total_pnl || 0)} prefix={ov.total_pnl >= 0 ? '+$' : '−$'} />
          <div className="note">across {numberWord(totalDays).toLowerCase()} sessions</div>
        </div>
        <div className="figure" style={{ animationDelay: '0.35s' }}>
          <div className="k">Green Sessions</div>
          <CountUp className="v" target={greenPct} suffix="%" />
          <div className="note">{greenDays} of {totalDays} declared green</div>
        </div>
        <div className="figure" style={{ animationDelay: '0.45s' }}>
          <div className="k">Finest Session</div>
          <CountUp className="v u" target={Math.round(ov.best_day || 0)} prefix="+$" />
          <div className="note">single-day record</div>
        </div>
        <div className="figure" style={{ animationDelay: '0.55s' }}>
          <div className="k">Mean Composure</div>
          <CountUp className="v" target={Math.round(ov.avg_score || 0)} />
          <div className="note">of one hundred</div>
        </div>
      </div>

      <div className="sec-head">
        <span className="num">i.</span><h3>The Equity Curve</h3><span className="rule" /><span className="aux">Cumulative · Net</span>
      </div>
      {curve ? (
        <div className="exhibit vframe shine">
          <div className="sheen" />
          <svg viewBox="0 0 1000 240" preserveAspectRatio="none">
            <line className="zero" x1="0" y1={curve.zeroY} x2="1000" y2={curve.zeroY} />
            <path className="eq-depth" d={curve.d} pathLength="1700" />
            <path className="eq" d={curve.d} pathLength="1700" />
            <circle className="runner" cx={curve.end.x} cy={curve.end.y} r="4" fill="#8df5c8" />
          </svg>
          <div className="exhibit__plaque">
            Fig. 2 — The Account · drawdowns retained for honesty · current standing <b>{pnl$(eq.length ? eq[eq.length - 1].equity : 0)}</b>
          </div>
        </div>
      ) : (
        <div className="jrnl-empty">— the curve will draw itself once two sessions exist —</div>
      )}

      <div className="sec-head">
        <span className="num">ii.</span><h3>The Collection</h3><span className="rule" />
        <span className="coll-nav">
          <button onClick={calPrev}>‹</button>
          <span className="aux">{MONTHS[month]} {year}</span>
          <button onClick={calNext}>›</button>
        </span>
      </div>
      <div className="collection">
        {['SU','MO','TU','WE','TH','FR','SA'].map(d => <div className="dw" key={d}>{d}</div>)}
        {cells.map((c, i) => {
          if (!c) return <div className="piece" key={'pad' + i} style={{ border: 'none' }} />;
          const traded = c.rec && c.rec.pnl != null;
          const win = traded && c.rec.pnl > 0, loss = traded && c.rec.pnl < 0;
          return (
            <div key={c.iso}
              className={`piece ${traded ? 't' : ''} ${win ? 'win' : ''} ${loss ? 'loss' : ''} ${c.iso === todayIso ? 'now' : ''}`}
              style={{ animationDelay: `${0.3 + i * 0.012}s` }}
              onClick={() => traded && openDay(c.rec.id)}>
              <span>{c.d}</span>
              {traded && <i>{(c.rec.pnl >= 0 ? '+' : '−') + Math.abs(Math.round(c.rec.pnl))}</i>}
            </div>
          );
        })}
      </div>

      <div className="sec-head" style={{ marginTop: 60 }}>
        <span className="num">iii.</span><h3>Provenance of Edge</h3><span className="rule" /><span className="aux">By Pattern</span>
      </div>
      {patterns.length === 0 && <div className="jrnl-empty">— run intelligence on your sessions to attribute the edge —</div>}
      <div style={{ marginBottom: 30 }}>
        {patterns.map((p, i) => {
          const wr = p.win_rate != null ? Math.round(p.win_rate * 100) : null;
          const good = wr != null && wr >= 60, bad = wr != null && wr < 50;
          return (
            <div className="prov-row" key={p.name} style={{ animationDelay: `${0.2 + i * 0.08}s` }}>
              <span className="no">{['i.','ii.','iii.','iv.','v.','vi.','vii.','viii.','ix.','x.'][i] || `${i + 1}.`}</span>
              <span className="name">{p.name}<small>{numberWord(p.sample_count || 0).toLowerCase()} samples in the record</small></span>
              <span className="prov-bar"><i style={{ '--w': `${wr ?? 0}%`, background: good ? 'var(--up)' : bad ? 'var(--dn)' : 'rgba(255,255,255,0.5)' }} /></span>
              <span className="wr" style={{ color: good ? 'var(--up)' : bad ? 'var(--dn)' : undefined }}>{wr != null ? wr + '%' : '—'}</span>
              <span className="avg" style={{ color: p.avg_pnl > 0 ? 'var(--up)' : p.avg_pnl < 0 ? 'var(--dn)' : undefined }}>{p.avg_pnl != null ? pnl$(p.avg_pnl) : '—'}</span>
            </div>
          );
        })}
      </div>

      <div className="colophon">
        <span className="orn">❦ ❦ ❦</span>
        Compiled from the complete record · Luxe Capital · MMXXVI
      </div>
    </div>
  );
}
