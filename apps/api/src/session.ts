// Resilient session resolution — retry a transient auth-DB blip, then FAIL OPEN.
//
// withSession (entitlements.ts) runs BEFORE the per-route gate and reads the auth DB (a
// neon-serverless Pool) to resolve the caller's session. A transient blip there must NOT 500
// the request: a `?preview=1` fetch/sign needs no session at all (preview is open to anyone),
// so a 500 would needlessly take down the anonymous preview funnel — the demo (CLAUDE.md: "the
// couch preview is the funnel… the canonical preview IS the demo, don't silently break it").
//
// Auth-free + generic on purpose: the fail-open path is unit-tested without constructing the
// Better Auth instance (which needs BETTER_AUTH_SECRET at module load) — mirrors tiers.ts.

/**
 * Resolve a session via `getSession`, retrying a TRANSIENT throw a few times, then FAILING OPEN
 * to `null` (anonymous) if it still throws. A null RESULT is the normal anonymous case and is
 * returned immediately — only a thrown error retries.
 *
 * Failing open to the LEAST-privileged tier is the secure direction: it can only ever grant
 * LESS access — a gated route falls back to its AccountGate 401 (never a leak), while preview,
 * open to anonymous by design, keeps serving. Short + few retries: this is on the USER's latency
 * budget, so a sustained outage degrades within ~baseMs·(2^0+2^1) ms, not seconds.
 */
export async function resolveSessionSafely<T>(
  getSession: () => Promise<T>,
  opts: { attempts?: number; baseMs?: number } = {},
): Promise<T | null> {
  const attempts = opts.attempts ?? 3
  const baseMs = opts.baseMs ?? 150
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await getSession()
    } catch (e) {
      lastError = e
      if (i === attempts - 1) break
      await new Promise((r) => setTimeout(r, baseMs * 2 ** i))
    }
  }
  console.error('[api] session resolution failed after retries — degrading to anonymous', lastError)
  return null
}
