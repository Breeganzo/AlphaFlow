"""
Tests for performance metrics: Calmar, Omega, IC_IR, IC t-stat
Grinold & Kahn (2000), Young (1991), Keating & Shadwick (2002)
"""
import math
import numpy as np
import pytest

from alpha_flow.analysis.performance import (
    calmar_ratio,
    omega_ratio,
    ic_information_ratio,
    ic_tstat,
)


# ── Calmar Ratio ─────────────────────────────────────────────────────────────

def test_calmar_positive_return_positive_drawdown() -> None:
    """Steady uptrend: calmar should be positive and finite."""
    pnl = list(range(1, 101))   # monotonically increasing cumulative PnL
    result = calmar_ratio(pnl)
    assert result is not None
    assert result > 0, f"Expected positive Calmar, got {result}"


def test_calmar_flat_curve() -> None:
    """Flat equity curve (zero per-bar P&L) → max_drawdown=0, ann_return=0 → calmar is nan (undefined)."""
    pnl = [0.0] * 50   # zero P&L each bar → flat
    result = calmar_ratio(pnl)
    import math
    assert result is None or (isinstance(result, float) and not math.isfinite(result)), (
        f"Flat curve: expected nan/None/inf, got {result}"
    )


def test_calmar_all_loss() -> None:
    """Constant negative per-bar P&L → ann_return < 0 and max_drawdown > 0 → calmar < 0."""
    pnl = [-0.002] * 100   # small negative return each bar
    result = calmar_ratio(pnl)
    assert result is not None
    import math
    assert math.isfinite(result) and result < 0, f"Expected negative Calmar for all-loss series, got {result}"


def test_calmar_single_bar_returns_none() -> None:
    """Single bar is insufficient to compute a drawdown → implementation returns NaN."""
    import math
    result = calmar_ratio([100.0])
    assert result is None or (isinstance(result, float) and not math.isfinite(result)), (
        f"Single-bar calmar: expected None/nan, got {result}"
    )


# ── Omega Ratio ──────────────────────────────────────────────────────────────

def test_omega_above_one_for_positive_returns() -> None:
    """All returns positive → Omega > 1 (no downside)."""
    returns = [0.01, 0.02, 0.015, 0.03, 0.005]
    result = omega_ratio(returns, threshold=0.0)
    assert result is not None
    assert result > 1.0, f"Expected Omega > 1 for all-positive returns, got {result}"


def test_omega_below_one_for_negative_returns() -> None:
    """All returns negative → Omega < 1 (pure downside)."""
    returns = [-0.01, -0.02, -0.015, -0.03]
    result = omega_ratio(returns, threshold=0.0)
    assert result is not None
    assert result < 1.0, f"Expected Omega < 1 for all-negative returns, got {result}"


def test_omega_symmetric_near_one() -> None:
    """Equal magnitude gains and losses → Omega ≈ 1."""
    returns = [0.01, -0.01, 0.02, -0.02, 0.015, -0.015]
    result = omega_ratio(returns, threshold=0.0)
    assert result is not None
    assert abs(result - 1.0) < 0.05, f"Expected Omega ≈ 1 for symmetric returns, got {result}"


# ── IC Information Ratio ─────────────────────────────────────────────────────

def test_ic_ir_consistent_signal() -> None:
    """IC consistently positive → IC_IR should be positive and > 0.5."""
    ic_folds = [0.06, 0.07, 0.08, 0.05, 0.09, 0.06, 0.07, 0.08]
    result = ic_information_ratio(ic_folds)
    assert result is not None
    assert result > 0.5, f"Expected IC_IR > 0.5 for consistently positive IC, got {result}"


def test_ic_ir_noisy_signal() -> None:
    """IC alternates + and − → IC_IR should be near 0."""
    ic_folds = [0.05, -0.05, 0.04, -0.04, 0.03, -0.03]
    result = ic_information_ratio(ic_folds)
    assert result is not None
    assert abs(result) < 1.5, f"Noisy IC_IR unexpectedly large: {result}"


def test_ic_ir_formula() -> None:
    """Manually verify: IC_IR = mean/std * sqrt(N)."""
    ic_folds = [0.04, 0.06, 0.05, 0.07]
    n = len(ic_folds)
    mean_ic = sum(ic_folds) / n
    std_ic = math.sqrt(sum((x - mean_ic) ** 2 for x in ic_folds) / (n - 1))
    expected = (mean_ic / std_ic) * math.sqrt(n)
    result = ic_information_ratio(ic_folds)
    assert result is not None
    assert abs(result - expected) < 0.001, f"IC_IR formula mismatch: expected {expected:.4f}, got {result:.4f}"


def test_ic_ir_single_fold_returns_none_or_zero() -> None:
    """Single fold: std = 0 → IC_IR undefined."""
    result = ic_information_ratio([0.05])
    assert result is None or result == 0 or not math.isfinite(result)


# ── IC t-statistic ───────────────────────────────────────────────────────────

def test_ic_tstat_significant_signal() -> None:
    """Strong positive IC with small variance → t-stat should be ≥ 2 (p < 0.05)."""
    # Distinct values ensure std > 0; all positive and high → t >> 2
    ic_folds = [0.06, 0.08, 0.07, 0.09, 0.08, 0.07, 0.06, 0.09,
                0.08, 0.07, 0.06, 0.09, 0.07, 0.08, 0.06, 0.09]
    t_stat, p_value = ic_tstat(ic_folds)
    assert t_stat is not None and p_value is not None
    assert t_stat > 2.0, f"Expected t > 2 for consistently positive IC, got {t_stat}"
    assert p_value < 0.05, f"Expected p < 0.05, got {p_value}"


def test_ic_tstat_noise() -> None:
    """Alternating IC → mean ≈ 0 → t-stat should be near 0."""
    ic_folds = [0.05, -0.05] * 10
    t_stat, p_value = ic_tstat(ic_folds)
    assert t_stat is not None
    assert abs(t_stat) < 1.0, f"Expected t ≈ 0 for zero-mean IC, got {t_stat}"


def test_ic_tstat_returns_tuple() -> None:
    """ic_tstat must return a 2-tuple of (t_stat, p_value)."""
    result = ic_tstat([0.03, 0.04, 0.05, 0.02, 0.06])
    assert isinstance(result, tuple) and len(result) == 2
    t_stat, p_value = result
    assert isinstance(t_stat, float)
    assert isinstance(p_value, float)
    assert 0.0 <= p_value <= 1.0, f"p-value out of [0,1]: {p_value}"
