# AlphaFlow — Market Microstructure Alpha Engine

[![Python 3.11+](https://img.shields.io/badge/python-3.11%2B-blue)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.111-green)](https://fastapi.tiangolo.com)
[![React 18](https://img.shields.io/badge/React-18-61dafb)](https://react.dev)
[![Tests](https://img.shields.io/badge/tests-39%20passing-brightgreen)](#testing)
[![Phase 1](https://img.shields.io/badge/Phase%201-Complete-success)](#phase-1--daily-microstructure-engine)
[![Phase 2](https://img.shields.io/badge/Phase%202-Complete-blueviolet)](#phase-2--intraday-alpha-engine)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

> **Author:** Anthony Breeganzo Thomas | Quantitative Engineer @ Kyndryl AI · Imperial College RMFE Target 2027  
> � **[Research Proposal](RESEARCH.md)**

AlphaFlow is a **two-phase microstructure alpha signal engine** that demonstrates real-world quantitative research practices end-to-end — from signal construction and walk-forward validation to LLM interpretation and live dashboarding.

**Phase 1** implements five academic microstructure signals on 2yr daily OHLCV, trains a LightGBM walk-forward classifier, and uses Groq LLM to generate signal rationale.  
**Phase 2** extends to hourly bars with three novel signals (VWAP deviation, Hawkes process intensity, volume clock imbalance), switches to LGBMRegressor for proper IC measurement, adds SHAP feature attribution, and streams live bar data via SSE.

---

## Quick Start

### Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Python | 3.9+ | 3.11–3.13 recommended |
| Node.js | 18+ | For the React frontend |
| npm | 9+ | Bundled with Node.js |
| Git | any | For cloning |

**Check your versions:**
```bash
python3 --version   # or python --version on Windows
node --version
npm --version
```

**Install Node.js + npm if missing:**
- **Mac:** `brew install node` (requires [Homebrew](https://brew.sh)) or download from [nodejs.org](https://nodejs.org)
- **Windows:** Download the LTS installer from [nodejs.org](https://nodejs.org) — npm is included

---

## Setup

### macOS / Linux

```bash
# 1. Clone and enter the project
git clone https://github.com/your-username/AlphaFlow.git
cd AlphaFlow

# 2. Create virtual environment and install Python dependencies
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 3. Create a .env file with your API keys
cp .env.example .env      # then edit .env
# Required: GROQ_API_KEY (free at https://console.groq.com)
# Optional: ALPACA_API_KEY + ALPACA_SECRET_KEY for live data

# 4. Install frontend dependencies
cd frontend
npm install
cd ..
```

### Windows (PowerShell)

```powershell
# 1. Clone and enter the project
git clone https://github.com/your-username/AlphaFlow.git
cd AlphaFlow

# 2. Create virtual environment and install Python dependencies
python -m venv .venv
.venv\Scripts\Activate.ps1      # If blocked: Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
pip install -r requirements.txt

# 3. Create .env with your API keys
copy .env.example .env          # then edit .env in Notepad

# 4. Install frontend dependencies
cd frontend
npm install
cd ..
```

### Environment Variables (`.env`)

> **Important:** The `.env` file must be placed inside the `AlphaFlow/` folder (the same folder as `requirements.txt`), not in the parent workspace directory.

#### Getting API Keys

**Groq (required):**
1. Go to [console.groq.com](https://console.groq.com) → Sign up (free, no credit card)
2. Navigate to **API Keys** → **Create API Key**
3. Copy the key — it starts with `gsk_`

**Alpaca (optional — for live/paper market data):**
1. Go to [app.alpaca.markets](https://app.alpaca.markets) → Sign up (free paper trading)
2. Navigate to **Paper Trading** → **API Keys** → **Generate New Key**
3. Copy **both** the Key ID (`PK…`) and the Secret Key immediately — **the Secret Key is shown only once** and cannot be retrieved after you close the dialog

```env
# Required — free at https://console.groq.com
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxx

# Optional second key (auto-fallback on rate limit)
GROQ_API_KEY_2=gsk_xxxxxxxxxxxxxxxxxxxx

# Optional — for Alpaca live/paper data (paper trading, 15-min delayed IEX free tier)
ALPACA_API_KEY=PKxxxxxxxxxxxxxxxxxx
ALPACA_SECRET_KEY=xxxxxxxxxxxxxxxxxx
ALPACA_BASE_URL=https://paper-api.alpaca.markets/v2
```

### Convenience Script (Mac/Linux only)

```bash
bash setup_venv.sh   # creates .venv + pip install in one step
```

---

## Running the App

Open **two terminals**. Run both commands simultaneously.

### Terminal 1 — Backend (FastAPI)

**Mac/Linux:**
```bash
cd AlphaFlow
source .venv/bin/activate
uvicorn backend.main:app --reload --port 8002
```

**Windows:**
```powershell
cd AlphaFlow
.venv\Scripts\Activate.ps1
uvicorn backend.main:app --reload --port 8002
```

Backend runs at: `http://localhost:8002`  
API docs (Swagger): `http://localhost:8002/docs`

### Terminal 2 — Frontend (React + Vite)

```bash
cd AlphaFlow/frontend
npm run dev
```

Frontend runs at: `http://localhost:3002`

Open your browser at **http://localhost:3002** to use the dashboard.

---

## Troubleshooting

### "API proxy error" / blank cards on the dashboard
**Cause:** The backend is not running.  
**Fix:** Start the FastAPI backend first (Terminal 1), then open the frontend. The frontend proxies all `/api/*` calls to `http://localhost:8002` — if the backend is down, every data request fails.

```bash
# Terminal 1 — start backend first
cd AlphaFlow
source .venv/bin/activate
uvicorn backend.main:app --reload --port 8002

# Verify it's alive
curl http://localhost:8002/health
# Expected: {"status":"ok","alpaca":"configured",...}
```

### Port 8002 or 3002 already in use

```bash
# Kill whatever is on the port (Mac/Linux)
lsof -ti:8002 | xargs kill -9
lsof -ti:3002 | xargs kill -9

# Then restart the services normally
```

### "ModuleNotFoundError: No module named 'alpha_flow'" or similar
**Cause:** Virtual environment not activated, or you're running from the wrong directory.  
**Fix:**
```bash
# Always activate venv first
source .venv/bin/activate           # Mac/Linux
.venv\Scripts\Activate.ps1          # Windows

# Run uvicorn from inside the AlphaFlow/ folder
cd AlphaFlow
uvicorn backend.main:app --reload --port 8002
```

### Alpaca shows "not_configured" in `/health`
**Cause:** `.env` keys saved but backend not restarted, OR `.env` is in the wrong location.  
**Fix:**
- The `.env` file **must be inside the `AlphaFlow/` folder** — not the parent workspace directory
- After editing `.env`, stop and restart uvicorn — environment variables are loaded at startup
- Verify: `curl http://localhost:8002/health` should return `"alpaca":"configured"`

### Groq LLM errors / "rate limit" messages
**Cause:** Groq free tier (100K tokens/day per key).  
**Fix:** Add a second key as `GROQ_API_KEY_2` in `.env` — AlphaFlow auto-rotates to it when the first key hits the daily limit.

### Frontend stuck on loading / stale data after pipeline run
**Fix:** Hard-refresh the browser (`Cmd+Shift+R` Mac / `Ctrl+Shift+R` Windows). React Query auto-polls every 10 seconds, but a forced refresh clears any cached stale state.

---

## What `run.py` Does

`run.py` is the **CLI entry point** — it runs the full pipeline (LangGraph → walk-forward → signal card → charts) **without the FastAPI server**. Use it when:

- You want a quick terminal demo without starting the UI
- Running in a CI environment (e.g. GitHub Actions)
- Batch processing or scripted usage

```bash
cd AlphaFlow
source .venv/bin/activate   # Mac/Linux
python run.py
```

Output: signal card printed to stdout + charts saved to `outputs/figures/`.

---

## Testing

```bash
cd AlphaFlow
source .venv/bin/activate
python -m pytest tests/ -v
```

Expected: **39 tests passing** (29 Phase 1 + 10 Phase 2)

```
tests/test_microstructure.py   29 passed  (OFI, Kyle λ, Amihud, C-S spread, IC, backtest)
tests/test_intraday.py         10 passed  (VWAP z-score, Hawkes intensity, walk-forward IC)
```

---

## Phase 1 — Daily Microstructure Engine

**Data:** yfinance, 2yr daily OHLCV, 10 tickers (S&P 500 large-caps), ~504 bars/ticker  
**Model:** LightGBM Classifier, walk-forward (5 folds), Spearman IC  
**LLM:** Groq `llama-3.3-70b-versatile`, deterministic cross-sectional signals  

### Phase 1 Signals

| Signal | Formula | Academic Paper |
|--------|---------|----------------|
| **OFI Z-score** | `(buy_vol − sell_vol) / total_vol`, z-scored over 20 bars | Chordia, Roll & Subrahmanyam (2002) |
| **Kyle's λ** | `λ = Cov(ΔP, OFI) / Var(OFI)`, rolling 20 bars | Kyle (1985) Econometrica |
| **Amihud ILLIQ** | `ILLIQ = |r_t| / (P_t × V_t)`, per $1M traded | Amihud (2002) JFM |
| **Corwin-Schultz Spread** | `S = 2(eᵅ−1)/(1+eᵅ)`, derived from H/L ratio | Corwin & Schultz (2012) JF |
| **Lee-Ready Tick Sign** | `+1` if close ≥ open, `−1` otherwise | Lee & Ready (1991) JF |

### Phase 1 Architecture

```
  DATA                   SIGNALS              ML + LLM
  yfinance API       OFI Z-score          LightGBM Classifier
  2yr daily OHLCV    Kyle's Lambda (λ)    Walk-forward (5 folds)
  ~504 bars/ticker─► Amihud ILLIQ     ─►  Spearman IC eval
  10 tickers         C-S Spread           Groq LLM rationale
  (+ custom)         Lee-Ready Sign       Cross-sectional ranking
```

---

## Phase 2 — Intraday Alpha Engine

**Data:** yfinance hourly, up to 730 days, ~3,276 bars/ticker; Alpaca IEX free tier fallback  
**Model:** LGBMRegressor (not Classifier — enables proper IC measurement), walk-forward (~17 folds)  
**New:** SHAP feature attribution, SSE live stream, VWAP + Hawkes + Volume Clock signals  

### Why LGBMRegressor instead of Classifier?

Phase 1 used a **Classifier** — it predicted direction (+1/−1). IC measured on class probabilities is biased.  
Phase 2 uses a **Regressor** — it predicts the *magnitude* of future return. IC = Spearman(predicted_return, actual_return) — the academically correct definition from Grinold & Kahn (2000).

| | Phase 1 | Phase 2 |
|---|---|---|
| Bars | 504 daily | ~3,276 hourly |
| WF folds | 5 | ~17 |
| Features | 5 signals + 3 lags | 8 signals + 4 lags = **12** |
| Model | LGBMClassifier | **LGBMRegressor** |
| IC target | direction (biased) | return magnitude (correct) |
| Attribution | none | **SHAP** (Lundberg & Lee 2017) |

### Phase 2 Signals (New)

| Signal | Formula | Academic Paper |
|--------|---------|----------------|
| **VWAP Deviation Z** | `z = (close − VWAP) / rolling_std(close − VWAP)` | Almgren & Chriss (2001) |
| **Hawkes Intensity Z** | `λ(t) = μ + Σ α·exp(−β·(t−tᵢ))`, MLE via L-BFGS-B | Bacry, Mastromatteo & Muzy (2015) |
| **Volume Imbalance Z** | `VI = (buy_vol − sell_vol) / total_vol`, z-scored | López de Prado (2018) Ch.3 |

**Novel contribution:** Using Hawkes intensity as an LLM feature (Phase 2 LangGraph node) — not present in existing literature.

### Phase 2 Architecture

```
  DATA                   SIGNALS (12 features)      ML + LLM
  yfinance 1h (cache)  OFI Z, Amihud, Kyle λ      LGBMRegressor
  Alpaca IEX fallback  CS Spread, Tick Sign        Walk-forward ~17 folds
  3,276 bars/ticker ─► VWAP Z, Hawkes Z,       ─►  Spearman IC, Sharpe
  SSE live stream      Volume Z, 4 lag returns     SHAP attribution
                                                    Groq LLM (hourly context)
```

---

## Full System Architecture

```
  ─────────────────────────────────────────────────────────────────────
  FastAPI BACKEND (port 8002)          SQLite DATABASE
  ─────────────────────────────────────────────────────────────────────
   Phase 1:                            Phase 2:
   POST /api/run                       POST /api/intraday/run
   GET  /api/signals/all               GET  /api/intraday/signals
   GET  /api/history                   GET  /api/data/shap-importance
   GET  /api/data/ofi-timeseries       GET  /api/stream (SSE)
   GET  /api/data/execution-quality    GET  /api/data/alpha-decay
   GET  /api/data/kyle-lambda          POST /api/explain (Groq)
   POST /api/chat (Groq)               GET  /api/tickers
  ─────────────────────────────────────────────────────────────────────
  React FRONTEND (port 3002) — Vite + TypeScript + TailwindCSS
   Daily mode: OFI charts, signal cards, LLM chat, execution quality
   Hourly mode: intraday signal cards, SHAP chart, live SSE dot
  ─────────────────────────────────────────────────────────────────────
```

---

## Architecture

```
                           AlphaFlow — System Architecture
  ─────────────────────────────────────────────────────────────────────────
  DATA LAYER                SIGNAL ENGINE              ML + LLM PIPELINE
  ────────────             ─────────────────          ──────────────────────
  yfinance API             OFI Z-score                LightGBM Classifier
  2yr daily OHLCV          Kyle's Lambda (λ)          Walk-forward training
  501 bars/ticker   ──►    Amihud ILLIQ        ──►    Spearman IC eval
  10 default +             Corwin-Schultz Spread       Groq llama-3.3-70b
  custom tickers           Lee-Ready Tick Sign         LLM rationale (JSON)
  ─────────────────────────────────────────────────────────────────────────
                                    │
                                    ▼
  ─────────────────────────────────────────────────────────────────────────
  FASTAPI BACKEND  (port 8002)
  ─────────────────────────────────────────────────────────────────────────
   POST /api/run                  GET  /api/tickers
   GET  /api/signals/all          POST /api/tickers/add
   GET  /api/history              DEL  /api/tickers/{ticker}
   GET  /api/history/{id}/signals GET  /api/data/ofi-timeseries
   GET  /api/outputs              GET  /api/data/execution-quality
   POST /api/explain              GET  /api/data/kyle-lambda
   POST /api/chat                 GET  /api/data/alpha-decay
  ─────────────────────────────────────────────────────────────────────────
                                    │
                                    ▼
  ─────────────────────────────────────────────────────────────────────────
  REACT DASHBOARD  (port 3002)  ·  Vite + TypeScript + Recharts
  ─────────────────────────────────────────────────────────────────────────
   Pipeline Control    │  Ticker Signal Cards (BUY / HOLD / SELL)
   Run History         │  Interactive Charts (OFI, Execution, Lambda, Decay)
   Custom Tickers      │  Groq AI Chat + Hover Tooltips
   Live Metrics        │  Dark / Light Mode  ·  CSV Data Download
  ─────────────────────────────────────────────────────────────────────────
```

---

## Theoretical Foundation

| Signal | Formula | Reference |
|--------|---------|-----------|
| **Order Flow Imbalance (OFI)** | Net buyer vs seller pressure per bar (OHLCV proxy) | Cont, Cucuringu & Zhang (2023) |
| **Kyle's Lambda (λ)** | Price impact per unit order flow: Δp = λ·x + ε | Kyle (1985, *Econometrica*) |
| **Amihud Illiquidity** | \|r_t\| / Volume_t — price move per dollar traded | Amihud (2002, *JFM*) |
| **Corwin-Schultz Spread** | Log high/low ratio estimator of effective spread | Corwin & Schultz (2012, *JF*) |
| **Tick Sign** | Lee-Ready tick test — infer buy/sell from close-to-close | Lee & Ready (1991, *JF*) |

**Signal Generation (BUY / HOLD / SELL):** Cross-sectional OFI Z-score ranking:
- OFI Z in top 20% of universe → **BUY**
- OFI Z in bottom 20% → **SELL**
- Middle 60% → **HOLD**
These are fully deterministic, not LLM-generated. The Groq LLM provides plain-English rationale only.

**Predictive Model:** Walk-forward LightGBM on 8 microstructure features (rolling 200-day train, 50-day test). Evaluated with Spearman IC, AUC, hit rate, Sharpe, Sortino, Max Drawdown. All three backtest metrics are stored in the `run_history` DB table after every pipeline run and displayed live in the dashboard.

**LLM Layer:** Groq `llama-3.3-70b-versatile` interprets per-ticker signal snapshots. Hover over any metric card (ⓘ) for formula and context.

---

## Data Sources

| Phase | Source | Latency | Cost | Status |
|-------|--------|---------|------|--------|
| Phase 1 *(current)* | yfinance — 2yr daily OHLCV (501 trading days) | end-of-day | Free | ✅ Active |
| Phase 2 *(roadmap)* | Alpaca Streaming WebSocket — real-time L1 tick data | Real-time | ~$240/yr | Set `ALPACA_USE_LIVE=true` |
| Fallback | Synthetic OHLCV (ticker-specific seed) | N/A | Free | Auto if yfinance fails |

---

## Features

### Custom Ticker Support
- Add any exchange-listed ticker via the "Add Custom Ticker" input in Pipeline Control
- Data is downloaded via yfinance, saved to `data/raw/<TICKER>.csv`, and persisted in `data/custom_tickers.json` with full name and sector metadata
- Default 10 tickers cannot be deleted; custom tickers show a red ✕ button **directly on their signal card** — click to remove immediately
- The ✕ button also appears in the Pipeline Control card under "Custom Tickers" for reference
- All subsequent pipeline runs automatically include custom tickers
- Ticker counter in the header subtitle dynamically reflects the total

### Interactive Recharts
All 4 research charts are now interactive Recharts (no static PNG):
| Chart | Type | API Endpoint |
|-------|------|-------------|
| OFI Z-score Monitor | Multi-line + date range picker | `/api/data/ofi-timeseries?start=&end=` |
| Execution Quality | Multi-line (spread bps / Amihud ILLIQ) + metric toggle | `/api/data/execution-quality` |
| Kyle's λ Trend | Multi-line (30d rolling mean) + date range | `/api/data/kyle-lambda` |
| Alpha Decay | Bar chart · IC at lags 1–10 · per-ticker or average | `/api/data/alpha-decay` |

All charts support per-ticker toggle pills and calendar date pickers. The X-axis shows `MM/DD/YY` format so the year is always visible; hovering a data point shows a fully formatted date label (`DD Mon 'YY`).

Every interactive chart has an **⊕ Expand Full Screen** button — clicking it opens a full-viewport `ChartLightbox` overlay (close with ESC or the ✕ button). OFI Z-score opens inline like all other charts; the expand button launches the overlay.

Hidden tickers (toggled off via the pill filter) are excluded from both the visual line *and* the tooltip using Recharts' `hide` prop — the tooltip only shows values for currently visible tickers.

### Signal Distribution + Portfolio Backtest Panel
Below the 4 metric cards, a combined panel shows:
- **Signal Distribution**: BUY / HOLD / SELL counts from the latest run, strongest and weakest OFI Z tickers, LightGBM hit rate
- **Long-Short Backtest**: Portfolio Sharpe, Sortino, and Max Drawdown from the `run_history` table — updated after every pipeline run
- All three backtest metrics have interactive hover tooltips with formula, interpretation, and academic reference
- Phase 1 note: Sharpe and Sortino are negative (IC ≈ 0 on daily OHLCV, as expected); Phase 2 tick data targets Sharpe > 0.5

### Pipeline History (Last 10 Runs)
- The history panel shows only the 10 most recent pipeline runs
- History run detail modal shows per-ticker signals and metrics for that exact run
- Future runs beyond 10 are not stored (lean by design)

### Walk-Forward Training
- **Rolling window**: 200-day train, 50-day test (not expanding)
- Each pipeline run re-runs all historical folds from scratch over the full 2yr dataset
- Including new data: click "Refresh Market Data" (downloads latest bars from yfinance), then click "Run Pipeline"
- New bars are automatically included in the rolling windows
- The walk-forward window does **not** auto-expand over time — this is intentional for stable live signal estimation
- Training frequency: every pipeline run re-trains from scratch. No scheduled re-training; you control it.

### Refresh Market Data Behavior
- **Same day**: Re-downloads the same data (yfinance always returns up to today)
- **New trading day**: Click "Refresh Market Data" → new bars are downloaded and cached → click "Run Pipeline" to include them in analysis
- There is **no automatic daily refresh** — you always manually trigger it

### Hover Tooltips
- Hover over any metric card (ⓘ) to see the formula, definition, and academic reference
- Tooltip follows the cursor and disappears on mouse-leave — no pinning, no click required
- Works on all metric cards, OFI Z labels, chart thumbnail previews, and spread labels

### Hover Animations
- All `Card` components lift on hover (translateY(-1px) + soft shadow)
- Signal cards lift 2px on hover
- Metric grid cards lift 2px on hover
- Chart thumbnail previews scale 1.02× on hover
- Ticker pills in scroll header have their existing marquee animation (CSS)

---

## Repository Structure

```
AlphaFlow/
├── run.py                    # Standalone entry point (all 4 pipeline steps)
├── requirements.txt          # All Python dependencies
├── .env.example              # API key template (safe to commit)
├── setup_venv.sh             # One-command venv setup
├── backend/
│   ├── main.py               # FastAPI — 14 endpoints, background tasks
│   └── database.py           # SQLite helpers (run_history, microstructure_signals)
├── alpha_flow/
│   ├── agent/                # LangGraph 5-node DAG + Groq LLM node
│   │   └── langgraph_flow.py # Uses get_all_tickers() — dynamic ticker universe
│   ├── analysis/
│   │   ├── performance.py    # Sharpe, Sortino, Max Drawdown (all tested)
│   │   └── figures.py        # 4 research chart generators (matplotlib)
│   ├── config/
│   │   └── settings.py       # TICKERS, get_all_tickers(), model params
│   ├── core/
│   │   ├── ofi_calculator.py # rolling_ofi_zscore (20-bar)
│   │   ├── amihud.py         # amihud_ratio, kyle_lambda
│   │   └── spread_tracker.py # corwin_schultz_spread
│   ├── data/
│   │   └── data_feed.py      # yfinance / Alpaca / synthetic fallback
│   └── signals/              # Signal card generator (all tickers)
├── data/
│   ├── app.db                # SQLite DB (gitignored)
│   ├── custom_tickers.json   # Persisted custom tickers ({"tickers": ["GS", ...]})
│   └── raw/<TICKER>.csv      # OHLCV cache (gitignored)
├── outputs/                  # 4 PNG charts + JSON report (gitignored)
├── tests/                    # 29 pytest unit tests (fully offline, all passing)
│   └── test_microstructure.py
├── docs/projects/            # Research documentation
└── frontend/                 # React 18 + Vite + TypeScript
    └── src/App.tsx           # ~1200-line single-file dashboard
```

---

## Quick Start

### One-time Setup

```bash
cd AlphaFlow   # wherever you unzipped / cloned

# 1. Python environment
bash setup_venv.sh
# or manually: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

# 2. API keys
cp .env.example .env
# Fill in GROQ_API_KEY, ALPACA_API_KEY, ALPACA_SECRET_KEY

# 3. Frontend packages (one-time)
cd frontend && npm install && cd ..
```

### Start Services (every session)

**Terminal 1 — Backend:**
```bash
cd AlphaFlow
.venv/bin/python3 -m uvicorn backend.main:app --port 8002 --log-level warning
```

**Terminal 2 — Frontend:**
```bash
cd AlphaFlow/frontend
npm run dev
```

**Browser:** `http://localhost:3002`

Click **Compute EOD Signals** (daily mode) or **Run Alpha Engine** (hourly mode). Done.

### Stop Services

```bash
kill -9 $(lsof -ti:8002)   # backend
kill -9 $(lsof -ti:3002)   # frontend
```

---

## API Endpoint Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| POST | `/api/run` | Trigger pipeline (async background task) |
| GET | `/api/signals/all` | All signals from most recent completed run |
| GET | `/api/history` | Last 10 pipeline runs |
| GET | `/api/history/{run_id}/signals` | Signals for a specific run |
| GET | `/api/metrics/latest` | Latest aggregate metrics |
| GET | `/api/outputs` | List available chart PNGs |
| GET | `/api/outputs/{filename}` | Serve a chart PNG |
| GET | `/api/tickers` | List all tickers (default + custom) with metadata |
| POST | `/api/tickers/add` | Add custom ticker (downloads 2yr OHLCV) |
| DELETE | `/api/tickers/{ticker}` | Delete a custom ticker (default 10 protected) |
| GET | `/api/data/ofi-timeseries` | OFI Z timeseries (`?start=&end=` or `?bars=N`) |
| GET | `/api/data/execution-quality` | Per-ticker spread (bps) + Amihud timeseries |
| GET | `/api/data/kyle-lambda` | Per-ticker Kyle λ + 30d rolling mean timeseries |
| GET | `/api/data/alpha-decay` | IC at lags 1–10 per ticker + cross-sectional avg |
| POST | `/api/explain` | Groq AI chart explanation |
| POST | `/api/chat` | Groq AI open chat |

---

## Testing

```bash
.venv/bin/pytest tests/ -v
```

39 tests, all passing, all offline (no API calls):
- 4 OFI calculator tests
- 4 Amihud ratio tests
- 4 Kyle lambda tests
- 4 Corwin-Schultz spread tests
- 4 Lee-Ready sign tests
- 4 Sortino ratio tests (new)
- 5 LightGBM integration tests

---

## Known Limitations (Phase 1)

### OFI IC ≈ 0

This is **expected and correct**. Daily OHLCV cannot resolve intra-bar order flow — each row covers one full trading day. The OFI Z-score derived from daily bars is a coarse proxy. Phase 2 with real bid/ask/trade tick data (Alpaca WebSocket) is required to achieve IC > 0.05. All documentation and tooltips disclose this per academic standards.

### Signal Correctness Audit

- **BUY/SELL/HOLD**: Cross-sectional OFI Z ranking (top 20%/bottom 20%) — fully deterministic, reproducible
- **Kyle λ**: OLS regression of ΔP vs signed volume (Kyle 1985) — implemented in `amihud.py::kyle_lambda`
- **Amihud ILLIQ**: |r_t| / V_t — implemented in `amihud.py::amihud_ratio`, stored as `amihud_illiq` in DB
- **C-S Spread**: β (HLt, HLt+1) estimator — implemented in `spread_tracker.py::corwin_schultz_spread`
- **IC**: Spearman rank correlation of OFI Z vs forward returns (lags 1–10)
- **Data cleaning**: 8-step protocol (NaN drop, volume=0 filter, zero-return filter, outlier clip ±5σ, min bars 50)
- **Backtest**: Walk-forward, no lookahead, Sharpe + Sortino + Max Drawdown all unit-tested
- **Amihud display bug (fixed Session 8)**: Frontend now correctly reads `amihud_illiq` (was `amihud`)

---

## GitHub Hosting

| Component | GitHub Pages? | Alternative |
|-----------|---------------|-------------|
| React frontend (static build) | ✅ Yes | `npm run build` → deploy `dist/` |
| FastAPI backend | ❌ No — Python needed | Railway / Render / Fly.io |
| Full working app | ❌ Not on Pages alone | Backend + frontend on separate hosts |

The frontend calls `/api/*` — these require a live FastAPI process. Without it, all data calls return network errors. To share the project, recipients must run it locally with their own `.env` API keys.

---

## Phase Roadmap

| Phase | Status | Focus |
|-------|--------|-------|
| **Phase 1** | ✅ Complete | Daily OHLCV · 4 metrics · LightGBM · Groq · Interactive dashboard |
| **Phase 2** | 🔜 Planned | Alpaca real-time tick data · True IC · L2 order book (bid/ask) |
| **Phase 3** | 🔜 Planned | Cross-sectional portfolio construction · Risk parity · Live execution stubs |

Phase 2 begins when `ALPACA_USE_LIVE=true` and live bar streaming is wired to the OFI calculator.

---

## References

- Kyle, A.S. (1985). Continuous auctions and insider trading. *Econometrica*, 53(6), 1315–1335.
- Amihud, Y. (2002). Illiquidity and stock returns. *Journal of Financial Markets*, 5(1), 31–56.
- Lee, C.M.C. & Ready, M.J. (1991). Inferring trade direction from intraday data. *Journal of Finance*, 46(2), 733–746.
- Corwin, S.A. & Schultz, P. (2012). A simple way to estimate bid-ask spreads from daily high and low prices. *Journal of Finance*, 67(2), 719–760.
- Cont, R., Cucuringu, M. & Zhang, C. (2023). Cross-impact of order flow imbalance in equity markets. *Quantitative Finance*, 23(10), 1373–1393.
- Lucchese, L., Pakkanen, M. & Veraart, A. (2024). The short-term predictability of returns in order book markets. *International Journal of Forecasting*, 40(4), 1587–1621.
- Cartea, Á. & Jaimungal, S. (2016). Incorporating order-flow into optimal execution. *Mathematics and Financial Economics*, 10(3), 339–364.
