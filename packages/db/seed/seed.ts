// Seed the curated CONTENT rows: regions, host personas, and the upstream-error fact
// corrections. Idempotent — re-running refreshes content and never clobbers workflow state.
//
// Tours are NOT seeded. Under the discovery-first reorder (2026-06-12), a tour is AUTHORED at
// runtime via the admin Create flow over the region POI corpus: (1) discover a region's POIs
// into the shared `pois` table (sweep-roam-pois.ts), (2) author + freeze a route (admin
// Create → materializeRoute), (3) generate the tour (it selects candidates from the corpus).
// The old seeded draft shells + the committed curated-route artifacts (tour-specs.ts +
// seed/data/*.json) were dropped — the routes are re-authored through the new system.
//
// Usage (DATABASE_URL injected via dotenvx):
//   dotenvx run -f .env.development -- bun packages/db/seed/seed.ts

import { sql } from 'drizzle-orm'
import { db } from '../src/client'
import { regions } from '../src/schema'
import { seedPoiOverrides } from './poi-overrides'
import { seedPersonas } from './personas'

/** The regions a tour can belong to — manual, geometry-free (D4). slug → spoken name.
 *  A region's discovery bbox is a generation-op parameter (sweep-roam-pois), not a column. */
const REGION_SEED: { slug: string; displayName: string }[] = [
  { slug: 'lake-tahoe', displayName: 'Lake Tahoe' },
]

/** Upsert the regions by slug (idempotent). */
async function seedRegions(): Promise<void> {
  for (const r of REGION_SEED) {
    await db
      .insert(regions)
      .values(r)
      .onConflictDoUpdate({
        target: regions.slug,
        set: { displayName: r.displayName, updatedAt: sql`now()` },
      })
  }
  const n = await db.select({ count: sql<number>`count(*)::int` }).from(regions)
  console.log(`✓ regions seeded — ${n[0]?.count ?? 0} rows in DB`)
}

async function main() {
  await seedRegions()
  await seedPersonas()
  await seedPoiOverrides()
}

await main()
