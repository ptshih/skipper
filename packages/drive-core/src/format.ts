// Shared display formatting for the drive — one implementation so the generator CLI, the
// sim CLI, and the mobile player can't drift on how a clock reads.

/**
 * Format a duration as `M:SS` (e.g. 83 → "1:23"). Rounds to the nearest second BEFORE
 * splitting (so 119.6s reads "2:00", never "1:60") and clamps negatives to "0:00".
 */
export function formatMmss(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** `formatMmss` for a millisecond input (player positions/durations are in ms). */
export const formatMmssMs = (ms: number): string => formatMmss(ms / 1000)
