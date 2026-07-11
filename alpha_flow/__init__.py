"""alpha_flow — Market Microstructure Alpha Signal Engine.

A production-grade quantitative research system implementing five academic papers:
  Kyle (1985) · Amihud (2002) · Chordia et al. (2002) ·
  Corwin-Schultz (2012) · Grinold-Kahn (2000)

Daily: OFI Z-score · Kyle λ · Amihud ILLIQ · C-S Spread ·
         LightGBM walk-forward + Groq LLM narrative. (Complete)
Hourly: VWAP deviation · Hawkes intensity · Volume-clock imbalance ·
         LGBMRegressor walk-forward + SHAP importance. (Complete)
Execution: Alpaca paper-trading · cross-ticker alpha decay ·
         APScheduler nightly cron · Render.com deployment. (Complete)

Quick start:
    from alpha_flow.data import get_daily_bars
    from alpha_flow.core import compute_ofi, kyle_lambda
"""

__version__ = "3.0.0"
__author__ = "Anthony Breeganzo Thomas"
