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
import sys, traceback, json
from datetime import datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).parent.parent
WORKSPACE = ROOT.parent
for _p in [str(ROOT), str(WORKSPACE)]:
    if _p not in sys.path:
        sys.path.insert(0, _p)

from fastapi import FastAPI, HTTPException, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from backend.database import (init_db, start_run, finish_run, get_run_history,
                              get_latest_signal, upsert_signal,
                              get_latest_signals_by_ticker, get_run_signals)

init_db()

app = FastAPI(title="AlphaFlow — Microstructure Alpha Engine", description="Order Flow Imbalance, Kyle λ, Amihud ILLIQ, LightGBM alpha prediction. References: Kyle (1985), Amihud (2002), Lee & Ready (1991).", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3002", "http://127.0.0.1:3002", "*"],
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
    try:
        from alpha_flow.agent.langgraph_flow import run
        final = run()

        snapshots           = final.get("snapshots", {}) if final else {}
        llm_signals         = final.get("llm_signals", {}) if final else {}
        ic_by_ticker        = final.get("ic_by_ticker", {}) if final else {}
        lgbm_results        = final.get("lgbm_results", {}) if final else {}
        lgbm_prob_by_ticker = final.get("lgbm_prob_by_ticker", {}) if final else {}
        portfolio_stats     = final.get("portfolio_stats", {}) if final else {}
        agg_sharpe    = portfolio_stats.get("sharpe", 0.0)
        agg_mdd       = portfolio_stats.get("max_drawdown", 0.0)
        agg_sortino   = portfolio_stats.get("sortino", 0.0)

        for t, snap in snapshots.items():
            sig_info   = llm_signals.get(t, {})
            ticker_res = lgbm_results.get(t, {})
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
                lgbm_prob=lgbm_prob_by_ticker.get(t, 0.5),
                sharpe=ticker_res.get("sharpe", 0.0),
            )

        # Generate all charts from cached daily data
        _generate_charts(snapshots, ic_by_ticker)

        finish_run(run_id, status="ok", sharpe=agg_sharpe, max_drawdown=agg_mdd, sortino=agg_sortino)
    except Exception as exc:
        traceback.print_exc()
        finish_run(run_id, status="error", error_msg=str(exc))


@app.get("/health", tags=["system"])
def health(): return {"status": "ok", "project": "AlphaFlow — Microstructure Alpha Engine"}


@app.get("/api/info", tags=["system"])
def info() -> dict[str, Any]:
    return {
        "title": "AlphaFlow — Microstructure Alpha Engine",
        "description": "Order Flow Imbalance, Kyle λ, Amihud ILLIQ, LightGBM alpha prediction. References: Kyle (1985), Amihud (2002), Lee & Ready (1991).",
        "endpoints": ["/api/run", "/api/history", "/api/signals", "/api/outputs"],
    }


@app.post("/api/run", tags=["pipeline"])
def trigger_run(background_tasks: BackgroundTasks) -> dict:
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
    """Re-fetch 2-year daily bars for all tickers and update CSV cache."""
    def _refresh_bg():
        from alpha_flow.config.settings import TICKERS
        from alpha_flow.data.data_feed import refresh_all_tickers
        result = refresh_all_tickers(TICKERS)
        print(f"[data refresh] {result}")
    background_tasks.add_task(_refresh_bg)
    return {"status": "started", "message": "Data refresh running in background. Re-run pipeline when complete."}


@app.get("/api/history", tags=["pipeline"])
def run_history(limit: int = Query(20, ge=1, le=100)) -> list[dict]:
    return get_run_history(limit)


@app.get("/api/signals", tags=["signals"])
def get_signal() -> dict:
    row = get_latest_signal()
    return row or {"message": "NO_DATA — run the pipeline first"}


@app.get("/api/signals/all", tags=["signals"])
def get_all_signals() -> list[dict] | dict:
    """Return the latest signal for each ticker from the most recent pipeline run."""
    rows = get_latest_signals_by_ticker()
    if not rows:
        return {"message": "NO_DATA — run the pipeline first"}
    return rows


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
    t = ticker.strip().upper()
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
    return {
        "ticker": ticker, "bars": len(hist), "saved": csv_path.name,
        "name": yf_name, "sector": yf_sector,
        "message": f"Downloaded {len(hist)} bars for {ticker} ({yf_name}, {yf_sector}). Re-run pipeline to include in analysis.",
    }


@app.get("/api/tickers", tags=["data"])
def list_all_tickers() -> list[dict]:
    """Return all tickers (default + custom) with name, sector, and is_custom flag."""
    from alpha_flow.config.settings import TICKERS as DEFAULT_TICKERS, _CUSTOM_TICKERS_FILE
    _META: dict[str, tuple[str, str]] = {
        "AAPL": ("Apple Inc.", "Technology"), "MSFT": ("Microsoft Corp.", "Technology"),
        "NVDA": ("NVIDIA Corp.", "Semiconductors"), "META": ("Meta Platforms", "Technology"),
        "GOOGL": ("Alphabet Inc.", "Technology"), "AMZN": ("Amazon.com", "Technology"),
        "TSLA": ("Tesla Inc.", "Consumer"), "JPM": ("JPMorgan Chase", "Financials"),
        "BAC": ("Bank of America", "Financials"), "V": ("Visa Inc.", "Financials"),
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
    return {"deleted": t, "remaining_custom": remaining}


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
    """IC at lags 1-10 per ticker + cross-sectional average for the Alpha Decay chart."""
    import numpy as np
    from scipy.stats import spearmanr
    from alpha_flow.config.settings import get_all_tickers as _gat
    from alpha_flow.data.data_feed import get_daily_bars
    from alpha_flow.core.ofi_calculator import rolling_ofi_zscore
    by_ticker: dict[str, dict] = {}
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
        except Exception:
            pass
    average = {lag: round(float(np.mean(vals)), 4) if vals else 0.0 for lag, vals in all_ic.items()}
    return {"by_ticker": by_ticker, "average": average}


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

_GROQ_CHART_CONTEXTS: dict[str, str] = {
    "ofi_zscore_chart.png": (
        "A multi-line time-series chart showing the Order Flow Imbalance (OFI) Z-score "
        "for all 10 analysed tickers over the last 60 trading bars. The OFI Z-score measures "
        "net buying vs selling pressure, normalised to a rolling 20-bar z-score. Values above "
        "+1.5 (amber dashed line) indicate sustained buying pressure; below -1.5 indicates "
        "selling pressure. Each coloured line represents one ticker. "
        "Signals above the threshold are candidates for BUY; below -1.5 for SELL."
    ),
    "ofi_intraday_heatmap.png": (
        "An intraday heatmap of Order Flow Imbalance (OFI) pivoted by hour-of-day (rows) and "
        "day-of-week (columns). OFI measures the net pressure from buyer-initiated versus "
        "seller-initiated trades. Green cells indicate periods of heavy buying pressure; "
        "red cells indicate selling pressure. Clusters at specific hours reveal systematic "
        "intraday liquidity patterns consistent with institutional order scheduling (VWAP/TWAP)."
    ),
    "execution_quality.png": (
        "A dual-panel time-series chart. Top panel: Corwin-Schultz effective bid-ask spread "
        "(in basis points) — the implicit cost to cross the spread; lower is better for traders. "
        "Bottom panel: Amihud (2002) illiquidity ratio — price impact per $1M of traded volume; "
        "spikes indicate periods when large trades moved the price significantly."
    ),
    "kyle_lambda_trend.png": (
        "A time-series of Kyle's lambda (λ) — the linear price impact coefficient from Kyle (1985). "
        "The thin line shows daily lambda; the thick line is a 30-day rolling average. "
        "Higher lambda means each unit of order flow moves the price more, indicating lower "
        "effective liquidity or elevated institutional activity. Declining lambda over time "
        "signals improving market depth."
    ),
    "alpha_decay.png": (
        "A bar chart showing the Spearman Information Coefficient (IC) between the OFI signal "
        "and forward equity returns at lags 1 through 10. Green bars indicate the OFI signal "
        "positively predicts returns at that lag; red bars indicate an inverted signal. "
        "The amber dashed lines mark the ±0.05 statistical significance threshold used in "
        "quantitative finance (Grinold & Kahn, 2000). Rapid IC decay confirms the signal "
        "is short-lived — characteristic of microstructure alpha."
    ),
}

_PROJECT_CONTEXT = """AlphaFlow is a microstructure alpha signal generator that analyses order flow imbalance (OFI), Kyle's lambda (price impact), and Amihud illiquidity to predict short-term price movements. Uses Alpaca real-time data feeds to detect institutional trading signatures and generate execution signals."""

@app.post("/api/explain", tags=["ai"])
async def explain_chart(body: dict) -> dict:
    """Call Groq to explain a chart in plain English (temperature=0.1)."""
    filename = body.get("filename", "")
    if ".." in filename or "/" in filename:
        raise HTTPException(400, "Invalid filename")
    
    chart_desc = _GROQ_CHART_CONTEXTS.get(filename)
    if not chart_desc:
        chart_desc = f"A quantitative analysis chart named {filename} from the {_PROJECT_CONTEXT[:50]} system."
    
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
                    "content": f"Explain this chart:\n{chart_desc}\n\nProject: {_PROJECT_CONTEXT}"
                }
            ],
        )
        return {"filename": filename, "explanation": explanation, "model": "llama-3.3-70b-versatile"}
    except Exception as exc:
        # Always return useful content even when Groq is unavailable
        return {"filename": filename, "explanation": chart_desc, "model": "static-fallback", "error": str(exc)}


import re as _re

def _build_chat_context(message: str) -> str:
    """Build a rich system context for chat, injecting live ticker data if mentioned."""
    # Detect ticker symbols in message (2-5 uppercase letters, common US tickers)
    tickers_mentioned = _re.findall(r'\b([A-Z]{2,5})\b', message)
    
    # Always include all-ticker summary from DB
    live_rows = get_latest_signals_by_ticker()
    if live_rows:
        ts = live_rows[0].get("recorded_at", "")[:16] if live_rows else ""
        rows_text = "\n".join(
            f"  {r['ticker']:<6} OFI_z={r.get('ofi', 0):+.3f}  "
            f"Kyle_λ={r.get('kyle_lambda', 0):.3e}  "
            f"Spread={r.get('eff_spread_bps', 0):.1f}bps  "
            f"Amihud={r.get('amihud_illiq', 0):.3e}  "
            f"IC={r.get('ic_value', 0) or 0:.4f}  "
            f"Signal={r.get('signal', 'HOLD')}  "
            f"Reason: {(r.get('llm_reason') or '')[:80]}"
            for r in live_rows
        )
        live_context = f"\n\nLIVE DASHBOARD DATA (as of {ts} UTC):\n{rows_text}"
    else:
        live_context = "\n\nLIVE DASHBOARD DATA: No pipeline runs yet."

    # Extra context for specific tickers mentioned
    ticker_context = ""
    ticker_map = {r["ticker"]: r for r in live_rows}
    for tkr in tickers_mentioned:
        if tkr in ticker_map:
            r = ticker_map[tkr]
            ticker_context += (
                f"\n\nDETAILED DATA FOR {tkr}:\n"
                f"  OFI Z-score: {r.get('ofi', 0):+.4f} (positive = net buying pressure; range ≈ -3 to +3)\n"
                f"  Kyle's Lambda: {r.get('kyle_lambda', 0):.4e} $/share (price impact per unit order flow)\n"
                f"  Amihud ILLIQ: {r.get('amihud_illiq', 0):.4e} price_chg/$1M_vol\n"
                f"  Effective Spread: {r.get('eff_spread_bps', 0):.2f} bps (Corwin-Schultz estimate)\n"
                f"  Walk-forward IC: {r.get('ic_value', 0) or 0:.4f} (Spearman ρ; >0.05 = significant)\n"
                f"  LLM Signal: {r.get('signal', 'HOLD')}\n"
                f"  LLM Reason: {r.get('llm_reason', 'N/A')}"
            )

    return _PROJECT_CONTEXT + live_context + ticker_context


@app.post("/api/chat", tags=["ai"])
async def chat(body: dict) -> dict:
    """Chat with Groq about this project (temperature=0.2). Injects live ticker data."""
    message = body.get("message", "").strip()
    history = body.get("history", [])
    
    if not message:
        raise HTTPException(400, "message is required")
    if len(message) > 500:
        raise HTTPException(400, "message too long (max 500 chars)")

    grounded_context = _build_chat_context(message)
    
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
