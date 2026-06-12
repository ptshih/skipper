// The load-bearing APPLY SEAM in pipeline/wikipedia.ts — review-mandated coverage: if a
// refactor drops either applyFactEditsChecked call, corrections silently stop applying
// while every other test stays green. Wikipedia's HTTP layer is stubbed via global fetch.

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { fetchDeepExtracts, fetchExtractsByTitle } from '../src/pipeline/wikipedia'
import {
  clearPoiOverridesForTest,
  setPoiOverridesForTest,
} from '../src/pipeline/poi-overrides'

const realFetch = globalThis.fetch

function stubWikipedia(extract: string): void {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        query: {
          pages: [
            {
              pageid: 4242,
              title: 'Stub Place',
              extract,
              fullurl: 'https://en.wikipedia.org/wiki/Stub_Place',
            },
          ],
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as unknown as typeof fetch
}

beforeEach(() => {
  setPoiOverridesForTest([
    {
      source: 'wikipedia',
      sourceId: '4242',
      name: 'Stub Place',
      find: 'built by the wrong person',
      replace: 'built by the right person',
      reason: 'seam test',
      sourceUrl: 'https://example.com',
    },
  ])
})

afterEach(() => {
  globalThis.fetch = realFetch
  clearPoiOverridesForTest()
})

test('lead extracts (fetchExtractsByTitle) pass through the correction seam', async () => {
  stubWikipedia('This hall was built by the wrong person in 1900.')
  const out = await fetchExtractsByTitle(['Stub Place'])
  expect(out[0]?.extract).toBe('This hall was built by the right person in 1900.')
})

test('deep extracts (fetchDeepExtracts) pass through the correction seam', async () => {
  stubWikipedia('Long body text. It was built by the wrong person, sadly.\n\nReferences\nfoo')
  const out = await fetchDeepExtracts([4242])
  // The END_SECTION cut runs first, then the correction.
  expect(out.get(4242)).toBe('Long body text. It was built by the right person, sadly.')
})
