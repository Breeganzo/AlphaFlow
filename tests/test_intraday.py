"""
tests/test_intraday.py
Phase 2 test suite — 10 tests for intraday data, signals, and API endpoints.

Adds to the existing 29 Phase 1 tests for a total of 39.

Run:
    pytest tests/ -v           # all 39 tests
    pytest tests/test_intraday.py -v  # just Phase 2
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
import sys
import os

# ─── Add project root to path so imports resolve ─────────────────────────────
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))


# ─── Helper: build a synthetic intraday OHLCV DataFrame ──────────────────────
def _make_hourly_df(n: int = 500) -> pd.DataFrame:
    """
    Generate a synthetic hourly OHLCV dataframe.
    Used in all tests that need price data without hitting yfinance.

    Characteristics:
      - DatetimeIndex, hourly frequency, 9:30 AM start
      - Prices follow a random walk (realistic for unit tests)
      - Volume follows a log-normal distribution (realistic)
      - All values are positive (valid OHLCV)
    """
    rng = np.random.default_rng(42)
    idx = pd.date_range('2024-01-02 09:30', periods=n, freq='h')

    closes = 100 + np.cumsum(rng.normal(0, 0.3, n))
    closes = np.maximum(closes, 1.0)   # no negative prices

    highs  = closes * (1 + rng.uniform(0, 0.005, n))
    lows   = closes * (1 - rng.uniform(0, 0.005, n))
    opens  = np.roll(closes, 1)
    opens[0] = closes[0]
    volumes = rng.lognormal(mean=14, sigma=0.8, size=n).astype(float)

    return pd.DataFrame({
        'open': opens, 'high': highs, 'low': lows,
        'close': closes, 'volume': volumes,
    }, index=idx)


# ═══════════════════════════════════════════════════════════════════════════════
# TESTS 1–2: Data infrastructure
# ═══════════════════════════════════════════════════════════════════════════════

def test_get_hourly_bars_returns_dataframe():
    """
    Test 1: get_hourly_bars returns a DataFrame with at least 100 bars and OHLCV columns.

    Why: Core Phase 2 data infrastructure. If this fails, all downstream tests fail.
    The function should always return valid data — either from cache, yfinance,
    or the synthetic fallback. 100 bars is the minimum viable for any ML model.
    """
    from alpha_flow.data.intraday_feed import get_hourly_bars
    df = get_hourly_bars('AAPL', years=1)
    assert isinstance(df, pd.DataFrame), "Should return a DataFrame"
    assert len(df) > 100, f"Expected >100 bars, got {len(df)}"
    assert set(['open', 'high', 'low', 'close', 'volume']).issubset(df.columns), \
        "Missing OHLCV columns"


def test_get_hourly_bars_no_negative_close():
    """
    Test 2: Close prices are never negative (data cleaning validation).

    Why: Negative prices indicate a data cleaning failure.
    yfinance and Alpaca occasionally return bad values — we clip them in
    _clean_ohlcv_intraday(). This test ensures the guard works.
    """
    from alpha_flow.data.intraday_feed import get_hourly_bars
    df = get_hourly_bars('AAPL', years=1)
    assert (df['close'] > 0).all(), "Close prices should never be negative"


# ═══════════════════════════════════════════════════════════════════════════════
# TESTS 3–4: VWAP signal
# ═══════════════════════════════════════════════════════════════════════════════

def test_vwap_zscore_range():
    """
    Test 3: VWAP deviation z-scores are in a realistic range [-5, +5].

    Why: Z-scores outside ±5 indicate numerical instability in the rolling
    normalisation. This would cause the LGBMRegressor to over-weight
    the VWAP signal during training (feature leakage).

    Reference: Almgren & Chriss (2001) — VWAP execution model.
    """
    from alpha_flow.core.vwap import vwap_deviation_zscore
    df = _make_hourly_df(500)
    z = vwap_deviation_zscore(df).dropna()
    assert len(z) > 0, "vwap_deviation_zscore returned empty series"
    assert (z >= -5).all() and (z <= 5).all(), \
        f"VWAP z-scores out of range: min={z.min():.2f}, max={z.max():.2f}"


def test_vwap_signal_values():
    """
    Test 4: vwap_reversion_signal returns only {-1, 0, +1}.

    Why: The signal drives long (+1) / flat (0) / short (-1) positions.
    Any other value would silently corrupt the position sizing.
    """
    from alpha_flow.core.vwap import vwap_reversion_signal
    df = _make_hourly_df(500)
    sig = vwap_reversion_signal(df).dropna()
    assert len(sig) > 0, "vwap_reversion_signal returned empty series"
    assert set(sig.unique()).issubset({-1, 0, 1}), \
        f"Unexpected signal values: {set(sig.unique())}"


# ═══════════════════════════════════════════════════════════════════════════════
# TESTS 5–6: Volume clock / Hawkes
# ═══════════════════════════════════════════════════════════════════════════════

def test_volume_imbalance_range():
    """
    Test 5: Volume imbalance values are in [-1, +1].

    Why: volume_imbalance = (buy_vol - sell_vol) / total_vol. This is
    mathematically bounded by construction. Any violation indicates a
    division-by-zero or NaN propagation bug.

    Reference: López de Prado (2018) Ch.3.
    """
    from alpha_flow.core.volume_clock import volume_imbalance
    df = _make_hourly_df(500)
    vi = volume_imbalance(df).dropna()
    assert len(vi) > 0, "volume_imbalance returned empty series"
    assert (vi >= -1).all() and (vi <= 1).all(), \
        f"Volume imbalance out of [-1,1] range: min={vi.min():.4f}, max={vi.max():.4f}"


def test_hawkes_params_positive():
    """
    Test 6: Hawkes process parameters μ, α, β are all > 0 after MLE fitting.

    Why: Negative parameter values are physically impossible for the Hawkes
    process (μ = background rate, α = excitement, β = decay must be positive).
    The MLE optimizer (L-BFGS-B) should enforce bounds, but this test
    verifies the implementation.

    Reference: Bacry, Mastromatteo & Muzy (2015).
    """
    from alpha_flow.core.hawkes import estimate_hawkes_params
    df = _make_hourly_df(300)
    params = estimate_hawkes_params(df['volume'])
    mu, alpha, beta = params['mu'], params['alpha'], params['beta']
    assert mu    > 0, f"Hawkes μ (background rate) should be positive, got {mu}"
    assert alpha > 0, f"Hawkes α (excitement) should be positive, got {alpha}"
    assert beta  > 0, f"Hawkes β (decay) should be positive, got {beta}"


# ═══════════════════════════════════════════════════════════════════════════════
# TESTS 7–8: Feature matrix
# ═══════════════════════════════════════════════════════════════════════════════

def test_intraday_feature_matrix_no_nan():
    """
    Test 7: build_intraday_feature_matrix returns zero NaN rows.

    Why: NaN rows in the feature matrix cause LightGBM to skip training samples
    silently, reducing effective fold size and corrupting IC measurement.
    The function must dropna() before returning.

    All 12 features + target are expected to be finite for every returned row.
    """
    from alpha_flow.analysis.intraday_engine import build_intraday_feature_matrix
    df = _make_hourly_df(600)
    feats = build_intraday_feature_matrix(df)
    assert feats.isna().sum().sum() == 0, \
        f"Feature matrix contains NaN values:\n{feats.isna().sum()}"


def test_feature_matrix_correct_columns():
    """
    Test 8: build_intraday_feature_matrix contains all 12 FEATURE_COLS + 'target'.

    Why: Any missing column silently reduces the feature space, making the model
    incomparable across runs. Explicitly testing column names catches import
    errors and typos in the feature pipeline.
    """
    from alpha_flow.analysis.intraday_engine import (
        build_intraday_feature_matrix, FEATURE_COLS
    )
    df = _make_hourly_df(600)
    feats = build_intraday_feature_matrix(df)
    for col in FEATURE_COLS:
        assert col in feats.columns, f"Missing feature column: '{col}'"
    assert 'target' in feats.columns, "Missing 'target' column"
    assert len(feats.columns) == len(FEATURE_COLS) + 1, \
        f"Expected {len(FEATURE_COLS)+1} columns, got {len(feats.columns)}: {list(feats.columns)}"


# ═══════════════════════════════════════════════════════════════════════════════
# TESTS 9–10: Pipeline smoke + API
# ═══════════════════════════════════════════════════════════════════════════════

def test_intraday_pipeline_smoke():
    """
    Test 9: run_intraday_pipeline runs without exception on synthetic AAPL data.

    This is a smoke test: it verifies the full pipeline (data → features →
    walk-forward LightGBM → SHAP) completes without crashing, not that
    the IC is above a threshold (that would be data-dependent).

    We patch get_intraday_bars to return synthetic data so:
      1. Test runs offline (no yfinance/Alpaca calls)
      2. Test is deterministic (same seed = same result every time)
    """
    import unittest.mock as mock
    from alpha_flow.analysis.intraday_engine import run_intraday_pipeline

    df = _make_hourly_df(1500)   # enough for ~17 folds at train_w=1000, test_w=250

    with mock.patch('alpha_flow.data.intraday_feed.get_intraday_bars', return_value=df):
        results = run_intraday_pipeline(['AAPL'], resolution='1h',
                                        train_window=1000, test_window=250)

    assert 'AAPL' in results, "Results should contain 'AAPL' key"
    aapl = results['AAPL']
    assert 'mean_ic' in aapl, f"Results missing 'mean_ic': {aapl}"
    assert 'error' not in aapl, f"Pipeline raised error: {aapl.get('error')}"
    assert aapl['n_folds'] >= 1, f"Expected at least 1 fold, got {aapl['n_folds']}"


def test_api_intraday_run_returns_run_id():
    """
    Test 10: POST /api/intraday/run returns HTTP 200 with a run_id.

    Uses FastAPI TestClient so the test runs without a live server.
    Patches run_intraday_pipeline to avoid actual computation.

    Why: Verifying the API contract here means frontend regressions are caught
    immediately when the backend is changed, before the server is restarted.
    """
    import unittest.mock as mock
    from fastapi.testclient import TestClient

    # Mock the pipeline so the test is fast and offline
    mock_result = {
        'AAPL': {'mean_ic': 0.08, 'sharpe': 1.2, 'n_folds': 5, 'n_bars': 3276,
                 'ic_per_fold': [0.06, 0.08, 0.09, 0.07, 0.10],
                 'shap_importance': {'ofi_zscore': 0.003, 'hawkes_zscore': 0.002}}
    }

    with mock.patch('alpha_flow.analysis.intraday_engine.run_intraday_pipeline',
                    return_value=mock_result):
        from backend.main import app
        client = TestClient(app)
        resp = client.post('/api/intraday/run', json={'tickers': ['AAPL'], 'resolution': '1h'})

    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    body = resp.json()
    assert 'run_id' in body, f"Response missing 'run_id': {body}"
    assert 'ic_summary' in body, f"Response missing 'ic_summary': {body}"
    assert 'AAPL' in body['ic_summary'], f"ic_summary missing 'AAPL': {body['ic_summary']}"
