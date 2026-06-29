"""
backend/database.py — SQLite persistence for AlphaFlow (P2).
"""
from __future__ import annotations
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

_UTC = timezone.utc

def _now_iso() -> str:
    """Return current UTC time as ISO 8601 string (timezone-aware)."""
    return datetime.now(_UTC).isoformat()

DB_PATH = Path(__file__).parent.parent / "data" / "app.db"


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
    ]
    with get_conn() as conn:
        sig_cols = {row[1] for row in conn.execute("PRAGMA table_info(microstructure_signals)").fetchall()}
        run_cols = {row[1] for row in conn.execute("PRAGMA table_info(run_history)").fetchall()}
        existing = {"microstructure_signals": sig_cols, "run_history": run_cols}
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


def get_shap_all_from_db() -> dict | None:
    """Return cross-ticker average SHAP importances from DB (ticker='ALL' row if saved)."""
    return get_shap_from_db("ALL")


# ── Intraday signal cards persistence ────────────────────────────────────────

def save_intraday_signals(cards: list[dict]) -> None:
    """Persist Phase 2 intraday signal cards. Replaces all existing rows on each run."""
    with get_conn() as conn:
        conn.execute("DELETE FROM intraday_signals")
        now = _now_iso()
        conn.executemany(
            """INSERT INTO intraday_signals
               (saved_at, ticker, signal, mean_ic, sharpe, sortino, max_drawdown,
                n_folds, n_bars, train_bars, test_bars, data_start, data_end, shap_top)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            [(now, c["ticker"], c.get("signal"), c.get("mean_ic", 0.0),
              c.get("sharpe", 0.0), c.get("sortino", 0.0), c.get("max_drawdown", 0.0),
              c.get("n_folds", 0), c.get("n_bars", 0), c.get("train_bars", 0),
              c.get("test_bars", 0), c.get("data_start"), c.get("data_end"),
              c.get("shap_top")) for c in cards],
        )


def get_intraday_signals_db() -> list[dict] | None:
    """Return Phase 2 intraday signal cards from DB.
    Returns None when no intraday pipeline has ever been run.
    """
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM intraday_signals ORDER BY ABS(mean_ic) DESC"
        ).fetchall()
    if not rows:
        return None
    return [dict(r) for r in rows]


init_db()
