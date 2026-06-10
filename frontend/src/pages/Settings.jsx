// ── EDGE — Settings Page ───────────────────────────────────────────────
import React, { useState, useEffect } from 'react';
import { api } from '../api.js';
import { Card, PageHead } from '../ui.jsx';

export default function SettingsPage({ setStatus }) {
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api('/settings').then(setSettings).catch(() => setSettings({}));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api('/settings', { method: 'PUT', body: JSON.stringify(settings) });
      setStatus('Settings saved');
    } catch (e) {
      setStatus('Failed to save: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const s = (k, v) => setSettings(prev => ({ ...prev, [k]: v }));

  if (!settings) return <div className="loading-line">LOADING CONFIGURATION…</div>;

  return <>
    <PageHead
      idx="01"
      eyebrow="SYSTEM CONFIG"
      title="Settings"
      sub="Journal preferences and calculation defaults"
      actions={<button className="btn primary" onClick={save} disabled={saving}>{saving ? <span className="spin" /> : null} SAVE SETTINGS</button>}
    />

    <Card idx="02" eyebrow="COMMISSION & FEES" title="Trade Costs" className="s1">
      <p style={{ fontSize: 13, color: 'var(--bone-2)', marginBottom: 16 }}>
        Applied automatically to all imported trades (CSV and future syncs).
        Entered as cost per contract per side — so a round trip costs 2× this amount.
      </p>
      <div className="field-grid c3">
        <label className="field">
          <span className="field__label">COMMISSION PER SIDE (PER CONTRACT)</span>
          <div className="row" style={{ alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", color: 'var(--bone-3)', fontSize: 14 }}>$</span>
            <input className="field__input" type="number" step="0.01" min="0" style={{ flex: 1 }}
              value={settings.commission_per_side ?? 0}
              onChange={e => s('commission_per_side', parseFloat(e.target.value) || 0)} />
          </div>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--bone-3)', marginTop: 6, display: 'block', letterSpacing: '0.04em' }}>
            E.G. TRADOVATE: $0.79/SIDE · NINJATRADER: $0.09/SIDE · RITHMIC: VARIES
          </span>
        </label>
        <label className="field">
          <span className="field__label">BROKER</span>
          <select className="field__input" value={settings.default_broker || 'Tradovate'}
            onChange={e => {
              s('default_broker', e.target.value);
              const rates = { Tradovate: 0.79, NinjaTrader: 0.09, Rithmic: 0.0 };
              if (rates[e.target.value] !== undefined) s('commission_per_side', rates[e.target.value]);
            }}>
            <option>Tradovate</option>
            <option>NinjaTrader</option>
            <option>Rithmic</option>
            <option>Other</option>
          </select>
        </label>
        <label className="field">
          <span className="field__label">TIMEZONE</span>
          <select className="field__input" value={settings.timezone || 'America/Chicago'}
            onChange={e => s('timezone', e.target.value)}>
            <option value="America/New_York">Eastern (ET)</option>
            <option value="America/Chicago">Central (CT)</option>
            <option value="America/Denver">Mountain (MT)</option>
            <option value="America/Los_Angeles">Pacific (PT)</option>
          </select>
        </label>
      </div>
    </Card>

    <Card idx="03" eyebrow="CONTRACT SPECS" title="Point Values" className="s2">
      <p style={{ fontSize: 13, color: 'var(--bone-2)', marginBottom: 14 }}>
        Used for P&L calculation when not provided by the broker. These are standard CME values.
      </p>
      <table className="ledger">
        <thead><tr><th>CONTRACT</th><th>PRODUCT</th><th>$/POINT</th><th>TICK SIZE</th><th>$/TICK</th></tr></thead>
        <tbody>
          {[
            ['MNQ', 'Micro E-mini NASDAQ', 2.0, 0.25, 0.50],
            ['NQ',  'E-mini NASDAQ',      20.0, 0.25, 5.00],
            ['MES', 'Micro E-mini S&P',    5.0, 0.25, 1.25],
            ['ES',  'E-mini S&P',         50.0, 0.25, 12.50],
            ['MYM', 'Micro E-mini Dow',    0.5, 1.0,  0.50],
            ['YM',  'E-mini Dow',          5.0, 1.0,  5.00],
            ['M2K', 'Micro E-mini Russell', 5.0, 0.1,  0.50],
            ['RTY', 'E-mini Russell',      50.0, 0.1,  5.00],
          ].map(([sym, name, ppnt, tick, ptick], i) => (
            <tr key={sym} style={{ animationDelay: `${0.04 * i}s` }}>
              <td style={{ fontWeight: 700, color: 'var(--bone)' }}>{sym}</td>
              <td className="muted">{name}</td>
              <td className="mono">${ppnt.toFixed(2)}</td>
              <td className="mono">{tick}</td>
              <td className="mono">${ptick.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  </>;
}
