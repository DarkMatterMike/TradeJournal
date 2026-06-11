// ── LUXE CAPITAL — Tradovate Sync Page ─────────────────────────────────
import React, { useState, useEffect, useRef } from 'react';
import { api, API, pnlC, pnl$ } from '../api.js';
import { Card, PageHead, Callout, Empty } from '../ui.jsx';

const toIso = (d) => d.toISOString().slice(0, 10);
const nDaysAgo = (n) => toIso(new Date(Date.now() - n * 86400000));

export default function SyncPage({ onOpenDay, setStatus }) {
  const [syncStatus, setSyncStatus] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [preview, setPreview] = useState(null);
  const [probeResult, setProbeResult] = useState(null);
  const [loading, setLoading] = useState('');

  // Cash History state
  const [chStart, setChStart] = useState(nDaysAgo(30));
  const [chEnd,   setChEnd]   = useState(toIso(new Date()));
  const [chDemo,  setChDemo]  = useState(false);
  const [chPreview, setChPreview] = useState(null);
  const [chResult,  setChResult]  = useState(null);

  useEffect(() => { loadStatus(); }, []);

  const loadStatus = async () => {
    try { setSyncStatus(await api('/tradovate/status')); } catch {}
  };

  const accountLabel = (acc) => acc.name || acc.nickname || acc.accountSpec || `Account ${acc.id}`;

  const loadAccounts = async () => {
    setLoading('accounts');
    try {
      const accs = await api('/tradovate/accounts');
      setAccounts(accs);
      if (accs.length === 1) setSelectedAccount(accs[0]);
    } catch (e) { setStatus('Failed: ' + e.message); }
    finally { setLoading(''); }
  };

  const runProbe = async () => {
    if (!selectedAccount) return;
    setLoading('probe');
    try { setProbeResult(await api(`/tradovate/probe/${selectedAccount.id}`)); }
    catch (e) { setStatus('Probe failed: ' + e.message); }
    finally { setLoading(''); }
  };

  const runFillPreview = async () => {
    if (!selectedAccount) return;
    setLoading('preview'); setPreview(null);
    try { setPreview(await api(`/tradovate/preview/${selectedAccount.id}`)); }
    catch (e) { setStatus('Preview failed: ' + e.message); }
    finally { setLoading(''); }
  };

  const disconnect = async () => {
    if (!confirm('Disconnect Tradovate? This clears the stored token and frees your active session slot.')) return;
    try {
      await api('/tradovate/disconnect', { method: 'POST', body: '{}' });
      await loadStatus(); setAccounts([]); setSelectedAccount(null);
    } catch (e) { setStatus('Failed: ' + e.message); }
  };

  // ── Cash History handlers ──────────────────────────────
  const cashPayload = () => ({
    start_date:   chStart,
    end_date:     chEnd,
    account_id:   selectedAccount?.id || null,
    account_spec: selectedAccount?.name || selectedAccount?.accountSpec || selectedAccount?.nickname || null,
    demo:         chDemo,
  });

  const runChPreview = async () => {
    setLoading('ch-preview'); setChPreview(null); setChResult(null);
    try {
      const r = await api('/tradovate/cash-history/preview', { method: 'POST', body: JSON.stringify(cashPayload()) });
      setChPreview(r);
      setStatus(`Cash History: ${r.total} rows found`);
    } catch (e) { setStatus('Cash History preview failed: ' + e.message); }
    finally { setLoading(''); }
  };

  const runChImport = async () => {
    if (!confirm(`Import Cash History ${chStart} → ${chEnd}? Safe to re-run — duplicates are skipped.`)) return;
    setLoading('ch-import'); setChResult(null);
    try {
      const r = await api('/tradovate/cash-history/import', { method: 'POST', body: JSON.stringify(cashPayload()) });
      setChResult(r);
      setStatus(`Imported ${r.imported} trades across ${r.days_updated} days`);
    } catch (e) { setStatus('Cash History import failed: ' + e.message); }
    finally { setLoading(''); }
  };

  const authorized = syncStatus?.authorized;
  const fmtDate = iso => { if (!iso) return '—'; const [y,m,d] = iso.split('-'); return `${m}/${d}/${y}`; };

  return <>
    <PageHead idx="01" eyebrow="BROKER LINK" title="Tradovate Sync"
      sub="Import your complete trade history via OAuth" />

    {/* 02 — Connection + Account selector inline */}
    <Card idx="02" eyebrow="CONNECTION" title="OAuth Status" className="s1"
      aux={<button className="btn ghost sm" onClick={loadStatus}>REFRESH</button>}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className={`conn ${authorized ? 'up' : 'warn'}`} />
          <span style={{ fontSize: 13, color: 'var(--bone-2)' }}>
            {authorized
              ? `Connected · token expires in ${Math.round((syncStatus.token_expires_in || 0) / 60)}m`
              : 'Not authorized'}
          </span>
        </div>
        {!authorized && (
          <a href={`${API}/tradovate/oauth/start`} target="_blank" rel="noopener noreferrer"
            className="btn primary" style={{ textDecoration: 'none' }}>
            CONNECT TRADOVATE →
          </a>
        )}
        {authorized && <>
          <a href={`${API}/tradovate/oauth/start`} target="_blank" rel="noopener noreferrer"
            className="btn ghost sm" style={{ textDecoration: 'none' }}>
            RE-AUTHORIZE
          </a>
          <button className="btn danger sm" onClick={disconnect}>DISCONNECT</button>
          {accounts.length === 0 && (
            <button className="btn ghost sm" onClick={loadAccounts} disabled={loading === 'accounts'}>
              {loading === 'accounts' ? <span className="spin" /> : null} LIST ACCOUNTS
            </button>
          )}
        </>}
      </div>
      {authorized && accounts.length === 0 && (
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          Connected. Click <strong style={{ color: 'var(--bone)' }}>LIST ACCOUNTS</strong> then select your account.
        </p>
      )}
      {accounts.length > 0 && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--hairline)' }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>
            <span className="eyebrow__idx">→</span><span>SELECT ACCOUNT</span>
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {accounts.map(acc => (
              <button key={acc.id}
                className={`btn ${selectedAccount?.id === acc.id ? 'primary' : 'ghost'}`}
                onClick={() => setSelectedAccount(acc)}>
                {accountLabel(acc)}
                {acc.accountType && <span style={{ fontSize: 10.5, opacity: 0.7, marginLeft: 6 }}>{acc.accountType}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </Card>

    {/* 03 — Cash History: primary import path */}
    <Card idx="03" eyebrow="REPORTING API" title="Cash History Import" className="s2"
      aux={<span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: 'var(--bone-3)', letterSpacing: '0.06em' }}>
        rpt-live.tradovateapi.com
      </span>}>
      <p style={{ fontSize: 13, color: 'var(--bone-2)', marginBottom: 20, lineHeight: 1.7 }}>
        Uses the Tradovate Reporting API — the most complete source of trade P&L data.
        Fetches your full Cash History, automatically chunked into 30-day windows to avoid timeouts.
        {selectedAccount && <strong style={{ color: 'var(--volt)' }}> Account {selectedAccount.name || selectedAccount.accountSpec || selectedAccount.id} (id: {selectedAccount.id}) selected.</strong>}
        {!selectedAccount && authorized && <span style={{ color: 'var(--gold)' }}> List Accounts above and select one first.</span>}
        {!authorized && <span style={{ color: 'var(--gold)' }}> Connect Tradovate above first.</span>}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 130px', gap: 12, alignItems: 'end', marginBottom: 16, maxWidth: 560 }}>
        <div className="field">
          <label className="field__label">Start Date</label>
          <input className="field__input" type="date" value={chStart} onChange={e => setChStart(e.target.value)} />
        </div>
        <div className="field">
          <label className="field__label">End Date</label>
          <input className="field__input" type="date" value={chEnd} onChange={e => setChEnd(e.target.value)} />
        </div>
        <div className="field">
          <label className="field__label">Environment</label>
          <select className="field__input" value={chDemo ? 'demo' : 'live'} onChange={e => setChDemo(e.target.value === 'demo')}>
            <option value="live">Live</option>
            <option value="demo">Demo</option>
          </select>
        </div>
      </div>

      <p className="field-hint" style={{ marginBottom: 16 }}>
        {fmtDate(chStart)} → {fmtDate(chEnd)}
        {selectedAccount ? ` · Account ${selectedAccount.id}` : ' · All accounts'}
        {' · Auto-splits into 30-day chunks'}
      </p>

      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <button className="btn ghost" onClick={runChPreview} disabled={!authorized || !!loading}>
          {loading === 'ch-preview' ? <span className="spin" /> : null} PREVIEW
        </button>
        <button className="btn primary" onClick={runChImport} disabled={!authorized || !!loading}>
          {loading === 'ch-import' ? <span className="spin" /> : null} IMPORT
        </button>
      </div>

      {chPreview && <div style={{ marginTop: 20 }}>
        <div className="callouts" style={{ border: 'none', padding: 0, marginBottom: 14 }}>
          <Callout k="ROWS FOUND" v={String(chPreview.total)} />
          <Callout k="SHOWING PREVIEW" v={`${Math.min(chPreview.rows?.length ?? 0, 200)}`} />
        </div>
        {chPreview.rows?.length > 0 && (
          <div className="trade-table-wrap">
            <table className="ledger"><thead><tr>
              {Object.keys(chPreview.rows[0]).slice(0, 9).map(k => (
                <th key={k}>{k.replace(/_/g, ' ').toUpperCase()}</th>
              ))}
            </tr></thead><tbody>
              {chPreview.rows.slice(0, 50).map((r, i) => (
                <tr key={i}>{Object.values(r).slice(0, 9).map((v, j) => (
                  <td key={j} className="mono" style={{ fontSize: 11 }}>{String(v ?? '—')}</td>
                ))}</tr>
              ))}
            </tbody></table>
          </div>
        )}
        {chPreview.total > 0 && (
          <div style={{ marginTop: 14 }}>
            <button className="btn primary" onClick={runChImport} disabled={!!loading}>
              {loading === 'ch-import' ? <span className="spin" /> : null}
              IMPORT THESE {chPreview.total} ROWS
            </button>
          </div>
        )}
      </div>}

      {chResult && <div style={{ marginTop: 16 }}>
        <div className="callouts" style={{ border: 'none', padding: 0 }}>
          <Callout k="IMPORTED" v={String(chResult.imported)} vColor="var(--up)" />
          <Callout k="SKIPPED (DUPES)" v={String(chResult.skipped ?? 0)} />
          <Callout k="DAYS UPDATED" v={String(chResult.days_updated)} />
          <Callout k="TOTAL ROWS" v={String(chResult.total_rows ?? 0)} />
          <Callout k="ERRORS" v={String(chResult.errors?.length || 0)}
            vColor={chResult.errors?.length ? 'var(--dn)' : undefined} />
        </div>
        {chResult.errors?.map((e, i) => (
          <div key={i} style={{ fontSize: 12, color: 'var(--gold)', marginTop: 4 }}>{e}</div>
        ))}
      </div>}
    </Card>

    {/* 04 — CSV Backfill */}
    <CsvImportSection setStatus={setStatus} />

    {/* 05 — Legacy fill-pair diagnostics */}
    <Card idx="05" eyebrow="DIAGNOSTICS" title="Legacy Fill-Pair Probe" className="s4"
      aux={<span style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: 'var(--bone-3)' }}>BLOCKED · FOR DIAGNOSTICS ONLY</span>}>
      <p className="muted" style={{ fontSize: 12, marginBottom: 14 }}>
        The fill-pair sync path is blocked by Tradovate for individual OAuth users (fill/ldeps → 401).
        Use Cash History above. These controls are kept for endpoint probing.
      </p>
      {selectedAccount && <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <button className="btn ghost sm" onClick={runFillPreview} disabled={!!loading}>
          {loading === 'preview' ? <span className="spin" /> : null} PREVIEW FILL PAIRS
        </button>
        <button className="btn ghost sm" onClick={runProbe} disabled={!!loading}>
          {loading === 'probe' ? <span className="spin" /> : null} PROBE ENDPOINTS
        </button>
      </div>}
      {probeResult && <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {Object.entries(probeResult).map(([ep, res]) => {
          const hasData = res.count > 0, hasError = !!res.error;
          return (
            <div key={ep} className={`probe-row ${hasData ? 'hit' : ''}`}>
              <code style={{ color: hasData ? 'var(--up)' : hasError ? 'var(--dn)' : 'var(--bone-3)', minWidth: 300, flexShrink: 0 }}>{ep}</code>
              {hasData && <span style={{ color: 'var(--up)', fontWeight: 600 }}>✓ {res.count} records</span>}
              {hasError && <span style={{ color: 'var(--dn)' }}>{res.error}</span>}
              {!hasData && !hasError && <span className="muted">empty</span>}
            </div>
          );
        })}
      </div>}
      {preview && <div style={{ marginTop: 14 }}>
        <p style={{ fontSize: 12, color: preview.fill_pair_count > 0 ? 'var(--up)' : 'var(--gold)' }}>
          {preview.fill_pair_count} fill pairs · {preview.errors?.length || 0} errors
        </p>
        {preview.errors?.map((e, i) => <div key={i} style={{ fontSize: 11, color: 'var(--gold)', marginTop: 4 }}>{e}</div>)}
      </div>}
    </Card>
  </>;
}

// ── CSV Import Section ────────────────────────────────────────────────
function CsvImportSection({ setStatus }) {
  const [csvPreview, setCsvPreview] = useState(null);
  const [csvResult, setCsvResult]   = useState(null);
  const [loading, setLoading]       = useState('');
  const [pendingFile, setPendingFile] = useState(null);
  const fileRef = useRef();

  const handleFile = async (file, previewOnly) => {
    if (!file) return;
    const label = previewOnly ? 'preview' : 'import';
    setLoading(label);
    if (previewOnly) { setCsvPreview(null); setPendingFile(file); }
    else setCsvResult(null);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('preview_only', previewOnly ? 'true' : 'false');
    try {
      const result = await api('/tradovate/import-csv', { method: 'POST', body: fd });
      if (previewOnly) setCsvPreview(result);
      else { setCsvResult(result); setCsvPreview(null); setPendingFile(null); setStatus(`Imported ${result.imported} trades across ${result.days_updated} days`); }
    } catch (e) { setStatus(`CSV ${label} failed: ${e.message}`); }
    finally { setLoading(''); if (fileRef.current) fileRef.current.value = ''; }
  };

  const importPending = () => { if (pendingFile) handleFile(pendingFile, false); };

  return <Card idx="04" eyebrow="CSV IMPORT" title="Manual Backfill" className="s3"
    aux={<span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: 'var(--bone-3)', letterSpacing: '0.06em' }}>TRADOVATE → REPORTS → ORDERS → DOWNLOAD</span>}>
    <p style={{ fontSize: 13, color: 'var(--bone-2)', marginBottom: 16 }}>
      Export your Orders CSV from Tradovate and upload here. Works for any date range.
    </p>
    <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
      <label className="btn ghost" style={{ cursor: 'pointer' }}>
        {loading === 'preview' ? <span className="spin" /> : null} PREVIEW CSV
        <input ref={fileRef} type="file" accept=".csv" hidden onChange={e => handleFile(e.target.files[0], true)} />
      </label>
      <label className="btn primary" style={{ cursor: 'pointer' }}>
        {loading === 'import' ? <span className="spin" /> : null} IMPORT CSV
        <input type="file" accept=".csv" hidden onChange={e => handleFile(e.target.files[0], false)} />
      </label>
    </div>

    {csvPreview && <div style={{ marginTop: 16 }}>
      <div className="callouts" style={{ border: 'none', padding: 0, marginBottom: 12 }}>
        <Callout k="FILLED ORDERS" v={String(csvPreview.raw_filled_count)} />
        <Callout k="ROUND TRIPS" v={String(csvPreview.total_trades)} />
        <Callout k="TOTAL P&L" v={pnl$(csvPreview.total_pnl)} vColor={csvPreview.total_pnl > 0 ? 'var(--up)' : csvPreview.total_pnl < 0 ? 'var(--dn)' : undefined} />
        <Callout k="DATES" v={String(csvPreview.dates?.length ?? 0)} />
      </div>
      {csvPreview.preview?.length > 0 && <div className="trade-table-wrap">
        <table className="ledger"><thead><tr>
          <th>DATE</th><th>SYMBOL</th><th>SIDE</th><th>QTY</th><th>ENTRY</th><th>EXIT</th><th>P&L</th>
        </tr></thead><tbody>
          {csvPreview.preview.map((r, i) => (
            <tr key={i} style={{ animationDelay: `${0.03 * i}s` }}>
              <td className="mono">{r.trade_date || '—'}</td>
              <td style={{ fontWeight: 600, color: 'var(--bone)' }}>{r.symbol}</td>
              <td className={r.side === 'Long' ? 'u' : 'd'}>{r.side}</td>
              <td className="mono">{r.qty}</td>
              <td className="mono">{r.entry_price != null ? r.entry_price.toFixed(2) : '—'}</td>
              <td className="mono">{r.exit_price != null ? r.exit_price.toFixed(2) : '—'}</td>
              <td className={`mono ${pnlC(r.pnl)}`}>{r.pnl != null ? pnl$(r.pnl) : '—'}</td>
            </tr>
          ))}
        </tbody></table>
      </div>}
      {csvPreview.errors?.length > 0 && <div style={{ marginTop: 8 }}>
        {csvPreview.errors.map((e, i) => <div key={i} style={{ fontSize: 12, color: 'var(--gold)' }}>{e}</div>)}
      </div>}
      <div style={{ marginTop: 12 }}>
        <button className="btn primary" onClick={importPending} disabled={!pendingFile || !!loading}>
          {loading === 'import' ? <span className="spin" /> : null} IMPORT THESE {csvPreview.total_trades} TRADES
        </button>
      </div>
    </div>}

    {csvResult && <div style={{ marginTop: 16 }}>
      <div className="callouts" style={{ border: 'none', padding: 0 }}>
        <Callout k="IMPORTED" v={String(csvResult.imported)} vColor="var(--up)" />
        <Callout k="SKIPPED" v={String(csvResult.skipped ?? 0)} />
        <Callout k="DAYS UPDATED" v={String(csvResult.days_updated)} />
        <Callout k="ERRORS" v={String(csvResult.errors?.length || 0)} vColor={csvResult.errors?.length ? 'var(--dn)' : undefined} />
      </div>
      {csvResult.errors?.map((e, i) => <div key={i} style={{ fontSize: 12, color: 'var(--gold)', marginTop: 4 }}>{e}</div>)}
    </div>}
  </Card>;
}
