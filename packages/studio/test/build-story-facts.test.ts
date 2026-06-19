import { describe, expect, test } from 'bun:test'
import { buildStoryFacts } from '../src/pipeline/persist'

// buildStoryFacts is the SINGLE builder every facts writer (sweep, refetch) uses. The facts-bag
// SHAPE (canonical key order, key set) and key-order hash invariance are covered in
// story-grounding.test.ts; this locks that the Wikidata qid is NOT in the bag — it was hoisted to
// the first-class `pois.qid` column (the canonical identity + dedup key), passed separately to
// upsertPoi. (Replaces the old qid-in-facts preservation tests; qid can no longer drift in/out of
// the bag because it isn't in the bag.)
describe('buildStoryFacts', () => {
  test('produces the canonical, qid-free facts bag', () => {
    const f = buildStoryFacts({ extract: 'e', title: 't', url: 'u', pageId: 1 })
    expect(Object.keys(f)).toEqual(['extract', 'title', 'url', 'pageId'])
    expect('qid' in f).toBe(false)
  })
})
