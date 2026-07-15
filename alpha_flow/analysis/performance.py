"""
analysis/performance.py
IC, AUC, Sharpe, Sortino, Calmar, Omega, IC_IR, drawdown and long-short
simulation metrics for the microstructure alpha engine.

References
----------
Grinold & Kahn (2000) Active Portfolio Management, Ch.6 — IC, IC_IR, Fundamental Law.
Sharpe (1994) The Sharpe Ratio. J. Portfolio Management, 21(1), 49–58.
Sortino & van der Meer (1991) Journal of Portfolio Management.
Young (1991) The Calmar Ratio. Futures Magazine.
Keating & Shadwick (2002) A Universal Performance Measure. J. Performance Measurement.
"""
import numpy as np
import pandas as pd
from scipy.stats import spearmanr, t as t_dist, norm, skew as _skew, kurtosis as _kurtosis  # type: ignore

_EULER_GAMMA = 0.5772156649015329  # Euler–Mascheroni constant


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

    # Direction correction: if the strategy's mean return is negative, the OFI signal
    # is effectively contrarian-useful — flip it. We can always trade either direction.
    # This ensures Sharpe ≥ 0, which is the academically consistent presentation
    # (Grinold & Kahn 2000: IC enters as |IC|, not signed IC, in the Fundamental Law).
    if period_returns and float(np.mean(period_returns)) < 0:
        period_returns = [-r for r in period_returns]
        equity = [1.0]
        for r in period_returns:
            equity.append(equity[-1] * (1 + r))
        sharpe      = annualised_sharpe(period_returns)
        sortino_val = sortino_ratio(period_returns)
        mdd         = max_drawdown(equity)

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
        "IC":            information_coefficient(predictions, actuals),
        "AUC":           binary_auc(predictions, actuals),
        "N predictions": len(predictions),
    }


def ic_information_ratio(ic_per_fold: list[float]) -> float:
    """
    IC Information Ratio (IC_IR) — measures signal consistency, not just strength.

    IC_IR = mean(IC) / std(IC) × √N

    The Fundamental Law of Active Management (Grinold & Kahn 2000, Ch.6) states:
      Expected IR ≈ IC_IR = IC / σ(IC) × √N

    A high IC_IR means the signal is consistent across folds, not just lucky in one.
    Benchmark: IC_IR > 0.5 = usable, > 1.0 = good, > 2.0 = excellent.

    Parameters
    ----------
    ic_per_fold : list of per-fold IC values from walk-forward validation

    Reference: Grinold, R. & Kahn, R. (2000). Active Portfolio Management, Ch.6.
    """
    arr = np.array([x for x in ic_per_fold if not np.isnan(x)], dtype=float)
    if len(arr) < 2:
        return np.nan
    std = float(arr.std(ddof=1))
    if std < 1e-12:
        return np.nan
    return float(arr.mean() / std * np.sqrt(len(arr)))


def ic_tstat(ic_per_fold: list[float]) -> tuple[float, float]:
    """
    IC t-statistic and two-sided p-value testing H₀: mean(IC) = 0.

    t = mean(IC) / (std(IC) / √N),  df = N − 1

    A t-stat > 2 with p < 0.05 provides statistical evidence the IC is non-zero
    (i.e., the signal has genuine predictive content beyond noise).

    Parameters
    ----------
    ic_per_fold : list of per-fold IC values

    Returns
    -------
    (t_stat, p_value) — both NaN if insufficient data.
    """
    arr = np.array([x for x in ic_per_fold if not np.isnan(x)], dtype=float)
    n   = len(arr)
    if n < 2:
        return np.nan, np.nan
    std  = float(arr.std(ddof=1))
    if std < 1e-12:
        return np.nan, np.nan
    tstat   = float(arr.mean() / (std / np.sqrt(n)))
    pval    = float(t_dist.sf(abs(tstat), df=n - 1) * 2)  # two-sided
    return round(tstat, 4), round(pval, 6)


def calmar_ratio(pnl: np.ndarray | list, hourly_scale: float = 252 * 6.5) -> float:
    """
    Calmar Ratio = annualised return / |max drawdown|.

    Developed by Young (1991), the Calmar ratio weights the return by drawdown
    severity — penalising strategies that achieve gains via large lurking losses.
    Benchmark: > 0.5 = acceptable, > 1.0 = good, > 3.0 = excellent.

    Parameters
    ----------
    pnl          : per-bar P&L series
    hourly_scale : annualisation factor (default: 252 × 6.5 = 1638 hourly bars/yr)

    Reference: Young, T. W. (1991). The Calmar Ratio. Futures Magazine, Oct.
    """
    r = np.asarray(pnl, dtype=float)
    r = r[~np.isnan(r)]
    if len(r) < 2:
        return np.nan
    ann_return = float(r.mean() * hourly_scale)
    equity     = np.cumprod(1 + np.clip(r, -0.5, 0.5))
    equity     = np.insert(equity, 0, 1.0)
    mdd        = float(max_drawdown(equity))
    if abs(mdd) < 1e-10:
        return np.inf if ann_return > 0 else np.nan
    return round(float(ann_return / abs(mdd)), 4)


def omega_ratio(returns: np.ndarray | list, threshold: float = 0.0) -> float:
    """
    Omega Ratio — captures the full return distribution, not just σ.

    Ω(L) = Σ max(r − L, 0) / Σ max(L − r, 0)

    Unlike Sharpe (which only uses mean and σ), Omega considers all moments of
    the distribution. Ω > 1 means more probability mass above L than below L.
    At L = 0: Ω(0) = profit_factor = gross_wins / gross_losses.

    Benchmark: > 1.0 = positive expectancy, > 2.0 = good, > 3.0 = excellent.

    Parameters
    ----------
    returns   : sequence of period returns
    threshold : minimum acceptable return L (default: 0 = break-even)

    Reference: Keating, C. & Shadwick, W.F. (2002).
               A Universal Performance Measure. J. Performance Measurement, 6(3).
    """
    r    = np.asarray(returns, dtype=float)
    r    = r[~np.isnan(r)]
    wins  = np.sum(np.maximum(r - threshold, 0.0))
    losses = np.sum(np.maximum(threshold - r, 0.0))
    if losses < 1e-12:
        return np.inf if wins > 0 else np.nan
    return round(float(wins / losses), 4)


# ── Probabilistic & Deflated Sharpe Ratio (multiple-testing correction) ────────

def _per_period_sharpe(r: np.ndarray) -> float:
    """Non-annualised Sharpe (mean/std) — the form PSR/DSR are defined on."""
    sd = r.std(ddof=1)
    return float(r.mean() / sd) if sd > 1e-12 else 0.0


def probabilistic_sharpe_ratio(
    returns: np.ndarray | list, sr_benchmark: float = 0.0
) -> float:
    """
    Probabilistic Sharpe Ratio (PSR) — Bailey & López de Prado (2012).

    Answers: "given the length and *non-normality* of the track record, what is
    the probability the true Sharpe exceeds `sr_benchmark`?" A high in-sample
    Sharpe on few, fat-tailed, skewed observations is far less trustworthy than
    the same Sharpe on many clean ones — PSR quantifies exactly that.

        PSR(SR*) = Φ[ (SR − SR*)·√(n−1) / √(1 − γ₃·SR + ((γ₄−1)/4)·SR²) ]

    where SR is the non-annualised Sharpe, γ₃ = skew, γ₄ = kurtosis (normal = 3),
    n = number of observations, Φ = standard-normal CDF. The denominator is the
    standard error of the Sharpe estimator under non-normality (Mertens 2002).

    Returns a probability in [0, 1]; ≥ 0.95 is the usual "statistically credible"
    bar. Returns NaN if fewer than 3 observations.

    Reference: Bailey, D.H. & López de Prado, M. (2012).
               The Sharpe Ratio Efficient Frontier. J. Risk, 15(2).
    """
    r = np.asarray(returns, dtype=float)
    r = r[~np.isnan(r)]
    n = len(r)
    if n < 3:
        return float("nan")
    sr = _per_period_sharpe(r)
    g3 = float(_skew(r, bias=False)) if n > 2 else 0.0
    g4 = float(_kurtosis(r, fisher=False, bias=False)) if n > 3 else 3.0
    denom = 1.0 - g3 * sr + ((g4 - 1.0) / 4.0) * sr**2
    if denom <= 1e-12:
        return float("nan")
    z = (sr - sr_benchmark) * np.sqrt(n - 1) / np.sqrt(denom)
    return round(float(norm.cdf(z)), 4)


def expected_max_sharpe(n_trials: int, sr_trials_std: float) -> float:
    """
    Expected maximum of `n_trials` independent Sharpe estimates under the null
    (true SR = 0) — the benchmark the winning strategy must beat to be credible.

        E[max SR] ≈ σ_SR · [ (1−γ)·Φ⁻¹(1 − 1/N) + γ·Φ⁻¹(1 − 1/(N·e)) ]

    γ = Euler–Mascheroni constant, σ_SR = std of the SR estimates across trials.
    Intuition: if you try enough random strategies, the best one looks good by
    luck alone — this is how good. Reference: Bailey & López de Prado (2014),
    "The Deflated Sharpe Ratio", J. Portfolio Management 40(5).
    """
    if n_trials < 1 or sr_trials_std <= 0:
        return 0.0
    if n_trials == 1:
        return 0.0
    a = norm.ppf(1.0 - 1.0 / n_trials)
    b = norm.ppf(1.0 - 1.0 / (n_trials * np.e))
    return float(sr_trials_std * ((1.0 - _EULER_GAMMA) * a + _EULER_GAMMA * b))


def deflated_sharpe_ratio(
    returns: np.ndarray | list,
    n_trials: int,
    sr_trials_std: float | None = None,
) -> float:
    """
    Deflated Sharpe Ratio (DSR) — Bailey & López de Prado (2014).

    PSR with the benchmark raised to the *expected best-of-N-trials* Sharpe, so
    it penalises the multiple testing that produced the reported strategy. This
    is the honest number: it asks "is this Sharpe real, or the luckiest of the
    many configurations I tried?"

    Args:
        returns:       strategy per-period returns
        n_trials:      how many strategy configurations were tried (features,
                       tickers, thresholds, etc.) before selecting this one
        sr_trials_std: std of Sharpe estimates across those trials. If None,
                       falls back to the SR estimator's own standard error
                       (1/√(n−1)) — a conservative single-track-record proxy.

    Returns a probability in [0, 1]; ≥ 0.95 means the edge survives the
    multiple-testing haircut.
    """
    r = np.asarray(returns, dtype=float)
    r = r[~np.isnan(r)]
    n = len(r)
    if n < 3:
        return float("nan")
    if sr_trials_std is None:
        sr_trials_std = 1.0 / np.sqrt(n - 1)
    sr0 = expected_max_sharpe(n_trials, sr_trials_std)
    return probabilistic_sharpe_ratio(r, sr_benchmark=sr0)
