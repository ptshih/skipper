// THE RIDER-FACING RATE LIMITERS ARE ACTUALLY MOUNTED (INV-11/INV-12).
//
// ⚠ WHY THIS FILE EXISTS AT ALL, since test/limits.test.ts already covers "the caps". That file pins
// the NUMBERS and the LABELS, and states plainly what it cannot do: ../src/rate-limit returns next()
// unconditionally under NODE_ENV=test, so no behavioural test can prove a bucket COUNTS or that a 429
// ever fires. True — but "does it count" and "is it mounted at all" are DIFFERENT properties, and only
// the first one is unreachable. The second is plain structure, and leaving it unpinned meant the three
// paths that bill an EXTERNAL VENDOR could lose their cap in a refactor with nothing to notice:
//
//   POST /drives/propose  → one Google Routes call per request, anonymous, forever
//   POST /drives/plan     → a frontier model per request, anonymous, forever (TWO windows)
//
// No test would fail, no type would break, nothing would throw. The only signal is the invoice — the
// same shape of silence as the Cloud Run max-instances default. INV-11 names the rate limiter as one of
// the four guards on rider-triggered spend; a guard that is not mounted is not a guard.
//
// ⚠ THE MECHANISM IS IDENTITY, and it is why ../src/index exports these middlewares. Each `rateLimit()`
// call returns a FRESH closure, so while they were inline there was nothing to compare — that is
// precisely what made them unpinnable. Hono records `{ basePath, path, method, handler }` per
// registered handler and never wraps it, so a named const is comparable. Exactly the technique
// test/drive-access.test.ts uses for `requireAccount` / `createDriveLimiter`, which is also why THAT
// limiter — the only one already named — was the only one already guarded.
//
// ⚠ MOUNT ORDER IS PART OF THE CONTRACT, not decoration. `app.use('/x')` matches that EXACT path only
// (never subpaths), and Hono matches in REGISTRATION order — so a limiter registered below
// `app.route('/drives', driveRoutes)` is dead, and `/drives/plan` mounted below it is swallowed
// entirely. Both are asserted.

import { describe, expect, test } from 'bun:test'

// Same seed, same `??=`, same reason as cors.test.ts / app-mount.test.ts — ../src/index calls
// `assertAuthEnv()` at top level as the boot-time fail-fast, and this file boots the app for real.
process.env.BETTER_AUTH_SECRET ??= 'test-only-secret-that-signs-nothing-real'

// Booting without a mailer logs the expected "RESET WILL FAIL" warning — real and correct in
// production, noise here. Silence it across the import only.
const origWarn = console.warn
console.warn = () => {}
const mod = await import('../src/index')
console.warn = origWarn

// ⚠ The HONO instance, not `mod.default` — the default export is Bun's serve config
// (`{ port, fetch, … }`), which carries no `.routes` and makes the middleware chain invisible.
const { app, proposeLimiter, planMinuteLimiter, planHourLimiter, sampleLimiter, regionsLimiter } = mod

// ⚠ The REAL `withSession`, imported rather than reconstructed: the /regions order assertion below is
// only meaningful if it compares against the same reference ../src/index mounted.
const { withSession } = await import('../src/entitlements')

/** Every registered handler on `path`, in REGISTRATION order. */
const handlersOn = (path: string): unknown[] =>
  app.routes.filter((r) => r.path === path).map((r) => r.handler)

/** The index of the first registration at `path`, for order comparisons across different paths. */
const firstIndexOf = (path: string): number => app.routes.findIndex((r) => r.path === path)

describe('the paid anonymous paths carry their rate limiter', () => {
  test('POST /drives/propose — the Google Routes path is capped', () => {
    // Anonymous, uncapped otherwise, and one billed Routes call per request (D14/INV-11).
    expect(handlersOn('/drives/propose')).toContain(proposeLimiter)
  })

  test('POST /drives/plan carries BOTH windows, minute BEFORE hour', () => {
    // Two mounts = two independent bucket maps (each rateLimit() closes over its own). The per-minute
    // window alone permits ~28,800 requests/day per IP per instance on a path that bills a frontier
    // model every time; the hourly window is what makes that a bounded number, so losing EITHER is a
    // cost regression and losing the hour one is the quieter of the two.
    const chain = handlersOn('/drives/plan')
    expect(chain).toContain(planMinuteLimiter)
    expect(chain).toContain(planHourLimiter)
    expect(chain.indexOf(planMinuteLimiter)).toBeLessThan(chain.indexOf(planHourLimiter))
  })

  test('GET /sample is capped too', () => {
    // Not a spend guard — it bills no vendor — but it is an anonymous, uncapped, DB-touching route,
    // which is a standing invitation. Pinned for the same structural reason, not the same cost reason.
    expect(handlersOn('/sample')).toContain(sampleLimiter)
  })

  test('GET /regions is capped too', () => {
    // Same family as /sample: no vendor charge, a LOAD cap. What it bounds is not the two corpus
    // queries — REGIONS_MEMO_TTL_MS already caps those — but the `withSession` resolve that runs
    // ahead of the memo. ⚠ Not "an auth-DB round-trip on every request": with cookieCache on, the
    // common rider path is answered from the cookie. The uncapped path is the attacker-controlled
    // one — a minted anonymous token sent WITHOUT `sessionData` reaches the DB every time. The exact
    // mechanism, read off the installed better-auth source, is in ../src/limits.
    expect(handlersOn('/regions')).toContain(regionsLimiter)
  })
})

describe('⚠ /regions — the limiter must run BEFORE the session read', () => {
  test('regionsLimiter is registered above withSession', () => {
    // THE ORDER IS THE WHOLE VALUE HERE. Both are mounted on the exact same path, so a refactor that
    // reorders these two lines leaves every test green, every type sound, and the cap still returning
    // 429s — while capping nothing that matters, because the session resolve this exists to bound
    // would already have run. The only visible symptom would be auth-DB load that nothing explains.
    // Mutation-checked: swapping the two mounts in ../src/index fails this.
    const chain = handlersOn('/regions')
    expect(chain).toContain(regionsLimiter)
    expect(chain).toContain(withSession)
    expect(chain.indexOf(regionsLimiter)).toBeLessThan(chain.indexOf(withSession))
  })
})

describe('⚠ mount ORDER — a limiter registered too late is dead', () => {
  test('/drives/propose and /drives/plan are registered ABOVE the /drives sub-app', () => {
    // `app.use('/x')` matches the EXACT path only, and Hono matches in registration order. Below
    // `app.route('/drives', driveRoutes)` the plan path is swallowed by that sub-app (every anonymous
    // plan then 401s — a failure that reads like an auth bug, not a routing one), and the propose
    // limiter never runs. ../src/index warns about this in prose; this is the mechanical version.
    const driveMount = firstIndexOf('/drives/*')
    expect(driveMount).toBeGreaterThanOrEqual(0) // the sub-app is mounted at all
    expect(firstIndexOf('/drives/propose')).toBeLessThan(driveMount)
    expect(firstIndexOf('/drives/plan')).toBeLessThan(driveMount)
  })
})

describe('⚠ the limiters are DISTINCT instances', () => {
  test('no two mounts share a bucket map', () => {
    // Each rateLimit() call closes over its OWN Map, so reusing one middleware on two paths would
    // silently merge their counts — a rider's /sample reads would then eat their /drives/plan budget.
    // Cheap to assert, and the failure mode is invisible at every other layer.
    const all = [proposeLimiter, planMinuteLimiter, planHourLimiter, sampleLimiter, regionsLimiter]
    expect(new Set(all).size).toBe(all.length)
  })
})
