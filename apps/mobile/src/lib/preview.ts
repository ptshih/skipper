// The preview engine — turns a tour into a TIME-COMPRESSED "simulated drive" the
// app plays from a couch (no GPS, no driving to the coordinates). Every clip plays
// at full length; the silent drive between stops is compressed into a short visual
// "zip" (the dot slides along the route). Output is a flat, ordered timeline the UI
// walks: clip (play audio) / rest (a brief break-stop card) / drive (animate the dot).
//
// This MIRRORS packages/sim/src/preview.ts (+ the pure geo helpers it needs). It is
// duplicated here because apps/mobile sits OUTSIDE the bun workspace and @skipper/sim
// carries DB deps for its CLI — the same reason the geo helpers are already copied
// between @skipper/generator and @skipper/sim. If a RN-safe shared package is ever
// extracted, dedupe these. The live driving player is this engine with the segment
// clock swapped for expo-location.

export type LngLat = [number, number]

const EARTH_RADIUS_M = 6_371_008.8
const FALLBACK_SPEED_MPS = 13.4 // ~30 mph, when a tour lacks a frozen drive time
const toRad = (deg: number): number => (deg * Math.PI) / 180

function haversineMeters(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(b[0] - a[0])
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)))
}

function cumulativeMeters(polyline: LngLat[]): number[] {
  const out = new Array<number>(polyline.length)
  if (polyline.length === 0) return out
  out[0] = 0
  for (let i = 1; i < polyline.length; i++) out[i] = out[i - 1]! + haversineMeters(polyline[i - 1]!, polyline[i]!)
  return out
}

/** Along-route distance (m) of the route vertex nearest `point`. */
function alongMeters(polyline: LngLat[], cumulative: number[], point: LngLat): number {
  let bestIdx = 0
  let bestDist = Infinity
  for (let i = 0; i < polyline.length; i++) {
    const d = haversineMeters(polyline[i]!, point)
    if (d < bestDist) {
      bestDist = d
      bestIdx = i
    }
  }
  return cumulative[bestIdx] ?? 0
}

export interface PreviewStop {
  seq: number
  stopType: 'story' | 'scenic' | 'break'
  name?: string
  lat: number
  lng: number
  audioDurationMs?: number | null
}

export type PreviewSegmentKind = 'clip' | 'rest' | 'drive'

export interface PreviewSegment {
  kind: PreviewSegmentKind
  seq: number
  name?: string
  stopType?: PreviewStop['stopType']
  startMs: number
  previewMs: number
  realMs: number
  routeProgress: number
  fromProgress?: number
  distanceM?: number
}

export interface PreviewTimeline {
  segments: PreviewSegment[]
  totalPreviewMs: number
  totalRealMs: number
  clipCount: number
}

export interface PreviewOptions {
  gapCompression?: number
  minGapSec?: number
  maxGapSec?: number
  restSec?: number
  totalDriveSec?: number
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

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

  const along = ordered.map((s) => (totalM > 0 ? alongMeters(polyline, cum, [s.lng, s.lat]) : 0))
  const progressOf = (m: number): number => (totalM > 0 ? clamp(m / totalM, 0, 1) : 0)
  const realMsForMeters = (m: number): number => (totalM > 0 ? (m / totalM) * totalDriveSec * 1000 : 0)

  const segments: PreviewSegment[] = []
  let cursor = 0
  const push = (seg: Omit<PreviewSegment, 'startMs'>): void => {
    segments.push({ ...seg, startMs: cursor })
    cursor += seg.previewMs
  }

  ordered.forEach((s, i) => {
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
    const isSilent = s.stopType === 'break' || !s.audioDurationMs
    push(
      isSilent
        ? {
            kind: 'rest',
            seq: s.seq,
            name: s.name,
            stopType: s.stopType,
            previewMs: restSec * 1000,
            realMs: restSec * 1000,
            routeProgress: progressOf(along[i]!),
          }
        : {
            kind: 'clip',
            seq: s.seq,
            name: s.name,
            stopType: s.stopType,
            previewMs: s.audioDurationMs!,
            realMs: s.audioDurationMs!,
            routeProgress: progressOf(along[i]!),
          },
    )
  })

  return {
    segments,
    totalPreviewMs: cursor,
    totalRealMs: segments.reduce((sum, seg) => sum + seg.realMs, 0),
    clipCount: segments.filter((s) => s.kind === 'clip').length,
  }
}
