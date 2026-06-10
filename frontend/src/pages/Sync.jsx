// ── EDGE — Tradovate Sync Page ─────────────────────────────────────────
import React, { useState, useEffect, useRef } from 'react';
import { api, API, pnlC, pnl$ } from '../api.js';
import { Card, PageHead, Callout, Empty } from '../ui.jsx';

export default function SyncPage({ onOpenDay, setStatus }) {
  const [syncStatus, setSyncStatus] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [preview, setPreview] = useState(null);
  const [syncResult, setSyncResult] = useState(null);
  const [probeResult, setProbeResult] = useState(null);
  const [loading, setLoading] = useState('');

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

  const runPreview = async () => {
    if (!selectedAccount) return;
    setLoading('preview'); setPreview(null);
    try { setPreview(await api(`/tradovate/preview/${selectedAccount.id}`)); }
    catch (e) { setStatus('Preview failed: ' + e.message); }
    finally { setLoading(''); }
  };

  const runSync = async () => {
    if (!selectedAccount) return;
    if (!confirm(`Import all closed trades from Tradovate account ${accountLabel(selectedAccount)}?`)) return;
    setLoading('sync'); setSyncResult(null);
    try {
      const result = await api(`/tradovate/sync/${selectedAccount.id}`, { method: 'POST', body: JSON.stringify({}) });
      setSyncResult(result);
      setStatus(`Sync complete — ${result.imported} imported, ${result.skipped} skipped`);
    } catch (e) { setStatus('Sync failed: ' + e.message); }
    finally { setLoading(''); }
  };

  const runProbe = async () => {
    if (!selectedAccount) return;
    setLoading('probe');
    try { setProbeResult(await api(`/tradovate/probe/${selectedAccount.id}`)); }
    catch (e) { setStatus('Probe failed: ' + e.message); }
    finally { setLoading(''); }
  };

  const disconnect = async () => {
    if (!confirm('Disconnect Tradovate? This clears the stored token and frees your active session slot.')) return;
    try { await api('/tradovate/disconnect', { method: 'POST', body: '{}' }); await loadStatus(); setAccounts([]); setSelectedAccount(null); }
    catch (e) { setStatus('Failed: ' + e.message); }
  };

  const authorized = syncStatus?.authorized;

  return <>
    <PageHead
      idx="01"
      eyebrow="BROKER LINK"
      title="Tradovate Sync"
      sub="Import your complete trade history via OAuth"
    />

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
        {authorized && (
          <a href={`${API}/tradovate/oauth/start`} target="_blank" rel="noopener noreferrer"
            className="btn ghost sm" style={{ textDecoration: 'none' }}>
            RE-AUTHORIZE (UPDATE SCOPES)
          </a>
        )}
        {authorized && (
          <button className="btn danger sm" onClick={disconnect}>DISCONNECT</button>
        )}
        {authorized && accounts.length === 0 && (
          <button className="btn ghost sm" onClick={loadAccounts} disabled={loading === 'accounts'}>
            {loading === 'accounts' ? <span className="spin" /> : null} LIST ACCOUNTS
          </button>
        )}
      </div>
      {authorized && accounts.length === 0 && (
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          Connected. Click <strong style={{ color: 'var(--bone)' }}>LIST ACCOUNTS</strong> then select your account to import.
        </p>
      )}
    </Card>

    {accounts.length > 0 && <Card idx="03" eyebrow="ACCOUNT" title="Select Account" className="s2">
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        {accounts.map(acc => (
          <button key={acc.id} className={`btn ${selectedAccount?.id === acc.id ? 'primary' : 'ghost'}`}
            onClick={() => setSelectedAccount(acc)}>
            {accountLabel(acc)}
            {acc.accountType && <span style={{ fontSize: 10.5, opacity: 0.7, marginLeft: 6 }}>{acc.accountType}</span>}
          </button>
        ))}
      </div>
    </Card>}

    {selectedAccount && <Card idx="04" eyebrow="OPERATIONS" title="Import Controls" className="s2">
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <button className="btn ghost" onClick={runPreview} disabled={!!loading}>
          {loading === 'preview' ? <span className="spin" /> : null} PREVIEW TRADES
        </button>
        <button className="btn primary" onClick={runSync} disabled={!!loading}>
          {loading === 'sync' ? <span className="spin" /> : null} IMPORT NOW
        </button>
        <button className="btn ghost" onClick={runProbe} disabled={!!loading} title="Probe all Tradovate endpoints to find which return data">
          {loading === 'probe' ? <span className="spin" /> : null} PROBE ALL ENDPOINTS
        </button>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>Preview first. Import is idempotent — safe to re-run.</p>
    </Card>}

    {probeResult && <Card idx="05" eyebrow="DIAGNOSTICS" title="Endpoint Probe Results" className="s2">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {Object.entries(probeResult).map(([ep, res]) => {
          const hasData = res.count > 0;
          const hasError = !!res.error;
          return (
            <div key={ep} className={`probe-row ${hasData ? 'hit' : ''}`}>
              <code style={{ color: hasData ? 'var(--up)' : hasError ? 'var(--dn)' : 'var(--bone-3)', minWidth: 320, flexShrink: 0 }}>{ep}</code>
              {hasData && <span style={{ color: 'var(--up)', fontWeight: 600 }}>✓ {res.count} records · keys: {res.keys?.join(', ')}</span>}
              {hasError && <span style={{ color: 'var(--dn)' }}>{res.error}</span>}
              {!hasData && !hasError && <span className="muted">empty []</span>}
            </div>
          );
        })}
      </div>
      <details style={{ marginTop: 12 }}>
        <summary style={{ fontSize: 12, color: 'var(--bone-3)', cursor: 'pointer' }}>Full raw response</summary>
        <pre style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--bone-2)', marginTop: 8, overflow: 'auto', background: 'var(--ink-1)', border: '1px solid var(--line)', padding: 12, maxHeight: 400 }}>
          {JSON.stringify(probeResult, null, 2)}
        </pre>
      </details>
    </Card>}

    {preview && <Card idx="06" eyebrow="PREVIEW" title={`${preview.fill_pair_count} Fill Pairs`} className="s2">
      <div className="row" style={{ flexWrap: 'wrap', gap: 16, marginBottom: 12 }}>
        {Object.entries(preview.counts || {}).map(([k, v]) => (
          <code key={k} style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, color: v > 0 ? 'var(--volt)' : 'var(--bone-3)' }}>{k}: {v}</code>
        ))}
      </div>
      {preview.errors?.length > 0 && <div style={{ marginBottom: 12 }}>
        {preview.errors.map((e, i) => <div key={i} style={{ fontSize: 12, color: 'var(--gold)' }}>{e}</div>)}
      </div>}
      {preview.fill_pair_count === 0
        ? <Empty>No fill pairs returned yet.</Empty>
        : <div className="trade-table-wrap"><table className="ledger"><thead><tr>
            <th>DATE</th><th>SYMBOL</th><th>SIDE</th><th>QTY</th><th>ENTRY</th><th>EXIT</th><th>P&L</th>
          </tr></thead><tbody>
            {(preview.preview || []).map((r, i) => (
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
          </tbody></table></div>
      }
      {preview.raw_fillpair?.length > 0 && <details style={{ marginTop: 12 }}>
        <summary style={{ fontSize: 12, color: 'var(--bone-3)', cursor: 'pointer' }}>Raw API response</summary>
        <pre style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: 'var(--bone-2)', marginTop: 8, overflow: 'auto', background: 'var(--ink-1)', border: '1px solid var(--line)', padding: 12 }}>
          {JSON.stringify({ fillPairs: preview.raw_fillpair, fills: preview.raw_fill }, null, 2)}
        </pre>
      </details>}
    </Card>}

    {syncResult && <Card idx="07" eyebrow="RESULT" title="Sync Result" className="s2">
      <div className="callouts" style={{ border: 'none', padding: 0 }}>
        <Callout k="IMPORTED" v={String(syncResult.imported)} vColor="var(--up)" />
        <Callout k="SKIPPED" v={String(syncResult.skipped)} />
        <Callout k="DAYS UPDATED" v={String(syncResult.days_updated)} />
        <Callout k="ERRORS" v={String(syncResult.errors?.length || 0)} vColor={syncResult.errors?.length ? 'var(--dn)' : undefined} />
      </div>
      {syncResult.message && <p style={{ fontSize: 13, color: 'var(--bone-2)', marginTop: 10 }}>{syncResult.message}</p>}
      {syncResult.errors?.map((e, i) => <div key={i} style={{ fontSize: 12, color: 'var(--gold)', marginTop: 4 }}>{e}</div>)}
    </Card>}

    <CsvImportSection setStatus={setStatus} />
  </>;
}

// ── CSV Import Section ────────────────────────────────────────────────
function CsvImportSection({ setStatus }) {
  const [csvPreview, setCsvPreview] = useState(null);
  const [csvResult, setCsvResult] = useState(null);
  const [loading, setLoading] = useState('');
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

  const importPending = () => {
    if (pendingFile) handleFile(pendingFile, false);
  };

  return <Card idx="08" eyebrow="CSV IMPORT" title="Manual Backfill" className="s3"
    aux={<span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--bone-3)', letterSpacing: '0.06em' }}>TRADOVATE → REPORTS → ORDERS → DOWNLOAD</span>}>
    <p style={{ fontSize: 13, color: 'var(--bone-2)', marginBottom: 16 }}>
      Export your Orders CSV from Tradovate and upload here. Works for any date range — use for full history backfill.
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
