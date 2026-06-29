# AlphaFlow — Backend API Reference
> **Author:** Anthony Breeganzo Thomas · AlphaFlow · Imperial College MSc RMFE Quant Portfolio

FastAPI on **port 8002** · SQLite · LangGraph pipeline trigger

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness probe |
| `GET` | `/api/info` | Project metadata + endpoint list |
| `POST` | `/api/run` | Trigger pipeline (background task) |
| `GET` | `/api/history` | Pipeline run history |
| `GET` | `/api/signals` | Latest signal (single ticker) |
| `GET` | `/api/signals/all` | Latest signal per ticker |
| `GET` | `/api/outputs` | List generated figures + reports |
| `GET` | `/api/outputs/{filename}` | Serve a figure or report file |
| `POST` | `/api/explain` | Groq AI explanation of a chart |
| `POST` | `/api/chat` | Groq conversational AI |

---

## Endpoint Detail

### `GET /health`
```json
{"status": "ok", "project": "AlphaFlow — Microstructure Alpha Engine"}
```

### `GET /api/info`
```json
{"title": "AlphaFlow", "description": "Market Microstructure Alpha Engine",
 "endpoints": ["/api/run", "/api/signals/all", "..."]}
```

### `POST /api/run`
Launches the 5-node LangGraph DAG as a `BackgroundTask`. Returns immediately.
```json
{"status": "started", "run_id": 42, "started_at": "2026-06-27T10:00:00Z"}
```

### `GET /api/history?limit=10`
```json
[{"id": 42, "started_at": "2026-06-27T10:00:00Z",
  "finished_at": "2026-06-27T10:01:05Z", "status": "ok", "error_msg": null}]
```

### `GET /api/signals`
```json
{"id": 7, "recorded_at": "2026-06-27T10:01:03Z", "ticker": "AAPL",
 "ofi": 1.84, "kyle_lambda": 1.2e-7, "amihud_illiq": 4.3e-5,
 "eff_spread_bps": 19.7, "signal": "BUY"}
```

### `GET /api/signals/all`
Array of the above shape — one row per tracked ticker.

### `GET /api/outputs`
```json
{"figures": ["ofi_timeseries.png", "lgbm_shap.png"],
 "reports": ["microstructure_report_20260627.json"]}
```

### `GET /api/outputs/{filename}`
Returns `image/png` or `text/plain`. 404 if not found.

### `POST /api/explain`
```json
// Request
{"filename": "ofi_timeseries.png"}
// Response
{"explanation": "The OFI time-series shows elevated buy-side pressure..."}
```

### `POST /api/chat`
```json
// Request
{"message": "What does Kyle's lambda indicate?", "history": []}
// Response
{"reply": "Kyle's lambda measures price impact per unit order flow..."}
```

---

## Infrastructure

**CORS:** All origins permitted (`*`) — development configuration. Restrict in production.

**Background Task Pattern:** `POST /api/run` writes a `run_history` row with `status=running`,
spawns `BackgroundTask(run_pipeline)`, then updates the row to `ok` or `error` on completion.

**SQLite Tables**

`run_history`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | auto-increment |
| started_at | TEXT | ISO-8601 |
| finished_at | TEXT | ISO-8601, nullable |
| status | TEXT | `running` / `ok` / `error` |
| error_msg | TEXT | nullable |

`microstructure_signals`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | auto-increment |
| recorded_at | TEXT | ISO-8601 |
| ticker | TEXT | e.g. `AAPL` |
| ofi | REAL | Z-scored order flow imbalance |
| kyle_lambda | REAL | Price impact coefficient |
| amihud_illiq | REAL | \|r\| / Volume |
| eff_spread_bps | REAL | Corwin-Schultz estimate, basis points |
| signal | TEXT | `BUY` / `SELL` / `HOLD` |
