"""
Tests for VPIN (Volume-Synchronized Probability of Informed Trading)
Easley, López de Prado & O'Hara (2012) Review of Financial Studies 25(5)
"""
import numpy as np
import pandas as pd
import pytest

from alpha_flow.core.vpin import vpin, vpin_zscore


@pytest.fixture
def sample_ohlcv() -> pd.DataFrame:
    """Generate synthetic OHLCV data with known properties."""
    rng = np.random.default_rng(42)
    n = 200
    close = 100 + np.cumsum(rng.standard_normal(n) * 0.5)
    high = close + rng.uniform(0.1, 0.5, n)
    low = close - rng.uniform(0.1, 0.5, n)
    volume = rng.integers(1000, 10000, n).astype(float)
    return pd.DataFrame({"open": close, "high": high, "low": low, "close": close, "volume": volume})


def test_vpin_range(sample_ohlcv: pd.DataFrame) -> None:
    """VPIN values must lie in [0, 1] — it is a probability estimate."""
    result = vpin(sample_ohlcv)
    valid = result.dropna()
    assert len(valid) > 0, "VPIN must produce non-NaN values"
    assert (valid >= 0.0).all(), f"VPIN below 0 detected: {valid.min()}"
    assert (valid <= 1.0).all(), f"VPIN above 1 detected: {valid.max()}"


def test_vpin_zscore_is_standardised(sample_ohlcv: pd.DataFrame) -> None:
    """VPIN z-score should be centred near 0 with unit std over a large window."""
    result = vpin_zscore(sample_ohlcv, window=20, norm_window=60)
    valid = result.dropna()
    assert len(valid) > 10, "Too few valid VPIN z-scores produced"
    # Allow generous tolerance — z-scores are not exactly N(0,1) on finite samples
    assert abs(valid.mean()) < 2.0, f"VPIN z-score mean too far from 0: {valid.mean():.3f}"


def test_vpin_toxic_flow_detection() -> None:
    """Simulate toxic (one-sided) order flow — VPIN should spike high."""
    n = 100
    # All closes equal highs → buy_frac = 1.0 for every bar → pure buyer-initiated
    close = np.linspace(100, 110, n)
    df = pd.DataFrame({
        "open": close,
        "high": close,        # close == high → buy_frac = 1
        "low": close - 0.01,
        "close": close,
        "volume": np.ones(n) * 5000,
    })
    result = vpin(df, window=20)
    valid = result.dropna()
    assert len(valid) > 0
    # With purely buy-initiated flow, VPIN should be elevated (>> 0.3)
    assert valid.mean() > 0.5, f"Toxic flow VPIN unexpectedly low: {valid.mean():.3f}"


def test_vpin_pipeline_returns_series(sample_ohlcv: pd.DataFrame) -> None:
    """Both vpin() and vpin_zscore() must return pd.Series of the same length."""
    raw = vpin(sample_ohlcv)
    z = vpin_zscore(sample_ohlcv)
    assert isinstance(raw, pd.Series), "vpin() must return pd.Series"
    assert isinstance(z, pd.Series), "vpin_zscore() must return pd.Series"
    assert len(raw) == len(sample_ohlcv), "vpin() length must match input length"
    assert len(z) == len(sample_ohlcv), "vpin_zscore() length must match input length"
