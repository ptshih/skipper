// audit-loudness — READ-ONLY corpus sweep: fetch each shipped narration .m4a from R2 and measure its
// post-encode loudness (the commit-702f092 meter), tail-collapse, and leading-silence budget, then report
// the DISTRIBUTION + worst-N outliers + a targeted resynth worklist. NO writes, NO GCP/TTS spend.
//
// The per-clip meter (verifyMasteredLoudness) runs INLINE at synth on every NEW clip; this is the
// COMPLEMENT — it decodes the ALREADY-SHIPPED corpus to a distribution, so the pending full-corpus regen
// GO/no-go becomes data, not a guess: if loudness is tight and nothing collapses, it KILLS the spend; if an
// off-spec lobe exists, it names the exact poi ids to resynth (NOT a blanket region regen). It reuses the
// EXACT exported measurement functions (parseEbur128Summary/judgeMasteredLoudness via verifyMasteredLoudness,
// measureTailCollapse), so the audit and the synth-time gate agree by construction.
//
// Blast radius: READ-ONLY (reads the DB + R2; no writes, no spend). The R2 PULL is gated behind a preview
// (prints clip-count + estimated bytes); pass --run to actually fetch + measure. Exits 1 when any clip is
// off-spec or collapsed, so it can gate a check/hook later. Conforms to docs/guides/ops-scripts-sop.md.
//
//   dotenvx run -f .env.development -- bun packages/studio/src/audit-loudness.ts              # preview only
//   ... --run                     fetch + measure (the whole corpus by default)
//   ... --region <slug>           scope to a region bbox (default: ALL shipped narrations)
//   ... --include-ids a,b,c       audit EXACTLY these poi ids
//   ... --released                only released clips (default: all, incl. staged)
//   ... --limit N                 smoke a cheap N first

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unlink, writeFile } from 'node:fs/promises'
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import { narrations, pois } from '@skipper/db/schema'
import { AUDIO_LOUDNESS } from '@skipper/shared'
import { getR2Client } from '@skipper/storage'
import { numericFlag, parseFlags } from './pipeline/ops'
import { resolveRegion, requireRegionBbox } from './pipeline/region'
import { withRetry } from './pipeline/http'
import { mapLimit } from './pipeline/concurrency'
import { ACTIVE_MASTER_TARGET_LUFS, verifyMasteredLoudness } from './pipeline/loudnorm'
import { measureTailCollapse, TAIL_COLLAPSE_DB } from './pipeline/tail'

const flags = parseFlags(process.argv.slice(2), { valueFlags: ['region', 'limit', 'include-ids'] })
const run = flags.has('run')
const releasedOnly = flags.has('released')
const limit = numericFlag(flags, 'limit', { fallback: Infinity })
const regionRaw = flags.value('region') || null
const includeIds = (flags.value('include-ids') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

// Audit concurrency: each clip is one R2 GET + a few small ffmpeg decodes (network + CPU bound, no spend).
const AUDIT_CONCURRENCY = 8
// Leading-silence flag (ms): a hard player.replace() then a long lead-in = a clip that "doesn't start" on a
// geofence trigger. Advisory only (we measure, never trim). Trailing silence is deferred — the AAC encoder
// zero-pads, so a measured trailing gap is confounded with codec padding and would false-alarm.
const LEADING_SILENCE_FLAG_MS = 600
// Est. bytes/sec for the pull preview: AAC-LC ~64 kbps → 8 KB/s (+ small container overhead, ignored).
const EST_BYTES_PER_SEC = 8000

const TARGET = ACTIVE_MASTER_TARGET_LUFS
const TP_CEILING = AUDIO_LOUDNESS.truePeakDbtp

interface ClipRow {
  poiId: string
  qid: string | null
  name: string
  audioUrl: string
  durationMs: number
}

interface Measured {
  row: ClipRow
  integratedLufs: number | null
  truePeakDb: number | null
  loudnessOk: boolean
  tailDropDb: number | null // null = sub-24s clip (probe skipped) or decode miss
  collapsed: boolean
  leadingMs: number | null
  /** No measurement landed at all (R2 fetch or every ffmpeg pass failed) — excluded from the stats. */
  unmeasured: boolean
}

/** p-th percentile of an ASCENDING-sorted array (nearest-rank); NaN on empty. Pure. */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return NaN
  const i = Math.min(sortedAsc.length - 1, Math.max(0, Math.round((p / 100) * (sortedAsc.length - 1))))
  return sortedAsc[i]!
}

/** Leading-silence (ms) of an .m4a via ffmpeg silencedetect; null on a decode/parse miss, 0 when the clip
 *  opens on sound. Counts a silence run ONLY if it starts at the very top (≤50ms), so it can't mistake an
 *  interior beat for a lead-in. */
async function measureLeadingSilenceMs(bytes: Uint8Array): Promise<number | null> {
  const file = join(tmpdir(), `skipper-sil-${crypto.randomUUID()}.m4a`)
  try {
    await writeFile(file, bytes)
    const proc = Bun.spawn(
      ['ffmpeg', '-hide_banner', '-nostats', '-i', file, '-af', 'silencedetect=noise=-50dB:d=0.3', '-f', 'null', '-'],
      { stdout: 'ignore', stderr: 'pipe' },
    )
    const stderr = await new Response(proc.stderr).text()
    if ((await proc.exited) !== 0) return null
    const start = /silence_start:\s*(-?\d+(?:\.\d+)?)/.exec(stderr)
    if (!start || Number(start[1]) > 0.05) return 0 // opens on sound (or no detected silence) → no lead-in
    const end = /silence_end:\s*(\d+(?:\.\d+)?)/.exec(stderr)
    return end ? Math.round(Number(end[1]) * 1000) : 0
  } catch {
    return null
  } finally {
    await unlink(file).catch(() => {})
  }
}

/** Fetch one clip's bytes from R2 and run the three read-only measurements on it. Network/decode misses
 *  degrade to nulls (unmeasured) — a single bad clip never aborts the sweep. */
async function measureClip(row: ClipRow): Promise<Measured> {
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await withRetry(() => getR2Client().file(row.audioUrl).arrayBuffer(), { label: `fetch(${row.name})` }))
  } catch {
    return { row, integratedLufs: null, truePeakDb: null, loudnessOk: false, tailDropDb: null, collapsed: false, leadingMs: null, unmeasured: true }
  }
  const [loud, tail, leadingMs] = await Promise.all([
    verifyMasteredLoudness(bytes),
    measureTailCollapse(bytes, row.durationMs),
    measureLeadingSilenceMs(bytes),
  ])
  return {
    row,
    integratedLufs: loud?.integratedLufs ?? null,
    truePeakDb: loud?.truePeakDb ?? null,
    loudnessOk: loud?.loudnessOk ?? false,
    tailDropDb: tail?.dropDb ?? null,
    collapsed: tail !== null && tail.dropDb >= TAIL_COLLAPSE_DB,
    leadingMs,
    unmeasured: loud === null, // the loudness meter is the primary signal; its miss = clip unmeasured
  }
}

function fmt(n: number, digits = 1): string {
  return Number.isFinite(n) ? n.toFixed(digits) : 'n/a'
}

async function main(): Promise<void> {
  console.log('\n[audit-loudness] READ-ONLY corpus audit — post-encode loudness + tail-collapse + leading-silence')
  console.log(`Active master target: ${fmt(TARGET)} LUFS, delivery ceiling ${fmt(TP_CEILING)} dBTP\n`)

  const region = includeIds.length === 0 && regionRaw ? await resolveRegion(regionRaw) : null
  const bbox = region ? requireRegionBbox(region) : null

  const rows = await withRetry(
    async (): Promise<ClipRow[]> => {
      const conds = []
      if (includeIds.length > 0) conds.push(inArray(narrations.poiId, includeIds))
      else if (bbox) {
        conds.push(sql`${pois.lat} between ${bbox.swLat} and ${bbox.neLat}`)
        conds.push(sql`${pois.lng} between ${bbox.swLng} and ${bbox.neLng}`)
      }
      if (releasedOnly) conds.push(isNotNull(narrations.releasedAt))
      const sel = db
        .select({
          // `pois.id`, not `narrations.poi_id`: identical under the innerJoin below, but NOT NULL, so a
        // CLUSTER telling (which has a null poi_id — see the narrations schema) can never reach a tool
        // that needs a place. The inner join already excludes them; this makes the type say so.
        poiId: pois.id,
          qid: pois.qid,
          name: pois.name,
          audioUrl: narrations.audioUrl,
          durationMs: narrations.audioDurationMs,
        })
        .from(narrations)
        .innerJoin(pois, eq(pois.id, narrations.poiId))
      return conds.length > 0 ? await sel.where(and(...conds)) : await sel
    },
    { label: 'load narrations' },
  )

  const queue = rows.slice(0, Number.isFinite(limit) ? limit : rows.length)
  const scope = includeIds.length > 0 ? `${includeIds.length} hand-picked` : region ? `region=${region.slug}` : 'ALL regions'
  const released = releasedOnly ? ', released-only' : ''
  const estMb = (queue.reduce((a, r) => a + (r.durationMs / 1000) * EST_BYTES_PER_SEC, 0) / 1e6).toFixed(1)

  console.log(`Queue: ${queue.length} shipped narration(s) [${scope}${released}] ≈ ~${estMb} MB to fetch from R2.`)
  if (queue.length === 0) {
    console.log('Nothing to audit.')
    return
  }
  if (!run) {
    console.log('\n(preview — no R2 pull, no measurement) Re-run with --run to fetch + measure.')
    return
  }

  console.log(`\nFetching + measuring ${queue.length} clip(s) (concurrency ${AUDIT_CONCURRENCY})...`)
  let done = 0
  const results = await mapLimit(queue, AUDIT_CONCURRENCY, async (r): Promise<Measured> => {
    const m = await measureClip(r)
    done++
    if (done % 25 === 0 || done === queue.length) console.log(`  [${done}/${queue.length}]`)
    return m
  })

  const measured = results.filter((m) => !m.unmeasured)
  const unmeasured = results.filter((m) => m.unmeasured)

  // ── LOUDNESS ──
  const lufs = measured.map((m) => m.integratedLufs!).filter((x): x is number => x !== null).sort((a, b) => a - b)
  const offLoud = measured.filter((m) => !m.loudnessOk && m.integratedLufs !== null)
  console.log(`\n── LOUDNESS (integrated LUFS · target ${fmt(TARGET)} · flag |I−target| > 1.0 LU) ──`)
  console.log(`  measured ${lufs.length} of ${queue.length}${unmeasured.length ? ` (${unmeasured.length} unmeasurable)` : ''}`)
  if (lufs.length > 0) {
    console.log(`  p5 / p50 / p95:  ${fmt(percentile(lufs, 5))} / ${fmt(percentile(lufs, 50))} / ${fmt(percentile(lufs, 95))} LUFS`)
    console.log(`  range:           ${fmt(lufs[0]!)} … ${fmt(lufs[lufs.length - 1]!)} LUFS`)
  }
  console.log(`  off-spec:        ${offLoud.length}`)
  for (const m of offLoud.sort((a, b) => Math.abs(b.integratedLufs! - TARGET) - Math.abs(a.integratedLufs! - TARGET)).slice(0, 12))
    console.log(`    ${fmt(m.integratedLufs!).padStart(6)} LUFS  ${m.row.name}  (${m.row.poiId})`)

  // ── TRUE PEAK ── (distinguish mere ceiling drift from ACTUAL clipping; only clipping earns a resynth)
  const withTp = measured.filter((m) => m.truePeakDb !== null)
  const overCeiling = withTp.filter((m) => m.truePeakDb! > TP_CEILING)
  const clipping = withTp.filter((m) => m.truePeakDb! > 0)
  const maxTp = withTp.length ? Math.max(...withTp.map((m) => m.truePeakDb!)) : NaN
  console.log(`\n── TRUE PEAK (dBTP · delivery ceiling ${fmt(TP_CEILING)}) ──`)
  console.log(`  max true peak:   ${fmt(maxTp)} dBTP`)
  console.log(`  above ceiling:   ${overCeiling.length}  (hotter than the new master's headroom — spec drift, not a defect)`)
  console.log(`  CLIPPING (>0):   ${clipping.length}  (audible — the resynth target)`)
  for (const m of clipping.sort((a, b) => b.truePeakDb! - a.truePeakDb!).slice(0, 12))
    console.log(`    ${fmt(m.truePeakDb!).padStart(6)} dBTP  ${m.row.name}  (${m.row.poiId})`)

  // ── TAIL-COLLAPSE ──
  const tailMeasured = measured.filter((m) => m.tailDropDb !== null)
  const collapsed = measured.filter((m) => m.collapsed)
  console.log(`\n── TAIL-COLLAPSE (body−tail drop · flag ≥ ${TAIL_COLLAPSE_DB} dB) ──`)
  console.log(`  measured ${tailMeasured.length}${measured.length - tailMeasured.length ? ` (${measured.length - tailMeasured.length} skipped — sub-24s)` : ''}`)
  console.log(`  collapsed:       ${collapsed.length}`)
  for (const m of collapsed.sort((a, b) => b.tailDropDb! - a.tailDropDb!).slice(0, 12))
    console.log(`    ${fmt(m.tailDropDb!).padStart(5)} dB  ${m.row.name}  (${m.row.poiId})`)

  // ── LEADING SILENCE (advisory) ──
  const lateStart = measured.filter((m) => m.leadingMs !== null && m.leadingMs > LEADING_SILENCE_FLAG_MS)
  console.log(`\n── LEADING SILENCE (advisory · flag > ${LEADING_SILENCE_FLAG_MS} ms lead-in) ──`)
  console.log(`  late starters:   ${lateStart.length}`)
  for (const m of lateStart.sort((a, b) => b.leadingMs! - a.leadingMs!).slice(0, 8))
    console.log(`    ${String(m.leadingMs).padStart(5)} ms  ${m.row.name}  (${m.row.poiId})`)

  // ── RESYNTH WORKLIST: the genuine DEFECTS only — off-spec loudness OR actual clipping (>0) OR collapsed.
  //    A clip merely above the −1 ceiling but not clipping is hotter than the new master, not defective, so
  //    it stays OFF the worklist (else this rebuilds the blanket regen this audit exists to avoid). ──
  const worklist = new Map<string, string>() // poiId → name
  for (const m of [...offLoud, ...clipping, ...collapsed]) worklist.set(m.row.poiId, m.row.name)
  console.log(`\n── RESYNTH WORKLIST (off-spec loudness OR clipping OR collapsed tail) ──`)
  if (worklist.size === 0) {
    console.log('  none — the shipped corpus is in spec on every measured axis. The regen would change nothing here.')
  } else {
    console.log(`  ${worklist.size} unique poi(s) — resynth EACH (💸 paid, founder GO) via resynth-narration <poiId>:`)
    for (const [poiId, name] of worklist) console.log(`    ${poiId}  ${name}`)
  }
  if (unmeasured.length > 0) {
    console.log(`\n  ⚠ ${unmeasured.length} clip(s) could not be measured (R2 fetch or ffmpeg miss) — re-run to retry:`)
    for (const m of unmeasured.slice(0, 8)) console.log(`    ${m.row.poiId}  ${m.row.name}`)
  }

  console.log()
  if (worklist.size > 0) {
    console.log(`FLAG: ${worklist.size} of ${queue.length} clip(s) are off-spec or collapsed (the worklist above).`)
    process.exitCode = 1
  } else {
    console.log(`All ${queue.length} clip(s) measured in spec — loudness tight, no clipping, no collapsed tails.`)
  }
}

await main()
