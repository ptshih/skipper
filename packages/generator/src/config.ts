// Generator configuration — env access, provider readiness, and the tuning knobs
// for M1 generation. Centralized so the founder has one place to turn the dials
// and one place to see which API keys a full run needs.
//
// Env is injected by dotenvx at the command line (the repo has NO plaintext
// .env), e.g.:
//   dotenvx run -f .env.development -- bun packages/generator/src/run.ts emerald-bay-run

import { existsSync } from 'node:fs'

import type { DurationBucket } from '@skipper/shared'

/** Read a required env var or throw a clear, actionable error. */
export function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) {
    throw new Error(
      `${name} is not set. Run via dotenvx, e.g.\n` +
        `  dotenvx run -f .env.development -- bun packages/generator/src/run.ts <slug>`,
    )
  }
  return v
}

/** True if a var is present and non-empty (used for graceful provider gating). */
export function hasEnv(name: string): boolean {
  return Boolean(process.env[name])
}

// --- Provider readiness (lets --dry-run skip TTS/R2 cleanly) ----------------

export const ANTHROPIC_READY = (): boolean => hasEnv('ANTHROPIC_API_KEY')
// Cloud TTS readiness. We always need the billing/quota project. For OAuth creds
// there are two honest paths, and the gate verifies the one in use actually works:
//   - ADC / workload identity: set GOOGLE_TTS_USE_ADC=true — creds come from the
//     metadata server or `gcloud auth application-default login`, no key file.
//   - a service-account key file: GOOGLE_APPLICATION_CREDENTIALS must point at a
//     file that EXISTS on this host.
// The file-existence check is deliberate: a dev-local GOOGLE_APPLICATION_CREDENTIALS
// path baked into .env.production is "set" but absent on a deployed host, so a
// presence-only check would false-green here and then fail deep in synthesize()
// with an opaque "could not obtain a Google access token". Fail loudly + early.
export const GOOGLE_TTS_READY = (): boolean => {
  if (!hasEnv('GOOGLE_CLOUD_PROJECT')) return false
  if (hasEnv('GOOGLE_TTS_USE_ADC')) return true
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  return Boolean(keyPath && existsSync(keyPath))
}
export const GOOGLE_READY = (): boolean => hasEnv('GOOGLE_MAPS_API_KEY')
// Credentials + bucket are always required; the endpoint comes from either an
// explicit S3_ENDPOINT override (Tigris, B2, AWS S3) or the R2 account id.
export const R2_READY = (): boolean =>
  ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'].every(hasEnv) &&
  (hasEnv('S3_ENDPOINT') || hasEnv('R2_ACCOUNT_ID'))

// --- Wikipedia etiquette ----------------------------------------------------

// Wikimedia REQUIRES a descriptive User-Agent with a contact; a generic/missing
// UA can be blocked without notice. (Contact is the project owner.)
export const WIKIPEDIA_USER_AGENT =
  'Skipper/0.1 (https://github.com/ptshih/skipper; ptshih@gmail.com) bun/1.3'

// --- Macrostrat geology enrichment ------------------------------------------

// Coordinate-keyed bedrock facts (lithology + age) layered onto story/scenic stops
// from the public Macrostrat API (keyless, CC BY 4.0; underlying USGS maps are PD).
// See pipeline/macrostrat.ts. Reuses the same descriptive UA + contact as Wikipedia.
export const MACROSTRAT_USER_AGENT = WIKIPEDIA_USER_AGENT
/** Geology enrichment is on by default; set SKIPPER_GEOLOGY=off to skip the per-stop lookup. */
export const GEOLOGY_ENRICHMENT = (): boolean => process.env.SKIPPER_GEOLOGY !== 'off'
/**
 * Who gets geology: SCENIC stops ALWAYS (they carry no Wikipedia facts — geology is the
 * one true thing they can say), but STORY stops only when their fact sheet is SPARSE
 * (below this many chars). On a fact-rich story geology just piles on as a repetitive
 * "deep time vs. our brief lives" closer (observed on emerald-bay-run: 9/9 stops →
 * monotony); a thin story is exactly where the rock rounds the stop out. Tunable; the
 * gap on emerald-bay-run sits between ~605 (sparse) and ~877+ (rich), so 700 splits clean.
 */
export const GEOLOGY_STORY_MAX_FACT_CHARS = 700
/**
 * Per-corridor allowlist of ICONIC-but-rich stops that get geology even though their
 * fact sheet clears the sparse threshold above — places where the rock IS the headline
 * (Emerald Bay's granite, a famous arch, a volcanic plug). Keyed by corridor slug →
 * exact stop name (the Wikipedia title). These get a "this rock is notable, give it a
 * real mention" narration cue rather than the sparse-story "you're light on facts" one,
 * so the prompt never feeds a rich stop a false premise. Hand-curated, not derived.
 */
export const GEOLOGY_ICONIC_STOPS: Record<string, string[]> = {
  'emerald-bay-run': ['Emerald Bay State Park'],
}

// --- Wikidata structured-fact enrichment ------------------------------------

// QID-keyed discrete facts (inception, elevation, named-after, heritage designation)
// layered onto STORY stops from the public Wikidata Action API (keyless, CC0). The join
// key is the Wikipedia page's `wikibase_item` property, captured at discovery. See
// pipeline/wikidata.ts. Reuses the same descriptive UA + contact as Wikipedia.
export const WIKIDATA_USER_AGENT = WIKIPEDIA_USER_AGENT
/** Wikidata enrichment is on by default; set SKIPPER_WIKIDATA=off to skip the per-stop lookup. */
export const WIKIDATA_ENRICHMENT = (): boolean => process.env.SKIPPER_WIKIDATA !== 'off'
/**
 * Who gets Wikidata facts: STORY stops only — a date/elevation/namesake identifies the
 * place, which would break the SCENIC "no place-facts" invariant (geology can ride scenic
 * because it names no landmark; Wikidata can't). And among stories, only SPARSE ones
 * (fact sheet below this many chars): a fact-rich lead extract already states these things
 * in prose, so on a rich stop the structured facts just pile on — exactly the monotony the
 * geology sparse-gate avoids. A thin story is where an exact year or elevation rounds it
 * out. Tunable independently of GEOLOGY_STORY_MAX_FACT_CHARS.
 */
export const WIKIDATA_STORY_MAX_FACT_CHARS = 700

// --- POI discovery ----------------------------------------------------------

/** Geosearch probe spacing along the route (m). ~1.5x radius gives overlap so nothing is missed. */
export const GEOSEARCH_STEP_M = 2_500
/** Geosearch circle radius per probe (m). Max allowed by the API is 10 km. */
export const GEOSEARCH_RADIUS_M = 2_000
/** Wikipedia POIs farther than this from the road aren't "along the drive" — dropped. */
export const OFF_ROUTE_MAX_M = 700
/**
 * Minimum on-the-ground separation between two NARRATED stops (m). A SPATIAL floor
 * complementary to the minGapSec TIME floor: two POIs can clear the time gap yet
 * sit on top of each other where the road wraps (Fannette Island sits INSIDE
 * Emerald Bay State Park — 571 m apart, 254 s apart in drive time — and both leads
 * named "the only island in Lake Tahoe"). Co-located candidates are deduped to the
 * richest extract. Measured margin on emerald-bay-run: the only sub-1.5 km pair is
 * that 571 m overlap; the next-closest stops are 2.3 km apart, so 1000 m is safe.
 */
export const MIN_STOP_SEPARATION_M = 1_000
/** Lead-section extract length to request (chars). ~3–5 sentences — used to RANK and
 * classify candidates at selection time (cheap, batched). The chosen story stops get
 * a deeper fact sheet (DEEP_EXTRACT_CHARS) before narration. */
export const EXTRACT_CHARS = 600
/** Below this extract length a STORY candidate is too thin → downgraded to scenic. */
export const STORY_MIN_FACT_CHARS = 140
/**
 * Full-article extract length (chars) fetched for the SELECTED story stops, so a stop
 * can be a fuller, longer story than the lead section alone supports (Shaka-Guide-length
 * storytelling is ~1–3 min, not ~30s — but ONLY when the facts are there to fill it; a
 * thin article stays short, never padded). Per-POI, one extra fetch each post-selection.
 * Trimmed of trailing meta sections (References/See also/…) in wikipedia.ts.
 */
export const DEEP_EXTRACT_CHARS = 4_000

// --- Pacing (by drive TIME, not distance) -----------------------------------

export interface BucketPacing {
  /** Minimum drive-time gap between consecutive narrated stops (seconds). */
  minGapSec: number
  /** Hard cap on story+scenic stops for the whole corridor. */
  maxNarratedStops: number
  /** Number of food/rest break stops to interleave. */
  breakStops: number
}

// M1 ships `standard` only; short/long are defined for forward use (M3).
// minGapSec is the floor between consecutive stops — it directly governs the SILENCE
// between clips (a ~120s clip with a 180s floor leaves ~60s of quiet, vs the ~120s+ of
// dead air a 240s floor left). Lowered to admit more of the already-discovered grounded
// POIs (discovery finds ~40+ along a route; the old floor used only ~9) so the drive
// stops having 5–7 min silent stretches. Stays ABOVE the clip length so the sequential
// player never backs up (the QUEUE_LAG guard in generate.ts asserts this per tour).
// breakStops is a TARGET, not a guarantee — breaks are optional rest/food callouts, so we
// scatter a few through the drive (selectBreaks prefers slots clear of a story, but keeps the
// least-stacked rather than dropping one). Generous on purpose; the rider takes them or not.
export const PACING: Record<DurationBucket, BucketPacing> = {
  short: { minGapSec: 300, maxNarratedStops: 8, breakStops: 1 },
  standard: { minGapSec: 180, maxNarratedStops: 16, breakStops: 3 },
  long: { minGapSec: 150, maxNarratedStops: 24, breakStops: 4 },
}

/** Target spoken length per stop type (seconds) — honored by narration, never padded.
 * `story` targets a Shaka-Guide-length telling (~2 min) so a rich fact sheet gets room
 * to breathe; the model still stops when the FACTS run out, so thin sheets stay short.
 * `scenic` stays short (delivery-only, no facts to fill time); `break` is a brief cue. */
export const TARGET_SECONDS = { story: 120, scenic: 20, break: 15 } as const

/** Generation-time overlap guard: the player plays clips through a sequential FIFO queue,
 *  so if stops are paced TIGHTER than their clips are long, the audio backs up and lags
 *  behind the car. Warn if any clip would start more than this many seconds after its
 *  trigger — a signal the pacing is too dense (lower the stop count or shorten clips). */
export const QUEUE_LAG_WARN_SEC = 45

/** Co-located cluster MERGE: when dedup would drop a POI sitting within MIN_STOP_SEPARATION_M
 *  of a kept stop, FOLD its facts onto that stop instead of discarding them — so a highlight
 *  like Emerald Bay becomes ONE richer telling (bay + castle + island + falls) rather than 3
 *  dropped landmarks (or 3 overlapping clips). Cap members so a survivor can't bloat; only
 *  fold members with a real (story-grade) extract; each adds room to the clip target. */
export const MERGE_MAX_MEMBERS = 3
export const MERGE_EXTRA_SEC = 40

/** Keep a BREAK from stacking on a narrated stop: a break within this many seconds of a story
 *  would queue behind that story's ~120s clip and play late (the +115s lag the guard caught).
 *  Breaks are flexible, so we just skip anchors this close to a chosen narrated stop. */
export const BREAK_MIN_GAP_SEC = 90

/** Default speed-adaptive trigger floor (m). Matches the tour_stops column default. */
export const TRIGGER_RADIUS_M = 120

/** Fallback average drive speed (m/s ≈ 30 mph) if a corridor lacks a frozen durationSeconds. */
export const FALLBACK_SPEED_MPS = 13.4
