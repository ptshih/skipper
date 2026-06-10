// Pure version-gate logic — shared by the mobile client (which decides nudge/force) and
// the unit tests, so both agree on one implementation. Dep-free: the API just SERVES the
// policy (apps/api version-policy.ts); the CLIENT compares its own version against it.

export type GateDecision = 'ok' | 'nudge' | 'force'

/** A core segment is numeric only when it is ALL digits; anything else (missing, negative,
 *  or suffixed like "3-beta") counts as 0 — so "1.2" === "1.2.0" and a malformed segment can't
 *  leak a negative through the old `parseInt(...) || 0` (where -1 is truthy and survives). */
const coreSegment = (s: string | undefined): number => (s !== undefined && /^\d+$/.test(s) ? Number(s) : 0)

/** An all-digits prerelease identifier — these order BELOW alphanumeric ones and compare
 *  numerically, not lexically (semver §11). */
const isNumericId = (id: string): boolean => /^\d+$/.test(id)

/** Split "1.2.3-beta.1+build" into [["1","2","3"], ["beta","1"]] — build metadata ("+…") is
 *  dropped (it carries no precedence), the prerelease (after the first "-") is split on ".". */
function splitVersion(v: string): [core: string[], pre: string[]] {
  const noBuild = (v ?? '').split('+')[0] ?? ''
  const dash = noBuild.indexOf('-')
  const core = dash >= 0 ? noBuild.slice(0, dash) : noBuild
  const pre = dash >= 0 ? noBuild.slice(dash + 1) : ''
  return [core.split('.'), pre === '' ? [] : pre.split('.')]
}

/**
 * Compare two version strings by Semver 2.0.0 precedence (https://semver.org §11).
 * Returns -1 if a<b, 0 if equal, 1 if a>b.
 *   - Build metadata ("+sha") is IGNORED.
 *   - The numeric core (major.minor.patch) compares numerically, not lexicographically
 *     ("1.10.0" > "1.9.0"); a missing or non-numeric segment counts as 0 ("1.2" === "1.2.0").
 *   - A version WITH a prerelease ("1.0.0-beta") has LOWER precedence than the same core
 *     without one ("1.0.0").
 *   - Prereleases compare identifier-by-identifier: numeric identifiers numerically,
 *     alphanumeric ones by ASCII; numeric < alphanumeric; and when all preceding identifiers
 *     are equal, the longer prerelease wins ("1.0.0-alpha" < "1.0.0-alpha.1").
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const [coreA, preA] = splitVersion(a)
  const [coreB, preB] = splitVersion(b)

  const coreLen = Math.max(coreA.length, coreB.length)
  for (let i = 0; i < coreLen; i++) {
    const na = coreSegment(coreA[i])
    const nb = coreSegment(coreB[i])
    if (na < nb) return -1
    if (na > nb) return 1
  }

  // Equal cores → apply prerelease precedence. No prerelease outranks any prerelease.
  if (preA.length === 0 && preB.length === 0) return 0
  if (preA.length === 0) return 1
  if (preB.length === 0) return -1

  const preLen = Math.max(preA.length, preB.length)
  for (let i = 0; i < preLen; i++) {
    if (i >= preA.length) return -1 // a ran out of identifiers first → fewer fields → lower
    if (i >= preB.length) return 1
    const ida = preA[i]!
    const idb = preB[i]!
    if (ida === idb) continue
    const numA = isNumericId(ida)
    const numB = isNumericId(idb)
    if (numA && numB) return Number(ida) < Number(idb) ? -1 : 1
    if (numA !== numB) return numA ? -1 : 1 // numeric identifiers have lower precedence
    return ida < idb ? -1 : 1 // both alphanumeric — ASCII order
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
