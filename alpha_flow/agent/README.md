# alpha_flow/agent — LangGraph DAG + Groq LLM Signal Interpreter
> **Author:** Anthony Breeganzo Thomas · AlphaFlow · Imperial College MSc RMFE Quant Portfolio

## Overview

This module implements a **stateful agentic pipeline** using LangGraph — a directed acyclic graph (DAG) framework built on LangChain. Each node is a Python function that receives the current `AgentState` TypedDict and returns updated keys. State flows deterministically from node to node with no cycles.

---

## Pipeline

```
fetch_data -> compute_features -> lgbm_predict -> llm_interpret -> summarise
```

## The 5 Nodes

| Node | Input Keys | Output Keys | Purpose |
|------|-----------|-------------|---------|
| `fetch_data` | `tickers`, `period`, `interval` | `bars` | Downloads OHLCV via data abstraction layer |
| `compute_features` | `bars` | `snapshots` | Runs all 5 core metrics per ticker |
| `lgbm_predict` | `snapshots` | `lgbm_results` | Loads trained LightGBM; returns P(up) per ticker |
| `llm_interpret` | `snapshots`, `lgbm_results` | `llm_signal`, `llm_reason`, `signal_ticker` | Groq LLM generates BUY/SELL/HOLD with rationale |
| `summarise` | all keys | final output dict | Packages signal card; persists to SQLite |

---

## State Schema

```python
class AgentState(TypedDict):
    tickers:        list[str]
    period:         str
    interval:       str
    bars:           dict[str, pd.DataFrame]   # ticker -> OHLCV DataFrame
    snapshots:      dict[str, dict]           # ticker -> {ofi_zscore, kyle_lambda,
                                              #            amihud, cs_spread, tick_sign}
    lgbm_results:   dict[str, float]          # ticker -> P(next bar up)
    llm_signal:     str                       # "BUY" | "SELL" | "HOLD"
    llm_reason:     str                       # plain-English rationale
    signal_ticker:  str                       # ticker with highest |OFI z-score|
```

---

## LLM: Groq llama-3.3-70b-versatile

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Model | `llama-3.3-70b-versatile` | State-of-art open-weight model; optimised on Groq LPU hardware |
| Temperature | 0.2 | Near-deterministic -> reproducible, auditable signal outputs |
| Latency | ~300 tokens/sec | Sub-second inference; viable for near-real-time use |
| Cost | ~$0.001/call | Negligible for research workloads |

### Prompt Structure (`signal_agent.py`)

```text
You are a quantitative analyst. Interpret the following microstructure snapshot:

Ticker: {ticker}
OFI Z-score:            {ofi_zscore:.2f}
Kyle Lambda:            {kyle_lambda:.4e}  ($/share per unit flow)
Amihud ILLIQ:           {amihud:.4e}
Corwin-Schultz Spread:  {cs_spread:.1f} bps
Tick Sign:              {tick_sign}
LightGBM P(up):         {lgbm_prob:.3f}

Output exactly:
SIGNAL: BUY | SELL | HOLD
REASON: [1-2 sentence explanation grounded in the metrics above]
```

Response parsed via: `re.search(r"SIGNAL:\s*(BUY|SELL|HOLD)", response)`.

---

## Academic Justification

The LLM layer does not make the trading decision — the LightGBM probability does. The LLM's role is **interpretability**: converting quantitative metrics into auditable language for risk managers and portfolio committees. This mirrors the human-in-the-loop paradigm described by Cartea & Jaimungal (2016), where algorithmic signals require structured justification prior to execution approval.

Hybrid ML + NLP pipelines for financial signal interpretation are an active research area, enabling quantitative rigour alongside stakeholder accessibility.

**Reference:** Cartea, A. & Jaimungal, S. (2016). Incorporating order-flow into optimal execution. *Mathematics and Financial Economics*, 10(3), 339-364.

---

## Cross-References

- `alpha_flow/core/` — produces the `snapshots` dict consumed by `llm_interpret`
- `alpha_flow/analysis/lightgbm_trainer.py` — trains the model loaded by `lgbm_predict`
- `backend/main.py` — calls `run_pipeline()` which invokes this DAG as a background task
