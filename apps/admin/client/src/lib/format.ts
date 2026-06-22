export const fmtDate = (iso?: string | null): string => (iso ? new Date(iso).toLocaleString() : '—')

// Normalize a thrown value to a display string. ApiError extends Error, so this covers both.
export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export function timeAgo(iso?: string | null): string {
  if (!iso) return '—'
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
