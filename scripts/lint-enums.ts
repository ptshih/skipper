#!/usr/bin/env bun
// Enforces enum-VALUE lockstep between the Drizzle pgEnums (@skipper/db/schema) and their Zod
// twins (@skipper/shared). The schema comments say "keep these in lockstep" — this makes it
// mechanical instead of a hope. `lint:types` already guards type-NAME collisions; this guards
// the VALUES (a member added to one copy but not the other typechecks fine and only blows up at
// runtime — a wrong `poi_source` insert, a DTO that rejects a valid row). Run: `bun run lint:enums`
// (also in `bun run check`). Mirrors scripts/lint-{docs,type-collisions}.ts (collect → ✗ → exit 1).
//
// Importing the schema is side-effect-free (no DB connection, no env — CLAUDE.md scaffold note),
// so this runs anywhere `bun run check` does.

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Relative source imports (not the '@skipper/*' specifiers): root scripts/ isn't a workspace
// member, so the subpath exports don't resolve here — same reason lint-type-collisions reads
// files as text. Importing the schema is still side-effect-free (no DB, no env).
import {
  poiSourceEnum,
  narrationFormEnum,
} from '../packages/db/src/schema'
import {
  poiSource,
  narrationForm,
  attributionSource,
} from '../packages/shared/src/enums'

const errors: string[] = []
const norm = (xs: readonly string[]) => [...xs].sort().join(', ')

// pgEnum.enumValues (Drizzle) must equal its Zod z.enum.options, member-for-member.
const PAIRS: { name: string; pg: readonly string[]; zod: readonly string[] }[] = [
  { name: 'poi_source ⇄ poiSource', pg: poiSourceEnum.enumValues, zod: poiSource.options },
  { name: 'narration_form ⇄ narrationForm', pg: narrationFormEnum.enumValues, zod: narrationForm.options },
]
for (const { name, pg, zod } of PAIRS) {
  if (norm(pg) !== norm(zod)) {
    errors.push(`${name}: pgEnum [${norm(pg)}] ≠ Zod [${norm(zod)}] — add the member to BOTH.`)
  }
}

// attributionSource is a documented SUPERSET of poiSource (a clip can credit enrichment that owns
// no `pois` row — Macrostrat, etc.). Every discovery source MUST be a creditable attribution source.
const missing = poiSource.options.filter((s) => !attributionSource.options.includes(s))
if (missing.length) {
  errors.push(
    `attributionSource must be a SUPERSET of poiSource, but is missing: [${missing.join(', ')}]. ` +
      `A discovered POI source that can't be credited breaks CC attribution.`,
  )
}

// AttributionSnapshot['source'] (a pure TS literal union in @skipper/db/schema, NO runtime value)
// duplicates the Zod `attributionSource` enum — keep them in lockstep. A pgEnum/Zod pair compares
// by VALUE above; this union has none, so TEXT-SCAN the schema for its members (like
// lint-type-collisions reads files as text). Only the LITERAL AttributionSnapshot union — NOT
// FactSheetEntry's `Exclude<AttributionSnapshot['source'], …>`, a derived type with no literals.
const SCHEMA_TS = resolve(import.meta.dir, '..', 'packages/db/src/schema.ts')
const schemaSrc = readFileSync(SCHEMA_TS, 'utf8')
const snapSrc = schemaSrc.match(/AttributionSnapshot\s*=\s*\{[^}]*?\bsource:\s*([^\n]+)/)?.[1]
if (!snapSrc) {
  // The match broke (the type was renamed or its `source:` field moved) — fail loudly rather than
  // silently stop guarding the union ⇄ enum lockstep.
  errors.push(
    `Could not find AttributionSnapshot['source'] union in ${join('packages/db/src', 'schema.ts')} ` +
      `— the type/field shape changed; update lint-enums.ts.`,
  )
} else {
  const snapMembers = [...snapSrc.matchAll(/'([^']+)'/g)].map((m) => m[1]!)
  if (snapMembers.length === 0) {
    errors.push(`AttributionSnapshot['source'] union has no string literals — update lint-enums.ts.`)
  } else if (norm(snapMembers) !== norm(attributionSource.options)) {
    errors.push(
      `AttributionSnapshot['source'] [${norm(snapMembers)}] ≠ Zod attributionSource ` +
        `[${norm(attributionSource.options)}] — add the member to BOTH.`,
    )
  }
}

if (errors.length) {
  console.error(`lint:enums — ${errors.length} enum-lockstep violation(s) (CLAUDE.md):\n`)
  for (const e of errors) console.error(`  ✗ ${e}`)
  process.exit(1)
}
console.log(
  `lint:enums — OK (${PAIRS.length} pgEnum⇄Zod pairs in lockstep + attributionSource⊇poiSource + ` +
    `AttributionSnapshot['source']⇄attributionSource)`,
)
