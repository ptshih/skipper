// Tests for the rider-facing caps (INV-3, INV-12, D32 — "tests cover the access and cost boundaries
// first"). The three things that actually have to be true: the cap measures REAL bytes rather than the
// caller's Content-Length, it is enforced under NODE_ENV=test, and a legitimate body still passes.
// The two drift-guard blocks at the bottom cover the caps that no request can reach — the socket
// settings and the rate-limiter buckets — where a pinned RELATIONSHIP is the only guard available.
//
// ⚠ Note the plain static import below — no BETTER_AUTH_SECRET seed, no dynamic import. ../src/limits
// imports NOTHING, so it cannot reach auth.ts's module-load throw. If a future edit makes this file
// need an env seed, that edit added an import to limits.ts and IS the bug.

import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import {
  DRIVE_CREATE_RATE,
  MAX_DRIVE_BODY_BYTES,
  MAX_PLAN_BODY_BYTES,
  MAX_PLAN_MESSAGE_CHARS,
  MAX_PLAN_MESSAGES,
  MAX_PLAN_TOTAL_CHARS,
  PLAN_RATE_HOUR,
  PLAN_RATE_MINUTE,
  PLAN_WRAP_UP_AFTER_MESSAGES,
  PLANNER_TIMEOUT_MS,
  PROPOSE_RATE,
  readBoundedText,
  REGIONS_RATE,
  SERVER_IDLE_TIMEOUT_SEC,
  SERVER_MAX_BODY_BYTES,
} from '../src/limits'

const CAP = 16 * 1024
const post = (body: string, headers?: Record<string, string>) =>
  new Request('http://localhost/x', { method: 'POST', body, headers })

/** A Request whose body is a stream, so it carries NO Content-Length — the shape a header-only guard
 *  admits entirely. `duplex: 'half'` is required by the fetch spec for a streaming request body. */
const streamPost = (chunks: Uint8Array[], onCancel?: () => void) =>
  new Request('http://localhost/x', {
    method: 'POST',
    body: new ReadableStream<Uint8Array>({
      start(ctrl) {
        for (const c of chunks) ctrl.enqueue(c)
        ctrl.close()
      },
      cancel: onCancel,
    }),
    duplex: 'half',
  } as RequestInit)

describe('readBoundedText — (a) measures REAL bytes, never Content-Length', () => {
  test('rejects a huge body that claims a tiny Content-Length', async () => {
    const req = post('x'.repeat(1_000_000), { 'content-length': '10' })
    // The lie survives Request construction — this is the attack, verbatim.
    expect(req.headers.get('content-length')).toBe('10')
    // ⚠ ok===false, never an exact byte count: one read can overshoot the cap before the counter trips.
    expect((await readBoundedText(req, CAP)).ok).toBe(false)
  })

  test('accepts a small body that claims a huge Content-Length', async () => {
    // The header must not be able to REJECT a legitimate request either — a guard that trusts it is
    // wrong in both directions, not just the exploitable one.
    expect(await readBoundedText(post('{"a":1}', { 'content-length': '99999999' }), CAP)).toEqual({
      ok: true,
      text: '{"a":1}',
    })
  })

  test('rejects a chunked body with NO Content-Length, and aborts the producer', async () => {
    let cancelled = false
    const chunk = new Uint8Array(4096)
    const req = streamPost(Array.from({ length: 64 }, () => chunk), () => {
      cancelled = true
    })
    expect(req.headers.get('content-length')).toBeNull()
    expect((await readBoundedText(req, CAP)).ok).toBe(false)
    // cancel() is load-bearing, not tidiness — it aborts the producer instead of draining 256 KB.
    expect(cancelled).toBe(true)
  })

  test('rejects on BYTES, not String.length', async () => {
    // 10_000 CJK chars: .length === 10_000 (under a 16_384 cap) but 30_000 UTF-8 bytes (over it).
    // A .length-based cap admits this, i.e. is ~3x bypassable.
    const payload = '中'.repeat(10_000)
    expect(payload.length).toBeLessThan(CAP)
    expect(new TextEncoder().encode(payload).byteLength).toBeGreaterThan(CAP)
    expect((await readBoundedText(post(payload), CAP)).ok).toBe(false)
  })
})

describe('readBoundedText — (b) enforced under NODE_ENV=test', () => {
  test('bun test really does set NODE_ENV=test', () => {
    // The precondition that makes the next assertion meaningful. ../src/rate-limit returns next()
    // unconditionally in exactly this environment, which is why the body cap is NOT built on it (INV-12).
    expect(process.env.NODE_ENV).toBe('test')
  })

  test('the cap still fires here', async () => {
    expect((await readBoundedText(post('x'.repeat(CAP + 1)), CAP)).ok).toBe(false)
  })
})

describe('readBoundedText — (c) legitimate bodies pass', () => {
  test('a worst-case-LEGAL propose body fits under MAX_DRIVE_BODY_BYTES', async () => {
    // Two endpoints plus the schema's maximum 8 `via` midpoints, each with a maximum-length name whose
    // characters are multi-byte. This is the request that must never 413.
    const ep = (n: number) => ({ name: `${n}`.padEnd(200, 'ä'), lat: 39.1, lng: -120.1 })
    const body = JSON.stringify({
      start: ep(0),
      end: ep(9),
      via: Array.from({ length: 8 }, (_, i) => ep(i + 1)),
      idempotencyKey: crypto.randomUUID(),
    })
    expect(await readBoundedText(post(body), MAX_DRIVE_BODY_BYTES)).toEqual({ ok: true, text: body })
  })

  test('a full-length planner transcript fits under MAX_PLAN_BODY_BYTES', async () => {
    const body = JSON.stringify({
      messages: Array.from({ length: MAX_PLAN_MESSAGES }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: i % 2 === 0 ? 'Something scenic, about two hours.' : 'x'.repeat(400),
      })),
    })
    expect(await readBoundedText(post(body), MAX_PLAN_BODY_BYTES)).toEqual({ ok: true, text: body })
  })

  test('an absent body is fine', async () => {
    const req = new Request('http://localhost/x', { method: 'POST' })
    expect(await readBoundedText(req, CAP)).toEqual({ ok: true, text: '' })
  })

  test('exactly at the cap passes; one byte over does not', async () => {
    expect(await readBoundedText(post('x'.repeat(16)), 16)).toEqual({ ok: true, text: 'x'.repeat(16) })
    expect((await readBoundedText(post('x'.repeat(17)), 16)).ok).toBe(false)
  })

  test('multi-byte text split across chunk boundaries round-trips exactly', async () => {
    // One byte per chunk — maximal stress on the streaming decoder. Without { stream: true } this comes
    // back full of replacement characters and JSON.parse fails on a perfectly valid rider message,
    // depending only on where the chunk boundary happened to land.
    const source = '{"say":"Sopaé — café 🚀 中文"}'
    const bytes = new TextEncoder().encode(source)
    const req = streamPost(Array.from({ length: bytes.length }, (_, i) => bytes.subarray(i, i + 1)))
    expect(await readBoundedText(req, CAP)).toEqual({ ok: true, text: source })
    expect(JSON.parse(source)).toBeTruthy()
  })
})

describe('readBoundedText — inside a hono handler', () => {
  // A throwaway app, so this stays independent of the real app's boot (auth secret, route ordering).
  // Proves the c.req.raw plumbing, which the Request-level tests above deliberately do not touch.
  const probe = new Hono()
  probe.post('/x', async (c) => {
    const read = await readBoundedText(c.req.raw, CAP)
    if (!read.ok) return c.json({ error: 'payload_too_large' }, 413)
    return c.json({ len: read.text.length })
  })

  test('413 over the cap, 200 under it', async () => {
    expect((await probe.fetch(post('x'.repeat(CAP + 1)))).status).toBe(413)
    const ok = await probe.fetch(post('{"a":1}'))
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ len: 7 })
  })
})

describe('cap relationships (drift guard)', () => {
  test('the socket backstop stays an order of magnitude above every route cap', () => {
    // It is a floor under the process, not a per-route guard. If a route cap ever climbs near it, the
    // backstop stops being a backstop and starts being the thing that rejects riders.
    expect(SERVER_MAX_BODY_BYTES).toBeGreaterThan(MAX_PLAN_BODY_BYTES * 8)
    expect(SERVER_MAX_BODY_BYTES).toBeGreaterThan(MAX_DRIVE_BODY_BYTES * 8)
  })

  test('the char cap binds before the byte cap for ordinary Latin text', () => {
    // Intent: bytes protect the parse, chars protect the token bill. If a raise ever inverts this, the
    // char cap becomes decorative and the byte cap silently becomes the only guard.
    const envelopeBytes = MAX_PLAN_MESSAGES * 40
    expect(MAX_PLAN_TOTAL_CHARS + envelopeBytes).toBeLessThan(MAX_PLAN_BODY_BYTES)
  })

  test('a single message cannot consume the whole conversation budget', () => {
    expect(MAX_PLAN_MESSAGE_CHARS * 2).toBeLessThan(MAX_PLAN_TOTAL_CHARS)
  })

  // D12's entire claim is that a rider never MEETS MAX_PLAN_MESSAGES, because the in-persona wrap-up
  // landed the conversation several exchanges earlier. That is only true while these two numbers keep
  // their relationship, and neither is reachable by a request — so the relationship IS the guard.
  test('the wrap-up starts above a normal conversation and below the hard cap', () => {
    // FLOOR: 8 exchanges = 16 messages is the top of the "3-8 exchanges" band limits.ts documents. Drop
    // below it and an ordinary rider gets hurried toward a plan mid-conversation AND pays for an
    // uncached third system block on most of their turns — a UX regression and a cost one at once.
    expect(PLAN_WRAP_UP_AFTER_MESSAGES).toBeGreaterThanOrEqual(16)
    // CEILING: at or above the cap the notice could never ride at all. D12 would be disabled silently,
    // with every other test in this repo still green — which is precisely how it shipped unproduced.
    expect(PLAN_WRAP_UP_AFTER_MESSAGES).toBeLessThan(MAX_PLAN_MESSAGES)
    // RUNWAY: enough turns left to bow out warmly. One or two would make the nudge and the hard stop
    // land almost together, which is the cliff D12 exists to remove rather than relocate.
    expect(MAX_PLAN_MESSAGES - PLAN_WRAP_UP_AFTER_MESSAGES).toBeGreaterThanOrEqual(6)
  })

  // ⚠ THE SOCKET TIMEOUT ITSELF IS NOT REACHABLE BY ANY TEST — an in-process app.fetch(new Request(...))
  // never touches a socket, exactly as SERVER_MAX_BODY_BYTES notes. This relationship IS the whole
  // guard, and it is guarding a live defect that shipped: Bun's DEFAULT idleTimeout is 10 seconds and it
  // fires WHILE A HANDLER IS STILL RUNNING, so POST /drives/plan was killing the rider's connection at
  // ~12 s while the Opus call it had already paid for kept generating (probe 2026-08-01). Both numbers
  // live in limits.ts precisely so this assert can exist.
  //
  // The 1.5x margin is not arbitrary: the model call is not the only thing on the clock — the bounded
  // body read, the region query and the anchor load all run first, and the socket has to outlive the
  // whole handler, not just its slowest await.
  test('the socket outlives the planner wall clock by a real margin', () => {
    expect(SERVER_IDLE_TIMEOUT_SEC * 1000).toBeGreaterThan(PLANNER_TIMEOUT_MS * 1.5)
  })
})

describe('rate-limiter buckets (drift guard)', () => {
  // ⚠ WHAT THESE CANNOT DO, so nobody re-litigates it: ../src/rate-limit returns next() unconditionally
  // under NODE_ENV=test, so no test here can prove a bucket COUNTS or that a 429 (or its `rate_limited`
  // log line) ever fires. What IS assertable is the part that actually drifts — the numbers and the
  // labels — which is the entire reason they live in ../src/limits and not at four mount sites (INV-12).
  const ALL = [
    PROPOSE_RATE,
    DRIVE_CREATE_RATE,
    PLAN_RATE_MINUTE,
    PLAN_RATE_HOUR,
    REGIONS_RATE,
  ]

  test('every bucket label is unique', () => {
    // Load-bearing twice over. ../src/rate-limit keys buckets `${label}:${ip}`, and — since the 2026-08
    // rejection log — the label is also the ONLY field a 429 emits: INV-13 forbids logging the rider's
    // IP, so a duplicated label leaves a rejection with nothing left to attribute it by. Copy-pasting a
    // bucket and forgetting the label is the exact mistake this catches.
    expect(new Set(ALL.map((r) => r.label)).size).toBe(ALL.length)
  })

  test('the per-minute buckets really do share one window, so their limits are comparable', () => {
    // The precondition for the next test: comparing `limit` across buckets is meaningless unless the
    // windows match. PLAN_RATE_HOUR is excluded on purpose — it is a second window on the same route.
    for (const r of [PROPOSE_RATE, DRIVE_CREATE_RATE, PLAN_RATE_MINUTE, REGIONS_RATE]) {
      expect(r.windowSec).toBe(60)
    }
  })

  test('the unpaid bucket is never tighter than a bucket that bills a vendor', () => {
    // GET /regions moves no per-request vendor money, while propose fires Google Routes and plan fires
    // a frontier model on EVERY request (INV-11). So the free path may sit above them and must never
    // fall below: if REGIONS_RATE ever becomes the tightest per-minute bucket, either a real cost
    // appeared behind /regions — which is a founder decision, not a tuning commit — or somebody edited
    // the wrong constant.
    // ⚠ THIS COVERED TWO UNPAID BUCKETS UNTIL 2026-08-05; SAMPLE_RATE was the other, and it was deleted
    // with `GET /sample`. The property is about the CLASS of route, not about either constant — so if a
    // second free, DB-touching route is ever added, it belongs in this loop on day one.
    for (const paid of [PROPOSE_RATE, DRIVE_CREATE_RATE, PLAN_RATE_MINUTE]) {
      expect(REGIONS_RATE.limit).toBeGreaterThanOrEqual(paid.limit)
    }
  })
})

describe('429 copy — the persona speaks, never a validator', () => {
  // ⚠ WHAT THIS GUARDS, because it is not obvious from either file alone: the mobile client's
  // `errorMessage()` returns an ApiError's `.message` VERBATIM, and these limiters mount ABOVE
  // ../src/plan-route, so a 429 never passes through that file's in-persona VOICE block. Whatever is
  // written on the cap is literally what the Skipper appears to say — and until 2026-08-02 every one
  // of these answered "Too many requests. Give it a moment and try again." on the one screen where the
  // persona speaks live, ungated, to an anonymous stranger.
  //
  // ⚠ THIS IS NOT A CAP CHANGE. Weakening a cap is a cost regression and a founder call (CLAUDE.md
  // STOP); the numbers here are untouched. Only what a rider READS on rejection moved.
  const RIDER_FACING = [
    PROPOSE_RATE,
    DRIVE_CREATE_RATE,
    PLAN_RATE_MINUTE,
    PLAN_RATE_HOUR,
    REGIONS_RATE,
  ]

  test('every rider-facing cap carries a line, and none of them sounds like a machine', () => {
    // Reported as a LIST OF LABELS rather than a per-cap assert so a failure names the offender —
    // `label` is the one field a 429 emits, so it is also how an operator would find it in logs.
    const missing = RIDER_FACING.filter((c) => !c.message || c.message.trim().length < 10)
    expect(missing.map((c) => c.label)).toEqual([])

    // The generic default in ../src/rate-limit is correct for an internal route and wrong for a rider.
    // Anything matching here has either been reverted to it or written in its register.
    const machine = RIDER_FACING.filter((c) => /too many requests|rate.?limit|quota|throttl/i.test(c.message))
    expect(machine.map((c) => c.label)).toEqual([])
  })

  test('no line leaks the number it is enforcing', () => {
    // The cap is OURS (INV-3/INV-12): a rider is told to wait, never told the budget they just spent.
    // A digit here is also how "20 per minute" ends up quoted back in a support email as a promise.
    const withDigits = RIDER_FACING.filter((c) => /\d/.test(c.message))
    expect(withDigits.map((c) => c.label)).toEqual([])
  })
})
