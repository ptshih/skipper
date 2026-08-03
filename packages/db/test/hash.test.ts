// Grounding-fingerprint guards. `clusterFactsHash` is the only staleness detector a FUSED telling
// gets, and both of its failure modes cost real money on a schedule: a hash that misses a change makes
// the clip immortal (drifting from its sources forever), and a hash that moves without a change makes
// it re-narrate + re-synthesize on every run. These assert the properties that distinguish the two.
// Pure functions over strings — offline, no DB.
import { describe, expect, it } from 'bun:test'
import { clusterFactsHash, groundingHash, hashFacts, hashSheet, stableStringify } from '../src/hash'
import { selectionSubject } from '../src/schema'

const HEX64 = /^[0-9a-f]{64}$/
const h = (n: number) => String(n).repeat(64).slice(0, 64) // a stand-in facts_hash, right shape
const group = { title: 'Emerald Bay and Vikingsholm', highlights: ['Vikingsholm', 'Eagle Falls'], dropped: ['Eagle Lake'] }

describe('clusterFactsHash', () => {
  it('is invariant to member ORDER — the member set is a set', () => {
    const a = clusterFactsHash({ ...group, members: [{ poiId: 'p1', name: 'Vikingsholm', factsHash: h(1) }, { poiId: 'p2', name: 'Eagle Falls', factsHash: h(2) }] })
    const b = clusterFactsHash({ ...group, members: [{ poiId: 'p2', name: 'Eagle Falls', factsHash: h(2) }, { poiId: 'p1', name: 'Vikingsholm', factsHash: h(1) }] })
    expect(a).toMatch(HEX64)
    expect(a).toBe(b!)
  })

  it('moves when a member\'s facts move', () => {
    const before = clusterFactsHash({ ...group, members: [{ poiId: 'p1', name: 'Vikingsholm', factsHash: h(1) }] })
    const after = clusterFactsHash({ ...group, members: [{ poiId: 'p1', name: 'Vikingsholm', factsHash: h(9) }] })
    expect(after).not.toBe(before!)
  })

  it('moves when MEMBERSHIP changes even though every surviving hash is identical', () => {
    const before = clusterFactsHash({ ...group, members: [{ poiId: 'p1', name: 'Vikingsholm', factsHash: h(1) }, { poiId: 'p2', name: 'Eagle Falls', factsHash: h(2) }] })
    const after = clusterFactsHash({ ...group, members: [{ poiId: 'p1', name: 'Vikingsholm', factsHash: h(1) }] })
    expect(after).not.toBe(before!)
  })

  it('keys on WHICH place, not just the multiset of hashes — two places can share a hash', () => {
    // Same NAME and same facts on purpose: this isolates `poiId`, so it still fails if the id is ever
    // dropped from the payload. Vary the name too and the test would pass on the name alone.
    const a = clusterFactsHash({ ...group, members: [{ poiId: 'p1', name: 'Vikingsholm', factsHash: h(1) }] })
    const b = clusterFactsHash({ ...group, members: [{ poiId: 'p2', name: 'Vikingsholm', factsHash: h(1) }] })
    expect(a).not.toBe(b!)
  })

  it('moves when a member is RENAMED — the fused prompt speaks that name aloud', () => {
    // `pois.name` becomes the "• Name:" bullet the telling is instructed to work in, so a rename
    // rewrites the most audible part of the script while every facts_hash stays byte-identical. Until
    // 2026-08-02 the digest omitted it and the clip read FRESH through a rename.
    const before = clusterFactsHash({ ...group, members: [{ poiId: 'p1', name: 'Vikingsholm', factsHash: h(1) }] })
    const after = clusterFactsHash({ ...group, members: [{ poiId: 'p1', name: 'Vikingsholm Castle', factsHash: h(1) }] })
    expect(before).not.toBe(after!)
  })

  it('cannot be spoofed by a name containing the field separator', () => {
    // The member payload is JSON-encoded per member rather than "a:b:c"-joined: a free-text name may
    // contain the separator, and a digest whose input can be spelled two ways can silently collide.
    const a = clusterFactsHash({ ...group, members: [{ poiId: 'p1', name: 'Foo", "bar', factsHash: h(1) }] })
    const b = clusterFactsHash({ ...group, members: [{ poiId: 'p1', name: 'Foo', factsHash: h(1) }] })
    expect(a).not.toBe(b!)
  })

  it('does not DROP a null-hash member — the bug a .filter(Boolean) would hide', () => {
    const one = clusterFactsHash({ ...group, members: [{ poiId: 'p1', name: 'Vikingsholm', factsHash: h(1) }] })
    const plusNull = clusterFactsHash({
      ...group,
      members: [{ poiId: 'p1', name: 'Vikingsholm', factsHash: h(1) }, { poiId: 'p2', name: 'Eagle Falls', factsHash: null }],
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
    const members = [{ poiId: 'p1', name: 'Vikingsholm', factsHash: h(1) }, { poiId: 'p2', name: 'Eagle Falls', factsHash: h(2) }]
    const base = clusterFactsHash({ ...group, members })
    // A member promoted out of `dropped` into `highlights` is spoken aloud where it wasn't before.
    expect(clusterFactsHash({ ...group, members, highlights: ['Vikingsholm', 'Eagle Falls', 'Eagle Lake'], dropped: [] })).not.toBe(base!)
    // The title is what the skipper calls the place.
    expect(clusterFactsHash({ ...group, members, title: 'Emerald Bay' })).not.toBe(base!)
  })

  it('treats highlight ORDER as significant — "most recognisable first" is a generation input', () => {
    const members = [{ poiId: 'p1', name: 'Vikingsholm', factsHash: h(1) }]
    const a = clusterFactsHash({ ...group, members, highlights: ['Vikingsholm', 'Eagle Falls'] })
    const b = clusterFactsHash({ ...group, members, highlights: ['Eagle Falls', 'Vikingsholm'] })
    expect(a).not.toBe(b!)
  })

  it('is a pure function of pois + the cluster row — retiring member CLIPS cannot move it', () => {
    // The build order retires ~107 member narrations AFTER the fused clips are heard. Nothing about
    // that pass may re-stale the clip it just validated, so `narrations` must not be an input.
    const members = [{ poiId: 'p1', name: 'Vikingsholm', factsHash: h(1) }, { poiId: 'p2', name: 'Eagle Falls', factsHash: h(2) }]
    expect(clusterFactsHash({ ...group, members })).toBe(clusterFactsHash({ ...group, members })!)
  })
})

describe('groundingHash / hashSheet / hashFacts — the two-column fingerprint', () => {
  const sheet = [{ text: 'a fact', source: 'wikipedia', sourceId: '1', license: 'CC BY-SA 4.0' }] as never

  it('grounding takes the SHEET hash when enriched, ignoring article churn', () => {
    // The columns as the writers set them: facts_hash follows the article, sheet_hash the sheet.
    const a = groundingHash({ factsHash: hashFacts({ extract: 'one', title: 't', url: 'u', pageId: 1 } as never), sheetHash: hashSheet(sheet) })
    const b = groundingHash({ factsHash: hashFacts({ extract: 'REWRITTEN', title: 't', url: 'u', pageId: 1 } as never), sheetHash: hashSheet(sheet) })
    expect(a).toBe(b!) // the free sweep moved facts_hash; grounding did not move
    expect(a).toMatch(HEX64)
  })

  it('falls through to the facts hash when un-enriched', () => {
    const facts = { extract: 'one', title: 't', url: 'u', pageId: 1 } as never
    expect(groundingHash({ factsHash: hashFacts(facts), sheetHash: hashSheet(null) })).toBe(hashFacts(facts)!)
  })

  it('hashSheet is null for an absent OR empty sheet — never sha256 of an empty array', () => {
    // Null is what makes the coalesce fall through. A constant digest here would make every
    // un-enriched poi share one grounding hash and read fresh against any clip carrying it.
    expect(hashSheet(null)).toBeNull()
    expect(hashSheet([])).toBeNull()
  })

  it('is null when there is nothing to ground on', () => {
    expect(groundingHash({ factsHash: null, sheetHash: null })).toBeNull()
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
