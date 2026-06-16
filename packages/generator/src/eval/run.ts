// Eval CLI — score a generated tour's GROUNDING from a `GenerateResult` artifact.
//
// Reads the JSON that `run.ts --json=<path>` already emits (scripts + the exact per-stop
// fact well), runs the grounding gate on every narrated stop, prints a scorecard, and
// exits NON-ZERO if the gate fails — so it can become a CI/regression gate as the eval
// flywheel grows. No live-pipeline coupling: it audits an artifact, so it never re-runs
// generation (and the only spend is the eval's own once-per-stop Opus calls).
//
// Dimensions: grounding (Opus, gate) + tts (deterministic, gate) + diversity
// (deterministic, advisory) run by default; charm (one Opus call, advisory) is opt-in via
// --charm, and veracity (Opus + web_search per STORY stop — the external-truth check the
// grounding gate is blind to, advisory) is opt-in via --veracity, to keep the default audit
// cheap.
//
// Usage (ANTHROPIC_API_KEY injected via dotenvx):
//   dotenvx run -f .env.development -- bun packages/generator/src/eval/run.ts <result.json> [--charm] [--veracity] [--json=<out>]
//
// To produce the input artifact first (this DOES cost narration tokens):
//   dotenvx run -f .env.development -- bun packages/generator/src/run.ts <slug> --dry-run --json=<result.json>

import { personaFromKey } from '../persona'
import type { LintInput } from '../pipeline/lint'
import { buildGroundingWell, evaluateGrounding, type GroundingInput } from './grounding'
import { evaluateTts } from './tts'
import { evaluateDiversity } from './diversity'
import { charmEvaluator, type CharmStop } from './charm'
import { evaluateVeracity, type VeracityInput } from './veracity'
import { recordEvalRun, tourIdForSlug, type StopIdentity } from './record'
import { buildScorecard } from './scorecard'
import type { StopEval, TourScorecard } from './types'
import { JUDGMENT_MODEL } from '../models'

// Minimal shape we read from the GenerateResult artifact (kept structural so it tolerates
// extra fields and stays decoupled from the generate.ts type, which is actively changing).
interface ArtifactStop {
  seq: number
  stopType: 'story' | 'scenic' | 'break'
  /** Stable place identity (pois dedup key) — on artifacts from 2026-06-09 onward. */
  source?: string
  sourceId?: string
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
  /** Region slug — retained as artifact metadata. Persona is no longer region-derived (the live
   *  pipeline resolves it from tours.persona_key), so this no longer feeds persona resolution. */
  regionSlug?: string
  /** Present on artifacts from 2026-06-09 onward (tolerated absent on older ones). */
  tourId?: string
  dryRun?: boolean
  narrationModel?: string
  stops: ArtifactStop[]
}

function parseArgs(argv: string[]): {
  path: string
  jsonOut?: string
  charm: boolean
  veracity: boolean
} {
  const args = argv.slice(2)
  const path = args.find((a) => !a.startsWith('--'))
  if (!path) {
    throw new Error(
      'Usage: eval/run.ts <result.json> [--charm] [--veracity] [--json=<out>]\n' +
        '  (produce <result.json> via run.ts <slug> --dry-run --json=<result.json>)',
    )
  }
  const jsonOut = args.find((a) => a.startsWith('--json='))?.split('=')[1] || undefined
  const charm = args.includes('--charm') // opt-in: one extra Opus call
  const veracity = args.includes('--veracity') // opt-in: Opus + web searches per STORY stop
  return { path, jsonOut, charm, veracity }
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
  const { path, jsonOut, charm, veracity } = parseArgs(process.argv)
  const artifact = (await Bun.file(path).json()) as Artifact

  // Audit every NARRATED stop. (Frames are a separate grounding surface — a future
  // evaluator; they carry no fact well in the artifact.)
  const narrated = artifact.stops.filter((s) => s.script && s.script.trim().length > 0)
  const dims = [
    'grounding (Opus)',
    'tts',
    'diversity',
    ...(charm ? ['charm (Opus)'] : []),
    ...(veracity ? ['veracity (Opus + web search)'] : []),
  ]
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
  // Per-stop isolation (mirrors the veracity pass below + the live pipeline's allSettled):
  // one stop's grounding call dying — transient API error, or a malformed completion with no
  // tool call — must NOT throw away every OTHER stop's completed Opus spend AND the durable
  // eval record. An errored stop is WARNED and omitted (un-audited ≠ failed).
  const grounding: StopEval[] = (
    await Promise.all(
      inputs.map(async (i) => {
        try {
          return await evaluateGrounding(i)
        } catch (e) {
          console.warn(
            `grounding: stop ${i.seq} ("${i.placeName ?? 'scenic'}") not evaluated — ${(e as Error).message}`,
          )
          return null
        }
      }),
    )
  ).filter((x): x is StopEval => x !== null)
  const tts: StopEval[] = narrated.map((s) => evaluateTts({ seq: s.seq, script: s.script! }))

  // ADVISORY: diversity (free, cross-stop lint over story+scenic — breaks aren't linted),
  // keyed on the persona kit. M1 is Skipper-only; when artifacts carry a persona key (M4) this
  // reads it instead of defaulting.
  const lintInputs: LintInput[] = narrated
    .filter((s) => s.stopType !== 'break')
    .map((s) => ({ seq: s.seq, stopType: s.stopType, script: s.script! }))
  const persona = personaFromKey('skipper')
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

  // ADVISORY: veracity (Opus + web_search, STORY stops only — they carry the Wikipedia-
  // derived sheet the grounding gate can't see past) — opt-in. Same well as grounding, so
  // the two auditors test the same permitted facts from opposite sides (sheet↔script vs
  // sheet↔world). Concurrent like grounding; the SDK handles 429 retry.
  let veracityEvals: StopEval[] = []
  if (veracity) {
    const vInputs: VeracityInput[] = narrated
      .filter((s) => s.stopType === 'story')
      .map((s) => ({
        seq: s.seq,
        name: s.name,
        script: s.script!,
        well: buildGroundingWell(s),
      }))
    // Per-stop isolation: one stop's checker dying must not throw away every other stop's
    // completed spend. An errored stop is WARNED and omitted (not evaluated ≠ failed).
    veracityEvals = (
      await Promise.all(
        vInputs.map(async (i) => {
          try {
            return await evaluateVeracity(i)
          } catch (e) {
            console.warn(
              `veracity: stop ${i.seq} ("${i.name}") not evaluated — ${(e as Error).message}`,
            )
            return null
          }
        }),
      )
    ).filter((x): x is StopEval => x !== null)
  }

  const stops: StopEval[] = [...grounding, ...tts, ...diversity, ...charmEvals, ...veracityEvals]

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

  // Persist the run durably (eval_runs/eval_scores — the system of record; the file above
  // is an export). Best-effort: a recording failure never fails the audit itself.
  try {
    const identityBySeq = new Map<number, StopIdentity>(
      artifact.stops.map((s) => [
        s.seq,
        {
          ...(s.source ? { poiSource: s.source } : {}),
          ...(s.sourceId ? { poiSourceId: s.sourceId } : {}),
          stopType: s.stopType,
        },
      ]),
    )
    await recordEvalRun({
      slug: artifact.slug,
      tourId: artifact.tourId ?? (await tourIdForSlug(artifact.slug)),
      kind: 'offline_audit',
      dryRun: artifact.dryRun ?? false,
      narrationModel: artifact.narrationModel ?? null,
      judgeModel: JUDGMENT_MODEL,
      scorecard: card,
      artifact,
      identityBySeq,
    })
  } catch (e) {
    console.warn(`eval record failed (non-fatal): ${(e as Error).message}`)
  }

  // Non-zero exit on a gate failure so this can wire into CI / a regression suite.
  if (!card.pass) process.exitCode = 1
}

main().catch((e) => {
  console.error('\nGrounding eval failed:', e instanceof Error ? e.message : e)
  process.exitCode = 1
})
