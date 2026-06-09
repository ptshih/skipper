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
// --charm to keep the default audit cheap (grounding Sonnet + free deterministic dims).

import Anthropic from '@anthropic-ai/sdk'
import { FORCED_TOOL_JUDGE_MODEL } from '../models'
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

export interface StopVerdict {
  seq: number
  charm: number // 1-10
  best: string // the beat that works (short quote/paraphrase)
  sag: string // where it falls flat (short)
}

export interface CharmVerdict {
  stops: StopVerdict[]
  overall: number // 1-10
  verdict: string
  recommendation: 'ship' | 'tune' | 'rework'
  weakestStops: number[]
  biggestRisk: string
}

const CHARM_SYSTEM = `You are a tough, tasteful editor judging an AI-narrated road-trip tour for ONE thing: CHARM. The product's whole thesis is "the persona is the product" — the voice is a warm, corny road-trip tour guide with the soul of a Jungle-Cruise ride skipper — a deadpan, pun-cracking showman narrating a drive (he is NOT a boat captain; the car-as-boat framing is retired, so flag nautical conceits as off-persona). The default joke notch is "dadpocalypse" — the corniest setting, but it is QUALITY over quantity: one or two BEST groaners per stop woven into a warm telling, NOT a dense pile of puns or a pun-chain. You are reading the WORDS of each stop (the TTS voice is judged separately, by ear).

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

let cached: Anthropic | undefined
function getClient(): Anthropic {
  if (!cached) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set (the charm judge needs it).')
    cached = new Anthropic()
  }
  return cached
}

/** The charm judge — one Opus call scoring every stop's writing. Throws on a missing report. */
export async function judgeCharm(stops: CharmStop[]): Promise<CharmVerdict> {
  const userMessage = stops
    .map((s) => `[stop ${s.seq}] ${s.stopType.toUpperCase()} — ${s.name}\n${s.script}`)
    .join('\n\n')
  const response = await getClient().messages.create({
    model: FORCED_TOOL_JUDGE_MODEL,
    max_tokens: 8_000,
    system: CHARM_SYSTEM,
    tools: [REPORT_TOOL],
    tool_choice: { type: 'tool', name: 'report' },
    messages: [{ role: 'user', content: `Every narrated stop on the tour, in order:\n\n${userMessage}` }],
  })
  const call = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  if (!call) throw new Error('Charm judge returned no structured report.')
  return call.input as CharmVerdict
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
