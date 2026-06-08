// Re-synthesize ALL of a tour's clips from their STORED scripts with the current TTS
// model + encoding (models.ts), then repoint poi_content.audioUrl + audioDurationMs.
// For a voice/model/codec migration where the narration is already blessed — this is a
// delivery re-render, NOT a re-generation: scripts (and thus grounding) are untouched.
//
// When the clip extension changes (e.g. wav→mp3), clipKey() returns a NEW key, so the
// old object is orphaned — we sweep it unless --keep-old. The poi_content cache key
// (poi, persona, voice, joke_level) is unchanged, so rows are updated in place and the
// tour stays `ready` (every clip keeps a non-null audioUrl + duration).
//
//   dotenvx run -f .env.development -- bun packages/generator/src/resynth-tour.ts --preview [--dry-run] [--keep-old]
//   dotenvx run -f .env.development -- bun packages/generator/src/resynth-tour.ts <tourId|prefix> [--dry-run]
//
// Needs Google Cloud TTS (GOOGLE_CLOUD_PROJECT + ADC) and R2_* — same as a full run.

import { and, asc, eq } from 'drizzle-orm'
import { db } from '@skipper/db'
import { poiContent, pois, tours, tourStops } from '@skipper/db/schema'
import type { JokeLevel, Persona } from '@skipper/shared'
import { GOOGLE_TTS_READY, R2_READY } from './config'
import { TTS_CLIP_EXTENSION, TTS_MODEL } from './models'
import { synthesize } from './pipeline/tts'
import { clipKey, deleteAudio, uploadAudio } from './pipeline/storage'

async function resolveTourId(arg: string | undefined): Promise<string> {
  if (arg === '--preview' || arg === undefined) {
    const row = (
      await db
        .select({ id: tours.id })
        .from(tours)
        .where(and(eq(tours.isPreview, true), eq(tours.status, 'ready')))
        .limit(1)
    )[0]
    if (!row) throw new Error('No ready isPreview tour found. Pass an explicit <tourId> instead.')
    return row.id
  }
  // Exact id, or a unique prefix (convenience for the short 8-char ids we log).
  const all = await db.select({ id: tours.id }).from(tours)
  const matches = all.filter((t) => t.id === arg || t.id.startsWith(arg))
  if (matches.length === 0) throw new Error(`No tour matches "${arg}".`)
  if (matches.length > 1) throw new Error(`"${arg}" matches ${matches.length} tours — use the full id.`)
  return matches[0]!.id
}

async function main() {
  const argv = process.argv.slice(2)
  const dryRun = argv.includes('--dry-run')
  const keepOld = argv.includes('--keep-old')
  const target = argv.find((a) => !a.startsWith('--'))
  const tourId = await resolveTourId(target ?? '--preview')

  // Distinct clips for this tour, in play order (dedup poi_content shared across stops).
  const stops = await db
    .select({
      seq: tourStops.seq,
      stopType: tourStops.stopType,
      name: pois.name,
      contentId: poiContent.id,
      poiId: poiContent.poiId,
      persona: poiContent.persona,
      voice: poiContent.voice,
      jokeLevel: poiContent.jokeLevel,
      script: poiContent.script,
      audioUrl: poiContent.audioUrl,
      audioDurationMs: poiContent.audioDurationMs,
    })
    .from(tourStops)
    .innerJoin(poiContent, eq(tourStops.poiContentId, poiContent.id))
    .innerJoin(pois, eq(tourStops.poiId, pois.id))
    .where(eq(tourStops.tourId, tourId))
    .orderBy(asc(tourStops.seq))

  const seen = new Set<string>()
  const clips = stops.filter((s) => (seen.has(s.contentId) ? false : (seen.add(s.contentId), true)))

  console.log(`Tour ${tourId.slice(0, 8)} — ${clips.length} clips → model=${TTS_MODEL}, ext=.${TTS_CLIP_EXTENSION}`)
  if (dryRun) {
    for (const c of clips) {
      const newKey = clipKey(c.poiId, c.persona as Persona, c.voice, c.jokeLevel as JokeLevel)
      const change = c.audioUrl === newKey ? '(same key)' : `${c.audioUrl ?? 'null'} → ${newKey}`
      console.log(`  #${c.seq} ${c.stopType.padEnd(6)} ${c.name} — ${(c.audioDurationMs ?? 0) / 1000}s  ${change}`)
    }
    console.log('\nDRY RUN — no synthesis, upload, DB write, or sweep.')
    return
  }

  if (!GOOGLE_TTS_READY()) throw new Error('Google Cloud TTS not configured (GOOGLE_CLOUD_PROJECT + ADC).')
  if (!R2_READY()) throw new Error('R2_* env is not set.')

  let swept = 0
  let totalSec = 0
  for (const c of clips) {
    const { audio, durationMs } = await synthesize(c.script, c.voice)
    const newKey = clipKey(c.poiId, c.persona as Persona, c.voice, c.jokeLevel as JokeLevel)
    await uploadAudio(newKey, audio)
    await db
      .update(poiContent)
      .set({ audioUrl: newKey, audioDurationMs: durationMs, updatedAt: new Date() })
      .where(eq(poiContent.id, c.contentId))
    // Sweep the orphan only when the key actually moved (e.g. the wav→mp3 extension change).
    const oldKey = c.audioUrl
    let sweptNote = ''
    if (oldKey && oldKey !== newKey && !keepOld) {
      try {
        await deleteAudio(oldKey)
        swept++
        sweptNote = `  (swept ${oldKey})`
      } catch (e) {
        sweptNote = `  (orphan ${oldKey} NOT swept: ${e instanceof Error ? e.message : e})`
      }
    }
    totalSec += durationMs / 1000
    const was = (c.audioDurationMs ?? 0) / 1000
    console.log(`  #${c.seq} ${c.stopType.padEnd(6)} ${c.name} — ${was}s → ${(durationMs / 1000).toFixed(1)}s${sweptNote}`)
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
