// In-memory fixed-window rate limiter middleware for Hono — the FIRST CUT spend/abuse guardrail.
//
// PER-INSTANCE + IN-MEMORY: each Cloud Run instance keeps its own counter map, so the effective
// limit is (limit × live instances) and a counter resets when an instance recycles. That's an
// accepted first-cut tradeoff — it caps the worst case (a single client hammering one instance,
// e.g. spamming the paid /drives/propose path) without standing up shared state. A shared store
// (Redis/Cloud Run's not-yet-there) or an LB-layer limit is the M4 upgrade.
//
// Keyed by client IP, taken from the RIGHT of x-forwarded-for (see clientIp — the leftmost is
// attacker-controlled). Enforcement is SKIPPED entirely under NODE_ENV=test so the suite can't trip it.

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

// How many RIGHT-hand x-forwarded-for entries are trusted infra hops to skip before the client IP.
// 0 today: api.skipper.fm is a Cloud Run DOMAIN MAPPING (no load balancer), so Google Front End
// appends only the real connecting IP as the rightmost entry. Set to 1 if an external HTTPS load
// balancer is ever put in front (it appends an LB IP to the right of the client — see the LB-cutover
// note in docs/guides/gcp-cloud-run-deploy.md). Env-tunable so that's a config change, not a code edit.
const TRUSTED_PROXY_HOPS = Number(process.env.TRUSTED_PROXY_HOPS ?? 0)

/**
 * Client IP from the RIGHT of x-forwarded-for, skipping TRUSTED_PROXY_HOPS trusted infra entries.
 *
 * ⚠ Parse from the RIGHT, never the left. GFE/Cloud Run APPENDS the real connecting IP to the right;
 * a caller can only PREPEND spoofed entries on the left. The old leftmost read let anyone send a
 * random x-forwarded-for to mint a fresh bucket every request, fully bypassing the per-IP cap on the
 * paid /drives Routes paths. Rightmost is unspoofable here. A short/forged chain clamps to the oldest
 * entry rather than underflowing, and a wrong HOPS value can only OVER-share a bucket (over-block),
 * never re-open the bypass. Falls back to x-real-ip then "anon" when x-forwarded-for is absent.
 */
function clientIp(c: Parameters<MiddlewareHandler<ApiEnv>>[0]): string {
  const fwd = c.req.header('x-forwarded-for')
  if (fwd) {
    const ips = fwd
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (ips.length > 0) {
      const ip = ips[Math.max(0, ips.length - 1 - TRUSTED_PROXY_HOPS)]
      if (ip) return ip
    }
  }
  return c.req.header('x-real-ip') ?? 'anon'
}

/**
 * Build a fixed-window limiter middleware. Each call gets its own bucket map, so two mounts with
 * different labels never share state. Returns JSON `{ error: 'rate_limited', message }` with HTTP
 * 429 and a `Retry-After` header (seconds) on exceed, and emits one structured `evt: 'rate_limited'`
 * log line per rejection (never on the allowed path). No-op under NODE_ENV=test.
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
      // Size-gated lazy GC. The map otherwise only ever grows — an IP that hits an OPEN path (/sample)
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
      // THE ONLY SIGNAL A 429 EVER EMITS, and the only way an operator can tell "the cap is absorbing a
      // scraper" from "nobody is calling this route" — they are the same observation from the outside,
      // and because buckets are per-IP AND per-INSTANCE (see the header) the aggregate exists nowhere
      // else. One line per rejection IS the count; the alerting handle is a log-based metric keyed on
      // `evt`, which is why the shape is single-line JSON rather than the `[api] …` prose elsewhere.
      //
      // ⚠ INV-13 — a rider transcript is transient rider content, and a log is not transient. Every
      // field here is OURS by construction: `evt` is a literal, `label`/`limit`/`windowSec` come from
      // this middleware's own options object, whose only call sites pass a frozen const from ./limits.
      // None can carry prose. The IP is the RIDER's and never appears — nor does any header, path,
      // query or body. That is also why the label has to stay unique per bucket (./limits): with the
      // key withheld, the label is the whole identity of a rejection.
      //
      // ⚠ `count` is deliberately NOT logged: the increment lives on the allowed branch below, so on
      // this branch it is pinned at `limit` by construction and could never vary. `windowSec` is the
      // field that makes `limit` mean anything (/drives/plan runs a 20/60s and a 120/3600s bucket).
      //
      // ⚠ console.info, not warn/error, and this line carries NO `severity` field. Both halves matter:
      // with no severity in the JSON, the LogEntry's severity falls back to the STREAM, and warn/error
      // go to stderr — conventionally ERROR. A guardrail doing exactly its job must not land in Error
      // Reporting looking like an outage. ⚠ That stream fallback is NOT stated on Cloud Run's logging
      // page; it is agent behaviour documented for GKE/Functions, so treat it as the reason to pick the
      // right stream, never as a guarantee. The DOCUMENTED lever is the `severity` field, which
      // ./planner.ts's logPlanSpend sets explicitly for exactly that reason — a line that must be ERROR
      // says so; this one must not be, so it says nothing and stays on stdout.
      //
      // ⚠ REJECTION PATH ONLY. On the allowed path this would be one line per request forever — pure
      // log cost, on the hottest code in the process.
      console.info(JSON.stringify({ evt: 'rate_limited', label, limit, windowSec }))
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
