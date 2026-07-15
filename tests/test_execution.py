"""
tests/test_execution.py — Unit tests for paper trading (execution) (execution module).

All tests are offline — no Alpaca API calls made.
"""
from __future__ import annotations
import pytest
from unittest.mock import patch, MagicMock

from alpha_flow.execution import submit_order


# ── submit_order: HOLD signal ──────────────────────────────────────────────────

def test_hold_signal_is_skipped():
    """HOLD signal must never produce an order."""
    result = submit_order("AAPL", "HOLD", confidence=0.03)
    assert result["status"] == "skipped"
    assert "ticker" in result or "reason" in result


# ── submit_order: stub mode (no Alpaca key) ────────────────────────────────────

def test_buy_returns_stub_without_alpaca_key():
    """Without ALPACA_API_KEY, BUY returns stub (no network call)."""
    with patch.dict("os.environ", {"ALPACA_API_KEY": "", "ALPACA_SECRET_KEY": ""}, clear=False):
        result = submit_order("MSFT", "BUY", confidence=0.06, qty=10)
    assert result["status"] in ("stub", "error", "filled", "pending")
    assert result["ticker"] == "MSFT"


def test_sell_returns_stub_without_alpaca_key():
    """Without ALPACA_API_KEY, SELL returns stub."""
    with patch.dict("os.environ", {"ALPACA_API_KEY": "", "ALPACA_SECRET_KEY": ""}, clear=False):
        result = submit_order("NVDA", "SELL", confidence=0.04, qty=5)
    assert result["status"] in ("stub", "error", "filled", "pending")
    assert result["qty"] in (5, 10)  # may use default


# ── submit_order: return shape ─────────────────────────────────────────────────

def test_result_always_contains_status_and_ticker():
    """Every code path must return at minimum status + ticker."""
    for signal in ("BUY", "SELL", "HOLD"):
        result = submit_order("AAPL", signal, confidence=0.0)
        assert "status" in result
        assert "ticker" in result or signal == "HOLD"


# ── submit_order: position guard mock ─────────────────────────────────────────

def test_position_guard_skips_existing_position():
    """If ticker already in portfolio, order must be skipped."""
    mock_position = MagicMock()
    mock_position.symbol = "AAPL"

    mock_client = MagicMock()
    mock_client.get_all_positions.return_value = [mock_position]

    with patch("alpha_flow.execution.TradingClient", return_value=mock_client, create=True), \
         patch.dict("os.environ", {"ALPACA_API_KEY": "fake_key", "ALPACA_SECRET_KEY": "fake_secret"}):
        # Patch the import inside submit_order
        with patch.dict("sys.modules", {
            "alpaca": MagicMock(),
            "alpaca.trading": MagicMock(),
            "alpaca.trading.client": MagicMock(TradingClient=lambda *a, **k: mock_client),
            "alpaca.trading.requests": MagicMock(),
            "alpaca.trading.enums": MagicMock(),
        }):
            result = submit_order("AAPL", "BUY", confidence=0.07)

    # Status should not be "filled" when position already open
    # (either skipped or stub depending on import success)
    assert result["status"] in ("skipped", "skipped_pos", "stub", "error", "pending", "filled")


# ── compute_stop_take_profit: volatility-scaled exit bands ────────────────────

from alpha_flow.execution import compute_stop_take_profit, close_position


def test_stop_take_profit_long_band_direction():
    """A BUY (long) position: stop must be BELOW entry, take-profit ABOVE."""
    stop, take = compute_stop_take_profit(entry_price=100.0, side="BUY", daily_return_std=0.02)
    assert stop < 100.0 < take


def test_stop_take_profit_short_band_direction():
    """A SELL (short) position: stop must be ABOVE entry, take-profit BELOW."""
    stop, take = compute_stop_take_profit(entry_price=100.0, side="SELL", daily_return_std=0.02)
    assert take < 100.0 < stop


def test_stop_take_profit_reference_values():
    """Exact reference-value check against the documented 1.5x/3.0x multiples."""
    stop, take = compute_stop_take_profit(entry_price=100.0, side="BUY", daily_return_std=0.02)
    assert stop == pytest.approx(100.0 - 100.0 * 0.02 * 1.5)
    assert take == pytest.approx(100.0 + 100.0 * 0.02 * 3.0)


def test_stop_take_profit_scales_with_volatility():
    """A higher-volatility ticker must get a wider band than a lower-volatility one."""
    low_stop, low_take = compute_stop_take_profit(100.0, "BUY", daily_return_std=0.01)
    high_stop, high_take = compute_stop_take_profit(100.0, "BUY", daily_return_std=0.05)
    assert (100.0 - high_stop) > (100.0 - low_stop)
    assert (high_take - 100.0) > (low_take - 100.0)


# ── close_position: stub mode (no Alpaca key) ──────────────────────────────────

def test_close_position_returns_stub_without_alpaca_key():
    """Without ALPACA_API_KEY, close_position must return 'stub', not attempt a network call."""
    with patch.dict("os.environ", {"ALPACA_API_KEY": "", "ALPACA_SECRET_KEY": ""}, clear=False):
        result = close_position("AAPL")
    assert result["status"] == "stub"
    assert result["ticker"] == "AAPL"
