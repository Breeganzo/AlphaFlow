# AlphaFlow — React Dashboard
> **Author:** Anthony Breeganzo Thomas · AlphaFlow · Imperial College MSc RMFE Quant Portfolio

React 18 + Vite 5 + TypeScript on **port 3002**

---

## Stack

| Package | Version | Role |
|---------|---------|------|
| React | 18 | UI framework |
| TypeScript | 5 | Type safety |
| Vite | 5 | Dev server + bundler |
| @tanstack/react-query | 5 | Server state + polling |
| axios | 1.x | HTTP client |
| Recharts | 2.x | Interactive charts (line, bar, responsive container) |

---

## Start

```bash
# Recommended: background process (avoids macOS TTY suspension)
cd /Users/anthonybreeganzo.t/Quant_Practise/AlphaFlow/frontend
node node_modules/.bin/vite --port 3002 < /dev/null > /tmp/af-frontend.log 2>&1 &

# Then open
open http://localhost:3002
```

> **Why `node ... vite` instead of `npm run dev`:** `npm run dev` in a background shell
> on macOS can receive `SIGTTOU` and suspend when it tries to write to the TTY.
> Invoking the Vite binary directly with redirected stdin/stdout avoids this entirely.

---

## API Proxy

Vite proxies all `/api/*` and `/health` requests to the FastAPI backend.
No browser CORS configuration required.

```ts
// vite.config.ts (key section)
proxy: {
  '/api':    { target: 'http://localhost:8002', changeOrigin: true },
  '/health': { target: 'http://localhost:8002', changeOrigin: true },
}
```

---

## Polling Intervals

| Data | Endpoint | Interval |
|------|----------|----------|
| Backend health | `/health` | 30 s |
| Run history | `/api/history` | 5 s |
| Signal cards | `/api/signals/all` | 10 s |
| Outputs list | `/api/outputs` | 10 s |

---

## `App.tsx` — Section Map

| Section | Description |
|---------|-------------|
| **Header** | Project title + live API status badge (green/red) + dark/light toggle |
| **Metrics Grid** | 4 cards — OFI Z, Kyle λ, Amihud ILLIQ, Effective Spread · hover for formula tooltip |
| **Ticker Signal Cards** | One card per tracked ticker: metric values + BUY/SELL/HOLD badge |
| **Run History Panel** | Collapsible history list · click any run to open full-detail modal with interactive Recharts |
| **Research Output Charts** | Thumbnail grid of PNGs; click any chart to analyse inline · ⊕ Expand Full Screen opens `ChartLightbox` overlay · OFI opens inline like all other charts |
| **Interactive Charts** | OFI Z-score Monitor, Execution Quality, Kyle's λ, Alpha Decay — all Recharts with per-ticker toggle pills, date pickers, year-visible X-axis (`MM/DD/YY`), hidden tickers excluded from tooltip via `hide` prop |
| **Research Assistant** | Groq chat panel — type questions or click suggestion chips · pre-filled from metric/chart click |

---

## Build

```bash
cd frontend
node node_modules/.bin/vite build   # outputs to dist/
```

Static files in `dist/` can be served by any web server or FastAPI's `StaticFiles` mount.
