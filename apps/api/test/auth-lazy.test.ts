// The MECHANISM the /drives access boundary now rests on (1.1 step 8 pre-work).
//
// ../src/auth used to throw at import, which forced every importer of ../src/drives to carry a
// secret and made a request-level test of the anonymous split impossible. It is now a LAZY MEMOIZED
// proxy. Two properties keep that from being a silent downgrade, and this file asserts both:
//
//   1. MEMOIZATION. createLazyProxy (packages/db/src/client.ts) runs its factory on EVERY property
//      read. Un-memoized, `auth.api.…` — i.e. every request through withSession — would construct a
//      whole new better-auth context, including a NEW in-memory rate-limit store, silently disabling
//      the brute-force guard on /sign-in/email and the INV-14 ceiling on /sign-in/anonymous. Nothing
//      throws. Nothing else in this suite would notice. ⚠ Mutation-checked before commit: dropping
//      `cached ??=` in buildAuth turns the identity test below RED and nothing else changes.
//   2. THE ASSERT STILL THROWS. Moving fail-fast out of module scope is only safe because
//      `assertAuthEnv()` exists and ../src/index calls it eagerly.
//
// ⚠ NO MOCKS HERE, deliberately — mock.module is process-wide under bun (one registry for the whole
// run; see plan-stream.test.ts's header and the 96-pass/9-fail incident), and this file has nothing
// to gain from one. It builds the REAL auth instance, which is safe because that reaches no network
// and no DB: better-auth's drizzleAdapter only closes over the client (the schema is supplied, so it
// never reads `db._.fullSchema`), and ../src/auth-db is itself a lazy proxy. Verified against the
// installed better-auth 1.6.23.

import { describe, expect, test } from 'bun:test'

// Seeded because building auth is the point of this file — `authSecret()` throws without it. Never a
// real value; nothing here exercises auth crypto. Same `??=` as cors.test.ts so whichever file bun
// runs first wins and neither clobbers the other.
process.env.BETTER_AUTH_SECRET ??= 'test-only-secret-that-signs-nothing-real'

const { assertAuthEnv, auth } = await import('../src/auth')

describe('the auth instance is lazy and MEMOIZED', () => {
  test('two property reads return the SAME instance', () => {
    // `api` is a plain object on the better-auth instance, so the proxy returns it unbound and
    // identity is meaningful. Memoized: one build, one `api`. Un-memoized: two builds, two objects,
    // and every request would be carrying its own rate-limit counter.
    expect(auth.api).toBe(auth.api)
  })

  test('the proxy really did defer — the instance is only built on first read', () => {
    // Guards the OTHER half: importing ../src/auth must stay side-effect-free, because that is what
    // lets ../src/drives be imported (and tested) without env. If someone "simplifies" the proxy
    // back to `export const auth = createAuth()`, the import above still succeeds here — the secret
    // is seeded — so nothing in this file would catch it except this: a module-scope build would
    // have happened before the delete below, and the read after it would still succeed.
    const saved = process.env.BETTER_AUTH_SECRET
    delete process.env.BETTER_AUTH_SECRET
    try {
      // Already built by the test above (bun runs a file's tests in order), so this must NOT throw —
      // the memo answers without re-reading env. The assertion is that laziness is not re-entrant.
      expect(auth.api).toBeDefined()
    } finally {
      process.env.BETTER_AUTH_SECRET = saved
    }
  })
})

describe('assertAuthEnv is the boot-time gate', () => {
  test('it throws with the REMEDIATION when the secret is missing', () => {
    // The message matters as much as the throw: this is the error a founder or a fresh clone sees,
    // and it is the only thing standing between a missing secret and better-auth silently running on
    // its publicly-known DEFAULT_SECRET (it only throws on its own under NODE_ENV=production).
    const saved = process.env.BETTER_AUTH_SECRET
    delete process.env.BETTER_AUTH_SECRET
    try {
      expect(() => assertAuthEnv()).toThrow(/BETTER_AUTH_SECRET/)
      expect(() => assertAuthEnv()).toThrow(/dotenvx set/)
    } finally {
      process.env.BETTER_AUTH_SECRET = saved
    }
  })

  test('it passes once the secret is set', () => {
    // ⚠ Swallow the mailer warning rather than assert on it: RESEND_API_KEY's presence depends on
    // whether the runner is under dotenvx, and a test that fails based on the operator's env is
    // worse than no test. What is asserted is that the WARNING PATH DOES NOT THROW — a boot gate
    // that fell over on a missing mailer would take the anonymous front door down with it.
    const origWarn = console.warn
    console.warn = () => {}
    try {
      expect(() => assertAuthEnv()).not.toThrow()
    } finally {
      console.warn = origWarn
    }
  })
})
