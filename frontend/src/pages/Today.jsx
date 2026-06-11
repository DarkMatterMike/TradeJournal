// ── LUXE CAPITAL · Today — the day as exhibit ──────────────────────────
import React, { useState, useEffect, useMemo } from 'react';
import { api, pnl$, pnlC } from '../api.js';
import { dateToWords, weekdayOf, numberWord, curvePath, roman, fmtClockShort } from '../vitrine.js';

function Reveal({ text, delay = 0.35 }) {
  const words = String(text || '').trim().split(/\s+/);
  return (
    <>
      {words.map((w, i) => (
        <span className="w" key={i}>
          <span style={{ animationDelay: `${delay + i * 0.12}s` }}>{w}</span>{' '}
        </span>
      ))}
    </>
  );
}

function useTilt(max = 9) {
  const onMove = e => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.transition = 'transform 0.1s';
    el.style.transform = `rotateY(${px * max}deg) rotateX(${-py * max}deg)`;
  };
  const onLeave = e => {
    const el = e.currentTarget;
    el.style.transition = 'transform 0.9s cubic-bezier(0.19,1,0.22,1)';
    el.style.transform = 'rotateY(0) rotateX(0)';
  };
  return { onMouseMove: onMove, onMouseLeave: onLeave };
}

export default function TodayPage({ stats, days, openDay, goPage }) {
  const latest = (days || []).find(d => d.pnl != null) || (days || [])[0] || null;
  const [trades, setTrades] = useState([]);
  const tilt = useTilt(9);

  useEffect(() => {
    let live = true;
    if (!latest?.id) { setTrades([]); return; }
    api('/days/' + latest.id)
      .then(b => { if (live) setTrades((b.trade_rows || []).map(r => ({ id: r.id, ...(r.row_data || {}) }))); })
      .catch(() => { if (live) setTrades([]); });
    return () => { live = false; };
  }, [latest?.id]);

  // session equity from this day's trades (cumulative net)
  const curve = useMemo(() => {
    const pts = [0];
    for (const t of trades) if (t.pnl != null) pts.push(+(pts[pts.length - 1] + t.pnl).toFixed(2));
    if (pts.length < 3 && stats?.equity_curve?.length >= 2) {
      return curvePath(stats.equity_curve.map(p => p.equity), 360, 220);
    }
    return curvePath(pts, 360, 220);
  }, [trades, stats?.equity_curve]);

  const best = trades.reduce((a, t) => (t.pnl != null && (!a || t.pnl > a.pnl)) ? t : a, null);
  const worst = trades.reduce((a, t) => (t.pnl != null && (!a || t.pnl < a.pnl)) ? t : a, null);

  // week numbers (last 7 calendar days of records)
  const weekDays = (days || []).slice(0, 7).filter(d => d.pnl != null);
  const weekPnl = weekDays.reduce((a, d) => a + d.pnl, 0);
  const weekGreen = weekDays.filter(d => d.pnl > 0).length;

  const tradeCount = trades.length || latest?.num_trades || 0;
  const tradeWord = numberWord(tradeCount);
  const title = latest ? dateToWords(latest.trade_date) : 'The Gallery Awaits';
  const ghostTickers = (latest?.tickers || '').toUpperCase();

  const curatorLede = latest
    ? (latest.pnl >= 0
      ? `A session declared green. ${tradeWord.toLowerCase() === 'one' ? 'A single execution' : `${tradeWord} executions`} across ${ghostTickers || 'the book'}, closing at ${pnl$(latest.pnl)} net of commission.`
      : `A drawing-down session, recorded faithfully. ${tradeWord} executions across ${ghostTickers || 'the book'}, closing at ${pnl$(latest.pnl)} net.`)
    : 'Import your first session to hang the opening piece.';

  const observation = weekDays.length
    ? `The last ${numberWord(weekDays.length).toLowerCase()} sessions total ${pnl$(weekPnl)}, ${weekGreen} of ${weekDays.length} declared green.${latest?.execution_score ? ` The execution score of ${Math.round(latest.execution_score)} reflects the machine's honest read.` : ''}`
    : 'Observations will appear once sessions are catalogued.';

  return (
    <div>
      <div className="stage">
        <div className="stage__left">
          <div className="genus">{ghostTickers ? `${ghostTickers} · ` : ''}{latest ? weekdayOf(latest.trade_date) : 'Awaiting Sessions'}</div>
          <h2 className="reveal"><Reveal text={title} delay={0.35} /></h2>
          <p>{latest?.ai_summary ? latest.ai_summary : curatorLede}</p>
          <div className="stage__meta">
            <div><div className="k">Net Result</div><div className="v" style={{ color: latest?.pnl > 0 ? 'var(--up)' : latest?.pnl < 0 ? 'var(--dn)' : undefined }}>{latest ? pnl$(latest.pnl) : '—'}</div></div>
            <div><div className="k">Trades</div><div className="v">{tradeCount ? tradeWord : '—'}</div></div>
            <div><div className="k">Score</div><div className="v">{latest?.execution_score ? Math.round(latest.execution_score) : '—'}</div></div>
          </div>
        </div>

        <div className="artifact persp">
          <div className="artifact__glow" />
          <div className="artifact__frame vframe shine" {...tilt}>
            <div className="sheen" />
            {curve ? (
              <svg viewBox="0 0 360 220" preserveAspectRatio="none">
                <path className="eq-depth" d={curve.d} pathLength="1100" />
                <path className="eq" d={curve.d} pathLength="1100" />
                <circle className="runner" cx={curve.end.x} cy={curve.end.y} r="4" fill="#8df5c8" />
              </svg>
            ) : (
              <div className="artifact__empty">— the first piece is yet to be hung —</div>
            )}
            <div className="artifact__plaque">Fig. 1 — Session Equity · Net of Commission</div>
          </div>
        </div>

        <div className="stage__right">
          <div className="thumbs">
            {best && <div className="thumb u" title={best.symbol}>{pnl$(best.pnl).replace('+$', '+').replace('−$', '−')}<small>FINEST</small></div>}
            {worst && worst !== best && <div className="thumb d" title={worst.symbol}>{pnl$(worst.pnl).replace('+$', '+').replace('−$', '−')}<small>COSTLIEST</small></div>}
          </div>
          <div className="h">Observe the record</div>
          <p>{observation}</p>
          <div className="sig">Luxe Intelligence</div>
          <button className="v-btn" onClick={() => goPage('journal')}><span>View Full Session</span></button>
        </div>
      </div>

      <div className="sec-head">
        <span className="num">i.</span>
        <h3>Today's Catalogue</h3>
        <span className="rule" />
        <span className="aux">{tradeCount ? `${tradeWord} Trades` : 'No Trades Yet'}</span>
      </div>

      {trades.length > 0 ? (
        <div className="strip">
          {trades.map((t, i) => (
            <div className="strip__item" key={t.id || i} style={{ animationDelay: `${0.12 + i * 0.06}s` }}
              onClick={() => latest && openDay(latest.id)}>
              <div className="lot">Trade {i + 1}</div>
              <div className="t">{fmtClockShort(t.entry_time)}</div>
              <div className={`p ${pnlC(t.pnl)}`}>{t.pnl != null ? pnl$(t.pnl).replace('+$', '+').replace('−$', '−') : '—'}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="jrnl-empty">— no trades catalogued for this session —</div>
      )}

      <footer className="gallery">
        <div className="gdots"><i className="on" /><i /><i /><i /></div>
        <span className="lc-date">{latest ? `SESSION ${latest.trade_date}` : ''}</span>
      </footer>
    </div>
  );
}
