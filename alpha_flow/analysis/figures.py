"""
analysis/figures.py — Chart generation for AlphaFlow (Microstructure Alpha Engine).

Charts
------
1. ofi_zscore_chart.png        — OFI Z-score time-series (all tickers, last 60 bars)
2. execution_quality.png       — Effective spread, Kyle λ, Amihud ILLIQ over time
3. kyle_lambda_trend.png       — Kyle λ (price impact) rolling 30-day trend
4. alpha_decay.png             — Microstructure alpha IC decay (lag 1→10)
"""
from __future__ import annotations
import json
import logging
from datetime import date
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import numpy as np
import pandas as pd

log = logging.getLogger(__name__)

OUTPUTS_DIR = Path(__file__).parent.parent.parent / "outputs"
FIGURES_DIR = OUTPUTS_DIR / "figures"
FIGURES_DIR.mkdir(parents=True, exist_ok=True)

_DARK, _PANEL, _AXIS, _GRID, _SPINE, _TEXT = \
    "#0d1117", "#161b22", "#8b949e", "#21262d", "#30363d", "#e6edf3"
_CYAN, _GREEN, _RED, _AMBER = "#79c0ff", "#56d364", "#f78166", "#ffa657"

# Palette for multi-ticker lines (index = alphabetical sort position)
_TICKER_COLORS = [
    "#79c0ff", "#56d364", "#ffa657", "#f78166", "#d2a8ff",
    "#58a6ff", "#3fb950", "#e3b341", "#ff7b72", "#bc8cff",
]

# Named map — must stay in sync with TICKER_COLORS in frontend/src/App.tsx
# Alphabetical assignment: AAPL(0) … V(9)
_TICKER_COLOR_MAP: dict[str, str] = {
    "AAPL": "#79c0ff", "AMZN": "#56d364", "BAC": "#ffa657", "GOOGL": "#f78166",
    "JPM":  "#d2a8ff", "META": "#58a6ff", "MSFT": "#3fb950", "NVDA": "#e3b341",
    "TSLA": "#ff7b72", "V":    "#bc8cff",
}


def _ax_style(ax):
    ax.set_facecolor(_PANEL)
    ax.tick_params(colors=_AXIS, labelsize=8)
    for sp in ax.spines.values():
        sp.set_edgecolor(_SPINE)
    ax.grid(True, color=_GRID, lw=0.5)


def _save(fig, path: Path) -> Path:
    plt.tight_layout()
    fig.savefig(path, dpi=150, bbox_inches="tight", facecolor=_DARK)
    plt.close(fig)
    log.info("Saved → %s", path)
    return path


def plot_ofi_zscore_chart(
    ofi_by_ticker: dict[str, pd.Series],
    output_path: Path | None = None,
) -> Path:
    """
    Multi-line OFI Z-score time-series chart.
    Shows rolling OFI Z (buy/sell pressure) for all tickers over last 60 bars.
    output_path: optional custom save location (defaults to ofi_zscore_chart.png).
    """
    out = output_path or (FIGURES_DIR / "ofi_zscore_chart.png")
    fig, ax = plt.subplots(figsize=(14, 5), facecolor=_DARK)
    _ax_style(ax)
    fig.suptitle("Order Flow Imbalance Z-score — All Tickers (Last 60 Bars)",
                 color=_TEXT, fontsize=12, weight="bold")

    any_data = False
    for i, (ticker, series) in enumerate(sorted(ofi_by_ticker.items())):
        s = series.dropna().tail(60)
        if len(s) < 2:
            continue
        color = _TICKER_COLOR_MAP.get(ticker, _TICKER_COLORS[i % len(_TICKER_COLORS)])
        ax.plot(s.index, s.values, lw=1.6, color=color, label=ticker, alpha=0.9)
        any_data = True

    if not any_data:
        ax.text(0.5, 0.5, "No OFI data — run the pipeline first",
                transform=ax.transAxes, ha="center", va="center",
                color=_AXIS, fontsize=10)
    else:
        ax.axhline(0,    color=_SPINE, lw=0.9, zorder=2)
        ax.axhline(+1.5, color=_AMBER, lw=0.8, ls="--", alpha=0.6, label="+1.5σ threshold")
        ax.axhline(-1.5, color=_AMBER, lw=0.8, ls="--", alpha=0.6)
        ax.set_ylabel("OFI Z-score", color=_TEXT, fontsize=9)
        ax.set_xlabel("Date", color=_AXIS, fontsize=8)
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %d"))
        plt.setp(ax.xaxis.get_majorticklabels(), rotation=30, ha="right", fontsize=7)
        ax.legend(fontsize=7, framealpha=0.25, ncol=5,
                  loc="upper left", labelcolor=_TEXT)
        ax.fill_between(
            ax.get_xlim(), -1.5, 1.5, alpha=0.03, color=_AMBER, zorder=0
        )

    return _save(fig, out)


def plot_execution_quality(
    eff_spread: pd.Series | None = None,
    amihud: pd.Series | None = None,
) -> Path:
    """Effective spread + Amihud ILLIQ over time."""
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(14, 7), facecolor=_DARK, sharex=True)
    fig.suptitle("AlphaFlow — Execution Quality", color=_TEXT, fontsize=12, weight="bold")
    for ax in (ax1, ax2):
        _ax_style(ax)

    if eff_spread is not None and not eff_spread.empty:
        ax1.plot(eff_spread.index, eff_spread.values, color=_CYAN, lw=1.3, label="Effective Spread")
        ax1.set_ylabel("Eff. Spread (bps)", color=_AXIS, fontsize=8)
        ax1.legend(fontsize=7, framealpha=0.3)
    else:
        ax1.text(0.5, 0.5, "No effective spread data", transform=ax1.transAxes,
                 ha="center", va="center", color=_AXIS)

    if amihud is not None and not amihud.empty:
        ax2.plot(amihud.index, amihud.values, color=_AMBER, lw=1.3, label="Amihud ILLIQ")
        ax2.set_ylabel("Illiquidity (price_chg / $1M_vol)", color=_AXIS, fontsize=8)
        ax2.legend(fontsize=7, framealpha=0.3)
        ax2.xaxis.set_major_formatter(mdates.DateFormatter("%b %Y"))
        plt.setp(ax2.xaxis.get_majorticklabels(), rotation=30, ha="right", fontsize=7)
    else:
        ax2.text(0.5, 0.5, "No Amihud data", transform=ax2.transAxes,
                 ha="center", va="center", color=_AXIS)

    return _save(fig, FIGURES_DIR / "execution_quality.png")


def plot_kyle_lambda_trend(kyle_lambda: pd.Series) -> Path:
    """Rolling 30-day Kyle λ price impact coefficient."""
    roll = kyle_lambda.rolling(30, min_periods=5).mean() if len(kyle_lambda) > 5 else kyle_lambda
    fig, ax = plt.subplots(figsize=(14, 4), facecolor=_DARK)
    _ax_style(ax)
    fig.suptitle("Kyle λ — Price Impact Coefficient (30-day Rolling)", color=_TEXT, fontsize=12, weight="bold")

    ax.plot(kyle_lambda.index, kyle_lambda.values, color=_CYAN, lw=0.7, alpha=0.4, label="Daily λ")
    ax.plot(roll.index, roll.values, color=_GREEN, lw=1.6, label="30-day MA")
    ax.set_ylabel("Kyle λ ($/share per unit order flow)", color=_AXIS, fontsize=9)
    ax.legend(fontsize=8, framealpha=0.3)
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %Y"))
    plt.setp(ax.xaxis.get_majorticklabels(), rotation=30, ha="right", fontsize=7)

    return _save(fig, FIGURES_DIR / "kyle_lambda_trend.png")


def plot_alpha_decay(ic_by_lag: dict) -> Path:
    """
    Bar chart of OFI-Z IC at forward-return lags 1–10.
    Green bars = positive IC. Red bars = negative IC.
    Dashed amber lines at ±0.05 = significance threshold (Grinold & Kahn, 2000).
    """
    lags = list(ic_by_lag.keys())
    ics  = list(ic_by_lag.values())

    fig, ax = plt.subplots(figsize=(11, 5), facecolor=_DARK)
    _ax_style(ax)
    fig.suptitle("AlphaFlow — Microstructure Signal Decay (OFI IC by Lag)",
                 color=_TEXT, fontsize=12, weight="bold")

    if not lags or all(v == 0.0 for v in ics):
        ax.text(0.5, 0.5,
                "Insufficient data for alpha decay estimation\n"
                "(Daily: daily OHLCV OFI proxy — IC near zero is expected)\n"
                "With real tick data, hourly will show meaningful IC > 0.05",
                transform=ax.transAxes, ha="center", va="center", color=_AXIS,
                fontsize=9, multialignment="center", linespacing=1.8)
        ax.axhline( 0.05, color=_AMBER, lw=1.1, ls="--", label="±0.05 significance threshold", zorder=2)
        ax.axhline(-0.05, color=_AMBER, lw=1.1, ls="--", zorder=2)
        ax.set_ylabel("Spearman IC", color=_TEXT, fontsize=9)
        ax.legend(fontsize=8, framealpha=0.3)
    else:
        colours = [_GREEN if v >= 0 else _RED for v in ics]
        bars = ax.bar(lags, ics, color=colours, width=0.6, alpha=0.85, zorder=3)
        ax.axhline(0,     color=_SPINE, lw=0.9, zorder=2)
        ax.axhline( 0.05, color=_AMBER, lw=1.1, ls="--", label="±0.05 significance", zorder=2)
        ax.axhline(-0.05, color=_AMBER, lw=1.1, ls="--", zorder=2)
        ax.set_xlabel("Forward Return Horizon (bars)", color=_TEXT, fontsize=9)
        ax.set_ylabel("Spearman IC",                  color=_TEXT, fontsize=9)
        ax.set_xticks(lags)
        ax.set_xticklabels([f"Lag {l}" for l in lags], fontsize=8, color=_TEXT,
                           rotation=30, ha="right")
        ax.legend(fontsize=8, framealpha=0.3)
        for bar, val in zip(bars, ics):
            va = "bottom" if val >= 0 else "top"
            offset = 0.003 if val >= 0 else -0.003
            ax.text(bar.get_x() + bar.get_width() / 2, val + offset,
                    f"{val:.3f}", ha="center", va=va, fontsize=7, color=_TEXT)

    return _save(fig, FIGURES_DIR / "alpha_decay.png")


def save_microstructure_report(
    eff_spread_mean: float = 0.0,
    amihud_mean: float = 0.0,
    kyle_lambda_mean: float = 0.0,
    ofi_ic: float = 0.0,
) -> Path:
    # Fixed filename — overwritten on each run (no duplicate accumulation)
    ts = date.today().strftime("%Y%m%d")
    report = {
        "generated_at": date.today().isoformat(),
        "project": "AlphaFlow — Microstructure Alpha Engine",
        "metrics": {
            "avg_effective_spread_bps": {
                "value": round(eff_spread_mean, 2),
                "unit": "basis points",
                "note": "Corwin-Schultz (2012) bid-ask spread estimator. Large-cap US equities typically 5–25 bps."
            },
            "avg_amihud_illiq": {
                "value": round(amihud_mean, 8),
                "unit": "price_chg / $1M_vol",
                "note": "Amihud (2002) illiquidity ratio. Dimensionless — price movement per $1M of traded volume. Liquid large-caps < 1e-7."
            },
            "avg_kyle_lambda": {
                "value": round(kyle_lambda_mean, 8),
                "unit": "$ price_impact / share",
                "note": "Kyle (1985) lambda: price impact per unit of order flow. Higher = each trade moves price more."
            },
            "ofi_predictive_ic": {
                "value": round(ofi_ic, 4),
                "unit": "Spearman rank correlation",
                "note": "IC between OFI signal and next-bar return. IC > 0.05 is statistically significant per HFT literature."
            },
        },
        "figures": [
            "ofi_zscore_chart.png",
            "execution_quality.png",
            "kyle_lambda_trend.png",
            "alpha_decay.png",
        ],
    }
    fname = OUTPUTS_DIR / "microstructure_report.json"
    fname.write_text(json.dumps(report, indent=2))
    log.info("Saved report → %s", fname)
    return fname
