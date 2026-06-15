import { z } from 'zod'

/**
 * The Dad-Joke-O-Meter notches — the narration VOCABULARY. A generation-time INPUT
 * (baked into the narration audio at generation time), NOT stored tour STATE: there is
 * no `joke_level` column and the notch is absent from every read DTO and the API. M1 is
 * `dadpocalypse`-only, so a stored notch would carry no information. When the 1-N notch
 * ships (M3) the column lands on the NARRATION (tracks) — a notch describes a telling,
 * not a route. This enum stays because the generator's narration is parameterized by it
 * (the persona prompt's whole notch ladder) and `tourRequest` carries it as the run input.
 */
export const jokeLevel = z.enum(['off', 'mild', 'dad', 'dadpocalypse'])
export type JokeLevel = z.infer<typeof jokeLevel>

/**
 * A TRACK's treatment/depth — "what kind of telling". The full vocabulary now that narration
 * is a 1:N `tracks` child of a place-anchor `segment` (a place can carry several forms):
 *   story  = fact-grounded telling + audio.
 *   scenic = delivery-only ambient audio, no facts (still needs audio for the ready gate).
 *   break  = food/rest stop; names the curated anchor only; mandatory audio.
 *   wave   = a free-roam passing call-out.
 *   bside  = a "tell me more" alternate telling.
 * Keep in lockstep with the pg `track_form` enum (@skipper/db/schema).
 */
export const trackForm = z.enum(['story', 'scenic', 'break', 'wave', 'bside'])
export type TrackForm = z.infer<typeof trackForm>

/**
 * The WIRE projection of a TOUR stop's track form: a tour track is always one of these three,
 * so `tourStopView.stopType` stays a 3-value field (the player's icon/treatment switch). This is
 * a read-DTO vocabulary, no longer backed by its own pg enum — `tracks.form` (a superset) is the
 * storage truth, projected down by the API.
 */
export const stopType = z.enum(['story', 'scenic', 'break'])
export type StopType = z.infer<typeof stopType>

/** The drive's FRAME pieces — intro/outro (the `tour_frames` table, pg `frame_kind`). The wire
 *  DTO keeps the `bracketKind` name for client stability. */
export const bracketKind = z.enum(['intro', 'outro'])
export type BracketKind = z.infer<typeof bracketKind>

/** Where a POI came from (its DISCOVERY source). Stored for dedup + attribution (Wikipedia is
 *  CC BY-SA; a named scenic pin is discovered from Wikidata, CC0). */
export const poiSource = z.enum(['wikipedia', 'google_places', 'wikidata'])
export type PoiSource = z.infer<typeof poiSource>

/**
 * Attribution source — a SUPERSET of `poiSource`. A clip may credit a source that
 * owns no `pois` row: enrichment layered onto an existing POI, not discovered as its
 * own POI — coordinate-keyed Macrostrat geology (CC BY 4.0), or QID-keyed Wikidata
 * structured facts (CC0). Keep in lockstep with the `AttributionSnapshot['source']`
 * union in @skipper/db/schema.
 */
export const attributionSource = z.enum(['wikipedia', 'google_places', 'macrostrat', 'wikidata'])
export type AttributionSource = z.infer<typeof attributionSource>

export const tourStatus = z.enum(['draft', 'generating', 'ready', 'failed'])
export type TourStatus = z.infer<typeof tourStatus>

/**
 * Admin gen-job KINDS — the closed vocabulary of cloud-ops scripts the admin can launch, and the
 * SINGLE SOURCE OF TRUTH for it: the admin-api dispatch (`jobs.ts` SCRIPTS, typed `Record<JobKind>`),
 * the generator's `beginJob`, and the admin client's `JobKind` all derive from this. Deliberately
 * NOT a pg enum — `gen_jobs.kind` is an OBSERVABILITY label (nothing reads it for logic) and this
 * set CHURNS as ops scripts are added, so the vocabulary lives in code over a plain `text` column,
 * not a migration-bound DB type. Add a kind here + in `jobs.ts` SCRIPTS; no migration needed.
 */
export const jobKind = z.enum([
  'generate',
  'patch_clip',
  'resynth',
  'resynth_roam_clip',
  'sweep_orphans',
  'sweep_region_pois',
  'generate_roam',
  'refetch_facts',
])
export type JobKind = z.infer<typeof jobKind>

/**
 * DEFERRED axis (no variant matrix in v1). Not a stored tour column — kept only as the
 * generator's internal pacing key (config PACING). When the duration=skip-stops feature
 * lands it becomes a player-side trim, never separate tours.
 */
export const durationBucket = z.enum(['short', 'standard', 'long'])
export type DurationBucket = z.infer<typeof durationBucket>

/**
 * DEFERRED axis (no variant matrix in v1). When interests land they are a stop FILTER
 * (stop tags), never separate tours. Kept for forward use; not a stored tour column.
 */
export const interest = z.enum(['history', 'nature', 'geology', 'culture', 'food', 'quirky'])
export type Interest = z.infer<typeof interest>

/**
 * Freemium access tier (DERIVED per request, not a column):
 *  - `anonymous` = no/guest session (basic free use + the preview tour)
 *  - `free`      = signed-in account
 *  - `paid`      = subscriber (user.tier = 'paid'; no Stripe wired yet)
 * `user.tier` only stores `free`/`paid`; `anonymous` is the absence of an account.
 */
export const accessTier = z.enum(['anonymous', 'free', 'paid'])
export type AccessTier = z.infer<typeof accessTier>

/** Mobile client platform — keys the per-platform app-version policy served by GET /version. */
export const platform = z.enum(['ios', 'android'])
export type Platform = z.infer<typeof platform>
