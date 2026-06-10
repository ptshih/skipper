// pipeline/poi-overrides — the curated upstream-error correction layer (DB-resident).
//
// Mechanism tests inject rows via the test seam (no DB); the live-entry tests pin the
// BOOTSTRAP seed rows (@skipper/db/seed/poi-overrides) against the sentence shapes the
// 2026-06-09 review verified, so an edit that drifts from the real article text goes red.

import { afterEach, describe, expect, test } from 'bun:test'
import {
  aggregateOverrideRows,
  applyFactEdits,
  applyFactEditsChecked,
  clearPoiOverridesForTest,
  poiOverrideFor,
  setPoiOverridesForTest,
  type OverrideRowLike,
} from '../src/pipeline/poi-overrides'
import { POI_OVERRIDE_SEED } from '@skipper/db/seed/poi-overrides'

afterEach(() => clearPoiOverridesForTest())

const EDIT_ROW: OverrideRowLike = {
  source: 'wikipedia',
  sourceId: '111',
  name: 'Test Place',
  kind: 'fact_edit',
  find: 'Leonard Palme',
  replace: 'Lennart Palme',
  reason: 'test',
  sourceUrl: 'https://example.com',
}

describe('apply mechanism (injected rows, no DB)', () => {
  test('unloaded cache → no overrides, text untouched', () => {
    const text = 'Leonard Palme designed nothing here.'
    expect(applyFactEdits('wikipedia', '111', text)).toBe(text)
    expect(poiOverrideFor('wikipedia', '111')).toBeUndefined()
  })

  test('unknown place is a no-op', () => {
    setPoiOverridesForTest([EDIT_ROW])
    const text = 'Leonard Palme strikes again.'
    expect(applyFactEdits('wikipedia', '999', text)).toBe(text)
  })

  test('replaces EVERY occurrence and reports nothing missed', () => {
    setPoiOverridesForTest([EDIT_ROW])
    const out = applyFactEditsChecked('wikipedia', '111', 'Leonard Palme met Leonard Palme.')
    expect(out.text).toBe('Lennart Palme met Lennart Palme.')
    expect(out.missed).toEqual([])
  })

  test('an unmatched find is reported as missed (healed vs reworded needs a human)', () => {
    setPoiOverridesForTest([EDIT_ROW])
    const out = applyFactEditsChecked('wikipedia', '111', 'Already says Lennart Palme.')
    expect(out.text).toBe('Already says Lennart Palme.')
    expect(out.missed).toHaveLength(1)
    expect(out.missed[0]?.find).toBe('Leonard Palme')
  })

  test('replacement text containing $ patterns is inserted literally', () => {
    setPoiOverridesForTest([
      { ...EDIT_ROW, find: 'cheap', replace: "$100 and worth every $& of it" },
    ])
    expect(applyFactEdits('wikipedia', '111', 'It was cheap.')).toBe(
      'It was $100 and worth every $& of it.',
    )
  })

  test('source must match, not just the id', () => {
    setPoiOverridesForTest([EDIT_ROW])
    expect(applyFactEdits('wikidata', '111', 'Leonard Palme')).toBe('Leonard Palme')
  })

  test('aggregation folds multiple rows for one place', () => {
    const rows: OverrideRowLike[] = [
      EDIT_ROW,
      { ...EDIT_ROW, find: 'wrong year', replace: 'right year' },
      {
        source: 'wikipedia',
        sourceId: '111',
        name: 'Test Place',
        kind: 'side_anchor',
        sideAnchorLat: 39.0,
        sideAnchorLng: -120.0,
        reason: 'test',
      },
    ]
    const agg = aggregateOverrideRows(rows)
    const place = agg.get('wikipedia:111')
    expect(place?.factEdits).toHaveLength(2)
    expect(place?.sideAnchor).toEqual({ lat: 39.0, lng: -120.0 })
  })
})

describe('bootstrap seed rows (2026-06-09 review findings)', () => {
  test('every fact_edit documents its reason and an authoritative source', () => {
    for (const r of POI_OVERRIDE_SEED) {
      expect(r.reason.length).toBeGreaterThan(20)
      if (r.kind === 'fact_edit') {
        expect(r.sourceUrl).toMatch(/^https?:\/\//)
        expect(r.find).not.toBe(r.replace)
      }
    }
  })

  test('identities are unique per (source, sourceId, kind, find)', () => {
    const keys = POI_OVERRIDE_SEED.map((r) => `${r.source}:${r.sourceId}:${r.kind}:${r.find ?? ''}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  test('Emerald Bay: Leonard → Lennart corrects the verbatim article sentence', () => {
    setPoiOverridesForTest(POI_OVERRIDE_SEED as OverrideRowLike[])
    const fetched =
      'The architect was Leonard Palme, who was hired by his aunt Lora Josephine Knight to design and build Vikingsholm.'
    const out = applyFactEdits('wikipedia', '1985884', fetched)
    expect(out).toContain('Lennart Palme')
    expect(out).not.toContain('Leonard')
  })

  test('Pope Estate: builder/decade corrected against the verbatim article sentence', () => {
    setPoiOverridesForTest(POI_OVERRIDE_SEED as OverrideRowLike[])
    const fetched =
      'The home was originally built by Lloyd Tevis, former president of Wells Fargo Bank, in the 1880s.'
    const out = applyFactEdits('wikipedia', '39007559', fetched)
    expect(out).toContain('George Tallant')
    expect(out).toContain('1894')
    expect(out).toContain('purchased by the Tevis family in 1899')
    expect(out).not.toContain('Wells Fargo')
    expect(out).not.toContain('1880s')
  })

  test('Sugar Pine Point carries a lakeside side ANCHOR (a coordinate, never a left/right)', () => {
    setPoiOverridesForTest(POI_OVERRIDE_SEED as OverrideRowLike[])
    const o = poiOverrideFor('wikipedia', '41195091')
    expect(o?.sideAnchor?.lat).toBeCloseTo(39.061266, 5)
    expect(o?.sideAnchor?.lng).toBeCloseTo(-120.113971, 5)
    expect(o?.factEdits).toEqual([])
  })
})
