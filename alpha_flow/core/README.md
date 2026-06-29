# alpha_flow/core — Market Microstructure Signal Engine
> **Author:** Anthony Breeganzo Thomas · AlphaFlow · Imperial College MSc RMFE Quant Portfolio

## Overview

This module computes five academically grounded microstructure metrics from OHLCV bar data. Microstructure signals quantify **information asymmetry** and **inventory pressure** within intraday bars — providing alpha that is orthogonal to conventional daily factors (momentum, value) and that decays within hours rather than months.

---

## Signals

### 1. Order Flow Imbalance (OFI)

**OHLCV proxy formula:**
```
V_buy  = Volume × (Close − Low)  / (High − Low)
V_sell = Volume × (High − Close) / (High − Low)
OFI    = V_buy − V_sell
OFI_z  = (OFI − μ_rolling) / σ_rolling     [20-bar window]
```

Sustained positive OFI → net buyer pressure → upward price drift in subsequent bars.

**Reference:** Cont, Cucuringu & Zhang (2023). *Cross-impact of order flow imbalance in equity markets.* Quantitative Finance, 23(10), 1373–1393.

> **Phase 1 limitation:** OHLCV-based OFI is a bar-level proxy for net order flow. True OFI requires tick-by-tick L2 order book data (queue-level bid/ask changes per trade). Expected IC with hourly OHLCV: ≈ 0.00. Expected IC with real tick data (Phase 2): > 0.05.

---

### 2. Kyle's Lambda (λ)

**Price impact model:**
```
Δp_t = λ · x_t + ε_t
```
where `Δp_t = Close_t − Close_{t−1}` and `x_t` is net order flow (OFI proxy).  
Estimated via rolling OLS over a 20-bar window. Higher λ → greater price impact per unit order flow → less liquid market. Units: dollars per share per unit of net order flow.

**Reference:** Kyle, A.S. (1985). Continuous auctions and insider trading. *Econometrica*, 53(6), 1315–1335.

---

### 3. Amihud Illiquidity Ratio

**Formula:**
```
ILLIQ_t = |r_t| / V_t
```
where `r_t` is bar return and `V_t` is dollar volume. Measures price movement per dollar traded.  
Liquid large-caps (S&P 500): ILLIQ < 1×10⁻⁷. Values above this indicate thin or stressed markets.

**Reference:** Amihud, Y. (2002). Illiquidity and stock returns. *Journal of Financial Markets*, 5(1), 31–56.

---

### 4. Corwin-Schultz Spread

Log high/low ratio estimator of the effective bid-ask spread across adjacent bars:
```
β = [ln(H_t/L_t)]²  +  [ln(H_{t+1}/L_{t+1})]²
γ = [ln(max(H_t, H_{t+1}) / min(L_t, L_{t+1}))]²
α = (√(2β) − √β) / (3 − 2√2) − √(γ / (3 − 2√2))
Spread ≈ 2(eᵅ − 1) / (1 + eᵅ)     [output in basis points]
```

**Reference:** Corwin, S.A. & Schultz, P. (2012). A simple way to estimate bid-ask spreads from daily high and low prices. *Journal of Finance*, 67(2), 719–760.

---

### 5. Lee-Ready Tick Sign

**Rule:**
```
tick_sign_t = +1            if Close_t > Close_{t−1}   (buyer-initiated)
            = −1            if Close_t < Close_{t−1}   (seller-initiated)
            = tick_sign_{t−1}                          (uptick rule on ties)
```

**Reference:** Lee, C.M.C. & Ready, M.J. (1991). Inferring trade direction from intraday data. *Journal of Finance*, 46(2), 733–746.

---

## File → Metric → Reference

| File | Metric | Reference |
|------|--------|-----------|
| `ofi_calculator.py` | OFI Z-score | Cont, Cucuringu & Zhang (2023) |
| `amihud.py` | Amihud ILLIQ, Kyle's λ | Amihud (2002); Kyle (1985) |
| `spread_tracker.py` | Corwin-Schultz spread (bps) | Corwin & Schultz (2012) |
| `lee_ready.py` | Tick direction classifier | Lee & Ready (1991) |
| `__init__.py` | Public API exports | — |

---

## Cross-References

- `alpha_flow/data/` — provides OHLCV bars consumed by all functions here
- `alpha_flow/analysis/lightgbm_trainer.py` — consumes OFI_z, λ, ILLIQ, spread, tick_sign as features
- `alpha_flow/agent/signal_agent.py` — receives a per-ticker metric snapshot dict for LLM interpretation
