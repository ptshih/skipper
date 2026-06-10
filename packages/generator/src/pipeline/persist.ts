// Persistence — Drizzle writes for the generator (zero-reuse model).
//
// The tour SHELL (route + endpoints + region) is created by the SEED as a `draft`
// row; the generator FILLS it. Narration is TOUR-OWNED — it lives on tour_stops /
// tour_brackets, never a shared poi_content cache. Order of operations (neon-http,
// no interactive transactions):
//   1. upsert pois (deduped on (source, source_id); stamp facts_hash/facts_fetched_at)
//   2. synthesize each stop's clip to a TOUR-scoped R2 key (clips/<tourId>/<stopId>)
//   3. synthesize the intro/outro bracket clips (clips/<tourId>/intro|outro)
//   4. ATOMIC ready-gate: db.batch([ clear old stops+brackets, flip status->ready,
//      insert all tour_stops, insert both tour_brackets ])
// Step 4 co-commits the status flip with the stop AND bracket rows in ONE implicit
// transaction, so a tour can never be `ready` with a missing stop or bracket. On any
// failure the caller marks the tour `failed`.

import { createHash } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import { pois, regions, tourBrackets, tourStops, tours } from '@skipper/db/schema'
import type {
  AttributionSnapshot,
  NewTourBracket,
  NewTourStop,
  PoiFacts,
  Polyline,
} from '@skipper/db/schema'
import type { BracketKind, PoiSource, StopType } from '@skipper/shared'

/** The seeded draft tour the generator fills — route geometry, endpoints, region. */
export interface TourShell {
  id: string
  slug: string
  /** Status at LOAD time — the snapshot a failed run restores (see restoreAfterFailedRun)
   *  and the signal that another run may already be in flight ('generating'). */
  status: 'draft' | 'generating' | 'ready' | 'failed'
  headline: string
  regionId: string
  regionSlug: string
  regionName: string
  polyline: Polyline
  distanceMeters: number | null
  durationSeconds: number | null
  startAnchorName: string
  startAnchorLat: number
  startAnchorLng: number
  endAnchorName: string
  endAnchorLat: number
  endAnchorLng: number
}

/** Load the seeded draft tour (geometry + endpoints + region) by slug. */
export async function loadTour(slug: string): Promise<TourShell> {
  const rows = await db
    .select({
      id: tours.id,
      slug: tours.slug,
      status: tours.status,
      headline: tours.headline,
      regionId: tours.regionId,
      regionSlug: regions.slug,
      regionName: regions.displayName,
      polyline: tours.polyline,
      distanceMeters: tours.distanceMeters,
      durationSeconds: tours.durationSeconds,
      startAnchorName: tours.startAnchorName,
      startAnchorLat: tours.startAnchorLat,
      startAnchorLng: tours.startAnchorLng,
      endAnchorName: tours.endAnchorName,
      endAnchorLat: tours.endAnchorLat,
      endAnchorLng: tours.endAnchorLng,
    })
    .from(tours)
    .innerJoin(regions, eq(tours.regionId, regions.id))
    .where(eq(tours.slug, slug))
    .limit(1)
  const row = rows[0]
  if (!row) throw new Error(`No tour seeded for slug "${slug}" — run the seed step first.`)
  return row
}

/** Hash of a poi's facts — the change-detector for narration staleness. Null when no facts. */
export function hashFacts(facts: PoiFacts | null): string | null {
  if (!facts) return null
  return createHash('sha256').update(JSON.stringify(facts)).digest('hex')
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
  /** Change-detector hash of `facts` (hashFacts). Null for break/scenic (no facts). */
  factsHash: string | null
}

/** Upsert a POI deduped on (source, source_id); stamps facts freshness; returns its id. */
export async function upsertPoi(input: UpsertPoiInput): Promise<string> {
  const { factsHash, ...rest } = input
  // Only a real facts fetch (a story stop) stamps the freshness clock; a scenic/break
  // write carries no facts.
  const factsFetchedAt = factsHash ? new Date() : null
  const rows = await db
    .insert(pois)
    .values({ ...rest, factsHash, factsFetchedAt })
    .onConflictDoUpdate({
      target: [pois.source, pois.sourceId],
      set: {
        // Location is always current — refresh it.
        name: sql`excluded.name`,
        kind: sql`excluded.kind`,
        lat: sql`excluded.lat`,
        lng: sql`excluded.lng`,
        // FACTS are SHARED across tours: the SAME place can be a story stop on one tour and
        // a (factless) scenic/break stop on another. NEVER let a factless write blank a place
        // that already carries facts — COALESCE keeps the richest known facts/summary, while a
        // genuine re-fetch (non-null incoming) still overwrites. (Upholds the "pois is the
        // shared facts cache" invariant + keeps the facts_hash staleness contract honest.)
        summary: sql`coalesce(excluded.summary, ${pois.summary})`,
        facts: sql`coalesce(excluded.facts, ${pois.facts})`,
        factsHash: sql`coalesce(excluded.facts_hash, ${pois.factsHash})`,
        factsFetchedAt: sql`coalesce(excluded.facts_fetched_at, ${pois.factsFetchedAt})`,
        updatedAt: new Date(),
      },
    })
    .returning({ id: pois.id })
  return rows[0]!.id
}

/**
 * Mark the tour `generating` (a status marker; the ready-gate does the real write).
 *
 * Deliberately a BLIND update, not a compare-and-set: a hard-killed run leaves the status
 * stuck on 'generating', and this write is the self-heal that lets the next run proceed.
 * The caller WARNS when the loaded shell already said 'generating' (a concurrent run may be
 * in flight); the damage a true race could do is contained by per-run-unique clip AND
 * bracket keys (storage.ts) — two runs never write the same R2 object.
 */
export async function markTourGenerating(tourId: string): Promise<void> {
  await db.update(tours).set({ status: 'generating' }).where(eq(tours.id, tourId))
}

/** A fully-narrated, fully-synthesized stop, ready to write onto its tour. */
export interface FinalStop {
  /** Client-generated stop id (also the clip key: clips/<tourId>/<id>). */
  id: string
  seq: number
  poiId: string
  stopType: StopType
  script: string
  audioUrl: string
  audioDurationMs: number
  /** One entry per source the clip drew on (Wikipedia + Macrostrat geology, etc.). */
  attribution: AttributionSnapshot[] | null
  /** The pois.facts_hash this narration grounded on (story only; null for scenic/break). */
  factsHash: string | null
  triggerRadiusM: number
  /** POI snapped to the route (the trigger point) + the route heading there. */
  triggerLat: number
  triggerLng: number
  approachHeadingDeg: number
}

/** A fully-narrated, fully-synthesized intro/outro bracket. */
export interface FinalBracket {
  kind: BracketKind
  script: string
  audioUrl: string
  audioDurationMs: number
}

/**
 * Atomic ready-gate: clear any prior stops/brackets, flip the tour to `ready`, and
 * write ALL tour_stops + both tour_brackets in one batch (one implicit transaction
 * over HTTP). All-or-nothing — never a `ready` tour with a missing stop or bracket.
 */
export async function finalizeTourReady(
  tourId: string,
  stops: FinalStop[],
  brackets: FinalBracket[],
): Promise<void> {
  if (stops.length === 0) throw new Error(`Refusing to finalize tour ${tourId} with zero stops.`)
  const haveIntro = brackets.some((b) => b.kind === 'intro')
  const haveOutro = brackets.some((b) => b.kind === 'outro')
  if (!haveIntro || !haveOutro) {
    throw new Error(`Refusing to finalize tour ${tourId} without BOTH intro and outro brackets.`)
  }
  const stopRows: NewTourStop[] = stops.map((s) => ({
    id: s.id,
    tourId,
    seq: s.seq,
    poiId: s.poiId,
    stopType: s.stopType,
    script: s.script,
    audioUrl: s.audioUrl,
    audioDurationMs: s.audioDurationMs,
    attribution: s.attribution,
    factsHash: s.factsHash,
    triggerRadiusM: s.triggerRadiusM,
    triggerLat: s.triggerLat,
    triggerLng: s.triggerLng,
    approachHeadingDeg: s.approachHeadingDeg,
  }))
  const bracketRows: NewTourBracket[] = brackets.map((b) => ({
    tourId,
    kind: b.kind,
    script: b.script,
    audioUrl: b.audioUrl,
    audioDurationMs: b.audioDurationMs,
  }))
  await db.batch([
    db.delete(tourStops).where(eq(tourStops.tourId, tourId)),
    db.delete(tourBrackets).where(eq(tourBrackets.tourId, tourId)),
    db
      .update(tours)
      .set({ status: 'ready' })
      .where(eq(tours.id, tourId))
      .returning({ id: tours.id }),
    db.insert(tourStops).values(stopRows).returning({ id: tourStops.id }),
    db.insert(tourBrackets).values(bracketRows).returning({ id: tourBrackets.id }),
  ])
}

/**
 * Conclude a run that THREW, restoring the right status (best-effort cleanup).
 *
 * A failed RE-generation of a previously-ready tour must restore 'ready', not 'failed':
 * the old telling's rows and clips are fully intact and servable — finalizeTourReady's
 * deletes live inside the never-executed batch — so flipping to 'failed' would silently
 * take a live tour (the demo!) offline over one mid-run hiccup. Anything else concludes
 * 'failed' as before. Guarded by `status = 'generating'` so it can never clobber a state
 * some other actor has since set (e.g. a concurrent run that finalized to 'ready').
 */
export async function restoreAfterFailedRun(
  tourId: string,
  priorStatus: TourShell['status'],
): Promise<void> {
  await db
    .update(tours)
    .set({ status: priorStatus === 'ready' ? 'ready' : 'failed' })
    .where(and(eq(tours.id, tourId), eq(tours.status, 'generating')))
}
