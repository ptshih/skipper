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
//   6. DISTANCE-BAND, THEN FORM: when several pins qualify on one fix, only ONE fires. Distance
//      decides first, but in BANDS (bandM wide) rather than to the metre — inside a band the
//      substantive telling wins over a one-breath wave. See pickBest below for why bands, not a
//      strict form ranking.
//
// Stateful, pure, no I/O — feed fixes via update(), exactly like TriggerEngine.

import { angularDiffDeg, bearingDeg, haversineMeters } from './geo'
import { effectiveRadiusM } from './trigger'
import type { GpsFix } from './trigger'

/** What KIND of telling a pin holds. Mirrors the wire's `driveClipForm` (@skipper/shared) rather
 *  than importing it — this package is deliberately dependency-free (see geo.ts) so the sim and RN
 *  can both take it. Only the story-vs-wave distinction matters to selection. */
export type RoamPinForm = 'story' | 'scenic' | 'break' | 'wave'

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
  /** The clip's narration form — used ONLY to break a same-band tie (a story outranks a wave).
   *  Optional: a pin without one counts as substantive, so an older pin never loses a tie. */
  form?: RoamPinForm
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
  /** Width (m) of the distance BAND used to pick among simultaneous candidates. Two pins whose
   *  distances fall in the same band are "about equally close", and form breaks the tie (a story
   *  beats a wave); different bands → the nearer band always wins, whatever the forms. Set to 0 for
   *  strict nearest-first (form never consulted). */
  bandM: number
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
  // 300 m ≈ 11 s at highway speed — inside that, two pins are "the same moment" to a rider, so which
  // one is nearer is noise and WHICH IS WORTH HEARING is the real question. Chosen relative to the
  // 600 m floor (half of it): big enough that a story and a wave at the same viewpoint compete, small
  // enough that a wave you are about to pass still beats a story a quarter-mile off.
  bandM: 300,
}

/** Coarse spatial-grid cell size in degrees (~5.5 km of latitude). A 3×3 neighborhood is a
 *  ~16 km window — comfortably larger than the max effective trigger distance (the 1500 m
 *  areal radius + a speed-adaptive lead), so no in-range pin is ever skipped. */
const GRID_CELL_DEG = 0.05

/** Grid key for a [lat, lng] — coordinates floored to the cell size. */
function cellKey(lat: number, lng: number): string {
  return `${Math.floor(lat / GRID_CELL_DEG)}:${Math.floor(lng / GRID_CELL_DEG)}`
}

/** Selection rank of a form — LOWER wins a same-band tie. Only 'wave' is demoted: it is the
 *  one-breath passing call-out, so at roughly equal distance a real telling is the better use of the
 *  one encounter the governor allows. Everything else (story/scenic/break, and an ABSENT form from an
 *  older pin) ranks equal-and-substantive — we deliberately do NOT invent a total order over forms
 *  the founder never ranked. */
function formRank(form: RoamPinForm | undefined): number {
  return form === 'wave' ? 1 : 0
}

/** Cross-session memory seeded into a fresh RoamEngine at session start. The PERSISTENCE lives in the
 *  app (a JSON file — apps/mobile/src/lib/roam-history.ts); the engine stays pure/no-I/O and is just
 *  born with this snapshot. */
export interface RoamHistorySeed {
  /** poiId → seconds since it last played (wall-clock AGE at session start). Seeded as a NEGATIVE fire
   *  time so update()'s existing session-relative `fix.tSec - firedAt` cooldown keeps counting across
   *  the session boundary — a pin heard on the morning commute stays quiet on the drive home until its
   *  cooldown elapses. */
  firedAgesSec?: Readonly<Record<string, number>>
  /** poiIds the rider muted ("don't tell me this one again") — never fire, this session or ever. */
  mutedPoiIds?: Iterable<string>
}

export class RoamEngine {
  private readonly opts: RoamTriggerOptions
  /** poiId → tSec it fired (cooldown clock). */
  private readonly firedAt = new Map<string, number>()
  /** name → tSec it fired — same cooldown as poiId; guards against two DB rows for the
   *  same physical place (different poiIds, identical name) playing back-to-back. */
  private readonly firedNameAt = new Map<string, number>()
  /** poiIds the rider has muted — never fire. Seeded from cross-session history; extendable at
   *  runtime via mute() (the encounter sheet's "don't tell me this one again"). */
  private readonly muted: Set<string>
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
    history: RoamHistorySeed = {},
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
    // Seed cross-session memory (the app persists it; the engine stays pure). Muted pins never fire;
    // prior fires seed the cooldown as a NEGATIVE tSec (age before session start) so the existing
    // `fix.tSec - firedAt < cooldownSec` check keeps counting the cooldown across the session boundary.
    this.muted = new Set<string>(history.mutedPoiIds)
    if (history.firedAgesSec) {
      const nameByPoi = new Map(this.pins.map((p) => [p.poiId, p.name]))
      for (const [poiId, ageSec] of Object.entries(history.firedAgesSec)) {
        if (!Number.isFinite(ageSec)) continue
        const firedTSec = -Math.max(0, ageSec)
        this.firedAt.set(poiId, firedTSec)
        const name = nameByPoi.get(poiId)
        if (name) {
          // Two poiIds can share a name; keep the most RECENT fire (largest = least-negative tSec).
          const prev = this.firedNameAt.get(name)
          if (prev === undefined || firedTSec > prev) this.firedNameAt.set(name, firedTSec)
        }
      }
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

  /**
   * Does candidate `a` beat the current `b` for this fix's single encounter slot?
   *
   * DISTANCE-BAND, THEN FORM (founder call): distance still decides, but quantized into bandM-wide
   * bands, so "nearer" only wins when it is MEANINGFULLY nearer. Within one band the forms are
   * compared and a wave yields to a substantive telling; ties fall back to true distance so the
   * result is always deterministic.
   *
   * Why not simply rank story over wave outright? Because the corpus is ~3× more waves than stories,
   * and strict form priority would let a story a kilometre away mute the wave you are passing THIS
   * SECOND — the rider hears the wrong place named, which is worse than hearing the smaller one. And
   * why not pure nearest? Because a wave whose un-snapped centroid happens to sit 40 m closer would
   * beat the real telling at the same viewpoint, spending the encounter slot on a one-liner. Bands
   * make "about equally close" an explicit, tunable idea instead of an accident of centroid noise.
   */
  private beats(a: { pin: RoamPinRef; d: number }, b: { pin: RoamPinRef; d: number }): boolean {
    const band = this.opts.bandM
    if (band > 0) {
      const bandA = Math.floor(a.d / band)
      const bandB = Math.floor(b.d / band)
      if (bandA !== bandB) return bandA < bandB
      const rankA = formRank(a.pin.form)
      const rankB = formRank(b.pin.form)
      if (rankA !== rankB) return rankA < rankB
    }
    return a.d < b.d
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
      if (this.muted.has(pin.poiId)) continue // muted ("don't tell me this one again") — never fires
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
      if (!best || this.beats({ pin, d }, best)) best = { pin, d }
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

  /** Mute a pin mid-session — "don't tell me this one again". It won't fire for the rest of this
   *  session; the app persists it (roam-history) so it never fires again. Idempotent. */
  mute(poiId: string): void {
    this.muted.add(poiId)
  }

  get firedCount(): number {
    return this.firedAt.size
  }
}
