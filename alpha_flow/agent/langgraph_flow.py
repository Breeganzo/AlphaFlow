"""
agents/langgraph_flow.py
LangGraph pipeline for Market Microstructure Alpha Engine.

Nodes:
  1. fetch_data        — load 2-year daily bars per ticker (cache-first)
  2. compute_features  — OFI z, Amihud, Kyle-λ, CS-spread, tick-sign per ticker
  3. lgbm_predict      — walk-forward LightGBM IC on all 10 tickers
  4. llm_interpret     — individual Groq LLM signal for EACH ticker (10 calls)
  5. summarise         — print top signals, IC table

Run:
    python3 -m alpha_flow.agent.langgraph_flow
"""
import numpy as np
import pandas as pd
from langgraph.graph import StateGraph, END  # type: ignore
from alpha_flow.config.settings import TICKERS, get_all_tickers
from alpha_flow.data.data_feed import get_daily_bars
from alpha_flow.core.ofi_calculator import rolling_ofi_zscore
from alpha_flow.core.amihud import amihud_ratio, kyle_lambda
from alpha_flow.core.spread_tracker import corwin_schultz_spread
from alpha_flow.core.lee_ready import tick_sign
from alpha_flow.agent.signal_agent import interpret_microstructure
from alpha_flow.analysis.lightgbm_trainer import walk_forward_train
from alpha_flow.analysis.performance import (
    summary_stats, annualised_sharpe, simulate_longshort_portfolio,
)


# ── Cross-sectional signal ranking ────────────────────────────────────────────
def _determine_signals_crosssectional(snapshots: dict, lgbm_results: dict) -> dict[str, str]:
    """
    Assign BUY/SELL/HOLD via cross-sectional OFI Z-score ranking.
    Industry standard (AQR, Two Sigma approach):
      - Top 20% of tickers by OFI Z  → BUY  (at least 1)
      - Bottom 20% by OFI Z          → SELL (at least 1)
      - Remaining 60%                → HOLD
    Signal is fully deterministic — not set by LLM.

    Reference: Grinold & Kahn (2000) Active Portfolio Management, Ch.6.
    """
    n = len(snapshots)
    if n == 0:
        return {}
    ranked = sorted(snapshots.keys(),
                    key=lambda t: snapshots[t]["ofi_zscore"],
                    reverse=True)
    n_top = max(1, round(n * 0.20))   # top 20% = BUY
    n_bot = max(1, round(n * 0.20))   # bottom 20% = SELL
    signals: dict[str, str] = {}
    for i, ticker in enumerate(ranked):
        if i < n_top:
            signals[ticker] = "BUY"
        elif i >= n - n_bot:
            signals[ticker] = "SELL"
        else:
            signals[ticker] = "HOLD"
    return signals


# ── Node 1 ────────────────────────────────────────────────────────────────────
def fetch_data(state: dict) -> dict:
    print("[1/5] Loading 2-year daily bars (cache-first) …")
    all_tickers = get_all_tickers()
    print(f"  Universe: {all_tickers}")
    bars: dict[str, pd.DataFrame] = {}
    for t in all_tickers:
        df = get_daily_bars(t, years=2)
        if len(df) > 50:
            bars[t] = df
        src = "cache" if (len(df) > 50) else "synthetic"
        print(f"  {t}: {len(df)} bars [{src}]")
    return {**state, "bars": bars}


# ── Node 2 ────────────────────────────────────────────────────────────────────
def compute_features(state: dict) -> dict:
    print("[2/5] Computing microstructure features …")
    bars: dict[str, pd.DataFrame] = state["bars"]
    snapshots = {}
    for t, df in bars.items():
        ofi_z_series = rolling_ofi_zscore(df)
        am    = amihud_ratio(df)
        kl    = kyle_lambda(df)
        sp    = corwin_schultz_spread(df)
        ts    = tick_sign(df["close"])

        # Use mean of last 20 bars for OFI (more stable than last-bar only)
        ofi_recent = ofi_z_series.dropna().tail(20)
        ofi_z_val  = float(ofi_recent.mean()) if len(ofi_recent) > 0 else 0.0

        snapshots[t] = {
            "ticker":       t,
            "ofi_zscore":   ofi_z_val,
            "ofi_series":   ofi_z_series,   # full series for chart
            "amihud":       float(am.dropna().tail(20).mean()) if len(am.dropna()) > 0 else 0.0,
            "kyle_lambda":  float(kl.dropna().tail(20).mean()) if len(kl.dropna()) > 0 else 0.0,
            "cs_spread":    float(sp.dropna().tail(20).mean()) if len(sp.dropna()) > 0 else 0.0,
            "tick_sign":    int(ts.iloc[-1]) if len(ts) > 0 else 0,
        }
    return {**state, "snapshots": snapshots}


# ── Node 3 (Phase 2) ─────────────────────────────────────────────────────────
def intraday_features(state: dict) -> dict:
    """
    Phase 2 conditional node: activates when resolution='hourly'.
    Runs the full intraday pipeline (VWAP + Hawkes + Volume Clock + SHAP)
    and adds results to state for the LLM to use.
    """
    if state.get("resolution") != "hourly":
        return state   # Daily mode: skip this node entirely

    print("[3/6] Running Phase 2 intraday pipeline (VWAP + Hawkes + Volume Clock) …")
    tickers = list(state.get("bars", {}).keys())
    if not tickers:
        return state

    try:
        from alpha_flow.analysis.intraday_engine import run_intraday_pipeline
        intraday_results = run_intraday_pipeline(tickers, resolution="1h")
        mean_ic_values = [v["mean_ic"] for v in intraday_results.values() if "mean_ic" in v]
        avg_ic = float(sum(mean_ic_values) / len(mean_ic_values)) if mean_ic_values else 0.0
        print(f"  Phase 2 avg IC across {len(tickers)} tickers: {avg_ic:.4f}")
        for t, res in intraday_results.items():
            ic = res.get("mean_ic", 0.0)
            n  = res.get("n_folds", 0)
            print(f"  {t}: IC={ic:.4f}  folds={n}")
        return {**state, "intraday_results": intraday_results, "intraday_avg_ic": avg_ic}
    except Exception as exc:
        print(f"  [intraday_features] Error: {exc}")
        return state


# ── Node 4 ────────────────────────────────────────────────────────────────────
def lgbm_predict(state: dict) -> dict:
    print("[3/5] Running walk-forward LightGBM on all tickers …")
    bars = state["bars"]
    ic_by_ticker: dict[str, float] = {}
    lgbm_results_all: dict[str, dict] = {}
    lgbm_prob_by_ticker: dict[str, float] = {}

    for ticker, df in bars.items():
        if len(df) < 160:
            ic_by_ticker[ticker] = 0.0
            lgbm_prob_by_ticker[ticker] = 0.5
            continue
        try:
            results = walk_forward_train(df, train_window=200, test_window=50, horizon=1)
            stats = summary_stats(results["predictions"], results["actuals"])
            ic_val = float(stats.get("IC", 0.0))
            ic_by_ticker[ticker] = ic_val if not np.isnan(ic_val) else 0.0
            lgbm_results_all[ticker] = results
            # Per-ticker Sharpe from raw predictions as period returns
            sharpe_t = annualised_sharpe(results["actuals"])
            results["sharpe"] = round(float(sharpe_t) if not np.isnan(sharpe_t) else 0.0, 4)
            # Last prediction as probability proxy (centred on 0.5)
            last_pred = results["predictions"][-1] if results["predictions"] else 0.0
            lgbm_prob = max(0.0, min(1.0, 0.5 + float(last_pred) / 2.0))
            lgbm_prob_by_ticker[ticker] = round(lgbm_prob, 4)
            print(f"  {ticker}: IC={ic_by_ticker[ticker]:.4f}  AUC={stats.get('AUC', 0):.4f}  Sharpe={results['sharpe']:.2f}  prob={lgbm_prob:.3f}")
        except Exception as exc:
            print(f"  {ticker}: LGBM error — {exc}")
            ic_by_ticker[ticker] = 0.0
            lgbm_prob_by_ticker[ticker] = 0.5

    return {**state, "lgbm_results": lgbm_results_all,
            "ic_by_ticker": ic_by_ticker,
            "lgbm_prob_by_ticker": lgbm_prob_by_ticker}


# ── Node 4 ────────────────────────────────────────────────────────────────────
def llm_interpret(state: dict) -> dict:
    print("[4/5] Calling Groq LLM for each ticker (reason only — signal from ranking) …")
    snapshots = state.get("snapshots", {})
    ic_by_ticker = state.get("ic_by_ticker", {})
    lgbm_results = state.get("lgbm_results", {})

    # Determine signals deterministically via cross-sectional OFI ranking
    cs_signals = _determine_signals_crosssectional(snapshots, lgbm_results)
    print(f"  Cross-sectional signals: { {t: cs_signals[t] for t in sorted(cs_signals)} }")

    llm_signals: dict[str, dict] = {}  # ticker → {signal, reason}

    for ticker, snap in snapshots.items():
        determined_signal = cs_signals.get(ticker, "HOLD")
        snap_with_ic = {
            **snap,
            "ic_value": ic_by_ticker.get(ticker, 0.0),
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
                clean_err = "Groq daily token limit reached — re-run tomorrow or add GROQ_API_KEY_2"
            elif '401' in err_str or 'auth' in err_str.lower():
                clean_err = "Groq auth error — check GROQ_API_KEY in .env"
            else:
                clean_err = f"LLM unavailable: {err_str[:120]}"
            print(f"  {ticker}: LLM error \u2014 {clean_err}")
            llm_signals[ticker] = {"signal": determined_signal, "reason": clean_err}

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
    lgbm_results = state.get("lgbm_results", {})
    llm_signals  = state.get("llm_signals", {})

    print(f"  Tickers analysed: {len(snapshots)}")
    header = f"  {'Ticker':<7} {'OFI_z':>7} {'Spread':>8} {'IC':>7} {'Sharpe':>7} {'Signal':<6}"
    print(header)
    print("  " + "-" * 52)
    for t, snap in sorted(snapshots.items()):
        sig    = llm_signals.get(t, {}).get("signal", "HOLD")
        sharpe = lgbm_results.get(t, {}).get("sharpe", 0.0)
        print(f"  {t:<7} {snap['ofi_zscore']:>+7.3f} {snap['cs_spread']*1e4:>7.1f}bps "
              f"{ic_by_tick.get(t, 0):>+7.4f}  {sharpe:>+6.2f}  {sig:<6}")

    # Long-short portfolio simulation
    # Build a simple single-snapshot portfolio (limited without time series of snapshots)
    all_actuals = {t: lgbm_results[t]["actuals"] for t in lgbm_results if lgbm_results[t].get("actuals")}
    if all_actuals and len(all_actuals) >= 2:
        # Use current snapshot ofi_zscores as the ranking signal
        single_snap = {t: {"ofi_zscore": snapshots[t]["ofi_zscore"]} for t in snapshots if t in all_actuals}
        min_len = min(len(v) for v in all_actuals.values())
        synced_snaps = [single_snap] * min_len   # same ranking repeated (simplified)
        synced_rets  = {t: v[:min_len] for t, v in all_actuals.items()}
        portfolio = simulate_longshort_portfolio(synced_snaps, synced_rets)
        print(f"\n  === LONG-SHORT PORTFOLIO (top-2 OFI vs bottom-2) ===")
        print(f"  Sharpe (annualised): {portfolio['sharpe']:+.3f}")
        print(f"  Max Drawdown:        {portfolio['max_drawdown']:.1%}")
        print(f"  Periods simulated:   {portfolio['n_periods']}")
        state = {**state, "portfolio_stats": portfolio}

    top = state.get("signal_ticker", "")
    print(f"\n  === TOP SIGNAL: {state.get('llm_signal', 'N/A')} ({top}) ===")
    return state


# ── Build graph ───────────────────────────────────────────────────────────────
def build_graph() -> StateGraph:
    g = StateGraph(dict)
    g.add_node("fetch_data",        fetch_data)
    g.add_node("compute_features",  compute_features)
    g.add_node("intraday_features", intraday_features)   # Phase 2 — no-op in daily mode
    g.add_node("lgbm_predict",      lgbm_predict)
    g.add_node("llm_interpret",     llm_interpret)
    g.add_node("summarise",         summarise)

    g.set_entry_point("fetch_data")
    g.add_edge("fetch_data",        "compute_features")
    g.add_edge("compute_features",  "intraday_features")  # Phase 2 node (no-op in daily mode)
    g.add_edge("intraday_features", "lgbm_predict")
    g.add_edge("lgbm_predict",      "llm_interpret")
    g.add_edge("llm_interpret",     "summarise")
    g.add_edge("summarise",         END)
    return g


def run() -> dict:
    print("=" * 60)
    print("  AlphaFlow — Market Microstructure Alpha Engine")
    print("=" * 60)
    g = build_graph()
    app = g.compile()
    final = app.invoke({})
    print("\n[DONE]")
    return final


if __name__ == "__main__":
    run()
