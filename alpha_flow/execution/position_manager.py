"""
alpha_flow/execution/position_manager.py — Automated exit logic for paper positions.

Closes an existing open_positions.status='open' row when EITHER:
  (a) the model's latest signal for that ticker has flipped against the
      held side (e.g. holding BUY, latest signal is now SELL or HOLD), or
  (b) the current price has breached the position's stop-loss or
      take-profit band (computed at entry time — see
      alpha_flow.execution.compute_stop_take_profit).

This module is deliberately pure/decision-only (no DB or Alpaca calls
inside `decide_exit`/`check_positions_logic`) so the exit rules themselves
are trivially unit-testable without mocking the database or network layer —
the DB/Alpaca side-effects live in backend/main.py's thin wrapper endpoint.
"""
from __future__ import annotations


def get_latest_price(ticker: str) -> float | None:
    """
    Best-effort current price for `ticker`: real Alpaca IEX latest bar close
    when ALPACA_API_KEY is configured (free tier, ~15-min delayed), else the
    most recent cached daily close (data_feed.get_daily_bars). Returns None
    only if both sources fail (e.g. brand-new/unknown ticker with no cache).
    """
    import os
    from dotenv import load_dotenv
    from pathlib import Path
    load_dotenv(Path(__file__).parent.parent.parent / ".env")
    api_key    = os.getenv("ALPACA_API_KEY", "")
    secret_key = os.getenv("ALPACA_SECRET_KEY", "")
    if api_key and secret_key:
        try:
            from alpaca.data.historical import StockHistoricalDataClient
            from alpaca.data.requests import StockLatestBarRequest
            client = StockHistoricalDataClient(api_key, secret_key)
            req = StockLatestBarRequest(symbol_or_symbols=ticker.upper())
            bars = client.get_stock_latest_bar(req)
            bar = bars.get(ticker.upper()) if hasattr(bars, "get") else bars[ticker.upper()]
            if bar is not None:
                return float(bar.close)
        except Exception:
            pass
    try:
        from alpha_flow.data.data_feed import get_daily_bars
        df = get_daily_bars(ticker)
        if len(df):
            return float(df["close"].iloc[-1])
    except Exception:
        pass
    return None


def estimate_daily_return_std(ticker: str, window: int | None = None) -> float:
    """Realized daily-return volatility (std of pct returns) over the last
    `window` trading days, from the already-cached daily bars — no new
    network call. Falls back to a conservative 2% if data is unavailable
    (roughly a typical large-cap daily vol) rather than raising, since this
    feeds a risk band, not a signal — a stale-but-present fallback is safer
    than crashing the entire position-check job over one ticker's data gap.
    """
    from alpha_flow.config.settings import POSITION_VOL_WINDOW
    window = window or POSITION_VOL_WINDOW
    try:
        from alpha_flow.data.data_feed import get_daily_bars
        df = get_daily_bars(ticker)
        closes = df["close"].tail(window + 1)
        if len(closes) < 5:
            return 0.02
        returns = closes.pct_change().dropna()
        std = float(returns.std())
        return std if std > 0 else 0.02
    except Exception:
        return 0.02


def decide_exit(position: dict, latest_signal: str | None, latest_price: float | None) -> str | None:
    """
    Pure decision function: should this open position be closed, and why?

    Args:
        position:       an open_positions row (dict) — needs side, stop_loss_price,
                         take_profit_price
        latest_signal:  the model's most recent BUY/SELL/HOLD for this ticker
                         (None if no signal available yet)
        latest_price:   current market price (None if unavailable)

    Returns:
        One of "signal_flip", "stop_loss", "take_profit", or None (keep holding).
        Signal-flip is checked first (methodology reason to exit), then
        price bands (risk-control reason) — order matters only for the
        `close_reason` label when both would independently trigger this run.
    """
    side = position.get("side", "").upper()

    # (a) Signal flip / decay to HOLD — the model no longer agrees with the position.
    if latest_signal is not None:
        if side == "BUY" and latest_signal != "BUY":
            return "signal_flip"
        if side == "SELL" and latest_signal != "SELL":
            return "signal_flip"

    # (b) Stop-loss / take-profit price bands.
    if latest_price is not None:
        stop = position.get("stop_loss_price")
        take = position.get("take_profit_price")
        if side == "BUY":
            if stop is not None and latest_price <= stop:
                return "stop_loss"
            if take is not None and latest_price >= take:
                return "take_profit"
        elif side == "SELL":
            if stop is not None and latest_price >= stop:
                return "stop_loss"
            if take is not None and latest_price <= take:
                return "take_profit"

    return None


def check_positions_logic(
    positions: list[dict],
    latest_signals: dict[str, str],
    latest_prices: dict[str, float],
) -> list[dict]:
    """
    Evaluate every open position against the latest signals/prices and
    return the list of {position_id, ticker, side, reason} actions to close.
    Pure function — no DB/Alpaca side effects, easy to unit test.
    """
    actions = []
    for pos in positions:
        ticker = pos["ticker"]
        reason = decide_exit(
            pos,
            latest_signals.get(ticker),
            latest_prices.get(ticker),
        )
        if reason:
            actions.append({
                "position_id": pos["id"],
                "ticker": ticker,
                "side": pos["side"],
                "reason": reason,
            })
    return actions
