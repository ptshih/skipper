// Persistence — Drizzle writes for the generator (zero-reuse model).
//
// The tour SHELL (route + endpoints + region) is created by the SEED as a `draft`
// row; the generator FILLS it. Narration is TOUR-OWNED — it lives on segments + tracks /
// tour_frames, never a shared poi_content cache. A tour STOP = one `segments` row (the
// place-anchor + trigger geometry + frozen persona) + one `tracks` row (the narration,
// form = the stop type, variant 0). Order of operations (neon-http, no interactive
// transactions):
//   1. upsert pois (deduped on (source, source_id); stamp facts_hash/facts_fetched_at)
//   2. synthesize each stop track's clip to a TOUR-scoped R2 key (clips/<tourId>/<trackId>)
//   3. synthesize the intro/outro frame clips (clips/<tourId>/intro|outro)
//   4. ATOMIC ready-gate: db.batch([ clear old segments (tracks cascade) + frames, flip
//      status->ready, insert all segments, insert all tracks, insert both tour_frames ])
// Step 4 co-commits the status flip with the segment/track AND frame rows in ONE implicit
// transaction, so a tour can never be `ready` with a missing stop or frame. On any
// failure the caller marks the tour `failed`.

import { createHash } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import { personas, pois, regions, segments, tourFrames, tours, tracks } from '@skipper/db/schema'
import { withRetry } from './http'
import type {
  AttributionSnapshot,
  NewSegment,
  NewTourFrame,
  NewTrack,
  PoiFacts,
  Polyline,
  FactSheetEntry,
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
  /** The host persona key (tours.persona_key) — the generator resolves the recipe via personaFromKey. */
  personaKey: string
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
          personaKey: tours.personaKey,
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

/**
 * Deterministic JSON serialization with object keys sorted recursively — so a hash taken over a
 * facts object is INVARIANT to key ORDER. This is load-bearing because `pois.facts` is `jsonb`:
 * Postgres does NOT preserve object key order, so the SAME logical facts serialize one way
 * in-memory (a writer's freshly-built object, stamped onto `pois.facts_hash`) and a DIFFERENT way
 * read back from the DB (what tours/roam stamp onto `tracks.facts_hash` — e.g. `{text,source,…}`
 * comes back as `{url,text,…}`). Plain `JSON.stringify` would make those two hashes diverge, so a
 * read-back-hashed clip would read as perpetually stale against the staleness contract
 * (`tracks.facts_hash IS DISTINCT FROM pois.facts_hash`). Sorting keys normalizes both sides to one
 * canonical form. ARRAY order is PRESERVED (significant — the well's spans are in reading order);
 * only object keys are reordered. Mirrors `JSON.stringify`'s treatment of `undefined` (object
 * entries dropped, array holes → null) so an omitted-vs-undefined key never shifts the hash.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? 'null' : stableStringify(v))).join(',')}]`
  }
  const obj = value as Record<string, unknown>
  const parts: string[] = []
  for (const k of Object.keys(obj).sort()) {
    const v = obj[k]
    if (v === undefined) continue // JSON.stringify omits undefined-valued object entries
    parts.push(`${JSON.stringify(k)}:${stableStringify(v)}`)
  }
  return `{${parts.join(',')}}`
}

/** Order-invariant hash of a poi's facts — the change-detector for narration staleness. Null when
 *  no facts. Canonicalizes via `stableStringify` so the hash survives the `pois.facts` jsonb
 *  round-trip: a writer's in-memory `pois.facts_hash` equals a reader's read-back `tracks.facts_hash`
 *  for the same content (the staleness contract compares those two STORED columns by inequality). */
export function hashFacts(facts: PoiFacts | null): string | null {
  if (!facts) return null
  return createHash('sha256').update(stableStringify(facts)).digest('hex')
}

/**
 * The GROUNDING fingerprint for a story poi — the hash a track's `facts_hash` is compared against for
 * staleness. THE SWITCH (corpus-enrichment-spec §3/§8), now reading the typed `pois.fact_sheet` column:
 *   - ENRICHED (a non-empty fact sheet) → hash the SHEET ONLY. Narration grounds on it, so a
 *     re-`discover` that rewrites `extract` but keeps the SAME sheet must NOT stale tracks; the
 *     `enriched_at` stamp can't churn it either (it isn't in the hash). The true "did the narration
 *     input change" detector. Byte-identical to the pre-column well-hash, so existing rows stay valid.
 *   - UN-ENRICHED (no sheet) → hash the whole facts object (`hashFacts`), so existing rows + the
 *     extract-head fallback keep their current hash exactly. Both WRITERS (sweep/enrich) and READERS
 *     (tours/roam) call THIS, canonicalized (`stableStringify`), so a clip's stamped hash can never
 *     diverge from `pois.facts_hash` across the in-memory ↔ jsonb-read-back boundary.
 */
export function storyFactsHash(
  facts: PoiFacts | null,
  factSheet: FactSheetEntry[] | null | undefined,
): string | null {
  if (factSheet && factSheet.length > 0) {
    return createHash('sha256').update(stableStringify(factSheet)).digest('hex')
  }
  if (!facts) return null
  return hashFacts(facts)
}

/** The distinct sourced credits in a well → the frozen `tracks.attribution` array (one entry per
 *  (source, sourceId), CC BY-SA / CC0 / CC BY preserved). `retrievedAt` is the well's enrich stamp. */
export function wellToAttribution(well: FactSheetEntry[], retrievedAt: string): AttributionSnapshot[] {
  const seen = new Set<string>()
  const out: AttributionSnapshot[] = []
  for (const s of well) {
    const key = `${s.source}:${s.sourceId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      source: s.source,
      sourceId: s.sourceId,
      ...(s.url ? { url: s.url } : {}),
      license: s.license,
      retrievedAt,
    })
  }
  return out
}

/** The canonical `pois.facts` object for a STORY place — the ONE builder every facts writer uses (the
 *  region sweep + refetch-poi) so the stored shape is consistent. The curated narration sheet is NO
 *  LONGER here — it lives in the typed `pois.fact_sheet` column (+ `enriched_at`). Key ORDER no longer
 *  affects the hash (`stableStringify` canonicalizes the jsonb read-back), but key PRESENCE still does
 *  — so `qid` is OMITTED when absent (never stored as null). The Wikidata `qid` linkage (region-corpus
 *  rebuilds tour candidates from it) is preserved BY CONSTRUCTION. */
export function buildStoryFacts(input: {
  extract: string
  title: string
  url: string
  pageId: number
  qid?: string | null
}): PoiFacts {
  return {
    extract: input.extract,
    title: input.title,
    url: input.url,
    pageId: input.pageId,
    ...(input.qid ? { qid: input.qid } : {}),
  }
}

export interface UpsertPoiInput {
  source: PoiSource
  sourceId: string
  name: string
  kind: string | null
  lat: number
  lng: number
  /** Curated "where to look" anchor — a place's speakable vantage (off speakableAnchorFor),
   *  SHARED and surviving a facts re-fetch. Omitted for places that speak from their own pin;
   *  coalesced on conflict so a curated anchor is never blanked by a later factless write. */
  speakableLat?: number | null
  speakableLng?: number | null
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
  /** The curated fact sheet (corpus `enrich` output) — its own column. Null/omitted for an
   *  un-enriched write (sweep/refetch); a paid enrich writes it. Coalesce-preserved on conflict so a
   *  free re-discover never blanks a paid sheet. */
  factSheet?: FactSheetEntry[] | null
  /** When the fact sheet was built (the enrich stamp). Coalesce-preserved like `factSheet`. */
  enrichedAt?: Date | null
}

/** Upsert a POI deduped on (source, source_id); stamps facts freshness; returns its id. */
export async function upsertPoi(input: UpsertPoiInput): Promise<string> {
  const { factsHash, factsFetchedAt: providedStamp, speakableLat, speakableLng, ...rest } = input
  // Only a stop with real facts (a story stop) carries the freshness clock; the stamp
  // itself is caller-owned (see UpsertPoiInput.factsFetchedAt).
  const factsFetchedAt = factsHash ? providedStamp : null
  // Retry-safe: an upsert (onConflictDoUpdate) is idempotent — a retried attempt lands on the
  // same row by (source, source_id) and writes the same facts (only updatedAt's now() differs).
  const rows = await withRetry(
    () =>
      db
        .insert(pois)
        .values({ ...rest, speakableLat, speakableLng, factsHash, factsFetchedAt })
        .onConflictDoUpdate({
          target: [pois.source, pois.sourceId],
          set: {
            // Location is always current — refresh it.
            name: sql`excluded.name`,
            kind: sql`excluded.kind`,
            lat: sql`excluded.lat`,
            lng: sql`excluded.lng`,
            // Speakable anchor is SEED-or-admin-owned (not auto-refetched): keep the EXISTING
            // value, filling from an incoming write only when the row has none. So an admin edit
            // (or the sweep's seed) is never clobbered by a later generate/sweep pass.
            speakableLat: sql`coalesce(${pois.speakableLat}, excluded.speakable_lat)`,
            speakableLng: sql`coalesce(${pois.speakableLng}, excluded.speakable_lng)`,
            // FACTS are SHARED across tours: the SAME place can be a story stop on one tour and
            // a (factless) scenic/break stop on another. NEVER let a factless write blank a place
            // that already carries facts — COALESCE keeps the richest known facts/summary, while a
            // genuine re-fetch (non-null incoming) still overwrites. (Upholds the "pois is the
            // shared facts cache" invariant + keeps the facts_hash staleness contract honest.)
            summary: sql`coalesce(excluded.summary, ${pois.summary})`,
            // FACTS is a plain coalesce now — the curated sheet lives in its OWN column, so a free
            // re-sweep (factless or article-only) can't touch it. (The old graft-back CASE is GONE.)
            facts: sql`coalesce(excluded.facts, ${pois.facts})`,
            // PRESERVE a paid fact sheet + its stamp across a later factless/sweep write: the sweep
            // passes them null → coalesce keeps the existing. A real re-enrich writes them directly.
            factSheet: sql`coalesce(excluded.fact_sheet, ${pois.factSheet})`,
            enrichedAt: sql`coalesce(excluded.enriched_at, ${pois.enrichedAt})`,
            // When the row is ENRICHED the grounding hash is the SHEET hash — keep it so a re-sweep's
            // (un-enriched) recomputed hash never overwrites it and stales the grounded tracks.
            factsHash: sql`case
              when ${pois.factSheet} is not null then ${pois.factsHash}
              else coalesce(excluded.facts_hash, ${pois.factsHash})
            end`,
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

/**
 * The cached `personas.id` for a host's persona_key — filled onto every `segments.persona_id`.
 * The personas table is tiny + stable within a run, so resolve once per key and memoize. A
 * missing row is a real error (the seed must run first), thrown — never papered over.
 */
const personaIdCache = new Map<string, Promise<string>>()
export function resolvePersonaId(personaKey: string): Promise<string> {
  let p = personaIdCache.get(personaKey)
  if (!p) {
    p = (async () => {
      const rows = await withRetry(
        () =>
          db
            .select({ id: personas.id })
            .from(personas)
            .where(eq(personas.personaKey, personaKey))
            .limit(1),
        { label: `resolvePersonaId(${personaKey})` },
      )
      const id = rows[0]?.id
      if (!id)
        throw new Error(
          `No personas row for persona_key "${personaKey}" — run the personas seed first.`,
        )
      return id
    })()
    personaIdCache.set(personaKey, p)
  }
  return p
}

/** A fully-narrated, fully-synthesized stop, ready to write as a segment + its track. */
export interface FinalStop {
  /** Client-generated segment id (the place-anchor row). */
  segmentId: string
  /** Client-generated track id (also the clip key: clips/<tourId>/<trackId>). */
  trackId: string
  seq: number
  poiId: string
  /** The frozen host of this telling — resolvePersonaId(persona.personaKey). */
  personaId: string
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

/** A fully-narrated, fully-synthesized intro/outro frame. */
export interface FinalBracket {
  kind: BracketKind
  script: string
  audioUrl: string
  audioDurationMs: number
}

/**
 * Atomic ready-gate: clear any prior segments (tracks cascade) + frames, flip the tour to
 * `ready`, and write ALL segments + their tracks + both tour_frames in one batch (one
 * implicit transaction over HTTP). All-or-nothing — never a `ready` tour with a missing
 * stop or frame. Each stop is one `segments` row (place-anchor + trigger geometry + persona)
 * paired with one `tracks` row (the narration, form = the stop type, variant 0).
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
    throw new Error(`Refusing to finalize tour ${tourId} without BOTH intro and outro frames.`)
  }
  // The audio invariant, enforced HERE so this gate is the single authority — every stop AND
  // every frame must carry real audio (a non-empty R2 key + a positive duration). The TS types
  // and the DB's NOT NULL columns both back this; the runtime check also catches an empty-string
  // key, which NOT NULL would let through. (Break audio is mandatory; a tour never goes ready
  // with a silent stop or a silent intro/outro.)
  for (const s of stops) {
    if (!s.audioUrl || !(s.audioDurationMs > 0)) {
      throw new Error(`Refusing to finalize tour ${tourId}: stop ${s.seq} (${s.stopType}) has no audio.`)
    }
  }
  for (const b of brackets) {
    if (!b.audioUrl || !(b.audioDurationMs > 0)) {
      throw new Error(`Refusing to finalize tour ${tourId}: ${b.kind} frame has no audio.`)
    }
  }
  // A stop splits into its place-anchor (segment) + its narration (track, form = the stop
  // type, variant 0). The segment carries the trigger geometry + frozen persona; the track
  // carries the script/audio/attribution/facts_hash.
  const segmentRows: NewSegment[] = stops.map((s) => ({
    id: s.segmentId,
    tourId,
    poiId: s.poiId,
    personaId: s.personaId,
    seq: s.seq,
    triggerLat: s.triggerLat,
    triggerLng: s.triggerLng,
    approachHeadingDeg: s.approachHeadingDeg,
    radiusM: s.triggerRadiusM,
  }))
  const trackRows: NewTrack[] = stops.map((s) => ({
    id: s.trackId,
    segmentId: s.segmentId,
    form: s.stopType,
    variant: 0,
    script: s.script,
    audioUrl: s.audioUrl,
    audioDurationMs: s.audioDurationMs,
    attribution: s.attribution,
    factsHash: s.factsHash,
  }))
  const frameRows: NewTourFrame[] = brackets.map((b) => ({
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
  // whole batch back and a retry re-runs to the identical end state. Deleting the segments
  // cascades their tracks, so the track insert always lands on a clean slate. Validation
  // throws (zero stops / missing frames) stay above this — they are real errors, not transients.
  await withRetry(
    () =>
      db.batch([
        db.delete(segments).where(eq(segments.tourId, tourId)),
        db.delete(tourFrames).where(eq(tourFrames.tourId, tourId)),
        db
          .update(tours)
          .set({ status: 'ready' })
          .where(eq(tours.id, tourId))
          .returning({ id: tours.id }),
        db.insert(segments).values(segmentRows).returning({ id: segments.id }),
        db.insert(tracks).values(trackRows).returning({ id: tracks.id }),
        db.insert(tourFrames).values(frameRows).returning({ id: tourFrames.id }),
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
