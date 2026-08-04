// buildDrive — assemble a paced, ordered drive from the corpus's REUSED narrations along a frozen route.
//
// The heart of "Create a Drive": a drive is the region's shared corpus, pre-ordered for your route.
// Each narration is a place's ONE shared telling (1:1 with its POI), already synthesized — so this NEVER generates
// audio; it SELECTS + PACES existing clips. Pure, zero-dep, RN-safe (like the rest of engine), so
// the server assembles a drive at request time AND the device can re-pace one offline.
//
// Two selection choices the design calls out:
//   - co-located candidates collapse PICK-ONE, never merge (you can't fuse two finished .m4a clips);
//   - the window prefers a clip that FITS the gap (won't queue-lag) + variety, ranked on the clip's
//     REAL audioDurationMs, not an extract length (the clip already exists).
//
// Break stops are layered by the caller when they land (DEFERRED — `detours`); this is the
// narration core.

// ⚠ This module no longer imports from './trigger'. That is the POINT, not an accident of cleanup:
// admission is a geometry question ("is this place along the drive"), and the moment it reaches for a
// trigger constant it has started answering a different one. See `buildCandidatePlacer`.
import { haversineMeters, OFF_ROUTE_MAX_M, triggerRadiusForKind, type LngLat } from './geo'
import { buildRouteSnapper, type RouteSnap } from './pacing'

/** A reusable narration a drive can include — the place's ONE shared telling (1:1 with the POI).
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
  /** An EXPLICIT trigger floor (m), overriding the `kind`/`anchored` derivation below. Exists for
   *  the fused CLUSTER telling, whose subject is a `poi_clusters` row: it has no `kind` to look up
   *  and no single anchor, so its floor is computed from its members' geometry instead
   *  (`clusterTrigger`). ⚠ Only set this when the kind vocabulary genuinely cannot answer — a POI
   *  must keep deriving its radius, so the two paths can't drift. */
  triggerRadiusM?: number
  /** True when this candidate's group is too spread out for ANY single point to represent honestly —
   *  `exceedsPointTrigger(clusterTrigger(members))` on the UNCAPPED radius. Routes the candidate down
   *  the MEMBER placement rule instead of the centre-point one (see the admission loop).
   *
   *  ⚠ It is a BOOLEAN carried from the server, not something recomputable here, and that is the whole
   *  point: the loader serves `triggerRadiusM` already CAPPED at `CLUSTER_MAX_TRIGGER_RADIUS_M`, so by
   *  the time a candidate exists the evidence is gone — asking `exceedsPointTrigger` again would read
   *  the cap and answer `false` for exactly the groups this reroutes. Compute it where the true radius
   *  still lives.
   *  ⚠ The caller must still populate it: "absent" and "wide" have to be distinguishable, and dropping
   *  the field at the mapper silently restores the centre-point behaviour this exists to stop. */
  tooWideForPoint?: boolean
  /** The group's tellable MEMBER anchors, as `[lng, lat]`. **Required whenever `tooWideForPoint` is
   *  set** — it is what the wide-group rule places on, and a wide candidate without it is REFUSED
   *  (fail-closed: the alternative is silently falling back to the off-road centre, which is the exact
   *  mis-placement the flag exists to prevent). Undefined for a poi, which has no members. */
  memberPoints?: LngLat[]
  /** This telling is a GLANCE — a short call-out (a named scenic feature you are passing) rather than
   *  a stop. Glances are selected in a SEPARATE pass that fills the quiet BETWEEN stops; they never
   *  compete for a stop slot and never count against `maxStops`.
   *
   *  ⚠ THE FLAG EXISTS BECAUSE COMPETING IS EXACTLY WHAT BREAKS THEM. Measured 2026-08-03 on the live
   *  corpus: adding 30 eligible 20-second scenic candidates to a real drive selected **zero** of them
   *  and changed the drive by nothing, while the same 30 run WITHOUT stories selected 7. They are
   *  reachable, they survive the co-located dedupe, they clear the pacing floor — they simply lose
   *  `better()`, which ranks on `audioDurationMs`, so a 60-90 s telling beats a 20 s glance in every
   *  window. A tier generated without this flag would be invisible in the only mode that exists. */
  glance?: boolean
}

/** The trigger floor for a candidate: an explicit override when one is supplied (a cluster), else the
 *  kind/anchored vocabulary (a poi). Single-sourced so selection and the manifest can't disagree —
 *  a stop admitted under one radius and served under another is selected-then-silent. */
export function candidateTriggerRadiusM(cand: Pick<DriveCandidate, 'kind' | 'anchored' | 'triggerRadiusM'>): number {
  return cand.triggerRadiusM ?? triggerRadiusForKind(cand.kind ?? null, cand.anchored === true)
}

/** One stop in an assembled drive — a narration placed on THIS route. A superset of the fields the
 *  preview/live player need; the route supplies the trigger geometry a narration doesn't store. */
export interface DriveStop {
  seq: number
  poiId: string
  audioKey: string
  audioDurationMs: number
  name?: string
  kind?: string | null
  /** Snapped to THIS route (a shared narration stores no trigger geometry — the route supplies it,
   *  which is what lets one telling ride every drive that passes it). */
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
}

/** Two narrations closer than this on the ground are the same physical stop — collapse to one
 *  (1 km; the spatial dedupe now lives only here in the engine, not in the studio pipeline). */
export const DRIVE_MIN_SEPARATION_M = 1_000
/** A clip that would start more than this many seconds after its trigger (FIFO queue lag) is
 *  DROPPED — silence beats a clip playing far behind the car. */
export const DRIVE_MAX_LAG_SEC = 45

/**
 * How much silence a GLANCE must leave on EACH side of itself: clear of the clip that just ended, and
 * clear of the next stop's trigger.
 *
 * ⚠ Deliberately the same number as `DRIVE_MAX_LAG_SEC`, and for the same reason rather than by
 * coincidence: that constant is the project's existing answer to "how far behind the car may audio
 * fall before silence is better", so it is the natural unit for "how much room a clip needs in order
 * not to tread on its neighbours". A glance that crowds the telling before it is worse than no glance.
 */
export const GLANCE_EDGE_SEC = 45

interface Snapped {
  cand: DriveCandidate
  /** The point this stop was actually PLACED from — `[lng, lat]` of the candidate for a poi, of the
   *  chosen member for a wide group. Kept because the two diverge: a wide group's `lat/lng` is an
   *  off-road enclosing-circle centre that can sit a kilometre from where the route meets it, and the
   *  co-located dedupe below must compare where stops ARE, not where their centres are. */
  anchor: LngLat
  alongSec: number
  triggerLat: number
  triggerLng: number
  approachHeadingDeg: number
}

/**
 * Where a WIDE group meets the route: the EARLIEST member the car comes close enough to trigger.
 *
 * Placement is "earliest", not "closest", and the difference is audible. A district is somewhere you
 * drive INTO, and its telling runs 2-3 minutes; anchoring on the closest approach starts him talking
 * from the middle of the group, so the rider is already leaving as he introduces it. The earliest
 * reachable member starts the telling on arrival. (Closest approach stays the right rule for the
 * REACHABILITY question — "is this group on the drive at all" — which is why every member is tested
 * against `reachM` before the earliest one is chosen.)
 *
 * ⚠ Returns null when there are no members or none is reachable, and BOTH must stay refusals. A group
 * whose members the route never approaches is not on this drive, and a wide candidate that arrives
 * without members is a mapper bug — falling back to the centre there would reintroduce exactly the
 * frozen mis-placement this rule replaced.
 */
function placeWideGroup(
  members: LngLat[] | undefined,
  snap: (p: LngLat) => RouteSnap,
  reachM: number,
): { anchor: LngLat; s: RouteSnap } | null {
  if (members == null || members.length === 0) return null
  let best: { anchor: LngLat; s: RouteSnap } | null = null
  for (const m of members) {
    const s = snap(m)
    if (s.offRouteM > reachM) continue
    if (best === null || s.alongSec < best.s.alongSec) best = { anchor: m, s }
  }
  return best
}

/** Where a candidate meets a route, or null when the car never comes close enough to TRIGGER it. */
export interface CandidatePlacement {
  /** The point the stop was placed from — the candidate's own point, or a wide group's chosen member. */
  anchor: LngLat
  alongSec: number
  triggerLat: number
  triggerLng: number
  approachHeadingDeg: number
}

/**
 * THE admission rule, as ONE expression: build it for a route, then ask it of any candidate.
 *
 * ⚠ It is exported because a SECOND caller genuinely needs the same answer, and asking it a second way
 * is what broke it. `notSupersededByServedCluster` retires a cluster's members in SQL the moment the
 * fused telling is SERVED — but "served" is a release-gate question, and whether the fused clip can
 * actually PLAY is a route-geometry one. When the two disagreed, a drive lost both: measured
 * 2026-08-03 on the Stateline→Stateline loop, "Emerald Bay and Vikingsholm" was refused for range (its
 * centre sits 605 m off Highway 89, past its own 516 m floor) while Vikingsholm's own released 81 s
 * clip — 175 m off route, comfortably reachable — stayed retired behind it. The drive passed Emerald
 * Bay in silence, inside a 17:56 gap. The loader now asks THIS function, so a telling a route cannot
 * reach cannot suppress anything.
 *
 * The wide-group branch is the same rule the design already applied one level down (see the admission
 * loop): a group too spread out for a point is placed on its earliest reachable MEMBER, never on its
 * off-road enclosing-circle centre.
 */
export function buildCandidatePlacer(
  polyline: LngLat[],
  totalSec: number,
): (cand: DriveCandidate) => CandidatePlacement | null {
  const snap = buildRouteSnapper(polyline, totalSec)

  // ⚠ `totalSec` is still required, and not vestigially: `buildRouteSnapper` needs it to convert
  // along-route metres into the `alongSec` every downstream rule paces on. What it is no longer used
  // for is a route-average speed — admission stopped depending on how fast the car is moving when the
  // speed-adaptive reach came out of this decision (see below).
  return (cand) => {
    // ADMISSION IS THE HONESTY BOUND, AND ONLY THAT — "is this place actually along the drive".
    //
    // ⚠ From 2026-08-02 to 2026-08-03 this was `min(OFF_ROUTE_MAX_M, effectiveRadiusM(...))`, on the
    // theory that a candidate in the 250-700 m band would be SELECTED and then silent, because the
    // trigger fires on the car's distance to the stop and an anchored floor is 250 m. That theory
    // described a pipeline we do not run. A stop is served at its ROUTE-SNAPPED point
    // (`manifestClips` ships `item.triggerLat/Lng`), and both the player and the sim then call
    // `snapStopsToRoute`, which REPLACES the coordinates with the snapped position. The stop therefore
    // sits ON the polyline, the car drives over it, and it fires at closest approach no matter how far
    // off-road the POI itself is.
    //
    // ⚠ VERIFIED before this was changed, three ways on the real engine: a POI at 264/365/390/542/622 m
    // fires at the same second (closest approach) whether it is served snapped or raw, because
    // `runDrive` snaps either one. Only when `snapStopsToRoute` is bypassed entirely — the world the
    // old arithmetic assumed — does anything past 250 m go silent, which is almost certainly how the
    // original "3 of 18 could not fire" number was produced. The filter was refusing content to prevent
    // a failure that cannot occur, and its own note recorded the cost: one drive went 8 stops to 6.
    //
    // ⚠ SO `triggerRadiusM` IS A LEAD-TIME KNOB, NOT AN ADMISSION KNOB — that conflation is the whole
    // bug. It still governs how EARLY a stop fires (the client keeps firing on
    // `candidateTriggerRadiusM`, and the cluster cap still keeps a district from announcing itself a
    // kilometre out). It must never again decide WHETHER a place is on the drive; that question has
    // one answer, and this is it.
    const reachM = OFF_ROUTE_MAX_M

    // The SECOND admission rule: a group too spread out for a point has no single point to snap, so
    // the point rule cannot judge it — and judging it anyway is not a harmless approximation.
    //
    // ⚠ A wide group's `lat/lng` is its enclosing-circle CENTRE, which `clusterTrigger` deliberately
    // leaves un-snapped and off-road, while the radius it arrives with is CAPPED (600 m) below the
    // group's true extent (914 m for downtown Reno). Snapping that centre both mis-places the stop and
    // breaks the guarantee that justified the centre in the first place ("every member is within the
    // enclosing radius" is only true UNCAPPED). The two failure modes are a stop that fires on the
    // freeway approach and one that never fires at all — and a drive's `selection` is FROZEN at
    // create against a credit that is never refunded, so either one is baked in for that rider
    // permanently. That is why the centre is never the fallback, even when members are missing.
    //
    // ⚠ The branch is GEOMETRIC, not mode-based, and that distinction is load-bearing. It used to key
    // on an `area` field (a served convex hull), which meant deleting the area MODE would have
    // silently flipped it and shipped exactly the frozen mis-fire above. Keying it on the geometry
    // keeps it true no matter what trigger modes exist — and this rule needs NO polygon, which is why
    // the hull's deletion cost it nothing: the route is the rails, so where the polyline meets the
    // members is the whole answer.
    //
    // ⚠ Until 2026-08-03 this was a flat refusal. That refused three groups holding 8m13s of RELEASED
    // audio (downtown Reno, Reno's Historic Homes, the UNR campus) — content no drive could ever play,
    // while `notSupersededByServedCluster` had already retired their members behind it.
    const wide = cand.tooWideForPoint === true
    const placement = wide ? placeWideGroup(cand.memberPoints, snap, reachM) : null
    if (wide && placement === null) return null
    const anchor: LngLat = placement ? placement.anchor : [cand.lng, cand.lat]
    const s = placement ? placement.s : snap(anchor)
    if (s.offRouteM > reachM) return null
    return {
      anchor,
      alongSec: s.alongSec,
      triggerLat: s.triggerLat,
      triggerLng: s.triggerLng,
      approachHeadingDeg: s.approachHeadingDeg,
    }
  }
}

export function buildDrive(params: BuildDriveParams): DriveStop[] {
  const { polyline, totalSec, candidates, minGapSec, maxStops } = params
  const minGapMs = minGapSec * 1000

  // 1. Snap to the route, then drop candidates the car will never come close enough to TRIGGER.
  //    The rule itself lives in `buildCandidatePlacer` — ONE expression, because the corpus loader
  //    has to ask the same question to decide whether a fused telling may retire its members.
  //
  //    ⚠ Selecting on the radius the TRIGGER will actually use can only ever TIGHTEN the gate (the
  //    radius is min'd with the honesty ceiling), so the stop COUNT can fall. Measured on three saved
  //    drives when it landed: 18 stops with 3 silent became 16 stops with 0 silent — AUDIBLE stops
  //    went 15 to 16. One drive backfilled the freed window (7 audible to 8); the other had no other
  //    candidate in range and went from 8 stops to 6. That is a truth correction, not a regression:
  //    the stops it removes were never going to play, and a shorter honest drive beats a longer one
  //    with silent gaps in it.
  const place = buildCandidatePlacer(polyline, totalSec)
  const placed: Snapped[] = []
  // Glances are admitted on the SAME geometry as stops (they are real places on the route) but are
  // held out of the pacing pass entirely — see the glance fill after step 4.
  const glancesPlaced: Snapped[] = []
  for (const cand of candidates) {
    const p = place(cand)
    if (p === null) continue
    ;(cand.glance === true ? glancesPlaced : placed).push({ cand, ...p })
  }

  // 2. PICK-ONE co-located dedupe — the INVERSE of the studio pipeline's merge (you cannot fuse two
  //    finished clips). Greedy best-first (richer/longer clip wins) so the survivor is strongest.
  const byScore = [...placed].sort((a, b) => b.cand.audioDurationMs - a.cand.audioDurationMs)
  const kept: Snapped[] = []
  for (const cand of byScore) {
    // ⚠ Compares the PLACED anchors, not `cand.lat/lng`. Identical for a poi (its anchor IS its
    // point), but a wide group's centre can sit ~1 km from where the route meets it, so comparing
    // centres would collapse a district against a stop it is nowhere near — or miss one it sits on.
    const collides = kept.some(
      (k) => haversineMeters(k.anchor, cand.anchor) < DRIVE_MIN_SEPARATION_M,
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
  //    more than DRIVE_MAX_LAG_SEC after its trigger (it would lag too far behind the car). Dropping a
  //    laggard frees the queue for the next one, so this is a single forward pass.
  chosen.sort((a, b) => a.alongSec - b.alongSec)
  const survivors: Snapped[] = []
  let playEnd = 0
  for (const s of chosen) {
    const start = Math.max(s.alongSec, playEnd)
    if (start - s.alongSec > DRIVE_MAX_LAG_SEC) continue
    playEnd = start + s.cand.audioDurationMs / 1000
    survivors.push(s)
  }

  // 4b. THE GLANCE FILL — short call-outs dropped into the quiet BETWEEN stops.
  //
  // ⚠ This runs AFTER the stop selection is final, and that ordering is the whole design. A glance
  // must never displace a telling: measured 2026-08-03, letting 20-second scenic candidates compete in
  // step 3 selected ZERO of them (better() ranks on clip length, so a 90-second story wins every
  // window), and the naive fix — making the comparator form-aware — would have let a glance beat a
  // telling instead, which is worse. Selecting stops first and filling the leftovers costs the stop
  // pass nothing and cannot change it.
  //
  // ⚠ Glances do NOT count against `maxStops`. That cap exists to keep a drive from becoming a lecture
  // (~1 stop / 4 min); a 20-second glance in a 6-minute silence is not what it was protecting against,
  // and counting them would have the cap starve exactly the gaps this fills.
  //
  // Every glance must clear `GLANCE_EDGE_SEC` on BOTH sides — of the clip that just finished playing
  // (not merely of the previous trigger: the FIFO means a stop's audio outlives its trigger by its
  // whole duration) and of whatever comes next. Among the eligible, the EARLIEST wins, because a
  // glance's alongSec is where the place physically is — you call a thing out as you pass it, and the
  // second-best candidate in a window is simply further down the road.
  //
  // ⚠ The fill takes AS MANY as fit, not one per window, and the difference is the whole point.
  // Until 2026-08-03 it took exactly one however long the window was, which meant a 17-minute silence
  // could receive a single 20-second call-out and the rest of the road stayed mute. Measured on the
  // live corpus: South Lake Tahoe → Incline Village had 17 reachable glances and used 3 (8 stops); the
  // greedy fill uses 7 (12 stops). Tahoe City → South Lake Tahoe went 14 → 16. Nothing about a window
  // justified the cap — `maxStops` is what protects against a lecture, and glances deliberately do not
  // count against it (a 20-second glance in a 6-minute silence is not what that cap was guarding).
  // The EDGE rule is the real spacing guarantee, and it is per-glance, so applying it repeatedly is
  // the same promise kept more often: each pick re-arms the cursor `GLANCE_EDGE_SEC` past its own end.
  if (glancesPlaced.length > 0) {
    const bySeq = [...survivors].sort((a, b) => a.alongSec - b.alongSec)
    const taken: Snapped[] = []
    let playEndCursor = 0
    for (let w = 0; w <= bySeq.length; w++) {
      const prev = w > 0 ? bySeq[w - 1] : undefined
      const next = bySeq[w]
      // The quiet runs from when the previous clip stops PLAYING to when the next one triggers.
      if (prev) playEndCursor = Math.max(playEndCursor, prev.alongSec) + prev.cand.audioDurationMs / 1000
      let from = (prev ? playEndCursor : 0) + GLANCE_EDGE_SEC
      const until = (next ? next.alongSec : totalSec) - GLANCE_EDGE_SEC
      for (;;) {
        const pick = glancesPlaced
          .filter((g) => !taken.includes(g))
          .filter((g) => g.alongSec >= from && g.alongSec + g.cand.audioDurationMs / 1000 <= until)
          // Never call out a place the drive already stops at — the co-located rule the stop pass
          // applies to itself, applied across the two passes.
          .filter((g) => !bySeq.some((s) => haversineMeters(s.anchor, g.anchor) < DRIVE_MIN_SEPARATION_M))
          // …and never call out the same place twice in a row either. Once glances can be adjacent,
          // the pass needs the separation rule against ITSELF: two call-outs 400 m apart naming
          // neighbouring coves is exactly the repetition the stop pass already refuses.
          .filter((g) => !taken.some((t) => haversineMeters(t.anchor, g.anchor) < DRIVE_MIN_SEPARATION_M))
          .sort((a, b) => a.alongSec - b.alongSec)[0]
        if (!pick) break
        taken.push(pick)
        from = pick.alongSec + pick.cand.audioDurationMs / 1000 + GLANCE_EDGE_SEC
      }
    }
    survivors.push(...taken)
  }

  // 5. Order + number.
  survivors.sort((a, b) => a.alongSec - b.alongSec)
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
