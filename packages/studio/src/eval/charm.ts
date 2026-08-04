// CHARM evaluator — "is the persona actually charming?" — an ADVISORY dimension.
//
// "The persona is the product," but charm is SUBJECTIVE, so this never gates a tour: it
// informs (the regen `avoid[]` hook + the human-calibrated flywheel). It is the reusable
// CORE of the charm judge — the system prompt, the report tool, and judgeCharm() — extracted
// here so BOTH the eval panel (charmEvaluator → StopEval[]) and the standalone
// writing+voice report CLI (judge-voice.ts) share ONE source (no duplicated rubric to drift).
//
// The judge call is INJECTABLE so the StopEval mapping is unit-tested with no spend; the real
// judge is Opus (charm needs nuance) — one call per tour, so the eval CLI gates it behind
// --charm to keep the default audit cheap (grounding Opus + free deterministic dims).

import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { JUDGMENT_MODEL } from '../models'
import { callTool } from '../pipeline/tool-call'
import type { StopEval } from './types'

/** A stop below this charm score (1-10) is "the man is not in the room" — flag it (advisory). */
export const CHARM_PASS_THRESHOLD = 5

/** The minimal stop shape the charm judge reads (decoupled from the changing StopSummary). */
export interface CharmStop {
  seq: number
  stopType: string
  name: string
  script: string
}

// The verdict shape, as ONE definition. It used to be an interface beside a hand-written JSON Schema
// beside a cast — three copies of one contract, and the cast is the copy that lied: `call.input as
// CharmVerdict` asserted a shape nothing ever checked, so a charm of 11, a missing `sag` or an off-enum
// recommendation flowed straight into the scores the panel reports. Zod collapses the interface and the
// runtime check into one; REPORT_TOOL below stays hand-written on purpose (see its comment).
const STOP_VERDICT = z.object({
  seq: z.number().int(),
  charm: z.number().int().min(1).max(10),
  best: z.string(), // the beat that works (short quote/paraphrase)
  sag: z.string(), // where it falls flat (short)
})

const CHARM_VERDICT = z.object({
  stops: z.array(STOP_VERDICT),
  overall: z.number().int().min(1).max(10),
  verdict: z.string(),
  recommendation: z.enum(['ship', 'tune', 'rework']),
  weakestStops: z.array(z.number().int()),
  biggestRisk: z.string(),
})

export type StopVerdict = z.infer<typeof STOP_VERDICT>
export type CharmVerdict = z.infer<typeof CHARM_VERDICT>

const CHARM_SYSTEM = `You are a tough, tasteful editor judging an AI-narrated road-trip tour for ONE thing: CHARM. The product's whole thesis is "the persona is the product" — the voice is a warm, corny road-trip tour guide with the soul of a Jungle-Cruise ride skipper — a deadpan, pun-cracking showman narrating a drive (he is NOT a boat captain; the car-as-boat framing is retired, so flag nautical conceits as off-persona). The voice is the corniest setting, but it is QUALITY over quantity: one or two BEST groaners per stop woven into a warm telling, NOT a dense pile of puns or a pun-chain. You are reading the WORDS of each stop (the TTS voice is judged separately, by ear).

Judge CHARM, not accuracy — grounding is a different gate; assume the facts are fine. Be HONEST and skeptical: competent is NOT charming. The bar is a real passenger reaction — a smile, a fond eye-roll/groan, a "huh, really" — versus the failure mode of a capable AI reading Wikipedia with a captain's hat glued on. Reward: genuine warmth and earnestness that means it, dad jokes that land the right GROAN (corny on purpose, not clever), surprise, a distinct human voice, fresh openers/closers. Penalize: travel-brochure voice, AI-chatbot tics, the encyclopedia shape (topic sentence → facts → reflective bow), jokes that try too hard, don't land, pile up into pun-chains, or are absent where the material plainly hands you one, sameyness across stops, and anything that sounds generated rather than spoken by a specific man.

Judge each stop appropriately for its TYPE: STORY is the showcase (it should charm); SCENIC is a short mood beat with no facts (judge the feeling, not jokes); BREAK is a brief named "good spot to pull off" cue (judge warmth + a light groan, keep expectations low).

Use the FULL 1-10 scale, anchored as follows. Do NOT default high or low — place each score at the anchor it actually earns:
- 1-2: brochure/encyclopedia voice. Reads like an AI reciting Wikipedia. No persona, or off-persona.
- 3-4: competent but generic. Information is fine; the man is not in the room. Tics, tired shape, no real laugh.
- 5-6: the persona flickers — one beat lands, the rest is filler or sags. Fixable.
- 7-8: solidly charming. A clear human voice, jokes that land, fresh shape. This is SHIP-quality writing.
- 9: genuinely delightful — surprises you, earns a real groan or grin, nothing sags.
- 10: reserve for a stop you'd quote to a friend. Rare.

For each stop give: a charm score 1-10, the single BEST beat (quote or tight paraphrase), and where it SAGS (the weakest beat — be specific). Then for the whole tour: an overall 1-10, an honest 2-3 sentence verdict, a recommendation, the weakest stops, and the SINGLE biggest charm risk. recommendation: "ship" = overall 7 or higher with no stop below 5; "tune" = good bones but at least one stop drags it down (one or more stops at 3-4, or overall 5-6); "rework" = overall 4 or lower, reads as competent AI, not the skipper. Score what is on the page, not what you wish were there. Call the report tool.`

// ⚠ HAND-WRITTEN ON PURPOSE — do not derive this from CHARM_VERDICT. The tool schema is part of the
// prompt, and this judge's thresholds were calibrated against Opus-tier judging (`models.ts`: "moving
// this would silently shift every score — re-run eval/calibrate.ts after any bump"). A derived schema is
// NOT byte-identical: measured 2026-08-04, zod renders an integer with safe-integer `minimum`/`maximum`
// where this carries a bare `{type:'integer'}`, and no zod spelling avoids it. So the schema goes over
// the wire unchanged and only the REPLY is validated — deriving it here would be a re-calibration.
const REPORT_TOOL: Anthropic.Tool = {
  name: 'report',
  description: 'Report per-stop charm scores and the tour-level verdict.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['stops', 'overall', 'verdict', 'recommendation', 'weakestStops', 'biggestRisk'],
    properties: {
      stops: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['seq', 'charm', 'best', 'sag'],
          properties: {
            seq: { type: 'integer' },
            charm: { type: 'integer', minimum: 1, maximum: 10 },
            best: { type: 'string', description: 'the beat that works (short quote/paraphrase)' },
            sag: { type: 'string', description: 'the weakest beat — specific' },
          },
        },
      },
      overall: { type: 'integer', minimum: 1, maximum: 10 },
      verdict: { type: 'string', description: '2-3 honest sentences on whether the persona charms' },
      recommendation: { type: 'string', enum: ['ship', 'tune', 'rework'] },
      weakestStops: { type: 'array', items: { type: 'integer' } },
      biggestRisk: { type: 'string', description: 'the single biggest charm risk, one line' },
    },
  },
}

/** The charm judge — one Opus call scoring every stop's writing.
 *
 *  Throws on a missing report OR one that does not match `CHARM_VERDICT`, and that is safe here because
 *  the only caller already treats this dimension as droppable: `audit-corpus.ts` wraps it in try/catch
 *  ("advisory; a failure is non-fatal, skipped") and prints a warning. So a malformed report now costs
 *  the charm dimension for that run and SAYS so, where it used to silently corrupt the scores instead.
 *  The spend tally moved inside `callTool`, above both throws — the ordering this call learned on
 *  2026-08-02, when the charm judge's share of every run read $0.00. */
export async function judgeCharm(stops: CharmStop[]): Promise<CharmVerdict> {
  const userMessage = stops
    .map((s) => `[stop ${s.seq}] ${s.stopType.toUpperCase()} — ${s.name}\n${s.script}`)
    .join('\n\n')
  return callTool({
    model: JUDGMENT_MODEL,
    system: CHARM_SYSTEM,
    messages: [{ role: 'user', content: `Every narrated stop on the tour, in order:\n\n${userMessage}` }],
    maxTokens: 8_000,
    tool: { name: REPORT_TOOL.name, description: REPORT_TOOL.description ?? '' },
    schema: CHARM_VERDICT,
    inputSchema: REPORT_TOOL.input_schema,
    label: 'Charm judge',
  })
}

/** The judge call shape — injectable so the StopEval mapping is testable without spend. */
export type CharmJudge = (stops: CharmStop[]) => Promise<CharmVerdict>

/** Map a CharmVerdict's per-stop scores into advisory StopEvals for the panel. */
export function charmToStopEvals(verdict: CharmVerdict): StopEval[] {
  return verdict.stops.map((s) => ({
    seq: s.seq,
    dimension: 'charm',
    pass: s.charm >= CHARM_PASS_THRESHOLD,
    score: s.charm / 10,
    findings: s.charm < CHARM_PASS_THRESHOLD ? [`charm ${s.charm}/10 — sags: ${s.sag}`] : [],
    detail: { best: s.best, sag: s.sag, charm: s.charm },
  }))
}

/** Run the charm judge over a tour's stops → advisory StopEvals (one per scored stop). */
export async function charmEvaluator(stops: CharmStop[], judge: CharmJudge = judgeCharm): Promise<StopEval[]> {
  const verdict = await judge(stops)
  return charmToStopEvals(verdict)
}
