"""alpha_flow.analysis — Walk-forward backtesting and intraday signal modelling.

Modules:
    intraday_engine     : Hourly — LGBMRegressor walk-forward on hourly bars,
                          SHAP attribution, Hawkes + VWAP + VolClock features.
    backtest            : Daily — Long-short portfolio simulation from daily signals.
    performance         : Portfolio-level Sharpe, Sortino, Max Drawdown, IC.
    lightgbm_trainer    : Walk-forward LightGBM cross-validation wrapper.
    figures             : Matplotlib chart generation for the research report.

Note: LightGBM and SHAP are imported at module-level inside these sub-modules.
Do not import alpha_flow.analysis in lightweight contexts (e.g. lambda handlers)
where these heavy dependencies are unavailable.
"""
