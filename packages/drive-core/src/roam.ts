// The FREE-ROAM trigger core — decides when a roam ENCOUNTER fires on an unplanned drive.
//
// The tour engine (trigger.ts) is route-relative: stops are snapped to a frozen polyline
// and fire as the car passes their point ON the road. Roam has NO route — the rider is on
// their own errand — so this engine works from raw proximity + heading, with the extra
// governors an open-ended ambient session needs (a tour's pacing is baked at generation
// time; roam must pace itself live):
//
//   1. SPEED-ADAPTIVE LEAD (same law as tours): effective radius =
//      max(floor, speed * leadSeconds) — a constant lead in TIME. The floor is higher
//      than a tour stop's (roam pins aren't snapped to the road, so allow for offset).
//   2. HEADING-TOWARD gate above ~5 mph — fire only while the pin is AHEAD. The failure
//      asymmetry is roam's friend: a missed encounter is invisible (the rider never knew
//      the story existed), so gates stay conservative.
//   3. MIN-GAP governor: at most one encounter START per minGapSec — an ambient companion
//      that won't shut up is worse than one that misses things.
//   4. COOLDOWN debounce: a fired pin won't re-fire within cooldownSec (session-scoped;
//      persistent cross-session history is a later layer).
//   5. CLUSTER SUPPRESSION: after a fire, neighbors within suppressRadiusM go quiet for
//      the gap — co-located pins (a bay + its park twin) don't stack the queue.
//   6. NEAREST-FIRST: when several pins qualify on one fix, only the nearest fires.
//
// Stateful, pure, no I/O — feed fixes via update(), exactly like TriggerEngine.

import { angularDiffDeg, bearingDeg, haversineMeters } from './geo'
import type { GpsFix } from './trigger'

/** A roam-narratable place (a roam_clips row joined onto its poi). */
export interface RoamPinRef {
  poiId: string
  lat: number
  lng: number
  /** Clip length (ms) — lets the governor hold the NEXT encounter until this one ends. */
  durationMs: number
  name?: string
}

export interface RoamTriggerEvent {
  poiId: string
  tSec: number
  /** Straight-line distance to the pin when it fired (m). */
  distanceM: number
  speedMps: number
}

export interface RoamTriggerOptions {
  /** Speed-adaptive lead: effective radius = max(floorM, speed * leadSeconds). */
  leadSeconds: number
  /** Proximity floor (m). Roam pins are NOT road-snapped, so this is roomier than a tour stop's. */
  floorM: number
  /** Below this speed (m/s) the heading gate is skipped (parked/crawling still triggers). */
  headingGateMps: number
  /** A pin counts as "ahead" when its bearing is within this half-angle of travel heading. */
  headingConeDeg: number
  /** Governor: minimum seconds between encounter STARTS (also holds while a clip plays). */
  minGapSec: number
  /** A fired pin cannot re-fire within this many seconds (session cooldown). */
  cooldownSec: number
  /** After a fire, other pins within this distance of it are suppressed (queue-stacking
   *  backstop for co-located twins the corpus dedup missed)... */
  suppressRadiusM: number
  /** ...but only for this long — suppression is a WINDOW, not forever (a pin must be able
   *  to fire on a later pass once its own cooldown allows). */
  suppressWindowSec: number
}

export const DEFAULT_ROAM_TRIGGER: RoamTriggerOptions = {
  leadSeconds: 12,
  floorM: 250,
  headingGateMps: 2.2,
  headingConeDeg: 100, // slightly wider than a tour's 90° — no route to disambiguate approach
  minGapSec: 75,
  cooldownSec: 60 * 60 * 4, // 4h: don't re-tell on the drive home (cross-session memory later)
  suppressRadiusM: 300,
  suppressWindowSec: 15 * 60,
}

export class RoamEngine {
  private opts: RoamTriggerOptions
  /** poiId → tSec it fired (cooldown clock). */
  private readonly firedAt = new Map<string, number>()
  /** When the governor next allows an encounter start (tSec). */
  private gateOpenAtSec = 0
  /** Where + when the LAST encounter fired (cluster suppression anchor; window-bounded). */
  private lastFire: { lat: number; lng: number; tSec: number } | null = null

  constructor(
    private readonly pins: RoamPinRef[],
    opts: Partial<RoamTriggerOptions> = {},
  ) {
    this.opts = { ...DEFAULT_ROAM_TRIGGER, ...opts }
  }

  /** Feed one fix; returns at most ONE encounter that fires on it. */
  update(fix: GpsFix): RoamTriggerEvent[] {
    if (fix.tSec < this.gateOpenAtSec) return [] // governor: a clip is playing / gap not elapsed
    const here: [number, number] = [fix.lng, fix.lat]
    let best: { pin: RoamPinRef; d: number } | null = null
    for (const pin of this.pins) {
      const fired = this.firedAt.get(pin.poiId)
      if (fired !== undefined && fix.tSec - fired < this.opts.cooldownSec) continue
      const d = haversineMeters(here, [pin.lng, pin.lat])
      if (d > Math.max(this.opts.floorM, fix.speedMps * this.opts.leadSeconds)) continue
      // Cluster suppression: too close to where the last encounter RECENTLY fired → quiet.
      if (
        this.lastFire &&
        fix.tSec - this.lastFire.tSec < this.opts.suppressWindowSec &&
        haversineMeters([pin.lng, pin.lat], [this.lastFire.lng, this.lastFire.lat]) <
          this.opts.suppressRadiusM
      )
        continue
      // Heading-toward gate (meaningful speed only): the pin must be roughly ahead.
      if (fix.speedMps >= this.opts.headingGateMps) {
        const off = angularDiffDeg(fix.headingDeg, bearingDeg(here, [pin.lng, pin.lat]))
        if (off > this.opts.headingConeDeg) continue
      }
      if (!best || d < best.d) best = { pin, d }
    }
    if (!best) return []
    this.firedAt.set(best.pin.poiId, fix.tSec)
    this.lastFire = { lat: best.pin.lat, lng: best.pin.lng, tSec: fix.tSec }
    // Hold the gate for the clip's length plus the min gap — the next encounter never
    // talks over this one, and the companion gets a breath between stories.
    this.gateOpenAtSec = fix.tSec + best.pin.durationMs / 1000 + this.opts.minGapSec
    return [
      {
        poiId: best.pin.poiId,
        tSec: fix.tSec,
        distanceM: best.d,
        speedMps: fix.speedMps,
      },
    ]
  }

  /**
   * Retune the min-gap governor mid-session — the CHATTINESS knob (a SELECTION control:
   * which/how-many encounters fire, never what a telling says). Fired-pin cooldowns and
   * the open gate are preserved; only the spacing of future encounter starts changes.
   */
  setMinGap(minGapSec: number): void {
    this.opts = { ...this.opts, minGapSec }
  }

  hasFired(poiId: string): boolean {
    return this.firedAt.has(poiId)
  }

  get firedCount(): number {
    return this.firedAt.size
  }
}
