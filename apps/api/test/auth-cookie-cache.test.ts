/**
 * Pins the session cookie cache — both that it is ON, and that its window stays SHORT.
 *
 * Enabling it was a deliberate trade (auth.ts, founder call 2026-08-02): it removes an auth-DB
 * round-trip from every `withSession` request, and in exchange REVOCATION IS DELAYED by `maxAge`.
 * Better Auth cannot delete a cookie on a device it is not talking to, so a signed-out or DELETED
 * account stays usable elsewhere until the cached copy expires.
 *
 * ⚠ Both halves of that trade are silent if they drift, which is why they are asserted rather than
 * trusted:
 *   • If `enabled` is dropped, nothing fails — the app just quietly pays the DB read again, and the
 *     revocation risk was taken for a benefit no longer received.
 *   • If `maxAge` is raised, nothing fails either — the orphan window on account deletion simply
 *     widens, and the sentence in auth.ts that justified the number stops being true.
 *
 * The ceiling here is the ceiling that reasoning supports. Raising it means re-doing the reasoning,
 * not editing this number.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

process.env.BETTER_AUTH_SECRET ??= 'test-only-secret-that-signs-nothing-real'

const origWarn = console.warn
console.warn = () => {}
const { auth } = await import('../src/auth')
console.warn = origWarn

/** The resolved options off the live instance — not a re-read of the source, so this fails if the
 *  key is misspelled, nested wrong, or dropped by a future refactor of how the config is built. */
const session = (auth.options as { session?: { cookieCache?: { enabled?: boolean; maxAge?: number } } })
  .session

describe('session cookie cache', () => {
  test('is ENABLED — otherwise the revocation trade buys nothing', () => {
    expect(session?.cookieCache?.enabled).toBe(true)
  })

  test('its window is 60s, well under the library default of 300', () => {
    // 300 is what better-auth uses when `maxAge` is absent (dist/cookies/index.mjs). Landing on the
    // default by accident — say, by deleting the key while keeping `enabled` — would 5× the window
    // in which a deleted account can still write.
    expect(session?.cookieCache?.maxAge).toBe(60)
  })

  test('the window never exceeds a minute', () => {
    // Stated as an inequality as well as an equality on purpose: the equality above catches a silent
    // deletion of the key, and this one states the actual INVARIANT — the orphan window on account
    // deletion is bounded by this number, and the argument in auth.ts is written for ≤60s.
    expect(session?.cookieCache?.maxAge).toBeLessThanOrEqual(60)
  })
})

describe('the vendor assumptions this rests on', () => {
  // Same instrument as auth-delete-hook.test.ts, and for the same reason: this behaviour is an
  // implementation detail of the installed package, not a public contract, and a dependency bump can
  // change it without changing any type we compile against.
  const PKG = dirname(Bun.resolveSync('better-auth/package.json', import.meta.dir))
  const read = (rel: string) => readFileSync(join(PKG, rel), 'utf8')

  test('the session route actually honours `cookieCache.enabled`', () => {
    // If this stops matching, the config above may be silently ignored — the worst outcome available,
    // because the revocation window would be real while the performance benefit is not.
    expect(read('dist/api/routes/session.mjs')).toContain('session?.cookieCache?.enabled')
  })

  test('a per-request escape hatch still exists for the write paths', () => {
    // `disableCookieCache` is what the TODO follow-up will hang the WRITE-path hardening off. If it
    // disappears in a bump, that plan needs rewriting before it is built.
    expect(read('dist/api/routes/session.mjs')).toContain('disableCookieCache')
  })

  test('the library default really is 300s, which is what 60 is chosen against', () => {
    expect(read('dist/cookies/index.mjs')).toMatch(/cookieCache\?\.maxAge \|\| 300/)
  })
})
