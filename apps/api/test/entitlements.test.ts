import { describe, expect, test } from 'bun:test'
import { meetsTier, tierOf, type TierSession } from '../src/tiers'

// Minimal session shape — tierOf only reads user.isAnonymous + user.tier.
const session = (user: Partial<{ isAnonymous: boolean | null; tier: string | null }>): TierSession => ({
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

describe('meetsTier', () => {
  test('ranks anonymous < free < paid', () => {
    expect(meetsTier('anonymous', 'free')).toBe(false)
    expect(meetsTier('free', 'free')).toBe(true)
    expect(meetsTier('free', 'paid')).toBe(false)
    expect(meetsTier('paid', 'free')).toBe(true)
    expect(meetsTier('anonymous', 'anonymous')).toBe(true)
  })
})
