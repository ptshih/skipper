// AREA triggers — "am I inside this place?" rather than "am I near this point?".
//
// The engine's only shape until now was a point plus a scalar radius. That is right for almost
// everything: a POI is somewhere you pass. But a DISTRICT is somewhere you are INSIDE, and the
// difference is not cosmetic — measured on the real corpus, downtown Reno's 46 members span
// 1031 × 1800 m and only 9 of them sit within 250 m of the group's centre. A point trigger wide
// enough to cover it fires ~900 m out, which is the exact regression `ANCHORED_TRIGGER_RADIUS_M`
// and `CLUSTER_MAX_TRIGGER_RADIUS_M` exist to forbid (simulated: a 92-second lead at city speed).
//
// ⚠ WHY A CONVEX HULL AND NOT A BBOX. Both were measured over the five real districts. A hull is
// 6–9 vertices at n=13..46 — cheap enough for the wire — and covers 44% of the enclosing circle's
// area on the two worst districts, against the bbox's 71%. More importantly a bbox concentrates ALL
// of its over-cover in the CORNERS, and the corner is exactly where the failure lives: a highway
// clipping the corner of downtown's bbox would fire a downtown telling at someone who never went
// downtown. A hull follows the places.
//
// ⚠ WHY NOT A UNION OF PER-MEMBER DISCS. It needs no hull at all, but it leaves HOLES — measured, a
// 250 m disc per member covers only 85% of downtown Reno's bbox — so a rider crossing a gap flips
// outside and back in mid-district, re-arming the trigger. A hull is simply-connected by construction.

import { haversineMeters, type LngLat } from './geo'

/** A closed convex ring in [lng, lat], counter-clockwise, WITHOUT a repeated closing vertex. */
export type Ring = LngLat[]

/**
 * The convex hull of a set of points (Andrew's monotone chain), as a ring.
 *
 * Deliberately not a concave/alpha hull: convex is the shape a rider experiences (you are "in
 * downtown" in the gaps between its landmarks too), it is stable under adding a member, and it is
 * the only one where containment is a few lines to verify by reading.
 *
 * ⚠ NOT antimeridian-safe — it treats lng as a plain number, so a ring spanning ±180° is wrong.
 * Every region is a bbox well inside one hemisphere; assert rather than handle.
 */
export function convexHull(points: readonly LngLat[]): Ring {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  // Dedupe — co-located members are real (three of Truckee's share one snapped anchor) and a
  // repeated point makes the cross-product test ambiguous.
  const uniq: LngLat[] = []
  for (const p of pts) {
    const last = uniq[uniq.length - 1]
    if (!last || last[0] !== p[0] || last[1] !== p[1]) uniq.push(p)
  }
  if (uniq.length <= 2) return uniq
  const cross = (o: LngLat, a: LngLat, b: LngLat) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const half = (src: LngLat[]): LngLat[] => {
    const out: LngLat[] = []
    for (const p of src) {
      while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, p) <= 0) out.pop()
      out.push(p)
    }
    out.pop() // the last point starts the other half
    return out
  }
  return [...half(uniq), ...half([...uniq].reverse())]
}

/**
 * Is the point strictly inside the ring? Ray-crossing parity.
 *
 * ⚠ Runs on RAW [lng, lat] with no projection, and that is correct rather than sloppy: parity is
 * invariant under any per-axis monotone map, and lng→x, lat→y is one. Distance is NOT invariant that
 * way, which is why `distanceToRingM` below projects and this does not.
 *
 * A point exactly ON an edge is undefined here (parity can go either way). That is deliberate and is
 * why containment is never used alone — `insideArea` pairs it with a metre margin, so the boundary is
 * decided by distance, not by parity.
 */
export function pointInRing(p: LngLat, ring: Ring): boolean {
  if (ring.length < 3) return false
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!
    const [xj, yj] = ring[j]!
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Metres from a point to a segment, on the sphere via a local flat projection (segments here are
 *  hundreds of metres, where the distortion is centimetres). */
function distanceToSegmentM(p: LngLat, a: LngLat, b: LngLat): number {
  const latRad = (p[1] * Math.PI) / 180
  const mPerDegLat = 111_132
  const mPerDegLng = 111_320 * Math.max(1e-6, Math.cos(latRad))
  const px = (p[0] - a[0]) * mPerDegLng
  const py = (p[1] - a[1]) * mPerDegLat
  const bx = (b[0] - a[0]) * mPerDegLng
  const by = (b[1] - a[1]) * mPerDegLat
  const len2 = bx * bx + by * by
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2))
  const dx = px - t * bx
  const dy = py - t * by
  return Math.hypot(dx, dy)
}

/** Metres from a point to the ring's boundary (0 when the point lies on it). Sign-free — pair it
 *  with `pointInRing` when you need to know which side. */
export function distanceToRingM(p: LngLat, ring: Ring): number {
  if (ring.length === 0) return Infinity
  if (ring.length === 1) return haversineMeters(p, ring[0]!)
  let best = Infinity
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    best = Math.min(best, distanceToSegmentM(p, ring[j]!, ring[i]!))
  }
  return best
}

/** A trigger area: the ring plus how far OUTSIDE it still counts as arriving. */
export interface AreaRef {
  ring: Ring
  /** Metres of slack outside the boundary that still reads as inside. Absorbs GPS error and the fact
   *  that the ring passes through the members rather than around the block they sit on. ⚠ This is
   *  NOT a speed-adaptive lead — an area has no approach, so there is no honest way to fire early.
   *  A district clip necessarily starts just inside the district rather than ahead of it. */
  marginM: number
}

/** Signed-ish containment: negative metres INSIDE the boundary, positive OUTSIDE. The one number the
 *  trigger loops need, so they never call the parity test and the distance test out of step. */
export function signedDistanceM(p: LngLat, area: AreaRef): number {
  const d = distanceToRingM(p, area.ring)
  return pointInRing(p, area.ring) ? -d : d
}

/** How deep inside the boundary a fix must be for the entry dwell to be UNNECESSARY.
 *
 *  The dwell exists to reject a single stray fix that lands just across a boundary — consumer GPS is
 *  good to roughly 5–20 m in the open and worse between tall buildings, which is exactly where
 *  districts are. But a fix this far inside cannot be that error, so waiting on it only delays a clip
 *  that should already be playing. It also fixes a real ordering bug: with an unconditional dwell an
 *  area ALWAYS loses a race to a co-located point pin, because the point fires on the first fix and
 *  closes the min-gap governor behind it — "inside beats near" would have been true in the comparator
 *  and false in practice. */
export const AREA_CONFIDENT_DEPTH_M = 60

/** Inside, allowing the margin. */
export function insideArea(p: LngLat, area: AreaRef): boolean {
  return signedDistanceM(p, area) <= area.marginM
}

/** Deep enough inside that a single fix is proof rather than possible GPS error — see
 *  `AREA_CONFIDENT_DEPTH_M`. Used to waive the entry dwell. */
export function deepInsideArea(p: LngLat, area: AreaRef): boolean {
  return signedDistanceM(p, area) <= -AREA_CONFIDENT_DEPTH_M
}

/**
 * Containment + entry bookkeeping for an AREA subject, shared by `TriggerEngine` and `RoamEngine`
 * so the two area paths cannot drift (the dwell rule below was previously spelled out, comment and
 * all, in both files).
 *
 * Returns the tSec the rider was first seen inside, or NULL when they are outside — which also
 * RE-ARMS the dwell, so leaving and re-entering starts the clock over.
 *
 * ⚠ Deliberately does NOT evaluate the dwell itself; see `areaDwellSatisfied`. The two are separate
 * because the callers interleave a governor between them: RoamEngine checks its open/closed gate
 * after this bookkeeping and before the dwell, so that dwell time keeps accruing while a clip is
 * playing. Fusing these into one call would quietly move that gate.
 */
export function trackAreaEntry<K>(
  insideSince: Map<K, number>,
  key: K,
  p: LngLat,
  area: AreaRef,
  tSec: number,
): number | null {
  if (!insideArea(p, area)) {
    insideSince.delete(key) // left (or never entered) → re-arm the dwell
    return null
  }
  const since = insideSince.get(key) ?? tSec
  insideSince.set(key, since)
  return since
}

/** Has the entry dwell been satisfied for an area the rider is already inside?
 *  The dwell guards the BOUNDARY only — a fix well inside is proof, not noise. */
export function areaDwellSatisfied(
  p: LngLat,
  area: AreaRef,
  since: number,
  tSec: number,
  enterDwellSec: number,
): boolean {
  return tSec - since >= enterDwellSec || deepInsideArea(p, area)
}

/** Planar area of the ring in m², for ordering overlapping areas (smallest — most specific — wins).
 *  Shoelace on the same local projection; exactness does not matter, only the ordering. */
export function ringAreaM2(ring: Ring): number {
  if (ring.length < 3) return 0
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length
  const mPerDegLat = 111_132
  const mPerDegLng = 111_320 * Math.max(1e-6, Math.cos((lat0 * Math.PI) / 180))
  let acc = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!
    const [xj, yj] = ring[j]!
    acc += xj * mPerDegLng * (yi * mPerDegLat) - xi * mPerDegLng * (yj * mPerDegLat)
  }
  return Math.abs(acc) / 2
}
