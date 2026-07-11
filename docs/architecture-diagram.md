# AlphaFlow — Architecture Diagram (current state)

Single canonical current-state diagram. Renders on GitHub and in VS Code
(Markdown Preview Mermaid Support). For the detailed multi-diagram reference
(pipeline DAGs, DB schema, endpoint table) see [ARCHITECTURE.md](ARCHITECTURE.md).

```mermaid
flowchart TB
    subgraph DATA["Data sources (free tiers)"]
        Y["yfinance\ndaily OHLCV (2yr)"]
        AL["Alpaca IEX\nhourly bars (free)"]
        SY["Synthetic fallback\n(no key needed)"]
    end

    subgraph CORE["Microstructure library — alpha_flow/core/ (pure, both resolutions)"]
        OFI["OFI z-score"]; KYLE["Kyle λ"]; AMI["Amihud ILLIQ"]
        CS["Corwin-Schultz spread"]; VPIN["VPIN"]; HAW["Hawkes intensity"]
        VW["VWAP deviation"]; VC["Volume-clock imbalance"]
    end

    subgraph DAILY["Daily pipeline — agent/ (LangGraph)"]
        DF["compute_features\nOFI z, Kyle, Amihud, CS, IC"]
        DCLS["Cross-sectional classifier\nrank + sign -> long-short book\nFDR = conviction flag\n(DETERMINISTIC)"]
    end

    subgraph HOURLY["Hourly pipeline — analysis/intraday_engine.py"]
        FM["13-feature matrix"]
        WF["LGBMRegressor walk-forward\nembargo/purge · 20-27 folds"]
        SH["SHAP attribution"]
        HCLS["Same rank + sign\nlong-short book\n(DETERMINISTIC)"]
        TS["Tearsheet: IC · IC t-stat · Sharpe\nSortino · Calmar · Omega"]
    end

    subgraph AI["Narrative layer — Groq LLM (NEVER decides signals)"]
        LLM["signal_agent · /api/explain · /api/chat\ngrounded in live DB numbers"]
    end

    subgraph EXEC["Execution — execution/"]
        PT["Alpaca paper trades\n(position-guarded)"]
    end

    subgraph BACK["Backend — FastAPI (backend/)"]
        API["44 endpoints · SSE stream"]
        DB[("SQLite\nsignals · intraday · trades · alpha_decay")]
        CRON["APScheduler\nweekday cron"]
    end

    UI["React dashboard (frontend/src/App.tsx)\nDaily view · Hourly view · charts · paper trades · chat\nlight + dark themes"]

    Y --> DF
    AL --> FM
    SY -.-> API
    CORE --> DF
    CORE --> FM
    DF --> DCLS
    FM --> WF --> SH --> HCLS
    WF --> TS
    DCLS --> API
    HCLS --> API
    TS --> API
    DCLS -. "signal (fixed)" .-> LLM
    HCLS -. "signal (fixed)" .-> LLM
    LLM --> API
    HCLS --> PT --> DB
    API <--> DB
    CRON --> API
    API --> UI

    classDef det fill:#064E3B,color:#6EE7B7,stroke:#10B981;
    classDef ai fill:#3730A3,color:#C7D2FE,stroke:#6366F1;
    class DCLS,HCLS det;
    class LLM ai;
```

**Reading the diagram:** the two green nodes are the *only* places a BUY/SELL/HOLD
is decided — both deterministic (cross-sectional rank → long-short book, with a
separate Benjamini-Hochberg FDR high-conviction flag; shared code in
`analysis/signal_classification.py`). The purple node (Groq
LLM) receives the already-decided signal and writes an explanation; it is never
upstream of a trading decision.
