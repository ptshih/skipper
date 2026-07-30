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
    const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 10_000 })
    // ⚠ REQUIRED, not defensive. `Pool` is an EventEmitter, and node's contract is that an 'error'
    // event with no listener is RETHROWN as an uncaught exception. An idle pooled socket dropped by
    // Neon (or any network blip between requests) emits exactly that — off the back of no request, so
    // no route's try/catch is on the stack — and the process dies, taking every in-flight request on
    // the container with it. The pool replaces dead clients on its own; the listener just has to exist.
    pool.on('error', (err: Error) => {
      console.error('[auth-db] idle pool client error (pool self-heals):', err)
    })
    cached = drizzle(pool)
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
