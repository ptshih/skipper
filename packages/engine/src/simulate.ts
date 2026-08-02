// The drive simulator — replay a drive's polyline as a GPS fix stream and run the
// trigger core against that drive's stops, so we can validate speed-adaptive
// triggering, debounce, and audio overlap WITHOUT a car or live GPS.

import { bearingDeg, cumulativeMeters, interpolate, MPH_TO_MPS, OFF_ROUTE_MAX_M } from './geo'
import type { LngLat } from './geo'
import { DEFAULT_TRIGGER, snapStopsToRoute, TriggerEngine } from './trigger'
import type { GpsFix, DriveStopRef, TriggerEvent, TriggerOptions } from './trigger'

export interface DriveOptions extends Partial<TriggerOptions> {
  /** Constant drive speed (mph). Default 60. */
  mph?: number
  /** Simulated fix rate (Hz) — the foreground service runs high-rate. Default 4. */
  tickHz?: number
  /** POIs farther off-route than this don't trigger (default 700 m). */
  maxOffRouteM?: number
}

/** Generate an evenly-timed GPS fix stream driving the polyline at a constant speed. */
export function generateDrive(polyline: LngLat[], opts: DriveOptions = {}): GpsFix[] {
  if (polyline.length < 2) return []
  const speedMps = (opts.mph ?? 60) * MPH_TO_MPS
  const dt = 1 / (opts.tickHz ?? 4)
  if (speedMps <= 0) throw new Error('Drive speed must be > 0 mph.')

  const cum = cumulativeMeters(polyline)
  const total = cum[cum.length - 1]!
  const fixes: GpsFix[] = []
  let along = 0
  let t = 0
  let seg = 0
  while (along <= total) {
    while (seg < polyline.length - 2 && cum[seg + 1]! < along) seg++
    const a = polyline[seg]!
    const b = polyline[seg + 1]!
    const segLen = cum[seg + 1]! - cum[seg]!
    const frac = segLen > 0 ? (along - cum[seg]!) / segLen : 0
    const [lng, lat] = interpolate(a, b, frac)
    fixes.push({ lat, lng, speedMps, headingDeg: bearingDeg(a, b), tSec: t, alongM: along })
    along += speedMps * dt
    t += dt
  }
  return fixes
}

export interface StopOutcome {
  seq: number
  name?: string
  stopType?: string
  fired: boolean
  /** When it fired (s) — undefined if it never fired. */
  fireSec?: number
  /** Seconds of warning before reaching the trigger point at fire. */
  leadSec?: number
  /** How far the POI sits off the road (m) — the key diagnostic. */
  offRouteM: number
  /** True when the POI is beyond maxOffRouteM — no honest trigger point, so it won't fire. */
  excluded: boolean
  durationMs?: number | null
}

/** An audio clip whose playback would overlap the previous one (player must queue/duck). */
export interface Overlap {
  prevSeq: number
  seq: number
  /** Seconds the new clip starts BEFORE the previous one would finish. */
  overlapSec: number
}

export interface SimReport {
  speedMph: number
  tickHz: number
  driveSec: number
  totalRouteM: number
  fixCount: number
  trigger: TriggerOptions
  events: TriggerEvent[]
  stops: StopOutcome[]
  overlaps: Overlap[]
  /** Valid (on-route) stops that still never fired — a real triggering miss. */
  neverFired: number[]
  /** Stops excluded because the POI is too far off-route to have an honest trigger point. */
  excludedOffRoute: number[]
  /** Fraction of the drive covered by narration audio (sum of clip lengths / drive time). */
  coverageRatio: number
}

/** Simulate a drive and report triggering + overlap + coverage. */
export function runDrive(polyline: LngLat[], stops: DriveStopRef[], opts: DriveOptions = {}): SimReport {
  const fixes = generateDrive(polyline, opts)
  const trigger: TriggerOptions = { ...DEFAULT_TRIGGER, ...opts }
  const maxOffRouteM = opts.maxOffRouteM ?? OFF_ROUTE_MAX_M

  // Snap each POI to its trigger point on the road; only on-route POIs can fire.
  const snapped = snapStopsToRoute(polyline, stops)
  const offRouteBySeq = new Map(snapped.map((s) => [s.seq, s.offRouteM]))
  const triggerable = snapped.filter((s) => s.offRouteM <= maxOffRouteM)
  const excludedOffRoute = snapped.filter((s) => s.offRouteM > maxOffRouteM).map((s) => s.seq)

  const engine = new TriggerEngine(triggerable, trigger)
  const events: TriggerEvent[] = []
  for (const fix of fixes) events.push(...engine.update(fix))

  const eventBySeq = new Map(events.map((e) => [e.seq, e]))
  const stopOutcomes: StopOutcome[] = stops.map((s) => {
    const e = eventBySeq.get(s.seq)
    return {
      seq: s.seq,
      name: s.name,
      stopType: s.stopType,
      fired: Boolean(e),
      fireSec: e?.tSec,
      leadSec: e?.leadSec,
      offRouteM: offRouteBySeq.get(s.seq) ?? Infinity,
      excluded: excludedOffRoute.includes(s.seq),
      durationMs: s.durationMs,
    }
  })

  // Overlap: among AUDIO clips in fire order, does one start before the previous ends?
  const audioFires = events
    .filter((e) => {
      const dur = stops.find((s) => s.seq === e.seq)?.durationMs
      return dur != null && dur > 0
    })
    .sort((a, b) => a.tSec - b.tSec)
  const overlaps: Overlap[] = []
  for (let i = 1; i < audioFires.length; i++) {
    const prev = audioFires[i - 1]!
    const cur = audioFires[i]!
    const prevDurSec = (stops.find((s) => s.seq === prev.seq)!.durationMs ?? 0) / 1000
    const gap = cur.tSec - (prev.tSec + prevDurSec)
    if (gap < 0) overlaps.push({ prevSeq: prev.seq, seq: cur.seq, overlapSec: -gap })
  }

  const driveSec = fixes.length ? fixes[fixes.length - 1]!.tSec : 0
  const audioSec = stops.reduce((sum, s) => sum + (s.durationMs ?? 0) / 1000, 0)
  const cum = cumulativeMeters(polyline)

  return {
    speedMph: opts.mph ?? 60,
    tickHz: opts.tickHz ?? 4,
    driveSec,
    totalRouteM: cum.length ? cum[cum.length - 1]! : 0,
    fixCount: fixes.length,
    trigger,
    events,
    stops: stopOutcomes,
    overlaps,
    neverFired: stopOutcomes.filter((s) => !s.fired && !s.excluded).map((s) => s.seq),
    excludedOffRoute,
    coverageRatio: driveSec > 0 ? audioSec / driveSec : 0,
  }
}
