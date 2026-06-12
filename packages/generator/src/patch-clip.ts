// Patch ONE clip's script and re-synthesize just that clip — for fixing a typo or a
// single bad word without paying to regenerate (and re-narrate) a whole tour. The
// narration is left otherwise untouched: this is a surgical text edit, not a re-run of
// the model, so a human-approved clip stays approved except for the fix.
//
// The target is a stop TRACK OR a tour_frame row (narration is tour-owned now; there
// is no poi_content). Patching writes to the row's EXISTING key (a track's
// clips/<tourId>/<trackId>; a frame's stored audioUrl — frame keys are per-RUN now),
// so re-uploading overwrites the SAME object and audioUrl never changes. The voice is
// the persona's fixed voice (models.ts). NB: a patched clip does NOT reach tours already
// DOWNLOADED offline (the device keeps its bytes until a re-download) — known gap.
//
//   dotenvx run -f .env.development -- bun packages/generator/src/patch-clip.ts \
//     <trackId|tourFrameId> --find "fiftehundred" --replace "fifteen hundred" [--all] [--apply]
//
// Blast radius: SPENDS $ (one TTS synth) + MUTATES DB (repoints the row's audioUrl in place).
// DEFAULT DRY RUN — pass --apply to synthesize + write. --find/--replace does a literal
// substring replacement in the stored script (the match must be present, and unique unless
// --all). An --apply run needs Google Cloud TTS (GOOGLE_CLOUD_PROJECT + ADC) and R2_*. See
// docs/guides/ops-scripts-sop.md.

import { eq } from 'drizzle-orm'
import { db } from '@skipper/db'
import { regions, segments, tourFrames, tours, tracks } from '@skipper/db/schema'
import { announce, assertReady, parseFlags } from './pipeline/ops'
import { personaForRegion } from './persona'
import { synthesizeWithTailRetake } from './pipeline/tts'
import { clipKey, uploadAudio } from './pipeline/storage'
import { beginJob, finishJob } from './pipeline/job-progress'

interface Args {
  id: string
  find: string
  replace: string
  all: boolean
  apply: boolean
  /** Re-voice the stored script unchanged (no text edit) — for a dud TTS take. */
  resynth: boolean
}

function parseArgs(argv: string[]): Args {
  // --find/--replace are value flags so the positional id isn't mistaken for one (and an id
  // that coincides with a find/replace string still resolves by position).
  const flags = parseFlags(argv, { valueFlags: ['find', 'replace'] })
  const id = flags.positionals[0]
  if (!id) {
    throw new Error(
      'Usage: patch-clip.ts <trackId|tourFrameId> (--find "<text>" --replace "<text>" [--all] | --resynth) [--apply]',
    )
  }
  // --resynth re-voices the stored script with no text change (no find/replace needed).
  if (flags.has('resynth')) {
    return { id, find: '', replace: '', all: false, apply: flags.has('apply'), resynth: true }
  }
  const find = flags.value('find')
  const replace = flags.value('replace')
  if (find === undefined || replace === undefined) {
    throw new Error(
      'Usage: patch-clip.ts <trackId|tourFrameId> --find "<text>" --replace "<text>" [--all] [--apply]  (or --resynth to re-voice unchanged)',
    )
  }
  // An empty --find would, with --all, interleave the replacement between every
  // character of the script (split('').join(x)) — garbage. Refuse it.
  if (find === '') throw new Error('--find must be a non-empty string (or pass --resynth to re-voice unchanged).')
  return { id, find, replace, all: flags.has('all'), apply: flags.has('apply'), resynth: false }
}

/** A clip to patch — either a stop track or a frame — normalized to its key + script. */
interface ClipTarget {
  label: string
  /** The owning tour — used to resolve the region's persona (voice + delivery style). */
  tourId: string
  key: string
  script: string
  storedAudioUrl: string | null
  /** Persist the edited script + new audio onto the underlying row. */
  save: (script: string, audioUrl: string, durationMs: number) => Promise<void>
}

/** Resolve the id to a stop TRACK first (via its segment), then a tour_frame. */
async function resolveTarget(id: string): Promise<ClipTarget | null> {
  const track = (
    await db
      .select({
        id: tracks.id,
        tourId: segments.tourId,
        seq: segments.seq,
        form: tracks.form,
        script: tracks.script,
        audioUrl: tracks.audioUrl,
      })
      .from(tracks)
      .innerJoin(segments, eq(tracks.segmentId, segments.id))
      .where(eq(tracks.id, id))
      .limit(1)
  )[0]
  if (track) {
    if (track.script === null) throw new Error(`Track ${id} has no script to patch.`)
    // Tour stops carry tourId (the clip lives at clips/<tourId>/<trackId>); a roam track is
    // placeless (tourId null) and patches in place at its stored key (roam/<poiId>/<trackId>).
    if (track.tourId === null) {
      if (track.audioUrl === null)
        throw new Error(`Roam track ${id} has no audio yet — generate it before patching.`)
      throw new Error(
        `Track ${id} is a roam encounter (no tour) — use resynth-roam-clip.ts to re-render it.`,
      )
    }
    const tourId = track.tourId
    return {
      label: `stop #${track.seq} (${track.form}) of tour ${tourId.slice(0, 8)}`,
      tourId,
      key: clipKey(tourId, track.id),
      script: track.script,
      storedAudioUrl: track.audioUrl,
      save: (script, audioUrl, durationMs) =>
        db
          .update(tracks)
          .set({ script, audioUrl, audioDurationMs: durationMs, updatedAt: new Date() })
          .where(eq(tracks.id, track.id))
          .then(() => {}),
    }
  }
  const frame = (
    await db
      .select({
        id: tourFrames.id,
        tourId: tourFrames.tourId,
        kind: tourFrames.kind,
        script: tourFrames.script,
        audioUrl: tourFrames.audioUrl,
      })
      .from(tourFrames)
      .where(eq(tourFrames.id, id))
      .limit(1)
  )[0]
  if (frame) {
    if (frame.script === null) throw new Error(`Frame ${id} has no script to patch.`)
    if (frame.audioUrl === null) {
      throw new Error(`Frame ${id} has no audio yet — generate the tour before patching.`)
    }
    return {
      label: `${frame.kind} frame of tour ${frame.tourId.slice(0, 8)}`,
      tourId: frame.tourId,
      // Patch IN PLACE at the row's stored key — frame keys are per-run now (bracketKey),
      // so minting a fresh key here would strand the row's pointer.
      key: frame.audioUrl,
      script: frame.script,
      storedAudioUrl: frame.audioUrl,
      save: (script, audioUrl, durationMs) =>
        db
          .update(tourFrames)
          .set({ script, audioUrl, audioDurationMs: durationMs, updatedAt: new Date() })
          .where(eq(tourFrames.id, frame.id))
          .then(() => {}),
    }
  }
  return null
}

async function main() {
  const { id, find, replace, all, apply, resynth } = parseArgs(process.argv.slice(2))
  announce({ tool: 'patch-clip', blast: ['SPENDS $', 'MUTATES DB'], apply })
  await beginJob('patch_clip', { dryRun: !apply, targetId: id })

  const target = await resolveTarget(id)
  if (!target) throw new Error(`No track or tour_frame row with id "${id}".`)

  // --resynth: re-voice the stored script verbatim. Otherwise apply the literal find/replace.
  let newScript = target.script
  if (resynth) {
    console.log(`Clip: ${target.label}`)
    console.log(`  re-voice (no text change)`)
  } else {
    const occurrences = target.script.split(find).length - 1
    if (occurrences === 0) throw new Error(`"${find}" not found in the clip's script.`)
    if (occurrences > 1 && !all) {
      throw new Error(`"${find}" appears ${occurrences} times — pass --all to replace every occurrence.`)
    }
    newScript = target.script.split(find).join(replace)
    console.log(`Clip: ${target.label}`)
    console.log(`  - ${target.script}`)
    console.log(`  + ${newScript}`)
    console.log(`  ${occurrences} replacement(s): "${find}" → "${replace}"`)
  }

  if (!apply) {
    console.log('\nPreview only — pass --apply to synthesize + write.')
    return
  }

  assertReady(['tts', 'r2'])

  // Resolve the persona (voice + delivery style) from the clip's tour's region.
  const regionRow = (
    await db
      .select({ slug: regions.slug })
      .from(tours)
      .innerJoin(regions, eq(tours.regionId, regions.id))
      .where(eq(tours.id, target.tourId))
      .limit(1)
  )[0]
  const persona = personaForRegion(regionRow?.slug ?? '')

  console.log('\nSynthesizing edited script...')
  const { audio, durationMs } = await synthesizeWithTailRetake(
    newScript,
    persona.voice,
    persona.ttsStyle,
    'edited clip',
  )

  // The clip key is tour-scoped (a stop track's clips/<tourId>/<trackId>; a frame's stored
  // key), so re-uploading overwrites the SAME object — audioUrl (the stored key) never changes.
  if (target.storedAudioUrl && target.storedAudioUrl !== target.key) {
    console.warn(
      `  note: stored audioUrl "${target.storedAudioUrl}" != computed key "${target.key}" — writing to the computed key.`,
    )
  }
  const audioUrl = await uploadAudio(target.key, audio)
  await target.save(newScript, audioUrl, durationMs)

  console.log(`Done. Re-synthesized ${(durationMs / 1000).toFixed(1)}s of audio → ${audioUrl}`)
}

main()
  .then(() => finishJob({ ok: true }))
  .catch(async (e) => {
    await finishJob({ ok: false, error: e instanceof Error ? e.message : String(e) })
    console.error('\nPatch failed:', e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
