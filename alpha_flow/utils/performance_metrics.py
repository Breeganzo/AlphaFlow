# COMPONENT TYPE: DETERMINISTIC
# All functions are pure closed-form mathematical computations on return series.
# No learned parameters, no external APIs, no randomness.
# Used as a shared dependency by all 7 projects.
"""
shared/performance_metrics.py
15+ standardised performance metrics shared across all 7 quant projects.

Academic references:
  Sharpe (1966) — mutual fund performance
  Sortino & Price (1994) — downside-risk measures
  Calmar (1991) — futures fund performance
  Spearman (1904) — rank correlation (IC)
"""
import numpy as np
import pandas as pd


# ── Return-based metrics ──────────────────────────────────────────────────────

def annualized_return(returns: pd.Series, periods: int = 252) -> float:
    """Compound annualized return."""
    if len(returns) == 0:
        return 0.0
    total = (1.0 + returns).prod()
    years = len(returns) / periods
    return float(total ** (1.0 / years) - 1.0) if years > 0 else 0.0


def annualized_volatility(returns: pd.Series, periods: int = 252) -> float:
    if len(returns) < 2:
        return 0.0
    return float(returns.std(ddof=1) * np.sqrt(periods))


def sharpe_ratio(returns: pd.Series, risk_free: float = 0.0,
                 periods: int = 252) -> float:
    """Annualised Sharpe ratio (Sharpe 1966)."""
    ann_ret = annualized_return(returns, periods)
    ann_vol = annualized_volatility(returns, periods)
    return (ann_ret - risk_free) / ann_vol if ann_vol > 0 else 0.0


def sortino_ratio(returns: pd.Series, risk_free: float = 0.0,
                  periods: int = 252) -> float:
    """Sortino ratio (Sortino & Price 1994) — penalises downside only."""
    ann_ret = annualized_return(returns, periods)
    downside = returns[returns < 0]
    if len(downside) < 2:
        return 0.0
    downside_vol = float(downside.std(ddof=1) * np.sqrt(periods))
    return (ann_ret - risk_free) / downside_vol if downside_vol > 0 else 0.0


def max_drawdown(equity_curve: pd.Series) -> float:
    """Maximum peak-to-trough drawdown (negative, e.g. -0.15 means -15%)."""
    if len(equity_curve) == 0:
        return 0.0
    peak = equity_curve.cummax()
    dd = (equity_curve - peak) / peak
    return float(dd.min())


def calmar_ratio(returns: pd.Series, periods: int = 252) -> float:
    """Calmar ratio = annualised return / |max drawdown|."""
    ann_ret = annualized_return(returns, periods)
    equity  = (1.0 + returns).cumprod()
    mdd     = abs(max_drawdown(equity))
    return ann_ret / mdd if mdd > 0 else 0.0


def hit_rate(returns: pd.Series) -> float:
    """Fraction of periods with positive return."""
    return float((returns > 0).mean()) if len(returns) > 0 else 0.0


def win_loss_ratio(returns: pd.Series) -> float:
    """Average win / |average loss|."""
    wins   = returns[returns > 0]
    losses = returns[returns < 0]
    if len(losses) == 0 or losses.mean() == 0:
        return float("inf")
    return float(wins.mean() / abs(losses.mean())) if len(wins) > 0 else 0.0


def profit_factor(returns: pd.Series) -> float:
    """Gross profit / gross loss."""
    gross_profit = returns[returns > 0].sum()
    gross_loss   = abs(returns[returns < 0].sum())
    return float(gross_profit / gross_loss) if gross_loss > 0 else float("inf")


def var_95(returns: pd.Series) -> float:
    """95% historical Value at Risk."""
    return float(np.percentile(returns, 5)) if len(returns) > 0 else 0.0


def cvar_95(returns: pd.Series) -> float:
    """95% Conditional VaR (Expected Shortfall)."""
    if len(returns) == 0:
        return 0.0
    v    = var_95(returns)
    tail = returns[returns <= v]
    return float(tail.mean()) if len(tail) > 0 else v


def omega_ratio(returns: pd.Series, threshold: float = 0.0) -> float:
    """Omega ratio: probability-weighted gains / probability-weighted losses."""
    gains  = (returns[returns > threshold] - threshold).sum()
    losses = (threshold - returns[returns <= threshold]).sum()
    return float(gains / losses) if losses > 0 else float("inf")


def recovery_factor(returns: pd.Series, periods: int = 252) -> float:
    """Net annualised return / |max drawdown|."""
    equity = (1.0 + returns).cumprod()
    mdd    = abs(max_drawdown(equity))
    return annualized_return(returns, periods) / mdd if mdd > 0 else 0.0


def average_win(returns: pd.Series) -> float:
    wins = returns[returns > 0]
    return float(wins.mean()) if len(wins) > 0 else 0.0


def average_loss(returns: pd.Series) -> float:
    losses = returns[returns < 0]
    return float(losses.mean()) if len(losses) > 0 else 0.0


# ── Alpha / signal quality metrics ───────────────────────────────────────────

def information_coefficient(predicted: pd.Series, actual: pd.Series) -> float:
    """Spearman rank IC between factor scores and realised returns."""
    from scipy.stats import spearmanr
    common = predicted.dropna().index.intersection(actual.dropna().index)
    if len(common) < 5:
        return 0.0
    ic, _ = spearmanr(predicted.loc[common], actual.loc[common])
    return float(ic) if not np.isnan(ic) else 0.0


def information_ratio(returns: pd.Series, benchmark_returns: pd.Series,
                      periods: int = 252) -> float:
    """IR = mean(active return) / tracking error * sqrt(periods)."""
    excess = returns - benchmark_returns
    return float(excess.mean() / excess.std() * np.sqrt(periods)
                 ) if excess.std() > 0 else 0.0


def binary_auc(scores: pd.Series, actuals: pd.Series) -> float:
    """ROC-AUC for direction prediction (actuals converted to 1/0 internally)."""
    try:
        from sklearn.metrics import roc_auc_score
    except ImportError:
        return float("nan")
    common = scores.dropna().index.intersection(actuals.dropna().index)
    if len(common) < 10:
        return float("nan")
    labels = (actuals.loc[common] > 0).astype(int)
    if labels.nunique() < 2:
        return float("nan")
    return float(roc_auc_score(labels, scores.loc[common]))


# ── Summary printer ───────────────────────────────────────────────────────────

def print_summary(returns: pd.Series, title: str = "Performance",
                  periods: int = 252) -> dict:
    """Print a formatted metrics table and return a dict of results."""
    equity  = (1.0 + returns).cumprod()
    metrics = {
        "Ann. Return":     f"{annualized_return(returns, periods):.2%}",
        "Ann. Volatility": f"{annualized_volatility(returns, periods):.2%}",
        "Sharpe Ratio":    f"{sharpe_ratio(returns, periods=periods):.3f}",
        "Sortino Ratio":   f"{sortino_ratio(returns, periods=periods):.3f}",
        "Max Drawdown":    f"{max_drawdown(equity):.2%}",
        "Calmar Ratio":    f"{calmar_ratio(returns, periods):.3f}",
        "Hit Rate":        f"{hit_rate(returns):.2%}",
        "Win/Loss Ratio":  f"{win_loss_ratio(returns):.3f}",
        "Profit Factor":   f"{profit_factor(returns):.3f}",
        "VaR 95%":         f"{var_95(returns):.3%}",
        "CVaR 95%":        f"{cvar_95(returns):.3%}",
        "Omega Ratio":     f"{omega_ratio(returns):.3f}",
        "Avg Win":         f"{average_win(returns):.3%}",
        "Avg Loss":        f"{average_loss(returns):.3%}",
        "# Periods":       str(len(returns)),
    }
    width = 54
    print("=" * width)
    print(f"  {title}")
    print("=" * width)
    for k, v in metrics.items():
        print(f"  {k:<26} {v}")
    print("=" * width)
    return metrics
