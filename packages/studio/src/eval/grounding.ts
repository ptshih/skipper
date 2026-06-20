// GROUNDING evaluator — the crown-jewel gate.
//
// The product's cardinal invariant is "persona lives in DELIVERY, never in FACTS": every
// claim a stop makes about its PLACE must trace to that stop's fact sheet. The studio pipeline's
// system prompt TEACHES this; this evaluator CHECKS it, after the fact, on the finished
// script — turning the human-ear / ad-hoc-audit gate into a standing, near-objective one.
//
// Why this can be a hard GATE (not a fuzzy judge): grounding is checkable. We don't ask
// "is this grounded?" holistically — we DECOMPOSE the script into atomic place-claims and
// classify each against the permitted well (entailment), mirroring the exact contract the
// studio pipeline is told to follow (skipper.ts "THE ONE RULE ABOVE ALL"): hedging doesn't launder
// an invented fact; a number computed from sheet facts is still invented; only naming the
// region/corridor + plain world-knowledge are sheet-free.
//
// The model call (decompose) is INJECTED, so the scoring/aggregation logic is unit-tested
// with a deterministic fake and zero API spend (see test/eval-grounding.test.ts). The real
// implementation mirrors judge.ts: lazy client + tool-use structured output.

import Anthropic from '@anthropic-ai/sdk'
import type { StopType } from '@skipper/shared'
import { getAnthropic, JUDGMENT_MODEL } from '../models'
import { recordModelUsage } from '../pipeline/spend'
import type { ClaimStatus, ClaimVerdict, StopEval } from './types'

// A well-scoped, once-per-stop entailment task on the shared JUDGMENT_MODEL (Opus).
// Grounding is the crown-jewel gate — a false negative lets a hallucination ship — so it
// rides the strongest forced-tool-capable model. It's a forced-tool ({type:'tool'}) call,
// so it pins JUDGMENT_MODEL (Opus 4.8). Re-run eval/calibrate.ts after any model change.
const GROUNDING_MODEL = JUDGMENT_MODEL
const GROUNDING_MAX_TOKENS = 4_000

/** One stop's narration + the EXACT well of facts it was permitted to draw from. */
export interface GroundingInput {
  seq: number
  stopType: StopType
  /** The named place (story/break, and a NAMED scenic feature — whose name/kind/side line
   *  must then be ON the well; an unnamed scenic omits this and may name no landmark). */
  placeName?: string
  /** The narration script under test. */
  script: string
  /** The permitted facts — the whole well the narrator was given. Build it with
   *  buildGroundingWell so it carries EVERYTHING the narrator could legitimately say
   *  (facts + geology + wikidata + merged-feature facts + the named-scenic/side lines) —
   *  a well thinner than the narrator's sheet false-flags grounded claims. */
  well: string[]
  /** Ambient carve-out: NAMING these (not asserting facts about them) is allowed sheet-free. */
  region: string
  /** OPTIONAL named stretch — the shared atom (roam corpus) names no corridor (it plays on any route). */
  corridor?: string
  /** Sanctioned-callback carve-out: names of OTHER stops on this drive. The narrator is fed
   *  earlier stops for earned callbacks, so RECALLING one (asserting nothing new about it)
   *  is delivery, not an invented place-fact. */
  otherStops?: string[]
}

/**
 * The minimal stop shape the well builder reads — structural, so both the LIVE pipeline
 * (the narration core, from a StopPlan) and the artifact auditor (the eval panel, from a
 * result JSON) build the SAME well and can never drift apart on what the narrator was
 * permitted to say.
 */
export interface GroundingWellStop {
  stopType: StopType
  /** The place name as narrated (story/break; a NAMED scenic feature). */
  name?: string | null
  /** Sayable kind (story/scenic: the POI kind; break: the SPOKEN kind, post-spokenKind). */
  kind?: string | null
  sideOfRoad?: 'left' | 'right'
  facts?: string[]
  geology?: string[]
  wikidata?: string[]
  /** Co-located landmarks merged into this stop — their facts are part of the permitted well. */
  mergedFeatures?: { name: string; facts: string[] }[]
}

/**
 * Build the EXACT permitted well for one stop, mirroring what narrate.ts put on the sheet:
 * story facts, geology, wikidata, each merged feature's facts (name-prefixed so a claim about
 * the feature traces), plus the sayable-by-contract lines that aren't "facts" on the sheet but
 * ARE licensed delivery — a named scenic's name/kind/side, a break's name/kind, the side of
 * the road. Omitting those false-flags the narrator for saying what it was told to say.
 */
export function buildGroundingWell(s: GroundingWellStop): string[] {
  const well: string[] = []
  if (s.stopType === 'story') {
    // facts / wikidata / merged features are STORY-only channels — gating them here keeps a
    // mislabeled input from ever blessing identifying place-facts on a scenic/break well.
    well.push(...(s.facts ?? []))
    if (s.sideOfRoad)
      well.push(`${s.name || 'This place'} is on the ${s.sideOfRoad} side of the road.`)
    well.push(...(s.wikidata ?? []))
    for (const m of s.mergedFeatures ?? []) for (const f of m.facts) well.push(`${m.name}: ${f}`)
  } else if (s.stopType === 'scenic' && s.name) {
    // The named-scenic contract (narrate.ts): name + kind + side are sayable; nothing the name implies is.
    well.push(
      `You are passing ${s.name}${s.kind ? `, a ${s.kind},` : ''}${s.sideOfRoad ? ` on the ${s.sideOfRoad}` : ''} — its name, its kind, and which side it is on are the only things this line licenses.`,
    )
  } else if (s.stopType === 'break' && s.name) {
    well.push(`A rest spot named ${s.name}${s.kind ? ` (a ${s.kind})` : ''} is coming up.`)
  }
  // Geology rides story AND scenic (the one fact channel a scenic stop is permitted).
  if (s.stopType !== 'break') well.push(...(s.geology ?? []))
  return well
}

/** The model call that decomposes a script into classified claims. Injectable for tests. */
export type ClaimDecomposer = (input: GroundingInput) => Promise<ClaimVerdict[]>

const CLAIM_STATUSES: readonly ClaimStatus[] = ['grounded', 'ambient', 'ungrounded']

const SYSTEM = `You audit ONE stop of an AI-narrated road-trip tour for GROUNDING — nothing else. You are given (a) the FACT SHEET: the ONLY facts the narrator was permitted to use for this stop, and (b) the SCRIPT the narrator produced.

Decompose the SCRIPT into every distinct factual CLAIM IT MAKES ABOUT A PLACE — a name, date, year, number (elevation/depth/height/distance/age/acreage/count), event, cause or reason, significance or ranking, comparison, or relationship to something nearby. For EACH claim, classify it:

- "grounded": it traces to a specific FACT SHEET line — including a claim that merely RESTATES a line in equivalent terms: the same relationship read from the other side ("hired by his aunt X" grounds "he was X's nephew"), or a plain rewording that adds no new quantity, date, entity, or cause. Put that line (quoted or closely paraphrased) in "evidence".
- "ambient": it asserts no checkable fact about THIS stop's place beyond the sheet. This covers: (a) it ONLY names or frames the tour's REGION or CORRIDOR (you are told both); (b) plain world-knowledge that asserts no fact about any specific place (the sky is big, mountain mornings are cold); (c) a general fact about a TYPE, STYLE, or CATEGORY the place belongs to — true of that category everywhere and saying nothing specific about THIS place (what a Queen Anne house looks like in general; what a "toll road" or "county seat" means by definition); (d) a widely-known basic fact about a DIFFERENT, well-known place named only as a frame or comparison (that a named valley city sits low and flat); OR (e) it merely RECALLS an earlier stop on this drive (the input may list the drive's other stops; a callback that names one while asserting nothing new about it is delivery — any NEW fact about it must still trace to the sheet). Put which carve-out in "evidence".
- "ungrounded": it is a place-fact that is NOT on the sheet. This includes a claim wrapped in a hedge ("I bet", "probably", "must have been", "I imagine", "they say", "legend has it") — hedging does NOT launder an invented fact — AND a number COMPUTED from sheet facts (e.g. subtracting two given years to state a span/age). Put null in "evidence".

Rules:
- Be adversarial: when a place-claim is borderline, prefer "ungrounded" over letting a possibly-invented fact pass. Naming/ranking/relating the stop to the REGION itself ("one of Tahoe's prettiest coves") is a place-fact unless it is on the sheet.
- The general-knowledge carve-outs (c)/(d) NEVER launder a checkable fact about THIS place: its own dates, size, depth, elevation, distance, count, event, ranking or superlative, or NAMING ORIGIN ("named for the view"), and any number COMPUTED from sheet facts (a span or age from two given years), stay "ungrounded" even when phrased as common knowledge. The carve-out is only for facts true independently of this stop — a category trait, a definition, or a basic fact about a different well-known place.
- Judge ONLY assertions of fact. Do NOT flag delivery, jokes, voice, or sensory coloring that asserts no place-fact ("she's a beaut", "the water's that impossible blue").
- Stop-type rules: a SCENIC stop may assert NO place-fact beyond its sheet — the sheet may carry GEOLOGY lines and (for a NAMED scenic feature) a line giving its name, kind, and side of the road, each sayable exactly as given; naming any OTHER peak/town/island/landmark on a scenic stop is "ungrounded", and a given name licenses NOTHING it implies (no history, no size or depth, no "famous"/"popular", no character). A BREAK stop may name only the given place + its category; anything else about it is "ungrounded".

Call the report tool with one entry per claim. If the script makes no factual place-claims at all, report an empty list.`

const REPORT_TOOL: Anthropic.Tool = {
  name: 'report',
  description: 'Report every factual place-claim the script makes and whether it is grounded.',
  input_schema: {
    type: 'object',
    properties: {
      claims: {
        type: 'array',
        description: 'One entry per distinct factual place-claim (empty if the script makes none).',
        items: {
          type: 'object',
          properties: {
            claim: { type: 'string', description: 'the asserted place-fact, in your own words' },
            status: { type: 'string', enum: ['grounded', 'ambient', 'ungrounded'] },
            evidence: {
              type: ['string', 'null'],
              description: 'grounded → the sheet line; ambient → which carve-out; ungrounded → null',
            },
          },
          required: ['claim', 'status', 'evidence'],
          additionalProperties: false,
        },
      },
    },
    required: ['claims'],
    additionalProperties: false,
  },
}

function buildUserMessage(input: GroundingInput): string {
  const well =
    input.well.length > 0
      ? input.well.map((f) => `- ${f}`).join('\n')
      : '(empty — this stop was given NO place-facts)'
  const otherStops = (input.otherStops ?? []).filter((n) => n && n !== input.placeName)
  return [
    `REGION: ${input.region}`,
    ...(input.corridor ? [`CORRIDOR: ${input.corridor}`] : []),
    `STOP TYPE: ${input.stopType.toUpperCase()}`,
    input.placeName ? `PLACE: ${input.placeName}` : 'PLACE: (unnamed scenic stop)',
    ...(otherStops.length > 0
      ? [
          '',
          'OTHER STOPS ON THIS DRIVE (recalling one by name is a sanctioned callback — ambient; any NEW fact about one must still trace to the sheet):',
          ...otherStops.map((n) => `- ${n}`),
        ]
      : []),
    '',
    'FACT SHEET (the entire permitted well — anything not here is not on the sheet):',
    well,
    '',
    'SCRIPT:',
    input.script,
  ].join('\n')
}

/** Coerce the model's raw `claims` value into ClaimVerdicts — never trust the wire.
 *  The forced-tool schema declares `claims` an array, but the model can still emit a
 *  non-array: a lone claim object (recovered here as a one-element list) or
 *  null/primitive (treated as "no claims"). A non-array used to crash `.map` — the bug
 *  this fixes. An unrecognized per-claim status is treated as `ungrounded`: a malformed
 *  claim is a violation, never silently passed. */
export function normalizeClaims(raw: unknown): ClaimVerdict[] {
  const list: unknown[] = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : []
  return list.map((c): ClaimVerdict => {
    const o = (c ?? {}) as Record<string, unknown>
    const status = CLAIM_STATUSES.includes(o.status as ClaimStatus)
      ? (o.status as ClaimStatus)
      : 'ungrounded'
    return {
      claim: typeof o.claim === 'string' ? o.claim : '(unspecified claim)',
      status,
      evidence: typeof o.evidence === 'string' ? o.evidence : null,
    }
  })
}

/** The real, Anthropic-backed decomposer (tool-use structured output). */
export const anthropicDecomposer: ClaimDecomposer = async (input) => {
  const response = await getAnthropic('grounding eval needs it').messages.create({
    model: GROUNDING_MODEL,
    max_tokens: GROUNDING_MAX_TOKENS,
    system: SYSTEM,
    tools: [REPORT_TOOL],
    tool_choice: { type: 'tool', name: 'report' },
    messages: [{ role: 'user', content: buildUserMessage(input) }],
  })
  recordModelUsage(GROUNDING_MODEL, response.usage)
  const call = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  if (!call) throw new Error(`Grounding eval: model returned no tool call for stop ${input.seq}.`)
  const rawClaims = (call.input as { claims?: unknown }).claims
  if (rawClaims != null && !Array.isArray(rawClaims)) {
    // Visibility for recurrence — this shape used to crash `.map`; it is now coerced, not dropped.
    console.warn(
      `Grounding eval: model returned non-array 'claims' (${typeof rawClaims}) for stop ${input.seq} — coercing.`,
    )
  }
  // Never trust the wire — the schema constrains the model, but coerce defensively anyway.
  return normalizeClaims(rawClaims)
}

/**
 * Score one stop's grounding. PASS = zero ungrounded claims (the hard gate). The score is
 * the share of claims that are grounded-or-ambient, so a stop with one slip among many
 * still reads as "mostly grounded" while still FAILING the gate.
 */
export async function evaluateGrounding(
  input: GroundingInput,
  decompose: ClaimDecomposer = anthropicDecomposer,
): Promise<StopEval> {
  const claims = await decompose(input)
  const ungrounded = claims.filter((c) => c.status === 'ungrounded')
  const total = claims.length
  return {
    seq: input.seq,
    dimension: 'grounding',
    pass: ungrounded.length === 0,
    score: total === 0 ? 1 : (total - ungrounded.length) / total,
    findings: ungrounded.map(
      (c) => `ungrounded place-claim: "${c.claim}"` + (c.evidence ? ` — ${c.evidence}` : ''),
    ),
    detail: claims,
  }
}
