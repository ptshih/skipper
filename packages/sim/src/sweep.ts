// Trigger parameter SWEEP — replay ONE drive across a GRID of trigger settings and report which
// stops change outcome, where. Env injected by dotenvx (needs DATABASE_URL):
//
//   dotenvx run -f .env.development -- bun packages/sim/src/sweep.ts <driveId> [flags]
//
// Flags (the default ranges live in DEFAULT_RADIUS_RANGE / DEFAULT_LEAD_RANGE below, and both are
// widened to always include today's shipping value — see `withBaseline`):
//   --radius=<min:max:step>  ANCHORED trigger floor (m) to sweep
//   --lead=<min:max:step>    speed-adaptive lead (s) to sweep
//   --mph=<n>                constant drive speed (default matches run.ts, so the two CLIs agree)
//                            ⚠ IGNORED with --trace: the speeds are whatever the road actually did
//   --trace=<path>           replay a RECORDED drive (apps/mobile writes these; see @skipper/engine
//                            trace.ts) instead of a synthetic one — the mode this tool exists for
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
// `packages/engine/src/geo.ts` says of `ANCHORED_TRIGGER_RADIUS_M` that the final number "is NOT
// desk-tunable; it's pinned on the next on-device Tahoe re-drive against the POIs that failed" —
// and trigger-precision-spec.md step 2 has been parked on that since June. The reason a drive is a
// bad instrument for it is arithmetic: **a car samples one parameter value per trip.** A sweep reads
// the whole curve from a single pass of input, which is the one thing driving genuinely cannot do.
// docs/designs/desk-drive-harness.md §4.5.
//
// ── WHAT IT SWEEPS, AND WHAT IT DELIBERATELY DOES NOT ────────────────────────────────────────────
// The radius axis varies the floor of ANCHORED stops only, because that is exactly what the constant
// governs (`triggerRadiusForKind(kind, anchored)`). An un-anchored pin keeps its kind-aware
// `radiusForKind` floor — a different lever, and shrinking it would REGRESS the ~99 Tahoe POIs with no
// anchor (trigger-precision §2: "NOT a blanket shrink"). Sweeping both together would blend two
// questions into one curve and answer neither.
//
// ── THE HONESTY CONSTRAINT (printed in the output too, on purpose) ───────────────────────────────
// ⚠ The two input modes are NOT equivalent evidence, and the output says which one produced it.
// With `--trace` the fixes are real and run through the SAME `createFixMapper` → `TriggerEngine`
// pipeline the phone runs, so a fix rejected here was rejected in the car — that is what geo.ts:54
// was waiting for. It is still ONE drive in ONE set of conditions, so a floor fitted to its exact
// edge is overfitted to that afternoon.
//
// Over SYNTHETIC fixes this is much weaker evidence than over a recorded trace: `generateDrive` emits
// fixes exactly on the polyline at exact speed and bearing, and the radius exists to absorb precisely
// the GPS error that synthetic fixes do not contain. So this shows what the GEOMETRY does, not what
// the ROAD does. It is still worth running — it finds stops that cannot fire at ANY setting, and it
// shows where a parameter stops mattering at all — but it must not be mistaken for the re-drive.
//
// READ-ONLY: two SELECTs and the pure engine. It writes nothing, calls no paid API, spends nothing.

import { eq, inArray } from 'drizzle-orm'
import { db } from '@skipper/db'
import { drives, narrations, pois, selectionSubject } from '@skipper/db/schema'
import { readFileSync } from 'node:fs'
import {
  ANCHORED_TRIGGER_RADIUS_M,
  driveTrace,
  parseTraceEnvelope,
  snapStopsToRoute,
  traceMatchesRoute,
  DEFAULT_TRIGGER,
  METERS_PER_MILE,
  MPH_TO_MPS,
  OFF_ROUTE_MAX_M,
  formatMmss,
  runDrive,
  triggerRadiusForKind,
} from '@skipper/engine'
import type { DriveStopRef, LngLat, RawFix, SimReport } from '@skipper/engine'

const DEFAULT_RADIUS_RANGE = '100:600:50'
const DEFAULT_LEAD_RANGE = '8:16:2'
// Matches run.ts's default so the two CLIs describe the same drive unless you ask them not to.
const DEFAULT_MPH = 60

// Every cell is a full `runDrive`, so a fat-fingered `--radius=0:10000:1` would sit there for minutes
// looking like a hang. Refuse loudly with the arithmetic instead. A cell is single-digit milliseconds,
// so this bound protects the operator from a typo — it is not a statement that the engine is slow.
const MAX_CELLS = 500

const round2 = (n: number): number => Math.round(n * 100) / 100

function parseRange(spec: string, flag: string): number[] {
  const parts = spec.split(':').map(Number)
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`--${flag} wants min:max:step (got "${spec}")`)
  }
  const [min, max, step] = parts as [number, number, number]
  if (step <= 0) throw new Error(`--${flag} step must be > 0 (got ${step})`)
  if (max < min) throw new Error(`--${flag} max must be >= min (got ${min}:${max})`)
  const out: number[] = []
  // Indexed rather than accumulated (`v += step`): repeated float addition drifts, and a range that
  // silently dropped its last value would read as "the sweep says nothing changes up there".
  for (let i = 0; min + i * step <= max + 1e-9; i++) out.push(round2(min + i * step))
  return out
}

/**
 * Add today's shipping value to a swept axis, always.
 *
 * ⚠ This is what makes every other row readable: without the baseline in the table, a sweep reports
 * outcomes at a set of values and says nothing about which of them you are running now. With it, every
 * row is a DELTA from what ships. It also means a requested range that misses the constant is silently
 * widened — deliberate, and called out in the header.
 */
function withBaseline(values: number[], baseline: number): number[] {
  return [...new Set([...values, round2(baseline)])].sort((a, b) => a - b)
}

function parseArgs(argv: string[]) {
  const args = argv.slice(2)
  const driveId = args.find((a) => !a.startsWith('--'))
  if (!driveId) {
    throw new Error(
      `Usage: sweep.ts <drive-id> [--radius=${DEFAULT_RADIUS_RANGE}] [--lead=${DEFAULT_LEAD_RANGE}] ` +
        `[--mph=${DEFAULT_MPH}] [--trace=<path>]`,
    )
  }
  const str = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
  const num = (name: string, def: number) => {
    const raw = str(name)
    return raw === undefined ? def : Number(raw)
  }
  return {
    driveId,
    radii: withBaseline(
      parseRange(str('radius') ?? DEFAULT_RADIUS_RANGE, 'radius'),
      ANCHORED_TRIGGER_RADIUS_M,
    ),
    leads: withBaseline(parseRange(str('lead') ?? DEFAULT_LEAD_RANGE, 'lead'), DEFAULT_TRIGGER.leadSeconds),
    mph: num('mph', DEFAULT_MPH),
    tracePath: str('trace'),
  }
}

/**
 * Load a recorded trace and check it belongs to this drive.
 *
 * ⚠ This flag was a deliberate REFUSAL until the format and the mapper moved into `@skipper/engine`.
 * The reason it could not simply be written here is worth keeping: a private reader or a second
 * mapper would give this sweep its own idea of what a fix means, and a sweep that disagrees with the
 * car is worse than no sweep. It reads real now because both ends share one definition, not because
 * the objection was dropped.
 *
 * The route check is not ceremony. Replaying trace A against drive B produces a full grid of
 * confident, meaningless numbers — the most expensive failure this tool can have.
 */
function loadTrace(path: string, polyline: LngLat[]): RawFix[] {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    throw new Error(`Could not read --trace=${path}.`)
  }
  const env = parseTraceEnvelope(raw)
  if (!env) throw new Error(`--trace=${path} is not a recorded drive trace (bad JSON, or the wrong shape).`)
  const match = traceMatchesRoute(env, polyline)
  if (!match.ok) {
    throw new Error(
      `--trace=${path} was not recorded on this drive: ${match.reason}.\n` +
        `  It says drive ${env.driveId}${env.label ? ` (${env.label})` : ''}.`,
    )
  }
  if (env.fixes.length === 0) throw new Error(`--trace=${path} contains no fixes.`)
  if (env.truncated) {
    console.error(`\n⚠ ${path} was TRUNCATED at capture — the tail of that drive is missing.\n`)
  }
  return env.fixes
}

/** A stop plus the one bit the sweep needs that `DriveStopRef` does not carry: is its pin road-snapped? */
interface SweepStop {
  ref: DriveStopRef
  /** Only an ANCHORED stop's floor comes from `ANCHORED_TRIGGER_RADIUS_M` — see the header. */
  anchored: boolean
}

interface CellOutcome {
  fired: boolean
  /** Straight-line distance to the stop when it fired (m) — the "Harrah's fired really far" signal. */
  distanceM?: number
  leadSec?: number
}

/**
 * Load the drive and resolve every stop's REAL trigger geometry.
 *
 * ⚠ This MIRRORS `run.ts` (which mirrors `rowsToCorpus` in apps/api/src/drives.ts): speakable anchor
 * when present, trigger floor from kind + anchored. That agreement is the whole value of the tool — a
 * sweep computed off different geometry than the car uses is a curve for a drive that does not exist.
 * If run.ts's resolution changes, this changes with it.
 */
async function loadStops(driveId: string) {
  const drive = (
    await db
      .select({ id: drives.id, label: drives.label, polyline: drives.polyline, selection: drives.selection })
      .from(drives)
      .where(eq(drives.id, driveId))
      .limit(1)
  )[0]
  if (!drive) throw new Error(`No drive found for id "${driveId}".`)

  const narrationItems = (drive.selection ?? []).filter((i) => i.kind === 'narration')
  // ⚠ POI subjects only, as run.ts: a frozen selection can also name a CLUSTER, whose geometry lives in
  // its members rather than in `pois`. Skipped rather than mis-placed — and counted, so a sweep over a
  // cluster-heavy drive can't quietly look like a sweep over all of it.
  const subjects = narrationItems.map((i) => selectionSubject(i))
  const poiIds = subjects.filter((s) => s?.kind === 'poi').map((s) => s!.id)
  const skippedClusters = subjects.filter((s) => s != null && s.kind !== 'poi').length

  const rows = poiIds.length
    ? await db
        .select({
          poiId: narrations.poiId,
          form: narrations.form,
          durationMs: narrations.audioDurationMs,
          lat: pois.lat,
          lng: pois.lng,
          name: pois.name,
          kind: pois.kind,
          speakableLat: pois.speakableLat,
          speakableLng: pois.speakableLng,
        })
        .from(narrations)
        .innerJoin(pois, eq(pois.id, narrations.poiId))
        .where(inArray(narrations.poiId, poiIds))
    : []
  const byPoi = new Map(rows.map((r) => [r.poiId, r]))

  const stops: SweepStop[] = []
  for (const item of narrationItems) {
    const subject = selectionSubject(item)
    const n = subject?.kind === 'poi' ? byPoi.get(subject.id) : undefined
    if (!n) continue
    const anchored = n.speakableLat != null && n.speakableLng != null
    stops.push({
      anchored,
      ref: {
        seq: item.seq,
        lat: n.speakableLat ?? n.lat,
        lng: n.speakableLng ?? n.lng,
        name: n.name,
        stopType: n.form,
        triggerRadiusM: triggerRadiusForKind(n.kind ?? null, anchored),
        durationMs: n.durationMs,
      },
    })
  }
  return { drive, stops, skippedClusters }
}

/** One grid cell: the same `runDrive` the car-agreeing CLI uses, with the anchored floor overridden. */
function runCell(polyline: LngLat[], stops: SweepStop[], radiusM: number, leadSeconds: number, mph: number) {
  // ⚠ Re-runs the FULL `runDrive` per cell instead of reusing one fix stream across the grid. That is
  // wasteful and intentional: `runDrive` is the function that agrees with the car, and a hand-rolled
  // inner loop here would be a second trigger implementation to keep in sync. Correctness over cost.
  const refs = stops.map((s) => (s.anchored ? { ...s.ref, triggerRadiusM: radiusM } : s.ref))
  const report = runDrive(polyline, refs, { mph, leadSeconds })
  const distBySeq = new Map(report.events.map((e) => [e.seq, e.distanceM]))
  const bySeq = new Map<number, CellOutcome>(
    report.stops.map((s) => [s.seq, { fired: s.fired, leadSec: s.leadSec, distanceM: distBySeq.get(s.seq) }]),
  )
  return { report, bySeq }
}

/**
 * One grid cell, driven by a RECORDED fix stream instead of a generated one.
 *
 * ⚠ It snaps the stops first, exactly as `runDrive` does internally, because `driveTrace` deliberately
 * does NOT re-snap — it answers about the stop set it is handed. Skipping the snap here would sweep
 * raw POI centroids while the synthetic path sweeps road-snapped anchors, and the two halves of this
 * CLI would quietly stop being comparable.
 *
 * `mph` plays no part: the speeds come from the road. That is the entire reason this mode exists.
 */
function runCellFromTrace(
  polyline: LngLat[],
  stops: SweepStop[],
  radiusM: number,
  leadSeconds: number,
  fixes: RawFix[],
): Map<number, CellOutcome> {
  const refs = stops.map((s) => (s.anchored ? { ...s.ref, triggerRadiusM: radiusM } : s.ref))
  const snapped = snapStopsToRoute(polyline, refs)
  const triggerable = snapped.filter((s) => s.offRouteM <= OFF_ROUTE_MAX_M)
  const result = driveTrace(polyline, triggerable, fixes, { leadSeconds })
  const byFired = new Map(result.fired.map((f) => [f.seq, f]))
  return new Map(
    refs.map((ref) => {
      const f = byFired.get(ref.seq)
      return [ref.seq, { fired: Boolean(f), distanceM: f?.distanceM, leadSec: f?.leadSec }]
    }),
  )
}

const fmtNum = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1))
const truncate = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/**
 * Compact run-length view of a fired/not-fired pattern across an axis, e.g. `✗100–300 ✓350–600`.
 *
 * Run-length rather than "the threshold" on purpose: firing is NOT monotonic in the radius (a wider
 * floor pulls a stop into range earlier, where the heading gate can veto it), so a single threshold
 * number would quietly discard the interesting cases.
 */
function firePattern(values: number[], fired: boolean[]): string {
  const runs: { fired: boolean; from: number; to: number }[] = []
  values.forEach((v, i) => {
    const f = fired[i] === true
    const last = runs[runs.length - 1]
    if (last && last.fired === f) last.to = v
    else runs.push({ fired: f, from: v, to: v })
  })
  if (runs.length === 1) return runs[0]!.fired ? 'fires at every value' : 'NEVER fires'
  return runs
    .map((r) => `${r.fired ? '✓' : '✗'}${fmtNum(r.from)}${r.from === r.to ? '' : `–${fmtNum(r.to)}`}`)
    .join(' ')
}

function rangeStr(nums: number[], fmt: (n: number) => string): string {
  if (nums.length === 0) return '—'
  const lo = Math.min(...nums)
  const hi = Math.max(...nums)
  return lo === hi ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`
}

/** One stop read along one axis of the grid: the fired pattern plus the ranges it fired over. */
function readAxis(
  values: number[],
  outcomes: CellOutcome[],
): { pattern: string; dist: string; lead: string } {
  const firedOutcomes = outcomes.filter((o) => o.fired)
  return {
    pattern: firePattern(
      values,
      outcomes.map((o) => o.fired),
    ),
    dist: rangeStr(
      firedOutcomes.map((o) => o.distanceM ?? 0),
      (n) => `${Math.round(n)}m`,
    ),
    lead: rangeStr(
      firedOutcomes.map((o) => o.leadSec ?? 0),
      (n) => `${n.toFixed(1)}s`,
    ),
  }
}

async function main() {
  const { driveId, radii, leads, mph, tracePath } = parseArgs(process.argv)

  const cellCount = radii.length * leads.length
  if (cellCount > MAX_CELLS) {
    throw new Error(
      `${radii.length} radii × ${leads.length} leads = ${cellCount} full drive sims ` +
        `(max ${MAX_CELLS}). Coarsen a step.`,
    )
  }

  const { drive, stops, skippedClusters } = await loadStops(driveId)
  if (stops.length === 0) {
    console.log(`\nDrive "${drive.label ?? drive.id}" resolved 0 poi-backed stops — nothing to sweep.\n`)
    return
  }

  const polyline = drive.polyline as LngLat[]
  const baseRadius = round2(ANCHORED_TRIGGER_RADIUS_M)
  const baseLead = round2(DEFAULT_TRIGGER.leadSeconds)
  const key = (r: number, l: number) => `${r}|${l}`

  // A recorded trace replaces the FIX STREAM, not the geometry. `baseline` is still produced by
  // `runDrive` either way, because everything it is read for below — off-route distance, which stops
  // are excluded — is a property of the route and the pins, not of how fast anyone drove.
  const fixes = tracePath === undefined ? undefined : loadTrace(tracePath, polyline)
  // The trace's own wall clock — the real duration, which the synthetic `driveSec` cannot know.
  const traceSec =
    fixes && fixes.length > 1 ? (fixes[fixes.length - 1]!.timestamp - fixes[0]!.timestamp) / 1000 : undefined

  const grid = new Map<string, Map<number, CellOutcome>>()
  let baseline: SimReport | undefined
  for (const r of radii) {
    for (const l of leads) {
      const { report, bySeq } = runCell(polyline, stops, r, l, mph)
      grid.set(key(r, l), fixes ? runCellFromTrace(polyline, stops, r, l, fixes) : bySeq)
      if (r === baseRadius && l === baseLead) baseline = report
    }
  }
  // Guaranteed by `withBaseline`, but the grid is indexed by float equality — assert rather than
  // silently render an empty baseline column.
  if (!baseline) throw new Error('Baseline cell missing from the grid — withBaseline() did not hold.')

  const cell = (r: number, l: number, seq: number): CellOutcome =>
    grid.get(key(r, l))?.get(seq) ?? { fired: false }
  const offRouteBySeq = new Map(baseline.stops.map((s) => [s.seq, s.offRouteM]))
  const excluded = new Set(baseline.excludedOffRoute)
  const onRoute = stops.filter((s) => !excluded.has(s.ref.seq)).length
  const anchoredCount = stops.filter((s) => s.anchored).length
  // ⚠ Every speed-dependent line below must describe the run that ACTUALLY happened. In trace mode
  // `--mph` is ignored, so continuing to print it (and to compute the inert row from it) would make
  // the report confidently wrong about its own input — the exact failure the caveat block exists to
  // prevent, committed by the tool itself. Median, not mean: a recorded drive contains stops at
  // lights and the odd wild fix, and a mean quietly reports a speed the car never held.
  const traceSpeeds = (fixes ?? [])
    .map((f) => f.coords.speed)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0)
    .sort((a, b) => a - b)
  const observedMps = traceSpeeds.length ? traceSpeeds[Math.floor(traceSpeeds.length / 2)]! : undefined
  const speedMps = observedMps ?? mph * MPH_TO_MPS
  const speedLabel = observedMps === undefined
    ? `${fmtNum(mph)} mph`
    : `~${fmtNum(round2(observedMps / MPH_TO_MPS))} mph observed`

  // ── Header ────────────────────────────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(94))
  console.log(`TRIGGER SWEEP — ${drive.label ?? '(untitled)'} · drive ${drive.id}`)
  console.log(
    `${(baseline.totalRouteM / METERS_PER_MILE).toFixed(1)} mi @ ${speedLabel} → ${formatMmss(traceSec ?? baseline.driveSec)} drive · ` +
      `${stops.length} stops (${anchoredCount} anchored, ${stops.length - anchoredCount} un-anchored, ${excluded.size} off-route)`,
  )
  console.log(
    `grid: radius ${radii.length} × lead ${leads.length} = ${cellCount} sims · ` +
      `⌖ = today's shipping value (${fmtNum(baseRadius)}m floor, ${fmtNum(baseLead)}s lead), always added to each axis`,
  )
  if (skippedClusters > 0) {
    console.log(`⚠ ${skippedClusters} CLUSTER stop(s) skipped — fused tellings have no pois row to place (as run.ts).`)
  }
  console.log('='.repeat(94))

  // ── The caveat, before any number is read ─────────────────────────────────────────────────────
  console.log('')
  if (fixes) {
    console.log(`✅ RECORDED INPUT — ${fixes.length} real fixes from ${tracePath}.`)
    console.log('  These carry the multipath, the dropouts, the iOS -1 sentinels and the approach geometry')
    console.log('  of an actual drive, and they run through the SAME pipeline the phone runs')
    console.log('  (`createFixMapper` → `TriggerEngine`), so a fix rejected here was rejected in the car.')
    console.log('  This is what geo.ts:54 was waiting for: re-analysis of a real drive, not desk guesswork.')
    console.log('  ⚠ It is still ONE drive, on ONE road, in ONE set of conditions. A floor tuned to fit it')
    console.log('    exactly is overfitted to that afternoon — look for a value with margin, not the edge.')
    console.log('  ⚠ --mph is IGNORED in this mode; the speeds are whatever the road actually did.')
  } else {
    console.log('⚠ SYNTHETIC INPUT — this is the ceiling on what everything below can prove.')
    console.log('  These fixes come from `generateDrive`: exactly on the polyline, exact speed, exact bearing,')
    console.log('  none dropped, none noisy. A trigger radius exists to absorb GPS error and approach geometry,')
    console.log('  and there is none in here — so what follows is what the GEOMETRY does, not what the ROAD does.')
    console.log('  It CAN show a stop that fires at no setting at all, and where a parameter stops mattering.')
    console.log('  It CANNOT pin ANCHORED_TRIGGER_RADIUS_M — that is what geo.ts means by "not desk-tunable".')
    console.log('  Re-run with --trace=<recorded drive> and the same sweep becomes re-analysis of a real one.')
  }

  // ── The grid ──────────────────────────────────────────────────────────────────────────────────
  const w = 8
  console.log('')
  console.log(`FIRED, of ${onRoute} on-route stops · rows: anchored floor (m) · cols: lead (s)`)
  console.log(
    ' '.repeat(20) + leads.map((l) => `${fmtNum(l)}${l === baseLead ? '⌖' : ''}`.padStart(w)).join(''),
  )
  console.log(
    '  inert at/below (m) ' + leads.map((l) => String(Math.round(speedMps * l)).padStart(w)).join(''),
  )
  for (const r of radii) {
    const label = `  floor ${fmtNum(r)}${r === baseRadius ? '⌖' : ''}`.padEnd(20)
    const counts = leads.map((l) => stops.filter((s) => cell(r, l, s.ref.seq).fired).length)
    console.log(label + counts.map((n) => String(n).padStart(w)).join(''))
  }
  console.log('')
  console.log('  In each column every floor at or below the "inert" value produces IDENTICAL results BY')
  console.log('  CONSTRUCTION — `effectiveRadiusM = max(floor, speed·lead)` picks the lead term there. A flat')
  console.log('  region above that line is a finding; a flat region below it is arithmetic.')
  const governsBelowMph = baseRadius / baseLead / MPH_TO_MPS
  console.log(
    `  ⚠ Today's floor only governs BELOW ${governsBelowMph.toFixed(0)} mph at the baseline lead; above that it is dead`,
  )
  console.log(
    `     weight. The POIs this constant is parked on are town/highway approaches — sweep at the speed you`,
  )
  console.log(
    fixes
      ? `     actually drive them — this trace held ${speedLabel}, so read the radius axis against THAT.`
      : `     actually drive them (--mph), or the radius axis is measuring nothing.`,
  )

  // ── Per-stop, one knob at a time from what SHIPS ──────────────────────────────────────────────
  // Both tables hold the other axis at the baseline, because the decision in front of the founder is
  // "move ONE constant from today's value", not "explore a plane". The whole-grid scan below is what
  // catches anything interesting that happens away from that cross — without it, the matrix could show
  // variation these two tables structurally cannot see.
  const section = (
    title: string,
    values: number[],
    outcomeAt: (v: number, seq: number) => CellOutcome,
  ) => {
    console.log('')
    console.log(title)
    console.log('   seq  A  stop                    outcome                      fire dist        lead')
    for (const s of stops) {
      const seq = s.ref.seq
      const read = readAxis(
        values,
        values.map((v) => outcomeAt(v, seq)),
      )
      const flag = excluded.has(seq) ? '⤬' : s.anchored ? '⚓' : '·'
      console.log(
        `  ${String(seq).padStart(3)}  ${flag}  ${truncate(s.ref.name ?? '', 22).padEnd(22)}  ` +
          `${read.pattern.padEnd(26)}  ${read.dist.padStart(12)}  ${read.lead.padStart(10)}`,
      )
    }
  }

  section(
    `PER-STOP × ANCHORED FLOOR (lead held at ${fmtNum(baseLead)}s, ${speedLabel})   ⚓ = swept · · = un-anchored (invariant here) · ⤬ = off-route`,
    radii,
    (v, seq) => cell(v, baseLead, seq),
  )
  if (anchoredCount === 0) {
    console.log('')
    console.log('  ⚠ NOT ONE stop on this drive is anchored, so the radius axis moved nothing — every row above is')
    console.log('    the same sim repeated. Read a flat table here as "wrong drive for this question", not as an')
    console.log('    answer about the floor.')
  }

  if (leads.length > 1) {
    section(
      `PER-STOP × LEAD SECONDS (anchored floor held at ${fmtNum(baseRadius)}m, ${speedLabel})   ⚓ = anchored · ⤬ = off-route`,
      leads,
      (v, seq) => cell(baseRadius, v, seq),
    )
  }

  // ── The whole-grid scan ───────────────────────────────────────────────────────────────────────
  // Never fired in ANY cell — the strongest signal the tool produces — and, for everything else, the
  // radius curve at EVERY lead rather than only at the baseline one.
  const neverAnywhere: SweepStop[] = []
  const curves: { stop: SweepStop; lines: { leads: number[]; pattern: string }[] }[] = []
  for (const s of stops) {
    const seq = s.ref.seq
    const fired = radii.flatMap((r) => leads.map((l) => cell(r, l, seq).fired))
    if (!fired.some(Boolean)) {
      neverAnywhere.push(s)
      continue
    }
    if (fired.every(Boolean)) continue // fires in every cell — no threshold to report
    // One radius pattern per lead, with adjacent identical leads collapsed so a stop whose curve
    // doesn't depend on the lead reads as ONE line instead of five identical ones.
    const lines: { leads: number[]; pattern: string }[] = []
    for (const l of leads) {
      const pattern = firePattern(
        radii,
        radii.map((r) => cell(r, l, seq).fired),
      )
      const last = lines[lines.length - 1]
      if (last && last.pattern === pattern) last.leads.push(l)
      else lines.push({ leads: [l], pattern })
    }
    curves.push({ stop: s, lines })
  }

  // ── What to do about it ───────────────────────────────────────────────────────────────────────
  console.log('')
  if (neverAnywhere.length > 0) {
    console.log(`⤬ NEVER FIRES AT ANY SETTING IN THE GRID — a GEOMETRY problem, not a tuning one:`)
    for (const s of neverAnywhere) {
      const off = Math.round(offRouteBySeq.get(s.ref.seq) ?? Infinity)
      const why = excluded.has(s.ref.seq)
        ? `${off}m off-route (> ${OFF_ROUTE_MAX_M}m — no honest trigger point)`
        : `${off}m off-route, on-route but never in range/ahead`
      console.log(`   stop ${s.ref.seq} ${s.ref.name ?? ''} — ${why}`)
    }
    console.log('   Fix the pin or its speakable anchor (or drop the stop). No radius or lead recovers these.')
  } else {
    console.log('✓ Every stop fires somewhere in the grid — no stop is unreachable by tuning alone.')
  }

  if (curves.length > 0) {
    console.log('')
    console.log('THRESHOLDS — every stop that changes outcome, and where (the part one drive cannot give you).')
    console.log('Each line is the ANCHORED-FLOOR curve (m) at the leads on its left; ✓/✗ = fires / does not.')
    console.log('A run names SWEPT values only — it says nothing about the gaps between them.')
    for (const c of curves) {
      console.log(`   stop ${c.stop.ref.seq} ${c.stop.ref.name ?? ''}`)
      for (const line of c.lines) {
        const label = `lead ${rangeStr(line.leads, (n) => `${fmtNum(n)}s`)}`
        console.log(`      ${label.padEnd(20)} ${line.pattern}`)
      }
    }
    console.log('')
    console.log('   ⚠ A stop that fires at a SMALL value and not at a larger one is not a bug in the table.')
    console.log('     A wider radius pulls the stop into range EARLIER, where the heading gate can veto it and')
    console.log('     the passed-point retire can then hold it down — so "more radius" is not monotonically')
    console.log('     "more firing" (packages/engine/src/trigger.ts). Read those rows before widening anything.')
  } else {
    console.log('')
    console.log('No stop changed outcome anywhere in the grid — every knob swept here is currently slack, which')
    console.log('over noiseless fixes is the EXPECTED result for a drive whose stops all sit on the route.')
  }

  console.log('')
  console.log(
    `Ran ${cellCount} sims over ${stops.length} stops. Read this as geometry; the road still owes you a trace.`,
  )
  console.log('')
}

main().catch((e) => {
  console.error('\nSweep failed:', e instanceof Error ? e.message : e)
  process.exitCode = 1
})
