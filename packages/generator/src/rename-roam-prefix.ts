// One-off V2 naming-pass migration: move every narration clip's R2 key from the `roam/` prefix to
// `narration/`, in lockstep with the `narrations.audio_url` pointer. The roam MODE keeps its name —
// only the storage prefix + the stored object KEY change, so the atom's bytes live under the atom's
// name (`narration/<poiId>/<clipId>.m4a`). Per-object lockstep — copy → flip THIS row's audio_url →
// delete the old object — so a live presign is never momentarily pointed at a moved-away object.
// Idempotent + re-runnable (a row already on `narration/` is excluded by the LIKE filter); a final
// sweep deletes any `roam/` leftovers only when every row migrated cleanly.
//
// Blast radius: MUTATES DB + DELETES BYTES (R2 copy-then-delete). DEFAULT DRY RUN — pass --apply.
// dev+prod share ONE bucket (`skipper`) + ONE Neon DB, so this runs exactly ONCE. Conforms to
// docs/guides/ops-scripts-sop.md.
//
//   dotenvx run -f .env.development -- bun packages/generator/src/rename-roam-prefix.ts [--apply]

import { db } from '@skipper/db'
import { narrations } from '@skipper/db/schema'
import { eq, like } from 'drizzle-orm'
import { getR2Client } from '@skipper/storage'
import { TTS_AUDIO_CONTENT_TYPE } from './models'
import { announce, assertReady, parseFlags } from './pipeline/ops'
import { deleteAudio, listAudioKeys } from './pipeline/storage'

const OLD_PREFIX = 'roam/'
const NEW_PREFIX = 'narration/'

/** Pure: map a `roam/` clip key to its `narration/` counterpart, or null if the key isn't under
 *  `roam/` (so an already-migrated or foreign key is a no-op, never double-prefixed). */
export function narrationKeyFromRoam(key: string): string | null {
  return key.startsWith(OLD_PREFIX) ? NEW_PREFIX + key.slice(OLD_PREFIX.length) : null
}

async function main() {
  const flags = parseFlags(process.argv.slice(2))
  const apply = flags.has('apply')

  assertReady(['r2']) // listing/copy needs R2 even to preview the plan
  announce({ tool: 'rename-roam-prefix', blast: ['MUTATES DB', 'DELETES BYTES'], apply })

  const client = getR2Client()
  const rows = await db
    .select({ id: narrations.id, key: narrations.audioUrl })
    .from(narrations)
    .where(like(narrations.audioUrl, `${OLD_PREFIX}%`))

  console.log(`${rows.length} narration(s) under "${OLD_PREFIX}" → "${NEW_PREFIX}"\n`)

  let moved = 0
  const failures: { id: string; key: string; err: string }[] = []
  for (const { id, key } of rows) {
    const newKey = narrationKeyFromRoam(key)
    if (!newKey) continue // the LIKE filter guarantees this; belt-and-suspenders against double-run
    if (!apply) {
      console.log(`  plan: ${key} → ${newKey}`)
      continue
    }
    try {
      // 1. Copy bytes to the new key (skip if a prior partial run already wrote it).
      if (!(await client.file(newKey).exists())) {
        const bytes = new Uint8Array(await client.file(key).arrayBuffer())
        await client.file(newKey).write(bytes, { type: TTS_AUDIO_CONTENT_TYPE })
      }
      // 2. Confirm the new object is really there BEFORE repointing the live row.
      if (!(await client.file(newKey).exists()))
        throw new Error('copy verify failed — new object absent after write')
      // 3. Flip THIS row's pointer (a failure here leaves the old, still-present key live).
      await db.update(narrations).set({ audioUrl: newKey }).where(eq(narrations.id, id))
      // 4. Delete the superseded object.
      await deleteAudio(key)
      moved++
      console.log(`  moved: ${key} → ${newKey}`)
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e)
      failures.push({ id, key, err })
      console.error(`  FAIL: ${key} — ${err}`)
    }
  }

  if (!apply) {
    console.log(`\nDRY RUN — ${rows.length} object(s) would move. Pass --apply to execute.`)
    return
  }

  console.log(`\nMoved ${moved}/${rows.length}. ${failures.length} failure(s).`)
  if (failures.length) {
    for (const f of failures) console.error(`  ${f.id} ${f.key}: ${f.err}`)
    process.exitCode = 1
    return
  }

  // Every row migrated cleanly → every DB pointer is now on `narration/`, so anything still under
  // `roam/` is an orphaned leftover (e.g. a delete that failed on an earlier partial run). Safe to
  // sweep only because there are zero remaining references.
  const leftover = await listAudioKeys(OLD_PREFIX)
  for (const k of leftover) {
    await deleteAudio(k)
    console.log(`  swept leftover: ${k}`)
  }
  console.log(`Swept ${leftover.length} leftover "${OLD_PREFIX}" object(s). Prefix is now empty.`)
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
