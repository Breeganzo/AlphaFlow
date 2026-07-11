"""alpha_flow.core — Microstructure signal primitives.

Re-exports the primary signal computation functions so callers can write:

    from alpha_flow.core import compute_ofi, rolling_ofi_zscore
    from alpha_flow.core import amihud_ratio, kyle_lambda
    from alpha_flow.core import corwin_schultz_spread
    from alpha_flow.core import compute_session_vwap, vwap_deviation_zscore
    from alpha_flow.core import hawkes_intensity, hawkes_intensity_zscore
    from alpha_flow.core import volume_imbalance, volume_clock_zscore

Modules:
    ofi_calculator  : Order Flow Imbalance — Chordia et al. (2002)
    amihud          : Illiquidity ratio + Kyle lambda — Amihud (2002), Kyle (1985)
    spread_tracker  : Corwin-Schultz effective spread — Corwin & Schultz (2012)
    lee_ready       : Tick-sign classification — Lee & Ready (1991)
    vwap            : Session VWAP and deviation z-score (hourly)
    hawkes          : Hawkes process intensity — event-driven order clustering (hourly)
    volume_clock    : Volume-clock signed imbalance + z-score (hourly)
"""
from alpha_flow.core.ofi_calculator import compute_ofi, rolling_ofi_zscore
from alpha_flow.core.amihud import amihud_ratio, kyle_lambda
from alpha_flow.core.spread_tracker import corwin_schultz_spread
from alpha_flow.core.lee_ready import tick_sign, signed_volume
from alpha_flow.core.vwap import (
    compute_session_vwap,
    vwap_deviation_zscore,
    vwap_reversion_signal,
)
from alpha_flow.core.hawkes import hawkes_intensity, hawkes_intensity_zscore
from alpha_flow.core.volume_clock import volume_imbalance, volume_clock_zscore

__all__ = [
    "compute_ofi", "rolling_ofi_zscore",
    "amihud_ratio", "kyle_lambda",
    "corwin_schultz_spread",
    "tick_sign", "signed_volume",
    "compute_session_vwap", "vwap_deviation_zscore", "vwap_reversion_signal",
    "hawkes_intensity", "hawkes_intensity_zscore",
    "volume_imbalance", "volume_clock_zscore",
]
