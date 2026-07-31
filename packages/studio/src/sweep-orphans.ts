// Sweep orphaned R2 clip objects under narration/ : list the narration/ prefix and delete every key
// NOT referenced by a current narrations.audioUrl. Every regen mints a fresh per-synth key and
// repoints the narration's audio_url, so the superseded object orphans as private, unreferenced
// bytes. Run after a blessed regen to cap the cruft. Conforms to docs/guides/ops-scripts-sop.md.
//
// Blast radius: DELETES BYTES (R2). Reads the DB. DEFAULT DRY RUN — pass --apply to delete.
// (V2: tour-scoped sweeping is gone with the tours table. `narrations` is the only clip owner under
// narration/; DRIVES reuse narration clips so they mint no R2 objects — so this single narration/
// sweep covers the paid corpus. When `detours` (break audio) un-defers, add a second sweep for its
// prefix.) Needs R2_* env.
//
//   dotenvx run -f .env.development -- bun packages/studio/src/sweep-orphans.ts [--apply]

import { db } from '@skipper/db'
import { narrations } from '@skipper/db/schema'
import { announce, assertReady, parseFlags } from './pipeline/ops'
import { deleteAudio, listAudioKeys, orphanKeys } from './pipeline/storage'
import { mapLimit } from './pipeline/concurrency'
import { beginJob, runJob } from './pipeline/job-progress'

/** R2 delete fan-out. Object stores handle this comfortably; kept modest so a large post-regen sweep
 *  doesn't open a socket per orphan. */
const R2_DELETE_CONCURRENCY = 8

/** The R2 keys the corpus currently points at — every narration's audioUrl (1:1 per poi). A regen
 *  mints a fresh key + repoints audio_url, so the superseded narration/<poiId>/ object orphans. */
async function narrationReferencedKeys(): Promise<Set<string>> {
  const rows = await db.select({ k: narrations.audioUrl }).from(narrations)
  const set = new Set<string>()
  for (const r of rows) if (r.k) set.add(r.k)
  return set
}

async function main() {
  const flags = parseFlags(process.argv.slice(2))
  const apply = flags.has('apply')

  assertReady(['r2']) // listing needs R2 even for a dry run
  announce({ tool: 'sweep-orphans', blast: ['DELETES BYTES'], apply })
  await beginJob('sweep_orphans', { dryRun: !apply, targetId: 'narration' })

  const referenced = await narrationReferencedKeys()
  const listed = await listAudioKeys('narration/')
  const orphans = orphanKeys(listed, referenced)
  console.log(
    `narration corpus — ${listed.length} object(s), ${referenced.size} referenced, ${orphans.length} orphan(s)`,
  )
  // List every key FIRST — the listing is this tool's output and its order is the report — then delete
  // in parallel. Deletes are independent R2 objects; serial cost one round trip each after a big regen.
  for (const key of orphans) console.log(`  ${apply ? 'delete' : 'orphan'}: ${key}`)
  let deleted = 0
  if (apply) {
    await mapLimit(orphans, R2_DELETE_CONCURRENCY, async (key) => {
      await deleteAudio(key)
      deleted++
    })
  }
  console.log(
    `\n${apply ? `Deleted ${deleted}` : `Found ${orphans.length}`} narration orphan(s).` +
      (apply ? '' : ' Pass --apply to delete.'),
  )
}

await runJob('sweep_orphans', null, main)
