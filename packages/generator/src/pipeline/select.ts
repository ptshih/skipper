// Stop selection — turn raw POI candidates into an ordered, time-paced set of
// tour stops. Pacing is by drive TIME (the invariant): every candidate is placed
// on the route, its along-route distance converted to seconds via the frozen
// total drive time, and stops are spaced by a minimum time gap.
//
// Rules baked in here:
//   - STORY  = a Wikipedia POI with a sufficiently rich lead extract.
//   - SCENIC = a Wikipedia POI too thin to narrate truthfully → delivery-only
//     audio at that location (no name, no facts spoken). It still anchors to the
//     POI so it has a location + a poi_content row (ready-gate).
//   - BREAK  = a Google Places food/rest anchor; NAMED audio (name + kind only,
//     normalized; no volatile data) — mandatory, like story/scenic.
// Within each spacing window we prefer the richest extract, so good stories win
// over thin neighbours.

import type { PoiSource, StopType } from '@skipper/shared'
import type { AttributionSnapshot } from '@skipper/db/schema'
import {
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
  /** STORY only: grounded fact sentences (the entire well the narrator may use). */
  facts: string[]
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

interface Placed {
  poi: WikiPoi
  alongSec: number
}

/**
 * Drop co-located candidates: when two POIs sit within MIN_STOP_SEPARATION_M of
 * each other on the ground they are effectively the same physical stop (e.g.
 * Fannette Island ⊂ Emerald Bay State Park), and narrating both repeats the place.
 * Keep the RICHER extract in each spatial cluster — a duplicate stop is worse than
 * one good one. Greedy richest-first, so the survivor is the longest extract.
 */
function dedupeColocated(placed: Placed[]): Placed[] {
  const byRichness = [...placed].sort((a, b) => b.poi.extract.length - a.poi.extract.length)
  const kept: Placed[] = []
  for (const cand of byRichness) {
    const tooClose = kept.some(
      (k) =>
        haversineMeters([k.poi.lng, k.poi.lat], [cand.poi.lng, cand.poi.lat]) <
        MIN_STOP_SEPARATION_M,
    )
    if (!tooClose) kept.push(cand)
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

/** Choose `count` break stops spaced through the drive, nearest to even time targets. */
function selectBreaks(
  params: SelectParams,
  snapOf: SnapFn,
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
  for (let k = 1; k <= count; k++) {
    const targetSec = (k / (count + 1)) * params.totalSec
    let best: (typeof placed)[number] | undefined
    let bestDelta = Infinity
    for (const p of placed) {
      if (used.has(p.anchor.placeId)) continue
      const delta = Math.abs(p.alongSec - targetSec)
      if (delta < bestDelta) {
        bestDelta = delta
        best = p
      }
    }
    if (best) {
      used.add(best.anchor.placeId)
      out.push(best)
    }
  }
  return out
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
  const breaks = selectBreaks(params, snapOf)

  type Pending = Omit<StopPlan, 'seq'>
  const pending: Pending[] = []

  for (const n of narrated) {
    const isStory = n.poi.extract.length >= STORY_MIN_FACT_CHARS
    const snap = snapOf([n.poi.lng, n.poi.lat])
    pending.push({
      stopType: isStory ? 'story' : 'scenic',
      source: 'wikipedia',
      sourceId: String(n.poi.pageid),
      name: n.poi.title,
      kind: null,
      lat: n.poi.lat,
      lng: n.poi.lng,
      alongSec: n.alongSec,
      facts: isStory ? toFacts(n.poi.extract) : [],
      targetSeconds: isStory ? TARGET_SECONDS.story : TARGET_SECONDS.scenic,
      triggerRadiusM: TRIGGER_RADIUS_M,
      triggerLat: snap.triggerLat,
      triggerLng: snap.triggerLng,
      approachHeadingDeg: snap.approachHeadingDeg,
      // Side of the road is delivery-only and only surfaced for STORY stops (a named
      // landmark to point at — "just off your left"); scenic names nothing, breaks
      // forbid it. Omitted when the geometry can't call a confident side.
      ...(isStory && snap.sideOfRoad ? { sideOfRoad: snap.sideOfRoad } : {}),
      ...(isStory ? { wikiUrl: n.poi.url, wikiTitle: n.poi.title, wikiPageId: n.poi.pageid } : {}),
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
