"""
analysis/portfolio_engine.py
Cross-sectional long-short portfolio construction + CAPM alpha decomposition.

Converts per-ticker walk-forward equity curves into a combined multi-stock portfolio:
  - Long  top-N tickers by mean IC  (highest positive predictive power)
  - Short bottom-N tickers by mean IC (worst predictors, traded in reverse)
  - Transaction cost model: half-spread (Corwin-Schultz) at each monthly rebalance
  - CAPM alpha: r_portfolio = α + β×r_SPY + ε  (OLS, SPY via yfinance)

Reference: Grinold & Kahn (2000) Active Portfolio Management, Ch.6-7
"""
from __future__ import annotations

import numpy as np
from scipy import stats as scipy_stats


def build_longshort_portfolio(
    cards: list[dict],
    n_long: int = 3,
    n_short: int = 3,
) -> dict:
    """
    Construct cross-sectional long-short portfolio from walk-forward signal cards.

    Args:
        cards:   List of intraday signal cards (from get_intraday_signals_db).
                 Each card must have 'equity_curve' (list of cumulative PnL values),
                 'mean_ic' (float), and optionally 'last_features' (dict with 'cs_spread').
        n_long:  Number of tickers to hold long (highest IC tickers).
        n_short: Number of tickers to hold short (lowest IC tickers).

    Returns:
        dict containing:
          gross_equity / net_equity: cumulative PnL lists (start at 1.0)
          long_tickers / short_tickers: which tickers are held each direction
          gross_sharpe / net_sharpe: annualised Sharpe ratios
          net_max_drawdown / net_calmar: drawdown-based risk metrics
          hit_rate / profit_factor: trade quality metrics
          portfolio_ic: combined directional IC of the basket
          avg_cost_bps: average half-spread cost per rebalance
          n_rebalances: total number of portfolio rebalances in the OOS period
    """
    # Filter to cards that have an equity curve
    valid = [
        c for c in cards
        if c.get("equity_curve") and len(c.get("equity_curve", [])) > 10
    ]

    if len(valid) < n_long + n_short:
        return {
            "error": (
                f"Need ≥{n_long + n_short} tickers with equity data; "
                f"found {len(valid)}. Run the Signal Engine first."
            )
        }

    # Sort by IC descending: longs = highest IC, shorts = lowest IC
    valid.sort(key=lambda c: c.get("mean_ic", 0.0), reverse=True)
    longs  = valid[:n_long]
    shorts = valid[-n_short:]

    def _to_returns(curve: list[float]) -> np.ndarray:
        """Convert cumulative equity curve (starts at ~1.0) to simple bar returns."""
        arr = np.array(curve, dtype=float)
        arr = np.maximum(arr, 1e-10)
        return np.diff(arr) / arr[:-1]

    long_rets  = [_to_returns(c["equity_curve"]) for c in longs]
    short_rets = [_to_returns(c["equity_curve"]) for c in shorts]

    # Align all curves to the minimum available length
    min_len = min(len(r) for r in long_rets + short_rets)
    if min_len < 50:
        return {"error": "Equity curves too short. Run the Signal Engine first."}

    long_rets  = [r[:min_len] for r in long_rets]
    short_rets = [r[:min_len] for r in short_rets]

    long_mean  = np.mean(long_rets,  axis=0)  # equal-weight long leg returns
    short_mean = np.mean(short_rets, axis=0)  # equal-weight short leg returns

    # Portfolio return = long leg PnL − short leg PnL
    # (going short means we earn the negative of the short tickers' returns)
    portfolio_returns = long_mean - short_mean

    # ── Transaction Cost Model ────────────────────────────────────────────────
    # Cost per rebalance = avg half-spread across all traded tickers.
    # Rebalance frequency = test_bars (default 105h ≈ 1 month of hourly bars).
    test_bars = int(cards[0].get("test_bars", 105)) if cards else 105

    spreads = []
    for c in longs + shorts:
        lf = c.get("last_features") or {}
        sp = lf.get("cs_spread", 0.0) or 0.0
        if sp > 0:
            spreads.append(float(sp))
    avg_half_spread = float(np.mean(spreads)) if spreads else 0.0005  # fallback 5 bps

    # Apply cost only at fold boundaries (rebalance dates)
    cost_series = np.zeros(min_len)
    for i in range(0, min_len, test_bars):
        # Round-trip half-spread on net 1-unit notional (1 long + 1 short)
        cost_series[i] = avg_half_spread

    net_returns = portfolio_returns - cost_series[:min_len]

    # ── Cumulative Equity Curves ──────────────────────────────────────────────
    gross_equity = np.cumprod(1.0 + np.clip(portfolio_returns, -0.5, 0.5))
    net_equity   = np.cumprod(1.0 + np.clip(net_returns, -0.5, 0.5))

    # ── Risk / Performance Metrics ────────────────────────────────────────────
    hourly_scale = 252 * 6.5  # ~1,638 trading hours per year

    gross_sharpe = float(
        np.mean(portfolio_returns) / (np.std(portfolio_returns) + 1e-10) * np.sqrt(hourly_scale)
    )
    net_sharpe = float(
        np.mean(net_returns) / (np.std(net_returns) + 1e-10) * np.sqrt(hourly_scale)
    )

    # Max drawdown (net equity curve)
    peak    = np.maximum.accumulate(net_equity)
    dd      = (net_equity - peak) / np.where(peak < 1e-10, 1e-12, peak)
    net_mdd = float(dd.min())

    # Calmar ratio (net annualised return / |max drawdown|)
    net_ann_return = float(np.mean(net_returns)) * hourly_scale
    net_calmar     = net_ann_return / abs(net_mdd) if abs(net_mdd) > 1e-10 else 0.0

    # Hit rate (% of bars portfolio was profitable, gross)
    hit_rate = float(np.mean(portfolio_returns > 0))

    # Gross profit factor
    wins   = float(portfolio_returns[portfolio_returns > 0].sum())
    losses = float(abs(portfolio_returns[portfolio_returns < 0].sum()))
    profit_factor = round(wins / losses, 4) if losses > 1e-10 else 9.99

    # Portfolio composite IC (mean of long ICs + mean |IC| of short legs)
    long_ics  = [c.get("mean_ic", 0.0) for c in longs]
    short_ics = [c.get("mean_ic", 0.0) for c in shorts]
    portfolio_ic = float(
        (np.mean(long_ics) + np.mean([abs(ic) for ic in short_ics])) / 2
    )

    # ── Per-Ticker Position Detail (PnL attribution) ──────────────────────────
    # Linear attribution: each leg contributes its equal-weighted share of
    # portfolio_returns bar-by-bar (long_mean = mean(long_rets), short_mean =
    # mean(short_rets), portfolio_returns = long_mean − short_mean). Reported
    # in percentage POINTS of cumulative gross return, NOT normalised by
    # total gross return — by construction the 6 legs' contributions sum
    # EXACTLY to 100×sum(portfolio_returns), the ADDITIVE bar-by-bar total.
    # Note this differs slightly from `gross_equity[-1] − 1` (a COMPOUNDED/
    # multiplicative quantity) once cumulative returns depart materially
    # from zero — the two only coincide closely for small returns, which is
    # the realistic regime for this strategy's per-fold OOS performance.
    # (Normalising by total gross return instead would explode toward ±∞
    # whenever the long/short legs' moves happen to net out near zero — a
    # known pitfall of "% of total return" attribution — producing
    # misleading figures such as +250% for a single position.)
    # `ic_rank` = 1-based rank in the full cross-sectional IC ordering
    # (1 = highest IC of all candidates).
    def _contrib_pct(x: float) -> float:
        return round(x * 100, 2)

    position_detail = [
        {
            "ticker": c["ticker"], "side": "LONG",
            "weight": round(1.0 / n_long, 4),
            "mean_ic": round(c.get("mean_ic", 0.0), 4),
            "ic_rank": valid.index(c) + 1,
            "pnl_contribution_pct": _contrib_pct(float(np.sum(r)) / n_long),
        }
        for c, r in zip(longs, long_rets)
    ] + [
        {
            "ticker": c["ticker"], "side": "SHORT",
            "weight": round(1.0 / n_short, 4),
            "mean_ic": round(c.get("mean_ic", 0.0), 4),
            "ic_rank": valid.index(c) + 1,
            "pnl_contribution_pct": _contrib_pct(-float(np.sum(r)) / n_short),
        }
        for c, r in zip(shorts, short_rets)
    ]

    # ── Shared equity_dates for chronological x-axis (best-effort) ────────────
    # Sourced from the first constituent card that has a long-enough
    # equity_dates array (added alongside equity_curve — absent on cards
    # persisted before this field existed). diff()/truncation above means
    # gross_equity[k] corresponds to the ORIGINAL card's date at index k+1,
    # so we slice [1 : min_len+1] to stay aligned with the equity arrays.
    _dates_source = next(
        (c.get("equity_dates") for c in longs + shorts
         if c.get("equity_dates") and len(c["equity_dates"]) >= min_len + 1),
        None,
    )
    equity_dates = _dates_source[1:min_len + 1] if _dates_source else []

    return {
        "gross_equity":     [round(float(v), 6) for v in gross_equity.tolist()],
        "net_equity":       [round(float(v), 6) for v in net_equity.tolist()],
        "equity_dates":     equity_dates,
        "long_tickers":     [c["ticker"] for c in longs],
        "short_tickers":    [c["ticker"] for c in shorts],
        "long_ics":         [round(ic, 4) for ic in long_ics],
        "short_ics":        [round(ic, 4) for ic in short_ics],
        "position_detail":  position_detail,
        "gross_sharpe":     round(gross_sharpe, 4),
        "net_sharpe":       round(net_sharpe, 4),
        "net_max_drawdown": round(net_mdd, 4),
        "net_calmar":       round(net_calmar, 4),
        "hit_rate":         round(hit_rate, 4),
        "profit_factor":    round(min(profit_factor, 9.99), 4),
        "portfolio_ic":     round(portfolio_ic, 6),
        "avg_cost_bps":     round(avg_half_spread * 10_000, 2),
        "n_rebalances":     int(min_len // test_bars),
        "n_long":           n_long,
        "n_short":          n_short,
        "n_bars":           min_len,
    }


def compute_capm_alpha(
    portfolio_equity: list[float],
    data_start: str | None = None,
) -> dict:
    """
    Estimate CAPM market-adjusted alpha via OLS regression:
        r_portfolio_daily = α + β × r_SPY_daily + ε

    Steps:
      1. Convert hourly portfolio equity → daily returns (sum 6 hourly bars)
      2. Fetch SPY 2-year daily returns via yfinance
      3. Align lengths (take tail of SPY to match portfolio OOS period)
      4. OLS regression → α, β, R², t-stat(α), p-val(α)
      5. Annualise α: α_annual = α_daily × 252

    Args:
        portfolio_equity: Gross cumulative equity curve (list of hourly floats, starts ~1.0)
        data_start:       Optional ISO date for diagnostic context

    Returns:
        dict with alpha_annual, alpha_pct, beta, r2, alpha_tstat, alpha_pval, n_daily_bars
        On error returns {"error": <str>}
    """
    try:
        import yfinance as yf

        gross_eq = np.array(portfolio_equity, dtype=float)
        gross_eq = np.maximum(gross_eq, 1e-10)
        gross_ret_hourly = np.diff(gross_eq) / gross_eq[:-1]

        # Resample hourly → daily (sum over 6 hourly bars ≈ one 6.5-hour trading day)
        n_per_day = 6
        n_daily   = len(gross_ret_hourly) // n_per_day
        if n_daily < 20:
            return {"error": "insufficient daily bars for CAPM regression (need ≥20)"}

        port_daily = np.array([
            gross_ret_hourly[i * n_per_day : (i + 1) * n_per_day].sum()
            for i in range(n_daily)
        ])

        # Fetch SPY daily returns. `timeout` bounds the underlying HTTP call so a
        # slow/unresponsive Yahoo endpoint fails fast into the except-block below
        # instead of hanging the (single-worker) request indefinitely.
        spy_hist = yf.download("SPY", period="2y", auto_adjust=True, progress=False, timeout=10)
        if spy_hist is None or spy_hist.empty:
            return {"error": "SPY data unavailable"}

        # yfinance ≥0.2 returns MultiIndex columns; normalise to a plain Series
        spy_close = spy_hist["Close"]
        if hasattr(spy_close, "columns"):          # it's a DataFrame (multi-ticker format)
            spy_close = spy_close.iloc[:, 0]
        spy_daily_ret = spy_close.pct_change().dropna()
        spy_daily_ret = np.array(spy_daily_ret, dtype=float).flatten()

        # Align: take the tail of SPY matching the portfolio OOS length
        n = min(len(port_daily), len(spy_daily_ret))
        if n < 20:
            return {"error": "insufficient overlapping bars for regression"}

        port_arr = port_daily[-n:]
        spy_arr  = spy_daily_ret[-n:]

        # OLS: r_portfolio = alpha_daily + beta * r_SPY + epsilon
        slope, intercept, r_value, p_value, std_err = scipy_stats.linregress(spy_arr, port_arr)

        annual_alpha = float(intercept) * 252
        alpha_tstat  = float(intercept) / (float(std_err) + 1e-10)

        return {
            "alpha_annual":  round(annual_alpha, 4),
            "alpha_pct":     round(annual_alpha * 100, 2),
            "beta":          round(float(slope), 4),
            "r2":            round(float(r_value ** 2), 4),
            "alpha_tstat":   round(alpha_tstat, 4),
            "alpha_pval":    round(float(p_value), 6),
            "n_daily_bars":  n,
        }
    except Exception as exc:
        return {"error": str(exc)}
