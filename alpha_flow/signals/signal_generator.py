# COMPONENT TYPE: HYBRID
# Deterministic parts: feature computation (OFI, Amihud, Kyle, spread, tick sign),
#   IC/AUC calculation, signal threshold logic.
# AI-based part: LightGBM model prediction (learned patterns from walk-forward training),
#   Groq LLM narrative interpretation (stochastic text generation).
# The final BUY/SELL/HOLD label comes from a deterministic threshold on the model score.
"""
signals/signal_generator.py
Produces a structured signal card for the Market Microstructure Engine.

The signal card reports, per ticker:
  - OFI Z-score (order flow pressure)
  - Amihud illiquidity ratio
  - Kyle's lambda (price impact sensitivity)
  - Corwin-Schultz bid-ask spread estimate
  - LightGBM model score (direction prediction probability)
  - Final signal: BUY / SELL / HOLD (model score + threshold)

Industry context: This is the type of signal report used by:
  - Market-making desks (Virtu, Citadel Securities) for inventory management
  - Statistical arbitrage desks for pre-trade signal validation
  - Systematic equity funds for order timing decisions
"""
import numpy as np
import pandas as pd

from alpha_flow.config.settings import TICKERS, SIGNAL_THRESHOLD
from alpha_flow.data.data_feed import get_daily_bars
from alpha_flow.core.ofi_calculator import rolling_ofi_zscore
from alpha_flow.core.amihud import amihud_ratio, kyle_lambda
from alpha_flow.core.spread_tracker import corwin_schultz_spread
from alpha_flow.core.lee_ready import tick_sign


def _latest_signal(df: pd.DataFrame, model_score: float) -> str:
    """Convert model score to BUY/SELL/HOLD label."""
    if model_score > 0.10:     # positive score → long bias
        return "BUY"
    if model_score < -0.10:    # negative score → short bias
        return "SELL"
    return "HOLD"


def generate_signal_card(tickers: list[str] | None = None,
                         verbose: bool = True) -> dict:
    """
    Generate microstructure signal card for all tickers.

    For each ticker:
      1. Download/simulate OHLCV data
      2. Compute all 5 microstructure features (latest bar)
      3. Run LightGBM model to get probability score
      4. Produce BUY/SELL/HOLD signal

    Returns: dict with ticker → {features, model_score, signal}
    """
    from alpha_flow.analysis.lightgbm_trainer import (
        walk_forward_train, build_features,
    )

    tickers = tickers or TICKERS
    card: dict[str, dict] = {}

    for ticker in tickers:
        try:
            df = get_simulated_l1(ticker)
            feats_df = build_features(df).dropna()

            if feats_df.empty:
                card[ticker] = {"signal": "HOLD", "error": "empty feature df"}
                continue

            # Latest bar microstructure snapshot
            latest = feats_df.iloc[-1]
            ofi_z  = float(latest.get("ofi_zscore", 0.0))
            amihud = float(latest.get("amihud", 0.0))
            kyle   = float(latest.get("kyle_lambda", 0.0))
            spread = float(latest.get("cs_spread", 0.0))
            tick   = float(latest.get("tick_sign", 0.0))

            # Walk-forward model score (latest fold prediction)
            wf_result   = walk_forward_train(df)
            preds        = wf_result.get("predictions", [])
            model_score  = float(preds[-1]) if preds else 0.0
            signal = _latest_signal(df, model_score)

            card[ticker] = {
                "ofi_zscore":   round(ofi_z, 4),
                "amihud":       round(amihud, 6),
                "kyle_lambda":  round(kyle, 6),
                "cs_spread":    round(spread, 6),
                "tick_sign":    round(tick, 4),
                "model_score":  round(float(model_score), 4),
                "signal":       signal,
                "mean_ic":      round(wf_result["mean_ic"], 4),
            }
        except Exception as exc:  # noqa: BLE001
            card[ticker] = {"signal": "HOLD", "error": str(exc)}

    return card


def print_signal_card(card: dict) -> None:
    """Pretty-print the microstructure signal card."""
    print("\n" + "=" * 70)
    print("  MARKET MICROSTRUCTURE ENGINE — SIGNAL CARD")
    print("=" * 70)
    print(f"  {'Ticker':<8} {'Signal':<6} {'OFI-Z':>7} {'Amihud':>10} "
          f"{'Kyle λ':>10} {'Spread':>8} {'IC':>7}")
    print("-" * 70)
    for ticker, data in card.items():
        if "error" in data:
            print(f"  {ticker:<8} {'ERROR':<6}  — {data['error'][:40]}")
            continue
        sig_fmt = ("▲ BUY " if data["signal"] == "BUY"
                   else "▼ SELL" if data["signal"] == "SELL" else "  HOLD")
        print(f"  {ticker:<8} {sig_fmt:<6} "
              f"{data['ofi_zscore']:>7.3f} {data['amihud']:>10.6f} "
              f"{data['kyle_lambda']:>10.6f} {data['cs_spread']:>8.6f} "
              f"{data['mean_ic']:>7.4f}")
    print("=" * 70)
