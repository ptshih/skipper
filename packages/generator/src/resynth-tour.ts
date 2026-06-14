// Re-synthesize ALL of a tour's clips (stop tracks + intro/outro frames) from their STORED
// scripts with the current TTS model + encoding (models.ts), then repoint
// tracks.audioUrl / tour_frames.audioUrl + audioDurationMs. For a voice/model/codec
// migration where the narration is already blessed — this is a delivery re-render, NOT a
// re-generation: scripts (and thus grounding) are untouched.
//
// A re-synth writes each clip at its row's EXISTING key (a track's clips/<tourId>/<trackId>;
// a frame's stored audioUrl — frame keys are per-RUN now), so it overwrites the same object
// in place — the only time a track key moves is an extension change (e.g. wav→mp3), and then
// we sweep the orphan unless --keep-old. The tour stays `ready` (every clip keeps a non-null
// audioUrl + duration).
//
//   dotenvx run -f .env.development -- bun packages/generator/src/resynth-tour.ts <tourId|prefix> [--apply] [--keep-old]
//
// Blast radius: SPENDS $ (re-synth EVERY clip) + MUTATES DB (repoints audioUrl/duration) +
// DELETES BYTES (sweeps a moved key unless --keep-old). DEFAULT DRY RUN — pass --apply to
// run. An --apply run needs Google Cloud TTS (GOOGLE_CLOUD_PROJECT + ADC) and R2_*. See
// docs/guides/ops-scripts-sop.md.

import { and, asc, eq } from 'drizzle-orm'
import { db } from '@skipper/db'
import { pois, segments, tourFrames, tours, tracks } from '@skipper/db/schema'
import { TTS_CLIP_EXTENSION, TTS_MODEL } from './models'
import { announce, assertReady, parseFlags, resolveTourId } from './pipeline/ops'
import { personaFromKey } from './persona'
import { synthesizeWithTailRetake } from './pipeline/tts'
import { estimateTtsUsd } from './pipeline/spend'
import { clipKey, deleteAudio, uploadAudio } from './pipeline/storage'
import { beginJob, finishJob } from './pipeline/job-progress'

/** A clip to re-render — a stop track or a frame — normalized to its label/key/script/save. */
interface Clip {
  label: string
  key: string
  script: string
  storedAudioUrl: string | null
  audioDurationMs: number | null
  save: (audioUrl: string, durationMs: number) => Promise<void>
}

async function main() {
  const flags = parseFlags(process.argv.slice(2), { valueFlags: ['max-cost'] })
  const apply = flags.has('apply')
  const keepOld = flags.has('keep-old')
  const maxCostUsd = (() => {
    const v = Number(flags.value('max-cost'))
    return Number.isFinite(v) && v > 0 ? v : Infinity // unset/invalid → no cap
  })()
  announce({ tool: 'resynth-tour', blast: ['SPENDS $', 'MUTATES DB', 'DELETES BYTES'], apply })
  const tourId = await resolveTourId(flags.positionals[0])
  await beginJob('resynth', { dryRun: !apply, tourId, targetId: tourId })

  // The persona (voice + delivery style) is resolved from the tour's persona key.
  const tourRow = (
    await db.select({ personaKey: tours.personaKey }).from(tours).where(eq(tours.id, tourId)).limit(1)
  )[0]
  const persona = personaFromKey(tourRow?.personaKey ?? 'skipper')

  // A tour stop = a segment + its variant-0 track; re-render the TRACK clip (its script + key).
  const stopRows = await db
    .select({
      trackId: tracks.id,
      seq: segments.seq,
      form: tracks.form,
      name: pois.name,
      script: tracks.script,
      audioUrl: tracks.audioUrl,
      audioDurationMs: tracks.audioDurationMs,
    })
    .from(segments)
    .innerJoin(tracks, and(eq(tracks.segmentId, segments.id), eq(tracks.variant, 0)))
    .innerJoin(pois, eq(segments.poiId, pois.id))
    .where(eq(segments.tourId, tourId))
    .orderBy(asc(segments.seq))

  const frameRows = await db
    .select({
      kind: tourFrames.kind,
      script: tourFrames.script,
      audioUrl: tourFrames.audioUrl,
      audioDurationMs: tourFrames.audioDurationMs,
    })
    .from(tourFrames)
    .where(eq(tourFrames.tourId, tourId))
    .orderBy(asc(tourFrames.kind))

  const clips: Clip[] = [
    ...frameRows
      .filter((b) => b.script !== null && b.audioUrl !== null)
      .map((b) => ({
        label: `${b.kind} frame`,
        // Re-synth IN PLACE at the row's stored key — frame keys are per-run now
        // (bracketKey), so recomputing one here would strand the row's pointer. A future
        // FORMAT migration (extension change) should mint new keys + update rows + sweep.
        key: b.audioUrl!,
        script: b.script!,
        storedAudioUrl: b.audioUrl,
        audioDurationMs: b.audioDurationMs,
        save: (audioUrl: string, durationMs: number) =>
          db
            .update(tourFrames)
            .set({ audioUrl, audioDurationMs: durationMs, updatedAt: new Date() })
            .where(and(eq(tourFrames.tourId, tourId), eq(tourFrames.kind, b.kind)))
            .then(() => {}),
      })),
    ...stopRows
      .filter((s) => s.script !== null)
      .map((s) => ({
        label: `#${s.seq} ${s.form.padEnd(6)} ${s.name}`,
        key: clipKey(tourId, s.trackId),
        script: s.script!,
        storedAudioUrl: s.audioUrl,
        audioDurationMs: s.audioDurationMs,
        save: (audioUrl: string, durationMs: number) =>
          db
            .update(tracks)
            .set({ audioUrl, audioDurationMs: durationMs, updatedAt: new Date() })
            .where(eq(tracks.id, s.trackId))
            .then(() => {}),
      })),
  ]

  console.log(`Tour ${tourId.slice(0, 8)} — ${clips.length} clips → model=${TTS_MODEL}, ext=.${TTS_CLIP_EXTENSION}`)
  if (!apply) {
    for (const c of clips) {
      const change = c.storedAudioUrl === c.key ? '(same key)' : `${c.storedAudioUrl ?? 'null'} → ${c.key}`
      console.log(`  ${c.label} — ${(c.audioDurationMs ?? 0) / 1000}s  ${change}`)
    }
    console.log('\nPreview only — pass --apply to synthesize + write (+ sweep moved keys).')
    return
  }

  assertReady(['tts', 'r2'])

  // Cost ceiling: abort before synthesizing if the estimated TTS exceeds --max-cost.
  const estSpendUsd = estimateTtsUsd(
    clips.map((c) => c.script),
    persona.ttsStyle.length,
  ).usd
  if (estSpendUsd > maxCostUsd) {
    console.error(
      `⛔ Estimated TTS ~$${estSpendUsd.toFixed(2)} exceeds --max-cost=$${maxCostUsd.toFixed(2)} — aborting before any synth. Raise --max-cost to proceed.`,
    )
    return
  }

  let swept = 0
  let totalSec = 0
  for (const c of clips) {
    const { audio, durationMs } = await synthesizeWithTailRetake(
      c.script,
      persona.voice,
      persona.ttsStyle,
      c.key,
    )
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

main()
  .then(() => finishJob({ ok: true }))
  .catch(async (e) => {
    await finishJob({ ok: false, error: e instanceof Error ? e.message : String(e) })
    console.error('\nResynth failed:', e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
