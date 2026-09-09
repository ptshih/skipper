import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { assertSourceCoverage, fileHash, loadLocalRoads, roadsFromGeojson, validateLocalRoads,
  withSourceLock, type LocalRoads, type RoadSource } from '../src/pipeline/local-roads'
import { BBOX_PAD_DEG, RoadIndex } from '../src/pipeline/road-index'
import { sourceIds, verifiedCache } from '../src/prepare-local-roads'

const box = { swLng: 0, swLat: 0, neLng: 1, neLat: 1 }
const geometry = (w: number, s: number, e: number, n: number): RoadSource['geometry'] => ({
  type: 'MultiPolygon', coordinates: [[[[w, s], [e, s], [e, n], [w, n], [w, s]]]],
})
const source = (id = 'left'): RoadSource => ({ id, url: `https://example.com/${id}.osm.pbf`,
  md5: 'a'.repeat(32), sha256: 'b'.repeat(64), timestamp: '2026-09-08T20:21:01Z',
  geometry: geometry(-1, -1, 2, 2) })
const way = { id: 'w1', version: 1, cls: 'primary', tags: { highway: 'primary' },
  geom: [{ lat: 0, lon: 0 }, { lat: 1, lon: 1 }] }
const file = (): LocalRoads => ({ format: 'skipper-local-roads-v1', region: 'test-region',
  generatedAt: '2026-09-09T00:00:00Z', osmiumVersion: 'osmium test', boxes: [box],
  paddingDegrees: BBOX_PAD_DEG, sources: [source()], ways: [structuredClone(way)] })

test('state boundary needs both source polygons, including the road-search buffer', () => {
  const left = { geometry: geometry(-1, -1, 0.5, 2) }
  const right = { geometry: geometry(0.5, -1, 2, 2) }
  expect(() => assertSourceCoverage([box], [left])).toThrow('missing state')
  expect(() => assertSourceCoverage([box], [left, right])).not.toThrow()
  expect(() => assertSourceCoverage([box], [{ geometry: geometry(0, 0, 1, 1) }])).toThrow()
})

test('disjoint region boxes do not demand sources for their intervening gap', () => {
  const other = { swLng: 4, swLat: 0, neLng: 5, neLat: 1 }
  expect(() => assertSourceCoverage([box, other], [source(), { geometry: geometry(3, -1, 6, 2) }])).not.toThrow()
})

test('an uncovered interior hole cannot pass a corners-only coverage check', () => {
  const s = source()
  s.geometry.coordinates[0]!.push([[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6], [0.4, 0.4]])
  expect(() => assertSourceCoverage([box], [s])).toThrow('missing state')
})

test('wrong region, expanded geometry, mixed snapshots and duplicate roads fail closed', () => {
  expect(() => validateLocalRoads(file(), 'wrong-region', [box])).toThrow('belongs')
  expect(() => validateLocalRoads(file(), 'test-region', [{ ...box, neLng: 1.1 }])).toThrow('current region')
  const mixed = file()
  mixed.sources.push({ ...source('right'), timestamp: '2026-09-07T20:21:01Z' })
  expect(() => validateLocalRoads(mixed, 'test-region', [box])).toThrow('different snapshot')
  const duplicate = file()
  duplicate.ways.push(structuredClone(way))
  expect(() => validateLocalRoads(duplicate, 'test-region', [box])).toThrow('Duplicate road')
  expect(() => validateLocalRoads({ ...file(), ways: [] }, 'test-region', [box])).toThrow()
})

const feature = (version = 1, highway = 'primary') => ({ type: 'Feature', properties: {
  '@id': 1, '@type': 'way', '@version': version, highway,
}, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } })
const collection = (...features: unknown[]) => ({ type: 'FeatureCollection', features })

test('overlapping state roads deduplicate only when version, tags and geometry match', () => {
  expect(roadsFromGeojson(collection(feature(), feature()))).toHaveLength(1)
  expect(() => roadsFromGeojson(collection(feature(), feature(2)))).toThrow('Conflicting road')
  expect(() => roadsFromGeojson(collection(feature(), feature(1, 'secondary')))).toThrow('Conflicting road')
  const shifted = feature()
  shifted.geometry.coordinates[1] = [1.1, 1]
  expect(() => roadsFromGeojson(collection(feature(), shifted))).toThrow('Conflicting road')
  const absentId = feature()
  delete (absentId.properties as Record<string, unknown>)['@id']
  expect(() => roadsFromGeojson(collection(absentId))).toThrow('identity')
})

test('local roads preserve coordinates/class and fingerprint the bytes actually loaded', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'skipper-road-test-'))
  try {
    const path = join(dir, 'roads.json')
    await Bun.write(path, JSON.stringify(file()))
    const local = await loadLocalRoads(path, 'test-region', [box])
    const index = new RoadIndex()
    index.add(local.ways)
    expect(index.nearest(0, 0, true)).toEqual({ distM: 0, lat: 0, lng: 0, cls: 'primary' })
    await Bun.write(path, JSON.stringify(file(), null, 2))
    const reformatted = await loadLocalRoads(path, 'test-region', [box])
    expect(reformatted.provenance.sha256).not.toBe(local.provenance.sha256)
    const broken = file()
    broken.ways[0]!.geom[0]!.lat = 100
    await Bun.write(path, JSON.stringify(broken))
    await expect(loadLocalRoads(path, 'test-region', [box])).rejects.toThrow()
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('future source names require no code changes; unsafe or missing IDs are refused', () => {
  expect(sourceIds('us/utah,us/arizona,us/utah')).toEqual(['us/arizona', 'us/utah'])
  expect(() => sourceIds(undefined)).toThrow('--sources')
  expect(() => sourceIds('../california')).toThrow('--sources')
})

test('shared source cache excludes another writer and releases its lock after a failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'skipper-road-lock-'))
  const lock = join(dir, 'state.lock')
  try {
    await expect(withSourceLock(lock, async () => {
      await expect(withSourceLock(lock, async () => 'must not run')).rejects.toThrow('cache is busy')
      throw new Error('download interrupted')
    })).rejects.toThrow('download interrupted')
    expect(await withSourceLock(lock, async () => 'retry succeeded')).toBe('retry succeeded')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('cached source corruption is rejected before it can be reused as road data', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'skipper-road-cache-'))
  try {
    const data = join(dir, 'source.pbf'), pointer = join(dir, 'source.json')
    await Bun.write(data, 'original')
    await Bun.write(pointer, JSON.stringify({ ...source(), file: data, bytes: 8, sha256: await fileHash(data) }))
    expect((await verifiedCache(pointer)).bytes).toBe(8)
    await Bun.write(data, 'modified')
    await expect(verifiedCache(pointer)).rejects.toThrow('Cached OSM file changed')
    await Bun.write(data, 'short')
    await expect(verifiedCache(pointer)).rejects.toThrow('Cached OSM file changed')
  } finally { await rm(dir, { recursive: true, force: true }) }
})
