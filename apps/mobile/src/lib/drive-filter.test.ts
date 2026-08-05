// MY DRIVES' region filter. The rule worth the whole file is `initialRegionFilter`: it is what stops
// the screen ever OPENING empty while the rider owns drives — the "a chip tap ate my library" reading
// that a 1:1 region filter invites. See `docs/designs/my-drives-legibility.md` §4.2.
import { describe, expect, test } from 'bun:test'
import type { DriveSummary } from './api'
import {
  filterDrivesByRegion,
  initialRegionFilter,
  regionFacets,
  shouldOfferRegionFilter,
} from './drive-filter'

const drive = (driveId: string, region: { id: string; displayName: string } | null): DriveSummary => ({
  driveId,
  label: `Drive ${driveId}`,
  startName: null,
  endName: null,
  distanceMeters: null,
  durationSeconds: null,
  clipCount: 3,
  createdAt: '2026-08-05T00:00:00.000Z',
  region: region ? { ...region, slug: region.displayName.toLowerCase() } : null,
})

const TAHOE = { id: 'tahoe-id', displayName: 'Lake Tahoe' }
const YOSEMITE = { id: 'yosemite-id', displayName: 'Yosemite' }

describe('regionFacets', () => {
  test('counts the regions present, in first-appearance order', () => {
    const facets = regionFacets([drive('a', TAHOE), drive('b', YOSEMITE), drive('c', TAHOE)])
    expect(facets.map((f) => f.id)).toEqual(['tahoe-id', 'yosemite-id'])
    expect(facets.map((f) => f.count)).toEqual([2, 1])
  })

  test('an unlabelled drive produces NO facet — it is reachable through All, not a dead category', () => {
    expect(regionFacets([drive('a', null)])).toEqual([])
    expect(regionFacets([drive('a', TAHOE), drive('b', null)]).map((f) => f.id)).toEqual(['tahoe-id'])
  })
})

describe('shouldOfferRegionFilter', () => {
  test('stays hidden until a second region is actually present', () => {
    // The whole "blocked on Yosemite to MATTER" gate, expressed as the control's own condition.
    expect(shouldOfferRegionFilter([])).toBe(false)
    expect(shouldOfferRegionFilter(regionFacets([drive('a', TAHOE), drive('b', TAHOE)]))).toBe(false)
  })

  test('appears once two regions are represented', () => {
    expect(shouldOfferRegionFilter(regionFacets([drive('a', TAHOE), drive('b', YOSEMITE)]))).toBe(true)
  })
})

describe('initialRegionFilter', () => {
  test('honours the cached region when the rider has drives there', () => {
    const facets = regionFacets([drive('a', TAHOE), drive('b', YOSEMITE)])
    expect(initialRegionFilter(facets, 'yosemite-id')).toBe('yosemite-id')
  })

  test('⚠ falls back to All when the cached region has NO drives — never opens empty', () => {
    // The rider's chip says Yosemite; every drive they own is Tahoe. Honouring the chip here would
    // show an empty library to someone who owns two drives.
    const facets = regionFacets([drive('a', TAHOE), drive('b', TAHOE)])
    expect(initialRegionFilter(facets, 'yosemite-id')).toBeNull()
  })

  test('falls back to All with no cached region at all', () => {
    expect(initialRegionFilter(regionFacets([drive('a', TAHOE)]), null)).toBeNull()
  })

  test('the opening view is never empty while drives exist', () => {
    // The property the two rules above exist to produce, asserted directly against both chip states.
    const drives = [drive('a', TAHOE), drive('b', YOSEMITE), drive('c', null)]
    const facets = regionFacets(drives)
    for (const chip of [null, 'tahoe-id', 'yosemite-id', 'moab-id']) {
      const initial = initialRegionFilter(facets, chip)
      expect(filterDrivesByRegion(drives, initial).length).toBeGreaterThan(0)
    }
  })
})

describe('filterDrivesByRegion', () => {
  test('null shows everything, including unlabelled drives', () => {
    const drives = [drive('a', TAHOE), drive('b', null)]
    expect(filterDrivesByRegion(drives, null).map((d) => d.driveId)).toEqual(['a', 'b'])
  })

  test('a region shows only its own, and never an unlabelled drive', () => {
    const drives = [drive('a', TAHOE), drive('b', YOSEMITE), drive('c', null)]
    expect(filterDrivesByRegion(drives, 'tahoe-id').map((d) => d.driveId)).toEqual(['a'])
  })

  test('preserves the server ordering — it only ever removes rows', () => {
    const drives = [drive('a', TAHOE), drive('b', YOSEMITE), drive('c', TAHOE)]
    expect(filterDrivesByRegion(drives, 'tahoe-id').map((d) => d.driveId)).toEqual(['a', 'c'])
  })
})
