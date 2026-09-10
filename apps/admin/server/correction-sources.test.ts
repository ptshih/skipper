import { expect, test } from 'bun:test'
import { correctionSourcesFor, resolveCorrectionSource } from './correction-sources'
const poi = { source: 'wikipedia' as const, sourceId: '6010203', qid: 'Q7088437' }
test('primary default remains compatible while secondary Wikidata resolves server-side', () => {
  expect(correctionSourcesFor(poi)).toEqual([{ source: 'wikipedia', sourceId: '6010203' }, { source: 'wikidata', sourceId: 'Q7088437' }])
  expect(resolveCorrectionSource(poi, undefined)).toEqual({ source: 'wikipedia', sourceId: '6010203' })
  expect(resolveCorrectionSource(poi, 'wikidata')).toEqual({ source: 'wikidata', sourceId: 'Q7088437' })
})
test('missing, arbitrary, and unrelated identities cannot target a different source row', () => {
  expect(resolveCorrectionSource({ ...poi, qid: null }, 'wikidata')).toBeNull()
  expect(resolveCorrectionSource(poi, 'Q1')).toBeNull()
  expect(resolveCorrectionSource(poi, null)).toBeNull()
  expect(resolveCorrectionSource({ source: 'wikidata', sourceId: 'Q1', qid: 'Q1' }, 'wikipedia')).toBeNull()
  expect(correctionSourcesFor({ source: 'wikidata', sourceId: 'Q1', qid: 'Q1' })).toHaveLength(1)
})
