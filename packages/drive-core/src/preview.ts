// The preview engine — turn a tour into a TIME-COMPRESSED "simulated drive" the app
// can play from a couch, without GPS or driving to the coordinates.
//
// A real drive is mostly silence: ~30% of the wall-clock is narration, the rest is
// scenery between stops. That silence is right in the car and death on a couch, so
// the preview keeps every clip at full length but COMPRESSES the drive between stops
// into a short visual "zip" (the dot slides along the route; no real-time wait, no
// generated bridge audio). The output is a flat, ordered timeline of segments the UI
// just plays through:
//   clip  — play this stop's audio (full length)
//   rest  — a brief "good spot to stretch" card for a silent break stop
//   drive — animate the dot from the previous stop to this one over a few seconds
//
// Pure + testable (no I/O, no RN). The same trigger core the live player uses lives
// in trigger.ts; this is its couch-bound sibling — the live player is this with the
// segment clock swapped for expo-location. Each stop carries its trigger point
// (persisted on its `segments` row), so the route-progress positions match the real drive.

import { cumulativeMeters, nearestOnRoute } from './geo'
import type { LngLat } from './geo'

/** Fallback average drive speed (m/s ≈ 30 mph) when a tour lacks a frozen drive time. */
const FALLBACK_SPEED_MPS = 13.4

// Intro/outro brackets are the drive's FRAME — placeless audio fired by lifecycle, not by
// a geofence. In a player they reuse the exact stop-clip machinery, keyed by a SENTINEL seq
// (negative, so it can never collide with a real stop seq) instead of a route position. The
// player maps the presigned bracket clip URL under these seqs.
export const INTRO_SEQ = -1
export const OUTRO_SEQ = -2
/** A bracket's sentinel seq → its kind (null for a real stop seq). */
export function bracketKindForSeq(seq: number): 'intro' | 'outro' | null {
  return seq === INTRO_SEQ ? 'intro' : seq === OUTRO_SEQ ? 'outro' : null
}

/** One tour stop, as the preview needs it (a subset of the segment + its variant-0 track,
 *  joined to the segment's pois anchor). */
export interface PreviewStop {
  seq: number
  stopType: 'story' | 'scenic' | 'break'
  name?: string
  /** Trigger point (POI snapped to the route). Use trigger_lat/lng; fall back to the POI. */
  lat: number
  lng: number
  /** Clip length (ms). Null/0 for a break (silent). */
  audioDurationMs?: number | null
}

export type PreviewSegmentKind = 'clip' | 'rest' | 'drive'

export interface PreviewSegment {
  kind: PreviewSegmentKind
  /** The stop this segment belongs to (for `drive`, the stop being driven TO). A bracket
   *  carries a SENTINEL seq (INTRO_SEQ / OUTRO_SEQ). */
  seq: number
  /** Set on a `clip` segment that is an intro/outro bracket (vs a real stop). */
  bracketKind?: 'intro' | 'outro'
  name?: string
  stopType?: PreviewStop['stopType']
  /** Start offset of this segment in the PREVIEW timeline (ms). */
  startMs: number
  /** How long this segment occupies the PREVIEW (ms) — compressed for `drive`. */
  previewMs: number
  /** The real-world duration this segment represents (ms) — for "~6 min" labels. */
  realMs: number
  /** 0..1 position along the route (clip/rest: the stop; drive: where it ENDS). */
  routeProgress: number
  /** `drive` only: where the dot starts (0..1 along the route). */
  fromProgress?: number
  /** `drive` only: along-route distance covered (m), for a "~4 mi" label. */
  distanceM?: number
}

export interface PreviewTimeline {
  segments: PreviewSegment[]
  /** Total play time of the compressed preview (ms). */
  totalPreviewMs: number
  /** Total real-world time the preview represents (ms) — i.e. the actual drive. */
  totalRealMs: number
  /** Number of audio clips (story/scenic) in the preview. */
  clipCount: number
}

export interface PreviewOptions {
  /** Real gap seconds × this = the compressed drive duration. Default 0.012. */
  gapCompression?: number
  /** Floor / ceiling for a compressed between-stop drive (s). Default 1.2 / 4. */
  minGapSec?: number
  maxGapSec?: number
  /** A silent break stop's card duration in the preview (s). Default 2. */
  restSec?: number
  /** Real total drive time (s) for labels/progress. Falls back to a speed estimate. */
  totalDriveSec?: number
  /** Intro bracket (plays FULL length at the very start; null/absent = none). */
  intro?: { audioDurationMs?: number | null } | null
  /** Outro bracket (plays FULL length at the very end; null/absent = none). */
  outro?: { audioDurationMs?: number | null } | null
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

/**
 * Build the compressed preview timeline for a tour. `stops` need not be pre-sorted;
 * they are ordered by seq. `polyline` is the tour's frozen geometry — each stop's
 * trigger point is snapped to it to get an along-route position, so the dot's progress
 * matches where the stop really sits on the drive.
 */
export function buildPreviewTimeline(
  stops: PreviewStop[],
  polyline: LngLat[],
  opts: PreviewOptions = {},
): PreviewTimeline {
  const gapCompression = opts.gapCompression ?? 0.012
  const minGapSec = opts.minGapSec ?? 1.2
  const maxGapSec = opts.maxGapSec ?? 4
  const restSec = opts.restSec ?? 2

  const ordered = [...stops].sort((a, b) => a.seq - b.seq)
  const cum = cumulativeMeters(polyline)
  const totalM = cum.length ? cum[cum.length - 1]! : 0
  const totalDriveSec = opts.totalDriveSec ?? (totalM > 0 ? totalM / FALLBACK_SPEED_MPS : 0)

  // Each stop's along-route distance (m) and 0..1 progress, via its trigger point.
  const along = ordered.map((s) =>
    totalM > 0 ? nearestOnRoute(polyline, cum, [s.lng, s.lat]).alongM : 0,
  )
  const progressOf = (m: number): number => (totalM > 0 ? clamp(m / totalM, 0, 1) : 0)
  const realMsForMeters = (m: number): number =>
    totalM > 0 ? (m / totalM) * totalDriveSec * 1000 : 0

  const segments: PreviewSegment[] = []
  let cursor = 0
  const push = (seg: Omit<PreviewSegment, 'startMs'>): void => {
    segments.push({ ...seg, startMs: cursor })
    cursor += seg.previewMs
  }

  // INTRO bracket — the welcome, played full-length at the very start (route position 0).
  const introMs = opts.intro?.audioDurationMs ?? 0
  if (introMs > 0) {
    push({ kind: 'clip', seq: INTRO_SEQ, bracketKind: 'intro', previewMs: introMs, realMs: introMs, routeProgress: 0 })
  }

  ordered.forEach((s, i) => {
    // DRIVE segment from the previous stop to this one (none before the first stop).
    if (i > 0) {
      const distanceM = Math.max(0, along[i]! - along[i - 1]!)
      const realMs = realMsForMeters(distanceM)
      const previewMs = clamp((realMs / 1000) * gapCompression, minGapSec, maxGapSec) * 1000
      push({
        kind: 'drive',
        seq: s.seq,
        previewMs,
        realMs,
        distanceM,
        fromProgress: progressOf(along[i - 1]!),
        routeProgress: progressOf(along[i]!),
      })
    }
    // The stop itself: a stop with no audio is a brief REST card; everything with
    // audio is a CLIP. A break WITH audio (a named break clip) now plays like any clip.
    const isSilent = !s.audioDurationMs
    if (isSilent) {
      push({
        kind: 'rest',
        seq: s.seq,
        name: s.name,
        stopType: s.stopType,
        previewMs: restSec * 1000,
        realMs: restSec * 1000,
        routeProgress: progressOf(along[i]!),
      })
    } else {
      push({
        kind: 'clip',
        seq: s.seq,
        name: s.name,
        stopType: s.stopType,
        previewMs: s.audioDurationMs!,
        realMs: s.audioDurationMs!,
        routeProgress: progressOf(along[i]!),
      })
    }
  })

  // OUTRO bracket — the sign-off, played full-length at the very end (route position 1).
  const outroMs = opts.outro?.audioDurationMs ?? 0
  if (outroMs > 0) {
    push({ kind: 'clip', seq: OUTRO_SEQ, bracketKind: 'outro', previewMs: outroMs, realMs: outroMs, routeProgress: 1 })
  }

  const totalRealMs = segments.reduce((sum, seg) => sum + seg.realMs, 0)
  return {
    segments,
    totalPreviewMs: cursor,
    totalRealMs,
    clipCount: segments.filter((s) => s.kind === 'clip').length,
  }
}
