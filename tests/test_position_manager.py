"""
tests/test_position_manager.py — Unit tests for automated exit logic
(alpha_flow/execution/position_manager.py).

decide_exit()/check_positions_logic() are pure functions (no DB/network),
so these are all fast, offline, reference-value tests.
"""
from __future__ import annotations
import pytest

from alpha_flow.execution.position_manager import decide_exit, check_positions_logic


# ── decide_exit: signal-flip exits ─────────────────────────────────────────────

def test_long_position_closes_when_signal_flips_to_sell():
    pos = {"side": "BUY", "stop_loss_price": 90.0, "take_profit_price": 120.0}
    assert decide_exit(pos, latest_signal="SELL", latest_price=100.0) == "signal_flip"


def test_long_position_closes_when_signal_decays_to_hold():
    """A model no longer confirming the BUY (now HOLD) is still a reason to exit —
    not just an outright flip to the opposite side."""
    pos = {"side": "BUY", "stop_loss_price": 90.0, "take_profit_price": 120.0}
    assert decide_exit(pos, latest_signal="HOLD", latest_price=100.0) == "signal_flip"


def test_long_position_holds_when_signal_still_agrees():
    pos = {"side": "BUY", "stop_loss_price": 90.0, "take_profit_price": 120.0}
    assert decide_exit(pos, latest_signal="BUY", latest_price=100.0) is None


def test_short_position_closes_when_signal_flips_to_buy():
    pos = {"side": "SELL", "stop_loss_price": 110.0, "take_profit_price": 80.0}
    assert decide_exit(pos, latest_signal="BUY", latest_price=100.0) == "signal_flip"


def test_no_signal_available_does_not_force_an_exit():
    """No signal data yet (e.g. pipeline hasn't run since the position opened)
    must not be misread as a flip — only price bands can trigger in that case."""
    pos = {"side": "BUY", "stop_loss_price": 90.0, "take_profit_price": 120.0}
    assert decide_exit(pos, latest_signal=None, latest_price=100.0) is None


# ── decide_exit: stop-loss / take-profit price bands ───────────────────────────

def test_long_position_hits_stop_loss():
    pos = {"side": "BUY", "stop_loss_price": 90.0, "take_profit_price": 120.0}
    assert decide_exit(pos, latest_signal="BUY", latest_price=89.0) == "stop_loss"


def test_long_position_hits_take_profit():
    pos = {"side": "BUY", "stop_loss_price": 90.0, "take_profit_price": 120.0}
    assert decide_exit(pos, latest_signal="BUY", latest_price=121.0) == "take_profit"


def test_short_position_hits_stop_loss():
    """Short: price rising through the (higher) stop-loss level is the losing direction."""
    pos = {"side": "SELL", "stop_loss_price": 110.0, "take_profit_price": 80.0}
    assert decide_exit(pos, latest_signal="SELL", latest_price=111.0) == "stop_loss"


def test_short_position_hits_take_profit():
    """Short: price falling through the (lower) take-profit level is the winning direction."""
    pos = {"side": "SELL", "stop_loss_price": 110.0, "take_profit_price": 80.0}
    assert decide_exit(pos, latest_signal="SELL", latest_price=79.0) == "take_profit"


def test_no_price_available_does_not_force_an_exit():
    pos = {"side": "BUY", "stop_loss_price": 90.0, "take_profit_price": 120.0}
    assert decide_exit(pos, latest_signal="BUY", latest_price=None) is None


# ── check_positions_logic: batch evaluation across multiple positions ─────────

def test_check_positions_logic_mixed_batch():
    positions = [
        {"id": 1, "ticker": "AAPL", "side": "BUY", "stop_loss_price": 90.0, "take_profit_price": 120.0},
        {"id": 2, "ticker": "MSFT", "side": "BUY", "stop_loss_price": 200.0, "take_profit_price": 260.0},
        {"id": 3, "ticker": "TSLA", "side": "SELL", "stop_loss_price": 300.0, "take_profit_price": 200.0},
    ]
    latest_signals = {"AAPL": "BUY", "MSFT": "SELL", "TSLA": "SELL"}
    latest_prices = {"AAPL": 100.0, "MSFT": 230.0, "TSLA": 195.0}  # TSLA hits take_profit

    actions = check_positions_logic(positions, latest_signals, latest_prices)
    by_ticker = {a["ticker"]: a["reason"] for a in actions}

    assert "AAPL" not in by_ticker           # still agrees, within band → hold
    assert by_ticker["MSFT"] == "signal_flip"  # model flipped to SELL
    assert by_ticker["TSLA"] == "take_profit"  # price band triggered
    assert len(actions) == 2


def test_check_positions_logic_empty_returns_empty():
    assert check_positions_logic([], {}, {}) == []
