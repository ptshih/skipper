// `pipeline/cluster.ts` is the ONE resolver for "which places does this fused telling speak for", and
// it had no tests. What it does is a COMPOSITION, and that is what these hold: four consumers — the
// grounding well, the attribution union, `narrations.facts_hash`, and the trigger — must all derive
// from the same array, so the hash has to be taken over exactly what `tellableMembers` returns. If the
// two ever differ by one place, the fused clip is either permanently stale (re-narrated and
// re-synthesized every run, for real money, producing byte-identical audio) or permanently fresh while
// grounded on something else, and neither shows up anywhere.
//
// The DIGEST's own properties — member-order invariance, null-vs-sha256(''), highlight order as
// significant — are pinned at their source in packages/db/test/hash.test.ts and are deliberately not
// re-run here. What is untested until this file is the WRAPPER: which members it hands the digest, and
// which cluster fields it threads through.
//
// `loadClusterMembers` is the only DB-touching export and is not called here.

import { describe, expect, test } from 'bun:test'
import {
  clusterGenerationBlock,
  clusterGroundingHash,
  tellableMembers,
  type ClusterGroupingRow,
  type ClusterMemberRow,
} from '../src/pipeline/cluster'
import type { FactSheetEntry } from '@skipper/db/schema'

const HEX64 = /^[0-9a-f]{64}$/
const h = (n: number) => String(n).repeat(64).slice(0, 64) // a stand-in facts_hash, right shape

const sheet = (text: string): FactSheetEntry[] => [
  { text, source: 'wikipedia', sourceId: '4242', license: 'CC BY-SA 4.0' },
]

/** A member in the state that reaches a telling: wikipedia-sourced, in the corpus, enriched. */
const member = (over: Partial<ClusterMemberRow> = {}): ClusterMemberRow => ({
  id: 'p1',
  clusterId: 'c1',
  name: 'Vikingsholm',
  kind: 'castle',
  source: 'wikipedia',
  sourceId: '4242',
  qid: 'Q1972742',
  excludedReason: null,
  lat: 38.9469,
  lng: -120.1108,
  speakableLat: null,
  speakableLng: null,
  speakableRoadClass: null,
  deliveryRegister: null,
  facts: {
    extract: 'Vikingsholm is a mansion on the shore of Emerald Bay.',
    title: 'Vikingsholm',
    url: 'https://en.wikipedia.org/wiki/Vikingsholm',
    pageId: 1,
  },
  factSheet: sheet('Built in nineteen twenty-nine from local granite.'),
  enrichedAt: null,
  factsFetchedAt: new Date('2026-07-01T00:00:00Z'),
  factsHash: h(1),
  // Un-enriched by default in this fixture's SHAPE sense: grounding therefore falls through to
  // factsHash, so the existing member-set assertions below keep asserting exactly what they did.
  sheetHash: null,
  ...over,
})

describe('tellableMembers', () => {
  test('raw `pois.cluster_id` membership is not the set — each gate drops a member for its own reason', () => {
    const roster = [
      member({ id: 'keep' }),
      // Stricter than the solo queue on purpose. For a solo clip an excluded poi is merely unreachable
      // (the read paths hide it); inside a FUSED telling it gets NAMED ALOUD in a clip about the places
      // around it, and no read-path filter can unsay that.
      member({ id: 'excluded', name: 'Eagle Falls', excludedReason: 'operator: off-corridor' }),
      // Enriched-but-emptied and never-enriched are the same answer: a story telling grounds on the
      // curated sheet, so without one there is nothing to write from.
      member({ id: 'sheet-emptied', name: 'Eagle Lake', factSheet: [] }),
      member({ id: 'never-enriched', name: 'Fannette Island', factSheet: null }),
      // A wikidata scenic pin has no article to quote and never had one.
      member({ id: 'scenic-pin', name: 'Inspiration Point', source: 'wikidata', facts: null, factSheet: null }),
      // Taste applies to ANY telling — a fused clip is not a loophole around the denylist.
      member({ id: 'taste-denied', name: 'Murder of a Tahoe local' }),
    ]
    expect(tellableMembers(roster).map((m) => m.id)).toEqual(['keep'])
  })
})

describe('clusterGenerationBlock', () => {
  test('a cluster with tellable members is generatable — no block', () => {
    expect(clusterGenerationBlock([member(), member({ id: 'p2', name: 'Eagle Falls' })])).toBeNull()
  })

  test('nothing tellable is REPORTED, not silently skipped', () => {
    // Half the grouped corpus is un-enriched. A cluster vanishing from a preview with no reason given
    // is how the un-enriched Yosemite half stayed invisible for a week.
    expect(clusterGenerationBlock([member({ factSheet: [] })])).toMatch(/no tellable members/)
    expect(clusterGenerationBlock([])).toMatch(/no tellable members/)
  })

})

// ── GEOMETRY: the generation gate and the serving refusal ask ONE question ───────────────────────
// Founder call 2026-08-03. Geometry stopped blocking on 2026-07-30 because a too-wide group would ship
// as an AREA telling instead; D42 (docs/designs/drives-first-1-1.md) then deleted area mode with roam,
// invalidating that rationale, and D42a kept a REFUSAL at serving — `buildDrive` skips a
// `tooWideForPoint` candidate. For three days the gate and the refusal disagreed: a PAID `--apply`
// would narrate, gate, synthesize and PERSIST clips no drive could select, and since a fused clip
// publishes with the region release and `releasedAt` is never cleared, they would be permanently
// released and permanently unplayable. These hold the two answers together.
describe('clusterGenerationBlock — too spread out for a point', () => {
  test('a group far too wide for a point trigger is BLOCKED, with the radius in the reason', () => {
    // ~48 km apart — nothing subtle, this is the direction of the gate rather than its threshold.
    const wide = [
      member({ id: 'p1', lat: 39.5296, lng: -119.8138 }),
      member({ id: 'p2', name: 'Eagle Falls', lat: 39.0968, lng: -120.0324 }),
    ]
    // The operator has to be able to act on this, and "too wide" alone doesn't say by how much.
    expect(clusterGenerationBlock(wide)).toMatch(/too spread out for a point trigger \(\d+ m/)
  })

  test('a real-corpus-width group still generates — this refuses outliers, not clusters', () => {
    // Emerald Bay's 1-center sits 516 m from its worst member and it SHIPPED; 22 of the 32 generatable
    // clusters land on the anchored floor. A gate that caught normal groups would silently empty the
    // fused queue, which is the failure mode worth a test of its own — the pair below spans ~575 m.
    const normal = [
      member({ id: 'p1', lat: 38.9469, lng: -120.1108 }),
      member({ id: 'p2', name: 'Eagle Falls', lat: 38.9512, lng: -120.1145 }),
    ]
    expect(clusterGenerationBlock(normal)).toBeNull()
  })

  test('measures the ROAD-SNAPPED anchors — the same `speakableLat ?? lat` rule serving measures on', () => {
    // Both raw pins are identical here, so a gate reading `lat/lng` would see a zero-width group and
    // pass. Serving computes its trigger from the speakable anchors (apps/api/src/clusters.ts), so if
    // the two point rules ever differed the gate would admit a group the drive path then refuses —
    // exactly the split this whole block exists to close. The anchors below are ~1.4 km apart.
    const snappedApart = [
      member({ id: 'p1', speakableLat: 38.9469, speakableLng: -120.1108 }),
      member({ id: 'p2', name: 'Eagle Falls', speakableLat: 38.96, speakableLng: -120.1108 }),
    ]
    expect(clusterGenerationBlock(snappedApart)).toMatch(/too spread out/)
  })

  test('nothing TELLABLE outranks the geometry reason — an un-enriched member has no position', () => {
    // Ordering matters for the operator: `enrich` fixes one, re-running the treatment classifier fixes
    // the other. It also guards the null trigger — a group whose tellable set is empty has no radius to
    // measure, and must never reach `exceedsPointTrigger` looking for one.
    const wideButUnenriched = [
      member({ id: 'p1', lat: 39.5296, lng: -119.8138, factSheet: [] }),
      member({ id: 'p2', name: 'Eagle Falls', lat: 39.0968, lng: -120.0324, factSheet: null }),
    ]
    expect(clusterGenerationBlock(wideButUnenriched)).toMatch(/no tellable members/)
  })
})

describe('clusterGroundingHash', () => {
  const group: ClusterGroupingRow = {
    title: 'Emerald Bay',
    highlights: ['Vikingsholm', 'Eagle Falls'],
    dropped: ['Eagle Lake'],
  }
  const hashOf = (members: ClusterMemberRow[], over: Partial<ClusterGroupingRow> = {}) =>
    clusterGroundingHash({ ...group, ...over }, members)

  const A = member({ id: 'p1', name: 'Vikingsholm', factsHash: h(1) })
  const B = member({ id: 'p2', name: 'Eagle Falls', factsHash: h(2) })

  test('is taken over the TELLABLE set, not raw membership', () => {
    const both = hashOf([A, B])
    expect(both).toMatch(HEX64)
    // An un-enriched member is in `pois.cluster_id` but not in the well, so it must not be in the
    // fingerprint — otherwise every `discover` sweep that touches it re-stales a clip written without it.
    expect(hashOf([A, B, member({ id: 'p3', name: 'Eagle Lake', factSheet: [] })])).toBe(both!)
    // …and ENRICHING it later does move the digest: it enters the well, so the telling is rewritten.
    expect(hashOf([A, B, member({ id: 'p3', name: 'Eagle Lake' })])).not.toBe(both!)
  })

  test('excluding a member lands exactly where "it was never a member" lands', () => {
    // The admin exclusion toggle moves no article and no facts, yet it removes a place from the
    // telling. Both assertions are needed: the first says the toggle is DETECTED, the second says the
    // hash is a function of the tellable set alone rather than of membership-minus-a-flag.
    const both = hashOf([A, B])
    const excluded = hashOf([A, { ...B, excludedReason: 'operator: off-corridor' }])
    expect(excluded).not.toBe(both!)
    expect(excluded).toBe(hashOf([A])!)
  })

  test('NULL — never a digest — when nothing is tellable, even with rows in the cluster', () => {
    // Null means "cannot generate yet", so the caller must consult the BLOCK before freshness: a null
    // compares unequal to any stored hash, which reads as permanently stale, which re-queues the
    // cluster for paid narration on every run forever.
    expect(hashOf([member({ factSheet: [] }), member({ id: 'p2', excludedReason: 'x' })])).toBeNull()
    expect(hashOf([])).toBeNull()
  })

  test('a member with no facts_hash of its own is still tellable, and still moves the digest', () => {
    // `isNarratableStoryPoi` never looks at `facts_hash`, so an enriched-but-unhashed member reaches
    // the well. It must not then be invisible to staleness: {h1} and {h1, null} are different tellings.
    expect(hashOf([A, member({ id: 'p9', name: 'Fannette Island', factsHash: null })])).not.toBe(
      hashOf([A])!,
    )
  })

  test('moves when a member\'s facts move — the whole reason a fused clip has a fingerprint', () => {
    expect(hashOf([A, { ...B, factsHash: h(7) }])).not.toBe(hashOf([A, B])!)
  })

  test('threads the whole cluster row through — title, highlights and dropped each move it alone', () => {
    // The wrapper's only other job. The digest's treatment of these three is pinned in
    // packages/db/test/hash.test.ts — but a wrapper that quietly stopped passing `dropped` would leave
    // every one of those tests green while a member muted out of the telling read as fresh.
    const base = hashOf([A, B])
    expect(hashOf([A, B], { title: 'Emerald Bay and Vikingsholm' })).not.toBe(base!)
    expect(hashOf([A, B], { highlights: ['Eagle Falls', 'Vikingsholm'] })).not.toBe(base!)
    expect(hashOf([A, B], { dropped: [] })).not.toBe(base!)
  })

  test('a member\'s non-grounding columns are OUT — re-classifying registers must not re-stale every clip', () => {
    // The documented, ACCEPTED gap (hash.ts): the delivery register — and so the length band — is
    // outside a solo poi's `facts_hash` too, so covering it only for clusters would put the two subject
    // kinds on different staleness contracts. One gap, one future fix. This asserts the gap is a
    // decision rather than something to be rediscovered as a bug.
    const base = hashOf([A, B])
    expect(
      hashOf([A, { ...B, deliveryRegister: 'town', speakableLat: 39.0, speakableLng: -120.0, kind: 'waterfall' }]),
    ).toBe(base!)
  })
})

// ── The all-dropped degenerate cluster ───────────────────────────────────────────────────────────
// The treatment classifier's `dropped` list demotes a member from NAMEABLE to background. When it
// covers every tellable member, the fused sheet carries a BACKGROUND ONLY block and nothing else —
// which tells the model to name nothing, invent nothing, and treat the stop as scenic. That sheet was
// reachable on a PAID story generation, which then narrated, gated and synthesized whatever came back
// and shipped it as a story. Degenerate, reachable, and completely silent. It is a block now.
describe('clusterGenerationBlock — nothing left to NAME', () => {
  const two = [member(), member({ id: 'p2', name: 'Eagle Falls' })]

  test('every tellable member dropped ⇒ BLOCKED, with a reason naming the cause', () => {
    expect(clusterGenerationBlock(two, ['Vikingsholm', 'Eagle Falls'])).toMatch(/nothing to name/)
  })

  test('one survivor is enough — a single nameable place is a legitimate telling', () => {
    expect(clusterGenerationBlock(two, ['Eagle Falls'])).toBeNull()
  })

  test('no dropped list at all is the common case and never blocks', () => {
    expect(clusterGenerationBlock(two)).toBeNull()
    expect(clusterGenerationBlock(two, [])).toBeNull()
  })

  test('the dropped match is FUZZY, so punctuation and case cannot smuggle a place back in', () => {
    // `dropped` is the model's free text; it matches `pois.name` 68 of 69 times live, and the fold is
    // what makes that work. If this stopped folding, the block would quietly stop firing.
    expect(clusterGenerationBlock(two, ['vikingsholm!', '  EAGLE   FALLS  '])).toMatch(/nothing to name/)
  })

  test('an UNMATCHED dropped entry fails SAFE — the member stays nameable, so no block', () => {
    // A miss must never mute a place the telling exists for; it stays nameable, which is also why an
    // unmatched entry cannot manufacture a block.
    expect(clusterGenerationBlock(two, ['Some Place That Is Not A Member'])).toBeNull()
  })

  test('nothing TELLABLE still reports the tellable reason, not this one', () => {
    // Ordering matters for the operator: "un-enriched" and "all dropped" need different actions.
    expect(clusterGenerationBlock([member({ factSheet: [] })], ['Vikingsholm'])).toMatch(/no tellable members/)
  })
})

// ── The member NAME is part of the fingerprint ───────────────────────────────────────────────────
describe('clusterGroundingHash — renaming a member', () => {
  const group: ClusterGroupingRow = {
    title: 'Emerald Bay',
    highlights: ['Vikingsholm', 'Eagle Falls'],
    dropped: [],
  }

  test('moves the digest — the name is SPOKEN, so the script changes with it', () => {
    // `pois.name` becomes the "• Name:" bullet the fused telling is told to work in. Until 2026-08-02
    // the digest carried only poiId + factsHash, so a rename rewrote the prompt while the clip read
    // FRESH and was never regenerated.
    const before = clusterGroundingHash(group, [member({ factsHash: h(1) })])
    const after = clusterGroundingHash(group, [member({ name: 'Vikingsholm Castle', factsHash: h(1) })])
    expect(before).toMatch(HEX64)
    expect(before).not.toBe(after!)
  })

  test('renaming an UN-TELLABLE member does not move it — the digest is over the tellable set', () => {
    const base = [member({ factsHash: h(1) }), member({ id: 'p2', name: 'Eagle Falls', factSheet: [] })]
    const renamed = [member({ factsHash: h(1) }), member({ id: 'p2', name: 'Eagle Lake', factSheet: [] })]
    expect(clusterGroundingHash(group, base)).toBe(clusterGroundingHash(group, renamed)!)
  })
})
