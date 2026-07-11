# AlphaFlow — Market Microstructure Alpha Engine

[![Tests](https://img.shields.io/badge/tests-111%20passing-brightgreen)](#testing)
[![Python](https://img.shields.io/badge/python-3.11%2B-blue)](#requirements)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

A market-microstructure alpha research system that computes order-flow and
liquidity signals from free OHLCV data, validates them with walk-forward
machine learning, and grounds a natural-language layer in the live results.
It runs end-to-end on **free API tiers** (Groq + Alpaca IEX) and ships with a
FastAPI backend, a React dashboard, and an APScheduler cron for unattended runs.

> **Design principle a reviewer should check first:** the trading signal is
> **100% deterministic** and built in **two tiers** — (1) a cross-sectional
> long-short *book* (long the top decile, short the bottom decile of the
> directional signal), and (2) a separate **high-conviction flag** for names
> whose IC also survives Benjamini-Hochberg FDR correction. The LLM (Groq
> `llama-3.3-70b-versatile`) writes *explanations only* and never decides a
> BUY/SELL/HOLD. Non-deterministic, unauditable output has no place in the
> signal path of a quant system.

---

## What it does — AI vs rules vs hybrid

| Layer | Implementation | Role |
|-------|---------------|------|
| **Rules (the alpha)** | `alpha_flow/core/*` microstructure math + `analysis/signal_classification.py` (rank → book + FDR conviction flag) | Deterministic. Produces every BUY/SELL/HOLD. |
| **ML (the predictor)** | Hourly walk-forward `LGBMRegressor` on 13 features (`analysis/intraday_engine.py`) | Statistical. IC / IC-t-stat drive the classifier. |
| **AI (narrative only)** | Groq LLM at 3 sites: `agent/signal_agent.py`, `POST /api/explain`, `POST /api/chat` | Explains signals in English, grounded in live DB numbers. Never decides. |

The system runs at **two resolutions**:

- **Daily** — OFI Z-score, Kyle's λ (price impact), Amihud illiquidity,
  Corwin-Schultz effective spread, VPIN from daily OHLCV. Orchestrated by a
  LangGraph pipeline; each ticker gets a one-sentence LLM rationale.
- **Hourly** — a LightGBM walk-forward (embargoed/purged folds) on 13
  microstructure features with SHAP attribution, a tearsheet
  (IC, IC-t-stat, Sharpe, Sortino, Calmar, Omega), a cross-sectional long-short
  portfolio simulation, and Alpaca paper-trade execution.

## Microstructure library (`alpha_flow/core/`)

| Signal | Estimator | Reference |
|--------|-----------|-----------|
| OFI Z-score | Buy-bar volume proxy, rolling z-score | Chordia, Roll & Subrahmanyam (2002) |
| Kyle's λ | Cov(ΔP, OFI)/Var(OFI) rolling OLS | Kyle (1985) |
| Amihud ILLIQ | \|return\| / dollar-volume | Amihud (2002) |
| Corwin-Schultz spread | High/low ratio estimator | Corwin & Schultz (2012) |
| VPIN | Bulk-volume-classified flow toxicity | Easley, López de Prado & O'Hara (2012) |
| Hawkes intensity | Self-exciting λ(t)=μ+Σα·e^(−β·Δt), MLE | Bacry, Mastromatteo & Muzy (2015) |
| VWAP deviation | Session VWAP z-score | — |
| Volume-clock imbalance | Signed volume z-score | López de Prado (2018) |

---

## Results (representative run, 50-ticker universe)

Numbers below are from a full run on free data (Alpaca IEX hourly + yfinance
daily). They are reproducible — re-run the pipelines and the dashboard/PDF will
report your own values.

**The tradeable book (Tier 1).** Both resolutions produce a cross-sectional
long-short book: **10 long / 10 short / 30 hold** at the hourly resolution
(top/bottom 20% of the 50-name universe by directional signal), each name shown
with its transaction-cost drag and net edge. This is standard systematic
construction — it monetises the rank spread and does *not* require any single
name to be individually significant.

**Statistical conviction (Tier 2).** Cross-sectional **average |IC| ≈ 1.4%**
(median 1.1%, max 5.2%); average gross Sharpe ≈ 0.42, Sortino ≈ 0.63 across
20–27 walk-forward folds per ticker. Individually strong names (TSM +5.2%,
IC t-stat 2.55; ORCL −4.2%, t-stat −2.79) exist, but **0 survive
Benjamini-Hochberg correction across 50 simultaneous tests** — so **0 names are
flagged high-conviction**. The book still trades; the flag honestly reports that
no single name is individually significant on free data. Daily OFI IC is ≈ 0
(mean −0.007), scientifically expected for daily OHLCV (Chordia et al. 2002).

> **Honest framing.** avg |IC| ≈ 1.4% is *below* the Grinold-Kahn 5%
> "strong-signal" threshold, and 0 names clear FDR — the expected ceiling for
> free OHLCV without tick / limit-order-book data. The value is the
> *methodology*: a real long-short book, leak-free walk-forward, net-of-cost
> reporting, multiple-testing honesty, and an auditable rules/ML/LLM split — not
> a headline Sharpe. See [RESEARCH.md](RESEARCH.md) for the full limitations.

---

## Architecture

```
                    ┌──────────────── React dashboard (Vite) ────────────────┐
                    │  daily view · hourly view · charts · paper trades · chat │
                    └───────────────────────────┬─────────────────────────────┘
                                                 │  REST + SSE
                    ┌────────────────────────────▼─────────────────────────────┐
                    │                 FastAPI backend (backend/main.py)          │
                    │  /api/run (daily)  /api/intraday/run (hourly)  /api/chat    │
                    └──────┬───────────────────────┬─────────────────────┬──────┘
             ┌────────────▼──────┐    ┌────────────▼───────────┐  ┌──────▼───────┐
             │ LangGraph daily   │    │ Hourly LightGBM         │  │ Groq LLM      │
             │ pipeline (agent/) │    │ walk-forward + SHAP     │  │ (narrative)   │
             │                   │    │ (analysis/)             │  └──────────────┘
             └────────┬──────────┘    └───────────┬─────────────┘
                      └──────────┬─────────────────┘
                    shared core/ microstructure + signal_classification (rank→book+FDR)
                                          │
                     data/ (yfinance daily · Alpaca IEX hourly · SQLite)
```

Full diagram and endpoint/schema tables: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Quick start

### Requirements
- Python **3.11+** (CI pins 3.11 for SHAP/LightGBM C-extension stability; 3.12/3.13 also work)
- Node **20+**
- A free **Groq** API key ([console.groq.com](https://console.groq.com/keys)); optional free **Alpaca** paper key ([alpaca.markets](https://alpaca.markets))

### Setup
```bash
cp .env.example .env          # add your GROQ_API_KEY (ALPACA_* optional)
./setup_venv.sh               # creates .venv, installs requirements.txt
source .venv/bin/activate

# Backend (terminal 1)
uvicorn backend.main:app --reload --port 8002

# Frontend (terminal 2)
cd frontend && npm install && npm run dev    # http://localhost:3002
```

Then in the dashboard: **Daily** → *Run EOD Signals*; **Hourly** → *Run Intraday*.
Without an Alpaca key the hourly pipeline falls back to yfinance hourly bars and
paper trading is disabled; everything else runs.

### CLI (offline research)
```bash
python run.py     # daily pipeline → walk-forward backtest → output charts
```

### Reproduce RESEARCH.md numbers
```bash
jupyter notebook notebooks/reproduce.ipynb
```
Runs both pipelines end-to-end (~10 min) and generates every table in
[RESEARCH.md](RESEARCH.md) from raw data, including rank fraction sensitivity
and a BH-FDR worked example.

---

## Testing

**111 tests, all passing, all offline** (no API keys, deterministic seeds,
synthetic frames). They include reference-value checks (hand-computed Amihud and
Kyle-λ), regression tests (Kyle-λ variance floor, two-tier signal (book + conviction)
parity between Daily and Hourly), and edge cases.

```bash
pytest -q
```

---

## Repository layout

```
alpha_flow/
  core/          microstructure estimators (pure functions, both resolutions)
  analysis/      intraday_engine, signal_classification (rank→book+FDR), portfolio,
                 alpha_decay, performance, figures, backtest (CLI)
  agent/         LangGraph daily pipeline + Groq narrative (signal_agent)
  data/          yfinance daily + Alpaca IEX hourly feeds + SSE stream
  execution/     Alpaca paper-trade order submission
  config/        settings (universe, windows, thresholds)
backend/         FastAPI app (main.py) + SQLite persistence (database.py)
frontend/        Vite + React + TypeScript dashboard (src/App.tsx)
tests/           111 offline tests
notebooks/       reproduce.ipynb — reproduces every RESEARCH.md number from raw data
docs/            ARCHITECTURE.md · APPLICATION.md · ROADMAP.md · PLANNING_PROMPT.md
                 AlphaFlow_Executive_Brief.html (open in browser → Print → Save as PDF)
run.py           CLI entry point (offline pipeline + backtest)
render.yaml      Render.com deployment (backend + static frontend)
```

## Deployment

`render.yaml` deploys the FastAPI backend and the static React build to
Render.com (free tier — the backend cold-starts after idle). SQLite persists on
a mounted disk (`DATA_DIR=/var/data`). Set `SCHEDULER_ENABLED=true` there to run
the weekday cron (daily 9:35 AM ET · hourly 10:35 AM–4:35 PM ET · data refresh
9:30 PM ET, America/New_York, DST-aware).

## References

Chordia, Roll & Subrahmanyam (2002) · Kyle (1985) · Amihud (2002) · Corwin &
Schultz (2012) · Easley, López de Prado & O'Hara (2012) · Bacry, Mastromatteo &
Muzy (2015) · Grinold & Kahn (2000) · Benjamini & Hochberg (1995) · López de
Prado (2018).

## License

MIT — see [LICENSE](LICENSE).
