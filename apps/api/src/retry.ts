// Bounded retry for the API's neon-http reads — mask a Neon cold-start blip on the USER's
// latency path. The public API sits idle between visitors, so the FIRST query after idle wakes
// a suspended Neon serverless compute and can transiently throw (429/5xx/reset). The generator
// hit this same DB enough to add its own retry (packages/studio/src/pipeline/http.ts —
// observed 2026-06-10); the API is even MORE cold-start-prone (it idles between rare anonymous
// visitors, so every funnel visitor is a cold start), but its reads were bare `db.select`.
//
// A read can NOT fail open — empty rows would silently 404 a real tour / blank the catalog — so
// `withRetry` retries a transient throw then RE-THROWS: after a bounded effort, a 500 is the
// honest answer. (Contrast ./session `resolveSessionSafely`, which shares this loop but fails
// OPEN to null — the secure direction for AUTH, where a missing session legitimately = anonymous.)
//
// Budget is SHORTER/FEWER than the generator's (4×/500 ms) because this is on the user's latency
// budget: with the defaults the worst added wait before a 500 is baseMs·(2^0 + 2^1) = 360 ms, and
// the common case is a single blip masked into a slightly-slower success.

/**
 * Retry a transient async READ with exponential backoff, then RE-THROW the last error if all
 * `attempts` fail. The op must be IDEMPOTENT (a read, or a repeat-safe write) — it runs again on
 * each retry. A non-transient error simply fails ~a few hundred ms later, harmlessly. Per-attempt
 * blips are logged ONLY when a `label` is given, so callers that want the cold-start signal opt in
 * while quiet callers (session resolution) stay silent.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseMs?: number; label?: string } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3
  const baseMs = opts.baseMs ?? 120
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      lastError = e
      if (i === attempts - 1) break
      if (opts.label) {
        console.warn(
          `[api] ${opts.label}: attempt ${i + 1}/${attempts} failed (${(e as Error).message}) — retrying`,
        )
      }
      await new Promise((r) => setTimeout(r, baseMs * 2 ** i))
    }
  }
  throw lastError
}
