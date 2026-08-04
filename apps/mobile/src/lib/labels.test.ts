// cleanPlaceName AS TESTS — the ", California" title suffix Wikipedia appends to disambiguate
// place names is stripped at the view boundary, while names a person would say (parks,
// curated break stops, event titles) pass through untouched. Runs under `bun test`.
import { describe, expect, test } from 'bun:test'
import { cleanPlaceName, driveLength, driveMinutes, spokenDriveLength } from './labels'

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
