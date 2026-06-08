// Wikidata structured facts — QID-keyed discrete facts layered onto narrated stops.
//
// Wikipedia gives us PROSE (a lead extract). Wikidata gives us STATEMENTS — a date, an
// elevation, a namesake — discrete, verified, and exact where the prose rounds or omits.
// The join is precise (not a fuzzy radius search): every Wikipedia page carries its
// Wikidata QID as a page property (`wikibase_item`), so a story stop we already chose
// links straight to its Wikidata item. One or two keyless GETs to the public MediaWiki
// Action API (`wbgetentities`) return that item's claims; we read a tight allowlist of
// high-charm, NON-VOLATILE properties and render each as a plain fact line.
//
// Why the Action API and not the new REST API: the v1 REST endpoint now REQUIRES
// authentication (https://www.wikidata.org/wiki/Wikidata:REST_API), which our keyless
// raw-fetch pipeline can't carry. `wbgetentities` is keyless, batchable, and honors the
// same etiquette (descriptive User-Agent, maxlag) as the Wikipedia client.
//
// Grounding (the cardinal invariant): the lines this builds ARE the well of facts — the
// narrator may say what is on them and nothing more. So each line states only what a
// single statement gives, rendered literally (a year, a rounded elevation, a resolved
// label). We take the PREFERRED-or-first-NORMAL value per property and skip deprecated /
// no-value statements, and we never render a property we can't turn into a clean sentence.
//
// Volatility: the allowlist is deliberately all FREEZE-SAFE facts (inception, elevation,
// named-after, heritage designation) — never population/visitor counts/anything that
// drifts, since the attribution + fact are frozen into a permanent R2 clip.
//
// License: Wikidata is CC0 — zero attribution burden, no share-alike. We still snapshot a
// `wikidata` AttributionSnapshot onto the clip for provenance/consistency in the array.

import { WIKIDATA_USER_AGENT } from '../config'
import type { AttributionSnapshot } from '@skipper/db/schema'
import { fetchWithRetry } from './http'

const API = 'https://www.wikidata.org/w/api.php'
/** Cap a hung request so a flaky Wikidata lookup can't stall a whole tour run. */
const REQUEST_TIMEOUT_MS = 10_000

/** metre and kilometre QIDs (the units an elevation statement uses) → metres-per-unit. */
const LENGTH_UNIT_METERS: Record<string, number> = {
  Q11573: 1, // metre
  Q828224: 1000, // kilometre
  Q3710: 0.3048, // foot (already imperial, but normalize through metres)
}
const M_TO_FT = 3.28084

/* -------------------------------------------------------------------------- */
/*  wbgetentities response shapes (formatversion=2, the fields we read)         */
/* -------------------------------------------------------------------------- */

interface TimeValue {
  time: string // e.g. "+1929-00-00T00:00:00Z"
  precision: number // 11=day 10=month 9=year 8=decade 7=century
}
interface QuantityValue {
  amount: string // e.g. "+1897"
  unit: string // a full entity URL, or "1" for dimensionless
}
interface ItemValue {
  'entity-type': string
  id: string // e.g. "Q1521"
}
interface Snak {
  snaktype: 'value' | 'novalue' | 'somevalue'
  property: string
  datavalue?: { value: TimeValue | QuantityValue | ItemValue | string; type: string }
}
interface Statement {
  mainsnak: Snak
  rank: 'preferred' | 'normal' | 'deprecated'
}
interface Entity {
  id: string
  missing?: string
  labels?: Record<string, { language: string; value: string }>
  claims?: Record<string, Statement[]>
}
interface WbGetEntitiesResponse {
  entities?: Record<string, Entity>
}

export interface WikidataResult {
  /** Plain, grounded fact lines for the fact sheet (the entire well for this layer). */
  facts: string[]
  /** Frozen credit for the clip's attribution array (CC0). */
  attribution: AttributionSnapshot
}

/* -------------------------------------------------------------------------- */
/*  Pure formatters — one per allowlisted property (exported for tests)         */
/* -------------------------------------------------------------------------- */

/** The narrowest QID at the END of a Wikidata entity URL, or the value if already a bare QID. */
function unitQid(unit: string): string {
  return unit.replace(/^.*\/(Q\d+)$/, '$1')
}

/**
 * Of a property's statements, pick the value-bearing one to speak: a `preferred` rank
 * beats `normal`; `deprecated` and non-`value` snaks are never spoken. Returns the first
 * qualifying statement (Wikidata orders preferred-first within a property), or null.
 */
export function pickStatement(statements: Statement[] | undefined): Statement | null {
  if (!statements || statements.length === 0) return null
  const usable = statements.filter(
    (s) => s.rank !== 'deprecated' && s.mainsnak.snaktype === 'value' && s.mainsnak.datavalue,
  )
  if (usable.length === 0) return null
  return usable.find((s) => s.rank === 'preferred') ?? usable[0]!
}

/** "+1929-00-00T00:00:00Z" → 1929 (signed). Returns null if unparseable or BCE. */
function parseYear(time: string): number | null {
  const m = time.match(/^([+-])(\d{1,})-/)
  if (!m) return null
  if (m[1] === '-') return null // BCE — out of scope for our POIs; skip rather than mis-speak
  const year = Number(m[2])
  return Number.isFinite(year) && year > 0 ? year : null
}

/**
 * P571 inception → "Established in 1929." Honors time precision: a year (9+) speaks the
 * exact year, a decade (8) speaks "the 1920s"; anything coarser (century/millennium) is
 * too vague to be a charming, dependable fact, so it's skipped.
 */
export function formatInception(value: TimeValue): string | null {
  const year = parseYear(value.time)
  if (year == null) return null
  if (value.precision >= 9) return `Established in ${year}.`
  if (value.precision === 8) return `It dates to the ${Math.floor(year / 10) * 10}s.`
  return null
}

/**
 * P2044 elevation above sea level → "It sits at about 6,220 feet above sea level."
 * Converts the statement's unit to feet (US-charm framing) and rounds to the nearest 10
 * — never an invented-precise figure. Skips unknown units and non-positive values.
 */
export function formatElevation(value: QuantityValue): string | null {
  const perUnit = LENGTH_UNIT_METERS[unitQid(value.unit)]
  if (perUnit == null) return null
  const meters = Number(value.amount) * perUnit
  if (!Number.isFinite(meters) || meters <= 0) return null
  const feet = Math.round((meters * M_TO_FT) / 10) * 10
  return `It sits at about ${feet.toLocaleString('en-US')} feet above sea level.`
}

/** P138 named after → "It's named after John C. Frémont." (label resolved separately.) */
export function formatNamedAfter(label: string): string | null {
  const l = label.trim()
  return l ? `It's named after ${l}.` : null
}

/**
 * P1435 heritage designation → "It holds a heritage designation: National Historic Landmark."
 * Wikidata's register labels carry a trailing "listed place/building/structure" tag (e.g.
 * "National Register of Historic Places listed place") — drop it so the designation reads
 * naturally; the wording is cosmetic, never the fact itself.
 */
export function formatHeritage(label: string): string | null {
  const l = label.trim().replace(/\s+listed (place|building|structure|site)$/i, '')
  return l ? `It holds a heritage designation: ${l}.` : null
}

/** Allowlisted item-valued properties whose value QID needs a label lookup before rendering. */
const ITEM_PROPS = {
  P138: formatNamedAfter, // named after
  P1435: formatHeritage, // heritage designation
} as const

/* -------------------------------------------------------------------------- */
/*  Pure assembly — claims + resolved labels → fact lines (exported for tests)  */
/* -------------------------------------------------------------------------- */

/** The value-QIDs an entity's item-valued allowlisted properties point at (need labels). */
export function referencedItemIds(entity: Entity): string[] {
  const ids = new Set<string>()
  for (const prop of Object.keys(ITEM_PROPS)) {
    const st = pickStatement(entity.claims?.[prop])
    const v = st?.mainsnak.datavalue?.value as ItemValue | undefined
    if (v && typeof v === 'object' && 'id' in v) ids.add(v.id)
  }
  return [...ids]
}

/**
 * Build grounded fact lines from an entity's claims plus a QID→label map (for the
 * item-valued properties). Order is fixed (inception, elevation, then item facts) so a
 * stop's Wikidata lines read consistently. Pure: no network, fully unit-testable.
 */
export function buildWikidataFacts(entity: Entity, labels: Map<string, string>): string[] {
  const facts: string[] = []

  const inception = pickStatement(entity.claims?.P571)
  if (inception) {
    const line = formatInception(inception.mainsnak.datavalue!.value as TimeValue)
    if (line) facts.push(line)
  }

  const elevation = pickStatement(entity.claims?.P2044)
  if (elevation) {
    const line = formatElevation(elevation.mainsnak.datavalue!.value as QuantityValue)
    if (line) facts.push(line)
  }

  for (const [prop, format] of Object.entries(ITEM_PROPS)) {
    const st = pickStatement(entity.claims?.[prop])
    if (!st) continue
    const id = (st.mainsnak.datavalue!.value as ItemValue).id
    const label = labels.get(id)
    if (!label) continue // never render a bare QID
    const line = format(label)
    if (line) facts.push(line)
  }

  return facts
}

/* -------------------------------------------------------------------------- */
/*  Network                                                                     */
/* -------------------------------------------------------------------------- */

/** One keyless wbgetentities GET with the required UA + maxlag etiquette. Non-fatal: throws to caller. */
async function getEntities(ids: string[], props: string): Promise<Record<string, Entity>> {
  const qs = new URLSearchParams({
    action: 'wbgetentities',
    ids: ids.join('|'),
    props,
    languages: 'en',
    format: 'json',
    formatversion: '2',
    maxlag: '5',
  })
  const res = await fetchWithRetry(
    `${API}?${qs}`,
    {
      headers: { 'User-Agent': WIKIDATA_USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
    { attempts: 3 },
  )
  if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}`)
  const json = (await res.json()) as WbGetEntitiesResponse
  return json.entities ?? {}
}

/**
 * Structured facts for one Wikidata QID, or null when there is nothing groundable (the
 * item is missing, or has none of the allowlisted properties). Non-fatal by contract:
 * any error returns null so a flaky Wikidata lookup never fails a tour (mirrors
 * geologyFacts / fetchDeepExtracts).
 */
export async function wikidataFacts(qid: string): Promise<WikidataResult | null> {
  let entity: Entity | undefined
  try {
    const entities = await getEntities([qid], 'claims|labels')
    entity = entities[qid]
  } catch (e) {
    console.warn(`Wikidata lookup failed for ${qid} (${(e as Error).message}) — skipping.`)
    return null
  }
  if (!entity || entity.missing != null || !entity.claims) return null

  // Resolve labels for the item-valued properties (named after, heritage designation) in
  // ONE batched call — skipped entirely when no allowlisted item property is present.
  const labels = new Map<string, string>()
  const refIds = referencedItemIds(entity)
  if (refIds.length > 0) {
    try {
      const labelEntities = await getEntities(refIds, 'labels')
      for (const id of refIds) {
        const en = labelEntities[id]?.labels?.en?.value
        if (en) labels.set(id, en)
      }
    } catch (e) {
      // Label resolution is best-effort: a failure just drops the item-valued facts.
      console.warn(`Wikidata label lookup failed for ${qid} (${(e as Error).message}).`)
    }
  }

  const facts = buildWikidataFacts(entity, labels)
  if (facts.length === 0) return null

  return {
    facts,
    attribution: {
      source: 'wikidata',
      sourceId: qid,
      title: entity.labels?.en?.value,
      url: `https://www.wikidata.org/wiki/${qid}`,
      license: 'CC0',
      retrievedAt: new Date().toISOString(),
    },
  }
}
