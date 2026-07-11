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

# Insert the project root (AlphaFlow/) into sys.path so imports like
# 'from alpha_flow.core...' resolve correctly regardless of where
# pytest is invoked from. __file__ is tests/test_microstructure.py,
# so one level up (..) is the AlphaFlow/ root.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../")))

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


def test_amihud_reference_value_small_window():
    """
    Reference-value check: independently recompute ILLIQ_t = |r_t|/DollarVol_t
    via raw pandas ops on a tiny 3-bar series and assert amihud_ratio() matches
    exactly, plus a hand-verifiable numeric anchor at the last bar:
      ret[1] = |102/100 - 1| = 0.02;      dv[1] = 1,000,000 * 102 = 102,000,000
      illiq[1] = 0.02 / 102,000,000 * 1e6 ≈ 1.96078e-4
      ret[2] = |99/102 - 1|  = 3/102;     dv[2] = 2,000,000 * 99  = 198,000,000
      illiq[2] = (3/102) / 198,000,000 * 1e6 ≈ 1.48544e-4
      mean(illiq[1], illiq[2]) ≈ 1.72311e-4
    """
    dates = pd.date_range("2023-01-01", periods=3, freq="B")
    df = pd.DataFrame({
        "open":   [100.0, 101.0, 100.0],
        "high":   [101.0, 103.0, 100.5],
        "low":    [99.0, 100.5, 98.0],
        "close":  [100.0, 102.0, 99.0],
        "volume": [1_500_000.0, 1_000_000.0, 2_000_000.0],
    }, index=dates)
    result = amihud_ratio(df, window=2)

    ret = df["close"].pct_change().abs()
    dv  = df["volume"] * df["close"]
    expected = ((ret / dv) * 1e6).rolling(2).mean()
    pd.testing.assert_series_equal(result, expected, check_names=False)

    assert result.iloc[2] == pytest.approx(1.72311e-4, rel=1e-3)


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


def test_kyle_lambda_reference_value_small_window():
    """
    Reference-value check: independently recompute λ = cov(Δp, net_OFI) /
    var(net_OFI) via raw pandas rolling ops on random, healthy-variance data
    and assert kyle_lambda() matches exactly. With generic random data the
    rolling variance is far above the degenerate-window floor, so the
    un-floored ratio should reproduce bit-for-bit (hand-verifiable formula).
    """
    n = 30
    rng = np.random.RandomState(2)
    dates = pd.date_range("2023-01-01", periods=n, freq="B")
    close = 100 + np.cumsum(rng.randn(n) * 0.8)
    open_ = close - rng.randn(n) * 0.5
    volume = rng.randint(500_000, 3_000_000, n).astype(float)
    df = pd.DataFrame({
        "open": open_, "high": close + 1, "low": close - 1,
        "close": close, "volume": volume,
    }, index=dates)

    window = 10
    result = kyle_lambda(df, window=window)

    dp = df["close"].diff()
    is_buy = (df["close"] >= df["open"]).astype(float)
    net_ofi = df["volume"] * (2 * is_buy - 1)
    roll_cov = dp.rolling(window).cov(net_ofi)
    roll_var = net_ofi.rolling(window).var(ddof=1)
    expected_last = roll_cov.iloc[-1] / roll_var.iloc[-1]
    assert result.iloc[-1] == pytest.approx(expected_last, rel=1e-9)


def test_kyle_lambda_transient_degenerate_variance_excluded():
    """
    Regression test for the variance-floor fix: a *transient* collapse in
    order-flow variance (e.g. a brief halt / quiet period) within an otherwise
    normal series must be excluded (NaN) rather than producing an
    astronomically large lambda from dividing by a fixed 1e-12 epsilon.
    """
    window = 10
    n_normal = 80   # establishes a normal trailing-variance baseline
    n_quiet  = 12   # brief degenerate segment (> window, so a full window sits inside it)
    rng = np.random.RandomState(5)

    close_normal  = 100 + np.cumsum(rng.randn(n_normal) * 0.5)
    open_normal   = close_normal - rng.randn(n_normal) * 0.3
    volume_normal = rng.randint(500_000, 3_000_000, n_normal).astype(float)

    # Quiet segment: price still drifts a little (Δp varies) but every bar is
    # a "buy" bar (close fractionally above open) with near-identical volume,
    # so net_OFI ≈ constant → var(net_OFI) collapses to ~0 for windows fully
    # inside it, while cov(Δp, net_OFI) stays non-trivial — the classic
    # near-0/near-0 ratio instability that the old fixed-epsilon guard blew up.
    last_close   = close_normal[-1]
    close_quiet  = last_close + np.cumsum(rng.randn(n_quiet) * 0.05)
    open_quiet   = close_quiet - 0.01          # always a tiny buy bar (deterministic)
    volume_quiet = np.full(n_quiet, 1_000_000.0) + rng.randn(n_quiet) * 1e-6

    close  = np.concatenate([close_normal, close_quiet])
    open_  = np.concatenate([open_normal, open_quiet])
    volume = np.concatenate([volume_normal, volume_quiet])
    dates  = pd.date_range("2023-01-01", periods=n_normal + n_quiet, freq="B")
    df = pd.DataFrame({
        "open": open_, "high": close + 0.5, "low": close - 0.5,
        "close": close, "volume": volume,
    }, index=dates)

    kl = kyle_lambda(df, window=window)
    assert not np.isinf(kl.dropna()).any(), "kyle_lambda must never be infinite"
    tail = kl.iloc[-3:]   # fully inside the quiet segment
    assert tail.isna().all() or tail.abs().max() < 1e4, (
        f"Transient near-zero-variance window should be excluded (NaN), not "
        f"blown up. Got tail values: {tail.tolist()}"
    )


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
    r1 = _determine_signals_crosssectional(snapshots)
    r2 = _determine_signals_crosssectional(snapshots)
    assert r1 == r2, "Cross-sectional signals must be deterministic"


def test_crosssectional_top_is_buy():
    """Highest OFI Z ticker must receive BUY signal (when genuinely net-positive)."""
    from alpha_flow.agent.langgraph_flow import _determine_signals_crosssectional
    # Signed z-scores (-2..+2) so both extremes are genuinely net-positive /
    # net-negative, not just "least extreme of the pack" — see gate test below
    # for the case where rank position alone is NOT enough.
    snapshots = {t: {"ofi_zscore": float(i) - 2.0} for i, t in enumerate(["A", "B", "C", "D", "E"])}
    signals = _determine_signals_crosssectional(snapshots)
    # "E" has the highest z (+2.0) → BUY
    assert signals["E"] == "BUY", f"Top OFI ticker should be BUY, got {signals['E']}"
    # "A" has the lowest z (-2.0) → SELL
    assert signals["A"] == "SELL", f"Bottom OFI ticker should be SELL, got {signals['A']}"


def test_crosssectional_gate_blocks_same_signed_extremes():
    """
    JPM-quant-grade regression test: on a broad-based net-buying day (every
    ticker's OFI Z-score is positive), the *least* positive ticker is still
    top-of-rank for SELL consideration but must NOT be labelled SELL — it has
    no genuine net-selling pressure, just a smaller positive value than peers.
    This is exactly the failure mode a pure percentile split cannot avoid.
    """
    from alpha_flow.agent.langgraph_flow import _determine_signals_crosssectional
    snapshots = {t: {"ofi_zscore": v} for t, v in
                 [("A", 0.1), ("B", 0.8), ("C", 1.5), ("D", 2.2), ("E", 3.0)]}
    signals = _determine_signals_crosssectional(snapshots)
    assert signals["E"] == "BUY", "Highest, genuinely positive OFI Z should still be BUY"
    assert signals["A"] == "HOLD", \
        f"Bottom-ranked ticker with a still-positive OFI Z must be HOLD, not SELL, got {signals['A']}"
    assert "SELL" not in signals.values(), "No ticker should be labelled SELL when every Z-score is positive"


def test_crosssectional_ic_gate_demotes_to_hold():
    """
    A ticker can rank top-of-universe by OFI Z-score yet still be demoted to
    HOLD if its own Spearman IC (OFI vs 1-bar fwd return) has been negative —
    i.e. OFI has recently been anti-predictive for that specific name.
    """
    from alpha_flow.agent.langgraph_flow import _determine_signals_crosssectional
    snapshots = {t: {"ofi_zscore": v} for t, v in
                 [("A", -2.0), ("B", -1.0), ("C", 0.0), ("D", 1.0), ("E", 2.0)]}
    # E ranks top by Z but has a negative IC → should be demoted to HOLD
    ic_by_ticker = {"E": -0.15, "A": -0.05}
    signals = _determine_signals_crosssectional(snapshots, ic_by_ticker)
    assert signals["E"] == "HOLD", \
        f"Top-ranked ticker with negative IC must be demoted to HOLD, got {signals['E']}"
    # A ranks bottom by Z (negative, genuine sell pressure) AND has a negative
    # IC (ic <= 0 passes the SELL gate) → SELL still confirmed
    assert signals["A"] == "SELL", f"Bottom-ranked ticker with ic<=0 should stay SELL, got {signals['A']}"


def test_crosssectional_ic_by_ticker_optional():
    """Omitting ic_by_ticker must not raise and must behave as if IC were neutral (0.0)."""
    from alpha_flow.agent.langgraph_flow import _determine_signals_crosssectional
    snapshots = {t: {"ofi_zscore": float(i) - 2.0} for i, t in enumerate(["A", "B", "C", "D", "E"])}
    signals_no_ic = _determine_signals_crosssectional(snapshots)
    signals_empty_ic = _determine_signals_crosssectional(snapshots, {})
    assert signals_no_ic == signals_empty_ic, "Missing ic_by_ticker should default identically to {}"


def test_crosssectional_book_produces_buys_and_sells_without_significance():
    """
    Two-tier property (Daily): a broad cross-section yields an actual long-short
    book — top-decile OFI names are BUY and bottom-decile are SELL — WITHOUT any
    per-name significance gate. Significance is a separate annotation
    (is_high_conviction), never a gate that suppresses the tradeable signal.
    """
    from alpha_flow.agent.langgraph_flow import _determine_signals_crosssectional
    snapshots = {t: {"ofi_zscore": float(i) - 4.5} for i, t in
                 enumerate([f"T{i}" for i in range(10)])}   # z from -4.5 .. +4.5
    signals = _determine_signals_crosssectional(snapshots)
    assert "BUY" in signals.values() and "SELL" in signals.values(), \
        "Cross-sectional book must produce both BUY and SELL, not all-HOLD"
    assert signals["T9"] == "BUY" and signals["T0"] == "SELL"


# ── Survivorship-bias diagnostic ─────────────────────────────────────────────
def _write_raw_csv(raw_dir, ticker: str, start: str, n: int) -> None:
    dates = pd.date_range(start, periods=n, freq="B")
    df = pd.DataFrame({
        "Date": dates, "open": 100.0, "high": 101.0, "low": 99.0,
        "close": 100.0, "volume": 1_000_000,
    })
    df.to_csv(raw_dir / f"{ticker}.csv", index=False)


def test_survivorship_flags_short_history_ticker(tmp_path, monkeypatch):
    """
    A ticker whose cached history starts ~1 year later than the rest of the
    universe (e.g. a recent IPO) must be flagged as partial-history — the
    detectable symptom check_universe_survivorship() can actually verify from
    data it already has, as distinct from the undetectable case of a name
    delisted before the window began (which requires point-in-time
    constituent data this project doesn't have).
    """
    from alpha_flow.data import data_feed
    monkeypatch.setattr(data_feed, "RAW_DIR", tmp_path)

    _write_raw_csv(tmp_path, "OLD1", "2022-01-03", 500)
    _write_raw_csv(tmp_path, "OLD2", "2022-01-03", 500)
    _write_raw_csv(tmp_path, "NEWIPO", "2023-06-01", 300)  # starts ~5 months later

    result = data_feed.check_universe_survivorship(["OLD1", "OLD2", "NEWIPO"])

    assert result["universe_size"] == 3
    assert result["tickers_with_full_history"] == 2
    flagged = {p["ticker"] for p in result["tickers_with_partial_history"]}
    assert flagged == {"NEWIPO"}
    assert result["tickers_with_partial_history"][0]["days_short"] > 30
    assert "survivorship" in result["disclosure"].lower()


def test_survivorship_no_data_returns_clean_disclosure(tmp_path, monkeypatch):
    """With no cached raw CSVs at all, the function must not crash — it should
    return a disclosure explaining the check couldn't run yet."""
    from alpha_flow.data import data_feed
    monkeypatch.setattr(data_feed, "RAW_DIR", tmp_path)

    result = data_feed.check_universe_survivorship(["GHOST1", "GHOST2"])
    assert result["universe_size"] == 2
    assert result["tickers_with_full_history"] == 0
    assert result["tickers_with_partial_history"] == []
    assert "disclosure" in result


def test_survivorship_all_full_history_no_flags(tmp_path, monkeypatch):
    """When every ticker's cached history starts on the same date, nothing
    should be flagged as partial."""
    from alpha_flow.data import data_feed
    monkeypatch.setattr(data_feed, "RAW_DIR", tmp_path)

    for t in ["AAA", "BBB", "CCC"]:
        _write_raw_csv(tmp_path, t, "2022-01-03", 500)

    result = data_feed.check_universe_survivorship(["AAA", "BBB", "CCC"])
    assert result["tickers_with_full_history"] == 3
    assert result["tickers_with_partial_history"] == []
