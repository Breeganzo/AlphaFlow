"""
backend/database.py — SQLite persistence for AlphaFlow (P2).
"""
from __future__ import annotations
import sqlite3
from datetime import datetime
from pathlib import Path

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
        """)
    # Non-destructive column migrations for existing DBs (ALTER TABLE is idempotent-ish)
    _migrate_columns()


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
                           (datetime.utcnow().isoformat(), "running"))
        return cur.lastrowid  # type: ignore[return-value]


_MAX_RUNS = 10  # Keep only the last N completed runs in history


def finish_run(run_id: int, *, status: str = "ok", error_msg: str | None = None,
               sharpe: float | None = None, max_drawdown: float | None = None,
               sortino: float | None = None) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE run_history SET finished_at=?, status=?, error_msg=?, sharpe=?, max_drawdown=?, sortino=? WHERE id=?",
            (datetime.utcnow().isoformat(), status, error_msg,
             round(sharpe, 4) if sharpe is not None else 0.0,
             round(max_drawdown, 4) if max_drawdown is not None else 0.0,
             round(sortino, 4) if sortino is not None else 0.0,
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
            (run_id, datetime.utcnow().isoformat(), ticker, ofi, kyle_lambda,
             amihud, eff_spread, signal, llm_reason, ic_value,
             round(lgbm_prob, 4) if lgbm_prob is not None else 0.5,
             round(sharpe, 4) if sharpe is not None else 0.0),
        )


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


init_db()
