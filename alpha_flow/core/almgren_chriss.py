"""
core/almgren_chriss.py — Optimal execution under linear market impact.

Almgren & Chriss (2001) solve the trader's dilemma: liquidate X shares over
horizon T while balancing **market-impact cost** (trade fast → move the price
against yourself) against **timing risk** (trade slow → exposed to volatility).
The closed-form optimal trajectory is the mean-variance-efficient schedule.

Model
-----
Discretise [0, T] into N intervals of length τ = T/N. Let xₖ = shares still to
sell at time tₖ (x₀ = X, x_N = 0) and nₖ = xₖ₋₁ − xₖ the shares sold in step k.

  Permanent impact:  price drifts by γ·nₖ  (does not decay)
  Temporary impact:  each trade pays η·(nₖ/τ) per share (decays instantly)
  Price risk:        σ = per-period volatility of the asset

Minimising  E[cost] + λ·Var[cost]  (λ = risk aversion) gives a trajectory
governed by a single parameter κ, with the elegant closed form:

        xₖ = X · sinh(κ(T − tₖ)) / sinh(κT)

        κ ≈ √(λ σ² / η)                (small-τ limit)

κ → 0 (risk-neutral): straight-line TWAP, sell evenly.
κ large (risk-averse): front-load — dump most of the position early to cut risk.

This is a genuine stochastic-control result (the discrete analogue of an
Euler–Lagrange solution), not a library call — included to demonstrate the
optimisation maths behind the paper-trading execution layer.

Reference: Almgren, R. & Chriss, N. (2001). Optimal execution of portfolio
transactions. Journal of Risk, 3, 5–40.
"""
from __future__ import annotations

import numpy as np


def kappa(risk_aversion: float, volatility: float, eta: float) -> float:
    """Trajectory curvature κ = √(λσ²/η). Higher risk aversion or vol → more
    front-loaded; deeper liquidity (large η penalty) → flatter (closer to TWAP)."""
    if eta <= 0:
        raise ValueError("temporary-impact coefficient eta must be > 0")
    return float(np.sqrt(max(risk_aversion, 0.0) * volatility**2 / eta))


def optimal_trajectory(
    total_shares: float,
    n_steps: int,
    risk_aversion: float,
    volatility: float,
    eta: float,
    horizon: float = 1.0,
) -> np.ndarray:
    """
    Optimal holdings path x₀…x_N (length n_steps+1), from `total_shares` to 0.

    xₖ = X·sinh(κ(T−tₖ)) / sinh(κT). At κ→0 this reduces to the linear TWAP
    schedule xₖ = X·(1 − tₖ/T). Returns the remaining-shares trajectory; take
    −np.diff(result) for the per-step trade sizes nₖ.
    """
    if n_steps < 1:
        raise ValueError("n_steps must be >= 1")
    t = np.linspace(0.0, horizon, n_steps + 1)
    k = kappa(risk_aversion, volatility, eta)
    if k * horizon < 1e-8:                       # risk-neutral limit → TWAP
        return total_shares * (1.0 - t / horizon)
    traj = total_shares * np.sinh(k * (horizon - t)) / np.sinh(k * horizon)
    traj[0], traj[-1] = total_shares, 0.0        # pin endpoints exactly
    return traj


def trade_schedule(
    total_shares: float,
    n_steps: int,
    risk_aversion: float,
    volatility: float,
    eta: float,
    horizon: float = 1.0,
) -> np.ndarray:
    """Per-step shares to trade nₖ (length n_steps), summing to `total_shares`."""
    traj = optimal_trajectory(total_shares, n_steps, risk_aversion, volatility, eta, horizon)
    return -np.diff(traj)


def expected_cost_and_variance(
    total_shares: float,
    n_steps: int,
    risk_aversion: float,
    volatility: float,
    eta: float,
    gamma: float = 0.0,
    horizon: float = 1.0,
) -> dict[str, float]:
    """
    Expected implementation shortfall and its variance for the optimal schedule.

      E[cost] = ½·γ·X²  +  η/τ · Σ nₖ²           (permanent + temporary impact)
      Var[cost] = σ² · τ · Σ xₖ²                  (timing risk on held inventory)

    The mean-variance objective E[cost] + λ·Var[cost] is what the trajectory
    minimises; reporting both lets you trace the efficient frontier by sweeping
    `risk_aversion`.
    """
    tau = horizon / n_steps
    traj = optimal_trajectory(total_shares, n_steps, risk_aversion, volatility, eta, horizon)
    n_k = -np.diff(traj)
    held = traj[1:]                              # inventory carried through each step
    temp_cost = float(eta / tau * np.sum(n_k**2))
    perm_cost = float(0.5 * gamma * total_shares**2)
    variance = float(volatility**2 * tau * np.sum(held**2))
    return {
        "expected_cost": round(perm_cost + temp_cost, 6),
        "permanent_cost": round(perm_cost, 6),
        "temporary_cost": round(temp_cost, 6),
        "variance": round(variance, 6),
        "kappa": round(kappa(risk_aversion, volatility, eta), 6),
    }
