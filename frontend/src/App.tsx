import React, { useState, useRef, useEffect, useCallback, useMemo, cloneElement, createContext, useContext } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ReferenceLine, ResponsiveContainer } from 'recharts'
import axios from 'axios'

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
}
const LIGHT_S = {
  bg: '#F0F4FF', surface: '#FFFFFF', border: '#B8CCEE',
  primary: '#1D4ED8', text: '#0F172A', muted: '#1E3A8A',
  runBtn: '#1D4ED8', tag: '#DBEAFE', cardBg: '#E8EFFF',
  tipBg: '#FFFFFF', tipBorder: '#93C5FD',
  success: '#DCFCE7', successText: '#14532D',
  error: '#FEE2E2', errorText: '#7F1D1D',
  warn: '#FEF9C3', warnText: '#713F12',
  buyBg: '#DCFCE7', buyText: '#14532D',
  sellBg: '#FEE2E2', sellText: '#7F1D1D',
  holdBg: '#FEF9C3', holdText: '#713F12',
  scrollThumb: '#B8CCEE',
}
type Theme = typeof DARK_S
const ThemeCtx = createContext<{ S: Theme; isDark: boolean }>({ S: DARK_S, isDark: true })
const useS = () => useContext(ThemeCtx).S
const useIsDark = () => useContext(ThemeCtx).isDark

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
// Per-ticker line colors — must match _TICKER_COLOR_MAP in alpha_flow/analysis/figures.py
// Alphabetical sorted assignment: AAPL(0) … V(9)
const TICKER_COLORS: Record<string, string> = {
  AAPL: '#79c0ff', AMZN: '#56d364', BAC: '#ffa657', GOOGL: '#f78166', JPM: '#d2a8ff',
  META: '#58a6ff', MSFT: '#3fb950', NVDA: '#e3b341', TSLA: '#ff7b72', V: '#bc8cff',
}
// Rotating palette for custom tickers (beyond the default 10)
const EXTRA_COLORS = ['#a5f3fc', '#fde68a', '#d9f99d', '#fbcfe8', '#e9d5ff', '#fed7aa', '#fecaca', '#bfdbfe']
function getTickerColor(ticker: string): string {
  if (TICKER_COLORS[ticker]) return TICKER_COLORS[ticker]
  const idx = ticker.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % EXTRA_COLORS.length
  return EXTRA_COLORS[idx]
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    const raw = iso.endsWith('Z') ? iso : (iso.includes('T') ? iso + 'Z' : iso + 'T00:00:00Z')
    return new Date(raw).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC'
  } catch { return iso }
}
function nowUTC() {
  return new Date().toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC'
}

// ── Components ───────────────────────────────────────────────────────────────
function Card({ title, children, accent = false, right }: { title: string; children: React.ReactNode; accent?: boolean; right?: React.ReactNode }) {
  const S = useS()
  const [hov, setHov] = useState(false)
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ background: S.surface, border: `1px solid ${accent ? S.primary : (hov ? S.primary + '33' : S.border)}`, borderRadius: 12, padding: 20, marginBottom: 16, transform: hov ? 'translateY(-1px)' : 'none', boxShadow: hov ? '0 6px 28px rgba(0,0,0,0.14)' : 'none', transition: 'transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease' }}>
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
        <div style={{ position: 'fixed', left: Math.min(pos.x, window.innerWidth - 330), top: Math.min(pos.y, window.innerHeight - 240), background: S.tipBg, border: `1px solid ${S.tipBorder}`, borderRadius: 9, padding: '10px 14px', maxWidth: 310, zIndex: 9999, pointerEvents: 'none', boxShadow: '0 12px 40px rgba(0,0,0,0.4)', fontSize: 12 }}>
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
      <span style={{ fontSize: 12, opacity: 0.6 }}>📅</span>
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
function OFIRechartsChart({ S, fullscreen = false }: { S: Theme; fullscreen?: boolean }) {
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
    refetchInterval: 60000,
    staleTime: 30000,
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
                style={{ background: hidden ? 'transparent' : `${col}20`, color: hidden ? '#475569' : col, border: `1.5px solid ${hidden ? S.border : col + '88'}`, borderRadius: 20, padding: '3px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s' }}>
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
          <div style={{ width: 14, height: 14, border: `2px solid ${S.primary}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}></div>Loading OFI data…
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
                contentStyle={{ background: S.surface, border: `1px solid ${S.border}`, borderRadius: 8, fontSize: 11, padding: '6px 12px' }}
                labelStyle={{ color: S.primary, fontWeight: 700, marginBottom: 4 }}
                labelFormatter={(v: string) => { const p = v.split('-'); return p.length === 3 ? `${p[2]} ${['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+p[1]]} '${p[0].slice(2)}` : v }}
                itemStyle={{ padding: '1px 0' }}
                formatter={(val: any, name: string) => [
                  <span key="v" style={{ color: getTickerColor(name), fontWeight: 700 }}>
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
            style={{ background: h ? 'transparent' : `${col}20`, color: h ? '#475569' : col, border: `1.5px solid ${h ? S.border : col + '88'}`, borderRadius: 20, padding: '3px 10px', fontSize: 10, fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s' }}>
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
  const [metric, setMetric] = useState<'spread' | 'amihud'>('spread')
  const [startDate, setStartDate] = useState(() => { const d = new Date(); d.setFullYear(d.getFullYear() - 2); return d.toISOString().slice(0, 10) })
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10))
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const q = useQuery({ queryKey: ['execQuality'], queryFn: () => axios.get('/api/data/execution-quality').then(r => r.data as { spread: Record<string, { date: string; value: number }[]>; amihud: Record<string, { date: string; value: number }[]> }), staleTime: 120000 })
  const tickers = useMemo(() => Object.keys(q.data?.[metric] ?? {}).sort(), [q.data, metric])
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
      {q.isLoading ? <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: S.muted, fontSize: 12, background: S.cardBg, borderRadius: 8, gap: 8 }}><div style={{ width: 14, height: 14, border: `2px solid ${S.primary}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />Loading…</div>
      : chartData.length === 0 ? <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: S.muted, fontSize: 12, fontStyle: 'italic', background: S.cardBg, borderRadius: 8 }}>No data — run pipeline first</div>
      : <div style={{ background: S.cardBg, borderRadius: 8, padding: '8px 4px 4px', border: `1px solid ${S.border}` }}>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 5, right: 16, bottom: 5, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={S.border} vertical={false} />
              <XAxis dataKey="date" tick={{ fill: S.muted, fontSize: 9 }} tickLine={false} axisLine={{ stroke: S.border }} interval={Math.max(0, Math.floor(chartData.length / 7) - 1)}
                tickFormatter={(v: string) => { const p = v.split('-'); return p.length === 3 ? `${p[1]}/${p[2]}/${p[0].slice(2)}` : v }} />
              <YAxis tick={{ fill: S.muted, fontSize: 9 }} tickLine={false} axisLine={false} />
              <RechartsTooltip contentStyle={{ background: S.surface, border: `1px solid ${S.border}`, borderRadius: 8, fontSize: 11, padding: '6px 12px' }} labelStyle={{ color: S.primary, fontWeight: 700, marginBottom: 4 }}
                labelFormatter={(v: string) => { const p = v.split('-'); return p.length === 3 ? `${p[2]} ${['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+p[1]]} '${p[0].slice(2)}` : v }}
                formatter={(val: any, name: string) => [<span key="v" style={{ color: getTickerColor(name), fontWeight: 700 }}><span style={{ opacity: 0.7, marginRight: 4 }}>{name}</span>{typeof val === 'number' ? (metric === 'spread' ? val.toFixed(1) : val.toExponential(2)) : val}</span>, null]} />
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
  const [startDate, setStartDate] = useState(() => { const d = new Date(); d.setFullYear(d.getFullYear() - 2); return d.toISOString().slice(0, 10) })
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10))
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const q = useQuery({ queryKey: ['kyleLambda'], queryFn: () => axios.get('/api/data/kyle-lambda').then(r => r.data as Record<string, { date: string; lambda: number; roll30: number }[]>), staleTime: 120000 })
  const tickers = useMemo(() => Object.keys(q.data ?? {}).sort(), [q.data])
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
      {q.isLoading ? <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: S.muted, fontSize: 12, background: S.cardBg, borderRadius: 8, gap: 8 }}><div style={{ width: 14, height: 14, border: `2px solid ${S.primary}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />Loading…</div>
      : chartData.length === 0 ? <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: S.muted, fontSize: 12, fontStyle: 'italic', background: S.cardBg, borderRadius: 8 }}>No data — run pipeline first</div>
      : <div style={{ background: S.cardBg, borderRadius: 8, padding: '8px 4px 4px', border: `1px solid ${S.border}` }}>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 5, right: 16, bottom: 5, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={S.border} vertical={false} />
              <XAxis dataKey="date" tick={{ fill: S.muted, fontSize: 9 }} tickLine={false} axisLine={{ stroke: S.border }} interval={Math.max(0, Math.floor(chartData.length / 7) - 1)}
                tickFormatter={(v: string) => { const p = v.split('-'); return p.length === 3 ? `${p[1]}/${p[2]}/${p[0].slice(2)}` : v }} />
              <YAxis tick={{ fill: S.muted, fontSize: 9 }} tickLine={false} axisLine={false} />
              <RechartsTooltip contentStyle={{ background: S.surface, border: `1px solid ${S.border}`, borderRadius: 8, fontSize: 11, padding: '6px 12px' }} labelStyle={{ color: S.primary, fontWeight: 700, marginBottom: 4 }}
                labelFormatter={(v: string) => { const p = v.split('-'); return p.length === 3 ? `${p[2]} ${['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+p[1]]} '${p[0].slice(2)}` : v }}
                formatter={(val: any, name: string) => [<span key="v" style={{ color: getTickerColor(name), fontWeight: 700 }}><span style={{ opacity: 0.7, marginRight: 4 }}>{name}</span>{typeof val === 'number' ? val.toExponential(2) : val}</span>, null]} />
              {tickers.map(t => <Line key={t} type="monotone" dataKey={t} stroke={getTickerColor(t)} strokeWidth={1.5} dot={false} hide={hidden.has(t)} isAnimationActive animationDuration={500} />)}
            </LineChart>
          </ResponsiveContainer>
        </div>}
      <p style={{ color: S.muted, fontSize: 9, textAlign: 'center', margin: '4px 0 0', opacity: 0.45 }}>Kyle λ (1985) · 30-day rolling mean · $/share price impact per unit of order flow · rising λ = less liquid</p>
    </div>
  )
}

function AlphaDecayChart({ S }: { S: Theme }) {
  const [sel, setSel] = useState('average')
  const tickerNames = useContext(TickerNamesCtx)
  const q = useQuery({ queryKey: ['alphaDecay'], queryFn: () => axios.get('/api/data/alpha-decay').then(r => r.data as { by_ticker: Record<string, Record<number, number>>; average: Record<number, number> }), staleTime: 120000 })
  const tickers = useMemo(() => Object.keys(q.data?.by_ticker ?? {}).sort(), [q.data])
  const chartData = useMemo(() => {
    if (!q.data) return []
    const src = sel === 'average' ? q.data.average : (q.data.by_ticker[sel] ?? q.data.average)
    return Array.from({ length: 10 }, (_, i) => i + 1).map(lag => ({ lag: `${lag}d`, ic: src[lag] ?? 0 }))
  }, [q.data, sel])
  return (
    <div>
      <div style={{ display: 'flex', gap: 5, marginBottom: 10, flexWrap: 'wrap' }}>
        <button onClick={() => setSel('average')} style={{ background: sel === 'average' ? S.primary : S.surface, color: sel === 'average' ? '#fff' : S.muted, border: `1.5px solid ${sel === 'average' ? S.primary : S.border}`, borderRadius: 20, padding: '3px 12px', fontSize: 10, fontWeight: sel === 'average' ? 700 : 500, cursor: 'pointer', transition: 'all 0.15s' }}>Avg</button>
        {tickers.map(t => <button key={t} onClick={() => setSel(t)} title={tickerNames[t]?.[0] ?? t} style={{ background: sel === t ? getTickerColor(t) : S.surface, color: sel === t ? '#fff' : S.muted, border: `1.5px solid ${sel === t ? getTickerColor(t) : S.border}`, borderRadius: 20, padding: '3px 10px', fontSize: 10, fontWeight: sel === t ? 700 : 500, cursor: 'pointer', transition: 'all 0.15s' }}>{t}</button>)}
      </div>
      {q.isLoading ? <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: S.muted, fontSize: 12, background: S.cardBg, borderRadius: 8, gap: 8 }}><div style={{ width: 14, height: 14, border: `2px solid ${S.primary}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />Loading…</div>
      : chartData.length === 0 ? <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: S.muted, fontSize: 12, fontStyle: 'italic', background: S.cardBg, borderRadius: 8 }}>No data — run pipeline first</div>
      : <div style={{ background: S.cardBg, borderRadius: 8, padding: '8px 4px 4px', border: `1px solid ${S.border}` }}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} margin={{ top: 5, right: 16, bottom: 5, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={S.border} vertical={false} />
              <XAxis dataKey="lag" tick={{ fill: S.muted, fontSize: 9 }} tickLine={false} axisLine={{ stroke: S.border }} />
              <YAxis tick={{ fill: S.muted, fontSize: 9 }} tickLine={false} axisLine={false} domain={[-0.15, 0.15]} />
              <RechartsTooltip contentStyle={{ background: S.surface, border: `1px solid ${S.border}`, borderRadius: 8, fontSize: 11, padding: '6px 12px' }} labelStyle={{ color: S.primary, fontWeight: 700 }}
                formatter={(val: any) => [<span key="v" style={{ color: Number(val) >= 0 ? '#56d364' : '#f78166', fontWeight: 700 }}>{typeof val === 'number' ? val.toFixed(4) : val}</span>, 'IC']} />
              <ReferenceLine y={0.05} stroke="#ffa657" strokeDasharray="5 3" strokeOpacity={0.7} strokeWidth={1} />
              <ReferenceLine y={-0.05} stroke="#ffa657" strokeDasharray="5 3" strokeOpacity={0.7} strokeWidth={1} />
              <ReferenceLine y={0} stroke={S.border} strokeWidth={1} />
              <Bar dataKey="ic" isAnimationActive animationDuration={600} radius={[3, 3, 0, 0]}>
                {chartData.map((e, i) => <Cell key={i} fill={e.ic >= 0 ? '#56d364' : '#f78166'} fillOpacity={0.85} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>}
      <p style={{ color: S.muted, fontSize: 9, textAlign: 'center', margin: '4px 0 0', opacity: 0.45 }}>Spearman IC · OFI Z vs forward returns · ±0.05 significance · IC ≈ 0 is expected in Phase 1 (daily OHLCV)</p>
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
    refetchInterval: 10000,
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
            : 'No runs yet — click Run Pipeline above'}
        </p>
      ) : !history.data?.length ? (
        <p style={{ color: S.muted, fontStyle: 'italic', opacity: 0.5, fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
          No runs yet — click Run Pipeline
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
                  <span style={{ color: S.primary, fontWeight: 800, fontSize: 13, minWidth: 50 }}>Run #{row.id}</span>
                  <StatusBadge s={row.status || 'running'} />
                  <span style={{ color: S.text, fontSize: 11, flex: 1 }}>{formatTime(row.started_at)}</span>
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
  const signalsQ = useQuery({
    queryKey: ['runSignals', runId],
    queryFn: () => axios.get(`/api/history/${runId}/signals`).then(r => r.data as any[]),
    staleTime: 300000,
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
          <div style={{ width: 12, height: 12, border: `2px solid ${S.primary}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
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
                    const ofiColor = ofi > 0.15 ? '#86EFAC' : ofi < -0.15 ? '#FCA5A5' : S.muted
                    return (
                      <div key={s.ticker} style={{ background: S.surface, border: `1px solid ${col}`, borderRadius: 8, padding: '10px 12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                          <span style={{ color: S.text, fontWeight: 800, fontSize: 13 }}>{s.ticker}</span>
                          <SignalBadge sig={s.signal ?? 'HOLD'} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '3px 6px', fontSize: 10 }}>
                          <span style={{ color: S.muted }}>OFI Z</span>
                          <span style={{ color: ofiColor, fontWeight: 600, textAlign: 'right' }}>{ofiDir} {ofi.toFixed(3)}</span>
                          <span style={{ color: S.muted }}>Spread</span>
                          <span style={{ color: S.text, textAlign: 'right' }}>{Number(s.eff_spread_bps ?? 0).toFixed(1)} bps</span>
                          <span style={{ color: S.muted }}>Kyle λ</span>
                          <span style={{ color: S.text, textAlign: 'right' }}>{Number(s.kyle_lambda ?? 0).toExponential(1)}</span>
                          <span style={{ color: S.muted }}>Amihud</span>
                          <span style={{ color: S.text, textAlign: 'right' }}>{Number(s.amihud_illiq ?? 0).toExponential(1)}</span>
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
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
                    {[['OFI Z', Number(s.ofi ?? 0).toFixed(3)], ['Spread', `${Number(s.eff_spread_bps ?? 0).toFixed(1)} bps`], ['Kyle λ', Number(s.kyle_lambda ?? 0).toExponential(1)], ['Amihud', Number(s.amihud_illiq ?? 0).toExponential(1)], ...(s.ic_value != null ? [['IC', Number(s.ic_value).toFixed(4)]] : [])].map(([k, v]) => (
                      <React.Fragment key={k}><span style={{ color: S.muted, fontSize: 9 }}>{k}</span><span style={{ color: S.text, fontSize: 10, textAlign: 'right' }}>{v}</span></React.Fragment>
                    ))}
                  </div>
                  {s.llm_reason && <p style={{ color: S.muted, fontSize: 9, margin: 0, lineHeight: 1.4, fontStyle: 'italic', borderTop: `1px solid ${S.border}33`, paddingTop: 5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{(s.llm_reason as string).replace(/LLM unavailable: Error code: \d+ - \{[\s\S]*\}/, 'Groq rate limit \u2014 re-run when tokens reset').replace(/LLM unavailable: /, '').slice(0, 130)}</p>}
                </div>
              )
            })}
          </div>
        )}

        {/* Interactive charts — NOT stale PNG thumbnails */}
        <h3 style={{ color: S.muted, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 12px' }}>Research Output — Interactive Charts</h3>
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
const TIP_OFI = (<div><p style={{ color: '#38BDF8', fontSize: 11, fontWeight: 700, margin: '0 0 4px' }}>Order Flow Imbalance Z-score</p><p style={{ color: '#475569', fontSize: 10, fontFamily: 'monospace', margin: '0 0 5px' }}>OFI = V_buy − V_sell; Z = (OFI − μ₂₀)/σ₂₀</p><p style={{ color: '#CBD5E1', fontSize: 11, margin: 0 }}>Net buy vs sell volume pressure, rolling 20-bar. &gt;+1.5 = strong buying; &lt;−1.5 = strong selling.</p></div>)
const TIP_SPREAD = (<div><p style={{ color: '#38BDF8', fontSize: 11, fontWeight: 700, margin: '0 0 4px' }}>Corwin-Schultz Effective Spread</p><p style={{ color: '#475569', fontSize: 10, fontFamily: 'monospace', margin: '0 0 5px' }}>α = f(β, γ) of daily log(H/L) ratios</p><p style={{ color: '#CBD5E1', fontSize: 11, margin: 0 }}>Estimated cost to cross bid-ask spread (bps). S&P 500 large-caps: 5–25 bps typical. Red = elevated liquidity stress.</p></div>)
const TIP_KYLE = (<div><p style={{ color: '#38BDF8', fontSize: 11, fontWeight: 700, margin: '0 0 4px' }}>Kyle&apos;s Lambda — Price Impact</p><p style={{ color: '#475569', fontSize: 10, fontFamily: 'monospace', margin: '0 0 5px' }}>Δp_t = λ · OFI_t + ε (rolling 20-bar OLS)</p><p style={{ color: '#CBD5E1', fontSize: 11, margin: 0 }}>$/share price move per unit of net order flow. Higher λ = each trade has more price impact = less liquid.</p><p style={{ color: '#334155', fontSize: 9, margin: '4px 0 0' }}>📚 Kyle, Econometrica (1985)</p></div>)
const TIP_AMIHUD = (<div><p style={{ color: '#38BDF8', fontSize: 11, fontWeight: 700, margin: '0 0 4px' }}>Amihud Illiquidity Ratio</p><p style={{ color: '#475569', fontSize: 10, fontFamily: 'monospace', margin: '0 0 5px' }}>ILLIQ_t = |r_t| / DollarVolume_t</p><p style={{ color: '#CBD5E1', fontSize: 11, margin: '0 0 5px' }}>Price change per $1M of traded volume. Liquid large-caps &lt; 1×10⁻⁷. Spike = institutional block trade / low depth.</p><p style={{ color: '#334155', fontSize: 9, margin: 0 }}>📚 Amihud, JFM (2002)</p></div>)
const TIP_SHARPE = (<div><p style={{ color: '#38BDF8', fontSize: 11, fontWeight: 700, margin: '0 0 4px' }}>Sharpe Ratio — Per Ticker</p><p style={{ color: '#475569', fontSize: 10, fontFamily: 'monospace', margin: '0 0 5px' }}>Sharpe = √252 × μ / σ (annualised)</p><p style={{ color: '#CBD5E1', fontSize: 11, margin: '0 0 5px' }}>Risk-adjusted return of each stock over the walk-forward test windows. Sharpe &gt; 1 = strong. Sharpe &lt; 0 = the stock declined in the test period. This reflects the STOCK's performance, not the signal's quality.</p><p style={{ color: '#334155', fontSize: 9, margin: '4px 0 0' }}>📚 Sharpe (1994) J. Portfolio Mgmt, 21(1), 49–58.</p></div>)

const METRIC_META: Record<string, { label: string; unit: string; help: string; formula: string; ref: string }> = {
  avg_effective_spread_bps: { label: 'Eff. Spread', unit: 'bps', formula: 'Corwin-Schultz (2012)', help: 'Average C-S spread across 10 tickers. S&P 500: 5–25 bps typical. Daily OHLCV gives ~30–70 bps (wider than intraday).', ref: 'Corwin & Schultz, JF (2012)' },
  avg_amihud_illiq: { label: 'Amihud ILLIQ', unit: 'Δprice / $1M vol', formula: 'ILLIQ_t = |r_t| / DollarVol_t', help: 'Price impact per $1M of traded volume. Liquid large-caps < 1×10⁻⁷. Higher = less liquid.', ref: 'Amihud, JFM (2002)' },
  avg_kyle_lambda: { label: "Kyle's λ", unit: '$/share per OFI unit', formula: 'Δp_t = λ·x_t + ε (rolling OLS)', help: 'Price impact coefficient. Each unit of net order flow moves price by λ. Higher = less liquid market depth.', ref: 'Kyle, Econometrica (1985)' },
  ofi_predictive_ic: { label: 'OFI IC', unit: 'Spearman ρ', formula: 'Spearman(OFI_z_t, r[t+1])', help: 'Signal quality. IC > 0.05 = significant. Phase 1 IC ≈ 0 is expected — daily OHLCV cannot resolve intra-bar direction.', ref: 'Grinold & Kahn (2000)' },
}

const CHART_DESC: Record<string, { title: string; what: string; how: string }> = {
  'ofi_zscore_chart.png': { title: 'OFI Z-score Monitor', what: 'Net buy/sell pressure for all 10 tickers, last 60 bars. Amber dashed = ±1.5σ thresholds.', how: 'Rolling 20-bar OFI Z-score from daily OHLCV. Crossings above ±1.5σ trigger BUY/SELL. Click to expand + filter tickers.' },
  'execution_quality.png': { title: 'Execution Quality', what: 'Corwin-Schultz spread (bps) and Amihud illiquidity over 2 years.', how: 'Spread spikes = earnings/macro events. Amihud spikes = institutional block trades reducing market depth.' },
  'kyle_lambda_trend.png': { title: "Kyle's λ Trend", what: 'Price impact coefficient over 2 years (30-day rolling mean).', how: 'Rising λ = market depth declining. High λ periods = elevated institutional participation or low liquidity.' },
  'alpha_decay.png': { title: 'Alpha Decay (IC Lags 1–10)', what: 'Spearman IC between OFI Z-score and forward returns at 1–10 day horizons.', how: 'Rapid IC decay = microstructure alpha is short-lived (intraday only). Amber lines = ±0.05 significance.' },
}

type ChatMsg = { role: 'user' | 'assistant'; content: string }

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const qc = useQueryClient()
  const [isDark, setIsDark] = useState(true)
  const S = isDark ? DARK_S : LIGHT_S

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

  // Dynamic ticker registry (default 10 + any custom tickers added via UI)
  const tickerInfoQuery = useQuery({
    queryKey: ['allTickers'],
    queryFn: () => axios.get('/api/tickers').then(r => r.data as { ticker: string; name: string; sector: string; is_custom: boolean }[]),
    refetchInterval: 60000, staleTime: 30000,
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

  const health = useQuery({ queryKey: ['health'], queryFn: () => axios.get('/health').then(r => r.data), refetchInterval: 30000 })
  const history = useQuery({ queryKey: ['history'], queryFn: () => axios.get('/api/history?limit=10').then(r => r.data as any[]), refetchInterval: 5000 })
  const allSignals = useQuery({ queryKey: ['allSignals'], queryFn: () => axios.get('/api/signals/all').then(r => r.data), refetchInterval: 10000 })
  const outputs = useQuery({ queryKey: ['outputs'], queryFn: () => axios.get('/api/outputs').then(r => r.data as { figures: string[]; reports: string[] }), refetchInterval: 10000 })
  const report = useQuery({
    queryKey: ['report'],
    queryFn: async () => {
      const o = await axios.get('/api/outputs')
      const rf = (o.data.reports as string[])?.find((r: string) => r.endsWith('.json'))
      if (!rf) return null
      return axios.get(`/api/outputs/${rf}`).then(r => r.data)
    },
    refetchInterval: 15000,
  })

  const isRunning = history.data?.some((r: any) => r.status === 'running') ?? false

  const run = useMutation({
    mutationFn: () => axios.post('/api/run'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['history'] })
      qc.invalidateQueries({ queryKey: ['allSignals'] })
      qc.invalidateQueries({ queryKey: ['outputs'] })
      qc.invalidateQueries({ queryKey: ['report'] })
      setSelectedImg(null); setExplanation(null)
    },
  })

  const refreshData = useMutation({
    mutationFn: () => axios.post('/api/data/refresh'),
    onSuccess: () => setRefreshedAt(Date.now()),
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
    } catch (err: any) {
      console.error(`Delete ${t} failed:`, err?.response?.data?.detail)
    }
  }

  async function sendChat() {
    const msg = chatInput.trim(); if (!msg || chatLoading) return
    setChatInput('')
    const next: ChatMsg[] = [...chat, { role: 'user', content: msg }]
    setChat(next); setChatLoading(true)
    try { const r = await axios.post('/api/chat', { message: msg, history: chat }); setChat([...next, { role: 'assistant', content: r.data.reply }]) }
    catch { setChat([...next, { role: 'assistant', content: 'Unable to reach API — is backend running on port 8002?' }]) }
    finally { setChatLoading(false) }
  }

  async function sendChatWith(msg: string) {
    if (!msg || chatLoading) return; setChatInput('')
    const next: ChatMsg[] = [...chat, { role: 'user', content: msg }]
    setChat(next); setChatLoading(true)
    try { const r = await axios.post('/api/chat', { message: msg, history: chat }); setChat([...next, { role: 'assistant', content: r.data.reply }]) }
    catch { setChat([...next, { role: 'assistant', content: 'Unable to reach API — is backend running on port 8002?' }]) }
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

  const metrics = report.data?.metrics ?? null
  const allSigEntries: any[] = Array.isArray(allSignals.data) ? allSignals.data : []
  const FIGURES = (outputs.data?.figures ?? []).filter((f: string) => f !== 'ofi_zscore_chart_filtered.png')

  return (
    <ThemeCtx.Provider value={{ S, isDark }}>
      <TickerNamesCtx.Provider value={dynTickerNames}>
      <div style={{ background: S.bg, minHeight: '100vh', color: S.text, fontFamily: "'Inter', system-ui, sans-serif", fontSize: 14 }}>

        {fullscreenChart && (() => {
          const fsMap: Record<string, { title: string; node: React.ReactNode }> = {
            ofi:       { title: 'OFI Z-score Monitor — Full Screen', node: <OFIRechartsChart S={S} fullscreen /> },
            execution: { title: 'Execution Quality — Full Screen', node: <ExecutionQualityChart S={S} /> },
            lambda:    { title: "Kyle's λ Trend — Full Screen", node: <KyleLambdaChart S={S} /> },
            decay:     { title: 'Alpha Decay (IC Lags 1–10) — Full Screen', node: <AlphaDecayChart S={S} /> },
          }
          const c = fsMap[fullscreenChart]
          return c ? <ChartLightbox title={c.title} onClose={() => setFullscreenChart(null)}>{c.node}</ChartLightbox> : null
        })()}
        {lightboxImg && (
          <Lightbox src={`/api/outputs/${lightboxImg}`} title={lightboxImg} onClose={() => setLightboxImg(null)} />
        )}
        {/* ── Header ── */}
        <div style={{ background: S.surface, borderBottom: `2px solid ${S.primary}44`, padding: '14px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100 }}>
          <div>
            <h1 style={{ color: S.primary, fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>
              AlphaFlow <span style={{ color: S.border }}>·</span>{' '}
              <span style={{ color: S.muted, fontSize: 13, fontWeight: 400 }}>Market Microstructure Alpha Engine</span>
            </h1>
            <p style={{ color: S.muted, fontSize: 11, margin: '2px 0 0', opacity: 0.65 }}>
              5 signals: OFI Z · Kyle λ · Amihud ILLIQ · C-S Spread · Walk-forward IC · {totalTickerCount} tickers · 2yr daily OHLCV · LightGBM + Groq LLM
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={() => setIsDark(!isDark)}
              style={{ background: S.tag, color: S.primary, border: `1px solid ${S.border}`, borderRadius: 8, padding: '5px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              {isDark ? '☀ Light' : '🌙 Dark'}
            </button>
            <span style={{ color: S.muted, fontSize: 11, opacity: 0.55 }}>{clock}</span>
            {isRunning && (
              <span style={{ color: S.primary, fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: S.primary, animation: 'pulse 1.4s ease-in-out infinite' }}></div>
                Pipeline running…
              </span>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: health.data ? '#22C55E' : '#EF4444', boxShadow: health.data ? '0 0 8px #22C55E88' : 'none' }}></div>
              <span style={{ color: health.data ? '#86EFAC' : '#FCA5A5', fontSize: 12, fontWeight: 600 }}>{health.data ? 'API Online' : 'API Offline'}</span>
            </div>
          </div>
        </div>

        <div style={{ padding: '24px 32px', maxWidth: 1380, margin: '0 auto' }}>

          {/* ── Pipeline + Metrics ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16, marginBottom: 16 }}>
            <Card title="Pipeline Control" accent>
              <button onClick={() => run.mutate()} disabled={run.isPending || isRunning}
                style={{ background: run.isPending || isRunning ? S.border : S.runBtn, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 22px', fontSize: 13, fontWeight: 700, cursor: run.isPending || isRunning ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 8, width: '100%', justifyContent: 'center' }}>
                {run.isPending || isRunning
                  ? <><div style={{ width: 12, height: 12, border: '2px solid #fff4', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}></div>Running…</>
                  : <><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>Run Pipeline</>}
              </button>
              {run.isError && <p style={{ color: '#FCA5A5', fontSize: 11, marginTop: 8, marginBottom: 0 }}>✗ Error — check terminal logs</p>}
              <button onClick={() => refreshData.mutate()} disabled={refreshData.isPending}
                style={{ background: refreshDone ? `${S.primary}18` : 'transparent', color: refreshDone ? S.primary : S.muted, border: `1px solid ${refreshDone ? S.primary + '44' : S.border}`, borderRadius: 8, padding: '7px 12px', fontSize: 11, fontWeight: 600, cursor: refreshData.isPending ? 'default' : 'pointer', width: '100%', marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all 0.3s' }}>
                {refreshData.isPending
                  ? <><div style={{ width: 10, height: 10, border: `2px solid ${S.muted}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}></div>{refreshLabel}</>
                  : refreshLabel}
              </button>
              {history.data?.[0] && (
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${S.border}` }}>
                  <p style={{ color: S.muted, fontSize: 10, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Last Run</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <StatusBadge s={history.data[0].status} />
                    <span style={{ color: S.muted, fontSize: 11 }}>{formatTime(history.data[0].started_at).split(',')[0]}</span>
                  </div>
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
                {addTickerMsg && <p style={{ color: addTickerMsg.ok ? '#86EFAC' : '#FCA5A5', fontSize: 10, margin: '5px 0 0', lineHeight: 1.4 }}>{addTickerMsg.text}</p>}
                <p style={{ color: S.muted, fontSize: 9, margin: '4px 0 0', opacity: 0.45 }}>Downloads 2yr OHLCV · refresh + re-run pipeline</p>
                {customTickersList.length > 0 && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${S.border}` }}>
                    <p style={{ color: S.muted, fontSize: 10, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Custom Tickers</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {customTickersList.map(t => (
                        <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 3, background: `${getTickerColor(t)}18`, border: `1px solid ${getTickerColor(t)}44`, borderRadius: 5, padding: '3px 6px' }}>
                          <span style={{ color: getTickerColor(t), fontWeight: 700, fontSize: 11 }}>{t}</span>
                          <button onClick={() => handleDeleteTicker(t)} title={`Remove ${t}`}
                            style={{ background: 'transparent', border: 'none', color: '#FCA5A5', cursor: 'pointer', padding: 0, fontSize: 11, lineHeight: 1 }}>✕</button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Card>

            <Card title="Live Microstructure Metrics — 10 Tickers · 2yr Daily OHLCV (501 bars · 2024-06-27 to 2026-06-26)">
              {metrics ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                  {Object.entries(METRIC_META).map(([key, meta]) => {
                    const raw = metrics[key]; const val = typeof raw === 'object' ? raw?.value : raw
                    const isLowIC = key === 'ofi_predictive_ic' && (val == null || Math.abs(val) < 0.05)
                    const formatted = val != null ? (Math.abs(val) < 0.001 ? Number(val).toExponential(2) : Number(val).toFixed(key === 'ofi_predictive_ic' ? 4 : 2)) : '—'
                    return (
                      <Tooltip key={key} content={
                        <div>
                          <p style={{ color: '#38BDF8', fontSize: 11, fontWeight: 700, margin: '0 0 5px' }}>{meta.label}</p>
                          <p style={{ color: '#475569', fontSize: 10, fontFamily: 'monospace', margin: '0 0 6px', background: '#050D20', padding: '3px 7px', borderRadius: 4 }}>{meta.formula}</p>
                          <p style={{ color: '#CBD5E1', fontSize: 11, margin: '0 0 5px', lineHeight: 1.5 }}>{meta.help}</p>
                          {isLowIC && <p style={{ color: '#FCA5A5', fontSize: 10, margin: '4px 0 0' }}>⚠ Phase 1 limit — Phase 2 tick data targets IC &gt; 0.05</p>}
                          <p style={{ color: '#334155', fontSize: 9, margin: '5px 0 0' }}>📚 {meta.ref}</p>
                        </div>
                      }>
                        <div style={{ background: S.bg, border: `1px solid ${isLowIC ? '#713f12' : S.border}`, borderRadius: 8, padding: '12px 14px', transition: 'transform 0.15s ease, box-shadow 0.15s ease' }}
                          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLDivElement).style.boxShadow = '0 6px 20px rgba(0,0,0,0.18)' }}
                          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = 'none'; (e.currentTarget as HTMLDivElement).style.boxShadow = 'none' }}>
                          <p style={{ color: S.muted, fontSize: 10, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{meta.label} <span style={{ opacity: 0.4 }}>ⓘ</span></p>
                          <p style={{ color: isLowIC ? S.muted : S.primary, fontSize: 18, fontWeight: 800, margin: '0 0 4px', fontVariantNumeric: 'tabular-nums', opacity: isLowIC ? 0.4 : 1 }}>{formatted}</p>
                          <p style={{ color: S.muted, fontSize: 9, margin: 0, opacity: 0.5 }}>{meta.unit}</p>
                        </div>
                      </Tooltip>
                    )
                  })}
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                  {Object.entries(METRIC_META).map(([k, m]) => (
                    <div key={k} style={{ background: S.bg, border: `1px solid ${S.border}`, borderRadius: 8, padding: '12px 14px', opacity: 0.35 }}>
                      <p style={{ color: S.muted, fontSize: 10, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{m.label}</p>
                      <p style={{ color: S.border, fontSize: 18, fontWeight: 800, margin: '0 0 4px' }}>—</p>
                      <p style={{ color: S.border, fontSize: 9, margin: 0 }}>Run pipeline first</p>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Combined Panel: Signal Distribution + Portfolio Backtest ── */}
              {allSigEntries.length > 0 && (() => {
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
                    {/* ── Signal Distribution Row ── */}
                    <p style={{ color: S.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 10px', opacity: 0.6 }}>Signal Distribution · Latest Run</p>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
                      <div style={{ background: S.buyBg, border: `1px solid ${S.buyText}44`, borderRadius: 7, padding: '6px 14px', textAlign: 'center', minWidth: 52 }}>
                        <p style={{ color: S.buyText, fontSize: 18, fontWeight: 800, margin: 0, lineHeight: 1 }}>{buys}</p>
                        <p style={{ color: S.buyText, fontSize: 8, margin: '3px 0 0', fontWeight: 700, letterSpacing: '0.08em' }}>BUY</p>
                      </div>
                      <div style={{ background: S.holdBg, border: `1px solid ${S.holdText}44`, borderRadius: 7, padding: '6px 14px', textAlign: 'center', minWidth: 52 }}>
                        <p style={{ color: S.holdText, fontSize: 18, fontWeight: 800, margin: 0, lineHeight: 1 }}>{holds}</p>
                        <p style={{ color: S.holdText, fontSize: 8, margin: '3px 0 0', fontWeight: 700, letterSpacing: '0.08em' }}>HOLD</p>
                      </div>
                      <div style={{ background: S.sellBg, border: `1px solid ${S.sellText}44`, borderRadius: 7, padding: '6px 14px', textAlign: 'center', minWidth: 52 }}>
                        <p style={{ color: S.sellText, fontSize: 18, fontWeight: 800, margin: 0, lineHeight: 1 }}>{sells}</p>
                        <p style={{ color: S.sellText, fontSize: 8, margin: '3px 0 0', fontWeight: 700, letterSpacing: '0.08em' }}>SELL</p>
                      </div>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 4 }}>
                        {topTicker && <p style={{ color: S.muted, fontSize: 9, margin: 0 }}>▲ <span style={{ color: '#86EFAC', fontWeight: 700 }}>{topTicker.ticker}</span> OFI {Number(topTicker.ofi).toFixed(3)}</p>}
                        {bottomTicker && <p style={{ color: S.muted, fontSize: 9, margin: 0 }}>▼ <span style={{ color: '#FCA5A5', fontWeight: 700 }}>{bottomTicker.ticker}</span> OFI {Number(bottomTicker.ofi).toFixed(3)}</p>}
                        <p style={{ color: S.muted, fontSize: 9, margin: 0 }}>Universe: <span style={{ color: S.text, fontWeight: 600 }}>{allSigEntries.length} tickers</span> · LightGBM + Groq LLM</p>
                      </div>
                    </div>

                    {/* ── Portfolio Backtest Strip ── */}
                    {portSharpe != null && (
                      <>
                        <p style={{ color: S.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 8px', opacity: 0.6 }}>
                          Long-Short Backtest · Top-2 OFI Long / Bottom-2 Short · Walk-forward
                        </p>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                          <Tooltip content={<div><p style={{ color: '#38BDF8', fontSize: 11, fontWeight: 700, margin: '0 0 4px' }}>Sharpe Ratio</p><p style={{ color: '#475569', fontSize: 10, fontFamily: 'monospace', margin: '0 0 5px' }}>Sharpe = √252 × μ / σ (annualised)</p><p style={{ color: '#CBD5E1', fontSize: 11, margin: 0 }}>Risk-adjusted return. A Sharpe &gt; 1 is good; &gt; 2 is excellent. Negative = strategy loses value after accounting for volatility. Phase 1 IC ≈ 0 explains negative Sharpe here.</p><p style={{ color: '#334155', fontSize: 9, margin: '4px 0 0' }}>📚 Sharpe (1994) J. Portfolio Mgmt.</p></div>}>
                            <div style={{ background: S.bg, border: `1px solid ${portSharpe >= 0 ? S.border : '#7f1d1d55'}`, borderRadius: 7, padding: '8px 10px', cursor: 'help' }}>
                              <p style={{ color: S.muted, fontSize: 8, margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Sharpe <span style={{ opacity: 0.4 }}>ⓘ</span></p>
                              <p style={{ color: portSharpe >= 0 ? '#86EFAC' : '#FCA5A5', fontSize: 15, fontWeight: 800, margin: 0, fontVariantNumeric: 'tabular-nums' }}>{portSharpe >= 0 ? '+' : ''}{portSharpe.toFixed(3)}</p>
                              <p style={{ color: S.muted, fontSize: 8, margin: '2px 0 0', opacity: 0.45 }}>annualised</p>
                            </div>
                          </Tooltip>
                          <Tooltip content={<div><p style={{ color: '#38BDF8', fontSize: 11, fontWeight: 700, margin: '0 0 4px' }}>Sortino Ratio</p><p style={{ color: '#475569', fontSize: 10, fontFamily: 'monospace', margin: '0 0 5px' }}>Sortino = √252 × μ / σ_downside</p><p style={{ color: '#CBD5E1', fontSize: 11, margin: 0 }}>Like Sharpe but only penalises DOWNSIDE volatility — upside variance is good! A Sortino &gt; 2 is strong. Better metric than Sharpe for asymmetric alpha strategies.</p><p style={{ color: '#334155', fontSize: 9, margin: '4px 0 0' }}>📚 Sortino &amp; van der Meer (1991) J. Portfolio Mgmt.</p></div>}>
                            <div style={{ background: S.bg, border: `1px solid ${(portSortino ?? 0) >= 0 ? S.border : '#7f1d1d55'}`, borderRadius: 7, padding: '8px 10px', cursor: 'help' }}>
                              <p style={{ color: S.muted, fontSize: 8, margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Sortino <span style={{ opacity: 0.4 }}>ⓘ</span></p>
                              <p style={{ color: (portSortino ?? 0) >= 0 ? '#86EFAC' : '#FCA5A5', fontSize: 15, fontWeight: 800, margin: 0, fontVariantNumeric: 'tabular-nums' }}>{portSortino != null ? `${portSortino >= 0 ? '+' : ''}${portSortino.toFixed(3)}` : '—'}</p>
                              <p style={{ color: S.muted, fontSize: 8, margin: '2px 0 0', opacity: 0.45 }}>downside-adj</p>
                            </div>
                          </Tooltip>
                          <Tooltip content={<div><p style={{ color: '#38BDF8', fontSize: 11, fontWeight: 700, margin: '0 0 4px' }}>Max Drawdown</p><p style={{ color: '#475569', fontSize: 10, fontFamily: 'monospace', margin: '0 0 5px' }}>MDD = min((E_t − peak_t) / peak_t)</p><p style={{ color: '#CBD5E1', fontSize: 11, margin: 0 }}>Worst peak-to-trough loss in the equity curve. −12% means the strategy lost 12% from its best point. Used for position sizing: Kelly/half-Kelly require knowing max drawdown.</p><p style={{ color: '#334155', fontSize: 9, margin: '4px 0 0' }}>📚 Grinold &amp; Kahn (2000) Active Portfolio Mgmt. Ch.14</p></div>}>
                            <div style={{ background: S.bg, border: `1px solid ${(portMDD ?? 0) > -0.1 ? S.border : '#7f1d1d55'}`, borderRadius: 7, padding: '8px 10px', cursor: 'help' }}>
                              <p style={{ color: S.muted, fontSize: 8, margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Max DD <span style={{ opacity: 0.4 }}>ⓘ</span></p>
                              <p style={{ color: (portMDD ?? 0) > -0.1 ? '#FDE68A' : '#FCA5A5', fontSize: 15, fontWeight: 800, margin: 0, fontVariantNumeric: 'tabular-nums' }}>{portMDD != null ? `${(portMDD * 100).toFixed(1)}%` : '—'}</p>
                              <p style={{ color: S.muted, fontSize: 8, margin: '2px 0 0', opacity: 0.45 }}>peak-to-trough</p>
                            </div>
                          </Tooltip>
                        </div>
                        <p style={{ color: S.muted, fontSize: 8, margin: '8px 0 0', opacity: 0.4, lineHeight: 1.5 }}>
                          ⚠ Phase 1 note: Sharpe and Sortino are negative because OFI IC ≈ 0 on daily bars — signal has no predictive power at this resolution. Phase 2 (tick data) targets Sharpe &gt; 0.5 and IC &gt; 0.05.
                        </p>
                      </>
                    )}
                  </div>
                )
              })()}
            </Card>
          </div>

          {/* ── Signal Cards ── */}
          {allSigEntries.length > 0 && (
            <Card
              title={`Ticker Signal Cards — ${allSigEntries.length} Tickers · Latest Run · All 5 Microstructure Signals`}
              right={<span style={{ color: S.muted, fontSize: 10, opacity: 0.55 }}>Click card → pre-fills chat input (press Enter to send) ›</span>}
            >
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))', gap: 10 }}>
                {allSigEntries.map((s: any) => {
                  const [name, sector] = dynTickerNames[s.ticker] ?? [s.ticker, 'Custom']
                  const isCustom = customTickersList.includes(s.ticker)
                  const ofi = Number(s.ofi ?? 0)
                  const ofiDir = ofi > 0.15 ? '▲' : ofi < -0.15 ? '▼' : '→'
                  const ofiColor = ofi > 0.15 ? '#86EFAC' : ofi < -0.15 ? '#FCA5A5' : S.muted
                  const sp = Number(s.eff_spread_bps ?? 0)
                  const spColor = sp > 50 ? '#FCA5A5' : sp > 25 ? '#FDE68A' : '#86EFAC'
                  const sharpe = Number(s.sharpe ?? 0)
                  const sharpeColor = sharpe >= 1 ? '#86EFAC' : sharpe >= 0 ? '#FDE68A' : '#FCA5A5'
                  const borderCol = getTickerColor(s.ticker)
                  // Clean up LLM reason — strip verbose API error JSON
                  const rawReason = s.llm_reason ?? ''
                  const llmReason = rawReason.startsWith('LLM unavailable') || rawReason.startsWith('Groq')
                    ? rawReason.replace(/LLM unavailable:\s*Error code:\s*\d+\s*-\s*\{.*\}/s, 'Groq rate limit — re-run when tokens reset')
                         .replace(/LLM unavailable:\s*/g, '')
                         .slice(0, 120)
                    : rawReason.slice(0, 120)
                  return (
                    <div key={s.ticker}
                      style={{ background: S.cardBg, border: `1px solid ${borderCol}`, borderRadius: 9, padding: '11px 13px', cursor: 'pointer', transition: 'transform 0.1s, box-shadow 0.1s', display: 'flex', flexDirection: 'column' }}
                      onClick={() => prefillChat(`What do the microstructure signals say about ${s.ticker} right now? Reference exact values and explain what they mean for ${name}.`)}
                      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLDivElement).style.boxShadow = `0 4px 20px ${S.primary}22` }}
                      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = 'none'; (e.currentTarget as HTMLDivElement).style.boxShadow = 'none' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                        <div>
                          <span style={{ color: S.text, fontSize: 15, fontWeight: 800 }}>{s.ticker}</span>
                          <p style={{ color: S.muted, fontSize: 9, margin: '1px 0 0', opacity: 0.7 }}>{name}</p>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <SignalBadge sig={s.signal ?? 'HOLD'} />
                          {isCustom && (
                            <button
                              onClick={e => { e.stopPropagation(); handleDeleteTicker(s.ticker) }}
                              title={`Remove ${s.ticker} (custom ticker)`}
                              style={{ background: '#7f1d1d44', border: '1px solid #FCA5A555', color: '#FCA5A5', borderRadius: 5, width: 18, height: 18, fontSize: 10, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0 }}>
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'inline-block', background: `${SECTOR_COLOR[sector] ?? S.border}18`, border: `1px solid ${SECTOR_COLOR[sector] ?? S.border}44`, borderRadius: 4, padding: '1px 6px', marginBottom: 7 }}>
                        <span style={{ color: SECTOR_COLOR[sector] ?? S.muted, fontSize: 8, fontWeight: 600, letterSpacing: '0.06em' }}>{sector}</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '3px 6px' }}>
                        <Tooltip content={TIP_OFI}><span style={{ color: S.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em' }}>OFI Z <span style={{ opacity: 0.45 }}>ⓘ</span></span></Tooltip>
                        <span style={{ color: ofiColor, fontSize: 10, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{ofiDir} {ofi.toFixed(3)}</span>
                        <Tooltip content={TIP_SPREAD}><span style={{ color: S.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Spread <span style={{ opacity: 0.45 }}>ⓘ</span></span></Tooltip>
                        <span style={{ color: spColor, fontSize: 10, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{sp.toFixed(1)} bps</span>
                        <Tooltip content={TIP_KYLE}><span style={{ color: S.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Kyle λ <span style={{ opacity: 0.45 }}>ⓘ</span></span></Tooltip>
                        <span style={{ color: S.text, fontSize: 10, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Number(s.kyle_lambda ?? 0).toExponential(1)}</span>
                        <Tooltip content={TIP_AMIHUD}><span style={{ color: S.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Amihud <span style={{ opacity: 0.45 }}>ⓘ</span></span></Tooltip>
                        <span style={{ color: S.text, fontSize: 10, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Number(s.amihud_illiq ?? 0).toExponential(1)}</span>
                        <Tooltip content={TIP_SHARPE}><span style={{ color: S.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Sharpe <span style={{ opacity: 0.45 }}>ⓘ</span></span></Tooltip>
                        <span style={{ color: sharpeColor, fontSize: 10, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{sharpe >= 0 ? '+' : ''}{sharpe.toFixed(2)}</span>
                      </div>
                      {llmReason && (
                        <p style={{
                          color: (llmReason.includes('rate limit') || llmReason.includes('auth') || llmReason.includes('error')) ? '#FDE68A' : S.muted,
                          fontSize: 9, margin: '7px 0 0', paddingTop: 6, borderTop: `1px solid ${S.border}33`,
                          lineHeight: 1.4, fontStyle: 'italic', opacity: 0.85,
                          overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                        }}>{llmReason}</p>
                      )}
                      <p style={{ color: S.muted, fontSize: 8, margin: 'auto 0 0', paddingTop: 5, textAlign: 'right', opacity: 0.25 }}>click → chat</p>
                    </div>
                  )
                })}
              </div>
              <p style={{ color: S.muted, fontSize: 10, margin: '12px 0 0', opacity: 0.45 }}>
                Sharpe is computed per-ticker over walk-forward test windows (annualised). Negative Sharpe = stock declined in the test period — not a signal quality measure. Phase 2 (tick data) targets portfolio Sharpe &gt; 1.
              </p>
            </Card>
          )}

          {/* ── Charts ── */}
          <Card title="Research Output Charts — Click to Analyse · Hover for Description">
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
                          <p style={{ color: '#475569', fontSize: 10, margin: 0, lineHeight: 1.5 }}>{d.how}</p>
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
                    <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 20, alignItems: 'start' }}>
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
                            <div style={{ width: 14, height: 14, border: `2px solid ${S.primary}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}></div>
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
          </Card>

          {/* ── Data Download ── */}
          <Card title="Raw Data — Download 2yr Daily OHLCV · 501 bars per ticker · Free">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              {ALL_TICKERS.map(t => {
                const [name, sector] = TICKER_NAMES[t] ?? [t, '']
                const col = SECTOR_COLOR[sector] ?? S.primary
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

          {/* ── Run History ── */}
          <HistoryPanel S={S} qc={qc} />

          {/* ── Chat ── */}
          <Card title="Research Assistant — Ask Groq (Grounded in Live DB Data)">
            {chat.length === 0 && (
              <div style={{ marginBottom: 12 }}>
                <p style={{ color: S.muted, fontSize: 11, margin: '0 0 8px', opacity: 0.6 }}>Groq AI grounded in live DB. Click a signal card above to pre-fill, or try:</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {["What is Kyle's lambda and why does it matter for NVDA?", "Why is IC near zero in Phase 1?", "Compare AAPL vs V liquidity profiles", "What does JPM spread anomaly mean?", "What changes in Phase 2 with tick data?"].map(q => (
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
