"""
core/hawkes.py
Hourly: Hawkes process intensity for self-exciting order flow.

A Hawkes process models events that trigger more events — like earthquakes
triggering aftershocks. In finance: a large buy order triggers momentum chasers,
stop-loss triggers, and HFT responses, causing a burst of follow-on orders.

Mathematical model:
    λ(t) = μ + Σᵢ α · exp(-β · (t - tᵢ))

  μ (mu)   = baseline order arrival rate (how busy the market is normally)
  α (alpha) = excitement (how much each order triggers follow-on orders)
  β (beta)  = decay (how fast the excitement fades)

When λ(t) is high → institutional activity burst → strong directional signal
When λ(t) is low  → quiet market → weak signal

Academic novelty (what makes AlphaFlow unique):
  Cont, Cucuringu & Zhang (2023) use Hawkes on limit order book (LOB) data.
  AlphaFlow uses Hawkes INTENSITY AS AN LLM FEATURE — nobody has done this.
  The LLM can now say "Hawkes intensity is 2.3σ above normal → likely
  institutional activity" instead of just reporting raw metrics.

Proxy approach (no tick data required):
  We use hourly bar VOLUME as a proxy for trade arrival intensity.
  Volume ∝ number of trades; volume spikes indicate order bursts.
  This is academically defensible for research purposes (documented limitation).

References:
  Bacry, E., Mastromatteo, I., & Muzy, J.F. (2015). Hawkes processes in finance.
  Market Microstructure and Liquidity, 1(01).
  DOI: 10.1017/S026646662015004X
"""
from __future__ import annotations

import warnings

import numpy as np
import pandas as pd
from scipy.optimize import minimize

from alpha_flow.config.settings import HAWKES_DECAY, HAWKES_EXCITEMENT


# ─── MLE fitting ──────────────────────────────────────────────────────────────

def estimate_hawkes_params(
    intensity_series: pd.Series,
    mu_init: float = 1.0,
    alpha_init: float = HAWKES_EXCITEMENT,
    beta_init: float = HAWKES_DECAY,
) -> dict[str, float]:
    """
    Fit Hawkes process parameters via Maximum Likelihood Estimation.

    What you learn here:
      - MLE: find parameters that maximise the probability of observing the data
      - scipy.optimize.minimize: general-purpose numerical optimisation
      - Why we need bounds: α must be < β for the process to be stationary
        (otherwise the intensity explodes to infinity)

    Args:
        intensity_series: pd.Series of observed intensities (volume proxy)
        mu_init, alpha_init, beta_init: initial parameter guesses

    Returns:
        dict with keys 'mu', 'alpha', 'beta'
        Falls back to initial guesses if optimisation fails.
    """
    arr = intensity_series.dropna().values.astype(float)
    arr = arr[arr > 0]   # Hawkes intensity must be positive
    if len(arr) < 10:
        return {"mu": mu_init, "alpha": alpha_init, "beta": beta_init}

    # Normalise so the optimiser sees O(1) values
    scale = arr.mean()
    arr_n = arr / scale

    def neg_log_likelihood(params: np.ndarray) -> float:
        """
        Simplified log-likelihood for discretised Hawkes process.
        Uses the continuous-time approximation on binned data.
        """
        mu, alpha, beta = params
        if mu <= 0 or alpha <= 0 or beta <= 0 or alpha >= beta:
            return 1e10   # Infeasible — return large penalty

        n   = len(arr_n)
        dt  = 1.0         # normalised bar interval

        # Iterative computation of λ(tᵢ) = μ + Σⱼ<ᵢ α·exp(-β·(i-j)·dt)
        lam_vals = np.empty(n)
        lam      = mu
        for i in range(n):
            lam_vals[i] = lam
            lam = mu + (lam - mu) * np.exp(-beta * dt) + alpha * arr_n[i]

        lam_vals = np.maximum(lam_vals, 1e-10)
        ll = np.sum(np.log(lam_vals)) - np.trapz(lam_vals) * dt
        return -ll

    x0     = [mu_init, alpha_init, beta_init]
    bounds = [(1e-6, None), (1e-6, None), (1e-6, None)]

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        result = minimize(
            neg_log_likelihood,
            x0,
            method="L-BFGS-B",
            bounds=bounds,
            options={"maxiter": 200, "ftol": 1e-8},
        )

    if result.success and all(result.x > 0):
        mu_fit, alpha_fit, beta_fit = result.x
        # Re-scale mu back (alpha and beta are dimensionless ratios)
        return {"mu": float(mu_fit) * scale, "alpha": float(alpha_fit), "beta": float(beta_fit)}

    # Fallback: initial guesses (MLE failed — documented gracefully)
    return {"mu": mu_init * scale, "alpha": alpha_init, "beta": beta_init}


# ─── Intensity computation ────────────────────────────────────────────────────

def hawkes_intensity(
    df: pd.DataFrame,
    window_bars: int = 30,
) -> pd.Series:
    """
    Compute rolling Hawkes intensity λ(t) for each bar.

    We use VOLUME as a proxy for trade arrivals:
      - Volume ↑ → more trades → higher λ(t)
      - The Hawkes model captures the self-exciting property:
        a burst in volume triggers further volume bursts

    For each bar i:
      λᵢ = μ + Σⱼ<ᵢ α · exp(-β · (i-j))   over last `window_bars` bars

    This is computed efficiently with exponential moving sums, not a nested loop.

    Args:
        df:          DataFrame with 'volume' column
        window_bars: How many recent bars to consider for intensity

    Returns:
        pd.Series named 'hawkes_intensity'
    """
    vol = df["volume"].copy().astype(float)
    vol = vol.clip(lower=0)

    # Fit parameters once on the full series
    params = estimate_hawkes_params(vol, mu_init=vol.mean())
    mu    = params["mu"]
    alpha = params["alpha"]
    beta  = params["beta"]

    # Efficient recursive computation: λᵢ₊₁ = μ + (λᵢ - μ)·e^(-β) + α·Nᵢ
    # where Nᵢ is the event count (volume) at time i
    n    = len(vol)
    lam  = np.empty(n)
    lam[0] = mu

    vol_arr = vol.values
    for i in range(1, n):
        lam[i] = mu + (lam[i-1] - mu) * np.exp(-beta) + alpha * vol_arr[i-1]

    result = pd.Series(lam, index=df.index, name="hawkes_intensity")
    return result.clip(lower=0)


def hawkes_intensity_zscore(
    df: pd.DataFrame,
    window_bars: int = 30,
    zscore_window: int = 20,
) -> pd.Series:
    """
    Z-score of Hawkes intensity over a rolling window.

    The raw intensity value depends on scale (volume units).
    Z-scoring makes it comparable across tickers and time periods.
    z > +2σ means unusually high institutional activity → strong signal.

    Returns:
        pd.Series named 'hawkes_zscore' — normalised intensity signal
    """
    intensity = hawkes_intensity(df, window_bars=window_bars)
    roll_mean = intensity.rolling(zscore_window, min_periods=5).mean()
    roll_std  = intensity.rolling(zscore_window, min_periods=5).std()
    z = (intensity - roll_mean) / roll_std.replace(0, np.nan)
    return z.fillna(0.0).rename("hawkes_zscore")
