"""
tests/test_alpha_decay.py — Unit tests for execution alpha decay analysis module.

All tests are offline — no live data or API calls.
"""
from __future__ import annotations
import math
import numpy as np
import pandas as pd
import pytest

from alpha_flow.analysis.alpha_decay import ic_half_life, compute_ic_by_lag


# ── ic_half_life ──────────────────────────────────────────────────────────────

def test_half_life_positive_for_decaying_ic():
    """A cleanly decaying IC series should produce a positive, finite half-life."""
    ic_map = {lag: 0.05 * math.exp(-0.1 * lag) for lag in range(1, 11)}
    hl = ic_half_life(ic_map)
    assert hl is not None
    assert hl > 0


def test_half_life_none_for_all_zero_ics():
    """All-zero IC values cannot be fit — half-life must be None."""
    ic_map = {lag: 0.0 for lag in range(1, 11)}
    hl = ic_half_life(ic_map)
    assert hl is None


def test_half_life_none_for_insufficient_lags():
    """Fewer than 3 data points makes curve fitting degenerate."""
    ic_map = {1: 0.05, 2: 0.03}
    hl = ic_half_life(ic_map)
    assert hl is None


def test_half_life_is_json_serialisable():
    """half-life value must be a plain float (for JSON storage in SQLite)."""
    ic_map = {lag: 0.04 * math.exp(-0.15 * lag) for lag in range(1, 11)}
    hl = ic_half_life(ic_map)
    if hl is not None:
        import json
        assert json.dumps(hl)  # should not raise


# ── compute_ic_by_lag ─────────────────────────────────────────────────────────

def _synthetic_data(n: int = 300) -> tuple[pd.Series, pd.Series]:
    """Return synthetic (ofi_zscore, close_price) series for testing."""
    idx = pd.date_range("2023-01-01", periods=n, freq="D")
    close = pd.Series(100 + np.cumsum(np.random.randn(n) * 0.5), index=idx, name="close")
    ofi = pd.Series(np.random.randn(n), index=idx, name="ofi_z")
    return ofi, close


def test_ic_by_lag_returns_10_lags():
    """Default should return ICs for lags 1–10."""
    ofi, close = _synthetic_data()
    result = compute_ic_by_lag(ofi, close)
    assert set(result.keys()) == set(range(1, 11))


def test_ic_by_lag_values_in_minus1_to_1():
    """All IC values must be in [−1, 1] by definition of Spearman correlation."""
    ofi, close = _synthetic_data()
    result = compute_ic_by_lag(ofi, close)
    for lag, val in result.items():
        assert -1.0 <= val <= 1.0, f"IC at lag {lag} = {val} is out of range"


def test_ic_by_lag_returns_zero_for_insufficient_data():
    """With fewer than 20 common data points, IC must default to 0."""
    idx = pd.date_range("2023-01-01", periods=15, freq="D")
    ofi = pd.Series(np.random.randn(15), index=idx)
    close = pd.Series(100 + np.random.randn(15).cumsum(), index=idx)
    result = compute_ic_by_lag(ofi, close, lags=[1, 2])
    assert result[1] == 0.0
    assert result[2] == 0.0
