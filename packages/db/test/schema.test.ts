// Schema-invariant guards. These assert that schema.ts DECLARES the structural invariants
// the rest of the system relies on — the pois dedup key, the delete-cascade/restrict graph,
// and the "every narration has audio" NOT NULL columns. They introspect the Drizzle table
// definitions (the source of truth the migrations are generated from), so they run offline in
// the normal `bun test` gate — no live DB, no shared-DB pollution. Postgres itself is trusted
// to ENFORCE a declared constraint; what these catch is a schema edit that silently DROPS one.
import { describe, expect, it } from 'bun:test'
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core'
import {
  creditEntries,
  drives,
  narrations,
  places,
  poiOverrides,
  poiSourceEnum,
  pois,
} from '../src/schema'

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

/** Every index name on a table (unique or not) — for asserting a (partial) index exists. */
function indexNames(table: PgTable): string[] {
  return getTableConfig(table)
    .indexes.map((i) => i.config.name)
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

/** Every column's DB name on a table — for asserting the ABSENCE of a column (a negative invariant). */
function columnNames(table: PgTable): string[] {
  return getTableConfig(table).columns.map((c) => c.name)
}

/** The TARGET table name of every FK on a table — for asserting no FK points at a forbidden table. */
function fkTargetTables(table: PgTable): string[] {
  return getTableConfig(table).foreignKeys.map((fk) =>
    getTableConfig(fk.reference().foreignTable as PgTable).name,
  )
}

/** A named table-level UNIQUE CONSTRAINT (drizzle `unique(name).on(...)`) — these live in
 *  `.uniqueConstraints`, NOT `.indexes`, so `uniqueIndexNames` misses them. */
function uniqueConstraint(table: PgTable, name: string) {
  const u = getTableConfig(table).uniqueConstraints.find((c) => c.name === name)
  if (!u) throw new Error(`no unique constraint "${name}" on ${getTableConfig(table).name}`)
  return u
}

/** Named CHECK constraints on a table (drizzle `check(name, sql)`) — they live in `.checks`. */
function checkNames(table: PgTable): string[] {
  return getTableConfig(table).checks.map((c) => c.name)
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
  it('pins poi_source membership to EXACTLY {wikipedia, wikidata} — google_places is attribution-only, NEVER a poi source', () => {
    // lint:enums only checks the pgEnum ⇄ Zod twin stay EQUAL to each other; a coordinated re-add of
    // 'google_places' to both would pass it. This pins the SET so that re-add fails the gate.
    expect([...poiSourceEnum.enumValues].sort()).toEqual(['wikidata', 'wikipedia'])
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
  it('facts_hash is NULLABLE — only story grounds on facts; scenic carries none and is never fact-stale', () => {
    expect(columnByDbName(narrations, 'facts_hash').notNull).toBe(false)
  })
  it('carries NO persona/voice/joke/delivery column — the one host resolves in CODE and is baked into audio (joke notch CUT)', () => {
    // Persona/voice/delivery are GENERATION params baked into the clip, never a narration column or a
    // live playback toggle. A future persona_key/voice_id/jokeLevel column would silently regress this.
    for (const name of columnNames(narrations)) {
      expect(name).not.toMatch(/persona|voice|joke|delivery/)
    }
  })
  it('a STORY clip must carry frozen attribution — the CC BY-SA legal floor (form-conditional CHECK)', () => {
    expect(checkNames(narrations)).toContain('narrations_story_attribution')
  })
  it('a narration can never have form=break — a break is NOT a narration row (break audio lives in detours)', () => {
    expect(checkNames(narrations)).toContain('narrations_form_not_break')
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
  it('pins the kind→amount SIGN — a wrong-sign movement cannot silently corrupt the SUM balance', () => {
    expect(checkNames(creditEntries)).toContain('credit_entries_amount_sign')
  })
})

describe('places — curated break/endpoint anchor structural invariants', () => {
  it('a place dedupes by a UNIQUE place_id, with place_id/name/lat/lng NOT NULL', () => {
    expect(uniqueIndexNames(places)).toContain('places_place_id_uq')
    for (const col of ['place_id', 'name', 'lat', 'lng']) {
      expect(columnByDbName(places, col).notNull).toBe(true)
    }
  })
  it('a place carries independent role flags (endpoint/break) + featured, all NOT NULL default false', () => {
    // Two INDEPENDENT booleans (not a tri-value enum) so a place can be BOTH and the admin can prune
    // one role without touching the other. NOT NULL + a default keeps the curate upsert + the picker
    // query total (no null-role rows). See docs/designs/places-endpoints-spec.md.
    for (const col of ['endpoint_eligible', 'break_eligible', 'featured']) {
      const c = columnByDbName(places, col)
      expect(c.notNull).toBe(true)
      expect(c.hasDefault).toBe(true)
      expect((c as { default?: unknown }).default).toBe(false)
    }
  })
  it('the endpoint picker has a partial bbox index (places_endpoint_idx) for GET /drives/anchors', () => {
    expect(indexNames(places)).toContain('places_endpoint_idx')
  })
  // ⚠ Three `detours` structural assertions lived here until the 1.1 sweep (D27). The table has ZERO
  // WRITERS — break audio is stubbed and nothing generates it — so they pinned the shape of something
  // that has never held a row, and would have had to be rewritten by whoever finally builds it. The
  // TABLE stays until an explicit drop call; only the tests that pretended it was live are gone.
})

describe('geometry-first regions — region is a BBOX, never a stored FK', () => {
  it('no coordinate-bearing table carries a region_id column (membership = point-in-bbox, derived)', () => {
    for (const t of [pois, drives]) {
      expect(columnNames(t)).not.toContain('region_id')
    }
  })
  it('neither pois nor drives has a foreign key into regions (the explicitly-warned-against re-stamp)', () => {
    expect(fkTargetTables(pois)).not.toContain('regions')
    expect(fkTargetTables(drives)).not.toContain('regions')
  })
})

describe('poi_overrides — curated-correction identity invariant', () => {
  it('one row per (source, source_id, find) via a NULLS NOT DISTINCT unique constraint (the admin upsert ON CONFLICT target)', () => {
    const u = uniqueConstraint(poiOverrides, 'poi_overrides_identity_uq')
    expect(u.columns.map((c) => c.name)).toEqual(['source', 'source_id', 'find'])
    expect(u.nullsNotDistinct).toBe(true)
  })
  it('keeps source / source_id / reason NOT NULL (identity + self-documentation)', () => {
    for (const col of ['source', 'source_id', 'reason']) {
      expect(columnByDbName(poiOverrides, col).notNull).toBe(true)
    }
  })
})
