// Drive-simulator CLI — replay a user-owned DRIVE + report the triggering schedule. Env injected
// by dotenvx (needs DATABASE_URL):
//
//   dotenvx run -f .env.development -- bun packages/sim/src/run.ts <driveId> [flags]
//
// Flags:
//   --mph=<n>        constant drive speed (default 60)
//   --tick=<hz>      simulated GPS fix rate (default 4)
//   --lead=<sec>     speed-adaptive lead time (default 12)
//
// V2: a drive is a frozen `selection` of place NARRATIONS (each 1:1 with its poi) along a route.
// We resolve each narration's poi coords/name + form/duration live, then run the SAME trigger
// engine the in-car player uses (engine runDrive) over the raw POI coords (it snaps them).

import { eq, inArray } from 'drizzle-orm'
import { db } from '@skipper/db'
import { drives, narrations, pois, selectionSubject } from '@skipper/db/schema'
import { OFF_ROUTE_MAX_M, METERS_PER_MILE, formatMmss, runDrive } from '@skipper/engine'
import type { LngLat, DriveStopRef } from '@skipper/engine'

function parseArgs(argv: string[]) {
  const args = argv.slice(2)
  const driveId = args.find((a) => !a.startsWith('--'))
  if (!driveId) throw new Error('Usage: run.ts <drive-id> [--mph=60] [--tick=4] [--lead=12]')
  const num = (name: string, def: number) => {
    const raw = args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
    return raw === undefined ? def : Number(raw)
  }
  return { driveId, mph: num('mph', 60), tickHz: num('tick', 4), leadSeconds: num('lead', 12) }
}

async function main() {
  const { driveId, mph, tickHz, leadSeconds } = parseArgs(process.argv)

  const drive = (
    await db
      .select({ id: drives.id, label: drives.label, polyline: drives.polyline, selection: drives.selection })
      .from(drives)
      .where(eq(drives.id, driveId))
      .limit(1)
  )[0]
  if (!drive) throw new Error(`No drive found for id "${driveId}".`)

  // The selection's place narrations, in route order. Resolve each poi's raw coords/name + the
  // narration's form/duration live (the drive freezes structure, not content).
  const narrationItems = (drive.selection ?? []).filter((i) => i.kind === 'narration')
  // ⚠ POI subjects only. A frozen selection can also name a CLUSTER (a fused telling), whose geometry
  // lives in its members rather than in `pois` — the simulator has no path for that yet, so those stops
  // are skipped rather than mis-placed. `selectionSubject` also absorbs the pre-fused item shape.
  const poiIds = narrationItems
    .map((i) => selectionSubject(i))
    .filter((s) => s?.kind === 'poi')
    .map((s) => s!.id)
  const rows = poiIds.length
    ? await db
        .select({
          poiId: narrations.poiId,
          form: narrations.form,
          durationMs: narrations.audioDurationMs,
          lat: pois.lat,
          lng: pois.lng,
          name: pois.name,
        })
        .from(narrations)
        .innerJoin(pois, eq(pois.id, narrations.poiId))
        .where(inArray(narrations.poiId, poiIds))
    : []
  const byPoi = new Map(rows.map((r) => [r.poiId, r]))

  const stops: DriveStopRef[] = []
  for (const item of narrationItems) {
    const subject = selectionSubject(item)
    const n = subject?.kind === 'poi' ? byPoi.get(subject.id) : undefined
    if (!n) continue
    stops.push({
      seq: item.seq,
      lat: n.lat,
      lng: n.lng,
      name: n.name,
      stopType: n.form,
      triggerRadiusM: 120,
      durationMs: n.durationMs,
    })
  }

  const report = runDrive(drive.polyline as LngLat[], stops, { mph, tickHz, leadSeconds })

  const r = report
  console.log('\n' + '='.repeat(78))
  console.log(`DRIVE SIM — ${drive.label ?? '(untitled)'} · drive ${drive.id}`)
  console.log(
    `${(r.totalRouteM / METERS_PER_MILE).toFixed(1)} mi @ ${r.speedMph} mph → ${formatMmss(r.driveSec)} drive · ` +
      `${r.fixCount} fixes @ ${r.tickHz} Hz · lead ${r.trigger.leadSeconds}s, floor varies, cone ${r.trigger.headingConeDeg}°`,
  )
  console.log('='.repeat(78))
  console.log('     seq  type     fire@   lead   off-route  stop')
  for (const s of r.stops) {
    const fire = s.fired ? `@${formatMmss(s.fireSec!)}`.padStart(6) : '  ——  '
    const lead = s.fired ? `${s.leadSec!.toFixed(0)}s`.padStart(5) : '   — '
    const off = `${Math.round(s.offRouteM)}m`.padStart(8)
    const flag = s.excluded ? '⤬' : s.fired ? '·' : '✗'
    console.log(` ${flag}  ${String(s.seq).padStart(2)}  ${(s.stopType ?? '').padEnd(7)} ${fire}  ${lead}  ${off}   ${s.name ?? ''}`)
  }

  const onRoute = r.stops.filter((s) => !s.excluded).length
  console.log('')
  console.log(`Fired ${r.stops.filter((s) => s.fired).length}/${onRoute} on-route stops · narration coverage ${(r.coverageRatio * 100).toFixed(0)}% (${formatMmss(r.stops.reduce((a, s) => a + (s.durationMs ?? 0) / 1000, 0))} audio).`)
  if (r.excludedOffRoute.length) {
    console.log(`⤬ Off-route (POI > ${OFF_ROUTE_MAX_M}m from the road, no trigger point): stops ${r.excludedOffRoute.join(', ')} — bad anchor, or POI too far to narrate honestly.`)
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
