"""
alpha_flow/analysis/signal_classification.py

Shared cross-sectional signal classification logic — used by BOTH:
  - Daily resolution's  _determine_signals_crosssectional (agent/langgraph_flow.py)
  - Hourly resolution's _build_intraday_cards            (backend/main.py)

Extracted into one module so both resolutions share IDENTICAL classification
mechanics (rank candidacy, absolute-IC candidacy, FDR significance) driven by
the same settings.py constants (SIGNAL_RANK_FRACTION, SIGNAL_SIGNIFICANCE_ALPHA,
SIGNAL_ABS_IC_THRESHOLD) — previously this logic was duplicated independently
in both files, which is exactly how the two resolutions drifted apart before
(tercile vs. 20% rank, gated vs. ungated absolute threshold, etc).

Two-TIER design — TRADEABLE SIGNAL + CONVICTION FLAG:

  Tier 1 — the tradeable cross-sectional book (`classify_signal`):
    A name is BUY if it ranks in the top SIGNAL_RANK_FRACTION of today's
    cross-section (or has an outright large |signal|) AND is sign-consistent;
    SELL symmetrically; otherwise HOLD. This is a standard systematic
    long-short construction (AQR / Two Sigma): go long the top decile and short
    the bottom decile. It does NOT require each name to be individually
    statistically significant — a cross-sectional book monetises the *rank
    spread* (does the top beat the bottom on average?), which can have real
    net-of-cost edge even when no single name clears a significance test.

  Tier 2 — high-conviction flag (`is_high_conviction`):
    Whether the name's own IC *also* survives Benjamini-Hochberg FDR correction
    across the whole cross-section this run. On free OHLCV this is rare (weak
    per-name IC), so it marks the small subset of genuinely significant names —
    an annotation, NOT a gate on the tradeable signal.

Why the split: gating the tradeable signal on per-name FDR made EVERY name HOLD
on free data (no single name is individually significant after correcting for
50 simultaneous tests) — which is the correct answer to "is THIS name real?"
but the wrong construction for a tradeable long-short book. Separating the two
lets the dashboard show an actual book (BUY/SELL) while still reporting, and
never overstating, statistical significance.

See RESEARCH.md §3.6 for the full design rationale and worked examples.
"""


def benjamini_hochberg_threshold(pvalues: list[float], q: float) -> float:
    """Benjamini-Hochberg (1995) false-discovery-rate threshold.

    Given the p-values from every hypothesis test in a batch (here: one
    per-ticker "is this IC significantly non-zero?" test) and a target false
    discovery rate `q`, return the largest p-value that survives correction.
    Any ticker with `ic_pvalue <= threshold` is confirmed; every other
    candidate falls back to HOLD.

    Why not a flat `p < q` cutoff per ticker: testing m tickers independently
    at p<q each risks ~m×q false "confirms" from chance alone even when none
    of them have real signal (e.g. 50 tickers × 0.10 ≈ 5 expected false
    positives per run — the "look-elsewhere effect"). BH controls the
    *expected proportion* of false discoveries across the whole batch instead
    of the per-ticker fluke rate, without assuming the tests are independent
    (Bonferroni's assumption — false here, since cross-sectional equity
    returns move together).

    Procedure: sort p-values ascending p(1) <= ... <= p(m); find the largest
    k where p(k) <= (k / m) * q; every ticker with p <= p(k) is confirmed.
    """
    m = len(pvalues)
    if m == 0:
        return 0.0
    ordered = sorted(pvalues)
    threshold = 0.0
    for k, p in enumerate(ordered, start=1):
        if p <= (k / m) * q:
            threshold = p
    return threshold


def adaptive_rank_sets(
    values: dict[str, float], fraction: float, z_min: float = 0.5
) -> tuple[set[str], set[str]]:
    """
    Adaptive cross-sectional book membership — returns (buy_set, sell_set).

    A name joins the long (short) book only if it is BOTH:
      (1) within the top (bottom) `fraction` of the cross-section by value, AND
      (2) at least `z_min` cross-sectional standard deviations above (below)
          the cross-sectional mean.

    Condition (2) is what makes the book ADAPTIVE rather than a mechanically
    fixed decile count: when the extremes are barely separated from the pack
    (a weak / flat cross-section) few or zero names clear the z_min hurdle, so
    the strategy trades less; when there is genuine dispersion, up to the
    `fraction` cap trade. A cross-section with no dispersion trades nothing.

    This directly answers the critique "why is it always exactly 10 long /
    10 short regardless of signal strength?" — the count now reflects how much
    tradeable separation actually exists in the cross-section each run.
    """
    n = len(values)
    if n == 0:
        return set(), set()
    vals = list(values.values())
    mu = sum(vals) / n
    var = sum((v - mu) ** 2 for v in vals) / n
    sd = var ** 0.5
    if sd <= 1e-12:
        return set(), set()  # flat cross-section → no separation → no book
    ordered = sorted(values, key=lambda t: values[t], reverse=True)
    cap = max(1, round(n * fraction))
    buy = {t for t in ordered[:cap] if (values[t] - mu) / sd >= z_min}
    sell = {t for t in ordered[n - cap:] if (values[t] - mu) / sd <= -z_min}
    return buy, sell


def classify_signal(
    signal_value: float,
    in_buy_rank: bool,
    in_sell_rank: bool,
    sign_ok_buy: bool,
    sign_ok_sell: bool,
    abs_threshold: float,
) -> str:
    """
    Tier-1 tradeable BUY/SELL/HOLD decision shared by Daily and Hourly.

    A name is a BUY candidate if it ranks in the top SIGNAL_RANK_FRACTION of
    today's cross-section (`in_buy_rank`) OR its directional signal is outright
    strong (`signal_value > abs_threshold`); SELL symmetrically. A candidate is
    confirmed when it is also sign-consistent (`sign_ok_buy`/`sign_ok_sell`,
    resolution-specific — see callers). This yields a standard long-short book
    (long top decile / short bottom decile).

    `signal_value` is the DIRECTIONAL ranking signal (Daily: OFI z-score;
    Hourly: the direction-corrected latest predicted return, `latest_signal`) —
    NOT the IC, which measures skill, not direction. Statistical significance is
    handled separately by `is_high_conviction`; it is intentionally NOT a gate
    here (see module docstring).
    """
    is_candidate_buy = in_buy_rank or signal_value > abs_threshold
    is_candidate_sell = in_sell_rank or signal_value < -abs_threshold

    if is_candidate_buy and sign_ok_buy:
        return "BUY"
    if is_candidate_sell and sign_ok_sell:
        return "SELL"
    return "HOLD"


def is_high_conviction(ic_pvalue: float, fdr_threshold: float) -> bool:
    """
    Tier-2 flag: does this name's IC survive Benjamini-Hochberg FDR correction
    across the whole cross-section this run? `fdr_threshold` is precomputed once
    per run via `benjamini_hochberg_threshold`. This is an annotation on a
    tradeable signal, never a gate that suppresses it.
    """
    return ic_pvalue <= fdr_threshold
