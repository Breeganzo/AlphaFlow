"""
execution — Order Execution Module  (Phase 2 Scope)
====================================================
This module is reserved for live order submission to Alpaca paper trading.

Currently AlphaFlow is a *signal engine only* — it identifies microstructure
signals but does **not** submit real or paper trades. Order execution is
intentionally left as Phase 2 scope so the signal quality can be validated
independently before any capital is put at risk.

Phase 2 will implement:
  - Connection to Alpaca paper trading REST API
  - Market and limit order submission based on signal cards from
    alpha_flow/signals/signal_generator.py
  - Position sizing (default: 10 shares; configurable via settings.py)
  - Risk controls: max 2 % NAV per signal, no net short exposure
  - Real-time fill monitoring and rejection handling

See also:
  alpha_flow/signals/signal_generator.py  — produces the signal cards
  alpha_flow/config/settings.py           — ALPACA_API_KEY, ALPACA_BASE_URL
"""
from __future__ import annotations


def submit_order(
    ticker: str,
    signal: str,
    confidence: float,
    qty: int = 10,
) -> dict:
    """
    Submit a paper-trading order to Alpaca based on a microstructure signal.

    Args:
        ticker:     Equity ticker symbol (e.g. "AAPL")
        signal:     "BUY", "SELL", or "HOLD"
        confidence: Signal confidence score [0.0, 1.0] from signal_generator
        qty:        Number of shares (default 10; scale with risk budget)

    Returns:
        Order response dict.  Currently returns a stub response — no real
        order is placed until Phase 2 implementation.

    TODO (Phase 2):
        1. from alpaca.trading.client import TradingClient
        2. client = TradingClient(ALPACA_API_KEY, ALPACA_SECRET_KEY, paper=True)
        3. req = MarketOrderRequest(symbol=ticker, qty=qty,
                                    side=OrderSide.BUY if signal=="BUY" else OrderSide.SELL,
                                    time_in_force=TimeInForce.DAY)
        4. return client.submit_order(req)
        5. Add position-limit guard: skip if existing position > 2% NAV
    """
    if signal == "HOLD":
        return {"status": "skipped", "reason": "HOLD signal — no order submitted"}

    side = "buy" if signal == "BUY" else "sell"
    return {
        "status": "stub",
        "ticker": ticker,
        "side": side,
        "qty": qty,
        "confidence": round(confidence, 4),
        "message": (
            "Phase 2 placeholder — Alpaca order submission not yet implemented. "
            "Signal has been logged; no trade was placed."
        ),
    }
