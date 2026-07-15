"""
core/ofi_calculator.py
Order Flow Imbalance (OFI) — bar-level proxy (Chordia et al. 2002).

IMPORTANT: this is a BAR-LEVEL PROXY, not real OFI.
Real OFI classifies each individual trade as buyer/seller-initiated using
Lee-Ready tick rules on trade-by-trade data (TAQ / Polygon / Databento).
This proxy classifies the ENTIRE bar's volume based on close vs open:
  buy_vol  = volume when close >= open
  sell_vol = volume when close <  open
This loses within-bar directional information and caps IC at ~1-3%.
See docs/ROADMAP.md Phase 5 for the tick-data upgrade path.
"""
import numpy as np
import pandas as pd
from alpha_flow.config.settings import OFI_WINDOW


def compute_ofi(df: pd.DataFrame) -> pd.Series:
    """
    OFI proxy using OHLCV bars.
    Buyer-initiated volume  ≈ volume when close ≥ open
    Seller-initiated volume ≈ volume when close <  open

    Args:
        df: DataFrame with columns [open, high, low, close, volume]
    Returns:
        OFI series (positive = net buying pressure)
    """
    buy_vol  = df["volume"].where(df["close"] >= df["open"], 0.0)
    sell_vol = df["volume"].where(df["close"] <  df["open"], 0.0)
    raw_ofi  = buy_vol - sell_vol
    # Normalise by total volume to get [-1, +1] fraction
    ofi = raw_ofi / df["volume"].replace(0, np.nan)
    return ofi.fillna(0.0).rename("ofi")


def rolling_ofi_zscore(df: pd.DataFrame, window: int = OFI_WINDOW) -> pd.Series:
    """Rolling Z-score of OFI over `window` bars. Returns 0.0 when std is zero."""
    ofi = compute_ofi(df)
    mu  = ofi.rolling(window).mean()
    sd  = ofi.rolling(window).std(ddof=1)
    # Guard: avoid NaN when std==0 (constant OFI in window)
    z   = (ofi - mu) / sd.replace(0.0, np.nan)
    return z.fillna(0.0).rename("ofi_zscore")
