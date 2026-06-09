// Backfill tour_stops trigger points for tours generated before these columns were
// populated. For every stop it snaps the POI onto its tour's frozen polyline
// (the trigger point) and records the route heading of travel there — the SAME
// computation the generator now does at generation time (pipeline/select.ts). The
// in-car player reuses these so it triggers as the car passes the POI's point on
// the ROAD (Tahoe POIs sit 400-650 m off the road) without re-snapping at load.
//
// Idempotent: recomputes and overwrites every targeted stop, so it also serves as
// a re-snap pass if a tour's polyline is ever re-frozen. Pure DB work — no TTS,
// no R2, free to run.
//
//   dotenvx run -f .env.development -- bun packages/generator/src/backfill-trigger-points.ts [slug] [--dry-run]
//
// With no slug, backfills every `ready` tour. With a slug, only that tour.

import { and, asc, eq } from 'drizzle-orm'
import { db } from '@skipper/db'
import { pois, tours, tourStops } from '@skipper/db/schema'
import { cumulativeMeters, nearestOnRoute, routeBearingAt } from './pipeline/geo'
import type { LngLat } from './pipeline/geo'

interface Args {
  slug?: string
  dryRun: boolean
}

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2)
  return { slug: args.find((a) => !a.startsWith('--')), dryRun: args.includes('--dry-run') }
}

async function main() {
  const { slug, dryRun } = parseArgs(process.argv)

  // Tours to backfill, each with its own frozen polyline (the route lives on the tour
  // now — corridors merged in — so we snap against the exact geometry it was paced on).
  const tourRows = await db
    .select({
      tourId: tours.id,
      tourName: tours.headline,
      polyline: tours.polyline,
    })
    .from(tours)
    .where(slug ? and(eq(tours.status, 'ready'), eq(tours.slug, slug)) : eq(tours.status, 'ready'))

  if (tourRows.length === 0) {
    console.log(slug ? `No ready tours for slug "${slug}".` : 'No ready tours.')
    return
  }

  let totalStops = 0
  for (const t of tourRows) {
    const polyline = t.polyline as LngLat[]
    const cum = cumulativeMeters(polyline)

    const stops = await db
      .select({ stopId: tourStops.id, seq: tourStops.seq, name: pois.name, lat: pois.lat, lng: pois.lng })
      .from(tourStops)
      .innerJoin(pois, eq(tourStops.poiId, pois.id))
      .where(eq(tourStops.tourId, t.tourId))
      .orderBy(asc(tourStops.seq))

    console.log(`\n${t.tourName} · tour ${t.tourId} — ${stops.length} stops`)
    const updates = stops.map((s) => {
      const pos = nearestOnRoute(polyline, cum, [s.lng, s.lat])
      const heading = Math.round(routeBearingAt(polyline, pos.index)) % 360
      console.log(
        `  [${String(s.seq).padStart(2)}] ${s.name}: off-route ${Math.round(pos.offRouteM)} m → ` +
          `trigger (${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}), heading ${heading}°`,
      )
      return db
        .update(tourStops)
        .set({ triggerLat: pos.lat, triggerLng: pos.lng, approachHeadingDeg: heading })
        .where(eq(tourStops.id, s.stopId))
        .returning({ id: tourStops.id })
    })
    totalStops += stops.length
    const [first, ...rest] = updates
    // db.batch co-commits this tour's stop updates in one neon-http round trip.
    if (!dryRun && first) await db.batch([first, ...rest])
  }

  console.log(
    `\n${dryRun ? 'DRY RUN — would backfill' : 'Backfilled'} ${totalStops} stops across ${tourRows.length} tour(s).`,
  )
}

main().catch((e) => {
  console.error('\nBackfill failed:', e instanceof Error ? e.message : e)
  process.exitCode = 1
})
