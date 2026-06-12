// Sweep orphaned R2 clip objects for a tour: list clips/<tourId>/ and delete every key NOT
// referenced by a current tracks.audioUrl / tour_frames.audioUrl. Every successful regen
// leaves the previous telling's clips behind (track + frame keys are per-run-unique by
// design — storage.ts), so they accumulate as private, unreferenced bytes. Run this after
// a blessed regen to cap the cruft. Conforms to docs/guides/ops-scripts-sop.md.
//
// Blast radius: DELETES BYTES (R2). Reads the DB. DEFAULT DRY RUN — pass --apply to delete.
// Scoped STRICTLY to clips/<tourId>/ — never touches another prefix. Needs R2_* env.
//
//   dotenvx run -f .env.development -- bun packages/generator/src/sweep-orphans.ts <tourId|prefix> [--apply]
//   dotenvx run -f .env.development -- bun packages/generator/src/sweep-orphans.ts --all [--apply --yes]

import { eq } from 'drizzle-orm'
import { db } from '@skipper/db'
import { segments, tourFrames, tours, tracks } from '@skipper/db/schema'
import { announce, assertReady, guardFanout, parseFlags, resolveTourId } from './pipeline/ops'
import { deleteAudio, listAudioKeys, orphanKeys } from './pipeline/storage'
import { beginJob, finishJob } from './pipeline/job-progress'

/** The R2 keys a tour's rows currently point at — the stop TRACKS (joined via their
 *  segments) ∪ the tour_frames, non-null. (Roam clips live under roam/<poiId>/ and are
 *  out of this clips/<tourId>/ sweep's scope.) */
async function referencedKeys(tourId: string): Promise<Set<string>> {
  const [trackKeys, frameKeys] = await Promise.all([
    db
      .select({ k: tracks.audioUrl })
      .from(tracks)
      .innerJoin(segments, eq(tracks.segmentId, segments.id))
      .where(eq(segments.tourId, tourId)),
    db.select({ k: tourFrames.audioUrl }).from(tourFrames).where(eq(tourFrames.tourId, tourId)),
  ])
  const set = new Set<string>()
  for (const r of [...trackKeys, ...frameKeys]) if (r.k) set.add(r.k)
  return set
}

async function sweepTour(tourId: string, apply: boolean): Promise<{ orphans: number; deleted: number }> {
  const referenced = await referencedKeys(tourId)
  const listed = await listAudioKeys(`clips/${tourId}/`)
  const orphans = orphanKeys(listed, referenced)
  console.log(
    `tour ${tourId.slice(0, 8)} — ${listed.length} object(s), ${referenced.size} referenced, ${orphans.length} orphan(s)`,
  )
  let deleted = 0
  for (const key of orphans) {
    console.log(`  ${apply ? 'delete' : 'orphan'}: ${key}`)
    if (apply) {
      await deleteAudio(key)
      deleted++
    }
  }
  return { orphans: orphans.length, deleted }
}

async function main() {
  const flags = parseFlags(process.argv.slice(2))
  const all = flags.has('all')
  const apply = flags.has('apply')
  const yes = flags.has('yes')

  guardFanout({ all, apply, yes })
  assertReady(['r2']) // listing needs R2 even for a dry run
  announce({ tool: 'sweep-orphans', blast: ['DELETES BYTES'], apply })

  const tourIds = all
    ? (await db.select({ id: tours.id }).from(tours)).map((t) => t.id)
    : [await resolveTourId(flags.positionals[0])]
  await beginJob('sweep_orphans', {
    dryRun: !apply,
    tourId: all ? undefined : tourIds[0],
    targetId: all ? 'all' : tourIds[0],
  })

  let totalOrphans = 0
  let totalDeleted = 0
  for (const tourId of tourIds) {
    const r = await sweepTour(tourId, apply)
    totalOrphans += r.orphans
    totalDeleted += r.deleted
  }

  console.log(
    `\n${apply ? `Deleted ${totalDeleted}` : `Found ${totalOrphans}`} orphan(s) across ${tourIds.length} tour(s).` +
      (apply ? '' : ' Pass --apply to delete.'),
  )
}

main()
  .then(() => finishJob({ ok: true }))
  .catch(async (e) => {
    await finishJob({ ok: false, error: e instanceof Error ? e.message : String(e) })
    console.error('\nSweep failed:', e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
