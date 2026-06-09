// Pairwise charm judge — "is version A more charming than version B?"
//
// WHY this exists alongside the absolute charm judge (judge-voice.ts): an absolute
// 1-10 charm score is the wrong tool for GATING a self-improvement loop. A
// judge-fix experiment (3 designs x real improved/original/degraded scripts, 5
// rolls each) found the absolute judge has WEAK, even INVERTED discrimination on
// subtle-but-real edits — it scored hand-improved scripts 0.2 *below* their
// originals, because good writing compresses into the 7-8 band where a maturing
// tour already lives. The pairwise design instead asks the one question a loop
// needs ("is the new draft better than the current best?") and got it right ~0.94
// of the time on subtle pairs, 1.0 on an obvious pair, and a correct TIE on
// identical input (no hallucinated difference). Position bias was a benign 0.54
// and is cancelled by always running BOTH orderings.
//
// Use: gatePairwise(candidate, baseline) -> accept the edit iff candidate wins a
// strict majority across rolls in both orders (ties and baseline-wins count
// AGAINST it, so the loop is monotone — it only moves on real evidence).
//
// This is the GATE for the loop. The recalibrated absolute judge (judge-voice.ts)
// stays the human-facing 1-10 ship score; do not use its threshold as the gate.

import Anthropic from '@anthropic-ai/sdk'
import { FORCED_TOOL_JUDGE_MODEL } from './models'

const PAIRWISE_SYSTEM = `You are a tough, tasteful editor comparing TWO versions of the SAME road-trip-tour stop, narrated by the same persona: a warm, corny road-trip guide with the soul of a Jungle-Cruise ride skipper (default joke notch "dadpocalypse"; he is NOT a boat captain — the car-as-boat framing is retired). Judge ONE thing: which version is MORE CHARMING to a real passenger — a smile, a fond eye-roll/groan, a "huh, really" — NOT which is more accurate (assume both are equally grounded) and NOT which is longer. Reward genuine warmth and earnestness, dad jokes that land the right GROAN (corny on purpose, not clever), surprise, a distinct human voice, fresh openers/closers. Penalize travel-brochure voice, AI-chatbot tics, the encyclopedia shape (topic sentence → facts → reflective bow), sameyness, and jokes that try too hard or don't land. Pick "A", "B", or "tie". Only answer "tie" if they are genuinely indistinguishable in charm — a small but real edge is NOT a tie. Give one sentence of reasoning, then call the report tool.`

const PAIR_TOOL: Anthropic.Tool = {
  name: 'report',
  description: 'Report which version is more charming.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['winner', 'reason'],
    properties: {
      winner: { type: 'string', enum: ['A', 'B', 'tie'] },
      reason: { type: 'string', description: 'one sentence' },
    },
  },
}

export interface PairVerdict {
  winner: 'A' | 'B' | 'tie'
  reason: string
}

/** One pairwise comparison. Caller controls slot order (run both ways to cancel bias). */
export async function comparePairwise(a: string, b: string): Promise<PairVerdict> {
  if (!process.env.ANTHROPIC_API_KEY)
    throw new Error('ANTHROPIC_API_KEY is not set (the pairwise judge needs it).')
  const res = await new Anthropic().messages.create({
    model: FORCED_TOOL_JUDGE_MODEL,
    max_tokens: 1_000,
    system: PAIRWISE_SYSTEM,
    tools: [PAIR_TOOL],
    tool_choice: { type: 'tool', name: 'report' },
    messages: [{ role: 'user', content: `Version A:\n${a}\n\n---\n\nVersion B:\n${b}` }],
  })
  const call = res.content.find((x): x is Anthropic.ToolUseBlock => x.type === 'tool_use')
  if (!call) throw new Error('pairwise judge returned no structured report.')
  return call.input as PairVerdict
}

export interface GateResult {
  accept: boolean
  winsCandidate: number
  winsBaseline: number
  ties: number
  n: number
  /** candidate won in BOTH slot orders at least once (guards against pure position bias). */
  bothOrders: boolean
  verdicts: { order: 'cand-first' | 'base-first'; winner: PairVerdict['winner']; reason: string }[]
}

/**
 * Gate one edit: compare `candidate` against `baseline` over `rolls` prompts in
 * BOTH orders (2*rolls comparisons). ACCEPT iff candidate takes a strict
 * supermajority (>= ceil(2/3 * n)) AND won in both slot orders at least once.
 * Ties and baseline-wins both count against the candidate, so a coin-flip never
 * promotes an edit — the loop only ever moves on evidence the new draft is better.
 */
export async function gatePairwise(candidate: string, baseline: string, rolls = 3): Promise<GateResult> {
  const jobs: Promise<{ order: 'cand-first' | 'base-first'; v: PairVerdict }>[] = []
  for (let i = 0; i < rolls; i++) {
    jobs.push(comparePairwise(candidate, baseline).then((v) => ({ order: 'cand-first' as const, v })))
    jobs.push(comparePairwise(baseline, candidate).then((v) => ({ order: 'base-first' as const, v })))
  }
  const results = await Promise.all(jobs)

  let winsCandidate = 0
  let winsBaseline = 0
  let ties = 0
  let candWinsCandFirst = 0
  let candWinsBaseFirst = 0
  const verdicts: GateResult['verdicts'] = []
  for (const { order, v } of results) {
    // normalize slot -> actual: cand-first => A is candidate; base-first => A is baseline
    let who: 'candidate' | 'baseline' | 'tie'
    if (v.winner === 'tie') who = 'tie'
    else if (order === 'cand-first') who = v.winner === 'A' ? 'candidate' : 'baseline'
    else who = v.winner === 'A' ? 'baseline' : 'candidate'

    if (who === 'candidate') {
      winsCandidate++
      if (order === 'cand-first') candWinsCandFirst++
      else candWinsBaseFirst++
    } else if (who === 'baseline') winsBaseline++
    else ties++
    verdicts.push({ order, winner: v.winner, reason: v.reason })
  }

  const n = results.length
  const threshold = Math.ceil((2 / 3) * n) // 4 of 6 at rolls=3
  const bothOrders = candWinsCandFirst >= 1 && candWinsBaseFirst >= 1
  const accept = winsCandidate >= threshold && bothOrders
  return { accept, winsCandidate, winsBaseline, ties, n, bothOrders, verdicts }
}
