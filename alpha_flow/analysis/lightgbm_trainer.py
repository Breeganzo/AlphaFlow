"""
analysis/lightgbm_trainer.py
Walk-forward LightGBM model trained on microstructure features.
Target: next-period return direction (binary +1 / -1).
"""
import numpy as np
import pandas as pd
from scipy.stats import spearmanr  # type: ignore
from alpha_flow.config.settings import (
    LGBM_N_ESTIMATORS, LGBM_LEARNING_RATE
)


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Construct microstructure feature matrix from a single-ticker OHLCV df.
    Columns: ofi_zscore, amihud, kyle_lambda, cs_spread, tick_sign,
             ret_1, ret_5, vol_ratio
    """
    from alpha_flow.core.ofi_calculator import rolling_ofi_zscore
    from alpha_flow.core.amihud import amihud_ratio, kyle_lambda
    from alpha_flow.core.spread_tracker import corwin_schultz_spread
    from alpha_flow.core.lee_ready import tick_sign

    feats = pd.DataFrame(index=df.index)
    feats["ofi_zscore"]  = rolling_ofi_zscore(df)
    feats["amihud"]      = amihud_ratio(df)
    feats["kyle_lambda"] = kyle_lambda(df)
    feats["cs_spread"]   = corwin_schultz_spread(df)
    feats["tick_sign"]   = tick_sign(df["close"])
    feats["ret_1"]       = df["close"].pct_change(1)
    feats["ret_5"]       = df["close"].pct_change(5)
    vol_ma               = df["volume"].rolling(20).mean()
    feats["vol_ratio"]   = df["volume"] / vol_ma.replace(0, np.nan)
    return feats


def walk_forward_train(df: pd.DataFrame,
                       train_window: int = 120,
                       test_window:  int = 20,
                       horizon:      int = 5) -> dict:
    """
    Walk-forward out-of-sample evaluation.
    Returns dict with predictions, actuals, IC per fold.
    """
    try:
        import lightgbm as lgb  # type: ignore
    except ImportError as exc:
        raise ImportError("Install lightgbm: pip install lightgbm") from exc

    feats = build_features(df).dropna()
    target = df["close"].pct_change(horizon).shift(-horizon).reindex(feats.index)
    combined = feats.join(target.rename("target")).dropna()

    n = len(combined)
    all_preds = []
    all_real  = []
    ics = []

    for start in range(0, n - train_window - test_window, test_window):
        train = combined.iloc[start : start + train_window]
        test  = combined.iloc[start + train_window : start + train_window + test_window]

        X_train, y_train = train.drop("target", axis=1), np.sign(train["target"])
        X_test,  y_test  = test.drop("target", axis=1),  test["target"]

        model = lgb.LGBMClassifier(
            n_estimators=LGBM_N_ESTIMATORS,
            learning_rate=LGBM_LEARNING_RATE,
            n_jobs=1,
            verbose=-1,
        )
        model.fit(X_train, y_train)
        preds = model.predict_proba(X_test)[:, 1] - 0.5   # centred score

        all_preds.extend(preds.tolist())
        all_real.extend(y_test.tolist())

        ic, _ = spearmanr(preds, y_test)
        ics.append(ic if not np.isnan(ic) else 0.0)

    return {
        "predictions": all_preds,
        "actuals":     all_real,
        "ic_per_fold": ics,
        "mean_ic":     float(np.mean(ics)) if ics else np.nan,
    }
