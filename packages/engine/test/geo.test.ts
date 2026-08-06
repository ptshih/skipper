import { describe, expect, test } from 'bun:test'
import {
  ANCHORED_TRIGGER_RADIUS_M,
  angularDiffDeg,
  parseRegionBbox,
  parseRegionBboxes,
  formatRegionBboxes,
  pointInRegionBbox,
  pointInAnyRegionBbox,
  containingRegionBboxArea,
  REGION_BBOX_SEPARATOR,
  bearingDeg,
  ACCESS_POINT_MAX_M,
  checkAccessPoint,
  checkSpeakableAnchor,
  cumulativeMeters,
  haversineMeters,
  interpolate,
  LOOP_MAX_RETRACE,
  radiusForKind,
  retraceFraction,
  SPEAKABLE_ANCHOR_RADIUS_MULT,
  speakableAnchorMaxM,
  triggerRadiusForKind,
} from '../src/geo'
import type { LngLat } from '../src/geo'

describe('geo', () => {
  test('haversineMeters: ~111 km per degree of latitude', () => {
    const d = haversineMeters([0, 0], [0, 1])
    expect(d).toBeGreaterThan(110_000)
    expect(d).toBeLessThan(112_000)
  })

  test('bearingDeg: cardinal directions', () => {
    expect(bearingDeg([0, 0], [0, 1])).toBeCloseTo(0, 1) // north
    expect(bearingDeg([0, 0], [1, 0])).toBeCloseTo(90, 0) // east
    expect(bearingDeg([0, 0], [0, -1])).toBeCloseTo(180, 1) // south
    expect(bearingDeg([0, 0], [-1, 0])).toBeCloseTo(270, 0) // west
  })

  test('angularDiffDeg wraps around 360', () => {
    expect(angularDiffDeg(10, 350)).toBeCloseTo(20)
    expect(angularDiffDeg(350, 10)).toBeCloseTo(20)
    expect(angularDiffDeg(0, 180)).toBeCloseTo(180)
    expect(angularDiffDeg(90, 90)).toBe(0)
  })

  test('interpolate is clamped and linear at the midpoint', () => {
    expect(interpolate([0, 0], [2, 4], 0.5)).toEqual([1, 2])
    expect(interpolate([0, 0], [2, 4], -1)).toEqual([0, 0])
    expect(interpolate([0, 0], [2, 4], 5)).toEqual([2, 4])
  })

  test('cumulativeMeters is monotonic and starts at 0', () => {
    const line: LngLat[] = [
      [0, 0],
      [0, 0.001],
      [0, 0.002],
    ]
    const cum = cumulativeMeters(line)
    expect(cum[0]).toBe(0)
    expect(cum[1]!).toBeGreaterThan(0)
    expect(cum[2]!).toBeGreaterThan(cum[1]!)
  })
})

describe('radiusForKind vocabulary', () => {
  test('extended landforms get the areal/mountain tier (they used to fall to the 600 m default)', () => {
    expect(radiusForKind('point')).toBe(1200) // peninsula-class
    expect(radiusForKind('cape')).toBe(1200)
    expect(radiusForKind('pass')).toBe(1500) // a high mountain feature
    expect(radiusForKind('waterfall')).toBe(1000)
    expect(radiusForKind('overlook')).toBe(1000)
  })

  test('"viewpoint" is park-tier — the \\bpoint\\b areal pattern must not swallow it', () => {
    expect(radiusForKind('viewpoint')).toBe(1000)
  })

  test('a spring stays compact (a point-source feature, not an areal body)', () => {
    expect(radiusForKind('spring')).toBe(600)
  })

  test('matching is case-insensitive so a capitalized kind never under-triggers', () => {
    expect(radiusForKind('State Park')).toBe(1000)
    expect(radiusForKind('CAPE')).toBe(1200)
    expect(radiusForKind('Mountain')).toBe(1500)
  })
})

describe('triggerRadiusForKind: tight when anchored, kind-floor when not', () => {
  test('an anchored pin gets the tight floor regardless of kind (center is on the road)', () => {
    expect(triggerRadiusForKind('mountain', true)).toBe(ANCHORED_TRIGGER_RADIUS_M)
    expect(triggerRadiusForKind('bay', true)).toBe(ANCHORED_TRIGGER_RADIUS_M)
    expect(triggerRadiusForKind('state park', true)).toBe(ANCHORED_TRIGGER_RADIUS_M)
    expect(triggerRadiusForKind(null, true)).toBe(ANCHORED_TRIGGER_RADIUS_M)
  })

  test('an un-anchored pin keeps the kind-aware floor (a tight radius on an off-road centroid would never fire)', () => {
    expect(triggerRadiusForKind('mountain', false)).toBe(radiusForKind('mountain'))
    expect(triggerRadiusForKind('bay', false)).toBe(radiusForKind('bay'))
    expect(triggerRadiusForKind('spring', false)).toBe(radiusForKind('spring'))
    expect(triggerRadiusForKind(null, false)).toBe(radiusForKind(null))
  })

  test('the tight floor is genuinely tighter than every areal kind floor it replaces', () => {
    expect(ANCHORED_TRIGGER_RADIUS_M).toBeLessThan(radiusForKind('spring')) // < the 600 m default
    expect(ANCHORED_TRIGGER_RADIUS_M).toBeLessThan(radiusForKind('mountain')) // < the 1500 m widest
  })

  test('anchor VALIDITY (speakableAnchorMaxM) is unchanged — it reads the un-conditional radius, not this floor', () => {
    expect(speakableAnchorMaxM('mountain')).toBe(Math.round(SPEAKABLE_ANCHOR_RADIUS_MULT * radiusForKind('mountain')))
  })
})

describe('access point sanity — where a car is sent when the pin is not drivable', () => {
  // Every number below is a measured proposal from the Tahoe routability sweep, not an invented case.
  test('the real corrections all clear the bound, and not narrowly', () => {
    // Hellman-Ehrman Mansion → the Sugar Pine Point park entrance: the closest correction there is.
    const close = checkAccessPoint([-120.11409, 39.05301], [-120.1146, 39.05195])
    expect(close.distanceM).toBeLessThan(200)
    expect(close.ok).toBe(true)

    // Baldwin Beach → its CA-89 turn-off: the FURTHEST real correction, and the one that sets the bound.
    const far = checkAccessPoint([-120.0662, 38.9427], [-120.0646, 38.93471])
    expect(far.distanceM).toBeGreaterThan(850)
    expect(far.ok).toBe(true)
    // Clears by more than 2×. If a future correction ever lands near the ceiling, that is the signal to
    // re-derive the bound from data rather than to nudge it.
    expect(far.distanceM * 2).toBeLessThan(ACCESS_POINT_MAX_M)
  })

  test('an access point on top of the pin is fine — null and zero mean the same thing here', () => {
    const r = checkAccessPoint([-120.1, 39.05], [-120.1, 39.05])
    expect(r.distanceM).toBeCloseTo(0, 5)
    expect(r.ok).toBe(true)
  })

  test('A DIFFERENT PLACE IS REJECTED — the substitution this guard exists for', () => {
    // Spooner Lake's pin with Carson City's coordinates: a plausible-looking "nearest town" correction
    // that would route a rider 13 km from the place they asked for, and bill Routes to do it.
    const r = checkAccessPoint([-119.908998, 39.107603], [-119.767403, 39.163798])
    expect(r.distanceM).toBeGreaterThan(ACCESS_POINT_MAX_M)
    expect(r.ok).toBe(false)
  })

  test('a transposed lat/lng is rejected rather than routed to', () => {
    // The classic typo: [lng,lat] written as [lat,lng] puts Tahoe in the Indian Ocean.
    expect(checkAccessPoint([-120.1, 39.05], [39.05, -120.1]).ok).toBe(false)
  })

  test('the bound is NOT kind-aware, unlike the speakable one', () => {
    // An access point sits OUTSIDE the feature by design — on the nearest public road — so scaling it
    // with the feature's own size would be measuring the wrong thing. The distance to a road is a fact
    // about the road network, not about how big the lake is.
    const near = checkAccessPoint([-120.1, 39.05], [-120.1, 39.051])
    const far = checkAccessPoint([-120.1, 39.05], [-120.1, 39.065])
    expect(near.maxM).toBe(far.maxM)
    expect(near.maxM).toBe(ACCESS_POINT_MAX_M)
    // And it is genuinely a different bound from the speakable one for the same place — a museum's
    // vantage ceiling (900 m) would reject the Baldwin Beach turn-off this guard has to allow.
    expect(ACCESS_POINT_MAX_M).toBeGreaterThan(speakableAnchorMaxM('museum'))
  })
})

describe('speakable anchor sanity', () => {
  test('speakableAnchorMaxM is the kind-aware radius widened to an edge-to-edge ceiling', () => {
    expect(speakableAnchorMaxM('state park')).toBe(Math.round(SPEAKABLE_ANCHOR_RADIUS_MULT * radiusForKind('state park')))
    expect(speakableAnchorMaxM('state park')).toBe(1500) // 1000 × 1.5
    expect(speakableAnchorMaxM('peninsula')).toBe(1800) // 1200 × 1.5
    expect(speakableAnchorMaxM('museum')).toBe(900) //    600 × 1.5
    expect(speakableAnchorMaxM(null)).toBe(900)
  })

  test('an anchor on top of the pin is always fine', () => {
    const r = checkSpeakableAnchor([-120.1, 39.05], [-120.1, 39.05], null)
    expect(r.distanceM).toBeCloseTo(0, 5)
    expect(r.ok).toBe(true)
  })

  test('the Sugar Pine Point case — an 810 m park vantage clears comfortably (not a near-miss)', () => {
    // pin -120.122,39.0575 → lighthouse anchor -120.113971,39.061266 (the one live anchor).
    const r = checkSpeakableAnchor([-120.122, 39.0575], [-120.113971, 39.061266], 'state park')
    expect(r.distanceM).toBeGreaterThan(790)
    expect(r.distanceM).toBeLessThan(830)
    expect(r.maxM).toBe(1500)
    expect(r.ok).toBe(true)
  })

  test('kind-awareness: the SAME distance fails as a default poi but passes as a park', () => {
    // ~1112 m north (0.01° lat): beyond the 900 m default ceiling, inside the 1500 m park ceiling.
    const pin: LngLat = [-120.1, 39.05]
    const anchor: LngLat = [-120.1, 39.06]
    const asDefault = checkSpeakableAnchor(pin, anchor, null)
    expect(asDefault.distanceM).toBeGreaterThan(900)
    expect(asDefault.ok).toBe(false)
    const asPark = checkSpeakableAnchor(pin, anchor, 'state park')
    expect(asPark.distanceM).toBe(asDefault.distanceM)
    expect(asPark.ok).toBe(true)
  })

  test('a km-away anchor is rejected even for the widest kind (the hallucinated-coord case)', () => {
    // 1° north ≈ 111 km — the typo/hallucination this guard exists to catch (peak ceiling = 2250 m).
    const r = checkSpeakableAnchor([-120.1, 39.05], [-120.1, 40.05], 'mountain peak')
    expect(r.distanceM).toBeGreaterThan(110_000)
    expect(r.ok).toBe(false)
  })
})

describe('retraceFraction — how much of a route is driven twice', () => {
  /** A straight west→east line of `km` kilometres at ~39°N, sampled every ~50 m. */
  const line = (km: number): LngLat[] => {
    const degPerKm = 1 / (111.32 * Math.cos((39 * Math.PI) / 180))
    const steps = km * 20
    return Array.from({ length: steps + 1 }, (_, i): LngLat => [-120 + (i / 20) * degPerKm, 39])
  }

  test('a one-way road is never retraced', () => {
    expect(retraceFraction(line(20))).toBe(0)
  })

  test('a road followed by its own reverse is almost entirely retraced', () => {
    // The defining case: an out-and-back. Measured at 98% on the real stitched Tahoe polylines.
    const out = line(20)
    const there = [...out, ...[...out].reverse()]
    expect(retraceFraction(there)).toBeGreaterThan(0.9)
  })

  test('a CLOSED RING does not convict itself for closing', () => {
    // ⚠ The reason RETRACE_MIN_ALONG_M exists. A ring's last point sits on its first; without the
    // along-route gate every honest loop would score as a retrace and the feature would refuse the
    // only shape it is meant to allow.
    const r = 0.15 // ~16 km radius in degrees of latitude
    const ring: LngLat[] = Array.from({ length: 721 }, (_, i): LngLat => {
      const a = (i / 720) * 2 * Math.PI
      return [-120 + r * Math.cos(a) * 1.3, 39 + r * Math.sin(a)]
    })
    expect(retraceFraction(ring)).toBeLessThan(LOOP_MAX_RETRACE)
  })

  test('a ring reached down a shared spur stays under the gate; a there-and-back does not', () => {
    // The shape the threshold is actually chosen for: leave home down one access road, go round, come
    // back up the same access road. That spur IS driven twice and honestly scores — it just must not
    // condemn the ring it serves.
    const spur = line(4)
    const r = 0.15
    const ring: LngLat[] = Array.from({ length: 721 }, (_, i): LngLat => {
      const a = (i / 720) * 2 * Math.PI
      return [spur[spur.length - 1]![0] + r * (Math.cos(a) - 1) * 1.3, 39 + r * Math.sin(a)]
    })
    const withSpur = [...spur, ...ring, ...[...spur].reverse()]
    expect(retraceFraction(withSpur)).toBeLessThan(LOOP_MAX_RETRACE)
  })

  test('the gate separates a real ring from a half-retraced route by a wide margin', () => {
    // Calibration held that a partial retrace scores ~50% — far above the 20% gate, far below a pure
    // there-and-back's 98%. A threshold in that gap is not a knife edge.
    const out = line(20)
    const backAndOn = [...out, ...[...out].reverse(), ...line(20).map(([x, y]): LngLat => [x, y + 0.3])]
    const f = retraceFraction(backAndOn)
    expect(f).toBeGreaterThan(LOOP_MAX_RETRACE)
    expect(f).toBeLessThan(0.9)
  })

  test('a degenerate route has nothing to drive twice', () => {
    expect(retraceFraction([])).toBe(0)
    expect(retraceFraction([[-120, 39]])).toBe(0)
    expect(retraceFraction([[-120, 39], [-120, 39]])).toBe(0)
  })

  test('the verdict is stable across the calibrated proximity band', () => {
    // 35 m and 60 m gave identical verdicts on every real polyline, which is what makes RETRACE_NEAR_M
    // a band rather than a tuned edge — pin that, so a later "tighten it a little" has to argue.
    const out = line(20)
    const there = [...out, ...[...out].reverse()]
    for (const near of [35, 50, 60]) {
      expect(retraceFraction(there, near)).toBeGreaterThan(0.9)
      expect(retraceFraction(line(20), near)).toBe(0)
    }
  })
})

describe('parseRegionBbox / pointInRegionBbox — ONE reader of regions.bbox (1.1 sweep)', () => {
  const TAHOE = '-120.16,38.93,-119.93,39.25'

  test('parses "lng_min,lat_min,lng_max,lat_max" — LONGITUDE first within each corner', () => {
    // The axis order is the thing four independent parsers could have disagreed on, and a region IS a
    // bbox rather than a stored FK — so getting it backwards silently moves places between regions.
    expect(parseRegionBbox(TAHOE)).toEqual({ swLng: -120.16, swLat: 38.93, neLng: -119.93, neLat: 39.25 })
  })

  // ⚠ THE DIVERGENCE THAT ACTUALLY EXISTED: the admin's parser trimmed and the other three did not, so
  // a bbox typed with a space after a comma resolved in the console and matched zero pois everywhere.
  test('tolerates whitespace around each field', () => {
    expect(parseRegionBbox('-120.16, 38.93, -119.93, 39.25')).toEqual(parseRegionBbox(TAHOE))
  })

  test('null for absent or malformed input — never a partial box', () => {
    // Every caller's honest answer to "I cannot read this extent" is "match nothing", not "match all".
    for (const bad of [null, undefined, '', 'not,a,box,here', '1,2,3', '1,2,3,4,5', '1,2,3,NaN']) {
      expect(parseRegionBbox(bad as string | null)).toBeNull()
    }
  })

  test('containment is INCLUSIVE on all four edges', () => {
    // Matches SQL `between` in the API's anchor query — that agreement is what makes the JS helper and
    // the query interchangeable, and it is why two admin screens cannot disagree about one poi.
    const box = parseRegionBbox(TAHOE)!
    expect(pointInRegionBbox(box, 38.93, -120.16)).toBe(true)
    expect(pointInRegionBbox(box, 39.25, -119.93)).toBe(true)
    expect(pointInRegionBbox(box, 39.0, -120.0)).toBe(true)
    expect(pointInRegionBbox(box, 39.26, -120.0)).toBe(false)
    expect(pointInRegionBbox(box, 39.0, -120.17)).toBe(false)
  })
})

describe('multi-bbox regions — a region is SEVERAL boxes when one rectangle cannot say it', () => {
  // The shape that forced this: reno-carson owns the I-80 corner NW of Reno, which is WEST of Reno's
  // own western edge. That set is an L, and widening one rectangle to reach it swallows lake-tahoe.
  const EAST = '-119.85,38.80,-119.45,39.65'
  const CORNER = '-120.40,39.40,-119.85,39.65'
  const BOTH = `${EAST}${REGION_BBOX_SEPARATOR}${CORNER}`

  test('one box parses as a one-element list — every stored value keeps working', () => {
    expect(parseRegionBboxes(EAST)).toEqual([parseRegionBbox(EAST)!])
  })

  test('several boxes parse in order', () => {
    expect(parseRegionBboxes(BOTH)).toEqual([parseRegionBbox(EAST)!, parseRegionBbox(CORNER)!])
  })

  // ⚠ THE SAFETY PROPERTY OF THE WHOLE CHANGE. A caller that was never converted must match NOTHING,
  // not the first box — reading half a region silently is how a release publishes half of one, or a
  // paid sweep bills half of one, with a green run to show for it.
  test('the SINGLE-box reader REFUSES a multi-box value rather than reading the first', () => {
    expect(parseRegionBbox(BOTH)).toBeNull()
    expect(parseRegionBbox(EAST)).not.toBeNull()
  })

  // ⚠ ALL-OR-NOTHING: a partial parse would silently SHRINK a region, which reads as a smaller region
  // rather than as an error — the failure mode this is built to refuse.
  test('one malformed box voids the whole list — never a partial region', () => {
    expect(parseRegionBboxes(`${EAST};garbage`)).toEqual([])
    expect(parseRegionBboxes(`garbage;${EAST}`)).toEqual([])
    expect(parseRegionBboxes(`${EAST};1,2,3`)).toEqual([])
  })

  test('empty segments are forgiving; absent input is empty', () => {
    expect(parseRegionBboxes(`${EAST};`)).toEqual([parseRegionBbox(EAST)!])
    expect(parseRegionBboxes(` ${EAST} ; ${CORNER} `)).toEqual(parseRegionBboxes(BOTH))
    for (const bad of [null, undefined, '', ';', '  ']) {
      expect(parseRegionBboxes(bad as string | null)).toEqual([])
    }
  })

  // ⚠ The round-trip is SEMANTIC, not byte-exact, and that is a property of numbers rather than a
  // defect: `38.80` parses to 38.8 and formats back as "38.8". Same box, shorter string. Worth knowing
  // only because the admin re-saving a region rewrites its stored text — the value moves, the extent
  // does not. Asserting byte-equality here would pin trailing zeros nothing depends on.
  test('round-trips through format (semantically)', () => {
    expect(parseRegionBboxes(formatRegionBboxes(parseRegionBboxes(BOTH)))).toEqual(parseRegionBboxes(BOTH))
    expect(formatRegionBboxes(parseRegionBboxes(BOTH)).split(REGION_BBOX_SEPARATOR)).toHaveLength(2)
    // A one-box region round-trips to a string with no separator at all — the stored form is unchanged
    // for every region that never needed a second box.
    expect(formatRegionBboxes(parseRegionBboxes(EAST))).not.toInclude(REGION_BBOX_SEPARATOR)
  })

  test('containment is ANY box, and the corner is genuinely outside the main one', () => {
    const boxes = parseRegionBboxes(BOTH)
    // Reno itself — in the main box only.
    expect(pointInAnyRegionBbox(boxes, 39.53, -119.81)).toBe(true)
    // Verdi, in the corner: west of the main box's western edge, so ONLY the second box holds it.
    expect(pointInAnyRegionBbox(boxes, 39.509, -120.048)).toBe(true)
    expect(pointInRegionBbox(boxes[0]!, 39.509, -120.048)).toBe(false)
    // Emerald Bay — in neither; it belongs to lake-tahoe.
    expect(pointInAnyRegionBbox(boxes, 38.95, -120.11)).toBe(false)
  })

  // ⚠ SMALLEST CONTAINING BOX, NEVER THE TOTAL — else a region gets "less specific", and loses a
  // label it should win, merely by annexing a far-away corner it also covers.
  test('specificity is the smallest CONTAINING box, not the summed area', () => {
    const big = parseRegionBboxes('-121.0,38.0,-119.0,40.0') // one broad box
    const split = parseRegionBboxes(BOTH)
    // A point in Reno: the east box (0.40 x 0.85) is far smaller than the broad box (2.0 x 2.0),
    // so the split region is MORE specific and must win the tie-break.
    const inReno = { lat: 39.53, lng: -119.81 }
    const a = containingRegionBboxArea(split, inReno.lat, inReno.lng)!
    const b = containingRegionBboxArea(big, inReno.lat, inReno.lng)!
    expect(a).toBeLessThan(b)
    // …and annexing the corner did NOT change that answer, because the corner does not contain Reno.
    expect(containingRegionBboxArea(parseRegionBboxes(EAST), inReno.lat, inReno.lng)).toBe(a)
    expect(containingRegionBboxArea(split, 38.95, -120.11)).toBeNull()
  })
})
