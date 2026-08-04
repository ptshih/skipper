// ONLY THE NEWEST RUN MAY WRITE. Several things reach for the same load at once — a focus effect, a
// reconnect self-heal, a Better Auth session refetch — and they share a network edge, so two can be
// in flight in the same moment. Without an ordinal the SLOWER of them wins: it resolves last and
// stamps a stale list, or a stale error, over a good one.
//
// ⚠ IT WAS TWO COPIES (home and MY DRIVES), and the rule is subtle enough that a copy is a liability:
// the guard has to be re-checked after EVERY await in the run, not just the first, and a `finally`
// that clears loading state has to be gated too or a superseded run switches the spinner off under
// its successor. Both call sites do that; a third would have had to re-derive it from reading them.
import { useCallback, useRef } from 'react'

/**
 * Returns a `begin()` for one run. Call it as the run starts; it hands back the predicate that says
 * whether this run is still the newest.
 *
 * ```ts
 * const begin = useLatestRun()
 * const load = useCallback(async () => {
 *   const isCurrent = begin()
 *   const r = await listDrives()
 *   if (!isCurrent()) return   // a newer load overtook us — drop this result on the floor
 *   setDrives(r.drives)
 * }, [begin])
 * ```
 */
export function useLatestRun(): () => () => boolean {
  const seq = useRef(0)
  return useCallback(() => {
    const mine = ++seq.current
    return () => seq.current === mine
  }, [])
}
