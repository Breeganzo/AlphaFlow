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

