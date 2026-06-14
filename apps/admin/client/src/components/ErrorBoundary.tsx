// Last-resort crash guards for the admin SPA, so a render error or a fatal boot error degrades
// to a LEGIBLE message + Reload instead of a blank white screen (the "admin just errors out" in
// local dev — TODO.md). Two layers:
//   - <ErrorBoundary>: catches errors thrown while RENDERING its children (a bad view, bad data).
//   - renderBootError(): a plain-DOM fallback for a crash BEFORE React can mount (e.g. the
//     dual-React `ReactCurrentDispatcher` error) — an error boundary can't catch that, and the
//     plain-DOM path works even when React or the app CSS is broken.
//
// Inline styles on purpose: the fallback must render even if Tailwind/the design tokens failed.
import { Component, type CSSProperties, type ReactNode } from 'react'

// A dual-React mismatch (two React copies after a `bun install` re-link) surfaces as a null hooks
// dispatcher — give the operator the exact fix instead of a cryptic stack.
const DUAL_REACT_RE = /ReactCurrentDispatcher|Invalid hook call|dispatcher is null|reading 'use[A-Z]/i
function dualReactHint(message: string): string | null {
  return DUAL_REACT_RE.test(message)
    ? 'Likely a dual-React mismatch (common after `bun install`). Fix: remove apps/admin/client/node_modules/.vite and reload; confirm vite.config.ts has resolve.dedupe([react, react-dom]).'
    : null
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}

/** Plain-DOM fallback for a pre-mount / fatal crash (no React, no app CSS). */
export function renderBootError(root: HTMLElement, error: unknown): void {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  const hint = dualReactHint(message)
  root.innerHTML = `
    <div style="display:flex;min-height:100vh;align-items:center;justify-content:center;font-family:system-ui,sans-serif;background:#18181b;color:#e4e4e7;padding:24px">
      <div style="max-width:680px;width:100%;background:#27272a;border:1px solid #3f3f46;border-radius:12px;padding:24px">
        <h1 style="margin:0;font-size:18px">Admin failed to start</h1>
        ${hint ? `<p style="color:#fbbf24;margin:8px 0 0;line-height:1.5">${escapeHtml(hint)}</p>` : ''}
        <pre style="white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,monospace;font-size:12px;background:#18181b;border:1px solid #3f3f46;border-radius:8px;padding:12px;margin-top:12px;max-height:280px;overflow:auto">${escapeHtml(message)}</pre>
        <button onclick="location.reload()" style="margin-top:16px;padding:8px 16px;background:#2f6b4f;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer">Reload</button>
      </div>
    </div>`
}

const wrap: CSSProperties = {
  display: 'flex',
  minHeight: '100vh',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'system-ui, sans-serif',
  background: '#18181b',
  color: '#e4e4e7',
  padding: 24,
}
const card: CSSProperties = {
  maxWidth: 680,
  width: '100%',
  background: '#27272a',
  border: '1px solid #3f3f46',
  borderRadius: 12,
  padding: 24,
}
const preStyle: CSSProperties = {
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontFamily: 'ui-monospace, monospace',
  fontSize: 12,
  background: '#18181b',
  border: '1px solid #3f3f46',
  borderRadius: 8,
  padding: 12,
  marginTop: 12,
  maxHeight: 280,
  overflow: 'auto',
}
const btnStyle: CSSProperties = {
  marginTop: 16,
  padding: '8px 16px',
  background: '#2f6b4f',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  fontWeight: 600,
  cursor: 'pointer',
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    console.error('[admin] render error caught by ErrorBoundary:', error)
  }
  render() {
    const error = this.state.error
    if (!error) return this.props.children
    const message = error.stack ?? error.message
    const hint = dualReactHint(message)
    return (
      <div style={wrap}>
        <div style={card}>
          <h1 style={{ margin: 0, fontSize: 18 }}>Something broke in the admin</h1>
          {hint && <p style={{ color: '#fbbf24', margin: '8px 0 0', lineHeight: 1.5 }}>{hint}</p>}
          <pre style={preStyle}>{message}</pre>
          <button style={btnStyle} onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </div>
    )
  }
}
