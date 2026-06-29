# AlphaFlow — Data Directory
> **Author:** Anthony Breeganzo Thomas · AlphaFlow · Imperial College MSc RMFE Quant Portfolio

```
data/
├── .gitkeep          # keeps directory tracked in git
└── app.db            # SQLite database (gitignored — never committed)
```

---

## app.db

SQLite database auto-created on first backend start (`backend/database.py`).
Stores pipeline execution history and all computed microstructure signals.

**Why SQLite:** zero-config, single-file, no server process required. Sufficient for
research-scale throughput (hundreds of pipeline runs, thousands of signal rows).
Portable — copy `app.db` to reproduce any session's results locally.

---

## Schema

### `run_history`
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PK, autoincrement | Run identifier |
| started_at | TEXT | NOT NULL | ISO-8601 UTC timestamp |
| finished_at | TEXT | — | ISO-8601 UTC; NULL while running |
| status | TEXT | NOT NULL | `running` / `ok` / `error` |
| error_msg | TEXT | — | Populated on pipeline failure |

### `microstructure_signals`
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PK, autoincrement | Row identifier |
| recorded_at | TEXT | NOT NULL | ISO-8601 UTC timestamp |
| ticker | TEXT | NOT NULL | Equity symbol, e.g. `AAPL` |
| ofi | REAL | — | Z-scored order flow imbalance |
| kyle_lambda | REAL | — | Price impact per unit flow ($/share) |
| amihud_illiq | REAL | — | Amihud ratio: |r_t| / Volume_t |
| eff_spread_bps | REAL | — | Corwin-Schultz effective spread (bps) |
| signal | TEXT | — | `BUY` / `SELL` / `HOLD` |

---

## Direct Queries

```bash
cd /Users/anthonybreeganzo.t/Quant_Practise/AlphaFlow/data
sqlite3 app.db

-- Recent pipeline runs
SELECT id, started_at, finished_at, status FROM run_history ORDER BY id DESC LIMIT 5;

-- Latest signal per ticker
SELECT ticker, ofi, eff_spread_bps, signal, recorded_at
FROM microstructure_signals
GROUP BY ticker HAVING MAX(id);

-- Signal distribution
SELECT signal, COUNT(*) FROM microstructure_signals GROUP BY signal;
```

---

## Regeneration

`app.db` is listed in `.gitignore`. To regenerate from scratch:

```bash
rm -f data/app.db
curl -X POST http://localhost:8002/api/run   # creates tables + runs pipeline
```

---

## Phase 2 Roadmap

When Alpaca live trading is activated (`ALPACA_USE_LIVE=true`), an `order_executions`
table will be added:

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | |
| signal_id | INTEGER FK | References `microstructure_signals.id` |
| submitted_at | TEXT | ISO-8601 |
| side | TEXT | `buy` / `sell` |
| qty | REAL | Shares submitted |
| fill_price | REAL | Alpaca fill (nullable until filled) |
| status | TEXT | `pending` / `filled` / `cancelled` |
