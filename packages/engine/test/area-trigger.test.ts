// The AREA branch inside the two trigger engines. The geometry is covered in area.test.ts; these
// guard the BEHAVIOUR — which is where the design decisions live, and where a naive port of the
// point loop would silently break a district clip mid-district.
import { describe, expect, it } from 'bun:test'
import { TriggerEngine, DEFAULT_TRIGGER, type GpsFix, type DriveStopRef } from '../src/trigger'
import { RoamEngine, type RoamPinRef } from '../src/roam'
import { convexHull } from '../src/area'
import type { LngLat } from '../src/geo'

const LAT0 = 39.53
const dLat = (m: number) => m / 111_132
const dLng = (m: number) => m / (111_320 * Math.cos((LAT0 * Math.PI) / 180))
const at = (eastM: number, northM: number): LngLat => [-119.81 + dLng(eastM), LAT0 + dLat(northM)]

/** A ~1 km square district. */
const RING = convexHull([at(0, 0), at(1000, 0), at(1000, 1000), at(0, 1000)])
const AREA = { ring: RING, marginM: 25 }

const fix = (p: LngLat, tSec: number, speedMps = 13): GpsFix => ({
  lat: p[1], lng: p[0], tSec, speedMps, headingDeg: 90, alongM: tSec * speedMps,
})

const areaStop = (seq = 0): DriveStopRef => ({
  seq, lat: at(500, 500)[1], lng: at(500, 500)[0], triggerRadiusM: 250, area: AREA, durationMs: 120_000,
})

describe('TriggerEngine — area stops', () => {
  it('does not fire outside, however long you sit there', () => {
    const e = new TriggerEngine([areaStop()])
    let fired = 0
    for (let t = 0; t < 60; t++) fired += e.update(fix(at(-500, 500), t)).length
    expect(fired).toBe(0)
  })

  it('fires IMMEDIATELY when confidently deep inside — depth is proof, not noise', () => {
    const e = new TriggerEngine([areaStop()])
    const events: number[] = []
    for (let t = 0; t < 60; t++) for (const ev of e.update(fix(at(500, 500), t))) events.push(ev.tSec)
    expect(events).toEqual([0]) // 500 m deep: no dwell, and only once
  })

  it('serves the entry dwell when only just inside — that is where GPS error lives', () => {
    const e = new TriggerEngine([areaStop()])
    const events: number[] = []
    // 20 m inside the west edge, well under AREA_CONFIDENT_DEPTH_M.
    for (let t = 0; t < 30; t++) for (const ev of e.update(fix(at(20, 500), t))) events.push(ev.tSec)
    expect(events).toEqual([DEFAULT_TRIGGER.enterDwellSec])
  })

  it('THE REGRESSION THAT MATTERS: it does not retire mid-district', () => {
    // Distance to the centre runs 900 → 0 → 900 crossing a district, so the point loop's
    // passed-point retire would drop the stop ~40 m past the nadir — while the rider is still
    // deep inside downtown. Drive all the way across and confirm it fires on the way IN.
    const e = new TriggerEngine([areaStop()])
    const events: number[] = []
    for (let t = 0; t <= 100; t++) {
      const east = -200 + t * 14 // enters ~t=15, exits ~t=86
      for (const ev of e.update(fix(at(east, 500), t))) events.push(ev.tSec)
    }
    expect(events).toHaveLength(1)
    expect(events[0]!).toBeLessThan(40) // fired shortly after entering, not at the far side
  })

  it('a single stray fix NEAR THE BOUNDARY does not fire it — the noise case the dwell is for', () => {
    const e = new TriggerEngine([areaStop()])
    let fired = 0
    fired += e.update(fix(at(10, 500), 0)).length // one blip 10 m inside the edge = plausible GPS error
    for (let t = 1; t < 30; t++) fired += e.update(fix(at(-800, 500), t)).length // back outside
    expect(fired).toBe(0)
  })

  it('leaving and re-entering re-arms the dwell rather than firing instantly', () => {
    const e = new TriggerEngine([areaStop()])
    e.update(fix(at(20, 500), 0)) // just inside, dwell starts
    e.update(fix(at(-900, 500), 1)) // out — clears insideSince
    const ev = e.update(fix(at(20, 500), 2)) // back in shallow: dwell restarts, must not fire
    expect(ev).toHaveLength(0)
  })

  it('ignores heading — you cannot be "approaching" a place you are standing in', () => {
    const e = new TriggerEngine([areaStop()])
    const events: number[] = []
    // heading 270° (due west) while the centre is behind: a point stop would be gated out.
    for (let t = 0; t < 30; t++) {
      const f = { ...fix(at(500, 500), t), headingDeg: 270 }
      for (const ev of e.update(f)) events.push(ev.tSec)
    }
    expect(events).toHaveLength(1)
  })

  it('reports depth, not a bogus lead', () => {
    const e = new TriggerEngine([areaStop()])
    let ev: { distanceM: number; leadSec: number } | undefined
    for (let t = 0; t < 30 && !ev; t++) ev = e.update(fix(at(500, 500), t))[0]
    expect(ev!.distanceM).toBeLessThan(0) // negative = inside
    expect(ev!.leadSec).toBe(0)
  })
})

describe('RoamEngine — area pins and the overlap ordering', () => {
  const pin = (poiId: string, ring: LngLat[], centre: LngLat): RoamPinRef => ({
    poiId, lat: centre[1], lng: centre[0], durationMs: 60_000, area: { ring, marginM: 25 }, name: poiId,
  })

  it('fires an area pin on containment', () => {
    const e = new RoamEngine([pin('district', RING, at(500, 500))])
    const events: string[] = []
    for (let t = 0; t < 40; t++) for (const ev of e.update(fix(at(500, 500), t))) events.push(ev.poiId)
    expect(events).toEqual(['district'])
  })

  it('INSIDE beats NEAR — an area you are in outranks a point you are merely close to', () => {
    // The point sits 5 m away; nearest-first would always pick it. Containment is a fact, proximity
    // is a lead, so the area must win.
    const e = new RoamEngine([
      pin('district', RING, at(500, 500)),
      { poiId: 'point', lat: at(505, 500)[1], lng: at(505, 500)[0], durationMs: 30_000, radiusM: 250, name: 'point' },
    ])
    const events: string[] = []
    for (let t = 0; t < 20; t++) for (const ev of e.update(fix(at(500, 500), t))) events.push(ev.poiId)
    expect(events[0]).toBe('district')
  })

  it('SMALLEST wins among overlapping areas — the measured Carson City case', () => {
    // Two real districts 646 m apart with members 73 m apart: a rider is genuinely inside both, and
    // the centre distances are noise. The tight historic core is the better telling.
    const big = convexHull([at(0, 0), at(1000, 0), at(1000, 1000), at(0, 1000)])
    const small = convexHull([at(300, 300), at(700, 300), at(700, 700), at(300, 700)])
    const e = new RoamEngine([pin('capital', big, at(500, 500)), pin('core', small, at(500, 500))])
    const events: string[] = []
    for (let t = 0; t < 20; t++) for (const ev of e.update(fix(at(500, 500), t))) events.push(ev.poiId)
    expect(events[0]).toBe('core')
  })

  it('a point pin still wins when no area contains you — nothing regressed', () => {
    const e = new RoamEngine([
      pin('district', RING, at(500, 500)),
      { poiId: 'point', lat: at(2000, 500)[1], lng: at(2000, 500)[0], durationMs: 30_000, radiusM: 300, name: 'point' },
    ])
    const events: string[] = []
    for (let t = 0; t < 20; t++) for (const ev of e.update(fix(at(2000, 500), t))) events.push(ev.poiId)
    expect(events[0]).toBe('point')
  })
})
