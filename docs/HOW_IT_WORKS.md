# AlphaFlow — How It Works (Learn the System)

A plain-English walkthrough of what AlphaFlow is, why each piece exists, and
how data flows from raw market prices to a trade you can see in the dashboard.
Read this top-to-bottom to understand the whole system.

---

## 1. What is AlphaFlow?

AlphaFlow is a **quantitative trading research system**. It answers one question:

> *"Using only free market data, can we find small, statistically-real edges in
> how stocks trade — and act on them with paper (fake-money) trades?"*

It does this the way a real quant desk would:

1. **Compute microstructure signals** — math on order flow and liquidity (not
   just "price went up"). These come from peer-reviewed academic papers.
2. **Validate them with machine learning** — walk-forward testing that never
   lets the model peek at the future (the #1 mistake in amateur backtests).
3. **Rank stocks into a long/short book** — buy the strongest, short the weakest.
4. **Execute paper trades** — submit real orders to Alpaca's paper account,
   then automatically manage exits (stop-loss / take-profit / signal-flip).
5. **Explain everything in English** — a Groq LLM writes narratives, but it
   **never decides a trade**. Every BUY/SELL is 100% deterministic and auditable.

The honesty principle: the numbers are **real and modest** (~1.4% average IC on
free data), not impressive-but-fake. A quant reviewer trusts a real 1.4% over a
fabricated 7%.

---

## 2. The Big Picture (data flow)

```
┌──────────────┐   OHLCV bars    ┌─────────────────────┐   signals   ┌──────────────┐
│ Data Sources │ ──────────────► │  Microstructure +   │ ──────────► │   Postgres   │
│ yfinance     │                 │  ML Engine          │             │  (or SQLite) │
│ Alpaca IEX   │                 │  (alpha_flow/)      │             │              │
└──────────────┘                 └─────────────────────┘             └──────┬───────┘
                                           │                                 │
                                           │ paper orders                    │ REST reads
                                           ▼                                 ▼
                                  ┌─────────────────┐              ┌──────────────────┐
                                  │  Alpaca Paper   │              │ FastAPI backend  │
                                  │  Trading API    │◄─────────────│ (backend/main.py)│
                                  └─────────────────┘   close/open └────────┬─────────┘
                                                                            │ JSON
                                                                            ▼
                                                                   ┌──────────────────┐
                                                                   │  React dashboard │
                                                                   │ (frontend/App.tsx)│
                                                                   └──────────────────┘
```

**The one rule that keeps it clean:** the frontend *only* talks to the backend
over REST (HTTP/JSON). It never touches the database. That's why we could swap
SQLite → Postgres without changing a single line of frontend code.

---

## 3. The Signal Engine (the "alpha")

This is the heart of the system — `alpha_flow/core/` and `alpha_flow/analysis/`.

### Microstructure features (the raw ingredients)
Each measures a different aspect of *how* a stock trades, not just its price:

| Feature | What it captures | Paper |
|---------|------------------|-------|
| **OFI** (Order Flow Imbalance) | Net buy vs sell pressure | Chordia et al. 2002 |
| **Kyle's λ** | Price impact per dollar traded (illiquidity) | Kyle 1985 |
| **Amihud ILLIQ** | Return moved per dollar of volume | Amihud 2002 |
| **Corwin-Schultz spread** | Effective bid-ask spread from high/low | Corwin & Schultz 2012 |
| **VPIN** | Order-flow toxicity (informed trading) | Easley et al. 2012 |

### Two-tier signal classification
`analysis/signal_classification.py` turns features into BUY/SELL/HOLD:

- **Tier 1 (the tradeable book):** rank all stocks by their directional signal,
  then build an **adaptive** long/short book (`adaptive_rank_sets`). A name only
  trades if it is **both** (a) in the top/bottom fraction **and** (b) at least
  `SIGNAL_CROSS_Z_MIN` cross-sectional std-devs from the mean — so the book
  *shrinks when signals are weak* rather than mechanically trading a fixed
  10-long/10-short every run. It is then confirmed only if the model's skill for
  that name is non-negative (`mean_ic ≥ 0`) — we don't act on names the model is
  anti-predictive for. Both Daily and Hourly share this exact logic.
- **Tier 2 (conviction flag):** a Benjamini-Hochberg FDR test flags which names
  are statistically strong. This is an **annotation only** — it does NOT gate
  trades. (An earlier version *gated* on FDR and everything became HOLD, because
  no single name clears significance after correcting for 50 tests on free data.
  Gating is the right answer to "is THIS one name real?" but the wrong
  construction for a long/short book that monetises the rank spread.)

> **Why not just gate on FDR?** Because IC measures *skill*, not direction, and
> on free bar-proxy data no single name is individually significant. A
> cross-sectional book earns from the top decile beating the bottom decile *on
> average* — a real, testable effect even when no one name is significant. The
> honest reporting lives in Tier 2 and in the Deflated Sharpe Ratio (below).

### Machine learning validation
`analysis/intraday_engine.py` runs an **hourly LightGBM walk-forward**: train on
past bars, test on the *next* unseen bars, slide the window forward (~20-27 folds
per ticker), with an embargo/purge gap so no future data leaks into training.
Output: Information Coefficient (IC = correlation of prediction vs actual),
Sharpe, Sortino, and SHAP feature attribution (which features drove each call).

### Statistical rigor — "is the Sharpe real?"
A high Sharpe on a short, fat-tailed track record — or the best of many
configurations you tried — is often luck. Two metrics (`analysis/performance.py`)
make this honest, reported on the portfolio panel:

- **Probabilistic Sharpe Ratio (PSR):** probability the *true* Sharpe > 0 given
  the sample length, skew, and kurtosis (Bailey & López de Prado 2012).
- **Deflated Sharpe Ratio (DSR):** PSR after penalising the multiple testing
  (all the tickers/configs screened). This is the number a quant trusts — it
  asks "is this the luckiest of N tries?"

### Math depth — optimal execution & self-excitation
- **Almgren-Chriss (`core/almgren_chriss.py`):** closed-form optimal trade
  schedule balancing market-impact cost vs timing risk — the stochastic-control
  result behind the execution layer (front-load when risk-averse, TWAP when
  risk-neutral).
- **Hawkes branching ratio η = α/β (`core/hawkes.py`):** how self-exciting order
  flow is. η → 1 means near-critical, reflexive markets (feedback-loop prone).
  Turns the raw Hawkes fit into a regime diagnostic.

---

## 4. Paper Trading & Position Management

This is where signals become (fake-money) trades. Two endpoints do the work:

### Opening a position — `POST /api/execute`
1. Read the latest hourly signal cards from the DB.
2. For each BUY/SELL (HOLD is skipped), call `submit_order()` →
   Alpaca paper API places a market order.
   - BUY → `OrderSide.BUY` (go long)
   - SELL → `OrderSide.SELL` (go short)
3. Compute a **volatility-scaled** stop-loss and take-profit band
   (`compute_stop_take_profit`): wider bands for volatile stocks (TSLA),
   tighter for calm ones (KO). Ratio is 2:1 reward:risk.
4. Save the position to `open_positions` so the exit job can manage it.

### Closing a position — `POST /api/positions/check`
Runs on a schedule. For every open position, `decide_exit()` (a pure,
unit-tested function in `position_manager.py`) checks — in order:

1. **Signal flip:** holding a BUY but the model now says SELL/HOLD? → close.
2. **Stop-loss:** price breached the downside band? → close.
3. **Take-profit:** price hit the upside target? → close.

**How much does it close?** The **entire** position, in one shot — there is no
partial scaling-out or averaging. `close_position(ticker)` flattens the position
to exactly zero (sells all shares of a long, buys back all shares of a short).
A stop-loss, take-profit, or signal-flip is always a **complete exit** of that
name's 10-share position, never a trim.

**When is the stop actually checked?** This is a **polled** stop, not a native
exchange stop order: the `/api/positions/check` cron fetches the latest price
every 10 minutes and closes if the band is breached. It is correct and works,
but it only acts at the polling cadence and only while the backend + cron are
alive — a fast intra-interval move can overshoot the stop before the next check.
For real-money use you would attach a **native bracket/stop order** to Alpaca at
entry so the exchange enforces the stop continuously; for a paper research
system the polled stop is an accepted, simpler design (documented limitation).

If any triggers, it calls `close_position()` which uses Alpaca's **native
close-position API** — NOT a naive opposite-side order. This matters:

> A naive "sell to close a long" that's the same size is fine, but if you're
> not careful an opposite order can *open a new short* instead of flattening.
> Alpaca's `close_position(ticker)` always flattens to exactly zero — correct
> for both closing a long (sells shares) and closing a short (buys to cover).

**So yes — buy, sell, short, and close all work correctly**, and the same
position is always closed rather than accidentally reversed.

---

## 5. Scheduling (how it runs unattended)

Signals need to fire on a schedule even when nobody's watching. The challenge:
Render's free tier **sleeps the backend after 15 minutes idle**, which kills any
in-process scheduler.

**Solution — GitHub Actions cron** (`.github/workflows/scheduled-signals.yml`):
- Runs on GitHub's servers (free, unlimited minutes on public repos).
- Sends HTTP requests to the backend's existing endpoints. The incoming request
  *wakes* the sleeping Render backend (~1 min cold start), then triggers the job.
- Reuses the exact same business logic as the manual buttons — zero duplicate code.

| Job | Schedule (ET) | Endpoint |
|-----|---------------|----------|
| Daily signals | 9:35 AM weekdays | `POST /api/run` |
| Hourly signals | 10:35 AM – 4:35 PM weekdays | `POST /api/intraday/run` |
| Position check | every 10 min, market hours | `POST /api/positions/check` |
| Data refresh | 9:30 PM weekdays | `POST /api/data/refresh` |

**Keepalive** (`keepalive.yml`): GitHub disables cron workflows after 60 days
with no commits. A weekly job commits a timestamp to keep them alive forever.

For **local development**, the old in-process APScheduler still works — set
`SCHEDULER_ENABLED=true` in `.env`. It's kept as a convenience but disabled in prod.

---

## 6. The Database (dual-mode)

`backend/database.py` speaks to **either Postgres or SQLite**, decided at startup
by whether `DATABASE_URL` is set:

- **`DATABASE_URL` set** → Postgres (Neon free tier, for production). Uses a
  connection pool + `RETURNING id` + `%s` placeholders.
- **`DATABASE_URL` unset** → SQLite (`data/app.db`, for local dev & tests). Uses
  `lastrowid` + `?` placeholders.

A thin abstraction (`_ph()` for placeholders, `_insert_returning_id()` for new
IDs) hides the dialect difference so every query function is written once. This
is why `pytest` runs identically against both backends in CI.

Seven tables: `run_history`, `microstructure_signals`, `intraday_signals`,
`shap_importance`, `paper_trades`, `open_positions`, `alpha_decay`.

---

## 7. Why these technology choices? (the "industry standard" bit)

| Choice | Why it's the right call |
|--------|------------------------|
| **REST-only frontend/backend split** | Standard 3-tier architecture. The DB migration touched zero frontend code — proof the boundary is clean. |
| **Raw SQL + thin dialect layer** (not a heavy ORM) | For 7 tables and well-tested queries, an ORM adds ceremony without benefit. Raw SQL is auditable — a quant reviewer can read exactly what hits the DB. |
| **psycopg2 (sync), not asyncpg** | The DB functions are synchronous and run inside thread pools. Making them async would cascade `await` through the whole codebase for no gain. |
| **GitHub Actions cron over paid schedulers** | Free, versioned in the repo, and reuses the API layer. The tradeoff (best-effort timing) is fine because signals use prior-bar closes, not real-time ticks. |
| **Neon over Supabase/Oracle** | Transparent scale-to-zero (no keep-alive hack), no 30-day expiry, no self-hosting risk. |
| **LLM kept out of the decision path** | Regulatory-credible. Signals are deterministic and reproducible; the LLM only writes prose. |

---

## 8. Where to look in the code

| You want to understand... | Read this file |
|---------------------------|----------------|
| How a signal is computed | `alpha_flow/core/*.py`, `analysis/signal_classification.py` |
| How ML validation works | `alpha_flow/analysis/intraday_engine.py` |
| How exits are decided | `alpha_flow/execution/position_manager.py` |
| How orders are placed | `alpha_flow/execution/__init__.py` |
| All API endpoints | `backend/main.py` |
| Database queries | `backend/database.py` |
| The dashboard UI | `frontend/src/App.tsx` |
| How to deploy | [DEPLOYMENT.md](DEPLOYMENT.md) |
| The research writeup | [../RESEARCH.md](../RESEARCH.md) |

---

## 9. Try it yourself (2 minutes)

```bash
# backend (SQLite, no external DB needed)
pip install -r requirements.txt
cp .env.example .env          # add your free Groq + Alpaca keys
uvicorn backend.main:app --reload --port 8002

# frontend (second terminal)
cd frontend && npm install && npm run dev   # http://localhost:3002
```

Open the dashboard, click **Run Signal Engine** (Hourly tab), then **Execute**
to place paper trades. Watch positions appear, and the position-check logic
close them when a stop/target/flip triggers.
