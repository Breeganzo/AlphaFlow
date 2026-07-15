"""
backend/database.py — Dual-mode persistence for AlphaFlow.

Supports Postgres (Neon free tier) when DATABASE_URL is set,
falls back to SQLite for local development when it is not.
"""
from __future__ import annotations
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

_UTC = timezone.utc

# ── Mode detection ────────────────────────────────────────────────────────────

_DATABASE_URL = os.environ.get("DATABASE_URL", "")
_USE_PG = bool(_DATABASE_URL)

_pg_pool = None

if _USE_PG:
    import psycopg2
    import psycopg2.pool
    import psycopg2.extras
    _pg_pool = psycopg2.pool.SimpleConnectionPool(1, 5, _DATABASE_URL)

# SQLite fallback paths
_DATA_DIR = Path(os.environ.get("DATA_DIR", str(Path(__file__).parent.parent / "data")))
DB_PATH = _DATA_DIR / "app.db"


def _now_iso() -> str:
    return datetime.now(_UTC).isoformat()


def _ph(n: int = 1) -> str:
    """Return n joined parameter placeholders for the active backend."""
    p = "%s" if _USE_PG else "?"
    return ",".join([p] * n)


@contextmanager
def get_conn():
    """Yield a DB connection (Postgres or SQLite). Auto-commits on success, rolls back on error."""
    if _USE_PG:
        conn = _pg_pool.getconn()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            _pg_pool.putconn(conn)
    else:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


def _execute(conn, sql: str, params=None):
    """Execute a query, adapting cursor creation for the active backend."""
    if _USE_PG:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(sql, params or ())
        return cur
    else:
        return conn.execute(sql, params or ())


def _fetchall(conn, sql: str, params=None) -> list[dict]:
    cur = _execute(conn, sql, params)
    rows = cur.fetchall()
    return [dict(r) for r in rows]


def _fetchone(conn, sql: str, params=None) -> dict | None:
    cur = _execute(conn, sql, params)
    row = cur.fetchone()
    return dict(row) if row else None


def _insert_returning_id(conn, sql_template: str, params: tuple) -> int:
    """INSERT and return the new row's id. Uses RETURNING on Postgres, lastrowid on SQLite."""
    if _USE_PG:
        sql = sql_template + " RETURNING id"
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(sql, params)
        return cur.fetchone()["id"]
    else:
        cur = conn.execute(sql_template, params)
        return cur.lastrowid  # type: ignore[return-value]


# ── Schema ────────────────────────────────────────────────────────────────────

_PK = "SERIAL PRIMARY KEY" if _USE_PG else "INTEGER PRIMARY KEY AUTOINCREMENT"

_CREATE_TABLES = [
    f"""CREATE TABLE IF NOT EXISTS run_history (
        id          {_PK},
        started_at  TEXT NOT NULL,
        finished_at TEXT,
        status      TEXT NOT NULL DEFAULT 'running',
        error_msg   TEXT
    )""",
    f"""CREATE TABLE IF NOT EXISTS microstructure_signals (
        id              {_PK},
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
    )""",
    f"""CREATE TABLE IF NOT EXISTS shap_importance (
        id         {_PK},
        saved_at   TEXT NOT NULL,
        ticker     TEXT NOT NULL,
        mean_ic    REAL NOT NULL DEFAULT 0.0,
        feature    TEXT NOT NULL,
        importance REAL NOT NULL
    )""",
    f"""CREATE TABLE IF NOT EXISTS intraday_signals (
        id           {_PK},
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
    )""",
    f"""CREATE TABLE IF NOT EXISTS paper_trades (
        id           {_PK},
        ticker       TEXT NOT NULL,
        signal       TEXT NOT NULL,
        qty          INTEGER NOT NULL DEFAULT 10,
        order_id     TEXT,
        status       TEXT DEFAULT 'pending',
        filled_price REAL,
        submitted_at TEXT NOT NULL,
        filled_at    TEXT
    )""",
    f"""CREATE TABLE IF NOT EXISTS alpha_decay (
        id             {_PK},
        computed_at    TEXT NOT NULL,
        ticker         TEXT NOT NULL,
        half_life_bars REAL,
        ic_by_lag_json TEXT
    )""",
    f"""CREATE TABLE IF NOT EXISTS open_positions (
        id                {_PK},
        ticker            TEXT NOT NULL,
        side              TEXT NOT NULL,
        qty               INTEGER NOT NULL DEFAULT 10,
        entry_price       REAL,
        stop_loss_price   REAL,
        take_profit_price REAL,
        opened_at         TEXT NOT NULL,
        status            TEXT NOT NULL DEFAULT 'open',
        exit_price        REAL,
        close_reason      TEXT,
        closed_at         TEXT
    )""",
]

_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_signals_ticker_recorded ON microstructure_signals(ticker, recorded_at)",
    "CREATE INDEX IF NOT EXISTS idx_intraday_ticker ON intraday_signals(ticker)",
    "CREATE INDEX IF NOT EXISTS idx_positions_status ON open_positions(status)",
    "CREATE INDEX IF NOT EXISTS idx_trades_submitted ON paper_trades(submitted_at DESC)",
]


def init_db() -> None:
    with get_conn() as conn:
        for ddl in _CREATE_TABLES:
            _execute(conn, ddl)
        for idx in _INDEXES:
            _execute(conn, idx)
    _migrate_columns()
    try:
        delete_signals_for_inactive_tickers()
    except Exception:
        pass


def _get_existing_columns(conn, table: str) -> set[str]:
    if _USE_PG:
        rows = _fetchall(
            conn,
            "SELECT column_name FROM information_schema.columns WHERE table_name = %s",
            (table,),
        )
        return {r["column_name"] for r in rows}
    else:
        rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
        return {row[1] for row in rows}


def _migrate_columns() -> None:
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
        ("intraday_signals",       "last_features",     "TEXT"),
        ("intraday_signals",       "equity_curve_json", "TEXT"),
        ("intraday_signals",       "ic_per_fold_json",  "TEXT"),
        ("intraday_signals",       "ic_ir",             "REAL"),
        ("intraday_signals",       "ic_tstat",          "REAL"),
        ("intraday_signals",       "ic_pvalue",         "REAL"),
        ("intraday_signals",       "calmar",            "REAL"),
        ("intraday_signals",       "omega",             "REAL"),
        ("intraday_signals",       "hit_rate",          "REAL"),
        ("intraday_signals",       "profit_factor",     "REAL"),
        ("intraday_signals",       "ic_sem",            "REAL"),
        ("intraday_signals",       "sharpe_sem",        "REAL"),
        ("intraday_signals",       "hit_rate_sem",      "REAL"),
        ("intraday_signals",       "equity_dates_json", "TEXT"),
        ("intraday_signals",       "latest_signal",     "REAL"),
        ("alpha_decay",            "half_life_ci_5",    "REAL"),
        ("alpha_decay",            "half_life_ci_95",   "REAL"),
    ]
    with get_conn() as conn:
        cache: dict[str, set[str]] = {}
        for table, col, col_type in cols_to_add:
            if table not in cache:
                cache[table] = _get_existing_columns(conn, table)
            if col not in cache[table]:
                _execute(conn, f"ALTER TABLE {table} ADD COLUMN {col} {col_type}")
                cache[table].add(col)


# ── Run history ──────────────────────────────────────────────────────────────

def start_run() -> int:
    with get_conn() as conn:
        return _insert_returning_id(
            conn,
            f"INSERT INTO run_history (started_at, status) VALUES ({_ph(2)})",
            (_now_iso(), "running"),
        )


_MAX_RUNS = 10


def finish_run(run_id: int, *, status: str = "ok", error_msg: str | None = None,
               sharpe: float | None = None, max_drawdown: float | None = None,
               sortino: float | None = None,
               data_start: str | None = None, data_end: str | None = None,
               total_bars: int | None = None) -> None:
    p = _ph(10)
    with get_conn() as conn:
        _execute(
            conn,
            f"UPDATE run_history SET finished_at={_ph()}, status={_ph()}, error_msg={_ph()}, "
            f"sharpe={_ph()}, max_drawdown={_ph()}, sortino={_ph()}, data_start={_ph()}, "
            f"data_end={_ph()}, total_bars={_ph()} WHERE id={_ph()}",
            (_now_iso(), status, error_msg,
             round(sharpe, 4) if sharpe is not None else 0.0,
             round(max_drawdown, 4) if max_drawdown is not None else 0.0,
             round(sortino, 4) if sortino is not None else 0.0,
             data_start, data_end, total_bars or 0,
             run_id),
        )
        # Purge oldest runs beyond _MAX_RUNS
        if _USE_PG:
            old_runs = _fetchall(
                conn,
                "SELECT id FROM run_history WHERE status != 'running' "
                "ORDER BY id DESC OFFSET %s",
                (_MAX_RUNS,),
            )
        else:
            old_runs = _fetchall(
                conn,
                "SELECT id FROM run_history WHERE status != 'running' "
                "ORDER BY id DESC LIMIT -1 OFFSET ?",
                (_MAX_RUNS,),
            )
        if old_runs:
            ids = tuple(r["id"] for r in old_runs)
            placeholders = ",".join([_ph()] * len(ids))
            _execute(conn, f"DELETE FROM microstructure_signals WHERE run_id IN ({placeholders})", ids)
            _execute(conn, f"DELETE FROM run_history WHERE id IN ({placeholders})", ids)


def get_run_history(limit: int = 20) -> list[dict]:
    with get_conn() as conn:
        return _fetchall(conn, f"SELECT * FROM run_history ORDER BY id DESC LIMIT {_ph()}", (limit,))


_STALE_RUN_MINUTES = 20


def get_active_run() -> dict | None:
    with get_conn() as conn:
        run = _fetchone(
            conn,
            f"SELECT * FROM run_history WHERE status = 'running' ORDER BY id DESC LIMIT 1",
        )
    if not run:
        return None
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


# ── Microstructure signals ───────────────────────────────────────────────────

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
        _execute(
            conn,
            f"""INSERT INTO microstructure_signals
               (run_id, recorded_at, ticker, ofi, kyle_lambda, amihud_illiq,
                eff_spread_bps, signal, llm_reason, ic_value, lgbm_prob, sharpe)
               VALUES ({_ph(12)})""",
            (run_id, _now_iso(), ticker, ofi, kyle_lambda,
             amihud, eff_spread, signal, llm_reason, ic_value,
             round(lgbm_prob, 4) if lgbm_prob is not None else 0.5,
             round(sharpe, 4) if sharpe is not None else 0.0),
        )


def delete_signals_for_inactive_tickers() -> int:
    from alpha_flow.config.settings import get_all_tickers
    active = get_all_tickers()
    if not active:
        return 0
    placeholders = ",".join([_ph()] * len(active))
    with get_conn() as conn:
        cur = _execute(
            conn,
            f"DELETE FROM microstructure_signals WHERE ticker NOT IN ({placeholders})",
            tuple(active),
        )
        deleted = cur.rowcount
    if deleted:
        print(f"[db cleanup] Removed {deleted} signal rows for inactive tickers.")
    return deleted


def get_latest_signal() -> dict | None:
    with get_conn() as conn:
        return _fetchone(conn, "SELECT * FROM microstructure_signals ORDER BY id DESC LIMIT 1")


def get_latest_signals_by_ticker() -> list[dict]:
    with get_conn() as conn:
        return _fetchall(conn, """
            SELECT * FROM microstructure_signals
            WHERE id IN (
                SELECT MAX(id) FROM microstructure_signals GROUP BY ticker
            )
            ORDER BY eff_spread_bps DESC
        """)


def get_run_signals(run_id: int) -> list[dict]:
    with get_conn() as conn:
        return _fetchall(
            conn,
            f"SELECT * FROM microstructure_signals WHERE run_id={_ph()} ORDER BY eff_spread_bps DESC",
            (run_id,),
        )


# ── SHAP persistence ────────────────────────────────────────────────────────

def save_shap_importance(ticker: str, features: list[dict], mean_ic: float = 0.0) -> None:
    with get_conn() as conn:
        _execute(conn, f"DELETE FROM shap_importance WHERE ticker = {_ph()}", (ticker,))
        now = _now_iso()
        for f in features:
            _execute(
                conn,
                f"INSERT INTO shap_importance (saved_at, ticker, mean_ic, feature, importance) VALUES ({_ph(5)})",
                (now, ticker, round(mean_ic, 6), f["feature"], round(f["importance"], 6)),
            )


def get_shap_from_db(ticker: str) -> dict | None:
    with get_conn() as conn:
        rows = _fetchall(
            conn,
            f"SELECT feature, importance, mean_ic FROM shap_importance "
            f"WHERE ticker = {_ph()} ORDER BY importance DESC LIMIT 8",
            (ticker,),
        )
    if not rows:
        return None
    features = [{"feature": r["feature"], "importance": r["importance"]} for r in rows]
    mean_ic = rows[0]["mean_ic"]
    return {"ticker": ticker, "features": features, "mean_ic": mean_ic}


# ── Intraday signal cards persistence ────────────────────────────────────────

def save_intraday_signals(cards: list[dict]) -> None:
    import json as _json
    if not cards:
        return
    tickers = [c["ticker"] for c in cards]
    with get_conn() as conn:
        # Replace ONLY the tickers computed in this batch — a partial-universe
        # run must not wipe cards for tickers it did not recompute. (Previously a
        # blanket DELETE meant a 16-ticker run left only 16 rows in the book.)
        _execute(conn, f"DELETE FROM intraday_signals WHERE ticker IN ({_ph(len(tickers))})", tuple(tickers))
        now = _now_iso()
        for c in cards:
            _execute(
                conn,
                f"""INSERT INTO intraday_signals
                   (saved_at, ticker, signal, mean_ic, sharpe, sortino, max_drawdown,
                    n_folds, n_bars, train_bars, test_bars, data_start, data_end, shap_top,
                    last_features, equity_curve_json, ic_per_fold_json,
                    ic_ir, ic_tstat, ic_pvalue, calmar, omega, hit_rate, profit_factor,
                    ic_sem, sharpe_sem, hit_rate_sem, equity_dates_json, latest_signal)
                   VALUES ({_ph(29)})""",
                (now, c["ticker"], c.get("signal"), c.get("mean_ic", 0.0),
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
                 _json.dumps(c.get("equity_dates") or []), c.get("latest_signal", 0.0)),
            )


def get_intraday_signals_db() -> list[dict] | None:
    import json as _json
    with get_conn() as conn:
        rows = _fetchall(conn, "SELECT * FROM intraday_signals ORDER BY ABS(mean_ic) DESC")
    if not rows:
        return None
    results = []
    for d in rows:
        for jcol, key in (("last_features", "last_features"), ("equity_curve_json", "equity_curve"), ("ic_per_fold_json", "ic_per_fold"), ("equity_dates_json", "equity_dates")):
            raw = d.pop(jcol, None)
            try:
                d[key] = _json.loads(raw) if raw else ({} if key == "last_features" else [])
            except Exception:
                d[key] = {} if key == "last_features" else []
        if d.get("sortino") == 0.0 and d.get("ic_ir") is None:
            d["sortino"] = None
        results.append(d)
    return results


# ── Paper trading persistence ────────────────────────────────────────────────

def save_paper_trade(
    ticker: str,
    signal: str,
    qty: int = 10,
    order_id: str | None = None,
    status: str = "pending",
    filled_price: float | None = None,
    filled_at: str | None = None,
) -> int:
    with get_conn() as conn:
        return _insert_returning_id(
            conn,
            f"""INSERT INTO paper_trades
               (ticker, signal, qty, order_id, status, filled_price, submitted_at, filled_at)
               VALUES ({_ph(8)})""",
            (ticker.upper(), signal.upper(), qty, order_id, status,
             filled_price, _now_iso(), filled_at),
        )


def get_paper_trades(limit: int = 50) -> list[dict]:
    with get_conn() as conn:
        return _fetchall(
            conn,
            f"SELECT * FROM paper_trades ORDER BY id DESC LIMIT {_ph()}",
            (limit,),
        )


def delete_all_trades() -> int:
    """Delete all paper trades and cancel all Alpaca orders. Returns rows deleted."""
    with get_conn() as conn:
        cur = _execute(conn, "DELETE FROM paper_trades")
        return cur.rowcount


def cancel_pending_trades() -> int:
    """Mark pending trades as cancelled. Returns rows updated."""
    with get_conn() as conn:
        cur = _execute(
            conn,
            f"UPDATE paper_trades SET status='cancelled' WHERE status IN ('pending', 'pending_new')",
        )
        return cur.rowcount


# ── Open-position tracking (exit logic — stop-loss/take-profit/signal-flip) ──

def save_open_position(
    ticker: str, side: str, qty: int, entry_price: float | None,
    stop_loss_price: float | None, take_profit_price: float | None,
) -> int:
    with get_conn() as conn:
        return _insert_returning_id(
            conn,
            f"""INSERT INTO open_positions
               (ticker, side, qty, entry_price, stop_loss_price, take_profit_price,
                opened_at, status)
               VALUES ({_ph(7)}, 'open')""",
            (ticker.upper(), side.upper(), qty, entry_price,
             stop_loss_price, take_profit_price, _now_iso()),
        )


def get_open_positions() -> list[dict]:
    with get_conn() as conn:
        return _fetchall(conn, "SELECT * FROM open_positions WHERE status='open' ORDER BY id ASC")


def close_position_db(position_id: int, exit_price: float | None, close_reason: str) -> None:
    with get_conn() as conn:
        _execute(
            conn,
            f"UPDATE open_positions SET status='closed', exit_price={_ph()}, close_reason={_ph()}, closed_at={_ph()} WHERE id={_ph()}",
            (exit_price, close_reason, _now_iso(), position_id),
        )


def get_closed_positions(limit: int = 50) -> list[dict]:
    with get_conn() as conn:
        return _fetchall(
            conn,
            f"SELECT * FROM open_positions WHERE status='closed' ORDER BY closed_at DESC LIMIT {_ph()}",
            (limit,),
        )


# ── Alpha decay persistence ─────────────────────────────────────────────────

def save_alpha_decay(ticker: str, half_life_bars: float | None, ic_by_lag: dict) -> None:
    import json as _json
    with get_conn() as conn:
        _execute(conn, f"DELETE FROM alpha_decay WHERE ticker={_ph()}", (ticker,))
        _execute(
            conn,
            f"INSERT INTO alpha_decay (computed_at, ticker, half_life_bars, ic_by_lag_json) VALUES ({_ph(4)})",
            (_now_iso(), ticker, half_life_bars, _json.dumps(ic_by_lag)),
        )


def get_alpha_decay_db(ticker: str | None = None) -> list[dict]:
    import json as _json
    with get_conn() as conn:
        if ticker:
            rows = _fetchall(
                conn,
                f"SELECT * FROM alpha_decay WHERE ticker={_ph()} ORDER BY id DESC LIMIT 1",
                (ticker.upper(),),
            )
        else:
            rows = _fetchall(conn, "SELECT * FROM alpha_decay ORDER BY ticker")
    for d in rows:
        d["ic_by_lag"] = _json.loads(d.pop("ic_by_lag_json", "{}"))
    return rows


def get_avg_intraday_ic() -> float | None:
    with get_conn() as conn:
        row = _fetchone(
            conn,
            "SELECT AVG(ABS(mean_ic)) AS avg_ic, COUNT(*) AS n FROM intraday_signals WHERE mean_ic IS NOT NULL",
        )
    if row and row["n"] > 0:
        return float(row["avg_ic"])
    return None


# ── Ticker cleanup (used by main.py delete-ticker endpoint) ──────────────────

def delete_signals_for_ticker(ticker: str) -> None:
    """Remove all signal rows for a specific ticker across all tables."""
    with get_conn() as conn:
        for table in ("microstructure_signals", "intraday_signals", "shap_importance", "alpha_decay"):
            _execute(conn, f"DELETE FROM {table} WHERE ticker = {_ph()}", (ticker.upper(),))


init_db()
