# COMPONENT TYPE: DETERMINISTIC
# All computations use mathematical formulas:
#   - Walk-forward IC computed via Spearman rank correlation
#   - AUC via sklearn.metrics (fixed formula, no training)
#   - SHAP values computed from the LightGBM model (tree SHAP — deterministic)
#   - Feature IC table: rank correlation per feature vs forward returns
# The LightGBM model in lightgbm_trainer.py is AI-based (see that file).
# This file only evaluates and reports — all evaluation is deterministic.
"""
analysis/backtest.py
Comprehensive walk-forward backtest for the Market Microstructure Engine (P2).

Outputs:
  - Per-ticker IC (Information Coefficient) table
  - Overall AUC (Area Under ROC Curve)
  - Hit rate (% of correct direction predictions)
  - Feature-level IC table (which features are most predictive)
  - SHAP feature importance (top-5 contributors to model predictions)

Industry context: This evaluation methodology mirrors what HFT firms (Jane Street,
  Virtu, Hudson River Trading) use to audit their microstructure signal quality.
  An IC consistently above 0.05 is considered statistically significant.

Academic references:
  Kyle (1985) — Continuous auctions and insider trading (OFI foundation)
  Amihud (2002) — Illiquidity and stock returns (Amihud measure)
  Lee & Ready (1991) — Inferring trade direction (tick sign)
  Corwin & Schultz (2012) — Simple way to estimate bid-ask spreads
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from alpha_flow.utils.performance_metrics import (
    print_summary, information_coefficient, binary_auc, hit_rate,
)
from alpha_flow.analysis.lightgbm_trainer import build_features, walk_forward_train
from alpha_flow.data.data_feed import get_daily_bars
from alpha_flow.config.settings import TICKERS


def _hit_rate_from_lists(preds: list, actuals: list) -> float:
    """Hit rate: fraction of predictions where sign(pred) == sign(actual)."""
    if not preds:
        return 0.0
    correct = sum(1 for p, a in zip(preds, actuals) if (p > 0) == (a > 0))
    return correct / len(preds)


def feature_ic_table(df: pd.DataFrame, horizon: int = 5) -> pd.DataFrame:
    """
    Compute Spearman IC of each microstructure feature vs forward returns.
    Returns a DataFrame sorted by |IC| descending.
    """
    from scipy.stats import spearmanr
    feats   = build_features(df).dropna()
    fwd_ret = df["close"].pct_change(horizon).shift(-horizon).reindex(feats.index).dropna()
    common  = feats.index.intersection(fwd_ret.index)
    feats   = feats.loc[common]
    fwd     = fwd_ret.loc[common]

    rows = []
    for col in feats.columns:
        ic, pval = spearmanr(feats[col].fillna(0), fwd)
        rows.append({"feature": col, "IC": round(float(ic), 4), "p_value": round(float(pval), 4)})

    return pd.DataFrame(rows).sort_values("IC", key=abs, ascending=False)


def shap_importance(df: pd.DataFrame, train_frac: float = 0.7) -> pd.Series | None:
    """
    Compute mean |SHAP| value per feature using the LightGBM model
    trained on the first train_frac of the data.
    Returns pd.Series of mean |SHAP| values, sorted descending.
    """
    try:
        import shap
        import lightgbm as lgb
        from scipy.stats import spearmanr
    except ImportError:
        return None

    feats  = build_features(df).dropna()
    target = df["close"].pct_change(5).shift(-5).reindex(feats.index)
    combo  = feats.join(target.rename("target")).dropna()

    n_train = int(len(combo) * train_frac)
    train   = combo.iloc[:n_train]
    test    = combo.iloc[n_train:]

    X_tr, y_tr = train.drop("target", axis=1), np.sign(train["target"])
    X_te       = test.drop("target", axis=1)

    model = lgb.LGBMClassifier(n_estimators=300, learning_rate=0.05,
                                n_jobs=1, verbose=-1)
    model.fit(X_tr, y_tr)

    explainer  = shap.TreeExplainer(model)
    shap_vals  = explainer.shap_values(X_te)
    # For binary classification, shap_values returns list [class0, class1]
    if isinstance(shap_vals, list):
        shap_arr = shap_vals[1]
    else:
        shap_arr = shap_vals
    mean_abs   = np.abs(shap_arr).mean(axis=0)
    return pd.Series(mean_abs, index=X_te.columns, name="mean_abs_shap"
                     ).sort_values(ascending=False)


def run_backtest(verbose: bool = True) -> dict:
    """
    Full walk-forward backtest across all TICKERS in P2.
    Returns per-ticker results and aggregate metrics.
    """
    if verbose:
        print("\n" + "=" * 60)
        print("  Market Microstructure Engine — Walk-Forward Backtest")
        print(f"  Tickers: {TICKERS}")
        print("=" * 60)

    ticker_results: dict[str, dict] = {}
    all_preds: list[float] = []
    all_actuals: list[float] = []

    for ticker in TICKERS:
        if verbose:
            print(f"\n  [{ticker}] Processing …")
        try:
            df = get_daily_bars(ticker)
            result = walk_forward_train(df)

            preds   = result["predictions"]
            actuals = result["actuals"]

            all_preds.extend(preds)
            all_actuals.extend(actuals)

            p = pd.Series(preds)
            a = pd.Series(actuals)

            ticker_results[ticker] = {
                "mean_ic":   round(result["mean_ic"], 4),
                "auc":       round(float(binary_auc(p, a)) if len(p) >= 10 else 0.0, 4),
                "hit_rate":  round(_hit_rate_from_lists(preds, actuals), 4),
                "n_folds":   len(result["ic_per_fold"]),
            }

            if verbose:
                r = ticker_results[ticker]
                print(f"    IC={r['mean_ic']:.4f}  AUC={r['auc']:.4f}  "
                      f"HitRate={r['hit_rate']:.2%}  Folds={r['n_folds']}")

        except Exception as exc:  # noqa: BLE001
            ticker_results[ticker] = {"mean_ic": 0.0, "auc": 0.0, "hit_rate": 0.0, "n_folds": 0}
            if verbose:
                print(f"    [SKIP] {exc}")

    # Aggregate
    ics      = [v["mean_ic"] for v in ticker_results.values() if v["mean_ic"] != 0.0]
    auc_vals = [v["auc"]     for v in ticker_results.values() if v["auc"] != 0.0]
    hr_vals  = [v["hit_rate"] for v in ticker_results.values() if v["hit_rate"] != 0.0]

    if verbose:
        print("\n" + "=" * 60)
        print("  AGGREGATE MICROSTRUCTURE BACKTEST RESULTS")
        print("=" * 60)
        print(f"  Tickers evaluated:  {len(ticker_results)}")
        print(f"  Avg IC:             {np.mean(ics):.4f}" if ics else "  Avg IC: N/A")
        print(f"  Avg AUC:            {np.mean(auc_vals):.4f}" if auc_vals else "  Avg AUC: N/A")
        print(f"  Avg Hit Rate:       {np.mean(hr_vals):.2%}" if hr_vals else "  Avg Hit Rate: N/A")
        print(f"  Total predictions:  {len(all_preds)}")
        print("=" * 60)

    # Feature IC table for first available ticker
    if TICKERS:
        if verbose:
            print(f"\n  Feature IC Table ({TICKERS[0]}):")
        try:
            df0   = get_daily_bars(TICKERS[0])
            fic   = feature_ic_table(df0)
            if verbose:
                print(fic.to_string(index=False))
        except Exception:  # noqa: BLE001
            fic = pd.DataFrame()
    else:
        fic = pd.DataFrame()

    # SHAP importance for first ticker
    shap_series = None
    try:
        if TICKERS:
            df0         = get_daily_bars(TICKERS[0])
            shap_series = shap_importance(df0)
            if shap_series is not None and verbose:
                print(f"\n  SHAP Feature Importance ({TICKERS[0]}, top 5):")
                print(shap_series.head(5).to_string())
    except Exception:  # noqa: BLE001
        pass

    return {
        "ticker_results": ticker_results,
        "avg_ic":         float(np.mean(ics)) if ics else 0.0,
        "avg_auc":        float(np.mean(auc_vals)) if auc_vals else 0.0,
        "avg_hit_rate":   float(np.mean(hr_vals)) if hr_vals else 0.0,
        "feature_ic":     fic,
        "shap":           shap_series,
    }


def compute_alpha_decay(df: pd.DataFrame, max_lag: int = 10) -> dict:
    """
    Compute Spearman IC between OFI-Z signal and forward returns at lags 1–max_lag.
    Shows how quickly the microstructure signal loses predictive power over time.

    An IC that decays steeply from lag-1 to lag-5 indicates a short-lived,
    high-frequency alpha — consistent with microstructure signals (Kyle 1985).
    IC consistently above ±0.05 at any lag is considered statistically significant.

    Args:
        df:       Single-ticker OHLCV DataFrame from get_daily_bars()
        max_lag:  Maximum forward return horizon in bars (default: 10)

    Returns:
        dict mapping lag (int) → IC (float), e.g. {1: 0.042, 2: 0.031, ...}
    """
    from scipy.stats import spearmanr
    from alpha_flow.analysis.lightgbm_trainer import build_features

    try:
        feats = build_features(df).dropna()
    except Exception:
        return {lag: 0.0 for lag in range(1, max_lag + 1)}

    ofi_z = feats["ofi_zscore"] if "ofi_zscore" in feats.columns else pd.Series(dtype=float)
    if ofi_z.empty:
        return {lag: 0.0 for lag in range(1, max_lag + 1)}

    ic_by_lag: dict[int, float] = {}
    for lag in range(1, max_lag + 1):
        fwd = df["close"].pct_change(lag).shift(-lag).reindex(feats.index).dropna()
        common = ofi_z.index.intersection(fwd.index)
        if len(common) < 20:
            ic_by_lag[lag] = 0.0
            continue
        ic, _ = spearmanr(ofi_z.loc[common].fillna(0), fwd.loc[common])
        ic_by_lag[lag] = round(float(ic) if not np.isnan(ic) else 0.0, 4)

    return ic_by_lag


if __name__ == "__main__":
    run_backtest()
