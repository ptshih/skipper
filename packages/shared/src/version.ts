// Pure version-gate logic — shared by the mobile client (which decides nudge/force) and
// the unit tests, so both agree on one implementation. Dep-free: the API just SERVES the
// policy (apps/api version-policy.ts); the CLIENT compares its own version against it.

export type GateDecision = 'ok' | 'nudge' | 'force'

/**
 * Compare two dotted numeric version strings ("x.y.z"). Returns -1 if a<b, 0 if equal,
 * 1 if a>b. Missing or non-numeric segments count as 0, so "1.2" === "1.2.0". Numeric,
 * not lexicographic: "1.10.0" > "1.9.0".
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split('.')
  const pb = b.split('.')
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const na = Number.parseInt(pa[i] ?? '0', 10) || 0
    const nb = Number.parseInt(pb[i] ?? '0', 10) || 0
    if (na < nb) return -1
    if (na > nb) return 1
  }
  return 0
}

/**
 * Decide the update gate for a client on `current`, given its platform policy:
 *   current < minimum      → 'force' (blocking wall, no dismiss)
 *   current < recommended  → 'nudge' (dismissible)
 *   otherwise              → 'ok'
 * Seeding minimum === recommended === the current version makes the gate a no-op.
 */
export function gateFor(
  current: string,
  policy: { minimum: string; recommended: string },
): GateDecision {
  if (compareVersions(current, policy.minimum) < 0) return 'force'
  if (compareVersions(current, policy.recommended) < 0) return 'nudge'
  return 'ok'
}
