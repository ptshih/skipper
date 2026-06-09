// Eval CLI — score a generated tour's GROUNDING from a `GenerateResult` artifact.
//
// Reads the JSON that `run.ts --json=<path>` already emits (scripts + the exact per-stop
// fact well), runs the grounding gate on every narrated stop, prints a scorecard, and
// exits NON-ZERO if the gate fails — so it can become a CI/regression gate as the eval
// flywheel grows. No live-pipeline coupling: it audits an artifact, so it never re-runs
// generation (and the only spend is the eval's own once-per-stop Sonnet calls).
//
// Dimensions: grounding (Sonnet, gate) + tts (deterministic, gate) + diversity
// (deterministic, advisory) run by default; charm (one Opus call, advisory) is opt-in via
// --charm to keep the default audit cheap.
//
// Usage (ANTHROPIC_API_KEY injected via dotenvx):
//   dotenvx run -f .env.development -- bun packages/generator/src/eval/run.ts <result.json> [--charm] [--json=<out>]
//
// To produce the input artifact first (this DOES cost narration tokens):
//   dotenvx run -f .env.development -- bun packages/generator/src/run.ts <slug> --dry-run --json=<result.json>

import { personaForRegion } from '../persona'
import type { LintInput } from '../pipeline/lint'
import { buildGroundingWell, evaluateGrounding, type GroundingInput } from './grounding'
import { evaluateTts } from './tts'
import { evaluateDiversity } from './diversity'
import { charmEvaluator, type CharmStop } from './charm'
import { buildScorecard } from './scorecard'
import type { StopEval, TourScorecard } from './types'

// Minimal shape we read from the GenerateResult artifact (kept structural so it tolerates
// extra fields and stays decoupled from the generate.ts type, which is actively changing).
interface ArtifactStop {
  seq: number
  stopType: 'story' | 'scenic' | 'break'
  name: string
  /** Sayable kind (break: already the SPOKEN kind) — part of the permitted well. */
  kind?: string
  sideOfRoad?: 'left' | 'right'
  script?: string
  facts?: string[]
  geology?: string[]
  wikidata?: string[]
  /** Co-located landmarks merged into the stop — their facts are part of the permitted well. */
  mergedFeatures?: { name: string; facts: string[] }[]
}
interface Artifact {
  slug: string
  tourName: string
  region: string
  stops: ArtifactStop[]
}

function parseArgs(argv: string[]): { path: string; jsonOut?: string; charm: boolean } {
  const args = argv.slice(2)
  const path = args.find((a) => !a.startsWith('--'))
  if (!path) {
    throw new Error(
      'Usage: eval/run.ts <result.json> [--charm] [--json=<out>]\n' +
        '  (produce <result.json> via run.ts <slug> --dry-run --json=<result.json>)',
    )
  }
  const jsonOut = args.find((a) => a.startsWith('--json='))?.split('=')[1] || undefined
  const charm = args.includes('--charm') // opt-in: one extra Opus call
  return { path, jsonOut, charm }
}

/** "Lake Tahoe" → "lake-tahoe" — best-effort region-slug for persona resolution (the artifact
 *  carries the display name, not the slug; an unknown slug falls back to the Skipper persona). */
const slugify = (s: string): string => s.toLowerCase().trim().replace(/\s+/g, '-')

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
  const { path, jsonOut, charm } = parseArgs(process.argv)
  const artifact = (await Bun.file(path).json()) as Artifact

  // Audit every NARRATED stop. (Brackets are a separate grounding surface — a future
  // evaluator; they carry no fact well in the artifact.)
  const narrated = artifact.stops.filter((s) => s.script && s.script.trim().length > 0)
  const dims = ['grounding (Sonnet)', 'tts', 'diversity', ...(charm ? ['charm (Opus)'] : [])]
  console.log(`Auditing ${narrated.length} narrated stops — ${dims.join(' + ')}...`)

  const inputs: GroundingInput[] = narrated.map((s) => ({
    seq: s.seq,
    stopType: s.stopType,
    // Story/break name their place; a NAMED scenic may too (its name/kind/side line is on
    // the well — the narrate.ts contract); only an unnamed scenic stays placeless.
    placeName: s.name || undefined,
    script: s.script!,
    // The SAME permitted well the live pipeline audits against (facts + geology + wikidata
    // + merged-feature facts + the sayable name/kind/side lines) — built by the shared
    // helper so the two auditors can never drift on what the narrator was allowed to say.
    well: buildGroundingWell(s),
    region: artifact.region,
    corridor: artifact.tourName,
    // Sanctioned-callback carve-out: the narrator is fed EARLIER stops for earned callbacks,
    // so only story names BEFORE this stop are blessed — a "callback" to a later place
    // would be invention and must not pass.
    tourStops: artifact.stops
      .filter((o) => o.stopType === 'story' && o.seq < s.seq)
      .map((o) => o.name),
  }))

  // GATES: grounding (LLM, concurrent — the SDK handles 429 retry) + tts (free, deterministic).
  const grounding: StopEval[] = await Promise.all(inputs.map((i) => evaluateGrounding(i)))
  const tts: StopEval[] = narrated.map((s) => evaluateTts({ seq: s.seq, script: s.script! }))

  // ADVISORY: diversity (free, cross-stop lint over story+scenic — breaks aren't linted),
  // keyed on the region's persona kit (resolved by slug; defaults to the Skipper).
  const lintInputs: LintInput[] = narrated
    .filter((s) => s.stopType !== 'break')
    .map((s) => ({ seq: s.seq, stopType: s.stopType, script: s.script! }))
  const persona = personaForRegion(slugify(artifact.region))
  const diversity: StopEval[] = evaluateDiversity(lintInputs, persona.kit)

  // ADVISORY: charm (one Opus call) — opt-in.
  let charmEvals: StopEval[] = []
  if (charm) {
    const charmStops: CharmStop[] = narrated.map((s) => ({
      seq: s.seq,
      stopType: s.stopType,
      name: s.name,
      script: s.script!,
    }))
    charmEvals = await charmEvaluator(charmStops)
  }

  const stops: StopEval[] = [...grounding, ...tts, ...diversity, ...charmEvals]

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
