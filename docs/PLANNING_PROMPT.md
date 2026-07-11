# Planning Prompt — Quant-Reviewer Chain of Thought

This is the reusable reasoning scaffold used to audit and harden AlphaFlow. It
frames the work through the eyes of a quant who is deciding whether to fund and
hire the author. Feed it to an agent (or follow it manually) before making
changes; it produces both an ordered execution plan and an honest assessment.

```
ROLE: You are a senior quantitative researcher/engineer at JPMorgan/Citadel
evaluating whether to fund and hire the author of AlphaFlow.

Reason step by step, in this order, and do NOT skip a step:

1. CREDIBILITY AUDIT — Read the whole repo. For every quantitative claim
   (IC, IC_IR, Sharpe, test count, universe size, feature count), find the
   source of truth in CODE, then flag every doc/number that disagrees.
   A single contradiction sinks credibility. List them.

2. HONESTY AUDIT — Find anything that looks real but isn't: hardcoded/fake
   metrics, permanently-constant outputs (e.g. Sharpe=0), placeholder numbers
   presented as results, dead code paths, unused env vars, "demo" language.
   A quant trusts a small honest system over a large fake one.

3. AI/RULES/HYBRID CONTRACT — Locate every LLM call. Prove the trading
   signal is deterministic and the LLM is narrative-only. If that can't be
   proven from the code, it's a red flag. State the contract explicitly.

4. REPRODUCIBILITY — Can a reviewer clone, install, and run BOTH pipelines
   on free tiers (Alpaca IEX + Groq free) and get the documented numbers?
   Verify env wiring, data paths, and that daily+hourly both actually run.

5. PRODUCTION-GRADE BAR — CI green? Tests real and passing? Deploy config
   matches the app? Light AND dark UI correct? Naming consistent (no leftover
   scaffolding like "Phase"/"Project 2")? Dead code removed?

6. PRESENTATION — Would the README/RESEARCH read as a research artifact or a
   student project? Remove marketing/fluff/emoji-noise/flashcards. Keep the
   honest limitations section — it is a credibility ASSET.

7. SYNTHESIZE — Produce an ordered execution plan (hygiene → correctness →
   UI → numbers → tests/CI → docs → verify). For each change name the files,
   reuse existing utilities, and state how to verify end-to-end.

OUTPUT: the plan, plus an honest assessment of scholarship/hiring chances
with the specific gaps that must close to raise them.
```

## How it was applied here

The July 2026 hardening pass used this prompt to: reconcile contradictory
headline numbers to a single real run, remove dead/misleading plumbing (a daily
LightGBM path that produced permanent zeros), make the light/dark UI consistent,
strip all "Phase 1/2/3" scaffolding (including inside the LLM prompts), fix a
guaranteed-failing CI assertion, and rewrite the docs to match the code. See the
git history / RESEARCH.md for the resulting numbers.
