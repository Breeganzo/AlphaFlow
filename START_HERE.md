# START HERE — AlphaFlow (clone → add keys → run)

A quantitative microstructure signal platform: OFI, Kyle's λ, Amihud ILLIQ,
Corwin–Schultz spread → LightGBM alpha ranking → LLM narrative → Alpaca paper
execution, with a React dashboard.

Clean source repo — no secrets, no build artifacts, no data binaries. You supply
your own (free) API keys and the app builds its own data on first run.

## Prerequisites
- Python 3.11+ (tested on 3.13)   |   Node.js 18+ and npm

## 1. Backend
```bash
python -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## 2. API keys (free)
```bash
cp .env.example .env
```
Fill in `.env`:
- `GROQ_API_KEY` — free at https://console.groq.com (LLM narratives)
- `ALPACA_API_KEY` / `ALPACA_SECRET_KEY` — **paper** keys from https://alpaca.markets
- keep `ALPACA_BASE_URL=https://paper-api.alpaca.markets/v2`

Market data (yfinance) needs no key. The dashboard degrades gracefully without keys.

## 3. Run
```bash
uvicorn backend.main:app --reload --port 8002      # terminal 1
cd frontend && npm install && npm run dev          # terminal 2 → http://localhost:3002
```
Click **Run Signal Engine** (~2 min). Switch to **Hourly** for the LightGBM view and the
live Paper Portfolio (equity, today's P&L, open positions).

## Honest note
The Paper Portfolio P&L is **real** mark-to-market on a real Alpaca paper account.
The walk-forward backtest shows **no repeatable edge after costs on daily data** (OFI alpha
is intraday). This is research infrastructure, not a validated money-maker. See `RESEARCH.md`.

## Tests & docs
`pytest -q` · docs in `docs/` (HOW_IT_WORKS, ARCHITECTURE, DEPLOYMENT, ROADMAP) + `RESEARCH.md`.
