import { expect, test } from 'bun:test'
import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import * as schema from '@skipper/db/schema'
import { previousListeningItems, listeningReviewSummaries } from './listening-history'
// Compile real SQL without executing a network request; projection is the regression boundary.
const db = drizzle({ client: neon('postgresql://test:test@localhost/test'), schema })
test('carry-forward query excludes parent snapshots and selects latest verdict per clip version', () => {
  const { sql, params } = previousListeningItems(db, 'yosemite-national-park').toSQL()
  expect(sql).not.toContain('"snapshot"')
  expect(sql).toContain('select distinct on ("listening_review_items"."narration_id", "listening_review_items"."fingerprint")')
  expect(sql).toContain('"listening_review_items"."updated_at" desc')
  for (const field of ['verdict', 'notes', 'advisory_reason', 'technical', 'reviewer']) expect(sql).toContain(`"listening_review_items"."${field}"`)
  expect(params).toEqual(['yosemite-national-park'])
})
test('review picker never fetches snapshots and keeps region scope and limit', () => {
  const { sql, params } = listeningReviewSummaries(db, 'yosemite-national-park').toSQL()
  expect(sql).not.toContain('"snapshot"')
  expect(sql).toContain('"approved_at"')
  expect(params).toEqual(['yosemite-national-park', 30])
})
