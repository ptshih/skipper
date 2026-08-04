// The PERSONA judge — the advisory half of the panel. "Does this sound like the Skipper?"
//
// ⚠ ADVISORY, NEVER A GATE, and the split is by CHECKABILITY rather than by importance — the same
// rule packages/studio/src/eval/types.ts applies to charm. Persona is taste; the three dimensions in
// ./checks are decided by pure functions and are the ones that block. On a project whose doctrine is
// "the persona is the product" it is tempting to gate on this. Do not: an LLM judge scoring taste
// would block a deploy on a disagreement about a joke.
//
// ⚠ THE JUDGE IS INJECTABLE so the verdict→TurnEval mapping is unit-tested with no spend. Same seam,
// and same reason, as `CharmJudge` in the narration panel.

import Anthropic from '@anthropic-ai/sdk'
import { CLAUDE_MODELS, recordModelUsage, usageUsd } from '@skipper/shared'
import type { PlannerScorecard, TurnEval, TurnOutcome } from './types'

/** A turn below this (1-10) is "the man is not in the room" — flagged, never blocking. */
export const PERSONA_PASS_THRESHOLD = 5

/**
 * The judging tier.
 *
 * ⚠ `CLAUDE_MODELS.opus`, matching `JUDGMENT_MODEL` in packages/studio/src/models.ts — but a SEPARATE
 * reference rather than an import, because `apps/api` does not depend on `@skipper/studio` and must
 * not start (the prompt this panel judges lives here precisely so it cannot reach studio's persona).
 * The shared constant is the common ground; this is the same VALUE, not a second opinion about it.
 *
 * ⚠ NOT `CLAUDE_MODELS.planner`. Judging output with the model that produced it teaches a panel to
 * like its own voice; and studio's note records the other half — the judge rubrics were calibrated at
 * Opus tier, so moving this silently shifts every score.
 */
const JUDGE_MODEL = CLAUDE_MODELS.opus

export interface PersonaTurnVerdict {
  scenarioId: string
  index: number
  persona: number
  /** What works, in a few words. */
  best: string
  /** Where it falls flat — specific. */
  sag: string
  /** True when the line reads like a script the rider has seen before. */
  canned: boolean
}

export interface PersonaVerdict {
  turns: PersonaTurnVerdict[]
  overall: number
  verdict: string
  recommendation: 'ship' | 'tune' | 'rework'
  /** ⚠ Optional: a judge forced to name a top risk on a clean run invents one. */
  biggestRisk?: string
}

const PERSONA_SYSTEM = `You are a tough, tasteful editor judging a live text conversation for ONE thing: does the character come through?

The character is "the Skipper" — a road-trip guide with the heart of an old theme-park jungle-boat skipper: deadpan, corny on purpose, warm, and above all HONEST. He is NOT on a boat; nautical framing ("all aboard", a river, a bow) is off-persona and you flag it. He is standing at a car window before a trip, helping folks pick a drive. He talks about WHERE, never WHAT — asked what a place IS, he deflects warmly and promises the road instead, because spoiling it in a parking lot spends the good part early. That deflection is a FEATURE; never score it as evasiveness or unhelpfulness.

He is READ ON A SCREEN, not heard, so judge the writing. Short turns — one to three sentences on most. One good groaner now and then, rationed, not every line.

JUDGE ONLY THE VOICE. Do not judge whether he routed correctly, whether he should have drawn a route, or whether he answered the question "usefully" — separate checks own all of that, and a turn that correctly refuses to answer can still be a 9.

Use the FULL 1-10 scale, anchored:
- 1-2: no persona, or off-persona. Reads like a generic assistant, or reaches for a boat.
- 3-4: competent and flat. The information is fine; the man is not in the room.
- 5-6: the persona flickers — one beat lands, the rest is filler.
- 7-8: solidly in character. A distinct human voice, warm, the corn lands. This is ship-quality.
- 9: genuinely delightful — earns a grin or a fond eye-roll.
- 10: reserve for a line you would quote to a friend. Rare.

⚠ WHAT YOU ARE READING. The blocks below are SEVERAL SEPARATE conversations with DIFFERENT riders, labelled [scenario #turn]. No rider ever sees more than one of them — a transcript dies with the screen, and a rider plans one to three drives in their life. So judge each conversation as its own encounter.

Set \`canned: true\` only for a line that reads like a stock phrase WITHIN ITS OWN CONVERSATION: a deflection recycled almost word-for-word from an earlier turn of the same chat, or a sentence with the cadence of a script rather than of an answer. A phrase that recurs between two DIFFERENT riders' conversations is not something anybody experiences — mention it in \`verdict\` if you find it interesting, but do not set \`canned\` for it, and do not treat it as a risk.

Judge what is on the page. Do not go looking for a particular failure; if the conversations read well, say so plainly.

For each turn give: a 1-10, the best beat, where it sags, and \`canned\`. Then for the whole run: an overall 1-10, an honest 2-3 sentence verdict, and a recommendation. Add \`biggestRisk\` ONLY if something genuinely rises to a risk — omit it on a clean run rather than reaching for one. recommendation: "ship" = overall 7+ with nothing below 5; "tune" = good bones, something drags; "rework" = reads as a generic assistant wearing a hat. Score what is on the page. Call the report tool.`

const REPORT_TOOL: Anthropic.Tool = {
  name: 'report',
  description: 'Report per-turn persona scores and the run-level verdict.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      turns: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['scenarioId', 'index', 'persona', 'best', 'sag', 'canned'],
          properties: {
            scenarioId: { type: 'string' },
            index: { type: 'integer' },
            persona: { type: 'integer', minimum: 1, maximum: 10 },
            best: { type: 'string' },
            sag: { type: 'string' },
            canned: { type: 'boolean', description: 'reads like a stock phrase or repeats an earlier turn' },
          },
        },
      },
      overall: { type: 'integer', minimum: 1, maximum: 10 },
      verdict: { type: 'string', description: '2-3 honest sentences' },
      recommendation: { type: 'string', enum: ['ship', 'tune', 'rework'] },
      // ⚠ OPTIONAL, AND IT USED TO BE REQUIRED — which meant the judge had to name a top risk even on
      // a clean run, and the system prompt had already told it which one to name. A required field
      // that manufactures its own finding is not a measurement.
      biggestRisk: { type: 'string', description: 'Omit entirely if nothing rises to a real risk.' },
    },
    required: ['turns', 'overall', 'verdict', 'recommendation'],
  },
}

export type PersonaJudge = (outcomes: readonly TurnOutcome[]) => Promise<PersonaVerdict>

/** The real judge — ONE call over the whole run, so it can see repetition ACROSS conversations.
 *
 * ⚠ Pinned to the judgement model, not the planner's. Judging with the same model and prompt family
 * that produced the text is how a panel learns to like its own voice.
 * ⚠ `recordModelUsage` runs BEFORE the parse can throw: the tokens are billed the moment the call
 * returns, and a malformed report must not also lose the charge — the exact bug that made the
 * narration charm judge bill invisibly until 2026-08-02. */
export async function judgePersona(outcomes: readonly TurnOutcome[]): Promise<PersonaVerdict> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set — the persona judge needs it')
  const client = new Anthropic({ apiKey: key })

  const body = outcomes
    .map((o) => `[${o.scenarioId} #${o.index}]\nThem: ${o.rider}\nYou: ${o.say}${o.routeKey ? '\n(a route was drawn)' : ''}`)
    .join('\n\n')

  const res = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 8_000,
    system: PERSONA_SYSTEM,
    tools: [REPORT_TOOL],
    tool_choice: { type: 'tool', name: 'report' },
    messages: [{ role: 'user', content: `Every turn of the run, in order:\n\n${body}` }],
  })
  recordModelUsage(JUDGE_MODEL, res.usage)
  const call = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  if (!call) throw new Error('persona judge returned no structured report')
  const verdict = call.input as PersonaVerdict
  // Stashed so the runner can add the judge's own spend to what the run BILLED.
  judgeSpendUsd += usageUsd(JUDGE_MODEL, res.usage)
  return verdict
}

/** What the judge itself billed this process. ⚠ The run's total must include it — a panel that
 *  reports only the replay's spend under-reports, and an under-reporting guard reads as reassurance. */
export let judgeSpendUsd = 0

/** Map a verdict into ADVISORY per-turn evals. */
export function personaToEvals(verdict: PersonaVerdict): TurnEval[] {
  return verdict.turns.map((t) => {
    const findings: string[] = []
    if (t.persona < PERSONA_PASS_THRESHOLD) findings.push(`persona ${t.persona}/10 — sags: ${t.sag}`)
    if (t.canned) findings.push(`reads as canned: ${t.sag}`)
    return {
      scenarioId: t.scenarioId,
      index: t.index,
      dimension: 'persona' as const,
      pass: findings.length === 0,
      score: t.persona / 10,
      findings,
    }
  })
}

/** Roll every eval up into the run scorecard. `pass` = every GATE dimension passes. */
export function rollUp(
  runName: string,
  scenarios: number,
  outcomes: TurnOutcome[],
  evals: TurnEval[],
  usd: number,
): PlannerScorecard {
  // Imported lazily-by-value to keep this module's import list short; the map is a plain const.
  const KIND = {
    routing: 'gate',
    voice: 'gate',
    discipline: 'gate',
    persona: 'advisory',
  } as const

  const dimensions = (Object.keys(KIND) as (keyof typeof KIND)[]).map((dimension) => {
    const mine = evals.filter((e) => e.dimension === dimension)
    const failed = mine.filter((e) => !e.pass)
    return {
      dimension,
      kind: KIND[dimension],
      // ⚠ An UNEVALUATED dimension passes. The alternative — failing on no evidence — would make a
      // judge that never ran (the exact failure CLAUDE.md records) read as a blocked deploy rather
      // than as a missing signal, and the runner reports the judge's absence separately.
      pass: failed.length === 0,
      score: mine.length ? mine.reduce((n, e) => n + e.score, 0) / mine.length : 1,
      turnsEvaluated: mine.length,
      turnsFailed: failed.length,
    }
  })

  return {
    runName,
    scenarios,
    turns: outcomes.length,
    dimensions,
    evals,
    outcomes,
    usd,
    pass: dimensions.filter((d) => d.kind === 'gate').every((d) => d.pass),
  }
}
