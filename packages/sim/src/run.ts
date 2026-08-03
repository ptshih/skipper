// Drive-simulator CLI — replay a user-owned DRIVE + report the triggering schedule. Env injected
// by dotenvx (needs DATABASE_URL):
//
//   dotenvx run -f .env.development -- bun packages/sim/src/run.ts <driveId> [flags]
//
// Flags:
//   --mph=<n>        constant drive speed (default 60)
//   --tick=<hz>      simulated GPS fix rate (default 4)
//   --lead=<sec>     speed-adaptive lead time (default 12)
//   --gpx=<path>     ALSO write an Xcode-replayable GPX of this drive's route (see below)
//   --gpx-hz=<n>     GPX waypoint cadence (default 1 Hz — Xcode emits ~1 update/s regardless)
//
// V2: a drive is a frozen `selection` of place NARRATIONS (each 1:1 with its poi) along a route.
// We resolve each narration's poi coords/name + form/duration live, then run the SAME trigger
// engine the in-car player uses (engine runDrive), which snaps each stop onto the route.
//
// ⚠ The point of this tool is that it agrees with the car. That means resolving a stop's geometry the
// SAME way `rowsToCorpus` (apps/api/src/drives.ts) does — speakable anchor when present, trigger floor
// from kind + anchored — not approximating it. A constant floor here silently turns the report into
// fiction for any stop whose real floor differs, which is most of them.
//
// ── --gpx: the DESK DRIVE ────────────────────────────────────────────────────────────────────────────
// Why this lives here and not in a script of its own: the GPX must walk the SAME polyline, at the SAME
// cadence, as the report printed above it — otherwise the file you replay on the phone and the schedule
// you read on the terminal are two different drives, and disagreement between them is unreadable.
// `generateDrive` is the shared walk, so both come from one call.
//
// Feed the file to Xcode (Debug ▸ Simulate Location ▸ Add GPX File to Workspace) with a PHYSICAL phone
// attached; it replays the route through real CoreLocation. That is the only desk path that exercises
// the live `expo-location` watch, the permission flow, the accuracy gate, watch teardown, and
// background/lock-screen Now Playing. (Founder call 2026-08-03: this + the in-app simulated source
// together stand in for RISK-1's real drive.)
//
// ⚠ **iOS may not simulate SPEED, and that changes what the pass proves.** Community consensus is that
// `CLLocation.speed`/`course` come back as the -1 sentinel under GPX replay, while Apple's own
// "Simulating location in tests" says Xcode updates "location, elevation, and velocity". They cannot
// both be right, so we emit BOTH `<time>` and `<speed>` — Xcode prefers `<time>` when both are present,
// and the `<speed>` tag costs nothing if it is ignored. If speed does arrive as -1, `saneNonNeg` maps it
// to 0 (apps/mobile/src/lib/gps-util.ts), which means: the speed-adaptive lead contributes nothing and
// every stop fires off its bare `trigger_radius_m` floor instead. Stops still fire — the plumbing is
// what this pass is for — but the LEAD TIMING above is not what you are watching. Read the printed
// schedule as the speed-adaptive truth and the phone as the plumbing truth; use the in-app simulated
// source (apps/mobile/src/lib/gps.ts `simulatedSource`) when you want real speeds on the device.
// ⚠ A second-order trap worth naming before it wastes an afternoon: at speed 0 the accuracy ceiling
// also collapses to its 50 m floor (`accuracyCeilingM`). If Xcode's simulated `horizontalAccuracy` is
// poor or negative, EVERY fix is rejected and NOTHING fires — that is a simulation artifact, not a bug
// in the trigger engine. Don't "fix" it.

import { writeFileSync } from 'node:fs'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@skipper/db'
import { drives, narrations, pois, selectionSubject } from '@skipper/db/schema'
import {
  OFF_ROUTE_MAX_M,
  METERS_PER_MILE,
  formatMmss,
  generateDrive,
  runDrive,
  triggerRadiusForKind,
} from '@skipper/engine'
import type { LngLat, DriveStopRef } from '@skipper/engine'

function parseArgs(argv: string[]) {
  const args = argv.slice(2)
  const driveId = args.find((a) => !a.startsWith('--'))
  if (!driveId) {
    throw new Error('Usage: run.ts <drive-id> [--mph=60] [--tick=4] [--lead=12] [--gpx=<path> [--gpx-hz=1]]')
  }
  const num = (name: string, def: number) => {
    const raw = args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
    return raw === undefined ? def : Number(raw)
  }
  const str = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
  return {
    driveId,
    mph: num('mph', 60),
    tickHz: num('tick', 4),
    leadSeconds: num('lead', 12),
    gpxPath: str('gpx'),
    gpxHz: num('gpx-hz', 1),
  }
}

// A fixed epoch, so re-running the same drive produces a byte-identical file — a GPX that churns on
// every run is one you can't diff, and Xcode only ever reads the DELTAS between stamps anyway.
const GPX_EPOCH_MS = Date.parse('2026-01-01T00:00:00Z')

/**
 * Render the drive's route as an Xcode-replayable GPX.
 *
 * ⚠ `<wpt>` ONLY — Xcode ignores `<trk>`/`<trkseg>` entirely, so a track-shaped GPX replays as a
 * single stationary point and the pass silently tests nothing.
 */
function toGpx(fixes: { lat: number; lng: number; speedMps: number; tSec: number }[], label: string): string {
  const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!)
  const pts = fixes.map((f) => {
    const time = new Date(GPX_EPOCH_MS + f.tSec * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
    return (
      `  <wpt lat="${f.lat.toFixed(6)}" lon="${f.lng.toFixed(6)}">\n` +
      `    <time>${time}</time>\n` +
      `    <speed>${f.speedMps.toFixed(2)}</speed>\n` +
      `  </wpt>`
    )
  })
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<gpx version="1.1" creator="skipper-sim">\n` +
    `  <!-- ${esc(label)} — replay in Xcode: Debug > Simulate Location > Add GPX File to Workspace -->\n` +
    pts.join('\n') +
    '\n</gpx>\n'
  )
}

async function main() {
  const { driveId, mph, tickHz, leadSeconds, gpxPath, gpxHz } = parseArgs(process.argv)

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
          // ⚠ kind + the speakable anchor are what make a stop's trigger geometry REAL. Without them
          // this CLI cannot reproduce what the car does — see the stop assembly below.
          kind: pois.kind,
          speakableLat: pois.speakableLat,
          speakableLng: pois.speakableLng,
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
    // Mirror `rowsToCorpus` in apps/api/src/drives.ts exactly: place the stop on its road-snapped
    // speakable anchor when it has one, and derive the trigger floor from kind + anchored.
    //
    // ⚠ This used to hardcode `triggerRadiusM: 120`, which quietly made the simulator disagree with
    // the road — the one thing @skipper/engine exists to prevent. 120 is neither value the live path
    // ever uses: an ANCHORED stop fires off the tight 250 m floor, and an un-anchored natural feature
    // keeps its kind-aware floor, which runs to 1500 m for a peak and 1200 m for a lake or valley. So
    // the CLI was reporting "on-route but never fired" for exactly the areal features you would open
    // it to diagnose, and reporting them tighter-than-real for the anchored ones.
    const anchored = n.speakableLat != null && n.speakableLng != null
    stops.push({
      seq: item.seq,
      lat: n.speakableLat ?? n.lat,
      lng: n.speakableLng ?? n.lng,
      name: n.name,
      stopType: n.form,
      triggerRadiusM: triggerRadiusForKind(n.kind ?? null, anchored),
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

  if (gpxPath) {
    // Same polyline, same walk as the report above — see the --gpx note in the header for why that
    // shared origin is the whole point.
    const gpxFixes = generateDrive(drive.polyline as LngLat[], { mph, tickHz: gpxHz })
    writeFileSync(gpxPath, toGpx(gpxFixes, `${drive.label ?? 'drive'} · ${drive.id} · ${mph} mph`), 'utf8')
    const wallSec = gpxFixes[gpxFixes.length - 1]?.tSec ?? 0
    console.log('')
    console.log(
      `📍 GPX → ${gpxPath} · ${gpxFixes.length} waypoints @ ${gpxHz} Hz · replays in ${formatMmss(wallSec)} of REAL time.`,
    )
    console.log(
      '   Xcode ▸ Debug ▸ Simulate Location ▸ Add GPX File to Workspace, with the phone attached.',
    )
    console.log(
      '   ⚠ If nothing fires, read the --gpx note at the top of this file BEFORE touching the engine —',
    )
    console.log('     iOS may report speed/accuracy as the -1 sentinel, which is a simulation artifact.')
  }
  console.log('')
}

main().catch((e) => {
  console.error('\nSimulation failed:', e instanceof Error ? e.message : e)
  process.exitCode = 1
})
