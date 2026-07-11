"""
tests/test_portfolio_engine.py
Regression tests for alpha_flow.analysis.portfolio_engine.build_longshort_portfolio().

Context: an earlier version of this module computed `pnl_contribution_pct` by
normalising each leg's return by the PORTFOLIO's net return (a "% of total"
attribution) — a formula that blows up toward +-inf whenever the long/short
legs happen to net out near zero (a real historical bug: one run showed
+250% for a single position). The fix (see portfolio_engine.py, _contrib_pct)
instead reports percentage POINTS of each leg's own cumulative return divided
by leg size (n_long/n_short) — a constant denominator that can never blow up.

This bug class previously had ZERO persisted regression coverage — the
verification used to confirm the original fix was a throwaway script, never
committed to tests/. This file closes that gap.

Run:
    pytest tests/test_portfolio_engine.py -v
"""
from __future__ import annotations

import numpy as np
import sys
import os

# ─── Add project root to path so imports resolve ─────────────────────────────
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from alpha_flow.analysis.portfolio_engine import build_longshort_portfolio


def _make_card(ticker: str, mean_ic: float, returns: np.ndarray, cs_spread: float = 0.0004) -> dict:
    """Build a synthetic signal card with a cumulative equity curve from a return path."""
    equity_curve = np.cumprod(1.0 + returns)
    equity_curve = np.concatenate([[1.0], equity_curve])  # prepend starting value of 1.0
    return {
        "ticker": ticker,
        "mean_ic": mean_ic,
        "equity_curve": equity_curve.tolist(),
        "last_features": {"cs_spread": cs_spread},
        "test_bars": 105,
    }


def _returns(seed: int, n: int, drift: float, std: float = 0.001) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return rng.normal(drift, std, n)


# ─── TEST 1: reference-value check ────────────────────────────────────────
def test_pnl_contribution_matches_manual_calc():
    """
    Test 1: pnl_contribution_pct for each leg matches a direct manual
    calculation from the SAME formula the source uses
    (100 * sum(returns) / leg_size) — a reference-value check, not just a
    bound check.
    """
    n = 200
    long_returns = {
        "AAA": _returns(1, n, 0.0015),
        "BBB": _returns(2, n, 0.0012),
        "CCC": _returns(3, n, 0.0010),
    }
    short_returns = {
        "XXX": _returns(4, n, -0.0015),
        "YYY": _returns(5, n, -0.0012),
        "ZZZ": _returns(6, n, -0.0010),
    }
    cards = (
        [_make_card(t, 0.08, r) for t, r in long_returns.items()]
        + [_make_card(t, -0.08, r) for t, r in short_returns.items()]
    )

    result = build_longshort_portfolio(cards, n_long=3, n_short=3)

    assert "error" not in result, f"unexpected error: {result.get('error')}"
    assert len(result["position_detail"]) == 6

    by_ticker = {p["ticker"]: p for p in result["position_detail"]}
    min_len = result["n_bars"]

    for t, r in long_returns.items():
        expected = round(100 * float(np.sum(r[:min_len])) / 3, 2)
        assert by_ticker[t]["side"] == "LONG"
        assert abs(by_ticker[t]["pnl_contribution_pct"] - expected) < 0.05, (
            f"{t}: expected {expected}, got {by_ticker[t]['pnl_contribution_pct']}"
        )
    for t, r in short_returns.items():
        expected = round(-100 * float(np.sum(r[:min_len])) / 3, 2)
        assert by_ticker[t]["side"] == "SHORT"
        assert abs(by_ticker[t]["pnl_contribution_pct"] - expected) < 0.05, (
            f"{t}: expected {expected}, got {by_ticker[t]['pnl_contribution_pct']}"
        )


# ─── TEST 2: contributions sum to the additive portfolio return ─────────
def test_pnl_contributions_sum_to_gross_return():
    """
    Test 2: the 6 position_detail contributions should sum EXACTLY to
    100 * sum(long_mean - short_mean) — the additive bar-by-bar portfolio
    return the source computes internally. This is the true invariant the
    code guarantees.

    Note: this is deliberately checked against the additive sum, NOT against
    `gross_equity[-1] - 1` (a COMPOUNDED/multiplicative quantity). The two
    only converge for small cumulative returns — compounding vs. additive
    sums diverge materially once total return departs from ~0 (e.g. ~64%
    compounded vs. ~49% additive was observed for a large synthetic drift
    during test-writing). See the softened wording in portfolio_engine.py's
    docstring comment, fixed alongside this test.
    """
    n = 300
    long_data  = [(f"L{i}", 0.05 + i * 0.01, _returns(10 + i, n, 0.0008)) for i in range(3)]
    short_data = [(f"S{i}", -0.05 - i * 0.01, _returns(20 + i, n, -0.0008)) for i in range(3)]
    cards = [_make_card(t, ic, r) for t, ic, r in long_data] + [_make_card(t, ic, r) for t, ic, r in short_data]

    result = build_longshort_portfolio(cards, n_long=3, n_short=3)
    assert "error" not in result

    total_contrib_pct = sum(p["pnl_contribution_pct"] for p in result["position_detail"])

    min_len    = result["n_bars"]
    long_mean  = np.mean([r[:min_len] for _, _, r in long_data], axis=0)
    short_mean = np.mean([r[:min_len] for _, _, r in short_data], axis=0)
    expected_total_pct = 100 * float(np.sum(long_mean - short_mean))

    assert abs(total_contrib_pct - expected_total_pct) < 0.1, (
        f"sum(contributions)={total_contrib_pct:.2f}% vs expected={expected_total_pct:.2f}%"
    )


# ─── TEST 3: near-zero net return does not blow up attribution (regression) ──
def test_pnl_contribution_bounded_when_net_return_near_zero():
    """
    Test 3 (regression guard): construct long/short legs whose returns are
    nearly mirror images of each other, so the PORTFOLIO's net return is
    close to zero — the exact condition that made the OLD "% of total"
    attribution formula explode toward +-inf. The current formula divides by
    the constant leg size (n_long/n_short), not by the portfolio's net
    return, so contributions must stay bounded regardless of how close to
    zero the net portfolio return is.
    """
    n = 250
    rng = np.random.default_rng(42)
    shared_shape = rng.normal(0, 0.003, n)  # both legs move almost identically

    cards = (
        [_make_card(f"L{i}", 0.01, shared_shape + rng.normal(0, 0.00001, n)) for i in range(3)]
        + [_make_card(f"S{i}", -0.01, shared_shape + rng.normal(0, 0.00001, n)) for i in range(3)]
    )

    result = build_longshort_portfolio(cards, n_long=3, n_short=3)
    assert "error" not in result

    # Portfolio net return should indeed be tiny (long and short legs nearly cancel)
    assert abs(result["gross_equity"][-1] - 1.0) < 0.5

    for p in result["position_detail"]:
        assert abs(p["pnl_contribution_pct"]) < 100, (
            f"{p['ticker']} contribution blew up to {p['pnl_contribution_pct']}% "
            "— the near-zero-net-return attribution bug may have regressed"
        )


# ─── TEST 4: insufficient data returns a clean error, not a crash ────────
def test_insufficient_cards_returns_error():
    """Test 4: fewer than n_long+n_short valid cards -> clean error dict, no exception."""
    cards = [_make_card("AAA", 0.05, _returns(1, 60, 0.001))]
    result = build_longshort_portfolio(cards, n_long=3, n_short=3)
    assert "error" in result
