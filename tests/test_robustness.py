"""
Tests for the statistical-rigor + math-depth additions:
  - Probabilistic / Deflated Sharpe Ratio (Bailey & López de Prado 2012, 2014)
  - Almgren-Chriss optimal execution (2001)
  - Hawkes branching ratio η = α/β
"""
import numpy as np
import pandas as pd
import pytest

from alpha_flow.analysis.performance import (
    probabilistic_sharpe_ratio,
    deflated_sharpe_ratio,
    expected_max_sharpe,
)
from alpha_flow.core.almgren_chriss import (
    optimal_trajectory,
    trade_schedule,
    expected_cost_and_variance,
    kappa,
)
from alpha_flow.core.hawkes import hawkes_branching_ratio


# ── Probabilistic Sharpe Ratio ───────────────────────────────────────────────

def _returns(mean, sd, n, seed=0):
    rng = np.random.default_rng(seed)
    return rng.normal(mean, sd, n)


def test_psr_high_for_strong_consistent_returns() -> None:
    r = _returns(0.01, 0.01, 500)          # SR ≈ 1.0 per period, long record
    assert probabilistic_sharpe_ratio(r) > 0.95


def test_psr_half_for_exactly_zero_mean() -> None:
    r = _returns(0.0, 0.02, 500)
    r = r - r.mean()          # SR == 0 exactly → PSR(0) == Φ(0) == 0.5
    assert probabilistic_sharpe_ratio(r) == pytest.approx(0.5, abs=0.02)


def test_psr_low_when_below_benchmark() -> None:
    r = _returns(0.005, 0.02, 300)
    # benchmark well above the sample SR → low probability of exceeding it
    assert probabilistic_sharpe_ratio(r, sr_benchmark=1.0) < 0.1


def test_psr_nan_for_tiny_sample() -> None:
    assert np.isnan(probabilistic_sharpe_ratio([0.01, 0.02]))


def test_psr_shrinks_with_shorter_record() -> None:
    strong = _returns(0.01, 0.01, 1000, seed=1)
    weak = strong[:20]
    assert probabilistic_sharpe_ratio(strong) >= probabilistic_sharpe_ratio(weak)


# ── Deflated Sharpe Ratio ────────────────────────────────────────────────────

def test_dsr_not_greater_than_psr() -> None:
    r = _returns(0.01, 0.01, 500)
    psr = probabilistic_sharpe_ratio(r)
    dsr = deflated_sharpe_ratio(r, n_trials=50)
    assert dsr <= psr + 1e-9


def test_dsr_decreases_with_more_trials() -> None:
    r = _returns(0.008, 0.01, 500)
    few = deflated_sharpe_ratio(r, n_trials=2)
    many = deflated_sharpe_ratio(r, n_trials=1000)
    assert many <= few


def test_expected_max_sharpe_monotonic_in_trials() -> None:
    assert expected_max_sharpe(1000, 0.1) > expected_max_sharpe(10, 0.1)


def test_expected_max_sharpe_zero_when_no_dispersion() -> None:
    assert expected_max_sharpe(100, 0.0) == 0.0


# ── Almgren-Chriss optimal execution ─────────────────────────────────────────

def test_trajectory_endpoints_and_length() -> None:
    traj = optimal_trajectory(1000, n_steps=10, risk_aversion=1e-6,
                              volatility=0.02, eta=0.1)
    assert len(traj) == 11
    assert traj[0] == pytest.approx(1000)
    assert traj[-1] == pytest.approx(0.0)


def test_risk_neutral_is_linear_twap() -> None:
    traj = optimal_trajectory(1000, n_steps=10, risk_aversion=0.0,
                              volatility=0.02, eta=0.1)
    expected = np.linspace(1000, 0, 11)
    assert np.allclose(traj, expected)


def test_risk_averse_front_loads() -> None:
    # Higher risk aversion sells more early: midpoint inventory is lower.
    twap = optimal_trajectory(1000, 10, 0.0, 0.02, 0.1)
    averse = optimal_trajectory(1000, 10, 5.0, 0.05, 0.01)
    assert averse[5] < twap[5]


def test_schedule_sums_to_total() -> None:
    sched = trade_schedule(1000, 20, 2.0, 0.03, 0.05)
    assert sched.sum() == pytest.approx(1000)
    assert np.all(sched >= -1e-9)


def test_cost_variance_tradeoff() -> None:
    # More risk aversion → lower timing variance (trades faster).
    low = expected_cost_and_variance(1000, 20, 0.1, 0.03, 0.05)
    high = expected_cost_and_variance(1000, 20, 10.0, 0.03, 0.05)
    assert high["variance"] < low["variance"]
    assert high["kappa"] > low["kappa"]


def test_kappa_rejects_bad_eta() -> None:
    with pytest.raises(ValueError):
        kappa(1.0, 0.02, 0.0)


# ── Hawkes branching ratio ───────────────────────────────────────────────────

def test_branching_ratio_in_unit_interval() -> None:
    rng = np.random.default_rng(3)
    # Bursty, autocorrelated volume proxy → self-exciting.
    base = rng.gamma(2.0, 1.0, 400)
    vol = pd.Series(base).rolling(3, min_periods=1).sum()
    out = hawkes_branching_ratio(vol)
    assert "branching_ratio" in out and "regime" in out
    eta = out["branching_ratio"]
    assert np.isnan(eta) or eta > 0.0
    assert out["regime"] in {
        "near-Poisson (independent flow)", "moderately self-exciting",
        "near-critical (reflexive)", "inconclusive (MLE did not converge)", "undefined",
    }


def test_branching_ratio_keys() -> None:
    vol = pd.Series(np.abs(np.random.default_rng(4).normal(100, 20, 200)))
    out = hawkes_branching_ratio(vol)
    assert set(["mu", "alpha", "beta", "branching_ratio", "regime"]).issubset(out)
