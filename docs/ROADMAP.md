# AlphaFlow — Development Roadmap

## Completed Phases

### Phase 1: Daily Microstructure Engine (Free Tier)
**Status:** Complete · **Cost:** $0/month

- 50-ticker S&P 500 universe with full sector coverage
- 5 daily microstructure signals: OFI z-score, Amihud ILLIQ, Kyle's lambda,
  Corwin-Schultz spread, tick sign
- LangGraph orchestration pipeline (fetch → compute → LLM narrative → summarise)
- Groq LLM narrative explanations (never decides signals)
- FastAPI backend + SQLite persistence
- React 18 / TypeScript dashboard with light/dark mode
- Daily signal distribution: ~3 BUY / ~4 SELL / ~43 HOLD (OFI z + IC sign gate)

### Phase 2: Hourly Walk-Forward ML Engine (Free Tier)
**Status:** Complete · **Cost:** $0/month

- 13 microstructure features at hourly resolution (6.5x more data than daily)
- LightGBM walk-forward regressor with embargo/purge (20-27 folds per ticker)
- SHAP feature attribution (TreeExplainer per fold)
- Volatility targeting (Moreira & Muir 2017)
- IC / IC_IR / Sharpe / Sortino / Calmar / Omega / Hit Rate tearsheet
- Alpha decay analysis with bootstrap 90% CI
- Alpaca IEX free-tier hourly bars (2-5% US market volume)
- SSE live-stream endpoint for real-time bar updates

### Phase 3: Two-Tier Signal + Portfolio Construction (Free Tier)
**Status:** Complete · **Cost:** $0/month

- Two-tier signal classification (shared Daily + Hourly):
  - Tier 1: cross-sectional long-short book (quintile rank, no FDR gate)
  - Tier 2: high-conviction flag (Benjamini-Hochberg FDR, annotation only)
- Portfolio simulation engine: gross/net Sharpe, transaction cost model
  (Corwin-Schultz half-spread at monthly rebalance), per-name TC drag + net edge
- CAPM alpha decomposition (OLS regression vs SPY)
- VPIN flow toxicity signal (Easley, Lopez de Prado & O'Hara 2012)
- Alpaca paper-trade execution layer (submit orders, PnL tracking)
- APScheduler cron (daily 9:35 AM ET, hourly 10:35-16:35 ET, nightly 9:30 PM ET)
- Reproducible research notebook (`notebooks/reproduce.ipynb`)
- 111 offline tests, CI, Render.com deployment

### Phase 3 Data Architecture (current)

```
Data source         Resolution    Coverage        OFI method         IC ceiling
─────────────────   ──────────    ──────────      ────────────────   ──────────
yfinance (free)     Daily OHLCV   All exchanges   Bar proxy*         ~0% (noise)
Alpaca IEX (free)   Hourly OHLCV  2-5% US mkt    Bar proxy*         ~1-3%
yfinance (free)     Hourly OHLCV  All exchanges   Bar proxy*         ~1-3%

* Bar proxy = classify entire bar's volume as buy/sell based on close vs open.
  Real OFI (Chordia 2002) classifies each individual TRADE via Lee-Ready.
  The proxy loses within-bar directional information → IC ceiling.
```

---

## Future Phases (Require Paid Data)

### Phase 4: SIP Full-Market Bars
**Status:** Planned · **Cost:** ~$200/month (Alpaca Algo Trader Plus)

**What changes:**
- SIP (Securities Information Processor) data covers ALL US exchanges
  (not just IEX's 2-5%). Every trade on NYSE, NASDAQ, ARCA, BATS, etc.
- Still OHLCV bars, but with 100% market coverage → better OFI proxy
- Real-time data (no 15-minute delay) → live signal updates
- Unlimited API calls (vs free tier rate limits)

**Expected IC improvement:** modest (still bar-level proxy, but 20-50x more
volume per bar → less noisy OFI estimate). Estimate: 1.4% → 2-3%.

**Code changes needed:**
- `alpha_flow/config/settings.py`: change `ALPACA_DATA_FEED = "sip"` (1 line)
- `alpha_flow/data/intraday_feed.py`: remove 15-minute delay offset (1 line)
- No algorithmic changes — the pipeline already handles any OHLCV source

### Phase 5: Tick-Level Data + Real OFI
**Status:** Planned · **Cost:** ~$100-300/month (Polygon.io or Databento)

**What changes — THIS IS THE REAL UNLOCK:**
- Individual trade-by-trade data (timestamp, price, size, exchange, conditions)
- Real Lee-Ready trade classification: classify each trade as buyer/seller
  initiated based on trade price vs midpoint of NBBO quote
- Sub-second bar construction: volume bars, dollar bars, tick bars
  (Lopez de Prado 2018 Ch.3)
- Actual order book snapshots (Level 2 data) for true Kyle's lambda

**Expected IC improvement:** significant. Chordia et al. (2002) measured IC
4-8% on TAQ tick data. Our bar proxy achieves 1.4% because it loses within-bar
direction. With tick data, OFI becomes a real signal. Estimate: 1.4% → 4-8%.

**Code changes needed:**
- `alpha_flow/core/ofi_calculator.py`: replace bar proxy with real Lee-Ready:
  ```python
  # Current (bar proxy):
  buy_vol = volume.where(close >= open, 0)
  
  # With tick data (real OFI):
  midpoint = (best_bid + best_ask) / 2
  buy_vol = trade_size.where(trade_price > midpoint, 0)
  sell_vol = trade_size.where(trade_price < midpoint, 0)
  # Trades AT midpoint: use tick rule (compare to previous trade price)
  ```
- New `alpha_flow/data/tick_feed.py`: Polygon/Databento REST client + cache
- New `alpha_flow/core/volume_bars.py`: construct volume/dollar bars from ticks
- `alpha_flow/core/amihud.py`: use actual spread from NBBO quotes (not HL proxy)
- `alpha_flow/core/spread_tracker.py`: replace Corwin-Schultz estimator with
  actual quoted spread from Level 2 data
- Update `intraday_engine.py`: add tick-derived features (trade arrival rate,
  order book imbalance, quote-to-trade ratio)

### Phase 6: Advanced Portfolio Construction
**Status:** Planned · **Cost:** $0 (algorithm only)

- Risk-parity position sizing (inverse-vol weighting across legs)
- Mean-variance optimisation with sector/factor constraints
- Kelly fraction sizing (optimal geometric growth rate)
- Sector exposure limits (max 30% per GICS sector)
- Gross/net leverage constraints
- Turnover penalty in the objective function
- Realistic market impact model (Almgren-Chriss 2001)

### Phase 7: Deep Learning + Alternative Data
**Status:** Research · **Cost:** $50-500/month

- Temporal Fusion Transformer (TFT) for sequence modelling
- Graph Neural Network for cross-sectional signal propagation
- Options-implied volatility surface as features (CBOE data)
- News/sentiment features (FinBERT on earnings calls)
- Institutional ownership changes (13F filings, quarterly)

---

## Cost Summary

| Phase | Monthly Cost | IC Estimate | Key Unlock |
|-------|-------------|-------------|------------|
| 1-3 (current) | $0 | ~1.4% | Methodology proof |
| 4 (SIP bars) | ~$200 | ~2-3% | Full market coverage |
| 5 (tick data) | ~$100-300 | ~4-8% | Real OFI (Chordia 2002) |
| 6 (portfolio) | $0 | same IC | Better risk-adjusted returns |
| 7 (deep learning) | $50-500 | TBD | Alternative signals |

**The single highest-ROI upgrade is Phase 5** (tick data). It replaces the bar
proxy with real trade-by-trade OFI — the same methodology Chordia et al. (2002)
used to measure IC 4-8%. Everything else is incremental.

---

## What the Current System Proves (Phases 1-3)

Even on free OHLCV data with a bar-level OFI proxy:
- The **methodology** is correct: walk-forward, embargo/purge, BH-FDR, two-tier L/S
- The **engineering** is production-grade: 111 tests, CI, deploy, audit trail
- The **AI boundary** is explicit and auditable: LLM narrative only
- The **honesty** is a credibility asset: 1.4% IC, 0 high-conviction, full limitations

The value isn't the headline IC — it's the **system** that would produce a real
IC with real data. That's what a quant desk evaluates: can this person build
the research infrastructure?
