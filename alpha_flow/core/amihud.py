"""
core/amihud.py
Amihud (2002) illiquidity ratio and Kyle's Lambda proxy.
Amihud = |r_t| / Volume_t   (averaged over window)
High Amihud → illiquid → price moves more per unit of volume traded.
"""
import numpy as np
import pandas as pd
from alpha_flow.config.settings import AMIHUD_WINDOW


def amihud_ratio(df: pd.DataFrame, window: int = AMIHUD_WINDOW) -> pd.Series:
    """
    Rolling Amihud illiquidity ratio.
    df must have [close, volume] columns.
    Returns series with same index as df.
    """
    ret = df["close"].pct_change().abs()
    dv  = df["volume"] * df["close"]                # dollar volume
    illiq = (ret / dv.replace(0, np.nan)) * 1e6     # scale to readable units
    return illiq.rolling(window).mean().rename("amihud")


def kyle_lambda(df: pd.DataFrame, window: int = AMIHUD_WINDOW) -> pd.Series:
    """
    Kyle's Lambda (1985): price impact coefficient.
    λ = cov(Δprice, net_OFI) / var(net_OFI)
    where:
      Δprice  = signed daily price change (close.diff(), NOT absolute)
      net_OFI = buy_vol - sell_vol, using Lee-Ready OHLC proxy:
                buy when close >= open (uptick bar), sell otherwise.
    Higher λ → larger price impact per unit of net order flow.

    Numerical safeguard: when net order flow is degenerate within a window
    (e.g. near-constant volume/direction → var(net_OFI) ≈ 0), naively dividing
    by a fixed epsilon (the old `clip(lower=1e-12)` guard) can blow up λ to an
    arbitrarily large, meaningless value (e.g. cov=1e-3, var=1e-12 → λ≈1e9)
    rather than reflecting real price impact. Windows whose variance falls
    below a data-driven floor — 1% of the ticker's own *trailing* median
    variance (rolling, not whole-series, so this stays point-in-time and
    introduces no look-ahead) — are excluded (NaN) instead of blown up.
    Downstream consumers already `.dropna()` before averaging, so excluded
    windows are simply skipped rather than corrupting the mean.

    Reference: Kyle, A.S. (1985). Continuous auctions and insider trading.
               Econometrica, 53(6), 1315–1335.
    """
    dp = df["close"].diff()                                           # SIGNED Δprice
    is_buy = (df["close"] >= df["open"]).astype(float)               # 1=buy bar, 0=sell bar
    net_ofi = df["volume"] * (2 * is_buy - 1)                        # buy_vol - sell_vol

    # Vectorised rolling covariance — O(n) instead of the old O(n×window) loop.
    # Handles hourly intraday datasets (~3,276 hourly bars) without timeout.
    roll_cov = dp.rolling(window).cov(net_ofi)           # cov(Δprice, net_OFI)
    roll_var = net_ofi.rolling(window).var(ddof=1)        # var(net_OFI)

    # Data-driven, causal "insufficient signal" floor (see docstring above).
    # Uses a trailing lookback of 5×window so the floor reflects the ticker's
    # own typical order-flow variance rather than one arbitrary constant.
    trailing_median_var = roll_var.rolling(window * 5, min_periods=window).median()
    floor = (trailing_median_var * 0.01).clip(lower=1e-12).fillna(1e-12)
    lam = roll_cov / roll_var.where(roll_var >= floor)    # λ = cov / var, NaN if degenerate
    return lam.rename("kyle_lambda")
