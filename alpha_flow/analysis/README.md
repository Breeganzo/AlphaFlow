# alpha_flow/analysis — Backtesting, Model Training & Performance Evaluation
> **Author:** Anthony Breeganzo Thomas · AlphaFlow · Imperial College MSc RMFE Quant Portfolio

## Overview

This module implements walk-forward backtesting, LightGBM model training, and a full suite of quantitative performance metrics. It produces four diagnostic charts and a JSON report consumed by the React dashboard and scholarship documentation.

---

## Walk-Forward Backtesting (`backtest.py`)

Walk-forward (rolling-window) testing trains on a fixed historical window, tests on the immediately following unseen window, then advances — simulating live deployment without lookahead bias.

```
|←─── 120 bars train ───→|←─ 20 test ─→|
                          |←─── 120 bars train ───→|←─ 20 test ─→|
```

A single train/test split leaks future information into early-period training. Walk-forward guarantees every test bar was **unseen at train time**, producing unbiased IC, AUC, and hit-rate estimates across rolling folds.

---

## Performance Metrics (`performance.py`)

### Information Coefficient (IC)

```
IC = Spearman_ρ(predicted_signal_t, r_{t+1})
```

Rank correlation between the model's predicted signal and realised next-bar return. IC ∈ [−1, 1].

| IC | Interpretation |
|----|----------------|
| > 0.05 | Statistically significant — exploitable signal (Grinold & Kahn 2000) |
| 0.02–0.05 | Marginal; requires larger sample or higher-frequency data |
| ≈ 0.00 | No predictive content — **expected in Phase 1** (hourly OHLCV limitation) |

**Reference:** Grinold, R.C. & Kahn, R.N. (2000). *Active Portfolio Management* (2nd ed.). McGraw-Hill.

### AUC (Area Under ROC Curve)

Binary classification quality for predicting return sign (`up` vs `down`).  
AUC = 0.50 → random classifier. **AUC > 0.55 → exploitable directional signal.**

### Hit Rate

```
Hit Rate = N_correct_direction / N_total
```

> 52% is generally profitable net of transaction costs at typical large-cap spread levels.

---

## SHAP Feature Importance

SHAP (SHapley Additive exPlanations) decomposes each LightGBM prediction into per-feature contributions using Shapley values from cooperative game theory:

- **Global importance:** mean |SHAP| across all walk-forward folds ranks features by predictive contribution
- **Local explanation:** per-prediction attribution enables individual signal auditability

Features ranked by expected importance: `ofi_zscore`, `kyle_lambda`, `amihud_illiq`, `cs_spread`, `tick_sign`, `ofi_lag1`, `ofi_lag2`, `volume_zscore`.

---

## Alpha Decay

IC is plotted against forward-return lags 1–10 bars. Rapid decay (IC < 0.05 by lag 3–4) confirms the signal is **microstructure alpha** — exploitable only at short horizons, not a slower factor. Alpha decay analysis is a required diagnostic in academic microstructure papers and distinguishes HFT-style signals from traditional quantitative strategies.

---

## Output Charts (`figures.py`)

| Chart | Filename | Interpretation |
|-------|----------|----------------|
| Cumulative PnL | `pnl_curve.png` | Walk-forward strategy vs buy-and-hold benchmark |
| IC Decay | `alpha_decay.png` | IC at forward lags 1–10 — confirms microstructure signal horizon |
| SHAP Summary | `shap_bar.png` | Feature importance across all walk-forward folds |
| Confusion Matrix | `confusion_matrix.png` | Precision/recall for BUY/SELL/HOLD predictions |

---

## LightGBM Trainer (`lightgbm_trainer.py`)

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Model | `LGBMClassifier` | Gradient boosting handles non-linear feature interactions; robust to fat-tailed financial returns |
| Features | 8 | OFI_z, OFI_lag1, OFI_lag2, Kyle λ, Amihud, C-S spread, tick_sign, volume_z |
| Target | `sign(r_{t+1})` | Binary: 1 = up, 0 = down |
| Train window | 120 bars | Re-fitted at each walk-forward step |
| Test window | 20 bars | Strictly unseen at train time |

---

## Cross-References

- `alpha_flow/core/` — produces the 8 feature columns consumed by the trainer
- `alpha_flow/data/` — provides OHLCV for backtest simulation
- `alpha_flow/agent/langgraph_flow.py` — loads the trained model for live inference
- `outputs/figures/` — receives all 4 charts and the JSON performance report
