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
