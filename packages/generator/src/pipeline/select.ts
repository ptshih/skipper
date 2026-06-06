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
//   - BREAK  = a Google Places food/rest anchor; no audio, no volatile data.
// Within each spacing window we prefer the richest extract, so good stories win
// over thin neighbours.

import type { PoiSource, StopType } from '@skipper/shared'
import { OFF_ROUTE_MAX_M, PACING, STORY_MIN_FACT_CHARS, TARGET_SECONDS, TRIGGER_RADIUS_M } from '../config'
import type { BucketPacing } from '../config'
import { cumulativeMeters, nearestOnRoute, timeAtAlong, totalMeters } from './geo'
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
  targetSeconds: number
  triggerRadiusM: number
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

/** Split a lead-section extract into clean fact sentences for the fact sheet. */
function toFacts(extract: string): string[] {
  return extract
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

interface Placed {
  poi: WikiPoi
  alongSec: number
}

/** Choose narrated (story/scenic) stops from Wikipedia POIs, time-paced, richest-first per window. */
function selectNarrated(params: SelectParams, alongSecOf: (p: LngLat) => { alongSec: number; offRouteM: number }) {
  const placed: Placed[] = []
  for (const poi of params.wikiPois) {
    if (NON_NARRATABLE_TITLE.test(poi.title)) continue
    const { alongSec, offRouteM } = alongSecOf([poi.lng, poi.lat])
    if (offRouteM <= OFF_ROUTE_MAX_M) placed.push({ poi, alongSec })
  }
  placed.sort((a, b) => a.alongSec - b.alongSec)

  const chosen: Placed[] = []
  let lastSec = -Infinity
  let i = 0
  while (i < placed.length && chosen.length < params.pacing.maxNarratedStops) {
    const here = placed[i]!
    if (here.alongSec - lastSec < params.pacing.minGapSec) {
      i++
      continue
    }
    // Within the next minGap window, prefer the richest extract (best story).
    let bestIdx = i
    let bestLen = here.poi.extract.length
    let j = i + 1
    while (j < placed.length && placed[j]!.alongSec - here.alongSec <= params.pacing.minGapSec) {
      if (placed[j]!.poi.extract.length > bestLen) {
        bestLen = placed[j]!.poi.extract.length
        bestIdx = j
      }
      j++
    }
    const pick = placed[bestIdx]!
    chosen.push(pick)
    lastSec = pick.alongSec
    i = bestIdx + 1
  }
  return chosen
}

/** Choose `count` break stops spaced through the drive, nearest to even time targets. */
function selectBreaks(
  params: SelectParams,
  alongSecOf: (p: LngLat) => { alongSec: number; offRouteM: number },
): { anchor: BreakAnchor; alongSec: number }[] {
  const count = params.pacing.breakStops
  if (count <= 0 || params.breakAnchors.length === 0) return []
  const placed = params.breakAnchors.map((a) => ({ anchor: a, alongSec: alongSecOf([a.lng, a.lat]).alongSec }))
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
  const alongSecOf = (p: LngLat) => {
    const pos = nearestOnRoute(params.polyline, cumulative, p)
    return { alongSec: timeAtAlong(pos.alongM, totalM, params.totalSec), offRouteM: pos.offRouteM }
  }

  const narrated = selectNarrated(params, alongSecOf)
  const breaks = selectBreaks(params, alongSecOf)

  type Pending = Omit<StopPlan, 'seq'>
  const pending: Pending[] = []

  for (const n of narrated) {
    const isStory = n.poi.extract.length >= STORY_MIN_FACT_CHARS
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
      ...(isStory ? { wikiUrl: n.poi.url, wikiTitle: n.poi.title, wikiPageId: n.poi.pageid } : {}),
    })
  }

  for (const b of breaks) {
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
    })
  }

  pending.sort((a, b) => a.alongSec - b.alongSec)
  return pending.map((p, seq) => ({ ...p, seq }))
}

/** Re-export so callers can read pacing for a bucket without importing config directly. */
export { PACING }
