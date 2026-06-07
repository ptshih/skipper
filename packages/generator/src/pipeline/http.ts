// Bounded retry for the raw-fetch external calls (Google Cloud TTS, Wikipedia, Places).
// A full tour makes ~2N sequential calls; without retry a single transient
// 429/5xx/network blip fails the whole run. We retry transient failures with
// exponential backoff (honoring Retry-After) and return the final Response — the
// caller still checks res.ok for terminal errors.

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504, 529])

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export interface RetryOptions {
  /** Total attempts including the first (default 4). */
  attempts?: number
  /** Base backoff in ms; doubles per attempt (default 500). */
  baseDelayMs?: number
}

export async function fetchWithRetry(url: string, init?: RequestInit, opts: RetryOptions = {}): Promise<Response> {
  const attempts = opts.attempts ?? 4
  const base = opts.baseDelayMs ?? 500
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    const isLast = i === attempts - 1
    try {
      const res = await fetch(url, init)
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
