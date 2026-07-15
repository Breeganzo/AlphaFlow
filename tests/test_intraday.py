"""
tests/test_intraday.py
hourly test suite — 21 tests for intraday data, signals, and API endpoints.

Part of the full suite (109 tests across all test files, see README.md).

Run:
    pytest tests/ -v                    # all tests
    pytest tests/test_intraday.py -v    # just this file
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

    Why: Core hourly data infrastructure. If this fails, all downstream tests fail.
    The function should always return valid data — either from cache, yfinance,
    or the synthetic fallback. 100 bars is the minimum viable for any ML model.
    """
    from alpha_flow.data.intraday_feed import get_hourly_bars
    df = get_hourly_bars('AAPL', years=1)
    if df.empty:
        pytest.skip("Live hourly data unavailable (no cache, yfinance returned empty)")
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
    if df.empty:
        pytest.skip("Live hourly data unavailable (no cache, yfinance returned empty)")
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


# ═══════════════════════════════════════════════════════════════════════════════
# TESTS 11–13: execution metrics — IC_IR, IC t-stat, VPIN feature
# ═══════════════════════════════════════════════════════════════════════════════

def test_pipeline_produces_ic_ir():
    """
    Test 11: Pipeline results for AAPL include ic_ir from Grinold & Kahn (2000).

    IC_IR = mean(IC) / std(IC) × √N is the Fundamental Law metric that measures
    signal CONSISTENCY, not just average strength. A positive ic_ir confirms the
    signal is reproducible across walk-forward folds.
    """
    import unittest.mock as mock
    from alpha_flow.analysis.intraday_engine import run_intraday_pipeline

    df = _make_hourly_df(1500)
    with mock.patch('alpha_flow.data.intraday_feed.get_intraday_bars', return_value=df):
        results = run_intraday_pipeline(['AAPL'], resolution='1h',
                                        train_window=1000, test_window=250)

    aapl = results['AAPL']
    assert 'error' not in aapl, f"Pipeline raised error: {aapl.get('error')}"
    assert 'ic_ir' in aapl, f"Expected 'ic_ir' in results keys: {list(aapl.keys())}"
    assert aapl['ic_ir'] is not None, "ic_ir should not be None when n_folds >= 2"
    # IC_IR can be any finite float — just validate type and finiteness
    import math
    assert math.isfinite(aapl['ic_ir']), f"ic_ir should be finite, got {aapl['ic_ir']}"


def test_pipeline_produces_ic_tstat():
    """
    Test 12: Pipeline includes ic_tstat and ic_pvalue (H₀: mean IC = 0).

    A significant t-stat (|t| ≥ 2, p ≤ 0.05) is required to reject the null
    hypothesis that IC is zero by chance. This validates signal statistical
    significance, not just observed mean IC.
    """
    import unittest.mock as mock
    from alpha_flow.analysis.intraday_engine import run_intraday_pipeline

    df = _make_hourly_df(1500)
    with mock.patch('alpha_flow.data.intraday_feed.get_intraday_bars', return_value=df):
        results = run_intraday_pipeline(['AAPL'], resolution='1h',
                                        train_window=1000, test_window=250)

    aapl = results['AAPL']
    assert 'error' not in aapl, f"Pipeline raised error: {aapl.get('error')}"
    assert 'ic_tstat' in aapl, f"Expected 'ic_tstat' in results: {list(aapl.keys())}"
    assert 'ic_pvalue' in aapl, f"Expected 'ic_pvalue' in results: {list(aapl.keys())}"
    if aapl['ic_tstat'] is not None:
        import math
        assert math.isfinite(aapl['ic_tstat']), f"ic_tstat should be finite, got {aapl['ic_tstat']}"
        assert 0.0 <= aapl['ic_pvalue'] <= 1.0, f"ic_pvalue out of [0,1]: {aapl['ic_pvalue']}"


def test_pipeline_includes_vpin_feature():
    """
    Test 13: Feature matrix includes 'vpin_zscore' as feature #13.

    VPIN (Easley, López de Prado & O'Hara 2012, RFS 25(5)) is added via BVC
    (Bulk Volume Classification). Its presence confirms the 13-feature pipeline
    is correctly assembled with the VPIN flow toxicity signal.
    """
    from alpha_flow.analysis.intraday_engine import build_intraday_feature_matrix

    df = _make_hourly_df(300)
    feat_df = build_intraday_feature_matrix(df)

    assert 'vpin_zscore' in feat_df.columns, (
        f"'vpin_zscore' missing from feature matrix. Got: {list(feat_df.columns)}"
    )
    # Validate z-score is mostly finite
    valid = feat_df['vpin_zscore'].dropna()
    assert len(valid) > 10, "Too few non-NaN VPIN z-scores in feature matrix"


# ═══════════════════════════════════════════════════════════════════════════════
# TEST 14: Standard Error of the Mean (SEM) — IC, Sharpe, hit-rate
# ═══════════════════════════════════════════════════════════════════════════════

def test_pipeline_produces_sem_fields():
    """
    Test 14: Pipeline results include ic_sem, sharpe_sem, hit_rate_sem — the
    walk-forward-fold-sampling Standard Errors of the Mean that back the
    frontend's ±95% CI badges (mirroring the Alpha Decay chart convention).

    Reference-value checks:
      - ic_sem must equal std(ic_per_fold, ddof=1) / √n_folds exactly (it is
        derived from the same per-fold IC array the pipeline already returns).
      - hit_rate_sem is a binomial proportion SE: √(p(1-p)/n) ∈ [0, 0.5], since
        p(1-p) is maximised at p=0.5 and n ≥ 1.
      - sharpe_sem must be finite and non-negative.
    """
    import math
    import unittest.mock as mock
    from alpha_flow.analysis.intraday_engine import run_intraday_pipeline

    df = _make_hourly_df(1500)
    with mock.patch('alpha_flow.data.intraday_feed.get_intraday_bars', return_value=df):
        results = run_intraday_pipeline(['AAPL'], resolution='1h',
                                        train_window=1000, test_window=250)

    aapl = results['AAPL']
    assert 'error' not in aapl, f"Pipeline raised error: {aapl.get('error')}"
    for key in ('ic_sem', 'sharpe_sem', 'hit_rate_sem'):
        assert key in aapl, f"Expected '{key}' in results: {list(aapl.keys())}"
        assert math.isfinite(aapl[key]), f"{key} should be finite, got {aapl[key]}"
        assert aapl[key] >= 0.0, f"{key} should be non-negative, got {aapl[key]}"

    # Reference-value check: ic_sem == std(ic_per_fold, ddof=1) / √N
    ic_per_fold = aapl['ic_per_fold']
    n_folds = aapl['n_folds']
    if n_folds >= 2:
        expected_ic_sem = float(np.std(ic_per_fold, ddof=1) / np.sqrt(n_folds))
        assert math.isclose(aapl['ic_sem'], expected_ic_sem, rel_tol=1e-6, abs_tol=1e-9), (
            f"ic_sem {aapl['ic_sem']} != std(ic_per_fold, ddof=1)/√N {expected_ic_sem}"
        )

    # hit_rate_sem is a binomial proportion SE, bounded by 0.5 (p=0.5 maximises p(1-p))
    assert aapl['hit_rate_sem'] <= 0.5, f"hit_rate_sem should be ≤ 0.5, got {aapl['hit_rate_sem']}"


# ═════════════════════════════════════════════════════════════════════════════
# TESTS 15–19: Benjamini-Hochberg FDR correction (Hourly significance gate)
# ═════════════════════════════════════════════════════════════════════════════

def test_benjamini_hochberg_reference_value():
    """
    Test 15: _benjamini_hochberg_threshold matches a hand-computed reference.

    p = [0.001, 0.01, 0.03, 0.04, 0.20], q = 0.10, m = 5.
    Bound at rank k is (k/5)*0.10:  k=1→0.02  k=2→0.04  k=3→0.06  k=4→0.08  k=5→0.10
      k=1: 0.001 <= 0.02  ✓
      k=2: 0.01  <= 0.04  ✓
      k=3: 0.03  <= 0.06  ✓
      k=4: 0.04  <= 0.08  ✓
      k=5: 0.20  <= 0.10  ✗
    Largest surviving k is 4 → threshold = p(4) = 0.04.
    """
    from backend.main import _benjamini_hochberg_threshold
    threshold = _benjamini_hochberg_threshold([0.001, 0.01, 0.03, 0.04, 0.20], q=0.10)
    assert threshold == pytest.approx(0.04), f"Expected BH threshold 0.04, got {threshold}"


def test_benjamini_hochberg_no_survivors():
    """
    Test 16: When every p-value is far above q, nothing survives correction —
    threshold must be 0.0 so no ticker can pass a `pvalue <= threshold` gate.
    """
    from backend.main import _benjamini_hochberg_threshold
    threshold = _benjamini_hochberg_threshold([0.5, 0.6, 0.7, 0.8], q=0.10)
    assert threshold == 0.0, f"Expected no survivors (threshold 0.0), got {threshold}"


def test_benjamini_hochberg_all_survive():
    """
    Test 17: When every p-value is tiny, all of them survive correction —
    threshold must equal the largest (least-significant) p-value in the set.
    """
    from backend.main import _benjamini_hochberg_threshold
    pvalues = [0.001, 0.002, 0.003, 0.004]
    threshold = _benjamini_hochberg_threshold(pvalues, q=0.10)
    assert threshold == pytest.approx(max(pvalues)), (
        f"Expected all-survive threshold {max(pvalues)}, got {threshold}"
    )


def test_intraday_cards_book_produces_buys_and_sells():
    """
    Two-tier (Hourly): the tradeable book ranks by `latest_signal` (the
    direction-corrected latest predicted return) and produces an actual
    long-short book — top decile BUY, bottom decile SELL — regardless of
    per-name significance. This is the fix for the previous all-HOLD behaviour.
    """
    from backend.main import _build_intraday_cards
    # 20 tickers with a clean latest_signal spread; p-values all insignificant.
    results = {}
    for i in range(20):
        results[f"T{i:02d}"] = {
            "mean_ic": 0.01, "ic_pvalue": 0.6,
            "latest_signal": (i - 9.5) * 1e-3,   # -9.5e-3 .. +9.5e-3
        }
    cards = _build_intraday_cards(results)
    sigs = {c["ticker"]: c["signal"] for c in cards}
    assert "BUY" in sigs.values() and "SELL" in sigs.values(), \
        "Hourly book must produce BUY and SELL from the latest_signal ranking, not all-HOLD"
    assert sigs["T19"] == "BUY" and sigs["T00"] == "SELL"


def test_intraday_cards_high_conviction_flag():
    """
    The Tier-2 `high_conviction` flag marks names whose IC survives BH-FDR
    correction — independent of the tradeable BUY/SELL. A lone strong cluster
    is flagged; pure noise is not.
    """
    from backend.main import _build_intraday_cards
    results = {"STRONG": {"mean_ic": 0.05, "ic_pvalue": 0.0005, "latest_signal": 0.02}}
    for i in range(19):
        results[f"NOISE_{i:02d}"] = {"mean_ic": 0.01, "ic_pvalue": 0.6, "latest_signal": (i - 9) * 1e-4}
    cards = {c["ticker"]: c for c in _build_intraday_cards(results)}
    assert cards["STRONG"]["high_conviction"] is True, "genuinely significant IC should be high-conviction"
    assert all(cards[f"NOISE_{i:02d}"]["high_conviction"] is False for i in range(19)), \
        "insignificant names must not be flagged high-conviction"


def test_intraday_buy_can_be_low_conviction():
    """
    Core property: a name can be a tradeable BUY (top of the latest_signal
    ranking) while NOT high-conviction (its IC doesn't survive FDR). This is
    exactly what free-data runs look like — an actionable book, honestly
    labelled as statistically weak.
    """
    from backend.main import _build_intraday_cards
    results = {"TOP": {"mean_ic": 0.02, "ic_pvalue": 0.30, "latest_signal": 0.05}}
    for i in range(19):
        results[f"F{i:02d}"] = {"mean_ic": 0.0, "ic_pvalue": 0.6, "latest_signal": -0.01 - i * 1e-3}
    cards = {c["ticker"]: c for c in _build_intraday_cards(results)}
    assert cards["TOP"]["signal"] == "BUY" and cards["TOP"]["high_conviction"] is False
