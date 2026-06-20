// Re-synthesize ONE narration from its STORED script — for fixing a malformed audio
// file (e.g. TTS returned duplicated audio) without changing the narration or the
// poi's facts. Reads the poi's delivery register so the re-read matches the original.
// Writes a FRESH R2 key + repoints audio_url + duration in ONE write (the superseded
// object orphans for sweep-orphans — never an in-place overwrite that could serve new
// audio under the old duration on a crash). A narration is the poi's 1:1 `narrations` row.
//
// SOP (docs/guides/ops-scripts-sop.md): PREVIEWS by default; writes only on --apply.
// Blast radius: SPENDS $ (one TTS synth) + MUTATES DB (updates audioDurationMs).
//
//   dotenvx run -f .env.development -- bun packages/studio/src/resynth-narration.ts <poiId>
//   dotenvx run -f .env.development -- bun packages/studio/src/resynth-narration.ts <poiId> --apply

import { eq } from 'drizzle-orm'
import { db } from '@skipper/db'
import { narrations, pois } from '@skipper/db/schema'
import { announce, assertReady, parseFlags } from './pipeline/ops'
import { runJob } from './pipeline/job-progress'
import { personaFromKey } from './persona'
import { ttsStyleFor } from './models'
import { synthesizeWithTailRetake } from './pipeline/tts'
import { narrationClipKey, uploadAudio } from './pipeline/storage'
import { withRetry } from './pipeline/http'

const flags = parseFlags(process.argv.slice(2))
const poiId = flags.positionals[0]
const apply = flags.has('apply')

if (!poiId) {
  console.error('Usage: resynth-narration.ts <poiId> [--apply]')
  process.exit(1)
}

announce({ tool: 'resynth-narration', blast: ['SPENDS $', 'MUTATES DB'], apply })
if (apply) assertReady(['tts', 'r2'])

async function main(poiId: string): Promise<void> {
  const [row] = await db
    .select({
      narrationId: narrations.id,
      audioUrl: narrations.audioUrl,
      audioDurationMs: narrations.audioDurationMs,
      script: narrations.script,
      poiName: pois.name,
      poiLat: pois.lat,
      poiLng: pois.lng,
      register: pois.deliveryRegister,
    })
    .from(narrations)
    .innerJoin(pois, eq(narrations.poiId, pois.id))
    .where(eq(narrations.poiId, poiId))

  if (!row) {
    throw new Error(`No narration found for poiId ${poiId}`)
  }

  const words = row.script?.split(/\s+/).length ?? 0
  const wpm = words / (row.audioDurationMs! / 1000 / 60)
  console.log(`\n"${row.poiName}"`)
  console.log(`  Current: ${row.audioDurationMs}ms (${(row.audioDurationMs! / 1000).toFixed(1)}s), ${words} words, ${wpm.toFixed(0)} wpm`)
  console.log(`  R2 key:  ${row.audioUrl}`)
  console.log(`  Script:  ${row.script?.slice(0, 120)}...`)

  if (!apply) {
    console.log('\nDRY RUN — nothing synthesized or written. Re-run with --apply to replace the clip.')
    return
  }

  const persona = personaFromKey('skipper')
  console.log('\nSynthesizing...')
  const { audio, durationMs, tail } = await synthesizeWithTailRetake(
    row.script!,
    persona.voice,
    ttsStyleFor(persona.ttsStyle, row.register ?? 'story'),
    `"${row.poiName}"`,
  )

  console.log(`  New clip: ${durationMs}ms (${(durationMs / 1000).toFixed(1)}s), ${words} words, ${(words / (durationMs / 1000 / 60)).toFixed(0)} wpm`)
  if (tail) {
    if (tail.shippedCollapsed) {
      console.warn(`  ⚠ tail still collapsed — flag for ear review.`)
    } else if (tail.retook) {
      console.log(`  Retake used (tail clean).`)
    }
  }

  // Fresh key + atomic repoint: upload to a NEW key, then repoint audio_url + duration in one write
  // (the old object orphans for sweep-orphans). Avoids the in-place-overwrite window where a crash
  // between the PUT and the duration update would serve new audio under the stale duration.
  const audioUrl = await withRetry(() => uploadAudio(narrationClipKey(poiId, crypto.randomUUID()), audio), {
    label: `upload(${row.poiName})`,
  })
  await withRetry(
    () =>
      db
        .update(narrations)
        .set({ audioUrl, audioDurationMs: durationMs, updatedAt: new Date() })
        .where(eq(narrations.id, row.narrationId)),
    { label: `repoint narration(${row.poiName})` },
  )

  console.log(`\nDone: replaced clip for "${row.poiName}" (${(row.audioDurationMs! / 1000).toFixed(1)}s → ${(durationMs / 1000).toFixed(1)}s).`)
}

await runJob('resynth_narration', { dryRun: !apply, targetId: poiId }, () => main(poiId))
