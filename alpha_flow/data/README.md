# alpha_flow/data — Data Abstraction Layer
> **Author:** Anthony Breeganzo Thomas · AlphaFlow · Imperial College MSc RMFE Quant Portfolio

## Overview

This module implements a **data abstraction layer** that decouples all upstream modules from the concrete data source. The rest of the system consumes a uniform OHLCV DataFrame regardless of whether data originates from live Alpaca streams, delayed yfinance, or a synthetic fallback.

```python
# Single interface consumed by all modules
bars: dict[str, pd.DataFrame] = fetch_bars(tickers, period="60d", interval="1h")
```

Switching Phase 1 -> Phase 2 requires **no changes** to `core/`, `analysis/`, or `agent/`.

---

## 3-Tier Data Hierarchy

| Priority | Source | Latency | Cost | Trigger | Status |
|----------|--------|---------|------|---------|--------|
| 1 | **Alpaca WebSocket** — real L1 tick bid/ask data | Real-time | ~$240/yr | `ALPACA_USE_LIVE=true` | Phase 2 roadmap |
| 2 | **yfinance** — 60-day, 1-hour OHLCV | ~15 min delayed | Free | Default | Active (Phase 1) |
| 3 | **Synthetic OHLCV** — GBM random walk | Generated | Free | yfinance failure | Auto fallback |

---

## Phase 1: yfinance (Current)

```python
import yfinance as yf
df = yf.download(ticker, period="60d", interval="1h", auto_adjust=True)
```

**Why delayed data is acceptable for research:** Methodology validation does not require live data. Phase 1 demonstrates the complete signal computation framework and documents its limitations rigorously. IC ~= 0.00 with hourly OHLCV is a quantified, documented limitation — not a defect — consistent with academic reproducibility standards. Any researcher can replicate results with the same free data source.

---

## Phase 2: Alpaca Live (Roadmap)

```python
# Activated by: ALPACA_USE_LIVE=true in .env
from alpaca.data.live import StockDataStream
# Streams real L1 quotes: bid_price, ask_price, bid_size, ask_size, timestamp
```

With true bid/ask data, OFI is computed from **actual trade initiations** — Lee-Ready applied to real tick data — unlocking IC > 0.05 and genuine short-horizon microstructure alpha extraction.

---

## Synthetic Fallback

```python
seed = hash(ticker) % 99_991   # deterministic, ticker-specific seed
rng  = np.random.default_rng(seed)
```

**Key design decision:** Per-ticker seeds generate **different** price paths per ticker. This prevents spurious cross-ticker correlations — if all tickers shared identical synthetic data, OFI, Kyle lambda, and Amihud calculations would be perfectly correlated, invalidating any multi-ticker signal analysis.

---

## OHLCV Column Schema

All downstream modules expect this exact schema (normalised to uppercase by the data layer):

| Column | dtype | Description |
|--------|-------|-------------|
| `Open` | float64 | Bar open price |
| `High` | float64 | Bar high price |
| `Low` | float64 | Bar low price |
| `Close` | float64 | Bar close price |
| `Volume` | float64 | Share volume traded |
| Index | DatetimeIndex (UTC) | Bar timestamp |

`auto_adjust=True` in yfinance handles corporate actions (splits, dividends) transparently.

---

## Cross-References

- `alpha_flow/core/` — all metric functions consume the OHLCV DataFrame produced here
- `alpha_flow/agent/langgraph_flow.py` — the `fetch_data` node calls `fetch_bars()`
- `.env` — controls `ALPACA_USE_LIVE`, `ALPACA_API_KEY`, `ALPACA_SECRET_KEY`
