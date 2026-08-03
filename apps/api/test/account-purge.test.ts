/**
 * Guards that account ERASURE stays COMPLETE — App Store 5.1.1(v).
 *
 * `purgeUserData` (../src/account.ts) hard-codes the tables it deletes: `drives` and
 * `credit_entries`. That list is correct today. Nothing makes it stay correct.
 *
 * ⚠ THE FAILURE THIS EXISTS FOR. `drives.user_id` and `credit_entries.user_id` are SOFT refs — auth
 * runs on a separate neon-serverless pool, so no DB-level FK spans the boundary and there is no
 * cascade to ride. A third table gaining a `user_id` therefore does NOT get erased by anything: not
 * by Better Auth, not by a cascade, and not by the purge, which has never heard of it. Nothing
 * throws, no test fails, and the rider's data outlives their deletion request.
 *
 * That is not hypothetical. CLAUDE.md already names the likely candidate: a `conversations` table
 * would be "new personal data purgeUserData must chase". The risk is anticipated in prose and, until
 * now, unguarded in code.
 *
 * So this asserts the SET of user-owned tables in the schema equals the set the purge deletes. Adding
 * a user-owned table fails here until someone updates `purgeUserData` — which is the moment the
 * decision should be made, not months later during a review.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core'
import * as schema from '@skipper/db/schema'

/** Every table in the app schema that carries a `user_id` column — i.e. is user-OWNED. */
function userOwnedTables(): string[] {
  const names: string[] = []
  for (const exported of Object.values(schema)) {
    // Drizzle tables are the only exports getTableConfig accepts; enums/types throw.
    let cfg: ReturnType<typeof getTableConfig>
    try {
      cfg = getTableConfig(exported as PgTable)
    } catch {
      continue
    }
    if (cfg.columns.some((col) => col.name === 'user_id')) names.push(cfg.name)
  }
  return names.sort()
}

const accountSrc = readFileSync(join(import.meta.dir, '..', 'src', 'account.ts'), 'utf8')

describe('account erasure covers every user-owned table', () => {
  test('the schema has exactly the user-owned tables the purge knows about', () => {
    // ⚠ If this fails because you ADDED a table: do not just update this list. Decide whether the new
    // rows are personal data (they almost certainly are, if they are keyed on a user id), add the
    // delete to purgeUserData, and THEN update this list. The list is the reminder, not the fix.
    expect(userOwnedTables()).toEqual(['credit_entries', 'drives'])
  })

  test('purgeUserData deletes each one', () => {
    // A source assertion, deliberately: purgeUserData writes through @skipper/db and exercising it
    // would need a live database, which this suite does not have (and must not acquire — dev and
    // prod share one). It proves the deletes are WRITTEN, which is what the schema check above pairs
    // with; auth-delete-hook.test.ts separately proves the function is WIRED to a hook that runs.
    for (const table of userOwnedTables()) {
      const camel = table.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
      expect(accountSrc).toContain(`db.delete(${camel})`)
    }
  })

  test('the deletes are BATCHED, so a partial purge cannot split a rider from their ledger', () => {
    // Two sequential awaits could delete the drives and then fail before the ledger, leaving a
    // half-erased account that no retry path visits again.
    expect(accountSrc).toContain('db.batch(')
  })

  test('it hard-deletes rather than soft-deletes', () => {
    // `drives` carries a `deleted_at` and the normal DELETE /drives/:id path is a tombstone. Erasure
    // must NOT reuse that: a tombstoned row still holds the rider's data and their user id.
    expect(accountSrc).not.toMatch(/update\(drives\)|deletedAt:/)
  })
})
