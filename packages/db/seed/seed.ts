// Seed regions + tour SHELLS into Neon.
//
// The route GEOMETRY (polyline + frozen Routes-API totals) is read from the FROZEN
// artifacts in ./data/*.json (materialized by ./materialize.ts; never calls Google).
// The headline/region/anchor METADATA comes from the curated spec (./tour-specs.ts) —
// so an older frozen artifact that predates the metadata fields still seeds correctly.
//
// For each spec it (1) upserts a `regions` row (deduped by slug) and (2) upserts the
// `tours` SHELL — route + endpoints + region, status `draft`. The generator then FILLS
// the shell (stops + intro/outro brackets) and flips it to `ready`. Re-running is safe:
// the upserts refresh metadata but never clobber a tour's generation state (status) —
// and for a NON-DRAFT tour they hold GEOMETRY too (a generated tour's trigger points were
// computed against its polyline; --force-geometry overrides, after which the tour must be
// regenerated). (No notch here — it's a generation INPUT, not stored tour state.)
//
// Usage (DATABASE_URL injected via dotenvx):
//   dotenvx run -f .env.development -- bun packages/db/seed/seed.ts            # all
//   dotenvx run -f .env.development -- bun packages/db/seed/seed.ts <slug>     # one
//   ... seed.ts <slug> --force-geometry   # update a generated tour's route (then REGENERATE)

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { eq, sql } from 'drizzle-orm'
import { db } from '../src/client'
import { regions, tours } from '../src/schema'
import { TOUR_SPECS, specBySlug, type TourSpec } from './tour-specs'
import { seedPoiOverrides } from './poi-overrides'

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), 'data')

/** Tahoe-region sanity box; a polyline outside this means bad coordinate order. */
const BBOX = { latMin: 38, latMax: 40, lngMin: -121, lngMax: -119 }

/** The frozen route geometry — read tolerantly so a legacy artifact shape still loads. */
interface Geometry {
  polyline: [number, number][]
  distanceMeters: number | null
  durationSeconds: number | null
}

function loadGeometry(slug: string): Geometry {
  const file = join(DATA_DIR, `${slug}.json`)
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    throw new Error(`No frozen artifact at ${file} — run materialize.ts ${slug} first.`)
  }
  const j = JSON.parse(raw) as {
    polyline?: [number, number][]
    provenance?: { distanceMeters?: number; durationSeconds?: number }
  }
  if (!Array.isArray(j.polyline) || j.polyline.length < 2) {
    throw new Error(`${slug}: frozen artifact has no usable polyline (run materialize.ts ${slug}).`)
  }
  return {
    polyline: j.polyline,
    distanceMeters: j.provenance?.distanceMeters ?? null,
    durationSeconds: j.provenance?.durationSeconds ?? null,
  }
}

function validatePolyline(slug: string, polyline: [number, number][]): void {
  for (const [i, pt] of polyline.entries()) {
    if (!Array.isArray(pt) || pt.length !== 2) throw new Error(`${slug}: point ${i} is not [lng, lat]`)
    const [lng, lat] = pt
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) throw new Error(`${slug}: point ${i} not finite`)
    if (lat < BBOX.latMin || lat > BBOX.latMax || lng < BBOX.lngMin || lng > BBOX.lngMax) {
      throw new Error(
        `${slug}: point ${i} [${lng}, ${lat}] outside Tahoe box — coordinates may be [lat, lng] instead of [lng, lat]`,
      )
    }
  }
}

/** Upsert a region by slug; returns its id (cached so a shared region is written once). */
const regionIdCache = new Map<string, string>()
async function upsertRegion(slug: string, displayName: string): Promise<string> {
  const cached = regionIdCache.get(slug)
  if (cached) return cached
  const [row] = await db
    .insert(regions)
    .values({ slug, displayName })
    .onConflictDoUpdate({
      target: regions.slug,
      set: { displayName, updatedAt: sql`now()` },
    })
    .returning({ id: regions.id })
  const id = row!.id
  regionIdCache.set(slug, id)
  return id
}

async function seedTour(spec: TourSpec, forceGeometry: boolean): Promise<void> {
  const geom = loadGeometry(spec.slug)
  validatePolyline(spec.slug, geom.polyline)

  const regionId = await upsertRegion(spec.regionSlug, spec.regionName)
  const origin = spec.waypoints[0]!
  const destination = spec.waypoints[spec.waypoints.length - 1]!

  // GEOMETRY GUARD (audit-caught): a generated tour's stops carry trigger points computed
  // against the polyline it was generated WITH — refreshing geometry under a non-draft tour
  // silently desyncs triggers from the route. For those tours, refresh METADATA only;
  // geometry moves only with an explicit --force-geometry (after which the tour must be
  // REGENERATED before it is driven).
  const existing = (
    await db
      .select({ status: tours.status })
      .from(tours)
      .where(eq(tours.slug, spec.slug))
      .limit(1)
  )[0]
  if (existing && existing.status !== 'draft' && !forceGeometry) {
    await db
      .update(tours)
      .set({ regionId, headline: spec.headline, summary: spec.summary, updatedAt: sql`now()` })
      .where(eq(tours.slug, spec.slug))
    console.log(
      `✓ ${spec.slug} [${spec.regionSlug}] — status=${existing.status}: metadata refreshed; ` +
        `GEOMETRY HELD (pass --force-geometry to update it, then regenerate the tour)`,
    )
    return
  }
  if (existing && existing.status !== 'draft' && forceGeometry) {
    console.warn(
      `⚠ ${spec.slug}: refreshing geometry under a '${existing.status}' tour — its existing ` +
        `stops' trigger points are now STALE; regenerate before driving it.`,
    )
  }

  const [row] = await db
    .insert(tours)
    .values({
      slug: spec.slug,
      regionId,
      headline: spec.headline,
      summary: spec.summary,
      polyline: geom.polyline,
      distanceMeters: geom.distanceMeters,
      durationSeconds: geom.durationSeconds,
      startAnchorName: spec.startAnchorName,
      startAnchorLat: origin.lat,
      startAnchorLng: origin.lng,
      endAnchorName: spec.endAnchorName,
      endAnchorLat: destination.lat,
      endAnchorLng: destination.lng,
      // status defaults to 'draft' (the generator fills the shell). The joke notch is NOT
      // seeded — it's a generation-time INPUT to the generator, not stored tour state.
    })
    .onConflictDoUpdate({
      target: tours.slug,
      // Refresh route + metadata, but NEVER clobber generation state (status) —
      // re-seeding a generated tour must not silently reset it to draft.
      set: {
        regionId,
        headline: spec.headline,
        summary: spec.summary,
        polyline: geom.polyline,
        distanceMeters: geom.distanceMeters,
        durationSeconds: geom.durationSeconds,
        startAnchorName: spec.startAnchorName,
        startAnchorLat: origin.lat,
        startAnchorLng: origin.lng,
        endAnchorName: spec.endAnchorName,
        endAnchorLat: destination.lat,
        endAnchorLng: destination.lng,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: tours.id, slug: tours.slug, status: tours.status })
  console.log(
    `✓ ${row?.slug} [${spec.regionSlug}] — ${geom.polyline.length} points, status=${row?.status} -> ${row?.id}`,
  )
}

async function main() {
  const args = process.argv.slice(2)
  const forceGeometry = args.includes('--force-geometry')
  const slug = args.find((a) => !a.startsWith('--'))
  const specs = slug ? [specBySlug(slug)] : TOUR_SPECS
  for (const spec of specs) {
    if (!spec) throw new Error(`No tour spec for slug "${slug}"`)
    await seedTour(spec, forceGeometry)
  }

  // Canonical content rows ride every seed: the curated upstream-error corrections
  // (idempotent; never clobbers upstream workflow state — see ./poi-overrides.ts).
  await seedPoiOverrides()

  const tourCount = await db.select({ count: sql<number>`count(*)::int` }).from(tours)
  const regionCount = await db.select({ count: sql<number>`count(*)::int` }).from(regions)
  console.log(`tours in DB: ${tourCount[0]?.count ?? 0}, regions: ${regionCount[0]?.count ?? 0}`)
}

await main()
