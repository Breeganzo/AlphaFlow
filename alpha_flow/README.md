# alpha_flow/
> **Author:** Anthony Breeganzo Thomas · AlphaFlow · Imperial College MSc RMFE Quant Portfolio

This is the main Python package for AlphaFlow. Everything the pipeline does lives here. It is organised into sub-modules that each have one clear job.

## Module map

```
alpha_flow/
├── agent/          Orchestrates the full pipeline using LangGraph
├── analysis/       Backtesting, chart generation, LightGBM model training
├── config/         Settings and API key loading
├── core/           Raw microstructure signal computation (the maths)
├── data/           Data loading from Alpaca / yfinance
├── execution/      Phase 2 placeholder — Alpaca order submission
├── signals/        Turns computed metrics into a BUY/SELL/HOLD decision
└── utils/          Shared performance metrics (Sharpe, Sortino, IC, etc.)
```

## How the modules connect

```
data/ ──→ core/ ──→ signals/ ──→ execution/   (signal pipeline)
            │
            └──→ analysis/ ──→ outputs/       (backtest + charts)
                     │
                agent/ ──→ LangGraph DAG      (orchestration + LLM)
```

1. **data/** fetches OHLCV bars (real or synthetic)
2. **core/** computes OFI, Amihud, Kyle's λ, Corwin-Schultz spread
3. **signals/** combines those metrics into a signal card per ticker
4. **analysis/** runs a walk-forward backtest and generates PNG charts
5. **agent/** ties everything together into a single callable pipeline

## Why `__init__.py` files?

Every sub-folder has an `__init__.py`. This tells Python to treat that folder as a package, allowing imports like `from alpha_flow.core.ofi_calculator import compute_ofi`. Most `__init__.py` files here are intentionally empty — their presence is all that is required.

The exception is `execution/__init__.py`, which contains a stub `submit_order()` function marking it as Phase 2 work.
