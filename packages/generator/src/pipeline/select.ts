// Stop selection — turn raw POI candidates into an ordered, time-paced set of
// tour stops. Pacing is by drive TIME (the invariant): every candidate is placed
// on the route, its along-route distance converted to seconds via the frozen
// total drive time, and stops are spaced by a minimum time gap.
//
// Candidates come from the Wikidata discovery spine (pipeline/wikidata-discovery.ts).
// Rules baked in here:
//   - STORY  = a candidate with a Wikipedia article (source 'wikipedia') whose lead extract
//     is rich enough to ground a telling.
//   - SCENIC = a NAMED Wikidata feature with no prose (source 'wikidata', extract '') — a bay,
//     a beach, a cove. Delivery-only: it speaks its NAME + KIND (sayable like a break's, CC0)
//     but asserts no facts. Carries an empty extract, so it loses any spacing window to a real
//     story and only lands where there is no story — filling the silent gaps.
//   - BREAK  = a Google Places food/rest anchor; NAMED audio (name + kind only,
//     normalized; no volatile data) — mandatory, like story/scenic.
// Within each spacing window we prefer the richest extract, so good stories win
// over thin/scenic neighbours.

import type { PoiSource, StopType } from '@skipper/shared'
import type { AttributionSnapshot, PoiFacts, WellSpan } from '@skipper/db/schema'
import { wellToAttribution } from './persist'
import {
  BREAK_MIN_GAP_SEC,
  MERGE_EXTRA_SEC,
  MERGE_MAX_MEMBERS,
  MIN_STOP_SEPARATION_M,
  OFF_ROUTE_MAX_M,
  PACING,
  STORY_MIN_FACT_CHARS,
  TARGET_SECONDS,
  TRIGGER_RADIUS_M,
} from '../config'
import type { BucketPacing } from '../config'
import {
  cumulativeMeters,
  haversineMeters,
  nearestOnRoute,
  routeBearingAt,
  sideOfApproach,
  timeAtAlong,
  totalMeters,
} from './geo'
import type { LngLat } from './geo'
import type { WikiPoi } from './wikipedia'
import type { BreakAnchor } from './places'

export interface StopPlan {
  seq: number
  stopType: StopType
  source: PoiSource
  sourceId: string
  name: string
  kind: string | null
  lat: number
  lng: number
  /** Along-route time (seconds) — for ordering/pacing/debug. */
  alongSec: number
  /** STORY only: grounded fact sentences (the entire well the narrator may use). Set to the
   *  positional extract head by selection; generate-tour OVERRIDES it with resolveStoryGrounding
   *  (the curated well when enriched, the capped extract head otherwise). */
  facts: string[]
  /** STORY only: the poi's full corpus facts object — the well↔extract grounding source +
   *  the grounding fingerprint (resolveStoryGrounding / storyFactsHash). Carried from the corpus
   *  (region-corpus), never re-fetched. Absent for scenic. */
  poiFacts?: PoiFacts
  /** STORY only: true once generate-tour grounds this stop on a curated WELL (vs the extract head). */
  enriched?: boolean
  /** STORY only: the frozen credit for an ENRICHED stop — the well's distinct sources (set in
   *  generate-tour from resolveStoryGrounding). An un-enriched stop builds attribution the old way. */
  wellAttribution?: AttributionSnapshot[]
  /** STORY + SCENIC: coordinate-keyed geology facts (Macrostrat), attached post-selection in generate.ts. */
  geology?: string[]
  /** Why a STORY stop got geology: 'sparse' (thin facts) or 'iconic' (allowlisted rich) — picks the narration cue. */
  geologyReason?: 'sparse' | 'iconic'
  /** Macrostrat attribution (CC BY 4.0) for the geology facts — folded into the clip's attribution array. */
  geologyAttribution?: AttributionSnapshot
  /** STORY only: linked Wikidata QID (from the page's `wikibase_item`) — the enrichment join key. */
  wikidataQid?: string
  /** STORY only: Wikidata structured facts (inception/elevation/named-after/…), attached post-selection in generate.ts. */
  wikidata?: string[]
  /** Wikidata attribution (CC0) for the structured facts — folded into the clip's attribution array. */
  wikidataAttribution?: AttributionSnapshot
  targetSeconds: number
  triggerRadiusM: number
  /** The POI snapped to the nearest route point (the trigger point) — [lat,lng]. */
  triggerLat: number
  triggerLng: number
  /** Route heading of travel (deg, 0=N) at the trigger point — the approach direction. */
  approachHeadingDeg: number
  /** Which side of the road the POI is on relative to travel ('left'/'right') — only when
   *  the route geometry calls it confidently; absent when too near dead-ahead/behind. */
  sideOfRoad?: 'left' | 'right'
  /** STORY only: Wikipedia attribution source (CC BY-SA). */
  wikiUrl?: string
  wikiTitle?: string
  wikiPageId?: number
  /** STORY only: co-located landmarks MERGED into this stop — their facts + sources. A separate
   *  channel (survives fact-sheet deepening, which only touches `facts`); each adds attribution. */
  mergedFeatures?: {
    name: string
    facts: string[]
    wikiUrl: string
    wikiTitle: string
    wikiPageId: number
    wikidataQid?: string
  }[]
}

export interface SelectParams {
  polyline: LngLat[]
  /** Total drive time for the corridor (seconds) — the pacing clock. */
  totalSec: number
  wikiPois: WikiPoi[]
  breakAnchors: BreakAnchor[]
  pacing: BucketPacing
}

// Wikipedia pages that are real articles but make terrible tour stops: index/
// list pages, NRHP listing rolls, disambiguation pages. Their extracts are dense
// (so they'd win a window) but they're meta, not places. Drop them as candidates.
const NON_NARRATABLE_TITLE =
  /^(List of |Lists of |National Register of Historic Places listings)|listings in|\(disambiguation\)/i

/** Split an extract into clean fact sentences for the fact sheet. */
export function toFacts(extract: string): string[] {
  return extract
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/** The positional HEAD of an extract — cap to `maxChars`, trimming back to the last full sentence
 *  so narration never grounds on a half sentence (mirrors fetchArticleExtract's truncation). The
 *  un-enriched fallback's narration bound; a no-op when the extract already fits. */
export function headOfExtract(extract: string, maxChars: number): string {
  if (extract.length <= maxChars) return extract
  const head = extract.slice(0, maxChars)
  const lastEnd = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '))
  return (lastEnd > 0 ? head.slice(0, lastEnd + 1) : head).trim()
}

/** The narration sheet + attribution for a STORY poi, resolving the curated narration sheet:
 *  the verbatim `facts.well` when the place has been ENRICHED, else the positional `extract` head
 *  (the un-enriched fallback — today's behavior, byte-for-byte, until a paid enrich run). The SINGLE
 *  source for BOTH tours and roam so the well↔fallback switch (and its frozen credit) can never
 *  drift between consumers. The well's credit uses its `enrichedAt`; the fallback's Wikipedia credit
 *  uses the caller's `retrievedAt` (the poi's facts_fetched_at). See corpus-enrichment-spec §6/§7. */
export interface StoryGrounding {
  facts: string[]
  attribution: AttributionSnapshot[]
  /** True iff grounded on a curated well (vs the extract-head fallback). */
  enriched: boolean
}

export function resolveStoryGrounding(
  facts: PoiFacts,
  opts: { fallbackChars: number; retrievedAt: string },
): StoryGrounding {
  const well = facts.well as WellSpan[] | undefined
  if (Array.isArray(well) && well.length > 0) {
    const enrichedAt = typeof facts.enrichedAt === 'string' ? facts.enrichedAt : opts.retrievedAt
    return {
      facts: well.map((s) => s.text),
      attribution: wellToAttribution(well, enrichedAt),
      enriched: true,
    }
  }
  const extract = typeof facts.extract === 'string' ? facts.extract : ''
  const title = typeof facts.title === 'string' ? facts.title : undefined
  const url = typeof facts.url === 'string' ? facts.url : undefined
  const sourceId = typeof facts.pageId === 'number' ? String(facts.pageId) : ''
  return {
    facts: toFacts(headOfExtract(extract, opts.fallbackChars)),
    attribution: [
      {
        source: 'wikipedia',
        sourceId,
        ...(title ? { title } : {}),
        ...(url ? { url } : {}),
        license: 'CC BY-SA 4.0',
        retrievedAt: opts.retrievedAt,
      },
    ],
    enriched: false,
  }
}

interface Placed {
  poi: WikiPoi
  alongSec: number
  /** Co-located POIs folded INTO this one (instead of dropped) — merged into one richer stop. */
  merged?: WikiPoi[]
}

/**
 * Cluster co-located candidates: when two POIs sit within MIN_STOP_SEPARATION_M of each other
 * on the ground they are the same physical stop (e.g. Fannette Island ⊂ Emerald Bay), so they
 * must not be two separate stops. Keep the RICHEST extract as the survivor and, instead of
 * DISCARDING the co-located ones, FOLD them into the survivor as `merged` members — so a
 * highlight like Emerald Bay becomes one richer telling (bay + castle + island + falls) rather
 * than losing the castle and island entirely. Only story-grade extracts merge, capped per stop
 * (MERGE_MAX_MEMBERS) so a survivor can't bloat. Greedy richest-first, so survivors win.
 */
function dedupeColocated(placed: Placed[]): Placed[] {
  const byRichness = [...placed].sort((a, b) => b.poi.extract.length - a.poi.extract.length)
  const kept: Placed[] = []
  for (const cand of byRichness) {
    const host = kept.find(
      (k) =>
        haversineMeters([k.poi.lng, k.poi.lat], [cand.poi.lng, cand.poi.lat]) <
        MIN_STOP_SEPARATION_M,
    )
    if (!host) {
      kept.push(cand)
      continue
    }
    // Co-located with a richer kept stop → fold its facts in rather than drop them.
    if (
      cand.poi.extract.length >= STORY_MIN_FACT_CHARS &&
      (host.merged?.length ?? 0) < MERGE_MAX_MEMBERS
    ) {
      ;(host.merged ??= []).push(cand.poi)
    }
  }
  return kept
}

/** A POI snapped to the route: its along-route time, off-route distance, trigger point, approach heading, and which side of the road it sits on. */
interface Snap {
  alongSec: number
  offRouteM: number
  triggerLat: number
  triggerLng: number
  approachHeadingDeg: number
  /** Which side of the road the POI is on relative to travel — null when too near dead-ahead/behind to call. */
  sideOfRoad: 'left' | 'right' | null
}
type SnapFn = (p: LngLat) => Snap

/** Choose narrated (story/scenic) stops from Wikipedia POIs, time-paced, richest-first per window. */
function selectNarrated(params: SelectParams, snapOf: SnapFn) {
  const placed: Placed[] = []
  for (const poi of params.wikiPois) {
    if (NON_NARRATABLE_TITLE.test(poi.title)) continue
    const { alongSec, offRouteM } = snapOf([poi.lng, poi.lat])
    // Flat OFF_ROUTE_MAX_M for EVERY stop — the discovery spine's wider areal gate
    // (SPINE_AREAL_OFF_ROUTE_MAX_M) is candidate-pool-only; an areal centroid 700–1500 m off
    // enters the pool but isn't placed here (keeps the sim + player honest at one floor).
    if (offRouteM <= OFF_ROUTE_MAX_M) placed.push({ poi, alongSec })
  }
  // Spatial dedup BEFORE time-pacing (two co-located POIs can clear the time gap).
  const candidates = dedupeColocated(placed)
  candidates.sort((a, b) => a.alongSec - b.alongSec)

  const chosen: Placed[] = []
  let lastSec = -Infinity
  let i = 0
  while (i < candidates.length && chosen.length < params.pacing.maxNarratedStops) {
    const here = candidates[i]!
    if (here.alongSec - lastSec < params.pacing.minGapSec) {
      i++
      continue
    }
    // Within the next minGap window, prefer the richest extract (best story).
    let bestIdx = i
    let bestLen = here.poi.extract.length
    let j = i + 1
    while (
      j < candidates.length &&
      candidates[j]!.alongSec - here.alongSec <= params.pacing.minGapSec
    ) {
      if (candidates[j]!.poi.extract.length > bestLen) {
        bestLen = candidates[j]!.poi.extract.length
        bestIdx = j
      }
      j++
    }
    const pick = candidates[bestIdx]!
    chosen.push(pick)
    lastSec = pick.alongSec
    i = bestIdx + 1
  }
  return chosen
}

/** Choose `count` break stops spaced through the drive, nearest to even time targets but
 *  kept clear of the narrated stops (a break that lands on a story queues behind its clip). */
function selectBreaks(
  params: SelectParams,
  snapOf: SnapFn,
  narratedSecs: number[],
): { anchor: BreakAnchor; alongSec: number }[] {
  const count = params.pacing.breakStops
  if (count <= 0 || params.breakAnchors.length === 0) return []
  // Filter off-route anchors FIRST: Google Places "search along route" returns spots
  // it considers near the route, but the corridor is one specific frozen road, so an
  // anchor can snap far off it (a restaurant 25 km away up a side valley). Drop any
  // beyond OFF_ROUTE_MAX_M — the same floor narrated stops use and the sim enforces,
  // so the generator never emits a break the drive simulator would flag as off-route.
  const placed = params.breakAnchors
    .map((a) => {
      const s = snapOf([a.lng, a.lat])
      return { anchor: a, alongSec: s.alongSec, offRouteM: s.offRouteM }
    })
    .filter((p) => p.offRouteM <= OFF_ROUTE_MAX_M)
  if (placed.length === 0) return []
  const used = new Set<string>()
  const out: { anchor: BreakAnchor; alongSec: number }[] = []
  // A break only LAGS if the stop just BEFORE it is still mid-clip when the break fires — so
  // the metric is the gap to the nearest PRECEDING narrated stop, NOT the nearest stop on
  // either side. (A story right AFTER a break doesn't make the break late; the break plays
  // first.) ≥ BREAK_MIN_GAP_SEC ⇒ the preceding clip has finished, so the break is on time.
  // Infinity when nothing plays before it. The queue guard in generate.ts is the backstop for
  // any residual lag (e.g. behind a longer merged clip).
  const precedingGap = (p: (typeof placed)[number]) => {
    let prev = -Infinity
    for (const ns of narratedSecs) if (ns <= p.alongSec && ns > prev) prev = ns
    return prev === -Infinity ? Infinity : p.alongSec - prev
  }
  for (let k = 1; k <= count; k++) {
    const targetSec = (k / (count + 1)) * params.totalSec
    // Eligible = unused, clear of the PRECEDING story, and not stacked on an already-picked
    // break (food anchors bunch at a town, so two can sit seconds apart). Food only exists at
    // the towns, so this naturally caps how many fit; when nothing's eligible we stop — breaks
    // are optional, and a badly-lagging break is worse than one fewer.
    const avail = placed.filter(
      (p) =>
        !used.has(p.anchor.placeId) &&
        precedingGap(p) >= BREAK_MIN_GAP_SEC &&
        out.every((b) => Math.abs(b.alongSec - p.alongSec) >= BREAK_MIN_GAP_SEC),
    )
    if (avail.length === 0) break
    const best = avail.reduce((a, b) =>
      Math.abs(a.alongSec - targetSec) <= Math.abs(b.alongSec - targetSec) ? a : b,
    )
    used.add(best.anchor.placeId)
    out.push(best)
  }
  return out
}

/**
 * Project FIFO-queue playback lag across the plan. The player plays clips sequentially — a
 * clip can't start until the previous one ends — so when triggers fire faster than clips
 * play, the audio backs up and drifts behind the car. This simulates that queue using each
 * stop's `targetSeconds` as the clip-length estimate and returns, per stop, how many seconds
 * AFTER its trigger the clip would actually start. Pure (drive-time = the frozen `alongSec`
 * pace); conservative (ignores the speed-adaptive early trigger, which only adds slack). The
 * overlap/density guard reads this at generation time so a too-dense pacing is caught off-road.
 */
export function projectQueueLag(plan: StopPlan[]): { seq: number; name: string; lagSec: number }[] {
  const sorted = [...plan].sort((a, b) => a.alongSec - b.alongSec)
  let playEnd = 0
  return sorted.map((s) => {
    const start = Math.max(s.alongSec, playEnd)
    playEnd = start + s.targetSeconds
    return { seq: s.seq, name: s.name, lagSec: Math.round(start - s.alongSec) }
  })
}

/** Build the final ordered stop plan for one corridor + duration bucket. */
export function selectStops(params: SelectParams): StopPlan[] {
  const cumulative = cumulativeMeters(params.polyline)
  const totalM = totalMeters(cumulative)
  const snapOf: SnapFn = (p) => {
    const pos = nearestOnRoute(params.polyline, cumulative, p)
    const heading = routeBearingAt(params.polyline, pos.index)
    return {
      alongSec: timeAtAlong(pos.alongM, totalM, params.totalSec),
      offRouteM: pos.offRouteM,
      triggerLat: pos.lat,
      triggerLng: pos.lng,
      approachHeadingDeg: Math.round(heading) % 360,
      // Side is the POI's bearing off the trigger point relative to the road heading.
      sideOfRoad: sideOfApproach(heading, [pos.lng, pos.lat], p),
    }
  }

  const narrated = selectNarrated(params, snapOf)
  // Breaks avoid stacking on a narrated stop (their alongSec is already computed).
  const breaks = selectBreaks(
    params,
    snapOf,
    narrated.map((n) => n.alongSec),
  )

  type Pending = Omit<StopPlan, 'seq'>
  const pending: Pending[] = []

  for (const n of narrated) {
    const isStory = n.poi.extract.length >= STORY_MIN_FACT_CHARS
    const snap = snapOf([n.poi.lng, n.poi.lat])
    // STORY stops carry their co-located cluster (merged in dedup) as a separate fact channel,
    // and run a little longer so the fuller telling (e.g. Emerald Bay + its landmarks) has room.
    const merged = (isStory ? (n.merged ?? []) : []).filter(
      (m) => m.extract.length >= STORY_MIN_FACT_CHARS,
    )
    // Merged members are co-located STORY-grade candidates, so they are always Wikipedia-sourced
    // (a pageid + url); the extract≥STORY_MIN_FACT_CHARS gate already excludes scenic pins.
    const mergedFeatures = merged.map((m) => ({
      name: m.title,
      facts: toFacts(m.extract),
      wikiUrl: m.url!,
      wikiTitle: m.title,
      wikiPageId: m.pageid!,
      ...(m.qid ? { wikidataQid: m.qid } : {}),
    }))
    pending.push({
      stopType: isStory ? 'story' : 'scenic',
      // Source is the candidate's own: STORY grounds on Wikipedia prose (source 'wikipedia',
      // sourceId = pageid); a named SCENIC pin owns its row from Wikidata (source 'wikidata',
      // sourceId = QID). This is the (source, source_id) the pois row dedups on.
      source: n.poi.source,
      sourceId: n.poi.sourceId,
      name: n.poi.title,
      // A NAMED scenic pin speaks its feature KIND (a bay/beach) like a break's; story keeps null.
      kind: isStory ? null : (n.poi.kind ?? null),
      lat: n.poi.lat,
      lng: n.poi.lng,
      alongSec: n.alongSec,
      facts: isStory ? toFacts(n.poi.extract) : [],
      targetSeconds:
        (isStory ? TARGET_SECONDS.story : TARGET_SECONDS.scenic) + merged.length * MERGE_EXTRA_SEC,
      triggerRadiusM: TRIGGER_RADIUS_M,
      triggerLat: snap.triggerLat,
      triggerLng: snap.triggerLng,
      approachHeadingDeg: snap.approachHeadingDeg,
      ...(mergedFeatures.length > 0 ? { mergedFeatures } : {}),
      // Side of the road is delivery-only: a STORY landmark to point at, or a NAMED scenic
      // feature to gesture at ("just off your left"). Breaks forbid it (built separately).
      // Omitted when the geometry can't call a confident side. A curated speakable ANCHOR
      // wins over the pin when the pin misleads (an inland park centroid whose speakable
      // content is lakeside — pipeline/speakable.ts): the side is recomputed from where the
      // content actually IS, through the same heading-aware geometry — so it stays correct
      // per travel direction (S→N and N→S are peer tours). Trigger geometry is untouched.
      ...((): { sideOfRoad?: 'left' | 'right' } => {
        // The speakable anchor rides on the candidate from the corpus (pois.speakable, curated or
        // admin-set). When present it wins over the pin — the side is recomputed from where the
        // content actually IS, through the same heading-aware geometry.
        const hasAnchor = n.poi.speakableLat != null && n.poi.speakableLng != null
        const side = hasAnchor
          ? sideOfApproach(
              snap.approachHeadingDeg,
              [snap.triggerLng, snap.triggerLat],
              [n.poi.speakableLng!, n.poi.speakableLat!],
            )
          : snap.sideOfRoad
        return side ? { sideOfRoad: side } : {}
      })(),
      ...(isStory
        ? { wikiUrl: n.poi.url, wikiTitle: n.poi.title, wikiPageId: n.poi.pageid }
        : {}),
      // Carry the full corpus facts for STORY stops — generate-tour resolves the narration sheet
      // (well or capped extract head) + the grounding fingerprint from it, and preserves the well
      // through the poi re-upsert. Absent when discovery surfaced no stored facts (defensive).
      ...(isStory && n.poi.facts ? { poiFacts: n.poi.facts } : {}),
      // Carry the Wikidata join key for STORY stops; generate.ts enriches sparse ones.
      ...(isStory && n.poi.qid ? { wikidataQid: n.poi.qid } : {}),
    })
  }

  for (const b of breaks) {
    const snap = snapOf([b.anchor.lng, b.anchor.lat])
    pending.push({
      stopType: 'break',
      source: 'google_places',
      sourceId: b.anchor.placeId,
      name: b.anchor.name,
      kind: b.anchor.primaryType ?? null,
      lat: b.anchor.lat,
      lng: b.anchor.lng,
      alongSec: b.alongSec,
      facts: [],
      targetSeconds: TARGET_SECONDS.break,
      triggerRadiusM: TRIGGER_RADIUS_M,
      triggerLat: snap.triggerLat,
      triggerLng: snap.triggerLng,
      approachHeadingDeg: snap.approachHeadingDeg,
    })
  }

  pending.sort((a, b) => a.alongSec - b.alongSec)
  return pending.map((p, seq) => ({ ...p, seq }))
}

/** Re-export so callers can read pacing for a bucket without importing config directly. */
export { PACING }
