"""
alpha_flow/core/vpin.py — VPIN: Volume-Synchronized Probability of Informed Trading
=====================================================================================
Approximates the probability of informed trading using Bulk Volume Classification
(BVC) on OHLCV bars.  Unlike OFI (which time-synchronizes each tick via Lee-Ready),
VPIN volume-synchronizes by measuring the bar's close position within [low, high]
to infer aggregate buy vs. sell pressure.

Theory
------
For each OHLCV bar:
  buy_frac  = (close − low) / (high − low)   ∈ [0, 1]
  buy_vol   = volume × buy_frac
  sell_vol  = volume × (1 − buy_frac)
  bar_vpin  = |buy_vol − sell_vol| / volume

Rolling VPIN = mean(bar_vpin over last window bars).
High VPIN → order flow is imbalanced → elevated probability of informed trading
→ predicts short-term price impact.

Complementary to OFI:
  - OFI uses Lee-Ready tick-sign (binary: buy or sell bar)
  - VPIN uses BVC (continuous: fraction of volume that was buying)
  - Together they capture different facets of order flow toxicity

References
----------
Easley, D., López de Prado, M. M., & O'Hara, M. (2012).
  Flow Toxicity and Liquidity in a High-Frequency World.
  Review of Financial Studies, 25(5), 1457–1493.
  https://doi.org/10.1093/rfs/hhs053

Easley, D., López de Prado, M. M., & O'Hara, M. (2011).
  The Microstructure of the "Flash Crash".
  Journal of Portfolio Management, 37(2), 118–128.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def vpin(df: pd.DataFrame, window: int = 20) -> pd.Series:
    """
    Compute rolling VPIN ∈ [0, 1] using Bulk Volume Classification.

    Parameters
    ----------
    df     : OHLCV DataFrame with columns high, low, close, volume
    window : rolling window for VPIN smoothing (default: 20 bars)

    Returns
    -------
    pd.Series of VPIN values indexed like df, range [0, 1].
    """
    rng       = (df["high"] - df["low"]).replace(0, np.nan)
    buy_frac  = ((df["close"] - df["low"]) / rng).fillna(0.5).clip(0.0, 1.0)
    buy_vol   = df["volume"] * buy_frac
    sell_vol  = df["volume"] - buy_vol
    imbalance = (buy_vol - sell_vol).abs()
    total_vol = df["volume"].replace(0, np.nan)
    bar_vpin  = (imbalance / total_vol).fillna(0.0)
    return bar_vpin.rolling(window, min_periods=max(3, window // 4)).mean()


def vpin_zscore(df: pd.DataFrame, window: int = 20, norm_window: int = 60) -> pd.Series:
    """
    Z-score normalised VPIN for cross-sectional comparison.

    VPIN_z = (VPIN_rolling − μ_long) / σ_long

    A high positive z-score signals order flow more toxic than usual, predicting
    elevated short-term price impact (adverse selection for liquidity providers).
    A large negative z-score signals unusually calm, symmetric order flow.

    Parameters
    ----------
    df          : OHLCV DataFrame
    window      : inner rolling window for VPIN smoothing (default: 20 bars)
    norm_window : outer window for z-score normalisation (default: 60 bars)

    Returns
    -------
    pd.Series of z-scored VPIN, indexed like df.
    """
    vpin_raw = vpin(df, window=window)
    mu   = vpin_raw.rolling(norm_window, min_periods=window).mean()
    sig  = vpin_raw.rolling(norm_window, min_periods=window).std(ddof=1)
    z    = (vpin_raw - mu) / sig.replace(0, np.nan)
    return z.fillna(0.0)
