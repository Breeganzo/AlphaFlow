# AlphaFlow — Application Note

**Author:** Anthony Breeganzo Thomas · Quantitative Engineer
**Target programmes:** Imperial College London — MSc Mathematics & Finance · JPMorgan
Quantitative Finance Scholarship · Erasmus Mundus QEM · Entry 2027

This note is the *personal / application-facing* companion to the technical
[README](../README.md) and [RESEARCH.md](../RESEARCH.md). The repository itself
is written to stand as an engineering artifact; this file explains why I built
it and what it is meant to demonstrate.

## Why I built AlphaFlow

I wanted a single project that exercises the full quant-research loop end to end
— signal construction from market-microstructure theory, leak-free statistical
validation, machine learning with attribution, execution, and a usable
interface — on infrastructure a student can actually afford (free API tiers).
The goal was not a high Sharpe; it was to show that I can build a research system
that is **honest about what it can and cannot claim**.

## What it is meant to demonstrate

- **Microstructure fluency** — OFI, Kyle's λ, Amihud illiquidity, Corwin-Schultz
  spread, VPIN, Hawkes intensity, VWAP and volume-clock signals, each tied to its
  primary reference and unit-tested against hand-computed values.
- **Statistical rigor** — walk-forward validation with embargo/purge, the
  Grinold-Kahn IC framework, and Benjamini-Hochberg multiple-testing correction.
  The signal is two-tier: a tradeable cross-sectional long-short book (the rank
  spread) plus a separate high-conviction flag for names that also survive FDR
  correction — which honestly reports 0 individually-significant names on free
  data rather than overstating significance (see RESEARCH.md §4.2).
- **A defensible AI boundary** — the LLM is confined to narrative explanation and
  is provably out of the signal path. This is the design choice I would defend in
  an interview: an unauditable model must never decide a trade.
- **Engineering** — FastAPI + React + SQLite, 111 offline tests, CI, and a
  one-command deploy — the kind of production hygiene expected on a desk.

## Honest self-assessment

The realised hourly cross-sectional |IC| (~1.4%) is below the 5% "strong-signal"
threshold, which is the expected ceiling for free OHLCV without tick / limit-order-book
data. I present this openly: the contribution is the *method and the honesty*,
not the return. RESEARCH.md documents the limitations (data resolution,
survivorship, transaction-cost treatment, flat position sizing) and the concrete
extensions that would raise the ceiling (real tick data, cost-aware sizing, a
larger and survivorship-free universe).

## What I would do next with proper resources

Tick / LOB data (to lift IC past the free-OHLCV ceiling), risk-parity / mean-variance
position sizing, and a survivorship-free universe with point-in-time constituents.
See [ROADMAP.md](ROADMAP.md) for the full phased plan with cost estimates and code
change specifications.

## Reproducibility

`notebooks/reproduce.ipynb` runs both pipelines end-to-end and generates every
table in RESEARCH.md from raw data — including a rank fraction sensitivity analysis
(Fama-French quintile justification) and a Benjamini-Hochberg FDR worked example.
Every number in the docs traces to this notebook.
