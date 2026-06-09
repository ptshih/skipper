// Wikipedia grounded facts — the well of truth for STORY stops.
//
// Two phases against the public MediaWiki Action API (no key, bun's global
// fetch): geosearch probes along the route, then batched lead-section extracts.
// The extract text IS the grounded fact source — a POI with a thin/empty extract
// is later downgraded to scenic (silence beats a hallucinated battle).
//
// Etiquette honored: descriptive User-Agent (required), maxlag=5, formatversion=2,
// requests in series. License for reuse is CC BY-SA 4.0 — attribution is
// snapshotted onto poi_content at generation time (see generate.ts).

import {
  DEEP_EXTRACT_CHARS,
  EXTRACT_CHARS,
  GEOSEARCH_RADIUS_M,
  WIKIPEDIA_USER_AGENT,
} from '../config'
import type { LngLat } from './geo'
import { fetchWithRetry, sleep } from './http'

const API = 'https://en.wikipedia.org/w/api.php'
/** Cap maxlag retries so sustained Wikimedia replication lag fails loudly instead of hanging forever. */
const MAX_MAXLAG_RETRIES = 5

interface GeoHit {
  pageid: number
  title: string
  lat: number
  lon: number
  dist: number
}

interface ExtractPage {
  pageid: number
  title: string
  extract?: string
  fullurl?: string
  canonicalurl?: string
  missing?: boolean
  /** Page properties; `wikibase_item` is the linked Wikidata QID (the enrichment join key). */
  pageprops?: { wikibase_item?: string }
}

/** A grounded Wikipedia POI candidate placed by (lat,lng). `extract` may be '' (thin → scenic). */
export interface WikiPoi {
  pageid: number
  title: string
  lat: number
  lng: number
  extract: string
  url: string
  /** Linked Wikidata QID (from the page's `wikibase_item` prop), when the page has one. */
  qid?: string
}

/**
 * One MediaWiki call with the required UA. Transient 429/5xx are retried by
 * fetchWithRetry; maxlag (which can come back as HTTP 200 OR 503, always with a
 * JSON error body) is retried up to MAX_MAXLAG_RETRIES; an edge 4xx/5xx with a
 * non-JSON (HTML) body surfaces as a clear error with the status instead of a
 * cryptic JSON.parse crash.
 */
async function wiki<T>(params: Record<string, string>, maxlagAttempt = 0): Promise<T> {
  const qs = new URLSearchParams({ format: 'json', formatversion: '2', maxlag: '5', ...params })
  const res = await fetchWithRetry(`${API}?${qs}`, {
    headers: { 'User-Agent': WIKIPEDIA_USER_AGENT },
  })
  const body = await res.text()
  let json: ({ error?: { code: string; info: string } } & T) | undefined
  try {
    json = JSON.parse(body)
  } catch {
    throw new Error(`Wikipedia returned non-JSON (HTTP ${res.status}): ${body.slice(0, 160)}`)
  }
  if (json!.error?.code === 'maxlag') {
    if (maxlagAttempt >= MAX_MAXLAG_RETRIES)
      throw new Error(`Wikipedia maxlag persisted after ${MAX_MAXLAG_RETRIES} retries.`)
    const wait = Number(res.headers.get('retry-after') ?? '5')
    await sleep(wait * 1000)
    return wiki<T>(params, maxlagAttempt + 1)
  }
  if (json!.error) throw new Error(`Wikipedia API ${json!.error.code}: ${json!.error.info}`)
  if (!res.ok) throw new Error(`Wikipedia HTTP ${res.status}`)
  return json as T
}

/** Pages with a coordinate within `radiusM` of a point. gsprimary=all catches secondary-coord pages too. */
async function geosearch(lat: number, lng: number, radiusM: number): Promise<GeoHit[]> {
  const j = await wiki<{ query?: { geosearch?: GeoHit[] } }>({
    action: 'query',
    list: 'geosearch',
    gscoord: `${lat}|${lng}`,
    gsradius: String(Math.min(radiusM, 10_000)),
    gslimit: '50',
    gsnamespace: '0',
    gsprimary: 'all',
  })
  return j.query?.geosearch ?? []
}

/** Batched lead-section extracts (≤20 pageids per call — the exlimit hard cap). */
async function fetchExtracts(pageids: number[]): Promise<ExtractPage[]> {
  const out: ExtractPage[] = []
  for (let i = 0; i < pageids.length; i += 20) {
    const chunk = pageids.slice(i, i + 20)
    const j = await wiki<{ query?: { pages?: ExtractPage[] } }>({
      action: 'query',
      prop: 'extracts|info|pageprops',
      pageids: chunk.join('|'),
      exintro: '1', // lead section only — required to return >1 extract per call
      explaintext: '1', // clean plain text for TTS
      exchars: String(EXTRACT_CHARS),
      exlimit: '20',
      inprop: 'url',
      ppprop: 'wikibase_item', // the linked Wikidata QID — our enrichment join key
    })
    out.push(...(j.query?.pages ?? []))
  }
  return out
}

// Trailing article sections that are NOT narration facts (lists of citations,
// links, etc.). With exsectionformat=plain these appear as bare heading lines; we
// cut the deep extract at the first one so the fact sheet stays story material.
const END_SECTION =
  /\n\s*(References|See also|External links?|Notes|Further reading|Bibliography|Citations|Sources|Gallery)\s*\n/i

/** Full-article plain-text extract for ONE page (no exintro), capped + trimmed of trailing meta. */
async function fetchArticleExtract(pageid: number): Promise<string> {
  // exintro is OFF here (we want the body, not just the lead), and MediaWiki forces
  // exlimit=1 in that mode — so this is one page per call. exchars caps the size.
  const j = await wiki<{ query?: { pages?: ExtractPage[] } }>({
    action: 'query',
    prop: 'extracts',
    pageids: String(pageid),
    explaintext: '1',
    exsectionformat: 'plain',
    exchars: String(DEEP_EXTRACT_CHARS),
  })
  const raw = (j.query?.pages?.[0]?.extract ?? '').trim()
  return raw.split(END_SECTION)[0]!.trim()
}

/**
 * Deep fact sheets for the SELECTED story POIs: one full-article extract each (in
 * series, per etiquette). Used to give a chosen story stop more grounded material
 * than the lead section alone, so the narration can run longer WITHOUT padding. A
 * per-POI failure is non-fatal — the caller keeps that stop's lead facts.
 */
export async function fetchDeepExtracts(pageids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  for (const id of pageids) {
    try {
      const text = await fetchArticleExtract(id)
      if (text) out.set(id, text)
    } catch (e) {
      console.warn(
        `Deep extract for page ${id} failed (${(e as Error).message}) — keeping lead facts.`,
      )
    }
    await sleep(200) // gentle pacing between full-article calls
  }
  return out
}

/** A lead extract resolved by article TITLE (the join key the Wikidata spine has). */
export interface TitleExtract {
  title: string
  pageId: number
  extract: string
  url: string
  /** Linked Wikidata QID (`wikibase_item`), when present. */
  qid?: string
}

/**
 * Lead-section extracts BY ARTICLE TITLE — the prose-join for the Wikidata discovery spine,
 * which resolves a sitelink to a title (not a pageid). Same batched query as `fetchExtracts`
 * (≤20/call, the exlimit cap); MediaWiki normalizes titles and drops missing ones. Returns
 * one entry per resolved page (its normalized title), with the linked QID when present.
 */
export async function fetchExtractsByTitle(titles: string[]): Promise<TitleExtract[]> {
  const out: TitleExtract[] = []
  for (let i = 0; i < titles.length; i += 20) {
    const chunk = titles.slice(i, i + 20)
    const j = await wiki<{ query?: { pages?: ExtractPage[] } }>({
      action: 'query',
      prop: 'extracts|info|pageprops',
      titles: chunk.join('|'),
      exintro: '1',
      explaintext: '1',
      exchars: String(EXTRACT_CHARS),
      exlimit: '20',
      inprop: 'url',
      ppprop: 'wikibase_item',
    })
    for (const p of j.query?.pages ?? []) {
      if (p.missing) continue
      out.push({
        title: p.title,
        pageId: p.pageid,
        extract: (p.extract ?? '').trim(),
        url: p.canonicalurl ?? p.fullurl ?? `https://en.wikipedia.org/?curid=${p.pageid}`,
        ...(p.pageprops?.wikibase_item ? { qid: p.pageprops.wikibase_item } : {}),
      })
    }
  }
  return out
}

/**
 * Discover grounded POIs along the corridor: geosearch at each sampled point (in
 * series, per etiquette), dedup by pageid (matches the pois (source, source_id)
 * invariant), then batch-fetch extracts. Returns one WikiPoi per unique page.
 */
export async function discoverWikipediaPois(samples: { point: LngLat }[]): Promise<WikiPoi[]> {
  const byId = new Map<number, GeoHit>()
  for (const s of samples) {
    const [lng, lat] = s.point
    const hits = await geosearch(lat, lng, GEOSEARCH_RADIUS_M)
    for (const h of hits) if (!byId.has(h.pageid)) byId.set(h.pageid, h)
  }

  const pages = await fetchExtracts([...byId.keys()])
  const extractById = new Map<number, ExtractPage>()
  for (const p of pages) if (!p.missing) extractById.set(p.pageid, p)

  const pois: WikiPoi[] = []
  for (const hit of byId.values()) {
    const page = extractById.get(hit.pageid)
    pois.push({
      pageid: hit.pageid,
      title: hit.title,
      lat: hit.lat,
      lng: hit.lon,
      extract: (page?.extract ?? '').trim(),
      url: page?.canonicalurl ?? page?.fullurl ?? `https://en.wikipedia.org/?curid=${hit.pageid}`,
      ...(page?.pageprops?.wikibase_item ? { qid: page.pageprops.wikibase_item } : {}),
    })
  }
  return pois
}
