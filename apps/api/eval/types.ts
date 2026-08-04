// The PLANNER eval panel's scorecard schema — the keystone every check plugs into.
//
// WHY THIS EXISTS AT ALL. CLAUDE.md names the live planner as the one place the persona speaks
// UNGATED: "the fail-closed eval panel covers generated clips, not a live turn." Every prompt defect
// this surface has actually shipped — the post-draw re-emit, the wordless draw turn, the redraw dead
// end — was invisible to `bun test` and to `bun run check`, because all prompt coverage is substring
// assertions on a static string and no model ever reads the prompt in CI. This panel is the missing
// half: it REPLAYS scripted rider conversations against the real prompt and scores what comes back.
//
// ⚠ IT LIVES IN apps/api/eval AND NOT IN packages/studio, and that is forced rather than chosen.
// `@skipper/studio` does not depend on `@skipper/api` and must not: the prompt lives in
// apps/api/src/planner-prompt.ts (it cannot go in @skipper/shared — apps/mobile imports that package,
// which would ship the system prompt into the App Store bundle where anyone can read it and nobody
// can revoke it). apps/api/Dockerfile copies ONLY `apps/api/src`, so nothing in this directory ever
// reaches the production image — the same reason `apps/api/test` is safe to keep here.
//
// ⚠ IT NEVER RUNS UNDER `bun test`. A replay spends real Anthropic tokens on every turn, and
// CLAUDE.md forbids an inferred paid run. The CLI is preview-by-default and bills only on `--apply`;
// the pure functions in ./checks are what the unit tests exercise, with no network at all.

import type { PlannerTurnInput } from '../src/planner'

/* -------------------------------------------------------------------------- */
/* What a scenario asserts.                                                     */
/* -------------------------------------------------------------------------- */

/**
 * What the planner is expected to DO on a given turn, as a closed set.
 *
 * ⚠ DELIBERATELY NOT "did a route come back". `draw` and `hold` are the two halves of the judgement
 * this prompt is most often wrong about, and a scenario that only checked for a route object could
 * not tell "the rider said yes and got their drive" from "the rider said 'cool' and got a second
 * identical card" — which is the exact defect the founder reported.
 */
export type TurnExpectation =
  /** A route MUST be emitted this turn (the rider just said yes to a stated plan). */
  | 'draw'
  /** A route must NOT be emitted — the rider said something that is not a yes to a new plan. */
  | 'hold'
  /** A route must NOT be emitted, AND if one is it must not repeat a drive already drawn. This is
   *  `hold` plus the duplicate check stated explicitly, for turns after a draw. */
  | 'hold_no_repeat'

export interface ScenarioTurn {
  /** What the rider types. */
  rider: string
  expect: TurnExpectation
  /** Optional substrings the reply must NOT contain, lower-cased before comparison. Used for the
   *  narrow, objective bans — a drive-time number where the prompt forbids one, say. Keep these
   *  mechanical; anything requiring taste belongs to the judge. */
  banned?: string[]
  /** Why this turn is in the suite. Printed beside a failure so an operator reads the intent, not
   *  just the assertion. */
  note?: string
}

export interface Scenario {
  /** Stable id — it keys the results, so renaming one loses its history. */
  id: string
  /** What defect or behaviour this scenario exists to catch. */
  about: string
  turns: ScenarioTurn[]
}

/* -------------------------------------------------------------------------- */
/* What came back.                                                              */
/* -------------------------------------------------------------------------- */

/** The eval dimensions. GATE dimensions fail the run; ADVISORY ones only inform. */
export type PlannerDimension =
  /** Did the model draw exactly when it should have, and never repeat a drive? */
  | 'routing'
  /** Did every turn carry a rider-visible line? (`route_wordless` is a live, instrumented defect.) */
  | 'voice'
  /** Did it stay off place facts, distances and drive times? */
  | 'discipline'
  /** Does it sound like the Skipper rather than a competent assistant? */
  | 'persona'

export type EvalKind = 'gate' | 'advisory'

/**
 * Gate vs advisory, split by CHECKABILITY — the same rule the narration panel uses.
 * `routing`, `voice` and `discipline` are decided by pure functions over the turn, so they gate.
 * `persona` is taste, judged by a model, so it informs and never blocks.
 */
export const PLANNER_DIMENSION_KIND: Record<PlannerDimension, EvalKind> = {
  routing: 'gate',
  voice: 'gate',
  discipline: 'gate',
  persona: 'advisory',
}

/** One turn, as it actually came back. */
export interface TurnOutcome {
  scenarioId: string
  /** 0-based index into the scenario's turns. */
  index: number
  rider: string
  expect: TurnExpectation
  say: string
  /** The tool input verbatim, or null. Untyped on purpose: it is model output. */
  rawRoute: unknown
  /** ./checks `routeKey` of `rawRoute`, or null when no route came back. */
  routeKey: string | null
  /** What ./planner classified the turn as — 'truncated'/'refused'/'empty' are failures the rider
   *  would see, and a suite that ignored them would score an outage as a clean run. */
  outcome: string
  /** USD this single turn billed, from the real usage. */
  usd: number
}

/** One dimension's verdict for one turn. */
export interface TurnEval {
  scenarioId: string
  index: number
  dimension: PlannerDimension
  pass: boolean
  /** 0..1, where 1 is clean. */
  score: number
  /** Empty when clean. These are what an operator actually reads. */
  findings: string[]
}

export interface DimensionRollup {
  dimension: PlannerDimension
  kind: EvalKind
  pass: boolean
  score: number
  turnsEvaluated: number
  turnsFailed: number
}

/** The full run scorecard. `pass` = every GATE dimension passes. */
export interface PlannerScorecard {
  runName: string
  scenarios: number
  turns: number
  dimensions: DimensionRollup[]
  evals: TurnEval[]
  outcomes: TurnOutcome[]
  /** ⚠ What the run BILLED, summed from real usage — never what it planned to bill. CLAUDE.md:
   *  "a paid one reports what it BILLED, not what it planned." */
  usd: number
  pass: boolean
}

/** A scenario replayed into the transcript shape ./planner consumes. Exported for the tests. */
export type Transcript = PlannerTurnInput[]
