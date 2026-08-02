// BUILD STEP 0 (docs/designs/drives-first-1-1.md D5) — the greenfield safety net.
//
// READ-ONLY. Spends nothing: one ~1.4s DB read + R2 GETs (egress is free). No --apply gate
// needed (ops-scripts-sop.md rule 2 governs SPEND, and this spends nothing).
//
// EXITS 1 when the snapshot is INCOMPLETE (a referenced clip missing from disk, or a failed R2 GET),
// so it is safe to `&&`-chain ahead of a destructive step — the chain stops instead of running with a
// net full of holes. A throw before that point exits non-zero on its own (top-level await).
//
// WIDER THAN D5 ON PURPOSE. D5 names five tables; D4 authorizes destructive migrations
// "everywhere". The gap includes `credit_entries` — append-only, never refunds, documented as
// having NO second copy — plus `poi_overrides` (hand-authored fact corrections), `drives`,
// `eval_runs`/`eval_scores` (the record of the fail-closed grounding gate) and the Better Auth
// pool. Widening costs seconds, so this dumps EVERY table it can see.
//
// ⚠ Coupled to zero files anyone else may be editing: tables are discovered from
// information_schema and read via sql.raw, never via drizzle table objects imported from
// packages/db/src/schema.ts.
//
// ⚠ Writes ONLY under .scratch/ — verified gitignored at any depth. `snapshots/` and `backup/`
// are NOT ignored and would drop ~477 MB into every other agent's `git status`.
//
// Run: cd packages/studio && bunx dotenvx run -f ../../.env.development --quiet -- bun src/snapshot-corpus.ts

import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { db } from '@skipper/db'
import { sql } from 'drizzle-orm'
import { getR2Client } from '@skipper/storage'
import { listAudioKeys } from './pipeline/storage'

const STAMP = process.env.SNAPSHOT_STAMP ?? 'snapshot'
const OUT = join(import.meta.dir, '..', '.scratch', STAMP)
const rows = (r: unknown) => ((r as { rows?: unknown[] }).rows ?? r) as Record<string, unknown>[]

async function dumpTables() {
  const dir = join(OUT, 'db')
  mkdirSync(dir, { recursive: true })

  // Discover rather than hardcode — a table added after this was written still gets captured.
  const found = rows(
    await db.execute(
      sql.raw(`select table_name from information_schema.tables
               where table_schema = 'public' and table_type = 'BASE TABLE'
               order by table_name`),
    ),
  ).map((r) => String(r.table_name))

  console.log(`[db] ${found.length} tables in public schema`)
  const manifest: Record<string, number> = {}
  let total = 0

  for (const t of found) {
    // sql.raw + an information_schema-sourced identifier; not user input.
    const data = rows(await db.execute(sql.raw(`select * from "${t}"`)))
    writeFileSync(join(dir, `${t}.json`), JSON.stringify(data, null, 1))
    manifest[t] = data.length
    total += data.length
    console.log(`  ${t.padEnd(28)} ${String(data.length).padStart(6)} rows`)
  }

  writeFileSync(join(OUT, 'tables.json'), JSON.stringify(manifest, null, 2))
  console.log(`[db] ${total} rows across ${found.length} tables → ${dir}`)
  return manifest
}

async function dumpR2() {
  const dir = join(OUT, 'r2')
  mkdirSync(dir, { recursive: true })
  const client = getR2Client()

  // Both live prefixes. `clips/` is legacy Phase-2 debris but it is bytes we cannot regenerate,
  // so it rides along — this is a safety net, not a tidy-up.
  const keys = [...new Set([...(await listAudioKeys('narration/')), ...(await listAudioKeys('clips/'))])]
  console.log(`[r2] ${keys.length} objects to pull`)

  let bytes = 0
  let done = 0
  const failed: string[] = []

  for (const key of keys) {
    const dest = join(dir, key)
    if (existsSync(dest)) { done++; continue } // resumable — a re-run skips what landed
    mkdirSync(join(dest, '..'), { recursive: true })
    try {
      const buf = Buffer.from(await client.file(key).arrayBuffer())
      writeFileSync(dest, buf)
      bytes += buf.byteLength
      done++
      if (done % 50 === 0) console.log(`  ${done}/${keys.length} (${(bytes / 1e6).toFixed(0)} MB)`)
    } catch (e) {
      failed.push(key)
      console.error(`  ✗ ${key}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  writeFileSync(join(OUT, 'r2-keys.json'), JSON.stringify({ keys, failed }, null, 1))
  console.log(`[r2] ${done}/${keys.length} objects, ${(bytes / 1e6).toFixed(1)} MB new → ${dir}`)
  if (failed.length) console.error(`[r2] ⚠ ${failed.length} FAILED — snapshot is INCOMPLETE`)
  return { total: keys.length, failed: failed.length }
}

console.log(`snapshot → ${OUT}\n`)
const t0 = Date.now()
const tables = await dumpTables()
const r2 = await dumpR2()

// Cross-check the one integrity property that matters: every live clip is on disk.
const narrations = JSON.parse(await Bun.file(join(OUT, 'db', 'narrations.json')).text()) as {
  audio_url: string | null
}[]
const referenced = narrations.map((n) => n.audio_url).filter((u): u is string => !!u)
const missing = referenced.filter((k) => !existsSync(join(OUT, 'r2', k)))

writeFileSync(
  join(OUT, 'MANIFEST.json'),
  JSON.stringify(
    { takenAt: new Date().toISOString(), tables, r2, referencedClips: referenced.length, missingClips: missing },
    null,
    2,
  ),
)

console.log(`\n${'='.repeat(60)}`)
console.log(`referenced clips: ${referenced.length}, missing from snapshot: ${missing.length}`)
if (missing.length === 0 && r2.failed === 0) {
  console.log('✓ SNAPSHOT COMPLETE')
} else {
  // Exit NON-ZERO (SOP rule 6 — an honest exit code), not just a warning line: this printed
  // "do not start destructive work" and still exited 0, so `snapshot-corpus && <destructive step>`
  // — the chain prune-corpus's own header recommends — proceeded on a net that cannot restore what
  // the next step is about to cascade away. The shell now stops at the &&.
  console.log('✗ SNAPSHOT INCOMPLETE — do not start destructive work')
  process.exitCode = 1
}
console.log(`took ${((Date.now() - t0) / 1000).toFixed(0)}s`)
