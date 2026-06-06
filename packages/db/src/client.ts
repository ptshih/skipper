import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import * as schema from './schema'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set')
}

// HTTP (one-shot) driver — ideal for serverless request/response handlers.
// NOTE: neon-http does not support interactive transactions; use db.batch([...])
// for multiple statements, or switch to drizzle-orm/neon-serverless (Pool) if
// you need real transactions.
const sql = neon(databaseUrl)

export const db = drizzle({ client: sql, schema })
export type DB = typeof db

export { schema }
export * from './schema'
