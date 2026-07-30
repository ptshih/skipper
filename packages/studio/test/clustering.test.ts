import { describe, expect, test } from 'bun:test'
import { leaderGroups, mergeDistricts, metersBetween, titleKey, titlesOverlap } from '../src/pipeline/clustering'

// ~0.001° of latitude ≈ 111 m, which makes a chain easy to lay out exactly.
const at = (id: string, latOffset: number, rank = 1) => ({ id, lat: 38 + latOffset * 0.001, lng: -120, rank })

describe('leaderGroups', () => {
  // The whole reason this isn't transitive-closure clustering. Single-linkage on this input returns ONE
  // group spanning ~666 m; leader grouping must bound each group to 2R around its own anchor.
  test('does NOT chain — a line of items each within R of the next stays bounded', () => {
    // 7 items 111 m apart (total span ~666 m), R = 150 m. Transitive closure would swallow all 7.
    const items = Array.from({ length: 7 }, (_, i) => at(`p${i}`, i, 7 - i))
    const groups = leaderGroups(items, 150)
    expect(groups.length).toBeGreaterThan(1)
    for (const g of groups) {
      let diameter = 0
      for (const a of g) for (const b of g) diameter = Math.max(diameter, metersBetween(a.lat, a.lng, b.lat, b.lng))
      expect(diameter).toBeLessThanOrEqual(2 * 150)
    }
  })

  test('every item lands in exactly one group, anchor first + highest rank', () => {
    const items = [at('a', 0, 1), at('b', 0.5, 9), at('c', 40, 5)]
    const groups = leaderGroups(items, 300)
    expect(groups.flat().map((i) => i.id).sort()).toEqual(['a', 'b', 'c'])
    const withB = groups.find((g) => g.some((i) => i.id === 'b'))!
    expect(withB[0]!.id).toBe('b') // rank 9 beats rank 1 → b anchors, a is absorbed
    expect(withB.map((i) => i.id).sort()).toEqual(['a', 'b'])
  })

  // Determinism is load-bearing: the classifier's verdicts are PERSISTED against these groups, so a
  // re-run that reshuffles membership would invalidate stored treatments.
  test('is deterministic when ranks TIE (id breaks the tie)', () => {
    const items = [at('z', 0, 5), at('y', 0.5, 5), at('x', 1, 5)]
    const a = leaderGroups(items, 200).map((g) => g.map((i) => i.id))
    const b = leaderGroups([...items].reverse(), 200).map((g) => g.map((i) => i.id))
    expect(a).toEqual(b)
  })
})

describe('titleKey', () => {
  test('folds case, punctuation and whitespace', () => {
    expect(titleKey('Downtown Reno')).toBe(titleKey('downtown  reno!'))
    expect(titleKey('Reno')).not.toBe(titleKey('Newlands'))
  })
})

describe('titlesOverlap', () => {
  // The real case: the classifier elaborated the title on one pass and not the other, so exact
  // equality left downtown Reno split into a 33-member and a 10-member district.
  test('matches by whole-word containment, not equality', () => {
    expect(titlesOverlap(titleKey('Downtown Reno and the Arch'), titleKey('Downtown Reno'))).toBe(true)
    expect(titlesOverlap(titleKey('Downtown Reno'), titleKey('Newlands Historic Neighborhood'))).toBe(false)
  })
  test('does not match on a partial WORD', () => {
    expect(titlesOverlap('reno', 'renoir')).toBe(false)
  })
})

describe('mergeDistricts', () => {
  const D = { districtTreatment: 'district', maxAnchorGapM: 3000 }

  // The dry run returned "downtown Reno" as two separate groups (33 members and 10) because leader
  // grouping anchors more than once inside a big district. Unmerged, phase 4 writes two competing
  // tellings about the same downtown.
  test('fuses two same-titled district groups whose anchors are close', () => {
    const merged = mergeDistricts(
      [
        { treatment: 'district', title: 'downtown Reno', members: [at('a', 0, 5), at('b', 1, 1)] },
        { treatment: 'district', title: 'Downtown Reno and the Arch', members: [at('c', 2, 9), at('d', 3, 2)] },
      ],
      D,
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]!.members.map((m) => m.id).sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(merged[0]!.members[0]!.id).toBe('c') // rank 9 across BOTH groups re-seats the anchor
  })

  test('does NOT fuse same-titled districts that are far apart', () => {
    const merged = mergeDistricts(
      [
        { treatment: 'district', title: 'Main Street', members: [at('a', 0, 1)] },
        { treatment: 'district', title: 'Main Street', members: [at('b', 200, 1)] }, // ~22 km away
      ],
      D,
    )
    expect(merged).toHaveLength(2)
  })

  test('leaves CLUSTER and SOLO groups untouched, in order', () => {
    const merged = mergeDistricts(
      [
        { treatment: 'cluster', title: 'Emerald Bay', members: [at('a', 0, 1)] },
        { treatment: 'cluster', title: 'Emerald Bay', members: [at('b', 1, 1)] },
        { treatment: 'solo', title: 'whatever', members: [at('c', 2, 1)] },
      ],
      D,
    )
    expect(merged.map((g) => g.members[0]!.id)).toEqual(['a', 'b', 'c'])
  })
})
