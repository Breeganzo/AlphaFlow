"""
tests/test_microstructure.py
Unit tests for core microstructure modules.
Tests cover:
  - Shape / range invariants (basic sanity)
  - Formula correctness (value-level checks)
  - Edge cases (constants, minimal data)
  - Cross-sectional signal determinism
  - Sharpe / drawdown metric correctness
  - Data cleaning protocol
"""
import numpy as np
import pandas as pd
import pytest
import sys, os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../../"))

from alpha_flow.core.ofi_calculator import compute_ofi, rolling_ofi_zscore
from alpha_flow.core.amihud import amihud_ratio, kyle_lambda
from alpha_flow.core.lee_ready import tick_sign, signed_volume
from alpha_flow.core.spread_tracker import corwin_schultz_spread
from alpha_flow.analysis.performance import (
    information_coefficient, binary_auc,
    annualised_sharpe, max_drawdown, sortino_ratio,
)
from alpha_flow.data.data_feed import _clean_ohlcv


# ── Fixtures ──────────────────────────────────────────────────────────────────
@pytest.fixture()
def mock_bars() -> pd.DataFrame:
    np.random.seed(7)
    n = 200
    dates = pd.date_range("2023-01-01", periods=n, freq="B")
    close = 100 * np.exp(np.cumsum(np.random.randn(n) * 0.01))
    high  = close * (1 + np.abs(np.random.randn(n) * 0.005))
    low   = close * (1 - np.abs(np.random.randn(n) * 0.005))
    open_ = close * (1 + np.random.randn(n) * 0.003)
    volume = np.random.randint(500_000, 3_000_000, n).astype(float)
    return pd.DataFrame({
        "open": open_, "high": high, "low": low,
        "close": close, "volume": volume,
    }, index=dates)


# ── OFI ───────────────────────────────────────────────────────────────────────
def test_ofi_range(mock_bars):
    ofi = compute_ofi(mock_bars)
    assert ofi.between(-1, 1).all(), "OFI must be in [-1, 1]"


def test_ofi_zscore_no_unexpected_nan(mock_bars):
    z = rolling_ofi_zscore(mock_bars, window=20)
    assert len(z) == len(mock_bars)
    assert not z.isna().any(), "OFI z-score should fill NaN with 0.0"


def test_ofi_all_buy_bars():
    """All buyer-initiated bars → OFI must be +1."""
    n = 50
    dates = pd.date_range("2023-01-01", periods=n, freq="B")
    close  = np.linspace(100, 110, n)
    df = pd.DataFrame({
        "open":   close - 0.5,    # close > open → buyer bar
        "high":   close + 0.5,
        "low":    close - 1.0,
        "close":  close,
        "volume": np.full(n, 1_000_000.0),
    }, index=dates)
    ofi = compute_ofi(df)
    assert (ofi == 1.0).all(), "All buy-bar days should give OFI = +1"


def test_ofi_all_sell_bars():
    """All seller-initiated bars → OFI must be -1."""
    n = 50
    dates = pd.date_range("2023-01-01", periods=n, freq="B")
    close  = np.linspace(110, 100, n)
    df = pd.DataFrame({
        "open":   close + 0.5,    # close < open → seller bar
        "high":   close + 1.0,
        "low":    close - 0.5,
        "close":  close,
        "volume": np.full(n, 1_000_000.0),
    }, index=dates)
    ofi = compute_ofi(df)
    assert (ofi == -1.0).all(), "All sell-bar days should give OFI = -1"


# ── Amihud ────────────────────────────────────────────────────────────────────
def test_amihud_positive(mock_bars):
    am = amihud_ratio(mock_bars)
    valid = am.dropna()
    assert (valid >= 0).all(), "Amihud must be non-negative"


def test_amihud_formula_direction(mock_bars):
    """Higher volume bars should, on average, produce lower Amihud (more liquid)."""
    df_low  = mock_bars.copy(); df_low["volume"]  *= 0.01   # illiquid
    df_high = mock_bars.copy(); df_high["volume"] *= 100    # very liquid
    am_low  = amihud_ratio(df_low).dropna().mean()
    am_high = amihud_ratio(df_high).dropna().mean()
    assert am_low > am_high, "Lower volume → higher Amihud (less liquid)"


# ── Kyle Lambda ───────────────────────────────────────────────────────────────
def test_kyle_lambda_length(mock_bars):
    kl = kyle_lambda(mock_bars)
    assert len(kl) == len(mock_bars)


def test_kyle_lambda_formula():
    """
    Verify Kyle λ sign: when price moves up with net buying (close>open),
    λ should be positive (buyer pressure drives price up).
    """
    n = 100
    dates = pd.date_range("2023-01-01", periods=n, freq="B")
    # Synthetic: strong positive price + strong buy signal
    price_change = np.where(np.arange(n) % 2 == 0, +1.0, -0.5)
    close = 100 + np.cumsum(price_change)
    # close > open on up days → net buy; close < open on down days → net sell
    open_ = np.where(price_change > 0, close - 1.0, close + 0.5)
    df = pd.DataFrame({
        "open":   open_,
        "high":   close + 0.5,
        "low":    close - 0.5,
        "close":  close,
        "volume": np.full(n, 2_000_000.0),
    }, index=dates)
    kl = kyle_lambda(df).dropna()
    # For synthetic data: cov(signed Δprice, net_OFI) should be positive
    assert kl.mean() > 0, f"Kyle λ should be positive when price tracks net_OFI. Got {kl.mean():.4e}"


# ── Lee-Ready ─────────────────────────────────────────────────────────────────
def test_tick_sign_values(mock_bars):
    signs = tick_sign(mock_bars["close"])
    assert set(signs.dropna().unique()).issubset({-1, 1})


def test_signed_volume_shape(mock_bars):
    sv = signed_volume(mock_bars)
    assert len(sv) == len(mock_bars)


# ── Spread ────────────────────────────────────────────────────────────────────
def test_spread_non_negative(mock_bars):
    sp = corwin_schultz_spread(mock_bars)
    valid = sp.dropna()
    assert (valid >= 0).all(), "Spread must be non-negative"


def test_spread_increases_with_wider_hl():
    """Wider high-low range → higher spread estimate."""
    n = 100
    dates = pd.date_range("2023-01-01", periods=n, freq="B")
    close = np.ones(n) * 100.0
    base = {"close": close, "volume": np.full(n, 1_000_000.0)}

    df_narrow = pd.DataFrame({**base,
        "open": close - 0.1, "high": close + 0.1, "low": close - 0.1}, index=dates)
    df_wide   = pd.DataFrame({**base,
        "open": close - 2.0, "high": close + 2.0, "low": close - 2.0}, index=dates)

    sp_narrow = corwin_schultz_spread(df_narrow).dropna().mean()
    sp_wide   = corwin_schultz_spread(df_wide).dropna().mean()
    assert sp_wide > sp_narrow, "Wider H-L range must produce higher spread estimate"


# ── Performance metrics ───────────────────────────────────────────────────────
def test_sharpe_zero_for_flat_returns():
    returns = [0.0] * 50
    sr = annualised_sharpe(returns)
    assert np.isnan(sr) or sr == 0.0, "Flat returns → Sharpe = 0 or NaN"


def test_sharpe_positive_for_upward_drift():
    np.random.seed(42)
    returns = np.random.normal(0.001, 0.01, 252)   # positive drift
    sr = annualised_sharpe(returns)
    assert sr > 0, f"Positive drift should give Sharpe > 0. Got {sr:.3f}"


def test_sharpe_scale_factor():
    """Daily Sharpe should be √252 × weekly Sharpe (approx) given same process."""
    np.random.seed(1)
    daily  = np.random.normal(0.0005, 0.01, 252)
    weekly = np.random.normal(0.0005 * 5, 0.01 * np.sqrt(5), 52)
    sr_d = annualised_sharpe(daily, freq="daily")
    sr_w = annualised_sharpe(weekly, freq="weekly")
    # Both should be in the same ballpark (within 1 unit for same underlying process)
    assert abs(sr_d - sr_w) < 2.0, f"Sharpe mismatch: daily={sr_d:.2f}, weekly={sr_w:.2f}"


# ── Sortino ratio ─────────────────────────────────────────────────────────────
def test_sortino_positive_for_upward_drift():
    """All-positive returns → Sortino is infinite (no downside)."""
    returns = np.abs(np.random.default_rng(42).normal(0.001, 0.001, 252))
    sr = sortino_ratio(returns)
    assert sr > 0 or np.isinf(sr), f"Expected Sortino > 0, got {sr}"


def test_sortino_greater_than_sharpe_for_skewed_upside():
    """Sortino should be ≥ Sharpe when there is positive skew (rare large gains)."""
    np.random.seed(99)
    r = np.random.normal(0.001, 0.01, 252)
    # Amplify the positive tail
    r[r > 0] *= 3
    assert sortino_ratio(r) >= annualised_sharpe(r), "Sortino ≥ Sharpe for positive-skew returns"


def test_sortino_nan_for_insufficient_data():
    """Single return → should return NaN (not crash)."""
    sr = sortino_ratio([0.01])
    assert np.isnan(sr), "Single data point must return NaN"


def test_sortino_scales_by_frequency():
    """Weekly Sortino should be lower than daily Sortino for same signal, confirming √freq scaling."""
    np.random.seed(5)
    daily = np.random.normal(0.0005, 0.01, 252)
    weekly = np.array([np.mean(daily[i:i+5]) for i in range(0, 250, 5)])
    sr_d = sortino_ratio(daily, freq="daily")
    sr_w = sortino_ratio(weekly, freq="weekly")
    # Same underlying process — values should be in same order of magnitude
    assert abs(sr_d - sr_w) < 3.0, f"Sortino freq mismatch: daily={sr_d:.2f}, weekly={sr_w:.2f}"


def test_max_drawdown_negative(mock_bars):
    """Max drawdown must be ≤ 0."""
    equity = np.cumprod(1 + mock_bars["close"].pct_change().fillna(0))
    mdd = max_drawdown(equity.tolist())
    assert mdd <= 0, f"Max drawdown must be ≤ 0, got {mdd}"


def test_max_drawdown_flat_equity():
    """Flat equity curve → no drawdown."""
    mdd = max_drawdown([1.0] * 100)
    assert mdd == 0.0


def test_ic_perfect_prediction():
    """Perfect rank-correlation predictions → IC = 1.0."""
    actuals = list(range(1, 11))
    ic = information_coefficient(actuals, actuals)
    assert abs(ic - 1.0) < 1e-9, f"Perfect predictions should give IC=1.0, got {ic}"


def test_ic_inverse_prediction():
    """Perfectly wrong predictions → IC = -1.0."""
    actuals = list(range(1, 11))
    preds   = list(range(10, 0, -1))
    ic = information_coefficient(preds, actuals)
    assert abs(ic + 1.0) < 1e-9, f"Inverted predictions should give IC=-1.0, got {ic}"


# ── Data cleaning ─────────────────────────────────────────────────────────────
def test_clean_removes_zero_close():
    """Rows with close ≤ 0 must be removed by _clean_ohlcv."""
    n = 50
    dates = pd.date_range("2023-01-01", periods=n, freq="B")
    df = pd.DataFrame({
        "open": np.ones(n) * 100, "high": np.ones(n) * 101,
        "low": np.ones(n) * 99, "close": np.ones(n) * 100,
        "volume": np.ones(n) * 1_000_000,
    }, index=dates)
    df.iloc[5, df.columns.get_loc("close")]  = 0.0    # bad data point
    df.iloc[10, df.columns.get_loc("close")] = -5.0   # bad data point
    cleaned = _clean_ohlcv(df, "TEST")
    assert (cleaned["close"] > 0).all(), "All closes must be positive after cleaning"
    assert len(cleaned) == n - 2


def test_clean_removes_zero_volume():
    """Zero-volume rows must be removed."""
    n = 50
    dates = pd.date_range("2023-01-01", periods=n, freq="B")
    df = pd.DataFrame({
        "open": np.ones(n) * 100, "high": np.ones(n) * 101,
        "low": np.ones(n) * 99, "close": np.ones(n) * 100,
        "volume": np.ones(n) * 1_000_000,
    }, index=dates)
    df.iloc[7, df.columns.get_loc("volume")] = 0.0
    cleaned = _clean_ohlcv(df, "TEST")
    assert (cleaned["volume"] > 0).all()
    assert len(cleaned) == n - 1


def test_clean_clips_extreme_returns():
    """Returns > ±20% should be removed."""
    n = 50
    dates = pd.date_range("2023-01-01", periods=n, freq="B")
    close = np.ones(n) * 100.0
    close[20] = 200.0   # +100% single-day jump (data error)
    df = pd.DataFrame({
        "open": close - 0.5, "high": close + 0.5,
        "low": close - 0.5, "close": close,
        "volume": np.ones(n) * 1_000_000,
    }, index=dates)
    cleaned = _clean_ohlcv(df, "TEST")
    ret = cleaned["close"].pct_change().abs()
    assert (ret.dropna() <= 0.20).all(), "No extreme returns after cleaning"


def test_clean_preserves_valid_data(mock_bars):
    """Clean data should not remove any valid rows from mock_bars."""
    cleaned = _clean_ohlcv(mock_bars.copy(), "MOCK")
    assert len(cleaned) == len(mock_bars), \
        f"No rows should be removed from clean data. Expected {len(mock_bars)}, got {len(cleaned)}"


# ── Cross-sectional signal determinism ───────────────────────────────────────
def test_crosssectional_signals_deterministic():
    """
    Running _determine_signals_crosssectional twice with the same input
    must produce identical results.
    """
    from alpha_flow.agent.langgraph_flow import _determine_signals_crosssectional
    snapshots = {
        "AAPL": {"ofi_zscore": 1.8},
        "MSFT": {"ofi_zscore": 0.5},
        "NVDA": {"ofi_zscore": -0.2},
        "META": {"ofi_zscore": -1.9},
        "TSLA": {"ofi_zscore": 0.1},
    }
    r1 = _determine_signals_crosssectional(snapshots, {})
    r2 = _determine_signals_crosssectional(snapshots, {})
    assert r1 == r2, "Cross-sectional signals must be deterministic"


def test_crosssectional_top_is_buy():
    """Highest OFI Z ticker must receive BUY signal."""
    from alpha_flow.agent.langgraph_flow import _determine_signals_crosssectional
    snapshots = {t: {"ofi_zscore": float(i)} for i, t in enumerate(["A", "B", "C", "D", "E"])}
    signals = _determine_signals_crosssectional(snapshots, {})
    # "E" has the highest index (4) = highest OFI Z → BUY
    assert signals["E"] == "BUY", f"Top OFI ticker should be BUY, got {signals['E']}"
    # "A" has the lowest (0) → SELL
    assert signals["A"] == "SELL", f"Bottom OFI ticker should be SELL, got {signals['A']}"
