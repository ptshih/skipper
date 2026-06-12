import { afterEach, describe, expect, test } from 'bun:test'
import { isFactsFresh } from '../src/pipeline/persist'
import {
  aggregateOverrideRows,
  cachedExtractSuspect,
  clearPoiOverridesForTest,
  latestOverrideAtFor,
  setPoiOverridesForTest,
} from '../src/pipeline/poi-overrides'

const T0 = new Date('2026-06-10T12:00:00Z')
const hoursAgo = (h: number) => new Date(T0.getTime() - h * 3_600_000)

describe('isFactsFresh (the pois facts read-through predicate)', () => {
  test('fresh: fetched within the TTL, no override', () => {
    expect(isFactsFresh(hoursAgo(24), undefined, 168, T0)).toBe(true)
  })
  test('stale: fetched outside the TTL', () => {
    expect(isFactsFresh(hoursAgo(200), undefined, 168, T0)).toBe(false)
  })
  test('never fetched is never fresh', () => {
    expect(isFactsFresh(null, undefined, 168, T0)).toBe(false)
  })
  test('TTL 0 disables the cache entirely', () => {
    expect(isFactsFresh(hoursAgo(1), undefined, 0, T0)).toBe(false)
  })
  test('an override NEWER than the fetch makes the row stale (correction must land)', () => {
    expect(isFactsFresh(hoursAgo(24), hoursAgo(2), 168, T0)).toBe(false)
  })
  test('an override OLDER than the fetch keeps the row fresh (already applied at fetch)', () => {
    expect(isFactsFresh(hoursAgo(2), hoursAgo(24), 168, T0)).toBe(true)
  })
})

describe('override freshness stamp (latestOverrideAt)', () => {
  afterEach(clearPoiOverridesForTest)

  test('aggregation keeps the NEWEST row stamp per place, across multiple edits', () => {
    const out = aggregateOverrideRows([
      {
        source: 'wikipedia',
        sourceId: '1',
        name: 'A',
        find: 'x',
        replace: 'y',
        reason: 'r',
        updatedAt: hoursAgo(48),
      },
      {
        source: 'wikipedia',
        sourceId: '1',
        name: 'A',
        find: 'p',
        replace: 'q',
        reason: 'r',
        updatedAt: hoursAgo(3), // newest — a later correction adjudication stamps too
      },
    ])
    expect(out.get('wikipedia:1')?.latestOverrideAt).toEqual(hoursAgo(3))
  })

  test('rows without updatedAt (seed fixtures) leave the stamp unset', () => {
    const out = aggregateOverrideRows([
      { source: 'wikipedia', sourceId: '2', name: 'B', find: 'x', replace: '', reason: 'r' },
    ])
    expect(out.get('wikipedia:2')?.latestOverrideAt).toBeUndefined()
  })

  test('latestOverrideAtFor reads through the loaded cache; absent place is undefined', () => {
    setPoiOverridesForTest([
      {
        source: 'wikipedia',
        sourceId: '3',
        name: 'C',
        find: 'x',
        replace: '',
        reason: 'r',
        updatedAt: hoursAgo(5),
      },
    ])
    expect(latestOverrideAtFor('wikipedia', '3')).toEqual(hoursAgo(5))
    expect(latestOverrideAtFor('wikipedia', 'nope')).toBeUndefined()
  })
})

describe('cachedExtractSuspect (the "reworded, still wrong" guard on cache reads)', () => {
  afterEach(clearPoiOverridesForTest)

  const load = (find: string, replace: string) =>
    setPoiOverridesForTest([
      { source: 'wikipedia', sourceId: '9', name: 'D', find, replace, reason: 'r' },
    ])

  test('clean: the correction (replace) is visible, the falsehood (find) is not', () => {
    load('Leonard Palme', 'Lennart Palme')
    expect(cachedExtractSuspect('wikipedia', '9', 'designed by Lennart Palme in 1929')).toBe(false)
  })
  test('suspect: the FIND string is literally present in the cached text', () => {
    load('Leonard Palme', 'Lennart Palme')
    expect(cachedExtractSuspect('wikipedia', '9', 'designed by Leonard Palme in 1929')).toBe(true)
  })
  test('suspect: NEITHER find nor replace appears (edit matched nothing at fetch time)', () => {
    load('Leonard Palme', 'Lennart Palme')
    expect(cachedExtractSuspect('wikipedia', '9', 'the architect, a Swede, drew it in 1929')).toBe(true)
  })
  test('deletion edit (replace="") with no find visible is accepted as applied', () => {
    load('a false sentence.', '')
    expect(cachedExtractSuspect('wikipedia', '9', 'only true sentences here.')).toBe(false)
  })
  test('a place with no overrides is never suspect', () => {
    setPoiOverridesForTest([])
    expect(cachedExtractSuspect('wikipedia', '9', 'anything')).toBe(false)
  })
})
