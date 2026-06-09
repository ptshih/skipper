import { expect, test } from 'bun:test'
import { deriveRegions, filterByRegion } from './regions'

const T = (slug: string, name: string) => ({ regionSlug: slug, regionName: name })

test('deriveRegions: distinct regions with counts, sorted by name', () => {
  const out = deriveRegions([
    T('yosemite', 'Yosemite'),
    T('lake-tahoe', 'Lake Tahoe'),
    T('lake-tahoe', 'Lake Tahoe'),
    T('moab', 'Moab'),
  ])
  expect(out).toEqual([
    { slug: 'lake-tahoe', name: 'Lake Tahoe', count: 2 },
    { slug: 'moab', name: 'Moab', count: 1 },
    { slug: 'yosemite', name: 'Yosemite', count: 1 },
  ])
})

test('filterByRegion: null returns all; a slug returns only its matches', () => {
  const all = [T('lake-tahoe', 'Lake Tahoe'), T('yosemite', 'Yosemite'), T('lake-tahoe', 'Lake Tahoe')]
  expect(filterByRegion(all, null)).toHaveLength(3)
  expect(filterByRegion(all, 'lake-tahoe').map((t) => t.regionSlug)).toEqual([
    'lake-tahoe',
    'lake-tahoe',
  ])
  expect(filterByRegion(all, 'moab')).toHaveLength(0)
})
