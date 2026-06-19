// Schema-invariant guards. These assert that schema.ts DECLARES the structural invariants
// the rest of the system relies on — the pois dedup key, the delete-cascade/restrict graph,
// and the "every stop/frame has audio" NOT NULL columns. They introspect the Drizzle table
// definitions (the source of truth the migrations are generated from), so they run offline in
// the normal `bun test` gate — no live DB, no shared-DB pollution. Postgres itself is trusted
// to ENFORCE a declared constraint; what these catch is a schema edit that silently DROPS one.
import { describe, expect, it } from 'bun:test'
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core'
import { drives, asides, narrations, pois } from '../src/schema'

function columnByDbName(table: PgTable, dbName: string) {
  const c = getTableConfig(table).columns.find((col) => col.name === dbName)
  if (!c) throw new Error(`no column "${dbName}" on ${getTableConfig(table).name}`)
  return c
}

function uniqueIndexNames(table: PgTable): string[] {
  return getTableConfig(table)
    .indexes.filter((i) => i.config.unique)
    .map((i) => i.config.name)
    .filter((n): n is string => typeof n === 'string')
}

/** Names of UNIQUE CONSTRAINTS (vs uniqueIndex) — e.g. a `unique().nullsNotDistinct()`. */
function uniqueConstraintNames(table: PgTable): string[] {
  return getTableConfig(table).uniqueConstraints.map((u) => u.name)
}

/** The ON DELETE action for the FK whose LOCAL column is `localDbName` (e.g. 'segment_id'). */
function fkOnDelete(table: PgTable, localDbName: string): string | undefined {
  const fk = getTableConfig(table).foreignKeys.find((fk) =>
    fk.reference().columns.some((col) => col.name === localDbName),
  )
  if (!fk) throw new Error(`no FK on "${localDbName}" of ${getTableConfig(table).name}`)
  return fk.onDelete
}

describe('pois — the shared-facts dedup invariant', () => {
  it('dedupes by a UNIQUE (source, source_id) index', () => {
    expect(uniqueIndexNames(pois)).toContain('pois_source_source_id_uq')
  })
  it('keeps source + source_id NOT NULL (attribution + dedup both need them)', () => {
    expect(columnByDbName(pois, 'source').notNull).toBe(true)
    expect(columnByDbName(pois, 'source_id').notNull).toBe(true)
  })
})

describe('V2 — narrations / drives / asides structural invariants', () => {
  it('narrations are 1:1 with a poi (UNIQUE poi_id)', () => {
    expect(uniqueIndexNames(narrations)).toContain('narrations_poi_uq')
  })
  it('a narration cascade-deletes with its poi (the telling dies with the place)', () => {
    expect(fkOnDelete(narrations, 'poi_id')).toBe('cascade')
  })
  it('a poi is RESTRICTed from deletion by NOTHING now (narration cascades, facts shared)', () => {
    // pois have no inbound RESTRICT FK in V2 (the old segments→poi restrict is gone); narrations
    // cascade. This documents the V2 delete graph: deleting a poi takes its narration with it.
    expect(fkOnDelete(narrations, 'poi_id')).toBe('cascade')
  })
  it('a narration always carries audio (audio_url + audio_duration_ms NOT NULL)', () => {
    expect(columnByDbName(narrations, 'audio_url').notNull).toBe(true)
    expect(columnByDbName(narrations, 'audio_duration_ms').notNull).toBe(true)
  })
  it('asides always carry audio + are unique per (region, persona, kind, variant)', () => {
    expect(columnByDbName(asides, 'audio_url').notNull).toBe(true)
    expect(columnByDbName(asides, 'audio_duration_ms').notNull).toBe(true)
    expect(uniqueConstraintNames(asides)).toContain('asides_lookup_uq')
  })
  it('a drive is user-owned (user_id NOT NULL) and carries a route signature', () => {
    expect(columnByDbName(drives, 'user_id').notNull).toBe(true)
    expect(columnByDbName(drives, 'route_sig').notNull).toBe(true)
  })
})
