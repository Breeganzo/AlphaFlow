"""
data/intraday_feed.py
Phase 2: Intraday data loader — three-tier strategy:

  Tier 1 (PRIMARY)   — yfinance 1-hour bars, up to 730 days (~2 years)
                       Free. Cached to Parquet. Used for all signal computation.

  Tier 2 (SECONDARY) — Alpaca REST API 1-minute bars via IEX free tier
                       Free with API key. 7+ years of history. IEX = 2-5% of
                       US market volume (documented limitation — academically
                       acceptable for research). Cached to DuckDB for fast
                       columnar queries.

  Tier 3 (FALLBACK)  — Graceful None return when Alpaca key is absent.
                       Callers must handle None and fall back to hourly.

Why DuckDB for 1-min data:
  1-min bars for 11 tickers × 365 days × 390 bars/day = 1.57M rows.
  DuckDB handles this with fast columnar scans; SQLite would be slow.
  Parquet is used for hourly (smaller; simpler tooling).

References:
  - Almgren & Chriss (2001) — VWAP execution and price impact
  - López de Prado (2018) — Alternative bar sampling (Ch.3)
  - Alpaca Markets API docs — https://docs.alpaca.markets
"""
from __future__ import annotations

import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import numpy as np

from alpha_flow.config.settings import (
    ALPACA_API_KEY,
    ALPACA_SECRET_KEY,
    ALPACA_BASE_URL,
    ALPACA_DATA_FEED,
    INTRADAY_RESOLUTION,
)

# ── Directory layout ──────────────────────────────────────────────────────────
_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_TICKS_DIR    = _PROJECT_ROOT / "data" / "ticks"
_TICKS_DIR.mkdir(parents=True, exist_ok=True)


# ═══════════════════════════════════════════════════════════════════════════════
# TIER 1 — yfinance 1-hour bars
# ═══════════════════════════════════════════════════════════════════════════════

def get_hourly_bars(ticker: str, years: int = 2) -> pd.DataFrame:
    """
    Fetch hourly OHLCV bars from Yahoo Finance (up to 730 days / ~2 years).

    Uses the same 8-step cleaning protocol as Phase 1 daily data.
    Caches to data/ticks/{ticker}_hourly.parquet for fast re-reads.

    What you learn building this:
      - yfinance interval='1h' gives up to 730 calendar days of hourly data
      - Parquet is column-compressed: 3,276 rows × 5 cols ≈ 50 KB vs ~200 KB CSV
      - Delta-append: only fetch new bars, keep old ones → fewer API calls

    Returns: DataFrame with DatetimeIndex (UTC), columns [open, high, low, close, volume]
    """
    import yfinance as yf

    cache_path = _TICKS_DIR / f"{ticker}_hourly.parquet"

    # ── Check if cache is fresh (< 2 hours old) ──────────────────────────────
    if cache_path.exists():
        mtime = datetime.fromtimestamp(cache_path.stat().st_mtime, tz=timezone.utc)
        age_hours = (datetime.now(tz=timezone.utc) - mtime).total_seconds() / 3600
        if age_hours < 2:
            df = pd.read_parquet(cache_path)
            return df

    # ── Fetch from yfinance ───────────────────────────────────────────────────
    try:
        period = f"{min(years, 2)}y"   # Yahoo Finance cap: 730 days for 1h
        raw = yf.download(
            ticker,
            period=period,
            interval="1h",
            auto_adjust=True,
            progress=False,
        )
        if raw.empty:
            raise ValueError(f"yfinance returned empty DataFrame for {ticker}")

        # Flatten MultiIndex columns (newer yfinance versions)
        if isinstance(raw.columns, pd.MultiIndex):
            raw.columns = [c[0].lower() for c in raw.columns]
        else:
            raw.columns = [c.lower() for c in raw.columns]

        df = raw[["open", "high", "low", "close", "volume"]].copy()
        df = _clean_ohlcv_intraday(df, ticker)

        # ── Delta-append: merge new bars with existing cache ─────────────────
        if cache_path.exists():
            existing = pd.read_parquet(cache_path)
            df = pd.concat([existing, df])
            df = df[~df.index.duplicated(keep="last")]
            df = df.sort_index()

        df.to_parquet(cache_path, engine="pyarrow", compression="snappy")
        return df

    except Exception as exc:
        print(f"  [intraday_feed] yfinance hourly failed for {ticker}: {exc}")
        if cache_path.exists():
            return pd.read_parquet(cache_path)   # stale cache is better than nothing
        return pd.DataFrame()


# ═══════════════════════════════════════════════════════════════════════════════
# TIER 2 — Alpaca REST API 1-minute bars (IEX free tier)
# ═══════════════════════════════════════════════════════════════════════════════

def get_alpaca_1min(ticker: str, days: int = 365) -> pd.DataFrame | None:
    """
    Fetch 1-minute OHLCV bars from Alpaca REST API (IEX free tier).

    Alpaca free tier provides:
      - 7+ years of historical 1-min bars via IEX exchange
      - IEX coverage: ~2-5% of US market volume (documented limitation)
      - 200 API calls/min rate limit
      - 15-minute delayed data (not real-time) on free tier

    Results are cached to DuckDB for fast columnar queries.
    Returns None gracefully if ALPACA_API_KEY is absent — callers fall back
    to hourly bars.

    What you learn building this:
      - REST API pagination: Alpaca uses cursor-based paging for large date ranges
      - DuckDB: columnar storage, SQL queries, fast aggregation on 1M+ rows
      - Why IEX matters: it's a registered exchange with clean trade reporting
    """
    if not ALPACA_API_KEY:
        return None   # No key — caller falls back to hourly

    try:
        import duckdb
        from alpaca.data.historical import StockHistoricalDataClient
        from alpaca.data.requests import StockBarsRequest
        from alpaca.data.timeframe import TimeFrame

        db_path = _TICKS_DIR / f"{ticker}_1min.duckdb"

        # ── Check what dates we already have ─────────────────────────────────
        start_dt = datetime.now(tz=timezone.utc) - timedelta(days=days)
        if db_path.exists():
            with duckdb.connect(str(db_path)) as con:
                result = con.execute(
                    "SELECT MAX(ts) FROM bars_1min WHERE ticker = ?",[ticker]
                ).fetchone()
                if result and result[0]:
                    last_ts = pd.Timestamp(result[0], tz="UTC")
                    # Only fetch bars newer than what we have
                    start_dt = max(
                        start_dt,
                        last_ts + timedelta(minutes=1)
                    )

        # ── Fetch from Alpaca ─────────────────────────────────────────────────
        client = StockHistoricalDataClient(
            api_key=ALPACA_API_KEY,
            secret_key=ALPACA_SECRET_KEY,
        )

        request = StockBarsRequest(
            symbol_or_symbols=ticker,
            timeframe=TimeFrame.Minute,
            start=start_dt,
            end=datetime.now(tz=timezone.utc) - timedelta(minutes=16),  # 15-min delay
            feed=ALPACA_DATA_FEED,
            limit=10_000,
        )

        bars = client.get_stock_bars(request)
        df_new = bars.df

        if df_new.empty:
            # No new data — read full cache if available
            if db_path.exists():
                with duckdb.connect(str(db_path)) as con:
                    return _duckdb_to_df(con, ticker)
            return None

        # ── Normalise columns ─────────────────────────────────────────────────
        if isinstance(df_new.index, pd.MultiIndex):
            df_new = df_new.xs(ticker, level="symbol") if ticker in df_new.index.get_level_values("symbol") else df_new.droplevel(0)
        df_new.index = pd.to_datetime(df_new.index).tz_convert("UTC")
        df_new = df_new.rename(columns={
            "open": "open", "high": "high", "low": "low",
            "close": "close", "volume": "volume",
        })
        df_new = df_new[["open", "high", "low", "close", "volume"]].dropna()

        # ── Append to DuckDB ──────────────────────────────────────────────────
        _append_to_duckdb(db_path, ticker, df_new)

        # ── Return full cached range ──────────────────────────────────────────
        with duckdb.connect(str(db_path)) as con:
            return _duckdb_to_df(con, ticker)

    except Exception as exc:
        print(f"  [intraday_feed] Alpaca 1-min failed for {ticker}: {exc}")
        # Try to return whatever we have cached
        if db_path.exists():
            try:
                import duckdb
                with duckdb.connect(str(db_path)) as con:
                    return _duckdb_to_df(con, ticker)
            except Exception:
                pass
        return None


# ═══════════════════════════════════════════════════════════════════════════════
# PUBLIC ROUTER
# ═══════════════════════════════════════════════════════════════════════════════

def get_intraday_bars(ticker: str, resolution: str = "1h") -> pd.DataFrame:
    """
    Public entry point — routes to correct data tier.

    Resolution '1h' → yfinance hourly (always available, free)
    Resolution '1m' → Alpaca IEX 1-min → fallback to yfinance hourly

    Callers should use resolution='1h' for signal computation.
    Resolution '1m' is for Hawkes process intensity fitting.
    """
    if resolution == "1m":
        df_1m = get_alpaca_1min(ticker)
        if df_1m is not None and not df_1m.empty:
            return df_1m
        # Fallback: return hourly bars (caller must handle lower resolution)
        print(f"  [intraday_feed] 1-min unavailable for {ticker}, using 1h fallback")
        return get_hourly_bars(ticker)
    else:
        return get_hourly_bars(ticker)


# ═══════════════════════════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

def _clean_ohlcv_intraday(df: pd.DataFrame, ticker: str) -> pd.DataFrame:
    """
    Apply 8-step cleaning to intraday OHLCV (same logic as Phase 1 daily).
    Adapted for intraday: clips ±5% per bar (vs ±20% for daily).
    """
    required = ["open", "high", "low", "close", "volume"]
    for col in required:
        if col not in df.columns:
            df[col] = np.nan

    df = df[df["close"] > 0]                      # Step 1: drop zero/negative close
    df = df[df["volume"] > 0]                     # Step 2: drop zero volume bars
    df = df.ffill(limit=2)                        # Step 3: fill ≤2 consecutive NaN
    df = df.dropna(subset=["close", "volume"])    # Step 4: drop remaining NaN
    # Step 5: clip extreme intraday returns (>±5% per bar = data error for 1h)
    ret = df["close"].pct_change().abs()
    df  = df[ret.isna() | (ret <= 0.05)]
    df  = df[~df.index.duplicated(keep="last")]   # Step 6: deduplicate
    df  = df.sort_index()                         # Step 7: sort chronologically
    return df


def _append_to_duckdb(db_path: Path, ticker: str, df: pd.DataFrame) -> None:
    """Delta-append new bars to DuckDB, deduplicating on timestamp."""
    import duckdb

    df_insert = df.copy()
    df_insert.index.name = "ts"
    df_insert = df_insert.reset_index()
    df_insert["ticker"] = ticker

    with duckdb.connect(str(db_path)) as con:
        # Create table if it doesn't exist
        con.execute("""
            CREATE TABLE IF NOT EXISTS bars_1min (
                ticker  VARCHAR,
                ts      TIMESTAMPTZ,
                open    DOUBLE,
                high    DOUBLE,
                low     DOUBLE,
                close   DOUBLE,
                volume  DOUBLE,
                PRIMARY KEY (ticker, ts)
            )
        """)
        # Insert new rows, ignore duplicates
        con.execute("""
            INSERT OR IGNORE INTO bars_1min
            SELECT ticker, ts, open, high, low, close, volume
            FROM df_insert
        """)


def _duckdb_to_df(con, ticker: str) -> pd.DataFrame:
    """Read all 1-min bars for a ticker from an open DuckDB connection."""
    df = con.execute(
        "SELECT ts, open, high, low, close, volume FROM bars_1min "
        "WHERE ticker = ? ORDER BY ts",
        [ticker]
    ).df()
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    df = df.set_index("ts")
    return df
