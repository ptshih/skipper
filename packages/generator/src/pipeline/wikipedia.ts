// Wikipedia grounded facts — the PROSE layer for STORY stops.
//
// Discovery is the Wikidata spine now (pipeline/wikidata-discovery.ts); Wikipedia is the
// prose well joined onto a story candidate by article title (`fetchExtractsByTitle`) and
// deepened to the full article for the chosen stops (`fetchDeepExtracts`). The extract text
// IS the grounded fact source — a story candidate whose extract is thin is downgraded to
// scenic (silence beats a hallucinated battle).
//
// Etiquette honored: descriptive User-Agent (required), maxlag=5, formatversion=2,
// requests in series. License for reuse is CC BY-SA 4.0 — attribution is snapshotted onto
// the tour_stop at generation time (see generate.ts).

import { DEEP_EXTRACT_CHARS, EXTRACT_CHARS, WIKIPEDIA_USER_AGENT } from '../config'
import { fetchWithRetry, sleep } from './http'
import {
  applyFactEditsChecked,
  ensurePoiOverridesLoaded,
  reportMissedEdits,
} from './poi-overrides'

const API = 'https://en.wikipedia.org/w/api.php'
/** Cap maxlag retries so sustained Wikimedia replication lag fails loudly instead of hanging forever. */
const MAX_MAXLAG_RETRIES = 5
/** Per-attempt timeout (ms). A hung connection (TCP open, server never responds) never rejects,
 *  so without this the retry machinery never fires and one stalled MediaWiki call hangs the whole
 *  run. Payloads are small JSON; generous-but-finite. (Mirrors wikidata/macrostrat.) */
const REQUEST_TIMEOUT_MS = 15_000

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

/**
 * A selection candidate placed by (lat,lng) — produced by the Wikidata discovery spine
 * (pipeline/wikidata-discovery.ts). A STORY candidate carries Wikipedia prose (source
 * 'wikipedia', a pageid + a non-empty extract); a SCENIC candidate is a named Wikidata
 * feature with no prose (source 'wikidata', extract ''). `extract.length` still drives the
 * story↔scenic split in select.ts, and `source`/`sourceId` become the pois (source, source_id).
 */
export interface WikiPoi {
  /** Discovery source for the pois row: 'wikipedia' (story prose) | 'wikidata' (named scenic). */
  source: 'wikipedia' | 'wikidata'
  /** Dedup id paired with source: a Wikipedia pageid (story) or a Wikidata QID (scenic). */
  sourceId: string
  title: string
  lat: number
  lng: number
  /** Lead extract — the grounded story well; '' for a scenic pin (no prose). */
  extract: string
  /** Wikipedia article url (story) — the CC BY-SA attribution link; absent for a scenic pin. */
  url?: string
  /** Wikipedia pageid (story) — for the deep-extract fetch + attribution; absent for a scenic pin. */
  pageid?: number
  /** Linked Wikidata QID — the enrichment join key (story) and the source id (scenic). */
  qid?: string
  /** P31 feature type for a NAMED scenic pin (e.g. 'bay') — spoken as the KIND, sayable like a break's. */
  kind?: string
  /** Curated/admin "where to look" anchor (pois.speakable) — overrides the pin for the
   *  side-of-road computation when the pin misleads. Carried from the corpus, not a code map. */
  speakableLat?: number
  speakableLng?: number
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
  const res = await fetchWithRetry(
    `${API}?${qs}`,
    { headers: { 'User-Agent': WIKIPEDIA_USER_AGENT } },
    { timeoutMs: REQUEST_TIMEOUT_MS },
  )
  const body = await res.text()
  let json: ({ error?: { code: string; info: string } } & T) | undefined
  try {
    json = JSON.parse(body)
  } catch {
    throw new Error(`Wikipedia returned non-JSON (HTTP ${res.status}): ${body.slice(0, 160)}`)
  }
  // JSON.parse succeeds for a literal `null`/scalar body (a misbehaving proxy could send
  // 200 + "null"); guard the shape before reading `.error` so it surfaces as a clear message
  // rather than a raw "Cannot read properties of null" TypeError thrown outside the catch.
  if (json === null || typeof json !== 'object') {
    throw new Error(`Wikipedia returned a non-object body (HTTP ${res.status}): ${body.slice(0, 160)}`)
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

// Trailing article sections that are NOT narration facts (lists of citations,
// links, etc.). With exsectionformat=plain these appear as bare heading lines; we
// cut the deep extract at the first one so the fact sheet stays story material.
const END_SECTION =
  /\n\s*(References|See also|External links?|Notes|Further reading|Bibliography|Citations|Sources|Gallery)\s*\n/i

/** Full-article plain-text extract for ONE page (no exintro), capped + trimmed of trailing meta. */
async function fetchArticleExtract(pageid: number): Promise<string> {
  await ensurePoiOverridesLoaded()
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
  // Curated upstream-error corrections ride EVERY fetch (pipeline/poi-overrides.ts), so the
  // fixed text is what reaches the sheet, pois.facts, and facts_hash. NB: edits apply AFTER
  // the server-side exchars cap — a find-string straddling the truncation boundary misses
  // (and warns), it can never half-apply.
  const cut = raw.split(END_SECTION)[0]!.trim()
  const { text, missed } = applyFactEditsChecked('wikipedia', String(pageid), cut)
  reportMissedEdits('wikipedia', String(pageid), missed, 'deep-extract')
  return text
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
  await ensurePoiOverridesLoaded()
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
      // Curated upstream-error corrections ride lead extracts too — this is the path
      // mergedFeatures facts come from (pipeline/poi-overrides.ts). A lead miss can be
      // benign (the target sentence sits deeper than the lead cap) — the warn says so.
      const { text, missed } = applyFactEditsChecked(
        'wikipedia',
        String(p.pageid),
        (p.extract ?? '').trim(),
      )
      reportMissedEdits('wikipedia', String(p.pageid), missed, 'lead-extract')
      out.push({
        title: p.title,
        pageId: p.pageid,
        extract: text,
        url: p.canonicalurl ?? p.fullurl ?? `https://en.wikipedia.org/?curid=${p.pageid}`,
        ...(p.pageprops?.wikibase_item ? { qid: p.pageprops.wikibase_item } : {}),
      })
    }
  }
  return out
}

