// Better Auth's own DB client.
//
// Better Auth writes user+account atomically on sign-up, which needs interactive
// transactions — and the app's @skipper/db client is neon-http, which has none.
// So auth uses a separate drizzle client over the neon-serverless WebSocket Pool
// (same Neon database). Lazy + proxied so importing this never requires
// DATABASE_URL (keeps schema codegen / typecheck env-free), mirroring @skipper/db.

import { drizzle, type NeonDatabase } from 'drizzle-orm/neon-serverless'
import { Pool } from '@neondatabase/serverless'

let cached: NeonDatabase | undefined

function getAuthDb(): NeonDatabase {
  if (!cached) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set (Better Auth db).')
    cached = drizzle(new Pool({ connectionString: url }))
  }
  return cached
}

export const authDb: NeonDatabase = new Proxy({} as NeonDatabase, {
  get(_target, prop) {
    const real = getAuthDb()
    const value = Reflect.get(real as object, prop)
    return typeof value === 'function' ? value.bind(real) : value
  },
})
