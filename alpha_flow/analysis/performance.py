"""
analysis/performance.py
IC, AUC, Sharpe, drawdown and long-short simulation metrics
for the microstructure alpha engine.

References
----------
Grinold & Kahn (2000) Active Portfolio Management, Ch.6 — IC formula.
Sharpe (1994) The Sharpe Ratio. J. Portfolio Management, 21(1), 49–58.
"""
import numpy as np
import pandas as pd
from scipy.stats import spearmanr  # type: ignore


def information_coefficient(predictions: list, actuals: list) -> float:
    """Rank correlation between predicted scores and realised returns."""
    if len(predictions) < 2:
        return np.nan
    ic, _ = spearmanr(predictions, actuals)
    return float(ic)


def binary_auc(predictions: list, actuals: list) -> float:
    """
    AUC for binary direction prediction.
    actuals are raw returns; converted to +1/-1 internally.
    """
    try:
        from sklearn.metrics import roc_auc_score  # type: ignore
    except ImportError:
        return np.nan
    labels = [1 if r > 0 else 0 for r in actuals]
    if len(set(labels)) < 2:
        return np.nan
    return float(roc_auc_score(labels, predictions))


def annualised_sharpe(returns: list | np.ndarray, freq: str = "daily") -> float:
    """
    Annualised Sharpe ratio (excess return over cash = 0 assumed).

    Parameters
    ----------
    returns : sequence of period returns (e.g. daily P&L fractions)
    freq    : 'daily' (252 trading days), 'weekly' (52), 'monthly' (12)

    Reference: Sharpe (1994) The Sharpe Ratio. J. Portfolio Management, 21(1), 49–58.
    """
    scale = {"daily": 252, "weekly": 52, "monthly": 12}.get(freq, 252)
    r = np.asarray(returns, dtype=float)
    r = r[~np.isnan(r)]
    if len(r) < 2 or r.std() == 0:
        return np.nan
    return float((r.mean() / r.std()) * np.sqrt(scale))


def max_drawdown(equity_curve: list | np.ndarray) -> float:
    """
    Maximum peak-to-trough drawdown (expressed as a negative fraction, e.g. -0.12 = -12%).

    Parameters
    ----------
    equity_curve : cumulative portfolio value series (e.g. [1.0, 1.02, 0.98, ...])
    """
    eq = np.asarray(equity_curve, dtype=float)
    if len(eq) < 2:
        return 0.0
    peak = np.maximum.accumulate(eq)
    drawdown = (eq - peak) / np.where(peak == 0, 1e-12, peak)
    return float(drawdown.min())


def simulate_longshort_portfolio(
    snapshots_series: list[dict],      # list of {ticker: ofi_zscore} dicts, one per period
    returns_by_ticker: dict[str, list[float]],  # forward returns per ticker per period
    n_long: int = 2,
    n_short: int = 2,
) -> dict:
    """
    Simulate a long-short equity portfolio based on cross-sectional OFI Z-score ranking.

    Strategy:
      - Each period: rank all tickers by OFI Z-score
      - Go LONG top-n_long, SHORT bottom-n_short (equal weight in each leg)
      - Portfolio return = mean(long returns) - mean(short returns)
      - Compute Sharpe, max drawdown, equity curve

    This mirrors the cross-sectional long-short strategy used in academic microstructure
    research (see Cont et al. 2023; Grinold & Kahn 2000).

    Returns
    -------
    dict with keys: sharpe, max_drawdown, equity_curve, period_returns, n_periods
    """
    period_returns: list[float] = []
    equity = [1.0]

    min_periods = min(len(v) for v in returns_by_ticker.values()) if returns_by_ticker else 0
    n_periods = min(len(snapshots_series), min_periods)

    for i in range(n_periods):
        snap = snapshots_series[i]
        if not snap:
            period_returns.append(0.0)
            equity.append(equity[-1])
            continue

        ranked = sorted(snap.keys(),
                        key=lambda t: snap[t].get("ofi_zscore", 0.0),
                        reverse=True)
        long_tickers  = ranked[:n_long]
        short_tickers = ranked[-n_short:] if n_short else []

        long_ret  = float(np.mean([returns_by_ticker[t][i] for t in long_tickers  if t in returns_by_ticker]))
        short_ret = float(np.mean([returns_by_ticker[t][i] for t in short_tickers if t in returns_by_ticker]))
        pnl = long_ret - short_ret
        period_returns.append(pnl)
        equity.append(equity[-1] * (1 + pnl))

    sharpe = annualised_sharpe(period_returns) if period_returns else np.nan
    mdd    = max_drawdown(equity)
    sortino_val = sortino_ratio(period_returns) if period_returns else np.nan

    return {
        "sharpe":         round(float(sharpe) if not np.isnan(sharpe) else 0.0, 4),
        "sortino":        round(float(sortino_val) if not np.isnan(sortino_val) and not np.isinf(sortino_val) else 0.0, 4),
        "max_drawdown":   round(mdd, 4),
        "equity_curve":   equity,
        "period_returns": period_returns,
        "n_periods":      n_periods,
    }


def sortino_ratio(returns: list | np.ndarray, freq: str = "daily") -> float:
    """
    Sortino ratio — penalises only downside (negative) volatility.
    Sortino = √scale × mean(r) / downside_std
    where downside_std uses only returns below zero.

    Reference: Sortino & van der Meer (1991) Journal of Portfolio Management.
    """
    scale = {"daily": 252, "weekly": 52, "monthly": 12}.get(freq, 252)
    r = np.asarray(returns, dtype=float)
    r = r[~np.isnan(r)]
    if len(r) < 2:
        return np.nan
    downside = r[r < 0]
    if len(downside) < 2:
        return np.inf if r.mean() > 0 else np.nan
    dstd = downside.std(ddof=1)
    if dstd == 0:
        return np.nan
    return float((r.mean() / dstd) * np.sqrt(scale))


def summary_stats(predictions: list, actuals: list) -> dict:
    return {
        "IC":            f"{information_coefficient(predictions, actuals):.4f}",
        "AUC":           f"{binary_auc(predictions, actuals):.4f}",
        "N predictions": len(predictions),
    }
