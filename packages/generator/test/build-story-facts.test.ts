import { describe, expect, test } from 'bun:test'
import { buildStoryFacts, hashFacts } from '../src/pipeline/persist'

// buildStoryFacts is the SINGLE builder every facts writer (sweep, refetch, tour+roam deepen) uses.
// These lock the two properties the facts HASH contract depends on: a fixed key order and qid
// preservation — the drift that caused the 2026-06-15 deepen qid-drop bug.
describe('buildStoryFacts', () => {
  test('emits the canonical key order: extract, title, url, pageId, qid', () => {
    const f = buildStoryFacts({ extract: 'e', title: 't', url: 'u', pageId: 1, qid: 'Q1' })
    expect(Object.keys(f)).toEqual(['extract', 'title', 'url', 'pageId', 'qid'])
  })

  test('omits qid when absent/null/empty (never stored as null)', () => {
    for (const qid of [undefined, null, '']) {
      const f = buildStoryFacts({ extract: 'e', title: 't', url: 'u', pageId: 1, qid })
      expect('qid' in f).toBe(false)
      expect(Object.keys(f)).toEqual(['extract', 'title', 'url', 'pageId'])
    }
  })

  test('is input-order independent → identical object + hash regardless of arg order (cross-writer stability)', () => {
    const a = buildStoryFacts({ extract: 'Lake Tahoe is deep.', title: 'Lake Tahoe', url: 'https://x', pageId: 42, qid: 'Q123' })
    const b = buildStoryFacts({ qid: 'Q123', pageId: 42, url: 'https://x', title: 'Lake Tahoe', extract: 'Lake Tahoe is deep.' })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(hashFacts(a)).toBe(hashFacts(b))
  })

  test('qid is hash-significant — dropping it changes the hash (the bug this prevents)', () => {
    const withQid = buildStoryFacts({ extract: 'e', title: 't', url: 'u', pageId: 1, qid: 'Q9' })
    const without = buildStoryFacts({ extract: 'e', title: 't', url: 'u', pageId: 1 })
    expect(hashFacts(withQid)).not.toBe(hashFacts(without))
  })
})
