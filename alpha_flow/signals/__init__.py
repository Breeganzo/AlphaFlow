"""alpha_flow.signals — Signal generation and per-ticker output cards.

Re-exports:
    from alpha_flow.signals import generate_signal_card
    from alpha_flow.signals import print_signal_card

Modules:
    signal_generator : Combines microstructure scores, LightGBM probability, and
                       Groq LLM narrative into a structured signal card dict.
                       Output: { ticker: { signal, confidence, ofi_z, spread, ... } }
"""
from alpha_flow.signals.signal_generator import generate_signal_card, print_signal_card

__all__ = ["generate_signal_card", "print_signal_card"]

