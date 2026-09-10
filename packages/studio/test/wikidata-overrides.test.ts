import { afterEach, expect, spyOn, test } from 'bun:test'
import { wikidataFacts } from '../src/pipeline/wikidata'
import { clearPoiOverridesForTest, setPoiOverridesForTest } from '../src/pipeline/poi-overrides'

const realFetch = globalThis.fetch
const original = 'It sits at about 8,200 feet above sea level.'
const corrected = 'It sits at approximately 8,400 feet above sea level.'
const edit = { source: 'wikidata', sourceId: 'Q7088437', name: 'Olmsted Point', find: original, replace: corrected, reason: 'NPS elevation' }
afterEach(() => { globalThis.fetch = realFetch; clearPoiOverridesForTest() })
function stub() {
  globalThis.fetch = (async () => Response.json({ entities: {
    Q7088437: { id: 'Q7088437', labels: { en: { value: 'Olmsted Point' } }, claims: {
      P2044: [{ rank: 'normal', mainsnak: { snaktype: 'value', datavalue: { value: { amount: '+8200', unit: 'http://www.wikidata.org/entity/Q3710' } } } }],
    } },
  } })) as unknown as typeof fetch
}
test('fetch corrects rendered Wikidata facts and preserves QID provenance', async () => {
  stub(); setPoiOverridesForTest([edit])
  const result = await wikidataFacts('Q7088437')
  expect(result?.facts).toEqual([corrected])
  expect(result?.attribution).toMatchObject({ source: 'wikidata', sourceId: 'Q7088437', license: 'CC0' })
})
test('same text under another source or QID does not alter this bundle', async () => {
  stub(); setPoiOverridesForTest([{ ...edit, source: 'wikipedia' }, { ...edit, sourceId: 'Q1' }])
  expect((await wikidataFacts('Q7088437'))?.facts).toEqual([original])
})
test('deleting the sole line yields no empty fact; retiring restores upstream text', async () => {
  stub(); setPoiOverridesForTest([{ ...edit, replace: '' }])
  expect(await wikidataFacts('Q7088437')).toBeNull()
  setPoiOverridesForTest([{ ...edit, active: false }])
  expect((await wikidataFacts('Q7088437'))?.facts).toEqual([original])
})
test('unmatched correction warns once per bundle context', async () => {
  stub(); setPoiOverridesForTest([{ ...edit, find: 'Old wording' }])
  const warning = spyOn(console, 'warn').mockImplementation(() => {})
  try {
    await wikidataFacts('Q7088437'); await wikidataFacts('Q7088437')
    expect(warning).toHaveBeenCalledTimes(1)
  } finally { warning.mockRestore() }
})
