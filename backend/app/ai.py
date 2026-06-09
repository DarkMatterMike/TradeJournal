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


# ── Type-specific chart analysis prompts ────────────
#
# Each prompt is tuned to a specific phase of the trading day.
# The {focus} placeholder is replaced with any user-supplied focus override.
# If no focus is provided, it is replaced with an empty string.

CHART_PROMPTS = {

    'premarket': """You are analyzing a premarket chart for a futures trader who uses SSMT methodology.
Your job is to read the structure and bias BEFORE the open. Be precise — only report what is actually visible.

FOCUS AREAS (in order of priority):
1. HTF BIAS — What does the daily/weekly structure say? Is price in a bullish or bearish delivery? 
   Are we trading into or away from a premium/discount? Is there a clear swing high or low being targeted?
2. KEY LIQUIDITY LEVELS — Identify visible swing highs/lows where buy-side or sell-side liquidity pools sit.
   Note prior day high/low, prior week high/low if visible. These are targets, not just S/R.
3. FAIR VALUE GAPS / IMBALANCES — Are there visible FVGs or imbalance zones from recent impulsive moves?
   Note their price range and whether price is approaching or has already entered one.
4. CORRELATED DIVERGENCE — If multiple instruments are visible (ES, NQ, YM), note any divergence 
   in structure, relative strength, or displacement. A leading instrument weakening is a signal.
5. OPENING SCENARIOS — Based on above, what are the 2-3 most likely plays at the open?
   Be specific: e.g. "sweep of PDL then reversal long toward PDH FVG" not just "could go up or down".

{focus}

Return ONLY this JSON (use null if not observable):
{{
  "summary": "2-3 sentence HTF bias read and primary narrative for the session",
  "directional_bias": "bullish | bearish | neutral",
  "htf_bias": {{
    "daily_structure": "bullish | bearish | ranging | null",
    "weekly_structure": "bullish | bearish | ranging | null",
    "in_premium": true/false/null,
    "in_discount": true/false/null,
    "notes": "brief context on why bias is what it is"
  }},
  "liquidity_levels": [
    {{"level": "price", "type": "bsl | ssl | pdh | pdl | pwh | pwl | swing_high | swing_low", "notes": "brief"}}
  ],
  "fvg_zones": [
    {{"range": "low-high", "direction": "bullish | bearish", "status": "open | partially_filled | filled"}}
  ],
  "correlated_divergence": "description of ES/NQ/YM divergence if visible, or null",
  "key_levels": ["flat list of price levels for database storage"],
  "likely_scenarios": ["scenario 1 with specific levels", "scenario 2", "scenario 3 if applicable"],
  "gap_direction": "gap_up | gap_down | flat | null",
  "premarket_trend": "bullish | bearish | mixed | null",
  "volume_assessment": "high | average | low | null",
  "pattern_tags": ["from: liquidity_sweep, cisd, power_of_3, fvg_entry, trend_day, reversal_day, chop_day, gap_and_go, failed_breakout, orb_breakout, orb_breakdown, higher_low, lower_high, double_top, double_bottom"],
  "risk_notes": "any structure that invalidates the bias or makes the read uncertain",
  "focus_override_applied": "what the user-supplied focus was, or null"
}}

Only tag patterns you can actually observe. Do not speculate beyond what the chart shows.""",


    'trade': """You are reviewing a trade screenshot for a futures trader who uses SSMT methodology.
Your job is to assess the quality of this specific entry or trade. Be brutally honest.

FOCUS AREAS (in order of priority):
1. CISD / STATE OF DELIVERY — Was there a visible change in state of delivery at or before the entry?
   Did price shift from bearish to bullish delivery (or vice versa) confirming the trade direction?
2. FVG / IMBALANCE ENTRY — Is the entry inside a Fair Value Gap or imbalance zone?
   Was the FVG from a relevant timeframe, and is it a clean entry or a chase?
3. LIQUIDITY SWEEP CONFIRMATION — Was there a sweep of a liquidity level (swing high/low) before entry?
   Did price take liquidity and then reverse with conviction, or is this a premature entry?
4. HTF ALIGNMENT — Does the entry direction align with the higher timeframe structure and bias?
   Is the trader going with delivery or fighting it?
5. STOP PLACEMENT — Where is the logical stop based on the structure? Is the visible stop (if any)
   placed correctly — below/above the manipulation point, not arbitrary?
6. ENTRY vs IDEAL — Was this the optimal entry, or was there a better location? 
   Describe what an ideal entry would have looked like on this chart.

{focus}

Return ONLY this JSON (use null if not observable):
{{
  "summary": "2-3 sentence verdict on the trade quality and what the chart shows",
  "directional_bias": "bullish | bearish | neutral",
  "trade_direction": "long | short | null",
  "entry_quality": "A | B | C | D",
  "entry_assessment": {{
    "cisd_present": true/false/null,
    "cisd_notes": "description of the state of delivery shift or why it's absent",
    "fvg_entry": true/false/null,
    "fvg_notes": "describe the FVG zone and entry quality within it",
    "liquidity_swept": true/false/null,
    "liquidity_notes": "what liquidity was taken and whether reversal was convincing",
    "htf_aligned": true/false/null,
    "htf_notes": "whether entry aligns with higher timeframe delivery",
    "stop_placement": "description of where the structural stop should be",
    "stop_quality": "correct | too_tight | too_wide | not_visible | null"
  }},
  "ideal_entry_notes": "where the textbook SSMT entry would have been on this chart",
  "entry_vs_ideal": "better_than_ideal | at_ideal | slightly_off | significantly_off | null",
  "key_levels": ["levels visible on this chart"],
  "pattern_tags": ["from: cisd, fvg_entry, liquidity_sweep, power_of_3, breakout_retest, failed_breakout, higher_low, lower_high, double_top, double_bottom, vwap_reclaim, orb_breakout, orb_breakdown"],
  "risk_notes": "what would invalidate this trade or cause it to fail",
  "focus_override_applied": "what the user-supplied focus was, or null"
}}

Be specific about prices and structure. Grade the entry honestly.""",


    'postmarket': """You are doing an end-of-day review of a chart for a futures trader who uses SSMT methodology.
Your job is to reconstruct what actually happened and compare it to what the structure offered.

FOCUS AREAS (in order of priority):
1. SCENARIO RESOLUTION — Which of the probable opening scenarios actually played out?
   Did price follow the HTF bias or was there a deviation?
2. KEY LEVEL PERFORMANCE — How did the key levels (PDH, PDL, swing highs/lows, FVGs) hold or fail?
   Which levels acted as significant turning points?
3. POWER OF 3 — Is there a visible accumulation → manipulation → distribution sequence?
   Identify each leg if present: where was the false move (manipulation), and where did the real 
   distribution/delivery begin?
4. LIQUIDITY TAKEN — What liquidity pools were hit during the session?
   Buy-side or sell-side? In what order? Was the sweep clean or messy?
5. DAILY RANGE COMPLETION — Did the day complete a full range, or was it a partial/truncated move?
   Where did it close relative to the day's range and key levels?

{focus}

Return ONLY this JSON (use null if not observable):
{{
  "summary": "2-3 sentence description of how the day actually played out",
  "directional_bias": "bullish | bearish | neutral",
  "scenario_played_out": "which scenario from the premarket read materialized, or 'unexpected'",
  "power_of_3": {{
    "present": true/false,
    "accumulation_zone": "price range or description",
    "manipulation_level": "the false move / liquidity grab price",
    "distribution_direction": "bullish | bearish | null",
    "notes": "brief description of the sequence"
  }},
  "liquidity_taken": [
    {{"type": "bsl | ssl", "level": "price", "clean": true/false, "notes": "brief"}}
  ],
  "key_level_review": [
    {{"level": "price", "type": "pdh | pdl | fvg | swing_high | swing_low | other", "held": true/false, "notes": "what happened at this level"}}
  ],
  "range_completion": {{
    "full_range": true/false,
    "close_location": "upper_quartile | upper_half | lower_half | lower_quartile",
    "notes": "how the day closed relative to its range"
  }},
  "missed_opportunities": ["list of setups that were available but may have been missed"],
  "key_levels": ["flat list of significant price levels for database storage"],
  "pattern_tags": ["from: power_of_3, liquidity_sweep, cisd, trend_day, reversal_day, chop_day, fvg_entry, gap_and_go, failed_breakout, orb_breakout, orb_breakdown, higher_low, lower_high"],
  "lessons": "one concrete takeaway from how this day played out",
  "focus_override_applied": "what the user-supplied focus was, or null"
}}

Be specific about what happened and where. Reference actual visible structure.""",


    'other': """You are analyzing a trading chart for a futures trader who uses SSMT methodology.
Describe what you observe in terms of market structure, key levels, and price delivery.

{focus}

Return ONLY this JSON (use null if not observable):
{{
  "summary": "2-3 sentence description of what the chart shows",
  "directional_bias": "bullish | bearish | neutral",
  "key_levels": ["significant price levels visible"],
  "likely_scenarios": ["1-2 likely plays based on visible structure"],
  "pattern_tags": ["from: liquidity_sweep, cisd, power_of_3, fvg_entry, trend_day, reversal_day, chop_day, gap_and_go, failed_breakout, breakout_retest, higher_low, lower_high, double_top, double_bottom"],
  "market_structure": {{
    "trend_or_chop": "trending | choppy | transitioning",
    "liquidity_sweep": true/false,
    "delivery_type": "bullish | bearish | ranging | null"
  }},
  "risk_notes": "any ambiguous or uncertain structure",
  "focus_override_applied": "what the user-supplied focus was, or null"
}}

Only report what is actually visible. Do not speculate.""",
}


def analyze_chart_image_bytes(
    content: bytes,
    kind: str,
    content_type: str = 'image/png',
    focus: str = '',
) -> Dict[str, Any]:
    if not client:
        return DISABLED

    base_prompt = CHART_PROMPTS.get(kind, CHART_PROMPTS['other'])

    # Inject user focus override or clear the placeholder
    if focus and focus.strip():
        focus_block = f"USER FOCUS OVERRIDE — Pay special attention to:\n{focus.strip()}\n"
    else:
        focus_block = ''

    prompt = base_prompt.format(focus=focus_block)

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


# ── Day intelligence ─────────────────────────────────
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


# ── Embeddings ───────────────────────────────────────
def embed_text(text: str) -> List[float] | None:
    if not client or not text.strip():
        return None
    resp = client.embeddings.create(model='text-embedding-3-small', input=text[:12000])
    return resp.data[0].embedding


# ── Recommendation ───────────────────────────────────
RECOMMEND_PROMPT = """You are a personal trading AI advisor for a futures trader using SSMT methodology.
The trader has uploaded today's chart. You have the AI analysis AND data from their most similar historical days.

Based on this data, return ONLY a JSON object with EXACTLY these fields:

{{
  "times_seen": <number of similar days provided>,
  "avg_result": <average P&L from similar days, or null>,
  "win_rate": <win rate across similar days as decimal, or null>,
  "best_strategy": "the specific approach (entry type, level, confirmation) that worked best on similar days",
  "most_common_mistake": "the most common error from similar days' lessons — be specific, not generic",
  "recommendation": "2-3 sentence actionable recommendation. Reference the HTF bias, specific liquidity levels or FVGs to watch, and what confirmation to wait for before entry. Ground it in the actual historical outcomes.",
  "risk_level": "low | moderate | high | very_high",
  "key_levels_to_watch": ["specific price levels from chart analysis that matter today"],
  "pattern_summary": "which SSMT pattern type this structure most resembles and how similar days played out"
}}

Be specific. Reference actual levels, patterns, and outcomes from the data. Do not give generic trading advice."""

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
