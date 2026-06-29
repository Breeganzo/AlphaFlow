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

    lambdas = []
    for i in range(len(df)):
        if i < window:
            lambdas.append(np.nan)
            continue
        dp_win  = dp.iloc[i - window:i].values
        ofi_win = net_ofi.iloc[i - window:i].values
        # Drop any NaN rows within the window
        mask    = ~(np.isnan(dp_win) | np.isnan(ofi_win))
        dp_w    = dp_win[mask]
        ofi_w   = ofi_win[mask]
        if len(dp_w) < 5:
            lambdas.append(np.nan)
            continue
        cov = np.cov(dp_w, ofi_w, ddof=1)
        lam = cov[0, 1] / max(cov[1, 1], 1e-12)
        lambdas.append(lam)

    return pd.Series(lambdas, index=df.index).rename("kyle_lambda")
