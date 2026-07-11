"""
agents/langgraph_flow.py
LangGraph pipeline for Market Microstructure Alpha Engine.

Nodes:
  1. fetch_data        — load 2-year daily bars per ticker (cache-first)
  2. compute_features  — OFI z, Amihud, Kyle-λ, CS-spread, tick-sign per ticker,
                         plus daily signal IC (Spearman ρ: OFI z-score vs 1-bar
                         forward return — Grinold & Kahn 2000 IC definition)
  3. intraday_features — conditional: runs the hourly LightGBM walk-forward when
                         resolution='hourly' (see analysis/intraday_engine.py)
  4. llm_interpret     — Groq LLM narrative reason for EACH ticker (never sets
                         the signal — the BUY/SELL/HOLD is decided deterministically)
  5. summarise         — print top signals, IC table

Run:
    python3 -m alpha_flow.agent.langgraph_flow
"""
import numpy as np
import pandas as pd
from typing import Callable
from langgraph.graph import StateGraph, END  # type: ignore
from scipy.stats import spearmanr
from alpha_flow.config.settings import (
    get_all_tickers, SIGNAL_RANK_FRACTION, GROQ_CALL_DELAY,
)
from alpha_flow.analysis.signal_classification import classify_signal
from alpha_flow.data.data_feed import get_daily_bars
from alpha_flow.core.ofi_calculator import rolling_ofi_zscore
from alpha_flow.core.amihud import amihud_ratio, kyle_lambda
from alpha_flow.core.spread_tracker import corwin_schultz_spread
from alpha_flow.core.lee_ready import tick_sign
from alpha_flow.agent.signal_agent import interpret_microstructure


# ── Cross-sectional signal ranking ────────────────────────────────────────────
def _determine_signals_crosssectional(
    snapshots: dict,
    ic_by_ticker: dict | None = None,
    ic_pvalue_by_ticker: dict | None = None,
) -> dict[str, str]:
    """
    Assign the Tier-1 tradeable BUY/SELL/HOLD via the shared classifier (see
    `alpha_flow/analysis/signal_classification.py`) — same construction as the
    Hourly resolution's `_build_intraday_cards` (backend/main.py).

    Cross-sectional long-short (AQR/Two Sigma style): rank the universe by OFI
    Z-score (the directional signal), BUY the top SIGNAL_RANK_FRACTION and SELL
    the bottom SIGNAL_RANK_FRACTION, each confirmed by a sign-consistency check
    (BUY needs z > 0 and ic >= 0; SELL needs z < 0 and ic <= 0). The book is
    NOT gated on per-name statistical significance — a cross-sectional book
    monetises the rank spread, not individual-name significance. Statistical
    significance is reported separately (see `is_high_conviction`), never as a
    gate that suppresses the tradeable signal.

    `ic_pvalue_by_ticker` is accepted for interface parity with the Hourly path
    (used there for the high-conviction flag) but is not required for the daily
    tradeable signal. Signal is fully deterministic — never set by the LLM.

    Reference: Grinold & Kahn (2000) Active Portfolio Management, Ch.6.
    """
    n = len(snapshots)
    if n == 0:
        return {}
    ic_by_ticker = ic_by_ticker or {}
    ranked = sorted(snapshots.keys(),
                    key=lambda t: snapshots[t]["ofi_zscore"],
                    reverse=True)
    n_top = max(1, round(n * SIGNAL_RANK_FRACTION))   # top fraction = BUY candidates (settings.py)
    n_bot = max(1, round(n * SIGNAL_RANK_FRACTION))   # bottom fraction = SELL candidates (settings.py)
    buy_rank  = set(ranked[:n_top])
    sell_rank = set(ranked[n - n_bot:])

    # Tier-1 tradeable book: rank by OFI z-score (the directional signal), long
    # the top decile / short the bottom decile, sign-consistent with IC. Not
    # gated on per-name FDR significance — see signal_classification module docs.
    signals: dict[str, str] = {}
    for ticker in snapshots:
        z  = snapshots[ticker]["ofi_zscore"]
        ic = ic_by_ticker.get(ticker, 0.0)
        signals[ticker] = classify_signal(
            signal_value=z,
            in_buy_rank=ticker in buy_rank,
            in_sell_rank=ticker in sell_rank,
            sign_ok_buy=(z > 0 and ic >= 0),
            sign_ok_sell=(z < 0 and ic <= 0),
            abs_threshold=float("inf"),   # daily candidacy is rank-based only
        )
    return signals


# ── Node 1 ────────────────────────────────────────────────────────────────────
def fetch_data(state: dict) -> dict:
    print("[1/5] Loading 2-year daily bars (cache-first) …")
    all_tickers = get_all_tickers()
    print(f"  Universe: {all_tickers}")
    on_ticker_done = state.get("on_ticker_done")
    total = len(all_tickers)
    bars: dict[str, pd.DataFrame] = {}
    for i, t in enumerate(all_tickers):
        df = get_daily_bars(t, years=2)
        if len(df) > 50:
            bars[t] = df
        src = "cache" if (len(df) > 50) else "synthetic"
        print(f"  {t}: {len(df)} bars [{src}]")
        if on_ticker_done:
            try:
                on_ticker_done("fetch_data", t, i + 1, total)
            except Exception:
                pass
    return {**state, "bars": bars}


# ── Node 2 ────────────────────────────────────────────────────────────────────
def compute_features(state: dict) -> dict:
    print("[2/5] Computing microstructure features …")
    bars: dict[str, pd.DataFrame] = state["bars"]
    on_ticker_done = state.get("on_ticker_done")
    total = len(bars)
    snapshots = {}
    ic_by_ticker: dict[str, float] = {}
    ic_pvalue_by_ticker: dict[str, float] = {}
    for i, (t, df) in enumerate(bars.items()):
        ofi_z_series = rolling_ofi_zscore(df)
        am    = amihud_ratio(df)
        kl    = kyle_lambda(df)
        sp    = corwin_schultz_spread(df)
        ts    = tick_sign(df["close"])

        # Use mean of last 20 bars for OFI (more stable than last-bar only)
        ofi_recent = ofi_z_series.dropna().tail(20)
        ofi_z_val  = float(ofi_recent.mean()) if len(ofi_recent) > 0 else 0.0

        # Daily signal IC: Spearman correlation of OFI z-score vs next-bar forward
        # return (Grinold & Kahn 2000 IC definition — same methodology already used
        # for the Alpha Decay chart in backend/main.py::_generate_charts). Cheap,
        # honest alternative to a full LightGBM walk-forward at daily resolution —
        # Hourly mode uses the heavier LightGBM walk-forward instead (see
        # alpha_flow/analysis/intraday_engine.py).
        fwd_ret = df["close"].pct_change().shift(-1)
        common  = ofi_z_series.dropna().index.intersection(fwd_ret.dropna().index)
        if len(common) >= 20:
            ic_val, p_val = spearmanr(ofi_z_series.loc[common], fwd_ret.loc[common])
            ic_by_ticker[t] = 0.0 if np.isnan(ic_val) else float(ic_val)
            ic_pvalue_by_ticker[t] = 1.0 if np.isnan(p_val) else float(p_val)
        else:
            ic_by_ticker[t] = 0.0
            ic_pvalue_by_ticker[t] = 1.0   # insufficient data — never significant by default

        snapshots[t] = {
            "ticker":       t,
            "ofi_zscore":   ofi_z_val,
            "ofi_series":   ofi_z_series,   # full series for chart
            "amihud":       float(am.dropna().tail(20).mean()) if len(am.dropna()) > 0 else 0.0,
            "kyle_lambda":  float(kl.dropna().tail(20).mean()) if len(kl.dropna()) > 0 else 0.0,
            "cs_spread":    float(sp.dropna().tail(20).mean()) if len(sp.dropna()) > 0 else 0.0,
            "tick_sign":    int(ts.iloc[-1]) if len(ts) > 0 else 0,
        }
        if on_ticker_done:
            try:
                on_ticker_done("compute_features", t, i + 1, total)
            except Exception:
                pass
    return {**state, "snapshots": snapshots, "ic_by_ticker": ic_by_ticker, "ic_pvalue_by_ticker": ic_pvalue_by_ticker}


# ── Node 3 (hourly only) ──────────────────────────────────────────────────────
def intraday_features(state: dict) -> dict:
    """
    Conditional node: activates when resolution='hourly'.
    Runs the full intraday pipeline (VWAP + Hawkes + Volume Clock + SHAP)
    and adds results to state for the LLM to use.
    """
    if state.get("resolution") != "hourly":
        return state   # Daily mode: skip this node entirely

    print("[3/5] Running intraday pipeline (VWAP + Hawkes + Volume Clock) …")
    tickers = list(state.get("bars", {}).keys())
    if not tickers:
        return state

    try:
        from alpha_flow.analysis.intraday_engine import run_intraday_pipeline
        intraday_results = run_intraday_pipeline(tickers, resolution="1h")
        mean_ic_values = [v["mean_ic"] for v in intraday_results.values() if "mean_ic" in v]
        avg_ic = float(sum(mean_ic_values) / len(mean_ic_values)) if mean_ic_values else 0.0
        print(f"  Intraday avg IC across {len(tickers)} tickers: {avg_ic:.4f}")
        for t, res in intraday_results.items():
            ic = res.get("mean_ic", 0.0)
            n  = res.get("n_folds", 0)
            print(f"  {t}: IC={ic:.4f}  folds={n}")
        return {**state, "intraday_results": intraday_results, "intraday_avg_ic": avg_ic}
    except Exception as exc:
        print(f"  [intraday_features] Error: {exc}")
        return state


# ── Node 4 ────────────────────────────────────────────────────────────────────
def llm_interpret(state: dict) -> dict:
    print("[4/5] Calling Groq LLM for each ticker (reason only — signal from ranking) …")
    import time
    snapshots = state.get("snapshots", {})
    ic_by_ticker = state.get("ic_by_ticker", {})
    ic_pvalue_by_ticker = state.get("ic_pvalue_by_ticker", {})
    on_ticker_done = state.get("on_ticker_done")

    # Determine signals deterministically via cross-sectional OFI ranking,
    # gated by sign-consistency + FDR-corrected IC significance (see
    # _determine_signals_crosssectional)
    cs_signals = _determine_signals_crosssectional(snapshots, ic_by_ticker, ic_pvalue_by_ticker)
    print(f"  Cross-sectional signals: { {t: cs_signals[t] for t in sorted(cs_signals)} }")

    llm_signals: dict[str, dict] = {}  # ticker → {signal, reason}
    n_tickers = len(snapshots)
    # Groq free tier = 30 RPM — GROQ_CALL_DELAY (settings.py) staggers calls to stay safe.

    for i, (ticker, snap) in enumerate(snapshots.items()):
        determined_signal = cs_signals.get(ticker, "HOLD")
        ic_val = ic_by_ticker.get(ticker)  # Spearman IC (OFI vs 1-bar fwd return) from compute_features
        snap_with_ic = {
            **snap,
            "ic_value": ic_val,
            "ic_note": "Daily signal IC = Spearman ρ(OFI z-score, 1-bar fwd return). Switch to Hourly for the full LightGBM walk-forward IC.",
            "signal":   determined_signal,           # ← LLM reads this, never sets it
        }
        try:
            result = interpret_microstructure(snap_with_ic)
            llm_signals[ticker] = {
                "signal": determined_signal,          # always use ranked signal
                "reason": result.get("llm_reason", ""),
            }
            print(f"  {ticker}: {determined_signal} — {llm_signals[ticker]['reason'][:80]}")
        except Exception as exc:
            err_str = str(exc)
            # Shorten verbose Groq rate-limit / API errors to a clean one-liner
            if 'rate_limit' in err_str.lower() or 'Rate limit' in err_str or '429' in err_str:
                clean_err = "Groq rate limit — staggered calls in progress, retry in 60s"
            elif '401' in err_str or 'auth' in err_str.lower():
                clean_err = "Groq auth error — check GROQ_API_KEY in .env"
            else:
                clean_err = f"LLM unavailable: {err_str[:120]}"
            print(f"  {ticker}: LLM error \u2014 {clean_err}")
            llm_signals[ticker] = {"signal": determined_signal, "reason": clean_err}
        if on_ticker_done:
            try:
                on_ticker_done("llm_interpret", ticker, i + 1, n_tickers)
            except Exception:
                pass
        # Stagger calls to avoid hitting Groq 30 RPM limit (skip delay for last ticker)
        if i < n_tickers - 1:
            time.sleep(GROQ_CALL_DELAY)

    # Top ticker by OFI magnitude for legacy state keys
    top_ticker = max(snapshots, key=lambda t: abs(snapshots[t]["ofi_zscore"])) if snapshots else ""
    return {
        **state,
        "llm_signals":   llm_signals,
        "llm_signal":    llm_signals.get(top_ticker, {}).get("signal", "HOLD"),
        "llm_reason":    llm_signals.get(top_ticker, {}).get("reason", ""),
        "signal_ticker": top_ticker,
    }


# ── Node 5 ────────────────────────────────────────────────────────────────────
def summarise(state: dict) -> dict:
    print("[5/5] Summary")
    snapshots    = state.get("snapshots", {})
    ic_by_tick   = state.get("ic_by_ticker", {})
    llm_signals  = state.get("llm_signals", {})

    print(f"  Tickers analysed: {len(snapshots)}")
    header = f"  {'Ticker':<7} {'OFI_z':>7} {'Spread':>8} {'IC':>7} {'Signal':<6}"
    print(header)
    print("  " + "-" * 44)
    for t, snap in sorted(snapshots.items()):
        sig = llm_signals.get(t, {}).get("signal", "HOLD")
        print(f"  {t:<7} {snap['ofi_zscore']:>+7.3f} {snap['cs_spread']*1e4:>7.1f}bps "
              f"{ic_by_tick.get(t, 0):>+7.4f}  {sig:<6}")

    # Portfolio performance (Sharpe/IC_IR over a walk-forward equity curve) is a
    # Hourly-resolution feature — daily OHLCV has no intra-bar forward-return
    # series to simulate a long-short book against. See /api/portfolio/simulate
    # and analysis/portfolio_engine.py (hourly).

    top = state.get("signal_ticker", "")
    print(f"\n  === TOP SIGNAL: {state.get('llm_signal', 'N/A')} ({top}) ===")
    return state


# ── Build graph ───────────────────────────────────────────────────────────────
def build_graph() -> StateGraph:
    g = StateGraph(dict)
    g.add_node("fetch_data",        fetch_data)
    g.add_node("compute_features",  compute_features)
    g.add_node("intraday_features", intraday_features)   # hourly only — no-op in daily mode
    g.add_node("llm_interpret",     llm_interpret)
    g.add_node("summarise",         summarise)

    g.set_entry_point("fetch_data")
    g.add_edge("fetch_data",        "compute_features")
    g.add_edge("compute_features",  "intraday_features")  # hourly-only node (no-op in daily mode)
    g.add_edge("intraday_features", "llm_interpret")      # daily IC already set by compute_features
    g.add_edge("llm_interpret",     "summarise")
    g.add_edge("summarise",         END)
    return g


def run(on_ticker_done: "Callable[[str, str, int, int], None] | None" = None) -> dict:
    print("=" * 60)
    print("  AlphaFlow — Market Microstructure Alpha Engine")
    print("=" * 60)
    g = build_graph()
    app = g.compile()
    final = app.invoke({"on_ticker_done": on_ticker_done})
    print("\n[DONE]")
    return final


if __name__ == "__main__":
    run()
