// audit-endpoint-routability — can a rider actually DRIVE to every curated endpoint? SPENDS $ (one
// Google Routes call per anchor) on --apply. Writes NOTHING.
//
// THE FAILURE IT EXISTS FOR. A curated endpoint is a Google Places row, and Places answers with the
// FEATURE's location — for a lake, that is the water. `Spooner Lake` was stored at 39.107603,
// -119.908998, which is the lake surface; the nearest thing Routes could snap it to was the gated
// NF-038 forest track on the far side, so Carson City → Spooner Lake came back 71 minutes each way
// instead of 19 on US-50. The rider was shown a 143-minute round trip with two stories on it and a
// "Make this drive" button underneath. Nothing errored. Every number on that card was correct, and the
// only place the truth appeared was Google's own `warnings` array, which nothing read.
// See docs/decisions/undrivable-endpoint-anchors.md.
//
// ⚠ WHY A SWEEP AND NOT JUST THE WIRE GATE. apps/api refuses a restricted route at both billed sites,
// which protects the RIDER — but it protects them by taking the drive away, one silent 422 at a time,
// and the log line it emits carries no place name (INV-13: it is a rider's destination). So the wire
// can tell an operator that something is wrong and can never tell them WHICH ANCHOR. This can: it runs
// offline, over the curated set, and prints names.
//
// ⚠ TWO SIGNALS, AND THE SECOND IS NOT REDUNDANT. `restricted` is Google's own warning and is the
// reliable one. `slow` is the backstop for the anchor Google routes to without complaint but only via
// something no one would drive — an implied average speed far below the region's roads. A clean sweep
// on both is what "this endpoint is real" means.
//
// Blast radius: SPENDS $ on --apply (Routes calls; no LLM, no TTS, no writes). Read-only against the
// DB in every mode. Exits 1 when any anchor is flagged, so it can gate a release later.
// Conforms to docs/guides/ops-scripts-sop.md.
//
//   preview:  dotenvx run -f .env.development -- bun packages/studio/src/audit-endpoint-routability.ts --region lake-tahoe
//   apply:    ... --region lake-tahoe --apply         probe every endpoint (one Routes call each)
//   ... --limit 10                                    probe only the first N (cheap spot-check)
//   ... --max-cost 0.25                               refuse to start if the estimate exceeds this
//   ... --apply --snap                                ALSO propose an access point per flagged anchor
//                                                     (a few more Routes calls each; still writes nothing)

import { and, between, eq } from 'drizzle-orm'
import { db } from '@skipper/db'
import { places } from '@skipper/db/schema'
import { haversineMeters, type LngLat } from '@skipper/engine'
import { materializeRoute } from '@skipper/routing'
import { announce, maxCostFlag, numericFlag, parseFlags } from './pipeline/ops'
import { requireRegionBbox, resolveRegion } from './pipeline/region'
import { withRetry } from './pipeline/http'
import { GOOGLE_READY } from './config'

/**
 * What one Compute Routes call costs, for the pre-run estimate only.
 *
 * ⚠ A PRE-SPEND BOUND, so it is deliberately the LIST price rather than anything netted down by
 * credits or volume tiers — an estimate that under-promises ahead of a paid run is the failure that
 * actually costs money (the same argument `curate-places` makes about its token figures). The real
 * spend is whatever Google bills; this number only decides whether `--max-cost` lets the run start.
 */
const ROUTES_CALL_USD = 0.005

/**
 * Below this implied average speed, a route is not a road trip.
 *
 * ⚠ A HEURISTIC, AND IT IS RANKED BELOW `restricted` ON PURPOSE — it flags for a human to look at,
 * never a refusal. 20 km/h (~12 mph) is far under anything a public road sustains door to door,
 * including a slow mountain two-lane with stops: every drive frozen in `drives` to date averages
 * 49–65 km/h. A short probe leg through one town centre can dip, which is why the flag prints the leg
 * it measured instead of just a verdict.
 */
const MIN_AVG_KMH = 20

/**
 * Below this ROUTE length, the SPEED heuristic is switched off — not the probe.
 *
 * ⚠ THE DISTINCTION IS THE POINT. On a 400 m hop the implied average is dominated by the first
 * junction and would flag half a town centre, so `slow` is noise there. The `restricted` warning is
 * not: a last 400 m up a private lane is exactly the defect this sweep is for, and skipping the whole
 * probe to avoid a noisy heuristic would leave those anchors unmeasured while the summary called them
 * clean. Suppress the unreliable signal, never the reliable one.
 *
 * ⚠ MEASURED ON THE ROUTE, NOT ON THE STRAIGHT LINE, and the difference is not academic — it was a bug
 * here. Google SNAPS a waypoint to the road network, and a resort pin sitting up on the mountain can
 * snap the better part of a kilometre: `Olympic Valley` is 1.3 km from its origin in a straight line
 * and 0.5 km by road. Trusting the straight line therefore armed the heuristic on exactly the
 * junction-dominated hops it exists to ignore, and the first sweep duly flagged two of them. The
 * quantity that produces the noise is the one that has to gate it.
 */
const MIN_SPEED_ROUTE_METERS = 800

interface Anchor {
  id: string
  name: string
  primaryType: string | null
  lat: number
  lng: number
  featured: boolean
  accessLat: number | null
  accessLng: number | null
}

/**
 * The coordinate a DRIVE is actually routed to for this anchor.
 *
 * ⚠ IT MUST AGREE WITH `routeWaypoints` (apps/api/src/drives.ts) OR THIS SWEEP MEASURES FICTION. The
 * two are separate copies of one rule — the repeated bug class in this codebase — and they fail in
 * opposite, equally useless directions: probing the PIN after an access point is set re-flags every
 * corrected anchor forever, so the exit code stops meaning anything; probing the access point when the
 * API ignores it would pass anchors that still send riders up a gated road. Same fallback, same order.
 */
const routedPoint = (a: Anchor): { lat: number; lng: number } =>
  a.accessLat != null && a.accessLng != null ? { lat: a.accessLat, lng: a.accessLng } : { lat: a.lat, lng: a.lng }

/**
 * The origin a candidate is probed FROM: its nearest FEATURED anchor.
 *
 * ⚠ WHY FEATURED, AND NOT SIMPLY THE NEAREST ANCHOR. The probe has to hold one end KNOWN-GOOD, or a
 * restricted leg between two suspect pins tells you nothing about either. `featured` is the curator's
 * popular-hub subset — towns and resorts (Carson City, Incline Village, Kings Beach, Genoa) — which
 * resolve to street addresses on public roads essentially by construction, whereas the flagged class
 * is feature centroids: lakes, beaches, summits, park polygons.
 *
 * ⚠ NEAREST, so the leg stays short and cheap and any warning is about the last mile rather than
 * something incidental 40 miles away.
 *
 * Returns null when the region has no featured anchor other than the candidate — the caller reports
 * that rather than silently falling back, because a fallback origin would quietly change what the
 * whole sweep measured.
 */
function originFor(candidate: Anchor, featured: Anchor[]): Anchor | null {
  let best: Anchor | null = null
  let bestM = Infinity
  for (const f of featured) {
    if (f.id === candidate.id) continue
    const m = haversineMeters([candidate.lng, candidate.lat] as LngLat, [f.lng, f.lat] as LngLat)
    if (m < bestM) {
      bestM = m
      best = f
    }
  }
  return best
}

type Verdict = 'ok' | 'restricted' | 'slow' | 'skipped' | 'error'

interface Probe {
  anchor: Anchor
  origin: Anchor | null
  verdict: Verdict
  km?: number
  minutes?: number
  kmh?: number
  warnings?: string[]
  note?: string
  /** The route Google returned, kept only so `--snap` can search along it. */
  polyline?: LngLat[]
}

/**
 * How many probes the access-point search may spend per flagged anchor.
 *
 * ⚠ IT IS A CEILING, NOT A TARGET — the search stops as soon as it has bracketed a single polyline
 * segment, so a short route costs far fewer. 10 halvings resolve a ~1000-point polyline exactly, which
 * is why this is the number: the first cut used 6 and stopped ~1.5% of the route early, reporting
 * Baldwin Beach 899 m short where the true turn-off was ~861 m. Harmless for a proposal a human signs
 * off, but a tool that quietly rounds in one direction should say so or stop doing it.
 */
const SNAP_PROBES = 10

/**
 * Where a car can actually be sent for a place whose own pin is not drivable.
 *
 * ⚠ THE FURTHEST CLEAN POINT ALONG ITS OWN ROUTE, not the nearest highway. Both work, and this one is
 * strictly better: it stops as close to the place as the public road allows, so the drive ends at the
 * turn-off rather than wherever a through-road happens to pass. Measured against the alternative on the
 * CA-89 cluster, nearest-highway left the rider 292–861 m out; this cannot do worse and often does
 * better, because part of an access road is frequently unrestricted.
 *
 * ⚠ IT ASSUMES THE RESTRICTION IS A SUFFIX — a clean run out from the origin, then the gated bit at the
 * end. That is what an undrivable ENDPOINT looks like, and it is why this only runs on flagged anchors.
 * A restricted segment in the MIDDLE of an otherwise fine route breaks the assumption, and the search
 * would then land somewhere arbitrary before it — which is why the caller prints the distance from the
 * proposal to the place and a human signs it off. It never writes.
 */
async function findAccessPoint(
  origin: Anchor,
  polyline: LngLat[],
): Promise<{ point: LngLat; probes: number } | null> {
  if (polyline.length < 2) return null
  // lo is known clean (the origin end), hi is known restricted (the place). Invariant held throughout.
  let lo = 0
  let hi = polyline.length - 1
  let probes = 0
  for (let i = 0; i < SNAP_PROBES && hi - lo > 1; i++) {
    const mid = Math.floor((lo + hi) / 2)
    const p = polyline[mid]!
    try {
      const r = await materializeRoute([
        { label: origin.name, lat: origin.lat, lng: origin.lng },
        { label: 'access probe', lat: p[1], lng: p[0] },
      ])
      probes++
      if (r.restricted) hi = mid
      else lo = mid
    } catch {
      // A probe that never resolved bought nothing and proves nothing — stop rather than let a network
      // blip narrow the range in a direction the evidence does not support.
      break
    }
  }
  return lo === 0 ? null : { point: polyline[lo]!, probes }
}

function line(p: Probe): string {
  const tag = { ok: '  ok  ', restricted: 'FLAG  ', slow: 'SLOW  ', skipped: ' skip ', error: 'ERROR ' }[p.verdict]
  const where = `${p.anchor.name} (${p.anchor.primaryType ?? 'locality'})`
  const from = p.origin ? ` from ${p.origin.name}` : ''
  const nums =
    p.km !== undefined && p.minutes !== undefined && p.kmh !== undefined
      ? `  ${p.km.toFixed(1)}km ${Math.round(p.minutes)}min avg ${Math.round(p.kmh)}km/h`
      : ''
  const why = p.note ? `  — ${p.note}` : ''
  return `${tag}${where}${from}${nums}${why}`
}

async function main() {
  const flags = parseFlags(process.argv.slice(2), { valueFlags: ['region', 'limit', 'max-cost'] })
  const apply = flags.has('apply')
  // ⚠ REQUIRED, no default (docs/decisions/no-default-region.md) — a defaulted region billed the wrong
  // corpus once already, and this CLI spends per anchor in whatever region it resolves.
  const region = await resolveRegion(flags.value('region'))
  const bbox = requireRegionBbox(region)
  const limit = numericFlag(flags, 'limit', { fallback: Infinity, min: 0 })
  const maxCost = maxCostFlag(flags)
  // Only meaningful with --apply: it searches along routes the sweep itself had to fetch first.
  const snap = flags.has('snap')

  announce({ tool: 'audit-endpoint-routability', blast: ['SPENDS $'], apply })
  console.log(`Region: ${region.displayName} (${region.slug})\n`)

  const rows = await withRetry(
    () =>
      db
        .select({
          id: places.id,
          name: places.name,
          primaryType: places.primaryType,
          lat: places.lat,
          lng: places.lng,
          featured: places.featured,
          accessLat: places.accessLat,
          accessLng: places.accessLng,
        })
        .from(places)
        .where(
          and(
            eq(places.endpointEligible, true),
            // Inclusive on all four edges, matching `pointInRegionBbox` and the API's own anchor query
            // — a region's membership rule decided differently here would audit a different set than
            // the picker offers.
            between(places.lat, bbox.swLat, bbox.neLat),
            between(places.lng, bbox.swLng, bbox.neLng),
          ),
        )
        .orderBy(places.name),
    { label: 'audit-endpoint-routability.anchors' },
  )

  if (rows.length === 0) {
    console.log('No endpoint-eligible anchors in this region. Nothing to audit.')
    return
  }

  const featured = rows.filter((r) => r.featured)
  const candidates = rows.slice(0, Number.isFinite(limit) ? limit : rows.length)
  // ⚠ WORST CASE WHEN --snap IS ON, deliberately. How many anchors get snapped is not knowable until the
  // sweep has run, so the bound assumes EVERY candidate is flagged. `--max-cost` exists to stop a run
  // before it spends; an estimate that priced the base sweep while --snap quietly multiplied it would be
  // bounding one quantity with a number derived from a different one — the trap `numericFlag` documents.
  const estimate = candidates.length * ROUTES_CALL_USD * (snap ? 1 + SNAP_PROBES : 1)

  console.log(
    `${rows.length} endpoint-eligible anchor(s), ${featured.length} of them featured (the probe origins).`,
  )
  if (featured.length === 0) {
    // ⚠ Not a crash, but not a quiet degradation either: with no known-good origin the sweep cannot
    // hold one end fixed, and saying so is the difference between "clean" and "did not measure".
    console.log(
      '⚠ NO FEATURED ANCHORS — every probe would need an unvetted origin, so nothing can be measured.\n' +
        '  Mark the region\'s obvious hubs (its towns) as featured in the admin Places view first.',
    )
    process.exitCode = 1
    return
  }
  console.log(`Probing ${candidates.length} of them — one Google Routes call each, ~$${estimate.toFixed(2)}.\n`)

  if (estimate > maxCost) {
    throw new Error(
      `Estimated $${estimate.toFixed(2)} exceeds --max-cost $${maxCost.toFixed(2)} — narrow with --limit, or raise the cap.`,
    )
  }

  if (!apply) {
    // ⚠ THE DRY RUN MAKES NO PAID CALLS (SOP) — it prints the plan, including which origin each anchor
    // would be measured from, because a wrong origin is the one way this sweep could be measuring
    // something other than what it claims.
    for (const a of candidates) {
      const o = originFor(a, featured)
      const m = o ? haversineMeters([a.lng, a.lat] as LngLat, [o.lng, o.lat] as LngLat) : 0
      console.log(`  would probe  ${a.name} (${a.primaryType ?? 'locality'})  from ${o?.name ?? '(none)'}  ${(m / 1000).toFixed(1)}km`)
    }
    console.log(`\nDry run — no Routes calls made, nothing written. Re-run with --apply to spend ~$${estimate.toFixed(2)}.`)
    return
  }

  if (!GOOGLE_READY()) {
    throw new Error('GOOGLE_MAPS_API_KEY is not set (a Routes-API-enabled key on a billed project).')
  }

  const probes: Probe[] = []
  let billed = 0
  for (const anchor of candidates) {
    const origin = originFor(anchor, featured)
    if (!origin) {
      probes.push({ anchor, origin: null, verdict: 'skipped', note: 'no featured anchor to probe from' })
      continue
    }
    try {
      // ⚠ Both ends via `routedPoint`: an origin with its own access point must be probed the way a
      // drive would leave it, or the leg measured is not a leg any rider takes.
      const from = routedPoint(origin)
      const to = routedPoint(anchor)
      const route = await materializeRoute([
        { label: origin.name, ...from },
        { label: anchor.name, ...to },
      ])
      // ⚠ COUNTED HERE, THE INSTANT THE CALL RESOLVES — that resolve IS the bill, and a tally kept
      // anywhere below would lose exactly the probes that spent and then threw (CLAUDE.md: a paid run
      // reports what it BILLED, not what it planned).
      billed++
      const km = route.distanceMeters / 1000
      const minutes = route.durationSeconds / 60
      const kmh = minutes > 0 ? km / (minutes / 60) : 0
      // Short leg → `restricted` still counts; only the noisy `slow` heuristic is muted.
      const speedTrusted = route.distanceMeters >= MIN_SPEED_ROUTE_METERS
      // ⚠ RESTRICTED OUTRANKS SLOW, matching the order apps/api answers them in: an undrivable anchor
      // trips both, and the warning is the one that says why.
      const verdict: Verdict = route.restricted ? 'restricted' : speedTrusted && kmh < MIN_AVG_KMH ? 'slow' : 'ok'
      probes.push({
        anchor,
        origin,
        verdict,
        km,
        minutes,
        kmh,
        warnings: route.warnings,
        polyline: route.polyline,
        // The raw warning is the evidence, so it is printed verbatim rather than summarised — a phrase
        // `RESTRICTED_ROAD_WARNINGS` does not know about has to be visible to a human here, since it is
        // invisible everywhere else by design.
        note: route.warnings.length ? route.warnings.join(' | ') : undefined,
      })
    } catch (e) {
      probes.push({ anchor, origin, verdict: 'error', note: e instanceof Error ? e.message : String(e) })
    }
  }

  for (const p of probes) console.log(line(p))

  const flagged = probes.filter((p) => p.verdict === 'restricted' || p.verdict === 'slow')
  const skipped = probes.filter((p) => p.verdict === 'skipped')
  const errored = probes.filter((p) => p.verdict === 'error')

  console.log(`\n${billed} Routes call(s) billed — ~$${(billed * ROUTES_CALL_USD).toFixed(2)}.`)
  // ⚠ NO SILENT CAPS. A sweep that skipped anchors, or errored on them, has NOT cleared them — and a
  // summary that only counted flags would read as "everything else is fine".
  if (skipped.length) console.log(`${skipped.length} skipped (listed above) — NOT audited.`)
  if (errored.length) console.log(`${errored.length} errored (listed above) — NOT audited.`)
  if (Number.isFinite(limit) && rows.length > candidates.length) {
    console.log(`${rows.length - candidates.length} anchor(s) beyond --limit were not probed.`)
  }

  // --snap: for each RESTRICTED anchor, propose the access point an operator should store against it.
  // Read-only, like the rest of this CLI — it prints coordinates, it never writes them.
  if (snap) {
    const restricted = probes.filter((p) => p.verdict === 'restricted' && p.polyline && p.origin)
    if (restricted.length === 0) {
      console.log('\n--snap: nothing restricted to snap.')
    } else {
      console.log(
        `\n--snap: searching each restricted route for the furthest point a car can still be sent to` +
          ` (up to ${SNAP_PROBES} Routes calls each, ~$${(restricted.length * SNAP_PROBES * ROUTES_CALL_USD).toFixed(2)}).\n`,
      )
      for (const p of restricted) {
        const found = await findAccessPoint(p.origin!, p.polyline!)
        billed += found?.probes ?? 0
        if (!found) {
          console.log(`  ${p.anchor.name.padEnd(31)} NO CLEAN POINT — the restriction starts at the origin end`)
          continue
        }
        const short = haversineMeters(found.point, [p.anchor.lng, p.anchor.lat] as LngLat)
        console.log(
          `  ${p.anchor.name.padEnd(31)} access ${found.point[1].toFixed(6)},${found.point[0].toFixed(6)}` +
            `  (${Math.round(short)}m short of the pin)`,
        )
      }
      // ⚠ The distance is printed for every proposal because it is the ONE number that says whether the
      // proposal is sane. A few hundred metres is a turn-off; several kilometres means the suffix
      // assumption in findAccessPoint did not hold for that route and the answer is arbitrary.
      console.log(
        `\n  Review the "short of the pin" column before storing any of these — a proposal more than a\n` +
          `  few hundred metres out is the search landing before an unrelated restricted segment, not\n` +
          `  the place's own turn-off.`,
      )
    }
  }

  if (flagged.length > 0) {
    console.log(
      `\n${flagged.length} of ${billed} probed anchor(s) are not drivable as curated. Each is a pin Places put on\n` +
        `the FEATURE rather than on a road — re-point it at the place a car can actually stop (a visitor\n` +
        `centre, a trailhead lot, a marina gate) in the admin Places view, or clear its endpoint role there.\n` +
        `⚠ curate-places upserts lat/lng last-write-wins, so a re-curation of this region will restore the\n` +
        `  bad pin — re-run this sweep after any curate run.`,
    )
    process.exitCode = 1
  } else if (billed > 0) {
    console.log(`\nAll ${billed} probed anchor(s) are reachable on public roads.`)
  }
}

await main()
