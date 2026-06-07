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
//   --judge-closers      Run the optional semantic-closer LLM judge after the lint
//                        (one extra model call) to break up closing-move monotony.
//   --duration=<bucket>  short | standard | long   (default: standard)
//
// A full run additionally needs Google Cloud TTS (GOOGLE_CLOUD_PROJECT + ADC, i.e.
// GOOGLE_APPLICATION_CREDENTIALS or `gcloud auth application-default login`) and R2_*.

import { generateTour } from './pipeline/generate'
import type { GenerateResult } from './pipeline/generate'

const DURATIONS = ['short', 'standard', 'long'] as const
type Duration = (typeof DURATIONS)[number]

interface Args {
  slug: string
  dryRun: boolean
  preview: boolean
  judgeClosers: boolean
  durationBucket: Duration
}

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2)
  const slug = args.find((a) => !a.startsWith('--'))
  if (!slug) {
    throw new Error('Usage: run.ts <corridor-slug> [--dry-run] [--preview] [--judge-closers] [--duration=short|standard|long]')
  }
  const dryRun = args.includes('--dry-run')
  const preview = args.includes('--preview')
  const judgeClosers = args.includes('--judge-closers')
  const durArg = args.find((a) => a.startsWith('--duration='))?.split('=')[1] ?? 'standard'
  if (!DURATIONS.includes(durArg as Duration)) {
    throw new Error(`--duration must be one of ${DURATIONS.join(', ')} (got "${durArg}")`)
  }
  return { slug, dryRun, preview, judgeClosers, durationBucket: durArg as Duration }
}

const mmss = (sec: number): string => {
  const total = Math.round(sec) // round first so seconds can't carry to 60 (e.g. 6:60)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function printResult(r: GenerateResult): void {
  console.log('\n' + '='.repeat(72))
  console.log(`${r.dryRun ? 'DRY RUN' : 'GENERATED'} — ${r.corridor} (${r.region}) · ${r.durationBucket} · ~${Math.round(r.totalSec / 60)} min drive`)
  if (r.tourId) console.log(`tour id: ${r.tourId}`)
  console.log('='.repeat(72))
  let audioMs = 0
  for (const s of r.stops) {
    const head = `[${String(s.seq).padStart(2, '0')}] @${mmss(s.alongSec)}  ${s.stopType.toUpperCase()}  ${s.name}`
    console.log('\n' + head + (s.durationMs ? `  (${(s.durationMs / 1000).toFixed(1)}s audio)` : ''))
    if (s.audioUrl) console.log(`     ${s.audioUrl}`)
    if (s.script) console.log(s.script.split('\n').map((l) => '     ' + l).join('\n'))
    audioMs += s.durationMs ?? 0
  }
  if (audioMs > 0) console.log(`\nTotal narration audio: ${mmss(audioMs / 1000)}`)
  console.log('')
}

async function main() {
  const { slug, dryRun, preview, judgeClosers, durationBucket } = parseArgs(process.argv)
  const result = await generateTour({ slug, dryRun, preview, judgeClosers, durationBucket })
  printResult(result)
}

main().catch((e) => {
  console.error('\nGeneration failed:', e instanceof Error ? e.message : e)
  process.exitCode = 1
})
