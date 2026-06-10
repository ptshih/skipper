// LLM-judge pass for SEMANTIC closer monotony — the residual the deterministic
// lint (lint.ts) cannot catch.
//
// The deterministic lint flags LEXICAL/STRUCTURAL repeats (shared words, banned
// phrases, duplicate opener/closer signatures). It is blind to the
// personification-kicker problem: two stops that end "the water showing off" and
// "Tahoe, generous to a fault" share no words yet pull the same trick — personify
// the place / sum it up with a tidy aphorism. Over a drive that sameness reads as
// formulaic. One Anthropic call per generation classifies each stop's CLOSING MOVE
// and flags the over-used ones; results come back in the deterministic lint's
// LintFinding shape, so generate.ts feeds them through the SAME `avoid` regen hook.
//
// Gated behind a flag in generate.ts (it adds one model call + non-determinism);
// the deterministic lint stays the always-on baseline.

import Anthropic from '@anthropic-ai/sdk'
import { JUDGMENT_MODEL } from '../models'
import { recordModelUsage } from './spend'
import type { LintFinding } from './lint'

// A light classification task on the shared JUDGMENT_MODEL (Opus) — one forced-tool
// ({type:'tool'}) call per tour, which is why it can't ride NARRATION_MODEL/Fable.
const JUDGE_MODEL = JUDGMENT_MODEL
const JUDGE_MAX_TOKENS = 2_000

export interface CloserInput {
  seq: number
  script: string
}

/** The last `n` sentences of a script — the "closing line(s)" we judge. */
export function lastSentences(script: string, n = 2): string {
  const parts = script.trim().split(/(?<=[.!?])\s+/).filter(Boolean)
  return parts.slice(-n).join(' ')
}

interface FlaggedCloser {
  seq: number
  move: string
  reason: string
}

/** Map the model's flagged closers into the deterministic lint's finding shape. */
export function toFindings(flagged: FlaggedCloser[]): LintFinding[] {
  return flagged.map((f) => ({
    seq: f.seq,
    reasons: [`closing-move monotony — leans on "${f.move}" (${f.reason})`],
    avoid: [
      `Close with a DIFFERENT KIND of move than "${f.move}". Too many stops on this tour end the same way — ` +
        `most often by personifying the place, with a tidy one-liner, on a reflective lesson/summary of what ` +
        `the stop "was about," or on a recap that re-lists facts you already gave. End THIS stop instead on a ` +
        `concrete fact, a plain sensory image, a question, or plain understatement; do NOT personify the place, ` +
        `do NOT end on a cute aphorism, a lesson, a moral, a recap/menu of the stop, or an atmospheric no-new-fact ` +
        `sign-off. And do NOT reach for a wind-up or canned tic ("here is the...", "wait for it") to replace the ` +
        `ending — just stop on the last real, concrete beat.`,
    ],
  }))
}

const SYSTEM = `You are a narration editor for an AI-narrated road-trip tour. You are given the CLOSING line(s) of each stop on ONE tour, in order. Your ONLY job is to catch CLOSING-MOVE MONOTONY: when too many stops end with the same RHETORICAL MOVE even though the words differ, so the endings feel formulaic.

Three moves to watch most. (1) PERSONIFYING THE PLACE or ending on a tidy aphorism — e.g. "the water showing off," "Smart island," "she earned the medal," "Tahoe, generous to a fault," "the meadow gets the last word." Those share no words but are the same trick: hand the landscape a human verb, or sum the stop up with a cute one-liner. (2) The REFLECTIVE BUTTON — closing on a little lesson, a moral, or a summary of what the stop "was really about": "there's a lesson in there somewhere," "the small one in the room, holding its own," "the lake remembers," "not bad for a place nobody planned." (3) The RECAP CLOSER — a final beat that re-lists facts already given (a little menu of the stop's stats: "a lighthouse, a rock, and a man named Bliss"; "twenty-seven events, thirty flags") or an atmospheric sign-off that adds no new fact ("the quiet does the rest," "and the lake just keeps on being the lake"). All three turn a story into a school essay; they are the move a LONGER stop falls into hardest, so weight them heavily. Other (good) moves include: a self-deprecating personal aside, a rhetorical question, a plain sensory image, restating ONE key fact, or dry understatement.

Rules:
- A move used once or twice across a tour is GOOD variety. Flag a move only when it is OVERUSED — roughly more than a third of the stops lean on it.
- When a move is overused, keep the SINGLE best instance and flag the REST to be re-written with a different kind of ending.
- Judge ONLY the closing move. Never flag for content, facts, or anything mid-stop.
- If the endings are already varied, flag nothing.

Call the report tool: classify every stop's closing move, then list the stops to change.`

const REPORT_TOOL: Anthropic.Tool = {
  name: 'report',
  description: 'Report each stop\'s closing move and which stops to rewrite for variety.',
  input_schema: {
    type: 'object',
    properties: {
      moves: {
        type: 'array',
        description: "Every stop's closing move (one entry per stop).",
        items: {
          type: 'object',
          properties: {
            seq: { type: 'integer' },
            move: { type: 'string', description: 'short name for the rhetorical move, e.g. "personify the place"' },
          },
          required: ['seq', 'move'],
          additionalProperties: false,
        },
      },
      flagged: {
        type: 'array',
        description: 'The over-used-move stops to rewrite (empty if endings are already varied).',
        items: {
          type: 'object',
          properties: {
            seq: { type: 'integer' },
            move: { type: 'string', description: 'the over-used move this closer exemplifies' },
            reason: { type: 'string', description: 'one short clause on why it is redundant' },
          },
          required: ['seq', 'move', 'reason'],
          additionalProperties: false,
        },
      },
    },
    required: ['moves', 'flagged'],
    additionalProperties: false,
  },
}

let cached: Anthropic | undefined
function getClient(): Anthropic {
  if (!cached) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set (closer judge needs it).')
    cached = new Anthropic()
  }
  return cached
}

/**
 * Judge the assembled closers for semantic monotony. Returns findings (lint shape)
 * for the over-used-move stops, or [] if the endings are varied. Best-effort: any
 * model/parse error returns [] so the judge can never block a valid tour.
 */
export async function judgeCloserDiversity(stops: CloserInput[]): Promise<LintFinding[]> {
  if (stops.length < 4) return [] // too few endings to be "monotonous"
  const userMessage =
    'Closing line(s) of each stop, in order:\n\n' +
    stops.map((s) => `[stop ${s.seq}] ${lastSentences(s.script)}`).join('\n')

  const response = await getClient().messages.create({
    model: JUDGE_MODEL,
    max_tokens: JUDGE_MAX_TOKENS,
    system: SYSTEM,
    tools: [REPORT_TOOL],
    tool_choice: { type: 'tool', name: 'report' },
    messages: [{ role: 'user', content: userMessage }],
  })
  recordModelUsage(JUDGE_MODEL, response.usage)

  const call = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  if (!call) return []
  const input = call.input as { flagged?: FlaggedCloser[] }
  const flagged = (input.flagged ?? []).filter((f) => stops.some((s) => s.seq === f.seq))
  return toFindings(flagged)
}
