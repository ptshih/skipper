import { describe, expect, test } from 'bun:test'
import { formatMmss, formatMmssMs } from '../src/format'

describe('formatMmss', () => {
  test('formats minutes:seconds', () => {
    expect(formatMmss(0)).toBe('0:00')
    expect(formatMmss(5)).toBe('0:05')
    expect(formatMmss(83)).toBe('1:23')
    expect(formatMmss(600)).toBe('10:00')
  })

  test('rounds to the nearest second BEFORE splitting (no 6:60 carry)', () => {
    expect(formatMmss(119.6)).toBe('2:00') // not "1:60"
    expect(formatMmss(59.5)).toBe('1:00')
  })

  test('clamps negatives to 0:00', () => {
    expect(formatMmss(-3)).toBe('0:00')
  })
})

describe('formatMmssMs', () => {
  test('takes milliseconds', () => {
    expect(formatMmssMs(83_000)).toBe('1:23')
    expect(formatMmssMs(0)).toBe('0:00')
    expect(formatMmssMs(-100)).toBe('0:00')
  })
})
