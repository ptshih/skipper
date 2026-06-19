// Schema-invariant guards. These assert that schema.ts DECLARES the structural invariants
// the rest of the system relies on — the pois dedup key, the delete-cascade/restrict graph,
// and the "every stop/frame has audio" NOT NULL columns. They introspect the Drizzle table
// definitions (the source of truth the migrations are generated from), so they run offline in
// the normal `bun test` gate — no live DB, no shared-DB pollution. Postgres itself is trusted
// to ENFORCE a declared constraint; what these catch is a schema edit that silently DROPS one.
import { describe, expect, it } from 'bun:test'
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core'
import { creditEntries, detours, drives, narrations, places, pois } from '../src/schema'

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

/** True if `dbName` carries a COLUMN-LEVEL `.unique()` (e.g. credit_entries.idempotency_key). These
 *  do NOT appear in `.indexes`, so `uniqueIndexNames` would miss them — this reads `column.isUnique`. */
function columnIsUnique(table: PgTable, dbName: string): boolean {
  return Boolean((columnByDbName(table, dbName) as { isUnique?: boolean }).isUnique)
}

/** The ON DELETE action for the FK whose LOCAL column is `localDbName` (e.g. 'place_id'). */
function fkOnDelete(table: PgTable, localDbName: string): string | undefined {
  const fk = getTableConfig(table).foreignKeys.find((fk) =>
    fk.reference().columns.some((col) => col.name === localDbName),
  )
  if (!fk) throw new Error(`no FK on "${localDbName}" of ${getTableConfig(table).name}`)
  return fk.onDelete
}

/** The FOREIGN (target) column names for the FK whose LOCAL column is `localDbName`. */
function fkTargetColumns(table: PgTable, localDbName: string): string[] {
  const fk = getTableConfig(table).foreignKeys.find((fk) =>
    fk.reference().columns.some((col) => col.name === localDbName),
  )
  if (!fk) throw new Error(`no FK on "${localDbName}" of ${getTableConfig(table).name}`)
  return fk.reference().foreignColumns.map((c) => c.name)
}

describe('pois — the shared-facts dedup invariant', () => {
  it('PRIMARY dedup key is the Wikidata QID (UNIQUE qid, NOT NULL) — catches a scenic↔story flip', () => {
    expect(uniqueIndexNames(pois)).toContain('pois_qid_uq')
    expect(columnByDbName(pois, 'qid').notNull).toBe(true)
  })
  it('keeps the SECONDARY (source, source_id) UNIQUE index for per-source dedup', () => {
    expect(uniqueIndexNames(pois)).toContain('pois_source_source_id_uq')
  })
  it('keeps source + source_id NOT NULL (attribution + dedup both need them)', () => {
    expect(columnByDbName(pois, 'source').notNull).toBe(true)
    expect(columnByDbName(pois, 'source_id').notNull).toBe(true)
  })
})

describe('V2 — narrations / drives structural invariants', () => {
  it('narrations are 1:1 with a poi (UNIQUE poi_id)', () => {
    expect(uniqueIndexNames(narrations)).toContain('narrations_poi_uq')
  })
  it('a narration cascade-deletes with its poi (deleting a poi takes its narration; pois have no inbound RESTRICT FK in V2)', () => {
    expect(fkOnDelete(narrations, 'poi_id')).toBe('cascade')
  })
  it('a narration always carries audio (audio_url + audio_duration_ms NOT NULL)', () => {
    expect(columnByDbName(narrations, 'audio_url').notNull).toBe(true)
    expect(columnByDbName(narrations, 'audio_duration_ms').notNull).toBe(true)
  })
  it('a drive is user-owned (user_id NOT NULL) and carries a route signature', () => {
    expect(columnByDbName(drives, 'user_id').notNull).toBe(true)
    expect(columnByDbName(drives, 'route_sig').notNull).toBe(true)
  })
})

describe('credit_entries — the money / double-charge invariants', () => {
  it('idempotency_key is UNIQUE — the SINGLE structural guard against double-charging', () => {
    // COLUMN-LEVEL .unique() (not a named index), so it must be checked via column.isUnique — the
    // ON CONFLICT DO NOTHING in credits.ts (grant + consume) relies entirely on this constraint.
    expect(columnIsUnique(creditEntries, 'idempotency_key')).toBe(true)
  })
  it('keeps the ledger money/identity columns NOT NULL (amount, kind, user_id, idempotency_key)', () => {
    // A null amount corrupts the SUM(amount) balance; a null kind/user_id mis-attributes credits;
    // a null idempotency_key defeats the dedupe guard above.
    expect(columnByDbName(creditEntries, 'amount').notNull).toBe(true)
    expect(columnByDbName(creditEntries, 'kind').notNull).toBe(true)
    expect(columnByDbName(creditEntries, 'user_id').notNull).toBe(true)
    expect(columnByDbName(creditEntries, 'idempotency_key').notNull).toBe(true)
  })
})

describe('places / detours — break-anchor structural invariants', () => {
  it('a place dedupes by a UNIQUE place_id, with place_id/name/lat/lng NOT NULL', () => {
    expect(uniqueIndexNames(places)).toContain('places_place_id_uq')
    for (const col of ['place_id', 'name', 'lat', 'lng']) {
      expect(columnByDbName(places, col).notNull).toBe(true)
    }
  })
  it('a detour is 1:1 with its place (UNIQUE place_id) and cascade-deletes with it', () => {
    expect(uniqueIndexNames(detours)).toContain('detours_place_uq')
    expect(fkOnDelete(detours, 'place_id')).toBe('cascade')
    // place_id FKs the internal UUID PK (places.id), NOT the Google text key (places.place_id) —
    // the name collision makes a wrong re-point plausible; pin the target.
    expect(fkTargetColumns(detours, 'place_id')).toEqual(['id'])
  })
  it('a detour always carries audio (audio_url + audio_duration_ms NOT NULL — a silent break never rides)', () => {
    expect(columnByDbName(detours, 'audio_url').notNull).toBe(true)
    expect(columnByDbName(detours, 'audio_duration_ms').notNull).toBe(true)
  })
})
