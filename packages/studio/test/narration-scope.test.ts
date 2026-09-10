import { expect, test } from 'bun:test'
import { PgDialect } from 'drizzle-orm/pg-core'
import { narrationScope } from '../src/pipeline/narration-scope'
const dialect = new PgDialect()
test('region plus explicit IDs cannot expand a paid run to the whole region',()=>{
 const id='d529d8f3-1347-4cbf-b28d-e2b7f75cd1d6'
 const q=dialect.sqlToQuery(narrationScope([id],[{swLng:-120.5,swLat:37,neLng:-119,neLat:38.5}])!)
 expect(q.params).toContain(id)
 expect(q.sql).toContain('"pois"."id" in')
 expect(q.sql).toContain('"pois"."lat"')
})
test('explicit-only remains bounded; an unscoped run fails closed',()=>{
 expect(dialect.sqlToQuery(narrationScope(['only-this'],null)!).params).toEqual(['only-this'])
 expect(()=>narrationScope([],null)).toThrow()
})
