// Re-synthesize ONE roam clip from its STORED script — for fixing a malformed audio
// file (e.g. TTS returned duplicated audio) without changing the narration or the
// poi's facts. Writes to the same R2 key (overwrites in place) and updates the roam
// track's audioDurationMs. A roam clip is the poi's segment(tour_id null) + its story track.
//
// SOP (docs/guides/ops-scripts-sop.md): PREVIEWS by default; writes only on --apply.
// Blast radius: SPENDS $ (one TTS synth) + MUTATES DB (updates audioDurationMs).
//
//   dotenvx run -f .env.development -- bun packages/generator/src/resynth-roam-clip.ts <poiId>
//   dotenvx run -f .env.development -- bun packages/generator/src/resynth-roam-clip.ts <poiId> --apply

import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@skipper/db'
import { pois, segments, tracks } from '@skipper/db/schema'
import { announce, assertReady, parseFlags } from './pipeline/ops'
import { personaFromKey } from './persona'
import { synthesizeWithTailRetake } from './pipeline/tts'
import { uploadAudio } from './pipeline/storage'

const flags = parseFlags(process.argv.slice(2))
const poiId = flags.positionals[0]
const apply = flags.has('apply')

if (!poiId) {
  console.error('Usage: resynth-roam-clip.ts <poiId> [--apply]')
  process.exit(1)
}

announce({ tool: 'resynth-roam-clip', blast: ['SPENDS $', 'MUTATES DB'], apply })
if (apply) assertReady(['tts', 'r2'])

const [row] = await db
  .select({
    trackId: tracks.id,
    audioUrl: tracks.audioUrl,
    audioDurationMs: tracks.audioDurationMs,
    script: tracks.script,
    poiName: pois.name,
    poiLat: pois.lat,
    poiLng: pois.lng,
  })
  .from(segments)
  .innerJoin(
    tracks,
    and(eq(tracks.segmentId, segments.id), eq(tracks.form, 'story'), eq(tracks.variant, 0)),
  )
  .innerJoin(pois, eq(segments.poiId, pois.id))
  .where(and(eq(segments.poiId, poiId), isNull(segments.tourId)))

if (!row) {
  console.error(`No roam clip found for poiId ${poiId}`)
  process.exit(1)
}

const words = row.script?.split(/\s+/).length ?? 0
const wpm = words / (row.audioDurationMs! / 1000 / 60)
console.log(`\n"${row.poiName}"`)
console.log(`  Current: ${row.audioDurationMs}ms (${(row.audioDurationMs!/1000).toFixed(1)}s), ${words} words, ${wpm.toFixed(0)} wpm`)
console.log(`  R2 key:  ${row.audioUrl}`)
console.log(`  Script:  ${row.script?.slice(0, 120)}...`)

if (!apply) {
  console.log('\nDRY RUN — nothing synthesized or written. Re-run with --apply to replace the clip.')
  process.exit(0)
}

const persona = personaFromKey('skipper')
console.log('\nSynthesizing...')
const { audio, durationMs, tail } = await synthesizeWithTailRetake(
  row.script!,
  persona.voice,
  persona.ttsStyle,
  `"${row.poiName}"`,
)

console.log(`  New clip: ${durationMs}ms (${(durationMs/1000).toFixed(1)}s), ${words} words, ${(words/(durationMs/1000/60)).toFixed(0)} wpm`)
if (tail) {
  if (tail.shippedCollapsed) {
    console.warn(`  ⚠ tail still collapsed — flag for ear review.`)
  } else if (tail.retook) {
    console.log(`  Retake used (tail clean).`)
  }
}

// Overwrite the same R2 key so the DB audioUrl never changes.
await uploadAudio(row.audioUrl!, audio)
await db
  .update(tracks)
  .set({ audioDurationMs: durationMs, updatedAt: new Date() })
  .where(eq(tracks.id, row.trackId))

console.log(`\nDone: replaced clip for "${row.poiName}" (${(row.audioDurationMs!/1000).toFixed(1)}s → ${(durationMs/1000).toFixed(1)}s).`)
