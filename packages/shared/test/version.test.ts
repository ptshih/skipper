import { describe, expect, test } from 'bun:test'
import { compareVersions, gateFor } from '../src/version'

describe('compareVersions', () => {
  test('orders by numeric segment', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1)
    expect(compareVersions('1.2.0', '1.1.9')).toBe(1)
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
  })

  test('treats missing/short segments as 0', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
    expect(compareVersions('1.2.0', '1.2')).toBe(0)
    expect(compareVersions('1', '1.0.1')).toBe(-1)
  })

  test('is numeric, not lexicographic', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1)
  })

  test('treats non-numeric / missing core segments as 0 (no parseInt leak)', () => {
    expect(compareVersions('1.x.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.2.', '1.2.0')).toBe(0)
  })

  test('a leading "-" is the semver prerelease delimiter, not a negative segment', () => {
    // "1.-1.0" parses as core "1.0" + prerelease "1.0" → less than the release "1.0.0".
    // (So a negative can never reach the numeric core to leak through, as the old code did.)
    expect(compareVersions('1.-1.0', '1.0.0')).toBe(-1)
  })

  test('ignores build metadata', () => {
    expect(compareVersions('1.2.3+abc', '1.2.3+def')).toBe(0)
    expect(compareVersions('1.2.3+build', '1.2.4')).toBe(-1)
  })

  test('a prerelease has lower precedence than its release (semver §11)', () => {
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(-1)
    expect(compareVersions('1.0.0', '1.0.0-beta')).toBe(1)
    expect(compareVersions('1.0.0-rc.1', '1.0.0-rc.1')).toBe(0)
  })

  test('orders prerelease identifiers per semver §11', () => {
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1) // fewer fields → lower
    expect(compareVersions('1.0.0-alpha.1', '1.0.0-alpha.beta')).toBe(-1) // numeric < alphanumeric
    expect(compareVersions('1.0.0-alpha.beta', '1.0.0-beta')).toBe(-1) // ASCII order
    expect(compareVersions('1.0.0-2', '1.0.0-11')).toBe(-1) // numeric, not lexicographic
  })
})

describe('gateFor', () => {
  const policy = { minimum: '1.0.0', recommended: '1.2.0' }

  test('below minimum → force', () => {
    expect(gateFor('0.9.0', policy)).toBe('force')
  })

  test('at/above minimum but below recommended → nudge', () => {
    expect(gateFor('1.0.0', policy)).toBe('nudge')
    expect(gateFor('1.1.9', policy)).toBe('nudge')
  })

  test('at/above recommended → ok', () => {
    expect(gateFor('1.2.0', policy)).toBe('ok')
    expect(gateFor('2.0.0', policy)).toBe('ok')
  })

  test('no-op floor (minimum === recommended === current) → ok', () => {
    expect(gateFor('0.0.0', { minimum: '0.0.0', recommended: '0.0.0' })).toBe('ok')
  })

  test('a prerelease just under the floor still forces', () => {
    // 1.0.0-beta < 1.0.0 by semver, so a prerelease build of the minimum is gated out.
    expect(gateFor('1.0.0-beta', { minimum: '1.0.0', recommended: '1.0.0' })).toBe('force')
  })
})
