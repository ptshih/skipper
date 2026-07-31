export const fmtDate = (iso?: string | null): string => (iso ? new Date(iso).toLocaleString() : '—')

/** An eval score to 2dp, or an em-dash when it wasn't measured. Shared so the run list and the run
 *  detail can't render the same number to different precision. */
export const fmtScore = (v: number | null): string => (v == null ? '—' : v.toFixed(2))

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
