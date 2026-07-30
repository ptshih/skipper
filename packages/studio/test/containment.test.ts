import { describe, expect, test } from 'bun:test'
import { containmentReason, isContainer, isSettlement } from '../src/pipeline/containment'

describe('isContainer', () => {
  // The case that motivated the TYPE signal: no area claim, so area alone missed it entirely.
  test('catches Carson Range by TYPE and by LENGTH, though it claims no area', () => {
    expect(isContainer({ types: ['mountain range'], lengthKm: 84, areaKm2: null })).toBe(true)
    expect(isContainer({ types: ['mountain range'] })).toBe(true) // type alone suffices
    expect(isContainer({ lengthKm: 84 })).toBe(true) // length alone suffices
  })

  // The case that must NOT be caught. Same local `kind` as Sierra Nevada, similar article length.
  test('does NOT catch Half Dome', () => {
    expect(isContainer({ types: ['granite dome', 'mountain', 'climbing area'] })).toBe(false)
  })

  // Size-independence is the whole point of the type signal — 16 km and no area claim.
  test('catches a SMALL mountain range that neither area nor length would', () => {
    expect(isContainer({ types: ['mountain range'], lengthKm: 16.1, areaKm2: null })).toBe(true)
  })

  test('catches big areal containers', () => {
    expect(isContainer({ areaKm2: 3079, types: ['national park'] })).toBe(true)
    expect(isContainer({ areaKm2: 259, types: ['us wilderness area'] })).toBe(true)
    expect(isContainer({ areaKm2: 502 })).toBe(true) // Lake Tahoe: area only
  })

  // Settlements are the things a DISTRICT is named after — barring them would break the best subjects.
  test('leaves settlements alone', () => {
    expect(isContainer({ areaKm2: 87, types: ['city'] })).toBe(false) // Truckee
    expect(isContainer({ areaKm2: 43, types: ['census-designated place in the united states'] })).toBe(false)
    expect(isContainer({ areaKm2: 16, types: ['unincorporated community'] })).toBe(false) // Wawona
  })

  // Substring matching on 'national park' would have swallowed these, and they are good stops.
  test('does not catch NPS facilities whose type merely MENTIONS a container', () => {
    expect(isContainer({ types: ['national park service visitor center'] })).toBe(false)
    expect(isContainer({ types: ['ranger station'] })).toBe(false)
  })

  // Authoritative replacement for the route-number name pattern — and it catches the one the regex missed.
  test('catches roads by type, including ones with no route number in the name', () => {
    expect(isContainer({ types: ['road'], lengthKm: 25.3 })).toBe(true) // Glacier Point Road
    expect(isContainer({ types: ['road'], lengthKm: 12.7 })).toBe(true) // short state route, by type
  })

  // A trail is linear but a SHORT one is a fine subject — Mist Trail anchors a real Yosemite cluster.
  test('leaves a short trail alone', () => {
    expect(isContainer({ types: ['hiking trail'], lengthKm: 13.7 })).toBe(false)
  })

  // An un-backfilled poi must answer false: a stop wrongly kept is visible, one wrongly deleted is silent.
  test('answers false when nothing is known', () => {
    expect(isContainer({})).toBe(false)
    expect(isContainer({ areaKm2: null, lengthKm: null, types: null })).toBe(false)
  })

  test('reports WHY, so an operator sees evidence rather than a verdict', () => {
    expect(containmentReason({ types: ['mountain range'] })).toContain('mountain range')
    expect(containmentReason({ areaKm2: 3079 })).toContain('km²')
    expect(containmentReason({ lengthKm: 84 })).toContain('km long')
    expect(containmentReason({})).toBeNull()
  })
})

describe('isContainer — false positives found by preview', () => {
  // Wikidata types trailheads as `protected area`. A trailhead is a POINT stop, and Eagle Falls
  // trailhead is a member of the Emerald Bay cluster — excluding it would have broken a real grouping.
  test('a trailhead typed `protected area` is NOT a container', () => {
    expect(isContainer({ types: ['protected area'] })).toBe(false)
  })
  // …while a genuinely large protected area is still caught, by extent.
  test('a large protected area is still caught by its AREA', () => {
    expect(isContainer({ types: ['protected area'], areaKm2: 259 })).toBe(true)
  })
})

describe('isSettlement overrides containment', () => {
  // 407 km², so extent alone prunes it — and that would delete the natural SUBJECT of the
  // "Historic Carson City" district along with the fact sheet that district is grounded on.
  test('a large city is a DISTRICT, not a container', () => {
    expect(isContainer({ areaKm2: 407, types: ['independent city in the united states', 'state or insular area capital of the united states'] })).toBe(false)
    expect(isContainer({ areaKm2: 87, types: ['town in california'] })).toBe(false)
    expect(isContainer({ areaKm2: 43, types: ['city of california'] })).toBe(false)
    expect(isContainer({ types: ['census-designated place in the united states'] })).toBe(false)
    expect(isContainer({ types: ['unincorporated town in nevada', 'unincorporated community'] })).toBe(false)
  })
  // The override must not become a loophole: a range is still a range.
  test('does not rescue a genuine container', () => {
    expect(isContainer({ types: ['mountain range'], lengthKm: 84 })).toBe(true)
    expect(isContainer({ types: ['us wilderness area'], areaKm2: 259 })).toBe(true)
  })
})

// Exercised directly too, so the exported predicate has its own contract test.
test('isSettlement', () => {
  expect(isSettlement(['town in california'])).toBe(true)
  expect(isSettlement(['mountain range'])).toBe(false)
  expect(isSettlement(null)).toBe(false)
})
