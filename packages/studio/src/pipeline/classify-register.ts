// Delivery-register classification — assigns each POI a `delivery_register` (landscape | story |
// town | civic) that picks its TTS read (`ttsStyleFor`). HYBRID, founder-chosen 2026-06-19 after
// external research (see TODO + the research synthesis):
//   1. STRUCTURAL (free, deterministic, the majority): every POI is a Wikidata entity, so its
//      `P31` ("instance of") type — walked up the `P279*` subclass graph against a small set of
//      register ANCHOR classes — buckets it. A mountain is Q8502; a single-family home walks
//      P279* up to house→building (story); a California state park walks up to protected area
//      (landscape). The walk happens in WDQS, so we list only ~25 anchors, not every leaf class.
//   2. LLM FALLBACK (paid, the tail only): a POI whose P31 matches NO anchor, has no P31, OR matches
//      CONFLICTING registers is handed to a cheap classifier over its fact sheet (classifyRegisterLLM).
// We trust the structural pass ONLY on a UNANIMOUS single-register match — a 2026-06-19 preview over
// the live corpus showed a blind priority tie-break guesses wrong on exactly the ambiguous multi-match
// cases (a scenic-but-dammed lake, a ski resort that's also a community), so conflicts go to the LLM
// (which has the fact sheet) rather than a guess. ~78% classify structurally; ~22% fall to the LLM.
//
// The register is a STABLE property of the place, classified ONCE and stored on `pois`, shared by
// roam + drives (like `kind`). Empirical grounding (2026-06-19 probe of the 460 enriched POIs):
// 460/460 resolve to a Wikidata entity, only 21 lack P31 (→ fallback), 48 are multi-P31 (→ tie-break).

import Anthropic from '@anthropic-ai/sdk'
import { CLAUDE_MODELS, type DeliveryRegister } from '@skipper/shared'
import { recordModelUsage } from './spend'

/** Wikidata anchor classes per register. A POI is in a register if its P31 is that class OR any
 *  P279* subclass of it. Small + top-level on purpose — the subclass walk (in WDQS) does the rest.
 *  Labels are for the audit log only; the QID is the key. */
export const REGISTER_ANCHORS: Record<DeliveryRegister, { qid: string; label: string }[]> = {
  landscape: [
    { qid: 'Q8502', label: 'mountain' },
    { qid: 'Q46831', label: 'mountain range' },
    { qid: 'Q133056', label: 'mountain pass' },
    { qid: 'Q23397', label: 'lake' },
    { qid: 'Q4022', label: 'river' },
    { qid: 'Q34038', label: 'waterfall' },
    { qid: 'Q39594', label: 'bay' },
    { qid: 'Q40080', label: 'beach' },
    { qid: 'Q23442', label: 'island' },
    { qid: 'Q39816', label: 'valley' },
    { qid: 'Q150784', label: 'canyon' },
    { qid: 'Q177380', label: 'hot spring' },
    { qid: 'Q4421', label: 'forest' },
    { qid: 'Q473972', label: 'protected area' }, // national/state parks, preserves, refuges
    { qid: 'Q167346', label: 'botanical garden' },
  ],
  town: [
    { qid: 'Q486972', label: 'human settlement' }, // city/town/village/CDP/unincorporated community/ghost town
    { qid: 'Q123705', label: 'neighborhood' },
  ],
  story: [
    { qid: 'Q41176', label: 'building' }, // house/church/theatre/hotel/historic building (the broad story catch)
    { qid: 'Q4989906', label: 'monument' },
    { qid: 'Q839954', label: 'archaeological site' },
    { qid: 'Q1370598', label: 'place of worship' },
    { qid: 'Q570116', label: 'tourist attraction' },
    // An EVENT that happened at a place is a human story (a battle, a festival, the 1960 Winter
    // Olympics). The LLM fallback occasionally tipped these to civic ("infrastructure AND historic")
    // — `event` (P279* super of battle/festival/sporting event) routes them structurally to story.
    // None of our natural/built/settlement/civic anchors subclass `event`, so this never conflicts.
    { qid: 'Q1656682', label: 'event' },
  ],
  civic: [
    // NB: `reservoir` is deliberately NOT here — a reservoir reads as a lake (landscape); only the
    // DAM itself is civic. (Live-preview fix 2026-06-19: reservoirs were wrongly landing civic.)
    { qid: 'Q12323', label: 'dam' },
    { qid: 'Q12280', label: 'bridge' },
    { qid: 'Q34442', label: 'road' },
    { qid: 'Q159719', label: 'power station' },
    { qid: 'Q55488', label: 'railway station' },
    { qid: 'Q64436', label: 'canal' },
    { qid: 'Q44377', label: 'tunnel' },
  ],
}

/** anchor QID → register, inverted from REGISTER_ANCHORS for O(1) lookup. */
export const REGISTER_BY_ANCHOR: Record<string, DeliveryRegister> = Object.fromEntries(
  (Object.entries(REGISTER_ANCHORS) as [DeliveryRegister, { qid: string }[]][]).flatMap(
    ([register, anchors]) => anchors.map((a) => [a.qid, register]),
  ),
)

export type StructuralResult =
  | { register: DeliveryRegister; basis: 'single' }
  | { register: null; reason: 'no-anchor-match' | 'conflict'; matched: DeliveryRegister[] }

/** PURE: given the register anchors a POI matched (via P31/P279*), assign its register or ABSTAIN.
 *  We trust the structure ONLY when it's UNANIMOUS — exactly one distinct register. Zero matches
 *  (no P31 / only unmapped classes) OR a conflict (≥2 registers, a genuinely ambiguous place) both
 *  abstain → the LLM fallback decides from the fact sheet, never a blind guess. */
export function classifyFromMatches(matchedRegisters: DeliveryRegister[]): StructuralResult {
  const distinct = [...new Set(matchedRegisters)]
  if (distinct.length === 1) return { register: distinct[0]!, basis: 'single' }
  if (distinct.length === 0) return { register: null, reason: 'no-anchor-match', matched: [] }
  return { register: null, reason: 'conflict', matched: distinct }
}

const WDQS = 'https://query.wikidata.org/sparql'
const UA = 'Skipper/1.0 (https://skipper.fm; hello@skipper.fm) delivery-register-classifier'

/** Fetch, per POI QID, which register ANCHORS it is a (sub)instance of — the P31/P279* walk runs in
 *  WDQS. Returns qid → matched registers (deduped). QIDs absent from the result matched nothing
 *  (no P31, or only unmapped classes) → they abstain to the LLM fallback. Batched to keep each query
 *  light. `fetchImpl` is injectable for tests. */
export async function fetchRegisterMatches(
  qids: string[],
  fetchImpl: typeof fetch = fetch,
  batchSize = 120,
): Promise<Map<string, DeliveryRegister[]>> {
  const anchorValues = Object.keys(REGISTER_BY_ANCHOR)
    .map((q) => `wd:${q}`)
    .join(' ')
  const out = new Map<string, DeliveryRegister[]>()
  const clean = [...new Set(qids.map((q) => q.match(/Q\d+/i)?.[0]?.toUpperCase()).filter(Boolean))] as string[]
  for (let i = 0; i < clean.length; i += batchSize) {
    const items = clean.slice(i, i + batchSize).map((q) => `wd:${q}`).join(' ')
    const query = `SELECT ?item ?anchor WHERE { VALUES ?item { ${items} } VALUES ?anchor { ${anchorValues} } ?item wdt:P31/wdt:P279* ?anchor. }`
    const res = await fetchImpl(`${WDQS}?format=json&query=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' },
    })
    if (!res.ok) throw new Error(`WDQS register query failed: ${res.status} ${await res.text()}`)
    const json = (await res.json()) as { results: { bindings: { item: { value: string }; anchor: { value: string } }[] } }
    for (const b of json.results.bindings) {
      const qid = b.item.value.split('/').pop()!
      const anchorQid = b.anchor.value.split('/').pop()!
      const register = REGISTER_BY_ANCHOR[anchorQid]
      if (!register) continue
      const prev = out.get(qid) ?? []
      if (!prev.includes(register)) prev.push(register)
      out.set(qid, prev)
    }
  }
  return out
}

// ---- LLM fallback (the ambiguous tail only) -------------------------------------------------

const FALLBACK_SYSTEM = `You assign ONE delivery register to a place in a road-trip audio tour — the register sets HOW a narrator READS the stop, based on what KIND of place it is (never its facts). Choose exactly one:
- landscape: a natural feature — mountain, lake, river, waterfall, vista, canyon, beach, forest, park/preserve, geology.
- story: human history or a built thing with a human story — a house, mansion, church, hotel, theatre, monument, ruin, a historic site, or an event that happened at a place.
- town: a settlement or community — a town, village, city, neighborhood, an unincorporated or former community.
- civic: a piece of infrastructure or public works — a dam, bridge, road, reservoir, power station, railway station, canal, tunnel.
Pick the single best fit. If a place is built infrastructure AND historic, prefer civic. If it is a settlement, prefer town. Call the tool with your choice.`

const FALLBACK_TOOL: Anthropic.Tool = {
  name: 'register',
  description: 'Report the single best delivery register for this place.',
  input_schema: {
    type: 'object',
    properties: { register: { type: 'string', enum: ['landscape', 'story', 'town', 'civic'] } },
    required: ['register'],
    additionalProperties: false,
  },
}

/** One model turn — injectable for tests. */
export type RegisterModelCall = (args: {
  system: string
  tools: Anthropic.Tool[]
  messages: Anthropic.MessageParam[]
}) => Promise<Anthropic.Message>

/** LLM fallback for a POI that matched no structural anchor: classify from its name/kind/fact sheet
 *  with a cheap model (Haiku) forced through the `register` tool. Defaults to 'story' on any refusal/
 *  malformed reply (the safest catch-all — it's the warm narration base). */
export async function classifyRegisterLLM(
  input: { name: string; kind: string | null; factSheet: string },
  call: RegisterModelCall,
): Promise<DeliveryRegister> {
  const kindLine = input.kind ? `\nWikidata type: ${input.kind}` : ''
  const user = `Place: ${input.name}${kindLine}\n\nFACT SHEET:\n${input.factSheet}`
  const response = await call({
    system: FALLBACK_SYSTEM,
    tools: [FALLBACK_TOOL],
    messages: [{ role: 'user', content: user }],
  })
  const toolUse = response.content.find((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use')
  const register = (toolUse?.input as { register?: string } | undefined)?.register
  if (register === 'landscape' || register === 'town' || register === 'civic') return register
  return 'story'
}

/** The real Haiku call backing classifyRegisterLLM (forced tool_choice so every reply classifies). */
export function makeRegisterCall(getAnthropic: () => Anthropic): RegisterModelCall {
  return async ({ system, tools, messages }) => {
    const response = await getAnthropic().messages.create({
      model: CLAUDE_MODELS.haiku,
      max_tokens: 256,
      system,
      tools,
      tool_choice: { type: 'tool', name: 'register' },
      messages,
    })
    // Tally the Haiku spend so a paid classify run reports its cost like enrich/generate do.
    recordModelUsage(CLAUDE_MODELS.haiku, response.usage)
    return response
  }
}
