import { describe, expect, test } from 'bun:test'
import { haversineMeters } from '@skipper/engine'
import type { Region } from '@skipper/shared'
import {
  EXAMPLE_ANCHORS_PER_REGION,
  MIN_ANCHOR_SEPARATION_M,
  pickExampleAnchors,
  spreadAnchors,
  type ExampleAnchorPlace,
  type ExampleAnchorRegion,
} from '../src/example-anchors'

// The selection behind `region.exampleAnchors` on GET /regions. Imports ONLY ../src/example-anchors —
// nothing that reaches ./auth, which throws at module load without BETTER_AUTH_SECRET and `bun test`
// runs unwrapped by dotenvx (same constraint planner.test.ts works around).

// "lng_min,lat_min,lng_max,lat_max" — the axis order loadRegionAnchors parses.
const TAHOE = '-120.2,38.8,-119.9,39.3'
const RENO = '-119.9,39.4,-119.6,39.7'
// A deliberately roomy box for the CAP tests. ⚠ They need more than
// `EXAMPLE_ANCHORS_PER_REGION` places that all clear MIN_ANCHOR_SEPARATION_M, and TAHOE is not wide
// enough to hold that many — the old versions of these tests stacked every place on one coordinate,
// which now correctly publishes a single name and made them assert the opposite of the rule.
const WIDE = '-121.0,38.0,-119.0,40.0'
// A lat ladder inside WIDE at ~16.7 km spacing: every pair clears the floor, so the cap is the only
// thing that can bound the result.
const ladder = (n: number): ExampleAnchorPlace[] =>
  Array.from({ length: n }, (_, i) => place(`Stop ${String(i).padStart(2, '0')}`, 38.1 + i * 0.15, -120.0))

let seq = 0
const place = (name: string, lat: number, lng: number, rank: number | null = null): ExampleAnchorPlace => ({
  id: `p${String(seq++).padStart(4, '0')}`,
  name,
  lat,
  lng,
  rank,
})

const region = (id: string, bbox: string | null): ExampleAnchorRegion => ({ id, bbox })

// `pickExampleAnchors` returns BOTH halves per region now (names + ready). The name assertions below
// are unchanged on purpose — they are the ones that pin INV-1, the ordering and the hygiene rules —
// so they read through this projection rather than being rewritten around the new shape. `ready` gets
// its own block at the bottom, where it can be asserted against cases the names cannot express.
const pickNames = (
  regions: readonly ExampleAnchorRegion[],
  places: readonly ExampleAnchorPlace[],
): Map<string, string[]> =>
  new Map([...pickExampleAnchors(regions, places)].map(([id, r]) => [id, r.names]))

describe('pickExampleAnchors — geometry-first bucketing', () => {
  test('a place inside a region bbox is published for it; one outside is published for nobody', () => {
    const inside = place('Tahoe City', 39.17, -120.14)
    const outside = place('Sacramento', 38.58, -121.49)
    const out = pickNames([region('r1', TAHOE)], [inside, outside])
    expect(out.get('r1')).toEqual(['Tahoe City'])
  })

  test('bbox edges are INCLUSIVE — mirrors the between() in loadRegionAnchors', () => {
    // Exactly on latMin and on lngMax: both corners of the box a `between()` would admit.
    const onEdge = place('Corner Cove', 38.8, -119.9)
    const out = pickNames([region('r1', TAHOE)], [onEdge])
    expect(out.get('r1')).toEqual(['Corner Cove'])
  })

  test('overlapping bboxes SHARE a place — there is no single-assignment rule', () => {
    const shared = place('Mount Rose', 39.32, -119.88)
    const a = region('a', '-120.2,38.8,-119.8,39.4')
    const b = region('b', '-119.95,39.3,-119.6,39.7')
    const out = pickNames([a, b], [shared])
    expect(out.get('a')).toEqual(['Mount Rose'])
    expect(out.get('b')).toEqual(['Mount Rose'])
  })

  // ── multi-bbox regions ─────────────────────────────────────────────────────────────────────────
  // The live shape: `reno-carson` is the east box PLUS the detached I-80 corner north-west of Reno.
  // This is an ANONYMOUS per-request path (every app launch hits GET /regions), so it gets its own
  // pins rather than relying on the engine's parser tests alone.
  const RENO_TWO_BOX = '-119.85,38.80,-119.45,39.65;-120.40,39.40,-119.85,39.65'

  test('a place in the DETACHED second box is published for the region', () => {
    const verdi = place('Verdi', 39.509, -120.048) // west of the first box's western edge
    const out = pickNames([region('reno', RENO_TWO_BOX)], [verdi])
    expect(out.get('reno')).toEqual(['Verdi'])
  })

  test('a place in the GAP between the boxes is published for NOBODY', () => {
    // Emerald Bay sits inside the two boxes' HULL but in neither box — it is Tahoe's ground. Publishing
    // it here would put a neighbour's endpoint in this region's allowlist (INV-1).
    const emerald = place('Emerald Bay', 38.95, -120.11)
    const out = pickNames([region('reno', RENO_TWO_BOX)], [emerald])
    expect(out.get('reno')).toEqual([])
  })

  test('both boxes contribute to one region — not just the first', () => {
    const reno = place('Reno', 39.53, -119.81)
    const verdi = place('Verdi', 39.509, -120.048)
    const out = pickNames([region('reno', RENO_TWO_BOX)], [reno, verdi])
    expect(out.get('reno')?.sort()).toEqual(['Reno', 'Verdi'])
  })

  test('a MALFORMED box voids the whole region rather than publishing the readable half', () => {
    // All-or-nothing: a region publishing anchors from half of itself reads as a thin region, not as
    // an error — so nothing is published and `ready` is false.
    const reno = place('Reno', 39.53, -119.81)
    const out = pickExampleAnchors([region('reno', '-119.85,38.80,-119.45,39.65;garbage')], [reno])
    expect(out.get('reno')?.names).toEqual([])
    expect(out.get('reno')?.ready).toBe(false)
  })

  test('every region gets an entry, even one with no places in range', () => {
    const out = pickNames([region('r1', TAHOE), region('r2', RENO)], [place('Tahoe City', 39.17, -120.14)])
    expect(out.get('r2')).toEqual([])
  })
})

// ⚠ NO CODEPOINT MUTATION CHECK LIVES HERE ANY MORE, and its absence is deliberate rather than a
// deletion. The published order stopped being alphabetical on 2026-08-03 (rank gates the pool,
// farthest-point spread orders it), so an alphabetical assertion at THIS level would now be pinning
// something the feature does not promise. `byAnchorRank`'s codepoint guarantee still matters — it is
// what keeps the planner's cached prompt prefix byte-stable across Cloud Run instances — and it is
// pinned where it is actually load-bearing, in planner-roster.test.ts, which asserts against
// localeCompare directly. Do not re-add a copy here; it would go green on a rewrite that broke the
// expensive one.
describe('pickExampleAnchors — rank gates the POOL, geometry orders it', () => {
  test('an unranked name is not published beside a top-ranked one, however it sorts', () => {
    // THE INVERSION, in one assertion. `featured` used to float a row up an otherwise alphabetical
    // list — which is how one curate-places run handed slot 0 to `Carson City` on the strength of C
    // sorting before E, with no curator intending it. It now decides ELIGIBILITY and nothing else.
    const out = pickNames(
      [region('r1', TAHOE)],
      [place('Aaa Bay', 38.85, -120.15), place('Zzz Cove', 39.25, -120.15, 1)],
    )
    expect(out.get('r1')).toEqual(['Zzz Cove'])
  })

  test('with NOTHING featured the whole contained set is eligible', () => {
    // The case ./anchor-format's "featured ORDERS, it never FILTERS" rule was really protecting: a
    // bare .filter(featured) hands the NEXT region curated an empty list and silently kills its
    // example asks. The fallback is what lets `featured` filter safely at all.
    const out = pickNames(
      [region('r1', TAHOE)],
      [place('Aaa Bay', 38.85, -120.15), place('Zzz Cove', 39.25, -120.15)],
    )
    expect(out.get('r1')).toEqual(['Aaa Bay', 'Zzz Cove'])
  })

  test('two places closer than the floor publish as ONE name — the 600 m regression', () => {
    // THE LITERAL BUG, with the real coordinates. These two were slots 0 and 1 of the live Tahoe
    // region, so the cold open's A→B chip read "Eagle Falls to Emerald Bay State Park, the scenic
    // way" — a six-hundred-metre drive, offered on the app's highest-intent tap. Publishing one name
    // costs a chip; publishing both cost the rider's trust in the first thing the skipper says.
    const out = pickNames(
      [region('r1', TAHOE)],
      [
        place('Eagle Falls', 38.9505207, -120.1151632, 1),
        place('Emerald Bay State Park', 38.9499894, -120.1082038, 1),
      ],
    )
    expect(out.get('r1')).toEqual(['Eagle Falls'])
  })

  test('output is independent of input row order', () => {
    const rows = [
      place('Kings Beach', 39.23, -120.02, 1),
      place('Emerald Bay', 38.85, -120.1, 1),
      place('Homewood', 39.08, -120.18, 1),
      place('Incline Village', 39.25, -119.95, 1),
      place('Camp Richardson', 38.93, -119.93, 1),
    ]
    const one = pickNames([region('r1', TAHOE)], rows)
    const shuffled = pickNames([region('r1', TAHOE)], [rows[3]!, rows[0]!, rows[4]!, rows[1]!, rows[2]!])
    const reversed = pickNames([region('r1', TAHOE)], [...rows].reverse())
    expect(shuffled.get('r1')).toEqual(one.get('r1')!)
    expect(reversed.get('r1')).toEqual(one.get('r1')!)
    // Pinned literally so a re-order isn't merely self-consistently wrong. Two things to read here:
    // the head is the WIDEST PAIR in the set (the seed rule) rather than the alphabetical head, which
    // would be Camp Richardson — and FIVE rows in, FOUR come out. `Kings Beach` is dropped because it
    // sits 6.4 km from `Incline Village`, under the floor. That is the whole feature in one
    // assertion: a fifth chip was available and publishing it would have offered a rider a six-
    // kilometre "drive", so it was not published.
    expect(one.get('r1')).toEqual(['Emerald Bay', 'Incline Village', 'Homewood', 'Camp Richardson'])
  })
})

describe('spreadAnchors — the separation guarantee the client leans on', () => {
  const at = (lat: number, lng: number, name = `${lat},${lng}`) => ({ lat, lng, name })

  test('the floor holds for EVERY pair, not just adjacent ones', () => {
    // The property that makes blind client-side pairing safe. The client is given no coordinates
    // (INV-1), so it cannot check this — if the guarantee were only about neighbours, rotating the
    // window would eventually put two near-neighbours in the A→B slots and nothing would notice.
    const grid = []
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) grid.push(at(38.5 + i * 0.05, -120.5 + j * 0.05))
    const picked = spreadAnchors(grid, 8, MIN_ANCHOR_SEPARATION_M)
    expect(picked.length).toBeGreaterThan(1)
    for (let i = 0; i < picked.length; i++)
      for (let j = i + 1; j < picked.length; j++)
        expect(
          haversineMeters([picked[i]!.lng, picked[i]!.lat], [picked[j]!.lng, picked[j]!.lat]),
        ).toBeGreaterThanOrEqual(MIN_ANCHOR_SEPARATION_M)
  })

  test('it returns FEWER names rather than worse ones', () => {
    // Degrading by count is what the client already handles (≥2 names → all three asks, 1 → the loop
    // and the open one). Degrading by quality would be invisible.
    const tight = [at(39.0, -120.0, 'A'), at(39.001, -120.001, 'B'), at(39.002, -120.002, 'C')]
    expect(spreadAnchors(tight, 8, MIN_ANCHOR_SEPARATION_M)).toHaveLength(1)
  })

  test('an empty pool and a k of zero are not errors', () => {
    expect(spreadAnchors([], 8, MIN_ANCHOR_SEPARATION_M)).toEqual([])
    expect(spreadAnchors([at(39, -120)], 0, MIN_ANCHOR_SEPARATION_M)).toEqual([])
  })
})

describe('pickExampleAnchors — bounds, hygiene, and the D9 shape', () => {
  test(`caps at EXAMPLE_ANCHORS_PER_REGION (${EXAMPLE_ANCHORS_PER_REGION})`, () => {
    const out = pickNames([region('r1', WIDE)], ladder(20))
    expect(out.get('r1')).toHaveLength(EXAMPLE_ANCHORS_PER_REGION)
  })

  // INV-1 in test form: a future edit that "helpfully" emits `{name, id}` or a "Name (lat, lng)" label
  // would put the billable identity of a curated endpoint on an anonymous route.
  test('emits NAMES ONLY — no ids, no coordinates', () => {
    // BOTH featured, and ~10 km apart, so two names actually publish — with only one eligible row
    // this test would still pass while checking half as much.
    const rows = [
      place('Sand Harbor', 39.198, -119.929, 1),
      place('Spooner Summit', 39.106, -119.895, 1),
    ]
    const names = pickNames([region('r1', TAHOE)], rows).get('r1')!
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
    const out = pickNames(
      [region('none', null), region('garbage', 'not,a,box,here'), region('short', '1,2,3'), region('empty', '')],
      rows,
    )
    expect([...out.values()]).toEqual([[], [], [], []])
  })

  test('names are flattened, blanks dropped, duplicates collapsed', () => {
    const out = pickNames(
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

  test('ready is TRUE for a region holding a curated endpoint whose NAME never publishes', () => {
    // The case that makes `ready` worth a field: one contained place, blank name, so nothing to show.
    // The region is perfectly drivable and its composer must stay. Deriving readiness from the
    // published names would hide it over a cosmetic defect.
    const out = pickExampleAnchors([region('r1', TAHOE)], [place('   ', 39.17, -120.14)])
    expect(out.get('r1')).toEqual({ names: [], ready: true })
  })

  test('ready is FALSE only when nothing curated falls inside the bbox', () => {
    const out = pickExampleAnchors(
      [region('r1', TAHOE), region('r2', RENO)],
      [place('Tahoe City', 39.17, -120.14)],
    )
    expect(out.get('r1')?.ready).toBe(true)
    expect(out.get('r2')?.ready).toBe(false)
  })

  test('a region with no usable extent is NOT ready — it cannot be planned', () => {
    // Distinct from the degraded read on the client: here we know the region and know it has no box,
    // so false is a fact rather than an assumption. (The DTO fails OPEN; the server fails closed.)
    const rows = [place('Tahoe City', 39.17, -120.14)]
    const out = pickExampleAnchors([region('none', null), region('garbage', 'not,a,box,here')], rows)
    expect(out.get('none')?.ready).toBe(false)
    expect(out.get('garbage')?.ready).toBe(false)
  })

  test('ready survives the display cap — it is not names.length in disguise', () => {
    const got = pickExampleAnchors([region('r1', WIDE)], ladder(EXAMPLE_ANCHORS_PER_REGION + 5)).get('r1')!
    expect(got.names).toHaveLength(EXAMPLE_ANCHORS_PER_REGION)
    expect(got.ready).toBe(true)
  })

  test('ready survives the SEPARATION floor too — a tight region is still drivable', () => {
    // The floor's own version of the rule above, and the case a new gate is blindest to: a region
    // whose curated endpoints are all within a few hundred metres publishes ONE name, which is not a
    // reason to hide its composer. `ready` comes from containment, upstream of every name filter.
    const got = pickExampleAnchors(
      [region('r1', TAHOE)],
      [place('Eagle Falls', 38.9505, -120.1152, 1), place('Emerald Bay', 38.95, -120.1082, 1)],
    ).get('r1')!
    expect(got.names).toHaveLength(1)
    expect(got.ready).toBe(true)
  })

  test('empty inputs are not an error', () => {
    expect(pickNames([], [place('Tahoe City', 39.17, -120.14)]).size).toBe(0)
    expect(pickNames([region('r1', TAHOE)], []).get('r1')).toEqual([])
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
      ready: true,
      examples: [],
      exampleNames: [],
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
