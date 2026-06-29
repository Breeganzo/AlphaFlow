# AlphaFlow — Market Microstructure Alpha Engine

[![Python 3.11+](https://img.shields.io/badge/python-3.11%2B-blue)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.111-green)](https://fastapi.tiangolo.com)
[![React 18](https://img.shields.io/badge/React-18-61dafb)](https://react.dev)
[![Tests](https://img.shields.io/badge/tests-29%20passing-brightgreen)](#testing)
[![Phase 1](https://img.shields.io/badge/Phase-1%20Complete-success)](#phases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

> **Author:** Anthony Breeganzo Thomas | MSc Risk Management and Financial Engineering — Imperial College London  
> 📄 **[Phase Roadmap](docs/PHASE_ROADMAP.md)** · 🎓 **[Scholarship Justification](docs/SCHOLARSHIP.md)** · 🔧 **[Technical Spec](docs/TECHNICAL_SPEC.md)** · 📊 **[Research Paper](RESEARCH.md)**

AlphaFlow extracts **short-horizon alpha signals** from market microstructure — the mechanics of how prices move in response to order flow. It implements four academically grounded metrics (OFI, Kyle λ, Amihud ILLIQ, Roll spread estimator), trains a LightGBM walk-forward classifier to predict next-bar return direction, runs a Groq LLM to generate plain-English signal rationale, and surfaces everything in a live React dashboard with interactive Recharts, hover tooltips, and custom ticker support.

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
cd /Users/anthonybreeganzo.t/Quant_Practise/AlphaFlow

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
cd /Users/anthonybreeganzo.t/Quant_Practise/AlphaFlow
.venv/bin/python3 -m uvicorn backend.main:app --port 8002 --log-level warning
```

**Terminal 2 — Frontend:**
```bash
cd /Users/anthonybreeganzo.t/Quant_Practise/AlphaFlow/frontend
node node_modules/.bin/vite --port 3002
```

**Browser:** `http://localhost:3002`

Click **Run Pipeline**. Done.

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

29 tests, all passing, all offline (no API calls):
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
