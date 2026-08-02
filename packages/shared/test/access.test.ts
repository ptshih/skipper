// The access predicates are shared by the API and the app (packages/shared/src/access.ts), so this is
// the ONE place their behaviour is pinned. INV-9's whole point is that the obvious reading —
// `session ?` — is wrong, so every case below is a case someone would get wrong by writing the
// obvious thing.
import { describe, expect, test } from 'bun:test'
import { isAdmin, isSignedIn, tierOf, type AccessSession } from '../src/access'

const anon: AccessSession = { user: { id: 'u1', isAnonymous: true } as AccessSession['user'] }
const account: AccessSession = { user: { isAnonymous: false } }
const admin: AccessSession = { user: { isAnonymous: false, role: 'admin' } }

describe('tierOf', () => {
  test('no session at all is anonymous', () => {
    expect(tierOf(null)).toBe('anonymous')
    expect(tierOf(undefined)).toBe('anonymous')
    expect(tierOf({})).toBe('anonymous')
    expect(tierOf({ user: null })).toBe('anonymous')
  })

  // ⚠ THE ONE THAT MATTERS. An anonymous session is a REAL user row with a real id, so it is perfectly
  // truthy — and it owns nothing. Reading `session ?` as "signed in" is the bug this file exists for.
  test('a TRUTHY anonymous session is still anonymous', () => {
    expect(tierOf(anon)).toBe('anonymous')
    expect(isSignedIn(anon)).toBe(false)
  })

  test('a real account is free', () => {
    expect(tierOf(account)).toBe('free')
    expect(isSignedIn(account)).toBe(true)
  })

  // A session cached before the anonymous plugin was registered carries no `isAnonymous` at all.
  // Reading that as anonymous would log a real rider out of their own drives on upgrade. This is the
  // CLIENT's rule, and it is why the predicate cannot simply be `!user.isAnonymous`.
  test('a MISSING isAnonymous reads as a real account, not as anonymous', () => {
    expect(tierOf({ user: {} })).toBe('free')
    expect(tierOf({ user: { isAnonymous: null } })).toBe('free')
  })

  // ⚠ THE SERVER'S RULE, AND THE ONE NOTHING PINNED UNTIL NOW. A malformed-but-PRESENT value must fail
  // toward `anonymous` — `entitlements.ts` calls that "the secure direction" — because `free` is the
  // tier that opens the five gated routes, mints a grant, and takes drive ownership. Written against an
  // anonymous row those become ledger and drive rows stranded forever (INV-4: hard-deleted at link, no
  // cascade, no session left to retry). The first shared version used `=== true` and would have
  // returned `free` for every one of these.
  test('a PRESENT but malformed isAnonymous fails toward anonymous, never toward free', () => {
    for (const bad of [1, 'true', 'false', {}, [], 'yes']) {
      expect(tierOf({ user: { isAnonymous: bad as unknown as boolean } })).toBe('anonymous')
      expect(isSignedIn({ user: { isAnonymous: bad as unknown as boolean } })).toBe(false)
    }
  })

  test('only an exact false is a real account when the field is present', () => {
    expect(tierOf({ user: { isAnonymous: false } })).toBe('free')
    expect(tierOf({ user: { isAnonymous: 0 as unknown as boolean } })).toBe('anonymous')
  })
})

describe('isAdmin — the SOLE bypass of the release filter', () => {
  test('an admin account is an admin', () => {
    expect(isAdmin(admin)).toBe(true)
  })

  test('a plain account and no session are not', () => {
    expect(isAdmin(account)).toBe(false)
    expect(isAdmin(null)).toBe(false)
  })

  // ⚠ This is the case the CLIENT's copy got wrong until step 8b. It is latent — the plugin defaults an
  // anonymous row's role to 'user' — but it was one server-side role write away from serving STAGED
  // content to a session nobody authenticated.
  test('an anonymous session is NEVER an admin, even carrying role=admin', () => {
    expect(isAdmin({ user: { isAnonymous: true, role: 'admin' } })).toBe(false)
  })
})
