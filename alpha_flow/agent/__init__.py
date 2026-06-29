"""alpha_flow.agent — LangGraph orchestration for the full analysis pipeline.

Runs a 6-node directed acyclic graph (DAG) that chains:
    ingest → ofi → spread → kyle → amihud → lgbm_predict → llm_interpret → aggregate

Each node is a pure function that mutates the shared pipeline state dict.
Groq llama-3.3-70b-versatile provides plain-English signal narratives.
Dual API key rotation handles the Groq free-tier daily token limit.

Note: LangGraph, Groq SDK, and LightGBM are imported inside langgraph_flow.py
at module level. Do not import alpha_flow.agent in lightweight contexts.
"""
