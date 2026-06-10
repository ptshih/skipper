// The enrichment SCOUT — a bounded tool-using agent that decides, per STORY stop, what the
// fact well is MISSING and fetches grounded enrichment. It replaces the old char-count
// sparse-gates (GEOLOGY_STORY_MAX_FACT_CHARS / WIKIDATA_STORY_MAX_FACT_CHARS) and the
// hand-curated GEOLOGY_ICONIC_STOPS allowlist with judgment: read the sheet, reason about
// what the telling lacks (a date? the rock? a namesake?), fetch it, decide how it should
// land. See docs/decisions/enrichment-scout.md.
//
// THE SAFETY INVARIANT (why agency is SAFE here): the scout chooses what to GATHER, never
// what is TRUE. Its tools are keyed to THIS stop's own identifiers — its Wikidata QID and
// its two candidate coordinates — baked in by the pipeline; the model supplies no free-form
// arguments, so it cannot fetch the wrong place's facts. Every line it can add to the well
// arrives VERBATIM from a sourced fetcher with provenance (source, sourceId, license) for
// the frozen attribution snapshot; the scout can only INCLUDE or EXCLUDE a fetched bundle,
// never edit it. The scout NEVER writes narration — it only assembles the well that
// narrateStop then grounds on. ("Persona lives in DELIVERY, never in FACTS" — agency may
// decide what to gather and how to cue it, never what is true.)
//
// BOUNDED: at most SCOUT_MAX_TOOL_TURNS model turns and SCOUT_MAX_TOKENS output per turn;
// hitting a cap (or any error) yields NO enrichment for that stop — non-fatal, logged by
// the caller, same blast radius as a fetcher failure under the old gates.
//
// The model call + the fetchers are INJECTED so the loop is unit-tested with zero network
// and zero spend (mirrors grounding.ts's injectable decomposer).

import Anthropic from '@anthropic-ai/sdk'
import type { AttributionSnapshot } from '@skipper/db/schema'
import { SCOUT_MAX_TOKENS, SCOUT_MAX_TOOL_TURNS } from '../config'
import { JUDGMENT_MODEL } from '../models'

// Judgment-tier, not narration-tier: the scout reads a sheet and picks fetches — the shared
// JUDGMENT_MODEL (Opus) at a few short turns per stop. It forces tool_choice {type:'any'}
// every turn (below), which is exactly why it can't ride NARRATION_MODEL/Fable.
const SCOUT_MODEL = JUDGMENT_MODEL

/** A sourced fact bundle exactly as a fetcher returned it (facts verbatim + provenance). */
export interface SourcedFacts {
  facts: string[]
  attribution: AttributionSnapshot
}

/** What the scout sees about the stop (no coordinates/QIDs — those live in the tools). */
export interface ScoutStop {
  name: string
  kind: string | null
  region: string
  corridor: string
  /** The current fact sheet (the deepened Wikipedia well). */
  facts: string[]
  /** Co-located landmarks merged into this stop (their facts ride the same telling). */
  mergedFeatures?: { name: string; facts: string[] }[]
  targetSeconds: number
}

/**
 * The stop-keyed fetchers. `geologyAt` resolves 'road' (the snapped trigger point — the
 * rock under the tires) or 'landmark' (the POI itself — the rock that makes the place);
 * `wikidataFacts` is null when the stop has no QID (or the channel is switched off), and
 * the tool is then not offered to the model at all.
 */
export interface ScoutTools {
  geologyAt: ((point: 'road' | 'landmark') => Promise<SourcedFacts | null>) | null
  wikidataFacts: (() => Promise<SourcedFacts | null>) | null
}

export interface ScoutResult {
  geology?: SourcedFacts & {
    /** How the narration should cue it: 'headline' (the rock IS the story — the old
     *  "iconic" cue) or 'supporting' (rounds out a thin telling — the old "sparse" cue). */
    emphasis: 'headline' | 'supporting'
  }
  wikidata?: SourcedFacts
  /** The scout's stated reasoning — logged + traced, never narrated. */
  reason: string
  toolCalls: number
  usage: { inputTokens: number; outputTokens: number }
}

const SYSTEM = `You are the fact-well SCOUT for ONE stop of an AI-narrated road-trip audio tour. A separate narrator will tell this stop's story strictly grounded on its FACT SHEET — it can only say what the sheet contains. Your job is to judge what the TELLING is missing and fetch grounded enrichment for it. You never write narration and you never state facts yourself; you only decide which sourced fetches belong on the sheet.

What you can fetch:
- GEOLOGY (fetch_geology): the bedrock at this stop, from geologic maps. Choose the point: "road" = the rock under the riders' tires (the default framing); "landmark" = the rock of the place itself (use when the rock IS what makes the place — cliffs, an island, a carved bay — since the road below often sits on plain valley fill).
- KEY FACTS (fetch_wikidata, when offered): discrete verified facts about this place — a date, an elevation, a namesake.

How to judge (read the sheet first):
- A RICH sheet (plenty of story material for the target length) usually wants NOTHING — piling on geology or dates makes every stop close on the same deep-time/numbers beat; restraint is a feature. Finalize with no inclusions.
- A THIN sheet wants rounding out: geology as supporting texture, and key facts (a year, a namesake) that anchor the place.
- Geology as "headline" is rare: only when the sheet itself shows the rock/landform IS the place's identity (a glacially carved bay, granite cliffs, a volcanic formation). Then fetch the "landmark" point.
- You may look before deciding: fetch, read what came back, and still EXCLUDE it if it adds nothing (e.g. generic valley alluvium under a town with a strong human story).
- Never include what you did not fetch; never paraphrase fetched facts — inclusion is all-or-nothing per bundle.

Always END by calling finalize, with a one-sentence reason. Be frugal: every fetch and every inclusion must earn its place in a ~spoken-minutes telling.`

const TOOL_GEOLOGY: Anthropic.Tool = {
  name: 'fetch_geology',
  description:
    'Fetch the sourced bedrock facts (lithology + age) for this stop from geologic maps.',
  input_schema: {
    type: 'object',
    properties: {
      point: {
        type: 'string',
        enum: ['road', 'landmark'],
        description:
          '"road" = the trigger point on the route (the rock under the tires); "landmark" = the place itself (the rock that makes the place).',
      },
    },
    required: ['point'],
    additionalProperties: false,
  },
}

const TOOL_WIKIDATA: Anthropic.Tool = {
  name: 'fetch_wikidata',
  description:
    "Fetch this place's discrete verified facts (inception, elevation, named-after, heritage designation) from Wikidata.",
  input_schema: { type: 'object', properties: {}, additionalProperties: false },
}

const TOOL_FINALIZE: Anthropic.Tool = {
  name: 'finalize',
  description: 'Commit your enrichment decision for this stop. Always call this last.',
  input_schema: {
    type: 'object',
    properties: {
      includeGeology: { type: 'boolean' },
      geologyPoint: {
        type: 'string',
        enum: ['road', 'landmark'],
        description: 'Which fetched geology bundle to include (must have been fetched).',
      },
      geologyEmphasis: {
        type: 'string',
        enum: ['headline', 'supporting'],
        description:
          '"headline" = the rock IS the story (rare); "supporting" = rounds out a thin telling.',
      },
      includeWikidata: { type: 'boolean' },
      reason: { type: 'string', description: 'One sentence: what the telling was missing, or why it needed nothing.' },
    },
    required: ['includeGeology', 'includeWikidata', 'reason'],
    additionalProperties: false,
  },
}

function buildUserMessage(stop: ScoutStop): string {
  const lines: string[] = [
    `REGION: ${stop.region}`,
    `CORRIDOR: ${stop.corridor}`,
    `PLACE: ${stop.name}${stop.kind ? ` (${stop.kind})` : ''}`,
    `TARGET LENGTH: about ${stop.targetSeconds} seconds spoken`,
    '',
    'CURRENT FACT SHEET:',
    ...(stop.facts.length > 0 ? stop.facts.map((f) => `- ${f}`) : ['(empty)']),
  ]
  for (const m of stop.mergedFeatures ?? []) {
    lines.push('', `ALSO AT THIS STOP — ${m.name}:`)
    for (const f of m.facts) lines.push(`- ${f}`)
  }
  lines.push('', 'Judge what the telling is missing, fetch what would help, then finalize.')
  return lines.join('\n')
}

/** One model turn — injectable for tests (the real one is a JUDGMENT_MODEL messages.create). */
export type ScoutModelCall = (params: {
  system: string
  tools: Anthropic.Tool[]
  messages: Anthropic.MessageParam[]
}) => Promise<Anthropic.Message>

let cached: Anthropic | undefined
function getClient(): Anthropic {
  if (!cached) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not set (the enrichment scout needs it).')
    }
    cached = new Anthropic()
  }
  return cached
}

const anthropicScoutCall: ScoutModelCall = async ({ system, tools, messages }) =>
  getClient().messages.create({
    model: SCOUT_MODEL,
    max_tokens: SCOUT_MAX_TOKENS,
    system,
    tools,
    tool_choice: { type: 'any' }, // every turn acts: fetch or finalize — no free prose
    messages,
  })

/**
 * Run the scout for one story stop. Returns the enrichment decision, or null when the stop
 * gets nothing (an explicit empty finalize, a hit turn-cap, or no tools to offer). Throws
 * only on a model-call failure — the caller treats that as "no enrichment", non-fatal.
 */
export async function scoutStop(
  stop: ScoutStop,
  tools: ScoutTools,
  call: ScoutModelCall = anthropicScoutCall,
): Promise<ScoutResult | null> {
  const offered: Anthropic.Tool[] = [
    ...(tools.geologyAt ? [TOOL_GEOLOGY] : []),
    ...(tools.wikidataFacts ? [TOOL_WIKIDATA] : []),
    TOOL_FINALIZE,
  ]
  if (offered.length === 1) return null // nothing fetchable — no decision to make

  // Everything the scout fetched, by bundle key — finalize can only include from here.
  const fetched = new Map<string, SourcedFacts | null>()
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: buildUserMessage(stop) }]
  let toolCalls = 0
  const usage = { inputTokens: 0, outputTokens: 0 }

  for (let turn = 0; turn < SCOUT_MAX_TOOL_TURNS; turn++) {
    const response = await call({ system: SYSTEM, tools: offered, messages })
    usage.inputTokens += response.usage.input_tokens
    usage.outputTokens += response.usage.output_tokens
    // A token-cap truncation can leave a PARTIAL final tool_use block — parsing whatever
    // survived would treat a half-written decision as authoritative. Map it to the
    // designed cap-failure instead: no enrichment, non-fatal.
    if (response.stop_reason === 'max_tokens') return null
    const calls = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    if (calls.length === 0) return null // text-only / refusal — treat as no enrichment

    // Dispatch the turn's FETCHES first — a frugal model may batch finalize alongside a
    // fetch in the same turn, and its include decision must see those bundles land.
    const results: Anthropic.ToolResultBlockParam[] = []
    for (const c of calls) {
      if (c.name !== 'fetch_geology' && c.name !== 'fetch_wikidata') continue
      toolCalls++
      let key: string
      let bundle: SourcedFacts | null = null
      if (c.name === 'fetch_geology') {
        const point = (c.input as { point?: string }).point === 'landmark' ? 'landmark' : 'road'
        key = `geology:${point}`
        if (tools.geologyAt) bundle = await tools.geologyAt(point).catch(() => null)
      } else {
        key = 'wikidata'
        if (tools.wikidataFacts) bundle = await tools.wikidataFacts().catch(() => null)
      }
      // Never clobber a good bundle with a failed re-fetch of the same key.
      if (bundle || !fetched.get(key)) fetched.set(key, bundle)
      results.push({
        type: 'tool_result',
        tool_use_id: c.id,
        content: bundle
          ? bundle.facts.map((f) => `- ${f}`).join('\n')
          : '(nothing found for this stop)',
      })
    }

    const finalize = calls.find((c) => c.name === 'finalize')
    if (finalize) {
      const f = finalize.input as {
        includeGeology?: boolean
        geologyPoint?: 'road' | 'landmark'
        geologyEmphasis?: 'headline' | 'supporting'
        includeWikidata?: boolean
        reason?: string
      }
      const result: ScoutResult = {
        reason: typeof f.reason === 'string' ? f.reason : '(no reason given)',
        toolCalls,
        usage,
      }
      // Inclusion is gated on a SUCCESSFUL fetch of that exact bundle — the scout can never
      // put facts on the well that no tool returned. An omitted point falls back to
      // whichever bundle actually has facts (a failed fetch never shadows a good one).
      if (f.includeGeology) {
        const point = f.geologyPoint ?? (fetched.get('geology:landmark') ? 'landmark' : 'road')
        const bundle = fetched.get(`geology:${point}`)
        if (bundle) result.geology = { ...bundle, emphasis: f.geologyEmphasis ?? 'supporting' }
      }
      if (f.includeWikidata) {
        const bundle = fetched.get('wikidata')
        if (bundle) result.wikidata = bundle
      }
      // The unanswered tool_use ids are wire-safe: the conversation ends here (no further
      // request is sent), so the "every tool_use needs a tool_result" rule never applies.
      return result
    }

    messages.push({ role: 'assistant', content: response.content }, { role: 'user', content: results })
  }

  // Turn cap without a finalize: no enrichment (bounded by construction; caller logs).
  return null
}
