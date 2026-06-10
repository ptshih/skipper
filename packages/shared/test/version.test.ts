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
})
