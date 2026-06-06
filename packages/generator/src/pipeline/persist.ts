// Persistence — Drizzle writes for the generator.
//
// Order of operations is dictated by neon-http (no interactive transactions):
//   1. upsert pois (deduped on (source, source_id))
//   2. upsert poi_content per narrated stop (cache key (poi, persona, voice, joke))
//   3. create the tour as `generating`
//   4. ATOMIC ready-gate: db.batch([ flip status->ready, insert all tour_stops ])
// Step 4 co-commits the status flip with the stop rows in ONE implicit
// transaction, so a tour can never be `ready` with missing stops. On any failure
// the caller marks the tour `failed`.
//
// onConflictDoUpdate (NOT DoNothing) is used everywhere we need the row id back —
// DoNothing returns nothing on conflict.

import { eq, sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import { corridors, poiContent, pois, tourStops, tours } from '@skipper/db/schema'
import type { AttributionSnapshot, NewTourStop, PoiFacts, Polyline } from '@skipper/db/schema'
import type { DurationBucket, JokeLevel, Persona, PoiSource, StopType } from '@skipper/shared'

export interface CorridorRow {
  id: string
  region: string
  name: string
  slug: string
  polyline: Polyline
  distanceMeters: number | null
  durationSeconds: number | null
}

/** Load the seeded corridor (geometry + frozen totals) by slug. */
export async function loadCorridor(slug: string): Promise<CorridorRow> {
  const rows = await db
    .select({
      id: corridors.id,
      region: corridors.region,
      name: corridors.name,
      slug: corridors.slug,
      polyline: corridors.polyline,
      distanceMeters: corridors.distanceMeters,
      durationSeconds: corridors.durationSeconds,
    })
    .from(corridors)
    .where(eq(corridors.slug, slug))
    .limit(1)
  const row = rows[0]
  if (!row) throw new Error(`No corridor seeded for slug "${slug}" — run the seed step first.`)
  return row
}

export interface UpsertPoiInput {
  source: PoiSource
  sourceId: string
  name: string
  kind: string | null
  lat: number
  lng: number
  summary: string | null
  facts: PoiFacts | null
}

/** Upsert a POI deduped on (source, source_id); returns its id on both insert and conflict. */
export async function upsertPoi(input: UpsertPoiInput): Promise<string> {
  const rows = await db
    .insert(pois)
    .values(input)
    .onConflictDoUpdate({
      target: [pois.source, pois.sourceId],
      set: {
        name: sql`excluded.name`,
        kind: sql`excluded.kind`,
        lat: sql`excluded.lat`,
        lng: sql`excluded.lng`,
        summary: sql`excluded.summary`,
        facts: sql`excluded.facts`,
        updatedAt: new Date(),
      },
    })
    .returning({ id: pois.id })
  return rows[0]!.id
}

export interface UpsertContentInput {
  poiId: string
  persona: Persona
  voice: string
  jokeLevel: JokeLevel
  script: string
  audioUrl: string
  audioDurationMs: number
  attribution: AttributionSnapshot | null
}

/** Upsert generated content on the cache key (poi, persona, voice, joke_level); returns its id. */
export async function upsertPoiContent(input: UpsertContentInput): Promise<string> {
  const rows = await db
    .insert(poiContent)
    .values(input)
    .onConflictDoUpdate({
      target: [poiContent.poiId, poiContent.persona, poiContent.voice, poiContent.jokeLevel],
      set: {
        script: sql`excluded.script`,
        audioUrl: sql`excluded.audio_url`,
        audioDurationMs: sql`excluded.audio_duration_ms`,
        attribution: sql`excluded.attribution`,
        updatedAt: new Date(),
      },
    })
    .returning({ id: poiContent.id })
  return rows[0]!.id
}

export interface CreateTourInput {
  corridorId: string
  durationBucket: DurationBucket
  persona: Persona
  jokeLevel: JokeLevel
}

/** Create the tour in `generating` state; returns its id. */
export async function createTour(input: CreateTourInput): Promise<string> {
  const rows = await db
    .insert(tours)
    .values({ ...input, status: 'generating' })
    .returning({ id: tours.id })
  return rows[0]!.id
}

export interface FinalStop {
  seq: number
  poiId: string
  poiContentId: string | null
  stopType: StopType
  triggerRadiusM: number
}

/**
 * Atomic ready-gate: flip the tour to `ready` and write ALL tour_stops in one
 * batch (one implicit transaction over HTTP). All-or-nothing — never a `ready`
 * tour with missing stops.
 */
export async function finalizeTourReady(tourId: string, stops: FinalStop[]): Promise<void> {
  if (stops.length === 0) throw new Error(`Refusing to finalize tour ${tourId} with zero stops.`)
  const rows: NewTourStop[] = stops.map((s) => ({
    tourId,
    seq: s.seq,
    poiId: s.poiId,
    poiContentId: s.poiContentId,
    stopType: s.stopType,
    triggerRadiusM: s.triggerRadiusM,
  }))
  await db.batch([
    db.update(tours).set({ status: 'ready' }).where(eq(tours.id, tourId)).returning({ id: tours.id }),
    db.insert(tourStops).values(rows).returning({ id: tourStops.id }),
  ])
}

/** Mark a tour `failed` (best-effort cleanup when generation throws). */
export async function markTourFailed(tourId: string): Promise<void> {
  await db.update(tours).set({ status: 'failed' }).where(eq(tours.id, tourId))
}
