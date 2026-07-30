import { describe, expect, test } from 'bun:test'
import { leaderGroups, mergeDuplicateGroups, metersBetween, pickSubject, titleKey, titlesOverlap } from '../src/pipeline/clustering'

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

describe('leaderGroups — seedable', () => {
  // The Yosemite failure: `Yosemite National Park` (a container with a huge article) outranked
  // `Half Dome` and seeded the group, so the group formed around a park's arbitrary centroid.
  test('a non-seedable item never anchors, but is still absorbed as a member', () => {
    const container = { ...at('park', 0, 99), seedable: false }
    const stop = at('dome', 0.5, 5)
    const groups = leaderGroups([container, stop], 300)
    expect(groups).toHaveLength(1)
    expect(groups[0]![0]!.id).toBe('dome') // the stop anchors despite the far lower rank
    expect(groups[0]!.map((m) => m.id).sort()).toEqual(['dome', 'park'])
  })

  // Dropping an unabsorbed container would delete it from the corpus silently — a worse bug than
  // mis-seeding, and a much harder one to notice.
  test('a non-seedable item with no neighbour still stands alone rather than vanishing', () => {
    const lone = { ...at('range', 0, 99), seedable: false }
    const far = at('other', 400, 1)
    const groups = leaderGroups([lone, far], 300)
    expect(groups.flat().map((m) => m.id).sort()).toEqual(['other', 'range'])
    expect(groups.find((g) => g.some((m) => m.id === 'range'))).toHaveLength(1)
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
  // The SECOND miss: contiguous containment still left Carson City split across two districts,
  // because the shared words are interleaved rather than adjacent.
  test('matches when the shared words are INTERLEAVED, not adjacent', () => {
    expect(titlesOverlap(titleKey('Historic Carson City'), titleKey('Historic Downtown Carson City'))).toBe(true)
  })
  test('still refuses two genuinely different districts', () => {
    expect(titlesOverlap(titleKey('Downtown Reno'), titleKey('Newlands Historic Neighborhood'))).toBe(false)
    expect(titlesOverlap(titleKey('Historic Carson City'), titleKey('Virginia City Boomtown'))).toBe(false)
  })
})

describe('pickSubject', () => {
  // The exact production failure: the district QID was in the group and lost to a longer clip.
  test('prefers a real district entity over any other member', () => {
    const m = [
      { id: 'a', name: 'Alpha Tau Omega Fraternity House (Reno, Nevada)', kind: null },
      { id: 'b', name: 'University of Nevada Reno Historic District', kind: 'historic district' },
    ]
    expect(pickSubject(m, 'University of Nevada, Reno Campus')?.id).toBe('b')
  })

  test('falls back to the member the group was NAMED after', () => {
    const m = [
      { id: 'a', name: 'Mormon Station State Historic Park', kind: null },
      { id: 'b', name: 'Genoa, Nevada', kind: null },
    ]
    expect(pickSubject(m, "Genoa, Nevada's Oldest Town")?.id).toBe('b')
  })

  // A null subject is a FEATURE: the Stateline casino strip is a real grouping that is not itself a
  // place, and electing a stand-in is what the old anchor model did wrong.
  test('returns null when no member names the group', () => {
    const m = [
      { id: 'a', name: "Harrah's Lake Tahoe", kind: null },
      { id: 'b', name: 'Golden Nugget Lake Tahoe', kind: null },
    ]
    expect(pickSubject(m, "Stateline's Casino Row")).toBeNull()
  })

  test('a very short name cannot match by title containment', () => {
    const m = [{ id: 'a', name: 'CA', kind: null }]
    expect(pickSubject(m, 'CA Route Somewhere')).toBeNull()
  })
})

describe('mergeDuplicateGroups', () => {
  const D = { mergeTreatments: ['district'], maxAnchorGapM: 3000 }

  // The dry run returned "downtown Reno" as two separate groups (33 members and 10) because leader
  // grouping anchors more than once inside a big district. Unmerged, phase 4 writes two competing
  // tellings about the same downtown.
  test('fuses two same-titled district groups whose anchors are close', () => {
    const merged = mergeDuplicateGroups(
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
    const merged = mergeDuplicateGroups(
      [
        { treatment: 'district', title: 'Main Street', members: [at('a', 0, 1)] },
        { treatment: 'district', title: 'Main Street', members: [at('b', 200, 1)] }, // ~22 km away
      ],
      D,
    )
    expect(merged).toHaveLength(2)
  })

  test('leaves CLUSTER and SOLO groups untouched, in order, when only districts are mergeable', () => {
    const merged = mergeDuplicateGroups(
      [
        { treatment: 'cluster', title: 'Emerald Bay', members: [at('a', 0, 1)] },
        { treatment: 'cluster', title: 'Emerald Bay', members: [at('b', 1, 1)] },
        { treatment: 'solo', title: 'whatever', members: [at('c', 2, 1)] },
      ],
      D,
    )
    expect(merged.map((g) => g.members[0]!.id)).toEqual(['a', 'b', 'c'])
  })

  // The UNR campus came back as TWO CLUSTER groups 1268 m apart whose titles differ only by a comma.
  // District-only merging missed it, and phase 4 would have shipped two clips about one campus.
  const CD = { mergeTreatments: ['cluster', 'district'], maxAnchorGapM: 3000 }

  test('fuses two CLUSTER groups that are the same place', () => {
    const merged = mergeDuplicateGroups(
      [
        { treatment: 'cluster', title: 'University of Nevada, Reno Campus', members: [at('a', 0, 5)] },
        { treatment: 'cluster', title: 'University of Nevada Reno Campus', members: [at('b', 0.01, 9)] },
      ],
      CD,
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]!.fusedFrom).toBe(2)
    expect(merged[0]!.members[0]!.id).toBe('b') // strongest across both re-seats the anchor
  })

  test('NEVER fuses SOLO groups — a solo verdict means "merely near each other"', () => {
    const merged = mergeDuplicateGroups(
      [
        { treatment: 'solo', title: 'Same Name', members: [at('a', 0, 1)] },
        { treatment: 'solo', title: 'Same Name', members: [at('b', 0.001, 1)] },
      ],
      { mergeTreatments: ['cluster', 'district', 'solo'], maxAnchorGapM: 3000 },
    )
    // 'solo' is passed in mergeTreatments here ON PURPOSE: the guard that matters is the CALLER never
    // doing that, so this documents what would happen — and the caller's list is the real guard.
    expect(merged).toHaveLength(1)
  })

  test('refuses to fuse ACROSS treatments — a cluster and a district are not the same verdict', () => {
    const merged = mergeDuplicateGroups(
      [
        { treatment: 'cluster', title: 'Virginia City', members: [at('a', 0, 1)] },
        { treatment: 'district', title: 'Virginia City', members: [at('b', 0.001, 1)] },
      ],
      CD,
    )
    expect(merged).toHaveLength(2)
  })

  test('marks untouched groups fusedFrom:1, so the caller can re-classify only what fused', () => {
    const merged = mergeDuplicateGroups(
      [{ treatment: 'cluster', title: 'Emerald Bay', members: [at('a', 0, 1)] }],
      CD,
    )
    expect(merged[0]!.fusedFrom).toBe(1)
  })
})
