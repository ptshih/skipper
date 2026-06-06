// Seed corridors into Neon from the FROZEN artifacts in ./data/*.json.
//
// Reads the JSON files materialized by ./materialize.ts (it never calls Google)
// and upserts one corridors row per file, keyed on slug — so re-running is safe
// and idempotent. Only the DB columns are written; provenance stays in the file.
//
// Usage (DATABASE_URL injected via dotenvx):
//   dotenvx run -f .env.development -- bun packages/db/seed/seed.ts            # all
//   dotenvx run -f .env.development -- bun packages/db/seed/seed.ts <slug>     # one

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sql } from 'drizzle-orm'
import { db } from '../src/client'
import { corridors } from '../src/schema'
import type { FrozenCorridor } from './corridors'

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), 'data')

/** Tahoe-region sanity box; a polyline outside this means bad coordinate order. */
const BBOX = { latMin: 38, latMax: 40, lngMin: -121, lngMax: -119 }

function loadFrozen(slug?: string): FrozenCorridor[] {
  const files = readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.json'))
    .filter((f) => !slug || f === `${slug}.json`)
  if (files.length === 0) {
    throw new Error(
      slug
        ? `No frozen artifact at ${join(DATA_DIR, `${slug}.json`)} — run materialize.ts ${slug} first.`
        : `No frozen artifacts in ${DATA_DIR} — run materialize.ts --all first.`,
    )
  }
  return files.map((f) => JSON.parse(readFileSync(join(DATA_DIR, f), 'utf8')) as FrozenCorridor)
}

function validate(c: FrozenCorridor): void {
  if (!c.slug || !c.region || !c.name) throw new Error(`${c.slug}: missing slug/region/name`)
  if (!Array.isArray(c.polyline) || c.polyline.length < 2) {
    throw new Error(`${c.slug}: polyline must have at least 2 points`)
  }
  for (const [i, pt] of c.polyline.entries()) {
    if (!Array.isArray(pt) || pt.length !== 2) throw new Error(`${c.slug}: point ${i} is not [lng, lat]`)
    const [lng, lat] = pt
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) throw new Error(`${c.slug}: point ${i} not finite`)
    if (lat < BBOX.latMin || lat > BBOX.latMax || lng < BBOX.lngMin || lng > BBOX.lngMax) {
      throw new Error(
        `${c.slug}: point ${i} [${lng}, ${lat}] outside Tahoe box — coordinates may be [lat, lng] instead of [lng, lat]`,
      )
    }
  }
}

async function main() {
  const slug = process.argv[2]
  const frozen = loadFrozen(slug)
  frozen.forEach(validate)

  for (const c of frozen) {
    const [row] = await db
      .insert(corridors)
      .values({
        slug: c.slug,
        region: c.region,
        name: c.name,
        summary: c.summary,
        polyline: c.polyline,
        distanceMeters: c.provenance.distanceMeters,
        durationSeconds: c.provenance.durationSeconds,
      })
      .onConflictDoUpdate({
        target: corridors.slug,
        set: {
          region: c.region,
          name: c.name,
          summary: c.summary,
          polyline: c.polyline,
          distanceMeters: c.provenance.distanceMeters,
          durationSeconds: c.provenance.durationSeconds,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: corridors.id, slug: corridors.slug })
    console.log(`✓ upserted ${row?.slug} (${c.polyline.length} points) -> ${row?.id}`)
  }

  const counted = await db.select({ count: sql<number>`count(*)::int` }).from(corridors)
  console.log(`corridors in DB: ${counted[0]?.count ?? 0}`)
}

await main()
