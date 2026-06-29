"""
core/volume_clock.py
Phase 2: Volume clock / dollar bars and signed volume imbalance.

Why time bars are flawed:
  Standard time bars (1 bar per hour) have UNEQUAL information content.
  9:30-10:30 AM (market open) → massive volume, many price moves per bar
  12:00-1:00 PM (lunch hour) → low volume, boring consolidation
  These two bars look identical to a model but contain very different information.

Volume bars fix this:
  One bar is emitted every time $N of value has been traded.
  High-activity periods produce more bars → more signal resolution.
  Low-activity periods produce fewer bars → no wasted bars.

This leads to better-conditioned ML training data:
  - More uniform variance per bar
  - Better IC at the same lookback count
  - Used by Marcos López de Prado (2018), Ch. 3

Additionally, signed volume imbalance tells us:
  Are buyers or sellers more aggressive in the current period?
  buy_volume  = volume when close ≥ open (uptick bar)
  sell_volume = volume when close < open (downtick bar)
  imbalance   = (buy_vol - sell_vol) / total_vol  ∈ [-1, +1]

Reference:
  López de Prado, M. (2018). Advances in Financial Machine Learning.
  Wiley. Chapter 3: Bars.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from alpha_flow.config.settings import VOLUME_CLOCK_N


def dollar_bars(df: pd.DataFrame, threshold: float = VOLUME_CLOCK_N) -> pd.DataFrame:
    """
    Aggregate OHLCV time bars into dollar bars.

    A new bar is emitted every time cumulative dollar value (close × volume)
    reaches `threshold` dollars. The resulting bars have uniform information
    content — each one represents the same amount of economic activity.

    Args:
        df:        DataFrame with DatetimeIndex and [open, high, low, close, volume]
        threshold: Dollar value threshold per bar (default: $1,000,000)

    Returns:
        DataFrame with dollar bar OHLCV — typically fewer rows than input.
        Has a 'bar_count' column showing how many time bars were aggregated.

    What you learn:
        This is the simplest version of alternative bar sampling. In practice,
        quant funds use volume bars, tick bars, and dollar imbalance bars.
        The key insight is that bars should sample by INFORMATION, not by TIME.
    """
    if df.empty:
        return df.copy()

    dv      = (df["close"] * df["volume"]).values
    opens   = df["open"].values
    highs   = df["high"].values
    lows    = df["low"].values
    closes  = df["close"].values
    volumes = df["volume"].values
    index   = df.index

    bars = []
    cum_dv = 0.0
    bar_open  = opens[0]
    bar_high  = highs[0]
    bar_low   = lows[0]
    bar_vol   = 0.0
    bar_start = index[0]
    bar_count = 0

    for i in range(len(df)):
        cum_dv   += dv[i]
        bar_high  = max(bar_high, highs[i])
        bar_low   = min(bar_low,  lows[i])
        bar_vol  += volumes[i]
        bar_count += 1

        if cum_dv >= threshold:
            bars.append({
                "ts":        bar_start,
                "open":      bar_open,
                "high":      bar_high,
                "low":       bar_low,
                "close":     closes[i],
                "volume":    bar_vol,
                "bar_count": bar_count,
            })
            # Reset for next bar
            if i + 1 < len(df):
                bar_open  = opens[i + 1]
                bar_high  = highs[i + 1]
                bar_low   = lows[i + 1]
                bar_start = index[i + 1]
            cum_dv    = 0.0
            bar_vol   = 0.0
            bar_count = 0

    if not bars:
        return df.copy()   # threshold too large — return original

    result = pd.DataFrame(bars).set_index("ts")
    result.index = pd.DatetimeIndex(result.index)
    return result


def volume_imbalance(df: pd.DataFrame, window: int = 20) -> pd.Series:
    """
    Rolling signed volume imbalance.

    Measures whether buyers or sellers are more aggressive over the last
    `window` bars:
        imbalance = (buy_volume - sell_volume) / total_volume

    buy_volume  = sum of volume on uptick bars (close ≥ open)
    sell_volume = sum of volume on downtick bars (close < open)

    Value range: [-1, +1]
      +1 = all buying (strong upward pressure)
      -1 = all selling (strong downward pressure)
       0 = balanced

    Args:
        df:     DataFrame with [open, close, volume]
        window: Rolling window for aggregation (default: 20 bars)

    Returns:
        pd.Series named 'volume_imbalance' with values in [-1, +1]
    """
    is_buy   = (df["close"] >= df["open"]).astype(float)
    buy_vol  = df["volume"] * is_buy
    sell_vol = df["volume"] * (1 - is_buy)

    roll_buy  = buy_vol.rolling(window, min_periods=5).sum()
    roll_sell = sell_vol.rolling(window, min_periods=5).sum()
    total     = (roll_buy + roll_sell).replace(0, np.nan)

    imbalance = (roll_buy - roll_sell) / total
    return imbalance.fillna(0.0).rename("volume_imbalance")


def volume_clock_zscore(df: pd.DataFrame, window: int = 20) -> pd.Series:
    """
    Z-score of rolling volume imbalance for use in the feature matrix.

    Normalises the imbalance signal so it has zero mean and unit variance
    over the rolling window. Makes the signal comparable across tickers.

    Returns:
        pd.Series named 'volume_zscore'
    """
    imbalance = volume_imbalance(df, window=window)
    roll_mean = imbalance.rolling(window, min_periods=5).mean()
    roll_std  = imbalance.rolling(window, min_periods=5).std()
    z = (imbalance - roll_mean) / roll_std.replace(0, np.nan)
    return z.fillna(0.0).rename("volume_zscore")
