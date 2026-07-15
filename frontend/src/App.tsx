import React, { useState, useRef, useEffect, useCallback, useMemo, cloneElement, createContext, useContext } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { LineChart, Line, AreaChart, Area, BarChart, Bar, ComposedChart, ScatterChart, Scatter, Cell, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ReferenceLine, ReferenceArea, ResponsiveContainer } from 'recharts'
import axios from 'axios'

// ── Production API URL ────────────────────────────────────────────────────────
// In production (Render/Vercel), set VITE_API_URL to the backend URL.
// In local dev, Vite proxy handles /api → localhost:8002 automatically.
const API_BASE_URL = import.meta.env.VITE_API_URL?.replace(/\/$/, '')
if (API_BASE_URL) {
  axios.defaults.baseURL = API_BASE_URL
}

function apiPath(path: string): string {
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path
}

// ── Themes ───────────────────────────────────────────────────────────────────
const DARK_S = {
  bg: '#020817', surface: '#0B1120', border: '#1E3A5F',
  primary: '#38BDF8', text: '#F0F9FF', muted: '#7DD3FC',
  runBtn: '#0369A1', tag: '#0C4A6E', cardBg: '#0F1A2E',
  tipBg: '#101B35', tipBorder: '#2563EB55',
  success: '#166534', successText: '#BBF7D0',
  error: '#7f1d1d', errorText: '#FECACA',
  warn: '#713f12', warnText: '#FDE68A',
  buyBg: '#14532d', buyText: '#86EFAC',
  sellBg: '#7f1d1d', sellText: '#FCA5A5',
  holdBg: '#713f12', holdText: '#FDE68A',
  scrollThumb: '#1E3A5F',
  positiveVal: '#86EFAC',   // light green on dark — positive metric value
  negativeVal: '#FCA5A5',   // light red on dark   — negative metric value
  warnVal:     '#FDE68A',   // amber on dark       — warning metric value
  // ── Glassmorphism layer — translucent panels + blur over a radial-gradient backdrop ──
  bgGradient: 'radial-gradient(circle at 18% -8%, rgba(56,189,248,0.13), transparent 42%), radial-gradient(circle at 85% 0%, rgba(99,102,241,0.12), transparent 46%), #020817',
  glassBg: 'rgba(13, 20, 38, 0.62)',
  glassBorder: 'rgba(148, 197, 253, 0.16)',
  glassShadow: '0 8px 32px rgba(0,0,0,0.45)',
  headerGlassBg: 'rgba(11, 17, 32, 0.72)',
  fabBg: 'rgba(56, 189, 248, 0.88)',
}
const LIGHT_S = {
  bg: '#C9DCF2',           // clear slate-blue page background — unmistakably blue
  surface: '#DBE9F8',      // blue-tinted card surface (never pure white)
  border: '#7AADDA',       // visible medium-blue border
  primary: '#1E40AF',      // deep blue accent
  text: '#071526',         // near-black navy — maximum readability
  muted: '#244E7A',        // medium navy — readable, not too dark
  runBtn: '#1D4ED8',
  tag: '#B8D4EE',
  cardBg: '#CFDFF3',       // slightly darker panel inner
  tipBg: '#1E3A5F',          // always-dark tooltip — existing tooltip text colours work in both modes
  tipBorder: '#2D6FA888',
  success: '#D1FAE5',      successText: '#052E16',  // light green bg + very dark text — readable on blue
  error: '#FEE2E2',        errorText: '#450A0A',    // light red bg + very dark text
  warn: '#FEF3C7',         warnText: '#3F1700',     // light amber bg + very dark text
  buyBg: '#14532D',        buyText: '#DCFCE7',      // dark green badge — pops on any light background
  sellBg: '#7F1D1D',       sellText: '#FEE2E2',     // dark red badge
  holdBg: '#78350F',       holdText: '#FEF3C7',     // dark amber badge
  scrollThumb: '#7AADDA',
  positiveVal: '#166534',    // dark green on light — readable against blue bg
  negativeVal: '#991B1B',    // dark red on light
  warnVal:     '#78350F',    // dark amber on light
  // ── Glassmorphism layer — frosted white panels over a radial-gradient blue backdrop ──
  bgGradient: 'radial-gradient(circle at 18% -8%, rgba(255,255,255,0.85), transparent 40%), radial-gradient(circle at 85% 0%, rgba(147,197,253,0.55), transparent 46%), #C9DCF2',
  glassBg: 'rgba(255, 255, 255, 0.55)',
  glassBorder: 'rgba(255, 255, 255, 0.7)',
  glassShadow: '0 8px 32px rgba(30,64,175,0.14)',
  headerGlassBg: 'rgba(219, 233, 248, 0.75)',
  fabBg: 'rgba(30, 64, 175, 0.88)',
}
type Theme = typeof DARK_S
const ThemeCtx = createContext<{ S: Theme; isDark: boolean }>({ S: DARK_S, isDark: true })
const useS = () => useContext(ThemeCtx).S
const useIsDark = () => useContext(ThemeCtx).isDark

// Tracks whether the viewport is narrower than `breakpoint` (default 768px = tablet/mobile).
// Used only where CSS alone (flexWrap / auto-fit minmax) can't express the layout change —
// e.g. collapsing an asymmetric fixed-sidebar grid into a single stacked column.
const useIsMobile = (breakpoint = 768) => {
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < breakpoint)
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < breakpoint)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [breakpoint])
  return isMobile
}

// ── Constants ────────────────────────────────────────────────────────────────
const TICKER_NAMES: Record<string, [string, string]> = {
  AAPL: ['Apple Inc.', 'Technology'], MSFT: ['Microsoft Corp.', 'Technology'],
  NVDA: ['NVIDIA Corp.', 'Semiconductors'], META: ['Meta Platforms', 'Technology'],
  GOOGL: ['Alphabet Inc.', 'Technology'], AMZN: ['Amazon.com', 'Technology'],
  TSLA: ['Tesla Inc.', 'Consumer'], JPM: ['JPMorgan Chase', 'Financials'],
  BAC: ['Bank of America', 'Financials'], V: ['Visa Inc.', 'Financials'],
}
const ALL_TICKERS = Object.keys(TICKER_NAMES)
// Context for dynamic ticker names (includes custom tickers added at runtime)
const TickerNamesCtx = createContext<Record<string, [string, string]>>(TICKER_NAMES)
const SECTOR_COLOR: Record<string, string> = {
  Technology: '#38BDF8', Semiconductors: '#A78BFA', Consumer: '#34D399', Financials: '#FBBF24',
  Communications: '#FB923C', Healthcare: '#4ADE80', Energy: '#FCD34D', Industrials: '#94A3B8',
  Materials: '#86EFAC', 'Real Estate': '#F9A8D4', Utilities: '#67E8F9', Equity: '#A5B4FC', Custom: '#A5B4FC',
}
// Darker analogues for light mode — same hue family as SECTOR_COLOR, tuned for
// readability as a direct text color (not just a tinted background) against
// the light-blue page background. Mirrors the TICKER_COLORS/TICKER_COLORS_LIGHT pattern.
const SECTOR_COLOR_LIGHT: Record<string, string> = {
  Technology: '#0369A1', Semiconductors: '#6D28D9', Consumer: '#065F46', Financials: '#92400E',
  Communications: '#9A3412', Healthcare: '#166534', Energy: '#78350F', Industrials: '#334155',
  Materials: '#14532D', 'Real Estate': '#9D174D', Utilities: '#155E75', Equity: '#3730A3', Custom: '#3730A3',
}
function getSectorColor(sector: string, isDark = true): string {
  return (isDark ? SECTOR_COLOR : SECTOR_COLOR_LIGHT)[sector] ?? SECTOR_COLOR.Custom
}
// Per-ticker line colors — must match _TICKER_COLOR_MAP in alpha_flow/analysis/figures.py
// Alphabetical sorted assignment: AAPL(0) … V(9)
const TICKER_COLORS: Record<string, string> = {
  AAPL: '#79c0ff', AMZN: '#56d364', BAC: '#ffa657', GOOGL: '#f78166', JPM: '#d2a8ff',
  META: '#58a6ff', MSFT: '#3fb950', NVDA: '#e3b341', TSLA: '#ff7b72', V: '#bc8cff',
}
// High-contrast dark variants for light mode (same hues, much darker for readability)
const TICKER_COLORS_LIGHT: Record<string, string> = {
  AAPL: '#0369A1', AMZN: '#166534', BAC: '#9A3412', GOOGL: '#991B1B', JPM: '#6D28D9',
  META: '#1D4ED8', MSFT: '#065F46', NVDA: '#92400E', TSLA: '#9B1C1C', V: '#5B21B6',
}
// Rotating palette for custom tickers (beyond the default 10)
const EXTRA_COLORS       = ['#a5f3fc', '#fde68a', '#d9f99d', '#fbcfe8', '#e9d5ff', '#fed7aa', '#fecaca', '#bfdbfe']
const EXTRA_COLORS_LIGHT = ['#0C4A6E', '#14532D', '#713F12', '#7F1D1D', '#4C1D95', '#1E3A5F', '#064E3B', '#78350F']
function getTickerColor(ticker: string, isDark = true): string {
  if (isDark) {
    if (TICKER_COLORS[ticker]) return TICKER_COLORS[ticker]
    const idx = ticker.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % EXTRA_COLORS.length
    return EXTRA_COLORS[idx]
  } else {
    if (TICKER_COLORS_LIGHT[ticker]) return TICKER_COLORS_LIGHT[ticker]
    const idx = ticker.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % EXTRA_COLORS_LIGHT.length
    return EXTRA_COLORS_LIGHT[idx]
  }
}
// Helper: format very small numbers in scientific notation with Unicode superscripts
const SUPERSCRIPT_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹'

// ── Polling cadence (ms) ─────────────────────────────────────────────────────
// UI-responsiveness choices — how often the frontend re-polls a cheap backend
// endpoint. Not quant parameters (those live in AlphaFlow/alpha_flow/config/
// settings.py) — centralised here so cadence tuning happens in one place
// instead of scattered magic numbers at each useQuery call.
const POLL_HEALTH_MS                = 30_000  // /health — cheap liveness check
const POLL_HISTORY_MS               = 5_000   // /api/history (main banner) — drives "isRunning"
const POLL_HISTORY_PANEL_MS         = 10_000  // /api/history (History panel's own query)
const POLL_ALL_SIGNALS_MS           = 10_000  // /api/signals/all — Daily signal cards
const POLL_OUTPUTS_MS               = 10_000  // /api/outputs — figures/report listing (Daily)
const POLL_REPORT_MS                = 15_000  // /api/outputs/<report>.json — Daily JSON report body
const POLL_DAILY_PROGRESS_MS        = 2_000   // /api/daily/progress — live per-ticker Daily progress
const POLL_INTRADAY_PROGRESS_MS     = 2_000   // /api/intraday/progress — live per-ticker Hourly progress
const POLL_INTRADAY_SIGNALS_FAST_MS = 3_000   // /api/intraday/signals + SHAP — while a Hourly run is active
const POLL_INTRADAY_SIGNALS_IDLE_MS = 10_000  // same endpoints, once idle
const POLL_OFI_TIMESERIES_MS        = 60_000  // /api/data/ofi-timeseries — Alpha Decay chart panel
const STALE_OFI_TIMESERIES_MS       = 30_000
const POLL_TICKERS_MS                = 60_000 // /api/tickers — ticker registry (rarely changes)
const STALE_TICKERS_MS               = 30_000
const STALE_CHART_DATA_MS           = 120_000 // 2 min — per-ticker chart endpoints (execution quality, Kyle λ,
                                               // alpha decay, Hawkes, VWAP-z, VPIN, alpha-decay-P3): moderately
                                               // expensive to recompute, don't need to refresh every re-render
const STALE_EXPENSIVE_COMPUTE_MS    = 300_000 // 5 min — heavier computations (feature-correlation matrix, LGBM
                                               // scatter, walk-forward equity curve) + historical run signals
                                               // (immutable once a past run is fetched)
const STALE_SHAP_DEPENDENCE_MS      = 600_000 // 10 min — SHAP dependence plot, heaviest per-(ticker,feature) query
const STALE_PAPER_TRADES_MS         = 30_000  // paper-trading blotter — changes as fills happen
const STALE_TRADE_PNL_MS            = 60_000  // paper P&L rollup

function fmtSmall(v: number, decimals = 2): string {
  if (v !== 0 && Math.abs(v) < 0.001) {
    const exp = Math.floor(Math.log10(Math.abs(v)))
    const mantissa = (v / Math.pow(10, exp)).toFixed(decimals)
    const expStr = String(Math.abs(exp)).split('').map(d => SUPERSCRIPT_DIGITS[+d]).join('')
    return `${mantissa}×10${exp < 0 ? '⁻' : ''}${expStr}`
  }
  return v.toFixed(4)
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    // If string already has a timezone offset (+00:00 or Z) use it as-is.
    // Otherwise append Z (UTC) so the browser doesn't treat it as local time.
    const hasOffset = iso.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(iso)
    const raw = hasOffset ? iso : (iso.includes('T') ? iso + 'Z' : iso + 'T00:00:00Z')
    const d = new Date(raw)
    if (isNaN(d.getTime())) return iso   // guard: never show "Invalid Date"
    return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' }) + ' UTC'
  } catch { return iso }
}
function nowUTC() {
  return new Date().toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC'
}

// ── Components ───────────────────────────────────────────────────────────────
function Card({ title, children, accent = false, right }: { title: React.ReactNode; children: React.ReactNode; accent?: boolean; right?: React.ReactNode }) {
  const S = useS()
  const [hov, setHov] = useState(false)
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ background: S.glassBg, backdropFilter: 'blur(18px) saturate(160%)', WebkitBackdropFilter: 'blur(18px) saturate(160%)', border: `1px solid ${accent ? S.primary : (hov ? S.primary + '55' : S.glassBorder)}`, borderRadius: 14, padding: 20, marginBottom: 16, transform: hov ? 'translateY(-2px)' : 'none', boxShadow: hov ? '0 14px 38px rgba(0,0,0,0.22)' : S.glassShadow, transition: 'transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <h2 style={{ color: S.primary, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0 }}>{title}</h2>
        {right}
      </div>
      {children}
    </div>
  )
}

function StatusBadge({ s }: { s: string }) {
  const S = useS()
  const m: Record<string, [string, string]> = {
    ok: [S.success, S.successText], running: [S.tag, S.primary], error: [S.error, S.errorText],
  }
  const [bg, fg] = m[s] ?? [S.tag, S.primary]
  return <span style={{ background: bg, color: fg, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{s}</span>
}

function SignalBadge({ sig }: { sig: string }) {
  const S = useS()
  const m: Record<string, [string, string]> = {
    BUY: [S.buyBg, S.buyText], SELL: [S.sellBg, S.sellText], HOLD: [S.holdBg, S.holdText],
  }
  const [bg, fg] = m[sig?.toUpperCase()] ?? [S.tag, S.muted]
  return <span style={{ background: bg, color: fg, fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 5, letterSpacing: '0.08em' }}>{sig?.toUpperCase() ?? '—'}</span>
}

// Tooltip: hover-only, no pinning
function Tooltip({ children, content }: { children: React.ReactElement; content: React.ReactNode }) {
  const S = useS()
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const enhanced = cloneElement(children, {
    onMouseMove: (e: React.MouseEvent) => {
      setPos({ x: e.clientX + 14, y: e.clientY + 14 })
      children.props.onMouseMove?.(e)
    },
    onMouseLeave: (e: React.MouseEvent) => {
      setPos(null)
      children.props.onMouseLeave?.(e)
    },
    style: { ...children.props.style, cursor: children.props.style?.cursor ?? 'help' },
  })
  return (
    <>
      {enhanced}
      {pos && createPortal(
        <div style={{ position: 'fixed', left: Math.min(pos.x, window.innerWidth - 330), top: Math.min(pos.y, window.innerHeight - 240), background: S.tipBg, border: `1px solid ${S.tipBorder}`, borderRadius: 9, padding: '10px 14px', maxWidth: 310, zIndex: 9999, pointerEvents: 'none', boxShadow: '0 12px 40px rgba(0,0,0,0.4)', fontSize: 12, color: '#CBD5E1' }}>
          {content}
        </div>,
        document.body
      )}
    </>
  )
}

// Shared styled date input with calendar icon — works in Chrome/Safari/macOS
function DateInput({ value, min, max, onChange, label }: { value: string; min?: string; max?: string; onChange: (v: string) => void; label?: string }) {
  const S = useS()
  const isDark = useIsDark()
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
      {label && <span style={{ color: S.muted, fontSize: 9 }}>{label}</span>}
      <span style={{ fontSize: 12, opacity: 0.6 }}></span>
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={e => onChange(e.target.value)}
        style={{
          background: S.surface, color: S.text,
          border: `1px solid ${S.border}`, borderRadius: 6,
          padding: '3px 6px', fontSize: 10, outline: 'none',
          cursor: 'pointer', minWidth: 110,
          colorScheme: isDark ? 'dark' : 'light',
        }}
      />
    </label>
  )
}

function Lightbox({ src, title, onClose }: { src: string; title: string; onClose: () => void }) {
  const S = useS()
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(2,8,23,0.97)', zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out', padding: 24 }}>
      <img src={src} alt={title} onClick={e => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 10, border: `1px solid ${S.border}`, objectFit: 'contain', cursor: 'default' }} />
      <p style={{ color: S.muted, fontSize: 12, marginTop: 14 }}>{title.replace('.png', '').replace(/_/g, ' ')}</p>
      <button onClick={onClose} style={{ position: 'fixed', top: 16, right: 20, background: S.surface, color: S.text, border: `1px solid ${S.border}`, borderRadius: 8, padding: '6px 16px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>ESC ✕</button>
    </div>
  )
}

// Interactive Recharts OFI Z-score chart with ticker toggle + date range calendar picker
// Shared Alpaca paper-trading setup guide (used in two places in the Paper Portfolio panel)
function AlpacaSetupGuide({ S, open = false, hint }: { S: Theme; open?: boolean; hint: string }) {
  const codeInline = { background: S.surface, padding: '1px 4px', borderRadius: 3, fontSize: 9 } as const
  const codeBlock = { display: 'block', background: '#0B1120', padding: '3px 8px', borderRadius: 4, marginTop: 3, fontSize: 9, fontFamily: 'monospace', color: '#7DD3FC', whiteSpace: 'pre', border: '1px solid #1E3A5F' } as const
  return (
    <details open={open} style={{ marginTop: 8, borderRadius: 6, border: `1px solid ${S.border}` }}>
      <summary style={{ padding: '6px 10px', color: S.primary, fontSize: 10, fontWeight: 700, cursor: 'pointer', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
        Enable Paper Trading <span style={{ color: S.muted, fontWeight: 400, fontSize: 9 }}>▸ {hint}</span>
      </summary>
      <ol style={{ margin: '4px 0 8px', padding: '0 0 0 24px', color: S.text, fontSize: 10, lineHeight: 1.8 }}>
        <li>Create a free account at <strong>alpaca.markets</strong></li>
        <li>Switch to <strong>Paper Trading</strong> mode in the Alpaca dashboard</li>
        <li>Generate a new key pair from <em>API Keys → Paper Trading</em></li>
        <li>Add to <code style={codeInline}>AlphaFlow/.env</code>:<br/>
          <code style={codeBlock}>{`ALPACA_API_KEY=your_paper_key\nALPACA_SECRET_KEY=your_paper_secret`}</code>
        </li>
        <li>Restart: <code style={codeInline}>uvicorn backend.main:app --reload --port 8002</code></li>
        <li>Click <strong>Run Intraday</strong> to generate signals, then <strong>▶ Execute Signals</strong></li>
      </ol>
    </details>
  )
}

function OFIRechartsChart({ S, fullscreen = false }: { S: Theme; fullscreen?: boolean }) {
  const isDark = useIsDark()
  const tickerNames = useContext(TickerNamesCtx)
  const today = new Date().toISOString().slice(0, 10)
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 60); return d.toISOString().slice(0, 10)
  })
  const [endDate, setEndDate] = useState(today)
  const [hiddenTickers, setHiddenTickers] = useState<Set<string>>(new Set())

  function applyPreset(days: number) {
    const end = new Date().toISOString().slice(0, 10)
    const s = new Date(); s.setDate(s.getDate() - days)
    setStartDate(s.toISOString().slice(0, 10)); setEndDate(end)
  }

  const ofiQuery = useQuery({
    queryKey: ['ofiTimeseries', startDate, endDate],
    queryFn: () => axios.get(`/api/data/ofi-timeseries?start=${startDate}&end=${endDate}`).then(r => r.data as Record<string, { date: string; value: number }[]>),
    refetchInterval: POLL_OFI_TIMESERIES_MS,
    staleTime: STALE_OFI_TIMESERIES_MS,
  })

  const chartTickers = useMemo(() => {
    if (!ofiQuery.data) return ALL_TICKERS
    return Object.keys(ofiQuery.data).sort()
  }, [ofiQuery.data])

  const chartData = useMemo(() => {
    if (!ofiQuery.data) return []
    const allDates = [...new Set(
      Object.values(ofiQuery.data).flatMap((s: any[]) => s.map((d: any) => d.date))
    )].sort()
    return allDates.map(date => {
      const point: Record<string, any> = { date }   // full YYYY-MM-DD
      Object.entries(ofiQuery.data!).forEach(([ticker, series]) => {
        const found = (series as any[]).find((d: any) => d.date === date)
        if (found) point[ticker] = found.value
      })
      return point
    })
  }, [ofiQuery.data])

  function toggleTicker(t: string) {
    setHiddenTickers(prev => {
      const next = new Set(prev)
      if (next.has(t)) { next.delete(t) }
      else { if (next.size >= chartTickers.length - 1) return prev; next.add(t) }
      return next
    })
  }

  // On first load, default to the 8 strongest-signal tickers (by latest |OFI z|)
  // instead of overlaying all 50 lines — a readable default; every chip is still
  // one click away. Users can Show-all or toggle individually.
  const didInitDefault = useRef(false)
  useEffect(() => {
    if (didInitDefault.current || !ofiQuery.data) return
    didInitDefault.current = true
    const tks = Object.keys(ofiQuery.data)
    if (tks.length <= 8) return
    const latestAbs = (t: string) => {
      const s = ofiQuery.data![t]
      return s && s.length ? Math.abs(s[s.length - 1].value) : 0
    }
    const keep = new Set([...tks].sort((a, b) => latestAbs(b) - latestAbs(a)).slice(0, 8))
    setHiddenTickers(new Set(tks.filter(t => !keep.has(t))))
  }, [ofiQuery.data])

  const chartH = fullscreen ? 380 : 230

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
          {chartTickers.map(t => {
            const hidden = hiddenTickers.has(t)
            const col = getTickerColor(t)
            return (
              <button key={t} onClick={() => toggleTicker(t)} title={tickerNames[t]?.[0] ?? t}
                style={{ background: hidden ? 'transparent' : `${col}20`, color: hidden ? S.muted : col, border: `1.5px solid ${hidden ? S.border : col + '88'}`, borderRadius: 20, padding: '3px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s' }}>
                {t}
              </button>
            )
          })}
          {hiddenTickers.size > 0 && (
            <button onClick={() => setHiddenTickers(new Set())}
              style={{ background: 'transparent', color: S.muted, border: `1px solid ${S.border}`, borderRadius: 20, padding: '3px 10px', fontSize: 10, cursor: 'pointer' }}>All ✓</button>
          )}
        </div>
        {/* Date range controls */}
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          {([[30, '30D'], [60, '60D'], [90, '90D'], [365, '1Y']] as const).map(([days, label]) => (
            <button key={label} onClick={() => applyPreset(days)}
              style={{ background: 'transparent', color: S.muted, border: `1px solid ${S.border}`, borderRadius: 5, padding: '2px 8px', fontSize: 9, cursor: 'pointer', transition: 'all 0.15s' }}>
              {label}
            </button>
          ))}
          <span style={{ color: S.border, fontSize: 10, margin: '0 2px' }}>|</span>
          <DateInput value={startDate} max={endDate} onChange={setStartDate} label="From" />
          <span style={{ color: S.muted, fontSize: 10 }}>→</span>
          <DateInput value={endDate} max={today} min={startDate} onChange={setEndDate} label="To" />
        </div>
      </div>

      {ofiQuery.isLoading ? (
        <div style={{ height: chartH, display: 'flex', alignItems: 'center', justifyContent: 'center', color: S.muted, fontSize: 12, gap: 10, background: S.cardBg, borderRadius: 8 }}>
          <div style={{ width: 14, height: 14, borderWidth: 2, borderStyle: 'solid', borderColor: S.primary, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}></div>Loading OFI data…
        </div>
      ) : ofiQuery.isError || chartData.length === 0 ? (
        <div style={{ height: chartH, display: 'flex', alignItems: 'center', justifyContent: 'center', color: S.muted, fontSize: 12, fontStyle: 'italic', background: S.cardBg, borderRadius: 8 }}>
          {ofiQuery.isError ? 'Failed to load — run the pipeline first' : 'No data yet — run the pipeline first'}
        </div>
      ) : (
        <div style={{ background: S.cardBg, borderRadius: 8, padding: '8px 4px 4px', border: `1px solid ${S.border}` }}>
          <ResponsiveContainer width="100%" height={chartH}>
            <LineChart data={chartData} margin={{ top: 5, right: 16, bottom: 5, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={S.border} vertical={false} />
              <XAxis dataKey="date" tick={{ fill: S.muted, fontSize: 9 }} tickLine={false} axisLine={{ stroke: S.border }}
                interval={Math.max(0, Math.floor(chartData.length / 7) - 1)}
                tickFormatter={(v: string) => { const p = v.split('-'); return p.length === 3 ? `${p[1]}/${p[2]}/${p[0].slice(2)}` : v }} />
              <YAxis tick={{ fill: S.muted, fontSize: 9 }} tickLine={false} axisLine={false} domain={[-4, 4]} tickCount={9} />
              <RechartsTooltip
                contentStyle={{ background: S.tipBg, border: `1px solid ${S.tipBorder}`, borderRadius: 8, fontSize: 11, padding: '6px 12px' }}
                labelStyle={{ color: '#38BDF8', fontWeight: 700, marginBottom: 4 }}
                labelFormatter={(v: string) => { const p = v.split('-'); return p.length === 3 ? `${p[2]} ${['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+p[1]]} '${p[0].slice(2)}` : v }}
                itemStyle={{ padding: '1px 0', color: '#CBD5E1' }}
                formatter={(val: any, name: string) => [
                  <span key="v" style={{ color: getTickerColor(name, true), fontWeight: 700 }}>
                    <span style={{ opacity: 0.7, marginRight: 4 }}>{name}</span>{typeof val === 'number' ? val.toFixed(3) : val}
                  </span>,
                  null,
                ]}
              />
              <ReferenceLine y={1.5} stroke="#ffa657" strokeDasharray="5 3" strokeOpacity={0.7} strokeWidth={1} />
              <ReferenceLine y={-1.5} stroke="#ffa657" strokeDasharray="5 3" strokeOpacity={0.7} strokeWidth={1} />
              <ReferenceLine y={0} stroke={S.border} strokeWidth={1} />
              {chartTickers.map(t => (
                <Line key={t} type="monotone" dataKey={t}
                  stroke={getTickerColor(t)}
                  strokeWidth={1.6} dot={false}
                  hide={hiddenTickers.has(t)}
                  isAnimationActive={true} animationDuration={500}
                  connectNulls={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <p style={{ color: S.muted, fontSize: 9, textAlign: 'center', margin: '4px 0 0', opacity: 0.45 }}>
        ±1.5σ thresholds (amber dashed) · OFI Z = (V_buy − V_sell − μ₂₀) / σ₂₀ rolling 20-bar · {startDate} → {endDate}
      </p>
    </div>
  )
}

// ── Interactive chart helper (shared date+ticker controls) ───────────────────
function ChartDateTickers({ S, tickers, hidden, onToggle, onResetAll, startDate, endDate, setStart, setEnd }: {
  S: Theme; tickers: string[]; hidden: Set<string>; onToggle: (t: string) => void; onResetAll: () => void
  startDate: string; endDate: string; setStart: (d: string) => void; setEnd: (d: string) => void
}) {
  const tickerNames = useContext(TickerNamesCtx)
  const today = new Date().toISOString().slice(0, 10)
  function applyPreset(days: number) {
    const e = new Date().toISOString().slice(0, 10)
    const s = new Date(); s.setDate(s.getDate() - days)
    setStart(s.toISOString().slice(0, 10)); setEnd(e)
  }
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
      {tickers.map(t => {
        const h = hidden.has(t); const col = getTickerColor(t)
        return (
          <button key={t} onClick={() => onToggle(t)} title={tickerNames[t]?.[0] ?? t}
            style={{ background: h ? 'transparent' : `${col}20`, color: h ? S.muted : col, border: `1.5px solid ${h ? S.border : col + '88'}`, borderRadius: 20, padding: '3px 10px', fontSize: 10, fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s' }}>
            {t}
          </button>
        )
      })}
      {hidden.size > 0 && <button onClick={onResetAll} style={{ background: 'transparent', color: S.muted, border: `1px solid ${S.border}`, borderRadius: 20, padding: '3px 8px', fontSize: 10, cursor: 'pointer' }}>All ✓</button>}
      <span style={{ color: S.border, fontSize: 10, margin: '0 2px' }}>|</span>
      {[[30,'30D'],[90,'90D'],[252,'1Y'],[504,'2Y']].map(([d,l]) => (
        <button key={l} onClick={() => applyPreset(d as number)}
          style={{ background: 'transparent', color: S.muted, border: `1px solid ${S.border}`, borderRadius: 5, padding: '2px 7px', fontSize: 9, cursor: 'pointer' }}>{l}</button>
      ))}
      <DateInput value={startDate} max={endDate} min={undefined} onChange={setStart} label="From" />
      <span style={{ color: S.muted, fontSize: 10 }}>→</span>
      <DateInput value={endDate} max={today} min={startDate} onChange={setEnd} label="To" />
    </div>
  )
}

function ExecutionQualityChart({ S }: { S: Theme }) {
  const isDark = useIsDark()
  const [metric, setMetric] = useState<'spread' | 'amihud'>('spread')
  const [startDate, setStartDate] = useState(() => { const d = new Date(); d.setFullYear(d.getFullYear() - 2); return d.toISOString().slice(0, 10) })
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10))
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const q = useQuery({ queryKey: ['execQuality'], queryFn: () => axios.get('/api/data/execution-quality').then(r => r.data as { spread: Record<string, { date: string; value: number }[]>; amihud: Record<string, { date: string; value: number }[]> }), staleTime: STALE_CHART_DATA_MS })
  const tickers = useMemo(() => Object.keys(q.data?.[metric] ?? {}).sort(), [q.data, metric])
  const didInitDefault = useRef(false)
  useEffect(() => {
    if (didInitDefault.current || !q.data?.[metric]) return
    didInitDefault.current = true
    const tks = Object.keys(q.data[metric])
    if (tks.length <= 8) return
    const latestAbs = (t: string) => { const s = q.data![metric][t]; return s?.length ? Math.abs(s[s.length - 1].value) : 0 }
    const keep = new Set([...tks].sort((a, b) => latestAbs(b) - latestAbs(a)).slice(0, 8))
    setHidden(new Set(tks.filter(t => !keep.has(t))))
  }, [q.data, metric])
  const chartData = useMemo(() => {
    const src = q.data?.[metric]; if (!src) return []
    const dates = [...new Set(Object.values(src).flatMap((s: any[]) => s.filter((d: any) => d.date >= startDate && d.date <= endDate).map((d: any) => d.date)))].sort()
    return dates.map(date => {
      const pt: Record<string, any> = { date }   // full YYYY-MM-DD
      Object.entries(src).forEach(([t, arr]) => { const f = (arr as any[]).find(d => d.date === date); if (f) pt[t] = f.value })
      return pt
    })
  }, [q.data, metric, startDate, endDate])
  function toggleT(t: string) { setHidden(p => { const n = new Set(p); n.has(t) ? n.delete(t) : (n.size < tickers.length - 1 && n.add(t)); return n }) }
  return (
    <div>
      <div style={{ display: 'flex', gap: 5, marginBottom: 8 }}>
        {(['spread', 'amihud'] as const).map(m => (
          <button key={m} onClick={() => setMetric(m)} style={{ background: metric === m ? `${S.primary}22` : 'transparent', color: metric === m ? S.primary : S.muted, border: `1px solid ${metric === m ? S.primary + '55' : S.border}`, borderRadius: 6, padding: '3px 10px', fontSize: 10, fontWeight: metric === m ? 700 : 400, cursor: 'pointer' }}>
            {m === 'spread' ? 'Spread (bps)' : 'Amihud ILLIQ'}
          </button>
        ))}
      </div>
      <ChartDateTickers S={S} tickers={tickers} hidden={hidden} onToggle={toggleT} onResetAll={() => setHidden(new Set())} startDate={startDate} endDate={endDate} setStart={setStartDate} setEnd={setEndDate} />
      {q.isLoading ? <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: S.muted, fontSize: 12, background: S.cardBg, borderRadius: 8, gap: 8 }}><div style={{ width: 14, height: 14, borderWidth: 2, borderStyle: 'solid', borderColor: S.primary, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />Loading…</div>
      : chartData.length === 0 ? <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: S.muted, fontSize: 12, fontStyle: 'italic', background: S.cardBg, borderRadius: 8 }}>No data — run pipeline first</div>
      : <div style={{ background: S.cardBg, borderRadius: 8, padding: '8px 4px 4px', border: `1px solid ${S.border}` }}>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 5, right: 16, bottom: 5, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={S.border} vertical={false} />
              <XAxis dataKey="date" tick={{ fill: S.muted, fontSize: 9 }} tickLine={false} axisLine={{ stroke: S.border }} interval={Math.max(0, Math.floor(chartData.length / 7) - 1)}
                tickFormatter={(v: string) => { const p = v.split('-'); return p.length === 3 ? `${p[1]}/${p[2]}/${p[0].slice(2)}` : v }} />
              <YAxis tick={{ fill: S.muted, fontSize: 9 }} tickLine={false} axisLine={false} />
              <RechartsTooltip contentStyle={{ background: S.tipBg, border: `1px solid ${S.tipBorder}`, borderRadius: 8, fontSize: 11, padding: '6px 12px' }} labelStyle={{ color: '#38BDF8', fontWeight: 700, marginBottom: 4 }}
                labelFormatter={(v: string) => { const p = v.split('-'); return p.length === 3 ? `${p[2]} ${['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+p[1]]} '${p[0].slice(2)}` : v }}
                formatter={(val: any, name: string) => [<span key="v" style={{ color: getTickerColor(name, true), fontWeight: 700 }}><span style={{ opacity: 0.7, marginRight: 4 }}>{name}</span>{typeof val === 'number' ? (metric === 'spread' ? val.toFixed(1) : fmtSmall(val)) : val}</span>, null]} />
              {tickers.map(t => <Line key={t} type="monotone" dataKey={t} stroke={getTickerColor(t)} strokeWidth={1.5} dot={false} hide={hidden.has(t)} isAnimationActive animationDuration={500} />)}
            </LineChart>
          </ResponsiveContainer>
        </div>}
      <p style={{ color: S.muted, fontSize: 9, textAlign: 'center', margin: '4px 0 0', opacity: 0.45 }}>
        {metric === 'spread' ? 'Corwin-Schultz (2012) effective spread · bps per ticker' : 'Amihud (2002) ILLIQ · |return| / $1M traded · lower = more liquid'}
      </p>
    </div>
  )
}

function KyleLambdaChart({ S }: { S: Theme }) {
  const isDark = useIsDark()
  const [startDate, setStartDate] = useState(() => { const d = new Date(); d.setFullYear(d.getFullYear() - 2); return d.toISOString().slice(0, 10) })
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10))
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const q = useQuery({ queryKey: ['kyleLambda'], queryFn: () => axios.get('/api/data/kyle-lambda').then(r => r.data as Record<string, { date: string; lambda: number; roll30: number }[]>), staleTime: STALE_CHART_DATA_MS })
  const tickers = useMemo(() => Object.keys(q.data ?? {}).sort(), [q.data])
  const didInitDefault = useRef(false)
  useEffect(() => {
    if (didInitDefault.current || !q.data) return
    didInitDefault.current = true
    const tks = Object.keys(q.data)
    if (tks.length <= 8) return
    const latestAbs = (t: string) => { const s = q.data![t]; return s?.length ? Math.abs(s[s.length - 1].roll30) : 0 }
    const keep = new Set([...tks].sort((a, b) => latestAbs(b) - latestAbs(a)).slice(0, 8))
    setHidden(new Set(tks.filter(t => !keep.has(t))))
  }, [q.data])
  const chartData = useMemo(() => {
    if (!q.data) return []
    const dates = [...new Set(Object.values(q.data).flatMap((s: any[]) => s.filter((d: any) => d.date >= startDate && d.date <= endDate).map((d: any) => d.date)))].sort()
    return dates.map(date => {
      const pt: Record<string, any> = { date }   // full YYYY-MM-DD
      Object.entries(q.data!).forEach(([t, arr]) => { const f = (arr as any[]).find(d => d.date === date); if (f?.roll30 != null) pt[t] = f.roll30 })
      return pt
    })
  }, [q.data, startDate, endDate])
  function toggleT(t: string) { setHidden(p => { const n = new Set(p); n.has(t) ? n.delete(t) : (n.size < tickers.length - 1 && n.add(t)); return n }) }
  return (
    <div>
      <ChartDateTickers S={S} tickers={tickers} hidden={hidden} onToggle={toggleT} onResetAll={() => setHidden(new Set())} startDate={startDate} endDate={endDate} setStart={setStartDate} setEnd={setEndDate} />
      {q.isLoading ? <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: S.muted, fontSize: 12, background: S.cardBg, borderRadius: 8, gap: 8 }}><div style={{ width: 14, height: 14, borderWidth: 2, borderStyle: 'solid', borderColor: S.primary, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />Loading…</div>
      : chartData.length === 0 ? <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: S.muted, fontSize: 12, fontStyle: 'italic', background: S.cardBg, borderRadius: 8 }}>No data — run pipeline first</div>
      : <div style={{ background: S.cardBg, borderRadius: 8, padding: '8px 4px 4px', border: `1px solid ${S.border}` }}>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 5, right: 16, bottom: 5, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={S.border} vertical={false} />
              <XAxis dataKey="date" tick={{ fill: S.muted, fontSize: 9 }} tickLine={false} axisLine={{ stroke: S.border }} interval={Math.max(0, Math.floor(chartData.length / 7) - 1)}
                tickFormatter={(v: string) => { const p = v.split('-'); return p.length === 3 ? `${p[1]}/${p[2]}/${p[0].slice(2)}` : v }} />
              <YAxis tick={{ fill: S.muted, fontSize: 9 }} tickLine={false} axisLine={false} />
              <RechartsTooltip contentStyle={{ background: S.tipBg, border: `1px solid ${S.tipBorder}`, borderRadius: 8, fontSize: 11, padding: '6px 12px' }} labelStyle={{ color: '#38BDF8', fontWeight: 700, marginBottom: 4 }}
                labelFormatter={(v: string) => { const p = v.split('-'); return p.length === 3 ? `${p[2]} ${['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+p[1]]} '${p[0].slice(2)}` : v }}
                formatter={(val: any, name: string) => [<span key="v" style={{ color: getTickerColor(name, true), fontWeight: 700 }}><span style={{ opacity: 0.7, marginRight: 4 }}>{name}</span>{typeof val === 'number' ? fmtSmall(val) : val}</span>, null]} />
              {tickers.map(t => <Line key={t} type="monotone" dataKey={t} stroke={getTickerColor(t)} strokeWidth={1.5} dot={false} hide={hidden.has(t)} isAnimationActive animationDuration={500} />)}
            </LineChart>
          </ResponsiveContainer>
        </div>}
      <p style={{ color: S.muted, fontSize: 9, textAlign: 'center', margin: '4px 0 0', opacity: 0.45 }}>Kyle λ (1985) · 30-day rolling mean · $/share price impact per unit of order flow · rising λ = less liquid</p>
    </div>
  )
}

function AlphaDecayChart({ S }: { S: Theme }) {
  const isDark = useIsDark()
  const [sel, setSel] = useState('average')
  const tickerNames = useContext(TickerNamesCtx)
  const q = useQuery({ queryKey: ['alphaDecay'], queryFn: () => axios.get('/api/data/alpha-decay').then(r => r.data as { by_ticker: Record<string, Record<number, number>>; average: Record<number, number>; avg_half_life_ci?: { half_life: number; ci_5: number; ci_95: number }; per_ticker_ci?: Record<string, { half_life: number; ci_5: number; ci_95: number }> }), staleTime: STALE_CHART_DATA_MS })
  const [showAllDecay, setShowAllDecay] = useState(false)
  const tickers = useMemo(() => {
    const ci = q.data?.per_ticker_ci
    return Object.keys(q.data?.by_ticker ?? {}).sort((a, b) => {
      const ha = ci?.[a]?.half_life ?? Infinity
      const hb = ci?.[b]?.half_life ?? Infinity
      return ha - hb || a.localeCompare(b)
    })
  }, [q.data])
  const visibleTickers = showAllDecay ? tickers : tickers.slice(0, 10)
  const chartData = useMemo(() => {
    if (!q.data) return []
    const src = sel === 'average' ? q.data.average : (q.data.by_ticker[sel] ?? q.data.average)
    return Array.from({ length: 10 }, (_, i) => i + 1).map(lag => ({ lag: `${lag}h`, ic: src[lag] ?? 0 }))
  }, [q.data, sel])

  // Fit exponential decay: |IC(k)| ≈ IC₀ · exp(−λk) via log-linear OLS
  const decayFit = useMemo(() => {
    const valid = chartData.filter(d => Math.abs(d.ic) > 0.005)
    if (valid.length < 3) return null
    const xs = valid.map((_, i) => i + 1)
    const ys = valid.map(d => Math.log(Math.abs(d.ic)))
    const n = xs.length
    const sx = xs.reduce((a, b) => a + b, 0)
    const sy = ys.reduce((a, b) => a + b, 0)
    const sxy = xs.reduce((s, x, i) => s + x * ys[i], 0)
    const sx2 = xs.reduce((s, x) => s + x * x, 0)
    const denom = n * sx2 - sx * sx
    if (Math.abs(denom) < 1e-10) return null
    const b = (n * sxy - sx * sy) / denom  // slope (negative = decay)
    const a = (sy - b * sx) / n             // intercept = ln(IC₀)
    const IC0 = Math.exp(a)
    const lambda = -b
    if (lambda <= 0 || IC0 <= 0 || IC0 > 0.5) return null
    const halfLife = Math.log(2) / lambda
    return { IC0, lambda, halfLife, b }
  }, [chartData])

  // Merge decay curve into bar data
  const combined = useMemo(() =>
    chartData.map((d, i) => ({
      ...d,
      decay: decayFit ? parseFloat((decayFit.IC0 * Math.exp(decayFit.b * (i + 1))).toFixed(5)) : undefined,
    })), [chartData, decayFit])

  const halfLifeLabel = decayFit
    ? decayFit.halfLife < 1
      ? `< 1d half-life`
      : decayFit.halfLife > 10
      ? `> 10d half-life (slow decay)`
      : `~${decayFit.halfLife.toFixed(1)}d half-life`
    : null

  return (
    <div>
      <div style={{ display: 'flex', gap: 5, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={() => setSel('average')} style={{ background: sel === 'average' ? S.primary : S.surface, color: sel === 'average' ? '#fff' : S.muted, border: `1.5px solid ${sel === 'average' ? S.primary : S.border}`, borderRadius: 20, padding: '3px 12px', fontSize: 10, fontWeight: sel === 'average' ? 700 : 500, cursor: 'pointer', transition: 'all 0.15s' }}>Avg</button>
        {visibleTickers.map(t => <button key={t} onClick={() => setSel(t)} title={tickerNames[t]?.[0] ?? t} style={{ background: sel === t ? getTickerColor(t) : S.surface, color: sel === t ? '#fff' : S.muted, border: `1.5px solid ${sel === t ? getTickerColor(t) : S.border}`, borderRadius: 20, padding: '3px 10px', fontSize: 10, fontWeight: sel === t ? 700 : 500, cursor: 'pointer', transition: 'all 0.15s' }}>{t}</button>)}
        {tickers.length > 10 && (
          <button onClick={() => setShowAllDecay(v => !v)}
            style={{ background: 'transparent', border: `1px solid ${S.border}`, color: S.primary, borderRadius: 20, padding: '3px 10px', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>
            {showAllDecay ? '▲ Fastest 10 Only' : `▼ Show All ${tickers.length}`}
          </button>
        )}
        {decayFit && halfLifeLabel && (() => {
          const ci = sel === 'average' ? q.data?.avg_half_life_ci : q.data?.per_ticker_ci?.[sel]
          const h = decayFit.halfLife
          const hlValue = h < 1 ? '<1d' : h > 10 ? '>10d' : `~${h.toFixed(1)}d`
          const regime = h < 2 ? { label: 'Microstructure ≤ 2d', color: S.primary }
            : h <= 6 ? { label: 'Short-term momentum 2-6d', color: S.warnVal }
            : { label: 'Slow-decay factor > 6d', color: S.positiveVal }
          const badge = (label: string, value: string, color: string) => (
            <div style={{ background: S.cardBg, border: `1px solid ${S.border}`, borderRadius: 6, padding: '4px 10px', fontSize: 10, minWidth: 76 }}>
              <div style={{ color: S.muted, fontSize: 8, marginBottom: 1 }}>{label}</div>
              <div style={{ color, fontWeight: 700, fontFamily: 'monospace', fontSize: 11 }}>{value}</div>
            </div>
          )
          return (
            <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
              {badge('Half-Life', hlValue, S.warnVal)}
              {badge('Decay λ', `${decayFit.lambda.toFixed(3)}/d`, S.muted)}
              {ci && badge('95% CI', `${ci.ci_5.toFixed(1)}–${ci.ci_95.toFixed(1)}d`, S.muted)}
              {badge('Regime', regime.label, regime.color)}
            </div>
          )
        })()}
      </div>
      {q.isLoading ? <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: S.muted, fontSize: 12, background: S.cardBg, borderRadius: 8, gap: 8 }}><div style={{ width: 14, height: 14, borderWidth: 2, borderStyle: 'solid', borderColor: S.primary, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />Loading…</div>
      : combined.length === 0 ? <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: S.muted, fontSize: 12, fontStyle: 'italic', background: S.cardBg, borderRadius: 8 }}>No data — run pipeline first</div>
      : <div style={{ background: S.cardBg, borderRadius: 8, padding: '8px 4px 4px', border: `1px solid ${S.border}` }}>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={combined} margin={{ top: 5, right: 16, bottom: 24, left: 18 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={S.border} vertical={false} />
              <XAxis dataKey="lag" tick={{ fill: S.muted, fontSize: 9 }} tickLine={false} axisLine={{ stroke: S.border }}
                label={{ value: 'Lag (trading days)', position: 'insideBottom', offset: -14, fill: S.muted, fontSize: 9 }} />
              <YAxis tick={{ fill: S.muted, fontSize: 9 }} tickLine={false} axisLine={false}
                domain={[(dataMin: number) => { const m = Math.abs(dataMin); return -(Math.max(m, 0.005) * 1.4); }, (dataMax: number) => Math.max(dataMax, 0.005) * 1.4]}
                tickFormatter={(v: number) => `${(v * 100).toFixed(1)}%`}
                label={{ value: 'IC %', angle: -90, position: 'insideLeft', offset: 14, fill: S.muted, fontSize: 9, dx: -4 }} />
              <RechartsTooltip
                contentStyle={{ background: S.tipBg, border: `1px solid ${S.tipBorder}`, borderRadius: 8, fontSize: 11, padding: '8px 12px', maxWidth: 300 }}
                labelStyle={{ color: '#38BDF8', fontWeight: 700, marginBottom: 4 }}
                itemStyle={{ color: '#CBD5E1' }}
                formatter={(val: any, name: string, item: any) => {
                  const v = Number(val)
                  const lag = item?.payload?.lag ?? ''
                  if (name === 'decay') {
                    return [`${(v * 100).toFixed(2)}%`, `Fitted decay envelope at ${lag}`]
                  }
                  const pct = (v * 100).toFixed(2)
                  const interp = Math.abs(v) < 0.01
                    ? `Noise at ${lag} — no predictive power at this horizon. Daily IC ≈ 0% is expected.`
                    : Math.abs(v) >= 0.05
                    ? `Significant at ${lag}: IC = ${pct}% (above 5% threshold, Grinold & Kahn 2000).`
                    : `Weak at ${lag}: IC = ${pct}% — below 5% significance.`
                  return [<span key="v" style={{ color: v >= 0 ? '#56d364' : '#f78166', fontWeight: 700, display: 'block', marginBottom: 3 }}>{pct}%</span>, interp]
                }} />
              <ReferenceLine y={0.05} stroke={S.warnVal} strokeDasharray="5 3" strokeOpacity={0.7} strokeWidth={1}
                label={{ value: '5% sig.', fill: S.warnVal, fontSize: 8, position: 'insideTopRight' }} />
              <ReferenceLine y={-0.05} stroke={S.warnVal} strokeDasharray="5 3" strokeOpacity={0.7} strokeWidth={1} />
              <ReferenceLine y={0} stroke={S.border} strokeWidth={1} />
              {decayFit && decayFit.halfLife >= 1 && decayFit.halfLife <= 10 && (
                <ReferenceLine
                  x={`${Math.round(decayFit.halfLife)}h`}
                  stroke={S.warnVal}
                  strokeDasharray="5 2"
                  strokeOpacity={0.65}
                  strokeWidth={1.5}
                  label={{ value: `t½≈${decayFit.halfLife.toFixed(1)}d`, fill: S.warnVal, fontSize: 8, position: 'insideTopLeft', dy: -12 }}
                />
              )}
              <Bar dataKey="ic" isAnimationActive animationDuration={600} radius={[3, 3, 0, 0]}>
                {combined.map((e, i) => <Cell key={i} fill={Math.abs(e.ic) >= 0.05 ? S.positiveVal : Math.abs(e.ic) >= 0.02 ? S.warnVal : S.muted} fillOpacity={0.9} />)}
              </Bar>
              {decayFit && (
                <Line dataKey="decay" type="monotone" stroke={isDark ? '#e2e8f0' : '#1E3A5F'} strokeWidth={1.5}
                  strokeDasharray="4 3" dot={false} strokeOpacity={0.65}
                  name="decay" isAnimationActive={false} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>}
      <p style={{ color: S.muted, fontSize: 9, textAlign: 'center', margin: '4px 0 0', opacity: 0.45 }}>
        IC expressed as % of Spearman ρ · OFI Z vs forward returns · ±5% = Grinold-Kahn significance · dashed = fitted exp. decay{halfLifeLabel ? ` · ${halfLifeLabel}` : ''}
      </p>
      <p style={{ color: S.muted, fontSize: 8, textAlign: 'center', margin: '2px 0 0', opacity: 0.35 }}>
        Necessity: IC half-life determines rebalancing frequency — if IC → 0 by lag 2, daily rebalance required; persists to lag 5+ → weekly is sufficient
      </p>
    </div>
  )
}

// Generic full-screen chart overlay — ESC or button to close
function ChartLightbox({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const S = useS()
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(2,8,23,0.97)', zIndex: 1000, display: 'flex', flexDirection: 'column', padding: '20px 28px', overflowY: 'auto' }}>
      <div style={{ maxWidth: 1300, width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ color: S.primary, fontSize: 18, fontWeight: 800, margin: 0 }}>{title}</h2>
          <button onClick={onClose} style={{ background: S.surface, color: S.text, border: `1px solid ${S.border}`, borderRadius: 8, padding: '7px 20px', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>ESC ✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ── Expandable pipeline history panel ───────────────────────────────────────
function HistoryPanel({ S, qc }: { S: Theme; qc: ReturnType<typeof useQueryClient> }) {
  const [isListOpen, setIsListOpen] = useState(false)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [openModal, setOpenModal] = useState<number | null>(null)
  const history = useQuery({
    queryKey: ['history'],
    queryFn: () => axios.get('/api/history?limit=10').then(r => r.data as any[]),
    refetchInterval: POLL_HISTORY_PANEL_MS,
  })

  function toggleRun(id: number) {
    setExpanded(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  const count = history.data?.length ?? 0

  return (
    <Card
      title="Run History"
      right={
        <button
          onClick={() => setIsListOpen(o => !o)}
          style={{ background: isListOpen ? `${S.primary}18` : 'transparent', color: S.primary, border: `1px solid ${isListOpen ? S.primary + '55' : S.border}`, borderRadius: 7, padding: '5px 14px', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, transition: 'all 0.18s' }}>
          {count > 0 ? `${count} Run${count !== 1 ? 's' : ''}` : 'No Runs'}
          <span style={{ transform: isListOpen ? 'rotate(180deg)' : 'none', display: 'inline-block', transition: 'transform 0.2s', fontSize: 10 }}>▼</span>
        </button>
      }
    >
      {openModal !== null && <RunModal runId={openModal} onClose={() => setOpenModal(null)} />}
      {!isListOpen ? (
        <p style={{ color: S.muted, fontSize: 12, margin: 0, opacity: 0.55, textAlign: 'center', padding: '10px 0' }}>
          {count > 0
            ? `${count} pipeline run${count !== 1 ? 's' : ''} recorded — click the button above to expand`
            : 'No runs yet — click Run Daily Scan above'}
        </p>
      ) : !history.data?.length ? (
        <p style={{ color: S.muted, fontStyle: 'italic', opacity: 0.5, fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
          No runs yet — click Run Daily Scan
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {history.data.map((row: any) => {
            const t0 = row.started_at ? new Date(row.started_at.endsWith('Z') ? row.started_at : row.started_at + 'Z') : null
            const t1 = row.finished_at ? new Date(row.finished_at.endsWith('Z') ? row.finished_at : row.finished_at + 'Z') : null
            const secs = t0 && t1 ? Math.round((t1.getTime() - t0.getTime()) / 1000) : null
            const dur = secs !== null ? (secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`) : '—'
            const isOpen = expanded.has(row.id)
            const isRunning = row.status === 'running' || row.status === 'pending'
            const accentCol = isRunning ? S.primary : row.status === 'failed' ? '#f78166' : '#56d364'
            return (
              <div key={row.id} style={{ border: `1px solid ${isOpen ? S.primary + '44' : S.border}`, borderRadius: 10, overflow: 'hidden', transition: 'border-color 0.2s' }}>
                {/* Header row */}
                <div
                  onClick={() => toggleRun(row.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', cursor: 'pointer', background: isOpen ? `${S.primary}08` : S.surface, transition: 'background 0.15s' }}
                  onMouseEnter={e => { if (!isOpen) (e.currentTarget as HTMLDivElement).style.background = `${S.primary}06` }}
                  onMouseLeave={e => { if (!isOpen) (e.currentTarget as HTMLDivElement).style.background = S.surface }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: accentCol, flexShrink: 0, boxShadow: isRunning ? `0 0 8px ${accentCol}88` : 'none' }} />
                  <span style={{ color: S.text, fontWeight: 700, fontSize: 12, flex: 1 }}>{formatTime(row.started_at)}</span>
                  <StatusBadge s={row.status || 'running'} />
                  <span style={{ color: S.muted, fontSize: 10, background: `${S.primary}15`, border: `1px solid ${S.primary}33`, borderRadius: 4, padding: '1px 7px', fontWeight: 600 }}>#{row.id}</span>
                  <span style={{ color: S.muted, fontSize: 11 }}>⏱ {dur}</span>
                  <button
                    onClick={e => { e.stopPropagation(); setOpenModal(row.id) }}
                    style={{ background: 'transparent', color: S.primary, border: `1px solid ${S.border}`, borderRadius: 6, padding: '3px 10px', fontSize: 10, cursor: 'pointer', fontWeight: 600 }}>
                    Full Detail →
                  </button>
                  <span style={{ color: S.muted, fontSize: 14, fontWeight: 700, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', display: 'inline-block' }}>⌄</span>
                </div>

                {/* Expanded content */}
                {isOpen && <HistoryRunDetail S={S} runId={row.id} />}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

function HistoryRunDetail({ S, runId }: { S: Theme; runId: number }) {
  const tickerNames = useContext(TickerNamesCtx)
  const signalsQ = useQuery({
    queryKey: ['runSignals', runId],
    queryFn: () => axios.get(`/api/history/${runId}/signals`).then(r => r.data as any[]),
    staleTime: STALE_EXPENSIVE_COMPUTE_MS,
  })
  const [tab, setTab] = useState<'signals' | 'ofi' | 'charts'>('signals')

  const signals = signalsQ.data ?? []
  const BUY = signals.filter((s: any) => s.signal === 'BUY')
  const SELL = signals.filter((s: any) => s.signal === 'SELL')
  const HOLD = signals.filter((s: any) => s.signal === 'HOLD')

  return (
    <div style={{ borderTop: `1px solid ${S.border}`, padding: '14px 16px', background: S.bg }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {(['signals', 'ofi', 'charts'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ background: tab === t ? S.primary : S.surface, color: tab === t ? '#fff' : S.muted, border: `1px solid ${tab === t ? S.primary : S.border}`, borderRadius: 7, padding: '5px 16px', fontSize: 11, fontWeight: tab === t ? 700 : 500, cursor: 'pointer', textTransform: 'capitalize', transition: 'all 0.15s' }}>
            {t === 'signals' ? 'Signal Cards' : t === 'ofi' ? 'OFI Z-Score' : 'All Charts'}
          </button>
        ))}
      </div>

      {signalsQ.isLoading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: S.muted, fontSize: 12 }}>
          <div style={{ width: 12, height: 12, borderWidth: 2, borderStyle: 'solid', borderColor: S.primary, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          Loading run data…
        </div>
      )}

      {!signalsQ.isLoading && tab === 'signals' && (
        <div>
          {signals.length === 0
            ? <p style={{ color: S.muted, fontStyle: 'italic', fontSize: 12 }}>No signals saved for this run</p>
            : (
              <div>
                {/* Summary counts */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  {[['BUY', BUY.length, S.buyBg, S.buyText], ['HOLD', HOLD.length, S.holdBg, S.holdText], ['SELL', SELL.length, S.sellBg, S.sellText]].map(([sig, cnt, bg, col]) => (
                    <span key={sig as string} style={{ background: bg as string, color: col as string, borderRadius: 20, padding: '3px 12px', fontSize: 11, fontWeight: 700 }}>
                      {sig} {cnt}
                    </span>
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
                  {signals.map((s: any) => {
                    const col = getTickerColor(s.ticker)
                    const ofi = Number(s.ofi ?? 0)
                    const ofiDir = ofi > 0.15 ? '▲' : ofi < -0.15 ? '▼' : '→'
                    const ofiColor = ofi > 0.15 ? S.positiveVal : ofi < -0.15 ? S.negativeVal : S.muted
                    return (
                      <div key={s.ticker} style={{ background: S.surface, border: `1px solid ${col}`, borderRadius: 8, padding: '10px 12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                          <span title={tickerNames[s.ticker]?.[0] ?? s.ticker} style={{ color: S.text, fontWeight: 800, fontSize: 13 }}>{s.ticker}</span>
                          <SignalBadge sig={s.signal ?? 'HOLD'} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '3px 6px', fontSize: 10 }}>
                          <span style={{ color: S.muted }}>OFI Z</span>
                          <span style={{ color: ofiColor, fontWeight: 600, textAlign: 'right' }}>{ofiDir} {ofi.toFixed(3)}</span>
                          <span style={{ color: S.muted }}>Spread</span>
                          <span style={{ color: S.text, textAlign: 'right' }}>{Number(s.eff_spread_bps ?? 0).toFixed(1)} bps</span>
                          <span style={{ color: S.muted }}>Kyle λ</span>
                          <span style={{ color: S.text, textAlign: 'right' }}>{fmtSmall(Number(s.kyle_lambda ?? 0))}</span>
                          <span style={{ color: S.muted }}>Amihud</span>
                          <span style={{ color: S.text, textAlign: 'right' }}>{fmtSmall(Number(s.amihud_illiq ?? 0))}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
        </div>
      )}

      {!signalsQ.isLoading && tab === 'ofi' && (
        <div style={{ background: S.surface, borderRadius: 8, padding: 14 }}>
          <OFIRechartsChart S={S} />
        </div>
      )}

      {!signalsQ.isLoading && tab === 'charts' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
          <div style={{ background: S.surface, borderRadius: 8, padding: 14 }}>
            <p style={{ color: S.muted, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', margin: '0 0 10px', letterSpacing: '0.08em' }}>Execution Quality</p>
            <ExecutionQualityChart S={S} />
          </div>
          <div style={{ background: S.surface, borderRadius: 8, padding: 14 }}>
            <p style={{ color: S.muted, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', margin: '0 0 10px', letterSpacing: '0.08em' }}>Kyle λ Trend</p>
            <KyleLambdaChart S={S} />
          </div>
          <div style={{ background: S.surface, borderRadius: 8, padding: 14, gridColumn: '1 / -1' }}>
            <p style={{ color: S.muted, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', margin: '0 0 10px', letterSpacing: '0.08em' }}>Alpha Decay (IC Lags 1–10)</p>
            <AlphaDecayChart S={S} />
          </div>
        </div>
      )}
    </div>
  )
}

function RunModal({ runId, onClose }: { runId: number; onClose: () => void }) {
  const S = useS()
  const tickerNames = useContext(TickerNamesCtx)
  const history = useQuery({ queryKey: ['history'], queryFn: () => axios.get('/api/history?limit=10').then(r => r.data as any[]) })
  const runSignals = useQuery({ queryKey: ['runSignals', runId], queryFn: () => axios.get(`/api/history/${runId}/signals`).then(r => r.data as any[]) })
  const run = history.data?.find((r: any) => r.id === runId)
  const [chartTab, setChartTab] = useState<'ofi' | 'execution' | 'lambda' | 'decay'>('ofi')
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [onClose])
  const chartTabs: { key: typeof chartTab; label: string }[] = [
    { key: 'ofi', label: 'OFI Z-Score' },
    { key: 'execution', label: 'Execution Quality' },
    { key: 'lambda', label: "Kyle's λ Trend" },
    { key: 'decay', label: 'Alpha Decay' },
  ]
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(2,8,23,0.96)', zIndex: 1001, overflowY: 'auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 20px' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: S.surface, border: `1px solid ${S.border}`, borderRadius: 14, padding: 28, maxWidth: 1100, width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h2 style={{ color: S.primary, fontSize: 18, fontWeight: 800, margin: 0 }}>Run #{runId} — Full Detail</h2>
            {run && <p style={{ color: S.muted, fontSize: 12, margin: '4px 0 0' }}>{formatTime(run.started_at)} · <StatusBadge s={run.status} /></p>}
          </div>
          <button onClick={onClose} style={{ background: S.tag, color: S.text, border: `1px solid ${S.border}`, borderRadius: 8, padding: '6px 18px', cursor: 'pointer', fontWeight: 700 }}>Close ✕</button>
        </div>

        {/* Signals */}
        <h3 style={{ color: S.muted, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 12px' }}>Ticker Signals</h3>
        {runSignals.isLoading && <p style={{ color: S.muted }}>Loading signals…</p>}
        {runSignals.data && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(185px, 1fr))', gap: 10, marginBottom: 28 }}>
            {(runSignals.data as any[]).map((s: any) => {
              const [name] = tickerNames[s.ticker] ?? [s.ticker, '']
              return (
                <div key={s.ticker} style={{ background: S.bg, border: `1px solid ${getTickerColor(s.ticker)}`, borderRadius: 8, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <div><span style={{ color: S.text, fontSize: 14, fontWeight: 800 }}>{s.ticker}</span><p style={{ color: S.muted, fontSize: 9, margin: '1px 0 0' }}>{name}</p></div>
                    <SignalBadge sig={s.signal ?? 'HOLD'} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 8px', marginBottom: 6 }}>
                    {[['OFI Z', Number(s.ofi ?? 0).toFixed(3)], ['Spread', `${Number(s.eff_spread_bps ?? 0).toFixed(1)} bps`], ['Kyle λ', fmtSmall(Number(s.kyle_lambda ?? 0))], ['Amihud', fmtSmall(Number(s.amihud_illiq ?? 0))]].map(([k, v]) => (
                      <React.Fragment key={k}>
                        <span style={{ color: S.muted, fontSize: 9 }}>{k}</span>
                        <span style={{ color: S.text, fontSize: 10, textAlign: 'right' }}>{v}</span>
                      </React.Fragment>
                    ))}
                  </div>
                  {s.llm_reason && !/NoneType|format string|Traceback|TypeError|AttributeError|unsupported format/i.test(s.llm_reason as string) && (
                    <p style={{ color: S.muted, fontSize: 9, margin: 0, lineHeight: 1.4, fontStyle: 'italic', borderTop: `1px solid ${S.border}33`, paddingTop: 5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                      {(s.llm_reason as string).replace(/LLM unavailable: Error code: \d+ - \{[\s\S]*\}/, 'Groq rate limit \u2014 re-run when tokens reset').replace(/LLM unavailable: /, '').slice(0, 130)}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Interactive charts — NOT stale PNG thumbnails */}
        <h3 style={{ color: S.muted, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 12px' }}>Live Signal Charts — Interactive</h3>
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          {chartTabs.map(({ key, label }) => (
            <button key={key} onClick={() => setChartTab(key)}
              style={{ background: chartTab === key ? S.primary : S.surface, color: chartTab === key ? '#fff' : S.muted, border: `1px solid ${chartTab === key ? S.primary : S.border}`, borderRadius: 7, padding: '6px 16px', fontSize: 11, fontWeight: chartTab === key ? 700 : 500, cursor: 'pointer', transition: 'all 0.15s' }}>
              {label}
            </button>
          ))}
        </div>
        <div style={{ background: S.bg, border: `1px solid ${S.border}`, borderRadius: 10, padding: 18 }}>
          {chartTab === 'ofi' && <OFIRechartsChart S={S} />}
          {chartTab === 'execution' && <ExecutionQualityChart S={S} />}
          {chartTab === 'lambda' && <KyleLambdaChart S={S} />}
          {chartTab === 'decay' && <AlphaDecayChart S={S} />}
        </div>
      </div>
    </div>
  )
}

// ── Tooltip content ──────────────────────────────────────────────────────────
const TIP_OFI = (<div><p style={{ color: '#38BDF8', fontSize: 11, fontWeight: 700, margin: '0 0 4px' }}>Order Flow Imbalance Z-score</p><p style={{ color: '#7DD3FC', fontSize: 10, fontFamily: 'monospace', margin: '0 0 5px' }}>OFI = V_buy − V_sell; Z = (OFI − μ₂₀)/σ₂₀</p><p style={{ color: '#CBD5E1', fontSize: 11, margin: 0 }}>Net buy vs sell volume pressure, rolling 20-bar. &gt;+1.5 = strong buying; &lt;−1.5 = strong selling.</p></div>)
const TIP_SPREAD = (<div><p style={{ color: '#38BDF8', fontSize: 11, fontWeight: 700, margin: '0 0 4px' }}>Corwin-Schultz Effective Spread</p><p style={{ color: '#7DD3FC', fontSize: 10, fontFamily: 'monospace', margin: '0 0 5px' }}>α = f(β, γ) of daily log(H/L) ratios</p><p style={{ color: '#CBD5E1', fontSize: 11, margin: 0 }}>Estimated cost to cross bid-ask spread (bps). S&P 500 large-caps: 5–25 bps typical. Red = elevated liquidity stress.</p><p style={{ color: '#F59E0B', fontSize: 9, margin: '5px 0 0', background: '#713f1222', padding: '4px 7px', borderRadius: 4 }}>⚠ Daily OHLCV estimate: daily bars over-estimate by ~15-25% vs intraday tick-derived spreads. Use as relative rank signal — not absolute cost for execution modelling.</p></div>)
const TIP_KYLE = (<div><p style={{ color: '#38BDF8', fontSize: 11, fontWeight: 700, margin: '0 0 4px' }}>Kyle&apos;s Lambda — Price Impact</p><p style={{ color: '#7DD3FC', fontSize: 10, fontFamily: 'monospace', margin: '0 0 5px' }}>&Delta;p_t = &lambda; &middot; OFI_t + &epsilon; (rolling 20-bar OLS)</p><p style={{ color: '#CBD5E1', fontSize: 11, margin: 0 }}>$/share price move per unit of net order flow. Higher &lambda; = each trade has more price impact = less liquid. <span style={{ opacity: 0.75 }}>Direction proxy: BVC (bar close vs open) — not tick-level Lee-Ready. Acceptable at hourly/daily resolution; production use requires real order-flow data.</span></p><p style={{ color: '#F59E0B', fontSize: 9, margin: '5px 0 0', background: '#713f1222', padding: '4px 7px', borderRadius: 4 }}>&oplus; Daily resolution proxy: production Kyle &lambda; uses tick-level signed flow (TAQ/ITCH). OHLCV BVC proxy adds ~20-30% estimation noise. Use for relative cross-sectional ranking, not absolute price-impact modelling.</p></div>)
const TIP_AMIHUD = (<div><p style={{ color: '#38BDF8', fontSize: 11, fontWeight: 700, margin: '0 0 4px' }}>Amihud Illiquidity Ratio</p><p style={{ color: '#7DD3FC', fontSize: 10, fontFamily: 'monospace', margin: '0 0 5px' }}>ILLIQ_t = |r_t| / DollarVolume_t</p><p style={{ color: '#CBD5E1', fontSize: 11, margin: '0 0 5px' }}>Price change per $1M of traded volume. Liquid large-caps &lt; 1×10⁻⁷. Spike = institutional block trade / low depth.</p></div>)
const TIP_SHARPE = (<div><p style={{ color: '#38BDF8', fontSize: 11, fontWeight: 700, margin: '0 0 4px' }}>Sharpe Ratio — Per Ticker (gross, pre-TC)</p><p style={{ color: '#7DD3FC', fontSize: 10, fontFamily: 'monospace', margin: '0 0 5px' }}>Sharpe = √252 × μ / σ (annualised)</p><p style={{ color: '#CBD5E1', fontSize: 11, margin: '0 0 5px' }}>Risk-adjusted return of each stock over the walk-forward test windows. Sharpe &gt; 1 = strong. Shown gross (pre-TC) — with ~52 bps spread cost and 2 trades/day, net Sharpe ≈ gross − 0.3.</p></div>)
const TIP_SEM = (<div><p style={{ color: '#38BDF8', fontSize: 11, fontWeight: 700, margin: '0 0 4px' }}>± Standard Error of the Mean (SEM)</p><p style={{ color: '#7DD3FC', fontSize: 10, fontFamily: 'monospace', margin: '0 0 5px' }}>SEM = σ(fold values) / √N folds</p><p style={{ color: '#CBD5E1', fontSize: 11, margin: 0 }}>Dispersion of the walk-forward MEAN estimate itself (not of individual folds). A tighter (smaller) SEM means the reported metric is a more reliable estimate. Roughly a ±1 SEM band; ×1.96 for a 95% CI.</p></div>)

const METRIC_META: Record<string, { label: string; unit: string; help: string; formula: string; ref: string }> = {
  avg_effective_spread_bps: { label: 'Eff. Spread', unit: 'bps', formula: 'Corwin-Schultz (2012)', help: 'Average C-S spread across the active universe. S&P 500: 5–25 bps typical. Daily OHLCV gives ~30–70 bps (wider than intraday).', ref: 'Corwin & Schultz, JF (2012)' },
  avg_amihud_illiq: { label: 'Amihud ILLIQ', unit: 'Δprice / $1M vol', formula: 'ILLIQ_t = |r_t| / DollarVol_t', help: 'Price impact per $1M of traded volume. Liquid large-caps < 1×10⁻⁷. Higher = less liquid.', ref: 'Amihud, JFM (2002)' },
  avg_kyle_lambda: { label: "Kyle's λ", unit: '$/share per OFI unit', formula: 'Δp_t = λ·x_t + ε (rolling OLS)', help: 'Price impact coefficient. Each unit of net order flow moves price by λ. Higher = less liquid market depth.', ref: 'Kyle, Econometrica (1985)' },
  avg_ofi_zscore: { label: 'OFI Z-Score', unit: 'cross-sect. avg (σ)', formula: 'Z_t = (OFI_t − μ₂₀) / σ₂₀', help: 'Cross-sectional average Order Flow Imbalance Z-score. Positive = net buying pressure across universe. |Z| > 1.5 = elevated imbalance. Raw signal input to LightGBM model. (Chordia et al. 2002)', ref: 'Chordia, Roll & Subrahmanyam (2002)' },
}

// Research Drawer metric explanations
const DRAWER_METRIC_META: Record<string, { label: string; unit: string; formula: string; help: string; ref: string }> = {
  IC:       { label: 'Information Coefficient (LightGBM Walk-Forward)', unit: 'Spearman ρ', formula: 'IC = Spearmanr(LightGBM_predicted_return, actual_return)', help: 'Mean walk-forward IC from the LightGBM regressor across all folds. Measures how accurately the model ranks next-bar returns. IC > 5% = statistically meaningful. Negative IC means the model consistently predicts the inverted direction — still usable by flipping the signal. Daily OFI IC ≈ 0 is expected (OHLCV cannot resolve intra-bar direction); hourly IC uses 13 microstructure features.', ref: 'Grinold & Kahn (2000) Active Portfolio Mgmt.' },
  Sharpe:   { label: 'Annualised Sharpe Ratio (gross, pre-TC)', unit: 'dimensionless', formula: 'Sharpe = mean(r) / std(r) × √252 × √6.5', help: 'Risk-adjusted annualised return from the walk-forward out-of-sample equity curve. Any positive Sharpe indicates the model earns more than it risks. > 1.0 = strong signal, > 2.0 = excellent. Near-zero is expected until live tick data improves model IC. Shown gross (pre-TC) — with ~52 bps C-S spread and 2 trades/day, expected net Sharpe ≈ gross − 0.3.', ref: 'Walk-Forward Validation' },
  'Max DD': { label: 'Maximum Drawdown', unit: '%', formula: 'MDD = min((Equity_t − Peak_t) / Peak_t)', help: 'Worst peak-to-trough equity loss in the walk-forward test period. Benchmarks: < 10% = excellent; 10–25% = acceptable; > 25% = needs review. At daily IC ≈ 0 the equity curve is near-random — expect 15–20% MDD, which shrinks as model IC improves with live intraday data.', ref: 'Grinold & Kahn (2000) Ch.14' },
  Folds:    { label: 'Walk-Forward Folds', unit: 'count', formula: 'folds = total_bars / (train_window + test_window)', help: 'Number of train/test windows in the walk-forward cross-validation. More folds = more statistically reliable IC estimate. Fold count varies per ticker (typically 19–27 folds on ≈2 years of hourly history) depending on each ticker’s actual available bar count — shown per-ticker on its snapshot card and Research Drawer. Prevents any look-ahead bias by construction.', ref: 'De Prado (2018) Advances in Financial ML, Ch.7' },
  'OFI Z':  { label: 'Order Flow Imbalance Z-Score', unit: 'σ', formula: 'OFI = (buy_vol − sell_vol) / total_vol; z-scored 20-bar rolling', help: 'Rolling z-score of net order flow pressure. Above +1.5σ = sustained buy pressure; below −1.5σ = sell pressure. Values near zero indicate balanced book. Primary directional signal at daily resolution; also an input feature to the hourly LightGBM model. Direction proxy: BVC (bar close vs open) — not tick-level Lee-Ready order-flow data; hourly bars are sourced primarily from yfinance (consolidated), with an Alpaca IEX fallback/live-stream path covering only ~2-5% of consolidated volume when active.', ref: 'Chordia, Roll & Subrahmanyam (2002)' },
  Spread:   { label: 'Corwin-Schultz Bid-Ask Spread', unit: 'basis points', formula: 'CS Spread = 2(eᵅ−1)/(1+eᵅ) from High/Low daily bars', help: 'Estimated transaction cost from OHLCV data — no TAQ or Level 2 data needed. S&P 500 range: 5–25 bps intraday; 30–70 bps from daily bars (wider due to aggregation). Lower = cheaper to execute.', ref: 'Corwin & Schultz (2012) J. Finance 67(2)' },
  'Kyle λ': { label: "Kyle's Lambda (Price Impact)", unit: '$/share per OFI unit', formula: 'λ = Cov(ΔPrice, OFI) / Var(OFI) via rolling OLS', help: "Price impact coefficient: each unit of net order flow moves price by λ. Measures market depth — higher λ = thinner book, more adverse selection risk. Large-caps typically λ < 1×10⁻⁶. Kyle (1985) showed informed traders' optimal strategy depends directly on this parameter. Direction proxy: BVC (bar close vs open) — not tick-level Lee-Ready; acceptable at daily/hourly bars.", ref: 'Kyle, Econometrica (1985)' },
}

const CHART_DESC: Record<string, { title: string; what: string; how: string }> = {
  'ofi_zscore_chart.png': { title: 'OFI Z-score Monitor', what: 'Net buy/sell pressure across all active tickers, last 60 bars. Amber dashed = ±1.5σ thresholds.', how: 'Rolling 20-bar OFI Z-score from daily OHLCV. Crossings above ±1.5σ trigger BUY/SELL. Click to expand + filter tickers.' },
  'execution_quality.png': { title: 'Execution Quality', what: 'Corwin-Schultz spread (bps) and Amihud illiquidity over 2 years.', how: 'Spread spikes = earnings/macro events. Amihud spikes = institutional block trades reducing market depth.' },
  'kyle_lambda_trend.png': { title: "Kyle's λ Trend", what: 'Price impact coefficient over 2 years (30-day rolling mean).', how: 'Rising λ = market depth declining. High λ periods = elevated institutional participation or low liquidity.' },
  'alpha_decay.png': { title: 'Alpha Decay (IC Lags 1–10)', what: 'Spearman IC between OFI Z-score and forward returns at 1–10 day horizons.', how: 'Rapid IC decay = microstructure alpha is short-lived (intraday only). Amber lines = ±0.05 significance.' },
}

type ChatMsg = { role: 'user' | 'assistant'; content: string }

// ── Tooltip component — shows explanation on hover ────────────────────────────
const TERM_TIPS: Record<string, string> = {
  // Daily reference set
  'OFI':           'Order Flow Imbalance (Chordia 2002): (buy_vol − sell_vol) / total_vol. Measures whether buyers or sellers are more aggressive. Range [−1, +1].',
  'OFI Z':         'Rolling z-score of OFI over 20 bars. Values above +1.5 = sustained buying pressure; below −1.5 = selling pressure.',
  'Kyle λ':        'Kyle\'s Lambda (Kyle 1985): λ = Cov(ΔPrice, OFI) / Var(OFI). Price impact per unit of net order flow. Higher λ = less liquid market.',
  'Amihud ILLIQ':  'Amihud (2002) illiquidity ratio: |r_t| / (Price_t × Volume_t). How much the price moves per $1M traded. Low = liquid (large-caps ≈ 1e-7).',
  'C-S Spread':    'Corwin-Schultz (2012) bid-ask spread estimate from High/Low bars. Spread = 2(eᵅ−1)/(1+eᵅ). Measures execution cost in basis points.',
  'IC':            'Information Coefficient: Spearman rank correlation between predicted return and actual return. IC > 0.05 = statistically useful signal.',
  'Sharpe':        'Annualised Sharpe ratio: mean(returns) / std(returns) × √252. Benchmarks: > 1.0 = strong, > 2.0 = excellent.',
  'Walk-Forward':  'Train on past N bars, test on next M bars, slide forward. Prevents look-ahead bias. More folds = more statistically reliable IC estimate.',
  // Hourly reference set
  'LGBMRegressor': 'LightGBM Gradient Boosting Regressor — predicts CONTINUOUS future return magnitude, not just direction. Enables proper IC measurement via Spearman correlation. ~17 walk-forward folds on 3,276 hourly bars.',
  'SHAP':          'SHapley Additive exPlanations (Lundberg & Lee 2017): how much each feature contributed to each prediction. Bars show mean |SHAP| across all test-fold predictions.',
  'VWAP':          'Volume Weighted Average Price: Σ(typical_price × vol) / Σ(vol), resetting each trading day. Institutional benchmark — deviations signal reversion opportunities.',
  'VWAP Z':        'VWAP deviation z-score: how many σ the current price is above/below VWAP. >+1.5σ = overbought (short); <−1.5σ = oversold (long).',
  'Hawkes':        'Hawkes process (Bacry 2015): λ(t) = μ + Σ α·e^(−β·Δt). Self-exciting point process — models how institutional orders trigger follow-on orders.',
  'Hawkes Z':      'Hawkes intensity z-score. High values = burst of order activity detected, likely institutional. Using Hawkes intensity as a predictive feature for the LightGBM model.',
  'Volume Clock':  'Volume imbalance: (buy_vol − sell_vol) / total_vol (López de Prado 2018 Ch.3). Dollar bars sample by volume not time — equal information content per bar.',
  'Volume Z':      'Z-score of volume imbalance over 20-bar rolling window. Positive = net buyers aggressive; negative = net sellers aggressive.',
  'Live':          'Server-Sent Events (SSE) stream from backend → browser. Green = connected to /api/stream (synthetic bars in free tier, real Alpaca IEX data with API key). Pulses every 15 seconds.',
  'Stream off':    'SSE stream not connected. Switch to Hourly mode and allow a moment to connect. Stream provides live bar data to the dashboard. Free tier = synthetic random walk (demonstrates the architecture).',
  'Sortino':       'Sortino ratio: mean(returns) / std(negative returns only) × √252 × √6.5. Like Sharpe but penalises downside volatility only — a model that has occasional large gains isn\'t penalised. Higher = better risk-adjusted return. > 1.0 = good, > 2.0 = excellent.',
  'Max DD':        'Maximum Drawdown: worst peak-to-trough equity loss during the walk-forward test. < 10% = excellent; 10–25% = acceptable; > 25% = needs review. At IC ≈ 0 expect 15–20% MDD — shrinks as model IC improves with live intraday data.',
  'Alpha Decay':   'Alpha Decay: measures how quickly a trading signal loses predictive power over time. IC half-life = bars until OFI IC drops to 50% of its initial value. Half-life < 4 bars = pure microstructure alpha (intraday only). Modelled as IC(t) = IC₀ × exp(−λt) — Grinold & Kahn (2000).',
}

function InfoTip({ term, children }: { term: string; children?: React.ReactNode }) {
  const S = useS()
  const tip = TERM_TIPS[term] || ''
  if (!tip) return <>{children}</>
  return (
    <Tooltip content={tip}>
      <span style={{
        cursor: 'help',
        borderBottom: `1px dashed ${S.border}`,
        display: 'inline',
      }}>
        {children || term}
      </span>
    </Tooltip>
  )
}

function InfoIcon({ term }: { term: string }) {
  const S = useS()
  const tip = TERM_TIPS[term] || ''
  if (!tip) return null
  return (
    <Tooltip content={tip}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 14, height: 14, borderRadius: '50%',
        background: S.border, color: S.muted,
        fontSize: 9, fontWeight: 700, cursor: 'help',
        marginLeft: 4, verticalAlign: 'middle', flexShrink: 0,
      }}>i</span>
    </Tooltip>
  )
}

// ── SHAP feature explanations ───────────────────────────────────────
const FEATURE_EXPLANATIONS: Record<string, { label: string; formula: string; highMeans: string; lowMeans: string; paper: string }> = {
  ofi_zscore:    { label: 'Order Flow Imbalance Z-Score', formula: 'OFI = (Δbid_vol − Δask_vol) / (bid_vol + ask_vol)', highMeans: 'More buy orders are flowing into the book than sell orders. Smart money may be quietly accumulating — OFI leads price by ~30 min at hourly resolution (Chordia 2002).', lowMeans: 'Sell-side pressure is dominant. Net order flow is negative — distribution phase.', paper: 'Chordia, Roll & Subrahmanyam (2002) J. Financial Economics 65(1)' },
  amihud:        { label: 'Amihud Illiquidity Ratio', formula: 'ILLIQ = |return| / dollar_volume × 10⁶', highMeans: 'The stock is illiquid today — each $1M of trading moves the price significantly. Precedes larger directional moves when combined with order flow signals.', lowMeans: 'Deep, two-sided liquidity. Large institutions can execute without moving price.', paper: 'Amihud (2002) J. Financial Markets 5(1)' },
  kyle_lambda:   { label: "Kyle's Lambda (Price Impact)", formula: 'λ = Δprice / signed_volume (OLS slope)', highMeans: 'Market is thin — informed traders can move price with small volume. High λ precedes sharp directional moves and signals information asymmetry.', lowMeans: 'Market is deep. Low impact — competitive market making with tight spreads.', paper: 'Kyle (1985) Econometrica 53(6)' },
  cs_spread:     { label: 'Corwin-Schultz Bid-Ask Spread', formula: 'Estimated from daily high-low ranges (no TAQ data needed)', highMeans: 'Dealers are quoting wide — compensating for adverse selection risk. High spread = market makers expect informed order flow, which is predictive of direction.', lowMeans: 'Narrow spread. Competitive market making, low information asymmetry.', paper: 'Corwin & Schultz (2012) J. Finance 67(2)' },
  tick_sign:     { label: 'Lee-Ready Tick Sign (Trade Direction)', formula: '+1 = uptick (P_t > P_{t-1}), −1 = downtick', highMeans: 'Consecutive upticks: buyers are lifting the ask aggressively. Positive serial correlation in tick direction — trend-following microstructure effect.', lowMeans: 'Downticks dominating. Sellers are hitting the bid — bearish pressure.', paper: 'Lee & Ready (1991) J. Finance 46(2)' },
  vwap_zscore:   { label: 'VWAP Deviation Z-Score', formula: 'VWAP = Σ(P×V)/ΣV daily reset; z = (P − VWAP) / σ', highMeans: 'Price is well above today\'s volume-weighted cost. VWAP algos (used by institutions) will resist going higher — mean-reversion risk at >2σ. Below 2σ = momentum.', lowMeans: 'Price below VWAP. Institutional buy programs reset here — potential support level.', paper: 'Almgren & Chriss (2001) J. Risk 3(2)' },
  volume_zscore: { label: 'Volume Clock Imbalance Z-Score', formula: 'Imbalance = (buy_vol − sell_vol) / total_vol; z-scored', highMeans: 'Volume-weighted buying pressure is surging. Volume imbalance leads price at 1-3 bar horizon with higher IC than pure OFI at hourly resolution (López de Prado 2018).', lowMeans: 'Volume-weighted selling. Distribution phase — sellers are more aggressive.', paper: 'López de Prado (2018) Advances in Financial ML, Ch.3' },
  hawkes_zscore: { label: 'Hawkes Process Intensity Z-Score', formula: 'λ(t) = μ + Σᵢ α·exp(−β·(t−tᵢ)), MLE via L-BFGS-B', highMeans: 'Order arrival rate is self-exciting — each trade triggers more trades. High Hawkes intensity predicts short-burst volatility clustering — a novel intraday signal derived from stochastic point process theory.', lowMeans: 'Calm, uncorrelated order flow. Background Poisson rate only — no clustering.', paper: 'Bacry, Mastromatteo & Muzy (2015) Market Microstructure and Liquidity 1(01)' },
  vpin_zscore:   { label: 'VPIN: Flow Toxicity Z-Score (Easley et al. 2012)', formula: 'buy_frac=(close−low)/(high−low); VPIN=rolling mean(|buy_vol−sell_vol|/vol)', highMeans: 'Order flow is toxic — elevated probability of informed trading. VPIN > 1.5σ predicts directional price impact at the 1–3 bar horizon. Used by NYSE and CME for real-time liquidity risk monitoring.', lowMeans: 'Symmetric, uninformed order flow. Low VPIN = benign liquidity. Market makers can quote tight — low adverse selection risk.', paper: 'Easley, López de Prado & O\'Hara (2012) Review of Financial Studies 25(5), 1457–1493. DOI: 10.1093/rfs/hhs053' },
  ret_1h:        { label: '1-Hour Lagged Return', formula: 'ret_1h = (close_{t-1} − close_{t-2}) / close_{t-2}', highMeans: 'Strong positive return in the prior bar. Short-term momentum at 1h horizon — most liquid large-caps show positive autocorrelation at this frequency.', lowMeans: 'Negative prior return — short-term mean-reversion may dominate.', paper: 'Jegadeesh & Titman (1993) J. Finance 48(1)' },
  ret_3h:        { label: '3-Hour Lagged Return', formula: 'ret_3h = (close_{t-1} − close_{t-4}) / close_{t-4}', highMeans: 'Positive 3-bar return leading into the prediction window. Multi-horizon momentum check used to distinguish intraday trends from noise.', lowMeans: 'Negative 3-bar trend. Possible intraday exhaustion forming.', paper: 'Lo & MacKinlay (1988) J. Financial Economics 22(1)' },
  ret_6h:        { label: '6-Hour Lagged Return (half-day)', formula: 'ret_6h = (close_{t-1} − close_{t-7}) / close_{t-7}', highMeans: 'Strong half-day momentum. Captures morning-to-afternoon directional trends and overnight gap follow-through into the following session.', lowMeans: 'Half-day reversal pattern forming — potential mean-reversion opportunity.', paper: 'Jegadeesh & Titman (1993) J. Finance 48(1)' },
  vol_ratio:     { label: 'Volume Ratio (vs 20-bar rolling avg)', formula: 'vol_ratio = volume_t / rolling_20_avg(volume)', highMeans: 'Volume spike (2×–3× normal). Signals institutional activity, news absorption, or index rebalancing. High volume on an up-bar = accumulation; on a down-bar = distribution.', lowMeans: 'Below-average volume. Market participants inactive — signals are less reliable at low volume.', paper: 'Karpoff (1987) J. Financial and Quantitative Analysis 22(1)' },
}

// ── SHAP Feature Modal ───────────────────────────────────────────────
function ShapFeatureModal({ feature, importance, ticker, onClose }: { feature: string; importance: number; ticker: string; onClose: () => void }) {
  const S = useS()
  const exp = FEATURE_EXPLANATIONS[feature]
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, background: '#00000090', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
      <div style={{ background: S.surface, border: `1px solid ${S.primary}66`, borderRadius: 14, padding: 28, maxWidth: 500, width: '100%', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <p style={{ color: S.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 4px' }}>SHAP Feature Explanation</p>
            <h3 style={{ color: S.primary, fontSize: 14, fontWeight: 700, margin: 0 }}>{exp?.label ?? feature}</h3>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: `1px solid ${S.border}`, color: S.muted, borderRadius: 6, width: 28, height: 28, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0 }}>✕</button>
        </div>
        {exp && <>
          <div style={{ background: S.cardBg, borderRadius: 8, padding: '8px 14px', marginBottom: 14, borderLeft: `3px solid ${S.primary}` }}>
            <p style={{ color: S.muted, fontSize: 9, margin: '0 0 3px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Formula</p>
            <p style={{ color: S.text, fontFamily: 'monospace', fontSize: 11, margin: 0 }}>{exp.formula}</p>
          </div>
          <div style={{ background: `${S.primary}11`, borderRadius: 8, padding: '10px 14px', marginBottom: 14 }}>
            <p style={{ color: S.primary, fontSize: 10, fontWeight: 700, margin: '0 0 5px' }}>What this means for <strong>{ticker}</strong> right now:</p>
            <p style={{ color: S.text, fontSize: 12, lineHeight: 1.65, margin: 0 }}>
              High <code style={{ background: S.cardBg, padding: '1px 5px', borderRadius: 4, fontSize: 10 }}>{feature}</code> importance → {exp.highMeans}
            </p>
          </div>
          <div style={{ marginBottom: 14 }}>
            <span style={{ color: S.muted, fontSize: 10 }}>SHAP Importance Value: </span>
            <span style={{ color: '#38BDF8', fontWeight: 700, fontFamily: 'monospace', fontSize: 12 }}>{importance.toFixed(6)}</span>
            <span style={{ color: S.muted, fontSize: 9, marginLeft: 8 }}>(mean |SHAP| across {ticker === 'ALL' ? 'all tickers' : 'test folds'})</span>
          </div>
          <div style={{ borderTop: `1px solid ${S.border}`, paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p style={{ color: S.muted, fontSize: 10, margin: 0 }}>{exp.paper}</p>
            <button onClick={onClose} style={{ background: S.runBtn, color: '#fff', border: 'none', borderRadius: 6, padding: '4px 14px', fontSize: 11, cursor: 'pointer' }}>Got it</button>
          </div>
        </>}
      </div>
    </div>,
    document.body
  )
}

// ── Metric Explanation Modal ─────────────────────────────────────────────────
function MetricExplanationModal({ metricKey, onClose }: { metricKey: string; onClose: () => void }) {
  const S = useS()
  const meta = METRIC_META[metricKey] ?? DRAWER_METRIC_META[metricKey]
  if (!meta) return null
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, background: '#00000090', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
      <div style={{ background: S.surface, border: `1px solid ${S.primary}66`, borderRadius: 14, padding: 28, maxWidth: 500, width: '100%', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <p style={{ color: S.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 4px' }}>Live Metric Explanation</p>
            <h3 style={{ color: S.primary, fontSize: 16, fontWeight: 700, margin: 0 }}>{meta.label}</h3>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: `1px solid ${S.border}`, color: S.muted, borderRadius: 6, width: 28, height: 28, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0 }}>✕</button>
        </div>
        <div style={{ background: S.cardBg, borderRadius: 8, padding: '8px 14px', marginBottom: 14, borderLeft: `3px solid ${S.primary}` }}>
          <p style={{ color: S.muted, fontSize: 9, margin: '0 0 3px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Formula / Method</p>
          <p style={{ color: S.text, fontFamily: 'monospace', fontSize: 11, margin: 0 }}>{meta.formula}</p>
        </div>
        <div style={{ background: `${S.primary}11`, borderRadius: 8, padding: '10px 14px', marginBottom: 14 }}>
          <p style={{ color: S.primary, fontSize: 11, fontWeight: 700, margin: '0 0 6px' }}>What this measures:</p>
          <p style={{ color: S.text, fontSize: 12, lineHeight: 1.65, margin: 0 }}>{meta.help}</p>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `1px solid ${S.border}`, paddingTop: 12 }}>
          <div>
            <span style={{ color: S.muted, fontSize: 10 }}>Unit: </span>
            <span style={{ color: S.text, fontSize: 10, fontWeight: 700 }}>{meta.unit}</span>
            <span style={{ color: S.muted, fontSize: 9, marginLeft: 12 }}>{meta.ref}</span>
          </div>
          <button onClick={onClose} style={{ background: S.runBtn, color: '#fff', border: 'none', borderRadius: 6, padding: '4px 14px', fontSize: 11, cursor: 'pointer' }}>Got it</button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── Ticker Research Drawer — right-side slide-in, shared chat state ───────────
function TickerResearchDrawer({ ticker, signalData, isHourly, chat, chatInput, setChatInput, onSend, chatLoading, onClose, onMetricClick }: {
  ticker: string; signalData: any; isHourly: boolean
  chat: { role: 'user' | 'assistant'; content: string }[]
  chatInput: string; setChatInput: (v: string) => void
  onSend: () => void; chatLoading: boolean; onClose: () => void
  onMetricClick: (key: string) => void
}) {
  const S = useS()
  const tickerNames = useContext(TickerNamesCtx)
  const [name, sector] = tickerNames[ticker] ?? [ticker, 'Custom']
  const inputRef = useRef<HTMLInputElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 80) }, [])
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chat])
  const sig = signalData?.signal ?? 'HOLD'

  // Liquidity metrics — same for both resolutions (these are INPUTS to the model, not outputs)
  const liquidityMetrics = signalData ? [
    ['OFI Z',  signalData?.ofi != null ? `${Number(signalData.ofi) > 0.15 ? '▲' : Number(signalData.ofi) < -0.15 ? '▼' : '→'} ${Number(signalData.ofi ?? 0).toFixed(3)}` : '—', Number(signalData?.ofi ?? 0) > 0.15 ? S.positiveVal : Number(signalData?.ofi ?? 0) < -0.15 ? S.negativeVal : S.muted],
    ['Spread', signalData?.eff_spread_bps != null ? `${Number(signalData.eff_spread_bps).toFixed(1)} bps` : '—', Number(signalData?.eff_spread_bps ?? 0) > 50 ? S.negativeVal : Number(signalData?.eff_spread_bps ?? 0) > 25 ? S.warnVal : S.positiveVal],
    ['Kyle λ', signalData?.kyle_lambda != null ? fmtSmall(Number(signalData.kyle_lambda)) : '—', S.text],
    ['Amihud', signalData?.amihud_illiq != null ? fmtSmall(Number(signalData.amihud_illiq)) : '—', Number(signalData?.amihud_illiq ?? 0) > 1e-5 ? S.warnVal : S.positiveVal],
  ] as [string, string, string][] : []

  // Model performance metrics — different for daily vs hourly
  // Trimmed to IC+Sharpe only (Max DD/Folds live in the fuller Equity/Rolling IC tab tearsheet — see signpost below)
  const modelMetrics = isHourly && signalData ? [
    ['IC',     signalData?.mean_ic != null ? `${(signalData.mean_ic * 100).toFixed(2)}%` : '—', Math.abs(signalData?.mean_ic ?? 0) > 0.05 ? S.positiveVal : S.warnVal],
    ['Sharpe', signalData?.sharpe != null ? `${signalData.sharpe >= 0 ? '+' : ''}${signalData.sharpe.toFixed(2)}` : '—', (signalData?.sharpe ?? 0) >= 0 ? S.positiveVal : S.negativeVal],
  ] as [string, string, string][] : signalData ? [
    ['Sharpe', signalData?.sharpe != null ? `${Number(signalData.sharpe) >= 0 ? '+' : ''}${Number(signalData.sharpe).toFixed(2)}` : '—', Number(signalData?.sharpe ?? 0) >= 0 ? S.positiveVal : S.negativeVal],
    ['IC',     '~0 (daily)', S.muted],   // expected at OHLCV resolution
  ] as [string, string, string][] : []

  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: '#00000055', zIndex: 9997 }} />
      <div style={{ position: 'fixed', top: 0, right: 0, height: '100vh', width: 'min(520px, 100vw)', background: S.surface, borderLeft: `2px solid ${S.border}`, zIndex: 9998, display: 'flex', flexDirection: 'column', boxShadow: '-20px 0 60px rgba(0,0,0,0.5)', overflowX: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${S.border}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
            <div>
              <p style={{ color: S.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 4px' }}>
                Signal Analyst · {isHourly ? 'Intraday Signal Engine' : 'EOD Signal Engine'}
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: S.text, fontSize: 20, fontWeight: 800, letterSpacing: '-0.01em' }}>{ticker}</span>
                <SignalBadge sig={sig} />
              </div>
              <p style={{ color: S.muted, fontSize: 11, margin: '3px 0 0' }}>{name} · <span style={{ opacity: 0.7 }}>{sector}</span></p>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: `1px solid ${S.border}`, color: S.muted, borderRadius: 6, width: 28, height: 28, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0, fontSize: 14 }}>✕</button>
          </div>
          {signalData && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {/* Block 1 — Microstructure / Liquidity signals (model INPUTS) */}
              <div>
                <p style={{ color: S.muted, fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.09em', margin: '0 0 5px', opacity: 0.6 }}>
                  Liquidity Signals — Model Inputs
                  <span style={{ marginLeft: 6, opacity: 0.45, fontSize: 7 }}>OFI = order flow pressure · Spread = transaction cost · Kyle λ = price impact · Amihud = depth</span>
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: 5 }}>
                  {liquidityMetrics.map(([label, val, col]) => {
                    const hasExp = !!DRAWER_METRIC_META[label as string]
                    return (
                      <div key={label}
                        onClick={() => hasExp && onMetricClick(label as string)}
                        title={hasExp ? `Click for ${label} explanation` : undefined}
                        style={{ background: S.cardBg, borderRadius: 6, padding: '6px 8px', textAlign: 'center', cursor: hasExp ? 'pointer' : 'default', transition: 'background 0.15s', border: `1px solid ${S.border}44` }}
                        onMouseEnter={e => { if (hasExp) (e.currentTarget as HTMLDivElement).style.background = S.surface }}
                        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = S.cardBg }}>
                        <p style={{ color: S.muted, fontSize: 8, margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                          {label}{hasExp && <span style={{ opacity: 0.45, fontSize: 7 }}> ⓘ</span>}
                        </p>
                        <p style={{ color: col, fontSize: 12, fontWeight: 700, margin: 0, fontVariantNumeric: 'tabular-nums' }}>{val}</p>
                      </div>
                    )
                  })}
                </div>
              </div>
              {/* Block 2 — Model performance (model OUTPUTS) */}
              {modelMetrics.length > 0 && (
                <div>
                  <p style={{ color: S.muted, fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.09em', margin: '0 0 5px', opacity: 0.6 }}>
                    {isHourly ? 'LightGBM Walk-Forward Performance' : 'Signal Performance'}
                    {isHourly && <span style={{ marginLeft: 6, opacity: 0.45, fontSize: 7 }}>13 hourly features · IC = Spearman ρ(predicted, actual return)</span>}
                    {!isHourly && <span style={{ marginLeft: 6, opacity: 0.45, fontSize: 7 }}>cross-sectional OFI rank · daily IC ≈ 0 is expected at OHLCV resolution</span>}
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', gap: 5 }}>
                    {modelMetrics.map(([label, val, col]) => {
                      const hasExp = !!DRAWER_METRIC_META[label as string]
                      return (
                        <div key={label}
                          onClick={() => hasExp && onMetricClick(label as string)}
                          title={hasExp ? `Click for ${label} explanation` : undefined}
                          style={{ background: isHourly ? `${S.primary}11` : S.cardBg, borderRadius: 6, padding: '6px 8px', textAlign: 'center', cursor: hasExp ? 'pointer' : 'default', transition: 'background 0.15s', border: `1px solid ${isHourly ? S.primary + '33' : S.border + '44'}` }}
                          onMouseEnter={e => { if (hasExp) (e.currentTarget as HTMLDivElement).style.background = S.surface }}
                          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = isHourly ? `${S.primary}11` : S.cardBg }}>
                          <p style={{ color: S.muted, fontSize: 8, margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                            {label}{hasExp && <span style={{ opacity: 0.45, fontSize: 7 }}> ⓘ</span>}
                          </p>
                          <p style={{ color: col, fontSize: 12, fontWeight: 700, margin: 0, fontVariantNumeric: 'tabular-nums' }}>{val}</p>
                        </div>
                      )
                    })}
                  </div>
                  {isHourly && (
                    <p style={{ color: S.muted, fontSize: 8, margin: '5px 0 0', opacity: 0.55, lineHeight: 1.5 }}>
                      Full walk-forward tearsheet (Calmar, hit rate, IC significance, equity curve) → Signal Charts ▸ Equity / Rolling IC tabs
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          {isHourly && signalData && (
            <div style={{ margin: '8px 0 0', padding: '6px 10px', background: S.tag, border: `1px solid ${S.border}`, borderRadius: 7, fontSize: 9, color: S.text, lineHeight: 1.6 }}>
              <strong style={{ color: '#38BDF8' }}>ⓘ Two IC types:</strong> &nbsp;
              <strong>Hourly LightGBM IC = {signalData?.mean_ic != null ? `${(signalData.mean_ic * 100).toFixed(2)}%` : '—'}</strong> — walk-forward validation across {signalData?.n_folds ?? '—'} folds (shown above &amp; grounded in chat).&nbsp;
              Daily OFI IC ≈ 0 is <em>expected</em> — OHLCV bars cannot resolve intra-bar trade direction.
            </div>
          )}
        </div>
        {/* Chat messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {chat.length === 0 && (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <p style={{ color: S.muted, fontSize: 12, opacity: 0.7 }}>Ask Groq about {ticker}</p>
              <p style={{ color: S.muted, fontSize: 10, opacity: 0.45, marginTop: 4 }}>History shared with the panel below — closing preserves memory</p>
            </div>
          )}
          {chat.map((m, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{ maxWidth: '82%', padding: '9px 14px', borderRadius: 8, fontSize: 13, lineHeight: 1.65, background: m.role === 'user' ? S.primary : S.bg, color: m.role === 'user' ? '#fff' : S.text, border: m.role === 'assistant' ? `1px solid ${S.border}` : 'none' }}>{m.content}</div>
            </div>
          ))}
          {chatLoading && <div style={{ display: 'flex', gap: 5, padding: '4px 0' }}>{[0, 1, 2].map(i => <div key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: S.primary, opacity: 0.4 + i * 0.3 }}></div>)}</div>}
          <div ref={chatEndRef} />
        </div>
        {/* Input */}
        <div style={{ padding: '12px 20px', borderTop: `1px solid ${S.border}`, flexShrink: 0, display: 'flex', gap: 8 }}>
          <input
            ref={inputRef}
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && onSend()}
            placeholder={`Ask about ${ticker}…`}
            style={{ flex: 1, background: S.bg, color: S.text, border: `1px solid ${S.border}`, borderRadius: 8, padding: '10px 14px', fontSize: 13, outline: 'none' }}
          />
          <button onClick={onSend} disabled={chatLoading || !chatInput.trim()}
            style={{ background: chatLoading || !chatInput.trim() ? S.border : S.runBtn, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', fontSize: 12, fontWeight: 700, cursor: chatLoading || !chatInput.trim() ? 'default' : 'pointer' }}>
            {chatLoading ? '…' : 'Send'}
          </button>
        </div>
        <p style={{ color: S.muted, fontSize: 9, textAlign: 'center', padding: '4px 20px 8px', opacity: 0.35, flexShrink: 0 }}>
          Groq llama-3.3-70b · shared chat history · closing preserves memory
        </p>
      </div>
    </>,
    document.body
  )
}

// ── Intraday Charts — Hawkes, VWAP, Feature Correlation, LGBM Scatter ─────────

const FEATURE_FRIENDLY: Record<string, string> = {
  ofi_zscore: 'OFI Z', amihud: 'Amihud', kyle_lambda: 'Kyle λ', cs_spread: 'Spread',
  tick_sign: 'Tick Sign', vwap_zscore: 'VWAP Z', volume_zscore: 'Vol Clock',
  hawkes_zscore: 'Hawkes Z', ret_1h: 'Ret 1h', ret_3h: 'Ret 3h', ret_6h: 'Ret 6h', vol_ratio: 'Vol Ratio',
}

// ── formatBarTime — convert ISO timestamp to compact label ───────────────────
// Input: '2026-06-24 18:00:00+00:00'  Output: 'Jun 24 18:00'
function formatBarTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso.replace(' ', 'T').replace('+00:00', 'Z'))
  if (isNaN(d.getTime())) return ''
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`
}

function HawkesChart({ ticker, S }: { ticker: string; S: Theme }) {
  const [nBars, setNBars] = useState(80)
  const q = useQuery({ queryKey: ['hawkes', ticker, nBars], queryFn: () => axios.get(`/api/intraday/hawkes?ticker=${ticker}&n=${nBars}`).then(r => r.data), staleTime: STALE_CHART_DATA_MS })
  if (q.isPending) return <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: S.muted, fontSize: 11, background: S.cardBg, borderRadius: 8 }}>Loading Hawkes intensity…</div>
  if (q.isError || !q.data?.data?.length) return <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: S.muted, fontSize: 11, background: S.cardBg, borderRadius: 8 }}>No Hawkes data — run intraday pipeline first</div>
  const pts = q.data.data.slice(-nBars).map((d: any) => ({
    bar: formatBarTime(d.time ?? ''),
    z: Number(d.hawkes_z),
    rawTime: d.time ?? '',
  }))
  const HawkesTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.[0]) return null
    const p = payload[0].payload
    const v: number = p.z
    const interp = v > 2.0
      ? 'Extreme burst — self-exciting cascade of orders. Volatility spike imminent. (Bacry et al. 2015)'
      : v > 1.5
      ? 'Above 1.5σ threshold — self-exciting order flow. Each trade is triggering follow-on orders. (Bacry et al. 2015)'
      : v < -1.5
      ? 'Suppressed arrivals — thin liquidity detected. Wide spreads likely, reduced market depth.'
      : Math.abs(v) < 0.5
      ? 'Quiet — normal order arrival rate, no clustering detected.'
      : 'Moderate — elevated order clustering but below burst threshold.'
    return (
      <div style={{ background: S.tipBg, border: `1px solid ${S.tipBorder}`, borderRadius: 8, padding: '8px 12px', maxWidth: 270, fontSize: 11 }}>
        <p style={{ color: v > 1.5 ? '#EF4444' : v < -1.5 ? '#22C55E' : '#7DD3FC', fontWeight: 700, margin: '0 0 4px' }}>
          {ticker} Hawkes Z = {v.toFixed(2)}σ
        </p>
        <p style={{ color: '#CBD5E1', margin: 0, lineHeight: 1.5, fontSize: 10 }}>{interp}</p>
        {p.rawTime && <p style={{ color: '#94A3B8', fontSize: 9, margin: '4px 0 0', opacity: 0.6 }}>{p.rawTime}</p>}
      </div>
    )
  }
  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ color: S.muted, fontSize: 9 }}>Window:</span>
        {([40, 80, 150] as const).map(n => (
          <button key={n} onClick={() => setNBars(n)}
            style={{ background: nBars === n ? S.primary : 'transparent', color: nBars === n ? '#fff' : S.muted, border: `1px solid ${nBars === n ? S.primary : S.border}`, borderRadius: 4, padding: '2px 8px', fontSize: 9, cursor: 'pointer' }}>
            {n}h <span style={{ opacity: 0.6, fontSize: 8 }}>(≈{Math.round(n / 7)}d)</span>
          </button>
        ))}
        <span style={{ color: S.muted, fontSize: 8, opacity: 0.4, marginLeft: 4 }}>1 trading day ≈ 7 hourly bars (6.5h market session)</span>
      </div>
      <div style={{ background: S.cardBg, borderRadius: 8, padding: '8px 4px 4px', border: `1px solid ${S.border}` }}>
        <ResponsiveContainer width="100%" height={210}>
          <BarChart data={pts} margin={{ top: 5, right: 16, bottom: 28, left: 18 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={S.border} vertical={false} />
            <XAxis dataKey="bar" tick={{ fill: S.muted, fontSize: 8 }} tickLine={false} axisLine={{ stroke: S.border }}
              interval={Math.max(0, Math.ceil(pts.length / 7) - 1)}
              label={{ value: 'Time (hourly bars)', position: 'insideBottom', offset: -14, fill: S.muted, fontSize: 9 }} />
            <YAxis tick={{ fill: S.muted, fontSize: 9 }} tickLine={false} axisLine={false}
              domain={[
                (dv: number) => Math.min(-2.5, isFinite(dv) ? dv : -2.5),
                (dv: number) => Math.max(2.5,  isFinite(dv) ? dv : 2.5),
              ]}
              label={{ value: 'Z-Score (σ)', angle: -90, position: 'insideLeft', offset: 14, fill: S.muted, fontSize: 9, dx: -4 }} />
            <RechartsTooltip content={<HawkesTooltip />} cursor={{ fill: `${S.primary}18` }} />
            <ReferenceLine y={1.5} stroke="#EF4444" strokeDasharray="5 3" strokeOpacity={0.7} strokeWidth={1}
              label={{ value: '1.5σ burst', fill: '#EF4444', fontSize: 8, position: 'insideTopRight' }} />
            <ReferenceLine y={-1.5} stroke="#22C55E" strokeDasharray="5 3" strokeOpacity={0.7} strokeWidth={1} />
            <ReferenceLine y={0} stroke={S.border} strokeWidth={1} />
            <Bar dataKey="z" isAnimationActive animationDuration={500} radius={[2, 2, 0, 0]}>
              {pts.map((p: typeof pts[0], i: number) => (
                <Cell key={i} fill={p.z > 1.5 ? '#EF4444' : p.z < -1.5 ? '#22C55E' : '#0891B2'} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p style={{ color: S.muted, fontSize: 9, textAlign: 'center', margin: '4px 0 0', opacity: 0.45, lineHeight: 1.5 }}>
        λ(t) = μ + Σ αe^(−βΔt) · red &gt;1.5σ = burst · hover bars for interpretation
      </p>
    </div>
  )
}

function VWAPChart({ ticker, S }: { ticker: string; S: Theme }) {
  const [nBars, setNBars] = useState(80)
  const q = useQuery({ queryKey: ['vwapZ', ticker, nBars], queryFn: () => axios.get(`/api/intraday/vwap?ticker=${ticker}&n=${nBars}`).then(r => r.data), staleTime: STALE_CHART_DATA_MS })
  const [hovIdx, setHovIdx] = useState<number | null>(null)
  if (q.isPending) return <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: S.muted, fontSize: 11, background: S.cardBg, borderRadius: 8 }}>Loading VWAP deviation…</div>
  if (q.isError || !q.data?.data?.length) return <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: S.muted, fontSize: 11, background: S.cardBg, borderRadius: 8 }}>No VWAP data — run intraday pipeline first</div>
  const pts = q.data.data.slice(-nBars).map((d: any) => ({
    v: Number(d.vwap_z),
    time: d.time ?? '',
    label: formatBarTime(d.time ?? ''),
  }))
  const firstLabel = pts[0]?.label || '←'
  const lastLabel  = pts[pts.length - 1]?.label || 'now'
  const max = Math.max(...pts.map((p: any) => Math.abs(p.v)), 2.5)
  const W = 500, H = 130, cy = H / 2, PAD = 4
  const barW = Math.max(2, (W - PAD * 2) / pts.length - 1)
  const hov = hovIdx !== null ? pts[hovIdx] : null
  const getInterp = (v: number) => v > 1.5
    ? 'Well above VWAP — rising execution costs. Institutional selling window. Momentum regime. (Almgren & Chriss 2001)'
    : v > 0.5 ? 'Above VWAP — price at premium vs vol-weighted avg. Bullish intraday momentum.'
    : v < -1.5 ? 'Well below VWAP — potential institutional support zone. Mean-reversion pressure.'
    : v < -0.5 ? 'Below VWAP — price below vol-weighted avg. Bearish pressure or value accumulation.'
    : 'Near VWAP — balanced order flow. No directional bias.'
  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ color: S.muted, fontSize: 9 }}>Window:</span>
        {([40, 80, 150] as const).map(n => (
          <button key={n} onClick={() => setNBars(n)}
            style={{ background: nBars === n ? S.primary : 'transparent', color: nBars === n ? '#fff' : S.muted, border: `1px solid ${nBars === n ? S.primary : S.border}`, borderRadius: 4, padding: '2px 8px', fontSize: 9, cursor: 'pointer' }}>
            {n}h <span style={{ opacity: 0.6, fontSize: 8 }}>(≈{Math.round(n / 7)}d)</span>
          </button>
        ))}
      </div>
      {hov ? (
        <div style={{ background: S.tipBg, border: `1px solid ${S.tipBorder}`, borderRadius: 7, padding: '7px 11px', fontSize: 10, marginBottom: 6, lineHeight: 1.5 }}>
          <span style={{ color: hov.v >= 0 ? '#22C55E' : '#EF4444', fontWeight: 700 }}>{ticker} VWAP Z = {hov.v.toFixed(2)}σ{hov.label ? ` · ${hov.label}` : ''}</span>
          <span style={{ color: S.muted, marginLeft: 8 }}>{getInterp(hov.v)}</span>
        </div>
      ) : (
        <div style={{ height: 28, display: 'flex', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ color: S.muted, fontSize: 9, opacity: 0.5 }}>Hover bars to see VWAP interpretation</span>
        </div>
      )}
      <div style={{ background: S.cardBg, borderRadius: 8, border: `1px solid ${S.border}`, padding: '4px 4px 0' }}>
        <div style={{ fontSize: 9, color: S.muted, opacity: 0.55, padding: '2px 6px 0', textAlign: 'right' }}>VWAP Z-Score (σ) ↑</div>
        <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
          onMouseLeave={() => setHovIdx(null)}>
          <line x1={PAD} y1={cy} x2={W - PAD} y2={cy} stroke={S.border} strokeWidth={1} />
          <line x1={PAD} y1={cy - (1.5 / max) * (cy - 6)} x2={W - PAD} y2={cy - (1.5 / max) * (cy - 6)}
            stroke="#22C55E" strokeWidth={0.7} strokeDasharray="4,4" opacity={0.6} />
          <line x1={PAD} y1={cy + (1.5 / max) * (cy - 6)} x2={W - PAD} y2={cy + (1.5 / max) * (cy - 6)}
            stroke="#EF4444" strokeWidth={0.7} strokeDasharray="4,4" opacity={0.6} />
          {pts.map((p: { v: number; time: string; label: string }, i: number) => {
            const bh = Math.max(1, (Math.abs(p.v) / max) * (cy - 6))
            const x = PAD + i * ((W - PAD * 2) / pts.length)
            const y = p.v >= 0 ? cy - bh : cy
            return (
              <rect key={i} x={x} y={y} width={barW} height={bh}
                fill={p.v >= 0 ? '#22C55E' : '#EF4444'}
                opacity={hovIdx === i ? 1 : 0.72}
                onMouseEnter={() => setHovIdx(i)}
                style={{ cursor: 'pointer' }}
              />
            )
          })}
          <text x={PAD + 2} y={cy - (1.5 / max) * (cy - 6) - 3} fill="#22C55E" fontSize={7} opacity={0.75}>+1.5σ</text>
          <text x={PAD + 2} y={cy + (1.5 / max) * (cy - 6) + 9} fill="#EF4444" fontSize={7} opacity={0.75}>-1.5σ</text>
          <text x={W / 2} y={cy + 1} dominantBaseline="middle" textAnchor="middle" fill={S.border} fontSize={8} opacity={0.5}>0</text>
        </svg>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: S.muted, opacity: 0.5, padding: '2px 6px 4px' }}>
          <span>{firstLabel}</span>
          <span>VWAP Z-Score (hourly)</span>
          <span>{lastLabel}</span>
        </div>
      </div>
      <p style={{ color: S.muted, fontSize: 9, textAlign: 'center', margin: '4px 0 0', opacity: 0.45, lineHeight: 1.5 }}>
        VWAP = Σ(P×V)/ΣV · green = above VWAP (momentum) · red = below (reversal zone)
      </p>
    </div>
  )
}

function FeatureCorrelationHeatmap({ ticker, S }: { ticker: string; S: Theme }) {
  const q = useQuery({ queryKey: ['featCorr', ticker], queryFn: () => axios.get(`/api/intraday/feature-correlation?ticker=${ticker}`).then(r => r.data), staleTime: STALE_EXPENSIVE_COMPUTE_MS })
  const [popup, setPopup] = useState<{ x: number; y: number; f1: string; f2: string; val: number } | null>(null)
  const [threshold, setThreshold] = useState(0)
  const [hovRC, setHovRC] = useState<{ r: number; c: number } | null>(null)
  const [cellZoom, setCellZoom] = useState(1)
  if (q.isPending) return <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: S.muted, fontSize: 11 }}>Computing 13×13 correlation matrix…</div>
  if (q.isError || !q.data?.matrix) return <div style={{ height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', color: S.muted, fontSize: 11 }}>No feature data — run intraday pipeline first</div>
  const feats: string[] = q.data.features.map((f: string) => FEATURE_FRIENDLY[f] ?? f)
  const matrix: number[][] = q.data.matrix
  const n = feats.length

  // Diverging colormap: white→red (positive) / white→blue (negative)
  const corrToRGB = (v: number, isDiag: boolean): string => {
    if (isDiag) return `${S.primary}28`
    const abs = Math.min(Math.abs(v), 1)
    if (v > 0) return `rgb(255,${Math.round(255 * (1 - abs))},${Math.round(255 * (1 - abs))})`
    return `rgb(${Math.round(255 * (1 - abs))},${Math.round(255 * (1 - abs))},255)`
  }
  // Always use dark text on light cells, light text on dark cells — visible in both themes
  const textColor = (v: number, isDiag: boolean): string => {
    if (isDiag) return S.primary
    const abs = Math.abs(v)
    // Cells with abs > 0.55 are deeply coloured (dark red or dark blue) → white text
    // Cells near 0 are nearly white → use S.text (dark in light mode, light in dark mode)
    return abs > 0.55 ? '#ffffff' : S.text
  }

  const cellSz = [24, 32, 44][cellZoom]
  const leftPad = 56
  const topPad  = 64
  const W = leftPad + n * cellSz + 20
  const H = topPad  + n * cellSz + 36

  const corrInterpret = (v: number): string => {
    const a = Math.abs(v)
    if (a >= 0.8) return 'Very high — almost identical signals, consider dropping one'
    if (a >= 0.6) return 'High — significant overlap, monitor for multicollinearity'
    if (a >= 0.4) return 'Moderate — partial overlap, acceptable'
    if (a >= 0.2) return 'Low — largely independent signals'
    return 'Near zero — independent, no redundancy'
  }

  return (
    <div style={{ overflowX: 'auto', position: 'relative' }} onClick={() => setPopup(null)}>
      {/* Zoom controls */}
      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', marginBottom: 6 }}>
        <span style={{ color: S.muted, fontSize: 9, alignSelf: 'center', opacity: 0.6 }}>Cell size:</span>
        <button onClick={e => { e.stopPropagation(); setCellZoom(z => Math.max(0, z - 1)) }}
          disabled={cellZoom === 0}
          style={{ background: 'transparent', border: `1px solid ${S.border}`, color: cellZoom === 0 ? S.border : S.muted, borderRadius: 4, width: 22, height: 22, cursor: cellZoom === 0 ? 'default' : 'pointer', fontSize: 14, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          −
        </button>
        <button onClick={e => { e.stopPropagation(); setCellZoom(z => Math.min(2, z + 1)) }}
          disabled={cellZoom === 2}
          style={{ background: 'transparent', border: `1px solid ${S.border}`, color: cellZoom === 2 ? S.border : S.muted, borderRadius: 4, width: 22, height: 22, cursor: cellZoom === 2 ? 'default' : 'pointer', fontSize: 14, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          +
        </button>
      </div>
      {/* Click popup */}
      {popup && (
        <div style={{ position: 'fixed', left: Math.min(popup.x + 12, window.innerWidth - 260), top: Math.min(popup.y + 12, window.innerHeight - 130),
          background: S.tipBg, border: `1px solid ${S.tipBorder}`, borderRadius: 9, padding: '10px 14px', maxWidth: 250, zIndex: 9999, pointerEvents: 'none',
          boxShadow: '0 8px 32px rgba(0,0,0,0.35)', fontSize: 11 }}>
          <p style={{ color: '#7DD3FC', fontWeight: 700, margin: '0 0 4px', fontSize: 12 }}>{popup.f1} × {popup.f2}</p>
          <p style={{ color: popup.val > 0 ? '#F87171' : popup.val < 0 ? '#60A5FA' : '#94A3B8', fontFamily: 'monospace', fontSize: 16, fontWeight: 800, margin: '0 0 4px' }}>ρ = {popup.val.toFixed(3)}</p>
          <p style={{ color: '#CBD5E1', fontSize: 10, margin: 0, lineHeight: 1.5 }}>{corrInterpret(popup.val)}</p>
        </div>
      )}
      <svg width={W} height={H} style={{ display: 'block', fontFamily: 'inherit' }}>
        {/* X-axis labels */}
        {feats.map((f, ci) => (
          <text key={`xh${ci}`} x={leftPad + ci * cellSz + cellSz / 2} y={topPad - 6}
            textAnchor="start" transform={`rotate(-60,${leftPad + ci * cellSz + cellSz / 2},${topPad - 6})`}
            fill={hovRC && (hovRC.r === ci || hovRC.c === ci) ? S.primary : S.muted}
            fontSize={8} fontWeight={hovRC && (hovRC.r === ci || hovRC.c === ci) ? 700 : 400}>{f}</text>
        ))}
        {/* Y-axis labels */}
        {feats.map((f, ri) => (
          <text key={`yl${ri}`} x={leftPad - 4} y={topPad + ri * cellSz + cellSz / 2 + 1}
            textAnchor="end" dominantBaseline="middle"
            fill={hovRC && (hovRC.r === ri || hovRC.c === ri) ? S.primary : S.muted}
            fontSize={8} fontWeight={hovRC && (hovRC.r === ri || hovRC.c === ri) ? 700 : 400}>{f}</text>
        ))}
        {/* Cells */}
        {matrix.map((row, ri) =>
          row.map((v, ci) => {
            const isDiag = ri === ci
            const cx = leftPad + ci * cellSz
            const cy = topPad  + ri * cellSz
            const displayVal = isDiag ? '1' : v.toFixed(2)
            const dimmed = !isDiag && threshold > 0 && Math.abs(v) < threshold
            return (
              <g key={`${ri}_${ci}`} style={{ cursor: isDiag ? 'default' : 'pointer' }}
                onMouseEnter={() => !isDiag && setHovRC({ r: ri, c: ci })}
                onMouseLeave={() => setHovRC(null)}
                onClick={(e) => { if (!isDiag) { e.stopPropagation(); setPopup({ x: e.clientX, y: e.clientY, f1: feats[ri], f2: feats[ci], val: v }) } }}>
                <rect x={cx} y={cy} width={cellSz} height={cellSz} fill={corrToRGB(v, isDiag)}
                  stroke={S.border} strokeWidth={0.5} rx={1}
                  fillOpacity={dimmed ? 0.15 : 1} />
                <text x={cx + cellSz / 2} y={cy + cellSz / 2} textAnchor="middle" dominantBaseline="middle"
                  fill={dimmed ? S.muted : textColor(v, isDiag)} fontSize={7}
                  fontWeight={isDiag ? 700 : Math.abs(v) > 0.4 ? 700 : 400}
                  opacity={dimmed ? 0.3 : 1}>
                  {displayVal}
                </text>
              </g>
            )
          })
        )}
        {/* Legend */}
        {(() => {
          const legY = topPad + n * cellSz + 12
          const legW = 120, legH = 10, legX = leftPad
          const steps = 20
          return (
            <g>
              {Array.from({ length: steps }, (_, i) => {
                const t = i / (steps - 1)  // 0 = left (neg), 1 = right (pos)
                const v = t * 2 - 1
                return (
                  <rect key={i} x={legX + i * (legW / steps)} y={legY}
                    width={legW / steps} height={legH}
                    fill={corrToRGB(v, false)} />
                )
              })}
              <text x={legX}           y={legY + legH + 9} fill={S.muted} fontSize={7} textAnchor="middle">−1</text>
              <text x={legX + legW / 2} y={legY + legH + 9} fill={S.muted} fontSize={7} textAnchor="middle">0</text>
              <text x={legX + legW}    y={legY + legH + 9} fill={S.muted} fontSize={7} textAnchor="middle">+1</text>
              <text x={legX + legW + 6} y={legY + legH / 2} fill={S.muted} fontSize={7} dominantBaseline="middle">
                Spearman ρ
              </text>
            </g>
          )
        })()}
      </svg>
      {/* Threshold filter slider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
        <span style={{ color: S.muted, fontSize: 9, flexShrink: 0 }}>Dim |ρ| &lt;</span>
        <input type="range" min="0" max="0.95" step="0.05" value={threshold}
          onChange={e => setThreshold(Number(e.target.value))}
          style={{ flex: 1, accentColor: S.primary, height: 4, cursor: 'pointer' }} />
        <span style={{ color: threshold > 0 ? S.primary : S.muted, fontSize: 9, fontFamily: 'monospace', width: 32, textAlign: 'right' }}>
          {threshold > 0 ? threshold.toFixed(2) : 'off'}
        </span>
        {threshold > 0 && (
          <button onClick={() => setThreshold(0)}
            style={{ background: 'transparent', color: S.muted, border: `1px solid ${S.border}`, borderRadius: 4, padding: '1px 7px', fontSize: 9, cursor: 'pointer' }}>
            Reset
          </button>
        )}
      </div>
      <p style={{ color: S.muted, fontSize: 8, margin: '3px 0 0', opacity: 0.55 }}>
        Hover a cell to highlight row/col · Click for details · Threshold slider dims weak correlations · Spearman ρ between 13 microstructure features
      </p>
    </div>
  )
}

function LGBMScatterChart({ ticker, S }: { ticker: string; S: Theme }) {
  const isDark = useIsDark()
  const [foldFilter, setFoldFilter] = useState<number | null>(null)
  const [zoomArea, setZoomArea] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const [zoomedDomain, setZoomedDomain] = useState<{ x: [number, number]; y: [number, number] } | null>(null)
  // Attach pinch/Ctrl+scroll zoom to WINDOW (not the element) so the handler
  // runs before Chrome's native page-zoom default action, regardless of whether
  // the chart container DOM element exists yet. Guard with isInsideRef so it
  // only fires when the pointer is actually over the chart.
  const isInsideRef  = useRef(false)
  const zoomStateRef = useRef<{ domain: [number, number]; maxV: number }>({ domain: [-1, 1], maxV: 1 })
  useEffect(() => {
    const handler = (e: WheelEvent) => {
      if (!isInsideRef.current) return
      if (!e.ctrlKey && !e.metaKey) return   // macOS pinch fires ctrlKey=true
      e.preventDefault()
      const factor = e.deltaY > 0 ? 1.25 : 1 / 1.25
      setZoomedDomain(prev => {
        const base = prev ?? { x: zoomStateRef.current.domain, y: zoomStateRef.current.domain }
        const cx = (base.x[0] + base.x[1]) / 2
        const cy = (base.y[0] + base.y[1]) / 2
        const mv = zoomStateRef.current.maxV
        const xH = Math.min((base.x[1] - base.x[0]) / 2 * factor, mv * 1.1)
        const yH = Math.min((base.y[1] - base.y[0]) / 2 * factor, mv * 1.1)
        if (xH < 0.00001) return prev
        return { x: [cx - xH, cx + xH] as [number, number], y: [cy - yH, cy + yH] as [number, number] }
      })
    }
    window.addEventListener('wheel', handler, { passive: false })
    return () => window.removeEventListener('wheel', handler)
  }, [])
  const q = useQuery({ queryKey: ['lgbmScatter', ticker], queryFn: () => axios.get(`/api/intraday/lgbm-scatter?ticker=${ticker}`).then(r => r.data), staleTime: STALE_EXPENSIVE_COMPUTE_MS })
  if (q.isPending) return <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: S.muted, fontSize: 11, background: S.cardBg, borderRadius: 8 }}>Running walk-forward LightGBM… (~15s)</div>
  if (q.isError || !q.data?.points?.length) return <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: S.muted, fontSize: 11, background: S.cardBg, borderRadius: 8 }}>No scatter data — run intraday pipeline first</div>
  const allPts: { predicted: number; actual: number; fold: number }[] = q.data.points
  const folds = [...new Set(allPts.map(p => p.fold))].sort((a, b) => a - b)
  const pts = foldFilter !== null ? allPts.filter(p => p.fold === foldFilter) : allPts

  // Compute r² and directional accuracy
  const yMean = pts.reduce((s, p) => s + p.actual, 0) / pts.length
  const ssTot = pts.reduce((s, p) => s + (p.actual - yMean) ** 2, 0)
  const ssRes = pts.reduce((s, p) => s + (p.actual - p.predicted) ** 2, 0)
  const r2    = Math.max(0, 1 - ssRes / Math.max(ssTot, 1e-12))
  const dirAcc = pts.filter(p => Math.sign(p.predicted) === Math.sign(p.actual)).length / pts.length

  // OLS regression line: y = m*x + b
  const n = pts.length
  const sx  = pts.reduce((a, p) => a + p.predicted, 0)
  const sy  = pts.reduce((a, p) => a + p.actual, 0)
  const sxy = pts.reduce((a, p) => a + p.predicted * p.actual, 0)
  const sx2 = pts.reduce((a, p) => a + p.predicted ** 2, 0)
  const olsDen = n * sx2 - sx * sx
  const olsSlope     = Math.abs(olsDen) > 1e-12 ? (n * sxy - sx * sy) / olsDen : 0
  const olsIntercept = (sy - olsSlope * sx) / n

  // Split by direction correctness
  const ptsGreen = pts.filter(p => Math.sign(p.predicted) === Math.sign(p.actual))
    .map(p => ({ x: p.predicted, y: p.actual, fold: p.fold }))
  const ptsRed   = pts.filter(p => Math.sign(p.predicted) !== Math.sign(p.actual))
    .map(p => ({ x: p.predicted, y: p.actual, fold: p.fold }))

  const maxV = Math.max(...pts.flatMap(p => [Math.abs(p.predicted), Math.abs(p.actual)]), 0.005)
  const domain: [number, number] = [-maxV * 1.1, maxV * 1.1]
  zoomStateRef.current = { domain, maxV }  // keep wheel handler in sync with current data range

  const ScatterTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.[0]) return null
    const { x, y } = payload[0].payload
    const correct = Math.sign(x) === Math.sign(y)
    return (
      <div style={{ background: S.tipBg, border: `1px solid ${S.tipBorder}`, borderRadius: 8, padding: '8px 12px', maxWidth: 270, fontSize: 11 }}>
        <p style={{ color: correct ? '#56d364' : '#f78166', fontWeight: 700, margin: '0 0 5px' }}>
          {correct ? '✓ Direction correct' : '✗ Direction wrong'}
        </p>
        <p style={{ color: '#CBD5E1', margin: '0 0 3px' }}>
          Predicted: <strong style={{ color: x >= 0 ? '#56d364' : '#f78166' }}>{x >= 0 ? '+' : ''}{(x * 100).toFixed(3)}%</strong>
          <span style={{ color: '#64748B', marginLeft: 4, fontSize: 10 }}>— model expects {x >= 0 ? 'up' : 'down'}</span>
        </p>
        <p style={{ color: '#CBD5E1', margin: 0 }}>
          Actual: <strong style={{ color: y >= 0 ? '#56d364' : '#f78166' }}>{y >= 0 ? '+' : ''}{(y * 100).toFixed(3)}%</strong>
          <span style={{ color: '#64748B', marginLeft: 4, fontSize: 10 }}>— price moved {y >= 0 ? 'up' : 'down'}</span>
        </p>
      </div>
    )
  }

  return (
    <div>
      {/* Stats + fold filter header */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ background: S.cardBg, border: `1px solid ${S.border}`, borderRadius: 6, padding: '5px 12px', fontSize: 10 }}>
          <span style={{ color: S.muted }}>R² </span>
          <span style={{ color: S.muted, fontFamily: 'monospace' }}>{r2.toFixed(4)}</span>
          <span style={{ color: S.muted, fontSize: 8, marginLeft: 4, opacity: 0.6 }}>(not the signal metric — see Dir. Acc.)</span>
        </div>
        <div style={{ background: S.cardBg, border: `1px solid ${S.border}`, borderRadius: 6, padding: '5px 12px', fontSize: 10 }}>
          <span style={{ color: S.muted }}>Dir. Acc. </span>
          <span style={{ color: dirAcc > 0.55 ? S.positiveVal : dirAcc > 0.50 ? S.warnVal : S.negativeVal, fontWeight: 700, fontFamily: 'monospace', fontSize: 12 }}>{(dirAcc * 100).toFixed(1)}%</span>
          <span style={{ color: S.muted, fontSize: 8, marginLeft: 4 }}>(≥55% = edge)</span>
        </div>
        <div style={{ background: S.cardBg, border: `1px solid ${S.border}`, borderRadius: 6, padding: '5px 12px', fontSize: 10 }}>
          <span style={{ color: S.muted }}>Folds </span>
          <span style={{ color: S.text, fontWeight: 700, fontFamily: 'monospace' }}>{q.data.n_folds}</span>
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', marginLeft: 'auto' }}>
          <span style={{ color: S.muted, fontSize: 9 }}>Fold:</span>
          <button onClick={() => setFoldFilter(null)}
            style={{ background: foldFilter === null ? S.primary : 'transparent', color: foldFilter === null ? '#fff' : S.muted, border: `1px solid ${foldFilter === null ? S.primary : S.border}`, borderRadius: 4, padding: '2px 8px', fontSize: 9, cursor: 'pointer' }}>
            All
          </button>
          {folds.map(f => (
            <button key={f} onClick={() => setFoldFilter(foldFilter === f ? null : f)}
              style={{ background: foldFilter === f ? S.primary : 'transparent', color: foldFilter === f ? '#fff' : S.muted, border: `1px solid ${foldFilter === f ? S.primary : S.border}`, borderRadius: 4, padding: '2px 7px', fontSize: 9, cursor: 'pointer' }}>
              {f}
            </button>
          ))}
        </div>
        {zoomedDomain && (
          <button onClick={() => setZoomedDomain(null)}
            style={{ background: S.tag, color: S.muted, border: `1px solid ${S.primary}55`, borderRadius: 4, padding: '2px 8px', fontSize: 9, cursor: 'pointer' }}>
            Reset Zoom
          </button>
        )}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ color: S.positiveVal, fontSize: 9 }}>● correct dir.</span>
          <span style={{ color: S.negativeVal, fontSize: 9 }}>● wrong dir.</span>
        </div>
      </div>
      <div style={{ background: S.cardBg, borderRadius: 8, border: `1px solid ${S.border}`, padding: '8px 4px 4px', touchAction: 'none' }}
        onMouseEnter={() => { isInsideRef.current = true }}
        onMouseLeave={() => { isInsideRef.current = false }}>
        <ResponsiveContainer width="100%" height={380}>
          <ScatterChart
            margin={{ top: 5, right: 20, bottom: 24, left: 18 }}
            onMouseDown={(e: any) => { if (e?.xValue != null) setZoomArea({ x1: e.xValue, y1: e.yValue, x2: e.xValue, y2: e.yValue }) }}
            onMouseMove={(e: any) => { if (zoomArea && e?.xValue != null) setZoomArea(z => z ? { ...z, x2: e.xValue, y2: e.yValue } : null) }}
            onMouseUp={() => {
              if (zoomArea && (Math.abs(zoomArea.x1 - zoomArea.x2) > 0.0001 || Math.abs(zoomArea.y1 - zoomArea.y2) > 0.0001)) {
                setZoomedDomain({ x: [Math.min(zoomArea.x1, zoomArea.x2), Math.max(zoomArea.x1, zoomArea.x2)], y: [Math.min(zoomArea.y1, zoomArea.y2), Math.max(zoomArea.y1, zoomArea.y2)] })
              }
              setZoomArea(null)
            }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={S.border} />
            <XAxis type="number" dataKey="x" domain={zoomedDomain ? zoomedDomain.x : domain} tick={{ fill: S.muted, fontSize: 9 }} tickLine={false} axisLine={{ stroke: S.border }}
              tickFormatter={v => v.toFixed(3)}
              label={{ value: 'Predicted Return', position: 'insideBottom', offset: -14, fill: S.muted, fontSize: 9 }} />
            <YAxis type="number" dataKey="y" domain={zoomedDomain ? zoomedDomain.y : domain} tick={{ fill: S.muted, fontSize: 9 }} tickLine={false} axisLine={false}
              tickFormatter={v => v.toFixed(3)}
              label={{ value: 'Actual Return', angle: -90, position: 'insideLeft', offset: 14, fill: S.muted, fontSize: 9, dx: -4 }} />
            <ReferenceLine x={0} stroke={S.border} strokeWidth={0.8} />
            <ReferenceLine y={0} stroke={S.border} strokeWidth={0.8} />
            {/* Perfect prediction diagonal y=x */}
            <ReferenceLine
              segment={[{ x: (zoomedDomain?.x ?? domain)[0], y: (zoomedDomain?.x ?? domain)[0] }, { x: (zoomedDomain?.x ?? domain)[1], y: (zoomedDomain?.x ?? domain)[1] }]}
              stroke={S.muted} strokeDasharray="5 3" strokeOpacity={0.5} strokeWidth={1}
              label={{ value: 'y=x', fill: S.muted, fontSize: 8, position: 'insideTopRight' }} />
            {/* OLS regression line */}
            <ReferenceLine
              segment={[{ x: (zoomedDomain?.x ?? domain)[0], y: olsSlope * (zoomedDomain?.x ?? domain)[0] + olsIntercept }, { x: (zoomedDomain?.x ?? domain)[1], y: olsSlope * (zoomedDomain?.x ?? domain)[1] + olsIntercept }]}
              stroke={S.primary} strokeDasharray="3 2" strokeOpacity={0.7} strokeWidth={1.5}
              label={{ value: `OLS m=${olsSlope.toFixed(2)}`, fill: S.primary, fontSize: 8, position: 'insideBottomRight' }} />
            <RechartsTooltip content={<ScatterTooltip />} cursor={{ strokeDasharray: '3 3' }} />
            <Scatter name="Correct dir" data={ptsGreen} fill={S.positiveVal} fillOpacity={0.65} r={3} />
            <Scatter name="Wrong dir"  data={ptsRed}   fill={S.negativeVal} fillOpacity={0.65} r={3} />
            {zoomArea && (
              <ReferenceArea x1={zoomArea.x1} x2={zoomArea.x2} y1={zoomArea.y1} y2={zoomArea.y2}
                strokeOpacity={0.4} fill={S.primary} fillOpacity={0.1} />
            )}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <p style={{ color: S.muted, fontSize: 9, textAlign: 'center', margin: '4px 0 0', opacity: 0.65, lineHeight: 1.6 }}>
        R² ≈ 0 is expected for return prediction — signal edge is measured by Direction Accuracy
        (≥50% = statistically meaningful, ≥55% = strong edge). The OLS trendline slope &gt; 0
        confirms the model&apos;s directional bias is correct even with low R².
        · Moreira &amp; Muir (2017) variance-managed position sizing.
        <span style={{ opacity: 0.4 }}> · Pinch or Ctrl+scroll to zoom · drag to box-select a region</span>
      </p>
    </div>
  )
}

// ── Rolling IC Chart ─ IC per walk-forward fold (Grinold & Kahn 2000) ────────
function RollingICChart({ ticker, S }: { ticker: string; S: Theme }) {
  const q = useQuery({
    queryKey: ['intradaySignals'],
    staleTime: STALE_EXPENSIVE_COMPUTE_MS,
  })
  const sigData: any[] = (q.data as any)?.signals ?? []
  const entry = sigData.find((s: any) => s.ticker === ticker)
  const folds: number[] = entry?.ic_per_fold ?? []
  if (!folds.length) return (
    <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: S.muted, fontSize: 11, background: S.cardBg, borderRadius: 8 }}>
      No fold IC data — run intraday pipeline first
    </div>
  )
  const data = folds.map((ic, i) => ({ fold: i + 1, ic, icPct: ic * 100 }))
  const meanIC = folds.reduce((a, b) => a + b, 0) / folds.length
  const stdIC = Math.sqrt(folds.reduce((a, b) => a + (b - meanIC) ** 2, 0) / Math.max(folds.length - 1, 1))
  const icIR = stdIC > 0 ? (meanIC / stdIC) * Math.sqrt(folds.length) : 0
  const positiveFolds = folds.filter(ic => ic > 0).length
  return (
    <div style={{ background: S.cardBg, borderRadius: 10, padding: '14px 16px 10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <p style={{ color: S.text, fontSize: 11, fontWeight: 700, margin: '0 0 2px' }}>IC per Walk-Forward Fold — {ticker}</p>
          <p style={{ color: S.muted, fontSize: 9, margin: 0, opacity: 0.6 }}>Consistency of OFI → return signal across {folds.length} folds · Grinold & Kahn (2000) Fundamental Law</p>
        </div>
        <div style={{ display: 'flex', gap: 14 }}>
          <div style={{ textAlign: 'right' }}>
            <p style={{ color: S.muted, fontSize: 8, margin: '0 0 2px', textTransform: 'uppercase' }}>IC_IR</p>
            <p style={{ color: Math.abs(icIR) >= 1 ? S.positiveVal : Math.abs(icIR) >= 0.5 ? S.warnVal : S.muted, fontSize: 14, fontWeight: 800, margin: 0, fontFamily: 'monospace' }}>{icIR.toFixed(2)}</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ color: S.muted, fontSize: 8, margin: '0 0 2px', textTransform: 'uppercase' }}>+ve folds</p>
            <p style={{ color: positiveFolds / folds.length >= 0.6 ? S.positiveVal : S.warnVal, fontSize: 14, fontWeight: 800, margin: 0 }}>{positiveFolds}/{folds.length}</p>
          </div>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={185}>
        <ComposedChart data={data} margin={{ top: 4, right: 10, bottom: 4, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={S.border} vertical={false} />
          <XAxis dataKey="fold" tick={{ fill: S.muted, fontSize: 8 }} axisLine={false} tickLine={false} label={{ value: 'Walk-Forward Fold', position: 'insideBottom', offset: -2, fill: S.muted, fontSize: 8 }} />
          <YAxis tick={{ fill: S.muted, fontSize: 9 }} axisLine={false} tickLine={false}
            tickFormatter={(v: number) => `${(v).toFixed(1)}%`}
            label={{ value: 'IC %', angle: -90, position: 'insideLeft', fill: S.muted, fontSize: 8 }} />
          <RechartsTooltip
            contentStyle={{ background: S.tipBg, border: `1px solid ${S.tipBorder}`, borderRadius: 8, fontSize: 10 }}
            labelStyle={{ color: '#38BDF8', fontWeight: 700 }}
            itemStyle={{ color: '#CBD5E1' }}
            formatter={(v: any) => {
              const pct = Number(v)
              const note = pct >= 5 ? '✓ above Grinold-Kahn 5% threshold' : pct >= 0 ? '△ positive but below 5% significance' : '✗ model underperformed this period — regime shift · IC_IR accounts for cross-fold variance — a few negative folds are expected'
              return [`${pct.toFixed(2)}% · ${note}`, 'IC']
            }}
            labelFormatter={(l: any) => {
              const testW = entry?.test_bars || 105
              const trainW = entry?.train_bars || 1260
              const trainStart = (l - 1) * testW + 1
              const testEnd = l * testW
              return `Fold ${l} — test bars ${trainStart}–${testEnd} (trained on prior ${trainW}h)`
            }}
          />
          <ReferenceLine y={5} stroke="#F59E0B" strokeDasharray="4 2" strokeWidth={1.2} label={{ value: '+5% threshold', fill: '#F59E0B', fontSize: 8, position: 'right' }} />
          <ReferenceLine y={-5} stroke="#F59E0B" strokeDasharray="4 2" strokeWidth={1.2} />
          <ReferenceLine y={0} stroke={S.border} strokeWidth={1} />
          <Bar dataKey="icPct" radius={[3, 3, 0, 0]}>
            {data.map((d) => (
              <Cell key={d.fold} fill={d.icPct >= 5 ? '#22C55E' : d.icPct >= 0 ? '#F59E0B' : '#EF4444'} fillOpacity={0.85} />
            ))}
          </Bar>
          <Line dataKey="icPct" dot={false} stroke={S.primary} strokeWidth={1.5} strokeOpacity={0.5} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 6, flexWrap: 'wrap' }}>
        <span style={{ color: S.muted, fontSize: 9 }}>🟢 IC ≥ 5% — above Grinold-Kahn threshold</span>
        <span style={{ color: S.muted, fontSize: 9 }}>🟡 IC 0–5% — positive, below significance</span>
        <span style={{ color: S.muted, fontSize: 9 }}>🔴 IC &lt; 0 — regime shift in this fold (expected; IC_IR smooths across folds)</span>
      </div>
      <p style={{ color: S.muted, fontSize: 8, textAlign: 'center', margin: '3px 0 0', opacity: 0.45 }}>
        Walk-forward: train {entry?.train_bars ?? 1260}h → test {entry?.test_bars ?? 105}h, no overlap · IC_IR = mean(IC)/std(IC)×√N
      </p>
    </div>
  )
}

// ── VPIN Flow Toxicity Chart ─ Easley, López de Prado & O'Hara (2012) ─────────
function VPINTooltip({ active, payload, label }: any) {
  const S = useS()
  if (!active || !payload?.[0]) return null
  const z = Number(payload[0].value)
  const barsBack = Math.abs(Number(label))
  const isToxic = Math.abs(z) >= 1.5
  const isElevated = Math.abs(z) >= 0.8
  const levelColor = isToxic ? '#EF4444' : isElevated ? '#F59E0B' : '#38BDF8'
  const level = isToxic ? 'TOXIC' : isElevated ? 'ELEVATED' : 'BENIGN'
  const note = isToxic
    ? 'Informed trading likely — expect directional price impact within 1-3 bars'
    : isElevated
    ? 'Above-avg order imbalance — monitor for directional follow-through'
    : 'Symmetric uninformed flow — no material signal'
  return (
    <div style={{ background: S.tipBg, border: `1px solid ${S.tipBorder}`, borderRadius: 8,
      padding: '8px 12px', maxWidth: 280, fontSize: 11 }}>
      <p style={{ color: '#7DD3FC', fontWeight: 700, margin: '0 0 4px' }}>
        {barsBack} bars back from now
      </p>
      <p style={{ color: levelColor, fontWeight: 700, margin: '0 0 3px', fontSize: 12 }}>
        [{level}] {z.toFixed(3)}σ
      </p>
      <p style={{ color: '#CBD5E1', margin: 0, fontSize: 10, lineHeight: 1.5 }}>{note}</p>
    </div>
  )
}

function VPINChart({ ticker, S }: { ticker: string; S: Theme }) {
  const isDark = useIsDark()
  const [nBars, setNBars] = useState(80)
  const q = useQuery({
    queryKey: ['vpin', ticker, nBars],
    queryFn: () => axios.get(`/api/intraday/vpin?ticker=${ticker}&n=${nBars}`).then(r => r.data),
    staleTime: STALE_CHART_DATA_MS,
  })
  if (q.isPending) return <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: S.muted, fontSize: 11, background: S.cardBg, borderRadius: 8, gap: 8 }}><div style={{ width: 14, height: 14, borderWidth: 2, borderStyle: 'solid', borderColor: S.primary, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />Loading VPIN…</div>
  if (q.isError || !q.data?.data?.length) return <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: S.muted, fontSize: 11, background: S.cardBg, borderRadius: 8 }}>No VPIN data — run intraday pipeline first</div>
  const rawData = q.data.data ?? []
  const zscores: number[] = rawData.map((p: { vpin_z: number }) => p.vpin_z)
  const toxicBars = zscores.filter(z => Math.abs(z) >= 1.5).length
  const data = rawData.map((p: { vpin_z: number; time?: string }, i: number) => ({
    bar: formatBarTime(p.time ?? ''),
    rawTime: p.time ?? '',
    z: p.vpin_z,
    idx: i,
  }))
  return (
    <div style={{ background: S.cardBg, borderRadius: 10, padding: '14px 16px 10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <p style={{ color: S.text, fontSize: 11, fontWeight: 700, margin: '0 0 2px' }}>VPIN Flow Toxicity Z-Score — {ticker}</p>
          <p style={{ color: S.muted, fontSize: 9, margin: 0, opacity: 0.6 }}>Volume-Synchronized Probability of Informed Trading · BVC method · Easley, López de Prado & O'Hara (2012)</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ color: S.muted, fontSize: 8, margin: '0 0 2px', textTransform: 'uppercase' }}>Toxic bars</p>
          <p style={{ color: toxicBars > 0 ? '#EF4444' : S.positiveVal, fontSize: 14, fontWeight: 800, margin: 0 }}>{toxicBars}/{zscores.length}</p>
        </div>
      </div>
      <div style={{ background: S.bg, borderRadius: 6, padding: '6px 10px', marginBottom: 8, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <span style={{ color: S.muted, fontSize: 9 }}>Formula: <code style={{ color: S.primary, fontSize: 8 }}>VPIN = mean(|V_buy − V_sell|/V_bar)</code></span>
        <span style={{ color: S.muted, fontSize: 9 }}>BVC: <code style={{ color: S.primary, fontSize: 8 }}>buy_frac = (close−low)/(high−low)</code></span>
      </div>
      <div style={{ background: '#713f1222', border: '1px solid #F59E0B33', borderRadius: 6, padding: '5px 10px', marginBottom: 8, fontSize: 9, color: '#F59E0B', lineHeight: 1.5 }}>
        ⊕ BVC proxy on OHLCV bars, not true trade-classification data — same limitation as Kyle's λ. Hourly bars are sourced primarily from yfinance (consolidated); the Alpaca IEX fallback/live-stream path covers only ~2-5% of consolidated volume when active.
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ color: S.muted, fontSize: 9 }}>Window:</span>
        {([40, 80, 150] as const).map(n => (
          <button key={n} onClick={() => setNBars(n)}
            style={{ background: nBars === n ? S.primary : 'transparent', color: nBars === n ? '#fff' : S.muted, border: `1px solid ${nBars === n ? S.primary : S.border}`, borderRadius: 4, padding: '2px 8px', fontSize: 9, cursor: 'pointer' }}>
            {n}h <span style={{ opacity: 0.6, fontSize: 8 }}>(&asymp;{Math.round(n / 7)}d)</span>
          </button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={175}>
        <BarChart data={data} margin={{ top: 4, right: 10, bottom: 4, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={S.border} vertical={false} />
          <XAxis dataKey="bar" tick={{ fill: S.muted, fontSize: 8 }} axisLine={false} tickLine={false}
            interval={Math.max(0, Math.ceil(data.length / 7) - 1)}
            label={{ value: 'Time (hourly)', position: 'insideBottom', offset: -2, fill: S.muted, fontSize: 8 }} />
          <YAxis tick={{ fill: S.muted, fontSize: 9 }} axisLine={false} tickLine={false}
            label={{ value: 'VPIN z', angle: -90, position: 'insideLeft', fill: S.muted, fontSize: 8 }} />
          <RechartsTooltip content={<VPINTooltip />} cursor={{ fill: S.border + '33' }} />
          <ReferenceLine y={1.5} stroke="#EF4444" strokeDasharray="4 2" strokeWidth={1.2} label={{ value: 'toxic ↑', fill: '#EF4444', fontSize: 8, position: 'right' }} />
          <ReferenceLine y={-1.5} stroke="#EF4444" strokeDasharray="4 2" strokeWidth={1.2} />
          <ReferenceLine y={0} stroke={S.border} strokeWidth={1} />
          <Bar dataKey="z" radius={[2, 2, 0, 0]}>
            {data.map((d: { bar: string; z: number; idx: number }) => (
              <Cell key={d.idx} fill={Math.abs(d.z) >= 1.5 ? '#EF4444' : Math.abs(d.z) >= 0.8 ? '#F59E0B' : (isDark ? '#64748B' : '#475569')} fillOpacity={0.8} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p style={{ color: S.muted, fontSize: 8, textAlign: 'center', margin: '4px 0 0', opacity: 0.45 }}>
        Red |z|≥1.5 = toxic order flow · Amber 0.8–1.5 = elevated · Grey = benign
      </p>
    </div>
  )
}

// ── Walk-Forward Equity Curve ─────────────────────────────────────────
function WalkForwardEquityCurve({ ticker, S }: { ticker: string; S: Theme }) {
  const [barWindow, setBarWindow] = useState<number | null>(null)
  const q = useQuery({
    queryKey: ['equityCurve', ticker],
    queryFn: () => axios.get(`/api/intraday/equity-curve?ticker=${ticker}`).then(r => r.data),
    staleTime: STALE_EXPENSIVE_COMPUTE_MS,
  })
  if (q.isPending) return <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: S.muted, fontSize: 11, background: S.cardBg, borderRadius: 8, gap: 8 }}><div style={{ width: 14, height: 14, borderWidth: 2, borderStyle: 'solid', borderColor: S.primary, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />Loading equity curve…</div>
  if (q.isError || !q.data?.equity_curve?.length) return <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: S.muted, fontSize: 11, background: S.cardBg, borderRadius: 8 }}>No equity data — run intraday pipeline first</div>

  const data: { bar: number; equity: number }[] = q.data.equity_curve
  const displayData = barWindow ? data.slice(-barWindow) : data

  // Metrics from API
  const final        = displayData[displayData.length - 1]?.equity ?? 1
  const sharpe       = q.data.sharpe       ?? 0
  const maxDD        = q.data.max_drawdown ?? 0
  const calmar       = q.data.calmar       ?? 0
  const hitRate      = q.data.hit_rate     ?? 0
  const profitFactor = q.data.profit_factor ?? 1
  const icTstat      = q.data.ic_tstat     ?? 0
  const icPvalue     = q.data.ic_pvalue    ?? 1
  const icIr         = q.data.ic_ir        ?? 0
  const testBars     = q.data.test_bars    || 105
  const nFolds       = q.data.n_folds      ?? 0
  const nBarsTotal   = q.data.n_bars       ?? data.length

  const finalColor = final >= 1 ? S.positiveVal : S.negativeVal

  // Compute rolling-peak drawdown series
  let peakVal = 1.0
  const ddData = displayData.map(d => {
    peakVal = Math.max(peakVal, d.equity)
    return {
      bar:    d.bar,
      equity: d.equity,
      dd:     peakVal > 0 ? (d.equity - peakVal) / peakVal : 0,   // ≤ 0
    }
  })

  const peak     = Math.max(...ddData.map(d => d.equity), 1)
  const domainMin = Math.min(...ddData.map(d => d.equity), 0.9)
  const domainMax = peak * 1.05

  // Fold boundary bars (every testBars within visible window)
  const firstBar = displayData[0]?.bar ?? 1
  const lastBar  = displayData[displayData.length - 1]?.bar ?? 1
  const foldBoundaryBars = Array.from(
    { length: Math.ceil(nBarsTotal / testBars) },
    (_, i) => (i + 1) * testBars
  ).filter(b => b >= firstBar && b <= lastBar)

  const metricBadge = (label: string, value: string, color: string) => (
    <div style={{ background: S.cardBg, border: `1px solid ${S.border}`, borderRadius: 6, padding: '4px 10px', fontSize: 10, minWidth: 80 }}>
      <div style={{ color: S.muted, fontSize: 8, marginBottom: 1 }}>{label}</div>
      <div style={{ color, fontWeight: 700, fontFamily: 'monospace', fontSize: 11 }}>{value}</div>
    </div>
  )

  return (
    <div>
      {/* Bar window selector */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ color: S.muted, fontSize: 9 }}>Window:</span>
        {([250, 500, 1000, null] as (number | null)[]).map(w => (
          <button key={w ?? 'all'} onClick={() => setBarWindow(w)}
            style={{ background: barWindow === w ? S.primary : 'transparent', color: barWindow === w ? '#fff' : S.muted, border: `1px solid ${barWindow === w ? S.primary : S.border}`, borderRadius: 4, padding: '2px 8px', fontSize: 9, cursor: 'pointer' }}>
            {w ? `${w}b (≈${Math.round(w / 7)}d)` : 'All'}
          </button>
        ))}
        <span style={{ color: S.muted, fontSize: 8, opacity: 0.4, marginLeft: 4 }}>
          {nFolds} monthly folds · {nBarsTotal} total hourly bars
        </span>
      </div>

      {/* Tearsheet metrics — row 1 */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
        {metricBadge('Final PnL', `${final >= 1 ? '+' : ''}${((final - 1) * 100).toFixed(2)}%`, finalColor)}
        {metricBadge('Sharpe', sharpe.toFixed(2), sharpe >= 1 ? S.positiveVal : sharpe >= 0 ? S.warnVal : S.negativeVal)}
        {metricBadge('Max DD', `${(maxDD * 100).toFixed(1)}%`, Math.abs(maxDD) > 0.2 ? S.negativeVal : S.warnVal)}
        {metricBadge('Calmar', calmar.toFixed(2), calmar >= 1 ? S.positiveVal : calmar >= 0 ? S.warnVal : S.negativeVal)}
      </div>
      {/* Tearsheet metrics — row 2 */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        {metricBadge('IC t-stat', icTstat.toFixed(2), Math.abs(icTstat) >= 2 ? S.positiveVal : S.warnVal)}
        {metricBadge('IC p-val', icPvalue.toFixed(3), icPvalue <= 0.05 ? S.positiveVal : icPvalue <= 0.1 ? S.warnVal : S.negativeVal)}
        {metricBadge('Hit Rate', `${(hitRate * 100).toFixed(1)}%`, hitRate >= 0.55 ? S.positiveVal : hitRate >= 0.50 ? S.warnVal : S.negativeVal)}
        {metricBadge('Prof. Factor', profitFactor.toFixed(2), profitFactor >= 1.5 ? S.positiveVal : profitFactor >= 1.0 ? S.warnVal : S.negativeVal)}
        {metricBadge('IC IR', icIr.toFixed(2), icIr >= 1 ? S.positiveVal : icIr >= 0.5 ? S.warnVal : S.negativeVal)}
      </div>

      {/* Chart — equity + drawdown overlay */}
      <div style={{ background: S.cardBg, borderRadius: 8, border: `1px solid ${S.border}`, padding: '8px 4px 4px' }}>
        <ResponsiveContainer width="100%" height={250}>
          <ComposedChart data={ddData} margin={{ top: 5, right: 48, bottom: 24, left: 18 }}>
            <defs>
              <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={final >= 1 ? '#56d364' : '#f78166'} stopOpacity={0.25} />
                <stop offset="95%" stopColor={final >= 1 ? '#56d364' : '#f78166'} stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"  stopColor="#EF4444" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#EF4444" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={S.border} vertical={false} />
            <XAxis dataKey="bar" tick={{ fill: S.muted, fontSize: 8 }} tickLine={false} axisLine={{ stroke: S.border }}
              tickFormatter={(bar: number) => {
                const fold = Math.ceil(bar / testBars)
                return `F${fold}`
              }}
              label={{ value: 'Fold (monthly out-of-sample)', position: 'insideBottom', offset: -14, fill: S.muted, fontSize: 9 }} />
            {/* Left axis — equity return */}
            <YAxis yAxisId="eq" tick={{ fill: S.muted, fontSize: 9 }} tickLine={false} axisLine={false}
              domain={[domainMin, domainMax]}
              tickFormatter={v => `${((v - 1) * 100).toFixed(0)}%`}
              label={{ value: 'Cum. PnL', angle: -90, position: 'insideLeft', offset: 14, fill: S.muted, fontSize: 9, dx: -4 }} />
            {/* Right axis — drawdown (inverted: 0 at top) */}
            <YAxis yAxisId="dd" orientation="right" tick={{ fill: '#EF444488', fontSize: 8 }} tickLine={false} axisLine={false}
              domain={[-1, 0]}
              tickFormatter={v => `${(v * 100).toFixed(0)}%`}
              width={40} />
            <RechartsTooltip
              contentStyle={{ background: S.tipBg, border: `1px solid ${S.tipBorder}`, borderRadius: 8, fontSize: 11, padding: '8px 12px' }}
              labelStyle={{ color: '#38BDF8', fontWeight: 700, marginBottom: 4 }}
              itemStyle={{ color: '#CBD5E1' }}
              labelFormatter={(bar: number) => `Bar ${bar} · Fold ${Math.ceil(bar / testBars)}`}
              formatter={(val: any, name: string) => {
                const v = Number(val)
                if (name === 'equity') {
                  const pct = ((v - 1) * 100).toFixed(2)
                  return [`${v >= 1 ? '+' : ''}${pct}% (${v.toFixed(4)}×)`, 'Equity']
                }
                return [`${(v * 100).toFixed(2)}%`, 'Drawdown']
              }} />
            {/* Break-even reference */}
            <ReferenceLine yAxisId="eq" y={1} stroke={S.muted} strokeDasharray="5 3" strokeOpacity={0.6} strokeWidth={1}
              label={{ value: 'Break-even', fill: S.muted, fontSize: 8, position: 'insideTopRight' }} />
            {/* Fold boundary vertical lines */}
            {foldBoundaryBars.map(b => (
              <ReferenceLine key={b} yAxisId="eq" x={b} stroke={S.border} strokeDasharray="2 4" strokeWidth={1} />
            ))}
            {/* Drawdown area (right axis, red shading) */}
            <Area yAxisId="dd" type="monotone" dataKey="dd"
              fill="url(#ddGrad)" stroke="#EF444444" strokeWidth={1}
              dot={false} activeDot={false} isAnimationActive={false}
              baseValue={0} />
            {/* Equity curve (left axis, green/red line + fill) */}
            <Area yAxisId="eq" type="monotone" dataKey="equity"
              fill="url(#eqGrad)" stroke={finalColor} strokeWidth={2}
              dot={false} activeDot={{ r: 4, strokeWidth: 0 }}
              isAnimationActive animationDuration={800}
              baseValue={1} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p style={{ color: S.muted, fontSize: 9, textAlign: 'center', margin: '4px 0 0', opacity: 0.45, lineHeight: 1.5 }}>
        Walk-forward PnL · normalised to 1.0 · signal-weighted long-short · variance-managed · red shading = drawdown from peak
      </p>
    </div>
  )
}

// ── SHAP Dependence Plot ──────────────────────────────────────────────
function SHAPDependencePlot({ ticker, S }: { ticker: string; S: Theme }) {
  const FEATS = ['ofi_zscore', 'vwap_zscore', 'hawkes_zscore', 'amihud', 'kyle_lambda', 'vol_ratio', 'ret_1h', 'ret_3h']
  const [selFeat, setSelFeat] = useState('ofi_zscore')
  const [zoomArea, setZoomArea] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const [zoomedDomain, setZoomedDomain] = useState<{ x: [number, number]; y: [number, number] } | null>(null)
  // Ctrl+scroll / pinch zoom — attached to window, gated by isInsideRef (same pattern as LGBMScatterChart)
  const isInsideRef  = useRef(false)
  const zoomStateRef = useRef<{ xDomain: [number, number]; yDomain: [number, number] }>({ xDomain: [-1, 1], yDomain: [-1, 1] })
  useEffect(() => {
    const handler = (e: WheelEvent) => {
      if (!isInsideRef.current) return
      if (!e.ctrlKey && !e.metaKey) return   // macOS pinch fires ctrlKey=true
      e.preventDefault()
      const factor = e.deltaY > 0 ? 1.25 : 1 / 1.25
      setZoomedDomain(prev => {
        const nat = zoomStateRef.current
        const base = prev ?? { x: nat.xDomain, y: nat.yDomain }
        const cx = (base.x[0] + base.x[1]) / 2
        const cy = (base.y[0] + base.y[1]) / 2
        const natXH = (nat.xDomain[1] - nat.xDomain[0]) / 2
        const natYH = (nat.yDomain[1] - nat.yDomain[0]) / 2
        const xH = Math.min((base.x[1] - base.x[0]) / 2 * factor, natXH)
        const yH = Math.min((base.y[1] - base.y[0]) / 2 * factor, natYH)
        if (xH < 1e-9 || yH < 1e-9) return prev
        if (xH >= natXH * 0.999 && yH >= natYH * 0.999) return null   // fully zoomed out → natural view
        return { x: [cx - xH, cx + xH] as [number, number], y: [cy - yH, cy + yH] as [number, number] }
      })
    }
    window.addEventListener('wheel', handler, { passive: false })
    return () => window.removeEventListener('wheel', handler)
  }, [])
  const q = useQuery({
    queryKey: ['shapDep', ticker, selFeat],
    queryFn: () => axios.get(`/api/intraday/shap-dependence?ticker=${ticker}&feature=${selFeat}`).then(r => r.data),
    staleTime: STALE_SHAP_DEPENDENCE_MS,
  })
  // Reset any active zoom when the ticker or feature selection changes (new data range)
  useEffect(() => { setZoomedDomain(null); setZoomArea(null) }, [ticker, selFeat])
  const pts = useMemo(() => (q.data?.points ?? []) as { feature_val: number; shap_val: number }[], [q.data])
  const xMin = pts.length ? Math.min(...pts.map(p => p.feature_val)) : 0
  const xMax = pts.length ? Math.max(...pts.map(p => p.feature_val)) : 0
  const xRange = xMax - xMin
  const xDomain: [number, number] = pts.length ? [xMin * 1.05, xMax * 1.05] : [-1, 1]
  const yDomain: [number, number] = pts.length ? [
    Math.min(...pts.map(p => p.shap_val)) * 1.1,
    Math.max(...pts.map(p => p.shap_val)) * 1.1,
  ] : [-1, 1]
  zoomStateRef.current = { xDomain, yDomain }  // keep wheel handler in sync with current data range
  const positive = pts.filter(p => p.shap_val >= 0).map(p => ({ x: p.feature_val, y: p.shap_val }))
  const negative = pts.filter(p => p.shap_val < 0).map(p => ({ x: p.feature_val, y: p.shap_val }))
  const activeX = zoomedDomain ? zoomedDomain.x : xDomain
  const activeY = zoomedDomain ? zoomedDomain.y : yDomain

  return (
    <div>
      {/* Feature selector */}
      <div style={{ display: 'flex', gap: 5, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {FEATS.map(f => (
          <button key={f} onClick={() => setSelFeat(f)}
            style={{ background: selFeat === f ? S.primary : S.surface, color: selFeat === f ? '#fff' : S.muted, border: `1.5px solid ${selFeat === f ? S.primary : S.border}`, borderRadius: 20, padding: '3px 10px', fontSize: 9, fontWeight: selFeat === f ? 700 : 500, cursor: 'pointer', transition: 'all 0.15s' }}>
            {FEATURE_FRIENDLY[f] ?? f}
          </button>
        ))}
        {zoomedDomain && (
          <button onClick={() => setZoomedDomain(null)}
            style={{ background: S.tag, color: S.muted, border: `1px solid ${S.primary}55`, borderRadius: 4, padding: '3px 9px', fontSize: 9, cursor: 'pointer', marginLeft: 'auto' }}>
            Reset Zoom
          </button>
        )}
      </div>
      {q.isPending ? (
        <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: S.muted, fontSize: 11, background: S.cardBg, borderRadius: 8, gap: 8 }}>
          <div style={{ width: 14, height: 14, borderWidth: 2, borderStyle: 'solid', borderColor: S.primary, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          Computing SHAP values… (~10s)
        </div>
      ) : q.isError || !pts.length ? (
        <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: S.muted, fontSize: 11, background: S.cardBg, borderRadius: 8 }}>No SHAP data — run intraday pipeline first</div>
      ) : (
        <div style={{ background: S.cardBg, borderRadius: 8, border: `1px solid ${S.border}`, padding: '8px 4px 4px', touchAction: 'none' }}
          onMouseEnter={() => { isInsideRef.current = true }}
          onMouseLeave={() => { isInsideRef.current = false }}>
          {pts.length > 0 && xRange < 0.001 && (
            <div style={{ background: '#451a0388', border: '1px solid #D97706', borderRadius: 7, padding: '7px 12px', margin: '4px 4px 8px', fontSize: 10, color: '#FDE68A', lineHeight: 1.5 }}>
              ⚠ Near-zero feature variance (range ={fmtSmall(xRange)}) — <strong>{FEATURE_FRIENDLY[selFeat] ?? selFeat}</strong> is nearly constant for {ticker}.
              The scatter appears as a vertical line. This feature contributes little to this ticker&apos;s model.
            </div>
          )}
          <ResponsiveContainer width="100%" height={300}>
            <ScatterChart
              margin={{ top: 5, right: 20, bottom: 24, left: 18 }}
              onMouseDown={(e: any) => { if (e?.xValue != null) setZoomArea({ x1: e.xValue, y1: e.yValue, x2: e.xValue, y2: e.yValue }) }}
              onMouseMove={(e: any) => { if (zoomArea && e?.xValue != null) setZoomArea(z => z ? { ...z, x2: e.xValue, y2: e.yValue } : null) }}
              onMouseUp={() => {
                if (zoomArea && (Math.abs(zoomArea.x1 - zoomArea.x2) > 1e-9 || Math.abs(zoomArea.y1 - zoomArea.y2) > 1e-9)) {
                  setZoomedDomain({ x: [Math.min(zoomArea.x1, zoomArea.x2), Math.max(zoomArea.x1, zoomArea.x2)], y: [Math.min(zoomArea.y1, zoomArea.y2), Math.max(zoomArea.y1, zoomArea.y2)] })
                }
                setZoomArea(null)
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={S.border} />
              <XAxis type="number" dataKey="x" domain={activeX} tick={{ fill: S.muted, fontSize: 9 }} tickLine={false} axisLine={{ stroke: S.border }}
                tickFormatter={v => v.toFixed(2)}
                label={{ value: `${FEATURE_FRIENDLY[selFeat] ?? selFeat} (feature value)`, position: 'insideBottom', offset: -14, fill: S.muted, fontSize: 9 }} />
              <YAxis type="number" dataKey="y" domain={activeY} tick={{ fill: S.muted, fontSize: 9 }} tickLine={false} axisLine={false}
                tickFormatter={v => v.toFixed(4)}
                label={{ value: 'SHAP value (impact)', angle: -90, position: 'insideLeft', offset: 14, fill: S.muted, fontSize: 9, dx: -4 }} />
              <ReferenceLine y={0} stroke={S.muted} strokeDasharray="5 3" strokeOpacity={0.6} strokeWidth={1}
                label={{ value: 'no impact', fill: S.muted, fontSize: 8, position: 'insideTopRight' }} />
              <RechartsTooltip
                contentStyle={{ background: S.tipBg, border: `1px solid ${S.tipBorder}`, borderRadius: 8, fontSize: 11, padding: '8px 12px' }}
                labelStyle={{ color: '#38BDF8', fontWeight: 700 }}
                itemStyle={{ color: '#CBD5E1' }}
                formatter={(val: any, name: string) => {
                  const v = Number(val)
                  return [v.toFixed(5), name === 'x' ? `${FEATURE_FRIENDLY[selFeat] ?? selFeat}` : 'SHAP impact']
                }} />
              <Scatter name="positive" data={positive} fill={S.positiveVal} fillOpacity={0.65} r={3} />
              <Scatter name="negative" data={negative} fill={S.negativeVal} fillOpacity={0.65} r={3} />
              {zoomArea && (
                <ReferenceArea x1={zoomArea.x1} x2={zoomArea.x2} y1={zoomArea.y1} y2={zoomArea.y2}
                  strokeOpacity={0.4} fill={S.primary} fillOpacity={0.1} />
              )}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}
      <p style={{ color: S.muted, fontSize: 9, textAlign: 'center', margin: '4px 0 0', opacity: 0.45, lineHeight: 1.5 }}>
        SHAP dependence · feature value vs contribution to prediction · green = positive impact
        <span style={{ opacity: 0.7 }}> · Pinch or Ctrl+scroll to zoom · drag to box-select a region</span>
      </p>
    </div>
  )
}

// ── SHAP Feature Importance Chart ────────────────────────────────────
function SHAPImportanceChart({ data, ticker, onBarClick }: { data: { feature: string; importance: number }[]; ticker?: string; onBarClick?: (feature: string, importance: number) => void }) {
  const S = useS()
  if (!data || data.length === 0) return (
    <div style={{ height: 260, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      color: S.muted, gap: 8, background: S.cardBg, borderRadius: 8 }}>
      <span style={{ fontSize: 26 }}></span>
      <span style={{ fontSize: 12, fontStyle: 'italic' }}>Switch to <strong style={{ color: S.primary }}>Hourly</strong> mode → Run Signal Engine to see SHAP feature importances</span>
    </div>
  )
  // Gradient: bright → teal → green → amber → red
  const BAR_COLORS = ['#38BDF8', '#22D3EE', '#34D399', '#86EFAC', '#A3E635', '#FDE68A', '#FCA5A5', '#D8B4FE', '#94A3B8', '#67E8F9', '#FB923C', '#F9A8D4']
  const maxVal = Math.max(...data.map(d => d.importance))

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.[0]) return null
    const feat = payload[0].payload.feature
    const val: number = payload[0].value
    const exp = FEATURE_EXPLANATIONS[feat]
    return (
      <div style={{ background: S.tipBg, border: `1px solid ${S.tipBorder}`, borderRadius: 9, padding: '10px 14px', maxWidth: 280, fontSize: 11 }}>
        <p style={{ color: '#7DD3FC', fontWeight: 700, margin: '0 0 4px' }}>{exp?.label ?? feat}</p>
        {exp && <p style={{ color: '#94A3B8', fontFamily: 'monospace', fontSize: 9, margin: '0 0 6px' }}>{exp.formula}</p>}
        <p style={{ color: '#E2E8F0', margin: '0 0 5px' }}>SHAP: <strong style={{ color: '#38BDF8' }}>{val.toFixed(6)}</strong></p>
        {exp && <p style={{ color: '#94A3B8', fontSize: 10, margin: '0 0 6px', lineHeight: 1.5 }}>{exp.highMeans.slice(0, 100)}…</p>}
        <p style={{ color: '#7DD3FC', fontSize: 9, margin: 0, opacity: 0.7 }}>Click bar for full explanation ›</p>
      </div>
    )
  }
  return (
    <>
      <p style={{ color: S.muted, fontSize: 9, margin: '0 0 6px', opacity: 0.5, textAlign: 'center' }}>
        Click any bar to see what this signal means for {ticker ?? 'this stock'} in plain English
      </p>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} layout="vertical" margin={{ left: 16, right: 36, top: 4, bottom: 8 }} style={{ cursor: onBarClick ? 'pointer' : 'default' }}>
          <CartesianGrid strokeDasharray="3 3" stroke={S.border + '55'} horizontal={false} />
          <XAxis type="number" domain={[0, maxVal * 1.2]} tickFormatter={v => v.toFixed(4)}
            tick={{ fill: S.muted, fontSize: 9 }} axisLine={{ stroke: S.border }} tickLine={false} />
          <YAxis type="category" dataKey="feature" width={100}
            tick={{ fill: S.text, fontSize: 10, fontFamily: 'monospace' }}
            axisLine={false} tickLine={false} />
          <RechartsTooltip content={<CustomTooltip />} />
          <Bar dataKey="importance" radius={[0, 5, 5, 0]} onClick={(d) => onBarClick?.(d.feature, d.importance)}>
            {data.map((_, i) => <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} opacity={i === 0 ? 1 : 0.82} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </>
  )
}

// Anchors a floating dropdown panel to its trigger button via a fixed-position
// portal (rendered at document.body), instead of `position:absolute` inside the
// local layout flow. Avoids clipping/overlap bugs when an ancestor has
// `overflow:hidden` or its own stacking context — the same class of bug fixed
// for the hover Tooltip component. Also handles outside-click-to-close across
// both the trigger and the portaled panel (which are not DOM-adjacent).
function useAnchoredDropdown(panelWidth: number) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  useEffect(() => {
    if (!open) return
    const update = () => {
      const r = btnRef.current?.getBoundingClientRect()
      if (!r) return
      setPos({
        top: Math.min(r.bottom + 4, window.innerHeight - 60),
        left: Math.min(Math.max(8, r.right - panelWidth), window.innerWidth - panelWidth - 8),
      })
    }
    update()
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, panelWidth])
  return { open, setOpen, btnRef, panelRef, pos }
}

// ── Searchable ticker combobox (single-select, replaces plain <select> across the 50+ ticker universe) ──
function SearchableTickerSelect({ value, onChange, options, S, allLabel }: {
  value: string
  onChange: (v: string) => void
  options: { ticker: string; name?: string }[]
  S: Theme
  allLabel?: string
}) {
  const PANEL_W = 220
  const { open, setOpen, btnRef, panelRef, pos } = useAnchoredDropdown(PANEL_W)
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const s = q.trim().toUpperCase()
    if (!s) return options
    return options.filter(o => o.ticker.includes(s) || (o.name ?? '').toUpperCase().includes(s))
  }, [options, q])
  const displayLabel = value === 'ALL' && allLabel ? allLabel : value
  return (
    <div style={{ position: 'relative', fontSize: 11, display: 'inline-block' }} onClick={e => e.stopPropagation()}>
      <button ref={btnRef} type="button" onClick={() => setOpen(o => !o)} title="Search or select a ticker"
        style={{ background: S.cardBg, color: S.text, border: `1px solid ${S.border}`, borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, minWidth: 76, justifyContent: 'space-between' }}>
        <span>{displayLabel}</span>
        <span style={{ opacity: 0.5, fontSize: 9 }}>▾</span>
      </button>
      {open && createPortal(
        <div ref={panelRef} style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 10000, width: PANEL_W, maxHeight: 320, display: 'flex', flexDirection: 'column',
          background: S.surface, border: `1px solid ${S.border}`, borderRadius: 8, boxShadow: '0 12px 32px rgba(0,0,0,0.4)', overflow: 'hidden' }}>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search ticker or company…"
            style={{ margin: 6, width: 'calc(100% - 12px)', background: S.bg, color: S.text, border: `1px solid ${S.border}`, borderRadius: 5, padding: '5px 8px', fontSize: 11, boxSizing: 'border-box' }} />
          <div style={{ overflowY: 'auto', maxHeight: 260, borderTop: `1px solid ${S.border}` }}>
            {allLabel && (!q || 'all'.includes(q.trim().toLowerCase())) && (
              <button onClick={() => { onChange('ALL'); setOpen(false); setQ('') }}
                style={{ display: 'block', width: '100%', textAlign: 'left', background: value === 'ALL' ? `${S.primary}22` : 'transparent', color: value === 'ALL' ? S.primary : S.text, borderWidth: 0, borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: `${S.border}55`, padding: '6px 10px', fontSize: 11, fontWeight: value === 'ALL' ? 700 : 500, cursor: 'pointer' }}>
                {allLabel}
              </button>
            )}
            {filtered.length === 0 ? (
              <div style={{ padding: 10, color: S.muted, fontSize: 10, textAlign: 'center' }}>No match</div>
            ) : filtered.map(o => (
              <button key={o.ticker} onClick={() => { onChange(o.ticker); setOpen(false); setQ('') }}
                style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left', background: value === o.ticker ? `${S.primary}22` : 'transparent', color: value === o.ticker ? S.primary : S.text, border: 'none', padding: '6px 10px', fontSize: 11, fontWeight: value === o.ticker ? 700 : 500, cursor: 'pointer' }}>
                <span>{o.ticker}</span>
                {o.name && <span style={{ color: S.muted, fontSize: 9, marginLeft: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.name}</span>}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

// ── Multi-select ticker filter — search + checkboxes + Select All/Clear, for narrowing
//    the ticker-card grids across the 50-ticker universe (null = no filter, show all) ──
function TickerMultiFilter({ allTickers, selected, onChange, S, iconOnly }: {
  allTickers: { ticker: string; name?: string }[]
  selected: Set<string> | null
  onChange: (v: Set<string> | null) => void
  S: Theme
  iconOnly?: boolean
}) {
  const PANEL_W = 260
  const { open, setOpen, btnRef, panelRef, pos } = useAnchoredDropdown(PANEL_W)
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const s = q.trim().toUpperCase()
    if (!s) return allTickers
    return allTickers.filter(o => o.ticker.includes(s) || (o.name ?? '').toUpperCase().includes(s))
  }, [allTickers, q])
  const isChecked = (t: string) => selected === null || selected.has(t)
  const toggle = (t: string) => {
    const base = selected === null ? new Set(allTickers.map(o => o.ticker)) : new Set(selected)
    if (base.has(t)) base.delete(t); else base.add(t)
    onChange(base)
  }
  const label = selected === null ? `All (${allTickers.length})` : `${selected.size} shown`
  const btnLabel = iconOnly ? (selected === null ? '' : `${selected.size}`) : label
  return (
    <div style={{ position: 'relative', display: 'inline-block' }} onClick={e => e.stopPropagation()}>
      <button ref={btnRef} type="button" onClick={() => setOpen(o => !o)} title={`Filter Universe — ${label}`}
        style={{ background: selected === null ? 'transparent' : `${S.primary}22`, color: selected === null ? S.muted : S.primary, border: `1px solid ${selected === null ? S.border : S.primary}`, borderRadius: 6, padding: iconOnly ? '4px 8px' : '4px 10px', fontSize: 10, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
        {btnLabel && `${btnLabel}`}{!iconOnly && <span style={{ opacity: 0.6, fontSize: 8 }}>▾</span>}
      </button>
      {open && createPortal(
        <div ref={panelRef} style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 10000, width: PANEL_W, maxHeight: 360, display: 'flex', flexDirection: 'column',
          background: S.surface, border: `1px solid ${S.border}`, borderRadius: 8, boxShadow: '0 12px 32px rgba(0,0,0,0.4)', overflow: 'hidden' }}>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search ticker or company…"
            style={{ margin: 6, width: 'calc(100% - 12px)', background: S.bg, color: S.text, border: `1px solid ${S.border}`, borderRadius: 5, padding: '5px 8px', fontSize: 11, boxSizing: 'border-box' }} />
          <div style={{ display: 'flex', gap: 6, padding: '0 6px 6px' }}>
            <button onClick={() => onChange(null)} style={{ flex: 1, background: 'transparent', color: S.primary, border: `1px solid ${S.primary}66`, borderRadius: 5, padding: '4px 0', fontSize: 9, fontWeight: 700, cursor: 'pointer' }}>Select All</button>
            <button onClick={() => onChange(new Set())} style={{ flex: 1, background: 'transparent', color: S.negativeVal, border: `1px solid ${S.negativeVal}66`, borderRadius: 5, padding: '4px 0', fontSize: 9, fontWeight: 700, cursor: 'pointer' }}>Clear</button>
          </div>
          <div style={{ overflowY: 'auto', maxHeight: 260, borderTop: `1px solid ${S.border}` }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 10, color: S.muted, fontSize: 10, textAlign: 'center' }}>No match</div>
            ) : filtered.map(o => (
              <label key={o.ticker} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', fontSize: 11, cursor: 'pointer', color: S.text }}>
                <input type="checkbox" checked={isChecked(o.ticker)} onChange={() => toggle(o.ticker)} style={{ cursor: 'pointer' }} />
                <span style={{ fontWeight: 600 }}>{o.ticker}</span>
                {o.name && <span style={{ color: S.muted, fontSize: 9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.name}</span>}
              </label>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

// ── Compact BUY/HOLD/SELL/ALL filter pill row — used to narrow ticker-card
//    grids (Daily + Hourly) down by signal category. `counts` drives the
//    per-pill badge number so users can see category sizes before clicking. ──
function SignalFilterPills({ value, onChange, counts, S, hideAll }: {
  value: 'ALL' | 'BUY' | 'HOLD' | 'SELL'
  onChange: (v: 'ALL' | 'BUY' | 'HOLD' | 'SELL') => void
  counts: { ALL: number; BUY: number; HOLD: number; SELL: number }
  S: Theme
  hideAll?: boolean
}) {
  const allOpts: { key: 'ALL' | 'BUY' | 'HOLD' | 'SELL'; bg: string; text: string }[] = [
    { key: 'ALL',  bg: S.cardBg, text: S.primary },
    { key: 'BUY',  bg: S.buyBg,  text: S.buyText },
    { key: 'HOLD', bg: S.holdBg, text: S.holdText },
    { key: 'SELL', bg: S.sellBg, text: S.sellText },
  ]
  const opts = allOpts.filter(o => !hideAll || o.key !== 'ALL')
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {opts.map(o => (
        <button key={o.key} onClick={() => onChange(o.key)} title={`Show only ${o.key === 'ALL' ? 'all signals' : o.key.toLowerCase() + ' signals'}`}
          style={{ background: o.bg, color: o.text, border: `2px solid ${value === o.key ? o.text : 'transparent'}`, borderRadius: 6, padding: '3px 10px', fontSize: 9, fontWeight: 800, letterSpacing: '0.05em', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
          {o.key} <span style={{ opacity: 0.75 }}>{counts[o.key]}</span>
        </button>
      ))}
    </div>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const qc = useQueryClient()
  // Seed theme from saved preference, then OS preference, defaulting to dark.
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    const saved = window.localStorage.getItem('alphaflow-theme')
    if (saved === 'dark') return true
    if (saved === 'light') return false
    return !window.matchMedia?.('(prefers-color-scheme: light)').matches
  })
  useEffect(() => {
    try { window.localStorage.setItem('alphaflow-theme', isDark ? 'dark' : 'light') } catch { /* ignore */ }
  }, [isDark])
  const S = isDark ? DARK_S : LIGHT_S
  const isMobile = useIsMobile()

  const [selectedImg, setSelectedImg] = useState<string | null>(null)
  const [lightboxImg, setLightboxImg] = useState<string | null>(null)
  const [explanation, setExplanation] = useState<string | null>(null)
  const [explaining, setExplaining] = useState(false)
  const [chat, setChat] = useState<ChatMsg[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [clock, setClock] = useState(nowUTC())
  const [hoveredChart, setHoveredChart] = useState<string | null>(null)
  const [fullscreenChart, setFullscreenChart] = useState<string | null>(null)
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null)
  const [customTicker, setCustomTicker] = useState('')
  const [addingTicker, setAddingTicker] = useState(false)
  const [addTickerMsg, setAddTickerMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // Hourly: resolution toggle + live stream dot + intraday data
  const [resolution, setResolution] = useState<'daily' | 'hourly'>('daily')
  const [streamConnected, setStreamConnected] = useState(false)
  const [selectedShapTicker, setSelectedShapTicker] = useState('AAPL')
  const [shapSignalFilter, setShapSignalFilter] = useState<'ALL' | 'BUY' | 'HOLD' | 'SELL'>('BUY')
  const [intradayChartTab, setIntradayChartTab] = useState<'hawkes' | 'vwap' | 'heatmap' | 'scatter' | 'equity' | 'dependence' | 'rolling_ic' | 'vpin'>('hawkes')
  const [shapClickedFeature, setShapClickedFeature] = useState<{ feature: string; importance: number } | null>(null)
  const [clickedMetricKey, setClickedMetricKey] = useState<string | null>(null)
  const [drawerMetricModal, setDrawerMetricModal] = useState<string | null>(null)
  const [researchDrawerTicker, setResearchDrawerTicker] = useState<string | null>(null)
  const [tickerCardsExpanded, setTickerCardsExpanded] = useState(true)
  const [dailyTickerFilter, setDailyTickerFilter] = useState<Set<string> | null>(null)
  const [daily10Signal, setDaily10Signal] = useState<'ALL' | 'BUY' | 'HOLD' | 'SELL'>('BUY')
  const [daily10Ticker, setDaily10Ticker] = useState<string>('ALL')
  const [dailyGridSignal, setDailyGridSignal] = useState<'ALL' | 'BUY' | 'HOLD' | 'SELL'>('BUY')
  const [dailyGridShowAll, setDailyGridShowAll] = useState(false)
  const [hourlyTickerFilter, setHourlyTickerFilter] = useState<Set<string> | null>(null)
  const [hourlyGridSignal, setHourlyGridSignal] = useState<'ALL' | 'BUY' | 'HOLD' | 'SELL'>('BUY')
  const [hourlyGridShowAll, setHourlyGridShowAll] = useState(false)
  const [hourly10Signal, setHourly10Signal] = useState<'ALL' | 'BUY' | 'HOLD' | 'SELL'>('BUY')
  const [hourly10Ticker, setHourly10Ticker] = useState<string>('ALL')
  const [alphaDecayShowAll, setAlphaDecayShowAll] = useState(false)
  const [hourlySnapTab, setHourlySnapTab] = useState<'ranked' | 'snapshot'>('ranked')
  // Portfolio Simulation — position-attribution popover , triggered by clicking a LONG/SHORT ticker chip
  const [posDetailOpen, setPosDetailOpen] = useState<{ ticker: string; rect: DOMRect } | null>(null)
  const posDetailPanelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!posDetailOpen) return
    const onDoc = (e: MouseEvent) => {
      if (posDetailPanelRef.current?.contains(e.target as Node)) return
      setPosDetailOpen(null)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [posDetailOpen])

  // Live per-ticker progress for the intraday pipeline — polled frequently so the
  // UI reflects reality even when the run was triggered outside the UI button
  // (curl, scheduler, another tab). Cheap in-memory read on the backend.
  const intradayProgress = useQuery({
    queryKey: ['intradayProgress'],
    queryFn: () => axios.get('/api/intraday/progress').then(r => r.data as {
      running: boolean; total: number; done: number; current: string | null;
      completed: { ticker: string; mean_ic: number; sharpe: number; error?: string | null }[];
    }),
    enabled: resolution === 'hourly',
    refetchInterval: POLL_INTRADAY_PROGRESS_MS,
    staleTime: 0,
  })
  const intradayRunning = intradayProgress.data?.running ?? false
  const intradaySignals = useQuery({
    queryKey: ['intradaySignals'],
    queryFn: () => axios.get('/api/intraday/signals').then(r => r.data as { signals: any[]; meta: { feature_count: number; feature_names: string[] } }),
    enabled: resolution === 'hourly',
    // Same auto-refresh cadence as the Daily `allSignals` query below — this is
    // what lets externally-triggered runs (curl, scheduler) surface in the UI
    // without requiring a manual page reload. Poll faster while a run is
    // actively in progress so the final results appear promptly once done.
    refetchInterval: intradayRunning ? POLL_INTRADAY_SIGNALS_FAST_MS : POLL_INTRADAY_SIGNALS_IDLE_MS,
  })
  const shapData = useQuery({
    queryKey: ['shapImportance', selectedShapTicker],
    queryFn: () => axios.get(`/api/data/shap-importance?ticker=${selectedShapTicker}`).then(r => r.data),
    enabled: resolution === 'hourly',
    refetchInterval: intradayRunning ? POLL_INTRADAY_SIGNALS_FAST_MS : POLL_INTRADAY_SIGNALS_IDLE_MS,
  })
  const runIntraday = useMutation({
    mutationFn: () => axios.post('/api/intraday/run', {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['intradaySignals'] })
      qc.invalidateQueries({ queryKey: ['shapImportance', selectedShapTicker] })
      qc.invalidateQueries({ queryKey: ['portfolioSimulate'] })
      qc.invalidateQueries({ queryKey: ['intradayProgress'] })
    },
  })

  const portfolioQuery = useQuery({
    queryKey: ['portfolioSimulate'],
    queryFn: () => axios.get('/api/portfolio/simulate').then(r => r.data as {
      gross_equity: number[]; net_equity: number[];
      long_tickers: string[]; short_tickers: string[];
      long_ics: number[]; short_ics: number[];
      gross_sharpe: number; net_sharpe: number;
      net_max_drawdown: number; net_calmar: number;
      hit_rate: number; profit_factor: number;
      portfolio_ic: number; avg_cost_bps: number;
      n_rebalances: number; n_bars: number;
      equity_dates?: string[];
      position_detail?: { ticker: string; side: 'LONG' | 'SHORT'; weight: number; mean_ic: number; ic_rank: number; pnl_contribution_pct: number }[];
      capm?: { alpha_annual: number; alpha_pct: number; beta: number; r2: number; alpha_tstat: number; alpha_pval: number; n_daily_bars: number; error?: string };
      robustness?: { psr: number; dsr: number; n_trials: number; n_obs: number };
      error?: string;
    }),
    enabled: resolution === 'hourly',
    staleTime: Infinity,
  })

  // SSE live stream connection
  useEffect(() => {
    if (resolution !== 'hourly') { setStreamConnected(false); return }
    const es = new EventSource(apiPath('/api/stream?tickers=AAPL,MSFT,NVDA'))
    es.onopen    = () => setStreamConnected(true)
    es.onerror   = () => setStreamConnected(false)
    es.onmessage = () => setStreamConnected(true)
    return () => { es.close(); setStreamConnected(false) }
  }, [resolution])

  // Collapse daily ticker cards when switching to hourly mode
  useEffect(() => { setTickerCardsExpanded(resolution === 'daily') }, [resolution])

  // Dynamic ticker registry (default 10 + any custom tickers added via UI)
  const tickerInfoQuery = useQuery({
    queryKey: ['allTickers'],
    queryFn: () => axios.get('/api/tickers').then(r => r.data as { ticker: string; name: string; sector: string; is_custom: boolean }[]),
    refetchInterval: POLL_TICKERS_MS, staleTime: STALE_TICKERS_MS,
  })
  const dynTickerNames = useMemo(() => {
    const base: Record<string, [string, string]> = { ...TICKER_NAMES }
    tickerInfoQuery.data?.forEach(t => { if (!base[t.ticker]) base[t.ticker] = [t.name || t.ticker, t.sector || 'Custom'] })
    return base
  }, [tickerInfoQuery.data])
  const customTickersList = useMemo(() => tickerInfoQuery.data?.filter(t => t.is_custom).map(t => t.ticker) ?? [], [tickerInfoQuery.data])
  const totalTickerCount = tickerInfoQuery.data?.length ?? ALL_TICKERS.length
  const chatInputRef = useRef<HTMLInputElement>(null)
  const chatEnd = useRef<HTMLDivElement>(null)

  useEffect(() => { const t = setInterval(() => setClock(nowUTC()), 60000); return () => clearInterval(t) }, [])
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: 'smooth' }) }, [chat])
  useEffect(() => {
    if (!refreshedAt) return
    const t = setTimeout(() => setRefreshedAt(null), 10000)
    return () => clearTimeout(t)
  }, [refreshedAt])

  const health = useQuery({ queryKey: ['health'], queryFn: () => axios.get('/health').then(r => r.data), refetchInterval: POLL_HEALTH_MS })
  const history = useQuery({ queryKey: ['history'], queryFn: () => axios.get('/api/history?limit=10').then(r => r.data as any[]), refetchInterval: POLL_HISTORY_MS })
  const allSignals = useQuery({ queryKey: ['allSignals'], queryFn: () => axios.get('/api/signals/all').then(r => r.data), refetchInterval: POLL_ALL_SIGNALS_MS })
  const outputs = useQuery({ queryKey: ['outputs'], queryFn: () => axios.get('/api/outputs').then(r => r.data as { figures: string[]; reports: string[] }), refetchInterval: POLL_OUTPUTS_MS, enabled: resolution === 'daily' })
  const report = useQuery({
    queryKey: ['report'],
    queryFn: async () => {
      const o = await axios.get('/api/outputs')
      const rf = (o.data.reports as string[])?.find((r: string) => r.endsWith('.json'))
      if (!rf) return null
      return axios.get(`/api/outputs/${rf}`).then(r => r.data)
    },
    refetchInterval: POLL_REPORT_MS,
    enabled: resolution === 'daily',
  })

  const isRunning = history.data?.some((r: any) => r.status === 'running') ?? false

  // Live per-ticker progress for the Daily pipeline — mirrors intradayProgress
  // above. `stage` is one of fetch_data / compute_features / llm_interpret, the
  // 3 sequential per-ticker phases of the LangGraph pipeline. llm_interpret is
  // by far the slowest (~2.2s/ticker Groq stagger, ~110s for 50 tickers), so
  // this is where live feedback matters most — previously Daily showed nothing
  // but a static "Running…" spinner for the full run duration.
  const dailyProgress = useQuery({
    queryKey: ['dailyProgress'],
    queryFn: () => axios.get('/api/daily/progress').then(r => r.data as {
      running: boolean; stage: string | null; total: number; done: number; current: string | null; completed: string[];
    }),
    enabled: resolution === 'daily',
    refetchInterval: POLL_DAILY_PROGRESS_MS,
    staleTime: 0,
  })
  const dailyStageLabel = (stage: string | null | undefined) =>
    stage === 'fetch_data' ? 'Loading market data'
      : stage === 'compute_features' ? 'Computing features'
        : stage === 'llm_interpret' ? 'Generating LLM signals'
          : 'Starting…'

  const run = useMutation({
    mutationFn: () => axios.post('/api/run'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['history'] })
      qc.invalidateQueries({ queryKey: ['allSignals'] })
      qc.invalidateQueries({ queryKey: ['outputs'] })
      qc.invalidateQueries({ queryKey: ['report'] })
      qc.invalidateQueries({ queryKey: ['dailyProgress'] })
      setSelectedImg(null); setExplanation(null)
    },
  })

  const refreshData = useMutation({
    mutationFn: () => axios.post('/api/data/refresh'),
    onSuccess: () => setRefreshedAt(Date.now()),
  })

  // ── Paper trading + Alpha Decay ──────────────────────────────────
  const executeTrades = useMutation({
    mutationFn: () => axios.post('/api/execute'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['paperTrades'] })
      qc.invalidateQueries({ queryKey: ['tradePnl'] })
    },
  })
  const cancelAll = useMutation({
    mutationFn: () => axios.delete('/api/trades/all'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['paperTrades'] })
      qc.invalidateQueries({ queryKey: ['tradePnl'] })
    },
  })

  const cancelPending = useMutation({
    mutationFn: () => axios.delete('/api/trades/pending'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['paperTrades'] })
      qc.invalidateQueries({ queryKey: ['tradePnl'] })
    },
  })
  const runAlphaDecayP3 = useMutation({
    mutationFn: () => axios.post('/api/alpha-decay/run'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alphaDecayP3'] }),
  })
  const paperTrades = useQuery({
    queryKey: ['paperTrades'],
    queryFn: () => axios.get('/api/trades').then(r => r.data as any[]),
    enabled: resolution === 'hourly',
    staleTime: STALE_PAPER_TRADES_MS,
  })
  const tradePnl = useQuery({
    queryKey: ['tradePnl'],
    queryFn: () => axios.get('/api/trades/pnl').then(r => r.data as { trades: any[]; total_pnl: number; open_count: number; note?: string }),
    enabled: resolution === 'hourly',
    staleTime: STALE_TRADE_PNL_MS,
  })
  // Live paper-account snapshot from Alpaca (broker = source of truth for P&L).
  // Polled in both Daily & Hourly so the Paper Portfolio panel always shows real
  // equity / today's P&L / open positions, independent of the local order table.
  type PortfolioAccount = {
    connected: boolean; reason?: string; note?: string
    equity?: number; last_equity?: number; cash?: number; buying_power?: number
    starting_capital?: number; today_pl?: number; today_pl_pct?: number
    total_pl?: number; total_pl_pct?: number; open_positions?: number
    positions?: Array<{ ticker: string; side: string; qty: number; entry_price: number; current_price: number; market_value: number; unrealized_pl: number; unrealized_plpc: number }>
  }
  const portfolioAccount = useQuery({
    queryKey: ['portfolioAccount'],
    queryFn: () => axios.get('/api/portfolio/account').then(r => r.data as PortfolioAccount),
    refetchInterval: 20_000,
  })
  const alphaDecayP3 = useQuery({
    queryKey: ['alphaDecayP3'],
    queryFn: () => axios.get('/api/alpha-decay').then(r => r.data as any[]),
    enabled: resolution === 'hourly',
    staleTime: STALE_CHART_DATA_MS,
  })

  const refreshDone = !!refreshedAt && !refreshData.isPending
  const refreshLabel = refreshData.isPending ? 'Refreshing…' : refreshDone ? '✓ Refreshed' : 'Refresh Market Data'

  const selectChart = useCallback(async (f: string) => {
    setSelectedImg(f); setExplanation(null); setExplaining(true)
    try { const r = await axios.post('/api/explain', { filename: f }); setExplanation(r.data.explanation) }
    catch { setExplanation(null) }
    finally { setExplaining(false) }
  }, [])

  async function handleAddTicker() {
    const t = customTicker.trim().toUpperCase()
    if (!t || addingTicker) return
    setAddingTicker(true); setAddTickerMsg(null)
    try {
      const r = await axios.post('/api/tickers/add', { ticker: t })
      setAddTickerMsg({ ok: true, text: `✓ ${t}: ${r.data.bars ?? '?'} bars downloaded` })
      setCustomTicker('')
      qc.invalidateQueries({ queryKey: ['ofiTimeseries'] })
      qc.invalidateQueries({ queryKey: ['allTickers'] })
    } catch (err: any) {
      setAddTickerMsg({ ok: false, text: err?.response?.data?.detail ?? `Failed to add ${t}` })
    }
    setAddingTicker(false)
  }

  async function handleDeleteTicker(t: string) {
    try {
      await axios.delete(`/api/tickers/${t}`)
      qc.invalidateQueries({ queryKey: ['allTickers'] })
      qc.invalidateQueries({ queryKey: ['ofiTimeseries'] })
      qc.invalidateQueries({ queryKey: ['allSignals'] })
      qc.invalidateQueries({ queryKey: ['intradaySignals'] })
      qc.invalidateQueries({ queryKey: ['shapImportance', t] })
      // Reset SHAP dropdown to ALL if the deleted ticker was selected
      if (selectedShapTicker === t) setSelectedShapTicker('ALL')
    } catch (err: any) {
      console.error(`Delete ${t} failed:`, err?.response?.data?.detail)
    }
  }

  function printResearchBrief({ ids, allSigEntries, p2AvgAbsIC, p2AvgIcIr }: {
    ids: any[], allSigEntries: any[], p2AvgAbsIC: number | null, p2AvgIcIr: number | null
  }) {
    const latestRun = ids[0]
    const dateRange = latestRun ? `${latestRun.data_start} – ${latestRun.data_end}` : 'N/A'
    const totalTickers = allSigEntries.length
    const icStr = p2AvgAbsIC != null ? `${(p2AvgAbsIC * 100).toFixed(2)}%` : 'N/A (run Signal Engine first)'
    const icIrStr = p2AvgIcIr != null ? p2AvgIcIr.toFixed(2) : 'N/A'
    const snapshotRows = allSigEntries.length > 0
      ? allSigEntries.slice(0, 10).map((s: any) =>
          `<tr><td>${s.ticker ?? '—'}</td><td>${s.ofi != null ? Number(s.ofi).toFixed(3) : '—'}</td><td>${s.kyle_lambda != null ? fmtSmall(Number(s.kyle_lambda)) : '—'}</td><td>${s.amihud_illiq != null ? fmtSmall(Number(s.amihud_illiq)) : '—'}</td><td>${s.eff_spread_bps != null ? Number(s.eff_spread_bps).toFixed(1) + ' bps' : '—'}</td><td><strong>${s.signal ?? '—'}</strong></td></tr>`
        ).join('')
      : '<tr><td colspan="6">No data — run Run Daily Scan first</td></tr>'

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>AlphaFlow — Technical Summary</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Georgia', serif; font-size: 11pt; color: #1a1a2e; padding: 25mm 20mm; line-height: 1.55; }
    h1 { font-size: 20pt; color: #1E3A5F; margin-bottom: 2px; }
    h2 { font-size: 13pt; color: #1E3A5F; margin: 18px 0 8px; border-bottom: 1.5px solid #1E3A5F22; padding-bottom: 4px; }
    h3 { font-size: 11pt; color: #1E3A5F; margin: 10px 0 4px; }
    .subtitle { color: #475569; font-size: 10pt; margin-bottom: 20px; }
    .meta { display: flex; gap: 30px; margin-bottom: 18px; flex-wrap: wrap; }
    .meta-item { display: flex; flex-direction: column; }
    .meta-label { font-size: 8pt; text-transform: uppercase; letter-spacing: .07em; color: #64748B; }
    .meta-value { font-size: 13pt; font-weight: bold; color: #1E3A5F; }
    table { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin-top: 8px; }
    th { background: #1E3A5F; color: #fff; padding: 6px 8px; font-weight: 600; text-align: left; }
    td { padding: 5px 8px; border-bottom: 1px solid #E2E8F0; vertical-align: top; }
    tr:nth-child(even) td { background: #F8FAFC; }
    .badge-novel { background: #EFF6FF; color: #1D4ED8; border: 1px solid #BFDBFE; border-radius: 4px; padding: 1px 6px; font-size: 8pt; font-weight: 700; display: inline-block; margin-right: 5px; }
    .badge-proxy { background: #FFFBEB; color: #B45309; border: 1px solid #FDE68A; border-radius: 4px; padding: 1px 6px; font-size: 8pt; font-weight: 700; display: inline-block; margin-right: 5px; }
    .badge-robust { background: #F0FDF4; color: #166534; border: 1px solid #BBF7D0; border-radius: 4px; padding: 1px 6px; font-size: 8pt; font-weight: 700; display: inline-block; margin-right: 5px; }
    .box { border: 1px solid #E2E8F0; border-radius: 6px; padding: 10px 14px; margin-bottom: 10px; background: #FAFAFA; }
    .box-novel { border-color: #BFDBFE; background: #EFF6FF; }
    .limitation { border-left: 3px solid #F59E0B; padding-left: 10px; margin: 6px 0; font-size: 9.5pt; color: #374151; }
    .novelty { border-left: 3px solid #1D4ED8; padding-left: 10px; margin: 6px 0; font-size: 9.5pt; color: #1e3a8a; }
    .footer { margin-top: 30px; border-top: 1px solid #E2E8F0; padding-top: 10px; font-size: 8pt; color: #94A3B8; }
    code { font-family: 'Courier New', monospace; font-size: 9pt; background: #F1F5F9; padding: 0 4px; border-radius: 3px; }
    @media print { body { padding: 12mm 15mm; } }
  </style>
</head>
<body>
  <h1>AlphaFlow</h1>
  <p class="subtitle">Microstructure Alpha Engine — Technical Summary &nbsp;|&nbsp; Generated ${new Date().toISOString().split('T')[0]}</p>

  <div class="meta">
    <div class="meta-item"><span class="meta-label">Data Range</span><span class="meta-value">${dateRange}</span></div>
    <div class="meta-item"><span class="meta-label">Tickers Analysed</span><span class="meta-value">${totalTickers}</span></div>
    <div class="meta-item"><span class="meta-label">Hourly Avg |IC|</span><span class="meta-value">${icStr}</span></div>
    <div class="meta-item"><span class="meta-label">IC_IR (Grinold-Kahn)</span><span class="meta-value">${icIrStr}</span></div>
  </div>

  <h2>1. Signal Architecture</h2>
  <table>
    <tr><th>Signal</th><th>Method</th><th>Resolution</th><th>Primary Reference</th></tr>
    <tr><td><strong>OFI z-score</strong></td><td>Buy-bar proxy: close≥open → buy vol</td><td>Daily</td><td>Chordia, Roll & Subrahmanyam (2002)</td></tr>
    <tr><td><strong>Kyle's Lambda</strong></td><td>Cov(ΔP, OFI)/Var(OFI) rolling OLS</td><td>Daily</td><td>Kyle, Econometrica (1985)</td></tr>
    <tr><td><strong>Amihud ILLIQ</strong></td><td>|return|/dollar_volume (exact)</td><td>Daily</td><td>Amihud, JFM (2002)</td></tr>
    <tr><td><strong>VPIN</strong></td><td>BVC: buy_frac=(close−low)/(high−low)</td><td>Daily</td><td>Easley, López de Prado & O'Hara (2012)</td></tr>
    <tr><td><strong>Hawkes Intensity z-score</strong></td><td>λ(t)=μ+Σαe^(−β·Δt), MLE L-BFGS-B</td><td>Hourly</td><td>Bacry, Mastromatteo & Muzy (2015)</td></tr>
    <tr><td><strong>LightGBM Ensemble</strong></td><td>13-feature walk-forward, 8 folds</td><td>Hourly</td><td>Ke et al. (2017) NeurIPS</td></tr>
  </table>

  <h2>2. Engineering Edges</h2>
  <div class="box box-novel">
    <div class="novelty">
      <strong>Hawkes Process at OHLCV Resolution</strong> — Fitting Hawkes self-exciting intensity at hourly OHLCV bars using bar volume as a surrogate event stream. Most microstructure implementations (Bacry 2015, Hardiman 2013) require tick-level LOB data; this pipeline delivers the same branching-ratio signal from free yfinance data. High SHAP importance across walk-forward folds confirms the feature carries orthogonal predictive information.
    </div>
    <div class="novelty" style="margin-top:8px">
      <strong>OHLCV-only Microstructure + ML Pipeline</strong> — End-to-end walk-forward combining OFI, Kyle λ, Amihud ILLIQ, VPIN, Hawkes, and Corwin-Schultz spread into a single LightGBM ensemble. Achieves IC &gt;5% at hourly resolution using only free yfinance data — meeting the Grinold-Kahn significance threshold without Level-2 data access.
    </div>
  </div>

  <h2>3. Data Transparency — Proxy Notes</h2>
  <div class="box">
    <h3><span class="badge-proxy">PROXY</span> OFI (Order Flow Imbalance)</h3>
    <div class="limitation">
      close≥open direction proxy cannot resolve intra-bar direction. True Chordia (2002) OFI requires bid/ask depth changes from Level-2 TAQ data. Daily IC≈0 is a direct consequence — OFI leads price by minutes, not days. Switch to Hourly mode for IC&gt;5% via LightGBM on 1h bars.
    </div>
    <h3 style="margin-top:10px"><span class="badge-proxy">PROXY</span> Kyle's Lambda</h3>
    <div class="limitation">
      Formula is exact (Kyle 1985); inputs are proxied. Production systems use signed trade flow from TAQ/ITCH. BVC proxy introduces noise at daily bars. Rolling OLS gives lambda estimates, not structural parameter.
    </div>
    <h3 style="margin-top:10px"><span class="badge-proxy">PROXY</span> Hawkes Process</h3>
    <div class="limitation">
      True Hawkes operates on nanosecond event times. Bar volume as surrogate event count smooths self-excitation dynamics. Fitted α, β capture clustering at bar-frequency. Explicitly documented as an engineering adaptation for OHLCV-only deployments.
    </div>
    <h3 style="margin-top:10px"><span class="badge-robust">ROBUST</span> Amihud ILLIQ + VPIN</h3>
    <div class="limitation" style="border-left-color:#22C55E">
      Both are correctly implemented from primary sources. No proxying required beyond OHLCV. VPIN BVC validated by Easley et al. (2012) on NYSE TAQ. Amihud formula is exact. Production-ready for liquidity screening.
    </div>
  </div>

  <h2>4. IC Validity — Grinold-Kahn Validation</h2>
  <div class="box">
    <p><strong>Daily IC ≈ 0:</strong> Expected. OFI leads price by minutes (Chordia 2002). Daily bars average out intra-day direction. This is a validation of the theory, not a failure.</p>
    <p style="margin-top:6px"><strong>Hourly IC ${icStr}:</strong> ${p2AvgAbsIC != null ? (p2AvgAbsIC > 0.05 ? '✓ Above Grinold-Kahn 5% threshold — signal is statistically meaningful.' : p2AvgAbsIC > 0.02 ? '⚠ Below 5% threshold with free OHLCV data. Live Alpaca tick data expected to push above threshold.' : '— Run Signal Engine to compute.') : 'Run Signal Engine to compute hourly IC.'}</p>
    <p style="margin-top:6px"><strong>IC_IR ${icIrStr}:</strong> ${p2AvgIcIr != null ? (p2AvgIcIr >= 1.0 ? '✓ Excellent signal consistency (IR ≥ 1.0).' : p2AvgIcIr >= 0.5 ? '✓ Usable consistency (IR ≥ 0.5).' : '⚠ Low consistency — consider regime filtering.') : 'Run Signal Engine to compute.'}</p>
  </div>

  <h2>5. Latest Signal Snapshot</h2>
  <table>
    <tr><th>Ticker</th><th>OFI Z-Score</th><th>Kyle λ</th><th>Amihud ILLIQ</th><th>Spread</th><th>Signal</th></tr>
    ${snapshotRows}
  </table>
  ${allSigEntries.length > 10 ? `<p style="font-size:9pt; color:#64748B; margin-top:4px">Showing 10 of ${allSigEntries.length} tickers.</p>` : ''}

  <div class="footer">
    AlphaFlow v3.0 · Production-grade microstructure signal platform
    <br>References: Kyle (1985), Amihud (2002), Lee & Ready (1991), Chordia et al. (2002), Easley et al. (2012), Bacry et al. (2015), Grinold & Kahn (2000)
  </div>
</body>
</html>`

    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 500) }
  }

  async function sendChat() {
    const msg = chatInput.trim(); if (!msg || chatLoading) return
    setChatInput('')
    const next: ChatMsg[] = [...chat, { role: 'user', content: msg }]
    setChat(next); setChatLoading(true)
    try {
      const body: Record<string, any> = { message: msg, history: chat }
      if (researchDrawerTicker) {
        body.ticker = researchDrawerTicker
        body.resolution = resolution
        if (resolution === 'hourly' && drawerSignalData) body.intraday_signal = drawerSignalData
      }
      const r = await axios.post('/api/chat', body)
      setChat([...next, { role: 'assistant', content: r.data.reply }])
    }
    catch { setChat([...next, { role: 'assistant', content: '⚠ The backend is not responding right now. Your analysis is safe — start the API (uvicorn backend.main:app --port 8002) or wait a moment and try again.' }]) }
    finally { setChatLoading(false) }
  }

  async function sendChatWith(msg: string) {
    if (!msg || chatLoading) return; setChatInput('')
    const next: ChatMsg[] = [...chat, { role: 'user', content: msg }]
    setChat(next); setChatLoading(true)
    try {
      const body: Record<string, any> = { message: msg, history: chat }
      if (researchDrawerTicker) {
        body.ticker = researchDrawerTicker
        body.resolution = resolution
        if (resolution === 'hourly' && drawerSignalData) body.intraday_signal = drawerSignalData
      }
      const r = await axios.post('/api/chat', body)
      setChat([...next, { role: 'assistant', content: r.data.reply }])
    }
    catch { setChat([...next, { role: 'assistant', content: '⚠ The backend is not responding right now. Your analysis is safe — start the API (uvicorn backend.main:app --port 8002) or wait a moment and try again.' }]) }
    finally { setChatLoading(false) }
  }

  // Pre-fills chat input without sending — user presses Enter to send
  function prefillChat(msg: string) {
    setChatInput(msg)
    setTimeout(() => {
      chatInputRef.current?.focus()
      chatInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 80)
  }

  // Auto-sends a message with an explicit ticker (avoids stale-closure issue with state)
  async function sendChatWithTicker(msg: string, ticker: string) {
    if (!msg || chatLoading) return
    const next: ChatMsg[] = [...chat, { role: 'user', content: msg }]
    setChat(next); setChatLoading(true)
    try {
      const r = await axios.post('/api/chat', {
        message: msg, history: chat,
        ticker, resolution,
      })
      setChat([...next, { role: 'assistant', content: r.data.reply }])
    }
    catch { setChat([...next, { role: 'assistant', content: '⚠ The backend is not responding right now. Your analysis is safe — start the API (uvicorn backend.main:app --port 8002) or wait a moment and try again.' }]) }
    finally { setChatLoading(false) }
  }

  const metrics = report.data?.metrics ?? null
  const allSigEntries: any[] = Array.isArray(allSignals.data) ? allSignals.data : []
  const dailyFilteredSigEntries: any[] = dailyTickerFilter === null ? allSigEntries : allSigEntries.filter((s: any) => dailyTickerFilter.has(s.ticker))
  // Card-grid signal-category pills (BUY/HOLD/SELL/ALL) + top-10 cap, independent of the ticker multi-filter above
  const dailyGridCounts = {
    ALL:  dailyFilteredSigEntries.length,
    BUY:  dailyFilteredSigEntries.filter((s: any) => (s.signal ?? 'HOLD') === 'BUY').length,
    HOLD: dailyFilteredSigEntries.filter((s: any) => (s.signal ?? 'HOLD') === 'HOLD').length,
    SELL: dailyFilteredSigEntries.filter((s: any) => (s.signal ?? 'HOLD') === 'SELL').length,
  }
  const dailyGridBySignal: any[] = dailyGridSignal === 'ALL' ? dailyFilteredSigEntries : dailyFilteredSigEntries.filter((s: any) => (s.signal ?? 'HOLD') === dailyGridSignal)
  const dailyGridSorted: any[] = [...dailyGridBySignal].sort((a: any, b: any) => Math.abs(Number(b.ofi ?? 0)) - Math.abs(Number(a.ofi ?? 0)))
  const dailyGridShown: any[] = dailyGridShowAll ? dailyGridSorted : dailyGridSorted.slice(0, 10)
  const FIGURES = (outputs.data?.figures ?? []).filter((f: string) => f !== 'ofi_zscore_chart_filtered.png')
  // Hourly derived state from intraday signals
  const ids: any[] = intradaySignals.data?.signals ?? []
  const hourlyFilteredIds: any[] = hourlyTickerFilter === null ? ids : ids.filter((s: any) => hourlyTickerFilter.has(s.ticker))
  // Card-grid signal-category pills (BUY/HOLD/SELL/ALL) + top-10 cap, ranked by |IC| (Hourly's signal-quality metric)
  const hourlyGridCounts = {
    ALL:  hourlyFilteredIds.length,
    BUY:  hourlyFilteredIds.filter((s: any) => (s.signal ?? 'HOLD') === 'BUY').length,
    HOLD: hourlyFilteredIds.filter((s: any) => (s.signal ?? 'HOLD') === 'HOLD').length,
    SELL: hourlyFilteredIds.filter((s: any) => (s.signal ?? 'HOLD') === 'SELL').length,
  }
  const hourlyGridBySignal: any[] = hourlyGridSignal === 'ALL' ? hourlyFilteredIds : hourlyFilteredIds.filter((s: any) => (s.signal ?? 'HOLD') === hourlyGridSignal)
  const hourlyGridSorted: any[] = [...hourlyGridBySignal].sort((a: any, b: any) => Math.abs(Number(b.mean_ic ?? 0)) - Math.abs(Number(a.mean_ic ?? 0)))
  const hourlyGridShown: any[] = hourlyGridShowAll ? hourlyGridSorted : hourlyGridSorted.slice(0, 10)
  // SHAP ticker-picker signal pre-filter — narrows the SHAP dropdown/pills to tickers currently carrying the selected signal
  const shapSignalCounts = {
    ALL:  ids.length,
    BUY:  ids.filter((s: any) => (s.signal ?? 'HOLD') === 'BUY').length,
    HOLD: ids.filter((s: any) => (s.signal ?? 'HOLD') === 'HOLD').length,
    SELL: ids.filter((s: any) => (s.signal ?? 'HOLD') === 'SELL').length,
  }
  const shapTickerSet = new Set((shapSignalFilter === 'ALL' ? ids : ids.filter((s: any) => (s.signal ?? 'HOLD') === shapSignalFilter)).map((s: any) => s.ticker))
  const shapOptions = (tickerInfoQuery.data ?? ALL_TICKERS.map(t => ({ ticker: t }))).filter((o: any) => shapTickerSet.has(o.ticker))
  const featureCount: number = intradaySignals.data?.meta?.feature_count ?? 12
  // Avg |IC| across tickers — measures signal strength regardless of direction
  const p2AvgAbsIC = ids.length > 0 ? ids.reduce((s: number, x: any) => s + Math.abs(x.mean_ic ?? 0), 0) / ids.length : null
  const p2AvgSharpe = ids.length > 0 ? ids.reduce((s: number, x: any) => s + (x.sharpe ?? 0), 0) / ids.length : null
  // Avg Sortino (only tickers with non-null sortino)
  const _sortinoTickers = ids.filter((x: any) => x.sortino != null)
  const p2AvgSortino = _sortinoTickers.length > 0 ? _sortinoTickers.reduce((s: number, x: any) => s + (x.sortino ?? 0), 0) / _sortinoTickers.length : null
  // IC_IR — Fundamental Law (Grinold & Kahn 2000): IC_IR = mean(IC)/std(IC)×√N
  const _icIrTickers = ids.filter((x: any) => x.ic_ir != null)
  const p2AvgIcIr = _icIrTickers.length > 0 ? _icIrTickers.reduce((s: number, x: any) => s + (x.ic_ir ?? 0), 0) / _icIrTickers.length : null
  const p2SignalRate = ids.length > 0 ? ids.filter((x: any) => x.signal !== 'HOLD').length / ids.length * 100 : null
  const p2TopSignal = ids.length > 0 ? [...ids].sort((a: any, b: any) => Math.abs(b.mean_ic) - Math.abs(a.mean_ic))[0] : null
  // Avg OFI Z-score from daily signals (replaces IC in daily live metrics)
  const avgOFIZ = allSigEntries.length > 0
    ? allSigEntries.reduce((s: number, x: any) => s + (x.ofi ?? 0), 0) / allSigEntries.length
    : null
  // Augmented metrics: merge backend metrics with frontend-computed avg_ofi_zscore
  const metricsForCards = metrics ? { ...metrics, avg_ofi_zscore: avgOFIZ } : (avgOFIZ != null ? { avg_ofi_zscore: avgOFIZ } as any : null)
  // Research drawer signal data — hourly vs daily
  const drawerSignalData = researchDrawerTicker
    ? (resolution === 'hourly'
      ? ids.find((s: any) => s.ticker === researchDrawerTicker)
      : allSigEntries.find((s: any) => s.ticker === researchDrawerTicker))
    : null
  // Open research drawer for a ticker — auto-sends a context-rich LLM query
  function openResearchDrawer(ticker: string) {
    setResearchDrawerTicker(ticker)
    // Build a deterministic, context-rich prompt from live signal data so the LLM
    // generates a unique, grounded analysis for this exact ticker and moment.
    const sd = resolution === 'hourly'
      ? ids.find((s: any) => s.ticker === ticker)
      : allSigEntries.find((s: any) => s.ticker === ticker)
    let autoMsg: string
    if (resolution === 'hourly' && sd) {
      const topFeat = sd.shap_top ?? 'ofi_zscore'
      const featLabel = FEATURE_EXPLANATIONS[topFeat]?.label ?? topFeat
      const featHighMeans = FEATURE_EXPLANATIONS[topFeat]?.highMeans ?? ''
      autoMsg = `Analyse ${ticker} (hourly intraday AlphaFlow). Current signal: ${sd.signal}. ` +
        `IC: ${(sd.mean_ic * 100).toFixed(2)}%, Sharpe: ${sd.sharpe >= 0 ? '+' : ''}${sd.sharpe.toFixed(2)}, ` +
        `Max DD: ${sd.max_drawdown != null ? '-' + (Math.abs(sd.max_drawdown) * 100).toFixed(1) + '%' : 'N/A'}, ` +
        `Walk-forward folds: ${sd.n_folds ?? '?'}. ` +
        `Top SHAP feature: "${featLabel}" (${topFeat}). ${featHighMeans ? 'High values mean: ' + featHighMeans.slice(0, 120) + '.' : ''} ` +
        `Explain in plain English: (1) what this signal means for near-term price direction, ` +
        `(2) why "${featLabel}" is the dominant driver, and (3) what are the key risk factors to watch.`
    } else if (resolution === 'daily' && sd) {
      autoMsg = `Analyse ${ticker} (daily microstructure). Signal: ${sd.signal}. ` +
        `OFI Z-score: ${Number(sd.ofi ?? 0).toFixed(3)}, Effective Spread: ${Number(sd.eff_spread_bps ?? 0).toFixed(1)} bps, ` +
        `Kyle λ: ${Number(sd.kyle_lambda ?? 0).toExponential(2)}, Amihud ILLIQ: ${Number(sd.amihud_illiq ?? 0).toExponential(2)}. ` +
        `Explain what these microstructure signals suggest about near-term price direction and liquidity conditions for ${ticker}. ` +
        `What should a trader watch out for?`
    } else {
      autoMsg = `Explain the microstructure signals for ${ticker}. What does the current data suggest about near-term direction and liquidity risk?`
    }
    // Use setTimeout to ensure state is committed before the API call reads it
    setTimeout(() => sendChatWithTicker(autoMsg, ticker), 60)
  }

  // Change the "currently selected" ticker (SHAP Importance / Signal Analysis).
  // If the Research Drawer (and its AI chat context) is already open, keep it
  // in sync too — otherwise switching ticker via a dropdown left the drawer
  // pointed at a stale ticker while the charts below it moved on.
  function selectTicker(ticker: string) {
    setSelectedShapTicker(ticker)
    if (researchDrawerTicker && ticker !== 'ALL') setResearchDrawerTicker(ticker)
  }

  return (
    <ThemeCtx.Provider value={{ S, isDark }}>
      <TickerNamesCtx.Provider value={dynTickerNames}>
      <div style={{ background: S.bgGradient, minHeight: '100vh', color: S.text, fontFamily: "'Inter', system-ui, sans-serif", fontSize: 14, overflowX: 'hidden' }}>

        {/* ── Backend-offline banner: keeps the UI usable + explains what to do ── */}
        {health.isError && (
          <div style={{ background: '#7f1d1d', color: '#FECACA', padding: '8px 16px', fontSize: 12, fontWeight: 600, textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <span>⚠ Backend API is offline — showing last-known data. Start it with</span>
            <code style={{ background: '#00000055', padding: '2px 8px', borderRadius: 4, fontFamily: 'monospace' }}>uvicorn backend.main:app --port 8002</code>
            <span>then it will reconnect automatically.</span>
          </div>
        )}

        {fullscreenChart && (() => {
          const fsT = selectedShapTicker === 'ALL' ? (intradaySignals.data?.signals?.[0]?.ticker ?? 'AAPL') : selectedShapTicker
          const fsMap: Record<string, { title: string; node: React.ReactNode }> = {
            ofi:             { title: 'OFI Z-score Monitor — Full Screen', node: <OFIRechartsChart S={S} fullscreen /> },
            execution:       { title: 'Execution Quality — Full Screen', node: <ExecutionQualityChart S={S} /> },
            lambda:          { title: "Kyle's λ Trend — Full Screen", node: <KyleLambdaChart S={S} /> },
            decay:           { title: 'Alpha Decay (IC Lags 1–10) — Full Screen', node: <AlphaDecayChart S={S} /> },
            lgbm_scatter:         { title: `LGBM Predicted vs Actual — ${fsT} — Full Screen`, node: <LGBMScatterChart ticker={fsT} S={S} /> },
            shap_dependence:      { title: `SHAP Dependence Plot — ${fsT} — Full Screen`, node: <SHAPDependencePlot ticker={fsT} S={S} /> },
            feature_correlation:  { title: `Feature Correlation Heatmap — ${fsT} — Full Screen`, node: <FeatureCorrelationHeatmap ticker={fsT} S={S} /> },
          }
          const c = fsMap[fullscreenChart]
          return c ? <ChartLightbox title={c.title} onClose={() => setFullscreenChart(null)}>{c.node}</ChartLightbox> : null
        })()}
        {lightboxImg && (
          <Lightbox src={`/api/outputs/${lightboxImg}`} title={lightboxImg} onClose={() => setLightboxImg(null)} />
        )}
        {clickedMetricKey && (
          <MetricExplanationModal metricKey={clickedMetricKey} onClose={() => setClickedMetricKey(null)} />
        )}
        {drawerMetricModal && (
          <MetricExplanationModal metricKey={drawerMetricModal} onClose={() => setDrawerMetricModal(null)} />
        )}
        {researchDrawerTicker && (
          <TickerResearchDrawer
            ticker={researchDrawerTicker}
            signalData={drawerSignalData}
            isHourly={resolution === 'hourly'}
            chat={chat}
            chatInput={chatInput}
            setChatInput={setChatInput}
            onSend={sendChat}
            chatLoading={chatLoading}
            onClose={() => setResearchDrawerTicker(null)}
            onMetricClick={setDrawerMetricModal}
          />
        )}
        {/* ── Floating Research Assistant button ── */}
        {createPortal(
          <button
            onClick={() => {
              const firstTicker = resolution === 'hourly'
                ? (ids[0]?.ticker ?? allSigEntries[0]?.ticker ?? ALL_TICKERS[0])
                : (allSigEntries[0]?.ticker ?? ids[0]?.ticker ?? ALL_TICKERS[0])
              openResearchDrawer(firstTicker)
            }}
            style={{ position: 'fixed', bottom: 28, right: 24, zIndex: 200, background: S.fabBg, backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', color: '#fff', border: 'none', borderRadius: 28, padding: '10px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.35)', transition: 'transform 0.15s, box-shadow 0.15s' }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 8px 28px rgba(0,0,0,0.45)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'none'; (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 20px rgba(0,0,0,0.35)' }}>
            Signal Analyst
          </button>,
          document.body
        )}
        {/* ── Hourly Banner (hourly mode only) ── */}
        {resolution === 'hourly' && (
          <div style={{ background: 'linear-gradient(90deg, #0C4A6E 0%, #0891B2 60%, #155E75 100%)', padding: '5px 32px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ color: '#A5F3FC', fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase' }}>Hourly Intraday Engine</span>
            <span style={{ color: '#67E8F9', fontSize: 10, opacity: 0.85 }}>Hourly Walk-Forward · VWAP Deviation · Hawkes Intensity · Volume Clock · LGBMRegressor · SHAP Attribution</span>
            <span style={{ background: '#0891B2', color: '#fff', fontSize: 8, fontWeight: 900, padding: '1px 7px', borderRadius: 3, letterSpacing: '0.1em', marginLeft: 'auto' }}>LIVE</span>
          </div>
        )}
        {/* ── Header ── */}
        <div style={{ background: S.headerGlassBg, backdropFilter: 'blur(14px) saturate(160%)', WebkitBackdropFilter: 'blur(14px) saturate(160%)', borderBottom: `2px solid ${resolution === 'hourly' ? '#0891B2' : S.primary}44`, padding: '14px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100, flexWrap: 'wrap', rowGap: 10 }}>
          <div>
            <h1 style={{ color: resolution === 'hourly' ? (isDark ? '#0891B2' : '#0E7490') : S.primary, fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>
              AlphaFlow <span style={{ color: S.border }}>·</span>{' '}
              <span style={{ color: S.muted, fontSize: 13, fontWeight: 400 }}>Quantitative Signal Infrastructure</span>
            </h1>
            <p style={{ color: S.muted, fontSize: 11, margin: '2px 0 0', opacity: 0.65 }}>
              {resolution === 'daily'
                ? `EOD Signal Engine · ${totalTickerCount} tickers · OFI Z-score · Kyle λ (price impact) · Amihud ILLIQ · Corwin-Schultz Spread`
                : `Intraday Signal Engine · ${totalTickerCount} tickers · ${featureCount} features · LightGBM Walk-Forward · SHAP Signal Attribution`
              }
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', rowGap: 8 }}>
            <button onClick={() => setIsDark(!isDark)}
              style={{ background: S.tag, color: S.primary, border: `1px solid ${S.border}`, borderRadius: 8, padding: '5px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              {isDark ? 'Light' : 'Dark'}
            </button>
            <span style={{ color: S.muted, fontSize: 11, opacity: 0.55 }}>{clock}</span>
            {/* Resolution toggle */}
            <div style={{ display: 'flex', background: S.tag, borderRadius: 8, border: `1px solid ${S.border}`, overflow: 'hidden' }}>
              {(['daily', 'hourly'] as const).map(r => (
                <button key={r} onClick={() => setResolution(r)}
                  style={{ padding: '5px 13px', fontSize: 11, fontWeight: 700, cursor: 'pointer', border: 'none',
                    background: resolution === r ? (r === 'hourly' ? '#0891B2' : S.primary) : 'transparent',
                    color: resolution === r ? '#fff' : S.muted, transition: 'all 0.2s' }}>
                  {r === 'daily' ? 'Daily' : 'Hourly'}
                </button>
              ))}
            </div>
            {((resolution === 'daily' && isRunning) || (resolution === 'hourly' && (runIntraday.isPending || intradayRunning))) && (
              <span style={{ color: resolution === 'hourly' ? (isDark ? '#0891B2' : '#0E7490') : S.primary, fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: resolution === 'hourly' ? '#0891B2' : S.primary, animation: 'pulse 1.4s ease-in-out infinite' }}></div>
                {resolution === 'hourly' && intradayProgress.data
                  ? `Pipeline running… ${intradayProgress.data.done}/${intradayProgress.data.total} tickers`
                  : resolution === 'daily' && dailyProgress.data?.running
                    ? `${dailyStageLabel(dailyProgress.data.stage)} — ${dailyProgress.data.done}/${dailyProgress.data.total} tickers`
                    : 'Pipeline running…'}
              </span>
            )}
            {/* Live stream dot */}
            {resolution === 'hourly' && (
              <span
                title={streamConnected
                  ? (health.data?.alpaca === 'configured'
                      ? 'Live SSE stream connected — receiving real Alpaca IEX bars every 15 seconds (15-min delayed, free tier). ALPACA_API_KEY is configured on the backend.'
                      : 'Live SSE stream connected — receiving bars every 15 seconds. No ALPACA_API_KEY configured on the backend, so this is synthetic random-walk data (same architecture as live). Add a free Alpaca key for real 15-min delayed IEX data.')
                  : 'Stream not connected. The browser is attempting to connect to /api/stream via SSE (Server-Sent Events). Free tier uses synthetic data as fallback — no API key needed.'}
                style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11,
                  color: streamConnected ? S.positiveVal : S.muted, cursor: 'help' }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%',
                  background: streamConnected ? '#22C55E' : S.border,
                  boxShadow: streamConnected ? '0 0 6px #22C55E' : 'none',
                  animation: streamConnected ? 'pulse 2s ease-in-out infinite' : 'none' }}></div>
                {streamConnected ? 'Live' : 'Connecting…'}
              </span>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: health.data ? '#22C55E' : '#EF4444', boxShadow: health.data ? '0 0 8px #22C55E88' : 'none' }}></div>
              <span style={{ color: health.data ? S.positiveVal : S.negativeVal, fontSize: 12, fontWeight: 600 }}>{health.data ? 'API Online' : 'API Offline'}</span>
            </div>
          </div>
        </div>

        <div style={{ padding: '24px 32px', maxWidth: 1380, margin: '0 auto' }}>

          {/* ── Pipeline + Metrics ── */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '260px 1fr', gap: 16, marginBottom: 16 }}>
            <Card title="Controls" accent>
              {resolution === 'daily' && (
                <>
                  <button onClick={() => run.mutate()} disabled={run.isPending || isRunning}
                    style={{ background: run.isPending || isRunning ? S.border : S.runBtn, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 22px', fontSize: 13, fontWeight: 700, cursor: run.isPending || isRunning ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 8, width: '100%', justifyContent: 'center' }}>
                    {run.isPending || isRunning
                      ? <><div style={{ width: 12, height: 12, borderWidth: 2, borderStyle: 'solid', borderColor: '#fff4', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}></div>
                          {dailyProgress.data?.running ? `${dailyProgress.data.done}/${dailyProgress.data.total}` : 'Running…'}
                        </>
                      : <><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>Run Daily Scan</>}
                  </button>
                  {run.isError && <p style={{ color: S.negativeVal, fontSize: 11, marginTop: 8, marginBottom: 0 }}>✗ Error — check terminal logs</p>}
                  {isRunning && dailyProgress.data?.running && (
                    <div style={{ marginTop: 6, padding: '7px 9px', background: `${S.primary}09`, border: `1px dashed ${S.border}`, borderRadius: 5, fontSize: 9, color: S.muted, lineHeight: 1.5 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <strong style={{ color: S.text }}>{dailyStageLabel(dailyProgress.data.stage)} — {dailyProgress.data.done}/{dailyProgress.data.total} tickers</strong>
                      </div>
                      {dailyProgress.data.current && (
                        <div style={{ marginBottom: 4, opacity: 0.75 }}>Just finished: <strong>{dailyProgress.data.current}</strong></div>
                      )}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                        {dailyProgress.data.completed.slice(-12).reverse().map(t => (
                          <span key={t} style={{ padding: '1px 5px', borderRadius: 4, background: `${S.positiveVal}22`, color: S.positiveVal, fontWeight: 700 }}>{t}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
              {resolution === 'hourly' && (
                <>
                  <button onClick={() => runIntraday.mutate()} disabled={runIntraday.isPending || intradayRunning}
                    style={{ background: (runIntraday.isPending || intradayRunning) ? S.border : S.runBtn, color: '#fff', border: 'none',
                      borderRadius: 8, padding: '10px 22px', fontSize: 13, fontWeight: 700,
                      cursor: (runIntraday.isPending || intradayRunning) ? 'default' : 'pointer',
                      display: 'flex', alignItems: 'center', gap: 8, width: '100%', justifyContent: 'center' }}>
                    {(runIntraday.isPending || intradayRunning)
                      ? <><div style={{ width: 12, height: 12, borderWidth: 2, borderStyle: 'solid', borderColor: '#fff4', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}></div>
                          {intradayProgress.data ? `Running… ${intradayProgress.data.done}/${intradayProgress.data.total}` : 'Running…'}
                        </>
                      : 'Run Signal Engine'}
                  </button>
                  <div style={{ marginTop: 8, padding: '6px 10px', background: S.bg, borderRadius: 6, border: `1px solid ${S.border}`, display: 'flex', alignItems: 'center', gap: 7 }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%',
                      background: streamConnected ? '#22C55E' : S.border,
                      boxShadow: streamConnected ? '0 0 6px #22C55E' : 'none',
                      animation: streamConnected ? 'pulse 2s ease-in-out infinite' : 'none', flexShrink: 0 }}></div>
                    <span style={{ color: S.muted, fontSize: 10, lineHeight: 1.4 }}>
                      {streamConnected ? 'Live stream connected' : 'Stream connecting…'}
                    </span>
                  </div>
                  {intradayRunning && intradayProgress.data ? (
                    <div style={{ marginTop: 6, padding: '7px 9px', background: `${S.primary}09`, border: `1px dashed ${S.border}`, borderRadius: 5, fontSize: 9, color: S.muted, lineHeight: 1.5 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <strong style={{ color: S.text }}>{intradayProgress.data.done}/{intradayProgress.data.total} tickers processed</strong>
                      </div>
                      {intradayProgress.data.current && (
                        <div style={{ marginBottom: 4, opacity: 0.75 }}>Just finished: <strong>{intradayProgress.data.current}</strong></div>
                      )}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                        {intradayProgress.data.completed.slice(-12).reverse().map(c => (
                          <span key={c.ticker} style={{ padding: '1px 5px', borderRadius: 4, background: c.error ? `${S.negativeVal}22` : `${S.positiveVal}22`, color: c.error ? S.negativeVal : S.positiveVal, fontWeight: 700 }}>{c.ticker}</span>
                        ))}
                      </div>
                    </div>
                  ) : ids.length > 0 && ids[0]?.data_end && !runIntraday.isPending && (
                    <div style={{ marginTop: 6, padding: '5px 9px', background: `${S.primary}09`, border: `1px dashed ${S.border}`, borderRadius: 5, fontSize: 9, color: S.muted, lineHeight: 1.5 }}>
                      Last computed: <strong style={{ color: S.text }}>{ids[0].data_end}</strong> · {ids.length} ticker{ids.length !== 1 ? 's' : ''}
                      <br /><span style={{ opacity: 0.6 }}>Click Run Signal Engine to refresh with latest hourly bars</span>
                    </div>
                  )}
                </>
              )}
              {resolution === 'daily' && (
                <button onClick={() => refreshData.mutate()} disabled={refreshData.isPending}
                  style={{ background: refreshDone ? `${S.primary}18` : 'transparent', color: refreshDone ? S.primary : S.muted, border: `1px solid ${refreshDone ? S.primary + '44' : S.border}`, borderRadius: 8, padding: '7px 12px', fontSize: 11, fontWeight: 600, cursor: refreshData.isPending ? 'default' : 'pointer', width: '100%', marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all 0.3s' }}>
                  {refreshData.isPending
                    ? <><div style={{ width: 10, height: 10, borderWidth: 2, borderStyle: 'solid', borderColor: S.muted, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}></div>{refreshLabel}</>
                    : refreshLabel}
                </button>
              )}
              {resolution === 'daily' && refreshDone && customTickersList.length > 0 && (
                <div style={{ marginTop: 8, padding: '7px 10px', background: `${S.primary}11`, border: `1px solid ${S.primary}33`, borderRadius: 7, fontSize: 9, color: S.primary, lineHeight: 1.6 }}>
                  <strong>↑ Data refreshed</strong> for {customTickersList.join(', ')} + default tickers.
                  <br />▶ Click <strong>Run Daily Scan</strong> to update microstructure analysis and signals for all tickers.
                </div>
              )}
              {resolution === 'daily' && history.data?.[0] && (
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${S.border}` }}>
                  <p style={{ color: S.muted, fontSize: 10, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Last Run</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <StatusBadge s={history.data[0].status} />
                    <span style={{ color: S.muted, fontSize: 11 }}>{formatTime(history.data[0].started_at)}</span>
                  </div>
                  {history.data[0].data_start && history.data[0].data_end && (
                    <p style={{ color: S.muted, fontSize: 9, margin: '3px 0 0', opacity: 0.55, lineHeight: 1.5 }}>
                      Data: {history.data[0].data_start} → {history.data[0].data_end}
                      {history.data[0].total_bars ? ` · ${history.data[0].total_bars} bars` : ''}
                    </p>
                  )}
                </div>
              )}
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${S.border}` }}>
                <p style={{ color: S.muted, fontSize: 10, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Add Custom Ticker</p>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    value={customTicker}
                    onChange={e => { setCustomTicker(e.target.value.toUpperCase()); setAddTickerMsg(null) }}
                    onKeyDown={e => e.key === 'Enter' && handleAddTicker()}
                    placeholder="e.g. AMZN"
                    maxLength={6}
                    style={{ flex: 1, background: S.bg, color: S.text, border: `1px solid ${S.border}`, borderRadius: 6, padding: '6px 8px', fontSize: 11, outline: 'none', minWidth: 0 }} />
                  <button onClick={handleAddTicker} disabled={!customTicker.trim() || addingTicker}
                    style={{ background: !customTicker.trim() || addingTicker ? S.border : S.primary, color: '#fff', border: 'none', borderRadius: 6, padding: '6px 10px', fontSize: 11, fontWeight: 700, cursor: !customTicker.trim() || addingTicker ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
                    {addingTicker ? '…' : 'Add ↓'}
                  </button>
                </div>
                {addTickerMsg && <p style={{ color: addTickerMsg.ok ? S.positiveVal : S.negativeVal, fontSize: 10, margin: '5px 0 0', lineHeight: 1.4 }}>{addTickerMsg.text}</p>}
                <p style={{ color: S.muted, fontSize: 9, margin: '4px 0 0', opacity: 0.45 }}>Downloads 2yr OHLCV · refresh + re-run pipeline</p>
                {customTickersList.length > 0 && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${S.border}` }}>
                    <p style={{ color: S.muted, fontSize: 10, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Custom Tickers</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {customTickersList.map(t => (
                        <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 3, background: `${getTickerColor(t, isDark)}18`, border: `1px solid ${getTickerColor(t, isDark)}44`, borderRadius: 5, padding: '3px 6px' }}>
                          <span style={{ color: getTickerColor(t, isDark), fontWeight: 700, fontSize: 11 }}>{t}</span>
                          <button onClick={() => handleDeleteTicker(t)} title={`Remove ${t}`}
                            style={{ background: 'transparent', border: 'none', color: S.negativeVal, cursor: 'pointer', padding: 0, fontSize: 11, lineHeight: 1 }}>✕</button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {resolution === 'daily' && (
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${S.border}` }}>
                  <button onClick={() => printResearchBrief({ ids, allSigEntries, p2AvgAbsIC, p2AvgIcIr })}
                    style={{ background: 'transparent', color: S.primary, border: `1px solid ${S.primary}55`, borderRadius: 8, padding: '7px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    Export Research Brief (PDF)
                  </button>
                  <p style={{ color: S.muted, fontSize: 9, margin: '5px 0 0', textAlign: 'center', opacity: 0.55 }}>Opens print dialog — Save as PDF</p>
                </div>
              )}
            </Card>

            <Card title={(() => {
              const latestRun = history.data?.[0]
              const ds = latestRun?.data_start
              const de = latestRun?.data_end
              const tb = latestRun?.total_bars
              const dateStr = ds && de ? `${ds} – ${de}` : '2yr daily OHLCV'
              const barStr  = tb ? `${tb} bars` : ''
              return `Live Microstructure Metrics — ${totalTickerCount} Tickers · ${dateStr}${barStr ? ` (${barStr})` : ''}`
            })()}>
              {resolution === 'hourly' ? (
                /* ── Hourly Summary Cards (hourly mode) ── */
                <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(165px, 1fr))', gap: 10 }}>
                  {/* IC_IR — Fundamental Law (Grinold & Kahn 2000 Ch.6) */}
                  <Tooltip content={<div><p style={{ color: '#38BDF8', fontSize: 11, fontWeight: 700, margin: '0 0 4px' }}>IC Information Ratio (IC_IR)</p><p style={{ color: '#7DD3FC', fontSize: 10, fontFamily: 'monospace', margin: '0 0 5px' }}>IC_IR = mean(IC) / std(IC) × √N</p><p style={{ color: '#CBD5E1', fontSize: 11, margin: '0 0 5px' }}>The Fundamental Law of Active Management (Grinold & Kahn 2000, Ch.6). IC_IR measures signal CONSISTENCY across walk-forward folds — not just average strength. Expected IR ≈ IC_IR. Benchmarks: &gt;0.5 = usable, &gt;1.0 = good, &gt;2.0 = excellent.</p>{ids.length === 0 && <p style={{ color: '#FDE68A', fontSize: 10, margin: '4px 0 0' }}>Click Run Intraday to populate</p>}</div>}>
                    <div style={{ background: S.bg, border: `1px solid ${p2AvgIcIr != null && p2AvgIcIr >= 1.0 ? '#166534' : p2AvgIcIr != null && p2AvgIcIr >= 0.5 ? '#854d0e' : S.border}`, borderRadius: 8, padding: '12px 14px' }}>
                      <p style={{ color: S.muted, fontSize: 10, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>IC_IR <span style={{ opacity: 0.4 }}>ⓘ</span></p>
                      <p style={{ color: p2AvgIcIr != null ? (p2AvgIcIr >= 1.0 ? S.positiveVal : p2AvgIcIr >= 0.5 ? S.warnVal : S.muted) : S.muted, fontSize: 18, fontWeight: 800, margin: '0 0 4px', fontVariantNumeric: 'tabular-nums' }}>
                        {p2AvgIcIr != null ? p2AvgIcIr.toFixed(2) : '—'}
                      </p>
                      <p style={{ color: S.muted, fontSize: 9, margin: 0, opacity: 0.5 }}>Fundamental Law · consistency</p>
                    </div>
                  </Tooltip>
                  {/* Avg |IC| */}
                  <Tooltip content={<div><p style={{ color: '#38BDF8', fontSize: 11, fontWeight: 700, margin: '0 0 4px' }}>Hourly Walk-Forward Avg |IC|</p><p style={{ color: '#CBD5E1', fontSize: 11, margin: '0 0 5px' }}>Mean absolute Information Coefficient — average of |IC| across all tickers from hourly walk-forward. Measures signal strength regardless of direction (a consistently negative IC is still usable). |IC| &gt; 5% = statistically meaningful (Grinold &amp; Kahn 2000).</p>{ids.length === 0 && <p style={{ color: '#FDE68A', fontSize: 10, margin: '4px 0 0' }}>Click Run Intraday to populate</p>}</div>}>
                    <div onClick={() => setClickedMetricKey('IC')} style={{ background: S.bg, border: `1px solid ${p2AvgAbsIC != null && p2AvgAbsIC > 0.05 ? '#166534' : '#854d0e'}`, borderRadius: 8, padding: '12px 14px', cursor: 'pointer' }}>
                      <p style={{ color: S.muted, fontSize: 10, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Avg |IC| (Hourly) <span style={{ color: S.primary, opacity: 0.7, fontSize: 9 }}>ⓘ click</span></p>
                      <p style={{ color: p2AvgAbsIC != null ? (p2AvgAbsIC > 0.05 ? S.positiveVal : S.warnVal) : S.muted, fontSize: 18, fontWeight: 800, margin: '0 0 4px', fontVariantNumeric: 'tabular-nums' }}>
                        {p2AvgAbsIC != null ? `${(p2AvgAbsIC * 100).toFixed(2)}%` : '—'}
                      </p>
                      <p style={{ color: S.muted, fontSize: 9, margin: 0, opacity: 0.5 }}>{p2AvgAbsIC != null ? (p2AvgAbsIC >= 0.05 ? 'meaningful signal' : p2AvgAbsIC >= 0.02 ? 'weak signal' : 'noise level') : 'mean |IC| · avg across tickers'}</p>
                    </div>
                  </Tooltip>
                  {/* Avg Sharpe */}
                  <Tooltip content={<div><p style={{ color: '#38BDF8', fontSize: 11, fontWeight: 700, margin: '0 0 4px' }}>Average Sharpe Ratio</p><p style={{ color: '#CBD5E1', fontSize: 11, margin: '0 0 5px' }}>Mean annualised Sharpe ratio across all {totalTickerCount} tickers from hourly walk-forward. Any positive Sharpe indicates the model earns more than it risks. &gt; 1 = strong, &gt; 2 = excellent. Near-zero is expected without live tick data.</p>{ids.length === 0 && <p style={{ color: '#FDE68A', fontSize: 10, margin: '4px 0 0' }}>Click Run Intraday to populate</p>}</div>}>
                    <div onClick={() => setClickedMetricKey('Sharpe')} style={{ background: S.bg, border: `1px solid ${p2AvgSharpe != null && p2AvgSharpe >= 0.5 ? '#166534' : S.border}`, borderRadius: 8, padding: '12px 14px', cursor: 'pointer' }}>
                      <p style={{ color: S.muted, fontSize: 10, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Avg Sharpe <span style={{ color: S.primary, opacity: 0.7, fontSize: 9 }}>ⓘ click</span></p>
                      <p style={{ color: p2AvgSharpe != null ? (p2AvgSharpe >= 0 ? S.positiveVal : S.negativeVal) : S.muted, fontSize: 18, fontWeight: 800, margin: '0 0 4px', fontVariantNumeric: 'tabular-nums' }}>
                        {p2AvgSharpe != null ? `${p2AvgSharpe >= 0 ? '+' : ''}${p2AvgSharpe.toFixed(2)}` : '—'}
                      </p>
                      <p style={{ color: S.muted, fontSize: 9, margin: 0, opacity: 0.5 }}>annualised · avg across tickers</p>
                    </div>
                  </Tooltip>
                  {/* Avg Sortino */}
                  <Tooltip content={<div><p style={{ color: '#38BDF8', fontSize: 11, fontWeight: 700, margin: '0 0 4px' }}>Average Sortino Ratio</p><p style={{ color: '#7DD3FC', fontSize: 10, fontFamily: 'monospace', margin: '0 0 5px' }}>Sortino = √scale × μ / σ_downside</p><p style={{ color: '#CBD5E1', fontSize: 11, margin: '0 0 5px' }}>Only penalises DOWNSIDE volatility. Upside swings don't count against you. Avg across all tickers. Benchmarks: &gt;0 = positive, &gt;1 = solid, &gt;2 = strong asymmetric alpha.</p>{ids.length === 0 && <p style={{ color: '#FDE68A', fontSize: 10, margin: '4px 0 0' }}>Click Run Intraday to populate</p>}</div>}>
                    <div style={{ background: S.bg, border: `1px solid ${p2AvgSortino != null && p2AvgSortino >= 1.0 ? '#166534' : S.border}`, borderRadius: 8, padding: '12px 14px' }}>
                      <p style={{ color: S.muted, fontSize: 10, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Avg Sortino <span style={{ opacity: 0.4 }}>ⓘ</span></p>
                      <p style={{ color: p2AvgSortino != null ? (p2AvgSortino >= 0 ? S.positiveVal : S.negativeVal) : S.muted, fontSize: 18, fontWeight: 800, margin: '0 0 4px', fontVariantNumeric: 'tabular-nums' }}>
                        {p2AvgSortino != null ? `${p2AvgSortino >= 0 ? '+' : ''}${p2AvgSortino.toFixed(2)}` : '—'}
                      </p>
                      <p style={{ color: S.muted, fontSize: 9, margin: 0, opacity: 0.5 }}>downside-vol adjusted · avg tickers</p>
                    </div>
                  </Tooltip>
                  {/* Signal Rate */}
                  <Tooltip content={<div><p style={{ color: '#38BDF8', fontSize: 11, fontWeight: 700, margin: '0 0 4px' }}>Signal Rate</p><p style={{ color: '#CBD5E1', fontSize: 11, margin: '0 0 5px' }}>Percentage of tickers with a directional signal (BUY or SELL). Higher = more actionable signals today. Remaining tickers are classified HOLD by cross-sectional IC ranking.</p>{ids.length === 0 && <p style={{ color: '#FDE68A', fontSize: 10, margin: '4px 0 0' }}>Click Run Intraday to populate</p>}</div>}>
                    <div style={{ background: S.bg, border: `1px solid ${p2SignalRate != null && p2SignalRate >= 50 ? '#166534' : S.border}`, borderRadius: 8, padding: '12px 14px' }}>
                      <p style={{ color: S.muted, fontSize: 10, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Signal Rate <span style={{ opacity: 0.4 }}>ⓘ</span></p>
                      <p style={{ color: p2SignalRate != null ? S.primary : S.muted, fontSize: 18, fontWeight: 800, margin: '0 0 4px', fontVariantNumeric: 'tabular-nums' }}>
                        {p2SignalRate != null ? `${p2SignalRate.toFixed(0)}%` : '—'}
                      </p>
                      <p style={{ color: S.muted, fontSize: 9, margin: 0, opacity: 0.5 }}>
                        {ids.length > 0 ? `${ids.filter((x: any) => x.signal === 'BUY').length} BUY · ${ids.filter((x: any) => x.signal === 'SELL').length} SELL · ${ids.filter((x: any) => x.signal === 'HOLD').length} HOLD` : 'BUY + SELL tickers / total'}
                      </p>
                    </div>
                  </Tooltip>
                  {/* Top Signal */}
                  <Tooltip content={<div><p style={{ color: '#38BDF8', fontSize: 11, fontWeight: 700, margin: '0 0 4px' }}>Top Signal</p><p style={{ color: '#CBD5E1', fontSize: 11, margin: '0 0 5px' }}>Ticker with the highest absolute IC from hourly walk-forward. This is the strongest directional signal in the current universe. Click its card below to open the Research Drawer.</p>{ids.length === 0 && <p style={{ color: '#FDE68A', fontSize: 10, margin: '4px 0 0' }}>Click Run Intraday to populate</p>}</div>}>
                    <div style={{ background: S.bg, border: `1px solid ${p2TopSignal ? getTickerColor(p2TopSignal.ticker) + '66' : S.border}`, borderRadius: 8, padding: '12px 14px', cursor: p2TopSignal ? 'pointer' : 'default' }} onClick={() => p2TopSignal && openResearchDrawer(p2TopSignal.ticker)}>
                      <p style={{ color: S.muted, fontSize: 10, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Top Signal <span style={{ opacity: 0.4 }}>ⓘ</span></p>
                      {p2TopSignal ? (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                            <span style={{ color: getTickerColor(p2TopSignal.ticker, isDark), fontSize: 18, fontWeight: 800 }}>{p2TopSignal.ticker}</span>
                            <SignalBadge sig={p2TopSignal.signal} />
                          </div>
                          <p style={{ color: S.muted, fontSize: 9, margin: 0, opacity: 0.5 }}>IC {(Math.abs(p2TopSignal.mean_ic) * 100).toFixed(2)}% · IC_IR {p2TopSignal.ic_ir?.toFixed(2) ?? '—'}</p>
                        </>
                      ) : (
                        <>
                          <p style={{ color: S.muted, fontSize: 18, fontWeight: 800, margin: '0 0 4px' }}>—</p>
                          <p style={{ color: S.muted, fontSize: 9, margin: 0, opacity: 0.5 }}>highest absolute IC ticker</p>
                        </>
                      )}
                    </div>
                  </Tooltip>
                </div>

                {/* ── Signal Distribution (tabbed: Ranked Trade Opportunities + Raw Feature Snapshot) ── */}
                {ids.length > 0 && (() => {
                  const buys  = ids.filter((s: any) => s.signal === 'BUY').length
                  const sells = ids.filter((s: any) => s.signal === 'SELL').length
                  const holds = ids.length - buys - sells
                  const hasSnapshotData = ids.some((s: any) => s.last_features && Object.keys(s.last_features).length > 0)
                  const activeTab: 'ranked' | 'snapshot' = hourlySnapTab === 'snapshot' && hasSnapshotData ? 'snapshot' : 'ranked'
                  return (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                      <p style={{ color: S.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0, opacity: 0.6 }}>Signal Distribution · Latest Run</p>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => setHourlySnapTab('ranked')}
                          style={{ background: activeTab === 'ranked' ? S.primary : S.cardBg, color: activeTab === 'ranked' ? '#fff' : S.muted, border: `1px solid ${activeTab === 'ranked' ? S.primary : S.border}`, borderRadius: 6, padding: '5px 12px', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>
                          Top Tradeable Signals
                        </button>
                        <button onClick={() => hasSnapshotData && setHourlySnapTab('snapshot')} title={hasSnapshotData ? 'Raw 13-feature LightGBM inputs per ticker' : 'No feature snapshot in this run'}
                          style={{ background: activeTab === 'snapshot' ? S.primary : S.cardBg, color: activeTab === 'snapshot' ? '#fff' : S.muted, border: `1px solid ${activeTab === 'snapshot' ? S.primary : S.border}`, borderRadius: 6, padding: '5px 12px', fontSize: 10, fontWeight: 700, cursor: hasSnapshotData ? 'pointer' : 'not-allowed', opacity: hasSnapshotData ? 1 : 0.4 }}>
                          Feature Snapshot
                        </button>
                      </div>
                    </div>
                    <div style={{ marginBottom: 14, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <button onClick={() => setHourly10Signal('BUY')} title="Show only BUY signals"
                        style={{ background: S.buyBg, border: `2px solid ${hourly10Signal === 'BUY' ? S.buyText : 'transparent'}`, borderRadius: 7, padding: '6px 14px', textAlign: 'center', minWidth: 52, cursor: 'pointer' }}>
                        <p style={{ color: S.buyText, fontSize: 18, fontWeight: 800, margin: 0, lineHeight: 1 }}>{buys}</p>
                        <p style={{ color: S.buyText, fontSize: 8, margin: '3px 0 0', fontWeight: 700, letterSpacing: '0.08em' }}>BUY</p>
                      </button>
                      <button onClick={() => setHourly10Signal('HOLD')} title="Show only HOLD signals"
                        style={{ background: S.holdBg, border: `2px solid ${hourly10Signal === 'HOLD' ? S.holdText : 'transparent'}`, borderRadius: 7, padding: '6px 14px', textAlign: 'center', minWidth: 52, cursor: 'pointer' }}>
                        <p style={{ color: S.holdText, fontSize: 18, fontWeight: 800, margin: 0, lineHeight: 1 }}>{holds}</p>
                        <p style={{ color: S.holdText, fontSize: 8, margin: '3px 0 0', fontWeight: 700, letterSpacing: '0.08em' }}>HOLD</p>
                      </button>
                      <button onClick={() => setHourly10Signal('SELL')} title="Show only SELL signals"
                        style={{ background: S.sellBg, border: `2px solid ${hourly10Signal === 'SELL' ? S.sellText : 'transparent'}`, borderRadius: 7, padding: '6px 14px', textAlign: 'center', minWidth: 52, cursor: 'pointer' }}>
                        <p style={{ color: S.sellText, fontSize: 18, fontWeight: 800, margin: 0, lineHeight: 1 }}>{sells}</p>
                        <p style={{ color: S.sellText, fontSize: 8, margin: '3px 0 0', fontWeight: 700, letterSpacing: '0.08em' }}>SELL</p>
                      </button>
                      <div style={{ flex: 1, minWidth: 140 }}>
                        <p style={{ color: S.muted, fontSize: 9, margin: 0 }} title="The BUY/SELL book is the cross-sectional rank spread (long top decile / short bottom decile) and does NOT require per-name significance. 'High-conviction' counts names whose IC also survives Benjamini-Hochberg FDR correction across the 50-name cross-section — rare on free OHLCV data.">Universe: <span style={{ color: S.text, fontWeight: 600 }}>{ids.length} tickers</span> · LightGBM Walk-Forward · <span style={{ color: S.text, fontWeight: 600 }}>{ids.filter((x: any) => x.high_conviction).length}</span> high-conviction (FDR)</p>
                      </div>
                    </div>
                    {activeTab === 'snapshot' && (() => {
                      const snapBase = ids.filter((s: any) => s.last_features)
                      const snapBySignal = snapBase.filter((s: any) => (s.signal ?? 'HOLD') === hourly10Signal)
                      const snapRows = (hourly10Ticker === 'ALL' ? snapBySignal : snapBySignal.filter((s: any) => s.ticker === hourly10Ticker))
                        .slice().sort((a: any, b: any) => Math.abs(Number(b.mean_ic ?? 0)) - Math.abs(Number(a.mean_ic ?? 0)))
                      return (
                    <div>
                    <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8 }}>
                      <SearchableTickerSelect value={hourly10Ticker} onChange={setHourly10Ticker}
                        options={snapBySignal.map((s: any) => ({ ticker: s.ticker, name: tickerInfoQuery.data?.find((t: any) => t.ticker === s.ticker)?.name }))}
                        S={S} allLabel="All Tickers" />
                    </div>
                    {snapRows.length === 0 ? (
                      <div style={{ background: S.cardBg, border: `1px dashed ${S.border}`, borderRadius: 8, padding: '16px 14px', textAlign: 'center', color: S.muted, fontSize: 11 }}>
                        No {hourly10Signal.toLowerCase()} signals{hourly10Ticker !== 'ALL' ? ` for ${hourly10Ticker}` : ''} in the latest run.
                      </div>
                    ) : (
                    <div style={{ overflowX: 'auto', background: S.cardBg, borderRadius: 8, border: `1px solid ${S.border}` }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                        <thead>
                          <tr>
                            {([
                              { h: 'Ticker',   tip: '' },
                              { h: 'Signal',   tip: '' },
                              { h: 'OFI z',    tip: FEATURE_EXPLANATIONS.ofi_zscore?.label + ' — ' + FEATURE_EXPLANATIONS.ofi_zscore?.formula },
                              { h: 'VWAP z',   tip: FEATURE_EXPLANATIONS.vwap_zscore?.label + ' — ' + FEATURE_EXPLANATIONS.vwap_zscore?.formula },
                              { h: 'Hawkes z', tip: FEATURE_EXPLANATIONS.hawkes_zscore?.label + ' — ' + FEATURE_EXPLANATIONS.hawkes_zscore?.formula },
                              { h: 'VPIN z',   tip: FEATURE_EXPLANATIONS.vpin_zscore?.label + ' — ' + FEATURE_EXPLANATIONS.vpin_zscore?.formula },
                              { h: 'Volume z', tip: FEATURE_EXPLANATIONS.volume_zscore?.label + ' — ' + FEATURE_EXPLANATIONS.volume_zscore?.formula },
                              { h: 'Amihud',   tip: FEATURE_EXPLANATIONS.amihud?.label + ' — ' + FEATURE_EXPLANATIONS.amihud?.formula },
                              { h: 'Kyle λ',   tip: FEATURE_EXPLANATIONS.kyle_lambda?.label + ' — ' + FEATURE_EXPLANATIONS.kyle_lambda?.formula },
                              { h: 'Vol Ratio',tip: FEATURE_EXPLANATIONS.vol_ratio?.label + ' — ' + FEATURE_EXPLANATIONS.vol_ratio?.formula },
                              { h: 'Ret 1h',   tip: FEATURE_EXPLANATIONS.ret_1h?.label },
                              { h: 'Ret 3h',   tip: FEATURE_EXPLANATIONS.ret_3h?.label },
                              { h: 'Ret 6h',   tip: FEATURE_EXPLANATIONS.ret_6h?.label },
                            ] as Array<{h:string;tip:string}>).map(({ h, tip }) => {
                              const cell = (
                                <th key={h}
                                  style={{ padding: '6px 8px', color: tip ? S.primary : S.muted, fontWeight: 600, textAlign: h === 'Ticker' ? 'left' : 'right', borderBottom: `1px solid ${S.border}`, fontSize: 9, letterSpacing: '0.04em', cursor: tip ? 'help' : 'default', whiteSpace: 'nowrap' }}>
                                  {h}{tip ? <span style={{ opacity: 0.45, fontSize: 8 }}>ⓘ</span> : ''}
                                </th>
                              )
                              return tip ? <Tooltip key={h} content={tip}>{cell}</Tooltip> : cell
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {snapRows.map((s: any, rowIdx: number) => {
                            const f = s.last_features
                            const fmtZ = (v: number | null | undefined) => {
                              if (v == null) return <span style={{ color: S.muted, opacity: 0.4 }}>—</span>
                              return <span style={{ color: Math.abs(v) >= 1.5 ? (v > 0 ? S.positiveVal : S.negativeVal) : Math.abs(v) >= 0.5 ? S.warnVal : S.muted, fontFamily: 'monospace', fontWeight: Math.abs(v) >= 1.5 ? 700 : 400 }}>{v >= 0 ? '+' : ''}{v.toFixed(2)}</span>
                            }
                            const fmtRet = (v: number | null | undefined) => {
                              if (v == null) return <span style={{ color: S.muted, opacity: 0.4 }}>—</span>
                              return <span style={{ color: v >= 0 ? S.positiveVal : S.negativeVal, fontFamily: 'monospace' }}>{v >= 0 ? '+' : ''}{(v * 100).toFixed(2)}%</span>
                            }
                            const fmtSml = (v: number | null | undefined, dec = 4) => {
                              if (v == null) return <span style={{ color: S.muted, opacity: 0.4 }}>—</span>
                              return <span style={{ color: S.muted, fontFamily: 'monospace' }}>{v.toFixed(dec)}</span>
                            }
                            return (
                              <tr key={s.ticker} style={{ borderBottom: rowIdx < snapRows.length - 1 ? `1px solid ${S.border}` : undefined, transition: 'background 0.1s' }}
                                onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.background = S.surface }}
                                onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = 'transparent' }}>
                                <td title={dynTickerNames[s.ticker]?.[0] ?? s.ticker} style={{ color: S.primary, fontWeight: 700, padding: '5px 8px', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{s.ticker}</td>
                                <td style={{ textAlign: 'right', padding: '5px 8px' }}><SignalBadge sig={s.signal} /></td>
                                <td style={{ textAlign: 'right', padding: '5px 8px' }}>{fmtZ(f.ofi_zscore)}</td>
                                <td style={{ textAlign: 'right', padding: '5px 8px' }}>{fmtZ(f.vwap_zscore)}</td>
                                <td style={{ textAlign: 'right', padding: '5px 8px' }}>{fmtZ(f.hawkes_zscore)}</td>
                                <td style={{ textAlign: 'right', padding: '5px 8px' }}>{fmtZ(f.vpin_zscore)}</td>
                                <td style={{ textAlign: 'right', padding: '5px 8px' }}>{fmtZ(f.volume_zscore)}</td>
                                <td style={{ textAlign: 'right', padding: '5px 8px' }}>{fmtSml(f.amihud, 3)}</td>
                                <td style={{ textAlign: 'right', padding: '5px 8px' }}>{fmtSml(f.kyle_lambda, 4)}</td>
                                <td style={{ textAlign: 'right', padding: '5px 8px', color: S.text, fontFamily: 'monospace' }}>{f.vol_ratio != null ? f.vol_ratio.toFixed(2) : <span style={{ color: S.muted, opacity: 0.4 }}>—</span>}</td>
                                <td style={{ textAlign: 'right', padding: '5px 8px' }}>{fmtRet(f.ret_1h)}</td>
                                <td style={{ textAlign: 'right', padding: '5px 8px' }}>{fmtRet(f.ret_3h)}</td>
                                <td style={{ textAlign: 'right', padding: '5px 8px' }}>{fmtRet(f.ret_6h)}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                      <p style={{ color: S.muted, fontSize: 8, padding: '3px 10px 5px', opacity: 0.45 }}>13-feature LightGBM walk-forward · hover column header (ⓘ) for formula · |z|≥1.5σ highlighted · 50-stock S&amp;P 500 universe</p>
                    </div>
                    )}
                    </div>
                      )
                    })()}
                    {activeTab === 'ranked' && (() => {
                      const bySignal = ids.filter((s: any) => (s.signal ?? 'HOLD') === hourly10Signal)
                      const byTicker = hourly10Ticker === 'ALL' ? bySignal : bySignal.filter((s: any) => s.ticker === hourly10Ticker)
                      const ranked = [...byTicker]
                        .map((s: any) => {
                          const spread = allSigEntries.find((a: any) => a.ticker === s.ticker)?.eff_spread_bps ?? 52
                          const ic = Math.abs(s.mean_ic ?? 0)
                          const netEdge = ic * 100 - spread * 0.01
                          const score = ic * 100 + Math.abs(s.sharpe ?? 0) * 0.5 + ((s.hit_rate ?? 0.5) - 0.5) * 20
                          return { ...s, spread, netEdge, score }
                        })
                        .sort((a: any, b: any) => b.score - a.score)
                        .slice(0, 10)
                      return (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                            <p style={{ color: S.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0, opacity: 0.6 }}>
                              TOP {ranked.length} {hourly10Signal} SIGNALS — RANKED BY SIGNAL QUALITY
                            </p>
                            <SearchableTickerSelect
                              value={hourly10Ticker}
                              onChange={setHourly10Ticker}
                              options={bySignal.map((s: any) => ({ ticker: s.ticker, name: tickerInfoQuery.data?.find((t: any) => t.ticker === s.ticker)?.name }))}
                              S={S}
                              allLabel="All Tickers"
                            />
                          </div>
                          {ranked.length === 0 ? (
                              <div style={{ background: S.cardBg, border: `1px dashed ${S.border}`, borderRadius: 8, padding: '16px 14px', textAlign: 'center', color: S.muted, fontSize: 11 }}>
                                No {hourly10Signal.toLowerCase()} signals{hourly10Ticker !== 'ALL' ? ` for ${hourly10Ticker}` : ''} in the latest run.
                              </div>
                            ) : (
                            <div style={{ overflowX: 'auto', background: S.cardBg, borderRadius: 8, border: `1px solid ${S.border}` }}>
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                                <thead>
                                  <tr style={{ borderBottom: `2px solid ${S.border}` }}>
                                    {(['#', 'TICKER', 'SIDE', 'IC', 'IC_IR', 'SHARPE', 'HIT RATE', 'TC (bps)', 'NET EDGE', 'KEY DRIVER'] as string[]).map((h, hi) => {
                                      const tip = h === 'SHARPE' ? TIP_SHARPE : (h === 'IC' || h === 'HIT RATE') ? TIP_SEM : null
                                      const cell = (
                                        <th key={h} style={{ padding: '6px 10px', color: S.muted, fontWeight: 700, textAlign: hi <= 1 ? 'left' : 'right', fontSize: 9, letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
                                          {h}{tip && <span style={{ opacity: 0.4 }}> ⓘ</span>}
                                        </th>
                                      )
                                      return tip ? <Tooltip key={h} content={tip}>{cell}</Tooltip> : cell
                                    })}
                                  </tr>
                                </thead>
                                <tbody>
                                  {ranked.map((s: any, ri: number) => {
                                    const ic = s.mean_ic != null ? Number(s.mean_ic) : null
                                    const isHold = s.signal === 'HOLD'
                                    const isLong = s.signal === 'BUY'
                                    const sideColor = isHold ? S.warnVal : isLong ? S.positiveVal : S.negativeVal
                                    const sideBg = isHold ? `${S.warnVal}18` : isLong ? `${S.positiveVal}18` : `${S.negativeVal}18`
                                    const icColor = ic != null ? (Math.abs(ic) >= 0.05 ? S.positiveVal : Math.abs(ic) >= 0.02 ? S.warnVal : S.negativeVal) : S.muted
                                    return (
                                      <tr key={s.ticker} style={{ borderBottom: ri < ranked.length - 1 ? `1px solid ${S.border}44` : undefined }}
                                        onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.background = S.surface }}
                                        onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = 'transparent' }}>
                                        <td style={{ padding: '5px 10px', color: S.muted, fontSize: 9, fontFamily: 'monospace', fontWeight: 700 }}>{ri + 1}</td>
                                        <td title={dynTickerNames[s.ticker]?.[0] ?? s.ticker} style={{ padding: '5px 10px', color: S.primary, fontWeight: 800, letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{s.ticker}</td>
                                        <td style={{ padding: '5px 10px', textAlign: 'right' }}>
                                          <span style={{ background: sideBg, color: sideColor, border: `1px solid ${sideColor}44`, borderRadius: 4, padding: '2px 7px', fontSize: 9, fontWeight: 800 }}>{isHold ? '● HOLD' : isLong ? '▲ LONG' : '▼ SHORT'}</span>
                                        </td>
                                        <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: icColor }}>
                                          {ic != null ? `${(ic * 100).toFixed(2)}%` : '—'}
                                          {ic != null && s.ic_sem != null && s.ic_sem > 0 && <div style={{ fontSize: 8, fontWeight: 400, opacity: 0.55, color: S.muted }}>±{(s.ic_sem * 100).toFixed(2)}%</div>}
                                        </td>
                                        <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'monospace', color: (s.ic_ir ?? 0) >= 1 ? S.positiveVal : (s.ic_ir ?? 0) >= 0.5 ? S.warnVal : S.negativeVal }}>{s.ic_ir != null ? s.ic_ir.toFixed(2) : '—'}</td>
                                        <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: (s.sharpe ?? 0) >= 1 ? S.positiveVal : (s.sharpe ?? 0) >= 0 ? S.warnVal : S.negativeVal }}>
                                          {s.sharpe != null ? `${s.sharpe >= 0 ? '+' : ''}${s.sharpe.toFixed(2)}` : '—'}
                                          {s.sharpe != null && s.sharpe_sem != null && s.sharpe_sem > 0 && <div style={{ fontSize: 8, fontWeight: 400, opacity: 0.55, color: S.muted }}>±{s.sharpe_sem.toFixed(2)}</div>}
                                        </td>
                                        <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'monospace', color: (s.hit_rate ?? 0) >= 0.55 ? S.positiveVal : S.warnVal }}>
                                          {s.hit_rate != null ? `${(s.hit_rate * 100).toFixed(0)}%` : '—'}
                                          {s.hit_rate != null && s.hit_rate_sem != null && s.hit_rate_sem > 0 && <div style={{ fontSize: 8, fontWeight: 400, opacity: 0.55, color: S.muted }}>±{(s.hit_rate_sem * 100).toFixed(1)}%</div>}
                                        </td>
                                        <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'monospace', color: S.warnVal }}>{s.spread.toFixed(0)}</td>
                                        <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, color: s.netEdge > 0 ? S.positiveVal : S.negativeVal }}>{s.netEdge > 0 ? '+' : ''}{s.netEdge.toFixed(2)}%</td>
                                        <td style={{ padding: '5px 10px', textAlign: 'right', color: S.primary, fontSize: 9, fontFamily: 'monospace', opacity: 0.85 }}>{s.shap_top ?? '—'}</td>
                                      </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                              <p style={{ color: S.muted, fontSize: 8, padding: '4px 10px 6px', opacity: 0.45, lineHeight: 1.5 }}>
                                Score = |IC|×100 + |Sharpe|×0.5 + (Hit Rate−50%)×20 · Net Edge = IC% − TC drag · IC &gt; 5% = statistically significant edge · ± values are Standard Error of the Mean (walk-forward fold sampling)
                              </p>
                            </div>
                            )}
                          </div>
                        )
                      })()}
                    </div>
                  )
                })()}
              </>
              ) : metricsForCards ? (
                /* ── Liquidity Metric Cards (daily mode) ── */
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                  {Object.entries(METRIC_META).map(([key, meta]) => {
                    const raw = metricsForCards[key]
                    const baseVal = typeof raw === 'object' ? raw?.value : raw
                    const val: number | null = baseVal != null ? Number(baseVal) : null
                    // OFI Z-score: show with + sign and σ unit
                    const isOFI = key === 'avg_ofi_zscore'
                    const ofiColor = isOFI && val != null ? (Math.abs(val) > 1.5 ? (val > 0 ? S.positiveVal : S.negativeVal) : S.primary) : S.primary
                    const formatted = val != null
                      ? isOFI
                        ? `${val >= 0 ? '+' : ''}${val.toFixed(3)}σ`
                        : fmtSmall(val)
                      : '—'
                    return (
                      <Tooltip key={key} content={
                        <div>
                          <p style={{ color: '#38BDF8', fontSize: 11, fontWeight: 700, margin: '0 0 5px' }}>{meta.label}</p>
                          <p style={{ color: '#7DD3FC', fontSize: 10, fontFamily: 'monospace', margin: '0 0 6px', background: '#050D20', padding: '3px 7px', borderRadius: 4 }}>{meta.formula}</p>
                          <p style={{ color: '#CBD5E1', fontSize: 11, margin: '0 0 5px', lineHeight: 1.5 }}>{meta.help}</p>
                          <p style={{ color: '#64748B', fontSize: 9, margin: '5px 0 0' }}>{meta.ref}</p>
                        </div>
                      }>
                        <div
                          onClick={() => setClickedMetricKey(key)}
                          style={{ background: S.bg, border: `1px solid ${S.border}`, borderRadius: 8, padding: '12px 14px', cursor: 'pointer', transition: 'transform 0.15s ease, box-shadow 0.15s ease' }}
                          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLDivElement).style.boxShadow = '0 6px 20px rgba(0,0,0,0.18)' }}
                          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = 'none'; (e.currentTarget as HTMLDivElement).style.boxShadow = 'none' }}>
                          <p style={{ color: S.muted, fontSize: 10, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{meta.label} <span style={{ opacity: 0.4 }}>ⓘ</span></p>
                          <p style={{ color: ofiColor, fontSize: 18, fontWeight: 800, margin: '0 0 4px', fontVariantNumeric: 'tabular-nums' }}>{formatted}</p>
                          {(key === 'avg_kyle_lambda') && (
                            <span style={{ background: S.warn, color: S.warnText, fontSize: 8, borderRadius: 3, padding: '1px 5px', display: 'inline-block', marginBottom: 3 }}>daily proxy</span>
                          )}
                          {(key === 'avg_effective_spread_bps') && (
                            <span style={{ background: S.warn, color: S.warnText, fontSize: 8, borderRadius: 3, padding: '1px 5px', display: 'inline-block', marginBottom: 3 }}>daily est.</span>
                          )}
                          <p style={{ color: S.muted, fontSize: 9, margin: '0 0 3px', opacity: 0.5 }}>{meta.unit}</p>
                          <p style={{ color: S.primary, fontSize: 8, margin: 0, opacity: 0.55 }}>Click for explanation ›</p>
                        </div>
                      </Tooltip>
                    )
                  })}
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                  {Object.entries(METRIC_META).map(([k, m]) => (
                    <div key={k} style={{ background: S.bg, border: `1px solid ${S.border}`, borderRadius: 8, padding: '12px 14px', opacity: 0.35 }}>
                      <p style={{ color: S.muted, fontSize: 10, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{m.label}</p>
                      <p style={{ color: S.border, fontSize: 18, fontWeight: 800, margin: '0 0 4px' }}>—</p>
                      <p style={{ color: S.border, fontSize: 9, margin: 0 }}>Run pipeline first</p>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Combined Panel: Signal Distribution + Portfolio Backtest (daily mode only) ── */}
              {resolution === 'daily' && allSigEntries.length > 0 && (() => {
                const buys  = allSigEntries.filter((s: any) => s.signal === 'BUY').length
                const sells = allSigEntries.filter((s: any) => s.signal === 'SELL').length
                const holds = allSigEntries.length - buys - sells
                const sortedOFI = [...allSigEntries].sort((a: any, b: any) => b.ofi - a.ofi)
                const topTicker    = sortedOFI[0]
                const bottomTicker = sortedOFI[sortedOFI.length - 1]
                const latestRun    = history.data?.[0]
                const portSharpe   = latestRun?.sharpe ?? null
                const portMDD      = latestRun?.max_drawdown ?? null
                const portSortino  = latestRun?.sortino ?? null
                return (
                  <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${S.border}` }}>
                    {/* ── Signal Distribution Row — click a pill to filter the table below ── */}
                    <p style={{ color: S.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 10px', opacity: 0.6, display: 'flex', alignItems: 'center', gap: 5 }}>
                      Signal Distribution · Latest Run · Click to Filter
                      <Tooltip content={<div><p style={{ color: '#38BDF8', fontSize: 11, fontWeight: 700, margin: '0 0 4px' }}>Rank-Then-Gate Cross-Sectional Split</p><p style={{ color: '#CBD5E1', fontSize: 11, margin: 0, lineHeight: 1.6 }}>Top 20% of tickers by OFI Z-score are BUY candidates, bottom 20% are SELL candidates (AQR / Two Sigma convention — Grinold &amp; Kahn 2000, Ch.6) — but a candidate is only confirmed if its own Z-score is genuinely sign-consistent AND its Spearman IC (OFI vs. 1-bar fwd return) agrees in sign, else it falls back to HOLD. Same sign-consistency gate the Hourly view uses. Counts vary run to run based on real order-flow dispersion — not a fixed 10/10/30 split.</p></div>}>
                        <span style={{ opacity: 0.55, fontSize: 9, cursor: 'help', textTransform: 'none', letterSpacing: 'normal', fontWeight: 700 }}>ⓘ</span>
                      </Tooltip>
                    </p>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
                      <button onClick={() => setDaily10Signal('BUY')} title="Show only BUY signals"
                        style={{ background: S.buyBg, border: `2px solid ${daily10Signal === 'BUY' ? S.buyText : 'transparent'}`, borderRadius: 7, padding: '6px 14px', textAlign: 'center', minWidth: 52, cursor: 'pointer' }}>
                        <p style={{ color: S.buyText, fontSize: 18, fontWeight: 800, margin: 0, lineHeight: 1 }}>{buys}</p>
                        <p style={{ color: S.buyText, fontSize: 8, margin: '3px 0 0', fontWeight: 700, letterSpacing: '0.08em' }}>BUY</p>
                      </button>
                      <button onClick={() => setDaily10Signal('HOLD')} title="Show only HOLD signals"
                        style={{ background: S.holdBg, border: `2px solid ${daily10Signal === 'HOLD' ? S.holdText : 'transparent'}`, borderRadius: 7, padding: '6px 14px', textAlign: 'center', minWidth: 52, cursor: 'pointer' }}>
                        <p style={{ color: S.holdText, fontSize: 18, fontWeight: 800, margin: 0, lineHeight: 1 }}>{holds}</p>
                        <p style={{ color: S.holdText, fontSize: 8, margin: '3px 0 0', fontWeight: 700, letterSpacing: '0.08em' }}>HOLD</p>
                      </button>
                      <button onClick={() => setDaily10Signal('SELL')} title="Show only SELL signals"
                        style={{ background: S.sellBg, border: `2px solid ${daily10Signal === 'SELL' ? S.sellText : 'transparent'}`, borderRadius: 7, padding: '6px 14px', textAlign: 'center', minWidth: 52, cursor: 'pointer' }}>
                        <p style={{ color: S.sellText, fontSize: 18, fontWeight: 800, margin: 0, lineHeight: 1 }}>{sells}</p>
                        <p style={{ color: S.sellText, fontSize: 8, margin: '3px 0 0', fontWeight: 700, letterSpacing: '0.08em' }}>SELL</p>
                      </button>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 4 }}>
                        {topTicker && <p style={{ color: S.muted, fontSize: 9, margin: 0 }}>▲ <span style={{ color: S.positiveVal, fontWeight: 700 }}>{topTicker.ticker}</span> OFI {Number(topTicker.ofi).toFixed(3)}</p>}
                        {bottomTicker && <p style={{ color: S.muted, fontSize: 9, margin: 0 }}>▼ <span style={{ color: S.negativeVal, fontWeight: 700 }}>{bottomTicker.ticker}</span> OFI {Number(bottomTicker.ofi).toFixed(3)}</p>}
                        <p style={{ color: S.muted, fontSize: 9, margin: 0 }}>Universe: <span style={{ color: S.text, fontWeight: 600 }}>{allSigEntries.length} tickers</span> · LightGBM + Groq LLM</p>
                      </div>
                    </div>

                    {/* ── Top 10 Tradeable Signals (Daily) — filterable by BUY/HOLD/SELL + single ticker ── */}
                    {(() => {
                      const bySignal = daily10Signal === 'ALL'
                        ? allSigEntries.filter((s: any) => s.signal === 'BUY' || s.signal === 'SELL')
                        : allSigEntries.filter((s: any) => s.signal === daily10Signal)
                      const byTicker = daily10Ticker === 'ALL' ? bySignal : bySignal.filter((s: any) => s.ticker === daily10Ticker)
                      const top10 = [...byTicker]
                        .sort((a: any, b: any) => Math.abs(Number(b.ofi)) - Math.abs(Number(a.ofi)))
                        .slice(0, 10)
                      const catLabel = daily10Signal === 'ALL' ? 'TRADEABLE' : daily10Signal
                      const countLabel = top10.length > 0 && top10.length < byTicker.length ? `TOP ${top10.length}` : `ALL ${top10.length}`
                      return (
                        <div style={{ marginBottom: 16 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                            <p style={{ color: S.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0, opacity: 0.6 }}>
                              {countLabel} {catLabel} · RANKED BY OFI MAGNITUDE
                            </p>
                            <SearchableTickerSelect
                              value={daily10Ticker}
                              onChange={setDaily10Ticker}
                              options={bySignal.map((s: any) => ({ ticker: s.ticker, name: tickerInfoQuery.data?.find((t: any) => t.ticker === s.ticker)?.name }))}
                              S={S}
                              allLabel="All Tickers"
                            />
                          </div>
                          {top10.length === 0 ? (
                            <div style={{ background: S.cardBg, border: `1px dashed ${S.border}`, borderRadius: 8, padding: '16px 14px', textAlign: 'center', color: S.muted, fontSize: 11 }}>
                              No {catLabel.toLowerCase()} signals{daily10Ticker !== 'ALL' ? ` for ${daily10Ticker}` : ''} in the latest run.
                            </div>
                          ) : (
                          <div style={{ overflowX: 'auto', background: S.cardBg, borderRadius: 8, border: `1px solid ${S.border}` }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                              <thead>
                                <tr style={{ borderBottom: `2px solid ${S.border}` }}>
                                  {(['#', 'TICKER', 'SIDE', 'OFI Z', 'KYLE λ', 'ILLIQ', 'SPREAD (bps)', 'IC', 'SIGNAL STRENGTH', 'NET EDGE'] as string[]).map((h, hi) => {
                                    const tip = h === 'OFI Z' ? TIP_OFI : h === 'KYLE λ' ? TIP_KYLE : h === 'ILLIQ' ? TIP_AMIHUD : h === 'SPREAD (bps)' ? TIP_SPREAD : null
                                    const cell = (
                                      <th key={h} style={{ padding: '6px 10px', color: S.muted, fontWeight: 700, textAlign: hi <= 1 ? 'left' : 'right', fontSize: 9, letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
                                        {h}{tip && <span style={{ opacity: 0.4 }}> ⓘ</span>}
                                      </th>
                                    )
                                    return tip ? <Tooltip key={h} content={tip}>{cell}</Tooltip> : cell
                                  })}
                                </tr>
                              </thead>
                              <tbody>
                                {top10.map((s: any, ri: number) => {
                                  const isLong = s.signal === 'BUY'
                                  const isHold = s.signal === 'HOLD'
                                  const sideColor = isHold ? S.warnVal : isLong ? S.positiveVal : S.negativeVal
                                  const sideBg = isHold ? `${S.warnVal}18` : isLong ? `${S.positiveVal}18` : `${S.negativeVal}18`
                                  const ofi = s.ofi != null ? Number(s.ofi) : null
                                  const ic = s.ic_value != null ? Number(s.ic_value) : null
                                  const spread = s.eff_spread_bps != null ? Number(s.eff_spread_bps) : null
                                  const netEdge = ic != null && spread != null ? ic * 100 - spread * 0.01 : null
                                  const kyle = s.kyle_lambda != null ? Number(s.kyle_lambda) : null
                                  const illiq = s.amihud_illiq != null ? Number(s.amihud_illiq) : null
                                  const strength = ic != null ? (Math.abs(ic) >= 0.05 ? 'STRONG' : Math.abs(ic) >= 0.02 ? 'MODERATE' : 'WEAK') : '—'
                                  const strengthColor = ic != null ? (Math.abs(ic) >= 0.05 ? S.positiveVal : Math.abs(ic) >= 0.02 ? S.warnVal : S.negativeVal) : S.muted
                                  return (
                                    <tr key={s.ticker} style={{ borderBottom: ri < top10.length - 1 ? `1px solid ${S.border}44` : undefined }}
                                      onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.background = S.surface }}
                                      onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = 'transparent' }}>
                                      <td style={{ padding: '5px 10px', color: S.muted, fontSize: 9, fontFamily: 'monospace', fontWeight: 700 }}>{ri + 1}</td>
                                      <td title={dynTickerNames[s.ticker]?.[0] ?? s.ticker} style={{ padding: '5px 10px', color: S.primary, fontWeight: 800, letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{s.ticker}</td>
                                      <td style={{ padding: '5px 10px', textAlign: 'right' }}>
                                        <span style={{ background: sideBg, color: sideColor, border: `1px solid ${sideColor}44`, borderRadius: 4, padding: '2px 7px', fontSize: 9, fontWeight: 800 }}>{isHold ? '● HOLD' : isLong ? '▲ LONG' : '▼ SHORT'}</span>
                                      </td>
                                      <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: ofi != null ? (Math.abs(ofi) > 1.5 ? sideColor : S.primary) : S.muted }}>{ofi != null ? `${ofi >= 0 ? '+' : ''}${ofi.toFixed(3)}σ` : '—'}</td>
                                      <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'monospace', color: S.muted, fontSize: 9 }}>{kyle != null ? fmtSmall(kyle) : '—'}</td>
                                      <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'monospace', color: S.muted, fontSize: 9 }}>{illiq != null ? fmtSmall(illiq) : '—'}</td>
                                      <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'monospace', color: spread != null ? (spread > 100 ? S.negativeVal : spread > 60 ? S.warnVal : S.positiveVal) : S.muted }}>{spread != null ? spread.toFixed(0) : '—'}</td>
                                      <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'monospace', color: ic != null ? (Math.abs(ic) >= 0.05 ? S.positiveVal : S.warnVal) : S.muted }}>{ic != null ? `${(ic * 100).toFixed(2)}%` : '—'}</td>
                                      <td style={{ padding: '5px 10px', textAlign: 'right' }}>
                                        <span style={{ color: strengthColor, fontWeight: 700, fontSize: 9 }}>{strength}</span>
                                      </td>
                                      <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, color: netEdge != null ? (netEdge > 0 ? S.positiveVal : S.negativeVal) : S.muted }}>{netEdge != null ? `${netEdge > 0 ? '+' : ''}${netEdge.toFixed(2)}%` : '—'}</td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                            <p style={{ color: S.muted, fontSize: 8, padding: '4px 10px 6px', opacity: 0.45 }}>
                              Net Edge = IC% − TC drag (½ spread) · OFI = Order Flow Imbalance z-score · Ranked by |OFI| · {daily10Signal === 'ALL' ? 'BUY + SELL' : daily10Signal} only
                            </p>
                          </div>
                          )}
                        </div>
                      )
                    })()}

                    {/* ── Portfolio Backtest Strip ── */}
                    {portSharpe != null && Math.abs(portSharpe) > 0.01 ? (
                      <>
                        <p style={{ color: S.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 8px', opacity: 0.6 }}>
                          Long-Short Backtest (OFI Strategy) · Top-2 OFI Long / Bottom-2 Short · Walk-forward
                        </p>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
                          <Tooltip content={<div><p style={{ color: '#38BDF8', fontSize: 11, fontWeight: 700, margin: '0 0 4px' }}>Sharpe Ratio (gross, pre-TC)</p><p style={{ color: '#7DD3FC', fontSize: 10, fontFamily: 'monospace', margin: '0 0 5px' }}>Sharpe = √252 × μ / σ (annualised)</p><p style={{ color: '#CBD5E1', fontSize: 11, margin: 0 }}>Risk-adjusted return (gross). Currently <strong style={{color: portSharpe >= 0 ? '#86EFAC' : '#FCA5A5'}}>{portSharpe >= 0 ? '+' : ''}{portSharpe.toFixed(3)}</strong>. Sharpe &gt; 1 = strong signal; &gt; 2 = excellent. Values near zero are expected at daily resolution — OFI signal half-life is ~30 min.</p></div>}>
                            <div style={{ background: S.bg, border: `1px solid ${portSharpe >= 0 ? S.border : '#7f1d1d55'}`, borderRadius: 7, padding: '8px 10px', cursor: 'help' }}>
                              <p style={{ color: S.muted, fontSize: 8, margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Sharpe <span style={{ opacity: 0.4 }}>ⓘ</span></p>
                              <p style={{ color: portSharpe >= 0 ? S.positiveVal : S.negativeVal, fontSize: 15, fontWeight: 800, margin: 0, fontVariantNumeric: 'tabular-nums' }}>{portSharpe >= 0 ? '+' : ''}{portSharpe.toFixed(3)}</p>
                              <p style={{ color: S.muted, fontSize: 8, margin: '2px 0 0', opacity: 0.45 }}>annualised</p>
                            </div>
                          </Tooltip>
                          <Tooltip content={<div><p style={{ color: '#38BDF8', fontSize: 11, fontWeight: 700, margin: '0 0 4px' }}>Sortino Ratio</p><p style={{ color: '#7DD3FC', fontSize: 10, fontFamily: 'monospace', margin: '0 0 5px' }}>Sortino = √252 × μ / σ_downside</p><p style={{ color: '#CBD5E1', fontSize: 11, margin: 0 }}>Only penalises DOWNSIDE volatility — upside swings do not count against you. Currently <strong style={{color: (portSortino ?? 0) >= 0 ? '#86EFAC' : '#FCA5A5'}}>{portSortino != null ? `${portSortino >= 0 ? '+' : ''}${portSortino.toFixed(3)}` : 'n/a'}</strong>. Benchmarks: &gt;0 = positive risk-adjusted direction; 0.5–1.0 = developing strategy; 1.0–2.0 = solid; &gt;2.0 = strong asymmetric alpha. Daily IC ≈ 0 explains values near zero — expect improvement in hourly walk-forward.</p></div>}>
                            <div style={{ background: S.bg, border: `1px solid ${(portSortino ?? 0) >= 0 ? S.border : '#7f1d1d55'}`, borderRadius: 7, padding: '8px 10px', cursor: 'help' }}>
                              <p style={{ color: S.muted, fontSize: 8, margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Sortino <span style={{ opacity: 0.4 }}>ⓘ</span></p>
                              <p style={{ color: (portSortino ?? 0) >= 0 ? S.positiveVal : S.negativeVal, fontSize: 15, fontWeight: 800, margin: 0, fontVariantNumeric: 'tabular-nums' }}>{portSortino != null ? `${portSortino >= 0 ? '+' : ''}${portSortino.toFixed(3)}` : '—'}</p>
                              <p style={{ color: S.muted, fontSize: 8, margin: '2px 0 0', opacity: 0.45 }}>downside-adj</p>
                            </div>
                          </Tooltip>
                          <Tooltip content={<div><p style={{ color: '#38BDF8', fontSize: 11, fontWeight: 700, margin: '0 0 4px' }}>Max Drawdown</p><p style={{ color: '#7DD3FC', fontSize: 10, fontFamily: 'monospace', margin: '0 0 5px' }}>MDD = min((E_t − peak_t) / peak_t)</p><p style={{ color: '#CBD5E1', fontSize: 11, margin: 0 }}>Worst peak-to-trough loss in the equity curve. Currently <strong style={{color: portMDD != null ? (Math.abs(portMDD) < 0.1 ? '#86EFAC' : Math.abs(portMDD) < 0.25 ? '#FDE68A' : '#FCA5A5') : S.muted}}>{portMDD != null ? `-${(Math.abs(portMDD)*100).toFixed(1)}%` : 'n/a'}</strong>. Benchmarks for systematic strategies: &lt;10% = excellent; 10–25% = acceptable; &gt;25% = needs improvement. At daily IC ≈ 0 the equity curve is essentially a random walk — 18–20% DD is expected and will shrink when hourly IC &gt; 5% provides genuine directional edge.</p></div>}>
                            <div style={{ background: S.bg, border: `1px solid ${portMDD == null ? S.border : Math.abs(portMDD) < 0.1 ? '#16653488' : Math.abs(portMDD) < 0.25 ? '#854d0e55' : '#7f1d1d55'}`, borderRadius: 7, padding: '8px 10px', cursor: 'help' }}>
                              <p style={{ color: S.muted, fontSize: 8, margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Max DD <span style={{ opacity: 0.4 }}>ⓘ</span></p>
                              <p style={{ color: portMDD == null ? S.muted : Math.abs(portMDD) < 0.1 ? S.positiveVal : Math.abs(portMDD) < 0.25 ? S.warnVal : S.negativeVal, fontSize: 15, fontWeight: 800, margin: 0, fontVariantNumeric: 'tabular-nums' }}>{portMDD != null ? `-${(Math.abs(portMDD) * 100).toFixed(1)}%` : '—'}</p>
                              <p style={{ color: S.muted, fontSize: 8, margin: '2px 0 0', opacity: 0.45 }}>peak-to-trough loss</p>
                            </div>
                          </Tooltip>
                        </div>
                        <p style={{ color: S.muted, fontSize: 8, margin: '8px 0 0', opacity: 0.4, lineHeight: 1.5 }}>
                          Daily OFI IC ≈ 0 expected — signal half-life is ~30 min, daily bars cannot resolve intra-bar direction. Switch to Hourly for IC &gt; 5% target.
                        </p>
                      </>
                    ) : (
                      <div style={{ marginTop: 8, padding: '8px 12px', background: '#0C4A6E22', border: '1px solid #0891B244', borderRadius: 7, fontSize: 10, color: S.muted }}>
                        Signal performance requires Hourly resolution — click <strong style={{ color: S.primary }}>Hourly</strong> for LightGBM walk-forward Sharpe &amp; IC
                      </div>
                    )}
                  </div>
                )
              })()}
            </Card>
          </div>

          {/* ── Daily Ticker Cards (collapsible, daily mode only) ── */}
          {resolution === 'daily' && (
            <div style={{ marginBottom: 16 }}>
              {allSigEntries.length === 0 ? (
                <div style={{ background: S.cardBg, border: `1px dashed ${S.border}`, borderRadius: 10, padding: '20px 24px', textAlign: 'center' }}>
                  <p style={{ color: S.text, fontWeight: 600, fontSize: 13, margin: '0 0 6px' }}>No Daily Signals Yet</p>
                  <p style={{ color: S.muted, fontSize: 11, margin: 0 }}>
                    Click <strong style={{ color: S.primary }}>Run Daily Scan</strong> to run the microstructure pipeline across {totalTickerCount} tickers.
                  </p>
                </div>
              ) : (
                <>
                  {/* Toggle header */}
                  <div
                    onClick={() => setTickerCardsExpanded(e => !e)}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: S.cardBg, border: `1px solid ${S.border}`, borderRadius: tickerCardsExpanded ? '10px 10px 0 0' : 10, padding: '10px 16px', cursor: 'pointer', userSelect: 'none', transition: 'background 0.15s', flexWrap: 'wrap', gap: 8 }}>
                    <span style={{ color: S.text, fontWeight: 700, fontSize: 12 }}>
                      Daily Microstructure Signals — {dailyGridShown.length} of {dailyFilteredSigEntries.length} Tickers
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }} onClick={e => e.stopPropagation()}>
                      <TickerMultiFilter
                        allTickers={(tickerInfoQuery.data ?? allSigEntries.map((s: any) => ({ ticker: s.ticker })))}
                        selected={dailyTickerFilter}
                        onChange={setDailyTickerFilter}
                        S={S}
                        iconOnly
                      />
                      <span onClick={() => setTickerCardsExpanded(e => !e)} style={{ color: S.muted, fontSize: 10, cursor: 'pointer' }}>{tickerCardsExpanded ? '▲ Collapse' : '▼ Expand'}</span>
                    </div>
                  </div>
                  {/* Cards grid */}
                  {tickerCardsExpanded && (
                    <div style={{ borderRight: `1px solid ${S.border}`, borderBottom: `1px solid ${S.border}`, borderLeft: `1px solid ${S.border}`, borderRadius: '0 0 10px 10px', padding: 12, background: S.surface }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                        <SignalFilterPills value={dailyGridSignal} onChange={setDailyGridSignal} counts={dailyGridCounts} S={S} hideAll />
                        <span style={{ color: S.muted, fontSize: 9, opacity: 0.6 }}>Ranked by |OFI| magnitude</span>
                      </div>
                      {dailyGridShown.length === 0 ? (
                        <div style={{ color: S.muted, fontSize: 11, fontStyle: 'italic', textAlign: 'center', padding: '16px 0' }}>
                          No {dailyGridSignal === 'ALL' ? '' : dailyGridSignal.toLowerCase() + ' '}tickers match the current filter.
                        </div>
                      ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))', gap: 8, maxHeight: dailyGridShown.length > 12 ? 440 : undefined, overflowY: dailyGridShown.length > 12 ? 'auto' : undefined, paddingRight: dailyGridShown.length > 12 ? 4 : undefined }}>
                        {dailyGridShown.map((s: any) => {
                          const sig: string = s.signal ?? 'HOLD'
                          const sigColor = sig === 'BUY' ? S.positiveVal : sig === 'SELL' ? S.negativeVal : S.warnVal
                          const sigBg = sig === 'BUY' ? `${S.positiveVal}18` : sig === 'SELL' ? `${S.negativeVal}18` : `${S.warnVal}18`
                          const ofi = typeof s.ofi === 'number' ? s.ofi : parseFloat(s.ofi ?? '0') || 0
                          const ofiColor = ofi > 0.02 ? S.positiveVal : ofi < -0.02 ? S.negativeVal : S.muted
                          const companyName = dynTickerNames[s.ticker]?.[0] ?? s.ticker
                          return (
                            <div
                              key={s.ticker}
                              onClick={() => openResearchDrawer(s.ticker)}
                              title={`Open Research Drawer for ${s.ticker}`}
                              style={{ position: 'relative', background: S.cardBg, border: `1.5px solid ${S.border}`, borderLeft: `3px solid ${sigColor}`, borderRadius: 9, padding: '10px 12px', cursor: 'pointer', transition: 'transform 0.15s' }}
                              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)' }}
                              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = 'none' }}
                            >
                              {customTickersList.includes(s.ticker) && (
                                <button
                                  onClick={e => { e.stopPropagation(); handleDeleteTicker(s.ticker) }}
                                  title={`Remove ${s.ticker} from universe`}
                                  style={{ position: 'absolute', top: 4, right: 4, background: 'transparent', border: 'none', color: S.negativeVal, cursor: 'pointer', fontSize: 11, lineHeight: 1, padding: '0 2px' }}
                                >✕</button>
                              )}
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                                <span title={companyName} style={{ color: S.text, fontWeight: 800, fontSize: 13 }}>{s.ticker}</span>
                                <span style={{ background: sigBg, color: sigColor, border: `1px solid ${sigColor}55`, borderRadius: 4, padding: '1px 6px', fontSize: 9, fontWeight: 800, letterSpacing: '0.06em' }}>{sig}</span>
                              </div>
                              <p style={{ color: S.muted, fontSize: 9, margin: '0 0 7px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{companyName}</p>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 6px' }}>
                                <div>
                                  <p style={{ color: S.muted, fontSize: 8, margin: '0 0 1px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>OFI</p>
                                  <p style={{ color: ofiColor, fontSize: 11, fontWeight: 700, margin: 0, fontVariantNumeric: 'tabular-nums' }}>{ofi.toFixed(3)}</p>
                                </div>
                                <div>
                                  <p style={{ color: S.muted, fontSize: 8, margin: '0 0 1px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Spread</p>
                                  <p style={{ color: S.text, fontSize: 11, fontWeight: 700, margin: 0, fontVariantNumeric: 'tabular-nums' }}>{typeof s.eff_spread_bps === 'number' ? s.eff_spread_bps.toFixed(1) : '—'}<span style={{ color: S.muted, fontSize: 8 }}> bps</span></p>
                                </div>
                                <div>
                                  <p style={{ color: S.muted, fontSize: 8, margin: '0 0 1px', letterSpacing: '0.06em' }}>Kyle λ</p>
                                  <p style={{ color: S.text, fontSize: 11, fontWeight: 700, margin: 0, fontVariantNumeric: 'tabular-nums' }}>{typeof s.kyle_lambda === 'number' ? fmtSmall(s.kyle_lambda) : '—'}</p>
                                </div>
                                <div>
                                  <p style={{ color: S.muted, fontSize: 8, margin: '0 0 1px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>ILLIQ</p>
                                  <p style={{ color: S.text, fontSize: 11, fontWeight: 700, margin: 0, fontVariantNumeric: 'tabular-nums' }}>{typeof s.amihud_illiq === 'number' ? fmtSmall(s.amihud_illiq) : '—'}</p>
                                </div>
                              </div>
                              {s.llm_reason && (
                                <p style={{ color: S.muted, fontSize: 8, margin: '6px 0 0', lineHeight: 1.4, fontStyle: 'italic', opacity: 0.7, maxHeight: 28, overflow: 'hidden' }}>
                                  {String(s.llm_reason).slice(0, 80)}{String(s.llm_reason).length > 80 ? '…' : ''}
                                </p>
                              )}
                            </div>
                          )
                        })}
                      </div>
                      )}
                      {dailyGridSorted.length > 10 && (
                        <div style={{ textAlign: 'center', marginTop: 10 }}>
                          <button onClick={() => setDailyGridShowAll(v => !v)}
                            style={{ background: 'transparent', border: `1px solid ${S.border}`, color: S.primary, borderRadius: 6, padding: '4px 14px', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>
                            {dailyGridShowAll ? '▲ Show Top 10 Only' : `▼ Show All ${dailyGridSorted.length}`}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Intraday Panel (full-width, hourly mode only) ── */}
          {resolution === 'hourly' && (
            <>
              {/* Section 1: Full-width intraday signal cards */}
              <Card
                title={
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>Intraday Signal Engine · Signals</span>
                    <InfoIcon term="Walk-Forward" />
                    <span style={{ color: S.muted, fontSize: 9, fontWeight: 400 }}>
                      Hourly · {featureCount} features · <InfoTip term="LGBMRegressor">LGBMRegressor</InfoTip> · Walk-Forward CV
                    </span>
                  </span>
                }
                right={
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {ids.length > 0 && (
                      <TickerMultiFilter
                        allTickers={(tickerInfoQuery.data ?? ids.map((s: any) => ({ ticker: s.ticker })))}
                        selected={hourlyTickerFilter}
                        onChange={setHourlyTickerFilter}
                        S={S}
                        iconOnly
                      />
                    )}
                    <button onClick={() => runIntraday.mutate()} disabled={runIntraday.isPending || intradayRunning}
                      title="Runs the hourly intraday pipeline: fetches hourly bars per ticker, computes microstructure features, then runs walk-forward LGBMRegressor. Takes 30–120 seconds."
                      style={{ background: (runIntraday.isPending || intradayRunning) ? S.border : S.runBtn, color: '#fff', border: 'none',
                        borderRadius: 6, padding: '5px 16px', fontSize: 11, fontWeight: 700,
                        cursor: (runIntraday.isPending || intradayRunning) ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {(runIntraday.isPending || intradayRunning)
                        ? <><div style={{ width: 10, height: 10, borderWidth: 2, borderStyle: 'solid', borderColor: '#fff4', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}></div>{intradayProgress.data ? `${intradayProgress.data.done}/${intradayProgress.data.total}` : 'Running…'}</>
                        : 'Run Signal Engine'}
                    </button>
                  </div>
                }>
                {ids.length > 0 ? (
                  hourlyFilteredIds.length === 0 ? (
                    <div style={{ color: S.muted, fontSize: 12, fontStyle: 'italic', padding: '20px 0', textAlign: 'center' }}>
                      No tickers match the current filter.
                    </div>
                  ) : (
                  <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                    <SignalFilterPills value={hourlyGridSignal} onChange={setHourlyGridSignal} counts={hourlyGridCounts} S={S} hideAll />
                    <span style={{ color: S.muted, fontSize: 9, opacity: 0.6 }}>{hourlyGridShown.length} of {hourlyFilteredIds.length} · Ranked by |IC|</span>
                  </div>
                  {hourlyGridShown.length === 0 ? (
                    <div style={{ color: S.muted, fontSize: 12, fontStyle: 'italic', padding: '20px 0', textAlign: 'center' }}>
                      No {hourlyGridSignal === 'ALL' ? '' : hourlyGridSignal.toLowerCase() + ' '}tickers match the current filter.
                    </div>
                  ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10, maxHeight: hourlyGridShown.length > 12 ? 460 : undefined, overflowY: hourlyGridShown.length > 12 ? 'auto' : undefined, paddingRight: hourlyGridShown.length > 12 ? 4 : undefined }}>
                    {hourlyGridShown.map((s: any) => (
                      <div key={s.ticker}
                        onClick={() => { setSelectedShapTicker(s.ticker); openResearchDrawer(s.ticker) }}
                        title={`Click to open Research Drawer for ${s.ticker}. IC = ${(s.mean_ic*100).toFixed(2)}% · Sharpe = ${s.sharpe.toFixed(2)}`}
                        style={{ background: S.cardBg, border: `2px solid ${selectedShapTicker === s.ticker ? S.primary : S.border}`,
                          borderRadius: 10, padding: '12px 14px', cursor: 'pointer', transition: 'all 0.2s' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLDivElement).style.boxShadow = `0 6px 20px ${S.primary}22` }}
                        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = 'none'; (e.currentTarget as HTMLDivElement).style.boxShadow = 'none' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                          <span title={dynTickerNames[s.ticker]?.[0] ?? s.ticker} style={{ color: getTickerColor(s.ticker, isDark), fontSize: 16, fontWeight: 800, letterSpacing: '-0.01em' }}>{s.ticker}</span>
                          <span style={{
                            background: s.signal === 'BUY' ? S.buyBg : s.signal === 'SELL' ? S.sellBg : S.holdBg,
                            color: s.signal === 'BUY' ? S.buyText : s.signal === 'SELL' ? S.sellText : S.holdText,
                            borderRadius: 4, padding: '2px 8px', fontSize: 10, fontWeight: 700, letterSpacing: '0.05em' }}>{s.signal}</span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '3px 6px', marginBottom: 6 }}>
                          <InfoTip term="IC"><span style={{ color: S.muted, fontSize: 9 }}>IC</span></InfoTip>
                          <span style={{ color: Math.abs(s.mean_ic) > 0.05 ? S.positiveVal : S.warnVal, fontSize: 11, fontWeight: 700, textAlign: 'right' }}>
                            {(s.mean_ic * 100).toFixed(2)}%
                          </span>
                          <InfoTip term="Sharpe"><span style={{ color: S.muted, fontSize: 9 }}>Sharpe</span></InfoTip>
                          <span style={{ color: s.sharpe >= 0 ? S.positiveVal : S.negativeVal, fontSize: 11, fontWeight: 700, textAlign: 'right' }}>
                            {(s.sharpe >= 0 ? '+' : '') + s.sharpe.toFixed(2)}
                          </span>
                          {s.sortino != null && <>
                            <InfoTip term="Sortino"><span style={{ color: S.muted, fontSize: 9 }}>Sortino</span></InfoTip>
                            <span style={{ color: s.sortino >= 0 ? S.positiveVal : S.negativeVal, fontSize: 11, fontWeight: 700, textAlign: 'right' }}>
                              {(s.sortino >= 0 ? '+' : '') + s.sortino.toFixed(2)}
                            </span>
                          </>}
                          {s.max_drawdown != null && <>
                            <InfoTip term="Max DD"><span style={{ color: S.muted, fontSize: 9 }}>Max DD</span></InfoTip>
                            <span style={{ color: Math.abs(s.max_drawdown) < 0.1 ? S.positiveVal : Math.abs(s.max_drawdown) < 0.2 ? S.warnVal : S.negativeVal, fontSize: 11, fontWeight: 700, textAlign: 'right' }}>
                              -{(Math.abs(s.max_drawdown) * 100).toFixed(1)}%
                            </span>
                          </>}
                        </div>
                        {s.data_start && s.data_end && (
                          <p style={{ color: S.muted, fontSize: 8, margin: '4px 0 2px', opacity: 0.5, lineHeight: 1.4 }}>
                            {s.data_start} – {s.data_end}<br />{s.n_bars} bars · {s.n_folds} folds
                          </p>
                        )}
                        <p style={{ color: S.muted, fontSize: 9, margin: '3px 0 0' }}>
                          Top: <InfoTip term="SHAP"><span style={{ color: S.primary, fontFamily: 'monospace', fontSize: 9 }}>{s.shap_top}</span></InfoTip>
                        </p>
                        <p style={{ color: S.muted, fontSize: 8, margin: '4px 0 0', opacity: 0.35, textAlign: 'right' }}>click → research ›</p>
                      </div>
                    ))}
                  </div>
                  )}
                  {hourlyGridSorted.length > 10 && (
                    <div style={{ textAlign: 'center', marginTop: 10 }}>
                      <button onClick={() => setHourlyGridShowAll(v => !v)}
                        style={{ background: 'transparent', border: `1px solid ${S.border}`, color: S.primary, borderRadius: 6, padding: '4px 14px', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>
                        {hourlyGridShowAll ? '▲ Show Top 10 Only' : `▼ Show All ${hourlyGridSorted.length}`}
                      </button>
                    </div>
                  )}
                  </>
                  )
                ) : (
                  <div style={{ color: S.muted, fontSize: 13, fontStyle: 'italic', padding: '28px 0', textAlign: 'center' }}>
                    Click <strong style={{ color: S.primary }}>Run Intraday</strong> to compute IC, Sharpe, and SHAP importances on hourly bars
                  </div>
                )}
              </Card>


              {/* Section 2: Full-width SHAP Feature Importance */}
              <Card title={
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <InfoTip term="SHAP">SHAP Feature Importance</InfoTip>
                    <InfoIcon term="SHAP" />
                  </span>
                }
                right={
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <SignalFilterPills value={shapSignalFilter} onChange={setShapSignalFilter} counts={shapSignalCounts} S={S} hideAll />
                    <SearchableTickerSelect
                      value={selectedShapTicker}
                      onChange={selectTicker}
                      options={shapOptions}
                      allLabel="ALL (avg)"
                      S={S}
                    />
                    <span style={{ color: S.muted, fontSize: 10, opacity: 0.6 }}>or click intraday card ›</span>
                  </div>
                }>
                {shapClickedFeature && (
                  <ShapFeatureModal
                    feature={shapClickedFeature.feature}
                    importance={shapClickedFeature.importance}
                    ticker={selectedShapTicker}
                    onClose={() => setShapClickedFeature(null)}
                  />
                )}
                {shapData.data?.features && shapData.data.features.length > 0 ? (
                  <>
                    <SHAPImportanceChart
                      data={shapData.data.features}
                      ticker={selectedShapTicker}
                      onBarClick={(feature, importance) => setShapClickedFeature({ feature, importance })}
                    />
                    {shapData.data.mean_ic !== undefined && (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 6 }}>
                        <span
                          onClick={() => setClickedMetricKey('IC')}
                          style={{ cursor: 'pointer', color: S.primary, fontSize: 10, textDecoration: 'underline dotted', textUnderlineOffset: 3 }}
                          title="Click to learn what IC means">
                          Mean IC
                        </span>
                        <span style={{ color: Math.abs(shapData.data.mean_ic) > 0.05 ? S.positiveVal : Math.abs(shapData.data.mean_ic) >= 0.02 ? S.warnVal : S.muted, fontWeight: 700, fontSize: 11 }}>
                          {(shapData.data.mean_ic * 100).toFixed(3)}%
                        </span>
                        {Math.abs(shapData.data.mean_ic) >= 0.05
                          ? <span style={{ color: S.positiveVal, fontSize: 9 }}>✓ meaningful signal</span>
                          : Math.abs(shapData.data.mean_ic) >= 0.02
                            ? <span style={{ color: S.warnVal, fontSize: 9 }}>weak signal</span>
                            : <span style={{ color: S.muted, fontSize: 9, opacity: 0.6 }}>noise level</span>}
                        {selectedShapTicker === 'ALL' && <span style={{ color: S.muted, fontSize: 9, opacity: 0.5 }}>(avg)</span>}
                      </div>
                    )}
                  </>
                ) : (
                  <SHAPImportanceChart data={[]} ticker={selectedShapTicker} />
                )}
              </Card>

              {/* Section 3: Intraday Analytical Charts — tabbed for proper chart space */}
              <Card title="Signal Analysis"
                right={
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <SearchableTickerSelect
                      value={selectedShapTicker === 'ALL' ? ids[0]?.ticker ?? 'AAPL' : selectedShapTicker}
                      onChange={selectTicker}
                      options={(tickerInfoQuery.data ?? ALL_TICKERS.map(t => ({ ticker: t })))}
                      S={S}
                    />
                    <span style={{ color: S.muted, fontSize: 9, opacity: 0.45 }}>select ticker</span>
                  </div>
                }>
                {(() => {
                  const ct = selectedShapTicker === 'ALL' ? (ids[0]?.ticker ?? 'AAPL') : selectedShapTicker
                  const ITABS: { key: 'hawkes' | 'vwap' | 'heatmap' | 'scatter' | 'equity' | 'dependence' | 'rolling_ic' | 'vpin'; label: string; sub: string; desc: string }[] = [
                    { key: 'hawkes',     label: 'Hawkes Intensity',   sub: 'order arrival clustering',          desc: 'Self-exciting point process: each trade triggers follow-on orders. Z > 1.5σ = burst regime — vol spike likely. Z < -1σ = quiet, thin book.' },
                    { key: 'vwap',      label: 'VWAP Deviation',     sub: 'price vs volume-weighted avg',      desc: 'Z-scored deviation from VWAP. Z > 1.5σ = price running hot above VWAP (momentum). Z < -1.5σ = below VWAP (mean-reversion pressure).' },
                    { key: 'heatmap',   label: 'Feature Correlation', sub: '13×13 Spearman ρ matrix',          desc: 'Cross-feature rank correlation. |ρ| > 0.6 = signal overlap — model learns same thing twice. Use to detect multicollinearity in the feature set.' },
                    { key: 'scatter',   label: 'LGBM Scatter',        sub: 'predicted vs actual return',        desc: 'Walk-forward scatter: each dot = one test-set bar. Green = correct direction. OLS slope > 0 = directional edge. Dir Acc > 55% = tradeable signal.' },
                    { key: 'equity',    label: 'Equity Curve',        sub: 'cumulative signal PnL',             desc: 'Cumulative OOS returns from signal-weighted long/short strategy. Each fold = 1 month of live simulation. Rising curve = signal monetises.' },
                    { key: 'dependence',label: 'SHAP Dependence',     sub: 'feature value vs model impact',     desc: 'SHAP: x-axis = feature value, y-axis = how much that value pushes model output up or down. Reveals non-linear relationships the model has learnt.' },
                    { key: 'rolling_ic',label: 'IC Stability',        sub: 'IC per fold',                       desc: 'IC per out-of-sample fold. Consistent positive bars = stable signal. IC_IR = mean(IC)/std(IC) — higher is more consistent across regimes.' },
                    { key: 'vpin',      label: 'VPIN Toxicity',       sub: 'informed-trading z-score',          desc: 'Volume-Synchronized Prob. of Informed Trading. Z > 1.5σ = adverse selection risk — informed traders likely active. Z < -1σ = safe to trade.' },
                  ]
                  return (
                    <>
                      {/* ── Tab bar ── */}
                      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap', borderBottom: `1px solid ${S.border}`, paddingBottom: 10 }}>
                        {ITABS.map(t => (
                          <button key={t.key}
                            onClick={() => setIntradayChartTab(t.key)}
                            title={t.desc}
                            style={{
                              background: intradayChartTab === t.key ? `${S.primary}22` : 'transparent',
                              color: intradayChartTab === t.key ? S.primary : S.muted,
                              border: `1px solid ${intradayChartTab === t.key ? S.primary + '77' : S.border}`,
                              borderRadius: 7, padding: '5px 16px', fontSize: 10,
                              fontWeight: intradayChartTab === t.key ? 700 : 400,
                              cursor: 'pointer', transition: 'all 0.15s',
                              display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
                            }}>
                            <span style={{ letterSpacing: '0.01em' }}>{t.label}</span>
                            <span style={{ fontSize: 8, opacity: 0.6 }}>{t.sub}</span>
                          </button>
                        ))}
                        <span style={{ marginLeft: 'auto', alignSelf: 'center', color: S.muted, fontSize: 8, opacity: 0.35 }}>
                          hover tab for description
                        </span>
                      </div>
                      {/* ── Active chart — full width ── */}
                      {intradayChartTab === 'hawkes'     && <HawkesChart ticker={ct} S={S} />}
                      {intradayChartTab === 'vwap'       && <VWAPChart ticker={ct} S={S} />}
                      {intradayChartTab === 'heatmap'    && (
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                            <button onClick={() => setFullscreenChart('feature_correlation')}
                              style={{ background: S.primary, color: '#fff', border: 'none', borderRadius: 6, padding: '3px 10px', fontSize: 9, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span style={{ fontSize: 11 }}>⊕</span> Expand
                            </button>
                          </div>
                          <FeatureCorrelationHeatmap ticker={ct} S={S} />
                        </div>
                      )}
                      {intradayChartTab === 'scatter'    && (
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                            <button onClick={() => setFullscreenChart('lgbm_scatter')}
                              style={{ background: S.primary, color: '#fff', border: 'none', borderRadius: 6, padding: '3px 10px', fontSize: 9, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span style={{ fontSize: 11 }}>⊕</span> Expand
                            </button>
                          </div>
                          <LGBMScatterChart ticker={ct} S={S} />
                        </div>
                      )}
                      {intradayChartTab === 'dependence' && (
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                            <button onClick={() => setFullscreenChart('shap_dependence')}
                              style={{ background: S.primary, color: '#fff', border: 'none', borderRadius: 6, padding: '3px 10px', fontSize: 9, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span style={{ fontSize: 11 }}>⊕</span> Expand
                            </button>
                          </div>
                          <SHAPDependencePlot ticker={ct} S={S} />
                        </div>
                      )}
                      {intradayChartTab === 'equity'     && <WalkForwardEquityCurve ticker={ct} S={S} />}
                      {intradayChartTab === 'rolling_ic' && <RollingICChart ticker={ct} S={S} />}
                      {intradayChartTab === 'vpin'       && <VPINChart ticker={ct} S={S} />}
                    </>
                  )
                })()}
              </Card>

              {/* ── Section 4: Paper Portfolio ─────────────────────────── */}
              <Card
                title={
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>Paper Portfolio</span>
                    <span style={{ color: S.primary, fontSize: 9, fontWeight: 500, background: '#0891B222', borderRadius: 4, padding: '1px 6px' }}>Alpaca · free · no real capital</span>
                  </span>
                }
                right={
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {portfolioAccount.data?.connected && (
                      <>
                        <span title="Change in account equity since the previous session close (Alpaca)"
                          style={{ color: (portfolioAccount.data.today_pl ?? 0) >= 0 ? S.positiveVal : S.negativeVal, fontSize: 12, fontWeight: 700 }}>
                          Today {(portfolioAccount.data.today_pl ?? 0) >= 0 ? '+' : '−'}${Math.abs(portfolioAccount.data.today_pl ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          <span style={{ opacity: 0.7, fontWeight: 500, marginLeft: 3 }}>({(portfolioAccount.data.today_pl_pct ?? 0) >= 0 ? '+' : ''}{(portfolioAccount.data.today_pl_pct ?? 0).toFixed(2)}%)</span>
                        </span>
                        <span title="Total account P&L vs the $100k paper starting capital"
                          style={{ color: (portfolioAccount.data.total_pl ?? 0) >= 0 ? S.positiveVal : S.negativeVal, fontSize: 12, fontWeight: 700 }}>
                          Total {(portfolioAccount.data.total_pl ?? 0) >= 0 ? '+' : '−'}${Math.abs(portfolioAccount.data.total_pl ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </>
                    )}
                    <a href="https://app.alpaca.markets/paper-trading/account/portfolio"
                      target="_blank" rel="noopener noreferrer"
                      title="View and manage all open orders on Alpaca's paper trading dashboard"
                      style={{ color: S.primary, fontSize: 10, fontWeight: 600, textDecoration: 'none', border: `1px solid #0891B244`, borderRadius: 6, padding: '4px 8px' }}>
                      ↗ Alpaca Dashboard
                    </a>
                    {paperTrades.data && paperTrades.data.some((t: any) => t.status === 'pending_new' || t.status === 'pending') && (
                      <button onClick={() => cancelPending.mutate()} disabled={cancelPending.isPending}
                        title="Cancel all pending_new orders on Alpaca and mark them cancelled locally. pending_new = order received by Alpaca, not yet routed/filled."
                        style={{ background: cancelPending.isPending ? S.border : '#7F1D1D', color: '#FCA5A5', border: '1px solid #7F1D1D', borderRadius: 6, padding: '4px 10px', fontSize: 10, fontWeight: 600, cursor: cancelPending.isPending ? 'default' : 'pointer' }}>
                        {cancelPending.isPending ? '…' : '✕ Cancel Pending'}
                      </button>
                    )}
                    {paperTrades.data && paperTrades.data.length > 0 && (
                      <button onClick={() => { if (window.confirm('Delete ALL paper trades and close all Alpaca positions? This cannot be undone.')) cancelAll.mutate() }}
                        disabled={cancelAll.isPending}
                        title="Closes all open Alpaca positions and deletes all paper trade records from the local DB. Use to reset the paper portfolio to zero."
                        style={{ background: cancelAll.isPending ? S.border : '#78350F', color: '#FDE68A', border: '1px solid #92400E', borderRadius: 6, padding: '4px 10px', fontSize: 10, fontWeight: 600, cursor: cancelAll.isPending ? 'default' : 'pointer' }}>
                        {cancelAll.isPending ? '…' : 'Reset Paper Trades'}
                      </button>
                    )}
                    <button onClick={() => executeTrades.mutate()} disabled={executeTrades.isPending}
                      title="Submit paper market orders to Alpaca for all BUY/SELL signals. HOLD signals are skipped. No real capital — paper trading only."
                      style={{ background: executeTrades.isPending ? S.border : '#0891B2', color: '#fff', border: 'none',
                        borderRadius: 6, padding: '5px 14px', fontSize: 11, fontWeight: 700,
                        cursor: executeTrades.isPending ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                      {executeTrades.isPending
                        ? <><div style={{ width: 10, height: 10, borderWidth: 2, borderStyle: 'solid', borderColor: '#fff4', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}></div>Executing…</>
                        : '▶ Execute Signals'}
                    </button>
                  </div>
                }>
                {/* ── Live Alpaca account snapshot: real equity, today's & total P&L, open positions ── */}
                {portfolioAccount.data?.connected ? (() => {
                  const a = portfolioAccount.data!
                  const kpi = (label: string, value: string, sub: string | null, color: string, tip: string) => (
                    <div title={tip} style={{
                      flex: '1 1 140px', minWidth: 130, position: 'relative', overflow: 'hidden',
                      background: `linear-gradient(135deg, ${color}14 0%, ${S.bg} 70%)`,
                      border: `1px solid ${color}33`, borderRadius: 10, padding: '11px 14px', cursor: 'help',
                      boxShadow: `0 2px 12px ${S.bg}88`,
                    }}>
                      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: color, opacity: 0.85 }} />
                      <p style={{ margin: 0, fontSize: 9, letterSpacing: '0.08em', color: S.muted, fontWeight: 700 }}>{label}</p>
                      <p style={{ margin: '5px 0 0', fontSize: 19, fontWeight: 800, color, fontFamily: 'monospace', letterSpacing: '-0.02em' }}>{value}</p>
                      {sub && <p style={{ margin: '2px 0 0', fontSize: 10, fontWeight: 600, color, opacity: 0.85 }}>{sub}</p>}
                    </div>
                  )
                  const money = (n: number) => `${n >= 0 ? '+' : '−'}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  return (
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                        {kpi('EQUITY', `$${(a.equity ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, `of $${(a.starting_capital ?? 100000).toLocaleString()} start`, S.text, 'Total account value now (Alpaca paper account)')}
                        {kpi("TODAY'S P&L", money(a.today_pl ?? 0), `${(a.today_pl_pct ?? 0) >= 0 ? '+' : ''}${(a.today_pl_pct ?? 0).toFixed(2)}% today`, (a.today_pl ?? 0) >= 0 ? S.positiveVal : S.negativeVal, 'Equity change since the previous session close')}
                        {kpi('TOTAL P&L', money(a.total_pl ?? 0), `${(a.total_pl_pct ?? 0) >= 0 ? '+' : ''}${(a.total_pl_pct ?? 0).toFixed(2)}% all-time`, (a.total_pl ?? 0) >= 0 ? S.positiveVal : S.negativeVal, 'Account P&L vs the $100k paper starting capital')}
                        {kpi('CASH', `$${(a.cash ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, `${a.open_positions ?? 0} open positions`, S.text, 'Uninvested cash + number of open positions')}
                      </div>
                      {(a.positions?.length ?? 0) > 0 && (
                        <div style={{ border: `1px solid ${S.border}`, borderRadius: 8, overflow: 'hidden' }}>
                          <div style={{ padding: '8px 12px', borderBottom: `1px solid ${S.border}`, fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', color: S.muted, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>OPEN POSITIONS · LIVE UNREALIZED P&L · ALPACA PAPER ACCOUNT</span>
                            <span style={{ opacity: 0.6, fontWeight: 500 }}>{a.positions!.length} positions · scroll ↕</span>
                          </div>
                          {/* Capped height + scroll so a 29-row book never dominates the page */}
                          <div style={{ maxHeight: 300, overflowY: 'auto', overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                            <thead style={{ position: 'sticky', top: 0, background: S.surface, zIndex: 1 }}>
                              <tr style={{ borderBottom: `1px solid ${S.border}` }}>
                                {['Ticker', 'Side', 'Qty', 'Entry', 'Current', 'Mkt Value', 'Unrealized P&L', '%'].map(h => (
                                  <th key={h} style={{ color: S.muted, fontWeight: 600, padding: '6px 10px', textAlign: h === 'Ticker' || h === 'Side' ? 'left' : 'right', fontSize: 10 }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {a.positions!.map((p, i) => (
                                <tr key={p.ticker + i} style={{ borderBottom: `1px solid ${S.border}22` }}>
                                  <td style={{ padding: '5px 10px', color: getTickerColor(p.ticker, isDark), fontWeight: 700, fontSize: 12 }}>{p.ticker}</td>
                                  <td style={{ padding: '5px 10px' }}>
                                    <span style={{ background: p.side === 'LONG' ? S.buyBg : S.sellBg, color: p.side === 'LONG' ? S.buyText : S.sellText, borderRadius: 3, padding: '1px 7px', fontSize: 9, fontWeight: 700 }}>{p.side}</span>
                                  </td>
                                  <td style={{ padding: '5px 10px', color: S.text, textAlign: 'right', fontFamily: 'monospace' }}>{p.qty}</td>
                                  <td style={{ padding: '5px 10px', color: S.text, textAlign: 'right', fontFamily: 'monospace' }}>${p.entry_price.toFixed(2)}</td>
                                  <td style={{ padding: '5px 10px', color: S.text, textAlign: 'right', fontFamily: 'monospace' }}>${p.current_price.toFixed(2)}</td>
                                  <td style={{ padding: '5px 10px', color: S.muted, textAlign: 'right', fontFamily: 'monospace' }}>${Math.abs(p.market_value).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                                  <td style={{ padding: '5px 10px', fontWeight: 700, textAlign: 'right', fontFamily: 'monospace', color: p.unrealized_pl >= 0 ? S.positiveVal : S.negativeVal }}>{p.unrealized_pl >= 0 ? '+' : '−'}${Math.abs(p.unrealized_pl).toFixed(2)}</td>
                                  <td style={{ padding: '5px 10px', fontWeight: 700, textAlign: 'right', fontFamily: 'monospace', color: p.unrealized_plpc >= 0 ? S.positiveVal : S.negativeVal }}>{p.unrealized_plpc >= 0 ? '+' : ''}{p.unrealized_plpc.toFixed(2)}%</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })() : portfolioAccount.data && !portfolioAccount.data.connected && (
                  <div style={{ background: '#451a0388', border: '1px solid #D97706', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 11, color: '#FDE68A' }}>
                    ⚠ Live account P&L unavailable — {portfolioAccount.data.note ?? 'add ALPACA_API_KEY + ALPACA_SECRET_KEY to .env'}.
                  </div>
                )}
                {executeTrades.data && (
                  <div style={{ background: S.bg, border: `1px solid ${S.border}`, borderRadius: 6, padding: '8px 12px', marginBottom: 10, fontSize: 10, color: S.muted }}>
                    Submitted: <strong style={{ color: S.positiveVal }}>{(executeTrades.data as any)?.data?.total ?? 0}</strong>
                    &nbsp;·&nbsp;Skipped (HOLD): <strong>{(executeTrades.data as any)?.data?.skipped_hold?.length ?? 0}</strong>
                    {((executeTrades.data as any)?.data?.skipped_no_creds?.length ?? 0) > 0 && (
                      <>&nbsp;·&nbsp;No Alpaca key: <strong style={{ color: '#818CF8' }}>{(executeTrades.data as any)?.data?.skipped_no_creds?.length}</strong> <span style={{ opacity: 0.6 }}>(stub — add ALPACA_API_KEY to .env)</span></>
                    )}
                    &nbsp;·&nbsp;Errors: <strong style={{ color: S.negativeVal }}>{(executeTrades.data as any)?.data?.errors?.length ?? 0}</strong>
                  </div>
                )}
                {paperTrades.data && paperTrades.data.length > 0 ? ((() => {
                  const _trades = tradePnl.data?.trades?.length ? tradePnl.data.trades : paperTrades.data
                  const allSkipped = _trades.length > 0 && _trades.every((t: any) => t.status === 'skipped' || t.status === 'stub')
                  return (<>
                  {allSkipped && (
                    <div style={{ background: '#451a0388', border: '1px solid #D97706', borderRadius: 8, padding: '10px 14px', marginBottom: 10, display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 11 }}>
                      <span style={{ fontSize: 16, flexShrink: 0 }}>⚠</span>
                      <div>
                        <p style={{ color: '#FDE68A', fontWeight: 700, margin: '0 0 3px' }}>Alpaca API key not configured — all trades are stubs</p>
                        <p style={{ color: '#FCD34D', margin: 0, fontSize: 10, lineHeight: 1.5 }}>Add <code style={{ background: '#1C1917', padding: '1px 4px', borderRadius: 3, fontSize: 9 }}>ALPACA_API_KEY</code> + <code style={{ background: '#1C1917', padding: '1px 4px', borderRadius: 3, fontSize: 9 }}>ALPACA_SECRET_KEY</code> to <code style={{ background: '#1C1917', padding: '1px 4px', borderRadius: 3, fontSize: 9 }}>AlphaFlow/.env</code> — expand the Setup Guide below.</p>
                      </div>
                    </div>
                  )}
                  <details style={{ marginTop: 6 }}>
                    <summary style={{ cursor: 'pointer', fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', color: S.muted, padding: '6px 0', userSelect: 'none' }}>
                      SUBMITTED ORDER LOG (LOCAL) · {_trades.length} orders
                      <span style={{ fontWeight: 400, opacity: 0.65, marginLeft: 6 }}>— raw order submissions; <code style={{ fontSize: 9 }}>pending_new</code> = sent to Alpaca, awaiting fill. Live P&L is the Positions table above.</span>
                    </summary>
                  <div style={{ maxHeight: 300, overflowY: 'auto', overflowX: 'auto', border: `1px solid ${S.border}22`, borderRadius: 8, marginTop: 6 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                      <thead style={{ position: 'sticky', top: 0, background: S.surface, zIndex: 1 }}>
                        <tr style={{ borderBottom: `1px solid ${S.border}` }}>
                          {['Ticker', 'Signal', 'Qty', 'Fill Price', 'Current', 'PnL', 'Status', 'Submitted'].map(h => (
                            <th key={h} style={{ color: S.muted, fontWeight: 600, padding: '5px 8px', textAlign: 'left', fontSize: 10 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(tradePnl.data?.trades?.length ? tradePnl.data.trades : paperTrades.data).slice(0, 15).map((t: any, i: number) => (
                          <tr key={t.id ?? i} style={{ borderBottom: `1px solid ${S.border}22` }}>
                            <td style={{ padding: '5px 8px', color: getTickerColor(t.ticker, isDark), fontWeight: 700, fontSize: 12 }}>{t.ticker}</td>
                            <td style={{ padding: '5px 8px' }}>
                              <span style={{ background: t.signal === 'BUY' ? S.buyBg : S.sellBg, color: t.signal === 'BUY' ? S.buyText : S.sellText, borderRadius: 3, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>{t.signal}</span>
                            </td>
                            <td style={{ padding: '5px 8px', color: S.text }}>{t.qty}</td>
                            <td style={{ padding: '5px 8px', color: S.text, fontFamily: 'monospace' }}>{t.filled_price != null ? `$${Number(t.filled_price).toFixed(2)}` : '—'}</td>
                            <td style={{ padding: '5px 8px', color: S.text, fontFamily: 'monospace' }}>{t.current_price != null ? `$${Number(t.current_price).toFixed(2)}` : '—'}</td>
                            <td style={{ padding: '5px 8px', fontWeight: 700, fontFamily: 'monospace', color: (t.pnl ?? 0) >= 0 ? S.positiveVal : S.negativeVal }}>
                              {t.pnl != null ? `${t.pnl >= 0 ? '+' : ''}$${Number(t.pnl).toFixed(2)}` : '—'}
                            </td>
                            <td style={{ padding: '5px 8px' }}>
                              <span
                                title={t.status === 'error' ? 'Alpaca API error — check logs for details.' : t.status === 'filled' ? 'Order confirmed by Alpaca paper account' : t.status === 'skipped' ? 'HOLD signal — no directional edge; order skipped' : t.status === 'skipped_pos' ? 'Position already open for this ticker — double-entry prevented by risk control' : t.status === 'stub' ? 'No Alpaca API key found in .env — set ALPACA_API_KEY + ALPACA_SECRET_KEY to enable paper execution' : 'Awaiting fill confirmation'}
                                style={{ color: t.status === 'filled' ? S.positiveVal : t.status === 'error' ? S.negativeVal : t.status === 'skipped_pos' ? '#A78BFA' : S.muted, fontSize: 10, cursor: 'help', borderBottom: '1px dashed currentColor' }}>{t.status}</span>
                            </td>
                            <td style={{ padding: '5px 8px', color: S.muted, fontSize: 9 }}>{(t.submitted_at ?? '').slice(0, 16).replace('T', ' ')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                    <p style={{ color: S.muted, fontSize: 9, margin: '6px 4px 0', opacity: 0.55, lineHeight: 1.5 }}>
                      ⓘ PnL shown <em>gross</em> of transaction costs. Estimated half-spread cost per trade ≈ eff_spread_bps / 2 bps × fill_price × qty. Production systems would deduct market impact via Kyle λ × qty at larger position sizes.
                    </p>
                    {/* ── Order Status Legend ── */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                      {([
                        { status: 'filled',      color: '#22C55E', bg: '#14532d', desc: 'Executed at fill price — confirmed by Alpaca' },
                        { status: 'pending_new', color: '#F59E0B', bg: '#451a03', desc: 'Received by Alpaca, routing to exchange' },
                        { status: 'pending',     color: '#F59E0B', bg: '#451a03', desc: 'Submitted locally, awaiting confirmation' },
                        { status: 'skipped_pos', color: '#A78BFA', bg: '#2E1065', desc: 'Position already open for this ticker — risk control prevents double-entry' },
                        { status: 'stub',        color: '#818CF8', bg: '#1e1b4b', desc: 'No ALPACA_API_KEY in .env — add to .env to enable paper execution' },
                        { status: 'error',       color: '#EF4444', bg: '#450a0a', desc: 'Alpaca API error — check server logs' },
                        { status: 'canceled',    color: '#94A3B8', bg: '#1e293b', desc: 'Cancelled before fill' },
                      ] as Array<{status:string;color:string;bg:string;desc:string}>).map(s => (
                        <div key={s.status} title={s.desc} style={{ display: 'flex', alignItems: 'center', gap: 5, background: s.bg, border: `1px solid ${s.color}44`, borderRadius: 5, padding: '3px 8px', cursor: 'help' }}>
                          <span style={{ color: s.color, fontFamily: 'monospace', fontSize: 9, fontWeight: 700 }}>{s.status}</span>
                          <span style={{ color: '#94A3B8', fontSize: 8 }}>{s.desc}</span>
                        </div>
                      ))}
                    </div>
                    <AlpacaSetupGuide S={S} open={allSkipped} hint="expand if trades show stub or skipped" />
                  </details>
                  </>)})()
                ) : (
                  <div style={{ color: S.muted, padding: '16px 0' }}>
                    <div style={{ background: S.bg, border: `1px solid ${S.border}`, borderRadius: 8, padding: '12px 14px', marginBottom: 10 }}>
                      <p style={{ color: S.primary, fontSize: 11, fontWeight: 700, margin: '0 0 6px' }}>ℹ What is Paper Portfolio?</p>
                      <p style={{ fontSize: 11, color: S.text, margin: '0 0 5px', lineHeight: 1.6 }}>
                        Paper Portfolio simulates live trade execution using the <strong>Alpaca Paper Trading API</strong> — no real capital is ever deployed.
                        When you click <strong>▶ Execute Signals</strong>, AlphaFlow submits market orders for all BUY/SELL signals and records fill prices, PnL, and status.
                      </p>
                      <p style={{ fontSize: 10, color: S.muted, margin: '0 0 4px', lineHeight: 1.5 }}>
                        <strong>Status meanings:</strong> <span style={{ color: S.positiveVal }}>filled</span> = order confirmed by Alpaca paper account.&nbsp;
                        <span style={{ color: S.negativeVal }}>error</span> = Alpaca API unreachable (expected in local dev without ALPACA_API_KEY in .env — trades are still logged).&nbsp;
                        <span style={{ color: S.muted }}>pending</span> = submitted, awaiting fill confirmation.
                      </p>
                      <p style={{ fontSize: 9, color: S.muted, margin: 0, opacity: 0.5 }}>Requires ALPACA_API_KEY + ALPACA_SECRET_KEY in .env · 100% paper · zero real capital</p>
                      <AlpacaSetupGuide S={S} hint="step-by-step" />
                    </div>
                    <p style={{ fontSize: 12, fontStyle: 'italic', textAlign: 'center', margin: 0 }}>
                      No paper trades yet — click <strong style={{ color: S.primary }}>▶ Execute Signals</strong> to submit orders based on current signal cards
                    </p>
                  </div>
                )}
              </Card>

              {/* ── Section 5: Alpha Decay (IC Half-Life) ─────────────────────── */}
              <Card
                title="Alpha Decay · IC Half-Life per Ticker"
                right={
                  <button onClick={() => runAlphaDecayP3.mutate()} disabled={runAlphaDecayP3.isPending}
                    title="Fit IC(t) = IC₀·exp(−λt) to compute how many bars before the OFI signal loses 50% of its predictive power."
                    style={{ background: runAlphaDecayP3.isPending ? S.border : S.primary, color: '#fff', border: 'none',
                      borderRadius: 6, padding: '5px 14px', fontSize: 11, fontWeight: 700,
                      cursor: runAlphaDecayP3.isPending ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                    {runAlphaDecayP3.isPending
                      ? <><div style={{ width: 10, height: 10, borderWidth: 2, borderStyle: 'solid', borderColor: '#fff4', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}></div>Computing…</>
                      : 'Run Decay Analysis'}
                  </button>
                }>
                {alphaDecayP3.data && alphaDecayP3.data.length > 0 ? (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10, gap: 10 }}>
                      <p style={{ color: S.muted, fontSize: 9, margin: 0, opacity: 0.7, lineHeight: 1.6, flex: 1 }}>
                        <InfoTip term="Alpha Decay">IC half-life</InfoTip> = bars until OFI predictive power drops by 50%.
                        Model: <span style={{ fontFamily: 'monospace', fontSize: 8 }}>IC(t) = IC₀·exp(−λt)</span> · Grinold &amp; Kahn (2000).
                        "—" = daily IC too small to fit decay (expected at OHLCV resolution).
                      </p>
                      <button
                        onClick={() => sendChatWithTicker(
                          'What is alpha decay in quantitative trading? Explain what IC half-life means, why microstructure signals like OFI typically have short half-lives (intraday only), and what a half-life of 1-3 bars implies for position sizing and holding period.',
                          'AlphaFlow'
                        )}
                        style={{ background: 'transparent', border: `1px solid ${S.border}`, color: S.muted, borderRadius: 6, padding: '3px 8px', fontSize: 9, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}>
                        Explain in chat
                      </button>
                    </div>
                    {(() => {
                      const decayItemsAll = alphaDecayP3.data
                        .filter((d: any) => d.half_life_bars != null)
                        .sort((a: any, b: any) => a.half_life_bars - b.half_life_bars)
                      const decayItems = alphaDecayShowAll ? decayItemsAll : decayItemsAll.slice(0, 10)
                      const nullItems = alphaDecayP3.data.filter((d: any) => d.half_life_bars == null)
                      if (decayItemsAll.length === 0) return null
                      const barData = decayItems.map((d: any) => ({
                        ticker: d.ticker,
                        half_life: Number(d.half_life_bars),
                        fill: d.half_life_bars <= 2 ? '#22C55E' : d.half_life_bars <= 5 ? '#EAB308' : '#EF4444',
                      }))
                      const HLTooltip = ({ active, payload }: any) => {
                        if (!active || !payload?.[0]) return null
                        const d = payload[0].payload
                        const label = d.half_life <= 2 ? 'Microstructure alpha — pure intraday signal, hold ≤2 bars' : d.half_life <= 5 ? 'Short-term signal — 2-5 bar holding window suggested' : 'Multi-day signal — OFI information persists beyond microstructure horizon'
                        return (
                          <div style={{ background: S.tipBg, border: `1px solid ${S.tipBorder}`, borderRadius: 7, padding: '7px 12px', fontSize: 10 }}>
                            <p style={{ color: '#7DD3FC', fontWeight: 700, margin: '0 0 3px' }}>{d.ticker}</p>
                            <p style={{ color: d.fill, fontWeight: 700, margin: '0 0 3px', fontFamily: 'monospace' }}>{d.half_life.toFixed(1)} bars</p>
                            <p style={{ color: '#CBD5E1', margin: 0, maxWidth: 220, lineHeight: 1.5 }}>{label}</p>
                          </div>
                        )
                      }
                      return (
                        <div>
                          <ResponsiveContainer width="100%" height={Math.max(80, decayItems.length * 28)}>
                            <BarChart data={barData} layout="vertical" margin={{ top: 0, right: 40, left: 36, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke={S.border} horizontal={false} />
                              <XAxis type="number" tick={{ fill: S.muted, fontSize: 9 }} tickLine={false} axisLine={{ stroke: S.border }} label={{ value: 'bars', position: 'insideRight', offset: -2, style: { fill: S.muted, fontSize: 8 } }} />
                              <YAxis type="category" dataKey="ticker" tick={{ fill: S.text, fontSize: 10, fontWeight: 700 }} tickLine={false} axisLine={false} width={36} />
                              <RechartsTooltip content={<HLTooltip />} cursor={{ fill: S.border + '33' }} />
                              <ReferenceLine x={2} stroke="#22C55E88" strokeDasharray="4 3" label={{ value: 'micro', position: 'top', style: { fill: '#22C55E', fontSize: 8 } }} />
                              <ReferenceLine x={5} stroke="#EAB30888" strokeDasharray="4 3" label={{ value: 'short-term', position: 'top', style: { fill: '#EAB308', fontSize: 8 } }} />
                              <Bar dataKey="half_life" isAnimationActive animationDuration={600} radius={[0, 3, 3, 0]}>
                                {barData.map((d: any) => <Cell key={d.ticker} fill={d.fill} />)}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                          {nullItems.length > 0 && (
                            <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px dashed ${S.border}` }}>
                              <p style={{ color: S.muted, fontSize: 9, margin: '0 0 5px', opacity: 0.5 }}>No detectable decay (daily IC &lt; 1%):</p>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                                {nullItems.map((d: any) => (
                                  <span key={d.ticker} style={{ color: S.muted, fontSize: 10, fontFamily: 'monospace', background: S.bg, borderRadius: 4, padding: '2px 6px', border: `1px solid ${S.border}`, opacity: 0.5 }}>
                                    {d.ticker} —
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 9, color: S.muted, opacity: 0.7 }}>
                            <span style={{ color: S.positiveVal }}>● ≤2 bars = microstructure</span>
                            <span style={{ color: S.warnVal }}>● 2–5 bars = short-term</span>
                            <span style={{ color: S.negativeVal }}>● &gt;5 bars = multi-day</span>
                          </div>
                          {decayItemsAll.length > 10 && (
                            <div style={{ textAlign: 'center', marginTop: 10 }}>
                              <button onClick={() => setAlphaDecayShowAll(v => !v)}
                                style={{ background: 'transparent', border: `1px solid ${S.border}`, color: S.primary, borderRadius: 6, padding: '4px 14px', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>
                                {alphaDecayShowAll ? '▲ Fastest-Decaying 10 Only' : `▼ Show All ${decayItemsAll.length}`}
                              </button>
                            </div>
                          )}
                          <p style={{ color: S.muted, fontSize: 9, margin: '10px 0 0', opacity: 0.6, lineHeight: 1.5, borderTop: `1px dashed ${S.border}`, paddingTop: 8 }}>
                            Even the slowest ("multi-day") half-lives above decay well within Portfolio Simulation's monthly rebalance cycle below — supporting monthly as a conservative, not aggressive, cadence.
                          </p>
                        </div>
                      )
                    })()}
                  </div>
                ) : (
                  <div>
                    <div style={{ background: S.bg, border: `1px solid ${S.border}`, borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
                      <p style={{ color: S.primary, fontSize: 11, fontWeight: 700, margin: '0 0 4px' }}>
                        <InfoTip term="Alpha Decay">ℹ What is Alpha Decay?</InfoTip>
                      </p>
                      <p style={{ fontSize: 10, color: S.text, margin: '0 0 4px', lineHeight: 1.6 }}>
                        Alpha decay measures how quickly a trading signal loses predictive power over time.
                        IC half-life = the number of bars until the OFI signal's IC drops to 50% of its initial value.
                        For microstructure signals, this is typically 1–3 bars (hours), confirming the alpha is intraday only.
                      </p>
                      <button
                        onClick={() => sendChatWithTicker(
                          'What is alpha decay in quantitative trading? Explain IC half-life, why OFI signals decay fast, and what that implies for optimal holding period.',
                          'AlphaFlow'
                        )}
                        style={{ background: 'transparent', border: `1px solid ${S.border}`, color: S.primary, borderRadius: 6, padding: '3px 10px', fontSize: 9, cursor: 'pointer' }}>
                        Ask Groq to explain this
                      </button>
                    </div>
                    <div style={{ color: S.muted, fontSize: 12, fontStyle: 'italic', textAlign: 'center' }}>
                      Click <strong style={{ color: S.primary }}>Run Decay Analysis</strong> to compute IC half-life per ticker
                      <p style={{ fontSize: 10, opacity: 0.6, margin: '6px 0 0' }}>Fits IC(t) = IC₀·exp(−λt) · Cont et al. (2023)</p>
                    </div>
                  </div>
                )}
              </Card>

              {/* ── Section 6: Cross-Sectional Portfolio Simulation ───── */}
              <Card
                title={
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>Portfolio Simulation — Cross-Sectional Long-Short</span>
                    <span style={{ color: S.primary, fontSize: 9, fontWeight: 500, background: '#0891B222', borderRadius: 4, padding: '1px 6px' }}>
                      top-3 IC long · bottom-3 IC short · TC model
                    </span>
                  </span>
                }
                right={
                  <button
                    onClick={() => qc.invalidateQueries({ queryKey: ['portfolioSimulate'] })}
                    disabled={portfolioQuery.isFetching}
                    style={{ background: portfolioQuery.isFetching ? S.border : S.primary, color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontSize: 11, fontWeight: 700, cursor: portfolioQuery.isFetching ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                    {portfolioQuery.isFetching ? <><div style={{ width: 10, height: 10, borderWidth: 2, borderStyle: 'solid', borderColor: '#fff4', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}></div>Computing…</> : '↻ Refresh'}
                  </button>
                }>
                {(() => {
                  const pd = portfolioQuery.data
                  if (portfolioQuery.isLoading) return <p style={{ color: S.muted, fontSize: 12, fontStyle: 'italic' }}>Loading portfolio simulation…</p>
                  if (!pd || pd.error) return (
                    <div style={{ background: S.bg, border: `1px solid ${S.border}`, borderRadius: 8, padding: '12px 16px' }}>
                      <p style={{ color: S.primary, fontSize: 11, fontWeight: 700, margin: '0 0 6px' }}>Cross-Sectional Long-Short Portfolio</p>
                      <p style={{ fontSize: 10, color: S.text, margin: '0 0 6px', lineHeight: 1.6 }}>
                        Ranks all tickers by walk-forward IC → long top-3, short bottom-3 (equal-weight). 
                        Applies half-spread transaction costs at each monthly rebalance. 
                        Computes CAPM alpha vs SPY to show the strategy earns above market exposure.
                      </p>
                      <p style={{ fontSize: 10, color: S.muted, margin: 0, opacity: 0.6 }}>
                        {pd?.error ?? 'Run Run Signal Engine for at least 6 tickers, then click ↻ Refresh.'}
                      </p>
                    </div>
                  )

                  const { gross_equity, net_equity, long_tickers, short_tickers, long_ics, short_ics,
                          gross_sharpe, net_sharpe, net_max_drawdown, net_calmar,
                          hit_rate, profit_factor, portfolio_ic, avg_cost_bps, n_rebalances, capm,
                          robustness, equity_dates, position_detail } = pd

                  // Build chart data — sample every N bars for readability
                  const sampleRate = Math.max(1, Math.floor((gross_equity?.length ?? 0) / 300))
                  const hasDates = (equity_dates?.length ?? 0) === (gross_equity?.length ?? 0) && (equity_dates?.length ?? 0) > 0
                  const chartData = (gross_equity ?? []).map((g: number, i: number) => ({
                    bar: i + 1,
                    date: equity_dates?.[i] ?? null,
                    gross: parseFloat((g * 100 - 100).toFixed(3)),
                    net:   parseFloat(((net_equity?.[i] ?? g) * 100 - 100).toFixed(3)),
                  })).filter((_: any, i: number) => i % sampleRate === 0)
                  const xTickInterval = Math.max(0, Math.floor(chartData.length / 8) - 1)

                  const finalGross = (gross_equity?.length ? gross_equity[gross_equity.length - 1] : 1) * 100 - 100
                  const finalNet   = (net_equity?.length   ? net_equity[net_equity.length - 1]     : 1) * 100 - 100

                  const MetricBadge = ({ label, value, sub, color, tip }: { label: string; value: string; sub?: string; color: string; tip: string }) => (
                    <Tooltip content={tip}>
                      <div style={{ background: S.surface, border: `1px solid ${S.border}`, borderRadius: 8, padding: '8px 12px', minWidth: 100, cursor: 'help' }}>
                        <div style={{ color: S.muted, fontSize: 9, marginBottom: 2 }}>{label}</div>
                        <div style={{ color, fontSize: 16, fontWeight: 800, fontFamily: 'monospace' }}>{value}</div>
                        {sub && <div style={{ color: S.muted, fontSize: 8, marginTop: 2, opacity: 0.7 }}>{sub}</div>}
                      </div>
                    </Tooltip>
                  )

                  return (
                    <div>
                      {/* Holdings display */}
                      <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span style={{ color: S.positiveVal, fontSize: 9, fontWeight: 700, letterSpacing: '0.08em' }}>▲ LONG</span>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {(long_tickers ?? []).map((t: string, i: number) => (
                              <Tooltip key={t} content={`IC = ${((long_ics?.[i] ?? 0) * 100).toFixed(2)}%. Click for position attribution.`}>
                                <span onClick={e => { const rect = (e.currentTarget as HTMLElement).getBoundingClientRect(); setPosDetailOpen(prev => prev?.ticker === t ? null : { ticker: t, rect }) }}
                                  style={{ background: `${S.positiveVal}22`, border: `1px solid ${S.positiveVal}55`, color: S.positiveVal, borderRadius: 6, padding: '3px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                                  {t} <span style={{ fontSize: 8, opacity: 0.7 }}>IC {((long_ics?.[i] ?? 0) * 100).toFixed(1)}%</span>
                                </span>
                              </Tooltip>
                            ))}
                          </div>
                        </div>
                        <div style={{ width: 1, background: S.border, alignSelf: 'stretch' }} />
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span style={{ color: S.negativeVal, fontSize: 9, fontWeight: 700, letterSpacing: '0.08em' }}>▼ SHORT</span>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {(short_tickers ?? []).map((t: string, i: number) => (
                              <Tooltip key={t} content={`IC = ${((short_ics?.[i] ?? 0) * 100).toFixed(2)}%. Click for position attribution.`}>
                                <span onClick={e => { const rect = (e.currentTarget as HTMLElement).getBoundingClientRect(); setPosDetailOpen(prev => prev?.ticker === t ? null : { ticker: t, rect }) }}
                                  style={{ background: `${S.negativeVal}22`, border: `1px solid ${S.negativeVal}55`, color: S.negativeVal, borderRadius: 6, padding: '3px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                                  {t} <span style={{ fontSize: 8, opacity: 0.7 }}>IC {((short_ics?.[i] ?? 0) * 100).toFixed(1)}%</span>
                                </span>
                              </Tooltip>
                            ))}
                          </div>
                        </div>
                        <div style={{ marginLeft: 'auto', color: S.muted, fontSize: 9, alignSelf: 'center', opacity: 0.6 }}>
                          {n_rebalances} rebalances · {(avg_cost_bps ?? 0).toFixed(1)} bps avg cost
                        </div>
                      </div>

                      {/* ── Plain-English verdict: translates Sharpe / IC into a one-line read ── */}
                      {(() => {
                        const ns = net_sharpe ?? 0
                        const good = ns > 0.5, ok = ns > 0
                        const verColor = good ? S.positiveVal : ok ? S.warnVal : S.negativeVal
                        const verText = good
                          ? `Net Sharpe ${ns.toFixed(2)} after costs — the long-short book is monetising the signal on this data.`
                          : ok
                            ? `Net Sharpe ${ns.toFixed(2)} after costs — a faint positive edge, but not yet robust enough to trade.`
                            : `Net Sharpe ${ns.toFixed(2)} after costs — this signal does NOT profit on daily OHLCV once transaction costs are applied. Expected: OFI alpha lives intraday (minutes), which daily bars average away. The value here is the research framework, not a live edge.`
                        return (
                          <div style={{ background: `${verColor}14`, border: `1px solid ${verColor}44`, borderRadius: 8, padding: '9px 13px', marginBottom: 14, fontSize: 11, lineHeight: 1.55, color: S.text, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                            <span style={{ color: verColor, fontWeight: 800, flexShrink: 0 }}>{good ? '✓ VERDICT' : ok ? '~ VERDICT' : '✕ VERDICT'}</span>
                            <span>{verText}</span>
                          </div>
                        )
                      })()}

                      {posDetailOpen && (() => {
                        const det = position_detail?.find((p: any) => p.ticker === posDetailOpen.ticker)
                        const r = posDetailOpen.rect
                        const sideColor = det?.side === 'SHORT' ? S.negativeVal : S.positiveVal
                        return createPortal(
                          <div ref={posDetailPanelRef} style={{
                            position: 'fixed', left: Math.min(r.left, window.innerWidth - 220), top: Math.min(r.bottom + 6, window.innerHeight - 180),
                            width: 210, background: S.tipBg, border: `1px solid ${S.tipBorder}`, borderRadius: 9, padding: '10px 14px', zIndex: 9999,
                            boxShadow: '0 12px 40px rgba(0,0,0,0.4)', fontSize: 11,
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                              <span style={{ color: sideColor, fontWeight: 800, fontSize: 13 }}>{posDetailOpen.ticker}</span>
                              <span onClick={() => setPosDetailOpen(null)} style={{ color: S.muted, cursor: 'pointer', fontSize: 12, padding: '0 2px' }}>✕</span>
                            </div>
                            {det ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: S.muted }}>Side</span><span style={{ color: sideColor, fontWeight: 700 }}>{det.side ?? '—'}</span></div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: S.muted }}>Weight</span><span style={{ color: S.text, fontWeight: 700 }}>{(Number(det.weight ?? 0) * 100).toFixed(1)}%</span></div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: S.muted }}>Mean IC</span><span style={{ color: S.text, fontWeight: 700 }}>{(Number(det.mean_ic ?? 0) * 100).toFixed(2)}%</span></div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: S.muted }}>IC Rank</span><span style={{ color: S.text, fontWeight: 700 }}>#{det.ic_rank ?? '—'}</span></div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: S.muted }}>PnL Contribution</span><span style={{ color: Number(det.pnl_contribution_pct ?? 0) >= 0 ? S.positiveVal : S.negativeVal, fontWeight: 700 }}>{Number(det.pnl_contribution_pct ?? 0) >= 0 ? '+' : ''}{Number(det.pnl_contribution_pct ?? 0).toFixed(2)}%</span></div>
                              </div>
                            ) : (
                              <p style={{ color: S.muted, fontSize: 10, margin: 0, fontStyle: 'italic' }}>Position detail unavailable — re-run ↻ Refresh.</p>
                            )}
                          </div>,
                          document.body
                        )
                      })()}

                      {/* Equity curve chart */}
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <span style={{ color: S.muted, fontSize: 9 }}>Cumulative OOS PnL (%) — Gross vs Net after transaction costs</span>
                          <div style={{ display: 'flex', gap: 12 }}>
                            {[{ color: '#22C55E', label: `Gross  ${finalGross >= 0 ? '+' : ''}${finalGross.toFixed(1)}%` },
                              { color: '#3B82F6', label: `Net  ${finalNet >= 0 ? '+' : ''}${finalNet.toFixed(1)}%` }].map(l => (
                              <span key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: S.text }}>
                                <span style={{ width: 12, height: 2, background: l.color, display: 'inline-block', borderRadius: 2 }}></span>
                                {l.label}
                              </span>
                            ))}
                          </div>
                        </div>
                        <ResponsiveContainer width="100%" height={220}>
                        <ComposedChart data={chartData} margin={{ top: 4, right: 12, left: 8, bottom: 18 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke={S.border} />
                          <XAxis dataKey={hasDates ? 'date' : 'bar'} tick={{ fill: S.muted, fontSize: 8 }}
                            interval={hasDates ? xTickInterval : 'preserveStartEnd'}
                            tickFormatter={(v: any) => hasDates ? String(v).slice(5, 10) : `${v}`}
                            label={{ value: hasDates ? 'Date (chronological, out-of-sample) →' : 'Walk-forward hour index (chronological, out-of-sample) →', position: 'insideBottom', offset: -10, fill: S.muted, fontSize: 9 }} />
                          <YAxis tick={{ fill: S.muted, fontSize: 8 }} tickFormatter={(v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`} width={56}
                            label={{ value: 'Cumulative return (%)', angle: -90, position: 'insideLeft', fill: S.muted, fontSize: 9 }} />
                          <RechartsTooltip formatter={(v: number, name: string) => [`${v >= 0 ? '+' : ''}${v.toFixed(2)}%`, name === 'gross' ? 'Gross PnL' : 'Net PnL (after TC)']} labelFormatter={(v: any) => hasDates ? `${v}` : `Hour #${v}`} contentStyle={{ background: S.tipBg, border: `1px solid ${S.tipBorder}`, borderRadius: 6, fontSize: 11 }} labelStyle={{ color: '#38BDF8', fontWeight: 700, marginBottom: 4 }} itemStyle={{ color: '#CBD5E1' }} />
                          <ReferenceLine y={0} stroke={S.muted} strokeDasharray="4 2" strokeWidth={1} />
                          <Line type="monotone" dataKey="gross" stroke="#22C55E" dot={false} strokeWidth={1.5} name="gross" />
                          <Line type="monotone" dataKey="net"   stroke="#3B82F6" dot={false} strokeWidth={1.5} strokeDasharray="4 3" name="net" />
                        </ComposedChart>
                        </ResponsiveContainer>
                      </div>

                      {/* Metric badges row 1 */}
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                        <MetricBadge label="Gross Sharpe" value={gross_sharpe >= 0 ? `+${gross_sharpe.toFixed(2)}` : gross_sharpe.toFixed(2)}
                          color={gross_sharpe >= 1 ? S.positiveVal : gross_sharpe >= 0 ? S.warnVal : S.negativeVal}
                          tip="Annualised Sharpe before transaction costs. Sharpe = √1638 × μ/σ on hourly returns." />
                        <MetricBadge label="Net Sharpe" value={net_sharpe >= 0 ? `+${net_sharpe.toFixed(2)}` : net_sharpe.toFixed(2)}
                          color={net_sharpe >= 0.5 ? S.positiveVal : net_sharpe >= 0 ? S.warnVal : S.negativeVal}
                          sub="after TC"
                          tip={`Net Sharpe after deducting ${(avg_cost_bps ?? 0).toFixed(1)} bps half-spread at each of ${n_rebalances} monthly rebalances.`} />
                        <MetricBadge label="Net Max DD"
                          value={`-${(Math.abs(net_max_drawdown ?? 0) * 100).toFixed(1)}%`}
                          color={Math.abs(net_max_drawdown ?? 0) < 0.1 ? S.positiveVal : Math.abs(net_max_drawdown ?? 0) < 0.25 ? S.warnVal : S.negativeVal}
                          tip="Worst peak-to-trough drawdown of the net portfolio equity curve." />
                        <MetricBadge label="Net Calmar"
                          value={net_calmar >= 0 ? `+${net_calmar.toFixed(2)}` : net_calmar.toFixed(2)}
                          color={net_calmar >= 0.5 ? S.positiveVal : net_calmar >= 0 ? S.warnVal : S.negativeVal}
                          tip="Net annualised return ÷ |Max Drawdown|. Calmar > 0.5 = acceptable risk-adjusted return." />
                        <MetricBadge label="Hit Rate" value={`${((hit_rate ?? 0) * 100).toFixed(1)}%`}
                          color={(hit_rate ?? 0) >= 0.52 ? S.positiveVal : (hit_rate ?? 0) >= 0.48 ? S.warnVal : S.negativeVal}
                          tip="Fraction of hourly bars where the portfolio was profitable (gross). 50% = coin flip; >52% = directional edge." />
                        <MetricBadge label="Profit Factor" value={(profit_factor ?? 1).toFixed(2)}
                          color={(profit_factor ?? 1) >= 1.1 ? S.positiveVal : (profit_factor ?? 1) >= 1.0 ? S.warnVal : S.negativeVal}
                          tip="Gross wins / |Gross losses|. > 1.0 = positive expectancy. > 1.2 = strong systematic edge." />
                        <MetricBadge label="Portfolio IC" value={`${((portfolio_ic ?? 0) * 100).toFixed(2)}%`}
                          color={(portfolio_ic ?? 0) >= 0.03 ? S.positiveVal : (portfolio_ic ?? 0) >= 0.01 ? S.warnVal : S.negativeVal}
                          tip="Mean IC of the long-short basket (avg of long ICs and |short ICs|). Grinold-Kahn threshold: IC > 3% = usable signal." />
                      </div>

                      {/* CAPM Alpha decomposition */}
                      {capm && !capm.error && (
                        <div style={{ background: S.bg, border: `1px solid ${S.border}`, borderRadius: 8, padding: '10px 14px', marginTop: 8 }}>
                          <p style={{ color: S.primary, fontSize: 10, fontWeight: 700, margin: '0 0 8px' }}>
                            CAPM Alpha Decomposition — r<sub>portfolio</sub> = α + β × r<sub>SPY</sub> + ε
                          </p>
                          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                            {[
                              { label: 'α (annual)', value: `${capm.alpha_pct >= 0 ? '+' : ''}${capm.alpha_pct.toFixed(1)}%`,
                                color: capm.alpha_pct > 0 ? S.positiveVal : S.negativeVal,
                                tip: `Annualised CAPM alpha = ${capm.alpha_pct.toFixed(2)}% p.a. Return above market exposure. Positive α = genuine informational edge beyond beta.` },
                              { label: 'β (market)', value: capm.beta.toFixed(3),
                                color: Math.abs(capm.beta) < 0.3 ? S.positiveVal : Math.abs(capm.beta) < 0.6 ? S.warnVal : S.negativeVal,
                                tip: `Market beta = ${capm.beta.toFixed(3)}. Long-short strategies should have β ≈ 0 (market-neutral). |β| < 0.3 = well-hedged.` },
                              { label: 'R²', value: capm.r2.toFixed(3),
                                color: capm.r2 < 0.1 ? S.positiveVal : capm.r2 < 0.3 ? S.warnVal : S.negativeVal,
                                tip: `R² = ${capm.r2.toFixed(3)}. Fraction of portfolio variance explained by SPY. Low R² = portfolio return is mostly idiosyncratic (good for L/S).` },
                              { label: 'α t-stat', value: capm.alpha_tstat >= 0 ? `+${capm.alpha_tstat.toFixed(2)}` : capm.alpha_tstat.toFixed(2),
                                color: Math.abs(capm.alpha_tstat) >= 2 ? S.positiveVal : Math.abs(capm.alpha_tstat) >= 1.5 ? S.warnVal : S.negativeVal,
                                tip: `t-statistic for H₀: α=0. |t| > 2 = statistically significant alpha at 95% confidence (${capm.n_daily_bars} daily obs).` },
                              { label: 'p-value', value: capm.alpha_pval < 0.001 ? '<0.001' : capm.alpha_pval.toFixed(3),
                                color: capm.alpha_pval < 0.05 ? S.positiveVal : capm.alpha_pval < 0.1 ? S.warnVal : S.negativeVal,
                                tip: `p-value for H₀: α=0. p < 0.05 = reject null (alpha is real). ${capm.n_daily_bars} daily observations used.` },
                            ].map(m => (
                              <Tooltip key={m.label} content={m.tip}>
                                <div style={{ cursor: 'help' }}>
                                  <div style={{ color: S.muted, fontSize: 9 }}>{m.label}</div>
                                  <div style={{ color: m.color, fontSize: 15, fontWeight: 800, fontFamily: 'monospace' }}>{m.value}</div>
                                </div>
                              </Tooltip>
                            ))}
                            <div style={{ marginLeft: 'auto', alignSelf: 'center' }}>
                              <div style={{ color: S.muted, fontSize: 8, opacity: 0.6 }}>{capm.n_daily_bars} daily obs · SPY proxy · OLS</div>
                            </div>
                          </div>
                        </div>
                      )}
                      {capm?.error && (
                        <p style={{ color: S.muted, fontSize: 9, marginTop: 6, opacity: 0.5 }}>CAPM alpha: {capm.error}</p>
                      )}

                      {/* Statistical robustness — Probabilistic & Deflated Sharpe (Bailey & López de Prado) */}
                      {robustness && (
                        <div style={{ background: S.bg, border: `1px solid ${S.border}`, borderRadius: 8, padding: '10px 14px', marginTop: 8 }}>
                          <p style={{ color: S.primary, fontSize: 10, fontWeight: 700, margin: '0 0 8px' }}>
                            Statistical Robustness — is the Sharpe real, or luck?
                          </p>
                          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                            {[
                              { label: 'PSR', value: `${(robustness.psr * 100).toFixed(0)}%`,
                                color: robustness.psr >= 0.95 ? S.positiveVal : robustness.psr >= 0.8 ? S.warnVal : S.negativeVal,
                                tip: `Probabilistic Sharpe Ratio = ${(robustness.psr * 100).toFixed(1)}%. Probability the true Sharpe > 0 given ${robustness.n_obs} observations and non-normal returns. ≥95% = statistically credible.` },
                              { label: 'DSR', value: `${(robustness.dsr * 100).toFixed(0)}%`,
                                color: robustness.dsr >= 0.95 ? S.positiveVal : robustness.dsr >= 0.8 ? S.warnVal : S.negativeVal,
                                tip: `Deflated Sharpe Ratio = ${(robustness.dsr * 100).toFixed(1)}%. PSR after penalising the ${robustness.n_trials} tickers screened to build this book (multiple-testing haircut). ≥95% = edge survives the haircut.` },
                            ].map(m => (
                              <Tooltip key={m.label} content={m.tip}>
                                <div style={{ cursor: 'help' }}>
                                  <div style={{ color: S.muted, fontSize: 9 }}>{m.label}</div>
                                  <div style={{ color: m.color, fontSize: 15, fontWeight: 800, fontFamily: 'monospace' }}>{m.value}</div>
                                </div>
                              </Tooltip>
                            ))}
                            <div style={{ marginLeft: 'auto', alignSelf: 'center' }}>
                              <div style={{ color: S.muted, fontSize: 8, opacity: 0.6 }}>{robustness.n_obs} obs · {robustness.n_trials} trials · Bailey &amp; López de Prado</div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })()}
              </Card>
            </>
          )}

          {/* ── Methodology footnote (daily view) ── */}
          {resolution === 'daily' && (
            <div style={{ borderTop: `1px solid ${S.border}`, paddingTop: 12, marginTop: 4 }}>
              <p style={{ color: S.muted, fontSize: 9, lineHeight: 1.7, margin: 0, opacity: 0.7 }}>
                <strong style={{ color: S.text, fontWeight: 600 }}>Signals:</strong>{' '}
                OFI Z-score · Kyle λ price impact · VPIN flow toxicity · Amihud ILLIQ · Corwin-Schultz spread · Hawkes self-exciting intensity.
                {' '}Daily IC ≈ 0 is expected — order flow leads price by minutes-to-hours, not days; daily bars average out intra-day direction.
                {' '}Switch to <strong style={{ color: S.primary }}>Hourly</strong> for LightGBM walk-forward IC and Sharpe.
                {' '}Full methodology: <strong style={{ color: S.text }}>Export Research Brief (PDF)</strong>.
              </p>
            </div>
          )}

          {/* ── Charts (daily only) ── */}
          {resolution === 'daily' && <Card title="Signal Charts — Click to Analyse · Hover for Description">
            {FIGURES.length ? (
              <div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: selectedImg ? 20 : 0 }}>
                  {FIGURES.map((f: string) => {
                    const d = CHART_DESC[f]
                    return (
                      <Tooltip key={f} content={d ? (
                        <div>
                          <p style={{ color: '#38BDF8', fontSize: 11, fontWeight: 700, margin: '0 0 5px' }}>{d.title}</p>
                          <p style={{ color: '#CBD5E1', fontSize: 11, margin: '0 0 4px', lineHeight: 1.5 }}>{d.what}</p>
                          <p style={{ color: '#94A3B8', fontSize: 10, margin: 0, lineHeight: 1.5 }}>{d.how}</p>
                        </div>
                      ) : <span>{f}</span>}>
                        <div
                          onClick={() => selectChart(f)}
                          onMouseEnter={() => setHoveredChart(f)}
                          onMouseLeave={() => setHoveredChart(null)}
                          style={{ position: 'relative', cursor: 'pointer', borderRadius: 8, overflow: 'hidden', border: `2px solid ${selectedImg === f ? S.primary : S.border}`, transform: hoveredChart === f ? 'scale(1.02)' : 'scale(1)', transition: 'border-color 0.15s, transform 0.1s', boxShadow: selectedImg === f ? `0 0 16px ${S.primary}44` : 'none', width: 200 }}>
                          <img src={`/api/outputs/${f}`} alt={f} style={{ width: 200, height: 112, objectFit: 'cover', display: 'block', background: S.bg }} />
                          <div style={{ position: 'absolute', inset: 0, background: 'rgba(2,6,23,0.78)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, opacity: hoveredChart === f ? 1 : 0, transition: 'opacity 0.18s', pointerEvents: 'none' }}>
                            <span style={{ fontSize: 16 }}>🔍</span>
                            <span style={{ color: S.primary, fontSize: 11, fontWeight: 700 }}>Analyse with Groq AI</span>
                          </div>
                          <p style={{ color: S.text, fontSize: 9, margin: '4px 8px 6px', textAlign: 'center', lineHeight: 1.3 }}>{d?.title ?? f.replace('.png', '').replace(/_/g, ' ')}</p>
                        </div>
                      </Tooltip>
                    )
                  })}
                </div>

                {selectedImg && (() => {
                  // Map each PNG to its interactive chart + fullscreen key
                  const EXPAND_KEY: Record<string, string> = {
                    'ofi_zscore_chart.png': 'ofi',
                    'execution_quality.png': 'execution',
                    'kyle_lambda_trend.png': 'lambda',
                    'alpha_decay.png': 'decay',
                  }
                  const interactiveMap: Record<string, React.ReactNode> = {
                    'ofi_zscore_chart.png': <OFIRechartsChart S={S} />,
                    'execution_quality.png': <ExecutionQualityChart S={S} />,
                    'kyle_lambda_trend.png': <KyleLambdaChart S={S} />,
                    'alpha_decay.png': <AlphaDecayChart S={S} />,
                  }
                  const interactiveChart = interactiveMap[selectedImg]
                  const expandKey = EXPAND_KEY[selectedImg]
                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '3fr 2fr', gap: 20, alignItems: 'start' }}>
                      <div>
                        {interactiveChart ? (
                          <div style={{ background: S.surface, border: `1px solid ${S.border}`, borderRadius: 8, padding: '16px 18px' }}>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                              <button onClick={() => expandKey && setFullscreenChart(expandKey)}
                                style={{ background: S.primary, color: '#fff', border: 'none', borderRadius: 7, padding: '5px 16px', fontSize: 10, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                                <span style={{ fontSize: 13 }}>⊕</span> Expand Full Screen
                              </button>
                            </div>
                            {interactiveChart}
                          </div>
                        ) : (
                          <div style={{ position: 'relative' }}>
                            <img src={`/api/outputs/${selectedImg}`} alt={selectedImg}
                              style={{ width: '100%', borderRadius: 8, border: `1px solid ${S.border}`, display: 'block', cursor: 'zoom-in' }}
                              onClick={() => setLightboxImg(selectedImg)} />
                            <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 6 }}>
                              <button onClick={() => setLightboxImg(selectedImg)} style={{ background: `${S.bg}dd`, border: `1px solid ${S.border}`, color: S.primary, borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>⊕ Expand</button>
                              <a href={`/api/outputs/${selectedImg}`} download={selectedImg} style={{ background: `${S.bg}dd`, border: `1px solid ${S.border}`, color: S.muted, borderRadius: 6, padding: '4px 10px', fontSize: 11, textDecoration: 'none', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>Save
                              </a>
                            </div>
                          </div>
                        )}
                      </div>
                      <div style={{ background: S.bg, border: `1px solid ${S.border}`, borderRadius: 8, padding: 18, minHeight: 200 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                          <p style={{ color: S.primary, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0 }}>Groq AI Analysis</p>
                          <span style={{ color: S.muted, fontSize: 9, opacity: 0.5 }}>llama-3.3-70b · temp=0.1</span>
                        </div>
                        {CHART_DESC[selectedImg] && (
                          <div style={{ background: `${S.primary}08`, border: `1px solid ${S.primary}22`, borderRadius: 6, padding: '8px 10px', marginBottom: 12 }}>
                            <p style={{ color: S.muted, fontSize: 10, fontWeight: 700, margin: '0 0 3px' }}>{CHART_DESC[selectedImg].title}</p>
                            <p style={{ color: S.muted, fontSize: 10, margin: 0, lineHeight: 1.5, opacity: 0.65 }}>{CHART_DESC[selectedImg].what}</p>
                          </div>
                        )}
                        {explaining ? (
                          <div style={{ color: S.muted, fontSize: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ width: 14, height: 14, borderWidth: 2, borderStyle: 'solid', borderColor: S.primary, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}></div>
                            Groq is analysing…
                          </div>
                        ) : explanation ? (
                          <p style={{ color: S.text, fontSize: 13, lineHeight: 1.75, margin: 0 }}>{explanation}</p>
                        ) : (
                          <p style={{ color: S.muted, fontSize: 12, fontStyle: 'italic', margin: 0, opacity: 0.5 }}>Click a chart thumbnail to analyse with Groq AI</p>
                        )}
                        <button onClick={() => sendChatWith(`Analyse the ${CHART_DESC[selectedImg]?.title ?? selectedImg.replace('.png', '')} chart in detail. What patterns are visible and what do they mean?`)}
                          style={{ marginTop: 14, background: 'transparent', color: S.primary, border: `1px solid ${S.border}`, borderRadius: 6, padding: '5px 12px', fontSize: 10, cursor: 'pointer', fontWeight: 600 }}>Ask follow-up in Chat ›</button>
                      </div>
                    </div>
                  )
                })()}
              </div>
            ) : (<p style={{ color: S.muted, fontSize: 13, fontStyle: 'italic', margin: 0, opacity: 0.5 }}>No charts yet — run the pipeline first</p>)}
          </Card>}

          {/* ── Data Download ── */}
          <Card title="Raw Data — Download 2yr Daily OHLCV · 501 bars per ticker · Free">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10, maxHeight: 168, overflowY: 'auto', paddingRight: 4 }}>
              {Object.keys(dynTickerNames).map(t => {
                const [name, sector] = dynTickerNames[t] ?? TICKER_NAMES[t] ?? [t, 'Custom']
                const col = getSectorColor(sector, isDark)
                return (
                  <a key={t} href={`/api/data/${t}/csv`} download={`${t}_2yr_daily.csv`}
                    style={{ background: `${col}15`, border: `1px solid ${col}44`, color: col, borderRadius: 8, padding: '6px 14px', fontSize: 11, textDecoration: 'none', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                    {t} <span style={{ opacity: 0.6, fontSize: 9 }}>{name.split(' ')[0]}</span>
                  </a>
                )
              })}
            </div>
            <p style={{ color: S.muted, fontSize: 10, margin: 0, opacity: 0.5 }}>Columns: Date, open, high, low, close, volume · yfinance · 2024-06-27 to 2026-06-26 · 501 trading days · Click any ticker to download CSV</p>
          </Card>

          {/* ── Run History (daily only) ── */}
          {resolution === 'daily' && <HistoryPanel S={S} qc={qc} />}

          {/* ── Chat ── */}
          <Card title="Signal Analyst — Groq AI (Grounded in Live DB Data)">
            {chat.length === 0 && (
              <div style={{ marginBottom: 12 }}>
                <p style={{ color: S.muted, fontSize: 11, margin: '0 0 8px', opacity: 0.6 }}>Groq AI grounded in live DB. Click a signal card above to pre-fill, or try:</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {["What is Kyle's lambda and why does it matter for NVDA?", "Why is daily IC near zero?", "Compare AAPL vs V liquidity profiles", "What does JPM spread anomaly mean?", "How does hourly mode improve IC with tick data?"].map(q => (
                    <button key={q} onClick={() => prefillChat(q)}
                      style={{ background: S.surface, border: `1px solid ${S.border}`, color: S.primary, borderRadius: 20, padding: '5px 14px', fontSize: 11, cursor: 'pointer', fontWeight: 500 }}>{q}</button>
                  ))}
                </div>
              </div>
            )}
            {chat.length > 0 && (
              <div style={{ maxHeight: 360, overflowY: 'auto', marginBottom: 12, background: S.bg, borderRadius: 8, padding: 12, border: `1px solid ${S.border}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {chat.map((m, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                    <div style={{ maxWidth: '78%', padding: '9px 14px', borderRadius: 8, fontSize: 13, lineHeight: 1.65, background: m.role === 'user' ? S.primary : S.surface, color: m.role === 'user' ? '#fff' : S.text, border: m.role === 'assistant' ? `1px solid ${S.border}` : 'none' }}>{m.content}</div>
                  </div>
                ))}
                {chatLoading && <div style={{ display: 'flex', gap: 5, padding: '4px 0' }}>{[0, 1, 2].map(i => <div key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: S.primary, opacity: 0.4 + i * 0.3 }}></div>)}</div>}
                <div ref={chatEnd} />
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <input ref={chatInputRef} value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendChat()}
                placeholder="Type a question and press Enter — or click a signal card above to pre-fill"
                style={{ flex: 1, background: S.bg, color: S.text, border: `1px solid ${S.border}`, borderRadius: 8, padding: '10px 14px', fontSize: 13, outline: 'none' }} />
              <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()}
                style={{ background: chatLoading || !chatInput.trim() ? S.border : S.runBtn, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 22px', fontSize: 13, fontWeight: 700, cursor: chatLoading || !chatInput.trim() ? 'default' : 'pointer', minWidth: 80 }}>
                {chatLoading ? '…' : 'Send ↵'}
              </button>
            </div>
            <p style={{ color: S.muted, fontSize: 10, marginTop: 8, marginBottom: 0, opacity: 0.4 }}>Groq llama-3.3-70b · dual API keys (auto-fallback) · grounded in live signals DB · signal cards pre-fill input, press Enter to send</p>
          </Card>

        </div>

        <style>{`
          * { box-sizing: border-box; }
          body { margin: 0; }
          @keyframes spin  { to { transform: rotate(360deg); } }
          @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
          ::-webkit-scrollbar { width: 5px; height: 5px; }
          ::-webkit-scrollbar-track { background: ${S.bg}; }
          ::-webkit-scrollbar-thumb { background: ${S.scrollThumb}; border-radius: 3px; }
          input:focus { border-color: ${S.primary} !important; box-shadow: 0 0 0 3px ${S.primary}22; }
          button:not(:disabled):hover { opacity: 0.88; }
          a:hover { opacity: 0.8; }
        `}</style>
      </div>
      </TickerNamesCtx.Provider>
    </ThemeCtx.Provider>
  )
}
