import { describe, expect, test } from 'bun:test'
import { isAdmin, tierOf, type TierSession } from '../src/tiers'

// Minimal session shape — the access helpers read user.isAnonymous (+ user.role). There is no tier
// column anymore (premium = credits); any real account is `free`.
const session = (
  user: Partial<{ isAnonymous: boolean | null; role: string | null }>,
): TierSession => ({
  user: { isAnonymous: false, ...user },
})

describe('tierOf', () => {
  test('no session → anonymous', () => {
    expect(tierOf(null)).toBe('anonymous')
  })
  test('anonymous-plugin guest → anonymous', () => {
    expect(tierOf(session({ isAnonymous: true }))).toBe('anonymous')
  })
  test('any signed-in account → free', () => {
    expect(tierOf(session({}))).toBe('free')
    expect(tierOf(session({ role: 'admin' }))).toBe('free')
  })
})

// region-release-gate: an admin sees STAGED (not-yet-released) content. A wrong answer either leaks
// unreleased clips to the public or hides released clips from admins — so pin the truth table.
describe('isAdmin', () => {
  test('no session → not an admin', () => {
    expect(isAdmin(null)).toBe(false)
  })
  test('anonymous guest is never an admin (the role lives on a real account)', () => {
    expect(isAdmin(session({ isAnonymous: true, role: 'admin' }))).toBe(false)
  })
  test('signed-in account without the admin role → not an admin', () => {
    expect(isAdmin(session({ role: 'user' }))).toBe(false)
    expect(isAdmin(session({ role: null }))).toBe(false)
    expect(isAdmin(session({}))).toBe(false)
  })
  test('signed-in account with role=admin → admin', () => {
    expect(isAdmin(session({ role: 'admin' }))).toBe(true)
  })
})
