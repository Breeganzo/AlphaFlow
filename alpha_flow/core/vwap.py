"""
core/vwap.py
Phase 2: VWAP (Volume Weighted Average Price) reversion signal.

VWAP is the fair price of the trading day, weighted by how much was traded at
each price level:
    VWAP = Σ(Price × Volume) / Σ(Volume)

Why it matters for AlphaFlow:
  - Institutional traders (pension funds, ETFs, index trackers) benchmark
    execution against VWAP. When price deviates significantly from VWAP,
    institutional flow tends to push it back.
  - ~60% of intraday price moves revert toward VWAP (Almgren & Chriss, 2001).
  - This is one of the most widely used intraday signals in algorithmic trading.

Signal construction:
  - Price far BELOW VWAP (z < -1.5σ) → institutional buyers likely → BUY +1
  - Price far ABOVE VWAP (z > +1.5σ) → institutional sellers likely → SELL -1
  - Near VWAP → no edge → HOLD 0

Reference:
  Almgren, R. & Chriss, N. (2001). Optimal execution of portfolio transactions.
  Journal of Risk, 3(2), 5–39.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from alpha_flow.config.settings import VWAP_WINDOW


def compute_session_vwap(df: pd.DataFrame) -> pd.Series:
    """
    Compute intraday cumulative VWAP, resetting at the start of each trading day.

    For each bar: VWAP = cumsum(typical_price × volume) / cumsum(volume)
    where typical_price = (high + low + close) / 3

    The VWAP resets every day at the first bar of each session (9:30 AM ET).
    This matches how traders actually use VWAP — it's a daily anchor.

    Args:
        df: DataFrame with DatetimeIndex and columns [high, low, close, volume]

    Returns:
        pd.Series named 'vwap' with same index as df
    """
    typical = (df["high"] + df["low"] + df["close"]) / 3
    tpv     = typical * df["volume"]           # typical price × volume

    # Group by date to reset VWAP each day
    idx     = df.index
    dates   = idx.normalize() if hasattr(idx, "normalize") else pd.to_datetime(idx.date)
    vwap    = pd.Series(np.nan, index=idx, name="vwap")

    for day, grp_idx in df.groupby(dates).groups.items():
        grp_tpv = tpv.loc[grp_idx]
        grp_vol = df["volume"].loc[grp_idx]
        cum_vol = grp_vol.cumsum()
        # Guard against zero volume (pre-market stubs)
        safe_vol = cum_vol.replace(0, np.nan)
        vwap.loc[grp_idx] = grp_tpv.cumsum() / safe_vol

    return vwap


def vwap_deviation_zscore(df: pd.DataFrame, window: int = VWAP_WINDOW) -> pd.Series:
    """
    Compute z-score of price deviation from intraday VWAP.

    Formula:
        deviation = close - vwap
        z = (deviation - rolling_mean(deviation, window)) / rolling_std(deviation, window)

    A z-score of ±1.5 means price is 1.5 standard deviations from its typical
    VWAP deviation level — this is the entry threshold for the signal.

    Args:
        df:     DataFrame with [high, low, close, volume]
        window: Rolling window for z-score normalisation (default: 20 bars)

    Returns:
        pd.Series named 'vwap_zscore'
    """
    vwap      = compute_session_vwap(df)
    deviation = df["close"] - vwap
    roll_mean = deviation.rolling(window, min_periods=5).mean()
    roll_std  = deviation.rolling(window, min_periods=5).std()
    z         = (deviation - roll_mean) / roll_std.replace(0, np.nan)
    return z.fillna(0.0).rename("vwap_zscore")


def vwap_reversion_signal(df: pd.DataFrame, threshold: float = 1.5) -> pd.Series:
    """
    Discrete BUY / SELL / HOLD signal from VWAP deviation z-score.

    +1 (BUY)  when z < -threshold: price is significantly below VWAP
              → mean-reversion expects upward move back to VWAP
    -1 (SELL) when z > +threshold: price is significantly above VWAP
              → mean-reversion expects downward move back to VWAP
     0 (HOLD) otherwise

    This is used as a feature in the LightGBM model, not a direct trading signal.
    Combined with OFI and Hawkes, it helps the model distinguish genuine
    momentum from temporary VWAP deviation.

    Args:
        df:        DataFrame with [high, low, close, volume]
        threshold: Z-score magnitude to trigger a signal (default: 1.5σ)

    Returns:
        pd.Series named 'vwap_signal' with values in {-1, 0, +1}
    """
    z      = vwap_deviation_zscore(df)
    signal = pd.Series(0, index=df.index, dtype=int, name="vwap_signal")
    signal[z < -threshold] = 1    # Below VWAP → buy (reversion up)
    signal[z >  threshold] = -1   # Above VWAP → sell (reversion down)
    return signal
