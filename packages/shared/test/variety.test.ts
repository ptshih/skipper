import { describe, expect, test } from 'bun:test'
import { varietyKey } from '../src/variety'

describe('varietyKey', () => {
  test('prefers the natural-feature kind when present', () => {
    expect(varietyKey('lake', ['body of water'])).toBe('lake')
  })

  // The actual gap: 85% of the narrated corpus has no `kind`, so the variety rule saw null === null and
  // treated a house and a casino as the same thing.
  test('derives a bucket for the built world, where kind is null', () => {
    expect(varietyKey(null, ['hotel'])).toBe('lodging')
    expect(varietyKey(null, ['casino'])).toBe('lodging')
    expect(varietyKey(null, ['single-family detached home'])).toBe('dwelling')
    expect(varietyKey(null, ['church building'])).toBe('worship')
    expect(varietyKey(null, ['railway station'])).toBe('transport')
    expect(varietyKey(null, ['ski resort'])).toBe('leisure')
  })

  test('a house and a hotel land in DIFFERENT buckets (they would have been both-null before)', () => {
    expect(varietyKey(null, ['house'])).not.toBe(varietyKey(null, ['hotel']))
  })

  test('returns null when nothing is known', () => {
    expect(varietyKey(null, null)).toBeNull()
    expect(varietyKey(null, ['some type nobody mapped'])).toBeNull()
  })
})
