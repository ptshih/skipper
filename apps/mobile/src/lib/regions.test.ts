import { expect, test } from 'bun:test'
import { deriveRegions, filterByRegion, showRegionFilter } from './regions'

const C = (region: string) => ({ region, id: region })

test('deriveRegions: distinct regions with counts, sorted by name', () => {
  const out = deriveRegions([C('Yosemite'), C('Lake Tahoe'), C('Lake Tahoe'), C('Moab')])
  expect(out).toEqual([
    { region: 'Lake Tahoe', count: 2 },
    { region: 'Moab', count: 1 },
    { region: 'Yosemite', count: 1 },
  ])
})

test('showRegionFilter: hidden for a single-region (Tahoe-only) catalog, shown at >=2', () => {
  expect(showRegionFilter(deriveRegions([C('Lake Tahoe'), C('Lake Tahoe')]))).toBe(false)
  expect(showRegionFilter(deriveRegions([C('Lake Tahoe'), C('Yosemite')]))).toBe(true)
  expect(showRegionFilter([])).toBe(false)
})

test('filterByRegion: null returns all; a region returns only its matches', () => {
  const all = [C('Lake Tahoe'), C('Yosemite'), C('Lake Tahoe')]
  expect(filterByRegion(all, null)).toHaveLength(3)
  expect(filterByRegion(all, 'Lake Tahoe').map((c) => c.region)).toEqual(['Lake Tahoe', 'Lake Tahoe'])
  expect(filterByRegion(all, 'Moab')).toHaveLength(0)
})
