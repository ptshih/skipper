import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import * as schema from './schema'

function createDb(databaseUrl: string) {
  // HTTP (one-shot) driver — ideal for serverless request/response handlers.
  // NOTE: neon-http has no interactive transactions. For multi-statement
  // atomicity (e.g. co-committing a parent row with its dependent rows — a poi
  // and its 1:1 narration — in one write) use db.batch([...]) — it co-commits.
  // Switch to drizzle-orm/neon-serverless (Pool) only if you ever need real
  // interactive transactions.
  return drizzle({ client: neon(databaseUrl), schema })
}

export type DB = ReturnType<typeof createDb>

let cached: DB | undefined

/**
 * Lazily create the neon-http client on first use. Importing @skipper/db is
 * therefore side-effect-free — the missing-DATABASE_URL error surfaces only when
 * a query actually runs, so env-free routes (e.g. GET /health) can import this
 * package without forcing the whole process to have a database configured.
 */
export function getDb(): DB {
  if (!cached) {
    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is not set')
    }
    cached = createDb(databaseUrl)
  }
  return cached
}

/** Lazy proxy: `db.select()...` works but the client is built on first access. */
export const db: DB = new Proxy({} as DB, {
  get(_target, prop) {
    const real = getDb()
    const value = Reflect.get(real as object, prop)
    return typeof value === 'function' ? value.bind(real) : value
  },
})

// Schema is intentionally NOT re-exported here. Import DB row types from the
// "@skipper/db/schema" subpath, aliased to avoid clashing with the Zod boundary
// types in @skipper/shared, e.g.:
//   import type { Poi as PoiRow } from '@skipper/db/schema'
