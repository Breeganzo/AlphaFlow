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
    return spread.rename("cs_spread").ewm(halflife=SPREAD_SMOOTH).mean()
