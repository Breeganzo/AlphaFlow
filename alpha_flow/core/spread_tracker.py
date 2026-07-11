"""
core/spread_tracker.py
Bid-ask spread proxy from OHLCV data.
Uses Corwin-Schultz (2012) high-low spread estimator.
"""
import numpy as np
import pandas as pd
from alpha_flow.config.settings import SPREAD_SMOOTH


def corwin_schultz_spread(df: pd.DataFrame) -> pd.Series:
    """
    Corwin-Schultz (2012) bid-ask spread from daily high-low.
    β = (ln H_t/L_t)^2 + (ln H_{t+1}/L_{t+1})^2
    γ = (ln max(H_t,H_{t+1}) / min(L_t,L_{t+1}))^2
    α = (√(2β) - √β) / (3 - 2√2) - √(γ / (3 - 2√2))
    Spread = 2(e^α - 1) / (1 + e^α)

    Stability enhancement (disclosed, not part of the original 2012 estimator):
    the raw per-bar CS spread is noisy bar-to-bar because it is derived from
    only two consecutive high/low ranges. We apply an EWM smooth with
    halflife=SPREAD_SMOOTH bars before returning, which trades a small amount
    of responsiveness for materially lower estimator variance — the same
    smoothing trade-off widely used for realised-volatility estimators. This
    is intentional engineering on top of the textbook formula, not a hidden
    deviation; see RESEARCH.md and the Spread tooltip (ⓘ) in the UI.
    """
    hi = np.log(df["high"] / df["low"])
    beta = hi ** 2 + hi.shift(1) ** 2
    hi2  = np.log(df["high"].combine(df["high"].shift(1), max) /
                  df["low"].combine(df["low"].shift(1), min))
    gamma = hi2 ** 2

    k  = 3.0 - 2.0 * np.sqrt(2.0)
    alpha = (np.sqrt(2 * beta) - np.sqrt(beta)) / k - np.sqrt(gamma / k)
    alpha = alpha.clip(lower=0)
    spread = 2 * (np.exp(alpha) - 1) / (1 + np.exp(alpha))
    # EWM smoothing — see docstring above for justification.
    return spread.rename("cs_spread").ewm(halflife=SPREAD_SMOOTH).mean()
