import { describe, expect, test } from 'bun:test'
import { hasAnySession, shouldMintAnonymous, type MintInputs } from './anon-session-util'

// Session fixtures shaped like Better Auth's, narrowed to the one field that matters. The REAL one
// is the fixture this whole file exists for.
const anonymousSession = { user: { id: 'anon_1', isAnonymous: true } }
const realSession = { user: { id: 'usr_1', isAnonymous: false } }
/** A session cached in SecureStore before the anonymous plugin shipped — no `isAnonymous` at all.
 *  It is a REAL account, and every predicate here must treat it as one. */
const legacySession = { user: { id: 'usr_legacy' } }

/** The one state in which minting is correct: settled, session-less, online, untried. Every test
 *  below flips exactly one field off this base, so a failure names its own cause. */
const mintable: MintInputs = {
  isPending: false,
  hasSession: false,
  offline: false,
  attempted: false,
  sessionErrored: false,
}

describe('hasAnySession', () => {
  test('a REAL session counts as a session', () => {
    expect(hasAnySession(realSession)).toBe(true)
  })

  test('a session with no isAnonymous field (pre-1.1 cache) counts as a session', () => {
    expect(hasAnySession(legacySession)).toBe(true)
  })

  test('an ANONYMOUS session counts as a session', () => {
    // Minting against one earns a BAD_REQUEST from the server, not a new user
    // (better-auth dist/plugins/anonymous/index.mjs:44). Wasted round-trip, nothing worse.
    expect(hasAnySession(anonymousSession)).toBe(true)
  })

  test('no session, a loading session, and a session with a null user all count as none', () => {
    expect(hasAnySession(null)).toBe(false)
    expect(hasAnySession(undefined)).toBe(false)
    expect(hasAnySession({ user: null })).toBe(false)
    expect(hasAnySession({})).toBe(false)
  })
})

describe('shouldMintAnonymous', () => {
  // ══ THE LOAD-BEARING CASE ══════════════════════════════════════════════════════════════════
  // `/sign-in/anonymous` does NOT refuse a signed-in caller — it overwrites the session cookie
  // with a fresh anonymous one (index.mjs:44 guards on isAnonymous ONLY, then :47-62 creates the
  // user and sets the cookie unconditionally). A mint fired here signs a real rider out of their
  // account, their drives and their credits, silently. This assertion is the guard.
  //
  // ⚠ MUTATION-CHECKED 2026-08-01: rewriting `hasAnySession` to mirror the SERVER's guard
  // (`session?.user?.isAnonymous === true` — "don't mint if already anonymous", the natural and
  // wrong reading) turns this test RED and leaves every other test in the file green. If you are
  // here because it failed, do not relax it; the mint is a convenience and the account is not.
  test('a REAL session is never overwritten', () => {
    expect(shouldMintAnonymous({ ...mintable, hasSession: hasAnySession(realSession) })).toBe(false)
  })

  test('a pre-1.1 cached session with no isAnonymous field is never overwritten', () => {
    expect(shouldMintAnonymous({ ...mintable, hasSession: hasAnySession(legacySession) })).toBe(
      false,
    )
  })
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  test('an ANONYMOUS session is not re-minted', () => {
    expect(shouldMintAnonymous({ ...mintable, hasSession: hasAnySession(anonymousSession) })).toBe(
      false,
    )
  })

  test('a settled, session-less, online, untried launch MINTS', () => {
    expect(shouldMintAnonymous(mintable)).toBe(true)
    expect(shouldMintAnonymous({ ...mintable, hasSession: hasAnySession(null) })).toBe(true)
  })

  test('a PENDING session never mints, even though data is still null', () => {
    // The expo client seeds `data` from a local cache without clearing `isPending`, and only when
    // the cached copy has not expired (@better-auth/expo dist/client.js:274-284). So `!hasSession`
    // while pending means "not known yet", never "no account" — minting on it is the same
    // data-loss bug as the real-session case, arriving one tick earlier.
    expect(shouldMintAnonymous({ ...mintable, isPending: true })).toBe(false)
  })

  test('one attempt per process — a failed mint never retries in-process', () => {
    // INV-14: /sign-in/anonymous must not be loopable. There is no rider-facing cost to not
    // retrying — the planner sends no cookie and /propose is open to anonymous.
    expect(shouldMintAnonymous({ ...mintable, attempted: true })).toBe(false)
  })

  test('offline never mints', () => {
    expect(shouldMintAnonymous({ ...mintable, offline: true })).toBe(false)
  })

  test('offline does NOT consume the one attempt — the online edge still mints', () => {
    // The caller sets `attempted` only when an attempt is actually made, so a launch in a dead zone
    // leaves the shot intact and the offline→online transition re-runs the effect. This asserts the
    // predicate's half of that contract: the ONLY difference between the two states is `offline`.
    const deadZone = { ...mintable, offline: true }
    expect(shouldMintAnonymous(deadZone)).toBe(false)
    expect(shouldMintAnonymous({ ...deadZone, offline: false })).toBe(true)
  })

  test('a FAILED session read never mints — unknown must behave like "there is one"', () => {
    // The gap `isPending` cannot close: once the read settles, better-auth reports a failed
    // /get-session as { data: null, error }, which on `data` alone is indistinguishable from an
    // honest "no session". Minting is the irreversible direction (an orphan row nothing may reap),
    // so the unknown answer has to be the conservative one.
    expect(shouldMintAnonymous({ ...mintable, sessionErrored: true })).toBe(false)
  })

  test('every clause is required — flipping any one alone blocks the mint', () => {
    for (const key of ['isPending', 'hasSession', 'offline', 'attempted', 'sessionErrored'] as const) {
      expect(shouldMintAnonymous({ ...mintable, [key]: true })).toBe(false)
    }
  })
})
