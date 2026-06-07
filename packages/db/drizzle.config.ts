import { defineConfig } from 'drizzle-kit'

// drizzle-kit does NOT auto-load .env. Run via the root passthrough scripts,
// which set bun's --env-file, e.g.:  bun run db:push
const url = process.env.DATABASE_URL
if (!url) {
  throw new Error(
    'DATABASE_URL is not set. Run drizzle-kit via the root scripts (e.g. `bun run db:push`) so .env is loaded.',
  )
}

export default defineConfig({
  dialect: 'postgresql',
  // Both our app schema and the Better Auth (CLI-generated) auth schema.
  schema: ['./src/schema.ts', './src/auth-schema.ts'],
  out: './drizzle',
  dbCredentials: { url },
  strict: true,
  verbose: true,
})
