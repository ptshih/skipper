// buildDrive — assemble a paced, ordered drive from REUSED roam narrations along a frozen route.
//
// The heart of V2's "Create a Drive": a drive is "roam, pre-ordered for your route." Each narration
// is a place's ONE shared telling (1:1 with its POI), already synthesized — so this NEVER generates
// audio; it SELECTS + PACES existing clips. Pure, zero-dep, RN-safe (like the rest of engine), so
// the server assembles a drive at request time AND the device can re-pace one offline.
//
// Two selection choices the design calls out:
//   - co-located candidates collapse PICK-ONE, never merge (you can't fuse two finished .m4a clips);
//   - the window prefers a clip that FITS the gap (won't queue-lag) + variety, ranked on the clip's
//     REAL audioDurationMs, not an extract length (the clip already exists).
//
// Breaks + clock-anchored asides are layered by the caller in later phases; this is the
// narration core.

import { cumulativeMeters, haversineMeters, OFF_ROUTE_MAX_M, totalMeters, triggerRadiusForKind, type LngLat } from './geo'
import { buildRouteSnapper } from './pacing'
import { DEFAULT_TRIGGER, effectiveRadiusM } from './trigger'

/** A reusable roam narration a drive can include — the place's ONE shared telling (1:1 with the POI).
 *  engine stays DB-agnostic, so the caller maps DB rows to this shape. */
export interface DriveCandidate {
  poiId: string
  /** Stable R2 key of the narration audio (NOT a presigned URL — presign at assemble time). */
  audioKey: string
  /** Real clip length (ms) — the pacing input (the clip exists, so we pace on its real length). */
  audioDurationMs: number
  lat: number
  lng: number
  /** POI kind — the trigger-radius vocabulary (natural features only; null for most of the corpus). */
  kind?: string | null
  /** Coarse "what sort of thing is this" bucket for the VARIETY rule, computed by the caller
   *  (@skipper/shared `varietyKey`) because engine stays dependency-free. Kept SEPARATE from `kind`:
   *  that one answers a physical size question for the trigger radius, this one answers "would these
   *  two back-to-back feel repetitive". ⚠ null means UNKNOWN — two nulls are NOT a repeat. */
  varietyKey?: string | null
  /** True when lat/lng is a ROAD-SNAPPED anchor rather than the raw centroid. Load-bearing for
   *  selection, not just display: an anchored stop triggers off a TIGHT floor
   *  (`ANCHORED_TRIGGER_RADIUS_M`) instead of the fat kind-aware one, so it is far easier for a
   *  candidate to be admitted as "on route" and then sit outside its own trigger range. See the
   *  reachability filter in buildDrive step 1. */
  anchored?: boolean
  /** Display name (the spoken "stop"). */
  name?: string
}

/** One stop in an assembled drive — a narration placed on THIS route. A superset of the fields the
 *  preview/live player need; the route supplies the trigger geometry roam clips don't store. */
export interface DriveStop {
  seq: number
  poiId: string
  audioKey: string
  audioDurationMs: number
  name?: string
  kind?: string | null
  /** Snapped to THIS route (roam stores no trigger geometry — the route supplies it). */
  triggerLat: number
  triggerLng: number
  approachHeadingDeg: number
  /** Along-route time (seconds) — ordering / pacing / debug. */
  alongSec: number
}

export interface BuildDriveParams {
  polyline: LngLat[]
  /** Total drive time (seconds) — the pacing clock (from materializeRoute().durationSeconds). */
  totalSec: number
  candidates: DriveCandidate[]
  /** Minimum drive-time gap between consecutive stops (seconds). */
  minGapSec: number
  /** Hard cap on the number of stops. */
  maxStops: number
  /** Off-route ceiling (m); defaults to the shared OFF_ROUTE_MAX_M. */
  offRouteMaxM?: number
  /** Min on-the-ground separation (m) for the pick-one co-located dedupe. */
  minSeparationM?: number
  /** A stop whose clip would start more than this many seconds after its trigger is DROPPED. */
  maxLagSec?: number
}

/** Two narrations closer than this on the ground are the same physical stop — collapse to one
 *  (1 km; the spatial dedupe now lives only here in the engine, not in the studio pipeline). */
export const DRIVE_MIN_SEPARATION_M = 1_000
/** A clip that would start more than this many seconds after its trigger (FIFO queue lag) is
 *  DROPPED — silence beats a clip playing far behind the car. */
export const DRIVE_MAX_LAG_SEC = 45

interface Snapped {
  cand: DriveCandidate
  alongSec: number
  triggerLat: number
  triggerLng: number
  approachHeadingDeg: number
}

export function buildDrive(params: BuildDriveParams): DriveStop[] {
  const { polyline, totalSec, candidates, minGapSec, maxStops } = params
  const offRouteMaxM = params.offRouteMaxM ?? OFF_ROUTE_MAX_M
  const minSeparationM = params.minSeparationM ?? DRIVE_MIN_SEPARATION_M
  const maxLagSec = params.maxLagSec ?? DRIVE_MAX_LAG_SEC
  const minGapMs = minGapSec * 1000

  const snap = buildRouteSnapper(polyline, totalSec)

  // The route's average speed — the best estimate this function has of how fast the car will be
  // moving, and therefore how far the speed-adaptive trigger will reach. Same uniform-speed
  // approximation `timeAtAlong` already makes to pace stops, used here for the same reason: it is
  // the only speed signal a frozen route carries. A stop on an unusually slow stretch can still
  // fall short; a stop admitted by the ceiling alone reliably does.
  const routeM = polyline.length > 1 ? totalMeters(cumulativeMeters(polyline)) : 0
  const avgMps = totalSec > 0 && routeM > 0 ? routeM / totalSec : 0

  // 1. Snap to the route, then drop candidates the car will never come close enough to TRIGGER.
  //
  //    ⚠ Two different distances used to govern this, and they disagreed. `offRouteMaxM` (700 m) is an
  //    HONESTY bound — "is this place actually along the drive". The TRIGGER fires on the car's distance
  //    to the stop, floored at ANCHORED_TRIGGER_RADIUS_M (250 m) for a road-snapped anchor and only
  //    stretched by speed (max(floor, speed x leadSeconds) ~ 322 m at 60 mph). So every candidate
  //    admitted in the 250-700 m band was SELECTED and then silent: it consumed a min-gap pacing slot,
  //    blocked a stop that would have played, and produced nothing. Measured on the three saved Tahoe
  //    drives before this filter: 3 of 18 selected stops could not fire at the drive's own average
  //    speed, and Granlibakken (622 m off-route) would have needed 116 mph.
  //
  //    Selecting on the radius the TRIGGER will actually use makes the two agree by construction. This
  //    can only ever TIGHTEN the gate (the radius is min'd with the honesty ceiling), so the stop COUNT
  //    can fall. Measured on the same three drives: 18 stops with 3 silent became 16 stops with 0
  //    silent — AUDIBLE stops went 15 to 16. One drive backfilled the freed window (7 audible to 8);
  //    the other had no other candidate in range and went from 8 stops to 6. That is a truth
  //    correction, not a regression: the stops it removes were never going to play, and a shorter
  //    honest drive beats a longer one with silent gaps in it.
  const placed: Snapped[] = []
  for (const cand of candidates) {
    const s = snap([cand.lng, cand.lat])
    const reachM = Math.min(
      offRouteMaxM,
      effectiveRadiusM(triggerRadiusForKind(cand.kind ?? null, cand.anchored === true), avgMps, DEFAULT_TRIGGER.leadSeconds),
    )
    if (s.offRouteM <= reachM) {
      placed.push({
        cand,
        alongSec: s.alongSec,
        triggerLat: s.triggerLat,
        triggerLng: s.triggerLng,
        approachHeadingDeg: s.approachHeadingDeg,
      })
    }
  }

  // 2. PICK-ONE co-located dedupe — the INVERSE of the studio pipeline's merge (you cannot fuse two
  //    finished clips). Greedy best-first (richer/longer clip wins) so the survivor is strongest.
  const byScore = [...placed].sort((a, b) => b.cand.audioDurationMs - a.cand.audioDurationMs)
  const kept: Snapped[] = []
  for (const cand of byScore) {
    const collides = kept.some(
      (k) =>
        haversineMeters([k.cand.lng, k.cand.lat], [cand.cand.lng, cand.cand.lat]) < minSeparationM,
    )
    if (!collides) kept.push(cand)
  }

  // 3. Time-paced selection: walk in route order; within each minGap window pick the BEST clip —
  //    one that FITS the gap (won't queue-lag) beats an over-long one; a DIFFERENT kind from the
  //    previous pick beats a repeat (variety); then the richer (longer) clip.
  kept.sort((a, b) => a.alongSec - b.alongSec)
  let prevVariety: string | null | undefined
  // Variety = "don't narrate four houses in a row". ⚠ An UNKNOWN bucket counts as different, always:
  // treating two nulls as a repeat is what silently disabled this rule for 85% of the corpus, since
  // `kind` is a natural-feature allowlist and the built world carries none.
  const differs = (v: string | null | undefined): boolean => v == null || prevVariety == null || v !== prevVariety
  const better = (a: Snapped, b: Snapped): boolean => {
    const aFits = a.cand.audioDurationMs <= minGapMs
    const bFits = b.cand.audioDurationMs <= minGapMs
    if (aFits !== bFits) return aFits
    const aVar = differs(a.cand.varietyKey ?? a.cand.kind)
    const bVar = differs(b.cand.varietyKey ?? b.cand.kind)
    if (aVar !== bVar) return aVar
    return a.cand.audioDurationMs > b.cand.audioDurationMs
  }
  const chosen: Snapped[] = []
  let lastSec = -Infinity
  let i = 0
  while (i < kept.length && chosen.length < maxStops) {
    const here = kept[i]!
    if (here.alongSec - lastSec < minGapSec) {
      i++
      continue
    }
    let best = here
    let bestIdx = i
    let j = i + 1
    while (j < kept.length && kept[j]!.alongSec - here.alongSec <= minGapSec) {
      if (better(kept[j]!, best)) {
        best = kept[j]!
        bestIdx = j
      }
      j++
    }
    chosen.push(best)
    lastSec = best.alongSec
    prevVariety = best.cand.varietyKey ?? best.cand.kind
    i = bestIdx + 1
  }

  // 4. Queue-lag DROP: clips play through a sequential FIFO, so a clip can't start until the
  //    previous ends. Walk in route order keeping a play cursor; DROP any clip that would start
  //    more than maxLagSec after its trigger (it would lag too far behind the car). Dropping a
  //    laggard frees the queue for the next one, so this is a single forward pass.
  chosen.sort((a, b) => a.alongSec - b.alongSec)
  const survivors: Snapped[] = []
  let playEnd = 0
  for (const s of chosen) {
    const start = Math.max(s.alongSec, playEnd)
    if (start - s.alongSec > maxLagSec) continue
    playEnd = start + s.cand.audioDurationMs / 1000
    survivors.push(s)
  }

  // 5. Order + number.
  return survivors.map((s, seq) => ({
    seq,
    poiId: s.cand.poiId,
    audioKey: s.cand.audioKey,
    audioDurationMs: s.cand.audioDurationMs,
    ...(s.cand.name != null ? { name: s.cand.name } : {}),
    ...(s.cand.kind != null ? { kind: s.cand.kind } : {}),
    triggerLat: s.triggerLat,
    triggerLng: s.triggerLng,
    approachHeadingDeg: s.approachHeadingDeg,
    alongSec: s.alongSec,
  }))
}
