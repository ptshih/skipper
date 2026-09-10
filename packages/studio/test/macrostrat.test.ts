import { afterEach, expect, test } from 'bun:test'
import { geologyFacts } from '../src/pipeline/macrostrat'
const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })
function stub(lith: string, name: string) {
  globalThis.fetch = (async () => Response.json({ success: { data: [{ map_id: 3185269, name, lith, strat_name: '', best_int_name: 'Paleozoic', t_age: 358.9, b_age: 443.8 }] } })) as unknown as typeof fetch
}
test('mixed sedimentary/volcanic unit preserves source lithology without inventing lava origin', async () => {
  stub('mudstone-carbonate-sandstone-conglomerate', 'Paleozoic sedimentary and volcanic rocks')
  const result = await geologyFacts(37.6567, -119.901)
  expect(result?.facts).toEqual(['The bedrock at this spot is mudstone-carbonate-sandstone-conglomerate.', 'This rock unit dates to the Paleozoic — roughly 359 to 444 million years old.'])
  expect(result?.attribution).toMatchObject({ source: 'macrostrat', sourceId: '3185269', license: 'CC BY 4.0' })
})
test('major/minor mixed unit does not assign one formation process to its constituents', async () => {
  stub('Major:{sandstone,basalt}, Minor:{granite}', 'Mixed rocks')
  expect((await geologyFacts(1, 2))?.facts[0]).toBe('The bedrock at this spot is sandstone,basalt.')
})
test('ordinary lithologies remain available; unusable water unit remains absent', async () => {
  for (const rock of ['granite', 'basalt']) {
    stub(rock, rock)
    expect((await geologyFacts(1, 2))?.facts[0]).toBe(`The bedrock at this spot is ${rock}.`)
  }
  stub('water', 'Water')
  expect(await geologyFacts(1, 2)).toBeNull()
})
