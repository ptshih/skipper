// Generator configuration — env access, provider readiness, and the tuning knobs
// for M1 generation. Centralized so the founder has one place to turn the dials
// and one place to see which API keys a full run needs.
//
// Env is injected by dotenvx at the command line (the repo has NO plaintext
// .env), e.g.:
//   dotenvx run -f .env.development -- bun packages/generator/src/run.ts emerald-bay-run

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
export const ELEVENLABS_READY = (): boolean => hasEnv('ELEVENLABS_API_KEY')
export const GOOGLE_READY = (): boolean => hasEnv('GOOGLE_MAPS_API_KEY')
export const R2_READY = (): boolean =>
  ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'].every(hasEnv)

// --- Wikipedia etiquette ----------------------------------------------------

// Wikimedia REQUIRES a descriptive User-Agent with a contact; a generic/missing
// UA can be blocked without notice. (Contact is the project owner.)
export const WIKIPEDIA_USER_AGENT =
  'Skipper/0.1 (https://github.com/ptshih/skipper; ptshih@gmail.com) bun/1.3'

// --- POI discovery ----------------------------------------------------------

/** Geosearch probe spacing along the route (m). ~1.5x radius gives overlap so nothing is missed. */
export const GEOSEARCH_STEP_M = 2_500
/** Geosearch circle radius per probe (m). Max allowed by the API is 10 km. */
export const GEOSEARCH_RADIUS_M = 2_000
/** Wikipedia POIs farther than this from the road aren't "along the drive" — dropped. */
export const OFF_ROUTE_MAX_M = 700
/** Lead-section extract length to request (chars). ~3–5 sentences of grounded facts. */
export const EXTRACT_CHARS = 600
/** Below this extract length a STORY candidate is too thin → downgraded to scenic. */
export const STORY_MIN_FACT_CHARS = 140

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
export const PACING: Record<DurationBucket, BucketPacing> = {
  short: { minGapSec: 360, maxNarratedStops: 6, breakStops: 0 },
  standard: { minGapSec: 240, maxNarratedStops: 14, breakStops: 1 },
  long: { minGapSec: 180, maxNarratedStops: 20, breakStops: 2 },
}

/** Target spoken length per stop type (seconds) — honored by narration, never padded. */
export const TARGET_SECONDS = { story: 35, scenic: 20, break: 15 } as const

/** Default speed-adaptive trigger floor (m). Matches the tour_stops column default. */
export const TRIGGER_RADIUS_M = 120

/** Fallback average drive speed (m/s ≈ 30 mph) if a corridor lacks a frozen durationSeconds. */
export const FALLBACK_SPEED_MPS = 13.4
