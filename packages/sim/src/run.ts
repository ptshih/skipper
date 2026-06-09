// Drive-simulator CLI — replay a real corridor + its generated tour and report the
// triggering schedule. Env injected by dotenvx (needs DATABASE_URL):
//
//   dotenvx run -f .env.development -- bun packages/sim/src/run.ts <slug> [flags]
//
// Flags:
//   --mph=<n>        constant drive speed (default 60)
//   --tick=<hz>      simulated GPS fix rate (default 4)
//   --lead=<sec>     speed-adaptive lead time (default 12)
//   --tour=<id>      a specific tour id (default: newest ready tour for the slug)

import { and, asc, desc, eq } from 'drizzle-orm'
import { db } from '@skipper/db'
import { pois, regions, tours, tourStops } from '@skipper/db/schema'
import { DEFAULT_MAX_OFF_ROUTE_M, runDrive } from '@skipper/drive-core'
import type { LngLat, TourStopRef } from '@skipper/drive-core'

const mmss = (sec: number): string => {
  const total = Math.round(sec)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function parseArgs(argv: string[]) {
  const args = argv.slice(2)
  const slug = args.find((a) => !a.startsWith('--'))
  if (!slug) throw new Error('Usage: run.ts <tour-slug> [--mph=60] [--tick=4] [--lead=12] [--tour=<id>]')
  const num = (name: string, def: number) => {
    const raw = args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
    return raw === undefined ? def : Number(raw)
  }
  return {
    slug,
    mph: num('mph', 60),
    tickHz: num('tick', 4),
    leadSeconds: num('lead', 12),
    tourId: args.find((a) => a.startsWith('--tour='))?.split('=')[1],
  }
}

async function main() {
  const { slug, mph, tickHz, leadSeconds, tourId } = parseArgs(process.argv)

  // A tour is the whole self-contained drive now (corridors merged in): its own route +
  // region. Load it by slug (newest ready) or by explicit --tour id.
  const tour = (
    await db
      .select({
        id: tours.id,
        headline: tours.headline,
        regionName: regions.displayName,
        polyline: tours.polyline,
      })
      .from(tours)
      .innerJoin(regions, eq(tours.regionId, regions.id))
      .where(tourId ? eq(tours.id, tourId) : and(eq(tours.slug, slug), eq(tours.status, 'ready')))
      .orderBy(desc(tours.createdAt))
      .limit(1)
  )[0]
  if (!tour) throw new Error(`No ready tour found for "${slug}".`)

  const stopRows = await db
    .select({
      seq: tourStops.seq,
      stopType: tourStops.stopType,
      lat: pois.lat,
      lng: pois.lng,
      name: pois.name,
      triggerRadiusM: tourStops.triggerRadiusM,
      durationMs: tourStops.audioDurationMs,
    })
    .from(tourStops)
    .innerJoin(pois, eq(tourStops.poiId, pois.id))
    .where(eq(tourStops.tourId, tour.id))
    .orderBy(asc(tourStops.seq))

  const stops: TourStopRef[] = stopRows.map((s) => ({
    seq: s.seq,
    lat: s.lat,
    lng: s.lng,
    name: s.name,
    stopType: s.stopType,
    triggerRadiusM: s.triggerRadiusM,
    durationMs: s.durationMs,
  }))

  const report = runDrive(tour.polyline as LngLat[], stops, { mph, tickHz, leadSeconds })

  const r = report
  console.log('\n' + '='.repeat(78))
  console.log(`DRIVE SIM — ${tour.headline} (${tour.regionName}) · tour ${tour.id}`)
  console.log(
    `${(r.totalRouteM / 1609.344).toFixed(1)} mi @ ${r.speedMph} mph → ${mmss(r.driveSec)} drive · ` +
      `${r.fixCount} fixes @ ${r.tickHz} Hz · lead ${r.trigger.leadSeconds}s, floor varies, cone ${r.trigger.headingConeDeg}°`,
  )
  console.log('='.repeat(78))
  console.log('     seq  type     fire@   lead   off-route  stop')
  for (const s of r.stops) {
    const fire = s.fired ? `@${mmss(s.fireSec!)}`.padStart(6) : '  ——  '
    const lead = s.fired ? `${s.leadSec!.toFixed(0)}s`.padStart(5) : '   — '
    const off = `${Math.round(s.offRouteM)}m`.padStart(8)
    const flag = s.excluded ? '⤬' : s.fired ? '·' : '✗'
    console.log(` ${flag}  ${String(s.seq).padStart(2)}  ${(s.stopType ?? '').padEnd(7)} ${fire}  ${lead}  ${off}   ${s.name ?? ''}`)
  }

  const onRoute = r.stops.filter((s) => !s.excluded).length
  console.log('')
  console.log(`Fired ${r.stops.filter((s) => s.fired).length}/${onRoute} on-route stops · narration coverage ${(r.coverageRatio * 100).toFixed(0)}% (${mmss(r.stops.reduce((a, s) => a + (s.durationMs ?? 0) / 1000, 0))} audio).`)
  if (r.excludedOffRoute.length) {
    console.log(`⤬ Off-route (POI > ${DEFAULT_MAX_OFF_ROUTE_M}m from the road, no trigger point): stops ${r.excludedOffRoute.join(', ')} — bad anchor, or POI too far to narrate honestly.`)
  }
  if (r.neverFired.length) {
    console.log(`⚠ On-route but never fired: stops ${r.neverFired.join(', ')} — a real triggering miss to investigate.`)
  }
  if (r.overlaps.length) {
    console.log(`⚠ Audio overlaps (player must queue/duck):`)
    for (const o of r.overlaps) console.log(`   stop ${o.seq} starts ${o.overlapSec.toFixed(0)}s before stop ${o.prevSeq}'s clip ends`)
  } else {
    console.log('✓ No audio overlaps — every clip finishes before the next stop fires.')
  }
  console.log('')
}

main().catch((e) => {
  console.error('\nSimulation failed:', e instanceof Error ? e.message : e)
  process.exitCode = 1
})
