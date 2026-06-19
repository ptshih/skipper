// Wikidata discovery SPINE — the route's POI discovery (it replaced Wikipedia-geosearch
// wholesale; there is no flag).
//
// Wikipedia-geosearch only found places that have a Wikipedia ARTICLE. But many named places
// along a drive have a geocoded Wikidata entity and NO article — the whole bay/beach/cove
// scenery layer (Sand Harbor is the canonical case: a typed Wikidata "bay" 363m off the road,
// no Wikipedia article, so geosearch was blind to it). So discovery is the spine: Wikidata
// answers "what exists here, where, what kind" (P625 coords + P31 type), and Wikipedia is the
// PROSE layer joined per story candidate via sitelink.
//
// It resolves every corridor entity into a tier:
//   STORY  — has a Wikipedia article with a story-grade lead extract (≥ STORY_MIN_FACT_CHARS).
//   SCENIC — a typed PLACE (bay/beach/lake/park/summit…) with no prose: name + type only,
//            delivery-only ("on your left, Sand Harbor"), exactly the scenic doctrine.
//   BREAK  — a commercial anchor (hotel/restaurant) with no article; the Places break layer's job.
//   DROP   — not a tour-worthy place (a school, a stream, an administrative boundary, a list page).
// The P31 typing REPLACES the brittle NON_NARRATABLE_TITLE regex and drives the split.
//
// Provenance: Wikidata is CC0 (the scenic NAME needs no attribution); a story stop still
// carries its Wikipedia CC BY-SA credit (joined here). This module only DISCOVERS + tiers;
// it does not narrate or persist — generate.ts adapts these candidates (via candidatesToWikiPois)
// into the selection pipeline. Pure helpers (tierOf/isAreal/normName/dedupeByName) are exported
// for unit tests; the network calls are isolated and non-fatal by contract.

import {
  STORY_MIN_FACT_CHARS,
  OFF_ROUTE_MAX_M,
  SPINE_AREAL_OFF_ROUTE_MAX_M,
  WDQS_ENDPOINT,
  WDQS_USER_AGENT,
} from '../config'
import { haversineMeters, type LngLat } from './geo'
import { fetchWithRetry } from './http'
import { fetchExtractsByTitle, type WikiPoi } from './wikipedia'

const REQUEST_TIMEOUT_MS = 30_000

export type Tier = 'story' | 'scenic' | 'break' | 'drop'

export interface WikidataCandidate {
  /** Wikidata QID — the join key for QID-keyed enrichment + the (source, source_id) for scenic pins. */
  qid: string
  /** Wikidata label — the spoken NAME for a scenic pin (CC0, non-volatile). */
  name: string
  lat: number
  lng: number
  /** P31 type labels (lowercased) — what KIND of place this is. */
  types: string[]
  tier: Tier
  /** Nearest distance from the route polyline (m). */
  offRouteM: number
  /** STORY tier only: the joined Wikipedia article (CC BY-SA prose). */
  article?: { title: string; url: string; pageId: number; extract: string }
}

/* -------------------------------------------------------------------------- */
/*  Pure tiering (exported for tests)                                          */
/* -------------------------------------------------------------------------- */

// Types that are NOT a tour destination even WITH an article — drop outright. NOTE: kept
// tight on purpose. It must NOT match settlement types ("census-designated place", "human
// settlement" — those are real story stops: Glenbrook, Incline Village) nor incidentally
// match place compounds ("road tunnel" must stay a STORY candidate — Cave Rock Tunnel — so
// no bare "road" here; that footgun mis-dropped Cave Rock Tunnel in the throwaway spike).
const TRUE_NONPLACE =
  /administrative territorial entity|electoral district|\bcounty\b|wikimedia (list|category|disambiguation|template|page)|disambiguation page|\bschool\b|\buniversity\b|\bcollege\b|public library|library branch|\bhospital\b|fire station|police station|radio station|television station|\bnewspaper\b|power station|substation|sewage|wastewater|\bcemetery\b|\bairport\b|water tower/i

// A typed PLACE worth pointing at even with no prose → the scenic scenery layer.
const SCENIC_PLACE =
  /\bbay\b|\bbeach\b|\bcove\b|lagoon|\blake\b|reservoir|\bpond\b|mountain|\bpeak\b|summit|butte|\bdome\b|mountain pass|\bpass\b|\bridge\b|\bhill\b|\bpoint\b|\bcape\b|headland|promontory|\bvalley\b|canyon|gorge|waterfall|\bfalls\b|\bspring\b|geyser|\bisland\b|peninsula|\bmeadow\b|\bgrove\b|\bforest\b|wilderness|state park|national park|\bpark\b|recreation area|protected area|nature reserve|scenic|viewpoint|overlook|\bvista\b|\bcliff\b|rock formation|natural arch|glacier|\bdune\b|historic district|\bharbor\b/i

// Commercial anchors — the Places break layer's territory when they have no notable history.
const COMMERCIAL =
  /\bhotel\b|\bresort\b|\bmotel\b|\binn\b|restaurant|\bcasino\b|\bbar\b|\bcafe\b|café|\bstore\b|\bshop\b|\bmall\b|\bbusiness\b|\bcompany\b|theater|theatre|drive-in|amusement/i

// Areal features whose single centroid sits off the road even when the route hugs them.
const AREAL =
  /\blake\b|reservoir|\bbay\b|\bcove\b|\bharbor\b|\bpark\b|recreation area|protected area|wilderness|\bforest\b|\bvalley\b|canyon|\branch\b|\bestate\b|golf course|management area/i

// Watercourses crossed in seconds (a creek, a river, a culvert) — never a STORY destination,
// even with an article: a two-minute telling about a creek the road bridges is the low-charm
// case. They name no scenery worth a glance either, so they drop. (Lakes/reservoirs/bays are
// NOT watercourses — they stay scenic/areal.)
const WATERCOURSE = /\b(creek|stream|brook|watercourse|canal|river)\b/i

/** Classify one entity into a tier from its P31 types, article presence, and prose length. */
export function tierOf(types: string[], hasArticle: boolean, extractLen: number): Tier {
  const t = types.join(' ; ')
  if (TRUE_NONPLACE.test(t)) return 'drop'
  if (WATERCOURSE.test(t)) return 'drop' // a creek/river is a crossing, not a stop
  if (hasArticle && extractLen >= STORY_MIN_FACT_CHARS) return 'story'
  if (SCENIC_PLACE.test(t)) return 'scenic'
  if (COMMERCIAL.test(t)) return 'break'
  return 'drop'
}

/** Areal features get the wider corridor gate (their centroid can sit off the hugged shore). */
export function isAreal(types: string[]): boolean {
  return AREAL.test(types.join(' ; '))
}

/** The corridor gate for an entity — wider for areal types. */
export function corridorGateM(types: string[]): number {
  return isAreal(types) ? SPINE_AREAL_OFF_ROUTE_MAX_M : OFF_ROUTE_MAX_M
}

/**
 * Normalize a label for same-place dedup: drop the state suffix, parenthetical, case, and the
 * protected-area DESIGNATION suffix so a natural feature collapses with its park item
 * ("Emerald Bay" ⇄ "Emerald Bay State Park"). Only a STATE/NATIONAL-qualified designation is
 * stripped — a bare "...Park" is usually the real name (Tahoe Park, William B Layton Park) and a
 * leading word that is part of the name ("Kings Beach" State Rec Area) must survive, so it is left
 * intact to avoid over-collapse. (Co-located twins like the Sand-Harbor bay vs its rec-area are
 * caught by the spatial dedup in select.ts instead.)
 */
export function normName(label: string): string {
  return label
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/,\s*(california|nevada|ca|nv)\b.*$/, '')
    .replace(
      /\s+(state|national)\s+(recreation area|park|beach|historic park|historic site|forest)\b.*$/,
      '',
    )
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Collapse same-place duplicates: Wikidata often models a settlement and its namesake water
 * feature as two items ("Zephyr Cove, Nevada" the town = STORY; "Zephyr Cove" the bay =
 * SCENIC). Keep the STORY (it already names the place in a richer telling) and drop the
 * same-named scenic/break so the drive doesn't stop twice for one name. Story always wins;
 * otherwise the richest-typed survivor is kept.
 */
export function dedupeByName(cands: WikidataCandidate[]): WikidataCandidate[] {
  const groups = new Map<string, WikidataCandidate[]>()
  for (const c of cands) {
    const k = normName(c.name)
    ;(groups.get(k) ?? groups.set(k, []).get(k)!).push(c)
  }
  const out: WikidataCandidate[] = []
  for (const group of groups.values()) {
    if (group.length === 1) {
      out.push(group[0]!)
      continue
    }
    const story = group.find((g) => g.tier === 'story')
    out.push(story ?? group.sort((a, b) => b.types.length - a.types.length)[0]!)
  }
  return out
}

/** A clean, spoken feature KIND for a named scenic pin (e.g. 'bay'), or undefined when the
 *  P31 types name no evocative natural feature (then the stop is named with no KIND). */
export function featureKind(types: string[]): string | undefined {
  const PREF = [
    'beach',
    'bay',
    'cove',
    'lake',
    'reservoir',
    'point',
    'cape',
    'island',
    'peninsula',
    'waterfall',
    'spring',
    'meadow',
    'summit',
    'peak',
    'mountain',
    'pass',
    'ridge',
    'hill',
    'valley',
    'canyon',
    'recreation area',
    'state park',
    'park',
    'vista',
    'viewpoint',
    'overlook',
    'historic district',
  ]
  const t = types.join(' ; ')
  for (const p of PREF) if (t.includes(p)) return p
  return undefined
}

/**
 * Adapt spine candidates into selection candidates (WikiPoi). Only STORY + SCENIC flow into
 * selection: a STORY carries its Wikipedia prose (source 'wikipedia', pageid + extract); a
 * SCENIC is a named Wikidata feature with no prose (source 'wikidata', extract '', a KIND).
 * BREAK is the Google Places layer's job and DROP is discarded, so neither is emitted.
 */
export function candidatesToWikiPois(cands: WikidataCandidate[]): WikiPoi[] {
  const out: WikiPoi[] = []
  for (const c of cands) {
    if (c.tier === 'story' && c.article) {
      out.push({
        source: 'wikipedia',
        sourceId: String(c.article.pageId),
        title: c.article.title,
        lat: c.lat,
        lng: c.lng,
        extract: c.article.extract,
        url: c.article.url,
        pageid: c.article.pageId,
        ...(c.qid ? { qid: c.qid } : {}),
      })
    } else if (c.tier === 'scenic') {
      const kind = featureKind(c.types)
      out.push({
        source: 'wikidata',
        sourceId: c.qid,
        title: c.name,
        lat: c.lat,
        lng: c.lng,
        extract: '',
        qid: c.qid,
        ...(kind ? { kind } : {}),
      })
    }
  }
  return out
}

/* -------------------------------------------------------------------------- */
/*  Network — WDQS bbox query + corridor filter + prose join                   */
/* -------------------------------------------------------------------------- */

interface RawItem {
  qid: string
  name: string
  lat: number
  lng: number
  types: Set<string>
  articleTitle?: string
}

const titleFromUrl = (u: string): string =>
  decodeURIComponent((u.split('/wiki/')[1] ?? '').replace(/_/g, ' '))

/** Bounding box [SW, NE] of a polyline, padded so an edge entity isn't clipped. */
export function boundingBox(polyline: LngLat[], padDeg = 0.025): { sw: LngLat; ne: LngLat } {
  let latMin = 90,
    latMax = -90,
    lngMin = 180,
    lngMax = -180
  for (const [lng, lat] of polyline) {
    if (lat < latMin) latMin = lat
    if (lat > latMax) latMax = lat
    if (lng < lngMin) lngMin = lng
    if (lng > lngMax) lngMax = lng
  }
  return { sw: [lngMin - padDeg, latMin - padDeg], ne: [lngMax + padDeg, latMax + padDeg] }
}

/** Every geocoded Wikidata entity in a bbox, with its P31 types + enwiki sitelink. */
async function fetchWikidataBox(sw: LngLat, ne: LngLat): Promise<RawItem[]> {
  const query = `SELECT ?item ?itemLabel ?lat ?lon ?typeLabel ?article WHERE {
    SERVICE wikibase:box {
      ?item wdt:P625 ?coord .
      bd:serviceParam wikibase:cornerSouthWest "Point(${sw[0]} ${sw[1]})"^^geo:wktLiteral .
      bd:serviceParam wikibase:cornerNorthEast "Point(${ne[0]} ${ne[1]})"^^geo:wktLiteral .
    }
    ?item p:P625/psv:P625 ?node . ?node wikibase:geoLatitude ?lat ; wikibase:geoLongitude ?lon .
    OPTIONAL { ?item wdt:P31 ?type . }
    OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
  }`
  // WDQS is the discovery spine's single hard dependency (no fallback). Surface BOTH failure
  // shapes — a network/timeout exhaustion and an HTTP error — as ONE actionable message: this is
  // almost always transient rate-limiting/overload, the run spent $0 (discovery precedes every
  // paid call), so "retry later" is the whole recovery. (Keeps a human from reading a bare
  // "WDQS HTTP 429" as a code bug.)
  let res: Response
  try {
    res = await fetchWithRetry(
      `${WDQS_ENDPOINT}?query=${encodeURIComponent(query)}`,
      { headers: { 'User-Agent': WDQS_USER_AGENT, Accept: 'application/sparql-results+json' } },
      { attempts: 3, timeoutMs: REQUEST_TIMEOUT_MS },
    )
  } catch (e) {
    throw new Error(
      `Wikidata Query Service (WDQS) unreachable after retries (${(e as Error).message}). ` +
        `Discovery has no fallback, but no spend was incurred — retry later.`,
    )
  }
  if (!res.ok) {
    const retryAfter = res.headers.get('retry-after')
    throw new Error(
      `Wikidata Query Service (WDQS) returned HTTP ${res.status}` +
        (retryAfter ? ` (Retry-After: ${retryAfter}s)` : '') +
        ` — usually rate-limited or overloaded. Discovery has no fallback, but no spend was ` +
        `incurred — retry later.`,
    )
  }
  const json = (await res.json()) as {
    results?: { bindings?: Record<string, { value: string }>[] }
  }
  const items = new Map<string, RawItem>()
  for (const b of json.results?.bindings ?? []) {
    const qid = b.item!.value.replace(/^.*\/(Q\d+)$/, '$1')
    let it = items.get(qid)
    if (!it) {
      it = {
        qid,
        name: b.itemLabel?.value ?? qid,
        lat: +b.lat!.value,
        lng: +b.lon!.value,
        types: new Set(),
      }
      items.set(qid, it)
    }
    if (b.typeLabel?.value) it.types.add(b.typeLabel.value.toLowerCase())
    if (b.article?.value && !it.articleTitle) it.articleTitle = titleFromUrl(b.article.value)
  }
  return [...items.values()]
}

/** Nearest distance (m) from a point to the route — vertex-sampled (dense polyline ⇒ exact enough). */
function distToRoute(lat: number, lng: number, sampledVerts: LngLat[]): number {
  let min = Infinity
  for (const v of sampledVerts) {
    const d = haversineMeters([lng, lat], v)
    if (d < min) min = d
  }
  return min
}

/**
 * Discover + tier Wikidata POIs along a route. SPARQL bbox → corridor filter (areal-aware)
 * → prose-join story candidates via Wikipedia sitelink → tier → same-place dedup. Network
 * (WDQS + MediaWiki).
 *
 * Discovery is a HARD dependency with NO fallback — the Wikidata spine replaced the old
 * Wikipedia-geosearch path wholesale (see the wikidata-discovery-spine decision), so there is
 * no second discovery source to fall back to. A hard WDQS failure (after fetchWithRetry's
 * retries) throws an actionable error and aborts the run — cheaply: discovery runs BEFORE any
 * paid LLM/TTS call, so the run fails at $0 with the seeded tour shell untouched, and "retry
 * later" is the whole recovery. (An EMPTY result is not an error here — it surfaces downstream
 * as generate.ts's "No narratable stops found" once selection yields nothing.)
 */
/**
 * Discover + tier Wikidata POIs in a raw BBOX — the FREE-ROAM sweep's discovery (no route,
 * so no corridor filter; offRouteM is 0 by construction). Same spine, prose-join, tiering,
 * and same-place dedup as the route path below. Callers sweeping a large area should split
 * it into modest sub-boxes (WDQS result-size etiquette) and merge by qid before dedupe —
 * see discover-pois.ts.
 */
export async function discoverWikidataBbox(sw: LngLat, ne: LngLat): Promise<WikidataCandidate[]> {
  const raw = await fetchWikidataBox(sw, ne)
  const storyCandidates = raw.filter(
    (it) => it.articleTitle && !TRUE_NONPLACE.test([...it.types].join(' ; ')),
  )
  const extracts = storyCandidates.length
    ? await fetchExtractsByTitle([...new Set(storyCandidates.map((it) => it.articleTitle!))])
    : []
  const extractByTitle = new Map(extracts.map((e) => [e.title.toLowerCase(), e]))
  const candidates: WikidataCandidate[] = raw.map((it) => {
    const ex = it.articleTitle ? extractByTitle.get(it.articleTitle.toLowerCase()) : undefined
    const types = [...it.types]
    const tier = tierOf(types, !!ex, ex?.extract.length ?? 0)
    return {
      qid: it.qid,
      name: it.name,
      lat: it.lat,
      lng: it.lng,
      types,
      tier,
      offRouteM: 0,
      ...(tier === 'story' && ex
        ? { article: { title: ex.title, url: ex.url, pageId: ex.pageId, extract: ex.extract } }
        : {}),
    }
  })
  return dedupeByName(candidates)
}

export async function discoverWikidataPois(polyline: LngLat[]): Promise<WikidataCandidate[]> {
  const { sw, ne } = boundingBox(polyline)
  const raw = await fetchWikidataBox(sw, ne)

  // Corridor filter (sample every 8th vertex for speed; ~tens of metres apart on our dense lines).
  const verts = polyline.filter((_, i) => i % 8 === 0)
  const inCorridor = raw
    .map((it) => ({ it, offRouteM: distToRoute(it.lat, it.lng, verts) }))
    .filter(({ it, offRouteM }) => offRouteM <= corridorGateM([...it.types]))

  // Prose-join: fetch lead extracts only for corridor items that COULD be a story (have an
  // article and aren't an outright non-place) — never for drop/scenic-only pins.
  const storyCandidates = inCorridor.filter(
    ({ it }) => it.articleTitle && !TRUE_NONPLACE.test([...it.types].join(' ; ')),
  )
  const extracts = storyCandidates.length
    ? await fetchExtractsByTitle([...new Set(storyCandidates.map(({ it }) => it.articleTitle!))])
    : []
  const extractByTitle = new Map(extracts.map((e) => [e.title.toLowerCase(), e]))

  const candidates: WikidataCandidate[] = inCorridor.map(({ it, offRouteM }) => {
    const ex = it.articleTitle ? extractByTitle.get(it.articleTitle.toLowerCase()) : undefined
    const types = [...it.types]
    const tier = tierOf(types, !!ex, ex?.extract.length ?? 0)
    return {
      qid: it.qid,
      name: it.name,
      lat: it.lat,
      lng: it.lng,
      types,
      tier,
      offRouteM: Math.round(offRouteM),
      ...(tier === 'story' && ex
        ? { article: { title: ex.title, url: ex.url, pageId: ex.pageId, extract: ex.extract } }
        : {}),
    }
  })

  return dedupeByName(candidates)
}
