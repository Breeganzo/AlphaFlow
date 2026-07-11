"""
config/settings.py
AlphaFlow — Quantitative Signal Infrastructure configuration.
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
ALPACA_BASE_URL   = os.getenv("ALPACA_BASE_URL", "https://paper-api.alpaca.markets/v2")

# Universe: 50 liquid S&P 500 large-caps — full sector coverage for cross-sectional L/S
TICKERS = [
    # Technology — semis, megacap internet, enterprise software
    "AAPL", "MSFT", "NVDA", "META", "GOOGL", "AMZN", "AVGO", "ORCL", "AMD", "INTC", "TSM",
    # Financials — money-centre banks, asset managers, card networks
    "JPM", "BAC", "V", "GS", "WFC", "MS", "BLK", "C", "AXP", "MA",
    # Healthcare — pharma, managed care, medtech, PBM
    "JNJ", "UNH", "LLY", "PFE", "ABBV", "MRK", "TMO",
    # Consumer Discretionary
    "TSLA", "HD", "MCD", "NKE", "SBUX",
    # Consumer Staples
    "KO", "PEP", "WMT", "COST",
    # Energy
    "XOM", "CVX", "COP", "EOG",
    # Industrials
    "CAT", "HON", "BA", "RTX", "GE",
    # Communication Services
    "DIS", "T", "VZ", "NFLX",
]

# Microstructure parameters
OFI_WINDOW        = 20       # Order flow imbalance rolling window (bars)
AMIHUD_WINDOW     = 21       # Amihud illiquidity rolling window (trading days)
SPREAD_SMOOTH     = 5        # EWM halflife for bid-ask spread smoothing
LGBM_N_ESTIMATORS = 300
LGBM_LEARNING_RATE = 0.05

LLM_MODEL         = "llama-3.3-70b-versatile"
GROQ_CALL_DELAY   = 2.2       # seconds between per-ticker Groq calls (Daily llm_interpret) —
                              # keeps request rate under the free-tier 30 RPM limit

# ── Signal classification (shared by Daily + Hourly cross-sectional gates) ───
# Two-stage design — RANK (relative to today's cross-section, regime-stable)
# then GATE (absolute quality control). See _determine_signals_crosssectional
# (agent/langgraph_flow.py) and _build_intraday_cards (backend/main.py).
# Supersedes the old single absolute |z|>1.5 threshold (removed): a fixed
# threshold's "extreme" bar doesn't adapt to the current volatility regime, so
# it could fire on 0 tickers some days and 30 on others; ranking is always
# relative to today's actual cross-section, and the gate stops a pure
# percentile split from ever mislabelling the "least-bad-of-the-pack" as a
# real signal.
SIGNAL_RANK_FRACTION      = 0.20   # quintile sort (Fama-French 1993 standard): top/bottom 20% = 10L/10S/30H
                                    # for N=50. Deciles (10%) would give only 5 per leg — too concentrated;
                                    # terciles (33%) too diluted. See notebooks/reproduce.ipynb §4 for sensitivity.
SIGNAL_SIGNIFICANCE_ALPHA = 0.10   # BH-FDR target Q — accept ≤10% expected false-discovery rate across the
                                    # cross-section. Conservative for 50 tests: best p needs ≤ (1/50)×0.10 = 0.002.
SIGNAL_ABS_IC_THRESHOLD   = 0.05   # |IC| this large makes a ticker a BUY/SELL *candidate* even outside
                                    # the rank cutoff (used by Hourly path only when abs_threshold != inf)

# ── Walk-forward parameters (production-grade for 2yr hourly data) ───────────
# 1-year rolling train window: industry standard for microstructure signals
# 1-month test window: matches standard systematic monthly rebalancing frequency
# With 3,276 hourly bars (AAPL, 2yr): floor((3276-1260-105)/105) ≈ 23 monthly folds
WF_TRAIN_WINDOW       = 252         # daily bars per train fold (1 year = 1,260 hourly)
WF_TEST_WINDOW        = 21          # daily bars per test fold (1 month = 105 hourly)
WF_HORIZON            = 1            # bars-ahead prediction target

# ── Intraday parameters ───────────────────────────────────────────────────────
INTRADAY_RESOLUTION   = "1h"         # primary intraday bar size (yfinance)
VWAP_WINDOW           = 20           # bars for VWAP z-score rolling window
HAWKES_DECAY          = 0.3          # β: initial Hawkes decay parameter
HAWKES_EXCITEMENT     = 0.5          # α: initial Hawkes excitement parameter
VOLUME_CLOCK_N        = 1_000_000    # dollar threshold per volume bar ($1M)
ALPACA_DATA_FEED      = "iex"        # IEX free tier (2-5% US market volume, OHLCV bars only).
                                      # Upgrade path: "sip" ($200/mo) = 100% market OHLCV bars.
                                      # For tick-level data (real Lee-Ready OFI), see docs/ROADMAP.md Phase 5.

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
