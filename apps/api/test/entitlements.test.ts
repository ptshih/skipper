import { describe, expect, test } from 'bun:test'
import { isAdmin, meetsTier, tierOf, type TierSession } from '../src/tiers'

// Minimal session shape — the tier helpers read user.isAnonymous + user.tier (+ user.role).
const session = (
  user: Partial<{ isAnonymous: boolean | null; tier: string | null; role: string | null }>,
): TierSession => ({
  user: { isAnonymous: false, tier: 'free', ...user },
})

describe('tierOf', () => {
  test('no session → anonymous', () => {
    expect(tierOf(null)).toBe('anonymous')
  })
  test('anonymous-plugin guest → anonymous', () => {
    expect(tierOf(session({ isAnonymous: true }))).toBe('anonymous')
  })
  test('signed-in account → free', () => {
    expect(tierOf(session({ tier: 'free' }))).toBe('free')
  })
  test('subscriber → paid', () => {
    expect(tierOf(session({ tier: 'paid' }))).toBe('paid')
  })
  test('missing/unknown tier on a real user falls back to free', () => {
    expect(tierOf(session({ tier: null }))).toBe('free')
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
  test('signed-in account with role=admin → admin (any paying tier)', () => {
    expect(isAdmin(session({ tier: 'free', role: 'admin' }))).toBe(true)
    expect(isAdmin(session({ tier: 'paid', role: 'admin' }))).toBe(true)
  })
})

describe('meetsTier', () => {
  test('ranks anonymous < free < paid', () => {
    expect(meetsTier('anonymous', 'free')).toBe(false)
    expect(meetsTier('free', 'free')).toBe(true)
    expect(meetsTier('free', 'paid')).toBe(false)
    expect(meetsTier('paid', 'free')).toBe(true)
    expect(meetsTier('anonymous', 'anonymous')).toBe(true)
  })
})
