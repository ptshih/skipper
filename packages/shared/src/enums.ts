import { z } from 'zod'

/**
 * The Dad-Joke-O-Meter notches — the narration VOCABULARY. A generation-time INPUT
 * (baked into the narration audio at generation time), NOT stored tour STATE: there is
 * no `joke_level` column and the notch is absent from every read DTO and the API. M1 is
 * `dadpocalypse`-only, so a stored notch would carry no information. When the 1-N notch
 * ships (M3) the column lands on the NARRATION (tour_stops) — a notch describes a telling,
 * not a route. This enum stays because the generator's narration is parameterized by it
 * (the persona prompt's whole notch ladder) and `tourRequest` carries it as the run input.
 */
export const jokeLevel = z.enum(['off', 'mild', 'dad', 'dadpocalypse'])
export type JokeLevel = z.infer<typeof jokeLevel>

/**
 * story  = factual narration (a fact-grounded telling + audio).
 * scenic = delivery-only ambient audio, no facts — but STILL needs non-null audio to
 *          satisfy the ready gate.
 * break  = food/rest stop; names the curated anchor only; mandatory audio.
 * Narration + audio live on the tour_stops row (tour-owned), not a shared cache.
 */
export const stopType = z.enum(['story', 'scenic', 'break'])
export type StopType = z.infer<typeof stopType>

/** The drive's FRAME pieces — intro/outro brackets (tour_brackets), NOT stops. */
export const bracketKind = z.enum(['intro', 'outro'])
export type BracketKind = z.infer<typeof bracketKind>

/** Where a POI came from (its DISCOVERY source). Stored for dedup + attribution (Wikipedia is CC BY-SA). */
export const poiSource = z.enum(['wikipedia', 'google_places'])
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
