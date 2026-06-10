import React from 'react';
import { Upload, Zap, History, ChevronLeft, Trash2, Search, Loader2 } from 'lucide-react';
import { fmt, TYPE_LABELS, TYPE_COLORS, TYPE_BG } from '../api';
import { PageHead, Card, Field, Empty } from '../ui';
import { AnalysisResultCards, HistoryCard, TypeChip } from '../cards';

export default function AnalyzePage({
  analyzeTab, setAnalyzeTab,
  analyzeConfig, ac,
  analyzing, runAnalysis,
  analyzeResult,
  history, historyLoading, loadHistory,
  selectedSession, setSelectedSession,
  openSession, deleteSession,
  openDay,
}) {
  const focusPlaceholder =
    analyzeConfig.analysis_type === 'premarket' ? 'e.g. "focus on the FVG at 19420 and whether NQ is diverging from ES"' :
    analyzeConfig.analysis_type === 'trade' ? 'e.g. "check if this entry was inside the 4h FVG and if liquidity was swept first"' :
    analyzeConfig.analysis_type === 'postmarket' ? 'e.g. "did the Power of 3 play out and where was the manipulation leg"' :
    'e.g. specific levels, patterns, or context to emphasize';

  return (
    <>
      <PageHead idx="01" eyebrow="CHART INTELLIGENCE" title="Analyze"
        sub={<>Chart intelligence · <b>saved to history</b> · linked to trade days</>}
        actions={
          <>
            <button className={`btn ${analyzeTab === 'upload' ? 'btn--primary' : ''}`} onClick={() => { setAnalyzeTab('upload'); setSelectedSession(null); }}><Zap size={13} /> Analyze</button>
            <button className={`btn ${analyzeTab === 'history' ? 'btn--primary' : ''}`} onClick={() => { setAnalyzeTab('history'); setSelectedSession(null); loadHistory(); }}>
              <History size={13} /> History{history.length > 0 && <span className="scorepill" style={{ marginLeft: 4, color: 'var(--volt)' }}>{history.length}</span>}
            </button>
          </>
        }
      />

      {/* ── UPLOAD TAB ── */}
      {analyzeTab === 'upload' && (
        <>
          <Card idx="02" eyebrow="CONFIGURATION" title="Session Setup" className="s1" style={{ marginTop: 26, marginBottom: 22 }}>
            <div className="field-grid field-grid--3" style={{ marginBottom: 4 }}>
              <label className="field">
                <span className="field__label">Analysis Type</span>
                <select className="field__input" value={analyzeConfig.analysis_type} onChange={e => ac('analysis_type', e.target.value)}>
                  <option value="premarket">Pre-Market — what am I looking at before open</option>
                  <option value="postmarket">Post-Market — how did the day resolve</option>
                  <option value="trade">Trade Screenshot — specific entry or exit</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className="field">
                <span className="field__label">Link to Trade Day <span className="hint">optional</span></span>
                <div className="row" style={{ minHeight: 38 }}>
                  <input type="checkbox" checked={analyzeConfig.link_to_day} onChange={e => ac('link_to_day', e.target.checked)} />
                  {analyzeConfig.link_to_day
                    ? <input className="field__input" type="date" value={analyzeConfig.trade_date} onChange={e => ac('trade_date', e.target.value)} style={{ flex: 1, width: 'auto' }} />
                    : <span className="muted" style={{ fontSize: 12 }}>Enable to attach to a day</span>}
                </div>
              </label>
              <Field label="Notes" hint="optional" value={analyzeConfig.notes} onChange={v => ac('notes', v)} placeholder="Context, ticker, session…" />
            </div>
            <Field
              label="Focus Override"
              hint="tell the AI what to pay special attention to"
              value={analyzeConfig.focus}
              onChange={v => ac('focus', v)}
              placeholder={focusPlaceholder}
            />

            <div className="dropzone">
              <div className="row" style={{ justifyContent: 'center' }}>
                <TypeChip type={analyzeConfig.analysis_type} />
                {analyzeConfig.link_to_day && analyzeConfig.trade_date && <span className="mono" style={{ fontSize: 11, color: 'var(--bone-2)' }}>→ {fmt(analyzeConfig.trade_date)}</span>}
              </div>
              <p>
                {analyzeConfig.analysis_type === 'premarket' ? 'Upload a premarket chart for AI analysis + historical match'
                  : analyzeConfig.analysis_type === 'postmarket' ? 'Upload an EOD chart to see how the day resolved vs similar days'
                  : analyzeConfig.analysis_type === 'trade' ? 'Upload a trade screenshot to analyze entry/exit quality'
                  : 'Upload a chart for analysis'}
              </p>
              {analyzing
                ? <div className="loading-line" style={{ padding: 0 }}><Loader2 size={16} className="spin" /> ANALYZING…</div>
                : <label className="btn btn--primary" style={{ cursor: 'pointer' }}>
                    <Upload size={13} /> Upload Screenshot
                    <input type="file" hidden accept="image/*" onChange={e => { runAnalysis(e.target.files[0]); e.target.value = ''; }} />
                  </label>}
            </div>
          </Card>

          {analyzeResult && (
            <>
              {analyzeResult.session_id && <div className="mono muted" style={{ fontSize: 10, letterSpacing: 1, marginBottom: 10 }}>SESSION #{analyzeResult.session_id} SAVED TO HISTORY</div>}
              <AnalysisResultCards result={analyzeResult} onOpenDay={openDay} cardIdx="03" />
            </>
          )}
        </>
      )}

      {/* ── HISTORY TAB ── */}
      {analyzeTab === 'history' && (
        <div style={{ marginTop: 26 }}>
          {selectedSession ? (
            <>
              <button className="detail-back" style={{ margin: '0 0 18px' }} onClick={() => setSelectedSession(null)}><ChevronLeft size={14} /> Back to history</button>
              <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 12 }}>
                <button className="btn btn--danger btn--sm" onClick={() => deleteSession(selectedSession.id)}><Trash2 size={12} /> Delete session</button>
              </div>
              <AnalysisResultCards result={selectedSession} onOpenDay={openDay} cardIdx="02" />
            </>
          ) : (
            <>
              <div className="row" style={{ marginBottom: 18 }}>
                <button className="btn btn--ghost btn--sm" style={{ marginLeft: 'auto' }} onClick={loadHistory}><Search size={12} /> Refresh</button>
              </div>
              {historyLoading
                ? <div className="loading-line"><Loader2 size={15} className="spin" /> LOADING HISTORY…</div>
                : history.length === 0
                  ? <Empty icon={History}>No analysis sessions yet. Upload a chart in the Analyze tab.</Empty>
                  : <div className="history-list">
                      {history.map((s, i) => (
                        <HistoryCard key={s.id} s={s} onOpen={openSession} onDelete={deleteSession} delay={Math.min(i * 0.04, 0.6)} />
                      ))}
                    </div>}
            </>
          )}
        </div>
      )}
    </>
  );
}
