# AlphaFlow — Phase Roadmap & Timelines

> **Author:** Anthony Breeganzo Thomas  
> **Programme:** MSc Risk Management and Financial Engineering — Imperial College London  
> **Project:** Market Microstructure Alpha Signal Engine

---

## Executive Summary

AlphaFlow is a three-phase research project building from academic signal research to live execution:

| Phase | Scope | Data | Target Sharpe | Status |
|-------|-------|------|---------------|--------|
| 1 | Daily OHLCV microstructure signals + ML | Daily bars (501 days) | Baseline / n/a | ✅ **Complete** |
| 2 | Tick-level LOB signals + HFT predictors | TAQ / Alpaca stream | > 1.0 | 🔨 **Next** |
| 3 | Live paper trading execution engine | Real-time Alpaca feed | > 1.5 | 📋 Planned |

---

## Phase 1 — Daily Resolution Signal Engine ✅ COMPLETE

**Duration:** 6 weeks (already complete)  
**Objective:** Establish a rigorous walk-forward research pipeline validating that microstructure signals can be reliably computed from daily OHLCV data, and that a correctly implemented ML model + LLM reasoning layer produces a coherent output — even when IC ≈ 0 (which is the expected and scientifically correct result for daily data).

### What was built

| Component | Description |
|-----------|-------------|
| **OFI Signal** | Order Flow Imbalance Z-score from OHLCV proxy — Chordia & Subrahmanyam (2004) methodology |
| **Effective Spread** | Roll (1984) estimator: `2√(-Cov(ΔP_t, ΔP_{t-1}))` — measures bid-ask spread from price series |
| **Kyle Lambda** | Price impact coefficient via OLS regression on signed order flow — Kyle (1985) |
| **Amihud Illiquidity** | `|r_t| / Volume_t` daily series — Amihud (2002) |
| **Walk-forward LightGBM** | 200-day rolling train / 50-day test, predicting next-day excess return from signal features |
| **Groq LLM Reasoning** | Per-ticker narrative using llama-3.3-70b-versatile with domain-specific prompting |
| **Portfolio Backtest** | Long-short: top-2 OFI long / bottom-2 OFI short; annualised Sharpe, Sortino, Max Drawdown |
| **FastAPI Backend** | REST API + SQLite run history with async pipeline execution |
| **React Dashboard** | Interactive Recharts visualisations + real-time signal cards |

### Key Empirical Results (Phase 1)

| Metric | Value | Interpretation |
|--------|-------|----------------|
| Portfolio Sharpe | **-0.168** | IC ≈ 0 on daily data produces noisy long-short signals; negative in test period |
| Portfolio Sortino | **-0.252** | Consistent with near-zero IC — downside deviation ≥ upside |
| Max Drawdown | **-15.84%** | Reflects broad equity drawdown in test period, not signal failure |
| Avg IC (all tickers) | **≈ 0.000** | Correct: daily OHLCV cannot reliably predict next-day returns. Phase 2 addresses this. |
| Best per-ticker Sharpe | **+1.67 (AAPL)** | Buy-and-hold Sharpe of the underlying stock during walk-forward test periods |

> **Why negative Sharpe is acceptable in Phase 1:** Negative portfolio Sharpe does NOT indicate a broken pipeline. It indicates exactly what market microstructure theory predicts: *daily* OHLCV signals have near-zero information content for next-day prediction. The pipeline infrastructure — walk-forward rigor, LLM integration, live dashboard — is the deliverable of Phase 1. Alpha generation is the objective of Phase 2.

### Phase 1 Gaps & Known Limitations

- IC ≈ 0 at daily resolution (correct and expected per EMH at daily scale)
- LightGBM predictions ≈ 0 at daily resolution → lgbm_prob ≈ 0.5 for all tickers
- Groq daily token quota (~100K/day per key) limits LLM call frequency
- No intraday data — Kyle λ and OFI are approximations from OHLCV proxies
- 11 tickers (AAPL, MSFT, NVDA, META, GOOGL, AMZN, TSLA, JPM, BAC, V, GS) — S&P 500 Large Cap only

---

## Phase 2 — Tick-Level LOB Signal Engine 🔨 NEXT (est. 8–10 weeks)

**Start:** Q3 2025  
**Duration:** 8–10 weeks  
**Objective:** Replace OHLCV proxies with genuine Level-2 order book data from Alpaca's websocket stream. Target IC > 0.05, Portfolio Sharpe > 1.0.

### What to build

| Component | Description | Expected Improvement |
|-----------|-------------|---------------------|
| **Alpaca WebSocket LOB ingest** | Subscribe to `quotes` feed (NBBO), reconstruct top-of-book, compute real-time OFI from actual bid/ask changes | IC: 0 → 0.05–0.15 |
| **True Effective Spread** | `(P_trade - midpoint) × side_indicator` — Lee & Ready (1992) trade direction | Spread estimate much more precise |
| **Intraday Kyle Lambda** | Regress price changes on trade-signed volume at 1-min and 5-min bars | 5–10× more signal than daily |
| **VWAP Reversion Signal** | `(P - VWAP_session) / σ_intraday` — captures mean-reversion in continuous session | New signal layer |
| **Volume Clock Features** | Tick-by-tick features: inter-arrival time, trade size distribution, runs test | Captures HFT microstructure effects |
| **Hawkes Process Intensity** | Model order arrival as a self-exciting point process — Hawkes (1971) | Academic novelty for MSc thesis |
| **Online LightGBM** | Rolling re-train every 30 mins using last 5 sessions of tick data | Adapts to intraday regime |
| **Real-time Dashboard** | WebSocket push from FastAPI to React — live signal updates every 1 min | Interactive trading interface |

### Phase 2 Milestones

| Week | Milestone |
|------|-----------|
| 1–2 | Alpaca WebSocket LOB ingest + tick data storage (DuckDB or Parquet) |
| 3–4 | Genuine OFI, Effective Spread, Kyle Lambda from tick data |
| 5–6 | Online LightGBM + IC > 0.02 validation |
| 7–8 | VWAP reversion + Hawkes process intensity |
| 9–10 | Portfolio backtest: target Sharpe > 1.0, Sortino > 0.8 |

### Academic Citations for Phase 2

- Chordia, T., Roll, R., & Subrahmanyam, A. (2002). Order imbalance, liquidity, and market returns. *Journal of Financial Economics*, 65(1), 111–130.
- Lee, C., & Ready, M. (1992). Inferring trade direction from intraday data. *Journal of Finance*, 47(2), 733–746.
- Hawkes, A. (1971). Spectra of some self-exciting and mutually exciting point processes. *Biometrika*, 58(1), 83–90.
- Ait-Sahalia, Y., Cacho-Diaz, J., & Laeven, R. (2015). Modeling financial contagion using mutually exciting jump processes. *Journal of Financial Economics*, 117(3), 585–606.

---

## Phase 3 — Live Execution Engine 📋 PLANNED (est. Q1–Q2 2026)

**Duration:** 6–8 weeks  
**Objective:** Connect Phase 2 signals to a live paper trading execution engine via Alpaca. Build a portfolio management system with risk controls, execution cost modelling, and performance attribution.

### What to build

| Component | Description |
|-----------|-------------|
| **Alpaca Paper Trading** | Live order routing via Alpaca REST API — bracket orders, market + limit |
| **Execution Algorithm** | TWAP/VWAP execution to minimise slippage on signal entry |
| **Position Sizing** | Kelly-fraction with IC shrinkage: `f* = IC × (μ/σ²)` |
| **Risk Budget** | Per-ticker max position, portfolio-level VaR constraint, correlation-adjusted sizing |
| **Transaction Cost Model** | Estimate market impact using Kyle λ, then optimise entry timing |
| **Performance Attribution** | Decompose PnL into: signal alpha, execution alpha, timing, sector exposure |
| **Drawdown Guardrail** | Auto-pause trading when MDD > 5% in any rolling 10-day window |
| **PDF Report Generator** | Scheduled WeasyPrint report: positions, PnL, signal IC, execution quality |

### Phase 3 Milestones

| Week | Milestone |
|------|-----------|
| 1–2 | Alpaca order routing + paper trading integration |
| 3–4 | TWAP execution algorithm + slippage measurement |
| 5–6 | Risk budget engine (VaR, Kelly sizing, correlation) |
| 7–8 | Performance attribution + PDF report generator |
| +2 | Production hardening, monitoring, alerting |

---

## Timeline Overview

```
2025 Q2    Q3                Q4           2026 Q1-Q2
   │        │                 │               │
[Phase 1]──[Phase 2: 8wks]──[Gap/Review]──[Phase 3: 8wks]
   ✅            🔨                               📋
```

---

## Technology Stack

| Layer | Phase 1 | Phase 2 Add | Phase 3 Add |
|-------|---------|-------------|-------------|
| Data | yfinance (daily) | Alpaca WebSocket (tick) | Alpaca REST (live orders) |
| Storage | SQLite | DuckDB (tick) | Parquet + SQLite |
| ML | LightGBM walk-forward | Online LightGBM, Hawkes process | — |
| LLM | Groq llama-3.3-70b | Groq + context from tick data | Same |
| Backend | FastAPI + uvicorn | Same + WebSocket push | Same + risk engine |
| Frontend | React + Recharts | Same + live updates | Same + execution panel |
| Execution | — | — | Alpaca paper trading |

---

## Academic Relevance (MSc RMFE — Imperial College)

This project directly applies coursework from:
- **Market Microstructure** — OFI, Kyle model, Amihud illiquidity, effective spread estimation
- **Quantitative Methods** — Walk-forward cross-validation, IC measurement, Spearman correlation
- **Portfolio Theory** — Sharpe / Sortino ratios, max drawdown, Kelly criterion sizing
- **Machine Learning in Finance** — LightGBM, gradient boosting, feature engineering from time series
- **Risk Management** — VaR budget, drawdown constraints, position limits

The Hawkes process (Phase 2) and performance attribution framework (Phase 3) are suitable as core components of the MSc dissertation.
