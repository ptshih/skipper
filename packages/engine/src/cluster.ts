// Where a FUSED CLUSTER telling triggers — phase 4 of the legibility layer, spec §4.1.
//
// A `poi_clusters` row carries NO geometry (schema: "a cluster's extent is its members'
// coordinates"), so a fused clip's trigger point has to be derived from the places it speaks for.
// The engine has exactly one trigger shape — a point, a scalar radius, haversine — so this has to
// produce those two numbers and nothing else.
//
// ⚠ Everything below is MEASURED over the 30 generatable Tahoe clusters (2026-07-30), not reasoned
// from taste. The candidates the spec originally proposed both lost.

import { ANCHORED_TRIGGER_RADIUS_M, EARTH_RADIUS_M, haversineMeters, type LngLat } from './geo'

/**
 * The widest a fused cluster's trigger may be and still honestly be a POINT.
 *
 * 600 m is not a taste number: it is the floor `radiusForKind` already gives an un-anchored place with
 * no kind, so a fused telling that exceeded it would trigger LOOSER than the loosest thing already
 * shipping. The corpus also leaves a wide gap right there — measured over the 32 generatable clusters,
 * radii run 250 (×22) … 386, 416, 516, then jump to 903, so nothing sits near the line.
 *
 * ⚠ Simulated, not assumed. Run through the real trigger engine on a dense city corridor, the 903 m
 * cluster (the merged UNR campus) fires with a 92-SECOND lead against 25 s for every other stop —
 * you would hear the campus named a minute and a half before reaching it. Emerald Bay at 516 m fires
 * at 26 s against a 12 s baseline on a real highway route, which is fine. The line is between them.
 *
 * ⚠ WHAT THIS NOW MEANS (2026-07-31, third revision — read the history, it is the point). It first
 * DEFERRED a group ("too wide, so don't tell it"). It then SELECTED A MODE, once the area trigger
 * existed: at or under, a point; over, an area. With roam removed there is no arrive-from-anywhere
 * rider left, so it is back to being a plain THRESHOLD — the question "can any single point represent
 * this group honestly?", asked once, on the UNCAPPED radius.
 *
 * Who answers it is the part that matters: the drive path REFUSES a group that fails it
 * (`tooWideForPoint` → buildDrive's second admission rule), because a drive's selection is frozen at
 * create against a credit that never refunds.
 *
 * ⚠ Do not collapse the threshold into whichever answer is currently implemented. The area mode HAS
 * since been deleted (the served hull went with roam), and keying the drive refusal on "was a hull
 * served?" rather than on this predicate is exactly what would have flipped that refusal into a
 * silent admission the moment it went.
 */
export const CLUSTER_MAX_TRIGGER_RADIUS_M = 600

/** A cluster member reduced to the one thing this needs: the point it would trigger from. Callers
 *  pass `speakableLat ?? lat`, matching the rule every read path already uses. */
export interface ClusterMemberPoint {
  lat: number
  lng: number
}

export interface ClusterTrigger {
  lat: number
  lng: number
  /** The floor to hand the trigger engine, in place of `triggerRadiusForKind` — a cluster has no
   *  `kind` and no single anchor, so the kind vocabulary cannot answer this. */
  radiusM: number
  /** Distance from the returned point to the farthest member (m) — the spread this circle covers.
   *  Exposed for previews and the admin surface; nothing in the trigger path reads it. */
  worstMemberM: number
}

/** Local equirectangular projection in metres about `origin`. Cluster spans are under ~1 km, where
 *  the distortion is centimetres — and every distance that MATTERS is re-measured with haversine
 *  before it is returned, so the projection only ever picks the candidate, never reports a number. */
function projector(origin: LngLat): {
  to: (p: ClusterMemberPoint) => [number, number]
  from: (xy: [number, number]) => LngLat
} {
  const R = EARTH_RADIUS_M
  const [lng0, lat0] = origin
  const cosLat = Math.cos((lat0 * Math.PI) / 180)
  return {
    to: (p) => [
      (((p.lng - lng0) * Math.PI) / 180) * R * cosLat,
      (((p.lat - lat0) * Math.PI) / 180) * R,
    ],
    from: ([x, y]) => [
      lng0 + ((x / (R * cosLat)) * 180) / Math.PI,
      lat0 + ((y / R) * 180) / Math.PI,
    ],
  }
}

/** Smallest circle enclosing every point, exact, by brute force: the minimal enclosing circle is
 *  always determined by 2 points (as a diameter) or 3 (their circumcircle), so testing every pair
 *  and triple finds it. O(n^4) — irrelevant at cluster scale, where the largest group is 9 members
 *  (84 triples). Chosen over Welzl deliberately: exact, no recursion, no randomisation, and short
 *  enough to check by reading it. */
function minimalEnclosingCircle(pts: [number, number][]): { c: [number, number]; r: number } {
  const EPS = 1e-6
  const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1])
  const encloses = (c: [number, number], r: number) => pts.every((p) => dist(c, p) <= r + EPS)

  let best: { c: [number, number]; r: number } | null = null
  const consider = (c: [number, number], r: number) => {
    if (!encloses(c, r)) return
    if (!best || r < best.r) best = { c, r }
  }

  if (pts.length === 1) return { c: pts[0]!, r: 0 }

  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i]!
      const b = pts[j]!
      consider([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], dist(a, b) / 2)
    }
  }
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      for (let k = j + 1; k < pts.length; k++) {
        const a = pts[i]!
        const b = pts[j]!
        const c = pts[k]!
        // Circumcentre via the perpendicular-bisector determinant. d ≈ 0 ⇒ collinear, and a
        // collinear triple is always covered by one of the pairs above.
        const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]))
        if (Math.abs(d) < 1e-9) continue
        const a2 = a[0] * a[0] + a[1] * a[1]
        const b2 = b[0] * b[0] + b[1] * b[1]
        const c2 = c[0] * c[0] + c[1] * c[1]
        const ux = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d
        const uy = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d
        consider([ux, uy], dist([ux, uy], a))
      }
    }
  }
  // Unreachable for n >= 2 (the widest pair always encloses or a triple does), but a total function
  // beats a non-null assertion here.
  return best ?? { c: pts[0]!, r: 0 }
}

/**
 * The trigger point + radius for a fused cluster telling, over the members it actually names.
 *
 * **Position: the 1-CENTER** (centre of the smallest circle enclosing every member). Measured against
 * the alternatives on the 30 generatable clusters, by mean worst-member distance:
 *
 *     1-center 192 m  ·  centroid 230 m (+20%)  ·  medoid 325 m (+69%)  ·  subject 522 m (+171%)
 *
 * ⚠ **NOT `subject_poi_id`**, which spec §4.1 originally proposed. It never wins: on the 10 clusters
 * that have a subject it ties the medoid 6 times (all n≤3, where the subject simply IS the medoid)
 * and LOSES the other 4, and it is exactly 2× worse than the 1-center on that subset. The reason is
 * structural, so it will not improve with more data — a subject is chosen for NAMING authority (a
 * `…Historic District` or settlement QID), and such an entity's Wikidata point is a label point, not
 * a centre. Vikingsholm is the worst case in the corpus: the flagship subject, 1032 m worst-member
 * against the 1-center's 516.
 *
 * **Radius: `max(ANCHORED_TRIGGER_RADIUS_M, enclosingRadius)`** — the circle that already contains
 * every member, floored at the standard anchored radius.
 *
 * ⚠ **NOT `worstMember + ANCHORED_TRIGGER_RADIUS_M`**, which spec §4.1 also proposed. Adding them
 * puts 24 of the 30 clusters above the 322 m the speed-adaptive lead already grants at 60 mph, so the
 * floor rather than the lead would decide the fire point for 80% of them — reintroducing precisely
 * the early-and-imprecise firing that `ANCHORED_TRIGGER_RADIUS_M` was added to stop (see its comment
 * in geo.ts, and the "Harrah's triggers really far" complaint behind it). The max() form still
 * encloses every member of every cluster by construction. ⚠ It does NOT bound the result: a group
 * spread over a kilometre yields a kilometre-wide circle, which is why `CLUSTER_MAX_TRIGGER_RADIUS_M`
 * exists as a separate policy above. 22 of the 32 clusters land on the 250 m floor and one (the merged
 * UNR campus, 903 m) is over the line.
 *
 * That bound is also what makes the point safe to leave OFF-ROAD. The 1-center can sit away from any
 * road (over the water, for Emerald Bay), and `buildDrive` drops a candidate whose off-route distance
 * exceeds its reach — but every member lies within `enclosingRadius` of the centre, so a route
 * passing any member is within the radius by definition. Snapping the point to the nearest member
 * anchor would trade that guarantee for a worse centre; it is deliberately not done.
 *
 * Returns null for an empty member list — a cluster with nothing tellable has no position, the same
 * way it has no `facts_hash`.
 */
export function clusterTrigger(members: readonly ClusterMemberPoint[]): ClusterTrigger | null {
  if (members.length === 0) return null
  if (members.length === 1) {
    const m = members[0]!
    return { lat: m.lat, lng: m.lng, radiusM: ANCHORED_TRIGGER_RADIUS_M, worstMemberM: 0 }
  }

  const origin: LngLat = [
    members.reduce((s, m) => s + m.lng, 0) / members.length,
    members.reduce((s, m) => s + m.lat, 0) / members.length,
  ]
  const proj = projector(origin)
  const { c } = minimalEnclosingCircle(members.map(proj.to))
  const [lng, lat] = proj.from(c)

  // Re-measure on the sphere: the projection picked the point, haversine reports the distance.
  const worstMemberM = members.reduce(
    (worst, m) => Math.max(worst, haversineMeters([lng, lat], [m.lng, m.lat])),
    0,
  )
  return {
    lat,
    lng,
    radiusM: Math.max(ANCHORED_TRIGGER_RADIUS_M, Math.ceil(worstMemberM)),
    worstMemberM,
  }
}

/** Whether this cluster is too spread out to be told from a single point — see
 *  `CLUSTER_MAX_TRIGGER_RADIUS_M`. Kept SEPARATE from `clusterTrigger`, which reports geometry: this
 *  is a policy about what we are willing to ship, and conflating the two would make the measurement
 *  unavailable to whoever wants to revisit the policy. */
export function exceedsPointTrigger(trigger: Pick<ClusterTrigger, 'radiusM'>): boolean {
  return trigger.radiusM > CLUSTER_MAX_TRIGGER_RADIUS_M
}
