// Region road files are frozen local artifacts, not a live closure feed. Their coverage and
// provenance travel with the geometry so a missing state can never look like empty backcountry.
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import * as clipping from 'polygon-clipping'
import type { MultiPolygon } from 'polygon-clipping'
import { z } from 'zod'
import { BBOX_PAD_DEG, DRIVABLE, type Way } from './road-index'

const lng = z.number().finite().min(-180).max(180)
const lat = z.number().finite().min(-90).max(90)
const point = z.tuple([lng, lat])
const polygon = z.array(z.array(point).min(4)).min(1)
export const geometrySchema = z.object({
  type: z.literal('MultiPolygon'), coordinates: z.array(polygon).min(1),
})
export const boxSchema = z.object({ swLng: lng, swLat: lat, neLng: lng, neLat: lat })
  .refine((b) => b.swLng < b.neLng && b.swLat < b.neLat, 'Invalid road coverage box')
export type RoadBox = z.infer<typeof boxSchema>
export const sourceSchema = z.object({
  id: z.string().min(1), url: z.url(), md5: z.string().regex(/^[a-f0-9]{32}$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), timestamp: z.iso.datetime(),
  geometry: geometrySchema,
})
export type RoadSource = z.infer<typeof sourceSchema>
export const roadWaySchema = z.object({
  id: z.string().regex(/^w[0-9]+$/), cls: z.string().regex(new RegExp(DRIVABLE)),
  version: z.number().int().positive(), tags: z.record(z.string(), z.string()),
  geom: z.array(z.object({ lat, lon: lng })).min(2),
})
export const localRoadsSchema = z.object({
  format: z.literal('skipper-local-roads-v1'), region: z.string().min(1),
  generatedAt: z.iso.datetime(), osmiumVersion: z.string().min(1),
  boxes: z.array(boxSchema).min(1), paddingDegrees: z.literal(BBOX_PAD_DEG),
  sources: z.array(sourceSchema).min(1), ways: z.array(roadWaySchema).min(1),
})
export type LocalRoads = z.infer<typeof localRoadsSchema>

export function paddedCoverage(boxes: readonly RoadBox[]): MultiPolygon {
  if (!boxes.length) throw new Error('Road coverage requires a region with valid boxes')
  return clipping.union(...boxes.map((raw): MultiPolygon => {
    const b = boxSchema.parse(raw)
    const w = Math.max(-180, b.swLng - BBOX_PAD_DEG), e = Math.min(180, b.neLng + BBOX_PAD_DEG)
    const s = Math.max(-90, b.swLat - BBOX_PAD_DEG), n = Math.min(90, b.neLat + BBOX_PAD_DEG)
    return [[[[w, s], [e, s], [e, n], [w, n], [w, s]]]]
  }) as [MultiPolygon, ...MultiPolygon[]])
}

export function assertSourceCoverage(boxes: readonly RoadBox[], sources: readonly Pick<RoadSource, 'geometry'>[]): void {
  if (!sources.length) throw new Error('No OSM sources selected')
  const geometries = sources.map((s) => geometrySchema.parse(s.geometry).coordinates)
  if (clipping.difference(paddedCoverage(boxes), ...geometries).length) {
    throw new Error('OSM sources do not cover every buffered region box; add the missing state/extract')
  }
}

export async function fileHash(path: string, algorithm = 'sha256'): Promise<string> {
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

/** A shared state's resumable download must have one writer, even across region preparations. */
export async function withSourceLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  try { await mkdir(path) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`OSM source cache is busy: ${path}. Retry after the other preparation finishes.`)
    }
    throw error
  }
  try { return await operation() } finally { await rm(path, { recursive: true, force: true }) }
}

export function validateLocalRoads(value: unknown, region: string, boxes: readonly RoadBox[]): LocalRoads {
  const data = localRoadsSchema.parse(value)
  if (data.region !== region) throw new Error(`Road file belongs to ${data.region}, not ${region}`)
  if (clipping.difference(paddedCoverage(boxes), paddedCoverage(data.boxes)).length) {
    throw new Error('Road file does not cover the current region geometry; rebuild it')
  }
  assertSourceCoverage(boxes, data.sources)
  if (new Set(data.sources.map((s) => s.timestamp)).size !== 1) {
    throw new Error('OSM sources have different snapshot timestamps; use matching dated extracts')
  }
  const ids = new Set<string>()
  for (const way of data.ways) {
    if (ids.has(way.id)) throw new Error(`Duplicate road ${way.id} in local road file`)
    ids.add(way.id)
  }
  return data
}

export async function loadLocalRoads(path: string, region: string, boxes: readonly RoadBox[]) {
  // Read once: the report's fingerprint must describe the very bytes used for snapping.
  const bytes = await Bun.file(path).text()
  const data = validateLocalRoads(JSON.parse(bytes), region, boxes)
  return {
    ways: data.ways as Way[],
    provenance: { kind: 'local-osm' as const, path, sha256: createHash('sha256').update(bytes).digest('hex'),
      generatedAt: data.generatedAt, sources: data.sources.map(({ geometry: _, ...source }) => source) },
  }
}

// Osmium export retains way IDs. Reject conflicting duplicates instead of silently picking a
// version at a state boundary; matching source timestamps and `osmium merge` prevent these normally.
export function roadsFromGeojson(value: unknown): z.infer<typeof roadWaySchema>[] {
  const data = z.object({ type: z.literal('FeatureCollection'), features: z.array(z.object({
    type: z.literal('Feature'), properties: z.record(z.string(), z.unknown()),
    geometry: z.object({ type: z.literal('LineString'), coordinates: z.array(point).min(2) }),
  })) }).parse(value)
  const ways = new Map<string, z.infer<typeof roadWaySchema>>()
  for (const f of data.features) {
    const cls = f.properties.highway
    if (typeof cls !== 'string' || !new RegExp(DRIVABLE).test(cls)) continue
    if (f.properties['@type'] !== 'way' || !Number.isSafeInteger(f.properties['@id'])) {
      throw new Error('Exported road is missing its OSM way identity')
    }
    const tags = Object.fromEntries(Object.entries(f.properties).filter(([key]) => !key.startsWith('@')).sort(([a], [b]) => a.localeCompare(b)))
    const way = roadWaySchema.parse({ id: `w${f.properties['@id']}`, cls, tags, version: f.properties['@version'],
      geom: f.geometry.coordinates.map(([lon, lat]) => ({ lat, lon })) })
    const prior = ways.get(way.id)
    if (prior && JSON.stringify(prior) !== JSON.stringify(way)) throw new Error(`Conflicting road ${way.id}`)
    ways.set(way.id, way)
  }
  if (!ways.size) throw new Error('Local OSM extraction produced no drivable roads')
  return [...ways.values()].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
}
