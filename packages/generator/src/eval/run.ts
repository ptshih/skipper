// Eval CLI — score a generated tour's GROUNDING from a `GenerateResult` artifact.
//
// Reads the JSON that `run.ts --json=<path>` already emits (scripts + the exact per-stop
// fact well), runs the grounding gate on every narrated stop, prints a scorecard, and
// exits NON-ZERO if the gate fails — so it can become a CI/regression gate as the eval
// flywheel grows. No live-pipeline coupling: it audits an artifact, so it never re-runs
// generation (and the only spend is the eval's own once-per-stop Sonnet calls).
//
// Usage (ANTHROPIC_API_KEY injected via dotenvx):
//   dotenvx run -f .env.development -- bun packages/generator/src/eval/run.ts <result.json> [--json=<out>]
//
// To produce the input artifact first (this DOES cost narration tokens):
//   dotenvx run -f .env.development -- bun packages/generator/src/run.ts <slug> --dry-run --json=<result.json>

import { evaluateGrounding, type GroundingInput } from './grounding'
import { evaluateTts } from './tts'
import { buildScorecard } from './scorecard'
import type { StopEval, TourScorecard } from './types'

// Minimal shape we read from the GenerateResult artifact (kept structural so it tolerates
// extra fields and stays decoupled from the generate.ts type, which is actively changing).
interface ArtifactStop {
  seq: number
  stopType: 'story' | 'scenic' | 'break'
  name: string
  script?: string
  facts?: string[]
  geology?: string[]
  wikidata?: string[]
}
interface Artifact {
  slug: string
  tourName: string
  region: string
  stops: ArtifactStop[]
}

function parseArgs(argv: string[]): { path: string; jsonOut?: string } {
  const args = argv.slice(2)
  const path = args.find((a) => !a.startsWith('--'))
  if (!path) {
    throw new Error(
      'Usage: eval/run.ts <result.json> [--json=<out>]\n' +
        '  (produce <result.json> via run.ts <slug> --dry-run --json=<result.json>)',
    )
  }
  const jsonOut = args.find((a) => a.startsWith('--json='))?.split('=')[1] || undefined
  return { path, jsonOut }
}

function printScorecard(card: TourScorecard): void {
  console.log('\n' + '='.repeat(72))
  console.log(`GROUNDING EVAL — ${card.tourName} (${card.slug})`)
  console.log('='.repeat(72))
  const bySeq = new Map<number, StopEval[]>()
  for (const s of card.stops) bySeq.set(s.seq, [...(bySeq.get(s.seq) ?? []), s])
  for (const seq of [...bySeq.keys()].sort((a, b) => a - b)) {
    const evals = bySeq.get(seq)!
    const summary = evals.map((e) => `${e.dimension} ${e.pass ? '✓' : '✗'}`).join('  ')
    console.log(`[${String(seq).padStart(2, '0')}] ${summary}`)
    for (const e of evals) for (const f of e.findings) console.log(`      · ${f}`)
  }
  console.log('-'.repeat(72))
  for (const d of card.dimensions) {
    console.log(
      `${d.dimension} (${d.kind}): ${d.pass ? 'PASS' : 'FAIL'} · ` +
        `score ${d.score.toFixed(2)} · ${d.stopsFailed}/${d.stopsEvaluated} stops failed`,
    )
  }
  console.log(`\nTOUR: ${card.pass ? 'PASS ✓' : 'FAIL ✗ (a gate dimension failed)'}\n`)
}

async function main() {
  const { path, jsonOut } = parseArgs(process.argv)
  const artifact = (await Bun.file(path).json()) as Artifact

  // Audit every NARRATED stop. (Brackets are a separate grounding surface — a future
  // evaluator; they carry no fact well in the artifact.)
  const narrated = artifact.stops.filter((s) => s.script && s.script.trim().length > 0)
  console.log(
    `Auditing ${narrated.length} narrated stops — grounding (Sonnet) + tts-cleanliness (deterministic)...`,
  )

  const inputs: GroundingInput[] = narrated.map((s) => ({
    seq: s.seq,
    stopType: s.stopType,
    // Scenic stops name no landmark by contract, so don't hand the auditor a place name to
    // bless; story/break may name their place.
    placeName: s.stopType === 'scenic' ? undefined : s.name,
    script: s.script!,
    well: [...(s.facts ?? []), ...(s.geology ?? []), ...(s.wikidata ?? [])],
    region: artifact.region,
    corridor: artifact.tourName,
  }))

  // Once-per-tour offline audit — grounding stops run concurrently (the SDK handles 429
  // retry); tts is a free deterministic pass. Both dimensions land in the same scorecard.
  const grounding: StopEval[] = await Promise.all(inputs.map((i) => evaluateGrounding(i)))
  const tts: StopEval[] = narrated.map((s) => evaluateTts({ seq: s.seq, script: s.script! }))
  const stops: StopEval[] = [...grounding, ...tts]

  const card = buildScorecard({
    slug: artifact.slug,
    tourName: artifact.tourName,
    evaluatedAt: new Date().toISOString(),
    stops,
  })

  printScorecard(card)
  if (jsonOut) {
    await Bun.write(jsonOut, JSON.stringify(card, null, 2))
    console.log(`Wrote scorecard JSON → ${jsonOut}`)
  }
  // Non-zero exit on a gate failure so this can wire into CI / a regression suite.
  if (!card.pass) process.exitCode = 1
}

main().catch((e) => {
  console.error('\nGrounding eval failed:', e instanceof Error ? e.message : e)
  process.exitCode = 1
})
