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

    Reference: Kyle, A.S. (1985). Continuous auctions and insider trading.
               Econometrica, 53(6), 1315–1335.
    """
    dp = df["close"].diff()                                           # SIGNED Δprice
    is_buy = (df["close"] >= df["open"]).astype(float)               # 1=buy bar, 0=sell bar
    net_ofi = df["volume"] * (2 * is_buy - 1)                        # buy_vol - sell_vol

    # Vectorised rolling covariance — O(n) instead of the old O(n×window) loop.
    # Handles Phase 2 intraday datasets (~3,276 hourly bars) without timeout.
    roll_cov = dp.rolling(window).cov(net_ofi)           # cov(Δprice, net_OFI)
    roll_var = net_ofi.rolling(window).var(ddof=1)        # var(net_OFI)
    lam      = roll_cov / roll_var.clip(lower=1e-12)      # λ = cov / var
    return lam.rename("kyle_lambda")
