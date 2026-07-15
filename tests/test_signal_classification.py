"""
tests/test_signal_classification.py

Direct unit tests for the shared classification primitives in
`alpha_flow/analysis/signal_classification.py` — used by BOTH Daily
(`_determine_signals_crosssectional`, agent/langgraph_flow.py) and Hourly
(`_build_intraday_cards`, backend/main.py).

Two-tier design under test:
  - `classify_signal`   → Tier-1 tradeable BUY/SELL/HOLD (rank + sign, no
                          significance gate).
  - `is_high_conviction`→ Tier-2 annotation (BH-FDR significance), never a gate.

Run:
    pytest tests/test_signal_classification.py -v
"""
from __future__ import annotations

import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from alpha_flow.analysis.signal_classification import (
    benjamini_hochberg_threshold,
    classify_signal,
    is_high_conviction,
    adaptive_rank_sets,
)


# ── adaptive_rank_sets: adaptive cross-sectional book ─────────────────────────
def test_adaptive_book_shrinks_when_mass_is_clustered():
    """A peaked cross-section (one outlier, the rest clustered) trades FEWER than
    the fraction cap: the fraction would admit 2 per side, but only names truly
    separated from the pack (≥ z_min σ) qualify. Demonstrates adaptivity —
    the z-score gate is scale-invariant, so it trims by distribution shape."""
    vals = {f"T{i}": 0.0 for i in range(9)}
    vals["OUT"] = 10.0                       # lone positive outlier pulls the mean up
    buy, sell = adaptive_rank_sets(vals, fraction=0.20, z_min=0.5)  # cap = round(10*0.2)=2
    assert buy == {"OUT"}                     # only the outlier clears z_min, not the 2nd-ranked
    assert len(sell) == 0                     # clustered zeros sit ~−0.33σ, none clear −z_min


def test_adaptive_book_trades_when_dispersed():
    """A dispersed cross-section with clear extremes produces a book, capped at the fraction."""
    vals = {f"T{i}": float(i) for i in range(10)}  # 0..9, well separated
    buy, sell = adaptive_rank_sets(vals, fraction=0.20, z_min=0.5)
    assert "T9" in buy and "T0" in sell
    assert len(buy) <= 2 and len(sell) <= 2       # fraction cap = round(10*0.2)=2


def test_adaptive_book_respects_fraction_cap():
    vals = {f"T{i}": float(i) for i in range(100)}
    buy, sell = adaptive_rank_sets(vals, fraction=0.20, z_min=0.0)
    assert len(buy) == 20 and len(sell) == 20     # z_min=0 → pure fraction


def test_adaptive_book_no_dispersion_returns_empty():
    same = {f"T{i}": 5.0 for i in range(8)}
    assert adaptive_rank_sets(same, 0.2, 0.5) == (set(), set())


def test_adaptive_book_empty_input():
    assert adaptive_rank_sets({}, 0.2, 0.5) == (set(), set())


# ── classify_signal: Tier-1 tradeable book ───────────────────────────────────
def test_rank_buy_candidate_sign_consistent_is_buy():
    """A top-rank name with a sign-consistent signal is a BUY (no significance needed)."""
    assert classify_signal(
        signal_value=0.8, in_buy_rank=True, in_sell_rank=False,
        sign_ok_buy=True, sign_ok_sell=False, abs_threshold=float("inf"),
    ) == "BUY"


def test_rank_sell_candidate_sign_consistent_is_sell():
    """Symmetric SELL: bottom-rank + sign-consistent."""
    assert classify_signal(
        signal_value=-0.8, in_buy_rank=False, in_sell_rank=True,
        sign_ok_buy=False, sign_ok_sell=True, abs_threshold=float("inf"),
    ) == "SELL"


def test_buy_fires_without_significance():
    """
    Core two-tier property: a rank candidate becomes BUY even though no
    significance/FDR information is involved at all — the tradeable book is
    the rank spread, not per-name significance.
    """
    assert classify_signal(
        signal_value=0.3, in_buy_rank=True, in_sell_rank=False,
        sign_ok_buy=True, sign_ok_sell=False, abs_threshold=float("inf"),
    ) == "BUY"


def test_abs_threshold_bypass_makes_candidate():
    """A name outside the rank cutoff but with |signal| > abs_threshold is a candidate."""
    assert classify_signal(
        signal_value=0.09, in_buy_rank=False, in_sell_rank=False,
        sign_ok_buy=True, sign_ok_sell=False, abs_threshold=0.05,
    ) == "BUY"


def test_signal_exactly_at_abs_threshold_is_not_bypass():
    """signal_value == abs_threshold (not strictly greater) must NOT trigger the bypass."""
    assert classify_signal(
        signal_value=0.05, in_buy_rank=False, in_sell_rank=False,
        sign_ok_buy=True, sign_ok_sell=False, abs_threshold=0.05,
    ) == "HOLD"


def test_rank_candidate_blocked_by_sign_inconsistency():
    """A rank candidate whose sign-consistency check fails is demoted to HOLD."""
    assert classify_signal(
        signal_value=0.8, in_buy_rank=True, in_sell_rank=False,
        sign_ok_buy=False, sign_ok_sell=False, abs_threshold=float("inf"),
    ) == "HOLD"


def test_non_candidate_stays_hold():
    """Neither rank nor abs-threshold candidate → HOLD regardless of sign flags."""
    assert classify_signal(
        signal_value=0.01, in_buy_rank=False, in_sell_rank=False,
        sign_ok_buy=True, sign_ok_sell=True, abs_threshold=0.05,
    ) == "HOLD"


# ── is_high_conviction: Tier-2 annotation ────────────────────────────────────
def test_high_conviction_true_when_pvalue_within_threshold():
    assert is_high_conviction(ic_pvalue=0.01, fdr_threshold=0.05) is True


def test_high_conviction_false_when_pvalue_above_threshold():
    assert is_high_conviction(ic_pvalue=0.20, fdr_threshold=0.05) is False


def test_high_conviction_inclusive_boundary():
    """ic_pvalue == fdr_threshold counts as high-conviction (inclusive)."""
    assert is_high_conviction(ic_pvalue=0.05, fdr_threshold=0.05) is True


def test_buy_can_be_low_conviction():
    """
    The whole point of the split: a name can be a tradeable BUY while NOT being
    high-conviction (its IC doesn't survive multiple-testing correction).
    """
    sig = classify_signal(
        signal_value=0.9, in_buy_rank=True, in_sell_rank=False,
        sign_ok_buy=True, sign_ok_sell=False, abs_threshold=float("inf"),
    )
    conv = is_high_conviction(ic_pvalue=0.30, fdr_threshold=0.002)
    assert sig == "BUY" and conv is False


# ── benjamini_hochberg_threshold ─────────────────────────────────────────────
def test_bh_threshold_empty_input_is_zero():
    assert benjamini_hochberg_threshold([], q=0.10) == 0.0


def test_bh_threshold_rejects_all_when_none_significant():
    """50 tests where the best p-value (0.011) still exceeds (1/50)*0.10=0.002 → threshold 0."""
    pvals = [0.011, 0.018, 0.03, 0.07] + [0.5] * 46
    assert benjamini_hochberg_threshold(pvals, q=0.10) == 0.0


def test_bh_threshold_accepts_strong_signal():
    """A very small p-value in a small batch survives BH correction."""
    pvals = [0.001, 0.5, 0.6]
    thr = benjamini_hochberg_threshold(pvals, q=0.10)
    assert thr >= 0.001
