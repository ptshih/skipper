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

// FACT corrections only now — the side-of-road coordinate moved onto `pois.speakable_lat/lng`
// (a place's stored vantage, written by the generator). The Sugar Pine Point speakable anchor
// lives as a curated map in packages/studio/src/pipeline/speakable.ts.
export const POI_OVERRIDE_SEED: NewPoiOverride[] = [
  {
    source: 'wikipedia',
    sourceId: '1985884',
    name: 'Emerald Bay State Park',
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
    find: 'built by Lloyd Tevis, former president of Wells Fargo Bank, in the 1880s',
    replace:
      'built in 1894 by George Tallant of Crocker Bank, and purchased by the Tevis family in 1899',
    reason:
      "The article credits the wrong builder and decade: the Tallac Historic Site's operator history and the on-site interpretive marker say George Tallant built the original Pope House in 1894; the Tevis family bought it in 1899 (Lloyd Tevis died that July — the buyer was his son William).",
    sourceUrl: 'https://taylortallac.org/history-of-tallac-historic-site/',
  },
  {
    source: 'wikipedia',
    sourceId: '22764866',
    name: 'Tahoe Keys, California',
    find: 'Constructed in the 1960s,',
    replace: 'Constructed beginning in the mid-1950s,',
    // RETIRED 2026-06-10: Wikipedia removed the construction-date sentence from the article
    // entirely (lead + full text now state no decade), so `find` matches nothing and the
    // correction no longer applies. Kept inactive for provenance in case the claim returns.
    active: false,
    reason:
      'The article dated construction to the 1960s; the California Tahoe Conservancy and the Tahoe Daily Tribune date the development to the 1950s/1960s, with construction beginning in the mid-1950s. Founder-adjudicated from a --veracity finding 2026-06-09. RETIRED 2026-06-10: the source removed the dated sentence, so this no longer matches anything.',
    sourceUrl: 'https://tahoe.ca.gov/upper-truckee-marsh/',
  },
  {
    source: 'wikipedia',
    sourceId: '32308786',
    name: 'Chambers Lodge, California',
    find: 'first established in 1854',
    replace: 'first established in 1863',
    reason:
      "The article says 1854; multiple consistent sources (Rubicon Trail Foundation, tahoecountry.com, L.W. Currey) say John McKinney established Hunter's Retreat at this site in 1863. Founder-adjudicated from a --veracity finding 2026-06-09.",
    sourceUrl: 'https://donsnotes.com/tahoe/chambers-landing.html',
  },
]

/** Idempotent upsert: refresh correction content, never touch upstream workflow state. */
export async function seedPoiOverrides(): Promise<void> {
  for (const row of POI_OVERRIDE_SEED) {
    await db
      .insert(poiOverrides)
      .values(row)
      .onConflictDoUpdate({
        target: [poiOverrides.source, poiOverrides.sourceId, poiOverrides.find],
        set: {
          name: row.name,
          replace: row.replace ?? null,
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
