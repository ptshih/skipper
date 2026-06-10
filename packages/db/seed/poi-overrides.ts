// Bootstrap rows for `poi_overrides` — the curated upstream-error corrections.
//
// The TABLE is the source of truth at runtime (the generator loads it per run; workflow
// state like upstream_status lives only there). This file is the reviewed BOOTSTRAP: the
// founder-adjudicated corrections, upserted idempotently so a fresh database starts with
// them. Re-running refreshes the correction CONTENT (find/replace/reason/source_url) but
// never clobbers workflow state (upstream_status / upstream_url) — that belongs to the DB.
//
// Adding a correction: adjudicate a --veracity finding (eval CLI), then either add it here
// and re-seed (keeps the bootstrap canonical) or insert directly once an admin surface
// exists. Discipline: a row repairs a VERIFIABLE error (reason + authoritative source_url
// required for fact_edits) — never an editorial rewrite.
//
// Usage (DATABASE_URL injected via dotenvx):
//   dotenvx run -f .env.development -- bun packages/db/seed/poi-overrides.ts

import { sql } from 'drizzle-orm'
import { db } from '../src/client'
import { poiOverrides, type NewPoiOverride } from '../src/schema'

export const POI_OVERRIDE_SEED: NewPoiOverride[] = [
  {
    source: 'wikipedia',
    sourceId: '1985884',
    name: 'Emerald Bay State Park',
    kind: 'fact_edit',
    find: 'Leonard Palme',
    replace: 'Lennart Palme',
    reason:
      "The article misnames Vikingsholm's architect: he was Lennart Palme (Lora Knight's nephew by marriage), as Wikipedia's own Vikingsholm article and the site's operators have it.",
    sourceUrl: 'https://vikingsholm.com/',
  },
  {
    source: 'wikipedia',
    sourceId: '39007559',
    name: 'Pope Estate',
    kind: 'fact_edit',
    find: 'built by Lloyd Tevis, former president of Wells Fargo Bank, in the 1880s',
    replace:
      'built in 1894 by George Tallant of Crocker Bank, and purchased by the Tevis family in 1899',
    reason:
      "The article credits the wrong builder and decade: the Tallac Historic Site's operator history and the on-site interpretive marker say George Tallant built the original Pope House in 1894; the Tevis family bought it in 1899 (Lloyd Tevis died that July — the buyer was his son William).",
    sourceUrl: 'https://taylortallac.org/history-of-tallac-historic-site/',
  },
  {
    source: 'wikipedia',
    sourceId: '41195091',
    name: "Ed Z'berg Sugar Pine Point State Park",
    kind: 'side_anchor',
    // The Sugar Pine Point Light — the speakable content the narration points at. A
    // COORDINATE (not a stored left/right): side flips with travel direction and S→N / N→S
    // are peer tours, so the heading-aware geometry resolves the side per drive.
    sideAnchorLat: 39.061266,
    sideAnchorLng: -120.113971,
    reason:
      "The park straddles CA-89 and its pin sits inland (west), so the pin-based geometry points riders away from the lake — but everything the narration points at (the shoreline, the Sugar Pine Point Light) is lakeside. Our delivery judgment, not a source error.",
    upstreamStatus: 'not_applicable',
  },
]

/** Idempotent upsert: refresh correction content, never touch upstream workflow state. */
export async function seedPoiOverrides(): Promise<void> {
  for (const row of POI_OVERRIDE_SEED) {
    await db
      .insert(poiOverrides)
      .values(row)
      .onConflictDoUpdate({
        target: [poiOverrides.source, poiOverrides.sourceId, poiOverrides.kind, poiOverrides.find],
        set: {
          name: row.name,
          replace: row.replace ?? null,
          sideAnchorLat: row.sideAnchorLat ?? null,
          sideAnchorLng: row.sideAnchorLng ?? null,
          reason: row.reason,
          sourceUrl: row.sourceUrl ?? null,
          updatedAt: sql`now()`,
        },
      })
  }
  const n = await db.select({ count: sql<number>`count(*)::int` }).from(poiOverrides)
  console.log(`✓ poi_overrides seeded — ${n[0]?.count ?? 0} rows in DB`)
}

// Runnable directly (the seed.ts main also calls seedPoiOverrides).
if (import.meta.main) {
  await seedPoiOverrides()
}
