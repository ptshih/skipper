// The eval-panel GATE: narrate a take, score it, retake it, and decide whether it may ship.
//
// ONE definition, because there are TWO generators — the solo poi path (generate-narrations.ts) and
// the fused cluster path (generate-cluster-narrations.ts) — and until 2026-07-30 each carried its own
// hand-copied version of this wiring, comments and all.
//
// ⚠ That copy was not hypothetical debt. The fused path went its entire existence without the
// unpriced-model spend guard the solo path has, so a fused run could synthesize a whole region under
// a `--max-cost` ceiling that silently read $0. Nobody removed the guard from the cluster generator;
// it was simply never copied in. That is the failure mode duplicated pipeline wiring produces, and it
// is the reason this file exists. Whatever else the two generators do differently, they must not
// disagree about how a clip is judged or when it is allowed to ship.
//
// WHAT STAYS IN THE CALLER, because it genuinely differs: how `base` and `well` are built. A poi
// grounds on its curated fact sheet (resolveStoryGrounding) and carries a shared-facts map; a cluster
// grounds on its merged member features. Both then hand the SAME shapes to the same judge — which is
// the property that matters, since the well the auditor scores against must never drift from the
// sheet the narrator saw.
//
// TESTABILITY is the other half of the point. The model calls below are dependency seams with live
// defaults — the same convention the enrichment scout and the grounding decomposer already use — so
// the gate/excise/retake branching can be exercised with fakes. The copy-pasted version could only be
// run by paying for it, and because model output is non-deterministic, even a paid run could not have
// proven the two copies agreed.

import { GROUNDING_EVAL, GROUNDING_REGEN_MAX_ROUNDS } from '../config'
import { getAnthropic } from '../models'
import { narrateStop, type NarrationRequest } from './narrate'
import { evaluateGrounding } from '../eval/grounding'
import { evaluateTts } from '../eval/tts'
import { evaluateDiversityAgainst } from '../eval/diversity'
import { evaluateLaterality } from '../eval/laterality'
import { evaluatePacing } from '../eval/pacing'
import { optimize } from '../eval/optimize'
import { exciseUngrounded, makeExciseCall } from '../eval/excise'
import { DIMENSION_KIND, type StopEval } from '../eval/types'

/** The prefix `evaluateGrounding` puts on an ungrounded-claim finding. The retake branches on it, so
 *  it is named once here rather than spelled out as a string literal in each generator. */
const UNGROUNDED_PREFIX = 'ungrounded place-claim'

export interface GateNarrationInput {
  seq: number
  /** The place name — the grounding judge's subject, and what the excision log line names. */
  name: string
  /** The narration request WITHOUT `avoid`; a retake folds that in. */
  base: NarrationRequest
  /** The permitted well, built from the SAME facts handed to the narrator. */
  well: string[]
  targetSeconds: number
  maxSeconds: number
  /** Shared and MUTATED: a shipped take is appended so later clips in this run are scored against it.
   *  ⚠ Best-effort by design — generation is concurrent, so how much context a given clip sees depends
   *  on completion order. That makes a run non-deterministic in its ADVISORY scoring only; gates are
   *  per-clip and unaffected, and more context is never worse than the none we started with. */
  diversityContext: string[]
  systemPrompt: string
}

/** Live-by-default seams. Override in tests; production passes nothing. */
export interface GateNarrationDeps {
  narrate?: typeof narrateStop
  judgeGrounding?: typeof evaluateGrounding
  /** Whether to spend the one Opus grounding call. Defaults to the SKIPPER_GROUNDING_EVAL knob. */
  groundingEnabled?: () => boolean
  excise?: typeof exciseUngrounded
  maxRounds?: number
}

export interface GatedNarration {
  /** The best take found. */
  script: string
  evals: StopEval[]
  /** Cleared every GATE dimension → eligible to synthesize + persist. */
  shipped: boolean
}

/**
 * Narrate one clip and run it through the panel until it stops improving.
 *
 * The panel is: tts-cleanliness + diversity + laterality + pacing (all free), plus GROUNDING (one
 * Opus call) when enabled. Diversity is scored against the REST of the region rather than against the
 * clip alone — a single-element diversity check is a no-op by arithmetic, which is how one geology
 * sentence reached 17 released Tahoe clips before anyone noticed.
 *
 * A grounding failure is repaired by targeted EXCISION of the flagged lines rather than by re-rolling
 * the whole clip, because re-rolling just reaches for a different flourish. Every other finding
 * re-narrates with the findings folded in as `avoid`.
 *
 * SHIP = every GATE dimension clean. Diversity is advisory: it steers the retake and never withholds
 * an otherwise-clean clip.
 */
export async function gateNarration(
  input: GateNarrationInput,
  deps: GateNarrationDeps = {},
): Promise<GatedNarration> {
  const {
    narrate = narrateStop,
    judgeGrounding = evaluateGrounding,
    groundingEnabled = GROUNDING_EVAL,
    excise = exciseUngrounded,
    maxRounds = GROUNDING_REGEN_MAX_ROUNDS,
  } = deps
  const { seq, name, base, well, targetSeconds, maxSeconds, diversityContext, systemPrompt } = input

  // ⚠ THE STOP TYPE COMES FROM `base`, THE SAME OBJECT THE NARRATOR IS HANDED. It was hardcoded
  // 'story' until 2026-08-03, which was correct only while story was the only thing generated — and
  // the SCENIC generator is what un-deferred it.
  //
  // ⚠ WHY IT WAS A TRAP RATHER THAN A SHORTCUT, kept because the hazard survives the fix: the
  // grounding judge's rules are STRICTER for the other two types — a scenic stop may assert no
  // place-fact beyond geology and its own name/kind, and a break may name only the given place plus
  // its category (see the SYSTEM prompt in eval/grounding.ts). `buildGroundingWell` implements all
  // three branches faithfully. So a scenic clip scored under STORY rules gets the LOOSEST set, and the
  // failure is silent: the gate returns a clean verdict, the clip ships, and nothing in the panel or
  // the tests distinguishes it. For this tier that is not a nicety — "a given name licenses nothing it
  // implies" is the entire reason a name-and-kind-only telling is safe to generate at all.
  //
  // ⚠ DERIVED, NOT A SECOND FIELD, and that is a deliberate departure from what the old comment here
  // proposed (a required `stopType` on GateNarrationInput). A parallel field is one a caller can set
  // to something the narrator was never told — two copies of the same fact, free to drift, which is
  // the bug class this repo keeps paying for. `base.stopType` is already required on
  // `NarrationRequest`, so the judge and the narrator now read ONE expression and cannot disagree.
  const stopType = base.stopType
  const evaluate = async (script: string): Promise<StopEval[]> => {
    const evals: StopEval[] = [
      evaluateTts({ seq, script }),
      ...evaluateDiversityAgainst({ seq, stopType, script }, diversityContext),
      evaluateLaterality({ seq, script }),
      evaluatePacing({ seq, script, targetSeconds, maxSeconds }),
    ]
    if (groundingEnabled()) {
      evals.push(
        await judgeGrounding({ seq, stopType, placeName: name, script, well, region: base.region }),
      )
    }
    return evals
  }

  const exciseCall = makeExciseCall(() => getAnthropic('grounding excision'))
  const regenerate = async (avoid: string[], prev: string): Promise<string> => {
    const ungrounded = avoid.filter((a) => a.startsWith(UNGROUNDED_PREFIX))
    if (ungrounded.length > 0) {
      console.log(`  ✂ ${name}: excising ${ungrounded.length} ungrounded claim(s)`)
      return excise(prev, ungrounded, well, exciseCall)
    }
    return (await narrate({ ...base, avoid }, systemPrompt)).script
  }

  const { script: initial } = await narrate(base, systemPrompt)
  const result = await optimize(initial, { evaluate, regenerate, maxRounds })
  const shipped = result.evals.filter((e) => DIMENSION_KIND[e.dimension] === 'gate').every((e) => e.pass)
  if (shipped && result.item) diversityContext.push(result.item)
  return { script: result.item, evals: result.evals, shipped }
}
