// In-memory fixed-window rate limiter middleware for Hono — the FIRST CUT spend/abuse guardrail.
//
// PER-INSTANCE + IN-MEMORY: each Cloud Run instance keeps its own counter map, so the effective
// limit is (limit × live instances) and a counter resets when an instance recycles. That's an
// accepted first-cut tradeoff — it caps the worst case (a single client hammering one instance,
// e.g. spamming the paid /drives/propose path) without standing up shared state. A shared store
// (Redis/Cloud Run's not-yet-there) or an LB-layer limit is the M4 upgrade.
//
// Keyed by client IP: Cloud Run sets x-forwarded-for with the real client as the FIRST hop, so we
// take that; falling back to cf-connecting-ip / x-real-ip / "anon" if it's absent. Enforcement is
// SKIPPED entirely under NODE_ENV=test so the suite can't trip it.

import type { MiddlewareHandler } from 'hono'
import type { ApiEnv } from './entitlements'

interface RateLimitOptions {
  /** Max requests allowed per window, per client IP. */
  limit: number
  /** Window length in seconds (fixed window — the count resets when the window rolls over). */
  windowSec: number
  /** Short label for the bucket (kept separate per label so distinct routes don't share a count). */
  label: string
}

interface Bucket {
  count: number
  /** Epoch ms when the current window expires (and the count resets). */
  resetAt: number
}

/** First hop of x-forwarded-for (Cloud Run's real client), else cf-connecting-ip / x-real-ip / "anon". */
function clientIp(c: Parameters<MiddlewareHandler<ApiEnv>>[0]): string {
  const fwd = c.req.header('x-forwarded-for')
  if (fwd) {
    const first = fwd.split(',')[0]?.trim()
    if (first) return first
  }
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-real-ip') ?? 'anon'
}

/**
 * Build a fixed-window limiter middleware. Each call gets its own bucket map, so two mounts with
 * different labels never share state. Returns JSON `{ error: 'rate_limited', message }` with HTTP
 * 429 and a `Retry-After` header (seconds) on exceed. No-op under NODE_ENV=test.
 */
export function rateLimit({ limit, windowSec, label }: RateLimitOptions): MiddlewareHandler<ApiEnv> {
  const buckets = new Map<string, Bucket>()
  const windowMs = windowSec * 1000

  return async (c, next) => {
    if (process.env.NODE_ENV === 'test') return next()

    const key = `${label}:${clientIp(c)}`
    const now = Date.now()
    const bucket = buckets.get(key)

    if (!bucket || now >= bucket.resetAt) {
      // Size-gated lazy GC. The map otherwise only ever grows — an IP that hits an OPEN path (/roam)
      // once and never returns leaves a permanent entry — so once it crosses a soft cap, sweep every
      // expired window here on the (already O(1)) window-roll branch. Bounded, no timer, no shared state.
      if (buckets.size > 5000) {
        for (const [k, b] of buckets) if (now >= b.resetAt) buckets.delete(k)
      }
      buckets.set(key, { count: 1, resetAt: now + windowMs })
      return next()
    }

    if (bucket.count >= limit) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
      c.header('Retry-After', String(retryAfterSec))
      return c.json(
        { error: 'rate_limited', message: 'Too many requests. Give it a moment and try again.' },
        429,
      )
    }

    bucket.count += 1
    return next()
  }
}
