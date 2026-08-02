#!/usr/bin/env bun
/**
 * db-preflight — refuse a destructive schema operation unless someone says so out loud.
 *
 * WHY THIS EXISTS. Cutting a table from `schema.ts` does not drop it. It ARMS the drop: the table
 * stays in the DB and in the latest drizzle snapshot, and the NEXT `db:generate` emits a
 * `DROP TABLE` while `db:push` executes one immediately. Between those two moments the repo looks
 * finished and the charge is live, and nothing in `bun run check` looks at schema-vs-snapshot drift.
 *
 * That gap is not theoretical here. `drive_demand` was cut from the declaration in the 1.1 sweep
 * (D25, `9f43d4e`) and has been armed ever since — correctly documented at its tombstone in
 * `packages/db/src/schema.ts`, but documented is not the same as guarded, and answering "what
 * exactly would fire right now?" previously meant hand-diffing a 17-table JSON snapshot.
 *
 * ⚠ WHAT MAKES IT SHARP HERE, and why a plain "are you sure?" is not enough: `.env.development` and
 * `.env.production` point at the SAME Neon host (CLAUDE.md › Posture). There is no staging to
 * rehearse on, so a `db:push` typed in a "development" shell is a production DDL. And 1.1's step 0
 * permits destructive migrations ONLY once an OFFSITE corpus + R2 snapshot exists; today's snapshot
 * is LOCAL, under a gitignored `.scratch/`, sharing a failure domain with the working tree.
 *
 * WHAT IT DOES. Compares the tables DECLARED in the schema files against the tables in the newest
 * drizzle snapshot, and prints the delta. A drop is refused (exit 1) unless the caller sets
 * SKIPPER_ALLOW_DESTRUCTIVE_DDL=1 — the same safe-by-default shape as the studio CLIs, where the
 * preview is free and only `--apply` spends (docs/guides/ops-scripts-sop.md).
 *
 * ⚠ SCOPE, stated plainly so nobody trusts it further than it goes: this compares TABLE NAMES only.
 * A dropped COLUMN, a narrowed type, or a removed constraint is just as destructive and is NOT
 * caught here. This is a tripwire for the failure that actually happened, not a schema differ —
 * read drizzle's own output before applying anything.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DB = join(import.meta.dir, '..', 'packages', 'db')
const SCHEMA_FILES = ['src/schema.ts', 'src/auth-schema.ts']

/** Table names from `pgTable('x'` / `pgTable("x"` — auth-schema.ts is CLI-generated with double quotes. */
function declaredTables(): Set<string> {
  const names = new Set<string>()
  for (const f of SCHEMA_FILES) {
    const src = readFileSync(join(DB, f), 'utf8')
    for (const m of src.matchAll(/pgTable\(\s*['"]([a-z_]+)['"]/g)) names.add(m[1]!)
  }
  return names
}

/** Tables in the newest snapshot — the state drizzle will diff the declaration against. */
function snapshotTables(): { tag: string; tables: Set<string> } {
  const metaDir = join(DB, 'drizzle', 'meta')
  const snaps = readdirSync(metaDir)
    .filter((f) => f.endsWith('_snapshot.json'))
    .sort()
  const newest = snaps.at(-1)
  if (!newest) throw new Error(`no *_snapshot.json under ${metaDir}`)
  const snap = JSON.parse(readFileSync(join(metaDir, newest), 'utf8')) as {
    tables?: Record<string, unknown>
  }
  // keys are "public.pois" — take the table half
  const tables = new Set(Object.keys(snap.tables ?? {}).map((k) => k.split('.').at(-1)!))
  return { tag: newest.replace('_snapshot.json', ''), tables }
}

const declared = declaredTables()
const { tag, tables: inSnapshot } = snapshotTables()

const drops = [...inSnapshot].filter((t) => !declared.has(t)).sort()
const creates = [...declared].filter((t) => !inSnapshot.has(t)).sort()

console.log(`db-preflight — ${declared.size} declared vs ${inSnapshot.size} in ${tag}`)
for (const t of creates) console.log(`  + ${t}  (new table)`)
for (const t of drops) console.log(`  ✗ ${t}  (DECLARATION GONE — armed to DROP)`)
if (!drops.length && !creates.length) console.log('  no table-level drift')

if (!drops.length) process.exit(0)

if (process.env.SKIPPER_ALLOW_DESTRUCTIVE_DDL === '1') {
  console.log('\n  SKIPPER_ALLOW_DESTRUCTIVE_DDL=1 — proceeding. The snapshot had better be offsite.')
  process.exit(0)
}

console.error(
  [
    '',
    `✗ REFUSING: ${drops.length} table(s) would be DROPPED from the database.`,
    '',
    `    ${drops.join(', ')}`,
    '',
    '  dev and prod are the SAME Neon host — there is no staging to rehearse this on, and',
    '  1.1 step 0 allows destructive migrations only once an OFFSITE snapshot exists (today\'s',
    '  is local, under a gitignored .scratch/, sharing a failure domain with this tree).',
    '',
    '  Take the offsite copy first. Then, deliberately:',
    '',
    '      SKIPPER_ALLOW_DESTRUCTIVE_DDL=1 bun run db:generate    # review the SQL it writes',
    '      SKIPPER_ALLOW_DESTRUCTIVE_DDL=1 bun run db:migrate     # apply it',
    '',
    '  (Prefer generate+migrate over push: push executes the DDL immediately with no artifact',
    '   to read, review, or revert.)',
    '',
    '  ⚠ Table names only — a dropped COLUMN or constraint is equally destructive and is NOT',
    '    caught here. Read drizzle\'s own diff before applying.',
    '',
  ].join('\n'),
)
process.exit(1)
