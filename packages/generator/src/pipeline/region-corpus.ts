// Tour discovery from the REGION CORPUS (the discovery-first reorder, 2026-06-12).
//
// Discovery is a region-level step now: sweep-region-pois.ts populates the shared `pois` table
// for a region's bbox (STORY rows carrying Wikipedia prose, SCENIC named pins), and BOTH tours
// and roam draw from that one corpus. A tour generate no longer calls WDQS live — it reads its
// candidates from this pool, scoped to the route's bounding box, and rebuilds the SAME WikiPoi
// shape the Wikidata spine used to emit (candidatesToWikiPois). Lossless: the sweep stores
// extract/title/url/pageId/qid in pois.facts for STORY rows, so nothing the selector or the
// facts-deepen step needs is dropped. Selection (select.ts) + the deepen (loadFreshPoiFacts)
// downstream are unchanged — they already read facts from `pois`.

import { and, between, inArray } from 'drizzle-orm'
import { db } from '@skipper/db'
import { pois } from '@skipper/db/schema'
import type { PoiFacts } from '@skipper/db/schema'
import { STORY_TASTE_DENYLIST } from '@skipper/shared'
import { withRetry } from './http'
import type { LngLat } from './geo'
import type { WikiPoi } from './wikipedia'

/** The discovery payload the region sweep stores in `pois.facts` for a STORY row. */
interface StoryFacts {
  extract?: string
  title?: string
  url?: string
  pageId?: number
  qid?: string
}

/**
 * Tour candidates from the region corpus, scoped to the route's bounding box. STORY rows
 * (source 'wikipedia') carry their Wikipedia prose; SCENIC rows (source 'wikidata') are named
 * pins with no prose — exactly what `candidatesToWikiPois` produced, but read from `pois`
 * instead of a live WDQS sweep. Break stops are NOT here (they come from Google Places at
 * generation time), so the query is scoped to the two discovery sources.
 */
export async function loadCandidatePoisInBox(sw: LngLat, ne: LngLat): Promise<WikiPoi[]> {
  const rows = await withRetry(
    () =>
      db
        .select({
          source: pois.source,
          sourceId: pois.sourceId,
          name: pois.name,
          kind: pois.kind,
          lat: pois.lat,
          lng: pois.lng,
          speakableLat: pois.speakableLat,
          speakableLng: pois.speakableLng,
          facts: pois.facts,
        })
        .from(pois)
        .where(
          and(
            inArray(pois.source, ['wikipedia', 'wikidata']),
            between(pois.lat, sw[1], ne[1]),
            between(pois.lng, sw[0], ne[0]),
          ),
        ),
    { label: 'loadCandidatePoisInBox' },
  )

  const out: WikiPoi[] = []
  let tasteGated = 0
  for (const r of rows) {
    // TASTE gate — the shared story-eligibility rule (@skipper/shared), applied to the tour candidate
    // pool the same way roam's queue applies it: a violent-crime / personal-tragedy article is never a
    // charming stop, so drop it ENTIRELY (story OR scenic) rather than let a tour narrate it. Apply the
    // denylist directly (not classifyStoryEligibility, which would also drop the wikidata scenic pins we
    // WANT to keep). Title-keyed; any source. Tours' thin→scenic downgrade stays in select.ts.
    if (STORY_TASTE_DENYLIST.test(r.name)) {
      tasteGated++
      continue
    }
    // The curated/admin "where to look" anchor (pois.speakable) — carried onto the candidate so
    // select.ts can recompute the side-of-road from where the content IS, not the misleading pin.
    const speakable =
      r.speakableLat != null && r.speakableLng != null
        ? { speakableLat: r.speakableLat, speakableLng: r.speakableLng }
        : {}
    if (r.source === 'wikipedia') {
      const f = (r.facts ?? {}) as StoryFacts
      out.push({
        source: 'wikipedia',
        sourceId: r.sourceId,
        title: r.name,
        lat: r.lat,
        lng: r.lng,
        extract: f.extract ?? '',
        ...(f.url ? { url: f.url } : {}),
        pageid: f.pageId ?? Number(r.sourceId),
        ...(f.qid ? { qid: f.qid } : {}),
        ...(r.kind ? { kind: r.kind } : {}),
        // Carry the FULL corpus facts (well + extract + provenance) for the well↔extract grounding
        // switch + the staleness fingerprint downstream (select → generate-tour). r.facts is the
        // jsonb; cast through StoryFacts↦PoiFacts (a story row always has facts here).
        ...(r.facts ? { facts: r.facts as PoiFacts } : {}),
        ...speakable,
      })
    } else {
      // wikidata = a named SCENIC pin (no prose); sourceId IS the QID.
      out.push({
        source: 'wikidata',
        sourceId: r.sourceId,
        title: r.name,
        lat: r.lat,
        lng: r.lng,
        extract: '',
        qid: r.sourceId,
        ...(r.kind ? { kind: r.kind } : {}),
        ...speakable,
      })
    }
  }
  if (tasteGated > 0) console.log(`  taste-gate: dropped ${tasteGated} candidate(s) from the tour pool.`)
  return out
}
