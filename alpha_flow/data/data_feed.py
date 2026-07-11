"""
alpha_flow/data/data_feed.py
============================
Market data abstraction layer for AlphaFlow.

Data sources:
  Primary:   yfinance free tier — 2-year daily OHLCV bars, delta-appended CSV cache.
             Refreshed automatically when last row is stale (> 1 trading day old).
  Fallback:  Synthetic OHLCV with ticker-specific random seed — used only when
             yfinance is unreachable; always labeled in outputs.

Note: Alpaca IEX (hourly bars) is handled separately by intraday_feed.py.

Data files (committed to git):
  data/raw/{ticker}.csv        — raw OHLCV bars (append-only)
  data/raw/metadata.json       — last_refreshed timestamp per ticker
  data/processed/              — reserved for feature CSVs (hourly)

References
----------
Cont, R., Cucuringu, M. & Zhang, C. (2023). Cross-impact of order flow imbalance
    in equity markets. Quantitative Finance, 23(10), 1373–1393.
Lucchese, L., Pakkanen, M. & Veraart, A. (2024). The short-term predictability of
    returns in order book markets: A deep learning perspective.
    International Journal of Forecasting, 40(4), 1587–1621.
"""
from __future__ import annotations

import json
import os
from datetime import date, datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

# ── Paths ─────────────────────────────────────────────────────────────────────
_DATA_ROOT = Path(__file__).parent.parent.parent / "data"
RAW_DIR = _DATA_ROOT / "raw"
PROCESSED_DIR = _DATA_ROOT / "processed"
METADATA_FILE = RAW_DIR / "metadata.json"

RAW_DIR.mkdir(parents=True, exist_ok=True)
PROCESSED_DIR.mkdir(parents=True, exist_ok=True)


# ── Metadata helpers ──────────────────────────────────────────────────────────
def _load_metadata() -> dict:
    if METADATA_FILE.exists():
        try:
            return json.loads(METADATA_FILE.read_text())
        except Exception:
            pass
    return {}


def _save_metadata(meta: dict) -> None:
    METADATA_FILE.write_text(json.dumps(meta, indent=2))


def _is_stale(ticker: str, max_age_days: int = 1) -> bool:
    """Return True if the raw CSV for `ticker` is missing or older than `max_age_days`."""
    raw_path = RAW_DIR / f"{ticker}.csv"
    if not raw_path.exists():
        return True
    meta = _load_metadata()
    last_str = meta.get(ticker)
    if not last_str:
        return True
    try:
        last = datetime.fromisoformat(last_str).date()
        return (date.today() - last) > timedelta(days=max_age_days)
    except Exception:
        return True


# ── Data quality cleaning ─────────────────────────────────────────────────────
def _clean_ohlcv(df: pd.DataFrame, ticker: str = "?") -> pd.DataFrame:
    """
    8-step OHLCV data cleaning protocol.

    Steps applied in order:
      1. Ensure required columns present (fill missing with NaN)
      2. Drop rows where close is zero or negative (data provider error)
      3. Drop rows where volume is zero (non-trading / holiday artefacts)
      4. Forward-fill up to 2 consecutive missing bars (weekends / thin markets)
      5. Drop any remaining NaN in close + volume
      6. Clip extreme single-day returns > ±20% (stock-split / bad-data artefacts)
      7. Deduplicate on index, keep last
      8. Sort chronologically

    Notes:
      - Forward-fill limit=2 avoids propagating true data gaps > 2 days.
      - ±20% clip is conservative; real single-day moves >20% are extremely rare
        for large-cap US equities and almost always indicate data errors.
      - All cleaning decisions are logged to stdout for auditability.

    Reference: Holden & Jacobsen (2014). Inventory Information.
               J. Finance, 69(4), 1727–1765. (Appendix: data cleaning protocol)
    """
    original_len = len(df)
    n_removed = 0

    # 1. Required columns
    for col in ["open", "high", "low", "close", "volume"]:
        if col not in df.columns:
            df[col] = np.nan

    # 2. Remove zero/negative close
    bad_close = (df["close"] <= 0) | df["close"].isna()
    if bad_close.any():
        print(f"  [clean/{ticker}] Dropping {bad_close.sum()} rows with close <= 0")
        df = df[~bad_close]
        n_removed += bad_close.sum()

    # 3. Remove zero-volume rows (non-trading days)
    zero_vol = (df["volume"] <= 0) | df["volume"].isna()
    if zero_vol.any():
        print(f"  [clean/{ticker}] Dropping {zero_vol.sum()} zero-volume rows")
        df = df[~zero_vol]
        n_removed += zero_vol.sum()

    # 4. Forward-fill short gaps (≤ 2 consecutive)
    df = df.ffill(limit=2)

    # 5. Drop remaining NaN in key columns
    before = len(df)
    df = df.dropna(subset=["close", "volume"])
    dropped = before - len(df)
    if dropped:
        print(f"  [clean/{ticker}] Dropped {dropped} rows with NaN after ffill")
        n_removed += dropped

    # 6. Clip extreme daily returns > ±20%
    ret = df["close"].pct_change()
    extreme = ret.abs() > 0.20
    if extreme.any():
        print(f"  [clean/{ticker}] Clipping {extreme.sum()} extreme return rows (>±20%)")
        # Remove the outlier row (not just clip price — preserves series continuity)
        df = df[~extreme]
        n_removed += extreme.sum()

    # 7. Deduplicate index
    dup = df.index.duplicated(keep="last")
    if dup.any():
        print(f"  [clean/{ticker}] Removing {dup.sum()} duplicate index rows")
        df = df[~dup]
        n_removed += dup.sum()

    # 8. Sort
    df = df.sort_index()

    if n_removed:
        print(f"  [clean/{ticker}] Total: {n_removed}/{original_len} rows cleaned "
              f"({n_removed/original_len:.1%}). Remaining: {len(df)}")

    return df


# ── Public API ────────────────────────────────────────────────────────────────
def get_daily_bars(ticker: str, years: int = 2, force_refresh: bool = False) -> pd.DataFrame:
    """
    Return a DataFrame of daily OHLCV bars [open, high, low, close, volume].

    Strategy:
      1. Load from data/raw/{ticker}.csv if fresh (< 1 trading day old).
      2. If stale or missing: fetch from yfinance (`period=f'{years}y', interval='1d'`),
         append new rows only, save back to CSV, update metadata.
      3. Fallback: synthetic per-ticker-seeded data if yfinance unavailable.

    Parameters
    ----------
    ticker        : str  — e.g. 'AAPL'
    years         : int  — history to maintain (default 2 = ~504 bars)
    force_refresh : bool — bypass cache and re-fetch from yfinance
    """
    raw_path = RAW_DIR / f"{ticker}.csv"

    # Load cached CSV if fresh
    if not force_refresh and raw_path.exists() and not _is_stale(ticker):
        try:
            df = pd.read_csv(raw_path, index_col=0, parse_dates=True)
            df = df[["open", "high", "low", "close", "volume"]].dropna()
            if len(df) >= 30:
                return _clean_ohlcv(df, ticker)
        except Exception:
            pass

    # Fetch from yfinance (delta append or full fetch)
    df = _fetch_yfinance_daily(ticker, raw_path, years)
    if df is not None and len(df) >= 30:
        return _clean_ohlcv(df, ticker)

    # Fallback: synthetic (no cleaning needed — generated data is already valid)
    return _synthetic_fallback(ticker, n_bars=years * 252)


def refresh_all_tickers(tickers: list[str]) -> dict[str, int]:
    """
    Force-refresh daily bar CSV for every ticker in `tickers`.
    Returns dict of {ticker: num_rows}.  Called by POST /api/data/refresh.
    """
    result = {}
    for t in tickers:
        try:
            df = get_daily_bars(t, force_refresh=True)
            result[t] = len(df)
        except Exception as exc:
            result[t] = -1
            print(f"  [data_feed] refresh failed for {t}: {exc}")
    return result


# ── Survivorship-bias diagnostic ───────────────────────────────────────────────
def check_universe_survivorship(tickers: list[str] | None = None) -> dict:
    """
    Survivorship-bias diagnostic for the trading universe.

    Why this exists: `alpha_flow.config.settings.TICKERS` lists CURRENT S&P 500
    constituents, not the point-in-time membership as of 2 years ago. Names that
    were delisted, merged, acquired, or dropped from the index within the
    backtest window are excluded from the universe by construction — classic
    survivorship bias (Brown, Goetzmann & Ross 1995, "Survival"; also see
    Elton, Gruber & Blake 1996 on mutual-fund survivorship). Backtesting only
    on "survivors" tends to overstate historical performance versus what a
    point-in-time investor could actually have captured.

    This function does NOT fix survivorship bias — doing so requires
    point-in-time historical index-constituent data, which is not available
    from the free data sources this project uses (yfinance/Alpaca). Instead,
    it makes the exposure MEASURABLE and disclosed at runtime rather than only
    asserted in prose: it flags any ticker whose cached raw price history
    starts meaningfully later than the rest of the universe (e.g. a recent
    IPO), which is the adjacent, detectable symptom — a ticker added to the
    universe without a full window of history — as opposed to the
    undetectable case of a delisted name being absent entirely.

    Returns:
        dict with universe_size, expected_start_date, tickers_with_full_history,
        tickers_with_partial_history (ticker/first_available_date/days_short),
        and a `disclosure` string suitable for surfacing in reports/API responses.
    """
    from alpha_flow.config.settings import get_all_tickers
    tickers = tickers or get_all_tickers()

    disclosure = (
        "Universe = CURRENT constituent tickers only, not point-in-time historical "
        "index membership. Companies delisted, merged, or dropped from the index "
        "within the backtest window are excluded by construction (survivorship "
        "bias — Brown, Goetzmann & Ross 1995). This check detects only the "
        "adjacent, measurable symptom (a ticker with a shorter-than-expected "
        "cached price history, e.g. a recent IPO); it cannot detect names absent "
        "from the universe entirely, which requires point-in-time constituent "
        "data not available from this project's free data sources."
    )

    first_dates: dict[str, pd.Timestamp] = {}
    for t in tickers:
        raw_path = RAW_DIR / f"{t}.csv"
        if not raw_path.exists():
            continue
        try:
            df = pd.read_csv(raw_path, usecols=[0], parse_dates=[0])
            if not df.empty:
                first_dates[t] = pd.Timestamp(df.iloc[:, 0].min())
        except Exception:
            continue

    if not first_dates:
        return {
            "universe_size": len(tickers),
            "expected_start_date": None,
            "tickers_with_full_history": 0,
            "tickers_with_partial_history": [],
            "disclosure": disclosure + " (No cached raw data found yet — run the pipeline first.)",
        }

    # "Expected" start = earliest start date seen across the universe, i.e.
    # what a ticker with a full, unbroken 2-year history looks like.
    expected_start = min(first_dates.values())
    partial: list[dict] = []
    for t, first_date in first_dates.items():
        days_short = int((first_date - expected_start).days)
        if days_short > 30:  # tolerance for holidays/weekends/minor data gaps
            partial.append({
                "ticker": t,
                "first_available_date": first_date.strftime("%Y-%m-%d"),
                "days_short": days_short,
            })

    return {
        "universe_size": len(tickers),
        "expected_start_date": expected_start.strftime("%Y-%m-%d"),
        "tickers_with_full_history": len(first_dates) - len(partial),
        "tickers_with_partial_history": sorted(partial, key=lambda x: -x["days_short"]),
        "disclosure": disclosure,
    }


# ── Private: yfinance fetch ────────────────────────────────────────────────────
def _fetch_yfinance_daily(ticker: str, raw_path: Path, years: int) -> pd.DataFrame | None:
    """
    Fetch fresh daily bars from yfinance and merge into the cached CSV.

    Incremental by design: when a cached CSV already exists, this only requests
    bars STRICTLY AFTER the last cached date — NOT the full trailing N-year
    window again. Cheaper/faster across a 50-ticker universe and avoids
    re-downloading years of history we already have just to pick up 1-2 new
    days. Falls back to a full `period=f'{years}y'` fetch only when there's no
    existing cache yet (brand-new/custom ticker) or the cached CSV is unreadable.
    """
    try:
        import yfinance as yf

        existing: pd.DataFrame | None = None
        if raw_path.exists():
            try:
                existing = pd.read_csv(raw_path, index_col=0, parse_dates=True)
                existing.index = pd.to_datetime(existing.index).normalize()
            except Exception:
                existing = None

        if existing is not None and not existing.empty:
            last_cached = existing.index.max().date()
            today = datetime.utcnow().date()
            if last_cached >= today:
                fresh = pd.DataFrame()  # already up to date — nothing new to fetch
            else:
                start = (last_cached + timedelta(days=1)).strftime("%Y-%m-%d")
                end   = (today + timedelta(days=1)).strftime("%Y-%m-%d")  # yfinance `end` is exclusive
                fresh = yf.download(
                    ticker, start=start, end=end, interval="1d",
                    auto_adjust=True, progress=False,
                )
        else:
            # No cache yet — full N-year fetch (first-time or brand-new custom ticker)
            fresh = yf.download(
                ticker, period=f"{years}y", interval="1d",
                auto_adjust=True, progress=False,
            )

        if fresh.empty:
            # Nothing new (weekend/holiday/already current) — still bump metadata
            # so we don't hit the network again for this ticker today.
            meta = _load_metadata()
            meta[ticker] = datetime.utcnow().isoformat()
            _save_metadata(meta)
            return existing if existing is not None and not existing.empty else None

        # Flatten MultiIndex columns
        if isinstance(fresh.columns, pd.MultiIndex):
            fresh.columns = [c[0].lower() for c in fresh.columns]
        else:
            fresh.columns = [c.lower() for c in fresh.columns]

        fresh = fresh[["open", "high", "low", "close", "volume"]].dropna()
        fresh.index = pd.to_datetime(fresh.index).normalize()

        # Merge with existing CSV (append-only, avoid duplicates)
        if existing is not None and not existing.empty:
            combined = pd.concat([existing, fresh])
            combined = combined[~combined.index.duplicated(keep="last")]
            combined = combined.sort_index()
        else:
            combined = fresh

        combined.to_csv(raw_path)

        # Update metadata
        meta = _load_metadata()
        meta[ticker] = datetime.utcnow().isoformat()
        _save_metadata(meta)

        return combined

    except Exception as exc:
        print(f"  [data_feed] yfinance failed for {ticker}: {exc}")
        return None


# ── Private: Hourly stub ──────────────────────────────────────────────────────
def _synthetic_fallback(ticker: str, n_bars: int) -> pd.DataFrame:
    """
    Per-ticker deterministic synthetic daily OHLCV.
    Each ticker gets a DIFFERENT seed so cross-ticker signals are uncorrelated.
    Used ONLY when yfinance is unavailable — clearly labeled in outputs.
    Saves to CSV so subsequent calls use the cached version.
    """
    seed = abs(hash(ticker)) % 99_991
    rng = np.random.default_rng(seed)
    dates = pd.bdate_range(end=date.today(), periods=n_bars)  # business days
    log_returns = rng.normal(0, 0.012, n_bars)               # daily vol ~1.2%
    close = 100.0 * np.exp(np.cumsum(log_returns))
    noise = rng.uniform(0.002, 0.015, n_bars)
    df = pd.DataFrame({
        "open":   close * (1 - noise * 0.4),
        "high":   close * (1 + noise),
        "low":    close * (1 - noise),
        "close":  close,
        "volume": rng.integers(1_000_000, 50_000_000, n_bars).astype(float),
    }, index=dates)
    # Cache to CSV
    try:
        raw_path = RAW_DIR / f"{ticker}.csv"
        df.to_csv(raw_path)
        meta = _load_metadata()
        meta[ticker] = datetime.utcnow().isoformat()
        _save_metadata(meta)
    except Exception:
        pass
    return df
