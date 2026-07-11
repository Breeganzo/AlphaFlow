"""
backend/database.py — SQLite persistence for AlphaFlow (P2).
"""
from __future__ import annotations
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

_UTC = timezone.utc

def _now_iso() -> str:
    """Return current UTC time as ISO 8601 string (timezone-aware)."""
    return datetime.now(_UTC).isoformat()

# DATA_DIR: use /var/data on Render (persistent disk), fall back to repo data/
_DATA_DIR = Path(os.environ.get("DATA_DIR", str(Path(__file__).parent.parent / "data")))
DB_PATH = _DATA_DIR / "app.db"


def get_conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with get_conn() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS run_history (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at  TEXT NOT NULL,
            finished_at TEXT,
            status      TEXT NOT NULL DEFAULT 'running',
            error_msg   TEXT
        );
        CREATE TABLE IF NOT EXISTS microstructure_signals (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id          INTEGER,
            recorded_at     TEXT NOT NULL,
            ticker          TEXT,
            ofi             REAL,
            kyle_lambda     REAL,
            amihud_illiq    REAL,
            eff_spread_bps  REAL,
            signal          TEXT,
            llm_reason      TEXT,
            ic_value        REAL
        );
        CREATE TABLE IF NOT EXISTS shap_importance (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            saved_at   TEXT NOT NULL,
            ticker     TEXT NOT NULL,
            mean_ic    REAL NOT NULL DEFAULT 0.0,
            feature    TEXT NOT NULL,
            importance REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS intraday_signals (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            saved_at     TEXT NOT NULL,
            ticker       TEXT NOT NULL,
            signal       TEXT,
            mean_ic      REAL DEFAULT 0.0,
            sharpe       REAL DEFAULT 0.0,
            sortino      REAL DEFAULT 0.0,
            max_drawdown REAL DEFAULT 0.0,
            n_folds      INTEGER DEFAULT 0,
            n_bars       INTEGER DEFAULT 0,
            train_bars   INTEGER DEFAULT 0,
            test_bars    INTEGER DEFAULT 0,
            data_start   TEXT,
            data_end     TEXT,
            shap_top     TEXT
        );
        CREATE TABLE IF NOT EXISTS paper_trades (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker       TEXT NOT NULL,
            signal       TEXT NOT NULL,
            qty          INTEGER NOT NULL DEFAULT 10,
            order_id     TEXT,
            status       TEXT DEFAULT 'pending',
            filled_price REAL,
            submitted_at TEXT NOT NULL,
            filled_at    TEXT
        );
        CREATE TABLE IF NOT EXISTS alpha_decay (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            computed_at    TEXT NOT NULL,
            ticker         TEXT NOT NULL,
            half_life_bars REAL,
            ic_by_lag_json TEXT
        );
        """)
    # Non-destructive column migrations for existing DBs (ALTER TABLE is idempotent-ish)
    _migrate_columns()
    # Purge any stale rows from removed tickers (safe: no-op if all tickers match)
    try:
        delete_signals_for_inactive_tickers()
    except Exception:
        pass  # Defer if settings not yet importable


def _migrate_columns() -> None:
    """Add new columns to existing DB without data loss."""
    cols_to_add = [
        ("microstructure_signals", "run_id",    "INTEGER"),
        ("microstructure_signals", "llm_reason", "TEXT"),
        ("microstructure_signals", "ic_value",   "REAL"),
        ("microstructure_signals", "lgbm_prob",  "REAL DEFAULT 0.5"),
        ("microstructure_signals", "sharpe",     "REAL DEFAULT 0.0"),
        ("run_history",            "sharpe",     "REAL DEFAULT 0.0"),
        ("run_history",            "max_drawdown", "REAL DEFAULT 0.0"),
        ("run_history",            "sortino",    "REAL DEFAULT 0.0"),
        ("run_history",            "data_start", "TEXT"),
        ("run_history",            "data_end",   "TEXT"),
        ("run_history",            "total_bars", "INTEGER DEFAULT 0"),
        # Intraday enrichment columns (added in upgrade)
        ("intraday_signals",       "last_features",     "TEXT"),
        ("intraday_signals",       "equity_curve_json", "TEXT"),
        ("intraday_signals",       "ic_per_fold_json",  "TEXT"),
        # Advanced tearsheet metrics — Fundamental Law + advanced ratios
        ("intraday_signals",       "ic_ir",             "REAL"),
        ("intraday_signals",       "ic_tstat",          "REAL"),
        ("intraday_signals",       "ic_pvalue",         "REAL"),
        ("intraday_signals",       "calmar",            "REAL"),
        ("intraday_signals",       "omega",             "REAL"),
        ("intraday_signals",       "hit_rate",          "REAL"),
        ("intraday_signals",       "profit_factor",     "REAL"),
        # Standard Error of the Mean — walk-forward fold sampling
        ("intraday_signals",       "ic_sem",            "REAL"),
        ("intraday_signals",       "sharpe_sem",        "REAL"),
        ("intraday_signals",       "hit_rate_sem",      "REAL"),
        # Real per-bar timestamps aligned with equity_curve (Portfolio Sim x-axis)
        ("intraday_signals",       "equity_dates_json", "TEXT"),
        # Directional ranking signal (latest direction-corrected predicted return)
        ("intraday_signals",       "latest_signal",     "REAL"),
        # Alpha decay bootstrap CI
        ("alpha_decay",            "half_life_ci_5",    "REAL"),
        ("alpha_decay",            "half_life_ci_95",   "REAL"),
    ]
    with get_conn() as conn:
        sig_cols   = {row[1] for row in conn.execute("PRAGMA table_info(microstructure_signals)").fetchall()}
        run_cols   = {row[1] for row in conn.execute("PRAGMA table_info(run_history)").fetchall()}
        intra_cols = {row[1] for row in conn.execute("PRAGMA table_info(intraday_signals)").fetchall()}
        decay_cols = {row[1] for row in conn.execute("PRAGMA table_info(alpha_decay)").fetchall()}
        existing = {
            "microstructure_signals": sig_cols,
            "run_history":            run_cols,
            "intraday_signals":       intra_cols,
            "alpha_decay":            decay_cols,
        }
        for table, col, col_type in cols_to_add:
            if col not in existing.get(table, set()):
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {col_type}")


def start_run() -> int:
    with get_conn() as conn:
        cur = conn.execute("INSERT INTO run_history (started_at, status) VALUES (?,?)",
                           (_now_iso(), "running"))
        return cur.lastrowid  # type: ignore[return-value]


_MAX_RUNS = 10  # Keep only the last N completed runs in history


def finish_run(run_id: int, *, status: str = "ok", error_msg: str | None = None,
               sharpe: float | None = None, max_drawdown: float | None = None,
               sortino: float | None = None,
               data_start: str | None = None, data_end: str | None = None,
               total_bars: int | None = None) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE run_history SET finished_at=?, status=?, error_msg=?, sharpe=?, max_drawdown=?, sortino=?, data_start=?, data_end=?, total_bars=? WHERE id=?",
            (_now_iso(), status, error_msg,
             round(sharpe, 4) if sharpe is not None else 0.0,
             round(max_drawdown, 4) if max_drawdown is not None else 0.0,
             round(sortino, 4) if sortino is not None else 0.0,
             data_start, data_end, total_bars or 0,
             run_id),
        )
        # Purge oldest runs beyond _MAX_RUNS (keep data clean)
        old_runs = conn.execute(
            "SELECT id FROM run_history WHERE status != 'running' "
            "ORDER BY id DESC LIMIT -1 OFFSET ?",
            (_MAX_RUNS,),
        ).fetchall()
        if old_runs:
            ids = tuple(r["id"] for r in old_runs)
            placeholders = ",".join("?" * len(ids))
            conn.execute(f"DELETE FROM microstructure_signals WHERE run_id IN ({placeholders})", ids)
            conn.execute(f"DELETE FROM run_history WHERE id IN ({placeholders})", ids)


def get_run_history(limit: int = 20) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM run_history ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [dict(r) for r in rows]


_STALE_RUN_MINUTES = 20  # a 'running' row older than this is treated as abandoned (e.g. backend was killed mid-run)


def get_active_run() -> dict | None:
    """
    Return the most recent run_history row still marked 'running', or None.

    Guards against duplicate/concurrent pipeline triggers (OWASP API4:2023 —
    unrestricted resource consumption): callers should check this before
    starting a new run. A stale row (older than _STALE_RUN_MINUTES, e.g. left
    behind by a crashed/killed backend process) is treated as inactive so a
    genuinely stuck state can never permanently block new runs.
    """
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM run_history WHERE status = 'running' ORDER BY id DESC LIMIT 1"
        ).fetchone()
    if not row:
        return None
    run = dict(row)
    try:
        started = datetime.fromisoformat(run["started_at"])
        if started.tzinfo is None:
            started = started.replace(tzinfo=_UTC)
        age_minutes = (datetime.now(_UTC) - started).total_seconds() / 60.0
        if age_minutes > _STALE_RUN_MINUTES:
            return None
    except Exception:
        pass
    return run


def upsert_signal(
    ticker: str, ofi: float, kyle_lambda: float, amihud: float,
    eff_spread: float, signal: str,
    run_id: int | None = None,
    llm_reason: str | None = None,
    ic_value: float | None = None,
    lgbm_prob: float | None = None,
    sharpe: float | None = None,
) -> None:
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO microstructure_signals
               (run_id, recorded_at, ticker, ofi, kyle_lambda, amihud_illiq,
                eff_spread_bps, signal, llm_reason, ic_value, lgbm_prob, sharpe)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (run_id, _now_iso(), ticker, ofi, kyle_lambda,
             amihud, eff_spread, signal, llm_reason, ic_value,
             round(lgbm_prob, 4) if lgbm_prob is not None else 0.5,
             round(sharpe, 4) if sharpe is not None else 0.0),
        )


def delete_signals_for_inactive_tickers() -> int:
    """Remove signal rows for tickers no longer in the active universe.
    Called on startup and at the start of each pipeline run to keep the DB clean.
    Returns the number of rows deleted.
    """
    from alpha_flow.config.settings import get_all_tickers
    active = get_all_tickers()
    if not active:
        return 0
    placeholders = ",".join("?" * len(active))
    with get_conn() as conn:
        cur = conn.execute(
            f"DELETE FROM microstructure_signals WHERE ticker NOT IN ({placeholders})",
            active,
        )
        deleted = cur.rowcount
    if deleted:
        print(f"[db cleanup] Removed {deleted} signal rows for inactive tickers.")
    return deleted


def get_latest_signal() -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM microstructure_signals ORDER BY id DESC LIMIT 1").fetchone()
    return dict(row) if row else None


def get_latest_signals_by_ticker() -> list[dict]:
    """Return the most recent signal row for each distinct ticker (from most recent run)."""
    with get_conn() as conn:
        rows = conn.execute("""
            SELECT * FROM microstructure_signals
            WHERE id IN (
                SELECT MAX(id) FROM microstructure_signals GROUP BY ticker
            )
            ORDER BY eff_spread_bps DESC
        """).fetchall()
    return [dict(r) for r in rows]


def get_run_signals(run_id: int) -> list[dict]:
    """Return all signals recorded for a specific run_id."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM microstructure_signals WHERE run_id=? ORDER BY eff_spread_bps DESC",
            (run_id,)
        ).fetchall()
    return [dict(r) for r in rows]


# ── SHAP persistence ──────────────────────────────────────────────────────────

def save_shap_importance(ticker: str, features: list[dict], mean_ic: float = 0.0) -> None:
    """Persist SHAP feature importances for a ticker. Replaces any existing entries.

    Args:
        ticker   : equity ticker symbol, or 'ALL' for universe aggregate
        features : list of {feature: str, importance: float} sorted desc by importance
        mean_ic  : walk-forward mean IC for this ticker (stored for quick retrieval)
    """
    with get_conn() as conn:
        conn.execute("DELETE FROM shap_importance WHERE ticker = ?", (ticker,))
        now = _now_iso()
        conn.executemany(
            "INSERT INTO shap_importance (saved_at, ticker, mean_ic, feature, importance) VALUES (?,?,?,?,?)",
            [(now, ticker, round(mean_ic, 6), f["feature"], round(f["importance"], 6)) for f in features],
        )


def get_shap_from_db(ticker: str) -> dict | None:
    """Return SHAP importances from DB for a given ticker.

    Returns None if no data has been saved yet (i.e. intraday pipeline has never run).
    """
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT feature, importance, mean_ic FROM shap_importance "
            "WHERE ticker = ? ORDER BY importance DESC LIMIT 8",
            (ticker,),
        ).fetchall()
    if not rows:
        return None
    features = [{"feature": r["feature"], "importance": r["importance"]} for r in rows]
    mean_ic = rows[0]["mean_ic"]
    return {"ticker": ticker, "features": features, "mean_ic": mean_ic}


# ── Intraday signal cards persistence ────────────────────────────────────────

def save_intraday_signals(cards: list[dict]) -> None:
    """Persist hourly intraday signal cards. Replaces all existing rows on each run."""
    import json as _json
    with get_conn() as conn:
        conn.execute("DELETE FROM intraday_signals")
        now = _now_iso()
        conn.executemany(
            """INSERT INTO intraday_signals
               (saved_at, ticker, signal, mean_ic, sharpe, sortino, max_drawdown,
                n_folds, n_bars, train_bars, test_bars, data_start, data_end, shap_top,
                last_features, equity_curve_json, ic_per_fold_json,
                ic_ir, ic_tstat, ic_pvalue, calmar, omega, hit_rate, profit_factor,
                ic_sem, sharpe_sem, hit_rate_sem, equity_dates_json, latest_signal)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            [(now, c["ticker"], c.get("signal"), c.get("mean_ic", 0.0),
              c.get("sharpe", 0.0), c.get("sortino"), c.get("max_drawdown", 0.0),
              c.get("n_folds", 0), c.get("n_bars", 0), c.get("train_bars", 0),
              c.get("test_bars", 0), c.get("data_start"), c.get("data_end"),
              c.get("shap_top"),
              _json.dumps(c.get("last_features") or {}),
              _json.dumps(c.get("equity_curve") or []),
              _json.dumps(c.get("ic_per_fold") or []),
              c.get("ic_ir"), c.get("ic_tstat"), c.get("ic_pvalue"),
              c.get("calmar"), c.get("omega"), c.get("hit_rate"), c.get("profit_factor"),
              c.get("ic_sem"), c.get("sharpe_sem"), c.get("hit_rate_sem"),
              _json.dumps(c.get("equity_dates") or []), c.get("latest_signal", 0.0)) for c in cards],
        )


def get_intraday_signals_db() -> list[dict] | None:
    """Return hourly intraday signal cards from DB.
    Returns None when no intraday pipeline has ever been run.
    """
    import json as _json
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM intraday_signals ORDER BY ABS(mean_ic) DESC"
        ).fetchall()
    if not rows:
        return None
    results = []
    for r in rows:
        d = dict(r)
        # Deserialise JSON blobs (columns added by migration — may be None for old rows)
        for jcol, key in (("last_features", "last_features"), ("equity_curve_json", "equity_curve"), ("ic_per_fold_json", "ic_per_fold"), ("equity_dates_json", "equity_dates")):
            raw = d.pop(jcol, None)
            try:
                d[key] = _json.loads(raw) if raw else ({} if key == "last_features" else [])
            except Exception:
                d[key] = {} if key == "last_features" else []
        # Normalise: sortino=0.0 from old schema means "not computed" — treat as None
        if d.get("sortino") == 0.0 and d.get("ic_ir") is None:
            d["sortino"] = None
        results.append(d)
    return results


# ── Paper trading persistence ──────────────────────────────────────────────────

def save_paper_trade(
    ticker: str,
    signal: str,
    qty: int = 10,
    order_id: str | None = None,
    status: str = "pending",
    filled_price: float | None = None,
    filled_at: str | None = None,
) -> int:
    """Insert a new paper trade row and return its row id."""
    with get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO paper_trades
               (ticker, signal, qty, order_id, status, filled_price, submitted_at, filled_at)
               VALUES (?,?,?,?,?,?,?,?)""",
            (ticker.upper(), signal.upper(), qty, order_id, status,
             filled_price, _now_iso(), filled_at),
        )
        return cur.lastrowid  # type: ignore[return-value]


def get_paper_trades(limit: int = 50) -> list[dict]:
    """Return the most recent paper trades, newest first."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM paper_trades ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]


# ── Alpha decay persistence ────────────────────────────────────────────────────

def save_alpha_decay(ticker: str, half_life_bars: float | None, ic_by_lag: dict) -> None:
    """Persist alpha decay result for one ticker. Replaces any existing row."""
    import json as _json
    with get_conn() as conn:
        conn.execute("DELETE FROM alpha_decay WHERE ticker=?", (ticker,))
        conn.execute(
            "INSERT INTO alpha_decay (computed_at, ticker, half_life_bars, ic_by_lag_json) VALUES (?,?,?,?)",
            (_now_iso(), ticker, half_life_bars, _json.dumps(ic_by_lag)),
        )


def get_alpha_decay_db(ticker: str | None = None) -> list[dict]:
    """Return stored alpha decay results.  Pass ticker to filter to one symbol."""
    import json as _json
    with get_conn() as conn:
        if ticker:
            rows = conn.execute(
                "SELECT * FROM alpha_decay WHERE ticker=? ORDER BY id DESC LIMIT 1",
                (ticker.upper(),),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM alpha_decay ORDER BY ticker"
            ).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d["ic_by_lag"] = _json.loads(d.pop("ic_by_lag_json", "{}"))
        result.append(d)
    return result


def get_avg_intraday_ic() -> float | None:
    """Return avg |mean_ic| from hourly intraday signals, or None if none computed yet."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT AVG(ABS(mean_ic)) AS avg_ic, COUNT(*) AS n FROM intraday_signals WHERE mean_ic IS NOT NULL"
        ).fetchone()
    if row and row["n"] > 0:
        return float(row["avg_ic"])
    return None


init_db()
