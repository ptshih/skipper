import { expect, test } from 'bun:test'
import { fetchTile } from './snap-speakable-anchors'
import { RoadIndex, roadReviewHolds } from './pipeline/road-index'

const noPause = async () => {}

test('exhausted server errors cannot masquerade as a roadless tile', async () => {
  let calls = 0
  const request = async () => {
    calls++
    return new Response('', { status: 503 })
  }
  await expect(fetchTile(37, -120, 38, -119, request, noPause)).rejects.toThrow('road tile unavailable')
  expect(calls).toBe(4)
})

test('HTTP-success partial data is rejected while a complete empty tile is valid', async () => {
  await expect(fetchTile(37, -120, 38, -119, async () => Response.json({
    elements: [], remark: 'runtime error: Query timed out',
  }), noPause)).rejects.toThrow('Incomplete Overpass tile')
  expect(await fetchTile(37, -120, 38, -119, async () => Response.json({ elements: [] }), noPause)).toEqual([])
})

test('a transient failure retries and preserves returned road geometry and class', async () => {
  let calls = 0
  const geometry = [{ lat: 37.5, lon: -119.5 }, { lat: 37.6, lon: -119.6 }]
  const result = await fetchTile(37, -120, 38, -119, async () => ++calls === 1
    ? new Response('', { status: 429 })
    : Response.json({ elements: [{ id: 123, geometry, tags: { highway: 'primary', motor_vehicle: 'private' } }] }), noPause)
  expect(calls).toBe(2)
  expect(result).toEqual([{ geom: geometry, cls: 'primary', id: 'w123', tags: { highway: 'primary', motor_vehicle: 'private' } }])
})


test('nearest-road evidence belongs to the selected segment, including through-road preference', () => {
  const roads = new RoadIndex()
  roads.add([
    {id: 'w1', cls:'residential', tags:{name:'Side street'}, geom:[{lat:37,lon:-120},{lat:37.01,lon:-120}]},
    {id: 'w2', cls:'primary', tags:{name:'Main road', tunnel:'yes'}, geom:[{lat:37,lon:-120.001},{lat:37.01,lon:-120.001}]},
  ])
  expect(roads.nearest(37.005,-120)?.road.id).toBe('w1')
  const major = roads.nearest(37.005,-120,true)!
  expect(major.road.id).toBe('w2')
  expect(roadReviewHolds(major.road.tags)).toEqual(['tunnel=yes'])
})

test('known vehicle restrictions are held while seasonal evidence remains available for review', () => {
  expect(roadReviewHolds({motor_vehicle:'private', disabled:'yes'})).toEqual(['motor_vehicle=private'])
  expect(roadReviewHolds({access:'no',motorcar:'yes'})).toEqual(['access=no'])
  expect(roadReviewHolds({vehicle:'forestry'})).toEqual(['vehicle=forestry'])
  expect(roadReviewHolds({tunnel:'building_passage'})).toEqual(['tunnel=building_passage'])
  expect(roadReviewHolds({access:'permissive', 'access:conditional':'no @ (Nov-May)',tunnel:'no'})).toEqual([])
  expect(roadReviewHolds()).toEqual([])
})
