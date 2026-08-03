import { describe, expect, test } from 'bun:test'
import { pickRegionId } from './region-select'

const TAHOE = { id: 'tahoe' }
const YOSEMITE = { id: 'yosemite' }

describe('pickRegionId', () => {
  test('an empty list selects nothing — there is nothing to select', () => {
    expect(pickRegionId([], null)).toBeNull()
    expect(pickRegionId([], 'tahoe')).toBeNull()
  })

  test('a single region is selected whether or not anything was cached', () => {
    expect(pickRegionId([TAHOE], null)).toBe('tahoe')
    expect(pickRegionId([TAHOE], 'tahoe')).toBe('tahoe')
  })

  // ⚠ THE REGRESSION. The rule this replaced selected nothing here, which cost a dead home screen —
  // no chip, no example asks, disabled composer — the moment a second region appeared. Since regions
  // ship from the SERVER, that would have landed on installed apps with no build to fix it.
  test('several regions still select one, rather than none', () => {
    expect(pickRegionId([TAHOE, YOSEMITE], null)).toBe('tahoe')
  })

  test("the rider's cached region wins when it is still on offer", () => {
    expect(pickRegionId([TAHOE, YOSEMITE], 'yosemite')).toBe('yosemite')
  })

  // A cached region can vanish: un-released, or a staged one an admin saw and a rider cannot. Trusting
  // the cache blindly would pin `regionId` to a row absent from `regions`, which resolves to no region
  // on the screen — the same dead state by a different route.
  test('a cached region that is no longer offered falls back rather than pinning a ghost', () => {
    expect(pickRegionId([TAHOE], 'yosemite')).toBe('tahoe')
    expect(pickRegionId([TAHOE, YOSEMITE], 'moab')).toBe('tahoe')
  })

  test('order comes from the server, and first means first', () => {
    expect(pickRegionId([YOSEMITE, TAHOE], null)).toBe('yosemite')
  })

  test('an undefined cache id is treated as no cache, not as a lookup for undefined', () => {
    expect(pickRegionId([TAHOE, YOSEMITE], undefined)).toBe('tahoe')
  })
})
