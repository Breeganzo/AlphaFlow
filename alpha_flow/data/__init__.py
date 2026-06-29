"""alpha_flow.data — Market data ingestion and caching.

Provides incremental-append OHLCV data feeds with local cache to minimise
API calls. The historical window grows on each run (never truncated).

Re-exports:
    from alpha_flow.data import get_daily_bars   # 2yr daily OHLCV via yfinance
    from alpha_flow.data import get_hourly_bars  # 60-min bars via yfinance / Alpaca

Modules:
    data_feed       : Daily OHLCV with delta-append CSV cache (data/raw/).
    intraday_feed   : Hourly bars with parquet cache (data/ticks/);
                      optional Alpaca 1-min streaming for Phase 3.
"""
from alpha_flow.data.data_feed import get_daily_bars
from alpha_flow.data.intraday_feed import get_hourly_bars

__all__ = ["get_daily_bars", "get_hourly_bars"]
