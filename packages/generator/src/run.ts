// M1 generator CLI.
//
// Usage (env injected by dotenvx — there is no plaintext .env):
//   dotenvx run -f .env.development -- bun packages/generator/src/run.ts <slug> [flags]
//
// Flags:
//   --dry-run            Narrate + print scripts only (no TTS / R2 / tour-state writes;
//                        the run's eval IS still recorded to eval_runs — observability).
//                        Needs ANTHROPIC_API_KEY (+ GOOGLE_MAPS_API_KEY for breaks).
//   --no-judge-closers   Skip the semantic-closer LLM judge. It is ON by default
//                        (one extra model call) — it breaks up closing-move monotony
//                        (the reflective-bow ending the charm judge flags), which the
//                        deterministic lint can't catch.
//   --duration=<bucket>  short | standard | long   (default: standard)
//   --joke-level=<notch> off | mild | dad | dadpocalypse   (default: dadpocalypse)
//                        The Dad-Joke-O-Meter notch to NARRATE at — a generation input,
//                        baked into the audio (NOT stored on the tour). M1 = dadpocalypse.
//   --max-cost=<usd>     Abort BEFORE the TTS/R2 phase if (LLM spent + estimated TTS)
//                        exceeds this. LLM spend is sunk by then — the cap saves the TTS
//                        bill; scripts + the eval record still land (like a dry run).
//   --json=<path>        Also write the full result (scripts + STORY fact sheets) as
//                        JSON — the artifact for an out-of-band grounding/quality audit.
//
// A full run additionally needs Google Cloud TTS (GOOGLE_CLOUD_PROJECT + ADC, i.e.
// GOOGLE_APPLICATION_CREDENTIALS or `gcloud auth application-default login`) and R2_*.

import { jokeLevel as JOKE_NOTCHES } from '@skipper/shared'
import type { JokeLevel } from '@skipper/shared'
import { formatMmss } from '@skipper/drive-core'
import { generateTour } from './pipeline/generate-tour'
import type { FrameSummary, GenerateResult } from './pipeline/generate-tour'
import { beginJob, finishJob } from './pipeline/job-progress'
import { WORDS_PER_SECOND } from './config'

const DURATIONS = ['short', 'standard', 'long'] as const
type Duration = (typeof DURATIONS)[number]

interface Args {
  slug: string
  dryRun: boolean
  judgeClosers: boolean
  durationBucket: Duration
  /** The notch to narrate at — a generation input, default dadpocalypse (M1). */
  jokeLevel: JokeLevel
  maxCostUsd?: number
  jsonPath?: string
}

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2)
  const slug = args.find((a) => !a.startsWith('--'))
  if (!slug) {
    throw new Error(
      'Usage: run.ts <tour-slug> [--dry-run] [--no-judge-closers] [--duration=short|standard|long] [--joke-level=off|mild|dad|dadpocalypse] [--max-cost=<usd>] [--json=<path>]',
    )
  }
  // Reject unrecognized flags loudly — a dropped flag is harmless for most of these, but a
  // silently ignored `--max-cost 5` (space instead of =) would run UNCAPPED and spend money.
  const KNOWN_FLAGS = ['--dry-run', '--no-judge-closers']
  const KNOWN_PREFIXES = ['--duration=', '--joke-level=', '--max-cost=', '--json=']
  const unknown = args.filter(
    (a) => a.startsWith('--') && !KNOWN_FLAGS.includes(a) && !KNOWN_PREFIXES.some((p) => a.startsWith(p)),
  )
  if (unknown.length > 0) {
    throw new Error(`Unrecognized flag(s): ${unknown.join(' ')} — value flags use =, e.g. --max-cost=5`)
  }
  const dryRun = args.includes('--dry-run')
  const judgeClosers = !args.includes('--no-judge-closers') // ON by default; opt out to save a call
  const durArg = args.find((a) => a.startsWith('--duration='))?.split('=')[1] ?? 'standard'
  if (!DURATIONS.includes(durArg as Duration)) {
    throw new Error(`--duration must be one of ${DURATIONS.join(', ')} (got "${durArg}")`)
  }
  // The notch is a generation INPUT (not stored): default dadpocalypse, validated against the
  // canonical @skipper/shared vocabulary so the CLI can never drift from the enum.
  const jokeArg = args.find((a) => a.startsWith('--joke-level='))?.split('=')[1] ?? 'dadpocalypse'
  if (!JOKE_NOTCHES.options.includes(jokeArg as JokeLevel)) {
    throw new Error(`--joke-level must be one of ${JOKE_NOTCHES.options.join(', ')} (got "${jokeArg}")`)
  }
  const costArg = args.find((a) => a.startsWith('--max-cost='))?.split('=')[1]
  let maxCostUsd: number | undefined
  if (costArg !== undefined) {
    maxCostUsd = Number(costArg)
    if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0) {
      throw new Error(`--max-cost must be a positive dollar amount (got "${costArg}")`)
    }
  }
  const jsonPath = args.find((a) => a.startsWith('--json='))?.split('=')[1] || undefined
  return {
    slug,
    dryRun,
    judgeClosers,
    durationBucket: durArg as Duration,
    jokeLevel: jokeArg as JokeLevel,
    ...(maxCostUsd !== undefined ? { maxCostUsd } : {}),
    jsonPath,
  }
}

// Spoken pace for the dry-run length ESTIMATE (no TTS yet) — the shared WORDS_PER_SECOND
// so the printed "~Xs est" tracks the target the model was given.
const estSpokenSec = (script: string): number =>
  script.trim().split(/\s+/).filter(Boolean).length / WORDS_PER_SECOND

function printResult(r: GenerateResult): void {
  console.log('\n' + '='.repeat(72))
  const mode = r.costCapped ? 'COST-CAPPED (scripts only — TTS skipped)' : r.dryRun ? 'DRY RUN' : 'GENERATED'
  console.log(
    `${mode} — ${r.tourName} (${r.region}) · ${r.durationBucket} · ${r.jokeLevel} · ~${Math.round(r.totalSec / 60)} min drive`,
  )
  if (r.tourId) console.log(`tour id: ${r.tourId}`)
  console.log('='.repeat(72))
  let audioMs = 0
  let estSec = 0 // dry-run: summed spoken-length estimate across narrated stops
  const intro = r.frames.find((b) => b.kind === 'intro')
  const outro = r.frames.find((b) => b.kind === 'outro')
  const printBracket = (b: FrameSummary | undefined, label: string): void => {
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
    const head = `[${String(s.seq).padStart(2, '0')}] @${formatMmss(s.alongSec)}  ${s.stopType.toUpperCase()}  ${s.name}`
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
  if (audioMs > 0) console.log(`\nTotal narration audio: ${formatMmss(audioMs / 1000)}`)
  else if (estSec > 0)
    console.log(
      `\nEstimated narration audio: ~${formatMmss(estSec)} (dry-run, words/${WORDS_PER_SECOND}/s)`,
    )
  console.log('')
}

async function main() {
  const { slug, dryRun, judgeClosers, durationBucket, jokeLevel, maxCostUsd, jsonPath } =
    parseArgs(process.argv)
  await beginJob('generate', { dryRun, targetSlug: slug })
  const result = await generateTour({
    slug,
    dryRun,
    judgeClosers,
    durationBucket,
    jokeLevel,
    ...(maxCostUsd !== undefined ? { maxCostUsd } : {}),
  })
  printResult(result)
  if (jsonPath) {
    await Bun.write(jsonPath, JSON.stringify(result, null, 2))
    console.log(`Wrote result JSON → ${jsonPath}`)
  }
  return { ok: true as const, tourId: result.tourId }
}

main()
  .then((o) => finishJob(o))
  .catch(async (e) => {
    await finishJob({ ok: false, error: e instanceof Error ? e.message : String(e) })
    console.error('\nGeneration failed:', e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
