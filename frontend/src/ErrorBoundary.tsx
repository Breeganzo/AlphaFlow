import React from 'react'

/**
 * App-wide error boundary.
 *
 * Without this, ANY render error in the (large) App tree unmounts the whole
 * page and the user sees a blank black screen with no way to recover. This
 * catches the error, shows a friendly recoverable panel, and lets the user
 * dismiss it (re-render) or reload — instead of white-screening the app.
 */
type Props = { children: React.ReactNode }
type State = { error: Error | null }

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Keep a console trail for debugging; never crash silently.
    console.error('[AlphaFlow] Recovered from a render error:', error, info?.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div style={{
        minHeight: '100vh', background: 'radial-gradient(circle at 30% 10%, #0B1120, #020817)',
        color: '#F0F9FF', fontFamily: "'Inter', system-ui, sans-serif",
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}>
        <div style={{
          maxWidth: 520, background: '#0F1A2E', border: '1px solid #1E3A5F', borderRadius: 14,
          padding: '28px 32px', boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}>
          <div style={{ fontSize: 30, marginBottom: 8 }}>⚠️</div>
          <h1 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 8px', color: '#38BDF8' }}>
            Something hiccuped — but your data is safe
          </h1>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: '#7DD3FC', margin: '0 0 16px' }}>
            A panel hit an unexpected value while rendering. Nothing was lost — dismiss this
            to return to the dashboard, or reload for a clean slate.
          </p>
          <pre style={{
            background: '#020817', border: '1px solid #1E3A5F', borderRadius: 8, padding: '10px 12px',
            fontSize: 11, color: '#FCA5A5', overflowX: 'auto', margin: '0 0 18px',
          }}>{error.message || String(error)}</pre>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => this.setState({ error: null })} style={{
              background: '#0369A1', color: '#fff', border: 'none', borderRadius: 8,
              padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}>← Back to dashboard</button>
            <button onClick={() => window.location.reload()} style={{
              background: 'transparent', color: '#7DD3FC', border: '1px solid #1E3A5F', borderRadius: 8,
              padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}>Reload</button>
          </div>
        </div>
      </div>
    )
  }
}
