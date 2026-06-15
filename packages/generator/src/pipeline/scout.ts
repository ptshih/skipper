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
import type { AttributionSnapshot, WellSpan } from '@skipper/db/schema'
import {
  ENRICH_MAX_TOKENS,
  ENRICH_MAX_TOOL_TURNS,
  ENRICH_WELL_TARGET_SPANS,
  SCOUT_MAX_TOKENS,
  SCOUT_MAX_TOOL_TURNS,
} from '../config'
import { ENRICH_MODELS, getAnthropic, JUDGMENT_MODEL } from '../models'
import { recordModelUsage } from './spend'

// Judgment-tier, not narration-tier: the scout reads a sheet and picks fetches — the shared
// JUDGMENT_MODEL (Opus) at a few short turns per stop. It forces tool_choice {type:'any'}
// every turn (below), so it pins JUDGMENT_MODEL (Opus 4.8).
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

/**
 * The per-STOP scout tools, gated by whether the place is already ENRICHED (a corpus well). Pulled
 * out of generate-tour so the PLACE/ROUTE split (corpus-enrichment-spec §6) is unit-testable: for an
 * ENRICHED stop the well already carries the PLACE-level facts, so the scout is narrowed to the ROUTE
 * "rock under the tires" only — landmark geology resolves to null and Wikidata is withheld (they'd
 * duplicate the well). An UN-enriched stop keeps the full per-stop scout (today's behavior). The
 * fetchers are INJECTED (the real Macrostrat/Wikidata fns in generate-tour; fakes in tests); a channel
 * that's off (GEOLOGY/WIKIDATA disabled) or a stop with no QID yields a null tool (not offered).
 */
export function scoutToolsForStop(
  stop: { enriched?: boolean; lat: number; lng: number; triggerLat: number; triggerLng: number; wikidataQid?: string },
  deps: {
    geologyEnabled: boolean
    wikidataEnabled: boolean
    geologyAt: (lat: number, lng: number) => Promise<SourcedFacts | null>
    wikidataFacts: (qid: string) => Promise<SourcedFacts | null>
  },
): ScoutTools {
  return {
    // "road" = the trigger point under the tires; "landmark" = the POI itself. For an ENRICHED stop
    // the landmark rock is already in the well, so landmark resolves to null (route only).
    geologyAt: deps.geologyEnabled
      ? (point) =>
          point === 'landmark'
            ? stop.enriched
              ? Promise.resolve(null)
              : deps.geologyAt(stop.lat, stop.lng)
            : deps.geologyAt(stop.triggerLat, stop.triggerLng)
      : null,
    // Wikidata is a PLACE fact — withheld for enriched stops (already in the well).
    wikidataFacts:
      deps.wikidataEnabled && !stop.enriched && stop.wikidataQid
        ? () => deps.wikidataFacts(stop.wikidataQid!)
        : null,
  }
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

/** A model-call factory: binds a model id + token cap into a ScoutModelCall. The scout pins
 *  SCOUT_MODEL (Opus, calibration); the corpus well builder passes the operator-chosen ENRICH
 *  model (Sonnet by default). Both force tool_choice {type:'any'} so every turn acts (fetch or
 *  finalize) — no free prose. recordModelUsage tallies real calls only (test fakes don't). */
export function makeScoutCall(model: string, maxTokens: number): ScoutModelCall {
  return async ({ system, tools, messages }) => {
    const response = await getAnthropic('the enrichment scout needs it').messages.create({
      model,
      max_tokens: maxTokens,
      system,
      tools,
      tool_choice: { type: 'any' },
      messages,
    })
    recordModelUsage(model, response.usage)
    return response
  }
}

const anthropicScoutCall: ScoutModelCall = makeScoutCall(SCOUT_MODEL, SCOUT_MAX_TOKENS)

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

/* -------------------------------------------------------------------------- */
/*  buildWell — the CORPUS well builder (generalizes the scout)                */
/* -------------------------------------------------------------------------- */
//
// The corpus `enrich` step (enrich-region.ts) runs this ONCE per story place to produce the
// shared "fact well" — the curated narration sheet tours + roam both ground on (principle #1;
// docs/specs/corpus-enrichment-spec.md). It is the scout, generalized: instead of only
// include/exclude-ing fetched bundles, it ALSO selects WHICH verbatim spans of the (uncapped)
// article to keep.
//
// THE INVARIANT (spec §2): VERBATIM SELECTION, never summarization. The model emits SPAN IDS +
// bundle choices — never text. Every kept span is `input.spans[id]` verbatim; every bundle line
// is what a sourced fetcher returned. The model decides what to GATHER, never what is TRUE, so the
// well can never carry a model-authored "fact" ("persona lives in DELIVERY, never FACTS"). Bounded
// the same way as the scout; a cap/empty/no-wikipedia-span outcome returns null (the caller leaves
// the place un-enriched — the read-time extract-head fallback covers it, and a re-run retries).

/** What buildWell sees about a place. `spans` are the verbatim article sentences (the model picks
 *  BY INDEX); `wiki` is the provenance every kept span credits. Geology is at the place CENTROID
 *  (the route-snapped "rock under the tires" stays at tour gen — spec §6). */
export interface EnrichInput {
  name: string
  kind: string | null
  region: string
  spans: string[]
  wiki: { sourceId: string; url: string; license: string }
  targetSeconds: number
}

/** Place-keyed fetchers for the well builder (centroid geology + QID Wikidata) — null when the
 *  channel is off or unavailable (no QID), and then not offered to the model. */
export interface EnrichTools {
  geologyAt: (() => Promise<SourcedFacts | null>) | null
  wikidataFacts: (() => Promise<SourcedFacts | null>) | null
}

export interface EnrichResult {
  well: WellSpan[]
  /** The model's one-sentence rationale — logged + traced, never narrated. */
  reason: string
  toolCalls: number
  usage: { inputTokens: number; outputTokens: number }
}

const ENRICH_SYSTEM = `You are the corpus FACT-WELL builder for ONE place in an AI-narrated road-trip audio tour. A separate narrator will later tell this place's story, strictly grounded on the WELL you assemble — it can only say what the well contains. Your job: pick the most narratable VERBATIM facts and round them out with grounded enrichment. You never write or reword narration, and you never state facts yourself.

You are given the place's full Wikipedia article split into NUMBERED SPANS (one sentence each). You SELECT spans by id — the kept spans go into the well VERBATIM. You never edit, summarize, or merge them.

What you can also fetch (include/exclude, all-or-nothing per bundle — never paraphrase what comes back):
- GEOLOGY (fetch_geology): the bedrock that makes this place (lithology + age), from geologic maps. Include it only when the rock/landform IS part of the place's identity, or to round out a thin article.
- KEY FACTS (fetch_wikidata, when offered): discrete verified facts — a date, an elevation, a namesake.

How to judge:
- Keep the narratable BEATS: what the place is, why it matters, the human story, the vivid specific (the year, the name, the "Major Ormsby was killed" line) — wherever it sits in the article, even deep. Pull the strong deep fact a first-N-characters cap would miss; that is the whole point of doing this.
- DROP list/table rows, demographic and census trivia, administrative/governance boilerplate, bare geographic coordinates, citation cruft, and anything that reads as an almanac entry rather than a story.
- RESTRAINT is a feature. Aim for roughly the strongest ${ENRICH_WELL_TARGET_SPANS} spans for a telling of about the target length — fewer for a thin article. A rich article wants no enrichment bundles; piling on geology/dates makes every place close on the same deep-time/numbers beat.
- You may fetch a bundle, read it, and still EXCLUDE it if it adds nothing.

Always END by calling finalize_well with the kept span ids and a one-sentence reason. Never include what you did not fetch.`

const TOOL_ENRICH_GEOLOGY: Anthropic.Tool = {
  name: 'fetch_geology',
  description:
    'Fetch the sourced bedrock facts (lithology + age) for this place (its centroid) from geologic maps.',
  input_schema: { type: 'object', properties: {}, additionalProperties: false },
}

const TOOL_FINALIZE_WELL: Anthropic.Tool = {
  name: 'finalize_well',
  description: 'Commit the curated well for this place. Always call this last.',
  input_schema: {
    type: 'object',
    properties: {
      keepSpanIds: {
        type: 'array',
        items: { type: 'integer' },
        description: 'The ids of the article spans to keep VERBATIM, in any order.',
      },
      includeGeology: { type: 'boolean' },
      includeWikidata: { type: 'boolean' },
      reason: {
        type: 'string',
        description: 'One sentence: what the well captures, and why anything fetched was kept or dropped.',
      },
    },
    required: ['keepSpanIds', 'includeGeology', 'includeWikidata', 'reason'],
    additionalProperties: false,
  },
}

function buildEnrichMessage(input: EnrichInput): string {
  const lines: string[] = [
    `REGION: ${input.region}`,
    `PLACE: ${input.name}${input.kind ? ` (${input.kind})` : ''}`,
    `TARGET LENGTH: about ${input.targetSeconds} seconds spoken`,
    '',
    'ARTICLE SPANS (id: text):',
    ...input.spans.map((s, i) => `${i}: ${s}`),
    '',
    'Select the spans that make the strongest grounded telling, fetch enrichment only if it earns its place, then finalize_well.',
  ]
  return lines.join('\n')
}

/**
 * Build the curated fact well for ONE story place. Returns the well (verbatim wikipedia spans +
 * any included geology/wikidata facts, each with provenance), or null when no usable well could be
 * assembled (a hit turn-cap, a max_tokens truncation, a text-only/refusal turn, or a finalize that
 * kept no article span). Throws only on a model-call failure — the caller treats that as "leave
 * this place un-enriched", non-fatal (the read path falls back to the positional extract head).
 * The model call is INJECTED (default: the chosen ENRICH model) so the loop unit-tests with zero
 * network and zero spend.
 */
export async function buildWell(
  input: EnrichInput,
  tools: EnrichTools,
  opts: { model?: string; call?: ScoutModelCall } = {},
): Promise<EnrichResult | null> {
  if (input.spans.length === 0) return null
  const call = opts.call ?? makeScoutCall(opts.model ?? ENRICH_MODELS.sonnet, ENRICH_MAX_TOKENS)
  const offered: Anthropic.Tool[] = [
    ...(tools.geologyAt ? [TOOL_ENRICH_GEOLOGY] : []),
    ...(tools.wikidataFacts ? [TOOL_WIKIDATA] : []),
    TOOL_FINALIZE_WELL,
  ]

  const fetched = new Map<string, SourcedFacts | null>()
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: buildEnrichMessage(input) }]
  let toolCalls = 0
  const usage = { inputTokens: 0, outputTokens: 0 }

  for (let turn = 0; turn < ENRICH_MAX_TOOL_TURNS; turn++) {
    const response = await call({ system: ENRICH_SYSTEM, tools: offered, messages })
    usage.inputTokens += response.usage.input_tokens
    usage.outputTokens += response.usage.output_tokens
    // A token-cap truncation can leave a PARTIAL finalize — treat it as the designed cap-failure
    // (no well, retryable) rather than acting on a half-written span list.
    if (response.stop_reason === 'max_tokens') return null
    const calls = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    if (calls.length === 0) return null // text-only / refusal — no well

    // Dispatch fetches first so a finalize batched in the same turn sees the bundles land.
    const results: Anthropic.ToolResultBlockParam[] = []
    for (const c of calls) {
      if (c.name !== 'fetch_geology' && c.name !== 'fetch_wikidata') continue
      toolCalls++
      const key = c.name === 'fetch_geology' ? 'geology' : 'wikidata'
      let bundle: SourcedFacts | null = null
      if (c.name === 'fetch_geology' && tools.geologyAt) bundle = await tools.geologyAt().catch(() => null)
      if (c.name === 'fetch_wikidata' && tools.wikidataFacts) bundle = await tools.wikidataFacts().catch(() => null)
      if (bundle || !fetched.get(key)) fetched.set(key, bundle)
      results.push({
        type: 'tool_result',
        tool_use_id: c.id,
        content: bundle ? bundle.facts.map((f) => `- ${f}`).join('\n') : '(nothing found for this place)',
      })
    }

    const finalize = calls.find((c) => c.name === 'finalize_well')
    if (finalize) {
      const f = finalize.input as {
        keepSpanIds?: number[]
        includeGeology?: boolean
        includeWikidata?: boolean
        reason?: string
      }
      // Dedupe + clamp to valid indices, sort to preserve the article's reading order.
      const keep = [...new Set(f.keepSpanIds ?? [])]
        .filter((i) => Number.isInteger(i) && i >= 0 && i < input.spans.length)
        .sort((a, b) => a - b)
      const well: WellSpan[] = keep.map((i) => ({
        text: input.spans[i]!,
        source: 'wikipedia',
        sourceId: input.wiki.sourceId,
        license: input.wiki.license,
        ...(input.wiki.url ? { url: input.wiki.url } : {}),
      }))
      if (f.includeGeology) {
        const b = fetched.get('geology')
        if (b) {
          for (const fact of b.facts) {
            well.push({
              text: fact,
              source: 'macrostrat',
              sourceId: b.attribution.sourceId,
              license: b.attribution.license ?? 'CC BY 4.0',
              ...(b.attribution.url ? { url: b.attribution.url } : {}),
            })
          }
        }
      }
      if (f.includeWikidata) {
        const b = fetched.get('wikidata')
        if (b) {
          for (const fact of b.facts) {
            well.push({
              text: fact,
              source: 'wikidata',
              sourceId: b.attribution.sourceId,
              license: b.attribution.license ?? 'CC0',
              ...(b.attribution.url ? { url: b.attribution.url } : {}),
            })
          }
        }
      }
      // A well with no article span is not a telling — leave the place un-enriched (retryable).
      if (!well.some((s) => s.source === 'wikipedia')) return null
      return {
        well,
        reason: typeof f.reason === 'string' ? f.reason : '(no reason given)',
        toolCalls,
        usage,
      }
    }

    messages.push({ role: 'assistant', content: response.content }, { role: 'user', content: results })
  }

  return null // turn cap without a finalize — no well (retryable)
}
