"""
config/settings.py
Project 2: Market Microstructure Alpha Engine configuration.
"""
import os
import json
from pathlib import Path
from dotenv import load_dotenv

# Explicitly load from AlphaFlow/.env — works regardless of working directory
_ENV_FILE = Path(__file__).parent.parent.parent / ".env"
load_dotenv(_ENV_FILE)

GROQ_API_KEY      = os.getenv("GROQ_API_KEY", "")
ALPACA_API_KEY    = os.getenv("ALPACA_API_KEY", "")
ALPACA_SECRET_KEY = os.getenv("ALPACA_SECRET_KEY", "")
ALPACA_BASE_URL   = os.getenv("ALPACA_BASE_URL", "https://paper-api.alpaca.markets")

# Universe: liquid large-caps with rich trade-level data
TICKERS = [
    "AAPL", "MSFT", "NVDA", "META", "GOOGL",
    "AMZN", "TSLA", "JPM", "BAC", "V",
]

# Microstructure parameters
OFI_WINDOW        = 20       # Order flow imbalance rolling window (bars)
AMIHUD_WINDOW     = 21       # Amihud illiquidity rolling window (trading days)
SPREAD_SMOOTH     = 5        # EWM halflife for bid-ask spread smoothing
SIGNAL_THRESHOLD  = 1.5      # Z-score threshold for trade signal
LGBM_N_ESTIMATORS = 300
LGBM_LEARNING_RATE = 0.05

LLM_MODEL         = "llama-3.3-70b-versatile"

# ── Phase 2 — Walk-forward parameters (centralised — used by all callers) ──────
WF_TRAIN_WINDOW       = 200          # daily bars per train fold (~9.5 months)
WF_TEST_WINDOW        = 50           # daily bars per test fold (~2.5 months)
WF_HORIZON            = 1            # bars-ahead prediction target

# ── Phase 2 — Intraday parameters ─────────────────────────────────────────────
INTRADAY_RESOLUTION   = "1h"         # primary intraday bar size (yfinance)
VWAP_WINDOW           = 20           # bars for VWAP z-score rolling window
HAWKES_DECAY          = 0.3          # β: initial Hawkes decay parameter
HAWKES_EXCITEMENT     = 0.5          # α: initial Hawkes excitement parameter
VOLUME_CLOCK_N        = 1_000_000    # dollar threshold per volume bar ($1M)
ALPACA_DATA_FEED      = "iex"        # IEX free tier (2-5% US market coverage)

# Custom tickers file — populated by POST /api/tickers/add
_CUSTOM_TICKERS_FILE = Path(__file__).parent.parent.parent / "data" / "custom_tickers.json"


def get_all_tickers() -> list[str]:
    """Return default TICKERS + any custom tickers saved via the UI."""
    if _CUSTOM_TICKERS_FILE.exists():
        try:
            data = json.loads(_CUSTOM_TICKERS_FILE.read_text())
            raw = data.get("tickers", [])
            if raw and isinstance(raw[0], dict):
                custom = [str(e["ticker"]).strip().upper() for e in raw if e.get("ticker")]
            else:
                custom = [str(t).strip().upper() for t in raw if str(t).strip()]
            return list(TICKERS) + [t for t in custom if t not in TICKERS]
        except Exception:
            pass
    return list(TICKERS)
