// cleanPlaceName AS TESTS — the ", California" title suffix Wikipedia appends to disambiguate
// place names is stripped at the view boundary, while names a person would say (parks,
// curated break stops, event titles) pass through untouched. Runs under `bun test`.
import { describe, expect, test } from 'bun:test'
import {
  cleanPlaceName,
  driveDate,
  driveLength,
  driveMinutes,
  spokenDriveDate,
  spokenDriveLength,
} from './labels'

test('strips a trailing ", <state>" disambiguator', () => {
  expect(cleanPlaceName('Tahoe Keys, California')).toBe('Tahoe Keys')
  expect(cleanPlaceName('Rubicon, California')).toBe('Rubicon')
  expect(cleanPlaceName('Meeks Bay, California')).toBe('Meeks Bay')
  expect(cleanPlaceName('Park City, Utah')).toBe('Park City')
})

test('cleans every name in a teaser that strings several together', () => {
  expect(cleanPlaceName('Tahoe Keys, California & Camp Richardson, California')).toBe(
    'Tahoe Keys & Camp Richardson',
  )
})

test('leaves names without a state suffix alone', () => {
  expect(cleanPlaceName('Emerald Bay State Park')).toBe('Emerald Bay State Park')
  expect(cleanPlaceName('D. L. Bliss State Park')).toBe('D. L. Bliss State Park')
  expect(cleanPlaceName('The Grove Beach Bar & Grill')).toBe('The Grove Beach Bar & Grill')
  expect(cleanPlaceName('1960 Winter Olympics')).toBe('1960 Winter Olympics')
})

test('does not strip a state word that is not a comma-suffix', () => {
  // "California" as part of the name proper (no ", " before it) is preserved.
  expect(cleanPlaceName('California State Railroad Museum')).toBe('California State Railroad Museum')
})

describe('driveLength', () => {
  test('rounds to whole minutes and stamps the badge label', () => {
    expect(driveLength(2160)).toBe('36 MIN')
    expect(driveLength(2189)).toBe('36 MIN') // rounds, never floors
    expect(driveLength(30)).toBe('1 MIN')
  })

  // The inconsistency this helper exists to end: the three cards disagreed about an absent
  // duration, so the same drive rendered nothing on one surface and `0 MIN` on another.
  test('renders NOTHING when there is no duration to show', () => {
    expect(driveLength(null)).toBe('')
    expect(driveLength(undefined)).toBe('')
    expect(driveLength(0)).toBe('')
    expect(driveLength(Number.NaN)).toBe('')
  })
})

describe('spokenDriveLength', () => {
  test('speaks the same number the badge shows', () => {
    expect(spokenDriveLength(2160)).toBe('36 minutes')
    expect(driveLength(2160)).toBe('36 MIN')
  })

  test('is singular at one minute, and silent when there is nothing to say', () => {
    expect(spokenDriveLength(60)).toBe('1 minute')
    expect(spokenDriveLength(null)).toBe('')
    expect(spokenDriveLength(0)).toBe('')
  })
})

describe('driveMinutes', () => {
  test('is the one arithmetic both renderings share', () => {
    expect(driveMinutes(2160)).toBe(36)
    expect(driveMinutes(-5)).toBe(0) // never negative, whatever the server said
  })
})

// ── driveDate / spokenDriveDate ──────────────────────────────────────────────
// `now` is INJECTED rather than mocked, which is why these read as plain assertions: the helpers take
// it as a parameter precisely so the day arithmetic is testable without freezing the clock.
//
// ⚠ Every fixture is built in LOCAL time and serialized to ISO, so the suite passes in any timezone —
// and that is the property under test, not an accident of the setup. The boundary a rider feels is
// their OWN midnight; comparing UTC dates would call a 9pm drive "Yesterday" for anyone east of UTC.
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).toISOString()
const now = new Date(2026, 7, 5, 14) // 2026-08-05, 2pm local

describe('driveDate', () => {
  test('names the two days a rider thinks of by name', () => {
    expect(driveDate(at(2026, 7, 5, 9), now)).toBe('Today')
    expect(driveDate(at(2026, 7, 4, 9), now)).toBe('Yesterday')
  })

  test('stamps a date beyond that, and the year only when it is not this one', () => {
    expect(driveDate(at(2026, 7, 3), now)).toBe('Aug 3')
    expect(driveDate(at(2025, 7, 3), now)).toBe('Aug 3 2025')
  })

  test('the day boundary is LOCAL midnight, not the UTC rollover', () => {
    expect(driveDate(at(2026, 7, 5, 23), now)).toBe('Today')
    expect(driveDate(at(2026, 7, 4, 23), now)).toBe('Yesterday')
  })

  test('clock skew never prints a future date', () => {
    // The phone's clock a few hours behind the server's must not stamp tomorrow on a drive just made.
    expect(driveDate(at(2026, 7, 6, 1), now)).toBe('Today')
  })

  test('shows NOTHING rather than a placeholder when there is no usable timestamp', () => {
    // Same rule `driveLength` makes for a missing duration — never "Invalid Date" on a card.
    expect(driveDate(null, now)).toBe('')
    expect(driveDate(undefined, now)).toBe('')
    expect(driveDate('not a date', now)).toBe('')
  })
})

describe('spokenDriveDate', () => {
  test('speaks a month VoiceOver can pronounce, where the card abbreviates it', () => {
    // "Aug" is a glance abbreviation; a screen reader says "awg". The pair rule, asserted.
    expect(spokenDriveDate(at(2026, 7, 3), now)).toBe('August 3')
    expect(driveDate(at(2026, 7, 3), now)).toBe('Aug 3')
  })

  test('carries the year the same way its glance twin does', () => {
    expect(spokenDriveDate(at(2025, 7, 3), now)).toBe('August 3, 2025')
    expect(spokenDriveDate(at(2026, 7, 3), now)).toBe('August 3')
  })

  test('speaks the relative days exactly as shown, and is silent when there is nothing', () => {
    expect(spokenDriveDate(at(2026, 7, 5), now)).toBe('Today')
    expect(spokenDriveDate(at(2026, 7, 4), now)).toBe('Yesterday')
    expect(spokenDriveDate(null, now)).toBe('')
  })
})
