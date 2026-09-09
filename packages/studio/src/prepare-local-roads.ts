// Free, local-only OSM preparation. Reads region geometry from DB; never changes the corpus.
// Preview: --region lake-tahoe --sources us/california,us/nevada
// Prepare: add --apply; use --refresh to explicitly replace cached source pointers with latest.
// --cache-dir defaults to packages/studio/.scratch/osm; --output defaults to <cache>/<region>.roads.json.
// Geofabrik source IDs come from its catalog, not a hard-coded state list. Requires osmium-tool + curl.
import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { z } from 'zod'
import { parseFlags, announce } from './pipeline/ops'
import { resolveRegion, requireRegionBboxes } from './pipeline/region'
import { BBOX_PAD_DEG, DRIVABLE } from './pipeline/road-index'
import { assertSourceCoverage, fileHash, geometrySchema, paddedCoverage, roadsFromGeojson,
  sourceSchema, validateLocalRoads, withSourceLock, type RoadSource } from './pipeline/local-roads'

const CATALOG = 'https://download.geofabrik.de/index-v1.json'
const UA = 'Skipper/0.1 (https://skipper.fm; hello@skipper.fm) local-road-preparation'
const cacheEntry = sourceSchema.extend({ file: z.string(), bytes: z.number().int().positive() })
type CacheEntry = z.infer<typeof cacheEntry>

async function command(args: string[], capture = false): Promise<string> {
  const proc = Bun.spawn(args, { stdout: capture ? 'pipe' : 'inherit', stderr: 'inherit' })
  const output = capture ? await new Response(proc.stdout).text() : ''
  const code = await proc.exited
  if (code !== 0) throw new Error(`${args[0]} ${args[1]} exited ${code}`)
  return output.trim()
}

async function response(url: string, method = 'GET'): Promise<Response> {
  const res = await fetch(url, { method, headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`${method} ${url}: HTTP ${res.status}`)
  return res
}

export function sourceIds(raw: string | undefined): string[] {
  const ids = raw?.split(',').map((s) => s.trim()) ?? []
  if (!ids.length || ids.some((id) => !/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/.test(id))) {
    throw new Error('--sources requires comma-separated Geofabrik IDs, e.g. us/california,us/nevada')
  }
  return [...new Set(ids)].sort()
}

export async function verifiedCache(path: string): Promise<CacheEntry> {
  const entry = cacheEntry.parse(await Bun.file(path).json())
  if (Bun.file(entry.file).size !== entry.bytes || await fileHash(entry.file) !== entry.sha256) {
    throw new Error(`Cached OSM file changed: ${entry.file}`)
  }
  return entry
}

export async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2), { valueFlags: ['region', 'sources', 'cache-dir', 'output'] })
  const ids = sourceIds(flags.value('sources'))
  const region = await resolveRegion(flags.value('region'))
  const boxes = requireRegionBboxes(region)
  const apply = flags.has('apply')
  const cache = resolve(flags.value('cache-dir') ?? 'packages/studio/.scratch/osm')
  const output = resolve(flags.value('output') ?? join(cache, `${region.slug}.roads.json`))
  announce({ tool: 'prepare-local-roads', blast: ['READ-ONLY'], apply })
  console.log(`Region: ${region.slug}; sources: ${ids.join(', ')}\nLocal output: ${output}\nNo model, TTS, Routes, DB or R2 writes.`)

  const saved = new Map<string, CacheEntry>()
  for (const id of ids) {
    const path = join(cache, 'sources', `${id.replaceAll('/', '__')}.json`)
    if (!flags.has('refresh') && await Bun.file(path).exists()) {
      const entry = await verifiedCache(path)
      if (entry.id !== id) throw new Error(`Cached source ID does not match ${id}`)
      saved.set(id, entry)
    }
  }
  // Fully cached builds make no Geofabrik requests. Refresh is deliberate, never a hidden TTL.
  const catalog = saved.size === ids.length ? null : await (await response(CATALOG)).json() as {
    features: { properties: { id: string; urls: { pbf: string } }; geometry: z.infer<typeof geometrySchema> }[]
  }
  const plans = ids.map((id) => {
    const old = saved.get(id)
    if (old) return { id, url: old.url, geometry: old.geometry, old }
    const feature = catalog?.features.find((f) => f.properties.id === id)
    if (!feature) throw new Error(`Unknown Geofabrik source: ${id}`)
    const url = feature.properties.urls.pbf
    if (!url.startsWith('https://download.geofabrik.de/')) throw new Error(`Unsupported source URL: ${url}`)
    return { id, url, geometry: geometrySchema.parse(feature.geometry), old: undefined }
  })
  assertSourceCoverage(boxes, plans)
  for (const p of plans) console.log(`  ${p.id}: ${p.old ? `cached ${p.old.timestamp}` : p.url}`)
  if (!apply) { console.log('PREVIEW: add --apply to download/verify sources and prepare local roads.'); return }
  const osmiumVersion = (await command(['osmium', '--version'], true)).split('\n')[0]!
  await mkdir(join(cache, 'sources'), { recursive: true })
  const sources: CacheEntry[] = []
  for (const plan of plans) {
    if (plan.old) { sources.push(plan.old); continue }
    const entry = await withSourceLock(join(cache, 'sources', `${plan.id.replaceAll('/', '__')}.lock`), async () => {
      // Resolve latest once to its immutable dated URL. Checksums guard resumed/truncated downloads.
      const head = await response(plan.url, 'HEAD')
      const url = head.url
      if (!/^https:\/\/download\.geofabrik\.de\/.*-\d{6}\.osm\.pbf$/.test(url)) {
        throw new Error(`Provider did not resolve to a dated extract: ${url}`)
      }
      const md5 = (await (await response(`${url}.md5`)).text()).trim().split(/\s+/)[0]!
      if (!/^[a-f0-9]{32}$/.test(md5)) throw new Error(`Invalid provider checksum for ${url}`)
      // Catalog IDs, not basenames, namespace files (e.g. Georgia the country vs US state).
      const directory = join(cache, 'sources', plan.id.replaceAll('/', '__'))
      await mkdir(directory, { recursive: true })
      const file = join(directory, basename(url))
      if (!(await Bun.file(file).exists()) || await fileHash(file, 'md5') !== md5) {
        const part = `${file}.part`
        console.log(`Downloading ${plan.id}: ${url}`)
        await command(['curl', '--fail', '--location', '--retry', '3', '--connect-timeout', '20',
          '--max-time', '1800', '--continue-at', '-', '--output', part, url])
        if (await fileHash(part, 'md5') !== md5) throw new Error(`Checksum mismatch: ${part}; remove it before retrying`)
        await rename(part, file)
      }
      const timestamp = await command(['osmium', 'fileinfo', '-g', 'header.option.osmosis_replication_timestamp', file], true)
      const entry = cacheEntry.parse({ id: plan.id, url, file, md5, sha256: await fileHash(file),
        timestamp, geometry: plan.geometry, bytes: Bun.file(file).size })
      const pointer = join(cache, 'sources', `${plan.id.replaceAll('/', '__')}.json`)
      const temporary = `${pointer}.${crypto.randomUUID()}.tmp`
      await Bun.write(temporary, JSON.stringify(entry, null, 2))
      await rename(temporary, pointer)
      return entry
    })
    sources.push(entry)
  }
  if (new Set(sources.map((s) => s.timestamp)).size !== 1) {
    throw new Error('Source snapshot timestamps differ; refresh all sources together before preparing roads')
  }
  const work = await mkdtemp(join(tmpdir(), 'skipper-local-roads-'))
  try {
    const polygonFile = join(work, 'coverage.geojson')
    await Bun.write(polygonFile, JSON.stringify({ type: 'MultiPolygon', coordinates: paddedCoverage(boxes) }))
    const exportConfig = join(work, 'export.json')
    await Bun.write(exportConfig, JSON.stringify({ attributes: { type: '@type', id: '@id', version: '@version' },
      linear_tags: true, area_tags: false }))
    const features: unknown[] = []
    for (const source of sources) {
      console.log(`Extracting ${source.id} (${source.timestamp})...`)
      const crop = join(work, `${source.id.replaceAll('/', '__')}.crop.osm.pbf`)
      const roads = join(work, `${source.id.replaceAll('/', '__')}.roads.osm.pbf`)
      const geojson = join(work, `${source.id.replaceAll('/', '__')}.geojson`)
      await command(['osmium', 'extract', '-p', polygonFile, '-s', 'complete_ways', '-S', 'relations=false', source.file, '-o', crop])
      await command(['osmium', 'tags-filter', crop, `w/highway=${DRIVABLE.slice(2, -2).split('|').join(',')}`, '-o', roads])
      await command(['osmium', 'check-refs', roads])
      await command(['osmium', 'export', '-E', '--geometry-types=linestring', '-a', 'type,id,version', '-c', exportConfig, roads, '-o', geojson])
      const result = await Bun.file(geojson).json() as { type: string; features: unknown[] }
      if (result.type !== 'FeatureCollection' || !Array.isArray(result.features)) throw new Error('Invalid Osmium export')
      features.push(...result.features)
    }
    const ways = roadsFromGeojson({ type: 'FeatureCollection', features })
    const data = validateLocalRoads({ format: 'skipper-local-roads-v1', region: region.slug,
      generatedAt: new Date().toISOString(), osmiumVersion, boxes, paddingDegrees: BBOX_PAD_DEG,
      sources: sources.map(({ file: _, bytes: _bytes, ...s }): RoadSource => s), ways }, region.slug, boxes)
    await mkdir(dirname(output), { recursive: true })
    // An interrupted extraction leaves the previous complete road file intact.
    const temporary = `${output}.${crypto.randomUUID()}.tmp`
    await Bun.write(temporary, JSON.stringify(data))
    await rename(temporary, output)
    console.log(`Prepared ${ways.length} unique roads; SHA-256 ${await fileHash(output)}\n${output}`)
  } finally { await rm(work, { recursive: true, force: true }) }
}

if (import.meta.main) main().catch((error) => { console.error(error); process.exitCode = 1 })
