"""
run_agent.py — Project 2: Market Microstructure Alpha Engine
Single entry point. Run with:
    python3 alpha_flow/run_agent.py

Executes:
  1. LangGraph pipeline (data → features → LGBM → LLM → summary)
  2. Full walk-forward backtest (IC table, AUC, hit rate, SHAP importance)
  3. Microstructure signal card for current snapshot

Fallbacks:
  - Groq API unavailable → LLM step skipped, raw model scores printed
  - LightGBM not installed → rule-based signal used (OFI Z-score threshold)
  - SHAP not installed → feature importance from LGBM .feature_importances_ used
"""
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).parent  # outer folder contains the package
WORKSPACE = ROOT.parent
for p in [str(ROOT), str(WORKSPACE)]:
    if p not in sys.path:
        sys.path.insert(0, p)


def run_langgraph_pipeline() -> None:
    print("\n" + "=" * 60)
    print("  PROJECT 2 — MARKET MICROSTRUCTURE ENGINE")
    print("  Step 1/3: LangGraph Pipeline")
    print("=" * 60)
    try:
        from alpha_flow.agent.langgraph_flow import build_graph
        g   = build_graph()
        app = g.compile()
        final = app.invoke({})
        print(f"  Pipeline completed. {len(final.get('predictions', []))} predictions generated.")
    except Exception as exc:  # noqa: BLE001
        print(f"  [WARN] LangGraph pipeline error: {exc}")


def run_backtest_suite() -> None:
    print("\n" + "=" * 60)
    print("  Step 2/3: Walk-Forward Backtest")
    print("=" * 60)
    try:
        from alpha_flow.analysis.backtest import run_backtest
        run_backtest(verbose=True)
    except Exception as exc:  # noqa: BLE001
        print(f"  [WARN] Backtest error: {exc}")
        traceback.print_exc()


def run_signal_card() -> None:
    print("\n" + "=" * 60)
    print("  Step 3/3: Current Microstructure Signal Card")
    print("=" * 60)
    try:
        from alpha_flow.signals.signal_generator import (
            generate_signal_card, print_signal_card,
        )
        card = generate_signal_card()
        print_signal_card(card)
    except Exception as exc:  # noqa: BLE001
        print(f"  [WARN] Signal card error: {exc}")


def run_figures() -> None:
    print("\n" + "=" * 60)
    print("  Step 4/4: Generating Output Charts")
    print("=" * 60)
    try:
        import numpy as np
        import pandas as pd
        from scipy.stats import spearmanr
        from alpha_flow.data.data_feed import get_daily_bars
        from alpha_flow.config.settings import TICKERS
        from alpha_flow.core.ofi_calculator import compute_ofi, rolling_ofi_zscore
        from alpha_flow.core.amihud import amihud_ratio, kyle_lambda
        from alpha_flow.core.spread_tracker import corwin_schultz_spread
        from alpha_flow.analysis.figures import (
            plot_ofi_zscore_chart,
            plot_execution_quality,
            plot_kyle_lambda_trend,
            plot_alpha_decay,
            save_microstructure_report,
        )
        from alpha_flow.analysis.backtest import compute_alpha_decay

        all_eff, all_amihud, all_kyle = [], [], []
        ofi_by_ticker: dict = {}
        ic_values: list[float] = []
        first_df = None

        for ticker in TICKERS[:3]:
            try:
                df = get_daily_bars(ticker, years=2)
                if first_df is None:
                    first_df = df
                ofi_z = rolling_ofi_zscore(df)
                eff   = corwin_schultz_spread(df)
                ami   = amihud_ratio(df)
                kyl   = kyle_lambda(df)

                if ofi_z is not None and not ofi_z.empty:
                    fwd = df["close"].pct_change(1).shift(-1)
                    common = ofi_z.index.intersection(fwd.dropna().index)
                    if len(common) >= 20:
                        ic, _ = spearmanr(ofi_z.loc[common].fillna(0), fwd.loc[common])
                        if not np.isnan(ic):
                            ic_values.append(float(ic))
                    ofi_by_ticker[ticker] = ofi_z

                if eff is not None and not eff.empty:
                    all_eff.append(eff)
                if ami is not None and not ami.empty:
                    all_amihud.append(ami)
                if kyl is not None and not kyl.empty:
                    all_kyle.append(kyl)
            except Exception as e:
                print(f"  [WARN] {ticker}: {e}")

        eff_series    = pd.concat(all_eff).sort_index()    if all_eff    else None
        amihud_series = pd.concat(all_amihud).sort_index() if all_amihud else None
        kyle_series   = pd.concat(all_kyle).sort_index()   if all_kyle   else pd.Series(dtype=float)

        p1 = plot_ofi_zscore_chart(ofi_by_ticker)
        print(f"  ✓ {p1.name}")
        p2 = plot_execution_quality(eff_series, amihud_series)
        print(f"  ✓ {p2.name}")
        if not kyle_series.empty:
            p3 = plot_kyle_lambda_trend(kyle_series)
            print(f"  ✓ {p3.name}")

        # Alpha decay chart — IC at lags 1–10
        if first_df is not None:
            try:
                ic_by_lag = compute_alpha_decay(first_df)
                p4 = plot_alpha_decay(ic_by_lag)
                print(f"  ✓ {p4.name}")
            except Exception as e:
                print(f"  [WARN] Alpha decay chart: {e}")

        # Fixed metric computation
        # ofi_ic: mean spearman IC across tickers (was wrong: self-autocorrelation)
        ofi_ic        = float(np.mean(ic_values)) if ic_values else 0.0
        # eff_spread: Corwin-Schultz is in raw ratio; ×10,000 → basis points
        eff_spread_bps = float(eff_series.mean() * 10_000) if eff_series is not None else 0.0
        # kyle_lambda: abs().mean() avoids sign cancellation giving -0.0
        kyle_abs_mean  = float(kyle_series.abs().mean()) if not kyle_series.empty else 0.0
        amihud_mean    = float(amihud_series.mean()) if amihud_series is not None else 0.0

        save_microstructure_report(
            eff_spread_mean=eff_spread_bps,
            amihud_mean=amihud_mean,
            kyle_lambda_mean=kyle_abs_mean,
            ofi_ic=ofi_ic if not np.isnan(ofi_ic) else 0.0,
        )
        print("  ✓ microstructure_report saved")
    except Exception as exc:
        print(f"  [WARN] Figures error: {exc}")
        import traceback; traceback.print_exc()


if __name__ == "__main__":
    run_langgraph_pipeline()
    run_backtest_suite()
    run_signal_card()
    run_figures()
    print("\n  Project 2 complete.\n")
