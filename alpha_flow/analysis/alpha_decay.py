"""
alpha_flow/analysis/alpha_decay.py — Alpha Decay Analysis (execution/analytics)
====================================================================
Computes two quantities:
  1. IC half-life per ticker — how many bars until OFI predictive power decays by 50%.
     Model: IC(t) = IC₀ · exp(−λt).  Fit via non-linear least-squares (scipy).
  2. Cross-ticker IC-by-lag matrix — Spearman IC at lags 1–10 for every ticker.

References:
  Grinold & Kahn (2000) Active Portfolio Management — IC definition
  Cont, Cucuringu & Zhang (2023) Cross-impact of order flow imbalance
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from scipy.optimize import curve_fit


def ic_half_life(ic_by_lag: dict[int, float]) -> float | None:
    """
    Fit IC(t) = IC₀ · exp(−λt) to the IC-by-lag values.
    Returns the half-life in bars (ln(2)/λ), or None if the fit fails.

    Args:
        ic_by_lag: Dict mapping lag (1..10) → Spearman IC at that lag.

    Returns:
        Half-life in bars, or None if fit is degenerate.
    """
    lags = np.array(sorted(ic_by_lag.keys()), dtype=float)
    ics  = np.array([ic_by_lag[int(l)] for l in lags])

    if len(lags) < 3 or np.all(ics == 0):
        return None

    # If all IC values are very small (< 0.01), signal is essentially noise — no
    # meaningful decay pattern can be fit.  Return None rather than a spurious
    # 693k-bar half-life from the optimizer hitting the lower λ bound.
    if np.max(np.abs(ics)) < 0.01:
        return None

    # Exponential decay model
    def _decay(t: np.ndarray, ic0: float, lam: float) -> np.ndarray:
        return ic0 * np.exp(-lam * t)

    try:
        ic0_guess = float(ics[0]) if ics[0] != 0 else 0.01
        lam_guess = 0.3
        popt, _ = curve_fit(
            _decay, lags, ics,
            p0=[ic0_guess, lam_guess],
            maxfev=2000,
            bounds=([-1.0, 0.05], [1.0, 10.0]),  # λ ≥ 0.05 → half-life ≤ 13.9 bars
        )
        lam_fit = popt[1]
        if lam_fit <= 0:
            return None
        hl = round(float(np.log(2) / lam_fit), 2)
        # Sanity cap: > 15 bars means no practically useful decay signal
        return hl if hl <= 15.0 else None
    except Exception:
        return None


def compute_ic_by_lag(
    ofi_zscore: pd.Series,
    close_prices: pd.Series,
    lags: list[int] | None = None,
) -> dict[int, float]:
    """
    Compute Spearman IC between OFI Z-score and forward returns at each lag.

    Args:
        ofi_zscore:   Rolling OFI Z-score series (indexed by datetime).
        close_prices: Close price series aligned to same index.
        lags:         List of look-forward lags to compute.  Default 1–10.

    Returns:
        Dict: {lag: ic_value, ...}.  0.0 when insufficient data.
    """
    if lags is None:
        lags = list(range(1, 11))

    result: dict[int, float] = {}
    for lag in lags:
        fwd_ret = close_prices.pct_change(lag).shift(-lag)
        common = ofi_zscore.index.intersection(fwd_ret.dropna().index)
        if len(common) < 20:
            result[lag] = 0.0
            continue
        ic_val, _ = spearmanr(ofi_zscore.loc[common], fwd_ret.loc[common])
        result[lag] = 0.0 if np.isnan(ic_val) else round(float(ic_val), 4)

    return result


def ic_half_life_with_ci(
    ic_by_lag: dict[int, float],
    n_bootstrap: int = 200,
    noise_std: float = 0.005,
) -> dict[str, float | None]:
    """
    Bootstrap confidence interval for IC half-life.

    Adds Gaussian noise N(0, noise_std) to each IC value, re-fits the exponential
    decay model, and collects the resulting half-life distribution.  Returns the
    median estimate and the 5th/95th percentile bounds.

    A narrow CI [e.g. 2.1d, 2.5d] indicates the decay curve is well-determined.
    A wide CI [e.g. 1.2d, 4.8d] indicates the data is too noisy for a reliable fit.

    Parameters
    ----------
    ic_by_lag    : dict lag → Spearman IC at that lag
    n_bootstrap  : number of resamples (default: 200)
    noise_std    : std of Gaussian perturbation per lag (default: 0.005)

    Returns
    -------
    dict: {half_life, ci_5, ci_95} — all None if point estimate fails.

    Reference: Efron, B. & Hastie, T. (2016). Computer Age Statistical Inference.
               Cambridge University Press, Ch.11 (Bootstrap confidence intervals).
    """
    point_est = ic_half_life(ic_by_lag)
    if point_est is None:
        return {"half_life": None, "ci_5": None, "ci_95": None}

    rng = np.random.default_rng(seed=42)
    estimates: list[float] = []
    for _ in range(n_bootstrap):
        noisy = {lag: ic + float(rng.normal(0.0, noise_std)) for lag, ic in ic_by_lag.items()}
        hl = ic_half_life(noisy)
        if hl is not None:
            estimates.append(hl)

    if len(estimates) < 10:
        return {"half_life": point_est, "ci_5": None, "ci_95": None}

    return {
        "half_life": round(point_est, 2),
        "ci_5":      round(float(np.percentile(estimates, 5)), 2),
        "ci_95":     round(float(np.percentile(estimates, 95)), 2),
    }


def compute_alpha_decay_universe() -> dict[str, dict]:
    """
    Compute IC-by-lag and IC half-life for every active ticker.

    Returns:
        Dict: {ticker: {"ic_by_lag": {...}, "half_life_bars": float|None}}
    """
    from alpha_flow.config.settings import get_all_tickers
    from alpha_flow.data.data_feed import get_daily_bars
    from alpha_flow.core.ofi_calculator import rolling_ofi_zscore

    results: dict[str, dict] = {}

    for ticker in get_all_tickers():
        try:
            df = get_daily_bars(ticker, years=2)
            if len(df) < 80:
                results[ticker] = {"ic_by_lag": {}, "half_life_bars": None, "error": "insufficient_data"}
                continue

            ofi_z = rolling_ofi_zscore(df).dropna()
            ic_map = compute_ic_by_lag(ofi_z, df["close"])
            ci_result = ic_half_life_with_ci(ic_map)

            results[ticker] = {
                "ic_by_lag":      ic_map,
                "half_life_bars": ci_result["half_life"],
                "half_life_ci_5":  ci_result["ci_5"],
                "half_life_ci_95": ci_result["ci_95"],
            }
        except Exception as exc:
            results[ticker] = {"ic_by_lag": {}, "half_life_bars": None, "half_life_ci_5": None, "half_life_ci_95": None, "error": str(exc)}

    return results
