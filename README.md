# AlphaFlow — Market Microstructure Alpha Engine

[![Python 3.11+](https://img.shields.io/badge/python-3.11%2B-blue)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.111-green)](https://fastapi.tiangolo.com)
[![React 18](https://img.shields.io/badge/React-18-61dafb)](https://react.dev)
[![Tests](https://img.shields.io/badge/tests-39%20passing-brightgreen)](#testing)
[![Phase 1](https://img.shields.io/badge/Phase%201-Complete-success)](#phase-1--daily-microstructure-signals)
[![Phase 2](https://img.shields.io/badge/Phase%202-Complete-blueviolet)](#phase-2--intraday-alpha-engine)
[![CI](https://img.shields.io/badge/CI-GitHub%20Actions-blue)](/.github/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

> **Author:** Anthony Breeganzo Thomas · Quantitative Engineer, Kyndryl AI Innovation Lab  
> **Target:** Imperial College RMFE / Erasmus Mundus QEM · Entry 2027  
> 📄 [Research Proposal](RESEARCH.md)

AlphaFlow is a **production-grade, two-phase market microstructure alpha signal engine** built to academic and industry standards — from signal construction and walk-forward validation through SHAP attribution, Hawkes process intensity, and LLM-powered interpretation.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  DATA LAYER              SIGNAL ENGINE            ML + LLM           │
│  ──────────────          ─────────────────        ──────────────     │
│  yfinance / Alpaca       OFI Z-score              LGBMRegressor      │
│  Daily OHLCV (2yr)  ──►  Kyle's Lambda (λ)   ──►  Walk-forward ~17x  │
│  Hourly bars (2yr)       Amihud ILLIQ             Spearman IC 1–3%   │
│  11 tickers              C-S Spread               SHAP attribution   │
│  + custom                VWAP Z, Hawkes Z          Groq LLM rationale│
│                          Volume Clock Z                               │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  FastAPI BACKEND  (port 8002)         SQLite  ·  SSE live stream     │
│  Phase 1: /api/run, /api/signals      Phase 2: /api/intraday/run     │
│  /api/history, /api/data/*            /api/intraday/signals, /stream │
│  /api/chat (Groq LLM)                 /api/data/shap-importance      │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  React DASHBOARD  (port 3002)  ·  Vite + TypeScript + TailwindCSS   │
│  Daily mode: signal cards, OFI/Kyle/Amihud charts, LLM chat         │
│  Hourly mode: walk-forward IC, SHAP feature importance, live SSE    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### Prerequisites

| Requirement | Version |
|---|---|
| Python | 3.11 – 3.13 |
| Node.js + npm | 18+ |

### Setup (one-time)

**macOS / Linux:**
```bash
git clone https://github.com/your-username/AlphaFlow.git
cd AlphaFlow

# Python environment
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Environment variables
cp .env.example .env
# Edit .env — add GROQ_API_KEY (free at console.groq.com)
# Optional: ALPACA_API_KEY + ALPACA_SECRET_KEY for live data

# Frontend packages
cd frontend && npm install && cd ..
```

**Windows (PowerShell):**
```powershell
git clone https://github.com/your-username/AlphaFlow.git
cd AlphaFlow
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
cd frontend && npm install && cd ..
```

**Convenience (Mac/Linux):**
```bash
bash setup_venv.sh   # creates .venv + pip install in one step
```

### Run (every session)

Open two terminals:

```bash
# Terminal 1 — Backend (from AlphaFlow/)
source .venv/bin/activate           # Mac/Linux
# .venv\Scripts\Activate.ps1       # Windows
uvicorn backend.main:app --reload --port 8002
```

```bash
# Terminal 2 — Frontend (from AlphaFlow/frontend/)
npm run dev
```

Open **http://localhost:3002** in your browser.

- **Daily mode:** click **Compute EOD Signals**
- **Hourly mode:** click **⚡ Run Alpha Engine**

---

## Signals

### Phase 1 — Daily Microstructure (5 signals)

| Signal | Formula | Reference |
|---|---|---|
| **OFI Z-score** | `(buy_vol − sell_vol) / total_vol`, z-scored 20-bar | Chordia, Roll & Subrahmanyam (2002) |
| **Kyle's λ** | `λ = Cov(ΔP, OFI) / Var(OFI)`, rolling 20 bars | Kyle (1985, *Econometrica*) |
| **Amihud ILLIQ** | `|r_t| / (P_t × V_t)` per $1M | Amihud (2002, *JFM*) |
| **Corwin-Schultz Spread** | `S = 2(eᵅ−1)/(1+eᵅ)` from H/L ratio | Corwin & Schultz (2012, *JF*) |
| **Lee-Ready Tick Sign** | `+1` close ≥ open, `−1` otherwise | Lee & Ready (1991, *JF*) |

**Note:** Phase 1 IC ≈ 0 is expected — daily OHLCV cannot resolve intra-bar order flow. IC measurement requires intraday resolution (Phase 2).

### Phase 2 — Intraday Alpha Engine (3 additional signals)

| Signal | Formula | Reference |
|---|---|---|
| **VWAP Deviation Z** | `z = (close − VWAP) / rolling_std(close − VWAP)` | Almgren & Chriss (2001) |
| **Hawkes Intensity Z** | `λ(t) = μ + Σ α·exp(−β·(t−tᵢ))`, MLE via L-BFGS-B | Bacry, Mastromatteo & Muzy (2015) |
| **Volume Imbalance Z** | `VI = (buy_vol − sell_vol) / total_vol`, z-scored | López de Prado (2018) |

**Novel contribution:** Hawkes process intensity as a real-time predictive feature in the LGBMRegressor pipeline — not present in existing open-source literature.

### Phase 2 Model

| Property | Value |
|---|---|
| Model | LGBMRegressor (return prediction, not direction) |
| Features | 12 (8 signals + 4 lag returns) |
| Walk-forward | ~17 folds (1000-bar train / 250-bar test) |
| IC target | Spearman(predicted_return, actual_return) |
| Achieved IC | 1–3% (AAPL 1.53%, AMZN 2.61%) |
| Max Drawdown | −11% to −15% with volatility targeting (Moreira & Muir 2017) |
| Attribution | SHAP TreeExplainer (Lundberg & Lee 2017) |

> **Why LGBMRegressor over Classifier?** Classifier IC (measured on class probabilities) is biased toward the middle of the scale. Regressor IC = Spearman(predicted_return, actual_return) — the academically correct definition from Grinold & Kahn (2000).

---

## Testing

```bash
source .venv/bin/activate
python -m pytest tests/ -v
```

**39 tests, all passing, all offline** (no live API calls in tests):

| File | Tests | Coverage |
|---|---|---|
| `tests/test_microstructure.py` | 29 | OFI, Kyle λ, Amihud, C-S spread, Lee-Ready, backtest metrics |
| `tests/test_intraday.py` | 10 | VWAP z-score, Hawkes intensity, walk-forward IC, API smoke |

---

## Repository Structure

```
AlphaFlow/
├── backend/
│   ├── main.py               # FastAPI — 18 endpoints, SSE stream, Groq chat
│   └── database.py           # SQLite helpers (run_history, signals, intraday)
├── alpha_flow/
│   ├── agent/                # LangGraph 5-node DAG + Groq LLM
│   ├── analysis/
│   │   ├── intraday_engine.py  # LGBMRegressor walk-forward + SHAP + vol targeting
│   │   ├── performance.py      # Sharpe, Sortino, Max Drawdown
│   │   └── figures.py          # Chart generators
│   ├── core/
│   │   ├── ofi_calculator.py   # OFI Z-score
│   │   ├── hawkes.py           # Hawkes intensity (MLE, L-BFGS-B)
│   │   ├── amihud.py           # Amihud ILLIQ + Kyle's λ
│   │   ├── spread_tracker.py   # Corwin-Schultz spread
│   │   └── volume_clock.py     # Volume clock imbalance
│   ├── data/
│   │   ├── data_feed.py        # yfinance / synthetic fallback
│   │   ├── intraday_feed.py    # Hourly bar cache (Parquet)
│   │   └── alpaca_stream.py    # Alpaca WebSocket SSE bridge
│   └── config/settings.py      # Tickers, model params
├── frontend/src/App.tsx        # React 18 single-file dashboard (~2400 lines)
├── tests/                      # 39 unit tests
├── .github/workflows/ci.yml    # GitHub Actions — pytest + import check + tsc build
├── requirements.txt
└── .env.example
```

---

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| Blank cards / proxy error | Backend not running | Start `uvicorn` in Terminal 1 first |
| "Invalid module" error | Wrong directory or venv not active | `cd AlphaFlow` then `source .venv/bin/activate` |
| Port already in use | Previous session still running | `lsof -ti:8002 \| xargs kill -9` |
| Groq rate limit | 100K tokens/day free tier | Add `GROQ_API_KEY_2` in `.env` — auto-rotates |
| Stale data after run | React Query cache | Hard-refresh: `Cmd+Shift+R` (Mac) / `Ctrl+Shift+R` (Windows) |

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Health check (Alpaca status) |
| POST | `/api/run` | Trigger Phase 1 pipeline |
| GET | `/api/signals/all` | Latest run signals (all tickers) |
| GET | `/api/history` | Last 10 runs with metrics |
| POST | `/api/intraday/run` | Trigger Phase 2 walk-forward engine |
| GET | `/api/intraday/signals` | Phase 2 IC, Sharpe, Max DD per ticker |
| GET | `/api/data/shap-importance` | SHAP feature importances |
| GET | `/api/data/ofi-timeseries` | OFI Z timeseries (`?start=&end=`) |
| GET | `/api/data/execution-quality` | Spread bps + Amihud timeseries |
| GET | `/api/data/kyle-lambda` | Kyle λ + 30d rolling mean |
| GET | `/api/data/alpha-decay` | IC at lags 1–10 per ticker |
| GET | `/api/stream` | SSE live bar stream |
| POST | `/api/chat` | Groq LLM open chat |
| POST | `/api/tickers/add` | Add custom ticker |

---

## Phase Roadmap

| Phase | Status | Description |
|---|---|---|
| **Phase 1** | ✅ Complete | Daily OHLCV · 5 signals · LightGBM · Groq LLM · interactive dashboard |
| **Phase 2** | ✅ Complete | Hourly bars · LGBMRegressor · IC 1–3% · SHAP · Hawkes · vol targeting · SSE |
| **Phase 3** | 🔜 Planned | Cross-sectional portfolio construction · risk parity · live execution stubs |

---

## References

- Kyle, A.S. (1985). Continuous auctions and insider trading. *Econometrica*, 53(6), 1315–1335.
- Amihud, Y. (2002). Illiquidity and stock returns. *Journal of Financial Markets*, 5(1), 31–56.
- Corwin, S.A. & Schultz, P. (2012). A simple way to estimate bid-ask spreads. *Journal of Finance*, 67(2), 719–760.
- Lee, C.M.C. & Ready, M.J. (1991). Inferring trade direction from intraday data. *Journal of Finance*, 46(2), 733–746.
- Cont, R., Cucuringu, M. & Zhang, C. (2023). Cross-impact of order flow imbalance. *Quantitative Finance*, 23(10), 1373–1393.
- Bacry, E., Mastromatteo, I. & Muzy, J.F. (2015). Hawkes processes in finance. *Market Microstructure and Liquidity*, 1(1).
- Grinold, R. & Kahn, R. (2000). *Active Portfolio Management* (2nd ed.). McGraw-Hill.
- Moreira, A. & Muir, T. (2017). Volatility-managed portfolios. *Journal of Finance*, 72(4), 1611–1644.
- Lundberg, S. & Lee, S.I. (2017). A unified approach to interpreting model predictions. *NeurIPS*, 30.
- López de Prado, M. (2018). *Advances in Financial Machine Learning*. Wiley.
