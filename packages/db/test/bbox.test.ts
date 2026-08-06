import { describe, expect, test } from 'bun:test'
import { PgDialect } from 'drizzle-orm/pg-core'
import { inAnyBbox, type SqlRegionBbox } from '../src/bbox'
import { pois } from '../src/schema'

const EAST: SqlRegionBbox = { swLng: -119.85, swLat: 38.8, neLng: -119.45, neLat: 39.65 }
const CORNER: SqlRegionBbox = { swLng: -120.4, swLat: 39.4, neLng: -119.85, neLat: 39.65 }

// The REAL renderer, not a proxy for it — `PgDialect` is what drizzle uses to emit the query, and it
// needs no connection, so this asserts the SQL that actually ships rather than an object shape.
const dialect = new PgDialect()
const render = (boxes: SqlRegionBbox[]) => {
  const q = dialect.sqlToQuery(inAnyBbox(pois.lat, pois.lng, boxes))
  return { sql: q.sql, params: q.params.map(Number) }
}

describe('inAnyBbox — the SQL twin of pointInAnyRegionBbox', () => {
  // ⚠ THE CASE THAT MATTERS MOST. A region with a null/malformed bbox parses to [], and an unguarded
  // `and(...[])` folds away in drizzle and leaves the query UNFILTERED — which is how a paid run bills
  // the wrong corpus and a release publishes rows nobody authorised. Fail CLOSED, always.
  test('an EMPTY box list matches NOTHING, never everything', () => {
    const { sql } = render([])
    expect(sql.trim()).toBe('false')
  })

  test('a single box emits the same plain AND the hand-written predicates did', () => {
    const { sql, params } = render([EAST])
    expect(sql).toInclude('between')
    expect(sql.toLowerCase()).not.toInclude(' or ')
    // lat bounds then lng bounds — the axis order the whole codebase agrees on.
    expect(params).toEqual([38.8, 39.65, -119.85, -119.45])
  })

  test('several boxes OR together, and neither half is dropped', () => {
    const { sql, params } = render([EAST, CORNER])
    expect(sql.toLowerCase()).toInclude(' or ')
    expect(params).toEqual([38.8, 39.65, -119.85, -119.45, 39.4, 39.65, -120.4, -119.85])
  })

  test('inclusive on all four edges — `between`, matching pointInRegionBbox', () => {
    // The agreement that lets an operator read the admin's poi-count and the API's anchor query as
    // the same number. A hand-rolled `>` here would silently disagree at a boundary.
    expect(render([EAST]).sql).toInclude('between')
    expect(render([EAST]).sql).not.toInclude('>')
  })
})
