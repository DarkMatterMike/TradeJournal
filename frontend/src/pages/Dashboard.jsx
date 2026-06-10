import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, fmt, fmtLong, fmtClock, pnl$, pnlC, pct, MONTHS } from '../api';
import { Eyebrow, Card, Verdict, Gauge, Meter, Callout, CalSurface, Empty } from '../ui';
import { Calendar } from 'lucide-react';

/* ── Hero P&L count-up (concept easing: easeOutQuart, 1800ms, 300ms delay) ── */
function HeroPnl({ value }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (value == null) return;
    const target = value;
    const dur = 1800, start = performance.now() + 300;
    let raf;
    const tick = now => {
      const t = Math.min(Math.max((now - start) / dur, 0), 1);
      const e = 1 - Math.pow(1 - t, 4);
      setV(target * e);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  if (value == null) return <div className="hero__pnl flat">—</div>;
  const abs = Math.abs(v);
  const dollars = Math.floor(abs);
  const cents = Math.round((abs - dollars) * 100);
  const sign = value > 0 ? '+$' : value < 0 ? '−$' : '$';
  const cls = value > 0 ? '' : value < 0 ? 'neg' : 'flat';
  return (
    <div className={`hero__pnl ${cls}`}>
      {sign}{dollars.toLocaleString()}<span className="cents">.{String(cents % 100).padStart(2, '0')}</span>
    </div>
  );
}

/* ── Equity curve from recent days' cumulative P&L ── */
function heroCurve(days) {
  const pts = (days || [])
    .filter(d => d.pnl != null)
    .slice(0, 12)
    .reverse()
    .reduce((acc, d) => { acc.push((acc.length ? acc[acc.length - 1] : 0) + d.pnl); return acc; }, []);
  if (pts.length < 2) {
    // concept fallback path
    return {
      line: 'M0,150 L60,148 L110,158 L170,142 L230,168 L290,160 L350,178 L410,172 L470,185 L530,120 L590,58 L640,46',
      fill: 'M0,150 L60,148 L110,158 L170,142 L230,168 L290,160 L350,178 L410,172 L470,185 L530,120 L590,58 L640,46 L640,200 L0,200 Z',
      end: { x: 640, y: 46 },
    };
  }
  const min = Math.min(...pts, 0), max = Math.max(...pts, 0);
  const span = max - min || 1;
  const xs = pts.map((_, i) => Math.round((i / (pts.length - 1)) * 640));
  const ys = pts.map(p => Math.round(185 - ((p - min) / span) * 140));
  const line = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x},${ys[i]}`).join(' ');
  return { line, fill: `${line} L640,200 L0,200 Z`, end: { x: xs[xs.length - 1], y: ys[ys.length - 1] } };
}

export default function Dashboard({ stats, days, patterns, calendarData, calView, calPrev, calNext, openDay, setPage }) {
  const [latestBundle, setLatestBundle] = useState(null);

  const latestDay = useMemo(() => (days || []).find(d => d.pnl != null) || (days || [])[0] || null, [days]);

  useEffect(() => {
    if (!latestDay?.id) { setLatestBundle(null); return; }
    let alive = true;
    api('/days/' + latestDay.id).then(b => { if (alive) setLatestBundle(b); }).catch(() => {});
    return () => { alive = false; };
  }, [latestDay?.id]);

  const day = latestBundle?.day || latestDay;
  const ov = stats?.overview || {};

  /* trade rows -> ledger */
  const trades = useMemo(() => (latestBundle?.trade_rows || []).map(r => r.row_data || {}).filter(r => r.symbol), [latestBundle]);

  /* derived session stats */
  const derived = useMemo(() => {
    const pnls = trades.map(t => Number(t.pnl)).filter(v => !isNaN(v));
    const wins = pnls.filter(v => v > 0), losses = pnls.filter(v => v < 0);
    const grossWin = wins.reduce((a, b) => a + b, 0);
    const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
    const pf = grossLoss > 0 ? grossWin / grossLoss : null;
    let best = null, worst = null;
    trades.forEach(t => {
      const p = Number(t.pnl);
      if (isNaN(p)) return;
      if (!best || p > Number(best.pnl)) best = t;
      if (!worst || p < Number(worst.pnl)) worst = t;
    });
    // week realized: last 7 calendar days ending at latest day
    let week = null, weekGreen = 0, weekSessions = 0;
    if (day?.trade_date && days?.length) {
      const end = new Date(day.trade_date + 'T00:00:00');
      const start = new Date(end); start.setDate(start.getDate() - 6);
      const inWeek = days.filter(d => {
        if (d.pnl == null) return false;
        const dt = new Date(d.trade_date + 'T00:00:00');
        return dt >= start && dt <= end;
      });
      if (inWeek.length) {
        week = inWeek.reduce((a, d) => a + d.pnl, 0);
        weekGreen = inWeek.filter(d => d.pnl > 0).length;
        weekSessions = inWeek.length;
      }
    }
    const winCount = day?.win_count ?? wins.length;
    const lossCount = day?.loss_count ?? losses.length;
    const wr = (winCount + lossCount) > 0 ? winCount / (winCount + lossCount) : null;
    return { pf, grossWin, grossLoss, best, worst, week, weekGreen, weekSessions, winCount, lossCount, wr };
  }, [trades, days, day]);

  const curve = useMemo(() => heroCurve(days), [days]);

  /* edge index from patterns */
  const edge = useMemo(() => (patterns || []).filter(p => p.sample_count > 0).slice(0, 4), [patterns]);
  const edgeSignal = useMemo(() => {
    const rated = edge.filter(p => p.avg_pnl != null);
    if (rated.length < 2) return null;
    const best = [...rated].sort((a, b) => b.avg_pnl - a.avg_pnl)[0];
    const worst = [...rated].sort((a, b) => a.avg_pnl - b.avg_pnl)[0];
    if (best.name === worst.name) return null;
    const ratio = worst.avg_pnl !== 0 ? Math.abs(best.avg_pnl / worst.avg_pnl).toFixed(1) : null;
    return `Your ${best.name} days average ${ratio ? ratio + '×' : 'well above'} your ${worst.name} days. The data says: lean into ${best.name}, cut the ${worst.name} entries.`;
  }, [edge]);

  const wrColor = w => w >= 0.7 ? 'var(--up)' : w >= 0.55 ? 'var(--gold)' : 'var(--dn)';

  const numTrades = day?.num_trades ?? (trades.length || null);
  const tickers = day?.tickers || [...new Set(trades.map(t => t.symbol))].slice(0, 3).join(' + ');

  return (
    <>
      {/* ── HERO ─────────────────────────────────── */}
      <section className="hero">
        <Eyebrow idx="01" label="SESSION REPORT" rule right="EDGE / OBSERVATORY" style={{ animation: 'rise 0.5s ease both' }} />

        <svg className="hero__curve" viewBox="0 0 640 200" preserveAspectRatio="none">
          <defs>
            <linearGradient id="curvefill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(0,229,255,0.14)" />
              <stop offset="100%" stopColor="rgba(0,229,255,0)" />
            </linearGradient>
          </defs>
          <path className="fill" d={curve.fill} />
          <path className="line" d={curve.line} />
          <circle cx={curve.end.x} cy={curve.end.y} r="4" />
        </svg>

        <div className="hero__date">
          {day?.trade_date ? fmtLong(day.trade_date) : 'NO SESSION LOGGED'}{day?.session ? ` · ${day.session.toUpperCase()}` : day?.trade_date ? ' · NY SESSION' : ''}
        </div>
        <HeroPnl value={day?.pnl ?? null} />
        <div className="hero__sub">
          Net of commissions{numTrades != null && <> · <b>{numTrades} round trips</b></>}{tickers && <> · {tickers}</>}{day?.title && <> · {day.title}</>}
        </div>

        <div className="callouts">
          <Callout k="Win Rate"
            v={derived.wr != null ? (derived.wr * 100).toFixed(1) : '—'} dim={derived.wr != null ? '%' : ''}
            note={derived.wr != null ? `${derived.winCount}W / ${derived.lossCount}L — payoff ratio matters` : 'log a session to populate'} />
          <Callout k="Profit Factor"
            v={derived.pf != null ? derived.pf.toFixed(2) : '—'}
            note={derived.pf != null ? `+$${Math.round(derived.grossWin)} gross win / −$${Math.round(derived.grossLoss)} gross loss` : 'needs trade fills'}
            noteTone={derived.pf != null && derived.pf >= 1 ? 'u' : derived.pf != null ? 'd' : ''} />
          <Callout k="Largest Win"
            v={derived.best ? pnl$(Number(derived.best.pnl)).replace('+$', '+$') : (ov.best_day != null ? pnl$(ov.best_day) : '—')}
            vColor="var(--up)"
            note={derived.best ? `${derived.best.symbol} ${String(derived.best.side || '').toLowerCase()} · ${fmtClock(derived.best.entry_time)}` : 'best day on record'} />
          <Callout k="Week Realized"
            v={derived.week != null ? pnl$(derived.week) : '—'}
            vColor={derived.week > 0 ? 'var(--up)' : derived.week < 0 ? 'var(--dn)' : undefined}
            note={derived.week != null ? `${derived.weekGreen} green of ${derived.weekSessions} sessions` : 'last 7 days'}
            noteTone={derived.week > 0 ? 'u' : derived.week < 0 ? 'd' : ''} />
        </div>
      </section>

      {/* ── ROW: ledger + gauge ──────────────────── */}
      <div className="deck">
        <Card className="s1" idx="02" eyebrow="EXECUTION LEDGER" title="Today's Fills"
          aux={<button className="lk" onClick={() => day?.id ? openDay(day.id) : setPage('days')}>FULL LEDGER →</button>}>
          {trades.length > 0 ? (
            <table className="ledger">
              <thead><tr><th>Time</th><th>Symbol</th><th>Side</th><th className="r">Entry</th><th className="r">Exit</th><th className="r">Net P&L</th></tr></thead>
              <tbody>
                {trades.slice(0, 10).map((t, i) => {
                  const p = Number(t.pnl);
                  return (
                    <tr key={i} style={{ animationDelay: `${0.7 + i * 0.06}s` }} onClick={() => day?.id && openDay(day.id)}>
                      <td className="mono">{fmtClock(t.entry_time)}</td>
                      <td className="sym">{t.symbol}</td>
                      <td className="tag">{String(t.side || '').toUpperCase()}</td>
                      <td className="r mono">{t.entry_price != null ? Number(t.entry_price).toFixed(2) : '—'}</td>
                      <td className="r mono">{t.exit_price != null ? Number(t.exit_price).toFixed(2) : '—'}</td>
                      <td className={`r pnl ${pnlC(p)}`}>{isNaN(p) ? '—' : (p >= 0 ? '+' : '−') + Math.abs(p).toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <Empty icon={Calendar}>No fills on the latest session yet. Sync Tradovate or import a CSV to populate the ledger.</Empty>
          )}
        </Card>

        <Card className="s2" idx="03" eyebrow="AI REVIEW" title="Execution Score">
          <div className="gauge-wrap">
            <Gauge score={day?.execution_score} />
            <div className="meters">
              <Meter label="Bias accuracy" value={day?.bias_score} delay={0.9} />
              <Meter label="Patience" value={day?.patience_score} delay={1.0} />
              <Meter label="Entry quality" value={day?.entry_score} delay={1.1} />
              <Meter label="Risk mgmt" value={day?.risk_mgmt_score} delay={1.2} />
              <Meter label="Profit taking" value={day?.profit_taking_score} delay={1.3} />
              {day?.execution_score == null && <span className="muted mono" style={{ fontSize: 10.5, letterSpacing: 1 }}>RUN INTELLIGENCE ON A DAY TO SCORE IT</span>}
            </div>
          </div>
          {day?.biggest_mistake && <Verdict label="Biggest Leak">{day.biggest_mistake}</Verdict>}
          {!day?.biggest_mistake && day?.biggest_strength && <Verdict tone="good" label="Biggest Strength">{day.biggest_strength}</Verdict>}
        </Card>
      </div>

      {/* ── ROW: calendar + edge index ───────────── */}
      <div className="deck" style={{ marginTop: 22 }}>
        <CalSurface
          calendarData={calendarData}
          onDayClick={openDay}
          viewYear={calView.year}
          viewMonth={calView.month}
          onPrev={calPrev}
          onNext={calNext}
          idx="04"
        />

        <Card className="s4" idx="05" eyebrow="EDGE INDEX" title="Pattern Performance"
          aux={<button className="lk" onClick={() => setPage('patterns')}>ALL →</button>}>
          {edge.length > 0 ? (
            <>
              {edge.map((p, i) => {
                const w = p.win_rate || 0;
                return (
                  <div key={p.name} className="edge-row" style={{ animationDelay: `${1.0 + i * 0.08}s` }} onClick={() => setPage('patterns')}>
                    <span className="edge-row__idx">{String(i + 1).padStart(2, '0')}</span>
                    <span className="edge-row__name">{p.name}<small>{p.sample_count} samples{p.description ? ` · ${p.description.slice(0, 40)}` : ''}</small></span>
                    <span className="edge-bar"><i style={{ '--w': `${Math.round(w * 100)}%`, background: wrColor(w) }} /></span>
                    <span className="edge-wr" style={{ color: wrColor(w) }}>{pct(w)}</span>
                    <span className="edge-pnl" style={{ color: p.avg_pnl >= 0 ? 'var(--up)' : 'var(--dn)' }}>{p.avg_pnl != null ? (p.avg_pnl >= 0 ? '+$' : '−$') + Math.abs(Math.round(p.avg_pnl)) : '—'}</span>
                  </div>
                );
              })}
              {edgeSignal && <Verdict tone="good" label="Edge Signal" style={{ marginTop: 18 }}>{edgeSignal}</Verdict>}
            </>
          ) : (
            <Empty>No pattern samples yet. Run Intelligence on your trade days to build the edge index.</Empty>
          )}
        </Card>
      </div>

      <div className="sig">
        <span>EDGE / Trade Intelligence System</span>
        <span>Neon · R2 · Railway · OpenAI</span>
        <span>Ledger Observatory v1</span>
      </div>
    </>
  );
}
