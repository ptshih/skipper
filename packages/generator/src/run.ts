// M1 generator CLI.
//
// Usage (env injected by dotenvx — there is no plaintext .env):
//   dotenvx run -f .env.development -- bun packages/generator/src/run.ts <slug> [flags]
//
// Flags:
//   --dry-run            Narrate + print scripts only (no TTS / R2 / DB writes).
//                        Needs ANTHROPIC_API_KEY (+ GOOGLE_MAPS_API_KEY for breaks).
//   --preview            Mark this tour as the anonymous-playable sample
//                        (tours.isPreview) — the free "sample, then sign up" tour.
//   --no-judge-closers   Skip the semantic-closer LLM judge. It is ON by default
//                        (one extra model call) — it breaks up closing-move monotony
//                        (the reflective-bow ending the charm judge flags), which the
//                        deterministic lint can't catch.
//   --duration=<bucket>  short | standard | long   (default: standard)
//   --json=<path>        Also write the full result (scripts + STORY fact sheets) as
//                        JSON — the artifact for an out-of-band grounding/quality audit.
//
// A full run additionally needs Google Cloud TTS (GOOGLE_CLOUD_PROJECT + ADC, i.e.
// GOOGLE_APPLICATION_CREDENTIALS or `gcloud auth application-default login`) and R2_*.

import { generateTour } from './pipeline/generate'
import type { BracketSummary, GenerateResult } from './pipeline/generate'

const DURATIONS = ['short', 'standard', 'long'] as const
type Duration = (typeof DURATIONS)[number]

interface Args {
  slug: string
  dryRun: boolean
  preview: boolean
  judgeClosers: boolean
  durationBucket: Duration
  jsonPath?: string
}

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2)
  const slug = args.find((a) => !a.startsWith('--'))
  if (!slug) {
    throw new Error(
      'Usage: run.ts <tour-slug> [--dry-run] [--preview] [--no-judge-closers] [--duration=short|standard|long] [--json=<path>]',
    )
  }
  const dryRun = args.includes('--dry-run')
  const preview = args.includes('--preview')
  const judgeClosers = !args.includes('--no-judge-closers') // ON by default; opt out to save a call
  const durArg = args.find((a) => a.startsWith('--duration='))?.split('=')[1] ?? 'standard'
  if (!DURATIONS.includes(durArg as Duration)) {
    throw new Error(`--duration must be one of ${DURATIONS.join(', ')} (got "${durArg}")`)
  }
  const jsonPath = args.find((a) => a.startsWith('--json='))?.split('=')[1] || undefined
  return { slug, dryRun, preview, judgeClosers, durationBucket: durArg as Duration, jsonPath }
}

const mmss = (sec: number): string => {
  const total = Math.round(sec) // round first so seconds can't carry to 60 (e.g. 6:60)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// Spoken pace for the dry-run length ESTIMATE (no TTS yet) — mirrors narrate.ts's
// WORDS_PER_SECOND so the printed "~Xs est" tracks the target the model was given.
const WORDS_PER_SECOND = 2.5
const estSpokenSec = (script: string): number =>
  script.trim().split(/\s+/).filter(Boolean).length / WORDS_PER_SECOND

function printResult(r: GenerateResult): void {
  console.log('\n' + '='.repeat(72))
  console.log(
    `${r.dryRun ? 'DRY RUN' : 'GENERATED'} — ${r.tourName} (${r.region}) · ${r.durationBucket} · ~${Math.round(r.totalSec / 60)} min drive`,
  )
  if (r.tourId) console.log(`tour id: ${r.tourId}`)
  console.log('='.repeat(72))
  let audioMs = 0
  let estSec = 0 // dry-run: summed spoken-length estimate across narrated stops
  const intro = r.brackets.find((b) => b.kind === 'intro')
  const outro = r.brackets.find((b) => b.kind === 'outro')
  const printBracket = (b: BracketSummary | undefined, label: string): void => {
    if (!b) return
    const est = b.script ? estSpokenSec(b.script) : 0
    const lenTag = b.durationMs
      ? `  (${(b.durationMs / 1000).toFixed(1)}s audio)`
      : b.script
        ? `  (~${Math.round(est)}s est)`
        : ''
    console.log('\n' + `[${label}]` + lenTag)
    if (b.script) console.log(b.script.split('\n').map((l) => '     ' + l).join('\n'))
    audioMs += b.durationMs ?? 0
    if (!b.durationMs && b.script) estSec += est
  }
  printBracket(intro, 'INTRO')
  for (const s of r.stops) {
    const est = s.script ? estSpokenSec(s.script) : 0
    // Real audio duration on a full run; a words/pace estimate on a dry-run.
    const lenTag = s.durationMs
      ? `  (${(s.durationMs / 1000).toFixed(1)}s audio)`
      : s.script
        ? `  (~${Math.round(est)}s est)`
        : ''
    const head = `[${String(s.seq).padStart(2, '0')}] @${mmss(s.alongSec)}  ${s.stopType.toUpperCase()}  ${s.name}`
    console.log('\n' + head + lenTag)
    if (s.audioUrl) console.log(`     ${s.audioUrl}`)
    if (s.script)
      console.log(
        s.script
          .split('\n')
          .map((l) => '     ' + l)
          .join('\n'),
      )
    audioMs += s.durationMs ?? 0
    if (!s.durationMs && s.script) estSec += est
  }
  printBracket(outro, 'OUTRO')
  if (audioMs > 0) console.log(`\nTotal narration audio: ${mmss(audioMs / 1000)}`)
  else if (estSec > 0)
    console.log(
      `\nEstimated narration audio: ~${mmss(estSec)} (dry-run, words/${WORDS_PER_SECOND}/s)`,
    )
  console.log('')
}

async function main() {
  const { slug, dryRun, preview, judgeClosers, durationBucket, jsonPath } = parseArgs(process.argv)
  const result = await generateTour({ slug, dryRun, preview, judgeClosers, durationBucket })
  printResult(result)
  if (jsonPath) {
    await Bun.write(jsonPath, JSON.stringify(result, null, 2))
    console.log(`Wrote result JSON → ${jsonPath}`)
  }
}

main().catch((e) => {
  console.error('\nGeneration failed:', e instanceof Error ? e.message : e)
  process.exitCode = 1
})
