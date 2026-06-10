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
import { and, eq, or, sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import { pois, regions, tourBrackets, tourStops, tours } from '@skipper/db/schema'
import { cachedExtractSuspect, latestOverrideAtFor } from './poi-overrides'
import { withRetry } from './http'
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
  // Retry only the read (idempotent) — a "no tour seeded" miss is a real error, not a
  // transient, so the !row throw stays OUTSIDE the retry (fail fast, no confusing retries).
  const rows = await withRetry(
    () =>
      db
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
        .limit(1),
    { label: `loadTour(${slug})` },
  )
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
  /** The freshness stamp for these facts — CALLER-owned (review-caught, twice over):
   *  a cache-HIT persist must pass the row's ORIGINAL stamp (reuse never slides the TTL
   *  clock, or frequently-regenerated places would never re-fetch), and a fetched persist
   *  passes the run's overrides-snapshot instant, NOT persist-time now() (a correction
   *  adjudicated mid-run must read as NEWER than the fetch). Forced null when factsHash
   *  is null — a scenic/break write carries no facts clock. */
  factsFetchedAt: Date | null
}

/**
 * Pure freshness predicate for the pois facts read-through (exported for tests).
 * Fresh = fetched, within the TTL, and not predating the place's newest override row
 * (a correction adjudicated AFTER the fetch must reach the sheet — re-fetch applies it).
 */
export function isFactsFresh(
  factsFetchedAt: Date | null,
  latestOverrideAt: Date | undefined,
  ttlHours: number,
  now: Date,
): boolean {
  if (ttlHours <= 0 || !factsFetchedAt) return false
  if (now.getTime() - factsFetchedAt.getTime() > ttlHours * 3_600_000) return false
  if (latestOverrideAt && latestOverrideAt.getTime() > factsFetchedAt.getTime()) return false
  return true
}

export interface FreshFacts {
  extract: string
  /** The row's ORIGINAL fetch stamp — callers that re-persist a cache hit must pass this
   *  back through upsertPoi so reuse never slides the TTL clock (review-caught: stamping
   *  NOW on a cache-hit persist would make frequently-regenerated places never re-fetch). */
  factsFetchedAt: Date
}

/**
 * READ side of principle #1's facts TTL (the mechanism the schema deferred): the stored,
 * already-corrected deep extract for each identity that is still FRESH (isFactsFresh) and
 * not SUSPECT (a fact-edit's find-string visible, or a non-deletion edit that matched
 * nothing — the "reworded, still wrong" case must keep re-fetching so the live warn
 * recurs). Misses are simply absent — the caller fetches those. Requires
 * ensurePoiOverridesLoaded() to have run (generateTour does, before discovery).
 */
export async function loadFreshPoiFacts(
  identities: { source: PoiSource; sourceId: string }[],
  ttlHours: number,
): Promise<Map<string, FreshFacts>> {
  const out = new Map<string, FreshFacts>()
  if (identities.length === 0 || ttlHours <= 0) return out
  const rows = await withRetry(
    () =>
      db
        .select({
          source: pois.source,
          sourceId: pois.sourceId,
          facts: pois.facts,
          factsFetchedAt: pois.factsFetchedAt,
        })
        .from(pois)
        .where(
          or(...identities.map((i) => and(eq(pois.source, i.source), eq(pois.sourceId, i.sourceId)))),
        ),
    { label: 'loadFreshPoiFacts' },
  )
  const now = new Date()
  for (const r of rows) {
    const extract = r.facts?.extract
    if (typeof extract !== 'string' || extract.length === 0) continue
    if (r.factsFetchedAt === null) continue
    if (!isFactsFresh(r.factsFetchedAt, latestOverrideAtFor(r.source, r.sourceId), ttlHours, now))
      continue
    if (cachedExtractSuspect(r.source, r.sourceId, extract)) continue
    out.set(`${r.source}:${r.sourceId}`, { extract, factsFetchedAt: r.factsFetchedAt })
  }
  return out
}

/** Upsert a POI deduped on (source, source_id); stamps facts freshness; returns its id. */
export async function upsertPoi(input: UpsertPoiInput): Promise<string> {
  const { factsHash, factsFetchedAt: providedStamp, ...rest } = input
  // Only a stop with real facts (a story stop) carries the freshness clock; the stamp
  // itself is caller-owned (see UpsertPoiInput.factsFetchedAt).
  const factsFetchedAt = factsHash ? providedStamp : null
  // Retry-safe: an upsert (onConflictDoUpdate) is idempotent — a retried attempt lands on the
  // same row by (source, source_id) and writes the same facts (only updatedAt's now() differs).
  const rows = await withRetry(
    () =>
      db
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
        .returning({ id: pois.id }),
    { label: `upsertPoi(${input.source}:${input.sourceId})` },
  )
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
  // Retry-safe: a blind status set is idempotent (re-applying writes the same value).
  await withRetry(
    () => db.update(tours).set({ status: 'generating' }).where(eq(tours.id, tourId)),
    { label: `markTourGenerating(${tourId})` },
  )
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
  // Retry the ATOMIC commit — the highest-EV retry in the pipeline. This is the LAST step of
  // a run, so a transient Neon blip here would discard the run's ENTIRE spend (all narration +
  // the whole TTS bill). The batch is one transaction AND idempotent by construction
  // (delete-all-by-tourId + insert fixed client-id rows), so a transient failure rolls the
  // whole batch back and a retry re-runs to the identical end state. Validation throws (zero
  // stops / missing brackets) stay above this — they are real errors, not transients.
  await withRetry(
    () =>
      db.batch([
        db.delete(tourStops).where(eq(tourStops.tourId, tourId)),
        db.delete(tourBrackets).where(eq(tourBrackets.tourId, tourId)),
        db
          .update(tours)
          .set({ status: 'ready' })
          .where(eq(tours.id, tourId))
          .returning({ id: tours.id }),
        db.insert(tourStops).values(stopRows).returning({ id: tourStops.id }),
        db.insert(tourBrackets).values(bracketRows).returning({ id: tourBrackets.id }),
      ]),
    { label: `finalizeTourReady(${tourId})` },
  )
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
  // Retry-safe: the status='generating' guard makes a second apply a no-op (the first attempt
  // already moved it off 'generating'), so a transient blip on the cleanup write can't leave a
  // crashed run stranded on 'generating'. The caller still .catch()es a full exhaustion.
  await withRetry(
    () =>
      db
        .update(tours)
        .set({ status: priorStatus === 'ready' ? 'ready' : 'failed' })
        .where(and(eq(tours.id, tourId), eq(tours.status, 'generating'))),
    { label: `restoreAfterFailedRun(${tourId})` },
  )
}
