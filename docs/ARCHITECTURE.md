# AlphaFlow — System Architecture

Three levels of detail: high-level system layers, the Phase 2 ML pipeline DAG, and module-level file relationships.

All diagrams render in VS Code with the [Markdown Preview Mermaid Support](https://marketplace.visualstudio.com/items?itemName=bierner.markdown-mermaid) extension (`Ctrl+Shift+V`).

---

## Diagram A — High-Level System Architecture

Five layers from raw market data to the live React dashboard.

```mermaid
graph TB
    subgraph SRC["Data Sources"]
        A1["yfinance\n2yr daily OHLCV\n~504 bars/ticker"]
        A2["yfinance hourly\n~3,276 bars/ticker"]
        A3["Alpaca REST\npaper-api.alpaca.markets/v2\nIEX free (15-min delay)"]
        A4["Synthetic fallback\nrandom-walk bars\n(no API key needed)"]
    end

    subgraph SIG["Microstructure Engine  (alpha_flow/core/)"]
        B1["OFI Z-score\nChordia et al. 2002"]
        B2["Kyle's λ\nKyle 1985"]
        B3["Amihud ILLIQ\nAmihud 2002"]
        B4["C-S Spread\nCorwin & Schultz 2012"]
        B5["VWAP Deviation Z\nAlmgren & Chriss 2001"]
        B6["Hawkes Intensity Z\nBacry et al. 2015"]
        B7["Volume Clock Imbalance\nLópez de Prado 2018"]
    end

    subgraph ML["ML + LLM Pipeline  (alpha_flow/agent/ · analysis/)"]
        C1["LightGBM Classifier\nPhase 1 · 5 folds\nBUY / SELL / HOLD"]
        C2["LGBMRegressor\nPhase 2 · ~17 walk-forward folds\nreturn magnitude prediction"]
        C3["SHAP Attribution\nTreeExplainer\nfeature importance per ticker"]
        C4["Groq LLM\nllama-3.3-70b-versatile\nnarrative generation"]
    end

    subgraph API["API Layer  (backend/)"]
        D1["FastAPI  port 8002"]
        D2["SQLite\naiosqlite async"]
        D3["SSE Stream\n/api/stream\nlive 1-min bars"]
    end

    subgraph UI["Dashboard  (frontend/)"]
        E1["React 18 + Vite\nport 3002\nTypeScript + Tailwind"]
        E2["Recharts\nOFI · Kyle λ · Spread\nAlpha Decay interactive"]
        E3["Research Drawer\nGroq AI chat\nper-ticker signal analysis"]
        E4["Intraday Panel\nSHAP importance chart\nwalk-forward IC cards"]
    end

    A1 --> B1 & B2 & B3 & B4
    A2 --> B5 & B6 & B7
    A3 -. "live bars" .-> D3
    A4 -. "fallback" .-> D3

    B1 & B2 & B3 & B4 --> C1
    B5 & B6 & B7 --> C2
    C1 & C2 --> C3 --> C4

    C4 --> D1
    D1 <--> D2
    D1 --> D3 --> E1
    D1 <--> E1

    E1 --> E2 & E3 & E4
```

---

## Diagram B — Phase 2 LangGraph ML Pipeline DAG

The intraday engine runs as a LangGraph state machine. Each node is a pure function. The graph is compiled once at startup and invoked per `POST /api/intraday/run`.

```mermaid
graph LR
    A["fetch_data\nyfinance 1h bars\nAlpaca fallback"]
    B["compute_features\n12 signals:\nOFI·Kyle·Amihud·Spread\nVWAP·Hawkes·VolClock\n+ 4 lag returns"]
    C["lgbm_walk_forward\nLGBMRegressor\n200-bar train / 50-bar test\n~17 folds · no lookahead"]
    D["shap_attribute\nTreeExplainer\nper-fold feature importance\naggregated across folds"]
    E["llm_interpret\nGroq llama-3.3-70b\ntemp=0.2 · grounded in\nDB signals + IC values"]
    F["summarise\nSignal card build\nIC · Sharpe · Sortino\nMax DD · top SHAP feature"]
    G[("SQLite DB\nalpha_flow_intraday\nper-ticker rows")]
    H["/api/intraday/signals\nJSON → React dashboard"]

    A --> B --> C --> D --> E --> F --> G --> H

    style A fill:#0C4A6E,color:#A5F3FC
    style B fill:#0C4A6E,color:#A5F3FC
    style C fill:#1e3a5f,color:#7DD3FC
    style D fill:#1e3a5f,color:#7DD3FC
    style E fill:#3730A3,color:#C7D2FE
    style F fill:#1e3a5f,color:#7DD3FC
    style G fill:#064E3B,color:#6EE7B7
    style H fill:#064E3B,color:#6EE7B7
```

**Key design decisions:**
- Walk-forward (not k-fold) to prevent look-ahead bias in financial time series
- LGBMRegressor (not Classifier) for correct IC = Spearman(ŷ, y) measurement
- SHAP TreeExplainer runs at test-fold level to prevent train-set contamination
- LLM grounded in live DB data — not hallucinated signal descriptions

---

## Diagram C — Module-Level File Architecture

Internal dependencies within `alpha_flow/` and how they connect to the backend and frontend.

```mermaid
graph TB
    subgraph CFG["alpha_flow/config/"]
        S["settings.py\nTickers · params\nAPI keys · .env loader"]
    end

    subgraph DATA["alpha_flow/data/"]
        DF["data_feed.py\nyfinance daily cache\nCSV per ticker"]
        AF["alpaca_stream.py\nSSE generator\npoll_latest_bars()"]
        IF["intraday_feed.py\nyfinance 1h\nhourly cache"]
    end

    subgraph CORE["alpha_flow/core/"]
        OFI["ofi_calculator.py\nrolling_ofi_zscore()\nbuy/sell vol split"]
        AMI["amihud.py\namihud_ratio()\nkyle_lambda()"]
        SPR["spread_tracker.py\ncorwin_schultz_spread()"]
    end

    subgraph SIG["alpha_flow/signals/"]
        GEN["generator.py\nLightGBM Classifier\nwalk-forward Phase 1\nsignal_card output"]
    end

    subgraph ANLYS["alpha_flow/analysis/"]
        IE["intraday_engine.py\nLGBMRegressor\nPhase 2 walk-forward\nSHAP + IC + Sharpe"]
        WF["wf_backtest.py\nwalk_forward_ic()\nportfolio backtest"]
        FIG["figures.py\n4 PNG charts\nmatplotlib"]
    end

    subgraph AGT["alpha_flow/agent/"]
        GR["graph.py\nLangGraph DAG\nfetch→compute→lgbm\n→shap→llm→summarise"]
    end

    subgraph EXEC["alpha_flow/execution/"]
        AB["alpaca_bridge.py\nPhase 3 (planned)\norder execution"]
    end

    subgraph BE["backend/"]
        MAIN["main.py\nFastAPI app\n/api/* endpoints\nBackgroundTasks"]
        DB["database.py\nSQLite aiosqlite\nrun history\nsignal persistence"]
    end

    subgraph FE["frontend/src/"]
        APP["App.tsx\nReact dashboard\nPhase 1 + Phase 2 UI\nResearch Drawer · Chat"]
    end

    S --> DATA & CORE & SIG & ANLYS & AGT
    DF --> CORE
    IF --> IE
    AF --> MAIN
    CORE --> SIG & ANLYS
    SIG --> GR --> MAIN
    ANLYS --> MAIN
    FIG --> MAIN
    MAIN <--> DB
    MAIN --> APP
    AB -.-> MAIN
```

---

## Export for Scholarship Applications

To export as PDF for scholarship or JPM application:

1. Open `architecture.drawio` at [diagrams.net](https://app.diagrams.net) (File → Open → upload the file)
2. Select all (Ctrl+A) → File → Export As → PDF
3. Tick "Fit Page" and "Border Width: 10"
4. Save as `AlphaFlow_Architecture.pdf`

The draw.io file contains Diagram A (high-level) as a polished version suitable for non-technical reviewers.
