// Schema-invariant guards. These assert that schema.ts DECLARES the structural invariants
// the rest of the system relies on — the pois dedup key, the delete-cascade/restrict graph,
// and the "every stop/frame has audio" NOT NULL columns. They introspect the Drizzle table
// definitions (the source of truth the migrations are generated from), so they run offline in
// the normal `bun test` gate — no live DB, no shared-DB pollution. Postgres itself is trusted
// to ENFORCE a declared constraint; what these catch is a schema edit that silently DROPS one.
import { describe, expect, it } from 'bun:test'
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core'
import { pois, segments, tourFrames, tracks } from '../src/schema'

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

describe('delete graph — narration dies with its tour, facts survive', () => {
  it('tracks cascade-delete with their segment', () => {
    expect(fkOnDelete(tracks, 'segment_id')).toBe('cascade')
  })
  it('segments cascade-delete with their tour (the ready-gate clears by tourId)', () => {
    expect(fkOnDelete(segments, 'tour_id')).toBe('cascade')
  })
  it('frames cascade-delete with their tour', () => {
    expect(fkOnDelete(tourFrames, 'tour_id')).toBe('cascade')
  })
  it('a poi is RESTRICTed from deletion while a segment references it (facts are shared)', () => {
    expect(fkOnDelete(segments, 'poi_id')).toBe('restrict')
  })
})

describe('audio invariant — every stop AND frame carries audio at the DB boundary', () => {
  // Guards the 0004 migration: a track/frame row can never persist without audio.
  for (const [label, table] of [
    ['tracks', tracks],
    ['tour_frames', tourFrames],
  ] as const) {
    it(`${label}.audio_url is NOT NULL`, () => {
      expect(columnByDbName(table, 'audio_url').notNull).toBe(true)
    })
    it(`${label}.audio_duration_ms is NOT NULL`, () => {
      expect(columnByDbName(table, 'audio_duration_ms').notNull).toBe(true)
    })
  }
})

describe('per-tour ordering uniques (no duplicate seq / form / frame-kind)', () => {
  it('segments are unique per (tour, seq)', () => {
    expect(uniqueIndexNames(segments)).toContain('segments_tour_seq_uq')
  })
  it('tracks are unique per (segment, form, variant)', () => {
    expect(uniqueIndexNames(tracks)).toContain('tracks_segment_form_variant_uq')
  })
  it('frames are unique per (tour, kind) — one intro, one outro', () => {
    expect(uniqueIndexNames(tourFrames)).toContain('tour_frames_tour_kind_uq')
  })
})
