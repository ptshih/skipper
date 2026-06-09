// Inspector for the Wikidata discovery spine (pipeline/wikidata-discovery.ts) — runs the
// real discovery on a frozen route and prints the tier breakdown + the story/scenic lists,
// no narration, no TTS, no DB writes. A fast way to eyeball what a route will surface
// (which named bays/beaches become scenic pins, which articles become story stops) without
// paying to generate. The selection/pacing that turns these into actual stops is the
// generator's job (run `... src/run.ts <slug> --dry-run` for that).
//
// Usage (frozen artifact read from packages/db/seed/data/<slug>.json):
//   dotenvx run -f .env.development -- bun packages/generator/src/wikidata-spine-diff.ts <slug> [<slug2> ...]

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LngLat } from './pipeline/geo'
import { discoverWikidataPois } from './pipeline/wikidata-discovery'

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../db/seed/data')

async function analyze(slug: string) {
  const j = JSON.parse(readFileSync(join(DATA_DIR, `${slug}.json`), 'utf8')) as { polyline: LngLat[] }
  const cands = await discoverWikidataPois(j.polyline)
  const byTier = (t: string) => cands.filter((c) => c.tier === t)

  console.log(`\n${'='.repeat(78)}\n${slug}`)
  console.log(
    `  tiers: story ${byTier('story').length} | scenic ${byTier('scenic').length} | ` +
      `break ${byTier('break').length} | drop ${byTier('drop').length}  (corridor entities: ${cands.length})`,
  )

  console.log(`\n  STORY (Wikipedia prose):`)
  for (const c of byTier('story').sort((a, b) => a.name.localeCompare(b.name)))
    console.log(`      ${c.name.padEnd(42)} ${c.article?.extract.length ?? 0}ch, ${c.offRouteM}m`)

  console.log(`\n  SCENIC (named Wikidata feature, no prose):`)
  for (const c of byTier('scenic').sort((a, b) => a.name.localeCompare(b.name)))
    console.log(`      ${c.name.padEnd(42)} ${c.types.slice(0, 2).join(', ')}  (${c.offRouteM}m)`)
}

async function main() {
  const slugs = process.argv.slice(2)
  if (slugs.length === 0) throw new Error('Usage: wikidata-spine-diff.ts <slug> [<slug2> ...]')
  for (const slug of slugs) await analyze(slug)
}

await main()
