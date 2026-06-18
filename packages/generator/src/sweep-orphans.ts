// Sweep orphaned R2 clip objects under roam/ : list the roam/ prefix and delete every key NOT
// referenced by a current narrations.audioUrl. Every roam regen mints a fresh per-synth key and
// repoints the narration's audio_url, so the superseded object orphans as private, unreferenced
// bytes. Run after a blessed regen to cap the cruft. Conforms to docs/guides/ops-scripts-sop.md.
//
// Blast radius: DELETES BYTES (R2). Reads the DB. DEFAULT DRY RUN — pass --apply to delete.
// (V2: tour-scoped sweeping is gone with the tours table. `narrations` is the only clip owner under
// roam/; DRIVES reuse narration clips so they mint no R2 objects, and interludes live under a
// separate prefix — so this single roam/ sweep covers the paid corpus.) Needs R2_* env.
//
//   dotenvx run -f .env.development -- bun packages/generator/src/sweep-orphans.ts [--apply]

import { db } from '@skipper/db'
import { narrations } from '@skipper/db/schema'
import { announce, assertReady, parseFlags } from './pipeline/ops'
import { deleteAudio, listAudioKeys, orphanKeys } from './pipeline/storage'
import { beginJob, runJob } from './pipeline/job-progress'

/** The R2 keys the corpus currently points at — every narration's audioUrl (1:1 per poi). A regen
 *  mints a fresh key + repoints audio_url, so the superseded roam/<poiId>/ object orphans. */
async function roamReferencedKeys(): Promise<Set<string>> {
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
  await beginJob('sweep_orphans', { dryRun: !apply, targetId: 'roam' })

  const referenced = await roamReferencedKeys()
  const listed = await listAudioKeys('roam/')
  const orphans = orphanKeys(listed, referenced)
  console.log(
    `roam corpus — ${listed.length} object(s), ${referenced.size} referenced, ${orphans.length} orphan(s)`,
  )
  let deleted = 0
  for (const key of orphans) {
    console.log(`  ${apply ? 'delete' : 'orphan'}: ${key}`)
    if (apply) {
      await deleteAudio(key)
      deleted++
    }
  }
  console.log(
    `\n${apply ? `Deleted ${deleted}` : `Found ${orphans.length}`} roam orphan(s).` +
      (apply ? '' : ' Pass --apply to delete.'),
  )
}

await runJob('sweep_orphans', null, main)
