export const fmtDate = (iso?: string | null): string => (iso ? new Date(iso).toLocaleString() : '—')

/** An eval score to 2dp, or an em-dash when it wasn't measured. Shared so the run list and the run
 *  detail can't render the same number to different precision. */
export const fmtScore = (v: number | null): string => (v == null ? '—' : v.toFixed(2))

// Normalize a thrown value to a display string. ApiError extends Error, so this covers both.
export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Meters → miles. MILES, not km: every region in the corpus is US and the rider-facing app talks in
 *  miles, so reporting a drive as "55 km" here would make the console and the phone disagree about the
 *  same frozen number. Em-dash when the route carries no distance. */
export const fmtMiles = (m?: number | null): string => (m == null ? '—' : `${(m / 1609.344).toFixed(1)} mi`)

/** Seconds → a compact "2h 5m" / "48m" / "40s". Used for drive durations and per-stop offsets. */
export function fmtDuration(sec?: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return '—'
  const s = Math.max(0, Math.round(sec))
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

export function timeAgo(iso?: string | null): string {
  if (!iso) return '—'
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
