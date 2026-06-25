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
import { effectiveRadiusM } from './trigger'
import type { GpsFix } from './trigger'

/** A roam-narratable place — a poi's narration surfaced as a proximity pin. */
export interface RoamPinRef {
  poiId: string
  lat: number
  lng: number
  /** Clip length (ms) — lets the governor hold the NEXT encounter until this one ends. */
  durationMs: number
  /** Per-pin proximity floor (m) — a KIND-aware server hint. Roam pins are raw POI
   *  centroids, never road-snapped (no route to snap to), so areal places need room:
   *  a peak's pin is its summit, a lake's is open water. Falls back to floorM. */
  radiusM?: number
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
  /** Once a pin has receded this many metres past its closest approach, treat it as PASSED
   *  (behind us) and don't start it — the heading gate's blind spot at low speed / unknown
   *  heading. Roomier than a tour stop's: roam pins are un-snapped centroids, so closest
   *  approach is farther out and noisier. */
  recedeMarginM: number
}

export const DEFAULT_ROAM_TRIGGER: RoamTriggerOptions = {
  leadSeconds: 15,
  // 600, not a tour stop's 120/250: roam pins are UN-SNAPPED centroids (the first live
  // drive measured only 8/77 pins within 250 m of the road — the floor was tuned for
  // road-snapped tour stops and silenced the whole basin). "Near here" language in the
  // encounter form tolerates the slack; per-pin radiusM widens areal places further.
  floorM: 600,
  headingGateMps: 2.2,
  headingConeDeg: 120, // generous: a roam miss is invisible, a false pass is bounded by cooldown
  minGapSec: 75,
  cooldownSec: 60 * 60 * 4, // 4h: don't re-tell on the drive home (cross-session memory later)
  suppressRadiusM: 300,
  suppressWindowSec: 15 * 60,
  recedeMarginM: 60,
}

/** Coarse spatial-grid cell size in degrees (~5.5 km of latitude). A 3×3 neighborhood is a
 *  ~16 km window — comfortably larger than the max effective trigger distance (the 1500 m
 *  areal radius + a speed-adaptive lead), so no in-range pin is ever skipped. */
const GRID_CELL_DEG = 0.05

/** Grid key for a [lat, lng] — coordinates floored to the cell size. */
function cellKey(lat: number, lng: number): string {
  return `${Math.floor(lat / GRID_CELL_DEG)}:${Math.floor(lng / GRID_CELL_DEG)}`
}

export class RoamEngine {
  private opts: RoamTriggerOptions
  /** poiId → tSec it fired (cooldown clock). */
  private readonly firedAt = new Map<string, number>()
  /** name → tSec it fired — same cooldown as poiId; guards against two DB rows for the
   *  same physical place (different poiIds, identical name) playing back-to-back. */
  private readonly firedNameAt = new Map<string, number>()
  /** poiId → closest approach distance (m) seen while in range — the passed-point retire clock.
   *  Tracked every fix (even gate-closed) and deleted when the pin falls out of range (re-arm). */
  private readonly minDistM = new Map<string, number>()
  /** When the governor next allows an encounter start (tSec). */
  private gateOpenAtSec = 0
  /** Where + when the LAST encounter fired (cluster suppression anchor; window-bounded). */
  private lastFire: { lat: number; lng: number; tSec: number } | null = null
  /** Coarse spatial index: cell key → the pins in that ~5.5 km cell. Built ONCE so each fix
   *  scans only its cell + 8 neighbors instead of every pin (a region can feed hundreds).
   *  Pins with non-finite coords are kept OUT of the grid and folded into a fallback scan. */
  private readonly grid = new Map<string, RoamPinRef[]>()
  /** Pins without usable coords — never indexable, always candidates (never silently dropped). */
  private readonly ungridded: RoamPinRef[] = []

  constructor(
    private readonly pins: RoamPinRef[],
    opts: Partial<RoamTriggerOptions> = {},
  ) {
    this.opts = { ...DEFAULT_ROAM_TRIGGER, ...opts }
    for (const pin of this.pins) {
      if (!Number.isFinite(pin.lat) || !Number.isFinite(pin.lng)) {
        this.ungridded.push(pin)
        continue
      }
      const key = cellKey(pin.lat, pin.lng)
      const bucket = this.grid.get(key)
      if (bucket) bucket.push(pin)
      else this.grid.set(key, [pin])
    }
  }

  /** Candidate pins for a fix: the fix's cell + its 8 neighbors, plus any ungridded pins.
   *  Falls back to ALL pins if the fix coords are non-finite (caller still drops the fix). */
  private candidatesFor(lat: number, lng: number): RoamPinRef[] {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return this.pins
    const baseLat = Math.floor(lat / GRID_CELL_DEG)
    const baseLng = Math.floor(lng / GRID_CELL_DEG)
    const out: RoamPinRef[] = []
    for (let dLat = -1; dLat <= 1; dLat++) {
      for (let dLng = -1; dLng <= 1; dLng++) {
        const bucket = this.grid.get(`${baseLat + dLat}:${baseLng + dLng}`)
        if (bucket) out.push(...bucket)
      }
    }
    if (this.ungridded.length) out.push(...this.ungridded)
    return out
  }

  /** Feed one fix; returns at most ONE encounter that fires on it. */
  update(fix: GpsFix): RoamTriggerEvent[] {
    // Defense-in-depth, mirroring TriggerEngine's shared choke point: a malformed fix (non-finite
    // coords/speed) must NEVER fire — a NaN distance or NaN effective-radius makes `d > radius` read
    // FALSE and would spuriously fire the nearest pin. Useless for triggering anyway → drop it. (audit #323)
    if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lng) || !Number.isFinite(fix.speedMps)) return []
    const gateOpen = fix.tSec >= this.gateOpenAtSec // governor: a clip is playing / gap not elapsed
    const here: [number, number] = [fix.lng, fix.lat]
    let best: { pin: RoamPinRef; d: number } | null = null
    // Spatial prune: only pins in the fix's cell + 8 neighbors can be in range (the 3×3
    // ~16 km window dwarfs the max effective radius). Trigger semantics are unchanged — the
    // per-pin decision, debounce, and nearest-first below are byte-identical; we only shrink
    // the candidate set. (A pin missing coords lives in `ungridded` and is always included.)
    for (const pin of this.candidatesFor(fix.lat, fix.lng)) {
      const d = haversineMeters(here, [pin.lng, pin.lat])
      const floor = pin.radiusM ?? this.opts.floorM
      if (d > effectiveRadiusM(floor, fix.speedMps, this.opts.leadSeconds)) {
        this.minDistM.delete(pin.poiId) // out of range → forget this approach (re-arm for a later pass)
        continue
      }
      // Track the closest approach on EVERY in-range fix — even while the gate is closed (a clip is
      // playing) — so a pin we drive PAST mid-clip is retired below instead of narrated late when the
      // gate reopens.
      const minSeen = Math.min(this.minDistM.get(pin.poiId) ?? Infinity, d)
      this.minDistM.set(pin.poiId, minSeen)
      if (!gateOpen) continue // tracking done; nothing may START while the governor holds the gate
      const fired = this.firedAt.get(pin.poiId)
      if (fired !== undefined && fix.tSec - fired < this.opts.cooldownSec) continue
      if (pin.name) {
        const nameFired = this.firedNameAt.get(pin.name)
        if (nameFired !== undefined && fix.tSec - nameFired < this.opts.cooldownSec) continue
      }
      // Passed-point retire: once we've clearly RECEDED past this pin's closest approach it's behind
      // us — don't start it late (the "narrated after I drove past" failure the heading gate misses
      // when heading is UNKNOWN or we're crawling).
      if (d > minSeen + this.opts.recedeMarginM) continue
      // Cluster suppression: too close to where the last encounter RECENTLY fired → quiet.
      if (
        this.lastFire &&
        fix.tSec - this.lastFire.tSec < this.opts.suppressWindowSec &&
        haversineMeters([pin.lng, pin.lat], [this.lastFire.lng, this.lastFire.lat]) <
          this.opts.suppressRadiusM
      )
        continue
      // Heading-toward gate — only at meaningful speed AND with a KNOWN heading. iOS
      // reports course -1 when invalid; a negative heading means "unknown", and gating
      // on it would treat the sentinel as due-north and silence every other direction
      // (the first live drive's zero-fire failure). Unknown heading → proximity only.
      if (fix.speedMps >= this.opts.headingGateMps && fix.headingDeg >= 0) {
        const off = angularDiffDeg(fix.headingDeg, bearingDeg(here, [pin.lng, pin.lat]))
        if (off > this.opts.headingConeDeg) continue
      }
      if (!best || d < best.d) best = { pin, d }
    }
    if (!best) return []
    this.firedAt.set(best.pin.poiId, fix.tSec)
    if (best.pin.name) this.firedNameAt.set(best.pin.name, fix.tSec)
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
