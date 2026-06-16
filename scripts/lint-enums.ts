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

// Relative source imports (not the '@skipper/*' specifiers): root scripts/ isn't a workspace
// member, so the subpath exports don't resolve here — same reason lint-type-collisions reads
// files as text. Importing the schema is still side-effect-free (no DB, no env).
import {
  poiSourceEnum,
  tourStatusEnum,
  trackFormEnum,
  frameKindEnum,
} from '../packages/db/src/schema'
import {
  poiSource,
  tourStatus,
  trackForm,
  frameKind,
  attributionSource,
} from '../packages/shared/src/enums'

const errors: string[] = []
const norm = (xs: readonly string[]) => [...xs].sort().join(', ')

// pgEnum.enumValues (Drizzle) must equal its Zod z.enum.options, member-for-member.
const PAIRS: { name: string; pg: readonly string[]; zod: readonly string[] }[] = [
  { name: 'poi_source ⇄ poiSource', pg: poiSourceEnum.enumValues, zod: poiSource.options },
  { name: 'tour_status ⇄ tourStatus', pg: tourStatusEnum.enumValues, zod: tourStatus.options },
  { name: 'track_form ⇄ trackForm', pg: trackFormEnum.enumValues, zod: trackForm.options },
  { name: 'frame_kind ⇄ frameKind', pg: frameKindEnum.enumValues, zod: frameKind.options },
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

if (errors.length) {
  console.error(`lint:enums — ${errors.length} enum-lockstep violation(s) (CLAUDE.md):\n`)
  for (const e of errors) console.error(`  ✗ ${e}`)
  process.exit(1)
}
console.log(`lint:enums — OK (${PAIRS.length} pgEnum⇄Zod pairs in lockstep + attributionSource⊇poiSource)`)
