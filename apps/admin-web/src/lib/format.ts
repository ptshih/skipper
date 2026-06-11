export const fmtDuration = (s?: number | null): string => (s == null ? '—' : `${Math.round(s / 60)} min`)
export const fmtMiles = (m?: number | null): string => (m == null ? '—' : `${(m / 1609.344).toFixed(1)} mi`)
export const fmtDate = (iso?: string | null): string => (iso ? new Date(iso).toLocaleString() : '—')
export const fmtScore = (v?: number | null): string => (v == null ? '—' : v.toFixed(3))
export const fmtCost = (v?: number | null): string => (v == null ? '—' : `$${v.toFixed(2)}`)
export const fmtSec = (ms?: number | null): string => (ms == null ? '—' : `${(ms / 1000).toFixed(1)}s`)

export function timeAgo(iso?: string | null): string {
  if (!iso) return '—'
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
