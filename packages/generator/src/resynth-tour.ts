// Re-synthesize ALL of a tour's clips (stops + intro/outro brackets) from their STORED
// scripts with the current TTS model + encoding (models.ts), then repoint
// tour_stops.audioUrl / tour_brackets.audioUrl + audioDurationMs. For a voice/model/codec
// migration where the narration is already blessed — this is a delivery re-render, NOT a
// re-generation: scripts (and thus grounding) are untouched.
//
// A re-synth writes each clip at its row's EXISTING key (a stop's clips/<tourId>/<stopId>;
// a bracket's stored audioUrl — bracket keys are per-RUN now), so it overwrites the same
// object in place — the only time a stop key moves is an extension change (e.g. wav→mp3),
// and then we sweep the orphan unless --keep-old. The tour stays `ready` (every clip keeps
// a non-null audioUrl + duration).
//
//   dotenvx run -f .env.development -- bun packages/generator/src/resynth-tour.ts <tourId|prefix> [--dry-run] [--keep-old]
//
// Needs Google Cloud TTS (GOOGLE_CLOUD_PROJECT + ADC) and R2_* — same as a full run.

import { and, asc, eq } from 'drizzle-orm'
import { db } from '@skipper/db'
import { pois, regions, tourBrackets, tourStops, tours } from '@skipper/db/schema'
import { GOOGLE_TTS_READY, R2_READY } from './config'
import { TTS_CLIP_EXTENSION, TTS_MODEL } from './models'
import { personaForRegion } from './persona'
import { synthesize } from './pipeline/tts'
import { clipKey, deleteAudio, uploadAudio } from './pipeline/storage'

async function resolveTourId(arg: string | undefined): Promise<string> {
  if (!arg) {
    throw new Error('Pass an explicit <tourId> (or a unique id prefix) to re-synth.')
  }
  // Exact id, or a unique prefix (convenience for the short 8-char ids we log).
  const all = await db.select({ id: tours.id }).from(tours)
  const matches = all.filter((t) => t.id === arg || t.id.startsWith(arg))
  if (matches.length === 0) throw new Error(`No tour matches "${arg}".`)
  if (matches.length > 1) throw new Error(`"${arg}" matches ${matches.length} tours — use the full id.`)
  return matches[0]!.id
}

/** A clip to re-render — a stop or a bracket — normalized to its label/key/script/save. */
interface Clip {
  label: string
  key: string
  script: string
  storedAudioUrl: string | null
  audioDurationMs: number | null
  save: (audioUrl: string, durationMs: number) => Promise<void>
}

async function main() {
  const argv = process.argv.slice(2)
  const dryRun = argv.includes('--dry-run')
  const keepOld = argv.includes('--keep-old')
  const target = argv.find((a) => !a.startsWith('--'))
  const tourId = await resolveTourId(target)

  // The persona (voice + delivery style) is resolved from the tour's region.
  const regionRow = (
    await db
      .select({ slug: regions.slug })
      .from(tours)
      .innerJoin(regions, eq(tours.regionId, regions.id))
      .where(eq(tours.id, tourId))
      .limit(1)
  )[0]
  const persona = personaForRegion(regionRow?.slug ?? '')

  const stopRows = await db
    .select({
      id: tourStops.id,
      seq: tourStops.seq,
      stopType: tourStops.stopType,
      name: pois.name,
      script: tourStops.script,
      audioUrl: tourStops.audioUrl,
      audioDurationMs: tourStops.audioDurationMs,
    })
    .from(tourStops)
    .innerJoin(pois, eq(tourStops.poiId, pois.id))
    .where(eq(tourStops.tourId, tourId))
    .orderBy(asc(tourStops.seq))

  const bracketRows = await db
    .select({
      kind: tourBrackets.kind,
      script: tourBrackets.script,
      audioUrl: tourBrackets.audioUrl,
      audioDurationMs: tourBrackets.audioDurationMs,
    })
    .from(tourBrackets)
    .where(eq(tourBrackets.tourId, tourId))
    .orderBy(asc(tourBrackets.kind))

  const clips: Clip[] = [
    ...bracketRows
      .filter((b) => b.script !== null && b.audioUrl !== null)
      .map((b) => ({
        label: `${b.kind} bracket`,
        // Re-synth IN PLACE at the row's stored key — bracket keys are per-run now
        // (bracketKey), so recomputing one here would strand the row's pointer. A future
        // FORMAT migration (extension change) should mint new keys + update rows + sweep.
        key: b.audioUrl!,
        script: b.script!,
        storedAudioUrl: b.audioUrl,
        audioDurationMs: b.audioDurationMs,
        save: (audioUrl: string, durationMs: number) =>
          db
            .update(tourBrackets)
            .set({ audioUrl, audioDurationMs: durationMs, updatedAt: new Date() })
            .where(and(eq(tourBrackets.tourId, tourId), eq(tourBrackets.kind, b.kind)))
            .then(() => {}),
      })),
    ...stopRows
      .filter((s) => s.script !== null)
      .map((s) => ({
        label: `#${s.seq} ${s.stopType.padEnd(6)} ${s.name}`,
        key: clipKey(tourId, s.id),
        script: s.script!,
        storedAudioUrl: s.audioUrl,
        audioDurationMs: s.audioDurationMs,
        save: (audioUrl: string, durationMs: number) =>
          db
            .update(tourStops)
            .set({ audioUrl, audioDurationMs: durationMs, updatedAt: new Date() })
            .where(eq(tourStops.id, s.id))
            .then(() => {}),
      })),
  ]

  console.log(`Tour ${tourId.slice(0, 8)} — ${clips.length} clips → model=${TTS_MODEL}, ext=.${TTS_CLIP_EXTENSION}`)
  if (dryRun) {
    for (const c of clips) {
      const change = c.storedAudioUrl === c.key ? '(same key)' : `${c.storedAudioUrl ?? 'null'} → ${c.key}`
      console.log(`  ${c.label} — ${(c.audioDurationMs ?? 0) / 1000}s  ${change}`)
    }
    console.log('\nDRY RUN — no synthesis, upload, DB write, or sweep.')
    return
  }

  if (!GOOGLE_TTS_READY()) throw new Error('Google Cloud TTS not configured (GOOGLE_CLOUD_PROJECT + ADC).')
  if (!R2_READY()) throw new Error('R2_* env is not set.')

  let swept = 0
  let totalSec = 0
  for (const c of clips) {
    const { audio, durationMs } = await synthesize(c.script, persona.voice, persona.ttsStyle)
    await uploadAudio(c.key, audio)
    await c.save(c.key, durationMs)
    // Sweep the orphan only when the key actually moved (e.g. the wav→mp3 extension change).
    let sweptNote = ''
    if (c.storedAudioUrl && c.storedAudioUrl !== c.key && !keepOld) {
      try {
        await deleteAudio(c.storedAudioUrl)
        swept++
        sweptNote = `  (swept ${c.storedAudioUrl})`
      } catch (e) {
        sweptNote = `  (orphan ${c.storedAudioUrl} NOT swept: ${e instanceof Error ? e.message : e})`
      }
    }
    totalSec += durationMs / 1000
    const was = (c.audioDurationMs ?? 0) / 1000
    console.log(`  ${c.label} — ${was}s → ${(durationMs / 1000).toFixed(1)}s${sweptNote}`)
  }
  console.log(
    `\nDone. Re-synthesized ${clips.length} clips (${totalSec.toFixed(0)}s total) on ${TTS_MODEL}` +
      `, ${swept} orphan(s) swept.`,
  )
}

main().catch((e) => {
  console.error('\nResynth failed:', e instanceof Error ? e.message : e)
  process.exitCode = 1
})
