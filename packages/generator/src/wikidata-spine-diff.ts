// Validation harness for the Wikidata discovery SPINE (pipeline/wikidata-discovery.ts).
//
// Runs the REAL spine module + the current Wikipedia-geosearch pipeline on a frozen route
// and prints the tier breakdown + a diff, so a flip can be judged on evidence (no TTS, no
// DB writes). The two gates it answers:
//   - regression: does the spine's STORY tier preserve the route's current story stops?
//   - coverage:   does the scenic layer surface the named bays/beaches Wikipedia is blind to?
//
// Usage (frozen artifact read from packages/db/seed/data/<slug>.json):
//   dotenvx run -f .env.development -- bun packages/generator/src/wikidata-spine-diff.ts <slug> [<slug2> ...]

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cumulativeMeters, sampleAlong, type LngLat } from './pipeline/geo'
import { discoverWikipediaPois } from './pipeline/wikipedia'
import { discoverWikidataPois } from './pipeline/wikidata-discovery'
import { GEOSEARCH_STEP_M, OFF_ROUTE_MAX_M, STORY_MIN_FACT_CHARS } from './config'
import { haversineMeters } from './pipeline/geo'

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../db/seed/data')
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/,\s*(california|nevada)\b.*$/, '')
    .replace(/\s+/g, ' ')
    .trim()

async function analyze(slug: string) {
  const j = JSON.parse(readFileSync(join(DATA_DIR, `${slug}.json`), 'utf8')) as {
    polyline: LngLat[]
  }
  const poly = j.polyline
  const cum = cumulativeMeters(poly)
  const verts = poly.filter((_, i) => i % 8 === 0)
  const distToRoute = (lat: number, lng: number) => {
    let m = Infinity
    for (const v of verts) {
      const d = haversineMeters([lng, lat], v)
      if (d < m) m = d
    }
    return m
  }

  // Current pipeline (Wikipedia geosearch), filtered to the real 700m stop corridor.
  const wiki = await discoverWikipediaPois(
    sampleAlong(poly, cum, GEOSEARCH_STEP_M).map((s) => ({ point: s.point })),
  )
  const wikiStory = wiki.filter(
    (p) => distToRoute(p.lat, p.lng) <= OFF_ROUTE_MAX_M && p.extract.length >= STORY_MIN_FACT_CHARS,
  )
  const wikiStoryNames = new Set(wikiStory.map((p) => norm(p.title)))

  // The spine.
  const cands = await discoverWikidataPois(poly)
  const byTier = (t: string) => cands.filter((c) => c.tier === t)
  const spineStoryNames = new Set(byTier('story').map((c) => norm(c.article?.title ?? c.name)))

  console.log(`\n${'='.repeat(78)}\n${slug}`)
  console.log(
    `  Wikipedia story candidates (≤${OFF_ROUTE_MAX_M}m, ≥${STORY_MIN_FACT_CHARS}ch): ${wikiStory.length}`,
  )
  console.log(
    `  Wikidata spine tiers: story ${byTier('story').length} | scenic ${byTier('scenic').length} | break ${byTier('break').length} | drop ${byTier('drop').length}`,
  )

  const overlap = [...wikiStoryNames].filter((n) => spineStoryNames.has(n))
  const wikiOnly = [...wikiStoryNames].filter((n) => !spineStoryNames.has(n))
  console.log(`\n  STORY overlap with current pipeline: ${overlap.length}/${wikiStoryNames.size}`)
  console.log(
    `  Wikipedia story stops the spine MISSES (verify each is noise, not a marquee loss):`,
  )
  for (const n of wikiOnly.sort()) console.log(`      - ${n}`)

  console.log(`\n  Spine STORY tier:`)
  for (const c of byTier('story').sort((a, b) => a.name.localeCompare(b.name)))
    console.log(`      ${c.name}  (${c.article?.extract.length ?? 0}ch, ${c.offRouteM}m)`)

  console.log(`\n  NEW SCENIC layer (typed place, no Wikipedia prose):`)
  for (const c of byTier('scenic').sort((a, b) => a.name.localeCompare(b.name)))
    console.log(`      ${c.name.padEnd(42)} ${c.types.slice(0, 2).join(', ')}  (${c.offRouteM}m)`)
}

async function main() {
  const slugs = process.argv.slice(2)
  if (slugs.length === 0) throw new Error('Usage: wikidata-spine-diff.ts <slug> [<slug2> ...]')
  for (const slug of slugs) await analyze(slug)
}

await main()
