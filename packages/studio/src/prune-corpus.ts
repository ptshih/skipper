// prune-corpus — flag Wikidata entities that EXIST but cannot be told as a stop.
//
// A Wikidata sweep answers "what is here", not "what can a driver be told about from a moving car",
// and the gap between those is the legibility layer (docs/ideas/poi-legibility-layer.md). This is its
// cheapest, most mechanical slice: entities that are disqualified by their SHAPE, not by taste.
//
// ONE RULE, one idea: a place with no meaningful POINT is not a stop. A numbered highway's coordinate is
// an arbitrary spot along a line you are ON for twenty minutes, so "you're on SR-431" is equally true a
// mile either side. The same is true of a place you are INSIDE for an hour — Yosemite National Park is
// not somewhere you pass (founder call 2026-07-29), and neither is a mountain range or a wilderness.
// Both shapes fail for the same reason, so they share a predicate: `pipeline/containment.ts`.
//
// ⚠ That predicate SUPERSEDES the route-number name pattern this tool started with, and is strictly
// better: `Glacier Point Road` is a 25 km road with no route number, which the regex missed entirely.
// The regex survives only as a fallback for POIs whose Wikidata claims were never backfilled.
//
// Judgment-based exclusions (a census-designated place duplicating the settlement beside it, a
// never-built project) are deliberately NOT here — they need the treatment classifier, and its `dropped`
// list already records them without silencing the place.
//
// ⚠ FLAGS, NEVER DELETES. Every one of these rows may already own generated audio — the Tahoe corpus
// had all 31 narrated, ~35 minutes of paid TTS — and a delete would orphan those R2 bytes and destroy
// the attribution with them. `excluded_reason` is a nullable REASON (not a boolean) so the call is
// auditable, reversible with a single UPDATE, and legible to whoever asks "why is SR-89 not in my
// drive?" Read paths filter on `excluded_reason IS NULL`.
//
// Why flagging is enough: the audio stays in R2 and the narration row stays intact, so restoring a
// place is `set excluded_reason = null` — no regeneration, no spend. That asymmetry is the whole
// reason to prefer a flag over a prune when the artifacts cost money to make.
//
// Blast radius: MUTATES DB on --apply only. NO spend (no model, no network). Conforms to
// docs/guides/ops-scripts-sop.md (SAFE BY DEFAULT): preview reports what WOULD change, writes nothing.
//
//   preview:  dotenvx run -f .env.development -- bun packages/studio/src/prune-corpus.ts
//   apply:    dotenvx run -f .env.development -- bun packages/studio/src/prune-corpus.ts --apply
//   --region <slug>   scope to a region's bbox (default: lake-tahoe)
//   --restore         clear the reason this tool sets, on the same scope (the undo)
//   --delete          HARD-DELETE rows this tool already flagged (founder call 2026-07-30). Flagging was
//                     the compromise for rows whose audio was already paid for; deleting is the honest
//                     end state once that is accepted. ⚠ IRREVERSIBLE and it CASCADES to `narrations`
//                     (poi_id ON DELETE CASCADE), which leaves their R2 clips ORPHANED — run
//                     `sweep-orphans.ts` afterwards to reclaim the bytes. Scoped to this tool's own
//                     reason prefix, so a hand-made admin exclusion is never swept up.

import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import { narrations, pois } from '@skipper/db/schema'
import { announce, parseFlags } from './pipeline/ops'
import { mapLimit } from './pipeline/concurrency'
import { withRetry } from './pipeline/http'
import { resolveRegion, requireRegionBbox } from './pipeline/region'
import { DEFAULT_REGION_SLUG } from './config'
import { containmentReason } from './pipeline/containment'
import { colocationReport, findColocations } from './pipeline/colocation'

/** DB-write fan-out. These are Neon round trips — a different resource from the LLM/TTS knobs in
 *  config.ts — so the pool is local, matching classify-treatments' DB-write concurrency. */
const DB_WRITE_CONCURRENCY = 8

/** Prefix on every reason this tool writes. `--restore` scopes to it, so a hand-made admin exclusion for
 *  some other cause is never silently undone by a re-run. */
export const PRUNE_REASON_PREFIX = 'no point trigger'
/** Retained for the rows written before containment landed, so `--restore` still finds them. */
export const LINEAR_FEATURE_REASON = 'linear-feature: no meaningful point trigger'

/** Numbered-route naming, the one shape that reliably identifies a linear feature in this corpus.
 *  Deliberately narrow: it matches the ROUTE-NUMBER form, not every road-ish name, so a named pass or
 *  a bridge (a real point you drive over) is untouched. */
const LINEAR_NAME = /(State Route|State Highway|\bU\.?S\.? Route\b|Interstate \d|\bHighway \d)/i

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2), { valueFlags: ['region'] })
  const apply = flags.has('apply')
  const restore = flags.has('restore')
  const hardDelete = flags.has('delete')
  announce({
    tool: 'prune-corpus',
    // 'DELETES ROWS' rather than 'DELETES BYTES': this cascade removes narration ROWS and thereby
    // ORPHANS their R2 objects — it never deletes the objects themselves. sweep-orphans does that.
    blast: hardDelete ? ['MUTATES DB', 'DELETES ROWS'] : ['MUTATES DB'],
    apply,
  })

  const region = await resolveRegion(flags.value('region') ?? DEFAULT_REGION_SLUG)
  const bbox = requireRegionBbox(region)
  console.log(`Region: ${region.displayName} (${region.slug})`)

  const inBbox = [
    sql`${pois.lat} between ${bbox.swLat} and ${bbox.neLat}`,
    sql`${pois.lng} between ${bbox.swLng} and ${bbox.neLng}`,
  ]

  const ownedByThisTool = sql`(${pois.excludedReason} = ${LINEAR_FEATURE_REASON}
    or ${pois.excludedReason} like ${PRUNE_REASON_PREFIX + '%'})`

  if (hardDelete) {
    // Only what THIS tool flagged. A narration row dies with its poi via the FK cascade, so count the
    // audio explicitly — the operator should see the bytes they are about to orphan, not discover it.
    const doomed = await db
      .select({
        id: pois.id,
        name: pois.name,
        reason: pois.excludedReason,
        narrationId: narrations.id,
        audioUrl: narrations.audioUrl,
        durationMs: narrations.audioDurationMs,
      })
      .from(pois)
      .leftJoin(narrations, eq(narrations.poiId, pois.id))
      .where(and(...inBbox, ownedByThisTool))

    if (doomed.length === 0) return console.log('\nNothing to delete — no rows carry this tool\'s exclusion in range.')
    const withAudio = doomed.filter((d) => d.narrationId != null)
    const sec = Math.round(withAudio.reduce((a, d) => a + (d.durationMs ?? 0), 0) / 1000)
    console.log(`\n${doomed.length} row(s) to DELETE:`)
    for (const d of doomed) console.log(`  ${d.narrationId ? '♪' : ' '} ${d.name}  —  ${d.reason}`)
    console.log(
      `\n⚠ ${withAudio.length} carry a narration that dies with them (${Math.round(sec / 60)} min of audio). ` +
        `The R2 CLIPS ARE NOT TOUCHED by this delete — they become ORPHANS. Reclaim them with:\n` +
        `    dotenvx run -f .env.development -- bun packages/studio/src/sweep-orphans.ts --apply`,
    )
    if (!apply) return console.log('\nPREVIEW — no writes. Re-run with --delete --apply to remove them.')
    await withRetry(() => db.delete(pois).where(and(...inBbox, ownedByThisTool)), { label: 'prune.delete' })
    console.log(`\n✓ ${doomed.length} row(s) deleted (${withAudio.length} narration(s) cascaded). Now sweep orphans.`)
    return
  }

  if (restore) {
    const rows = await db
      .select({ id: pois.id, name: pois.name })
      .from(pois)
      .where(and(...inBbox, ownedByThisTool))
    console.log(`\n${rows.length} POI(s) currently excluded by this tool.`)
    if (!apply) {
      console.log('PREVIEW — no writes. Re-run with --apply to restore them.')
      return
    }
    await withRetry(
      () => db.update(pois).set({ excludedReason: null }).where(and(...inBbox, eq(pois.excludedReason, LINEAR_FEATURE_REASON))),
      { label: 'prune.restore' },
    )
    console.log(`✓ ${rows.length} POI(s) restored (excluded_reason cleared).`)
    return
  }

  // Candidates = not already excluded, matching the linear-feature name shape. The narration join is
  // reporting only: it is what makes the cost of this call visible before it is made.
  const candidates = await db
    .select({
      id: pois.id,
      name: pois.name,
      qid: pois.qid,
      lat: pois.lat,
      lng: pois.lng,
      areaKm2: pois.areaKm2,
      lengthKm: pois.lengthKm,
      types: pois.wikidataTypes,
      narrationId: narrations.id,
      durationMs: narrations.audioDurationMs,
      released: narrations.releasedAt,
    })
    .from(pois)
    .leftJoin(narrations, eq(narrations.poiId, pois.id))
    .where(and(...inBbox, isNull(pois.excludedReason)))

  // Co-location triage — reported alongside the prune scan because this is the FREE hygiene pass an
  // operator already runs over a region, and it is the only place a pre-existing mis-located row
  // surfaces without a re-sweep. Advisory only: it never sets `excluded_reason` (most collisions are
  // genuine — see pipeline/colocation.ts).
  for (const line of colocationReport(
    findColocations(candidates.map((r) => ({ qid: r.qid, name: r.name, lat: r.lat, lng: r.lng }))))
  ) {
    console.warn(line)
  }

  // Authoritative first, name pattern only as the fallback for un-backfilled rows.
  const rows = candidates
    .map((r) => ({
      ...r,
      reason:
        containmentReason({ areaKm2: r.areaKm2, lengthKm: r.lengthKm, types: r.types }) ??
        (LINEAR_NAME.test(r.name) ? 'linear feature: numbered route, no point trigger' : null),
    }))
    .filter((r): r is typeof r & { reason: string } => r.reason != null)

  if (rows.length === 0) {
    console.log('\nNothing to flag — no un-excluded linear features in range.')
    return
  }

  const narrated = rows.filter((r) => r.narrationId != null)
  const releasedN = rows.filter((r) => r.released != null).length
  const totalSec = Math.round(narrated.reduce((a, r) => a + (r.durationMs ?? 0), 0) / 1000)

  console.log(`\n${rows.length} place(s) with no meaningful point trigger:`)
  for (const r of rows) console.log(`  ${r.narrationId ? '♪' : ' '} ${r.name}  —  ${r.reason}`)
  console.log(
    `\n⚠ ${narrated.length} of them already carry generated audio (${Math.round(totalSec / 60)} min, ` +
      `${releasedN} released). The audio is NOT deleted — these rows are flagged, so the clips stay in ` +
      `R2 and \`--restore\` brings them back with no regeneration.`,
  )

  if (!apply) {
    console.log('\nPREVIEW — no writes. Re-run with --apply to flag them.')
    return
  }
  // One update per poi id, independent and order-free — fan out rather than pay a round trip each.
  await mapLimit(rows, DB_WRITE_CONCURRENCY, async (r) => {
    await withRetry(
      () => db.update(pois).set({ excludedReason: `${PRUNE_REASON_PREFIX} — ${r.reason}` }).where(eq(pois.id, r.id)),
      { label: `prune(${r.name})` },
    )
  })
  console.log(`\n✓ ${rows.length} POI(s) flagged. Undo: --restore --apply`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
