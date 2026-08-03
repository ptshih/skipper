// GPS fault injection — the road, synthesised. Pure, seedable, deterministic.
//
// A RECORDED trace replays the noise of a road already driven (desk-drive-harness.md §4.2). This file
// covers what recording cannot reach yet: the failure modes we have reasoned about but never captured.
// Each function degrades a `RawFix[]` into another `RawFix[]`, so the degraded trace goes through
// `replaySource`/`replayHeadless` → `createFixMapper` — the SAME pipeline the live watch runs. (§4.3)
//
// ⚠ The bar every fault here is held to: it must change what some BRANCH of that pipeline does. A
// degradation that only makes the numbers uglier proves nothing — `gps-fault.test.ts` asserts the
// pipeline consequence (admitted vs rejected, cursor advanced vs frozen), never just that the input
// changed. A fault nobody can attribute an outcome to is worse than no fault at all, which is also why
// each one injects a SINGLE failure mode and composition is explicit (`degrade`).
//
// ⚠ One item from §4.3 is deliberately absent: iOS REDUCED (approximate) accuracy. It lives on the
// permission RESPONSE (`isReducedAccuracy`), not on a fix, so no trace can express it — its downstream
// symptom (kilometre-wide fixes) is `canyonMultipath` with an absurd band, but the branch itself is a
// permissions test, not a trace test.
import { bearingDeg, EARTH_RADIUS_M, haversineMeters, OFF_ROUTE_MAX_M, type LngLat } from '@skipper/engine'
import type { RawFix } from './gps-util'

/* -------------------------------------------------------------------------- */
/*  Determinism                                                                */
/* -------------------------------------------------------------------------- */

/**
 * mulberry32 — a small 32-bit PRNG, seeded explicitly by every fault below.
 *
 * ⚠ `Math.random()` is BANNED in this file. A fault trace that cannot be re-run is an anecdote, not a
 * fixture: the whole economic argument of the harness is that a desk drive costs nothing and therefore
 * gets run on every change, and the parameter sweep (§4.5) re-runs one trace against many trigger
 * radii. Both need the degradation to be byte-identical across runs, processes and machines.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * One standard-normal sample (Box–Muller). Position error is not uniform — it clusters near the truth
 * with occasional wide excursions, and the excursions are the interesting part, since they are what
 * decides whether a stop beside the road falls inside the trigger radius on the pass that mattered.
 */
function gauss(rand: () => number): number {
  const u = 1 - rand() // (0,1]: log(0) is -Infinity
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

/** Deterministic in-place Fisher–Yates, driven by the caller's seeded generator. */
function shuffle<T>(items: T[], rand: () => number): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const tmp = items[i]!
    items[i] = items[j]!
    items[j] = tmp
  }
}

/* -------------------------------------------------------------------------- */
/*  Geometry                                                                    */
/* -------------------------------------------------------------------------- */

const pointOf = (raw: RawFix): LngLat => [raw.coords.longitude, raw.coords.latitude]

/**
 * Move a [lng, lat] point `meters` along `bearing` (deg, 0=N). Equirectangular, which is exact enough
 * at the ≤ few-hundred-metre scale a fault displaces — and it uses `EARTH_RADIUS_M` so this file and
 * the `haversineMeters` the pipeline measures the result with sit on the SAME sphere (see the constant's
 * doc in engine/geo.ts: two Earth models make a self-check quietly compare against a different planet).
 */
function offsetMeters(point: LngLat, bearing: number, meters: number): LngLat {
  const [lng, lat] = point
  const rad = (bearing * Math.PI) / 180
  const dLat = ((meters * Math.cos(rad)) / EARTH_RADIUS_M) * (180 / Math.PI)
  // Guard the divisor so a (never-visited) polar latitude yields a finite longitude rather than NaN.
  const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 1e-6)
  const dLng = ((meters * Math.sin(rad)) / (EARTH_RADIUS_M * cosLat)) * (180 / Math.PI)
  return [lng + dLng, lat + dLat]
}

/** Below this separation two fixes are the same place and their bearing is meaningless. */
const MIN_BEARING_SEPARATION_M = 1

/**
 * Bearing of travel at fix `i`, from the fix before it (or the one after, at the head of the trace).
 *
 * ⚠ `bearingDeg` FABRICATES due north for coincident points — read its doc, this is the documented
 * trap. A stationary pair would therefore silently rotate lateral jitter to due EAST for the whole
 * stretch a car sits at a light, which is the one place lateral error looks least like a canyon. Fall
 * back to the last real bearing instead.
 */
function travelBearingAt(trace: RawFix[], i: number, fallback: number): number {
  const cur = pointOf(trace[i]!)
  if (i > 0) {
    const prev = pointOf(trace[i - 1]!)
    if (haversineMeters(prev, cur) > MIN_BEARING_SEPARATION_M) return bearingDeg(prev, cur)
  }
  if (i + 1 < trace.length) {
    const next = pointOf(trace[i + 1]!)
    if (haversineMeters(cur, next) > MIN_BEARING_SEPARATION_M) return bearingDeg(cur, next)
  }
  return fallback
}

/* -------------------------------------------------------------------------- */
/*  Windows                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Which stretch of a trace a fault applies to, in seconds from the trace's FIRST fix.
 *
 * ⚠ Seconds, not indices, and that is load-bearing for composition: a `dropout` re-indexes everything
 * after it, so a second fault addressed by index would land on different fixes depending on what ran
 * before it — silently, with no error. A fix's own clock survives every fault in this file.
 */
export interface FaultWindow {
  /** Inclusive lower bound. Default 0 (the start of the trace). */
  startSec?: number
  /** Exclusive upper bound. Default: the end of the trace. */
  endSec?: number
}

function windowTest(trace: RawFix[], w: FaultWindow): (raw: RawFix) => boolean {
  const t0 = trace[0]?.timestamp ?? 0
  const fromMs = t0 + (w.startSec ?? 0) * 1000
  const toMs = w.endSec == null ? Infinity : t0 + w.endSec * 1000
  return (raw) => raw.timestamp >= fromMs && raw.timestamp < toMs
}

/* -------------------------------------------------------------------------- */
/*  The faults                                                                  */
/* -------------------------------------------------------------------------- */
// All of them are PURE: a new array out, input array and input fix objects never mutated. Fixes the
// fault did not touch are shared by reference (nothing in this file mutates, so sharing is safe and
// keeps a `degrade` chain cheap) — treat a returned trace as read-only, as every consumer here does.

export interface CanyonMultipathOptions extends FaultWindow {
  seed: number
  /** Reported horizontal accuracy band (m). The default band is the granite-canyon case from §4.3. */
  accuracyMinM?: number
  accuracyMaxM?: number
  /** 1σ of the lateral position error (m). ⚠ See the clamp note below before raising this. */
  lateralM?: number
  /** AR(1) ρ: how strongly each sample is pulled toward the previous one, 0 (white) … <1 (drifting). */
  correlation?: number
}

/** How many σ of lateral error the walk is allowed to reach. See `canyonMultipath`. */
const LATERAL_SIGMA_CLAMP = 3

/**
 * Canyon multipath: usefully-noisy fixes — reported accuracy in the 80–150 m band, with position error
 * to match — for the stretch of trace inside the window.
 *
 * **This is the fault the speed-aware accuracy gate exists for.** `accuracyCeilingM` loosens with speed
 * precisely so that a 120 m fix at 30 m/s still DRIVES triggering instead of being thrown away; a gate
 * without that term rejects every fix in a granite canyon and the drive silently never fires a stop —
 * the field-confirmed zero-fire. So the pass condition for a canyon-degraded trace at speed is that it
 * still yields admitted fixes, and the same trace at rest is correctly rejected.
 *
 * The lateral error is CORRELATED (an AR(1) walk), not resampled per fix, because multipath is not
 * white noise: the reflecting geometry persists for seconds at a time, so the error leans to one side of
 * the road for a stretch and then leans back. White noise would average out over any few fixes and never
 * put the car meaningfully off the polyline at all.
 *
 * ⚠ The walk is clamped to `LATERAL_SIGMA_CLAMP`σ so the default band stays well inside `OFF_ROUTE_MAX_M`.
 * Letting the tail run would occasionally throw a fix past the off-route rejection band and FREEZE the
 * projection cursor — which is `positionJump`'s failure mode, not this one, and a run that mixes two
 * faults can no longer attribute its outcome to either. Raise `lateralM` past OFF_ROUTE_MAX_M/3 only if
 * you mean to inject both.
 *
 * Jitter direction is perpendicular to travel, derived from the INPUT trace (so the frame of reference
 * doesn't itself wander as fixes move). Lateral rather than 2-D because lateral is the component the
 * pipeline can see: it changes the distance to a stop beside the road and it is what the off-route
 * rejection measures, whereas an along-track error on a ~13 m polyline mostly re-selects a neighbouring
 * vertex.
 */
export function canyonMultipath(trace: RawFix[], opts: CanyonMultipathOptions): RawFix[] {
  const { accuracyMinM = 80, accuracyMaxM = 150, lateralM = 60, correlation = 0.9 } = opts
  const rand = mulberry32(opts.seed)
  const inWindow = windowTest(trace, opts)
  const rho = Math.max(0, Math.min(0.999, correlation))
  let state = 0 // the AR(1) walk, in σ
  let bearing = 0

  return trace.map((raw, i) => {
    bearing = travelBearingAt(trace, i, bearing)
    if (!inWindow(raw)) return raw
    // Stationary AR(1): ρ·state + √(1−ρ²)·N(0,1) keeps unit variance whatever ρ is, so `lateralM`
    // stays the 1σ error the caller asked for instead of shrinking as correlation rises.
    state = rho * state + Math.sqrt(1 - rho * rho) * gauss(rand)
    state = Math.max(-LATERAL_SIGMA_CLAMP, Math.min(LATERAL_SIGMA_CLAMP, state))
    const [lng, lat] = offsetMeters(pointOf(raw), bearing + 90, state * lateralM)
    return {
      coords: {
        ...raw.coords,
        latitude: lat,
        longitude: lng,
        accuracy: accuracyMinM + rand() * (accuracyMaxM - accuracyMinM),
      },
      timestamp: raw.timestamp,
    }
  })
}

/**
 * Tunnel / dead zone: no fixes at all for the window.
 *
 * ⚠ Takes no seed, and that is the point of the fault rather than an omission: a tunnel does not
 * produce BAD fixes, it produces NO fixes. Nothing reaches the accuracy gate, so nothing counts as
 * rejected and no stat anywhere goes red — the only symptom is a widening gap that the windowed
 * projection cursor has to span in one step when the car comes out the other side. (A gap longer than
 * `PROJECT_WINDOW_VERTS` of route is where that stops being free.)
 */
export function dropout(trace: RawFix[], opts: FaultWindow): RawFix[] {
  const inWindow = windowTest(trace, opts)
  return trace.filter((raw) => !inWindow(raw))
}

export interface ColdStartOptions {
  seed: number
  /** How many leading fixes are unsettled. Default 5. */
  count?: number
  /** Reported horizontal accuracy of an unsettled fix (m). Default `COLD_START_ACCURACY_M`. */
  accuracyM?: number
  /** How far the unsettled position actually wanders from the truth (m). Default 300. */
  scatterM?: number
}

/**
 * An unsettled acquisition fix's reported accuracy. Its one job is to clear `accuracyCeilingM` at any
 * survivable road speed — the ceiling is speed-proportional, so this is deliberately an order of
 * magnitude past the floor rather than a value tuned to today's constant, which would turn a tightening
 * of the gate into a silently-passing fault.
 */
const COLD_START_ACCURACY_M = 1000

/**
 * Cold start: the first `count` fixes are replaced with unsettled ones — ~1000 m reported accuracy and
 * a position that genuinely wanders, because a fix that bad is not merely mislabelled.
 *
 * These MUST be rejected: a wild fix landing near a stop would false-fire it before the car has moved.
 * Replaced rather than prepended because that is the real shape — the rider taps Drive and the car
 * pulls out; nobody waits for the radio to settle, so the garbage fixes occupy the first real seconds
 * of the route rather than sitting in extra time before it.
 */
export function coldStart(trace: RawFix[], opts: ColdStartOptions): RawFix[] {
  const { count = 5, accuracyM = COLD_START_ACCURACY_M, scatterM = 300 } = opts
  const rand = mulberry32(opts.seed)
  return trace.map((raw, i) => {
    if (i >= count) return raw
    const [lng, lat] = offsetMeters(pointOf(raw), rand() * 360, rand() * scatterM)
    return {
      coords: { ...raw.coords, latitude: lat, longitude: lng, accuracy: accuracyM * (0.8 + 0.4 * rand()) },
      timestamp: raw.timestamp,
    }
  })
}

export type SentinelField = 'speed' | 'heading' | 'accuracy'

export interface IosSentinelOptions extends FaultWindow {
  seed: number
  /** Share of in-window fixes carrying the sentinel, 0..1. Default 0.25. */
  fraction?: number
  /** Which fields go to -1. Default speed + heading — see why `accuracy` is opt-in. */
  fields?: SentinelField[]
}

/**
 * The iOS -1 sentinels (expo/expo#5401): CLLocation reports **-1, not null**, for a value it could not
 * derive, on device AND simulator. The types say `number | null`, so `?? 0` looks sufficient and is not
 * — and the two spellings must both survive a trace round-trip, which is why the recorder never
 * "cleans" them.
 *
 * All requested fields go bad on the SAME fix from ONE roll, rather than being rolled independently:
 * on iOS they share a cause (the fix was too poor to derive course and speed from), so they arrive
 * together. Rolling per-field would model a failure that does not happen and would dilute the
 * speed+heading pairing that the interesting branches key on.
 *
 * ⚠ `accuracy` is NOT in the default set. A -1 accuracy is a hard REJECT at the gate, so including it
 * turns any fraction into a partial zero-fire and masks whatever the speed/heading sentinels were
 * supposed to prove. Ask for it deliberately, as its own experiment.
 */
export function iosSentinels(trace: RawFix[], opts: IosSentinelOptions): RawFix[] {
  const { fraction = 0.25, fields = ['speed', 'heading'] } = opts
  const rand = mulberry32(opts.seed)
  const inWindow = windowTest(trace, opts)
  const wants = new Set(fields)
  return trace.map((raw) => {
    if (!inWindow(raw)) return raw
    if (rand() >= fraction) return raw
    const coords = { ...raw.coords }
    if (wants.has('speed')) coords.speed = -1
    if (wants.has('heading')) coords.heading = -1
    if (wants.has('accuracy')) coords.accuracy = -1
    return { coords, timestamp: raw.timestamp }
  })
}

export interface PositionJumpOptions extends FaultWindow {
  seed: number
  /** How far off-route to teleport (m). Default: `JUMP_OFFROUTE_MULT` × the off-route rejection band. */
  offsetM?: number
}

/**
 * How far past the off-route rejection band the default teleport lands. Expressed as a multiple of
 * `OFF_ROUTE_MAX_M` rather than a literal, because the number that matters is "unambiguously outside
 * the band" — if the band moves, this fault must move with it or it stops testing anything.
 */
const JUMP_OFFROUTE_MULT = 3

/**
 * The seeded lean, in degrees, rotated from the perpendicular TOWARD the direction of travel. Both
 * bounds are load-bearing, and neither is taste:
 *
 * - the MAX keeps the cross-track component at ≥ offsetM·cos(60°) = offsetM/2, so the fix lands clearly
 *   outside the rejection band. ⚠ Shrink `offsetM` below 2×OFF_ROUTE_MAX_M and that guarantee is gone —
 *   the jump can land INSIDE the band and the cursor will happily follow it.
 * - the MIN keeps the along-track component POSITIVE (≥ offsetM·sin(15°)), which is what makes the
 *   fault attributable. A jump that lands BEHIND the cursor is frozen by the monotonic floor whether or
 *   not off-route rejection exists, so it silently tests the wrong guard: measured, a backward-leaning
 *   teleport froze the cursor identically with rejection disabled. Landing ahead and off-route leaves
 *   exactly one thing that can hold the cursor back.
 */
const JUMP_LEAN_MIN_DEG = 15
const JUMP_LEAN_MAX_DEG = 60

/**
 * Teleport the windowed fixes far off-route — the fix that arrives from somewhere else entirely.
 *
 * The branch under test is the projection cursor's off-route rejection: a fix near NO vertex in the
 * window must FREEZE the cursor rather than snap to whatever vertex happened to be least far away.
 * Without it the cursor walks forward on every fix, feeds the end predicate, and fires the outro in
 * seconds — drive over, credit spent, nothing played (the App-Review-in-Cupertino bug). Freezing is the
 * safe failure: `alongM` drives only the progress dot and the end predicate, while stop triggering keys
 * on raw proximity, so a parked cursor can never silence a stop.
 *
 * ⚠ Displacement is FORWARD-AND-SIDEWAYS by construction, not a uniformly random bearing, and that is
 * a correctness fix rather than a flourish. A uniform bearing lands back ON the route whenever it
 * happens to point along it (2 km north on a north-south road is just 2 km further down the road, which
 * the cursor rightly follows), and lands behind it half the rest of the time, where the monotonic floor
 * freezes the cursor for a different reason entirely. Either way the run still looks degraded while
 * testing nothing it claims to. A fault that only sometimes faults is the worst kind of fixture; the
 * seed picks the side and the lean, and the bounds keep both properties (see the lean constants).
 *
 * ⚠ Accuracy is left ALONE on purpose. A teleported fix that also reported bad accuracy would be
 * rejected at the gate and never reach the cursor at all, so the rejection this fault exists to
 * exercise would go untested while the run still looked degraded.
 *
 * ONE displacement for the whole window, fixed at the moment the jump starts: a bad lock puts you in
 * one wrong place (a cell/wifi fallback, a reflection) for as long as its cause lasts. Re-rolling per
 * fix would scatter the car across the county, which is not a failure mode anything has ever seen.
 */
export function positionJump(trace: RawFix[], opts: PositionJumpOptions): RawFix[] {
  const { offsetM = OFF_ROUTE_MAX_M * JUMP_OFFROUTE_MULT } = opts
  const rand = mulberry32(opts.seed)
  const inWindow = windowTest(trace, opts)
  const side = rand() < 0.5 ? 1 : -1
  const lean = JUMP_LEAN_MIN_DEG + rand() * (JUMP_LEAN_MAX_DEG - JUMP_LEAN_MIN_DEG)
  const startIdx = trace.findIndex(inWindow)
  if (startIdx < 0) return trace.slice()
  // Perpendicular to travel at the moment the jump starts, rotated `lean` degrees toward the heading.
  const bearing = travelBearingAt(trace, startIdx, 0) + side * (90 - lean)
  return trace.map((raw) => {
    if (!inWindow(raw)) return raw
    const [lng, lat] = offsetMeters(pointOf(raw), bearing, offsetM)
    return { coords: { ...raw.coords, latitude: lat, longitude: lng }, timestamp: raw.timestamp }
  })
}

export interface ReorderOptions extends FaultWindow {
  seed: number
  /** How many adjacent pairs to swap. Default 1. Non-overlapping, so a swap can't be undone. */
  swaps?: number
}

/**
 * Deliver fixes out of chronological order.
 *
 * Swaps DELIVERY order and lets each fix keep its own clock — a buffered or delayed radio update
 * arriving after a newer one, which is the thing that actually happens. Rewriting the timestamps in
 * place instead would model a clock bug nobody has ever seen, and would leave delivery order (the thing
 * the projection cursor consumes) untouched.
 *
 * The property worth asserting downstream is that the monotonic cursor absorbs this: an out-of-order
 * pair must not rewind `alongM`. `tSec` is a different matter — it is measured from the first ADMITTED
 * fix and is documented reporting-only, so a swapped pair can hand the consumer a NEGATIVE `tSec`.
 * That is survivable only for as long as "reporting-only" stays true.
 */
export function reorderTimestamps(trace: RawFix[], opts: ReorderOptions): RawFix[] {
  const { swaps = 1 } = opts
  const rand = mulberry32(opts.seed)
  const inWindow = windowTest(trace, opts)

  const eligible: number[] = []
  for (let i = 0; i + 1 < trace.length; i++) {
    if (inWindow(trace[i]!) && inWindow(trace[i + 1]!)) eligible.push(i)
  }
  shuffle(eligible, rand)

  const out = trace.slice()
  const taken = new Set<number>()
  let done = 0
  for (const i of eligible) {
    if (done >= swaps) break
    if (taken.has(i) || taken.has(i + 1)) continue // overlapping pairs would cancel each other out
    taken.add(i)
    taken.add(i + 1)
    const held = out[i]!
    out[i] = out[i + 1]!
    out[i + 1] = held
    done++
  }
  return out
}

/* -------------------------------------------------------------------------- */
/*  Composition                                                                 */
/* -------------------------------------------------------------------------- */

/** A degradation, pre-bound to its options: `(t) => canyonMultipath(t, { seed: 1 })`. */
export type TraceFault = (trace: RawFix[]) => RawFix[]

/**
 * Apply faults left to right.
 *
 * ⚠ ORDER MATTERS and the faults do not commute — dropout-then-canyon degrades fewer fixes than
 * canyon-then-dropout, and a canyon applied after a dropout re-derives its travel bearing ACROSS the
 * seam. Write the chain in the order the road would have produced it.
 *
 * Composition is also where faults stop being independent: a speed sentinel inside a canyon collapses
 * `accuracyCeilingM` back to its floor and those fixes are rejected, which neither fault does alone.
 * That is a real property of the pipeline and worth reaching for deliberately — just don't reach for it
 * by accident and then read the rejection count as a canyon result.
 */
export function degrade(trace: RawFix[], faults: TraceFault[]): RawFix[] {
  return faults.reduce<RawFix[]>((t, fault) => fault(t), trace)
}
