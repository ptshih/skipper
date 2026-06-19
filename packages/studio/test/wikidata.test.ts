import { describe, expect, test } from 'bun:test'
import {
  buildWikidataFacts,
  formatElevation,
  formatHeritage,
  formatInception,
  formatNamedAfter,
  pickStatement,
  referencedItemIds,
} from '../src/pipeline/wikidata'

const METRE = 'http://www.wikidata.org/entity/Q11573'
const KILOMETRE = 'http://www.wikidata.org/entity/Q828224'
const FOOT = 'http://www.wikidata.org/entity/Q3710'

/** A minimal value-bearing statement for one property. */
function stmt(value: unknown, rank = 'normal'): any {
  return { mainsnak: { snaktype: 'value', property: 'P', datavalue: { value, type: 't' } }, rank }
}

describe('formatElevation', () => {
  test('converts metres to feet, rounded to the nearest 10 (Lake Tahoe ≈ 1897 m)', () => {
    // 1897 m × 3.28084 ≈ 6225 ft → nearest 10 = 6220.
    expect(formatElevation({ amount: '+1897', unit: METRE } as any)).toBe(
      'It sits at about 6,220 feet above sea level.',
    )
  })

  test('handles a kilometre unit', () => {
    // 2 km = 2000 m × 3.28084 ≈ 6562 ft → nearest 10 = 6560.
    expect(formatElevation({ amount: '+2', unit: KILOMETRE } as any)).toBe(
      'It sits at about 6,560 feet above sea level.',
    )
  })

  test('passes a foot unit through (already imperial)', () => {
    expect(formatElevation({ amount: '+1000', unit: FOOT } as any)).toContain('1,000 feet')
  })

  test('skips an unknown unit (no invented number)', () => {
    expect(
      formatElevation({ amount: '+100', unit: 'http://www.wikidata.org/entity/Q99999' } as any),
    ).toBeNull()
  })

  test('skips a non-positive value', () => {
    expect(formatElevation({ amount: '0', unit: METRE } as any)).toBeNull()
  })
})

describe('formatInception', () => {
  test('year precision speaks the exact year', () => {
    expect(formatInception({ time: '+1929-00-00T00:00:00Z', precision: 9 } as any)).toBe(
      'Established in 1929.',
    )
  })

  test('decade precision speaks the decade', () => {
    expect(formatInception({ time: '+1925-00-00T00:00:00Z', precision: 8 } as any)).toBe(
      'It dates to the 1920s.',
    )
  })

  test('century precision is too vague — skipped', () => {
    expect(formatInception({ time: '+1800-00-00T00:00:00Z', precision: 7 } as any)).toBeNull()
  })

  test('BCE dates are out of scope — skipped, never mis-spoken', () => {
    expect(formatInception({ time: '-0500-00-00T00:00:00Z', precision: 9 } as any)).toBeNull()
  })
})

describe('formatNamedAfter / formatHeritage', () => {
  test('named after renders the resolved label', () => {
    expect(formatNamedAfter('John C. Frémont')).toBe("It's named after John C. Frémont.")
  })

  test('named after skips an empty label', () => {
    expect(formatNamedAfter('   ')).toBeNull()
  })

  test('heritage designation renders the resolved label', () => {
    expect(formatHeritage('National Historic Landmark')).toBe(
      'It holds a heritage designation: National Historic Landmark.',
    )
  })

  test("heritage designation drops Wikidata's trailing 'listed place' tag", () => {
    expect(formatHeritage('National Register of Historic Places listed place')).toBe(
      'It holds a heritage designation: National Register of Historic Places.',
    )
  })
})

describe('pickStatement', () => {
  test('prefers a preferred-rank statement over a normal one', () => {
    const normal = stmt({ time: '+1900' }, 'normal')
    const preferred = stmt({ time: '+1929' }, 'preferred')
    expect(pickStatement([normal, preferred])).toBe(preferred)
  })

  test('falls back to the first normal statement when none are preferred', () => {
    const a = stmt({ time: '+1900' }, 'normal')
    const b = stmt({ time: '+1929' }, 'normal')
    expect(pickStatement([a, b])).toBe(a)
  })

  test('never speaks a deprecated value', () => {
    expect(pickStatement([stmt({ time: '+1900' }, 'deprecated')])).toBeNull()
  })

  test('skips novalue / somevalue snaks', () => {
    const novalue: any = { mainsnak: { snaktype: 'novalue', property: 'P' }, rank: 'normal' }
    expect(pickStatement([novalue])).toBeNull()
  })

  test('returns null for an absent property', () => {
    expect(pickStatement(undefined)).toBeNull()
  })
})

describe('referencedItemIds', () => {
  test('collects the value QIDs of the item-valued allowlisted properties', () => {
    const entity: any = {
      id: 'Q1',
      claims: {
        P138: [stmt({ 'entity-type': 'item', id: 'Q1521' })], // named after
        P1435: [stmt({ 'entity-type': 'item', id: 'Q4204' })], // heritage designation
        P2044: [stmt({ amount: '+1897', unit: METRE })], // not item-valued — ignored
      },
    }
    expect(referencedItemIds(entity).sort()).toEqual(['Q1521', 'Q4204'])
  })
})

describe('buildWikidataFacts', () => {
  test('emits inception, elevation, then label-resolved item facts, in order', () => {
    const entity: any = {
      id: 'Q1',
      claims: {
        P571: [stmt({ time: '+1929-00-00T00:00:00Z', precision: 9 })],
        P2044: [stmt({ amount: '+1897', unit: METRE })],
        P138: [stmt({ 'entity-type': 'item', id: 'Q1521' })],
      },
    }
    const labels = new Map([['Q1521', 'John C. Frémont']])
    expect(buildWikidataFacts(entity, labels)).toEqual([
      'Established in 1929.',
      'It sits at about 6,220 feet above sea level.',
      "It's named after John C. Frémont.",
    ])
  })

  test('drops an item fact whose label could not be resolved (never a bare QID)', () => {
    const entity: any = {
      id: 'Q1',
      claims: { P138: [stmt({ 'entity-type': 'item', id: 'Q1521' })] },
    }
    expect(buildWikidataFacts(entity, new Map())).toEqual([])
  })

  test('returns no lines when the item has none of the allowlisted properties', () => {
    const entity: any = { id: 'Q1', claims: { P99999: [stmt({ amount: '+1' })] } }
    expect(buildWikidataFacts(entity, new Map())).toEqual([])
  })
})
