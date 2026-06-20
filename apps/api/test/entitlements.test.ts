import { describe, expect, test } from 'bun:test'
import { isTester, meetsTier, tierOf, type TierSession } from '../src/tiers'

// Minimal session shape — the tier helpers read user.isAnonymous + user.tier (+ user.tester).
const session = (
  user: Partial<{ isAnonymous: boolean | null; tier: string | null; tester: boolean | null }>,
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

// region-release-gate: a tester sees STAGED (not-yet-released) content. A wrong answer either leaks
// unreleased clips to the public or hides released clips from testers — so pin the truth table.
describe('isTester', () => {
  test('no session → not a tester', () => {
    expect(isTester(null)).toBe(false)
  })
  test('anonymous guest is never a tester (the bit lives on a real account)', () => {
    expect(isTester(session({ isAnonymous: true, tester: true }))).toBe(false)
  })
  test('signed-in account without the flag → not a tester', () => {
    expect(isTester(session({ tester: false }))).toBe(false)
    expect(isTester(session({ tester: null }))).toBe(false)
    expect(isTester(session({}))).toBe(false)
  })
  test('signed-in account with tester=true → tester (any paying tier)', () => {
    expect(isTester(session({ tier: 'free', tester: true }))).toBe(true)
    expect(isTester(session({ tier: 'paid', tester: true }))).toBe(true)
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
