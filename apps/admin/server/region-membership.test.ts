/**
 * A place can belong to MORE THAN ONE region.
 *
 * Regions are bboxes, not FKs (CLAUDE.md › geometry-first), and nothing forbids two boxes from
 * overlapping — `lake-tahoe`'s seeded box is the whole Tahoe–Reno corridor, so a future `reno` sits
 * entirely inside it. Founder call, 2026-08-02: membership is genuinely many-to-many.
 *
 * The console assumed the opposite in three places, all via `.find()` — "the FIRST region, rows
 * display-name ordered, whose bbox contains it". That was not a display nit:
 *   • a shared place was counted in one region only, so the other under-reported its own corpus;
 *   • the Region filter HID it from its second region — and a paid run now dispatches the explicit
 *     ids of the filtered rows, so "select all" under that region would have silently omitted it;
 *   • the off-road heuristic marked only the first region as snapped.
 * It also made a region release look broken when it wasn't: release publishes every staged clip in the
 * bbox, which is correct under many-to-many — the operator simply could not SEE the clips the console
 * had filed under someone else.
 *
 * The first test below pins the PREMISE against the shared geometry helper. The rest are source
 * assertions on the three sites, in the same shape as jobs.test.ts: the logic lives inline in a route
 * handler that needs a DB to call, so what is checkable here is that it still says "every", not
 * "first" — which is exactly the regression to catch.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
// The admin re-exports the shared engine helpers under its own long-standing names.
import { parseBbox, pointInBbox } from './bbox'

const src = readFileSync(join(import.meta.dir, 'index.ts'), 'utf8')

describe('the premise: overlapping bboxes really do share places', () => {
  // A wide corridor and a small box inside it — the Tahoe/Reno shape.
  const corridor = parseBbox('-120.25,38.86,-119.55,39.65')
  const inner = parseBbox('-119.90,39.45,-119.70,39.60')

  test('a point inside both boxes is in both — nothing makes them exclusive', () => {
    expect(corridor).not.toBeNull()
    expect(inner).not.toBeNull()
    const lat = 39.53
    const lng = -119.81
    expect(pointInBbox(corridor!, lat, lng)).toBe(true)
    expect(pointInBbox(inner!, lat, lng)).toBe(true)
  })

  test('and a point only in the corridor is in exactly one', () => {
    const lat = 39.0
    const lng = -120.0
    expect(pointInBbox(corridor!, lat, lng)).toBe(true)
    expect(pointInBbox(inner!, lat, lng)).toBe(false)
  })
})

describe('the console attributes to EVERY containing region, not the first', () => {
  test('POI attribution filters, and does not find', () => {
    // `\s*` spans the line break the formatter takes at this width — the assertion is about `.filter`
    // vs `.find`, so it must not also pin where the line happens to wrap.
    expect(src).toMatch(/const regionsForPoi = \(lat: number, lng: number\) =>\s*regionBoxes\.filter\(/)
    // the single-assignment helper must be gone, not merely unused
    expect(src).not.toContain('const regionForPoi =')
  })

  test('the region POI count tallies a place under every region that contains it', () => {
    const from = src.indexOf("app.get('/admin/regions'")
    const route = src.slice(from, src.indexOf('\napp.', from + 10))
    // a nested loop over boxed, not a .find() picking one winner
    // (`boxes` PLURAL since multi-bbox regions — the property asserted is unchanged: every containing
    // region is tallied, rather than one winner being selected)
    expect(route).toMatch(/for \(const \{ slug, boxes \} of boxed\)/)
    expect(route).not.toMatch(/boxed\.find\(/)
    // ⚠ …and ONCE per region even when several of its own boxes contain the point — the predicate is
    // `pointInAnyBbox`, not a per-box tally, so a poi cannot double-count against its own region.
    expect(route).toContain('pointInAnyBbox(boxes, lat, lng)')
  })

  test('the off-road heuristic asks whether ANY containing region has been snapped', () => {
    expect(src).toContain('inRegions.some((r) => snappedRegions.has(r.slug))')
  })

  test('the wire carries arrays, so a client cannot re-collapse it to one', () => {
    expect(src).toContain('regionSlugs: inRegions.map((r) => r.slug)')
    expect(src).toContain('regionNames: inRegions.map((r) => r.name)')
  })
})

describe('the corpus filter matches membership, not equality', () => {
  const corpus = readFileSync(join(import.meta.dir, '..', 'client/src/views/pois/CorpusTab.tsx'), 'utf8')

  test('Region filter uses includes() — otherwise a paid select-all omits shared places', () => {
    expect(corpus).toContain("!p.regionSlugs.includes(region)")
    expect(corpus).not.toContain('p.regionSlug !== region')
  })
})
