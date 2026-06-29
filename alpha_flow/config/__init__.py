"""alpha_flow.config — Configuration, constants, and ticker universe.

Re-exports:
    from alpha_flow.config import TICKERS            # default 10-ticker universe
    from alpha_flow.config import get_all_tickers    # TICKERS + custom UI additions
    from alpha_flow.config import WF_TRAIN_WINDOW    # 200 daily bars per train fold
    from alpha_flow.config import WF_TEST_WINDOW     # 50 daily bars per test fold
    from alpha_flow.config import OFI_WINDOW         # rolling window for OFI z-score
    from alpha_flow.config import AMIHUD_WINDOW      # rolling window for Amihud/Kyle

Modules:
    settings        : All constants, API keys (from .env), ticker list, window sizes.
"""
from alpha_flow.config.settings import (
    TICKERS,
    get_all_tickers,
    OFI_WINDOW,
    AMIHUD_WINDOW,
    WF_TRAIN_WINDOW,
    WF_TEST_WINDOW,
)

__all__ = [
    "TICKERS",
    "get_all_tickers",
    "OFI_WINDOW",
    "AMIHUD_WINDOW",
    "WF_TRAIN_WINDOW",
    "WF_TEST_WINDOW",
]
