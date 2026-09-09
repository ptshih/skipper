import { expect, test } from 'bun:test'
import { fetchTile } from './snap-speakable-anchors'

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
    : Response.json({ elements: [{ geometry, tags: { highway: 'primary' } }] }), noPause)
  expect(calls).toBe(2)
  expect(result).toEqual([{ geom: geometry, cls: 'primary' }])
})
