// Patch ONE poi_content clip's script and re-synthesize just that clip — for fixing
// a typo or a single bad word without paying to regenerate (and re-narrate) a whole
// tour. The narration is left otherwise untouched: this is a surgical text edit, not
// a re-run of the model, so a human-approved clip stays approved except for the fix.
//
// It re-synthesizes the edited script (Google Cloud TTS), overwrites the SAME R2
// object (the clip key is a function of poi/persona/voice/joke, so audioUrl never
// changes), and updates poi_content.script + audio_duration_ms. The poi_content
// cache key dimensions (persona, voice, joke_level) are read from the row, so the
// re-synth always lands on the exact same key.
//
//   dotenvx run -f .env.development -- bun packages/generator/src/patch-clip.ts \
//     <poiContentId> --find "fiftehundred" --replace "fifteen hundred" [--dry-run]
//
// --find/--replace does a literal substring replacement in the stored script (the
// match must be present, and must be unique unless --all is passed). Needs Google
// Cloud TTS (GOOGLE_CLOUD_PROJECT + ADC) and R2_* — same as a full generation run.

import { eq } from 'drizzle-orm'
import { db } from '@skipper/db'
import { poiContent } from '@skipper/db/schema'
import { GOOGLE_TTS_READY, R2_READY } from './config'
import { synthesize } from './pipeline/tts'
import { clipKey, uploadAudio } from './pipeline/storage'
import type { JokeLevel, Persona } from '@skipper/shared'

interface Args {
  id: string
  find: string
  replace: string
  all: boolean
  dryRun: boolean
}

function flag(args: string[], name: string): string | undefined {
  const eqForm = args.find((a) => a.startsWith(`--${name}=`))
  if (eqForm) return eqForm.slice(name.length + 3)
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2)
  const id = args.find((a) => !a.startsWith('--') && a !== flag(args, 'find') && a !== flag(args, 'replace'))
  const find = flag(args, 'find')
  const replace = flag(args, 'replace')
  if (!id || find === undefined || replace === undefined) {
    throw new Error(
      'Usage: patch-clip.ts <poiContentId> --find "<text>" --replace "<text>" [--all] [--dry-run]',
    )
  }
  // An empty --find would, with --all, interleave the replacement between every
  // character of the script (split('').join(x)) — garbage that would then be
  // synthesized over the live clip. Refuse it.
  if (find === '') throw new Error('--find must be a non-empty string.')
  return { id, find, replace, all: args.includes('--all'), dryRun: args.includes('--dry-run') }
}

async function main() {
  const { id, find, replace, all, dryRun } = parseArgs(process.argv)

  const row = (
    await db
      .select({
        id: poiContent.id,
        poiId: poiContent.poiId,
        persona: poiContent.persona,
        voice: poiContent.voice,
        jokeLevel: poiContent.jokeLevel,
        script: poiContent.script,
        audioUrl: poiContent.audioUrl,
      })
      .from(poiContent)
      .where(eq(poiContent.id, id))
      .limit(1)
  )[0]
  if (!row) throw new Error(`No poi_content row with id "${id}".`)

  const occurrences = row.script.split(find).length - 1
  if (occurrences === 0) throw new Error(`"${find}" not found in the clip's script.`)
  if (occurrences > 1 && !all) {
    throw new Error(`"${find}" appears ${occurrences} times — pass --all to replace every occurrence.`)
  }
  const newScript = row.script.split(find).join(replace)

  console.log(`Clip ${row.id} (poi ${row.poiId}, ${row.persona}/${row.voice}/${row.jokeLevel})`)
  console.log(`  - ${row.script}`)
  console.log(`  + ${newScript}`)
  console.log(`  ${occurrences} replacement(s): "${find}" → "${replace}"`)

  if (dryRun) {
    console.log('\nDRY RUN — no synthesis, upload, or DB write.')
    return
  }

  if (!GOOGLE_TTS_READY()) {
    throw new Error('Google Cloud TTS is not configured (GOOGLE_CLOUD_PROJECT + ADC). Use --dry-run to preview.')
  }
  if (!R2_READY()) throw new Error('R2_* env is not set.')

  console.log('\nSynthesizing edited script...')
  const { audio, durationMs } = await synthesize(newScript, row.voice)

  // The clip key is a pure function of the cache-key dimensions, so re-uploading
  // overwrites the SAME object — audioUrl (the stored key) does not change.
  const key = clipKey(row.poiId, row.persona as Persona, row.voice, row.jokeLevel as JokeLevel)
  if (row.audioUrl && row.audioUrl !== key) {
    console.warn(`  note: stored audioUrl "${row.audioUrl}" != computed key "${key}" — writing to the computed key.`)
  }
  const audioUrl = await uploadAudio(key, audio)

  await db
    .update(poiContent)
    .set({ script: newScript, audioUrl, audioDurationMs: durationMs, updatedAt: new Date() })
    .where(eq(poiContent.id, row.id))

  console.log(`Done. Re-synthesized ${(durationMs / 1000).toFixed(1)}s of audio → ${audioUrl}`)
}

main().catch((e) => {
  console.error('\nPatch failed:', e instanceof Error ? e.message : e)
  process.exitCode = 1
})
