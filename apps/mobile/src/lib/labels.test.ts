// cleanPlaceName AS TESTS — the ", California" title suffix Wikipedia appends to disambiguate
// place names is stripped at the view boundary, while names a person would say (parks,
// curated break stops, event titles) pass through untouched. Runs under `bun test`.
import { expect, test } from 'bun:test'
import { cleanPlaceName } from './labels'

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
