// Grounding-fingerprint guards. `clusterFactsHash` is the only staleness detector a FUSED telling
// gets, and both of its failure modes cost real money on a schedule: a hash that misses a change makes
// the clip immortal (drifting from its sources forever), and a hash that moves without a change makes
// it re-narrate + re-synthesize on every run. These assert the properties that distinguish the two.
// Pure functions over strings — offline, no DB.
import { describe, expect, it } from 'bun:test'
import { clusterFactsHash, hashFacts, storyFactsHash, stableStringify } from '../src/hash'
import { selectionSubject } from '../src/schema'

const HEX64 = /^[0-9a-f]{64}$/
const h = (n: number) => String(n).repeat(64).slice(0, 64) // a stand-in facts_hash, right shape
const group = { title: 'Emerald Bay and Vikingsholm', highlights: ['Vikingsholm', 'Eagle Falls'], dropped: ['Eagle Lake'] }

describe('clusterFactsHash', () => {
  it('is invariant to member ORDER — the member set is a set', () => {
    const a = clusterFactsHash({ ...group, members: [{ poiId: 'p1', factsHash: h(1) }, { poiId: 'p2', factsHash: h(2) }] })
    const b = clusterFactsHash({ ...group, members: [{ poiId: 'p2', factsHash: h(2) }, { poiId: 'p1', factsHash: h(1) }] })
    expect(a).toMatch(HEX64)
    expect(a).toBe(b!)
  })

  it('moves when a member\'s facts move', () => {
    const before = clusterFactsHash({ ...group, members: [{ poiId: 'p1', factsHash: h(1) }] })
    const after = clusterFactsHash({ ...group, members: [{ poiId: 'p1', factsHash: h(9) }] })
    expect(after).not.toBe(before!)
  })

  it('moves when MEMBERSHIP changes even though every surviving hash is identical', () => {
    const before = clusterFactsHash({ ...group, members: [{ poiId: 'p1', factsHash: h(1) }, { poiId: 'p2', factsHash: h(2) }] })
    const after = clusterFactsHash({ ...group, members: [{ poiId: 'p1', factsHash: h(1) }] })
    expect(after).not.toBe(before!)
  })

  it('keys on WHICH place, not just the multiset of hashes — two places can share a hash', () => {
    const a = clusterFactsHash({ ...group, members: [{ poiId: 'p1', factsHash: h(1) }] })
    const b = clusterFactsHash({ ...group, members: [{ poiId: 'p2', factsHash: h(1) }] })
    expect(a).not.toBe(b!)
  })

  it('does not DROP a null-hash member — the bug a .filter(Boolean) would hide', () => {
    const one = clusterFactsHash({ ...group, members: [{ poiId: 'p1', factsHash: h(1) }] })
    const plusNull = clusterFactsHash({
      ...group,
      members: [{ poiId: 'p1', factsHash: h(1) }, { poiId: 'p2', factsHash: null }],
    })
    expect(plusNull).not.toBe(one!)
    expect(plusNull).toMatch(HEX64)
  })

  it('returns NULL for an empty member set — never the sha256("") constant', () => {
    const empty = clusterFactsHash({ ...group, members: [] })
    expect(empty).toBeNull()
    // sha256 of the empty string: the value a naive filter+join would produce, which every
    // memberless cluster would share AND which reads as a valid hash to the admin fresh/stale check.
    expect(empty).not.toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('moves when the NAMING evidence changes but no member\'s facts do', () => {
    const members = [{ poiId: 'p1', factsHash: h(1) }, { poiId: 'p2', factsHash: h(2) }]
    const base = clusterFactsHash({ ...group, members })
    // A member promoted out of `dropped` into `highlights` is spoken aloud where it wasn't before.
    expect(clusterFactsHash({ ...group, members, highlights: ['Vikingsholm', 'Eagle Falls', 'Eagle Lake'], dropped: [] })).not.toBe(base!)
    // The title is what the skipper calls the place.
    expect(clusterFactsHash({ ...group, members, title: 'Emerald Bay' })).not.toBe(base!)
  })

  it('treats highlight ORDER as significant — "most recognisable first" is a generation input', () => {
    const members = [{ poiId: 'p1', factsHash: h(1) }]
    const a = clusterFactsHash({ ...group, members, highlights: ['Vikingsholm', 'Eagle Falls'] })
    const b = clusterFactsHash({ ...group, members, highlights: ['Eagle Falls', 'Vikingsholm'] })
    expect(a).not.toBe(b!)
  })

  it('is a pure function of pois + the cluster row — retiring member CLIPS cannot move it', () => {
    // The build order retires ~107 member narrations AFTER the fused clips are heard. Nothing about
    // that pass may re-stale the clip it just validated, so `narrations` must not be an input.
    const members = [{ poiId: 'p1', factsHash: h(1) }, { poiId: 'p2', factsHash: h(2) }]
    expect(clusterFactsHash({ ...group, members })).toBe(clusterFactsHash({ ...group, members })!)
  })
})

describe('storyFactsHash / hashFacts', () => {
  it('hashes the SHEET when enriched, ignoring article churn', () => {
    const sheet = [{ text: 'a fact', source: 'wikipedia', sourceId: '1', license: 'CC BY-SA 4.0' }] as never
    const a = storyFactsHash({ extract: 'one', title: 't', url: 'u', pageId: 1 } as never, sheet)
    const b = storyFactsHash({ extract: 'REWRITTEN', title: 't', url: 'u', pageId: 1 } as never, sheet)
    expect(a).toBe(b!)
    expect(a).toMatch(HEX64)
  })

  it('falls back to the facts bag when un-enriched', () => {
    const facts = { extract: 'one', title: 't', url: 'u', pageId: 1 } as never
    expect(storyFactsHash(facts, null)).toBe(hashFacts(facts)!)
  })

  it('is null when there is nothing to ground on', () => {
    expect(storyFactsHash(null, null)).toBeNull()
    expect(hashFacts(null)).toBeNull()
  })
})

describe('selectionSubject', () => {
  // `drives.selection` is jsonb with no FK, so the column outlives the type. Getting this wrong drops
  // every stop of a saved drive silently — the rider spent a non-refundable credit on it.
  it('reads a fused-era item', () => {
    expect(selectionSubject({ subjectId: 'c1', subjectKind: 'cluster' })).toEqual({ id: 'c1', kind: 'cluster' })
    expect(selectionSubject({ subjectId: 'p1', subjectKind: 'poi' })).toEqual({ id: 'p1', kind: 'poi' })
  })

  it('reads a LEGACY item — poiId, no subjectId — as a poi subject', () => {
    expect(selectionSubject({ poiId: 'p1' } as never)).toEqual({ id: 'p1', kind: 'poi' })
  })

  it('prefers subjectId when both are present (a fused-era poi item writes both)', () => {
    expect(selectionSubject({ subjectId: 'p1', subjectKind: 'poi', poiId: 'p1' })).toEqual({ id: 'p1', kind: 'poi' })
  })

  it('returns null when the item names no subject at all, so the caller can drop the stop', () => {
    expect(selectionSubject({} as never)).toBeNull()
  })
})

describe('stableStringify', () => {
  it('normalizes object key order (the jsonb read-back trap) but preserves array order', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }))
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]))
  })
})
