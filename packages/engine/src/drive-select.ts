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

import { haversineMeters, OFF_ROUTE_MAX_M, type LngLat } from './geo'
import { buildRouteSnapper } from './pacing'

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
  /** POI kind — the variety bucket (and, later, trigger radius). */
  kind?: string | null
  /** Display name (the spoken "stop"). */
  name?: string
  /** Optional stored quality signal (a future eval score); absent ⇒ 0. Breaks dedupe/window ties. */
  qualityScore?: number
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

/** Two narrations closer than this on the ground are the same physical stop — collapse to one.
 *  Mirrors the generator's MIN_STOP_SEPARATION_M. */
export const DRIVE_MIN_SEPARATION_M = 1_000
/** A clip that would start more than this many seconds after its trigger (FIFO queue lag) is
 *  DROPPED — silence beats a clip playing far behind the car. Mirrors QUEUE_LAG_WARN_SEC. */
export const DRIVE_MAX_LAG_SEC = 45

interface Snapped {
  cand: DriveCandidate
  alongSec: number
  triggerLat: number
  triggerLng: number
  approachHeadingDeg: number
}

const scoreOf = (c: DriveCandidate): number => c.qualityScore ?? 0

export function buildDrive(params: BuildDriveParams): DriveStop[] {
  const { polyline, totalSec, candidates, minGapSec, maxStops } = params
  const offRouteMaxM = params.offRouteMaxM ?? OFF_ROUTE_MAX_M
  const minSeparationM = params.minSeparationM ?? DRIVE_MIN_SEPARATION_M
  const maxLagSec = params.maxLagSec ?? DRIVE_MAX_LAG_SEC
  const minGapMs = minGapSec * 1000

  const snap = buildRouteSnapper(polyline, totalSec)

  // 1. Snap to the route + drop off-route candidates (no trustworthy trigger point past the floor).
  const placed: Snapped[] = []
  for (const cand of candidates) {
    const s = snap([cand.lng, cand.lat])
    if (s.offRouteM <= offRouteMaxM) {
      placed.push({
        cand,
        alongSec: s.alongSec,
        triggerLat: s.triggerLat,
        triggerLng: s.triggerLng,
        approachHeadingDeg: s.approachHeadingDeg,
      })
    }
  }

  // 2. PICK-ONE co-located dedupe — the INVERSE of the generator's merge (you cannot fuse two
  //    finished clips). Greedy best-first (quality, then richer/longer) so the survivor is strongest.
  const byScore = [...placed].sort(
    (a, b) => scoreOf(b.cand) - scoreOf(a.cand) || b.cand.audioDurationMs - a.cand.audioDurationMs,
  )
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
  //    previous pick beats a repeat (variety); then higher quality; then the richer (longer) clip.
  kept.sort((a, b) => a.alongSec - b.alongSec)
  let prevKind: string | null | undefined
  const better = (a: Snapped, b: Snapped): boolean => {
    const aFits = a.cand.audioDurationMs <= minGapMs
    const bFits = b.cand.audioDurationMs <= minGapMs
    if (aFits !== bFits) return aFits
    const aVar = a.cand.kind !== prevKind
    const bVar = b.cand.kind !== prevKind
    if (aVar !== bVar) return aVar
    const sa = scoreOf(a.cand)
    const sb = scoreOf(b.cand)
    if (sa !== sb) return sa > sb
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
    prevKind = best.cand.kind
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
