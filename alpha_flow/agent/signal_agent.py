"""
agents/signal_agent.py
Groq LLM agent — interprets microstructure signals per ticker with unique, data-grounded reasoning.
Uses primary GROQ_API_KEY with automatic fallback to GROQ_API_KEY_2.

SIGNAL-PRODUCER vs SIGNAL-EXPLAINER CONTRACT (do not violate):
  - The BUY/SELL/HOLD decision is ALWAYS computed deterministically upstream via
    the shared cross-sectional classifier (candidacy → Benjamini-Hochberg FDR gate):
    `_determine_signals_crosssectional` in alpha_flow/agent/langgraph_flow.py (daily)
    and `_build_intraday_cards` in backend/main.py (hourly), both calling
    `alpha_flow/analysis/signal_classification.py`.
  - This module (the LLM) NEVER decides the signal. `interpret_microstructure()` reads
    `state["signal"]` as a fixed input and only generates the one-sentence natural-
    language justification (`llm_reason`). An LLM must never be the sole source of a
    trading decision — non-deterministic, unauditable output has no place in the
    signal-generation path of a production quant system.
"""
import os
from pathlib import Path
from dotenv import load_dotenv

_ENV_PATH = Path(__file__).parent.parent.parent / ".env"
load_dotenv(_ENV_PATH)

LLM_MODEL = "llama-3.3-70b-versatile"

# Company context for each ticker — used to produce unique, ticker-specific reasoning
TICKER_INFO: dict[str, str] = {
    "AAPL":  "Apple Inc. — Consumer electronics & services; massive buy-back program keeps price resilient",
    "MSFT":  "Microsoft Corp. — Enterprise cloud (Azure); recurring SaaS revenue, very stable",
    "NVDA":  "NVIDIA Corp. — AI GPU monopoly; extremely high short-term volatility from AI demand cycles",
    "META":  "Meta Platforms — Digital advertising & social media; ad-revenue tied tightly to macro sentiment",
    "GOOGL": "Alphabet Inc. — Search, YouTube & GCP; diversified but ad-revenue still >75% of revenue",
    "AMZN":  "Amazon.com — E-commerce & AWS cloud; AWS margin expansion is the key earnings driver",
    "TSLA":  "Tesla Inc. — Electric vehicles & energy; high retail participation, extreme sentiment swings",
    "JPM":   "JPMorgan Chase — Universal bank; earnings driven by net interest margin (rate-sensitive)",
    "BAC":   "Bank of America — Consumer & commercial banking; highest rate-sensitivity of major US banks",
    "V":     "Visa Inc. — Global payment network; fee-based model, near-zero credit risk, high FCF margins",
}

# Historical typical Corwin-Schultz spreads for each ticker (bps) — for anomaly detection
TYPICAL_SPREAD_BPS: dict[str, float] = {
    "AAPL": 7.0, "MSFT": 7.0, "NVDA": 12.0, "META": 9.0, "GOOGL": 8.0,
    "AMZN": 9.0, "TSLA": 15.0, "JPM": 6.0, "BAC": 5.5, "V": 5.5,
}


def _groq_call(prompt: str, temperature: float = 0.1, max_tokens: int = 80) -> str:
    """Call Groq with automatic fallback to secondary key. seed=42 for reproducibility."""
    from groq import Groq  # type: ignore
    keys = [k for k in [
        os.getenv("GROQ_API_KEY", ""),
        os.getenv("GROQ_API_KEY_2", ""),
    ] if k]
    if not keys:
        raise EnvironmentError("No GROQ_API_KEY in .env")

    last_err: Exception = RuntimeError("No keys")
    for key in keys:
        try:
            client = Groq(api_key=key)
            resp = client.chat.completions.create(
                model=LLM_MODEL,
                temperature=temperature,
                seed=42,
                max_tokens=max_tokens,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a senior market microstructure analyst. "
                            "Write a ONE-SENTENCE explanation for why a stock was assigned "
                            "a given signal based on its microstructure metrics. "
                            "Be SPECIFIC: cite exact numbers from the data. "
                            "Never hallucinate metrics. Output format: REASON: [one sentence]"
                        )
                    },
                    {"role": "user", "content": prompt},
                ],
            )
            return resp.choices[0].message.content.strip()
        except Exception as e:
            last_err = e
    raise last_err


def interpret_microstructure(state: dict) -> dict:
    """
    Reads microstructure metrics from state and asks Groq for a ticker-specific signal.
    state keys: ticker, ofi_zscore, amihud, kyle_lambda, cs_spread, tick_sign, ic_value
    """
    ticker     = state.get("ticker", "UNKNOWN")
    ofi_z      = float(state.get("ofi_zscore") or 0.0)
    amihud_val = float(state.get("amihud") or 0.0)
    kyle_val   = float(state.get("kyle_lambda") or 0.0)
    spread_bps = float(state.get("cs_spread") or 0.0) * 10_000
    tick       = int(state.get("tick_sign") or 0)
    ic_val     = float(state.get("ic_value") or 0.0)

    typical_spread = TYPICAL_SPREAD_BPS.get(ticker, 10.0)
    spread_vs_typical = spread_bps / typical_spread if typical_spread > 0 else 1.0
    spread_note = (
        f"ELEVATED ({spread_vs_typical:.1f}× typical {typical_spread:.0f} bps — suggests stress)"
        if spread_vs_typical > 3 else
        f"normal ({spread_vs_typical:.1f}× typical)"
    )
    company_ctx = TICKER_INFO.get(ticker, f"{ticker} \u2014 custom ticker added to AlphaFlow universe")

    # Rank metrics by how anomalous they are for THIS ticker
    # This forces the LLM to focus on what is genuinely different per ticker
    ofi_flag  = abs(ofi_z) > 0.5
    amihud_flag = amihud_val > 2e-7
    kyle_flag   = kyle_val > 1e-7
    tick_flag   = tick != 0

    # Build a ranked list of notable signals so each ticker gets a different angle
    notable = []
    if ofi_flag:
        direction = "buying pressure" if ofi_z > 0 else "selling pressure"
        notable.append(f"OFI Z={ofi_z:+.3f} ({direction})")
    if spread_vs_typical > 3:
        notable.append(f"Spread {spread_bps:.1f} bps = {spread_vs_typical:.1f}× typical")
    if amihud_flag:
        notable.append(f"Amihud illiquidity {amihud_val:.2e} (elevated vs large-cap norm)")
    if kyle_flag:
        notable.append(f"Kyle λ={kyle_val:.2e} (elevated price impact)")
    if tick_flag and not notable:
        notable.append(f"tick sign {tick:+d}")

    headline_focus = notable[0] if notable else f"neutral readings (OFI Z={ofi_z:+.3f})"

    # Sector-specific angle to force narrative variety
    sector_angles = {
        "AAPL":  "consumer electronics demand cycle",
        "MSFT":  "cloud/enterprise software revenue visibility",
        "NVDA":  "GPU data-centre demand and supply chain",
        "META":  "digital advertising spend and AI capex cycle",
        "GOOGL": "search/cloud duality and regulatory overhang",
        "AMZN":  "AWS margin expansion vs retail capex",
        "TSLA":  "EV delivery cadence and energy business growth",
        "JPM":   "net interest margin and credit cycle positioning",
        "BAC":   "deposit re-pricing sensitivity to rate moves",
        "V":     "payment network volume and cross-border recovery",
    }
    sector_hint = sector_angles.get(ticker, "sector dynamics")

    # Signal is determined by cross-sectional ranking in langgraph_flow — NOT by LLM.
    # LLM only writes the reason sentence.
    signal = state.get("signal", "HOLD")

    prompt = f"""Explain in ONE sentence why {ticker} was assigned a {signal} signal.

Ticker: {ticker} — {company_ctx}
Sector angle: {sector_hint}
Assigned signal: {signal}

Current microstructure readings:
  OFI Z-score:          {ofi_z:+.3f}   (>+1.5 = net buying; <-1.5 = net selling; ~0 = neutral)
  Corwin-Schultz Spread:{spread_bps:.1f} bps  [{spread_note}]
  Amihud Illiquidity:   {amihud_val:.3e}  (liquid large-caps typical < 1e-7)
  Kyle Lambda:          {kyle_val:.3e}  (price impact per unit order flow)
  Last Tick Sign:       {tick:+d}        (+1 uptick / -1 downtick)
  Walk-forward IC:      {ic_val:.4f}   (>0.05 = statistically significant; ~0.0 expected at OHLCV resolution)

Most notable reading: {headline_focus}

Rules:
1. Start with "{ticker}" or the company name
2. Cite at least one EXACT number from the readings
3. Reference {sector_hint} or the most anomalous metric
4. Max 25 words. Output EXACTLY one line: REASON: [sentence]"""

    # Hourly: add intraday context to the prompt when running in hourly mode
    if state.get("resolution") == "hourly":
        vwap_z    = float(state.get("vwap_zscore") or 0.0)
        hawkes_z  = float(state.get("hawkes_zscore") or 0.0)
        vol_z     = float(state.get("volume_zscore") or 0.0)
        shap_top  = state.get("shap_top_feature") or "ofi_zscore"
        prompt += f"""

Intraday signals (hourly resolution):
  VWAP Deviation Z:     {vwap_z:+.3f}  (<-1.5 = below VWAP → reversion buy; >+1.5 = above VWAP → reversion sell)
  Hawkes Intensity Z:   {hawkes_z:+.3f}  (>+2 = institutional activity burst detected)
  Volume Imbalance Z:   {vol_z:+.3f}  (>0 = net buying; <0 = net selling)
  Top SHAP feature:     {shap_top}  (most influential signal for this prediction)"""

    text = _groq_call(prompt, temperature=0.1, max_tokens=80)

    reason = ""
    for line in text.split("\n"):
        stripped = line.strip()
        if stripped.upper().startswith("REASON:"):
            reason = stripped.split(":", 1)[1].strip()
            break
    if not reason:
        # Fallback: use the whole response as reason if format not followed
        reason = text.replace("REASON:", "").strip()[:200]

    return {**state, "llm_signal": signal, "llm_reason": reason}
