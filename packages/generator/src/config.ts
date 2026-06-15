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
/** Geology enrichment is on by default; set SKIPPER_GEOLOGY=off to skip the per-stop lookup
 * (scenic stops) and withhold the scout's fetch_geology tool (story stops). */
export const GEOLOGY_ENRICHMENT = (): boolean => process.env.SKIPPER_GEOLOGY !== 'off'
// Who gets geology: SCENIC stops ALWAYS (they carry no Wikipedia facts — geology is the one
// true thing they can say; a contract, not a heuristic). STORY stops are decided by the
// enrichment SCOUT (pipeline/scout.ts) — the old char-count sparse-gate
// (GEOLOGY_STORY_MAX_FACT_CHARS=700) and the hand-curated GEOLOGY_ICONIC_STOPS allowlist
// were replaced by per-stop judgment 2026-06-09 (docs/decisions/enrichment-scout.md).

// --- Wikidata structured-fact enrichment ------------------------------------

// QID-keyed discrete facts (inception, elevation, named-after, heritage designation)
// layered onto STORY stops from the public Wikidata Action API (keyless, CC0). The join
// key is the Wikipedia page's `wikibase_item` property, captured at discovery. See
// pipeline/wikidata.ts. Reuses the same descriptive UA + contact as Wikipedia.
export const WIKIDATA_USER_AGENT = WIKIPEDIA_USER_AGENT
/** Wikidata enrichment is on by default; set SKIPPER_WIKIDATA=off to withhold the scout's
 * fetch_wikidata tool. */
export const WIKIDATA_ENRICHMENT = (): boolean => process.env.SKIPPER_WIKIDATA !== 'off'
// Who gets Wikidata facts: STORY stops only — a date/elevation/namesake identifies the
// place, which would break the SCENIC "no place-facts" invariant (geology can ride scenic
// because it names no landmark; Wikidata can't). WHICH story stops is the enrichment
// SCOUT's call (pipeline/scout.ts) — the old WIKIDATA_STORY_MAX_FACT_CHARS=700 sparse-gate
// was replaced by per-stop judgment 2026-06-09 (docs/decisions/enrichment-scout.md).

// --- The enrichment scout (pipeline/scout.ts) --------------------------------

/** The scout is on by default; set SKIPPER_SCOUT=off to skip story-stop enrichment
 * entirely (scenic geology is unaffected — it's a contract, not a scout decision). */
export const SCOUT_ENRICHMENT = (): boolean => process.env.SKIPPER_SCOUT !== 'off'
/** Max model turns per stop — the ReAct loop's hard bound. A turn is one Opus call that
 * either fetches (possibly several tools at once) or finalizes; 5 covers look-then-decide
 * with a re-fetch, and a loop that hits the cap yields NO enrichment (logged, non-fatal). */
export const SCOUT_MAX_TOOL_TURNS = 5
/** Max output tokens per scout turn (it emits tool calls + a sentence of reason, never prose). */
export const SCOUT_MAX_TOKENS = 1_000

// --- The corpus enrich step's well builder (pipeline/scout.ts buildWell) ------
// Generalizes the per-stop scout to the CORPUS: it selects verbatim article spans (by id) +
// includes/excludes grounded bundles (geology@centroid, Wikidata), ONCE per place — the shared
// "fact well" tours + roam ground on (docs/specs/corpus-enrichment-spec.md). Same ReAct shape +
// bounds as the scout; the only difference is the finalize emits a list of kept span ids, so it
// gets a bit more output headroom.
/** Max model turns per place — look (fetch geology/wikidata), then finalize. */
export const ENRICH_MAX_TOOL_TURNS = 5
/** Max output tokens per enrich turn — a finalize emits a kept-span-id LIST + a sentence of
 *  reason (numbers, not prose), so more than the scout's 1k but still tight. */
export const ENRICH_MAX_TOKENS = 2_000
/** SOFT selection target: roughly how many verbatim spans the well should carry for a ~150s
 *  telling. GUIDANCE to the model (restraint is a feature), NOT a hard cap — the well's true
 *  bound is the enricher's judgment, never a char truncation (which would butcher a verbatim
 *  span). See spec §9. */
export const ENRICH_WELL_TARGET_SPANS = 16

// --- Bounded fan-out (pipeline/concurrency.ts) --------------------------------

/** Env-overridable positive-int knob (≥1); falls back to the default when unset/garbage. */
function intKnob(raw: string | undefined, fallback: number): number {
  const n = Number(raw)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback
}
/** Concurrent FIRST-PASS narration calls. Each stop drafts independently (BLIND of its
 * siblings — cross-stop variety is enforced AFTER, by the diversity lint + regen pass in
 * generate.ts), so the draft phase is bounded by its SLOWEST stop instead of the sum. This is
 * the rate-limit dial: narration runs in its own phase with full TPM headroom, but it's the
 * largest-output Anthropic call, so drop it if a fan-out spikes 429s (the SDK retries them).
 * Override: SKIPPER_NARRATION_CONCURRENCY. */
export const NARRATION_CONCURRENCY = (): number => intKnob(process.env.SKIPPER_NARRATION_CONCURRENCY, 6)
/** Concurrent TTS synth+upload calls on a full run. The clips are independent (scripts
 * frozen, per-run keys), so the phase is bounded by its LONGEST clip instead of the sum —
 * measured 2026-06-09: a 27-min tour spent ~10 min synthesizing serially at ~0.38× audio
 * length per clip. Gemini-TTS 3.1-preview has NO fixed QPM quota (dynamic Standard-PayGo
 * throughput); Google's guidance is steady traffic + exponential backoff on 429, which
 * fetchWithRetry already provides. 6 keeps the fan-out modest (no second-level spikes). */
export const TTS_CONCURRENCY = (): number => intKnob(process.env.SKIPPER_TTS_CONCURRENCY, 6)
/** Concurrent scout agent runs — independent per stop (each reads only its OWN sheet and
 * stop-keyed tools). No prompt-cache interplay: scout calls carry no cache_control and
 * their prefix is under the Opus cacheable minimum. */
export const SCOUT_CONCURRENCY = (): number => intKnob(process.env.SKIPPER_SCOUT_CONCURRENCY, 4)
/** Concurrent grounding-REGEN optimize() loops — independent per stop (per-stop memo, the
 * shared budget spends synchronously, the advisory panel judges against a frozen snapshot;
 * see generate.ts). Override: SKIPPER_GROUNDING_REGEN_CONCURRENCY. */
export const GROUNDING_REGEN_CONCURRENCY = (): number =>
  intKnob(process.env.SKIPPER_GROUNDING_REGEN_CONCURRENCY, 4)
/** Concurrent FREE-DIM (tts+diversity) PANEL + closer-judge regen narrations — the same
 * parallel-safe shape as the grounding regens above: each candidate is judged against a
 * FROZEN snapshot of the assembled set taken at pass start (so a concurrent retake can't read
 * a sibling mid-mutation), the shared panel budget is spent with a synchronous check+decrement
 * (no over-spend race), and the OUTER pass loop re-lints the LIVE set between passes so
 * convergence is unharmed. Override: SKIPPER_PANEL_REGEN_CONCURRENCY. */
export const PANEL_REGEN_CONCURRENCY = (): number =>
  intKnob(process.env.SKIPPER_PANEL_REGEN_CONCURRENCY, 4)

// --- pois facts freshness (principle #1's TTL mechanism — READ side) ----------

/** Re-use a place's stored deepened facts on regen when fetched within this many hours AND
 * no poi_override row for the place is NEWER than the fetch (a fresh adjudication must
 * reach the sheet immediately — the override-stamp check in persist.loadFreshPoiFacts).
 * 0 disables the read-through (always re-fetch). Override: SKIPPER_FACTS_TTL_HOURS. */
export const FACTS_TTL_HOURS = (): number => {
  const n = Number(process.env.SKIPPER_FACTS_TTL_HOURS)
  return Number.isFinite(n) && n >= 0 ? n : 168
}

// --- Eval panel + evaluator-optimizer (the in-pipeline flywheel) -------------

// generate.ts runs the eval panel (src/eval/) DURING generation and feeds findings back
// through the evaluator-optimizer (eval/optimize.ts). Cost shape (deliberate): the per-pass
// loop is driven ONLY by the FREE deterministic dims (tts + diversity); GROUNDING (one
// Opus call per story/scenic stop) runs ONCE as a final pass, and only a stop that FAILS
// it gets a bounded targeted re-narration. Grounding findings drive regen + are recorded on
// the scorecard but NEVER block `ready` — the human ear stays the ship decision (CLAUDE.md:
// "Deferred — DO NOT build: any automated groundedness gate").
/** Grounding eval is on by default; set SKIPPER_GROUNDING_EVAL=off to skip the Opus pass. */
export const GROUNDING_EVAL = (): boolean => process.env.SKIPPER_GROUNDING_EVAL !== 'off'
/** Tour-level passes of the FREE panel (tts + diversity) → regen loop. Each pass re-lints the
 * assembled set (fixing stop A can clear or create a cross-stop finding on stop B) and is a
 * no-op once clean. 4 matches the old LINT_ROUNDS budget — long-form stops can take several
 * regens to clear stacked findings. */
export const EVAL_MAX_PASSES = 4
/** Max targeted re-narrations for ONE stop that failed the grounding pass. Kept small: each
 * round costs an Opus regen + an Opus re-audit, and the ungrounded-claim avoid-notes land
 * the fix in round 1 almost always. */
export const GROUNDING_REGEN_MAX_ROUNDS = 2
/** HARD cap on re-narration ATTEMPTS per tour for the FREE-dim passes + the closer judge.
 * The cost guardrail the eval loop is required to carry (see TODO.md): without it, worst-case
 * spend is passes × stops Opus calls. When exhausted, every stop keeps its best take so far
 * (the accept-if-not-worse guarantee makes that safe) and the cap is logged. Typical observed
 * regen counts are 1–5 per tour; 24 is roomy, not open-ended. */
export const EVAL_REGEN_BUDGET = 24
/** SEPARATE hard cap on re-narration attempts for the GROUNDING pass, so a tic-heavy tour
 * that burns the panel budget above can never starve the crown-jewel dimension to zero
 * regens. Each attempt also costs one Opus re-audit. 12 = six failing stops at the full
 * GROUNDING_REGEN_MAX_ROUNDS (the first live audit of a 14-stop tour flagged EIGHT, so 8
 * proved tight); beyond the cap the verdicts just land on the scorecard for human review. */
export const GROUNDING_REGEN_BUDGET = 12

// --- POI discovery ----------------------------------------------------------

/** The off-route floor (m) for POIs that are honestly "along the drive". Single-sourced in
 *  @skipper/drive-core and re-exported here, so selection, the sim, and the live player all
 *  read ONE number (a stop the generator accepts is a stop that triggers). */
export { OFF_ROUTE_MAX_M } from '@skipper/drive-core'

// --- Wikidata discovery spine ----------------------------------------------
// Discovery IS the Wikidata spine (it replaced Wikipedia-geosearch wholesale): query
// geocoded entities along the route (P31-typed, P625-located), with Wikipedia demoted to a
// prose layer joined via sitelink. Wikidata has far more geocoded entities than Wikipedia
// has articles, so this surfaces the named bay/beach/cove scenery layer Wikipedia is blind
// to (e.g. Sand Harbor — no Wikipedia article, but a typed Wikidata pin). See
// pipeline/wikidata-discovery.ts.
/** Wikidata Query Service (SPARQL) — the geospatial endpoint (distinct from the keyless
 *  wbgetentities Action API the enrichment uses). Public, rate-limited; needs the UA. */
export const WDQS_ENDPOINT = 'https://query.wikidata.org/sparql'
export const WDQS_USER_AGENT = WIKIPEDIA_USER_AGENT
/** Areal features (a lake, a park, a bay) carry ONE arbitrary centroid that can sit well off
 *  the road even when the route hugs their shore — so they get a wider corridor gate than the
 *  point `OFF_ROUTE_MAX_M`, or a shoreline lake/park is wrongly dropped (the Spooner Lake case).
 *  SCOPE: this widens the DISCOVERY candidate pool ONLY (pipeline/wikidata-discovery.ts). Final
 *  stop SELECTION (pipeline/select.ts) — and therefore the sim + the player — cap placement at
 *  the flat `OFF_ROUTE_MAX_M` for every stop, so an areal centroid 700–1500 m off enters the
 *  pool but does NOT become a stop today. Persisting areal stops out to 1500 m would need
 *  areal-aware selection + the sim/player to honor it (a deferred feature, not just this gate). */
export const SPINE_AREAL_OFF_ROUTE_MAX_M = 1_500
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
 * the full article (ENRICHER_INPUT_CHARS) stored at sweep time. */
export const EXTRACT_CHARS = 600
/** Below this extract length a STORY candidate is too thin → downgraded to scenic. */
export const STORY_MIN_FACT_CHARS = 140
/**
 * Full-article plaintext length (chars) the region sweep STORES in `pois.facts.extract` — the
 * raw, verbatim article, which is the corpus `enrich` step's INPUT (it selects the well from it)
 * and the re-enrichment/audit source. Generous so a deep narratable fact isn't lost to a
 * positional cap before the enricher can even see it (a city article runs long); the bound on the
 * enricher's READ, not on narration. Trimmed of trailing meta sections (References/See also/…) in
 * wikipedia.ts. (Was DEEP_EXTRACT_CHARS=4000 — the per-stop narration cap — until the corpus
 * enrichment migration, 2026-06-15; see docs/specs/corpus-enrichment-spec.md §7.)
 */
export const ENRICHER_INPUT_CHARS = 12_000
/**
 * The narration FALLBACK head (chars): when a story poi has NOT been enriched (no `facts.well`),
 * generation grounds on the positional head of `facts.extract` capped to this (the old
 * DEEP_EXTRACT_CHARS value) — byte-for-byte today's behavior for existing 4k rows; once a row is
 * re-swept under ENRICHER_INPUT_CHARS=12k the head is a strict VERBATIM superset (it packs a sentence
 * or two more into the same 4k window), never a content change. An ENRICHED poi ignores this: it
 * grounds on the curated well (judgment is the bound, not a char cap). resolveStoryGrounding
 * (pipeline/select.ts) applies it; tours + roam pass it in.
 */
export const NARRATION_FALLBACK_CHARS = 4_000

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

/** Default speed-adaptive trigger floor (m). The reader's fallback when segments.radius_m is
 *  null (nullable now); the generator still writes it explicitly onto every segment. */
export const TRIGGER_RADIUS_M = 120

/** Fallback average drive speed (m/s ≈ 30 mph) if a corridor lacks a frozen durationSeconds. */
export const FALLBACK_SPEED_MPS = 13.4
