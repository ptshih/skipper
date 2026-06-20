#!/usr/bin/env bun
// Enforces the @skipper/shared (Zod DTO) ⇄ @skipper/db/schema (Drizzle row) type-name
// collision rule from CLAUDE.md ("Type-name collisions"): a handful of names are exported by
// BOTH packages with DIFFERENT shapes (read DTOs — nullish, internal cols omitted — vs the raw
// DB rows). So a Drizzle ROW type imported from '@skipper/db/schema' MUST be aliased (e.g.
// `import type { Tour as TourRow }`), and a barrel must never `export *` from both. Unaliased,
// the wrong-shaped type slips in silently and typechecks. Run: `bun run lint:types` (also in
// `bun run check`). Mirrors scripts/lint-docs.ts in shape (collect → print ✗ → exit 1).

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..')
const DB_SCHEMA = '@skipper/db/schema'
const SHARED = '@skipper/shared'
const SELF = 'scripts/lint-type-collisions.ts'

const errors: string[] = []

// 1. Derive the COLLISION SET dynamically = Drizzle row types (`export type X = typeof
//    t.$inferSelect`) that ALSO have a same-named exported type in @skipper/shared. This
//    naturally EXCLUDES structural helpers like Polyline (a plain `[number, number][]` alias in
//    both — same shape, harmless) and DB-only types (NewTour, PoiOverride, …). Deriving it (vs a
//    hardcoded list) keeps the guard correct as the schema/DTOs grow.
const dbSrc = readFileSync(join(ROOT, 'packages/db/src/schema.ts'), 'utf8')
// Every exported TYPE name from the schema — the Drizzle row types (`= typeof t.$inferSelect`) AND
// hand-written `export type X = {…}` / `export interface X` (RouteProvenance, DriveSelection,
// AttributionSnapshot, …). A hand-written shape collides just as silently as a row type, so both must
// be on the radar (was a gap: only $inferSelect was derived, so a future shared DTO named e.g.
// `DriveSelection` with a divergent shape slipped past).
const dbExportedTypes = new Set<string>([
  ...[...dbSrc.matchAll(/export\s+type\s+(\w+)/g)].map((m) => m[1]!),
  ...[...dbSrc.matchAll(/export\s+interface\s+(\w+)/g)].map((m) => m[1]!),
])
// Exported by BOTH packages but DELIBERATELY the same shape (a plain structural alias), so aliasing
// would be pointless noise. Keep this list tiny + documented. `Polyline` = `[number, number][]` in
// the schema, `z.infer` of the same tuple in shared.
const SAME_SHAPE = new Set(['Polyline'])
// The shared public surface = index.ts + every module it `export *`s. Parse the barrel so a
// newly-added module (e.g. audio.ts) is covered automatically — a hardcoded file list silently drops
// it (audio.ts was added and immediately fell outside the old list).
const sharedDir = join(ROOT, 'packages/shared/src')
const barrelSrc = readFileSync(join(sharedDir, 'index.ts'), 'utf8')
const sharedFiles = [
  'index.ts',
  ...[...barrelSrc.matchAll(/export\s+\*\s+from\s+['"]\.\/([\w-]+)['"]/g)].map((m) => `${m[1]}.ts`),
]
const sharedExports = new Set<string>()
for (const f of sharedFiles) {
  const p = join(sharedDir, f)
  if (!existsSync(p)) continue
  for (const m of readFileSync(p, 'utf8').matchAll(/export\s+type\s+(\w+)/g)) sharedExports.add(m[1]!)
}
const COLLISION = new Set(
  [...dbExportedTypes].filter((n) => sharedExports.has(n) && !SAME_SHAPE.has(n)),
)
if (COLLISION.size === 0) {
  // Not a violation, but a sign the derivation broke (renamed schema export form, moved files) —
  // fail loudly rather than silently pass and stop guarding.
  console.error(
    `lint:types — could not derive the collision set (0 names) from packages/db/src/schema.ts ∩ ` +
      `@skipper/shared. The schema/DTO export form likely changed — update this script.`,
  )
  process.exit(1)
}

// 2. Scan every tracked + untracked-unignored .ts/.tsx (same enumeration as lint-docs).
const ls = Bun.spawnSync(['git', 'ls-files', '-co', '--exclude-standard', '--', '*.ts', '*.tsx'], {
  cwd: ROOT,
})
const files = ls.stdout.toString().split('\n').filter(Boolean)

// Named specifiers in an `import {…}`/`export {…} from '@skipper/db/schema'` block (multi-line OK;
// imports never nest braces, so `[^}]*` is safe).
const NAMED_FROM_DB = /(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]@skipper\/db\/schema['"]/g
const starFrom = (spec: string) =>
  new RegExp(`export\\s+\\*\\s+from\\s+['"]${spec.replace('/', '\\/')}['"]`)

for (const rel of files) {
  if (rel === SELF) continue // the guard names the collision types in strings — don't scan itself
  const path = join(ROOT, rel)
  if (!existsSync(path)) continue // deleted in working tree but still tracked
  const content = readFileSync(path, 'utf8')
  if (!content.includes(DB_SCHEMA)) continue

  // (a) Unaliased collision-name imports/re-exports from @skipper/db/schema.
  for (const block of content.matchAll(NAMED_FROM_DB)) {
    const specs = block[1]!
      .replace(/\/\/[^\n]*/g, '') // strip line comments inside the braces
      .replace(/\/\*[\s\S]*?\*\//g, '') // …and block comments
      .split(',')
    for (const raw of specs) {
      const spec = raw.trim().replace(/^type\s+/, '') // drop a per-spec inline `type` modifier
      const m = spec.match(/^(\w+)(?:\s+as\s+(\w+))?$/)
      if (!m) continue
      const [, name, alias] = m
      if (COLLISION.has(name!) && !alias) {
        errors.push(
          `${rel}: imports \`${name}\` from ${DB_SCHEMA} unaliased — it's a Drizzle ROW type that ` +
            `collides with the @skipper/shared DTO \`${name}\` (different shape). Alias it: ` +
            `\`import type { ${name} as ${name}Row }\`. (CLAUDE.md: Type-name collisions.)`,
        )
      }
    }
  }

  // (b) A barrel that `export *`s from BOTH packages re-merges the colliding names into one surface.
  if (starFrom(SHARED).test(content) && starFrom(DB_SCHEMA).test(content)) {
    errors.push(
      `${rel}: \`export *\` from BOTH ${SHARED} and ${DB_SCHEMA} — re-exports the colliding type ` +
        `names into one barrel. Never barrel both. (CLAUDE.md: Type-name collisions.)`,
    )
  }
}

if (errors.length) {
  console.error(`lint:types — ${errors.length} type-name collision violation(s) (CLAUDE.md):\n`)
  for (const e of errors) console.error(`  ✗ ${e}`)
  process.exit(1)
}
console.log(`lint:types — OK (collision set: ${[...COLLISION].sort().join(', ')}; ${files.length} files scanned)`)
