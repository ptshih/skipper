// THE HEADLESS DESK DRIVE — the piece that turns a 40-minute sitting into a few milliseconds.
//
// A drive, end to end, with no device, no timers, no audio and no human: raw fixes → the REAL live
// mapping pipeline (`createFixMapper`) → the REAL `TriggerEngine` → stop outcomes you can assert on.
// That is the whole economic argument of the harness. A desk drive that costs nothing gets run on
// every change; one that costs an afternoon gets run when someone remembers.
// docs/designs/desk-drive-harness.md §4.4.
//
// ⚠ What makes this different from `runDrive` in @skipper/engine, which already simulates a drive:
// runDrive generates PERFECT fixes and feeds the trigger engine directly, so it can never see an
// accuracy rejection, a -1 sentinel, a frozen cursor or a missed end predicate. This runs the same
// stops through the same engine but by way of the code a real phone actually executes. Use runDrive
// to ask "is the trigger geometry right"; use this to ask "does a real fix stream survive the trip".
import { createFixMapper, type RawFix } from './fix-mapper'
import { TriggerEngine } from './trigger'
import type { DriveStopRef, GpsFix, TriggerOptions } from './trigger'
import type { LngLat } from './geo'

export interface HarnessResult {
  /** Fixes that passed the accuracy gate and reached the trigger engine. */
  admitted: number
  /** Fixes the gate threw away. A high count with zero fires IS the zero-fire failure. */
  rejected: number
  /** Did the end predicate fire? A trace that stops short must NOT complete — see gps-source.ts. */
  ended: boolean
  fired: { seq: number; tSec: number; leadSec: number; distanceM: number }[]
  /** Stops handed in that never fired — the finding a desk drive exists to surface. */
  neverFired: number[]
  /** How far along the route the projection cursor actually got (m). Freezes on a run of off-route fixes. */
  finalAlongM: number
}

/**
 * Drive a raw fix trace through the full live path and report what the stops did.
 *
 * `stops` must already be snapped/filtered the way the app does it (`snapStopsToRoute` +
 * off-route drop) — this deliberately does NOT re-snap, so a caller can hand it exactly the stop set
 * a real drive would have used and get an answer about THAT, rather than about a re-derived one.
 */
export function driveTrace(
  polyline: LngLat[],
  stops: DriveStopRef[],
  trace: RawFix[],
  opts: Partial<TriggerOptions> = {},
): HarnessResult {
  const engine = new TriggerEngine(stops, opts)
  const fired: HarnessResult['fired'] = []
  let admitted = 0
  let rejected = 0
  let ended = false
  let finalAlongM = 0

  const accept = createFixMapper(polyline, {
    onFix: (f: GpsFix) => {
      admitted++
      finalAlongM = f.alongM
      for (const e of engine.update(f)) {
        fired.push({ seq: e.seq, tSec: e.tSec, leadSec: e.leadSec, distanceM: e.distanceM })
      }
    },
    onEnd: () => {
      ended = true
    },
  })
  for (const raw of trace) if (!accept(raw)) rejected++

  const firedSeqs = new Set(fired.map((f) => f.seq))
  return {
    admitted,
    rejected,
    ended,
    fired,
    neverFired: stops.map((s) => s.seq).filter((seq) => !firedSeqs.has(seq)),
    finalAlongM,
  }
}

export interface SyntheticTraceOptions {
  mph?: number
  tickHz?: number
  /** Reported horizontal accuracy (m). The default is a clean open-sky fix. */
  accuracyM?: number
  /** Epoch ms of the first fix. Explicit so a synthetic trace is byte-stable across runs. */
  startMs?: number
}

/**
 * Build a clean `RawFix[]` walking the polyline — the bridge that lets the existing synthetic
 * generator feed the REAL pipeline instead of bypassing it.
 *
 * ⚠ This is a *baseline*, not a realistic drive: every fix is exactly on the polyline with a constant
 * speed and a fixed accuracy. Its job is to be the control case you degrade (gps-fault.ts) or compare
 * a recorded trace against. Tuning anything against it alone repeats the mistake geo.ts:54 warns about
 * — a synthetic fix contains none of the error the trigger radius exists to absorb.
 *
 * Kept here rather than in @skipper/engine because `RawFix` is the mobile boundary type; the engine
 * has no business knowing what a CLLocation looks like.
 */
export function syntheticTrace(polyline: LngLat[], opts: SyntheticTraceOptions = {}): RawFix[] {
  const { mph = 45, tickHz = 1, accuracyM = 5, startMs = 1_700_000_000_000 } = opts
  if (polyline.length < 2) return []
  const speedMps = mph * 0.44704
  const dtSec = 1 / tickHz
  const out: RawFix[] = []

  // Walk the polyline by arc length so fix spacing reflects the requested speed, exactly as the
  // engine's own generator does — a harness whose geometry disagrees with the car is worse than none.
  const segLen: number[] = []
  let total = 0
  for (let i = 0; i < polyline.length - 1; i++) {
    const d = metersBetween(polyline[i]!, polyline[i + 1]!)
    segLen.push(d)
    total += d
  }

  let along = 0
  let t = 0
  let seg = 0
  let acc = 0
  while (along <= total) {
    while (seg < segLen.length - 1 && acc + segLen[seg]! < along) {
      acc += segLen[seg]!
      seg++
    }
    const a = polyline[seg]!
    const b = polyline[seg + 1] ?? a
    const frac = segLen[seg] ? (along - acc) / segLen[seg]! : 0
    out.push({
      coords: {
        latitude: a[1] + (b[1] - a[1]) * frac,
        longitude: a[0] + (b[0] - a[0]) * frac,
        accuracy: accuracyM,
        speed: speedMps,
        heading: bearing(a, b),
      },
      timestamp: startMs + Math.round(t * 1000),
    })
    along += speedMps * dtSec
    t += dtSec
  }
  return out
}

const R_EARTH_M = 6_371_000
const rad = (d: number) => (d * Math.PI) / 180

function metersBetween(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1])
  const dLng = rad(b[0] - a[0])
  const lat = rad((a[1] + b[1]) / 2)
  const x = dLng * Math.cos(lat)
  return Math.sqrt(x * x + dLat * dLat) * R_EARTH_M
}

function bearing(a: LngLat, b: LngLat): number {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]))
  const x =
    Math.cos(rad(a[1])) * Math.sin(rad(b[1])) -
    Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]))
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360
}
