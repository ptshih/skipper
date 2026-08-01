import { describe, expect, test } from 'bun:test'
import type { Region } from '@skipper/shared'
import {
  EXAMPLE_ANCHORS_PER_REGION,
  pickExampleAnchors,
  type ExampleAnchorPlace,
  type ExampleAnchorRegion,
} from '../src/example-anchors'

// The selection behind `region.exampleAnchors` on GET /regions. Imports ONLY ../src/example-anchors —
// nothing that reaches ./auth, which throws at module load without BETTER_AUTH_SECRET and `bun test`
// runs unwrapped by dotenvx (same constraint planner.test.ts works around).

// "lng_min,lat_min,lng_max,lat_max" — the axis order loadRegionAnchors parses.
const TAHOE = '-120.2,38.8,-119.9,39.3'
const RENO = '-119.9,39.4,-119.6,39.7'

let seq = 0
const place = (name: string, lat: number, lng: number, featured = false): ExampleAnchorPlace => ({
  id: `p${String(seq++).padStart(4, '0')}`,
  name,
  lat,
  lng,
  featured,
})

const region = (id: string, bbox: string | null): ExampleAnchorRegion => ({ id, bbox })

describe('pickExampleAnchors — geometry-first bucketing', () => {
  test('a place inside a region bbox is published for it; one outside is published for nobody', () => {
    const inside = place('Tahoe City', 39.17, -120.14)
    const outside = place('Sacramento', 38.58, -121.49)
    const out = pickExampleAnchors([region('r1', TAHOE)], [inside, outside])
    expect(out.get('r1')).toEqual(['Tahoe City'])
  })

  test('bbox edges are INCLUSIVE — mirrors the between() in loadRegionAnchors', () => {
    // Exactly on latMin and on lngMax: both corners of the box a `between()` would admit.
    const onEdge = place('Corner Cove', 38.8, -119.9)
    const out = pickExampleAnchors([region('r1', TAHOE)], [onEdge])
    expect(out.get('r1')).toEqual(['Corner Cove'])
  })

  test('overlapping bboxes SHARE a place — there is no single-assignment rule', () => {
    const shared = place('Mount Rose', 39.32, -119.88)
    const a = region('a', '-120.2,38.8,-119.8,39.4')
    const b = region('b', '-119.95,39.3,-119.6,39.7')
    const out = pickExampleAnchors([a, b], [shared])
    expect(out.get('a')).toEqual(['Mount Rose'])
    expect(out.get('b')).toEqual(['Mount Rose'])
  })

  test('every region gets an entry, even one with no places in range', () => {
    const out = pickExampleAnchors([region('r1', TAHOE), region('r2', RENO)], [place('Tahoe City', 39.17, -120.14)])
    expect(out.get('r2')).toEqual([])
  })
})

describe('pickExampleAnchors — deterministic order', () => {
  test('featured floats above alphabetically-earlier un-featured names', () => {
    const out = pickExampleAnchors(
      [region('r1', TAHOE)],
      [place('Aaa Bay', 39.1, -120.0), place('Zzz Cove', 39.1, -120.0, true)],
    )
    expect(out.get('r1')).toEqual(['Zzz Cove', 'Aaa Bay'])
  })

  // ⚠ THE MUTATION CHECK. Codepoint puts 'Z' (0x5A) before 'e' (0x65); localeCompare puts 'echo'
  // first. Swapping byRank's name comparator to localeCompare must turn this red — that is the whole
  // point of not using it (see buildRosterBlock: an ICU difference between Cloud Run instances would
  // reshuffle the chips between launches).
  test('name order is CODEPOINT, not locale', () => {
    const out = pickExampleAnchors(
      [region('r1', TAHOE)],
      [place('echo Lake', 39.1, -120.0), place('Zephyr Cove', 39.05, -119.95)],
    )
    expect(out.get('r1')).toEqual(['Zephyr Cove', 'echo Lake'])
  })

  test('output is independent of input row order (a dropped sort survives the tests above)', () => {
    const rows = [
      place('Kings Beach', 39.23, -120.02),
      place('Emerald Bay', 38.95, -120.1, true),
      place('Homewood', 39.08, -120.16),
      place('Incline Village', 39.25, -119.97, true),
      place('Camp Richardson', 38.93, -120.04),
    ]
    const one = pickExampleAnchors([region('r1', TAHOE)], rows)
    const shuffled = pickExampleAnchors([region('r1', TAHOE)], [rows[3]!, rows[0]!, rows[4]!, rows[1]!, rows[2]!])
    const reversed = pickExampleAnchors([region('r1', TAHOE)], [...rows].reverse())
    expect(shuffled.get('r1')).toEqual(one.get('r1')!)
    expect(reversed.get('r1')).toEqual(one.get('r1')!)
    // Pinned literally so a re-order isn't just self-consistently wrong.
    expect(one.get('r1')).toEqual(['Emerald Bay', 'Incline Village', 'Camp Richardson', 'Homewood', 'Kings Beach'])
  })
})

describe('pickExampleAnchors — bounds, hygiene, and the D9 shape', () => {
  test(`caps at EXAMPLE_ANCHORS_PER_REGION (${EXAMPLE_ANCHORS_PER_REGION})`, () => {
    const many = Array.from({ length: 20 }, (_, i) => place(`Stop ${String(i).padStart(2, '0')}`, 39.1, -120.0))
    const out = pickExampleAnchors([region('r1', TAHOE)], many)
    expect(out.get('r1')).toHaveLength(EXAMPLE_ANCHORS_PER_REGION)
  })

  // INV-1 in test form: a future edit that "helpfully" emits `{name, id}` or a "Name (lat, lng)" label
  // would put the billable identity of a curated endpoint on an anonymous route.
  test('emits NAMES ONLY — no ids, no coordinates', () => {
    const rows = [place('Sand Harbor', 39.198, -119.929, true), place('Spooner Summit', 39.106, -119.895)]
    const names = pickExampleAnchors([region('r1', TAHOE)], rows).get('r1')!
    for (const n of names) {
      expect(typeof n).toBe('string')
      for (const r of rows) {
        expect(n).not.toContain(r.id)
        expect(n).not.toContain(String(r.lat))
        expect(n).not.toContain(String(r.lng))
      }
    }
  })

  test('a null or malformed bbox yields [] rather than throwing (a draft region has no extent)', () => {
    const rows = [place('Tahoe City', 39.17, -120.14)]
    const out = pickExampleAnchors(
      [region('none', null), region('garbage', 'not,a,box,here'), region('short', '1,2,3'), region('empty', '')],
      rows,
    )
    expect([...out.values()]).toEqual([[], [], [], []])
  })

  test('names are flattened, blanks dropped, duplicates collapsed', () => {
    const out = pickExampleAnchors(
      [region('r1', TAHOE)],
      [
        place('Tahoe\n  City', 39.17, -120.14),
        place('   ', 39.17, -120.14),
        place('Tahoe City', 39.16, -120.13),
        place('Zephyr Cove', 39.0, -119.94),
      ],
    )
    expect(out.get('r1')).toEqual(['Tahoe City', 'Zephyr Cove'])
  })

  test('empty inputs are not an error', () => {
    expect(pickExampleAnchors([], [place('Tahoe City', 39.17, -120.14)]).size).toBe(0)
    expect(pickExampleAnchors([region('r1', TAHOE)], []).get('r1')).toEqual([])
  })
})

// TYPE-LEVEL PIN — lives here, not in packages/shared/test, because that tsconfig includes only "src"
// so a `satisfies` there is never checked. This is the assertion that GET /regions can never again ship
// a Region without exampleAnchors: `.catch()`'s OUTPUT type is the inner array, so the field is
// REQUIRED on the DTO and the handler's `const payload: Region[]` is a compile error until it projects
// one. That compile error is the feature.
describe('the Region DTO requires exampleAnchors', () => {
  test('a full region literal type-checks', () => {
    const r: Region = {
      id: '3582ed8a-a55e-4fb2-b8af-59dcd9eef16c',
      slug: 'lake-tahoe',
      displayName: 'Lake Tahoe',
      exampleAnchors: ['Tahoe City'],
    }
    expect(r.exampleAnchors).toEqual(['Tahoe City'])
  })

  test('omitting exampleAnchors does NOT type-check', () => {
    // @ts-expect-error — exampleAnchors is required on the wire DTO; this is the tripwire.
    const r: Region = { id: '3582ed8a-a55e-4fb2-b8af-59dcd9eef16c', slug: 'lake-tahoe', displayName: 'Lake Tahoe' }
    expect(r.slug).toBe('lake-tahoe')
  })
})
