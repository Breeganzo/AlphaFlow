"""
core/lee_ready.py
Lee-Ready (1991) trade-direction classifier.
Using OHLCV proxy: tick test applied to close prices.
  +1 → buyer-initiated (uptick or zero-uptick)
  -1 → seller-initiated (downtick or zero-downtick)
"""
import numpy as np
import pandas as pd


def tick_sign(close: pd.Series) -> pd.Series:
    """
    Simplified tick test.
    Returns +1 (buy) or -1 (sell) for each bar.
    """
    diff = close.diff()
    sign = np.sign(diff)
    # Carry forward last non-zero sign for zero-ticks
    sign = sign.replace(0, np.nan).ffill().fillna(1)
    return sign.astype(int).rename("tick_sign")


def signed_volume(df: pd.DataFrame) -> pd.Series:
    """Signed volume = tick_sign × volume."""
    signs = tick_sign(df["close"])
    return (signs * df["volume"]).rename("signed_volume")
