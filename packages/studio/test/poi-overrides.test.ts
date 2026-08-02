// The override AGGREGATION contract — `aggregateOverrideRows` is labelled "exported for tests" and
// had none: every existing test reached it through `setPoiOverridesForTest` with a single ACTIVE row,
// so the half of the contract that only a RETIRED row exercises was never run. That half is the
// subtle one: a retired row must contribute NO edit and STILL stamp freshness, because the retirement
// itself is what busts caches that adopted the now-withdrawn correction. Get it backwards in either
// direction and nothing fails — the withdrawn text keeps being applied, or the withdrawal never
// invalidates anything — which is exactly the shape of bug that stays live for weeks.

import { afterEach, expect, test } from 'bun:test'
import {
  aggregateOverrideRows,
  applyFactEditsChecked,
  clearPoiOverridesForTest,
  poiOverrideFor,
  setPoiOverridesForTest,
  type OverrideRowLike,
} from '../src/pipeline/poi-overrides'

// The cache is module-level and this file writes it via the test seam — leaving it loaded would
// silently change what a later test file's fetch path applies.
afterEach(() => clearPoiOverridesForTest())

const row = (over: Partial<OverrideRowLike> = {}): OverrideRowLike => ({
  source: 'wikipedia',
  sourceId: '4242',
  name: 'Stub Place',
  find: 'the wrong architect',
  replace: 'the right architect',
  reason: 'upstream error',
  sourceUrl: 'https://example.com',
  updatedAt: new Date('2026-06-09T00:00:00Z'),
  ...over,
})

const only = (rows: OverrideRowLike[]) => aggregateOverrideRows(rows).get('wikipedia:4242')

test('an ACTIVE row contributes its edit and stamps freshness', () => {
  const p = only([row()])
  expect(p?.factEdits).toEqual([
    {
      find: 'the wrong architect',
      replace: 'the right architect',
      reason: 'upstream error',
      sourceUrl: 'https://example.com',
    },
  ])
  expect(p?.latestOverrideAt).toEqual(new Date('2026-06-09T00:00:00Z'))
})

test('an omitted `active` is ACTIVE — seed and test rows predate the column', () => {
  expect(only([row({ active: undefined })])?.factEdits).toHaveLength(1)
  expect(only([row({ active: null })])?.factEdits).toHaveLength(1)
})

test('a RETIRED row contributes no edit but STILL stamps — the retirement is the cache-bust', () => {
  const p = only([row({ active: false })])
  expect(p?.factEdits).toEqual([])
  expect(p?.latestOverrideAt).toEqual(new Date('2026-06-09T00:00:00Z'))
})

test('retiring the newest correction still moves the stamp forward', () => {
  // The live sequence: an old correction is applied, then a newer row retires it. If the retired row
  // were skipped wholesale, the stamp would fall back to the OLD row's date and every cache that
  // re-fetched between the two would keep serving the withdrawn correction as fresh.
  const p = only([
    row({ find: 'old', replace: 'new', updatedAt: new Date('2026-06-01T00:00:00Z') }),
    row({ find: 'healed', active: false, updatedAt: new Date('2026-07-20T00:00:00Z') }),
  ])
  expect(p?.factEdits.map((e) => e.find)).toEqual(['old'])
  expect(p?.latestOverrideAt).toEqual(new Date('2026-07-20T00:00:00Z'))
})

test('the stamp is the MAX, not the last row read', () => {
  const p = only([
    row({ find: 'a', updatedAt: new Date('2026-07-20T00:00:00Z') }),
    row({ find: 'b', updatedAt: new Date('2026-06-01T00:00:00Z') }),
  ])
  expect(p?.latestOverrideAt).toEqual(new Date('2026-07-20T00:00:00Z'))
})

test('a row with no find-string stamps freshness without inventing an edit', () => {
  // poi_overrides also carries workflow state (upstream_status), so a row can legitimately have no
  // find/replace — it must not become an empty edit that then warns "matched NOTHING" forever.
  const p = only([row({ find: null, replace: null })])
  expect(p?.factEdits).toEqual([])
  expect(p?.latestOverrideAt).toEqual(new Date('2026-06-09T00:00:00Z'))
})

test('a row with no updated_at leaves the stamp unset rather than defaulting to now', () => {
  expect(only([row({ updatedAt: null })])?.latestOverrideAt).toBeUndefined()
})

test('places aggregate under (source, sourceId) — one place never inherits another edit', () => {
  const map = aggregateOverrideRows([
    row(),
    row({ sourceId: '9999', name: 'Other Place', find: 'other', replace: 'fixed' }),
  ])
  expect(map.get('wikipedia:4242')?.factEdits.map((e) => e.find)).toEqual(['the wrong architect'])
  expect(map.get('wikipedia:9999')?.factEdits.map((e) => e.find)).toEqual(['other'])
})

test('a retired row is inert at the APPLY seam — the withdrawn text is left alone', () => {
  setPoiOverridesForTest([row({ active: false })])
  const out = applyFactEditsChecked('wikipedia', '4242', 'Designed by the wrong architect, 1929.')
  expect(out.text).toBe('Designed by the wrong architect, 1929.')
  // ...and it is not reported as a MISS either: a retired edit has nothing to verify, so warning on
  // it every run would train the operator to ignore the one signal this layer has.
  expect(out.missed).toEqual([])
  expect(poiOverrideFor('wikipedia', '4242')?.latestOverrideAt).toBeDefined()
})
