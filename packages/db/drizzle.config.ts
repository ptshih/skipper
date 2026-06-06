import { defineConfig } from 'drizzle-kit'

// DATABASE_URL must be present in the environment when running drizzle-kit.
// Bun auto-loads .env from the working directory. With the .env at the repo
// root, run from there or point bun at it explicitly, e.g.:
//   bun --env-file=.env --filter @skipper/db db:push
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  strict: true,
  verbose: true,
})
