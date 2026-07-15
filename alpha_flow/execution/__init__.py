"""
execution — Order Execution Module  (execution/analytics)
=============================================
Submits paper trades to Alpaca paper trading API (free forever, no real capital).
Falls back to a logged stub response when ALPACA_API_KEY is not configured.

Position sizing: fixed 10 shares per signal (configurable via qty kwarg).
Position guard:  skips the order if the ticker already has an open position in
                 the paper account — prevents double-entry on the same signal.
Risk control:    HOLD signals are always skipped.
"""
from __future__ import annotations


def submit_order(
    ticker: str,
    signal: str,
    confidence: float,
    qty: int = 10,
) -> dict:
    """
    Submit a paper-trading market order to Alpaca based on a microstructure signal.

    Args:
        ticker:     Equity ticker symbol (e.g. "AAPL")
        signal:     "BUY", "SELL", or "HOLD"
        confidence: Signal confidence score (mean_ic from walk-forward pipeline)
        qty:        Number of shares (default 10)

    Returns:
        Dict with keys: status, ticker, signal, qty, order_id, filled_avg_price,
        filled_at, side.  "status" is one of:
          "filled"  — Alpaca accepted and (paper-)filled the order
          "pending" — order submitted but not yet confirmed
          "skipped" — HOLD signal or existing position
          "stub"    — no Alpaca key configured (order logged but not placed)
          "error"   — Alpaca API returned an error
    """
    if signal == "HOLD":
        return {"status": "skipped", "ticker": ticker, "reason": "HOLD signal"}

    ticker = ticker.upper()
    side = signal.upper()  # "BUY" or "SELL"

    # ── Try real Alpaca paper trading ─────────────────────────────────────────
    try:
        import os
        from dotenv import load_dotenv
        from pathlib import Path
        load_dotenv(Path(__file__).parent.parent.parent / ".env")

        api_key    = os.getenv("ALPACA_API_KEY", "")
        secret_key = os.getenv("ALPACA_SECRET_KEY", "")

        if not (api_key and secret_key):
            return {
                "status": "stub",
                "ticker": ticker,
                "signal": side,
                "qty": qty,
                "confidence": round(confidence, 4),
                "message": "ALPACA_API_KEY not set — set it in .env for live paper trading",
            }

        from alpaca.trading.client import TradingClient
        from alpaca.trading.requests import MarketOrderRequest
        from alpaca.trading.enums import OrderSide, TimeInForce

        client = TradingClient(api_key, secret_key, paper=True)

        # Position guard: skip if already holding this ticker
        try:
            positions = client.get_all_positions()
            held = {p.symbol for p in positions}
            if ticker in held:
                return {
                    "status": "skipped_pos",
                    "ticker": ticker,
                    "signal": side,
                    "reason": f"Position already open for {ticker} in paper account",
                }
        except Exception:
            pass  # Non-fatal: proceed without position guard

        order_side = OrderSide.BUY if side == "BUY" else OrderSide.SELL
        req = MarketOrderRequest(
            symbol=ticker,
            qty=qty,
            side=order_side,
            time_in_force=TimeInForce.DAY,
        )
        order = client.submit_order(req)

        return {
            "status":          order.status.value if hasattr(order.status, "value") else str(order.status),
            "ticker":          ticker,
            "signal":          side,
            "qty":             qty,
            "order_id":        str(order.id),
            "filled_avg_price": float(order.filled_avg_price) if order.filled_avg_price else None,
            "filled_at":       str(order.filled_at) if order.filled_at else None,
            "side":            side.lower(),
        }

    except Exception as exc:
        return {
            "status": "error",
            "ticker": ticker,
            "signal": side,
            "qty": qty,
            "error": str(exc),
        }


def compute_stop_take_profit(entry_price: float, side: str, daily_return_std: float) -> tuple[float, float]:
    """
    Compute a volatility-scaled stop-loss and take-profit price band.

    Uses realized daily-return volatility (std of recent close-to-close pct
    returns) rather than a fixed percentage, so a low-vol name (e.g. KO) and
    a high-vol name (e.g. TSLA) get proportionally different bands — the
    same principle as an ATR-based stop. See
    alpha_flow/config/settings.py::STOP_LOSS_VOL_MULT/TAKE_PROFIT_VOL_MULT
    for the multiples (2:1 reward:risk by default).

    Args:
        entry_price:      fill price of the position
        side:              "BUY" (long) or "SELL" (short)
        daily_return_std:  std of recent daily pct returns (e.g. 0.02 = 2%)

    Returns:
        (stop_loss_price, take_profit_price)
    """
    from alpha_flow.config.settings import STOP_LOSS_VOL_MULT, TAKE_PROFIT_VOL_MULT

    move_stop = entry_price * daily_return_std * STOP_LOSS_VOL_MULT
    move_take = entry_price * daily_return_std * TAKE_PROFIT_VOL_MULT
    if side.upper() == "BUY":
        return entry_price - move_stop, entry_price + move_take
    else:  # SELL / short
        return entry_price + move_stop, entry_price - move_take


def close_position(ticker: str) -> dict:
    """
    Close an open Alpaca paper position for `ticker` (market order in the
    opposite direction, sized to exactly flatten — NOT a naive same-qty
    opposite-side order, which would just open a new position in the other
    direction instead of closing the existing one).

    Returns dict with keys: status, ticker, exit_price. "status" is one of:
      "closed"  — Alpaca confirmed the close
      "stub"    — no Alpaca key configured (logged only)
      "no_position" — Alpaca reports no open position for this ticker
      "error"   — Alpaca API returned an error
    """
    ticker = ticker.upper()
    try:
        import os
        from dotenv import load_dotenv
        from pathlib import Path
        load_dotenv(Path(__file__).parent.parent.parent / ".env")

        api_key    = os.getenv("ALPACA_API_KEY", "")
        secret_key = os.getenv("ALPACA_SECRET_KEY", "")

        if not (api_key and secret_key):
            return {"status": "stub", "ticker": ticker, "exit_price": None,
                     "message": "ALPACA_API_KEY not set — no live paper position to close"}

        from alpaca.trading.client import TradingClient

        client = TradingClient(api_key, secret_key, paper=True)

        try:
            order = client.close_position(ticker)
        except Exception as exc:
            if "404" in str(exc) or "position does not exist" in str(exc).lower():
                return {"status": "no_position", "ticker": ticker, "exit_price": None}
            raise

        return {
            "status":     "closed",
            "ticker":     ticker,
            "order_id":   str(getattr(order, "id", "")),
            "exit_price": float(order.filled_avg_price) if getattr(order, "filled_avg_price", None) else None,
        }
    except Exception as exc:
        return {"status": "error", "ticker": ticker, "exit_price": None, "error": str(exc)}

