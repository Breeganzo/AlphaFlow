# alpha_flow/signals/
> **Author:** Anthony Breeganzo Thomas · AlphaFlow · Imperial College MSc RMFE Quant Portfolio

This folder is the final decision layer of the AlphaFlow pipeline. It takes the computed microstructure metrics and the LightGBM model score and produces a structured **signal card** for each ticker: a single BUY, SELL, or HOLD recommendation with all supporting metrics attached.

## File

| File | Purpose |
|------|---------|
| `signal_generator.py` | Generates and prints the signal card per ticker |

## What a signal card looks like

```json
{
  "ticker": "AAPL",
  "signal": "BUY",
  "confidence": 0.72,
  "ofi_zscore": 1.84,
  "amihud_illiq": 0.000031,
  "kyle_lambda": 0.00019,
  "eff_spread_bps": 14.2,
  "tick_sign": 1,
  "model_score": 0.68,
  "recorded_at": "2026-06-27T10:30:00"
}
```

## How the signal is decided

1. Compute the latest OFI Z-score, Amihud, Kyle's λ, and spread from the most recent bars
2. Run the LightGBM model on the current feature snapshot → get a `model_score` (0 to 1)
3. If `model_score > 0.55` → **BUY** (model predicts up-move with some confidence)
4. If `model_score < 0.45` → **SELL**
5. Otherwise → **HOLD** (model is uncertain)

Confidence is the distance of the model score from 0.5, scaled to [0, 1].

## Where the signal goes

- Stored in the SQLite database (`data/app.db`) in the `microstructure_signals` table
- Served by the backend via `/api/signals`
- Displayed in the frontend "Latest Signal" section
- In Phase 2, passed to `execution/submit_order()` to place the actual trade

## Difference from `core/`

`core/` computes the raw metrics mathematically. `signals/` calls `core/` and then makes the final trading decision. One is pure maths; the other is the business logic layer.
