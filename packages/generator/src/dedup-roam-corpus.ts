// dedup-roam-corpus — find and clean up same-place duplicate roam clips.
//
// Multiple sweep runs (or slightly different Wikidata QID→pageId mappings) can produce
// several `pois` rows for the same physical place, each getting its own roam clip (the poi's
// 1:1 `narrations` row). The `(source, source_id)` DB unique key prevents re-inserting the SAME
// article, but two DIFFERENT Wikipedia articles covering the same place (different pageIds)
// create two rows — both get narrations, both fire on drives.
//
// This script groups clips by normName(poi.name), reports the duplicates, and on --apply
// keeps the RICHEST row (longest facts.extract) and deletes the orphaned clips from both
// DB (the poi's `narrations` row) and R2.
//
// SOP (docs/guides/ops-scripts-sop.md): PREVIEWS by default; writes only on --apply.
// Blast radius: DELETES R2 objects + narration rows. Reads the DB.
//
//   dotenvx run -f .env.development -- bun packages/generator/src/dedup-roam-corpus.ts
//   dotenvx run -f .env.development -- bun packages/generator/src/dedup-roam-corpus.ts --apply

import { eq } from 'drizzle-orm'
import { db } from '@skipper/db'
import { narrations, pois } from '@skipper/db/schema'
import { normName } from './pipeline/wikidata-discovery'
import { deleteAudio } from './pipeline/storage'
import { announce, assertReady, parseFlags } from './pipeline/ops'

const flags = parseFlags(process.argv.slice(2))
const apply = flags.has('apply')

announce({ tool: 'dedup-roam-corpus', blast: ['DELETES BYTES', 'MUTATES DB'], apply })
if (apply) assertReady(['r2'])

// Load all pois that have a roam clip (the poi's 1:1 narration row).
const rows = await db
  .select({
    poiId: pois.id,
    name: pois.name,
    source: pois.source,
    sourceId: pois.sourceId,
    lat: pois.lat,
    lng: pois.lng,
    facts: pois.facts,
    narrationId: narrations.id,
    clipUrl: narrations.audioUrl,
    clipDurationMs: narrations.audioDurationMs,
  })
  .from(narrations)
  .innerJoin(pois, eq(narrations.poiId, pois.id))

console.log(`Loaded ${rows.length} roam clip(s).`)

// Group by normalised name.
const byNorm = new Map<string, typeof rows>()
for (const r of rows) {
  const k = normName(r.name)
  ;(byNorm.get(k) ?? byNorm.set(k, []).get(k)!).push(r)
}

const dupeGroups = [...byNorm.values()].filter((g) => g.length > 1)
if (dupeGroups.length === 0) {
  console.log('\nNo duplicate-named clips found. Corpus is clean.')
  process.exit(0)
}

console.log(`\nFound ${dupeGroups.length} duplicate name group(s):\n`)

const toDelete: { narrationId: string; clipUrl: string | null; poiId: string; name: string }[] = []

for (const group of dupeGroups) {
  // Sort: richest extract first (longest string); fall back to longest clip if no extract.
  group.sort((a, b) => {
    const aLen = a.facts?.extract.length ?? 0
    const bLen = b.facts?.extract.length ?? 0
    if (bLen !== aLen) return bLen - aLen
    return (b.clipDurationMs ?? 0) - (a.clipDurationMs ?? 0)
  })

  const [keep, ...drop] = group
  const keepExtractLen = keep!.facts?.extract.length ?? 0

  console.log(`  "${keep!.name}" (norm: "${normName(keep!.name)}")`)
  console.log(
    `  KEEP  poiId=${keep!.poiId.slice(0, 8)} source=${keep!.source}:${keep!.sourceId} ` +
      `extract=${keepExtractLen}ch  clip=${(keep!.clipDurationMs ?? 0) / 1000}s`,
  )
  for (const d of drop) {
    const dropExtractLen = d.facts?.extract.length ?? 0
    console.log(
      `  DROP  poiId=${d.poiId.slice(0, 8)} source=${d.source}:${d.sourceId} ` +
        `extract=${dropExtractLen}ch  clip=${(d.clipDurationMs ?? 0) / 1000}s  r2=${d.clipUrl}`,
    )
    toDelete.push({ narrationId: d.narrationId, clipUrl: d.clipUrl, poiId: d.poiId, name: d.name })
  }
  console.log()
}

console.log(`${toDelete.length} clip(s) to remove (${dupeGroups.length} duplicate group(s)).`)

if (!apply) {
  console.log('\nDRY RUN — nothing deleted. Re-run with --apply to remove duplicates.')
  process.exit(0)
}

let deleted = 0
for (const { narrationId, clipUrl, name } of toDelete) {
  process.stdout.write(`  deleting clip "${name}" (${clipUrl})... `)
  if (clipUrl) {
    try {
      await deleteAudio(clipUrl)
      process.stdout.write('R2 ✓  ')
    } catch (e) {
      process.stdout.write(`R2 WARN(${(e as Error).message})  `)
    }
  } else {
    process.stdout.write('R2 (no clip)  ')
  }
  // Delete the poi's roam narration row.
  await db.delete(narrations).where(eq(narrations.id, narrationId))
  process.stdout.write('DB ✓\n')
  deleted++
}

console.log(`\nDone: removed ${deleted} duplicate roam clip(s).`)
