"""
backend/main.py — AlphaFlow — Microstructure Alpha Engine | uvicorn backend.main:app --reload --port 8002

Endpoints
---------
GET  /health
GET  /api/info
POST /api/run         trigger pipeline (background)
GET  /api/history     last 20 runs
GET  /api/signals     latest signal
GET  /api/outputs     list PNGs + reports
GET  /api/outputs/{filename} serve output file
"""
from __future__ import annotations

# ── SSL fix — must be before any network import (yfinance, alpaca-py, httpx) ──
# pip-system-certs patches ssl at startup via macOS/Windows system keychain.
# The certifi block below ensures REQUESTS_CA_BUNDLE is set as a safety net.
try:
    import certifi as _certifi, os as _os
    _os.environ.setdefault("SSL_CERT_FILE", _certifi.where())
    _os.environ.setdefault("REQUESTS_CA_BUNDLE", _certifi.where())
except ImportError:
    pass

import sys, traceback, json, os, asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    import pandas as pd  # noqa: F401  — for type-hint resolution only; real imports stay function-local

ROOT = Path(__file__).parent.parent
WORKSPACE = ROOT.parent
for _p in [str(ROOT), str(WORKSPACE)]:
    if _p not in sys.path:
        sys.path.insert(0, _p)

from fastapi import FastAPI, HTTPException, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from backend.database import (init_db, start_run, finish_run, get_run_history,
                              get_active_run,
                              get_latest_signal, upsert_signal,
                              get_latest_signals_by_ticker, get_run_signals,
                              delete_signals_for_inactive_tickers,
                              save_paper_trade, get_paper_trades,
                              save_alpha_decay, get_alpha_decay_db)

init_db()


_scheduler_ref: Any = None  # set by lifespan() when SCHEDULER_ENABLED=true; read by /api/scheduler/status

# Live per-ticker progress for the currently-running (or last-run) DAILY
# pipeline. Mirrors _intraday_progress below. The Daily LangGraph pipeline has
# 3 sequential per-ticker stages (fetch_data, compute_features, llm_interpret)
# so `stage` identifies which one is currently advancing; `done`/`total`/
# `completed` reset each time the stage changes. Polled by the frontend
# (GET /api/daily/progress) so the UI can show real incremental
# "stage X — N/50 tickers" feedback instead of a static "running…" spinner.
_daily_progress: dict = {
    "running": False, "stage": None, "total": 0, "done": 0, "current": None, "completed": [],
}


@asynccontextmanager
async def lifespan(_app: "FastAPI"):  # type: ignore[name-defined]
    """APScheduler cron — only activates when SCHEDULER_ENABLED=true in .env.

    Three independent weekday jobs, all using the America/New_York timezone
    (DST-safe via zoneinfo — a fixed UTC cron would be off by 1 hour for half
    the year, since US clocks shift between EST/UTC-5 and EDT/UTC-4):

      1. Daily signal engine  (LangGraph z-score pipeline) — 9:35 AM ET
         (market open + 5min buffer). Computes off the prior session's
         finalized close, since "today's" daily bar doesn't exist until
         today's close — this is the standard quant workflow of generating
         a signal overnight and trading it at the next open, not a bug.
      2. Hourly signal engine (LightGBM walk-forward)      — every hour
         10:35 AM through 4:35 PM ET (7 fires/day), ~5min after each hourly
         bar closes so the data provider has finalized it. Not run outside
         market hours: no new bar exists then, so it would just recompute
         on identical data and burn free-tier API quota for nothing.
      3. Nightly data refresh (yfinance 2yr daily bars)    — 9:30 PM ET,
         well after close, so the day's final daily bar is captured.

    All three skip themselves (log + return) if a run of that same kind is
    already in progress, so a scheduled fire can never collide with a
    manually-triggered run from the dashboard.
    """
    global _scheduler_ref
    if os.getenv("SCHEDULER_ENABLED", "false").lower() == "true":
        try:
            from zoneinfo import ZoneInfo
            from apscheduler.schedulers.asyncio import AsyncIOScheduler
            from apscheduler.triggers.cron import CronTrigger

            et = ZoneInfo("America/New_York")

            def _daily_signals():
                """Weekdays 9:35 AM ET: Daily/LangGraph z-score pipeline."""
                try:
                    if get_active_run():
                        print("[scheduler] daily signals skipped — a run is already in progress")
                        return
                    print("[scheduler] daily signal engine started")
                    run_id = start_run()
                    _run_pipeline_bg(run_id)
                    print("[scheduler] daily signal engine done")
                except Exception as exc:
                    print(f"[scheduler] daily signals error: {exc}")

            def _hourly_signals():
                """Weekdays 10:35 AM – 4:35 PM ET, on the hour: Hourly/intraday pipeline."""
                global _intraday_running
                try:
                    if _intraday_running:
                        print("[scheduler] hourly signals skipped — a run is already in progress")
                        return
                    from alpha_flow.config.settings import get_all_tickers
                    tickers = get_all_tickers()
                    _intraday_running = True
                    _intraday_progress.update(running=True, total=len(tickers), done=0, current=None, completed=[])
                    print("[scheduler] hourly signal engine started")
                    _execute_intraday_pipeline_sync(tickers)
                    print("[scheduler] hourly signal engine done")
                except Exception as exc:
                    print(f"[scheduler] hourly signals error: {exc}")

            def _nightly_refresh():
                """Weekdays 9:30 PM ET: refresh 2yr daily bars (yfinance) only — no signal computation."""
                try:
                    import time
                    t0 = time.time()
                    print("[scheduler] nightly data refresh started")
                    from alpha_flow.config.settings import get_all_tickers
                    from alpha_flow.data.data_feed import refresh_all_tickers
                    refresh_all_tickers(get_all_tickers())
                    print(f"[scheduler] nightly data refresh done in {time.time()-t0:.1f}s")
                except Exception as exc:
                    print(f"[scheduler] nightly refresh error: {exc}")

            scheduler = AsyncIOScheduler()
            scheduler.add_job(_daily_signals, CronTrigger(day_of_week="mon-fri", hour=9, minute=35, timezone=et), id="daily_signals", name="Daily signal engine (9:35 AM ET)")
            scheduler.add_job(_hourly_signals, CronTrigger(day_of_week="mon-fri", hour="10-16", minute=35, timezone=et), id="hourly_signals", name="Hourly signal engine (10:35-16:35 ET)")
            scheduler.add_job(_nightly_refresh, CronTrigger(day_of_week="mon-fri", hour=21, minute=30, timezone=et), id="nightly_refresh", name="Nightly data refresh (9:30 PM ET)")
            scheduler.start()
            _scheduler_ref = scheduler
            print("[scheduler] started — daily signals 9:35 AM ET · hourly signals 10:35 AM-4:35 PM ET · data refresh 9:30 PM ET (all weekdays, DST-aware)")
        except ImportError as exc:
            print(f"[scheduler] APScheduler not installed: {exc} — pip install apscheduler>=3.10.4")
        except Exception as exc:
            print(f"[scheduler] failed to start: {exc}")
    else:
        print("[scheduler] disabled — set SCHEDULER_ENABLED=true in .env to enable")
    yield  # app runs here


app = FastAPI(
    title="AlphaFlow — Microstructure Alpha Engine",
    description=(
        "Market microstructure signal engine. Computes OFI Z-score, Kyle price-impact λ, "
        "Amihud ILLIQ, Corwin-Schultz effective spread, VPIN flow toxicity, and Hawkes intensity. "
        "Hourly LightGBM walk-forward validation. Paper execution via Alpaca."
    ),
    version="3.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        o.strip()
        for o in os.getenv(
            "ALLOWED_ORIGINS",
            "http://localhost:3002,http://127.0.0.1:3002,http://localhost:5173"
        ).split(",")
        if o.strip()
    ],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

OUTPUTS_DIR = ROOT / "outputs"
FIGURES_DIR = OUTPUTS_DIR / "figures"


def _generate_charts(snapshots: dict, ic_by_ticker: dict) -> None:
    """Generate all 4 output charts from pipeline state + cached daily data."""
    try:
        import numpy as np
        import pandas as pd
        from alpha_flow.data.data_feed import get_daily_bars
        from alpha_flow.config.settings import get_all_tickers
        from alpha_flow.core.ofi_calculator import rolling_ofi_zscore
        from alpha_flow.core.amihud import amihud_ratio, kyle_lambda as kyle_lambda_fn
        from alpha_flow.core.spread_tracker import corwin_schultz_spread
        from alpha_flow.analysis.figures import (
            plot_ofi_zscore_chart, plot_execution_quality,
            plot_kyle_lambda_trend, plot_alpha_decay, save_microstructure_report,
        )
        from scipy.stats import spearmanr

        ofi_by_ticker: dict = {}
        all_eff, all_amihud, all_kyle = [], [], []
        ic_lags: dict = {}
        ic_values: list = []

        for ticker in get_all_tickers():
            try:
                df = get_daily_bars(ticker, years=2)
                if len(df) < 30:
                    continue
                ofi_z = rolling_ofi_zscore(df)
                eff   = corwin_schultz_spread(df)
                ami   = amihud_ratio(df)
                kl    = kyle_lambda_fn(df)

                if ofi_z is not None and not ofi_z.dropna().empty:
                    ofi_by_ticker[ticker] = ofi_z
                if eff is not None and not eff.dropna().empty:
                    all_eff.append(eff)
                if ami is not None and not ami.dropna().empty:
                    all_amihud.append(ami)
                if kl is not None and not kl.dropna().empty:
                    all_kyle.append(kl)

                # IC values for report metric
                ic_v = ic_by_ticker.get(ticker, 0.0)
                if ic_v and not np.isnan(ic_v):
                    ic_values.append(ic_v)
            except Exception:
                pass

        # Chart 1: OFI time-series
        if ofi_by_ticker:
            plot_ofi_zscore_chart(ofi_by_ticker)

        # Chart 2: Execution quality
        eff_s = pd.concat(all_eff).sort_index() if all_eff else None
        ami_s = pd.concat(all_amihud).sort_index() if all_amihud else None
        plot_execution_quality(eff_s * 10_000 if eff_s is not None else None, ami_s)

        # Chart 3: Kyle lambda trend (use first ticker's series)
        kyl_s = pd.concat(all_kyle).sort_index() if all_kyle else pd.Series(dtype=float)
        if not kyl_s.empty:
            plot_kyle_lambda_trend(kyl_s)

        # Chart 4: Alpha decay (IC at lags 1-10 on first ticker)
        first_ticker = get_all_tickers()[0]
        first_df = get_daily_bars(first_ticker, years=2)
        if len(first_df) >= 80:
            ofi_z = rolling_ofi_zscore(first_df).dropna()
            ic_decay = {}
            for lag in range(1, 11):
                fwd = first_df["close"].pct_change(lag).shift(-lag)
                common = ofi_z.index.intersection(fwd.dropna().index)
                if len(common) >= 20:
                    ic_val, _ = spearmanr(ofi_z.loc[common], fwd.loc[common])
                    ic_decay[lag] = 0.0 if np.isnan(ic_val) else float(ic_val)
                else:
                    ic_decay[lag] = 0.0
            plot_alpha_decay(ic_decay)

        # Save report JSON
        eff_mean = float(eff_s.mean() * 10_000) if eff_s is not None else 0.0
        ami_mean = float(ami_s.mean()) if ami_s is not None else 0.0
        kyl_mean = float(kyl_s.abs().mean()) if not kyl_s.empty else 0.0
        ofi_mean_ic = float(np.mean(ic_values)) if ic_values else 0.0
        save_microstructure_report(eff_mean, ami_mean, kyl_mean, ofi_mean_ic)

    except Exception as exc:
        print(f"[chart gen] error: {exc}")
        import traceback as tb; tb.print_exc()


def _run_pipeline_bg(run_id: int) -> None:
    _daily_progress.update(running=True, stage=None, total=0, done=0, current=None, completed=[])

    def _on_ticker_done(stage: str, ticker: str, idx: int, total: int) -> None:
        if _daily_progress.get("stage") != stage:
            _daily_progress["stage"] = stage
            _daily_progress["done"] = 0
            _daily_progress["completed"] = []
        _daily_progress["total"] = total
        _daily_progress["done"] = idx
        _daily_progress["current"] = ticker
        _daily_progress["completed"].append(ticker)

    try:
        # ── Step 0: purge DB rows for any tickers removed since last run ──────
        try:
            delete_signals_for_inactive_tickers()
        except Exception as _e:
            print(f"[pipeline] db cleanup skipped: {_e}")

        from alpha_flow.agent.langgraph_flow import run
        final = run(on_ticker_done=_on_ticker_done)

        snapshots           = final.get("snapshots", {}) if final else {}
        llm_signals         = final.get("llm_signals", {}) if final else {}
        ic_by_ticker        = final.get("ic_by_ticker", {}) if final else {}

        for t, snap in snapshots.items():
            sig_info = llm_signals.get(t, {})
            upsert_signal(
                ticker=t,
                ofi=snap.get("ofi_zscore", 0.0),
                kyle_lambda=snap.get("kyle_lambda", 0.0),
                amihud=snap.get("amihud", 0.0),
                eff_spread=snap.get("cs_spread", 0.0) * 10_000,
                signal=sig_info.get("signal", "HOLD"),
                run_id=run_id,
                llm_reason=sig_info.get("reason", ""),
                ic_value=ic_by_ticker.get(t),
            )

        # Generate all charts from cached daily data
        _generate_charts(snapshots, ic_by_ticker)

        # ── Capture data date range for UI card title ─────────────────────────
        data_start_str: str | None = None
        data_end_str:   str | None = None
        total_bars_val: int = 0
        try:
            from alpha_flow.data.data_feed import get_daily_bars
            from alpha_flow.config.settings import get_all_tickers
            import pandas as _pd
            _dates_min, _dates_max, _bar_counts = [], [], []
            for _t in get_all_tickers():
                _df = get_daily_bars(_t)
                if not _df.empty:
                    _dates_min.append(_df.index.min())
                    _dates_max.append(_df.index.max())
                    _bar_counts.append(len(_df))
            if _dates_min:
                data_start_str = _pd.Timestamp(min(_dates_min)).strftime("%Y-%m-%d")
                data_end_str   = _pd.Timestamp(max(_dates_max)).strftime("%Y-%m-%d")
                total_bars_val = int(sum(_bar_counts) // len(_bar_counts))  # avg bars/ticker
        except Exception as _e:
            print(f"[pipeline] date range capture failed: {_e}")

        # Daily runs carry no portfolio Sharpe/DD — those are Hourly-resolution
        # metrics (walk-forward equity curve). Persist run metadata only.
        finish_run(run_id, status="ok", data_start=data_start_str,
                   data_end=data_end_str, total_bars=total_bars_val)
    except Exception as exc:
        traceback.print_exc()
        finish_run(run_id, status="error", error_msg=str(exc))
    finally:
        _daily_progress["running"] = False


@app.get("/health", tags=["system"])
def health():
    from alpha_flow.config.settings import ALPACA_API_KEY, ALPACA_BASE_URL
    alpaca_status = "configured" if ALPACA_API_KEY else "not_configured"
    return {
        "status": "ok",
        "project": "AlphaFlow — Microstructure Alpha Engine",
        "alpaca": alpaca_status,
        "alpaca_url": ALPACA_BASE_URL if ALPACA_API_KEY else None,
    }


@app.get("/api/info", tags=["system"])
def info() -> dict[str, Any]:
    return {
        "title": "AlphaFlow — Microstructure Alpha Engine",
        "description": "Order Flow Imbalance, Kyle λ, Amihud ILLIQ, LightGBM alpha prediction. References: Kyle (1985), Amihud (2002), Lee & Ready (1991).",
        "endpoints": ["/api/run", "/api/history", "/api/signals", "/api/outputs"],
    }


@app.get("/api/scheduler/status", tags=["system"])
def scheduler_status() -> dict:
    """
    Introspect the APScheduler cron jobs — proves whether Daily/Hourly are
    genuinely auto-triggering on a timer (not waiting on a manual click) and
    shows each job's next scheduled fire time in both ET and UTC.
    """
    enabled = os.getenv("SCHEDULER_ENABLED", "false").lower() == "true"
    if not enabled or _scheduler_ref is None:
        return {"enabled": False, "jobs": []}
    jobs = []
    for job in _scheduler_ref.get_jobs():
        next_run = job.next_run_time
        jobs.append({
            "id": job.id,
            "name": job.name,
            "next_run_et": next_run.strftime("%Y-%m-%d %H:%M %Z") if next_run else None,
            "next_run_utc": next_run.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC") if next_run else None,
        })
    return {"enabled": True, "jobs": jobs}


@app.get("/api/universe/metadata", tags=["system"])
def universe_metadata() -> dict:
    """
    Survivorship-bias diagnostic for the current trading universe.
    Read-only, no side effects. See check_universe_survivorship() docstring
    for methodology and disclosed limitations.
    """
    from alpha_flow.data.data_feed import check_universe_survivorship
    return check_universe_survivorship()


@app.post("/api/run", tags=["pipeline"])
def trigger_run(background_tasks: BackgroundTasks) -> dict:
    active = get_active_run()
    if active:
        return {
            "status": "already_running", "run_id": active["id"],
            "message": f"A daily pipeline run (id={active['id']}) is already in progress. Poll /api/history for status.",
            "started_at": active["started_at"],
        }
    run_id = start_run()
    background_tasks.add_task(_run_pipeline_bg, run_id)
    return {
        "status": "started", "run_id": run_id,
        "message": "Pipeline started. Poll /api/history for status.",
        "started_at": datetime.utcnow().isoformat(),
    }


@app.get("/api/run", tags=["pipeline"])
def trigger_run_get(background_tasks: BackgroundTasks) -> dict:
    return trigger_run(background_tasks)


@app.post("/api/data/refresh", tags=["pipeline"])
def refresh_data(background_tasks: BackgroundTasks) -> dict:
    """Re-fetch 2-year daily bars for all tickers only. Does NOT run the intraday pipeline — use POST /api/intraday/run for that."""
    def _refresh_bg():
        import time
        t0 = time.time()
        from alpha_flow.config.settings import get_all_tickers
        from alpha_flow.data.data_feed import refresh_all_tickers
        tickers = get_all_tickers()
        refresh_all_tickers(tickers)
        print(f"[data refresh] daily OHLCV refreshed in {time.time()-t0:.1f}s — {len(tickers)} tickers")
    background_tasks.add_task(_refresh_bg)
    return {"status": "started", "message": "Refreshing 2yr daily OHLCV data only (~30s). Use Run Alpha Engine to recompute signals."}


@app.get("/api/daily/progress", tags=["pipeline"])
def daily_progress() -> dict:
    """
    Live per-ticker progress for the currently-running (or last-completed)
    Daily pipeline run. `stage` is one of fetch_data / compute_features /
    llm_interpret — the 3 sequential per-ticker stages of the LangGraph
    pipeline. Poll while `running` is true to show real incremental
    "stage — N/50 tickers" feedback, whether triggered from the UI button,
    curl, or the scheduler.
    """
    return _daily_progress


@app.get("/api/history", tags=["pipeline"])
def run_history(limit: int = Query(20, ge=1, le=100)) -> list[dict]:
    return get_run_history(limit)


@app.get("/api/signals", tags=["signals"])
def get_signal() -> dict:
    row = get_latest_signal()
    return row or {"message": "NO_DATA — run the pipeline first"}


@app.get("/api/signals/all", tags=["signals"])
def get_all_signals() -> list[dict] | dict:
    """Return the latest signal for each ACTIVE ticker (default + current custom)."""
    from alpha_flow.config.settings import get_all_tickers
    rows = get_latest_signals_by_ticker()
    if not rows:
        return {"message": "NO_DATA — run the pipeline first"}
    active = set(get_all_tickers())
    return [r for r in rows if r.get("ticker") in active]


@app.get("/api/history/{run_id}/signals", tags=["pipeline"])
def run_signals(run_id: int) -> list[dict]:
    """Return all ticker signals recorded for a specific run."""
    return get_run_signals(run_id)


@app.get("/api/outputs", tags=["outputs"])
def list_outputs() -> dict:
    figures = sorted(
        p.name for p in FIGURES_DIR.glob("*.png") if FIGURES_DIR.exists()
    ) if FIGURES_DIR.exists() else []
    reports = []
    if OUTPUTS_DIR.exists():
        for ext in ("*.json", "*.csv"):
            reports.extend(p.name for p in OUTPUTS_DIR.glob(ext))
    reports = [r for r in sorted(reports) if "microstructure_report" in r and r.endswith(".json")]
    return {"figures": figures, "reports": reports}


@app.get("/api/data/{ticker}/csv", tags=["data"])
def download_ticker_csv(ticker: str) -> FileResponse:
    """Serve raw 2-year daily OHLCV CSV for a single ticker."""
    from alpha_flow.config.settings import get_all_tickers
    t = ticker.strip().upper()
    if t not in get_all_tickers():
        raise HTTPException(400, f"Unknown ticker '{t}' — not in the tracked universe.")
    csv_path = ROOT / "data" / "raw" / f"{t}.csv"
    if not csv_path.exists():
        raise HTTPException(404, f"No data file for {t} — run pipeline first to generate data.")
    return FileResponse(str(csv_path), media_type="text/csv", filename=f"{t}_2yr_daily.csv")


@app.post("/api/tickers/add", tags=["data"])
async def add_custom_ticker(body: dict) -> dict:
    """
    Validate a ticker symbol via yfinance, download 2-year daily OHLCV,
    save to raw CSV cache, and persist the ticker to custom_tickers.json.
    The new ticker is included in all subsequent pipeline runs automatically.
    """
    import re
    ticker = str(body.get("ticker") or "").strip().upper()
    if not ticker or not re.match(r"^[A-Z]{1,8}$", ticker):
        raise HTTPException(400, f"Invalid ticker symbol '{ticker}' — use 1-8 letters (e.g. MSFT)")
    try:
        import yfinance as yf
        yf_obj = yf.Ticker(ticker)
        hist = yf_obj.history(period="2y", auto_adjust=True)
    except Exception as exc:
        raise HTTPException(502, f"yfinance error fetching {ticker}: {exc}")
    if hist is None or hist.empty:
        raise HTTPException(404, f"No price data found for '{ticker}' — check the symbol is listed on a major exchange")
    # Fetch name and sector from yfinance info (best-effort; fall back gracefully)
    try:
        info = yf_obj.info or {}
        yf_name = info.get("longName") or info.get("shortName") or ticker
        raw_sector = info.get("sector") or info.get("quoteType") or "Equity"
        # Map yfinance sector labels to clean display labels
        _SECTOR_MAP = {
            "Financial Services": "Financials", "Technology": "Technology",
            "Consumer Cyclical": "Consumer", "Consumer Defensive": "Consumer",
            "Healthcare": "Healthcare", "Energy": "Energy", "Industrials": "Industrials",
            "Communication Services": "Communications", "Basic Materials": "Materials",
            "Real Estate": "Real Estate", "Utilities": "Utilities",
            "EQUITY": "Equity", "ETF": "ETF", "MUTUALFUND": "Fund",
        }
        yf_sector = _SECTOR_MAP.get(raw_sector, raw_sector)
    except Exception:
        yf_name, yf_sector = ticker, "Equity"
    # Save OHLCV CSV
    save_dir = ROOT / "data" / "raw"
    save_dir.mkdir(parents=True, exist_ok=True)
    csv_path = save_dir / f"{ticker}.csv"
    hist.reset_index().to_csv(csv_path, index=False)
    # Persist to custom_tickers.json with name + sector metadata
    from alpha_flow.config.settings import TICKERS as DEFAULT_TICKERS, _CUSTOM_TICKERS_FILE
    if ticker not in DEFAULT_TICKERS:
        _CUSTOM_TICKERS_FILE.parent.mkdir(parents=True, exist_ok=True)
        existing_data: dict = {"tickers": []}
        if _CUSTOM_TICKERS_FILE.exists():
            try:
                existing_data = json.loads(_CUSTOM_TICKERS_FILE.read_text())
            except Exception:
                existing_data = {"tickers": []}
        # Store as list of dicts with metadata
        tickers_list = existing_data.get("tickers", [])
        # Convert legacy format (list of strings) to list of dicts
        if tickers_list and isinstance(tickers_list[0], str):
            tickers_list = [{"ticker": t, "name": t, "sector": "Equity"} for t in tickers_list]
        if not any(e["ticker"] == ticker for e in tickers_list):
            tickers_list.append({"ticker": ticker, "name": yf_name, "sector": yf_sector})
        existing_data["tickers"] = tickers_list
        _CUSTOM_TICKERS_FILE.write_text(json.dumps(existing_data, indent=2))
    # Immediately compute a daily microstructure snapshot so the ticker appears in daily signals
    snapshot_note = ""
    try:
        from alpha_flow.data.data_feed import get_daily_bars as _gdb
        from alpha_flow.core.ofi_calculator import rolling_ofi_zscore as _ofi_z
        from alpha_flow.core.amihud import amihud_ratio as _amihud, kyle_lambda as _kl
        from alpha_flow.core.spread_tracker import corwin_schultz_spread as _cs
        from backend.database import upsert_signal as _upsert, start_run as _sr, finish_run as _fr
        _df = _gdb(ticker)
        if len(_df) >= 50:
            _ofi_series = _ofi_z(_df).dropna().tail(20)
            _am = _amihud(_df).dropna().tail(20)
            _kl_s = _kl(_df).dropna().tail(20)
            _sp = _cs(_df).dropna().tail(20)
            _ofi_val   = float(_ofi_series.mean()) if len(_ofi_series) > 0 else 0.0
            _am_val    = float(_am.mean())          if len(_am) > 0 else 0.0
            _kl_val    = float(_kl_s.mean())        if len(_kl_s) > 0 else 0.0
            _sp_val    = float(_sp.mean() * 10_000) if len(_sp) > 0 else 0.0
            _run_id = _sr()
            _upsert(
                ticker=ticker,
                ofi=_ofi_val,
                kyle_lambda=abs(_kl_val),
                amihud=_am_val,
                eff_spread=_sp_val,
                signal="HOLD",
                run_id=_run_id,
                llm_reason=f"Initial snapshot ({yf_name}, {yf_sector}). Run Compute EOD Signals for full LLM analysis.",
                ic_value=0.0,
            )
            _fr(_run_id, status="ok",
                data_start=str(_df.index[0].date()), data_end=str(_df.index[-1].date()),
                total_bars=len(_df))
            snapshot_note = " · Initial microstructure snapshot saved — visible in daily signals now."
    except Exception as _snap_err:
        print(f"[add_ticker] snapshot error for {ticker}: {_snap_err}")
        snapshot_note = " · Re-run pipeline to include in analysis."
    return {
        "ticker": ticker, "bars": len(hist), "saved": csv_path.name,
        "name": yf_name, "sector": yf_sector,
        "message": f"Downloaded {len(hist)} bars for {ticker} ({yf_name}, {yf_sector}).{snapshot_note}",
    }


@app.get("/api/tickers", tags=["data"])
def list_all_tickers() -> list[dict]:
    """Return all tickers (default + custom) with name, sector, and is_custom flag."""
    from alpha_flow.config.settings import TICKERS as DEFAULT_TICKERS, _CUSTOM_TICKERS_FILE
    # Covers the full 50-ticker hourly universe (see alpha_flow/config/settings.py TICKERS),
    # not just the original 10-ticker Daily universe — sector labels match frontend SECTOR_COLOR keys.
    _META: dict[str, tuple[str, str]] = {
        # Technology — megacap internet, enterprise software
        "AAPL": ("Apple Inc.", "Technology"), "MSFT": ("Microsoft Corp.", "Technology"),
        "META": ("Meta Platforms", "Technology"), "GOOGL": ("Alphabet Inc.", "Technology"),
        "AMZN": ("Amazon.com", "Technology"), "ORCL": ("Oracle Corp.", "Technology"),
        # Semiconductors
        "NVDA": ("NVIDIA Corp.", "Semiconductors"), "AVGO": ("Broadcom Inc.", "Semiconductors"),
        "AMD": ("Advanced Micro Devices", "Semiconductors"), "INTC": ("Intel Corp.", "Semiconductors"),
        "TSM": ("Taiwan Semiconductor", "Semiconductors"),
        # Financials — money-centre banks, asset managers, card networks
        "JPM": ("JPMorgan Chase", "Financials"), "BAC": ("Bank of America", "Financials"),
        "V": ("Visa Inc.", "Financials"), "GS": ("Goldman Sachs", "Financials"),
        "WFC": ("Wells Fargo", "Financials"), "MS": ("Morgan Stanley", "Financials"),
        "BLK": ("BlackRock Inc.", "Financials"), "C": ("Citigroup Inc.", "Financials"),
        "AXP": ("American Express", "Financials"), "MA": ("Mastercard Inc.", "Financials"),
        # Healthcare — pharma, managed care, medtech, PBM
        "JNJ": ("Johnson & Johnson", "Healthcare"), "UNH": ("UnitedHealth Group", "Healthcare"),
        "LLY": ("Eli Lilly and Co.", "Healthcare"), "PFE": ("Pfizer Inc.", "Healthcare"),
        "ABBV": ("AbbVie Inc.", "Healthcare"), "MRK": ("Merck & Co.", "Healthcare"),
        "TMO": ("Thermo Fisher Scientific", "Healthcare"),
        # Consumer (discretionary + staples)
        "TSLA": ("Tesla Inc.", "Consumer"), "HD": ("Home Depot", "Consumer"),
        "MCD": ("McDonald's Corp.", "Consumer"), "NKE": ("Nike Inc.", "Consumer"),
        "SBUX": ("Starbucks Corp.", "Consumer"), "KO": ("Coca-Cola Co.", "Consumer"),
        "PEP": ("PepsiCo Inc.", "Consumer"), "WMT": ("Walmart Inc.", "Consumer"),
        "COST": ("Costco Wholesale", "Consumer"),
        # Energy
        "XOM": ("Exxon Mobil Corp.", "Energy"), "CVX": ("Chevron Corp.", "Energy"),
        "COP": ("ConocoPhillips", "Energy"), "EOG": ("EOG Resources", "Energy"),
        # Industrials
        "CAT": ("Caterpillar Inc.", "Industrials"), "HON": ("Honeywell Intl.", "Industrials"),
        "BA": ("Boeing Co.", "Industrials"), "RTX": ("RTX Corp.", "Industrials"),
        "GE": ("GE Aerospace", "Industrials"),
        # Communication Services
        "DIS": ("Walt Disney Co.", "Communications"), "T": ("AT&T Inc.", "Communications"),
        "VZ": ("Verizon Communications", "Communications"), "NFLX": ("Netflix Inc.", "Communications"),
    }
    # Load custom ticker metadata
    custom_meta: dict[str, tuple[str, str]] = {}
    if _CUSTOM_TICKERS_FILE.exists():
        try:
            data = json.loads(_CUSTOM_TICKERS_FILE.read_text())
            tickers_raw = data.get("tickers", [])
            if tickers_raw and isinstance(tickers_raw[0], dict):
                for entry in tickers_raw:
                    t = entry.get("ticker", "")
                    if t:
                        custom_meta[t] = (entry.get("name", t), entry.get("sector", "Equity"))
            else:
                # Legacy plain list
                for t in tickers_raw:
                    if isinstance(t, str):
                        custom_meta[t] = (t, "Equity")
        except Exception:
            pass
    result = []
    for t in DEFAULT_TICKERS:
        name, sector = _META.get(t, (t, "Equity"))
        result.append({"ticker": t, "name": name, "sector": sector, "is_custom": False})
    for t, (name, sector) in custom_meta.items():
        if t not in DEFAULT_TICKERS:
            result.append({"ticker": t, "name": name, "sector": sector, "is_custom": True})
    return result


@app.delete("/api/tickers/{ticker}", tags=["data"])
def delete_custom_ticker(ticker: str) -> dict:
    """Remove a custom ticker (default 10 cannot be deleted)."""
    from alpha_flow.config.settings import TICKERS as DEFAULT_TICKERS, _CUSTOM_TICKERS_FILE
    t = ticker.strip().upper()
    if t in DEFAULT_TICKERS:
        raise HTTPException(403, f"'{t}' is a default ticker and cannot be deleted")
    if not _CUSTOM_TICKERS_FILE.exists():
        raise HTTPException(404, f"'{t}' not found in custom tickers")
    try:
        data = json.loads(_CUSTOM_TICKERS_FILE.read_text())
    except Exception:
        raise HTTPException(500, "Could not read custom_tickers.json")
    tickers_raw = data.get("tickers", [])
    # Handle both legacy (list of strings) and new (list of dicts) formats
    if tickers_raw and isinstance(tickers_raw[0], dict):
        if not any(e.get("ticker") == t for e in tickers_raw):
            raise HTTPException(404, f"'{t}' not found in custom tickers")
        tickers_raw = [e for e in tickers_raw if e.get("ticker") != t]
        remaining = [e["ticker"] for e in tickers_raw]
    else:
        if t not in tickers_raw:
            raise HTTPException(404, f"'{t}' not found in custom tickers")
        tickers_raw.remove(t)
        remaining = list(tickers_raw)
    data["tickers"] = tickers_raw
    _CUSTOM_TICKERS_FILE.write_text(json.dumps(data, indent=2))
    # Remove CSV if present
    csv_path = ROOT / "data" / "raw" / f"{t}.csv"
    if csv_path.exists():
        csv_path.unlink()
    # Remove parquet files from data/ticks/
    ticks_dir = ROOT / "data" / "ticks"
    removed_files: list[str] = []
    if ticks_dir.exists():
        for pf in ticks_dir.glob(f"{t}_*.parquet"):
            pf.unlink()
            removed_files.append(pf.name)
    # Remove all DB entries for this ticker
    import sqlite3 as _sqlite3
    db_path = ROOT / "data" / "app.db"
    if db_path.exists():
        try:
            _conn = _sqlite3.connect(str(db_path))
            for _tbl in ("microstructure_signals", "intraday_signals", "shap_importance", "paper_trades", "alpha_decay"):
                try:
                    _conn.execute(f"DELETE FROM {_tbl} WHERE ticker = ?", (t,))
                except Exception:
                    pass
            _conn.commit()
            _conn.close()
        except Exception as _e:
            print(f"[delete_ticker] DB cleanup error: {_e}")
    return {"deleted": t, "remaining_custom": remaining, "files_removed": removed_files}


# ── Interactive chart data endpoints ─────────────────────────────────────────

@app.get("/api/data/execution-quality", tags=["data"])
def execution_quality_data() -> dict:
    """Per-ticker Corwin-Schultz spread (bps) and Amihud ILLIQ timeseries for Recharts."""
    import numpy as np
    import pandas as pd
    from alpha_flow.config.settings import get_all_tickers as _gat
    from alpha_flow.data.data_feed import get_daily_bars
    from alpha_flow.core.spread_tracker import corwin_schultz_spread
    from alpha_flow.core.amihud import amihud_ratio
    result: dict = {"spread": {}, "amihud": {}}
    for t in _gat():
        try:
            df = get_daily_bars(t)
            sp = corwin_schultz_spread(df).dropna()
            am = amihud_ratio(df).dropna()
            result["spread"][t] = [
                {"date": str(i.date()), "value": round(float(v) * 10_000, 4)}
                for i, v in sp.items() if not np.isnan(v)
            ]
            result["amihud"][t] = [
                {"date": str(i.date()), "value": float(v)}
                for i, v in am.items() if not np.isnan(v)
            ]
        except Exception:
            pass
    return result


@app.get("/api/data/kyle-lambda", tags=["data"])
def kyle_lambda_data() -> dict:
    """Per-ticker Kyle lambda timeseries (daily + 30-day rolling mean) for Recharts."""
    import numpy as np
    import pandas as pd
    from alpha_flow.config.settings import get_all_tickers as _gat
    from alpha_flow.data.data_feed import get_daily_bars
    from alpha_flow.core.amihud import kyle_lambda as kl_fn
    result: dict = {}
    for t in _gat():
        try:
            df = get_daily_bars(t)
            kl = kl_fn(df).dropna()
            roll = kl.rolling(30, min_periods=5).mean()
            combined = pd.DataFrame({"lambda": kl, "roll30": roll}).dropna(subset=["lambda"])
            result[t] = [
                {"date": str(idx.date()),
                 "lambda": None if np.isnan(row["lambda"]) else round(float(row["lambda"]), 10),
                 "roll30": None if np.isnan(row["roll30"]) else round(float(row["roll30"]), 10)}
                for idx, row in combined.iterrows()
            ]
        except Exception:
            pass
    return result


@app.get("/api/data/alpha-decay", tags=["data"])
def alpha_decay_data() -> dict:
    """IC at lags 1-10 per ticker + cross-sectional average + bootstrap CI for the Alpha Decay chart."""
    import numpy as np
    from scipy.stats import spearmanr
    from alpha_flow.config.settings import get_all_tickers as _gat
    from alpha_flow.data.data_feed import get_daily_bars
    from alpha_flow.core.ofi_calculator import rolling_ofi_zscore
    from alpha_flow.analysis.alpha_decay import ic_half_life_with_ci
    by_ticker: dict[str, dict] = {}
    half_life_ci: dict[str, dict] = {}
    all_ic: dict[int, list] = {lag: [] for lag in range(1, 11)}
    for t in _gat():
        try:
            df = get_daily_bars(t)
            if len(df) < 80:
                continue
            ofi_z = rolling_ofi_zscore(df).dropna()
            ticker_ic: dict[int, float] = {}
            for lag in range(1, 11):
                fwd = df["close"].pct_change(lag).shift(-lag)
                common = ofi_z.index.intersection(fwd.dropna().index)
                if len(common) >= 20:
                    ic_val, _ = spearmanr(ofi_z.loc[common], fwd.loc[common])
                    val = 0.0 if np.isnan(ic_val) else round(float(ic_val), 4)
                    ticker_ic[lag] = val
                    all_ic[lag].append(val)
                else:
                    ticker_ic[lag] = 0.0
            by_ticker[t] = ticker_ic
            half_life_ci[t] = ic_half_life_with_ci(ticker_ic)
        except Exception:
            pass
    average = {lag: round(float(np.mean(vals)), 4) if vals else 0.0 for lag, vals in all_ic.items()}
    avg_ci  = ic_half_life_with_ci(average)
    return {"by_ticker": by_ticker, "average": average, "half_life_ci": half_life_ci, "avg_half_life_ci": avg_ci}


@app.get("/api/data/ofi-timeseries", tags=["data"])
def ofi_timeseries(
    tickers: str = Query(default=""),
    start: str = Query(default=""),
    end: str = Query(default=""),
    bars: int = Query(default=60),
) -> dict:
    """
    Return OFI Z-score time series for the requested tickers.
    Supports ?start=YYYY-MM-DD&end=YYYY-MM-DD (date range) or ?bars=N (last N bars).
    Response: { "AAPL": [{"date": "2024-07-01", "value": 1.23}, ...], ... }
    """
    from alpha_flow.config.settings import get_all_tickers as _get_all_tickers
    from alpha_flow.data.data_feed import get_daily_bars
    from alpha_flow.core.ofi_calculator import rolling_ofi_zscore

    all_t = _get_all_tickers()
    requested = [t.strip().upper() for t in tickers.split(",") if t.strip()] if tickers else list(all_t)
    requested = [t for t in requested if t in all_t] or list(all_t)

    result: dict[str, list] = {}
    for t in requested:
        try:
            df = get_daily_bars(t)
            z  = rolling_ofi_zscore(df).dropna()
            if start and end:
                try:
                    z = z.loc[start:end]
                except Exception:
                    z = z.tail(bars)
            else:
                z = z.tail(bars)
            result[t] = [
                {"date": str(idx.date()), "value": round(float(v), 4)}
                for idx, v in z.items()
            ]
        except Exception:
            result[t] = []
    return result


@app.get("/api/outputs/{filename}", tags=["outputs"])
def serve_output(filename: str) -> FileResponse:
    if ".." in filename or "/" in filename:
        raise HTTPException(400, "Invalid filename")
    for d in [FIGURES_DIR, OUTPUTS_DIR]:
        p = d / filename
        if p.exists() and p.is_file():
            media_type = "image/png" if filename.endswith(".png") else "text/plain"
            return FileResponse(str(p), media_type=media_type, filename=filename)
    raise HTTPException(404, f"\'{filename}\' not found — run the pipeline first.")


# ---------------------------------------------------------------------------
# Groq helpers
# ---------------------------------------------------------------------------

def _load_groq_keys() -> list[str]:
    """Load GROQ_API_KEY and GROQ_API_KEY_2 from environment."""
    import os
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env")
    return [k for k in [os.getenv("GROQ_API_KEY", ""), os.getenv("GROQ_API_KEY_2", "")] if k]


def _groq_call(
    messages: list,
    model: str = "llama-3.3-70b-versatile",
    temperature: float = 0.2,
    max_tokens: int = 300,
) -> str:
    """Call Groq with automatic fallback to secondary key."""
    from groq import Groq
    keys = _load_groq_keys()
    if not keys:
        raise RuntimeError("No GROQ API keys found in .env")
    last_err: Exception = RuntimeError("No Groq keys")
    for key in keys:
        try:
            resp = Groq(api_key=key).chat.completions.create(
                model=model, temperature=temperature, max_tokens=max_tokens, messages=messages
            )
            return resp.choices[0].message.content.strip()
        except Exception as e:
            last_err = e
    raise last_err


# ---------------------------------------------------------------------------
# Groq AI Chart Explanation
# ---------------------------------------------------------------------------

_CHART_FORMULAS: dict[str, str] = {
    "ofi_zscore_chart.png": (
        "OFI_z = (buy_vol − sell_vol) / total_vol, normalised via rolling 20-bar z-score. "
        "|z| > 1.5σ = significant directional pressure. Signal → BUY if z > 1.5, SELL if z < −1.5. "
        "Chordia, Roll & Subrahmanyam (2002)."
    ),
    "ofi_intraday_heatmap.png": (
        "Hourly × weekday heat-map of OFI = (buy_vol − sell_vol) / total_vol. "
        "Rows = hour-of-day (09:00–16:00 ET), columns = Mon–Fri. "
        "Cell colour = mean OFI for that hour/day bucket over the sample window. "
        "Systematic clusters reveal VWAP/TWAP institutional scheduling. Chordia et al. (2002)."
    ),
    "execution_quality.png": (
        "Corwin-Schultz spread (bps): S = 2·(exp(d₀ + d₁·√Δt) − 1) estimated from H/L ratio. "
        "Amihud illiquidity: Λ = |ret| / dollar_volume × 10⁶ — price impact per $1M traded. "
        "Lower C-S spread = cheaper execution; higher Amihud = more illiquid. "
        "Corwin & Schultz (2012); Amihud (2002)."
    ),
    "kyle_lambda_trend.png": (
        "Kyle λ: estimated via OLS |ret| ~ |signed_vol|, slope = λ ($/share per OFI unit). "
        "Higher λ = larger price impact per order-flow unit = thinner effective liquidity. "
        "Thin line = daily λ; thick line = 30-day rolling average. Kyle (1985)."
    ),
    "alpha_decay.png": (
        "IC(lag) = Spearman_rank_corr(OFI_z_t, ret_{t+lag}) for lags 1..10 days. "
        "IC half-life fit: IC(t) = IC₀·exp(−λt). "
        "Grinold & Kahn (2000) significance threshold |IC| > 0.05. "
        "Rapid decay (half-life ≤ 2 bars) = pure microstructure alpha, intraday only."
    ),
}

def _get_chart_context(filename: str) -> str:
    """Build fully dynamic chart context: formula + live DB values + interpretation instruction."""
    formula = _CHART_FORMULAS.get(filename, "")
    live_parts: list[str] = []
    try:
        rows = get_latest_signals_by_ticker()
        if rows:
            if filename == "ofi_zscore_chart.png":
                buys  = [r for r in rows if r.get("signal") == "BUY"]
                sells = [r for r in rows if r.get("signal") == "SELL"]
                top3  = sorted(rows, key=lambda r: abs(r.get("ofi") or 0), reverse=True)[:3]
                bot3  = sorted(rows, key=lambda r: r.get("ofi") or 0)[:3]
                live_parts += [
                    f"Universe: {len(rows)} tickers",
                    f"Signals: {len(buys)} BUY / {len(sells)} SELL / {len(rows)-len(buys)-len(sells)} HOLD",
                    "Highest OFI: " + ", ".join(f'{r["ticker"]} ({(r.get("ofi") or 0):+.3f}\u03c3)' for r in top3),
                    "Lowest OFI:  " + ", ".join(f'{r["ticker"]} ({(r.get("ofi") or 0):+.3f}\u03c3)' for r in bot3),
                ]
            elif filename == "kyle_lambda_trend.png":
                kl_vals = [r.get("kyle_lambda") or 0 for r in rows]
                avg_kl  = sum(kl_vals) / max(len(kl_vals), 1)
                top_kl  = max(rows, key=lambda r: r.get("kyle_lambda") or 0)
                live_parts += [
                    f"Cross-sectional avg Kyle \u03bb = {avg_kl:.3e}",
                    f"Highest impact: {top_kl['ticker']} \u03bb = {(top_kl.get('kyle_lambda') or 0):.3e}",
                ]
            elif filename == "execution_quality.png":
                sp_vals = [r.get("eff_spread_bps") or r.get("eff_spread") or 0 for r in rows]
                am_vals = [r.get("amihud") or 0 for r in rows]
                avg_sp  = sum(sp_vals) / max(len(sp_vals), 1)
                avg_am  = sum(am_vals) / max(len(am_vals), 1)
                widest  = max(rows, key=lambda r: r.get("eff_spread_bps") or 0)
                live_parts += [
                    f"Universe avg C-S spread = {avg_sp:.1f} bps",
                    f"Widest spread: {widest['ticker']} = {(widest.get('eff_spread_bps') or 0):.1f} bps",
                    f"Universe avg Amihud = {avg_am:.4f}",
                ]
            elif filename == "alpha_decay.png":
                from backend.database import get_alpha_decay_db
                decay_rows = get_alpha_decay_db()
                if decay_rows:
                    hl_vals = [d["half_life_bars"] for d in decay_rows if d.get("half_life_bars")]
                    if hl_vals:
                        avg_hl = sum(hl_vals) / len(hl_vals)
                        micro  = [d["ticker"] for d in decay_rows if (d.get("half_life_bars") or 999) <= 2]
                        live_parts += [
                            f"Avg IC half-life = {avg_hl:.1f} bars (range: {min(hl_vals):.1f}\u2013{max(hl_vals):.1f})",
                            f"Microstructure tickers (\u22642 bars): {', '.join(micro) if micro else 'none detected'}",
                        ]
    except Exception:
        pass

    if not live_parts and not formula:
        return ""

    parts: list[str] = []
    if formula:
        parts.append(f"FORMULA: {formula}")
    if live_parts:
        parts.append("LIVE STATE (from DB, current run):\n  \u00b7 " + "\n  \u00b7 ".join(live_parts))
    parts.append(
        "TASK: Interpret the specific live values above using the formula as context. "
        "Do NOT generically describe what this chart type is — focus on what these numbers reveal "
        "about current market conditions, which tickers show notable signals, and actionable implications "
        "for a systematic microstructure trading strategy."
    )
    return "\n\n".join(parts)


def _build_project_context() -> str:
    """Return project description with the live hourly IC if available from DB."""
    base = (
        "AlphaFlow is a market microstructure alpha engine with two resolutions.\n"
        "Daily: OFI Z-score, Kyle's lambda, Amihud illiquidity, Corwin-Schultz bid-ask spread "
        "from daily OHLCV. The daily OFI IC ≈ 0 at daily resolution — scientifically expected (Chordia et al. 2002).\n"
        "Hourly: LightGBM walk-forward on 13 microstructure features (OFI, VWAP deviation, "
        "Hawkes intensity, spread, volume clock, VPIN, etc.) at hourly resolution. "
    )
    try:
        from backend.database import get_avg_intraday_ic
        avg_ic = get_avg_intraday_ic()
        if avg_ic is not None:
            pct = avg_ic * 100
            quality = (
                "significant — above Grinold-Kahn 5% threshold" if pct >= 5
                else "weak — below 5% significance; typical for free OHLCV data, target >5% with live ticks"
            )
            base += f"LIVE hourly avg |IC| = {pct:.2f}% ({quality}). "
        else:
            base += (
                "Hourly IC is 1–3% with yfinance free OHLCV; expected >5% with live Alpaca tick data. "
                "Run the hourly engine to compute IC. "
            )
    except Exception:
        base += "Hourly IC target >5% (Grinold & Kahn 2000). "
    base += "The hourly IC_IR (= IC/σ(IC)) is the primary performance metric for this engine."
    return base


@app.post("/api/explain", tags=["ai"])
async def explain_chart(body: dict) -> dict:
    """Call Groq to explain a chart in plain English (temperature=0.1)."""
    filename = body.get("filename", "")
    if ".." in filename or "/" in filename:
        raise HTTPException(400, "Invalid filename")
    
    chart_desc = _get_chart_context(filename)
    if not chart_desc:
        chart_desc = f"A quantitative analysis chart named {filename} from the AlphaFlow Microstructure Alpha Engine."

    # Inject live current-value suffix so explanations reference actual dashboard state
    try:
        live_rows = get_latest_signals_by_ticker()
        n = len(live_rows) if live_rows else 0
        # Filenames handled by the elif chain below (only these get a "CURRENT VALUES" suffix)
        _live_value_chart_files = {"ofi_zscore_chart.png", "execution_quality.png", "kyle_lambda_trend.png", "alpha_decay.png"}
        if n > 0 and filename in _live_value_chart_files:
            if filename == "ofi_zscore_chart.png":
                top_buy  = max(live_rows, key=lambda r: r.get("ofi") or 0)
                top_sell = min(live_rows, key=lambda r: r.get("ofi") or 0)
                avg_ofi  = sum((r.get("ofi") or 0) for r in live_rows) / n
                chart_desc += (
                    f"\n\nCURRENT VALUES: Universe avg OFI Z = {avg_ofi:+.2f}. "
                    f"Strongest buying: {top_buy['ticker']} (Z={top_buy.get('ofi') or 0:+.2f}). "
                    f"Strongest selling: {top_sell['ticker']} (Z={top_sell.get('ofi') or 0:+.2f})."
                )
            elif filename == "execution_quality.png":
                avg_spread = sum((r.get("eff_spread_bps") or 0) for r in live_rows) / n
                widest     = max(live_rows, key=lambda r: r.get("eff_spread_bps") or 0)
                avg_amihud = sum((r.get("amihud_illiq") or 0) for r in live_rows) / n
                chart_desc += (
                    f"\n\nCURRENT VALUES: Universe avg C-S spread = {avg_spread:.1f} bps "
                    f"(widest: {widest['ticker']} at {widest.get('eff_spread_bps') or 0:.1f} bps). "
                    f"Avg Amihud ILLIQ = {avg_amihud:.3e}."
                )
            elif filename == "kyle_lambda_trend.png":
                avg_lambda     = sum((r.get("kyle_lambda") or 0) for r in live_rows) / n
                most_impactful = max(live_rows, key=lambda r: r.get("kyle_lambda") or 0)
                chart_desc += (
                    f"\n\nCURRENT VALUES: Universe avg Kyle λ = {avg_lambda:.3e} $/share. "
                    f"Highest price impact: {most_impactful['ticker']} (λ = {most_impactful.get('kyle_lambda') or 0:.3e})."
                )
            elif filename == "alpha_decay.png":
                ics    = [(r.get("ic_value") or 0) for r in live_rows]
                avg_ic = sum(abs(v) for v in ics) / n
                chart_desc += (
                    f"\n\nCURRENT VALUES: Universe avg |IC| at lag 1 = {avg_ic * 100:.2f}% "
                    f"({'above' if avg_ic >= 0.05 else 'below'} Grinold-Kahn 5% threshold)."
                )
    except Exception:
        pass  # Non-fatal — static description still used

    try:
        explanation = _groq_call(
            temperature=0.1,
            max_tokens=220,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a financial data analyst explaining research charts to a non-technical audience. "
                        "In 2-3 sentences: state what the chart measures, describe the key pattern visible, "
                        "and give one actionable insight a decision-maker should take from it. "
                        "Be factual, concise, no jargon, no file name mentions."
                    )
                },
                {
                    "role": "user",
                    "content": f"Explain this chart:\n{chart_desc}\n\nProject: {_build_project_context()}"
                }
            ],
        )
        return {"filename": filename, "explanation": explanation, "model": "llama-3.3-70b-versatile"}
    except Exception as exc:
        # Always return useful content even when Groq is unavailable
        return {"filename": filename, "explanation": chart_desc, "model": "static-fallback", "error": str(exc)}


import re as _re

def _build_chat_context(message: str, ticker: str | None = None, resolution: str = "daily", intraday_signal: dict | None = None) -> str:
    """Build a rich system context for chat, injecting live ticker data if mentioned."""
    project_ctx = _build_project_context()
    now_utc = datetime.utcnow().strftime("%Y-%m-%d %H:%M")
    time_prefix = f"System date/time: {now_utc} UTC. "
    # Detect ticker symbols in message (2-5 uppercase letters, common US tickers)
    tickers_mentioned = list(set(_re.findall(r'\b([A-Z]{2,5})\b', message)))
    if ticker and ticker not in tickers_mentioned:
        tickers_mentioned.append(ticker)

    # Always include all-ticker summary from DB (daily signals)
    live_rows = get_latest_signals_by_ticker()
    if live_rows:
        ts = live_rows[0].get("recorded_at", "")[:16] if live_rows else ""
        if resolution == "hourly":
            # In hourly mode, omit OFI_IC (daily OHLCV IC ≈ 0 — irrelevant here)
            rows_text = "\n".join(
                f"  {r['ticker']:<6} OFI_z={r.get('ofi', 0):+.3f}  "
                f"Kyle_λ={r.get('kyle_lambda', 0):.3e}  "
                f"Spread={r.get('eff_spread_bps', 0):.1f}bps  "
                f"Amihud={r.get('amihud_illiq', 0):.3e}  "
                f"Signal={r.get('signal', 'HOLD')}"
                for r in live_rows
            )
            live_context = (
                f"\n\n⚠ HOURLY SESSION — the daily OFI IC (≈0 on daily OHLCV) is NOT the relevant IC here. "
                f"When asked about IC or Information Coefficient, always quote the hourly LightGBM IC from the HOURLY INTRADAY DATA below, NOT the daily OFI IC.\n"
                f"LIVE MICROSTRUCTURE DATA (as of {ts} UTC — liquidity metrics only, for execution context):\n{rows_text}"
            )
        else:
            rows_text = "\n".join(
                f"  {r['ticker']:<6} OFI_z={r.get('ofi', 0):+.3f}  "
                f"Kyle_λ={r.get('kyle_lambda', 0):.3e}  "
                f"Spread={r.get('eff_spread_bps', 0):.1f}bps  "
                f"Amihud={r.get('amihud_illiq', 0):.3e}  "
                f"OFI_IC={r.get('ic_value', 0) or 0:.4f}  "
                f"Signal={r.get('signal', 'HOLD')}  "
                f"Reason: {(r.get('llm_reason') or '')[:80]}"
                for r in live_rows
            )
            live_context = f"\n\nLIVE DASHBOARD DATA (as of {ts} UTC, daily OFI signals):\n{rows_text}"
    else:
        live_context = "\n\nLIVE DASHBOARD DATA: No pipeline runs yet."

    # Extra context for specific tickers mentioned (daily data)
    ticker_context = ""
    ticker_map = {r["ticker"]: r for r in live_rows}
    for tkr in tickers_mentioned:
        if tkr in ticker_map:
            r = ticker_map[tkr]
            if resolution == "hourly":
                # In hourly mode, only include liquidity metrics — not the daily IC
                ticker_context += (
                    f"\n\nLIQUIDITY CONTEXT FOR {tkr} (daily data — for execution cost context only):\n"
                    f"  OFI Z-score: {r.get('ofi', 0):+.4f}\n"
                    f"  Kyle's Lambda: {r.get('kyle_lambda', 0):.4e} $/share\n"
                    f"  Amihud ILLIQ: {r.get('amihud_illiq', 0):.4e}\n"
                    f"  Effective Spread: {r.get('eff_spread_bps', 0):.2f} bps\n"
                    f"  DO NOT quote the daily OFI IC for this ticker — see the hourly LightGBM IC in the HOURLY INTRADAY DATA below."
                )
            else:
                ticker_context += (
                    f"\n\nDETAILED DAILY DATA FOR {tkr}:\n"
                    f"  OFI Z-score: {r.get('ofi', 0):+.4f} (positive = net buying pressure; range ≈ -3 to +3)\n"
                    f"  Kyle's Lambda: {r.get('kyle_lambda', 0):.4e} $/share (price impact per unit order flow)\n"
                    f"  Amihud ILLIQ: {r.get('amihud_illiq', 0):.4e} price_chg/$1M_vol\n"
                    f"  Effective Spread: {r.get('eff_spread_bps', 0):.2f} bps (Corwin-Schultz estimate)\n"
                    f"  Daily OFI IC: {r.get('ic_value', 0) or 0:.4f} (daily OHLCV IC ≈ 0 is EXPECTED — cannot resolve intra-bar direction)\n"
                    f"  Signal: {r.get('signal', 'HOLD')}\n"
                    f"  Reason: {r.get('llm_reason', 'N/A')}"
                )

    # Hourly intraday signal override (research drawer in hourly mode)
    if resolution == "hourly" and intraday_signal:
        tkr       = intraday_signal.get("ticker", ticker or "")
        mean_ic   = intraday_signal.get("mean_ic") or 0
        sharpe    = intraday_signal.get("sharpe") or 0
        mdd       = abs(intraday_signal.get("max_drawdown") or 0)
        sortino   = intraday_signal.get("sortino") or 0
        n_folds   = intraday_signal.get("n_folds") or "N/A"
        shap_top  = intraday_signal.get("shap_top") or "N/A"
        ticker_context += (
            f"\n\nHOURLY INTRADAY DATA FOR {tkr} (LightGBM Walk-Forward, Hourly Resolution):\n"
            f"  Signal: {intraday_signal.get('signal', 'HOLD')}\n"
            f"  LightGBM IC (mean_ic): {mean_ic * 100:.2f}% — THIS is the hourly IC to reference, NOT the daily OFI IC above\n"
            f"  Annualised Sharpe: {sharpe:+.2f}\n"
            f"  Max Drawdown: {mdd * 100:.1f}%\n"
            f"  Sortino Ratio: {sortino:+.2f}\n"
            f"  Walk-Forward Folds: {n_folds}\n"
            f"  Top SHAP Feature: {shap_top}\n"
            f"  NOTE: the hourly IC = {mean_ic * 100:.2f}% is from LightGBM on 13 microstructure features at hourly resolution. "
            f"The daily OFI IC ≈ 0 is unrelated — do NOT quote it when discussing hourly performance for this ticker."
        )

    return time_prefix + project_ctx + live_context + ticker_context


@app.post("/api/chat", tags=["ai"])
async def chat(body: dict) -> dict:
    """Chat with Groq about this project (temperature=0.2). Injects live ticker data."""
    message = body.get("message", "").strip()
    history = body.get("history", [])
    ticker           = body.get("ticker")
    resolution       = body.get("resolution", body.get("phase", "daily"))  # accept legacy "phase" key
    intraday_signal  = body.get("intraday_signal")

    if not message:
        raise HTTPException(400, "message is required")
    if len(message) > 500:
        raise HTTPException(400, "message too long (max 500 chars)")

    grounded_context = _build_chat_context(message, ticker=ticker, resolution=resolution, intraday_signal=intraday_signal)
    
    messages = [
        {
            "role": "system",
            "content": (
                "You are an AI assistant for the AlphaFlow Market Microstructure Alpha Engine. "
                "You have access to live dashboard data and must use it when answering questions "
                "about specific tickers or current metrics. Be concise (2-4 sentences). "
                "When referencing live values, quote the actual numbers from the data provided.\n\n"
                f"Context: {grounded_context}"
            )
        }
    ]
    
    for h in history[-6:]:
        if h.get("role") in ("user", "assistant") and h.get("content"):
            messages.append({"role": h["role"], "content": h["content"][:300]})
    
    messages.append({"role": "user", "content": message})
    
    try:
        reply = _groq_call(messages, temperature=0.2, max_tokens=350)
        return {"reply": reply, "model": "llama-3.3-70b-versatile"}
    except Exception as exc:
        return {
            "reply": (
                "Groq is temporarily unavailable (rate limit or network). "
                "The live dashboard data is still accessible — "
                f"latest signals: {', '.join(r['ticker']+' '+r.get('signal','HOLD') for r in (get_latest_signals_by_ticker() or [])[:5])}."
            ),
            "model": "error",
            "detail": str(exc),
        }


# ═══════════════════════════════════════════════════════════════════════════════
# Hourly / Intraday Endpoints
# ═══════════════════════════════════════════════════════════════════════════════

_intraday_results_cache: dict = {}  # in-memory cache keyed by run_id — values are ALWAYS {ticker: {mean_ic, ...}} results dicts, never anything else (see _build_intraday_cards fallback below)
_intraday_running: bool = False  # in-memory concurrency guard — /api/intraday/run has no BackgroundTasks/run_history entry
_FEAT_CORR_CACHE: dict = {}         # in-memory cache for feature correlation matrices (per ticker)
_SHAP_DEP_CACHE: dict = {}          # in-memory cache for SHAP dependence-plot points, keyed by f"{ticker}_{feature}" — kept separate from _intraday_results_cache (different value shape; sharing one dict caused get_intraday_signals()'s "latest run" fallback to occasionally grab a SHAP-dependence entry instead of a results dict and crash with AttributeError: 'str' object has no attribute 'get')

# Live per-ticker progress for the currently-running (or last-run) intraday pipeline.
# Polled by the frontend (GET /api/intraday/progress) so the UI can show real
# incremental "N/50 tickers processed" feedback regardless of whether the run
# was triggered from the UI button or an external call (e.g. curl, scheduler).
_intraday_progress: dict = {
    "running": False, "total": 0, "done": 0, "current": None, "completed": [],
}


def _benjamini_hochberg_threshold(pvalues: list[float], q: float) -> float:
    """Re-exported from the shared module for backward-compatible imports
    (tests + any external callers import this name from `backend.main`).
    See `alpha_flow.analysis.signal_classification.benjamini_hochberg_threshold`
    for the implementation and full docstring.
    """
    from alpha_flow.analysis.signal_classification import benjamini_hochberg_threshold
    return benjamini_hochberg_threshold(pvalues, q)


def _build_intraday_cards(results: dict) -> list[dict]:
    """Build intraday signal card dicts from raw pipeline results dict.

    Two-tier classification (shared with Daily via signal_classification.py):

      Tier 1 — tradeable book: rank tickers by `latest_signal` (direction-
      corrected latest predicted return — NOT mean_ic, which is skill not
      direction). Long top SIGNAL_RANK_FRACTION, short bottom, sign-checked.
      No FDR gate — the book monetises the rank spread.

      Tier 2 — high-conviction flag: BH-FDR across all tickers' ic_pvalue
      this run. Annotation only, never suppresses the tradeable signal.
    """
    from alpha_flow.config.settings import (
        SIGNAL_RANK_FRACTION, SIGNAL_SIGNIFICANCE_ALPHA,
    )
    from alpha_flow.analysis.signal_classification import classify_signal, is_high_conviction

    valid = {t: r for t, r in results.items() if isinstance(r, dict) and "error" not in r}
    if not valid:
        return []

    # Cross-sectional ranking by the DIRECTIONAL signal (latest direction-corrected
    # predicted return), NOT by mean_ic (which is predictive skill, not direction).
    # Long the top decile, short the bottom decile — a standard systematic book.
    sorted_tickers = sorted(valid, key=lambda t: valid[t].get("latest_signal", 0.0), reverse=True)
    n = len(sorted_tickers)
    n_candidates = max(1, round(n * SIGNAL_RANK_FRACTION))   # top/bottom fraction, matches Daily's convention
    buy_rank  = set(sorted_tickers[:n_candidates])
    sell_rank = set(sorted_tickers[n - n_candidates:])

    # Benjamini-Hochberg FDR correction across every ticker's ic_pvalue this run —
    # used only for the Tier-2 high-conviction flag, not to gate the tradeable signal.
    all_pvalues = [res.get("ic_pvalue", 1.0) for res in valid.values()]
    fdr_threshold = _benjamini_hochberg_threshold(all_pvalues, SIGNAL_SIGNIFICANCE_ALPHA)

    cards = []
    for ticker, res in valid.items():
        shap = res.get("shap_importance", {})
        top_feature = max(shap, key=shap.get) if shap else "ofi_zscore"
        ic = res.get("mean_ic", 0.0)
        pvalue = res.get("ic_pvalue", 1.0)
        ls = res.get("latest_signal", 0.0)

        signal = classify_signal(
            signal_value=ls,
            in_buy_rank=ticker in buy_rank,
            in_sell_rank=ticker in sell_rank,
            sign_ok_buy=(ls >= 0),
            sign_ok_sell=(ls <= 0),
            abs_threshold=float("inf"),   # hourly candidacy is rank-based only
        )
        high_conviction = is_high_conviction(pvalue, fdr_threshold)

        cards.append({
            "ticker":        ticker,
            "signal":        signal,
            "high_conviction": high_conviction,
            "latest_signal": round(ls, 8),
            "mean_ic":       round(ic, 6),
            "ic_sem":        round(res.get("ic_sem", 0.0), 6),
            "ic_ir":         round(res.get("ic_ir", 0.0), 4),
            "ic_tstat":      round(res.get("ic_tstat", 0.0), 4),
            "ic_pvalue":     round(res.get("ic_pvalue", 1.0), 6),
            "sharpe":        round(res.get("sharpe", 0.0), 4),
            "sharpe_sem":    round(res.get("sharpe_sem", 0.0), 4),
            "sortino":       round(res.get("sortino", 0.0), 4),
            "calmar":        round(res.get("calmar", 0.0), 4),
            "omega":         round(res.get("omega", 1.0), 4),
            "hit_rate":      round(res.get("hit_rate", 0.0), 4),
            "hit_rate_sem":  round(res.get("hit_rate_sem", 0.0), 4),
            "profit_factor": round(res.get("profit_factor", 1.0), 4),
            "max_drawdown":  round(res.get("max_drawdown", 0.0), 4),
            "n_folds":       res.get("n_folds", 0),
            "n_bars":        res.get("n_bars", 0),
            "train_bars":    res.get("train_bars", 0),
            "test_bars":     res.get("test_bars", 0),
            "data_start":    res.get("data_start"),
            "data_end":      res.get("data_end"),
            "shap_top":      top_feature,
            "last_features": res.get("last_features", {}),
            "equity_curve":  res.get("equity_curve", []),
            "equity_dates":  res.get("equity_dates", []),
            "ic_per_fold":   res.get("ic_per_fold", []),
        })
    return sorted(cards, key=lambda c: abs(c["mean_ic"]), reverse=True)


def _execute_intraday_pipeline_sync(tickers: list[str], resolution: str = "1h") -> dict:
    """
    Run the hourly intraday pipeline and persist all results (SHAP + signal
    cards). Shared by POST /api/intraday/run (wrapped in asyncio.to_thread so
    it doesn't block the event loop) and the hourly APScheduler job (which
    already runs in its own executor thread, so no to_thread wrapping is
    needed there). Keeping this logic in one place guarantees a
    scheduler-triggered run behaves identically to a UI-triggered one — same
    DB writes, same live /api/intraday/progress feed — regardless of trigger.

    Caller contract: the caller must already have set _intraday_running=True
    and reset _intraday_progress *before* calling this (both call sites do
    this as a single synchronous check-and-set with no `await` in between, to
    avoid a race between the two trigger paths). This function resets
    _intraday_running back to False in its `finally` block.
    """
    global _intraday_running
    from alpha_flow.analysis.intraday_engine import run_intraday_pipeline

    def _on_ticker_done(ticker: str, idx: int, total: int, result: dict) -> None:
        _intraday_progress["done"] = idx
        _intraday_progress["current"] = ticker
        _intraday_progress["completed"].append({
            "ticker": ticker,
            "mean_ic": result.get("mean_ic", 0.0),
            "sharpe": result.get("sharpe", 0.0),
            "error": result.get("error"),
        })

    try:
        results = run_intraday_pipeline(tickers, resolution, on_ticker_done=_on_ticker_done)
    finally:
        _intraday_running = False
        _intraday_progress["running"] = False

    # ── Persist SHAP importances to SQLite ──
    from backend.database import save_shap_importance as _save_shap
    from backend.database import save_intraday_signals as _save_cards
    from collections import defaultdict as _dd
    universe_totals: dict = _dd(list)
    all_ics: list[float] = []
    for t, res in results.items():
        if "error" in res or not res.get("shap_importance"):
            continue
        shap_dict = res["shap_importance"]
        ticker_ic = res.get("mean_ic", 0.0)
        ticker_features = sorted(
            [{"feature": k, "importance": v} for k, v in shap_dict.items()],
            key=lambda x: x["importance"], reverse=True,
        )
        _save_shap(t, ticker_features[:8], mean_ic=ticker_ic)
        for feat, val in shap_dict.items():
            universe_totals[feat].append(val)
        all_ics.append(ticker_ic)
    if universe_totals:
        all_features = sorted(
            [{"feature": k, "importance": round(sum(v) / len(v), 6)} for k, v in universe_totals.items()],
            key=lambda x: x["importance"], reverse=True,
        )
        avg_ic = round(sum(all_ics) / len(all_ics), 6) if all_ics else 0.0
        _save_shap("ALL", all_features[:8], mean_ic=avg_ic)

    # ── Persist intraday signal cards to SQLite ──
    cards = _build_intraday_cards(results)
    _save_cards(cards)

    return results


@app.post("/api/intraday/run", tags=["intraday"])
async def run_intraday(body: dict = {}) -> dict:
    """
    Trigger the hourly intraday pipeline (LGBMRegressor walk-forward on hourly bars).

    Why POST: triggers computation, not a read.
    Returns: run_id + IC summary so the frontend can poll for updates.

    Body params (all optional):
      tickers    — list of ticker symbols (default: all from settings)
      resolution — '1h' (default) or '1m'
    """
    global _intraday_running
    import uuid
    from alpha_flow.config.settings import get_all_tickers

    if _intraday_running:
        raise HTTPException(409, "An intraday pipeline run is already in progress. Please wait for it to finish.")

    known_universe = set(get_all_tickers())
    requested      = body.get("tickers") or get_all_tickers()
    tickers        = [t for t in (str(x).strip().upper() for x in requested) if t in known_universe]
    if not tickers:
        raise HTTPException(400, "No valid tickers in request body — must be from the tracked universe.")
    resolution = body.get("resolution", "1h")
    run_id     = str(uuid.uuid4())[:8]

    _intraday_running = True
    _intraday_progress.update(running=True, total=len(tickers), done=0, current=None, completed=[])

    try:
        # Offload the CPU-bound walk-forward/LightGBM/SHAP compute to a worker
        # thread. This endpoint is `async def`, and without to_thread the call
        # below would run synchronously *inside* the event loop coroutine —
        # blocking it completely (no other request, including the /api/stream
        # SSE generator's heartbeat, can be serviced) for the full multi-minute
        # run duration. Running it in a thread lets the event loop keep
        # scheduling other coroutines between GIL switches.
        results = await asyncio.to_thread(_execute_intraday_pipeline_sync, tickers, resolution)
    except Exception as exc:
        raise HTTPException(500, f"Intraday pipeline failed: {exc}")

    _intraday_results_cache[run_id] = results

    ic_summary = {
        t: {"mean_ic": v.get("mean_ic", 0.0), "sharpe": v.get("sharpe", 0.0),
            "n_folds": v.get("n_folds", 0), "n_bars": v.get("n_bars", 0)}
        for t, v in results.items()
    }
    avg_ic_val = (
        sum(v["mean_ic"] for v in ic_summary.values()) / len(ic_summary)
        if ic_summary else 0.0
    )
    return {"run_id": run_id, "ic_summary": ic_summary, "avg_ic": round(avg_ic_val, 6)}


@app.get("/api/intraday/progress", tags=["intraday"])
def intraday_progress() -> dict:
    """
    Live per-ticker progress for the currently-running (or last-completed)
    intraday pipeline run. Poll this while `running` is true to show real
    incremental "N/50 tickers processed" feedback in the UI — works whether
    the run was triggered from the UI button, curl, or a scheduler.
    """
    return _intraday_progress


@app.get("/api/intraday/signals", tags=["intraday"])
def get_intraday_signals() -> dict:
    """
    Return latest intraday signal cards with feature metadata.
    Reads from SQLite first (survives backend restarts); falls back to in-memory cache.
    Response: { signals: [...], meta: { feature_count: int, feature_names: list[str] } }
    """
    from backend.database import get_intraday_signals_db
    from alpha_flow.analysis.intraday_engine import FEATURE_COLS

    db_cards = get_intraday_signals_db()
    signals: list = []
    if db_cards is not None:
        signals = db_cards
    elif _intraday_results_cache:
        latest_run = list(_intraday_results_cache.values())[-1]
        signals = _build_intraday_cards(latest_run)

    return {
        "signals": signals,
        "meta": {
            "feature_count": len(FEATURE_COLS),
            "feature_names": list(FEATURE_COLS),
        },
    }


@app.get("/api/data/shap-importance", tags=["intraday"])
def get_shap_importance(ticker: str = "AAPL") -> dict:
    """
    Return SHAP feature importances for a given ticker.
    Reads from SQLite first (survives backend restarts); falls back to in-memory cache.
    ticker=ALL returns the cross-ticker average importance.
    """
    from backend.database import get_shap_from_db

    # 1. Try persistent DB (populated after first intraday run, survives restarts)
    db_result = get_shap_from_db(ticker.upper())
    if db_result:
        return db_result

    # 2. Fall back to in-memory cache (only if DB is empty, e.g. first-ever run in progress)
    if not _intraday_results_cache:
        return {"ticker": ticker, "features": [], "error": "No intraday run yet — run the Signal Engine"}

    latest_run = list(_intraday_results_cache.values())[-1]

    if ticker.upper() == "ALL":
        from collections import defaultdict
        totals: dict[str, list[float]] = defaultdict(list)
        all_ics = []
        for res in latest_run.values():
            if "error" in res or not res.get("shap_importance"):
                continue
            for feat, val in res["shap_importance"].items():
                totals[feat].append(val)
            all_ics.append(res.get("mean_ic", 0.0))
        if not totals:
            return {"ticker": "ALL", "features": [], "error": "No SHAP data yet"}
        features = sorted(
            [{"feature": k, "importance": round(sum(v) / len(v), 6)} for k, v in totals.items()],
            key=lambda x: x["importance"], reverse=True,
        )
        avg_ic = round(sum(all_ics) / len(all_ics), 6) if all_ics else 0.0
        return {"ticker": "ALL", "features": features[:8], "mean_ic": avg_ic}

    res = latest_run.get(ticker.upper(), {})
    if "error" in res:
        return {"ticker": ticker, "features": [], "error": res["error"]}
    shap = res.get("shap_importance", {})
    features = sorted(
        [{"feature": k, "importance": round(v, 6)} for k, v in shap.items()],
        key=lambda x: x["importance"], reverse=True,
    )
    return {"ticker": ticker, "features": features[:8], "mean_ic": res.get("mean_ic", 0.0)}


@app.get("/api/stream", tags=["intraday"])
async def stream_live_bars(tickers: str = "AAPL,MSFT,NVDA"):
    """
    Server-Sent Events (SSE) endpoint — streams the latest bar for each ticker.

    What you learn:
      - SSE vs WebSocket: SSE is one-directional server→client, works over
        standard HTTP/1.1, simpler for dashboards (no handshake needed).
      - The browser connects with: new EventSource('/api/stream')
      - Each event is formatted as: "data: {json}\\n\\n"
      - Comment lines (": ping ...\\n\\n") are heartbeats — they keep
        load-balancers and Vite proxy from closing the connection after 30s.

    Falls back to synthetic random-walk data when no Alpaca API key is configured.
    Green dot in UI = connected. Grey dot = disconnected.
    """
    from fastapi.responses import StreamingResponse
    from alpha_flow.data.alpaca_stream import poll_latest_bars

    ticker_list = [t.strip().upper() for t in tickers.split(",") if t.strip()]

    async def event_gen():
        # Initial handshake event — browser EventSource.onopen fires immediately
        yield f"data: {json.dumps({'type': 'connected', 'tickers': ticker_list})}\n\n"
        async for bar in poll_latest_bars(ticker_list, interval_seconds=15):
            yield bar.to_sse()

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":     "no-cache",
            "X-Accel-Buffering": "no",        # disable nginx buffering
            "Connection":        "keep-alive",
        },
    )


# ═══════════════════════════════════════════════════════════════════════════════
# Paper Trading (Execution)
# ═══════════════════════════════════════════════════════════════════════════════

@app.post("/api/execute", tags=["execution"])
async def execute_signals() -> dict:
    """
    Read the latest hourly signal cards and submit paper orders for BUY/SELL signals.

    - Calls Alpaca paper trading API (free forever, no real capital).
    - Skips HOLD signals.
    - Persists every attempt to the paper_trades SQLite table.
    Returns a summary of orders submitted.
    """
    from backend.database import get_intraday_signals_db
    from alpha_flow.execution import submit_order

    cards = get_intraday_signals_db()
    if not cards:
        raise HTTPException(404, "No intraday signals — run the Signal Engine first")

    submitted, skipped, errors = [], [], []
    for card in cards:
        ticker = card["ticker"]
        signal = card.get("signal", "HOLD")
        if signal == "HOLD":
            skipped.append(ticker)
            continue
        try:
            result = submit_order(ticker, signal, card.get("mean_ic", 0.0), qty=10)
            trade_id = save_paper_trade(
                ticker=ticker,
                signal=signal,
                qty=result.get("qty", 10),
                order_id=result.get("order_id"),
                status=result.get("status", "pending"),
                filled_price=result.get("filled_avg_price"),
                filled_at=result.get("filled_at"),
            )
            submitted.append({"ticker": ticker, "signal": signal, "trade_id": trade_id,
                               "status": result.get("status"), "order_id": result.get("order_id")})
        except Exception as exc:
            errors.append({"ticker": ticker, "error": str(exc)})
            save_paper_trade(ticker=ticker, signal=signal, qty=10, status="error")

    stub_trades = [s for s in submitted if s.get("status") == "stub"]
    return {
        "submitted": submitted,
        "skipped_hold": skipped,
        "skipped_no_creds": [s["ticker"] for s in stub_trades],
        "skipped_pos": [s["ticker"] for s in submitted if s.get("status") == "skipped_pos"],
        "errors": errors,
        "total": len(submitted),
        "executed_at": datetime.utcnow().isoformat(),
    }


@app.get("/api/trades", tags=["execution"])
def list_trades(limit: int = Query(50, ge=1, le=200)) -> list[dict]:
    """Return the most recent paper trades (newest first)."""
    return get_paper_trades(limit)


@app.get("/api/trades/pnl", tags=["execution"])
def trades_pnl() -> dict:
    """
    Mark-to-market PnL for all open paper trades.

    Fetches current price from Alpaca latest bar.
    PnL = (current_price − filled_price) × qty  (BUY)
         = (filled_price − current_price) × qty  (SELL)
    """
    import numpy as np
    trades = get_paper_trades(200)
    if not trades:
        return {"trades": [], "total_pnl": 0.0, "open_count": 0}

    # Only include filled trades
    filled = [t for t in trades if t.get("status") == "filled" and t.get("filled_price")]
    if not filled:
        return {"trades": trades, "total_pnl": 0.0, "open_count": 0,
                "note": "No filled trades yet — orders are paper (stub) until Alpaca fills them"}

    # Fetch current prices in batch
    tickers = list({t["ticker"] for t in filled})
    current_prices: dict[str, float] = {}
    try:
        from alpaca.data.historical import StockHistoricalDataClient
        from alpaca.data.requests import StockLatestBarRequest
        from alpha_flow.config.settings import ALPACA_API_KEY, ALPACA_SECRET_KEY
        if ALPACA_API_KEY and ALPACA_SECRET_KEY:
            client = StockHistoricalDataClient(ALPACA_API_KEY, ALPACA_SECRET_KEY)
            req = StockLatestBarRequest(symbol_or_symbols=tickers)
            bars = client.get_stock_latest_bar(req)
            current_prices = {sym: float(bar.close) for sym, bar in bars.items()}
    except Exception:
        pass  # PnL will be 0 for tickers without a price

    enriched, total_pnl = [], 0.0
    for t in filled:
        fill = t["filled_price"]
        current = current_prices.get(t["ticker"], fill)
        qty = t.get("qty", 10)
        pnl = (current - fill) * qty if t["signal"] == "BUY" else (fill - current) * qty
        total_pnl += pnl
        enriched.append({**t, "current_price": round(current, 4), "pnl": round(pnl, 4)})

    return {
        "trades": sorted(enriched, key=lambda x: abs(x["pnl"]), reverse=True),
        "total_pnl": round(total_pnl, 4),
        "open_count": len(filled),
    }


@app.delete("/api/trades/all", tags=["execution"])
def delete_all_trades() -> dict:
    """Cancel all paper trades in local DB and attempt to close all positions in Alpaca."""
    import sqlite3 as _sl
    alpaca_closed = False
    try:
        from alpaca.trading.client import TradingClient
        from alpha_flow.config.settings import ALPACA_API_KEY, ALPACA_SECRET_KEY
        if ALPACA_API_KEY and ALPACA_SECRET_KEY:
            tc = TradingClient(ALPACA_API_KEY, ALPACA_SECRET_KEY, paper=True)
            tc.close_all_positions(cancel_orders=True)
            alpaca_closed = True
    except Exception as _api_err:
        print(f"[delete_all_trades] Alpaca close_all_positions failed: {_api_err}")
    deleted = 0
    db_path = ROOT / "data" / "app.db"
    if db_path.exists():
        try:
            _conn = _sl.connect(str(db_path))
            cur = _conn.execute("DELETE FROM paper_trades")
            deleted = cur.rowcount
            _conn.commit()
            _conn.close()
        except Exception as _db_err:
            print(f"[delete_all_trades] DB delete error: {_db_err}")
    return {"deleted": deleted, "alpaca_closed": alpaca_closed}


@app.delete("/api/trades/pending", tags=["execution"])
def cancel_pending_trades() -> dict:
    """
    Cancel all pending_new / pending orders via Alpaca API.
    Falls back to marking them 'cancelled' in local DB if Alpaca is unreachable.

    Status lifecycle: pending_new → accepted → new → filled (or cancelled).
    'pending_new' means Alpaca received the order but hasn't routed it yet — still cancellable.
    """
    import sqlite3 as _sl
    cancelled_api, cancelled_local = [], []

    # Try Alpaca cancel-all first
    try:
        from alpaca.trading.client import TradingClient  # type: ignore
        from alpha_flow.config.settings import ALPACA_API_KEY, ALPACA_SECRET_KEY
        if ALPACA_API_KEY and ALPACA_SECRET_KEY:
            tc = TradingClient(ALPACA_API_KEY, ALPACA_SECRET_KEY, paper=True)
            tc.cancel_orders()  # cancels ALL open orders on paper account
            cancelled_api.append("all_open_orders")
    except Exception as _api_err:
        print(f"[cancel_pending] Alpaca cancel-all failed (expected without live key): {_api_err}")

    # Mark pending rows in local DB as 'cancelled'
    db_path = ROOT / "data" / "app.db"
    if db_path.exists():
        try:
            _conn = _sl.connect(str(db_path))
            cur = _conn.execute(
                "UPDATE paper_trades SET status='cancelled' WHERE status IN ('pending','pending_new')"
            )
            _conn.commit()
            cancelled_local.append(cur.rowcount)
            _conn.close()
        except Exception as _db_err:
            print(f"[cancel_pending] DB update error: {_db_err}")

    return {
        "cancelled_via_alpaca": bool(cancelled_api),
        "local_rows_updated": sum(cancelled_local),
        "message": "Pending orders cancelled. View confirmed status at paper.alpaca.markets",
    }




@app.post("/api/alpha-decay/run", tags=["alpha_decay"])
async def run_alpha_decay_analysis() -> dict:
    """
    Compute IC half-life and IC-by-lag for every ticker, persist to SQLite, and return results.
    IC half-life: fit IC(t) = IC₀·exp(−λt) via least-squares.
    """
    from alpha_flow.analysis.alpha_decay import compute_alpha_decay_universe

    try:
        results = compute_alpha_decay_universe()
    except Exception as exc:
        raise HTTPException(500, f"Alpha decay computation failed: {exc}")

    for ticker, data in results.items():
        save_alpha_decay(ticker, data.get("half_life_bars"), data.get("ic_by_lag", {}))

    return {
        "tickers": list(results.keys()),
        "results": results,
        "computed_at": datetime.utcnow().isoformat(),
    }


@app.get("/api/alpha-decay", tags=["alpha_decay"])
def get_alpha_decay(ticker: str = Query(default="")) -> list[dict]:
    """
    Return stored alpha decay results.
    Optional ?ticker=AAPL to filter to one symbol.
    """
    return get_alpha_decay_db(ticker.upper() if ticker else None)


# ═══════════════════════════════════════════════════════════════════════════════
# Intraday Analytical Charts — Hawkes, VWAP, Feature Correlation, LGBM Scatter
# ═══════════════════════════════════════════════════════════════════════════════

def _load_hourly_df(ticker: str) -> "pd.DataFrame":
    """Load the best available hourly OHLCV parquet for a ticker."""
    import pandas as pd
    _TICKS = ROOT / "data" / "ticks"
    for suffix in ("_alpaca_hourly.parquet", "_hourly.parquet"):
        p = _TICKS / f"{ticker}{suffix}"
        if p.exists():
            df = pd.read_parquet(str(p))
            df.index = pd.to_datetime(df.index, utc=True)
            return df
    raise FileNotFoundError(f"No hourly parquet for {ticker}")


@app.get("/api/intraday/hawkes", tags=["intraday_charts"])
def get_hawkes_series(ticker: str = Query(...), n: int = Query(default=120)) -> dict:
    """
    Return the last N Hawkes intensity z-scores for a ticker at hourly resolution.
    Hawkes process: self-exciting point process λ(t) = μ + Σ α·exp(−β·(t−tᵢ)).
    Z-scored relative to its own 20-bar rolling mean/std.
    High values indicate trade clustering (burst mode) — a novel intraday alpha signal.
    """
    t = ticker.upper()
    try:
        df = _load_hourly_df(t)
        from alpha_flow.core.hawkes import hawkes_intensity_zscore
        series = hawkes_intensity_zscore(df).dropna().tail(n)
        return {
            "ticker": t,
            "data": [{"time": str(ts), "hawkes_z": round(float(v), 4)} for ts, v in series.items()],
            "note": "Hawkes intensity z-score: >1.5 = clustered trades (buy/sell burst), <−1.5 = calm period"
        }
    except Exception as exc:
        raise HTTPException(500, f"Hawkes computation failed for {t}: {exc}")


@app.get("/api/intraday/vwap", tags=["intraday_charts"])
def get_vwap_series(ticker: str = Query(...), n: int = Query(default=120)) -> dict:
    """
    Return the last N VWAP deviation z-scores for a ticker.
    VWAP deviation = (price − VWAP) / VWAP, z-scored rolling 20-bar.
    Positive = price above VWAP = bullish intraday momentum signal.
    Used as feature 6 in the 12-feature LightGBM model.
    """
    t = ticker.upper()
    try:
        df = _load_hourly_df(t)
        from alpha_flow.core.vwap import vwap_deviation_zscore
        series = vwap_deviation_zscore(df).dropna().tail(n)
        return {
            "ticker": t,
            "data": [{"time": str(ts), "vwap_z": round(float(v), 4)} for ts, v in series.items()],
            "note": "VWAP deviation z-score: >1.5 = price above 20-bar VWAP mean (bullish), <−1.5 = below (bearish)"
        }
    except Exception as exc:
        raise HTTPException(500, f"VWAP computation failed for {t}: {exc}")


@app.get("/api/intraday/vpin", tags=["intraday_charts"])
def get_vpin_series(ticker: str = Query(...), n: int = Query(default=120)) -> dict:
    """
    Return the last N VPIN z-scores for a ticker at hourly resolution.

    VPIN (Volume-Synchronized PIN) uses Bulk Volume Classification to measure
    order flow toxicity: buy_frac = (close − low) / (high − low), then
    VPIN = rolling mean |buy_vol − sell_vol| / total_vol.
    High z-score = elevated informed trading probability → predicts price impact.

    Reference: Easley, López de Prado & O'Hara (2012) Review of Financial Studies 25(5).
    """
    t = ticker.upper()
    try:
        df = _load_hourly_df(t)
        from alpha_flow.core.vpin import vpin_zscore
        series = vpin_zscore(df).dropna().tail(n)
        return {
            "ticker": t,
            "data":   [{"time": str(ts), "vpin_z": round(float(v), 4)} for ts, v in series.items()],
            "note":   "VPIN z-score: >1.5 = elevated informed-trading probability (toxic flow), <−1.5 = unusually calm/symmetric order flow",
        }
    except Exception as exc:
        raise HTTPException(500, f"VPIN computation failed for {t}: {exc}")

@app.get("/api/intraday/feature-correlation", tags=["intraday_charts"])
def get_feature_correlation(ticker: str = Query(...)) -> dict:
    """
    Return the 13×13 Spearman correlation matrix of all LightGBM input features.
    Useful for detecting multicollinearity between signals.
    High correlation (>0.7) between two features means they carry redundant information.
    Result is cached per ticker for 10 minutes to avoid repeated heavy computation.
    """
    t = ticker.upper()
    # Simple module-level cache (TTL ~10 min) — avoids re-computing on every tab switch
    cache_key = f"feat_corr_{t}"
    cached = _FEAT_CORR_CACHE.get(cache_key)
    if cached:
        return cached
    try:
        df = _load_hourly_df(t)
        from alpha_flow.analysis.intraday_engine import build_intraday_feature_matrix, FEATURE_COLS
        feats = build_intraday_feature_matrix(df, horizon=1)
        corr = feats[FEATURE_COLS].corr(method="spearman").round(3)
        result = {
            "ticker": t,
            "features": FEATURE_COLS,
            "matrix": corr.values.tolist(),
            "note": "Spearman correlation of 13 LightGBM input features. Values near ±1 = redundant signals.",
        }
        _FEAT_CORR_CACHE[cache_key] = result
        return result
    except Exception as exc:
        raise HTTPException(500, f"Feature correlation failed for {t}: {exc}")


@app.get("/api/intraday/lgbm-scatter", tags=["intraday_charts"])
def get_lgbm_scatter(ticker: str = Query(...)) -> dict:
    """
    Return per-fold LightGBM predicted vs actual return pairs for scatter plot.
    Each point represents one test-bar prediction.
    Tight scatter around the diagonal = high IC = good model.
    Flat scatter = IC ≈ 0 = model has no edge (expected at daily resolution).
    """
    t = ticker.upper()
    try:
        df = _load_hourly_df(t)
        from alpha_flow.analysis.intraday_engine import build_intraday_feature_matrix, FEATURE_COLS
        from alpha_flow.config.settings import WF_TRAIN_WINDOW, WF_TEST_WINDOW, WF_HORIZON
        from lightgbm import LGBMRegressor  # type: ignore
        import numpy as np
        feats = build_intraday_feature_matrix(df, horizon=WF_HORIZON)
        X = feats[FEATURE_COLS].values
        y = feats["target"].values
        points, fold = [], 0
        train_w = (WF_TRAIN_WINDOW or 252) * 5   # 1,260 hourly bars (matches main pipeline)
        test_w  = (WF_TEST_WINDOW  or 21)  * 5   # 105 hourly bars
        for start in range(0, len(X) - train_w - test_w, test_w):
            X_tr = X[start : start + train_w]
            y_tr = y[start : start + train_w]
            X_te = X[start + train_w : start + train_w + test_w]
            y_te = y[start + train_w : start + train_w + test_w]
            fold += 1
            try:
                m = LGBMRegressor(n_estimators=100, learning_rate=0.05, num_leaves=15, n_jobs=1, verbose=-1)
                m.fit(X_tr, y_tr)
                preds = m.predict(X_te)
                for p, a in zip(preds.tolist(), y_te.tolist()):
                    points.append({"predicted": round(float(p), 6), "actual": round(float(a), 6), "fold": fold})
            except Exception:
                continue
        return {
            "ticker": t,
            "points": points[:2000],   # up to 2k points (14 folds × 250 test bars = 3,500 max)
            "n_folds": fold,
            "note": "LightGBM walk-forward predictions vs actual returns. Good IC = points cluster near the diagonal."
        }
    except Exception as exc:
        raise HTTPException(500, f"LGBM scatter failed for {t}: {exc}")


@app.get("/api/intraday/equity-curve", tags=["intraday_charts"])
def get_equity_curve(ticker: str = Query(...)) -> dict:
    """
    Return the walk-forward equity curve for a ticker (normalised to 1.0 start).
    Read from the persisted DB row — populated after each intraday pipeline run.
    Used by the Walk-Forward Equity Curve chart in the Intraday Analysis section.
    """
    from backend.database import get_intraday_signals_db
    t = ticker.upper()
    cards = get_intraday_signals_db()
    if not cards:
        return {"ticker": t, "equity_curve": [], "error": "No intraday run yet — run the Signal Engine"}
    card = next((c for c in cards if c["ticker"] == t), None)
    if not card:
        return {"ticker": t, "equity_curve": [], "error": f"No data for {t}"}
    equity = card.get("equity_curve") or []
    ic_folds = card.get("ic_per_fold") or []
    return {
        "ticker":        t,
        "equity_curve":  [{"bar": i + 1, "equity": round(v, 6)} for i, v in enumerate(equity)],
        "ic_per_fold":   [round(v, 4) for v in ic_folds],
        "sharpe":        card.get("sharpe", 0.0),
        "max_drawdown":  card.get("max_drawdown", 0.0),
        "n_folds":       card.get("n_folds", 0),
        # Extended production metrics — populated after fresh pipeline run
        "calmar":        card.get("calmar", 0.0),
        "hit_rate":      card.get("hit_rate", 0.0),
        "profit_factor": card.get("profit_factor", 1.0),
        "ic_tstat":      card.get("ic_tstat", 0.0),
        "ic_pvalue":     card.get("ic_pvalue", 1.0),
        "ic_ir":         card.get("ic_ir", 0.0),
        "n_bars":        card.get("n_bars", 0),
        "train_bars":    card.get("train_bars", 0),
        "test_bars":     card.get("test_bars", 0),
        "data_start":    card.get("data_start"),
        "data_end":      card.get("data_end"),
    }


@app.get("/api/portfolio/simulate", tags=["portfolio"])
def portfolio_simulate() -> dict:
    """
    Cross-sectional long-short portfolio: long top-3 IC tickers, short bottom-3 IC tickers.
    Returns gross/net equity curves (after half-spread transaction costs) and CAPM alpha.

    Methodology (Grinold & Kahn 2000, Ch.6-7):
      - Rank all tickers by walk-forward mean IC
      - Long the top-3, short the bottom-3 (equal-weight each leg)
      - Transaction cost: half Corwin-Schultz spread at each monthly rebalance
      - CAPM alpha: OLS regression of daily portfolio returns vs SPY daily returns
    """
    from backend.database import get_intraday_signals_db
    from alpha_flow.analysis.portfolio_engine import build_longshort_portfolio, compute_capm_alpha

    cards = get_intraday_signals_db()
    if not cards:
        return {"error": "No intraday signals — run the Signal Engine first"}

    result = build_longshort_portfolio(cards)
    if "error" in result:
        return result

    # CAPM alpha decomposition (SPY as market proxy)
    if result.get("gross_equity"):
        data_start = next((c.get("data_start") for c in cards if c.get("data_start")), None)
        result["capm"] = compute_capm_alpha(result["gross_equity"], data_start=data_start)

    return result


@app.get("/api/intraday/shap-dependence", tags=["intraday_charts"])
def get_shap_dependence(ticker: str = Query(...), feature: str = Query(default="ofi_zscore")) -> dict:
    """
    Return (feature_value, shap_value) pairs for a selected feature.
    Computed on demand from last-fold LightGBM model — shows non-linear feature relationships.
    Used by the SHAP Dependence Plot in the Intraday Analysis section.
    ~5-15 second compute time on first call; cached in memory thereafter.
    """
    t = ticker.upper()
    cache_key = f"shap_dep_{t}_{feature}"
    if cache_key in _SHAP_DEP_CACHE:
        return _SHAP_DEP_CACHE[cache_key]

    try:
        from alpha_flow.analysis.intraday_engine import build_intraday_feature_matrix, FEATURE_COLS
        from alpha_flow.config.settings import WF_TRAIN_WINDOW, WF_TEST_WINDOW, WF_HORIZON
        from lightgbm import LGBMRegressor  # type: ignore
        import numpy as np

        df = _load_hourly_df(t)
        feats = build_intraday_feature_matrix(df, horizon=WF_HORIZON)
        if feature not in FEATURE_COLS:
            raise HTTPException(400, f"Feature '{feature}' not in FEATURE_COLS")

        X_df = feats[FEATURE_COLS]
        y = feats["target"].values
        n = len(feats)
        train_w = (WF_TRAIN_WINDOW or 200) * 5
        test_w  = (WF_TEST_WINDOW  or 50)  * 5

        # Use last available fold for SHAP dependence
        start = max(0, n - train_w - test_w)
        X_train = X_df.iloc[start : start + train_w]
        y_train = y[start : start + train_w]
        X_test  = X_df.iloc[start + train_w : start + train_w + test_w]

        model = LGBMRegressor(n_estimators=200, learning_rate=0.05, num_leaves=15,
                              subsample=0.8, colsample_bytree=0.8, verbose=-1, random_state=42)
        model.fit(X_train, y_train)

        try:
            import shap
            explainer   = shap.TreeExplainer(model)
            shap_values = explainer.shap_values(X_test)
            feat_idx    = FEATURE_COLS.index(feature)
            feat_vals   = X_test[feature].values.tolist()
            shap_vals   = shap_values[:, feat_idx].tolist()
            points = [{"feature_val": round(float(fv), 4), "shap_val": round(float(sv), 6)}
                      for fv, sv in zip(feat_vals, shap_vals)]
        except ImportError:
            # SHAP not available: fallback to partial dependence approximation
            feat_vals = X_test[feature].values.tolist()
            preds = model.predict(X_test).tolist()
            mu = float(np.mean(preds))
            points = [{"feature_val": round(float(fv), 4), "shap_val": round(float(pv) - mu, 6)}
                      for fv, pv in zip(feat_vals, preds)]

        result = {"ticker": t, "feature": feature, "points": points[:400]}
        _SHAP_DEP_CACHE[cache_key] = result
        return result
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, f"SHAP dependence failed for {t}/{feature}: {exc}")

