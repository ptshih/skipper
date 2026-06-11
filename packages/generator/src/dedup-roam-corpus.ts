// dedup-roam-corpus — find and clean up same-place duplicate roam clips.
//
// Multiple sweep runs (or slightly different Wikidata QID→pageId mappings) can produce
// several `pois` rows for the same physical place, each getting its own `roam_clip`.
// The `(source, source_id)` DB unique key prevents re-inserting the SAME article, but
// two DIFFERENT Wikipedia articles covering the same place (different pageIds) create
// two rows — both get clips, both fire on drives.
//
// This script groups clips by normName(poi.name), reports the duplicates, and on --apply
// keeps the RICHEST row (longest facts.extract) and deletes the orphaned clips from both
// DB and R2.
//
// SOP (docs/guides/ops-scripts-sop.md): PREVIEWS by default; writes only on --apply.
// Blast radius: DELETES R2 objects + roam_clips rows. Reads the DB.
//
//   dotenvx run -f .env.development -- bun packages/generator/src/dedup-roam-corpus.ts
//   dotenvx run -f .env.development -- bun packages/generator/src/dedup-roam-corpus.ts --apply

import { eq } from 'drizzle-orm'
import { db } from '@skipper/db'
import { pois, roamClips } from '@skipper/db/schema'
import { normName } from './pipeline/wikidata-discovery'
import { deleteAudio } from './pipeline/storage'
import { announce, assertReady, parseFlags } from './pipeline/ops'

const flags = parseFlags(process.argv.slice(2))
const apply = flags.has('apply')

announce({ tool: 'dedup-roam-corpus', blast: ['DELETES BYTES', 'MUTATES DB'], apply })
if (apply) assertReady(['r2'])

// Load all pois that have at least one roam_clip.
const rows = await db
  .select({
    poiId: pois.id,
    name: pois.name,
    source: pois.source,
    sourceId: pois.sourceId,
    lat: pois.lat,
    lng: pois.lng,
    extract: pois.facts,
    clipId: roamClips.id,
    clipUrl: roamClips.audioUrl,
    clipDurationMs: roamClips.audioDurationMs,
  })
  .from(roamClips)
  .innerJoin(pois, eq(roamClips.poiId, pois.id))

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

const toDelete: { clipId: string; clipUrl: string; poiId: string; name: string }[] = []

for (const group of dupeGroups) {
  // Sort: richest extract first (longest string); fall back to longest clip if no extract.
  group.sort((a, b) => {
    const aLen = typeof (a.extract as { extract?: string } | null)?.extract === 'string'
      ? (a.extract as { extract: string }).extract.length
      : 0
    const bLen = typeof (b.extract as { extract?: string } | null)?.extract === 'string'
      ? (b.extract as { extract: string }).extract.length
      : 0
    if (bLen !== aLen) return bLen - aLen
    return (b.clipDurationMs ?? 0) - (a.clipDurationMs ?? 0)
  })

  const [keep, ...drop] = group
  const keepExtractLen =
    typeof (keep!.extract as { extract?: string } | null)?.extract === 'string'
      ? (keep!.extract as { extract: string }).extract.length
      : 0

  console.log(`  "${keep!.name}" (norm: "${normName(keep!.name)}")`)
  console.log(
    `  KEEP  poiId=${keep!.poiId.slice(0, 8)} source=${keep!.source}:${keep!.sourceId} ` +
      `extract=${keepExtractLen}ch  clip=${(keep!.clipDurationMs ?? 0) / 1000}s`,
  )
  for (const d of drop) {
    const dropExtractLen =
      typeof (d.extract as { extract?: string } | null)?.extract === 'string'
        ? (d.extract as { extract: string }).extract.length
        : 0
    console.log(
      `  DROP  poiId=${d.poiId.slice(0, 8)} source=${d.source}:${d.sourceId} ` +
        `extract=${dropExtractLen}ch  clip=${(d.clipDurationMs ?? 0) / 1000}s  r2=${d.clipUrl}`,
    )
    toDelete.push({ clipId: d.clipId, clipUrl: d.clipUrl, poiId: d.poiId, name: d.name })
  }
  console.log()
}

console.log(`${toDelete.length} clip(s) to remove (${dupeGroups.length} duplicate group(s)).`)

if (!apply) {
  console.log('\nDRY RUN — nothing deleted. Re-run with --apply to remove duplicates.')
  process.exit(0)
}

let deleted = 0
for (const { clipId, clipUrl, name } of toDelete) {
  process.stdout.write(`  deleting clip "${name}" (${clipUrl})... `)
  try {
    await deleteAudio(clipUrl)
    process.stdout.write('R2 ✓  ')
  } catch (e) {
    process.stdout.write(`R2 WARN(${(e as Error).message})  `)
  }
  await db.delete(roamClips).where(eq(roamClips.id, clipId))
  process.stdout.write('DB ✓\n')
  deleted++
}

console.log(`\nDone: removed ${deleted} duplicate roam clip(s).`)
