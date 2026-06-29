# AlphaFlow — Technical Specification

> **Version:** Phase 1 (Complete)  
> **Last updated:** June 2025  
> **Author:** Anthony Breeganzo Thomas, MSc RMFE — Imperial College London

---

## 1. System Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                     ALGOFLOW SYSTEM                           │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │                React + Vite Frontend (Port 3002)         │  │
│  │  • Recharts interactive visualisations                  │  │
│  │  • Dark / Light mode dashboard                          │  │
│  │  • Signal cards (11 tickers) + custom ticker API        │  │
│  │  • Real-time run history + portfolio metrics            │  │
│  └─────────────────────┬───────────────────────────────────┘  │
│                        │ REST API (JSON)                       │
│  ┌─────────────────────▼───────────────────────────────────┐  │
│  │               FastAPI Backend (Port 8002)                │  │
│  │  • /api/run  — async pipeline trigger                   │  │
│  │  • /api/runs — run history (Sharpe, Sortino, MDD)       │  │
│  │  • /api/signals/{run_id} — per-ticker signal data       │  │
│  │  • /api/chart/{name}     — PNG chart serve              │  │
│  │  • /api/tickers          — custom ticker CRUD           │  │
│  └──────┬───────────────────────────────┬──────────────────┘  │
│         │                               │                      │
│  ┌──────▼──────┐               ┌────────▼──────────┐          │
│  │  SQLite DB  │               │   Pipeline Engine  │          │
│  │  (app.db)   │               │   (LangGraph DAG)  │          │
│  │  run_history│               └────────┬──────────┘          │
│  │  signals    │                        │                      │
│  │  run_signals│          ┌─────────────▼─────────────────┐   │
│  └─────────────┘          │          LangGraph Flow         │   │
│                           │  ingest → ofi → spread → kyle  │   │
│                           │  → amihud → lgbm → llm → agg  │   │
│                           └─────────────┬─────────────────┘   │
│                                         │                      │
│                    ┌────────────────────┼────────────────────┐ │
│                    │                    │                    │ │
│             ┌──────▼──────┐  ┌─────────▼──────┐  ┌─────────▼┐│
│             │  yfinance   │  │  LightGBM     │  │ Groq API │ │
│             │  (market    │  │  Walk-forward  │  │ llama-3.3│ │
│             │   data)     │  │  200/50 days   │  │ -70b     │ │
│             └─────────────┘  └────────────────┘  └──────────┘ │
└───────────────────────────────────────────────────────────────┘
```

---

## 2. Signal Computation Methods

### 2.1 Order Flow Imbalance (OFI)

**Formula:** OFI proxy from daily OHLCV:
$$\text{OFI\_raw}_t = \frac{(H_t - L_t - |C_t - O_t|)}{H_t - L_t} \times \text{Volume}_t$$
$$\text{OFI\_z}_t = \frac{\text{OFI\_raw}_t - \mu_{90}}{\sigma_{90}}$$

A rolling 90-day window Z-score is applied to standardise across tickers and regimes.

**Reference:** Chordia, Roll & Subrahmanyam (2002). Order imbalance, liquidity, and market returns. *Journal of Financial Economics*, 65(1), 111–130.

### 2.2 Effective Spread (Roll Estimator)

**Formula:** Roll (1984) serial covariance estimator:
$$\text{Spread} = 2\sqrt{\max(0, -\text{Cov}(\Delta P_t, \Delta P_{t-1}))}$$
$$\text{Spread\_bps} = \frac{\text{Spread}}{P_t} \times 10^4$$

Computed from rolling 90-day window of log price changes.

**Reference:** Roll, R. (1984). A simple implicit measure of the effective bid-ask spread in an efficient market. *Journal of Finance*, 39(4), 1127–1139.

### 2.3 Kyle Lambda (Price Impact)

**Formula:** OLS regression on rolling 90-day window:
$$\Delta P_t = \alpha + \lambda \times Q_t + \varepsilon_t$$

Where $Q_t$ is signed volume proxy. $\lambda$ (Kyle Lambda) measures the price impact per unit of order flow — a direct measure of informed trading.

**Reference:** Kyle, A.S. (1985). Continuous auctions and insider trading. *Econometrica*, 53(6), 1315–1335.

### 2.4 Amihud Illiquidity

**Formula:** Daily illiquidity ratio, annualised:
$$\text{Illiq}_t = \frac{|r_t|}{\text{Volume}_t \times P_t}$$
$$\text{Amihud}_{\text{annual}} = \frac{1}{T} \sum_{t=1}^{T} \text{Illiq}_t \times 10^6$$

Scaled by $10^6$ for numerical readability. Higher = more illiquid (more price impact per dollar traded).

**Reference:** Amihud, Y. (2002). Illiquidity and stock returns: Cross-section and time-series effects. *Journal of Financial Markets*, 5(1), 31–56.

---

## 3. Machine Learning Pipeline

### Walk-Forward Validation Design

```
Train          Test   Train           Test
[───────────] [────] [──────────────] [────]
     200 days    50 days    rolling forward...
```

- **Train window:** 200 trading days (≈ 10 months)
- **Test window:** 50 trading days (≈ 2.5 months)
- **Step:** 50 days forward each iteration
- **Feature set:** OFI\_z, effective\_spread\_bps, kyle\_lambda, amihud\_illiq (lagged 1 day)
- **Target:** Forward 1-day excess return over risk-free rate

### LightGBM Configuration

```python
model = LGBMRegressor(
    n_estimators=300,
    learning_rate=0.05,
    max_depth=4,
    num_leaves=15,
    min_child_samples=10,
    subsample=0.8,
    colsample_bytree=0.8,
    reg_alpha=0.1,
    reg_lambda=1.0,
    random_state=42,
    verbose=-1,
)
```

Parameters tuned for low-noise daily regime with limited training samples (~200 bars).

### Information Coefficient (IC)

$$\text{IC} = \text{Spearman}\left(\hat{r}_{t+1}, r_{t+1}\right)$$

IC measures the rank-correlation between model predictions and actual returns across all walk-forward test windows.

**Phase 1 result:** IC ≈ 0.000 (all tickers)

This is **expected and correct** for daily data under market efficiency. The Information Ratio at daily resolution is noise-dominated. Phase 2 (tick-level LOB data, intraday signals) targets IC > 0.05.

---

## 4. Portfolio Backtest Methodology

### Long-Short Construction

At each signal date $t$:
1. Rank all 11 tickers by OFI Z-score
2. **Long position:** Top-2 tickers (highest OFI Z → most buying pressure)
3. **Short position:** Bottom-2 tickers (lowest OFI Z → most selling pressure)
4. Equal-weight within each leg ($\frac{1}{2}$ per ticker)
5. Portfolio return: $r_{\text{port},t} = r_{\text{long},t} - r_{\text{short},t}$

### Performance Metrics

| Metric | Formula |
|--------|---------|
| Sharpe Ratio | $\sqrt{252} \times \mu / \sigma$ (annualised) |
| Sortino Ratio | $\sqrt{252} \times \mu / \sigma_{\text{downside}}$ (annualised) |
| Max Drawdown | $\max_{t \leq s} \left(1 - \frac{P_t}{P_s}\right)$ |

---

## 5. LLM Integration (Groq)

### Model
- `llama-3.3-70b-versatile` via Groq Cloud API
- Temperature: 0.25 (low variance for research output)
- Max tokens: 80 per ticker (compact, focused reasoning)

### Prompt Design

The prompt provides:
1. Company context (sector, business model)
2. Per-ticker microstructure signal values vs. typical ranges
3. Signal ranking (most anomalous → least)
4. Explicit instruction: flag the most significant anomaly, state directional implication

### Key Rotation
Two API keys are rotated (`GROQ_API_KEY`, `GROQ_API_KEY_2`) to double the daily token quota (200K tokens/day total). At ~500 tokens per pipeline run (11 tickers × ~45 tokens), this supports ~400 full pipeline runs per day before hitting rate limits.

---

## 6. Database Schema

```sql
CREATE TABLE run_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    status      TEXT NOT NULL DEFAULT 'running',
    error_msg   TEXT,
    sharpe      REAL DEFAULT 0.0,
    max_drawdown REAL DEFAULT 0.0,
    sortino     REAL DEFAULT 0.0
);

CREATE TABLE signals (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker      TEXT NOT NULL,
    ofi         REAL,
    eff_spread_bps REAL,
    kyle_lambda REAL,
    amihud_illiq REAL,
    ic_value    REAL,
    sharpe      REAL,
    lgbm_prob   REAL,
    signal      TEXT,
    llm_reason  TEXT
);

CREATE TABLE run_signals (
    run_id      INTEGER NOT NULL REFERENCES run_history(id),
    signal_id   INTEGER NOT NULL REFERENCES signals(id),
    PRIMARY KEY (run_id, signal_id)
);
```

---

## 7. API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/run` | POST | Trigger pipeline (async, returns `run_id`) |
| `/api/runs` | GET | Get last N run history records |
| `/api/signals/{run_id}` | GET | Get all signal records for a run |
| `/api/tickers` | GET | List all custom tickers |
| `/api/tickers` | POST | Add custom ticker (validates via yfinance) |
| `/api/tickers/{ticker}` | DELETE | Remove custom ticker |
| `/api/chart/{filename}` | GET | Serve chart PNG from `outputs/figures/` |
| `/api/ask` | POST | Ask LLM about signals (chat interface) |
| `/health` | GET | Health check |

---

## 8. Repository Structure

```
AlphaFlow/
├── backend/                # FastAPI application
│   ├── main.py             # Routes + async pipeline runner
│   └── database.py         # SQLite CRUD + migration
├── alpha_flow/             # Core Python package
│   ├── agent/
│   │   ├── signal_agent.py     # Per-ticker signal computation + Groq LLM
│   │   └── langgraph_flow.py   # LangGraph DAG (8-node pipeline)
│   ├── analysis/
│   │   ├── microstructure.py   # OFI, Spread, Kyle λ, Amihud
│   │   └── performance.py      # Walk-forward backtest + Sharpe/Sortino/MDD
│   ├── core/
│   │   └── predictor.py        # LightGBM walk-forward trainer
│   ├── data/
│   │   └── fetcher.py          # yfinance data fetch + caching
│   └── signals/
│       └── ofi.py              # OFI computation module
├── frontend/               # React + Vite + TypeScript
│   └── src/App.tsx         # Single-file dashboard component
├── data/
│   ├── app.db              # SQLite database
│   ├── raw/                # Cached OHLCV CSVs (per-ticker)
│   └── custom_tickers.json # User-added custom tickers
├── outputs/
│   └── figures/            # Generated chart PNGs
├── tests/                  # pytest test suite (29 tests)
├── docs/                   # This documentation folder
│   ├── PHASE_ROADMAP.md
│   ├── SCHOLARSHIP.md
│   └── TECHNICAL_SPEC.md   (this file)
├── README.md               # Project overview + quick start
├── RESEARCH.md             # Empirical results + methodology
└── .env                    # API keys (not committed)
```
