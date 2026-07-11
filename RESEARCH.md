# AlphaFlow: A Microstructure Alpha Signal Engine
### Manuscript draft — Imperial College MS Mathematics & Finance
**Author:** Anthony Breeganzo Thomas  
**System version:** v3.0 · 111 tests passing · TypeScript clean

---

## Abstract

Market microstructure theory predicts that informed trading leaves measurable signatures in equity order flow. We operationalise this theory in **AlphaFlow**, an end-to-end research system that extracts 13 microstructure features from hourly OHLCV bars, evaluates their predictive power via walk-forward cross-validation with a LightGBM regressor, and validates signal quality using the Fundamental Law of Active Management (Grinold & Kahn 2000).

Our pipeline achieves a cross-sectional average **|IC| of ≈ 1.4%** (median 1.1%, max 5.2%) across a **50-ticker** S&P 500 large-cap universe using ~730 days of hourly bars, with the strongest single names (TSM +5.2%, IC t-stat 2.55; ORCL −4.2%, t-stat −2.79; NFLX +3.2%, t-stat 2.32) individually significant at p<0.05. The engine builds a two-tier signal: a **tradeable cross-sectional long-short book** (long the top decile, short the bottom decile of the directional signal — 10 long / 10 short / 30 hold on the 50-name universe) plus a separate **high-conviction flag** for names whose IC also survives a **Benjamini-Hochberg false-discovery-rate correction** (Q=0.10). On free data, **0 of 50 names clear the multiple-testing threshold**, so the book trades while honestly reporting zero individually-significant names — separating a tradeable rank spread from a claim of per-name significance. A **VPIN (Volume-Synchronized Probability of Informed Trading)** feature (Easley, López de Prado & O'Hara 2012) is incorporated as the 9th of the 13 signal dimensions, measuring order-flow toxicity via Bulk Volume Classification.

The system includes an Alpaca paper trading execution layer, IC half-life alpha decay analysis with bootstrap confidence intervals, and an APScheduler nightly pipeline. The stack is engineered to production hygiene — FastAPI backend, React 18/TypeScript frontend, 111 offline tests, CI, and a one-command Render.com deploy (free tier) — while remaining a research artifact rather than a live trading system.

**Keywords:** market microstructure, order flow imbalance, information coefficient, walk-forward validation, LightGBM, VPIN, SHAP attribution

---

## 1. Introduction

Financial markets exhibit short-lived predictability at intraday horizons. When institutional traders execute large orders, they reveal their information through the order flow — a phenomenon quantified as Order Flow Imbalance (OFI) by Chordia, Roll & Subrahmanyam (2002). This paper describes AlphaFlow, a system that:

1. Extracts **13 microstructure signals** from hourly OHLCV bars across 50 US equities
2. Trains a LightGBM regressor in a **walk-forward framework** (no look-ahead bias)
3. Evaluates signal quality using the **Fundamental Law**: IR ≈ IC × √N  (Grinold & Kahn 2000)
4. Attributes signal contribution via **SHAP** (Lundberg & Lee 2017)
5. Measures how long signals persist via **IC half-life decay** with bootstrap CI (Cont et al. 2023)
6. Executes paper trades via Alpaca and monitors live order flow toxicity via **VPIN**

**Research question:** Do OFI-based intraday signals contain statistically significant, economically exploitable Information Coefficients across a diversified 50-ticker universe — and do they survive multiple-testing correction?

**Hypothesis:** IC > 0.03 at lag 1, IC_IR > 0.5, t-stat > 2.0 for ≥ 50% of tickers.

---

## 2. Literature Review

### 2.1 Order Flow and Price Discovery

Kyle (1985) established the canonical model: a strategic, risk-neutral informed trader maximises profits by camouflaging orders within noise trading. The market maker's price adjustment coefficient **λ** (Kyle's lambda) is defined as:

    λ = Δprice / signed_volume (OLS slope)

A high λ indicates thin markets susceptible to information-based price impact. Chordia, Roll & Subrahmanyam (2002) demonstrated empirically that daily OFI predicts next-period returns with statistically significant IC ≈ 0.04–0.08, while Cont (2001) documented the stylized facts (fat tails, volatility clustering, autocorrelation) that any empirical model must respect.

### 2.2 Intraday Microstructure Signals

At hourly resolution, richer signals become computationally tractable:

- **VWAP deviation** (Almgren & Chriss 2001) tracks institutional volume-weighted execution costs, creating predictable mean-reversion pressure above ±2σ. VWAP algos used by institutions systematically resist filling above their volume-weighted average cost.
- **Hawkes process intensity** (Bacry et al. 2015) captures self-exciting order arrival:  
  `λ(t) = μ + Σᵢ α·exp(−β·(t−tᵢ))`, MLE via L-BFGS-B.  
  Elevated intensity predicts volatility clustering at 1–3 bar horizon.
- **Volume clock imbalance** (López de Prado 2018) uses buy/sell volume asymmetry within each bar as a higher-frequency OFI proxy, with empirically higher IC than price-based OFI at hourly resolution.

### 2.3 VPIN: Volume-Synchronized Probability of Informed Trading

Easley, López de Prado & O'Hara (2012) introduced VPIN — a non-parametric estimator of the Probability of Informed Trading (PIN) operating on volume-synchronized buckets. Using Bulk Volume Classification (BVC):

    buy_frac = (close − low) / (high − low)
    VPIN = (1/n) × Σ |V_buy − V_sell| / V_bar

VPIN ∈ [0,1] with high values signalling toxic, informed order flow. The NYSE and CME adopted VPIN-based circuit breakers after the 2010 Flash Crash. Easley et al. (2012) show VPIN predicts short-term price impact at 1–3 bar horizons in equity markets — making it a natural addition as feature #9 of the 13 in our microstructure pipeline.

AlphaFlow implements VPIN with a 20-bar rolling window, z-scored over a 60-bar normalisation window (`alpha_flow/core/vpin.py`). VPIN z > 1.5σ flags toxic flow episodes.

### 2.4 The Fundamental Law of Active Management

Grinold & Kahn (2000, Ch.6) formalise the relationship between signal quality and portfolio performance:

    IR ≈ IC × √(N_breadth)                          [Fundamental Law]

where **IC** is the Information Coefficient (Spearman ρ between signal ranks and forward return ranks) and **N** is the number of independent forecasts. The **IC Information Ratio**:

    IC_IR = mean(IC) / std(IC) × √N_folds             [Grinold & Kahn 2000, p.145]

measures signal *consistency* across walk-forward folds, not just average strength. Benchmarks: IC_IR > 0.5 = practitioner usability threshold; > 1.0 = publication-grade; > 2.0 = excellent. A signal with IC_IR = 0.3 that looks good on average IC may be dominated by 1–2 lucky folds.

Statistical significance is tested via:

    t-stat = mean(IC) / (std(IC) / √N_folds)          [H₀: mean IC = 0]
    p-value = P(|T| ≥ t | N-1 d.f.)

### 2.5 Walk-Forward Validation

Harvey, Liu & Zhu (2016) show that, given the hundreds of factors already tested in the published finance literature (the "factor zoo"), the conventional t-stat > 2.0 significance bar is far too lenient once multiple testing is accounted for — many "significant" factors in the literature are false discoveries, and they argue newly-proposed signals should clear a materially higher bar (t-stat > 3.0). We take this seriously by reporting IC t-stats/p-values explicitly (§2.4) rather than asserting significance from average IC alone. Separately, for the walk-forward validation itself, we follow López de Prado (2018, Ch.7) using **strictly sequential** splits: model trained on first K bars, tested on bars K+1 to K+W, W rolling forward without any look-back contamination.

---

## 3. Methodology

### 3.1 Data

- **Universe:** 50 S&P 500 large-caps spanning all GICS sectors (see `alpha_flow/config/settings.py`)
- **Horizon:** 730 calendar days (~2 years) of hourly OHLCV bars
- **Source:** Alpaca IEX feed (preferred, when API key configured) with Yahoo Finance (`yfinance`) as fallback — both windowed to the same 2-year horizon for consistency
- **Cache:** DuckDB/Parquet for reproducible re-runs without re-fetching

### 3.2 Feature Construction (13 features)

| # | Feature | Short formula | Paper |
|---|---------|---------------|-------|
| 1 | OFI z-score | (Δbid_vol − Δask_vol)/(bid+ask); z-scored | Chordia et al. (2002) |
| 2 | Amihud ILLIQ | |r_t| / (price × volume) × 10⁶ | Amihud (2002) |
| 3 | Kyle's λ | OLS: ΔP = λ×sign_vol + ε | Kyle (1985) |
| 4 | Corwin-Schultz spread | From daily high-low ranges | Corwin & Schultz (2012) |
| 5 | Tick sign | +1 uptick, −1 downtick (Lee-Ready) | Lee & Ready (1991) |
| 6 | VWAP z-score | (P − VWAP_t)/σ intraday reset | Almgren & Chriss (2001) |
| 7 | Volume clock z-score | (V_buy − V_sell)/V; z-scored | López de Prado (2018) |
| 8 | Hawkes z-score | MLE (μ,α,β) of Hawkes process; z-scored intensity | Bacry et al. (2015) |
| **9** | **VPIN z-score** | BVC bulk volume toxicity; z-scored 60-bar window | **Easley et al. (2012)** |
| 10 | Ret 1h | (P_{t-1} − P_{t-2})/P_{t-2} | Jegadeesh & Titman (1993) |
| 11 | Ret 3h | (P_{t-1} − P_{t-4})/P_{t-4} | Lo & MacKinlay (1988) |
| 12 | Ret 6h | (P_{t-1} − P_{t-7})/P_{t-7} | Jegadeesh & Titman (1993) |
| 13 | Vol ratio | V_t / 20-bar rolling avg | Karpoff (1987) |

### 3.3 Walk-Forward Pipeline

```
Train [1 .. 1260 bars]  │  Test [1261 .. 1365]
              ─── roll 105 bars ───▶
Train [106 .. 1365]     │  Test [1366 .. 1470]
              ─── roll 105 bars ───▶  ...  (~19-27 folds, varies by ticker)
```

- **Model:** `LightGBMRegressor` with early stopping on validation IC
- **Target:** r_{t+1} (next-bar return)
- **IC per fold:** Spearman ρ between predicted ranks and realised return ranks — test window only
- **SHAP:** `TreeExplainer` on each fold's test set; aggregated as mean |SHAP value| per feature
- **Embargo/purge gap:** 1 bar (`WF_HORIZON`) is skipped between each fold's train end and test start. The 1-bar-ahead target is constructed from price data that would otherwise overlap the test window; skipping this gap removes that label-leakage overlap (López de Prado 2018, Ch.7).

### 3.4 Performance Metrics

Annualisation factor: `scale = √(252 × 6.5)` = √1638 hourly bars/year.

    Sharpe  = scale × μ / σ
    Sortino = scale × μ / σ_downside     (downside vol only)
    Calmar  = Ann.Return / |Max Drawdown|             [Young 1991]
    Ω(L)    = Σmax(r−L,0) / Σmax(L−r,0)              [Keating & Shadwick 2002]
    IC_IR   = mean(IC)/std(IC) × √N_folds             [Grinold & Kahn 2000]
    HitRate = #{sign(ŷ) = sign(y)} / N_test
    ProfFac = gross_profit / gross_loss

### 3.5 Alpha Decay and Bootstrap CI

IC half-life is estimated by fitting `IC(τ) = IC₀ × exp(−λτ)` via `scipy.curve_fit`.  
Half-life = `ln(2)/λ` bars. Bootstrap 90% CI computed from 200 resamples (Efron & Hastie 2016).

### 3.6 Signal Classification: Two-Tier Design

Both resolutions share **one classification module** — `alpha_flow/analysis/signal_classification.py` — so their BUY/SELL/HOLD mechanics are identical. The design separates two questions a novice conflates:

**Tier 1 — the tradeable book (`classify_signal`):** rank the universe by its directional signal (Daily: OFI z-score; Hourly: `latest_signal`, the direction-corrected latest predicted return), go long the top `SIGNAL_RANK_FRACTION` (default 0.20 = quintile, Fama-French 1993 standard) and short the bottom fraction, each confirmed by a sign-consistency check. This is a standard cross-sectional long-short construction (AQR, Two Sigma): it monetises the *rank spread* and does **not** require any single name to be individually significant. With N=50, the quintile sort gives 10 long / 10 short / 30 hold — enough diversification per leg (deciles would give only 5, too concentrated; terciles 17, too diluted). See `notebooks/reproduce.ipynb` §4 for sensitivity analysis across fractions.

**Tier 2 — high-conviction flag (`is_high_conviction`):** separately, each name's IC p-value is tested against a Benjamini-Hochberg (1995) FDR threshold (Q=0.10) computed across the full universe. Names that survive are annotated as high-conviction. This is an **annotation**, never a gate that suppresses the Tier-1 signal.

**Why the split:** gating the tradeable signal on per-name FDR made every name HOLD on free data (the correct answer to "is THIS name individually significant?" but the wrong construction for a tradeable book). The two-tier design yields an actual book while honestly reporting that 0 names survive multiple-testing correction.

**Note on `latest_signal` vs `mean_ic`:** IC measures *skill* (correlation between predicted and actual), not *direction*. A name with IC = −4% is contrarian-useful — the model's predictions are anti-correlated with returns, so trading the opposite is profitable. `latest_signal = signal_dir × preds[-1]` corrects for this, giving the actual directional call the book ranks on. See `alpha_flow/analysis/intraday_engine.py` L304-313.

Both resolutions can legitimately show BUY/SELL/HOLD counts that differ from run to run and from each other — this reflects real, time-varying cross-sectional dispersion and significance in order flow, not an inconsistency between the two views.

---


## 4. Results

All numbers below are from a full run on the **50-ticker universe** over ~730
days of hourly bars (Alpaca IEX free tier), 20–27 walk-forward folds per ticker.
They are reproducible: re-running the hourly pipeline regenerates them in the
dashboard and the exported PDF brief. Reported to the precision the free data
supports — no cherry-picking.

### 4.1 Cross-Sectional Hourly Performance (representative run)

| Metric | Value (50-ticker universe) |
|--------|-----------------------------|
| Tradeable book (Tier 1) | **10 long / 10 short / 30 hold** (top/bottom 20%) |
| Average \|IC\| | **1.42%** (median 1.12%, max 5.24%) |
| Names with IC t-stat \|t\| > 2 | 3 of 50 |
| Names with p < 0.10 (pre-correction) | 4 of 50 |
| High-conviction: survive Benjamini-Hochberg FDR (Q=0.10) | **0 of 50** |
| Average gross Sharpe | +0.42 |
| Average Sortino | +0.63 |
| Average hit-rate | 50.2% |

**Strongest single-name signals** (individually significant, before correction):

| Ticker | IC | IC t-stat | Gross Sharpe |
|--------|-----|-----------|--------------|
| TSM | +5.24% | +2.55 | +1.77 |
| ORCL | −4.22% | −2.79 | +1.94 |
| KO | +4.13% | +1.59 | +1.07 |
| EOG | +3.74% | +1.93 | +0.95 |
| WMT | −3.85% | −1.72 | +0.46 |
| NFLX | +3.22% | +2.32 | +1.41 |

### 4.2 Two tiers: a tradeable book vs. per-name significance — the key result

The methodological core is the separation of two questions a novice conflates:

1. **What do I trade?** A cross-sectional long-short book: rank the universe by
   the directional signal, go long the top decile and short the bottom decile.
   This monetises the *rank spread* — whether the top outperforms the bottom on
   average — and is exactly how systematic equity desks (AQR, Two Sigma) build
   books. It does **not** require any single name to be individually significant.
   This run: 10 long / 10 short / 30 hold.

2. **Which names are individually significant?** Several look strong in isolation
   (TSM p=0.018, ORCL p=0.011, NFLX p=0.030). But across 50 simultaneous tests,
   2–3 spurious p<0.05 hits are expected by chance. Applying **Benjamini-Hochberg
   FDR correction at Q=0.10**, the best-ranked name needs p ≤ (1/50)·0.10 = 0.002
   — which *no* ticker meets. So **0 names are flagged high-conviction**.

An earlier version *gated* the tradeable signal on per-name FDR, which made every
name HOLD on free data — the correct answer to question 2 but the wrong
construction for question 1. Separating them yields an actual book while never
overstating significance. On the **daily** resolution the same construction
produces a smaller book (the OFI-vs-IC sign gate is stricter) because the daily
OFI IC ≈ 0 (mean −0.007) — exactly what microstructure theory predicts for daily
OHLCV that cannot resolve intra-bar direction (Chordia et al. 2002).

### 4.3 Fundamental Law context

At avg |IC| ≈ 1.4% and ~2,500 hourly bets/name/year, the Grinold-Kahn Fundamental
Law (IR ≈ IC·√breadth) implies a modest theoretical IR, consistent with the
observed average gross Sharpe of ≈ +0.42. The gap versus a naive breadth
calculation reflects cross-sectional signal correlation (reducing *effective*
breadth) and the fact that reported Sharpe is gross of transaction costs (§6.3).

### 4.4 VPIN Feature Contribution

VPIN (the 9th of the 13 hourly features) is included to capture order-flow
toxicity via Bulk Volume Classification (Easley, López de Prado & O'Hara 2012).
Its per-run SHAP importance and pairwise correlation with the other features are
computed live and surfaced in the dashboard (`/api/data/shap-importance`,
`/api/intraday/feature-correlation`); across runs it consistently carries
non-trivial, low-collinearity importance rather than being a redundant copy of
the OFI/Hawkes signals. Exact ranks vary run to run with the data window — the
dashboard is the source of truth, not a hard-coded table.

### 4.5 Alpha Decay (IC Half-Life with Bootstrap CI)

The alpha-decay module fits IC(lag) = IC₀·e^(−λ·lag) over lags 1–10 and reports
the implied half-life with a bootstrap confidence interval per ticker
(`POST /api/alpha-decay/run`, `GET /api/alpha-decay`; charted as
`outputs/figures/alpha_decay.png`). Microstructure OFI signals decay fast — a
half-life of a few bars — which is the expected profile for order-flow alpha and
implies a short execution window. Per-ticker half-lives are computed live rather
than quoted as fixed numbers here, to avoid presenting one window's estimate as a
universal constant.

### 4.6 Feature Collinearity Audit

The 13×13 Spearman ρ matrix shows max pairwise |ρ| = 0.38 (VWAP z / Kyle λ). VPIN z has max |ρ| = 0.31. Return features form a mild cluster (|ρ| ≈ 0.45–0.65) — acceptable; LightGBM handles moderate collinearity via leaf-splitting without feature pruning.

---

## 5. System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     AlphaFlow v3.0 System                           │
│                                                                     │
│  Data Layer               13-Feature Core                          │
│  ────────────  ────────▶  OFI · Amihud · Kyle · CS · Tick          │
│  yfinance 2yr             VWAP · VolClock · Hawkes · VPIN          │
│  Alpaca IEX               ret1h · ret3h · ret6h · VolRatio         │
│  DuckDB cache                       │                               │
│                         ┌───────────▼──────────┐                   │
│                         │ LightGBM walk-forward│                   │
│                         │ 19-27 folds · 13 feats│                   │
│                         │ IC_IR · Calmar · Omega│                  │
│                         └───────────┬──────────┘                   │
│            ┌────────────────────────┼──────────────────┐           │
│            ▼                        ▼                   ▼          │
│        Alpha Decay              SHAP                Execution      │
│        IC half-life             TreeExplainer       Alpaca paper   │
│        bootstrap CI             feature rank        submit_order() │
│                                                                     │
│  FastAPI backend · SQLite · Groq llama-3.3-70b · APScheduler       │
│  React 18 · TypeScript · Tailwind · Vite · port 3002               │
└─────────────────────────────────────────────────────────────────────┘
```

| Endpoint | Purpose |
|----------|---------|
| `POST /api/intraday/run` | Run 13-feature walk-forward pipeline |
| `GET /api/intraday/signals` | IC, IC_IR, t-stat, Calmar, Omega, Hit Rate per ticker |
| `GET /api/intraday/vpin?ticker=X&n=80` | Last N VPIN z-scores |
| `GET /api/data/alpha-decay` | IC by lag + half-life + bootstrap 90% CI |
| `POST /api/execute` | Submit paper trades for BUY/SELL signals |
| `GET /api/trades` | Paper trade log with gross PnL |

**Test coverage:** 111 tests across 9 files — `test_microstructure.py` (39), `test_intraday.py` (20), `test_performance.py` (14, Calmar/Omega/IC_IR/t-stat/SEM), `test_signal_classification.py` (14, two-tier book + conviction flag), `test_alpha_decay.py` (7), `test_execution.py` (5), `test_scheduler.py` (4), `test_portfolio_engine.py` (4), `test_vpin.py` (4, VPIN range/toxicity/pipeline).

### 5.1 Additional Implemented Capabilities

The following are implemented and running in the live system but not otherwise called out above:

| Capability | Where | Purpose |
|---|---|---|
| SSE live-stream endpoint | `GET /api/stream` | Pushes live Alpaca bars to the frontend without polling |
| Volatility targeting | `alpha_flow/analysis/` (Moreira & Muir 2017) | Scales position sizing to a target volatility rather than fixed notional |
| Feature winsorization | feature pipeline | Clips extreme outlier feature values before model input (Grinold & Kahn 2000) |
| Dual Groq API key rotation | `backend/main.py` chat/explain handlers | Rotates between two Groq keys to reduce rate-limit failures |
| Stub/synthetic paper-trade fallback | `alpha_flow/execution/` | Returns a synthetic fill when Alpaca paper-trading credentials are absent, so `/api/execute` stays demoable offline |
| In-memory result/correlation caches | `backend/main.py` | Avoids recomputing SHAP/correlation matrices on repeat requests for the same run |
| APScheduler cron config | `backend/main.py` lifespan, `render.yaml` | Nightly weekday data refresh + weekly full pipeline re-run (`SCHEDULER_ENABLED`) |
| LLM chat grounding | `POST /api/chat` | Groq responses are grounded in the live DB signals, not general knowledge |
| Mark-to-market PnL | `GET /api/trades/pnl` | Aggregates realised + unrealised PnL across open paper positions |
| Cross-ticker SHAP endpoint | `GET /api/intraday/shap-dependence` | SHAP dependence plot data for a single feature across tickers |
| Hourly Top-10 table | frontend | Ranked summary view alongside the full Hourly card grid |
| Custom-ticker persistence | `POST /api/tickers/add`, `DELETE /api/tickers/{ticker}` | User-added tickers survive restarts (SQLite-backed, not session-only) |
| Per-fold SHAP | `intraday_engine.py` walk-forward loop | SHAP values computed per walk-forward fold, then aggregated — not a single end-of-sample fit |

---

## 6. Discussion

### 6.1 Why IC > 0 at Hourly but ≈ 0 at Daily

Daily bars aggregate intra-bar buyer/seller initiation, destroying the directional sign information that OFI exploits. At hourly resolution, institutional orders are still being sliced (VWAP/TWAP) over 1–4 bar windows, leaving detectable OFI signatures. This is consistent with Chordia et al. (2002)'s finding that OFI IC is highest at 5-minute horizons and decays to noise at daily resolution.

### 6.2 Hawkes z as Top SHAP Feature

Hawkes z-score consistently ranks #1 in SHAP importance for high-beta tickers (TSLA, NVDA). This confirms Bacry et al. (2015): momentum/high-IV tickers exhibit stronger self-excitation in order arrival — each trade triggers more trades. OFI z-score dominates for stable large-cap names (AAPL, JPM), consistent with classical adverse-selection literature.

### 6.3 Limitations

1. **Data resolution:** OHLCV bars proxy true order flow. NYSE TAQ tick data would yield higher and more reliable IC
2. **Universe breadth:** 50 tickers (expanded from 10). The Fundamental Law's √N still rewards expanding toward 500+ names
3. **Transaction costs:** Portfolio simulation reports both gross and net-of-cost Sharpe (Corwin-Schultz half-spread at monthly rebalance). Per-name TC drag (bps) and net edge are surfaced in the dashboard. The cost model is first-order (half-spread only, no market impact or slippage)
4. **Regime dependence:** Pipeline not validated across 2008 crisis or COVID — bull-market overfitting is possible
5. **Position sizing / portfolio risk:** Paper execution uses a flat qty=10 shares per signal regardless of ticker volatility, price level, or account size — there is no vol-scaling (e.g. inverse-vol or risk-parity sizing), no sector/factor exposure limits, and no max gross/net leverage constraint. This is acceptable for a research/paper-trading demonstration but would need a proper position-sizing and portfolio risk model (e.g. Kelly-fraction or vol-targeting with sector caps) before any live-capital deployment
6. **Survivorship bias:** the 50-ticker universe (`alpha_flow/config/settings.py::TICKERS`) is CURRENT S&P 500 constituents, not point-in-time historical membership — names delisted, merged, or dropped from the index within the 2-year backtest window are excluded by construction (Brown, Goetzmann & Ross 1995). This is not fixed here — doing so requires point-in-time historical index-constituent data, unavailable from this project's free data sources (yfinance/Alpaca). What IS implemented: `check_universe_survivorship()` (`alpha_flow/data/data_feed.py`, exposed via `GET /api/universe/metadata`) programmatically detects the adjacent, measurable symptom — a ticker whose cached price history starts meaningfully later than the rest of the universe (e.g. a recent IPO) — turning the disclosure from prose alone into a runtime, testable check (3 unit tests, `tests/test_microstructure.py`). It cannot detect names absent from the universe entirely; that residual bias remains and should be disclosed to any reader of the backtest results

### 6.4 Engineering Hardening (this revision)

A self-audit of the system above (beyond the modelling results themselves) closed several correctness/rigor gaps:

- Fixed a field-name mismatch that left the Daily dashboard's "Key Driver" column blank; wired Hourly's per-ticker IC to the walk-forward engine's real fold-level output (previously an orphaned LangGraph node left it empty)
- Added the embargo/purge gap described in §3.3, closing a doc-vs-code gap — the López de Prado citation existed in this document before the code enforced it
- Hardened Kyle's Lambda: rolling OFI variance below a minimum-signal threshold now marks λ as excluded/NaN rather than letting the variance floor blow up the ratio
- Disclosed the EWM smoothing (halflife=5 bars) applied on top of the base Corwin-Schultz (2012) spread estimator
- Added the Standard Error of the Mean (`ic_sem`, `sharpe_sem`, `hit_rate_sem`) alongside every walk-forward point estimate, wired end-to-end from `intraday_engine.py` through SQLite to the dashboard, with a reference-value unit test
- Added BUY/HOLD/SELL/ALL signal-filter pills to the Daily grid, Hourly table, and Hourly grid, plus a mobile-responsive layout pass (`useIsMobile` breakpoint hook, auto-fit/minmax card grids)

## 7. Reproducibility

Every quantitative claim in this paper can be verified by running the
reproducible research notebook: `notebooks/reproduce.ipynb`. It reproduces
the IC table, rank fraction sensitivity, two-tier classification, BH-FDR
worked example, portfolio simulation, and daily OFI cross-section from raw
data in a single top-to-bottom execution (~10 min on a laptop).

## 8. Future Work

| Extension | IC Impact | Cost | Status |
|-----------|-----------|------|--------|
| Alpaca SIP (full-market OHLCV bars) | 1.4% → 2-3% | ~$200/mo | Planned |
| Tick data (Polygon/Databento) + real Lee-Ready OFI | 1.4% → 4-8% | ~$100-300/mo | Planned |
| Risk-parity / mean-variance position sizing | Better risk-adjusted returns | $0 | Planned |
| Survivorship-free universe (point-in-time constituents) | Remove look-ahead bias | $0 | Planned |
| 500-stock universe | ↑ breadth (Fundamental Law √N) | $0 | Planned |

The single highest-ROI upgrade is tick-level data: replacing the bar-level OFI
proxy (`buy_vol = volume.where(close >= open, 0)`) with real Lee-Ready trade
classification would unlock the IC range Chordia et al. (2002) measured on TAQ
data. See [docs/ROADMAP.md](docs/ROADMAP.md) for the full phased plan with code
change specifications.

---

## References

1. **Almgren, R. & Chriss, N.** (2001). Optimal Execution of Portfolio Transactions. *Journal of Risk*, 3(2), 5–39.
2. **Amihud, Y.** (2002). Illiquidity and stock returns. *Journal of Financial Markets*, 5(1), 31–56. https://doi.org/10.1016/S1386-4181(01)00024-6
3. **Bacry, E., Mastromatteo, I. & Muzy, J.F.** (2015). Hawkes Processes in Finance. *Market Microstructure and Liquidity*, 1(01). https://arxiv.org/abs/1502.04592
4. **Brown, S.J., Goetzmann, W.N. & Ross, S.A.** (1995). Survival. *Journal of Finance*, 50(3), 853–873.
5. **Chordia, T., Roll, R. & Subrahmanyam, A.** (2002). Order imbalance, liquidity, and market returns. *Journal of Financial Economics*, 65(1), 111–130.
6. **Cont, R.** (2001). Empirical properties of asset returns. *Quantitative Finance*, 1(2), 223–236.
7. **Cont, R., Cucuringu, M. & Zhang, C.** (2023). Cross-impact of order flow imbalance in equity markets. *Quantitative Finance*. https://arxiv.org/abs/2301.00780
8. **Corwin, S.A. & Schultz, P.** (2012). A Simple Way to Estimate Bid-Ask Spreads from Daily High and Low Prices. *Journal of Finance*, 67(2), 719–759.
9. **Easley, D., López de Prado, M. & O'Hara, M.** (2012). Flow Toxicity and Liquidity in a High-Frequency World. *Review of Financial Studies*, 25(5), 1457–1493. https://doi.org/10.1093/rfs/hhs053
10. **Efron, B. & Hastie, T.** (2016). *Computer Age Statistical Inference*. Cambridge University Press.
11. **Grinold, R.C. & Kahn, R.N.** (2000). *Active Portfolio Management* (2nd ed.), Ch.6. McGraw-Hill.
12. **Harvey, C.R., Liu, Y. & Zhu, H.** (2016). … and the Cross-Section of Expected Returns. *Review of Financial Studies*, 29(1), 5–68.
13. **Jegadeesh, N. & Titman, S.** (1993). Returns to Buying Winners and Selling Losers. *Journal of Finance*, 48(1), 65–91.
14. **Karpoff, J.M.** (1987). The Relation Between Price Changes and Trading Volume. *Journal of Financial and Quantitative Analysis*, 22(1), 109–126.
15. **Keating, C. & Shadwick, W.F.** (2002). A Universal Performance Measure. *Journal of Performance Measurement*, 6(3), 59–84.
16. **Kyle, A.S.** (1985). Continuous Auctions and Insider Trading. *Econometrica*, 53(6), 1315–1335.
17. **Lee, C.M.C. & Ready, M.J.** (1991). Inferring Trade Direction from Intraday Data. *Journal of Finance*, 46(2), 733–746.
18. **Lo, A.W. & MacKinlay, A.C.** (1988). Stock Market Prices Do Not Follow Random Walks. *Review of Financial Studies*, 1(1), 41–66.
19. **López de Prado, M.** (2018). *Advances in Financial Machine Learning*. Wiley.
20. **Lundberg, S. & Lee, S.I.** (2017). A Unified Approach to Interpreting Model Predictions. *NeurIPS 2017*. https://arxiv.org/abs/1705.07874
21. **Young, T.W.** (1991). Calmar Ratio: A Smoother Tool. *Futures Magazine*, Oct.

---

*111 tests passing · TypeScript build clean · GitHub Actions CI/CD · Deployed on Render.com*

