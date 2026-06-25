// The trigger core — decides WHEN a tour stop fires as a vehicle approaches.
//
// This is the heart of the M1 bet, and the algorithm the real in-car player will
// reuse on every foreground GPS update (so it lives here, pure + testable, not in
// the React Native app). It encodes the three landmines from CLAUDE.md:
//
//   1. SPEED-ADAPTIVE LEAD, not a fixed geofence. A car sails through a 350 m
//      radius in 13 s at 60 mph but takes 26 s at 30 mph. So the trigger distance
//      is `max(trigger_radius_m floor, speed * leadSeconds)` — a constant ~lead in
//      TIME regardless of speed. trigger_radius_m is a floor, never the rule.
//   2. HEADING GATE above ~5 mph. Only fire when the stop is AHEAD (its bearing is
//      within a forward cone of travel) so a POI the road passes — or one behind
//      you on a there-and-back — doesn't fire. Below ~5 mph heading is unreliable,
//      so the gate is skipped — and likewise when the heading is UNKNOWN (negative:
//      the iOS course -1 sentinel). Both are the same policy: no trustworthy heading
//      → proximity only.
//   2b. PASSED-POINT RETIRE. The heading gate goes dark below ~5 mph and when heading
//      is UNKNOWN — exactly the gaps where a stop you've already driven PAST can still
//      sit inside the radius and fire late ("narrated after I drove past it"). So also
//      track each stop's closest approach and, once it has clearly RECEDED, stop it
//      firing; re-arm only when it's well out of range again (a later there-and-back).
//   3. DEBOUNCE. Each stop fires at most once per drive.
//
// Stateful: feed it fixes in order via update(); it returns any stops that fired on
// that fix. No I/O — the simulator and the player both just call update().

import { angularDiffDeg, bearingDeg, cumulativeMeters, haversineMeters, nearestOnRoute } from './geo'
import type { LngLat } from './geo'

/** One GPS fix from the (simulated or real) location stream. */
export interface GpsFix {
  lat: number
  lng: number
  speedMps: number
  /** Compass heading of travel (0=N, clockwise). NEGATIVE means UNKNOWN (iOS course -1). */
  headingDeg: number
  /** Seconds since the drive started. */
  tSec: number
  /** Along-route distance (m) — for reporting; the trigger logic doesn't need it. */
  alongM: number
}

/** A stop the engine can fire, with its trigger floor and (for audio stops) clip length. */
export interface DriveStopRef {
  seq: number
  lat: number
  lng: number
  /** The proximity floor (m); the effective trigger distance is never smaller than this. */
  triggerRadiusM: number
  /** Clip length (ms) — audio stops only; used downstream to detect overlapping playback. */
  durationMs?: number | null
  name?: string
  stopType?: string
}

export interface TriggerEvent {
  seq: number
  tSec: number
  alongM: number
  /** Straight-line distance to the stop at the moment it fired (m). */
  distanceM: number
  speedMps: number
  /** Seconds of warning before reaching the stop at the current speed (distance / speed). */
  leadSec: number
}

export interface TriggerOptions {
  /** Speed-adaptive lead: effective radius = max(floor, speed * leadSeconds). */
  leadSeconds: number
  /** Below this speed (m/s) the heading gate is skipped (heading is noisy when crawling). */
  headingGateMps: number
  /** A stop only counts as "ahead" when its bearing is within this half-angle of heading. */
  headingConeDeg: number
  /** Once a stop has receded this many metres past its closest approach, treat it as PASSED
   *  (behind us) and stop it firing — covers the heading gate's blind spot (crawling / unknown
   *  heading). Stops are route-snapped, so closest approach is ~on the road and this can be tight. */
  recedeMarginM: number
}

// ~5 mph = 2.235 m/s; lead of 12 s ≈ 322 m at 60 mph, 161 m at 30 mph; a 90° cone is
// the forward hemisphere (fire while the stop is anywhere ahead, not once it's behind).
export const DEFAULT_TRIGGER: TriggerOptions = {
  leadSeconds: 12,
  headingGateMps: 2.2,
  headingConeDeg: 90,
  recedeMarginM: 40,
}

/** The effective trigger distance for a stop at a given speed (m). */
export function effectiveRadiusM(triggerRadiusM: number, speedMps: number, leadSeconds: number): number {
  return Math.max(triggerRadiusM, speedMps * leadSeconds)
}

export class TriggerEngine {
  private readonly fired = new Set<number>()
  /** stop seq → closest approach distance (m) seen while in range — the passed-point retire clock.
   *  Deleted when the stop falls out of range, so a later re-approach re-arms it. */
  private readonly minDistM = new Map<number, number>()
  private readonly opts: TriggerOptions

  constructor(
    private readonly stops: DriveStopRef[],
    opts: Partial<TriggerOptions> = {},
  ) {
    this.opts = { ...DEFAULT_TRIGGER, ...opts }
  }

  /** Feed one fix; returns the stops that fired on it (usually 0 or 1). */
  update(fix: GpsFix): TriggerEvent[] {
    // Defense-in-depth: a malformed fix (non-finite coords/speed) must NEVER fire. Without this,
    // a NaN distance — or a NaN effective radius from a NaN speed — makes `d > radius` read FALSE,
    // so the stop fires; and since every unfired stop shares the one bad fix, the WHOLE tour would
    // dump into the queue at once. The live source sanitizes the iOS -1 SPEED sentinel (gps.ts
    // `saneNonNeg()`), but this engine is the SHARED safety-critical choke point (sim, live drive) and
    // must not trust each source to do so. A malformed fix is useless for triggering anyway → drop it.
    if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lng) || !Number.isFinite(fix.speedMps)) {
      return []
    }
    const here: [number, number] = [fix.lng, fix.lat]
    const events: TriggerEvent[] = []
    for (const stop of this.stops) {
      if (this.fired.has(stop.seq)) continue
      const d = haversineMeters(here, [stop.lng, stop.lat])
      if (d > effectiveRadiusM(stop.triggerRadiusM, fix.speedMps, this.opts.leadSeconds)) {
        this.minDistM.delete(stop.seq) // out of range → forget this approach (re-arm for a later pass)
        continue
      }
      // Passed-point retire: track the closest approach, and once we've clearly RECEDED past it the
      // stop is BEHIND us — don't fire it late. Covers the heading gate's blind spot (it's skipped
      // when crawling or when heading is UNKNOWN), the likely cause of "narrated after I drove past".
      const minSeen = Math.min(this.minDistM.get(stop.seq) ?? Infinity, d)
      this.minDistM.set(stop.seq, minSeen)
      if (d > minSeen + this.opts.recedeMarginM) continue
      // Heading gate — only at meaningful speed AND with a KNOWN heading. iOS reports
      // course -1 when invalid; gating on the sentinel would read it as due-north and
      // silence every other direction (roam's first-live-drive zero-fire, ported here).
      // Unknown heading → proximity only, the same policy as crawling speed.
      if (fix.speedMps >= this.opts.headingGateMps && fix.headingDeg >= 0) {
        const ahead = angularDiffDeg(fix.headingDeg, bearingDeg(here, [stop.lng, stop.lat]))
        if (ahead > this.opts.headingConeDeg) continue // stop is abeam/behind → not approaching
      }
      this.fired.add(stop.seq)
      events.push({
        seq: stop.seq,
        tSec: fix.tSec,
        alongM: fix.alongM,
        distanceM: d,
        speedMps: fix.speedMps,
        leadSec: fix.speedMps > 0 ? d / fix.speedMps : 0,
      })
    }
    return events
  }

  hasFired(seq: number): boolean {
    return this.fired.has(seq)
  }

  get firedCount(): number {
    return this.fired.size
  }
}

/** A stop with its lat/lng moved to its TRIGGER POINT (the POI snapped to the road). */
export interface SnappedStop extends DriveStopRef {
  /** Off-route distance of the POI (m) — how far off the road it actually sits. */
  offRouteM: number
  /** The original POI position, preserved for reference. */
  poiLat: number
  poiLng: number
}

/**
 * Move each stop's trigger location from its POI to the nearest point on the route,
 * so it fires as the vehicle passes the POI's point on the road. This is the
 * preprocessing both the simulator and the real player run once at tour-load
 * (the player has the tour's polyline) before feeding stops to TriggerEngine.
 */
export function snapStopsToRoute(polyline: LngLat[], stops: DriveStopRef[]): SnappedStop[] {
  const cum = cumulativeMeters(polyline)
  return stops.map((s) => {
    const pos = nearestOnRoute(polyline, cum, [s.lng, s.lat])
    return { ...s, lat: pos.lat, lng: pos.lng, poiLat: s.lat, poiLng: s.lng, offRouteM: pos.offRouteM }
  })
}
