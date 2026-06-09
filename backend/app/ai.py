import os, base64, json
from pathlib import Path
from typing import Dict, Any, List
from openai import OpenAI

client = OpenAI(api_key=os.getenv('OPENAI_API_KEY')) if os.getenv('OPENAI_API_KEY') else None

def has_ai() -> bool:
    return client is not None

def _image_b64(content: bytes, content_type: str) -> str:
    return f"data:{content_type or 'image/png'};base64," + base64.b64encode(content).decode('utf-8')

def analyze_chart_image_bytes(content: bytes, kind: str, content_type: str='image/png') -> Dict[str, Any]:
    if not client:
        return {'summary':'AI disabled. Add OPENAI_API_KEY and rerun analysis.', 'tags':[], 'market_structure':{}}
    prompt = f"""
You are analyzing a trader's {kind} screenshot for a private trading journal. Return strict JSON only.
Extract observable chart details without pretending certainty. Include:
summary, directional_bias, market_structure, key_levels, setup_tags, risk_notes, what_to_review, ideal_vs_actual_notes.
For market_structure include: gap_context, premarket_trend, trend_or_chop, breakout_retest, liquidity_sweep, vwap_context, volume_context when visible.
"""
    resp = client.chat.completions.create(
        model='gpt-4o-mini',
        messages=[{'role':'user','content':[{'type':'text','text':prompt},{'type':'image_url','image_url':{'url':_image_b64(content, content_type)}}]}],
        response_format={'type':'json_object'},
        temperature=0.2,
    )
    txt = resp.choices[0].message.content or '{}'
    try: return json.loads(txt)
    except Exception: return {'summary':txt, 'tags':[], 'market_structure':{}}

def summarize_day(day:dict, uploads:list, trades:list) -> Dict[str, Any]:
    if not client:
        return {'summary':'AI disabled. Add OPENAI_API_KEY and rerun intelligence.', 'setup_tags':'', 'market_structure':{}, 'execution_review':{}}
    payload = {'day':day, 'uploads':uploads, 'trade_rows_sample':trades[:50]}
    prompt = """You are a trading intelligence journal. Return strict JSON with:
summary, setup_tags as comma string, market_structure object, execution_review object, lessons, mistakes, strengths, review_questions.
Compare actual trade data/notes against ideal trade notes/screenshot descriptions when available. Be direct and specific."""
    resp = client.chat.completions.create(
        model='gpt-4o-mini',
        messages=[{'role':'system','content':prompt},{'role':'user','content':json.dumps(payload, default=str)[:60000]}],
        response_format={'type':'json_object'}, temperature=0.2)
    try: return json.loads(resp.choices[0].message.content or '{}')
    except Exception: return {'summary':resp.choices[0].message.content or '', 'setup_tags':'', 'market_structure':{}, 'execution_review':{}}

def embed_text(text: str) -> List[float] | None:
    if not client or not text.strip(): return None
    resp = client.embeddings.create(model='text-embedding-3-small', input=text[:12000])
    return resp.data[0].embedding
