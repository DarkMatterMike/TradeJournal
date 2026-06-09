import os, base64, json
from typing import Dict, Any, List
from openai import OpenAI

client = OpenAI(api_key=os.getenv('OPENAI_API_KEY')) if os.getenv('OPENAI_API_KEY') else None

DISABLED = {'summary': 'AI disabled. Add OPENAI_API_KEY.'}

def has_ai() -> bool:
    return client is not None

def _image_b64(content: bytes, content_type: str) -> str:
    return f"data:{content_type or 'image/png'};base64," + base64.b64encode(content).decode('utf-8')

def _safe_json(txt: str) -> dict:
    try:
        return json.loads(txt)
    except Exception:
        return {'summary': txt}

# ── Step 2: Structured chart analysis ──────────────
CHART_PROMPT = """You are analyzing a trader's {kind} screenshot for a private trading journal.
Return ONLY a JSON object with EXACTLY these fields (use null if not observable):

{{
  "summary": "1-2 sentence description of what the chart shows",
  "gap_direction": "gap_up | gap_down | flat | null",
  "premarket_trend": "bullish | bearish | mixed | null",
  "volume_assessment": "high | average | low | null",
  "key_levels": ["list of price levels visible as support/resistance"],
  "likely_scenarios": ["list of 1-3 likely scenarios based on the structure"],
  "pattern_tags": ["list from: gap_and_go, vwap_reclaim, failed_breakout, orb_breakout, orb_breakdown, trend_day, reversal_day, chop_day, liquidity_sweep, cisd, power_of_3, fvg_entry, breakout_retest, double_top, double_bottom, higher_low, lower_high"],
  "directional_bias": "bullish | bearish | neutral",
  "market_structure": {{
    "trend_or_chop": "trending | choppy | transitioning",
    "breakout_retest": true/false,
    "liquidity_sweep": true/false,
    "vwap_context": "above | below | reclaiming | rejecting | null"
  }},
  "risk_notes": "any caution flags or risk factors",
  "ideal_vs_actual_notes": "comparison if this is an ideal or trade screenshot"
}}

Be precise. Only tag patterns you can actually observe in the chart. Do not guess."""

def analyze_chart_image_bytes(content: bytes, kind: str, content_type: str = 'image/png') -> Dict[str, Any]:
    if not client:
        return DISABLED
    prompt = CHART_PROMPT.format(kind=kind)
    resp = client.chat.completions.create(
        model='gpt-4o-mini',
        messages=[{'role': 'user', 'content': [
            {'type': 'text', 'text': prompt},
            {'type': 'image_url', 'image_url': {'url': _image_b64(content, content_type)}}
        ]}],
        response_format={'type': 'json_object'},
        temperature=0.2,
    )
    return _safe_json(resp.choices[0].message.content or '{}')

# ── Step 2: Structured day intelligence ────────────
INTEL_PROMPT = """You are a trading performance analyst for a private trading journal.
Analyze this trading day's complete data and return ONLY a JSON object with EXACTLY these fields:

{{
  "summary": "2-3 sentence analysis of the day's trading",
  "pattern_tags": ["matching patterns from: gap_and_go, vwap_reclaim, failed_breakout, orb_breakout, orb_breakdown, trend_day, reversal_day, chop_day, liquidity_sweep, cisd, power_of_3, fvg_entry, breakout_retest, double_top, double_bottom, higher_low, lower_high"],
  "gap_direction": "gap_up | gap_down | flat | null",
  "premarket_trend": "bullish | bearish | mixed | null",
  "volume_assessment": "high | average | low | null",
  "key_levels": "comma-separated price levels that were significant",
  "likely_scenarios": "what setups were available vs what was taken",
  "execution_scores": {{
    "overall": 0-100,
    "bias": 0-10,
    "patience": 0-10,
    "entry": 0-10,
    "risk_management": 0-10,
    "profit_taking": 0-10
  }},
  "biggest_mistake": "single most impactful mistake, or 'None' if clean execution",
  "biggest_strength": "single best thing about this session's execution",
  "market_structure": {{
    "trend_or_chop": "trending | choppy | transitioning",
    "breakout_retest": true/false,
    "liquidity_sweep": true/false,
    "vwap_context": "above | below | reclaiming | rejecting | null",
    "session_type": "trend | range | reversal | chop"
  }},
  "execution_review": {{
    "entry_quality": "assessment of entry timing and location",
    "exit_quality": "assessment of exit timing",
    "risk_reward": "was the R:R appropriate",
    "plan_adherence": "did trader follow their stated plan"
  }},
  "lessons": "key takeaway from this session",
  "review_questions": ["2-3 questions for the trader to reflect on"]
}}

Compare actual trades/notes against ideal trade notes and chart analysis when available.
Be direct, specific, and honest. Score conservatively — an 80+ overall requires clean execution with good R:R."""

def summarize_day(day: dict, uploads: list, trades: list) -> Dict[str, Any]:
    if not client:
        return {**DISABLED, 'pattern_tags': [], 'execution_scores': {}, 'market_structure': {}, 'execution_review': {}}
    payload = {'day': day, 'uploads': uploads, 'trade_rows_sample': trades[:50]}
    resp = client.chat.completions.create(
        model='gpt-4o-mini',
        messages=[
            {'role': 'system', 'content': INTEL_PROMPT},
            {'role': 'user', 'content': json.dumps(payload, default=str)[:60000]}
        ],
        response_format={'type': 'json_object'},
        temperature=0.2,
    )
    return _safe_json(resp.choices[0].message.content or '{}')

# ── Embeddings ──────────────────────────────────────
def embed_text(text: str) -> List[float] | None:
    if not client or not text.strip():
        return None
    resp = client.embeddings.create(model='text-embedding-3-small', input=text[:12000])
    return resp.data[0].embedding

# ── Personal Trading AI Recommendation ─────────────
RECOMMEND_PROMPT = """You are a personal trading AI advisor. The trader has uploaded today's premarket chart.
You have the AI analysis of the chart AND data from their most similar historical trading days.

Based on this data, return ONLY a JSON object with EXACTLY these fields:

{{
  "times_seen": <number of similar days provided>,
  "avg_result": <average P&L from similar days, or null>,
  "win_rate": <win rate across similar days as decimal, or null>,
  "best_strategy": "the strategy that worked best on similar days, based on their notes and results",
  "most_common_mistake": "the most common mistake from similar days' lessons and AI reviews",
  "recommendation": "2-3 sentence specific actionable recommendation for today based on what happened on similar days. Reference specific patterns and outcomes.",
  "risk_level": "low | moderate | high | very_high",
  "key_levels_to_watch": ["list of levels from chart analysis"],
  "pattern_summary": "what pattern type this chart structure most resembles based on the history"
}}

Be specific and reference the actual data. Don't be generic."""

def generate_recommendation(chart_analysis: dict, similar_days: list) -> Dict[str, Any]:
    if not client:
        return {'recommendation': 'AI disabled. Add OPENAI_API_KEY.', 'times_seen': 0}
    payload = {
        'chart_analysis': chart_analysis,
        'similar_days': [{
            'trade_date': str(d.get('trade_date', '')),
            'pnl': d.get('pnl'),
            'strategy': d.get('strategy', ''),
            'tickers': d.get('tickers', ''),
            'lessons': d.get('lessons', ''),
            'biggest_mistake': d.get('biggest_mistake', ''),
            'biggest_strength': d.get('biggest_strength', ''),
            'ai_summary': d.get('ai_summary', ''),
            'ai_pattern_tags': d.get('ai_pattern_tags', ''),
            'execution_score': d.get('execution_score'),
            'trade_notes': d.get('trade_notes', ''),
        } for d in similar_days[:15]]
    }
    resp = client.chat.completions.create(
        model='gpt-4o-mini',
        messages=[
            {'role': 'system', 'content': RECOMMEND_PROMPT},
            {'role': 'user', 'content': json.dumps(payload, default=str)[:60000]}
        ],
        response_format={'type': 'json_object'},
        temperature=0.3,
    )
    return _safe_json(resp.choices[0].message.content or '{}')
