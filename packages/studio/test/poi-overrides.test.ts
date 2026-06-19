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
import { speakableAnchorFor } from '../src/pipeline/speakable'
import { POI_OVERRIDE_SEED } from '@skipper/db/seed/poi-overrides'

afterEach(() => clearPoiOverridesForTest())

const EDIT_ROW: OverrideRowLike = {
  source: 'wikipedia',
  sourceId: '111',
  name: 'Test Place',
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

  test('aggregation folds multiple fact-edit rows for one place', () => {
    const rows: OverrideRowLike[] = [
      EDIT_ROW,
      { ...EDIT_ROW, find: 'wrong year', replace: 'right year' },
    ]
    const agg = aggregateOverrideRows(rows)
    const place = agg.get('wikipedia:111')
    expect(place?.factEdits).toHaveLength(2)
  })
})

describe('retired (active === false) overrides', () => {
  test('a retired fact_edit is NOT applied and NOT reported missed', () => {
    setPoiOverridesForTest([{ ...EDIT_ROW, active: false }])
    const out = applyFactEditsChecked('wikipedia', '111', 'Leonard Palme designed it.')
    expect(out.text).toBe('Leonard Palme designed it.') // untouched — skipped, not applied
    expect(out.missed).toEqual([]) // and no warn (it would warn forever otherwise)
  })

  test('a retired row STILL stamps freshness (its retirement busts adopted caches)', () => {
    const when = new Date('2026-06-10T00:00:00Z')
    const agg = aggregateOverrideRows([{ ...EDIT_ROW, active: false, updatedAt: when }])
    const place = agg.get('wikipedia:111')
    expect(place?.factEdits).toEqual([]) // skipped for application
    expect(place?.latestOverrideAt).toEqual(when) // but freshness preserved
  })

  test('undefined active is treated as active (back-compat for existing rows)', () => {
    setPoiOverridesForTest([EDIT_ROW]) // no active field
    expect(applyFactEdits('wikipedia', '111', 'Leonard Palme')).toBe('Lennart Palme')
  })

  test('the healed Tahoe Keys seed row is retired (active === false)', () => {
    const tahoeKeys = POI_OVERRIDE_SEED.find((r) => r.sourceId === '22764866')
    expect(tahoeKeys?.active).toBe(false)
  })
})

describe('bootstrap seed rows (2026-06-09 review findings)', () => {
  test('every fact_edit documents its reason and an authoritative source', () => {
    for (const r of POI_OVERRIDE_SEED) {
      expect(r.reason.length).toBeGreaterThan(20)
      // poi_overrides is fact-corrections only now — every seed row is a find/replace edit.
      expect(r.sourceUrl).toMatch(/^https?:\/\//)
      expect(r.find).not.toBe(r.replace)
    }
  })

  test('identities are unique per (source, sourceId, find)', () => {
    const keys = POI_OVERRIDE_SEED.map((r) => `${r.source}:${r.sourceId}:${r.find ?? ''}`)
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

  test('Sugar Pine Point no longer carries a fact-correction row (its speakable anchor moved)', () => {
    setPoiOverridesForTest(POI_OVERRIDE_SEED as OverrideRowLike[])
    // The side_anchor coordinate relocated off poi_overrides onto pipeline/speakable.ts; the
    // place has no fact-edit, so it has no override row at all now.
    expect(poiOverrideFor('wikipedia', '41195091')).toBeUndefined()
  })
})

describe('speakable anchors (relocated off poi_overrides.side_anchor)', () => {
  test('Sugar Pine Point carries a lakeside speakable ANCHOR (a coordinate, never a left/right)', () => {
    const a = speakableAnchorFor('wikipedia', '41195091')
    expect(a?.lat).toBeCloseTo(39.061266, 5)
    expect(a?.lng).toBeCloseTo(-120.113971, 5)
  })

  test('a place with no curated anchor returns undefined', () => {
    expect(speakableAnchorFor('wikipedia', '999999')).toBeUndefined()
  })
})
