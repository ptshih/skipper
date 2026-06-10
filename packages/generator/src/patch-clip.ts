// Patch ONE clip's script and re-synthesize just that clip — for fixing a typo or a
// single bad word without paying to regenerate (and re-narrate) a whole tour. The
// narration is left otherwise untouched: this is a surgical text edit, not a re-run of
// the model, so a human-approved clip stays approved except for the fix.
//
// The target is a tour_stop OR a tour_bracket row (narration is tour-owned now; there
// is no poi_content). Patching writes to the row's EXISTING key (a stop's
// clips/<tourId>/<stopId>; a bracket's stored audioUrl — bracket keys are per-RUN now),
// so re-uploading overwrites the SAME object and audioUrl never changes. The voice is
// the persona's fixed voice (models.ts). NB: a patched clip does NOT reach tours already
// DOWNLOADED offline (the device keeps its bytes until a re-download) — known gap.
//
//   dotenvx run -f .env.development -- bun packages/generator/src/patch-clip.ts \
//     <tourStopId|tourBracketId> --find "fiftehundred" --replace "fifteen hundred" [--all] [--apply]
//
// Blast radius: SPENDS $ (one TTS synth) + MUTATES DB (repoints the row's audioUrl in place).
// DEFAULT DRY RUN — pass --apply to synthesize + write. --find/--replace does a literal
// substring replacement in the stored script (the match must be present, and unique unless
// --all). An --apply run needs Google Cloud TTS (GOOGLE_CLOUD_PROJECT + ADC) and R2_*. See
// docs/guides/ops-scripts-sop.md.

import { eq } from 'drizzle-orm'
import { db } from '@skipper/db'
import { regions, tourBrackets, tourStops, tours } from '@skipper/db/schema'
import { announce, assertReady, parseFlags } from './pipeline/ops'
import { personaForRegion } from './persona'
import { synthesize } from './pipeline/tts'
import { clipKey, uploadAudio } from './pipeline/storage'

interface Args {
  id: string
  find: string
  replace: string
  all: boolean
  apply: boolean
}

function parseArgs(argv: string[]): Args {
  // --find/--replace are value flags so the positional id isn't mistaken for one (and an id
  // that coincides with a find/replace string still resolves by position).
  const flags = parseFlags(argv, { valueFlags: ['find', 'replace'] })
  const id = flags.positionals[0]
  const find = flags.value('find')
  const replace = flags.value('replace')
  if (!id || find === undefined || replace === undefined) {
    throw new Error(
      'Usage: patch-clip.ts <tourStopId|tourBracketId> --find "<text>" --replace "<text>" [--all] [--apply]',
    )
  }
  // An empty --find would, with --all, interleave the replacement between every
  // character of the script (split('').join(x)) — garbage. Refuse it.
  if (find === '') throw new Error('--find must be a non-empty string.')
  return { id, find, replace, all: flags.has('all'), apply: flags.has('apply') }
}

/** A clip to patch — either a stop or a bracket — normalized to its key + script. */
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

/** Resolve the id to a tour_stop first, then a tour_bracket. */
async function resolveTarget(id: string): Promise<ClipTarget | null> {
  const stop = (
    await db
      .select({
        id: tourStops.id,
        tourId: tourStops.tourId,
        seq: tourStops.seq,
        stopType: tourStops.stopType,
        script: tourStops.script,
        audioUrl: tourStops.audioUrl,
      })
      .from(tourStops)
      .where(eq(tourStops.id, id))
      .limit(1)
  )[0]
  if (stop) {
    if (stop.script === null) throw new Error(`Stop ${id} has no script to patch.`)
    return {
      label: `stop #${stop.seq} (${stop.stopType}) of tour ${stop.tourId.slice(0, 8)}`,
      tourId: stop.tourId,
      key: clipKey(stop.tourId, stop.id),
      script: stop.script,
      storedAudioUrl: stop.audioUrl,
      save: (script, audioUrl, durationMs) =>
        db
          .update(tourStops)
          .set({ script, audioUrl, audioDurationMs: durationMs, updatedAt: new Date() })
          .where(eq(tourStops.id, stop.id))
          .then(() => {}),
    }
  }
  const bracket = (
    await db
      .select({
        id: tourBrackets.id,
        tourId: tourBrackets.tourId,
        kind: tourBrackets.kind,
        script: tourBrackets.script,
        audioUrl: tourBrackets.audioUrl,
      })
      .from(tourBrackets)
      .where(eq(tourBrackets.id, id))
      .limit(1)
  )[0]
  if (bracket) {
    if (bracket.script === null) throw new Error(`Bracket ${id} has no script to patch.`)
    if (bracket.audioUrl === null) {
      throw new Error(`Bracket ${id} has no audio yet — generate the tour before patching.`)
    }
    return {
      label: `${bracket.kind} bracket of tour ${bracket.tourId.slice(0, 8)}`,
      tourId: bracket.tourId,
      // Patch IN PLACE at the row's stored key — bracket keys are per-run now (bracketKey),
      // so minting a fresh key here would strand the row's pointer.
      key: bracket.audioUrl,
      script: bracket.script,
      storedAudioUrl: bracket.audioUrl,
      save: (script, audioUrl, durationMs) =>
        db
          .update(tourBrackets)
          .set({ script, audioUrl, audioDurationMs: durationMs, updatedAt: new Date() })
          .where(eq(tourBrackets.id, bracket.id))
          .then(() => {}),
    }
  }
  return null
}

async function main() {
  const { id, find, replace, all, apply } = parseArgs(process.argv.slice(2))
  announce({ tool: 'patch-clip', blast: ['SPENDS $', 'MUTATES DB'], apply })

  const target = await resolveTarget(id)
  if (!target) throw new Error(`No tour_stop or tour_bracket row with id "${id}".`)

  const occurrences = target.script.split(find).length - 1
  if (occurrences === 0) throw new Error(`"${find}" not found in the clip's script.`)
  if (occurrences > 1 && !all) {
    throw new Error(`"${find}" appears ${occurrences} times — pass --all to replace every occurrence.`)
  }
  const newScript = target.script.split(find).join(replace)

  console.log(`Clip: ${target.label}`)
  console.log(`  - ${target.script}`)
  console.log(`  + ${newScript}`)
  console.log(`  ${occurrences} replacement(s): "${find}" → "${replace}"`)

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
  const { audio, durationMs } = await synthesize(newScript, persona.voice, persona.ttsStyle)

  // The clip key is tour-scoped (clips/<tourId>/<stopId|kind>), so re-uploading
  // overwrites the SAME object — audioUrl (the stored key) does not change.
  if (target.storedAudioUrl && target.storedAudioUrl !== target.key) {
    console.warn(
      `  note: stored audioUrl "${target.storedAudioUrl}" != computed key "${target.key}" — writing to the computed key.`,
    )
  }
  const audioUrl = await uploadAudio(target.key, audio)
  await target.save(newScript, audioUrl, durationMs)

  console.log(`Done. Re-synthesized ${(durationMs / 1000).toFixed(1)}s of audio → ${audioUrl}`)
}

main().catch((e) => {
  console.error('\nPatch failed:', e instanceof Error ? e.message : e)
  process.exitCode = 1
})
