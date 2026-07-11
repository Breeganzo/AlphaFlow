"""alpha_flow.data — Market data ingestion and caching.

Provides incremental-append OHLCV data feeds with local CSV/Parquet cache to
minimise API calls. The historical window grows on each run (never truncated).

Re-exports:
    from alpha_flow.data import get_daily_bars   # 2yr daily OHLCV via yfinance
    from alpha_flow.data import get_hourly_bars  # 60-min bars via Alpaca IEX (yfinance fallback)

Modules:
    data_feed       : Daily OHLCV with delta-append CSV cache (data/raw/).
                      Uses yfinance — free 2-year daily history not available on
                      Alpaca IEX free tier.
    intraday_feed   : Hourly bars with parquet cache (data/ticks/).
                      Primary: Alpaca IEX REST; fallback: yfinance 1h.
    alpaca_stream   : SSE live stream — REST polls Alpaca IEX latest bar every 60s.
                      Yields AlpacaStreamBar objects consumed by /api/stream endpoint.
"""
from alpha_flow.data.data_feed import get_daily_bars
from alpha_flow.data.intraday_feed import get_hourly_bars

__all__ = ["get_daily_bars", "get_hourly_bars"]
