// The corpus FACT-SHEET builder — a bounded tool-using agent that, per STORY place, SELECTS the
// most narratable verbatim article spans and rounds them out with grounded enrichment (centroid
// geology, Wikidata key facts). The corpus `enrich` step (enrich-pois.ts) runs buildCorpusFactSheet
// ONCE per place to produce the shared `pois.fact_sheet` that tours + roam ground on. See
// docs/specs/corpus-enrichment-spec.md + docs/decisions/enrichment-scout.md.
// (History: this file also held a per-STOP `scoutStop` from the V1 generate-tour pipeline; it was
// removed 2026-06-19 — dead since the V2 corpus collapse, with no non-test caller.)
//
// THE SAFETY INVARIANT (why agency is SAFE here): it chooses what to GATHER, never what is TRUE.
// Kept spans are `input.spans[id]` VERBATIM and every fetched line arrives from a sourced fetcher
// with provenance (source, sourceId, license) for the frozen attribution snapshot; the model can
// only SELECT/INCLUDE/EXCLUDE, never edit or author a fact. ("Persona lives in DELIVERY, never in
// FACTS" — agency may decide what to gather and how to cue it, never what is true.)
//
// BOUNDED: at most ENRICH_MAX_TOOL_TURNS model turns and ENRICH_MAX_TOKENS output per turn; hitting
// a cap (or any error) yields NO sheet for that place — non-fatal, logged by the caller (the read
// path falls back to the positional extract head, and a re-run retries).
//
// The model call + the fetchers are INJECTED so the loop is unit-tested with zero network and zero
// spend (fact-sheet-builder.test.ts).

import Anthropic from '@anthropic-ai/sdk'
import type { AttributionSnapshot, FactSheetEntry } from '@skipper/db/schema'
import {
  ENRICH_MAX_TOKENS,
  ENRICH_MAX_TOOL_TURNS,
  ENRICH_FACT_SHEET_TARGET_SPANS,
} from '../config'
import { ENRICH_MODELS, getAnthropic } from '../models'
import { recordModelUsage } from './spend'

/** A sourced fact bundle exactly as a fetcher returned it (facts verbatim + provenance). */
export interface SourcedFacts {
  facts: string[]
  attribution: AttributionSnapshot
}

const TOOL_WIKIDATA: Anthropic.Tool = {
  name: 'fetch_wikidata',
  description:
    "Fetch this place's discrete verified facts (inception, elevation, named-after, heritage designation) from Wikidata.",
  input_schema: { type: 'object', properties: {}, additionalProperties: false },
}

/** One model turn — injectable for tests (the real one is a JUDGMENT_MODEL messages.create). */
export type ScoutModelCall = (params: {
  system: string
  tools: Anthropic.Tool[]
  messages: Anthropic.MessageParam[]
}) => Promise<Anthropic.Message>

/** A model-call factory: binds a model id + token cap into a ScoutModelCall. The corpus fact-sheet
 *  builder passes the operator-chosen ENRICH model (Sonnet by default). It forces tool_choice
 *  {type:'any'} so every turn acts (fetch or finalize) — no free prose. recordModelUsage tallies
 *  real calls only (test fakes don't). */
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

/* -------------------------------------------------------------------------- */
/*  buildCorpusFactSheet — the CORPUS fact-sheet builder (generalizes the scout) */
/* -------------------------------------------------------------------------- */
//
// The corpus `enrich` step (enrich-pois.ts) runs this ONCE per story place to produce the
// shared fact sheet (stored on `pois.fact_sheet`) — the curated narration source tours + roam both
// ground on (principle #1; docs/specs/corpus-enrichment-spec.md). It is the scout, generalized:
// instead of only include/exclude-ing fetched bundles, it ALSO selects WHICH verbatim spans of the
// (uncapped) article to keep.
//
// THE INVARIANT (spec §2): VERBATIM SELECTION, never summarization. The model emits SPAN IDS +
// bundle choices — never text. Every kept span is `input.spans[id]` verbatim; every bundle line
// is what a sourced fetcher returned. The model decides what to GATHER, never what is TRUE, so the
// sheet can never carry a model-authored "fact" ("persona lives in DELIVERY, never FACTS"). Bounded
// the same way as the scout; a cap/empty/no-wikipedia-span outcome returns null (the caller leaves
// the place un-enriched — the read-time extract-head fallback covers it, and a re-run retries).

/** What buildCorpusFactSheet sees about a place. `spans` are the verbatim article sentences (the model picks
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

/** Place-keyed fetchers for the fact-sheet builder (centroid geology + QID Wikidata) — null when the
 *  channel is off or unavailable (no QID), and then not offered to the model. */
export interface EnrichTools {
  geologyAt: (() => Promise<SourcedFacts | null>) | null
  wikidataFacts: (() => Promise<SourcedFacts | null>) | null
}

export interface EnrichResult {
  sheet: FactSheetEntry[]
  /** The model's one-sentence rationale — logged + traced, never narrated. */
  reason: string
  toolCalls: number
  usage: { inputTokens: number; outputTokens: number }
}

const ENRICH_SYSTEM = `You are the corpus FACT-SHEET builder for ONE place in an AI-narrated road-trip audio tour. A separate narrator will later tell this place's story, strictly grounded on the FACT SHEET you assemble — it can only say what the sheet contains. Your job: pick the most narratable VERBATIM facts and round them out with grounded enrichment. You never write or reword narration, and you never state facts yourself.

You are given the place's full Wikipedia article split into NUMBERED SPANS (one sentence each). You SELECT spans by id — the kept spans go into the fact sheet VERBATIM. You never edit, summarize, or merge them.

What you can also fetch (include/exclude, all-or-nothing per bundle — never paraphrase what comes back):
- GEOLOGY (fetch_geology): the bedrock that makes this place (lithology + age), from geologic maps. Include it only when the rock/landform IS part of the place's identity, or to round out a thin article.
- KEY FACTS (fetch_wikidata, when offered): discrete verified facts — a date, an elevation, a namesake.

How to judge:
- Keep the narratable BEATS: what the place is, why it matters, the human story, the vivid specific (the year, the name, the "Major Ormsby was killed" line) — wherever it sits in the article, even deep. Pull the strong deep fact a first-N-characters cap would miss; that is the whole point of doing this.
- DROP list/table rows, demographic and census trivia, administrative/governance boilerplate, bare geographic coordinates, citation cruft, and anything that reads as an almanac entry rather than a story.
- RESTRAINT is a feature. Aim for roughly the strongest ${ENRICH_FACT_SHEET_TARGET_SPANS} spans for a telling of about the target length — fewer for a thin article. A rich article wants no enrichment bundles; piling on geology/dates makes every place close on the same deep-time/numbers beat.
- You may fetch a bundle, read it, and still EXCLUDE it if it adds nothing.

Always END by calling finalize_fact_sheet with the kept span ids and a one-sentence reason. Never include what you did not fetch.`

const TOOL_ENRICH_GEOLOGY: Anthropic.Tool = {
  name: 'fetch_geology',
  description:
    'Fetch the sourced bedrock facts (lithology + age) for this place (its centroid) from geologic maps.',
  input_schema: { type: 'object', properties: {}, additionalProperties: false },
}

const TOOL_FINALIZE_SHEET: Anthropic.Tool = {
  name: 'finalize_fact_sheet',
  description: 'Commit the curated fact sheet for this place. Always call this last.',
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
        description: 'One sentence: what the fact sheet captures, and why anything fetched was kept or dropped.',
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
    'Select the spans that make the strongest grounded telling, fetch enrichment only if it earns its place, then finalize_fact_sheet.',
  ]
  return lines.join('\n')
}

/**
 * Build the curated fact sheet for ONE story place. Returns the sheet (verbatim wikipedia spans +
 * any included geology/wikidata facts, each with provenance), or null when no usable sheet could be
 * assembled (a hit turn-cap, a max_tokens truncation, a text-only/refusal turn, or a finalize that
 * kept no article span). Throws only on a model-call failure — the caller treats that as "leave
 * this place un-enriched", non-fatal (the read path falls back to the positional extract head).
 * The model call is INJECTED (default: the chosen ENRICH model) so the loop unit-tests with zero
 * network and zero spend.
 */
export async function buildCorpusFactSheet(
  input: EnrichInput,
  tools: EnrichTools,
  opts: { model?: string; call?: ScoutModelCall } = {},
): Promise<EnrichResult | null> {
  if (input.spans.length === 0) return null
  const call = opts.call ?? makeScoutCall(opts.model ?? ENRICH_MODELS.sonnet, ENRICH_MAX_TOKENS)
  const offered: Anthropic.Tool[] = [
    ...(tools.geologyAt ? [TOOL_ENRICH_GEOLOGY] : []),
    ...(tools.wikidataFacts ? [TOOL_WIKIDATA] : []),
    TOOL_FINALIZE_SHEET,
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
    // (no sheet, retryable) rather than acting on a half-written span list.
    if (response.stop_reason === 'max_tokens') return null
    const calls = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    if (calls.length === 0) return null // text-only / refusal — no sheet

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

    const finalize = calls.find((c) => c.name === 'finalize_fact_sheet')
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
      const sheet: FactSheetEntry[] = keep.map((i) => ({
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
            sheet.push({
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
            sheet.push({
              text: fact,
              source: 'wikidata',
              sourceId: b.attribution.sourceId,
              license: b.attribution.license ?? 'CC0',
              ...(b.attribution.url ? { url: b.attribution.url } : {}),
            })
          }
        }
      }
      // A sheet with no article span is not a telling — leave the place un-enriched (retryable).
      if (!sheet.some((s) => s.source === 'wikipedia')) return null
      return {
        sheet,
        reason: typeof f.reason === 'string' ? f.reason : '(no reason given)',
        toolCalls,
        usage,
      }
    }

    messages.push({ role: 'assistant', content: response.content }, { role: 'user', content: results })
  }

  return null // turn cap without a finalize — no sheet (retryable)
}
