"""alpha_flow — Market Microstructure Alpha Signal Engine.

A production-grade quantitative research system implementing five academic papers:
  Kyle (1985) · Amihud (2002) · Chordia et al. (2002) ·
  Corwin-Schultz (2012) · Grinold-Kahn (2000)

Phase 1: Daily OFI Z-score · Kyle λ · Amihud ILLIQ · C-S Spread ·
         LightGBM walk-forward + Groq LLM narrative. (Complete)
Phase 2: Hourly VWAP deviation · Hawkes intensity · Volume-clock imbalance ·
         LGBMRegressor walk-forward + SHAP importance. (Complete)
Phase 3: Alpaca paper-trading execution · cross-ticker alpha decay · conference
         submission. (Planned)

Quick start:
    from alpha_flow.data import get_daily_bars
    from alpha_flow.core import compute_ofi, kyle_lambda
    from alpha_flow.signals.signal_generator import generate_signal_card
"""

__version__ = "2.0.0"
__author__ = "Anthony Breeganzo Thomas"
