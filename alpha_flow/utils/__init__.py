"""alpha_flow.utils — Performance analytics and shared helpers.

Re-exports the full performance metrics library:
    from alpha_flow.utils import sharpe_ratio, sortino_ratio
    from alpha_flow.utils import max_drawdown, information_coefficient
    from alpha_flow.utils import calmar_ratio, var_95, cvar_95

Modules:
    performance_metrics : Annualised Sharpe, Sortino, Max DD, Calmar, IC,
                          VaR 95%, CVaR 95%, Omega ratio, Hit rate, Win/Loss.
"""
from alpha_flow.utils.performance_metrics import (
    annualized_return,
    annualized_volatility,
    sharpe_ratio,
    sortino_ratio,
    max_drawdown,
    calmar_ratio,
    hit_rate,
    win_loss_ratio,
    profit_factor,
    var_95,
    cvar_95,
    omega_ratio,
    information_coefficient,
    information_ratio,
    binary_auc,
    print_summary,
)

__all__ = [
    "annualized_return", "annualized_volatility",
    "sharpe_ratio", "sortino_ratio",
    "max_drawdown", "calmar_ratio",
    "hit_rate", "win_loss_ratio", "profit_factor",
    "var_95", "cvar_95", "omega_ratio",
    "information_coefficient", "information_ratio",
    "binary_auc", "print_summary",
]
