// Bounded retry for transient external + DB calls. A full tour makes ~2N sequential fetches
// (Google Cloud TTS, Wikipedia, Places) PLUS several Neon reads; without retry a single
// transient 429/5xx/network/cold-start blip fails the whole run. `fetchWithRetry` retries the
// raw-fetch path (exponential backoff, honoring Retry-After) and returns the final Response;
// `withRetry` is the generic async-thunk form the stateless neon-http READS use (a cold-start
// blip on the FIRST query otherwise kills a run at $0 — observed 2026-06-10).

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504, 529])

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Retry a transient async operation (a DB READ, any non-fetch call) with exponential backoff.
 * READS only — the caller must be idempotent, since a retried op runs again (a write could
 * double-apply). Logs each retry so a transient blip is visible, then throws the last error if
 * all `attempts` fail (a non-transient error just fails ~a few seconds later, harmlessly).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseDelayMs?: number; label?: string } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 4
  const base = opts.baseDelayMs ?? 500
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      lastError = e
      if (i === attempts - 1) break
      if (opts.label) {
        console.warn(
          `${opts.label}: attempt ${i + 1}/${attempts} failed (${(e as Error).message}) — retrying...`,
        )
      }
      await sleep(base * 2 ** i)
    }
  }
  throw lastError
}

export interface RetryOptions {
  /** Total attempts including the first (default 4). */
  attempts?: number
  /** Base backoff in ms; doubles per attempt (default 500). */
  baseDelayMs?: number
  /** Per-attempt timeout in ms. A FRESH AbortSignal.timeout is minted for EACH attempt —
   *  passing a single `signal: AbortSignal.timeout(N)` in `init` would start the clock once
   *  for the whole sequence and, once it fired, make every remaining retry reject INSTANTLY
   *  (defeating the retry exactly when upstream is slow). Combined with any caller `init.signal`. */
  timeoutMs?: number
}

export async function fetchWithRetry(url: string, init?: RequestInit, opts: RetryOptions = {}): Promise<Response> {
  const attempts = opts.attempts ?? 4
  const base = opts.baseDelayMs ?? 500
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    const isLast = i === attempts - 1
    // Mint the timeout PER ATTEMPT so each retry gets a full, fresh budget (a timeout that
    // fires is a transient failure and is retried below, with a new clock next pass).
    const timeoutSignal = opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined
    const signal =
      timeoutSignal && init?.signal
        ? AbortSignal.any([init.signal, timeoutSignal])
        : (timeoutSignal ?? init?.signal)
    try {
      const res = await fetch(url, signal ? { ...init, signal } : init)
      if (!RETRYABLE_STATUS.has(res.status) || isLast) return res
      const retryAfter = Number(res.headers.get('retry-after'))
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : base * 2 ** i
      await sleep(delay)
    } catch (e) {
      // Network-level failure (DNS, reset, timeout) — retry unless we're out of attempts.
      lastError = e
      if (isLast) throw e
      await sleep(base * 2 ** i)
    }
  }
  throw lastError ?? new Error(`fetchWithRetry: exhausted ${attempts} attempts for ${url}`)
}
