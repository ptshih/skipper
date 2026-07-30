// Fused-cluster trigger geometry. The properties here are the ones the radius rule PROMISES, and
// the promise is load-bearing: `buildDrive` drops a candidate whose off-route distance exceeds its
// reach, so "the circle always contains every member" is what keeps an off-road 1-center from
// silently vanishing from a drive.
import { describe, expect, it } from 'bun:test'
import {
  clusterTrigger, ANCHORED_TRIGGER_RADIUS_M, CLUSTER_MAX_TRIGGER_RADIUS_M, exceedsPointTrigger,
  haversineMeters, candidateTriggerRadiusM,
} from '../src'

/** Metres → degrees at Tahoe's latitude, for building fixtures that read in metres. */
const LAT0 = 39.0
const dLat = (m: number) => m / 111_320
const dLng = (m: number) => m / (111_320 * Math.cos((LAT0 * Math.PI) / 180))
const at = (eastM: number, northM: number) => ({ lat: LAT0 + dLat(northM), lng: -120 + dLng(eastM) })
const worst = (t: { lat: number; lng: number }, ms: { lat: number; lng: number }[]) =>
  ms.reduce((w, m) => Math.max(w, haversineMeters([t.lng, t.lat], [m.lng, m.lat])), 0)

describe('clusterTrigger', () => {
  it('returns null for no members — a cluster with nothing tellable has no position', () => {
    expect(clusterTrigger([])).toBeNull()
  })

  it('THE INVARIANT: the radius always encloses every member', () => {
    // This is what lets the point sit off-road safely: a route passing any member is inside the
    // radius by construction, so buildDrive's reachability gate cannot silently drop the stop.
    const cases = [
      [at(0, 0), at(400, 0)],
      [at(0, 0), at(300, 400), at(-500, 100)],
      [at(0, 0), at(900, 0), at(450, 780), at(450, 260), at(100, 50)],
      Array.from({ length: 9 }, (_, i) => at(Math.cos(i) * 350, Math.sin(i * 2) * 350)),
    ]
    for (const members of cases) {
      const t = clusterTrigger(members)!
      expect(t.radiusM).toBeGreaterThanOrEqual(worst(t, members) - 0.5)
      expect(t.radiusM).toBeGreaterThanOrEqual(ANCHORED_TRIGGER_RADIUS_M)
    }
  })

  it('floors at the anchored radius for a tight cluster, and never below it', () => {
    const t = clusterTrigger([at(0, 0), at(30, 0), at(0, 40)])!
    expect(t.radiusM).toBe(ANCHORED_TRIGGER_RADIUS_M)
    expect(t.worstMemberM).toBeLessThan(30)
  })

  it('finds the true 1-center of two points — the midpoint, radius = half the separation', () => {
    // ⚠ tolerances are 2 m because the FIXTURE is approximate (a fixed cos(lat) metres→degrees
    // helper), not because the geometry is. The assertions below are about the ratio, not the metre.
    const members = [at(0, 0), at(800, 0)]
    const t = clusterTrigger(members)!
    const sep = haversineMeters([members[0]!.lng, members[0]!.lat], [members[1]!.lng, members[1]!.lat])
    expect(t.worstMemberM).toBeGreaterThan(sep / 2 - 2)
    expect(t.worstMemberM).toBeLessThan(sep / 2 + 2)
    // A MEDOID would sit on one of the two and measure the FULL separation — the n=2 case where the
    // medoid is structurally exactly twice as bad as the 1-center.
    expect(worst(members[0]!, members)).toBeGreaterThan(t.worstMemberM * 1.99)
  })

  it('beats the centroid when one member is an outlier — the case the measurement was about', () => {
    // Three tight, one far: the centroid is dragged toward the pack, the 1-center is not.
    const members = [at(0, 0), at(20, 0), at(0, 20), at(1000, 0)]
    const t = clusterTrigger(members)!
    const centroid = {
      lat: members.reduce((s, m) => s + m.lat, 0) / members.length,
      lng: members.reduce((s, m) => s + m.lng, 0) / members.length,
    }
    expect(t.worstMemberM).toBeLessThan(worst(centroid, members))
  })

  it('is invariant to member ORDER', () => {
    const members = [at(0, 0), at(300, 400), at(-500, 100), at(120, -240)]
    const a = clusterTrigger(members)!
    const b = clusterTrigger([...members].reverse())!
    expect(a.lat).toBeCloseTo(b.lat, 9)
    expect(a.lng).toBeCloseTo(b.lng, 9)
    expect(a.radiusM).toBe(b.radiusM)
  })

  it('handles collinear members (a strip of buildings along one street)', () => {
    const members = [at(0, 0), at(200, 0), at(400, 0), at(600, 0)]
    const t = clusterTrigger(members)!
    expect(t.worstMemberM).toBeGreaterThan(298) // the widest pair is the diameter
    expect(t.worstMemberM).toBeLessThan(302)
  })

  it('a duplicated member does not move the answer (shared speakable anchors are real)', () => {
    const members = [at(0, 0), at(500, 0)]
    const withDupes = [...members, at(0, 0), at(0, 0)]
    expect(clusterTrigger(withDupes)!.radiusM).toBe(clusterTrigger(members)!.radiusM)
  })

  it('a single member gets the plain anchored radius', () => {
    const t = clusterTrigger([at(0, 0)])!
    expect(t.radiusM).toBe(ANCHORED_TRIGGER_RADIUS_M)
    expect(t.worstMemberM).toBe(0)
  })
})

describe('candidateTriggerRadiusM', () => {
  it('an explicit radius wins — a cluster has no kind to look up', () => {
    expect(candidateTriggerRadiusM({ kind: null, anchored: false, triggerRadiusM: 480 })).toBe(480)
  })

  it('a POI still derives from kind/anchored — the two paths must not drift', () => {
    expect(candidateTriggerRadiusM({ kind: 'lake', anchored: false })).toBe(1200)
    expect(candidateTriggerRadiusM({ kind: 'lake', anchored: true })).toBe(ANCHORED_TRIGGER_RADIUS_M)
    expect(candidateTriggerRadiusM({ kind: null, anchored: false })).toBe(600)
  })
})

describe('exceedsPointTrigger', () => {
  // Simulated, not guessed: the 903 m cluster fires 92 s early at city pace against a 25 s baseline,
  // while Emerald Bay at 516 m fires at 26 s against 12 s on a real route. The line sits between them,
  // on a number that already means something (the floor an un-anchored kindless POI gets).
  it('passes a cluster no looser than the loosest thing already shipping', () => {
    expect(exceedsPointTrigger({ radiusM: ANCHORED_TRIGGER_RADIUS_M })).toBe(false)
    expect(exceedsPointTrigger({ radiusM: 516 })).toBe(false) // Emerald Bay
    expect(exceedsPointTrigger({ radiusM: CLUSTER_MAX_TRIGGER_RADIUS_M })).toBe(false)
  })

  it('rejects a cluster that would fire like a district', () => {
    expect(exceedsPointTrigger({ radiusM: CLUSTER_MAX_TRIGGER_RADIUS_M + 1 })).toBe(true)
    expect(exceedsPointTrigger({ radiusM: 903 })).toBe(true) // the merged UNR campus
  })

  it('a real over-wide cluster is caught end to end', () => {
    // Two members ~1.9 km apart → a ~950 m enclosing circle, the UNR shape.
    const t = clusterTrigger([at(0, 0), at(1900, 0)])!
    expect(t.radiusM).toBeGreaterThan(CLUSTER_MAX_TRIGGER_RADIUS_M)
    expect(exceedsPointTrigger(t)).toBe(true)
  })
})
