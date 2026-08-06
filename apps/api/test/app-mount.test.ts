// POST /drives/plan answers a rider with NO session — the app-level assertion ../src/plan-route.ts and
// ../src/index.ts both promise in prose. THIS is that test; until it existed the promise was the only
// guard, which is how the boundary stayed uncovered while steps 6-10 were built on top of it.
//
// ⚠ WHY IT MATTERS MORE THAN THE ONE `expect` LOOKS. The planner is the OPEN ANONYMOUS FRONT DOOR
// (D14/D15): a rider plans a whole drive by talking, and only meets the wall at POST /drives. Losing
// that is silent in the way that costs the most — nothing throws, every planner test stays green, and
// the symptom a rider reports ("it wants me to make an account") reads like an AUTH bug, so it gets
// triaged against ../src/entitlements instead of against a mount order. At least three separate edits
// produce it, which is why the assertion below is about the OUTCOME rather than about any one
// arrangement:
//   • the plan mount sliding BELOW `app.route('/drives', driveRoutes)` — hono matches in REGISTRATION
//     order, so anything the /drives mount answers first wins;
//   • `requireAccount` going back onto the `/drives*` mount (INV-15) with the plan mount below it;
//   • a gate added inside ../src/plan-route.ts itself.
//
// ⚠ THE FIRST TWO ARE ONE HAZARD, NOT TWO, and the prose upstream slightly overstates it: measured
// 2026-08-02 against a mutated copy of ../src/index, a reorder ALONE is currently harmless — driveRoutes
// registers no terminal catch-all, only `use('*', withSession)`, so a POST that matches nothing inside it
// falls through to whatever was registered next. It is the COMBINATION (a blanket wall on the mount plus
// the plan route below it) that 401s. That is why the assertion here is behavioural: it does not care
// which half of the combination arrives first.
//
// ⚠ NO DB AND NO NETWORK, and that is a property of the FIXTURES, not of luck: every body below is
// malformed on purpose, and plan-route.ts rejects on request SHAPE before the region query and long
// before the model call. A well-formed body here would reach Neon — dev and prod share ONE database —
// and then SPEND (INV-11). Keep every request in this file unparseable.
//
// ⚠ NO MOCKS IN THIS FILE, deliberately. `mock.module` is process-wide under bun (see the header of
// plan-stream.test.ts and the 96-pass/9-fail incident), and this file's entire value is that it drives
// the REAL object ../src/index exports to Bun. A mock here would be both a leak and a lie.

import { describe, expect, test } from 'bun:test'

// Same seed, same `??=`, same reason as cors.test.ts — ../src/index calls `assertAuthEnv()` at top
// level as the boot-time fail-fast, and this file boots the app for real. See that file's header for
// why deleting the line would be a symptom rather than a fix.
process.env.BETTER_AUTH_SECRET ??= 'test-only-secret-that-signs-nothing-real'

// Booting without a mailer logs the expected "SIGN-IN AND SIGN-UP WILL FAIL" warning — real and correct in
// production, noise here. Silence it across the import only.
const origWarn = console.warn
console.warn = () => {}
const app = (await import('../src/index')).default
const { requireAccount } = await import('../src/entitlements')
const { planRoutes } = await import('../src/plan-route')
console.warn = origWarn

/** ⚠ Malformed on purpose (see the header). `'{'` dies in JSON.parse; the object body is well-formed
 *  JSON that fails `drivePlanRequest`. Both are answered by plan-route.ts BEFORE the region read. */
const post = (path: string, body: string) =>
  app.fetch(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    }),
  )

describe('POST /drives/plan is reachable with NO session', () => {
  // ⚠ TWO ASSERTIONS, AND THE SECOND IS NOT DECORATION. `not.toBe(401)` alone would pass on a 404 —
  // i.e. on the plan mount being deleted outright. The `bad_request` code is plan-route.ts's own
  // rejection vocabulary, so reading it back is what proves the request reached THAT handler rather
  // than merely missing the wall.
  test('an unparseable body is answered by the planner handler, not by the account wall', async () => {
    const res = await post('/drives/plan', '{')
    expect(res.status).not.toBe(401)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error?: string }).error).toBe('bad_request')
  })

  test('a well-formed body of the wrong shape is the planner handler too', async () => {
    // A second shape, one validator further in: this one clears JSON.parse and fails the Zod parse, so
    // it proves the handler is reached even when the request survives its first gate.
    const res = await post('/drives/plan', JSON.stringify({ turns: [], regionId: 'not-a-uuid' }))
    expect(res.status).not.toBe(401)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error?: string }).error).toBe('bad_request')
  })

  // ⚠ THE CONTROL, and without it the two tests above are close to vacuous: they would also pass in a
  // process where NOTHING is walled. This one shows 401 is the live, available answer on the same app
  // for a caller with no session — so the planner's non-401 is a fact about the planner's placement,
  // not about a wall that stopped working. The /drives boundary ITSELF is owned by
  // drive-access.test.ts (INV-15's primary control); this is only borrowing it as a reference point.
  test('CONTROL — POST /drives with no session IS 401 in this same app', async () => {
    const res = await post('/drives', '{}')
    expect(res.status).toBe(401)
    expect(((await res.json()) as { error?: string }).error).toBe('account_required')
  })
})

describe('the planner sub-app registers no gate of its own', () => {
  // ⚠ WHAT CANNOT BE ASSERTED HERE, so the next agent does not spend an afternoon on it: the top-level
  // REGISTRATION ORDER is not inspectable from a test. hono does expose `routes` on an app instance
  // (drive-access.test.ts pins driveRoutes' table that way), but ../src/index exports only the Bun
  // server object — `{ port, idleTimeout, fetch, maxRequestBodySize }` — and `app.fetch` is a bound
  // class field that carries no `routes`. Verified 2026-08-02. Exporting the instance purely to test it
  // is a production edit for a property the behavioural tests above already cover from the outside;
  // they catch a reorder by its EFFECT, which is the thing riders actually experience.
  //
  // What IS inspectable is this sub-app's own table, and it earns its place for a sharper reason than
  // "one more layer": THE BEHAVIOURAL TESTS ABOVE CANNOT CATCH THIS ONE. `requireAccount` reads
  // `c.get('tier')`, which only `withSession` sets — and the plan mount deliberately carries no session
  // middleware (the planner has no corpus access, so there is nothing an admin could be shown that a
  // stranger could not). Measured 2026-08-02 against a mutated copy: a `requireAccount` added inside
  // ../src/plan-route.ts lets every request through, because an unset tier is not `'anonymous'`. So the
  // gate would be dead code, the 200 would keep flowing, and only the route table would say so. It also
  // catches the NEXT route: the tests above can only ever see POST /.
  test('every route in planRoutes is anonymous-reachable', () => {
    const gated = planRoutes.routes.filter((r) => r.handler === requireAccount)
    // Named, not boolean, so the failure says WHICH route someone walled.
    expect(gated.map((r) => `${r.method} ${r.path}`)).toEqual([])
  })
})

// ⚠ WHAT THIS FILE DELIBERATELY DOES NOT TRY TO PROVE: that the two stacked rate limiters on
// /drives/plan actually COUNT. ../src/rate-limit.ts returns next() unconditionally under NODE_ENV=test,
// which `bun test` sets, so a limiter is untestable BY CONSTRUCTION here — it consumes no bucket and
// sets no header, so even its PRESENCE is unobservable from a response. ../src/limits.ts owns those
// numbers (INV-12) and records the stacking probe that verified two windows do not leak into each
// other. Do not write a test that asserts a 429 on this path; it can only ever pass by accident.
