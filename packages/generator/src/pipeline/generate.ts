// The M1 generator pipeline — assemble ONE tour from its seeded shell.
//
//   tour shell (DB, loaded by slug)          (frozen route + endpoints + region)
//     -> Wikidata SPARQL spine               (discover candidate POIs in the route box)
//     -> Wikipedia prose + Places            (per-candidate fact enrichment + BREAK anchors)
//     -> select stops by drive TIME          (pace, not distance)
//     -> Skipper narration (Anthropic)       (persona resolved from the region slug;
//                                             story + scenic + break)
//     -> eval panel + optimizer              (free dims per pass; grounding once;
//                                             drives regen, RECORDS — never gates `ready`)
//     -> TTS (Google Cloud, Gemini-TTS) -> R2 (audio + duration)
//     -> tours + ordered segments/tracks (Neon)  (atomic ready-gate; a stop = 1 segment + 1 track)
//
// Invariants honored here:
//   - Persona lives in delivery, never in facts: story stops get a fact sheet;
//     scenic stops carry none; break stops carry only the curated NAME + KIND
//     (sayable), never volatile data (hours/rating/features — live at tour-load).
//   - Story attribution (CC BY-SA) is snapshotted on every story clip.
//   - EVERY stop — story, scenic, AND break — gets a segment + track with non-null
//     audio; a tour reaches `ready` only via the atomic batch, after every stop has it.
// M1 scope: no cache reuse, no dedup beyond the (source,source_id) upsert, no
// feedback. Break narration names the curated Places anchor; the volatile live data
// (open-now/rating) is still fetched fresh at tour-load (and "ask the skipper" later).

import type { BracketKind, DurationBucket, JokeLevel } from '@skipper/shared'
import type { AttributionSnapshot } from '@skipper/db/schema'
import {
  ANTHROPIC_READY,
  EVAL_MAX_PASSES,
  EVAL_REGEN_BUDGET,
  GEOLOGY_ENRICHMENT,
  GOOGLE_TTS_READY,
  GROUNDING_EVAL,
  FACTS_TTL_HOURS,
  GROUNDING_REGEN_BUDGET,
  GROUNDING_REGEN_CONCURRENCY,
  GROUNDING_REGEN_MAX_ROUNDS,
  NARRATION_CONCURRENCY,
  PANEL_REGEN_CONCURRENCY,
  FALLBACK_SPEED_MPS,
  GOOGLE_READY,
  PACING,
  QUEUE_LAG_WARN_SEC,
  R2_READY,
  SCOUT_CONCURRENCY,
  SCOUT_ENRICHMENT,
  TTS_CONCURRENCY,
  WIKIDATA_ENRICHMENT,
  requireEnv,
} from '../config'
import { mapLimit } from './concurrency'
import { estimateTtsUsd, llmSpendLines, llmSpentUsd, unpricedModels } from './spend'
import {
  applyTailOutcomes,
  buildGroundingWell,
  buildScorecard,
  evaluateDiversity,
  evaluateGrounding,
  evaluateTts,
  findingScore,
  gatesNotWorse,
  optimize,
  recordGenerationEval,
} from '../eval'
import { NARRATION_MODEL } from '../models'
import type {
  GroundingInput,
  OptimizeResult,
  OptimizeRound,
  StopEval,
  TourScorecard,
} from '../eval'
import { personaForRegion } from '../persona'
import { cumulativeMeters, encodePolyline, METERS_PER_MILE, totalMeters } from './geo'
import type { LngLat } from './geo'
import { fetchDeepExtracts } from './wikipedia'
import { ensurePoiOverridesLoaded } from './poi-overrides'
import { boundingBox } from './wikidata-discovery'
import { loadCandidatePoisInBox } from './region-corpus'
import { geologyFacts } from './macrostrat'
import { wikidataFacts } from './wikidata'
import { scoutStop } from './scout'
import { searchBreakStops, spokenKind } from './places'
import type { BreakAnchor } from './places'
import { projectQueueLag, selectStops, toFacts } from './select'
import type { StopPlan } from './select'
import { narrateIntro, narrateOutro, narrateStop } from './narrate'
import type { NarrationRequest } from './narrate'
import { judgeCloserDiversity } from './judge'
import { synthesizeWithTailRetake } from './tts'
import type { TailOutcome } from './tts'
import { bracketKey, clipKey, uploadAudio } from './storage'
import {
  finalizeTourReady,
  hashFacts,
  loadFreshPoiFacts,
  loadTour,
  markTourGenerating,
  resolvePersonaId,
  restoreAfterFailedRun,
  upsertPoi,
} from './persist'
import type { FinalBracket, FinalStop } from './persist'

export interface GenerateOptions {
  slug: string
  durationBucket?: DurationBucket
  /** The Dad-Joke-O-Meter notch to NARRATE at — a generation input, not stored tour state.
   *  Baked into the narration audio; defaults to `dadpocalypse` (the M1 notch). */
  jokeLevel?: JokeLevel
  /** Narrate + print scripts only; skip TTS, R2, and all TOUR-STATE writes. (The run's
   *  eval scorecard IS still recorded to eval_runs — observability, not state.) */
  dryRun?: boolean
  /** Run the optional semantic-closer judge (one extra model call) after the lint. */
  judgeClosers?: boolean
  /** Abort BEFORE the TTS/R2 phase if (LLM spent so far + estimated TTS) exceeds this many
   *  USD. LLM spend is already SUNK at the gate — the cap saves the TTS bill and leaves the
   *  tour untouched (scripts + the eval record still land, like a dry run). */
  maxCostUsd?: number
}

export interface StopSummary {
  seq: number
  stopType: StopPlan['stopType']
  /** The pois dedup identity — the STABLE cross-run case key for eval comparison
   *  (stop ids regenerate every telling; places don't). */
  source: string
  sourceId: string
  name: string
  alongSec: number
  /** SAYABLE kind — story/scenic: the POI kind; break: the SPOKEN kind (post-spokenKind).
   *  Emitted so the artifact auditor builds the same permitted well the narrator had. */
  kind?: string
  /** STORY only: which side of the road the place is on, when the geometry called it. */
  sideOfRoad?: 'left' | 'right'
  script?: string
  /** STORY only: the grounded fact sheet the model was given — emitted on dry-run so
   *  the script can be audited against its exact well of facts (grounding invariant). */
  facts?: string[]
  /** STORY + SCENIC: the geology lines (Macrostrat) the model was given — part of the audited well. */
  geology?: string[]
  /** STORY only: the Wikidata structured facts the model was given — part of the audited well. */
  wikidata?: string[]
  /** STORY only: co-located landmarks merged into this stop — their facts are part of the audited well. */
  mergedFeatures?: { name: string; facts: string[] }[]
  durationMs?: number
  audioUrl?: string
}

export interface BracketSummary {
  kind: BracketKind
  script?: string
  durationMs?: number
}

/** One optimizer engagement on one stop — the per-pass trajectory the eval flywheel records. */
export interface EvalPassTrace {
  seq: number
  /** Which pass engaged the stop: 'panel pass N' (free dims), 'closer-judge', 'grounding'. */
  phase: string
  rounds: number
  stop: OptimizeResult<string>['stop']
  history: OptimizeRound[]
  /** Rounds ran but the take did not change — a failed/budget-capped regen returns the
   *  previous take (which scores as an accepted tie); this flag keeps the trace honest. */
  unchanged?: boolean
}

/** Re-narration ATTEMPTS (a failed attempt still burned spend) vs the configured cap. */
export interface RegenSpend {
  used: number
  budget: number
}

/** The generation-time eval ride-along: the final scorecard + every optimizer trajectory.
 *  RECORDING only — a failing gate dimension here never blocks `ready` (CLAUDE.md: no
 *  automated groundedness gate; the human ear stays the ship decision). */
export interface TourEvalReport {
  scorecard: TourScorecard
  passes: EvalPassTrace[]
  /** The two cost-guard pools: free-dim passes + closer judge, and the grounding pass —
   *  separate so a tic-heavy tour can't starve the grounding regens (see config.ts). */
  regens: { panel: RegenSpend; grounding: RegenSpend }
}

export interface GenerateResult {
  tourId?: string
  slug: string
  /** Display label for the drive (the tour's headline, e.g. "Emerald Bay"). */
  tourName: string
  region: string
  /** Region SLUG (the persona-registry key) — single-sourced from the tour shell so the
   *  offline eval resolves the SAME persona kit the live pipeline used, instead of guessing
   *  it by slugifying the display name. */
  regionSlug: string
  /** Provenance pin for the eval record: which model narrated this telling. */
  narrationModel: string
  durationBucket: DurationBucket
  /** The notch this run narrated at (a generation input; not persisted on the tour). */
  jokeLevel: JokeLevel
  totalSec: number
  dryRun: boolean
  stops: StopSummary[]
  brackets: BracketSummary[]
  /** The eval panel's scorecard + optimizer trace for this run (persisted via --json). */
  eval: TourEvalReport
  /** Wall-clock per pipeline phase (ms) — rides the artifact into eval_runs so profiling
   *  a run is a query, not R2-timestamp archaeology. */
  timings?: Record<string, number>
  /** True when the --max-cost gate stopped the run before TTS (dryRun is also true then:
   *  no tour state was written — that is what dry means in the eval record). */
  costCapped?: boolean
}

const firstSentence = (facts: string[]): string | null => facts[0] ?? null

/** The kind as the narrator may SAY it — break kinds go through spokenKind (a raw Places
 *  primaryType isn't speakable); story/scenic use the POI kind as-is. Drives both the
 *  artifact's `kind` field and the grounding well, so the audit matches the narration. */
const sayableKind = (s: StopPlan): string | null =>
  s.stopType === 'break' ? spokenKind(s.kind) : s.kind

export async function generateTour(opts: GenerateOptions): Promise<GenerateResult> {
  const durationBucket: DurationBucket = opts.durationBucket ?? 'standard'
  // The notch is a generation INPUT (not stored tour state): default to the M1 dadpocalypse.
  const jokeLevel: JokeLevel = opts.jokeLevel ?? 'dadpocalypse'
  const dryRun = Boolean(opts.dryRun)
  const judgeClosers = Boolean(opts.judgeClosers)

  if (!ANTHROPIC_READY()) throw new Error('ANTHROPIC_API_KEY is not set (narration requires it).')
  // A money guardrail must never be silently OFF: NaN satisfies `!== undefined` while every
  // `>` comparison reads false — fail fast BEFORE any model call is paid for (review-caught).
  if (
    opts.maxCostUsd !== undefined &&
    !(Number.isFinite(opts.maxCostUsd) && opts.maxCostUsd > 0)
  ) {
    throw new Error(`maxCostUsd must be a finite positive dollar amount (got ${opts.maxCostUsd})`)
  }
  if (!dryRun) {
    if (!GOOGLE_TTS_READY())
      throw new Error(
        'Google Cloud TTS is not configured — set GOOGLE_CLOUD_PROJECT and provide ADC ' +
          '(GOOGLE_APPLICATION_CREDENTIALS=<service-account.json>, or `gcloud auth application-default login` ' +
          'plus GOOGLE_TTS_USE_ADC=1). Use --dry-run to skip TTS.',
      )
    if (!R2_READY()) {
      throw new Error('R2_* env (ACCOUNT_ID, ACCESS_KEY_ID, SECRET_ACCESS_KEY, BUCKET) is not set.')
    }
  }

  // 0. Curated corrections (poi_overrides) load once per run — BEFORE discovery/selection,
  // so the Wikipedia fetch seam and the sync side-anchor lookup in select.ts both see them.
  // The instant BEFORE the load is the run's facts stamp (review-caught): facts fetched
  // this run carry corrections as-of this snapshot, so an override adjudicated at ANY
  // later point — even mid-run — reads as newer than the fetch and busts the cache.
  const factsSnapshotAt = new Date()
  await ensurePoiOverridesLoaded()

  // 1. Tour shell: route geometry + drive time (the pacing clock) + endpoints/region.
  const shell = await loadTour(opts.slug)
  if (shell.status === 'generating') {
    // Not fatal (a hard-killed run leaves this status behind and the blind marker below is
    // the self-heal), but a CONCURRENT run would be double spend — say so loudly.
    console.warn(
      `Tour "${opts.slug}" is already 'generating' — another run may be in flight (or a prior ` +
        `run crashed). Per-run clip/bracket keys keep R2 safe, but prefer one run at a time.`,
    )
  }
  // The generation persona (prompts/voice/style/kit) is resolved from the tour's REGION.
  // The notch (`jokeLevel`) is a generation input resolved above — not a tour column, not a
  // persona trait.
  const persona = personaForRegion(shell.regionSlug)
  const polyline = shell.polyline as LngLat[]
  const cumulative = cumulativeMeters(polyline)
  const totalM = totalMeters(cumulative)
  const totalSec = shell.durationSeconds ?? Math.round(totalM / FALLBACK_SPEED_MPS)
  console.log(
    `Tour "${shell.headline}" (${shell.regionName}): ${(totalM / METERS_PER_MILE).toFixed(1)} mi, ~${Math.round(totalSec / 60)} min` +
      (shell.durationSeconds ? '' : ' [estimated drive time]'),
  )

  // Phase wall-clock (ms) — recorded on the result so eval_runs carries the profile.
  const runStart = Date.now()
  const timings: Record<string, number> = {}
  let lapStart = runStart
  const lap = (phase: string): void => {
    timings[phase] = Date.now() - lapStart
    lapStart = Date.now()
  }
  const finishTimings = (): Record<string, number> => {
    timings.total = Date.now() - runStart
    console.log(
      'Phase timings: ' +
        Object.entries(timings)
          .map(([k, v]) => `${k} ${(v / 1000).toFixed(1)}s`)
          .join(' · '),
    )
    return timings
  }

  // 2. Candidates from the REGION CORPUS (discovery-first reorder): the shared `pois` table,
  //    pre-populated for the region by sweep-roam-pois.ts. STORY = a Wikipedia-sourced row with
  //    prose; SCENIC = a named Wikidata pin. No live WDQS here — the corpus IS the discovery
  //    layer, scoped to the route's bounding box (and shared with roam). An empty corpus is an
  //    operator error (discover the region first), thrown at $0 before any paid LLM/TTS call.
  console.log('Loading POI candidates from the region corpus...')
  const routeBox = boundingBox(polyline)
  const wikiPois = await loadCandidatePoisInBox(routeBox.sw, routeBox.ne)
  if (wikiPois.length === 0) {
    throw new Error(
      'No POIs in the route corridor — the region corpus is empty here. Run region discovery ' +
        '(sweep-roam-pois.ts --apply for the region bbox) before generating this tour.',
    )
  }
  const storyCount = wikiPois.filter((p) => p.source === 'wikipedia').length
  console.log(
    `Loaded ${wikiPois.length} candidates from the corpus ` +
      `(${storyCount} story-grade, ${wikiPois.length - storyCount} named-scenic).`,
  )
  lap('discovery')

  // 3. Break-stop anchors from Places (non-fatal — breaks are a nicety).
  let breakAnchors: BreakAnchor[] = []
  if (GOOGLE_READY()) {
    try {
      breakAnchors = await searchBreakStops(
        encodePolyline(polyline),
        requireEnv('GOOGLE_MAPS_API_KEY'),
      )
      console.log(`Found ${breakAnchors.length} break-stop anchors.`)
    } catch (e) {
      console.warn(`Break-stop search failed (continuing without breaks): ${(e as Error).message}`)
    }
  } else {
    console.warn('GOOGLE_MAPS_API_KEY not set — skipping break stops.')
  }
  lap('places')

  // 4. Select + time-pace stops.
  const plan = selectStops({
    polyline,
    totalSec,
    wikiPois,
    breakAnchors,
    pacing: PACING[durationBucket],
  })
  const narratedCount = plan.filter((s) => s.stopType !== 'break').length
  if (narratedCount === 0) throw new Error(`No narratable stops found for "${opts.slug}".`)
  console.log(
    `Planned ${plan.length} stops: ${plan.filter((s) => s.stopType === 'story').length} story, ` +
      `${plan.filter((s) => s.stopType === 'scenic').length} scenic, ` +
      `${plan.filter((s) => s.stopType === 'break').length} break.`,
  )

  // Overlap guard: tighter pacing admits more stops, but clips play through a sequential
  // FIFO queue, so stops paced closer than their clips are long make the audio lag behind
  // the car. Surface that HERE (at generation), never on the road — a flagged tour wants a
  // higher minGapSec or fewer stops (see PACING / QUEUE_LAG_WARN_SEC).
  const lag = projectQueueLag(plan)
  const backedUp = lag.filter((l) => l.lagSec > QUEUE_LAG_WARN_SEC)
  if (backedUp.length > 0) {
    console.warn(
      `⚠ Queue backup: ${backedUp.length} clip(s) start >${QUEUE_LAG_WARN_SEC}s after their trigger ` +
        `(pacing too dense — audio will lag behind the car):`,
    )
    for (const l of backedUp) console.warn(`    +${l.lagSec}s late · "${l.name}"`)
  } else {
    console.log(
      `Queue pacing OK — worst clip lag ${Math.max(0, ...lag.map((l) => l.lagSec))}s (no stop outruns the drive).`,
    )
  }

  // Deepen the fact sheets for the CHOSEN story stops. Selection ranked + classified
  // candidates on the cheap batched LEAD extract; a fuller, longer telling needs more
  // than the lead, so we pull the full article (capped, meta-trimmed) for each story
  // stop the pois cache can't serve (the read-through below) and use it as the fact
  // well. Grounding is unchanged — still only that POI's Wikipedia text — and any
  // per-POI failure falls back to its lead facts.
  // seq → the freshness stamp the persist phase must write for that stop's facts: a cache
  // HIT carries its row's ORIGINAL stamp (set in the read-through below); every fetched
  // stop falls back to this run's overrides-snapshot instant (factsSnapshotAt).
  const factsStampBySeq = new Map<number, Date>()
  const storyStops = plan.filter(
    (s): s is StopPlan & { wikiPageId: number } =>
      s.stopType === 'story' && s.wikiPageId !== undefined,
  )
  if (storyStops.length > 0) {
    // READ-THROUGH (principle #1's TTL mechanism, read side): a place narrated before
    // already carries its deepened, override-CORRECTED extract on pois — reuse it while
    // fresh instead of re-fetching the full article. Fresh = within FACTS_TTL_HOURS and
    // not predating the place's newest poi_override row (a correction adjudicated since
    // the fetch makes the row stale, so the re-fetch applies it — see loadFreshPoiFacts).
    const cached = await loadFreshPoiFacts(
      storyStops.map((s) => ({ source: s.source, sourceId: s.sourceId })),
      FACTS_TTL_HOURS(),
    )
    const toFetch: typeof storyStops = []
    for (const s of storyStops) {
      const hit = cached.get(`${s.source}:${s.sourceId}`)
      // A hit counts ONLY when its extract would actually be adopted (outsizes the lead —
      // the live fetch's adopt rule). A hit that doesn't outsize the lead is a MISS
      // (review-caught): pois can't tell a deep extract from a lead-only row stored by a
      // run whose deep fetch FAILED, so treating it as satisfied would pin that place to
      // a thin sheet for the whole TTL. Re-fetching lets it heal — one polite wiki call.
      if (hit && hit.extract.length > s.facts.join(' ').length) {
        s.facts = toFacts(hit.extract)
        // Reuse keeps the row's ORIGINAL fetch stamp (review-caught: re-stamping a cache
        // hit would slide the TTL forever for frequently-regenerated places).
        factsStampBySeq.set(s.seq, hit.factsFetchedAt)
      } else {
        toFetch.push(s)
      }
    }
    console.log(
      `Deepening fact sheets: ${storyStops.length - toFetch.length}/${storyStops.length} fresh ` +
        `from pois (TTL ${FACTS_TTL_HOURS()}h)` +
        (toFetch.length > 0 ? `; fetching ${toFetch.length} full-article extract(s)...` : '.'),
    )
    if (toFetch.length > 0) {
      const deep = await fetchDeepExtracts(toFetch.map((s) => s.wikiPageId))
      for (const s of toFetch) {
        const text = deep.get(s.wikiPageId)
        if (text && text.length > s.facts.join(' ').length) s.facts = toFacts(text)
      }
      console.log(`Deepened ${deep.size}/${toFetch.length} fetched story fact sheets.`)
    }
  }
  lap('deepenFacts')

  // Geology enrichment for SCENIC stops (Macrostrat, CC BY 4.0): a coordinate-keyed fact
  // layer — the rock you are driving through, grounded from geologic maps. SCENIC gets it
  // ALWAYS: a scenic stop carries no Wikipedia facts, so geology is the one true thing it
  // can say — a CONTRACT, not a heuristic, so it stays out of the scout's hands. The
  // TRIGGER point (POI snapped onto the road) is queried — "the rock under your tires,"
  // always on LAND (dodges the fine map's "water" units that force a coarse fallback).
  // Per-stop failures are non-fatal (the stop just gets no geology). Set SKIPPER_GEOLOGY=off.
  if (GEOLOGY_ENRICHMENT()) {
    const scenicStops = plan.filter((s) => s.stopType === 'scenic')
    console.log(`Enriching ${scenicStops.length} scenic stops with Macrostrat geology...`)
    // Independent coordinate lookups — bounded fan-out instead of one-at-a-time.
    let geoHits = 0
    await mapLimit(scenicStops, 4, async (s) => {
      const geo = await geologyFacts(s.triggerLat, s.triggerLng)
      if (geo) {
        s.geology = geo.facts
        s.geologyAttribution = geo.attribution
        geoHits++
      }
    })
    console.log(`Geology grounded ${geoHits}/${scenicStops.length} scenic stops.`)
  }
  lap('geology')

  // STORY-stop enrichment is the SCOUT's call (pipeline/scout.ts): a bounded tool-using
  // agent reads each stop's deepened sheet, judges what the telling is missing, fetches
  // grounded enrichment (geology at the road or the landmark point; Wikidata key facts),
  // and decides how it should land — replacing the old char-count sparse-gates + the
  // hand-curated iconic allowlist (docs/decisions/enrichment-scout.md). Its tools are
  // keyed to the stop's OWN coords/QID, so it can only gather, never assert: every fact
  // still arrives verbatim from a sourced fetcher, with attribution for the freeze.
  // Per-stop failures are non-fatal (the stop just gets no enrichment, same as a fetcher
  // failure under the old gates). Set SKIPPER_SCOUT=off to skip.
  if (SCOUT_ENRICHMENT()) {
    const scoutStops = plan.filter((s) => s.stopType === 'story')
    console.log(`Scouting enrichment for ${scoutStops.length} story stops (judgment, not char-gates)...`)
    const runScout = async (s: StopPlan): Promise<void> => {
      try {
        const decision = await scoutStop(
          {
            name: s.name,
            kind: s.kind,
            region: shell.regionName,
            corridor: shell.headline,
            facts: s.facts,
            ...(s.mergedFeatures?.length
              ? { mergedFeatures: s.mergedFeatures.map((m) => ({ name: m.name, facts: m.facts })) }
              : {}),
            targetSeconds: s.targetSeconds,
          },
          {
            // Stop-keyed tools: the scout picks WHICH point ("road" = the trigger point
            // under the tires; "landmark" = the POI itself, for rock-IS-the-place stops
            // where the road below snaps onto valley alluvium) — never WHOSE facts.
            geologyAt: GEOLOGY_ENRICHMENT()
              ? (point) =>
                  point === 'landmark'
                    ? geologyFacts(s.lat, s.lng)
                    : geologyFacts(s.triggerLat, s.triggerLng)
              : null,
            wikidataFacts:
              WIKIDATA_ENRICHMENT() && s.wikidataQid
                ? () => wikidataFacts(s.wikidataQid!)
                : null,
          },
        )
        if (!decision) {
          console.log(`  stop ${s.seq} ("${s.name}"): scout passed (no enrichment).`)
          return
        }
        if (decision.geology) {
          s.geology = decision.geology.facts
          s.geologyAttribution = decision.geology.attribution
          // The narration cue keeps the StopPlan vocabulary: 'iconic' = the rock IS the
          // headline (the old allowlist's cue), 'sparse' = supporting texture.
          s.geologyReason = decision.geology.emphasis === 'headline' ? 'iconic' : 'sparse'
        }
        if (decision.wikidata) {
          s.wikidata = decision.wikidata.facts
          s.wikidataAttribution = decision.wikidata.attribution
        }
        const got = [
          ...(decision.geology ? [`geology(${decision.geology.emphasis})`] : []),
          ...(decision.wikidata ? ['wikidata'] : []),
        ]
        console.log(
          `  stop ${s.seq} ("${s.name}"): ${got.length ? got.join(' + ') : 'nothing included'} — ${decision.reason}`,
        )
      } catch (e) {
        console.warn(
          `  stop ${s.seq} ("${s.name}") scout failed (${(e as Error).message}) — no enrichment.`,
        )
      }
    }
    // The scouts are independent per stop (each touches only its OWN StopPlan) — bounded
    // fan-out. NOTE (review-caught): no warm-first staggering — scout calls set no
    // cache_control, so there is no prompt cache to warm (and the scout's small
    // tools+system prefix sits under Opus's 4096-token cacheable minimum anyway).
    await mapLimit(scoutStops, SCOUT_CONCURRENCY(), runScout)
  }
  lap('scout')

  // Cross-stop variety is enforced AFTER narration, not threaded through it: the first pass
  // narrates every stop in PARALLEL, blind to its siblings (see the narration loop below), then
  // the diversity lint + regen pass catches and fixes collisions. These extractors feed THAT
  // editor (regenScript), giving a re-narrated stop full awareness of every OTHER stop's
  // opener/closer/kit/motifs — the context the first pass no longer threads.
  const openerOf = (script: string) => script.trim().split(/\s+/).slice(0, 8).join(' ')
  const closerOf = (script: string) => script.trim().split(/\s+/).slice(-8).join(' ')
  // Detect which personal-kit beats a script leaned on, so later (independently
  // generated) stops can be told they're spent — the load-bearing fix for kit
  // overuse, since each stop is narrated in isolation with no view of its siblings.
  // The kit is per-PERSONA (persona.kit.beats) — the SAME source the diversity lint
  // bans in stops, so the two can never desync.
  const kitBeatsOf = (script: string) =>
    persona.kit.beats.filter((b) => b.match.test(script)).map((b) => b.label)
  // Recurring DEVICES beyond the fixed personal kit — the same-shape gags the charm
  // judge keeps flagging on a new vector each run (every town's post office, the
  // name-change rundown, "was nothing"; and self-deprecation flavors the model invents
  // fresh — the one-room apartment, the handyman who won't show). Same isolation problem
  // as the kit, so detect them and tell later stops the bit is SPENT. Unlike the kit
  // (which has a 1/3 budget), a frame is a one-time bit — the spent list is CUMULATIVE.
  const MOTIF_BEATS: [RegExp, string][] = [
    [/post ?office/i, 'the post-office (opened/closed/reopened) bit'],
    [
      /could ?(n'?t| not) (decide|pick|settle|make up)|make up (your|his|its|their|my)? ?mind|answered to .{0,30}names|changed (its )?names?|(a few|a couple of?|several|different|two|three) names?\b|gone by .{0,15}names?|used to be called|(went|gone) by\b/i,
      'the "place that changed / could not pick its name" rundown',
    ],
    [
      /(patch|place|stretch|spot|valley|lot) (of |that was )?nothing|was (just )?nothing\b|nobody (could|would) (name|picture)|undeveloped|empty .{0,15}(valley|patch|mountain)/i,
      'the "was nothing, now something" frame',
    ],
    [
      /the distance from .{0,30}(dock|hat|boat)|surveyed .{0,20}inch|down to the (quarter section|inch|foot)|tape measure|the kind of precision|some poor soul/i,
      'the surveyed-to-the-inch / tape-measure-precision gag',
    ],
    [
      /one good word|use(d)? it twice|used twice|why (pay|reach|use|go) (for )?two\b|one (word|idea|name).{0,18}(twice|do the|hold the|float)|covering all (your|his) bases|wearing every hat|every hat (the|this|it)|all three (jobs|hats)|namesake.{0,25}(same|are the same)/i,
      'the "economy of naming / one man did it all and named it after himself" riff',
    ],
    [
      /my (one[- ]room |whole )?apartment|lose my keys|keys? in (it|there)/i,
      'the one-room-apartment self-deprecation',
    ],
    [
      /(get|find) (a|my) (guy|handyman|fellow).{0,25}(wrench|show|fix)|with a wrench/i,
      'the handyman-with-a-wrench self-deprecation',
    ],
    [/I do this for a living/i, 'the "I do this for a living" self-deprecation'],
  ]
  const motifBeatsOf = (script: string) =>
    MOTIF_BEATS.filter(([re]) => re.test(script)).map(([, label]) => label)
  const baseReq = (s: StopPlan): NarrationRequest => ({
    region: shell.regionName,
    corridor: shell.headline,
    stopType: s.stopType,
    jokeLevel,
    targetSeconds: s.targetSeconds,
    // STORY: name + facts (+ side of road, when geometry calls it). BREAK: the curated
    // name + kind (no facts). SCENIC: neither.
    ...(s.stopType === 'story'
      ? {
          place: { name: s.name, kind: s.kind },
          facts: s.facts,
          ...(s.sideOfRoad ? { sideOfRoad: s.sideOfRoad } : {}),
          ...(s.geology?.length
            ? {
                geology: s.geology,
                ...(s.geologyReason ? { geologyContext: s.geologyReason } : {}),
              }
            : {}),
          ...(s.wikidata?.length ? { wikidata: s.wikidata } : {}),
          ...(s.mergedFeatures?.length
            ? { mergedFeatures: s.mergedFeatures.map((m) => ({ name: m.name, facts: m.facts })) }
            : {}),
        }
      : s.stopType === 'break'
        ? { place: { name: s.name, kind: spokenKind(s.kind) } } // normalize raw primaryType
        : // SCENIC: a NAMED Wikidata feature — its name + KIND are sayable like a break's (no
          // facts), plus the side to gesture at and geology when present. (All spine scenic
          // pins carry a name; a bare/nameless scenic just omits place and stays mood-only.)
          {
            ...(s.name ? { place: { name: s.name, kind: s.kind } } : {}),
            ...(s.sideOfRoad ? { sideOfRoad: s.sideOfRoad } : {}),
            ...(s.geology?.length ? { geology: s.geology } : {}),
          }),
  })
  // First-pass narration: each stop drafts BLIND of its siblings (no cross-stop threading), so
  // the whole tour narrates in PARALLEL instead of one-await-at-a-time — the draft phase is now
  // bounded by its slowest stop, not their sum. The price is that two stops can independently
  // reach for the same opener/kit/motif; that collision is caught and fixed by the diversity
  // lint + regen pass below, which threads FULL sibling context into each retake (regenScript).
  // Trade recorded: parallel draft + after-the-fact cleanup, vs the old serial draft that dodged
  // collisions up front (it cost ~the sum of every stop's latency). mapLimit keeps ITEM ORDER,
  // so narratedRecs stays seq-ordered. Breaks narrate too (named, mandatory audio) but stay OUT
  // of the diversity lint + kit accounting below (short generic cues).
  const narrate = (s: StopPlan) => narrateStop(baseReq(s), persona.systemPrompt)
  console.log(`Narrating ${plan.length} stops in parallel (concurrency ${NARRATION_CONCURRENCY()})...`)
  const narratedRecs: { s: StopPlan; script: string }[] = await mapLimit(
    plan,
    NARRATION_CONCURRENCY(),
    async (s) => {
      console.log(`  narrating stop ${s.seq} (${s.stopType}) "${s.name}"...`)
      const { script } = await narrate(s)
      return { s, script }
    },
  )
  lap('narration')

  // ---- The eval panel + evaluator-optimizer (the in-pipeline flywheel). ----------------
  // Findings feed regeneration through optimize() (accept-if-not-worse, gate-weighted, per-
  // round trace) — generalizing the old bespoke lint→regen loop. Cost shape (deliberate, see
  // config): the PASS loop below runs only the FREE deterministic dims (tts + diversity);
  // GROUNDING (one Opus call per story/scenic stop) runs ONCE as a final pass further down.
  // Nothing in this section can BLOCK the tour — every pass keeps the best available take.

  // Breaks are excluded from the diversity lint — short generic cues, and the kit
  // detector's /coffee/ would misfire on a café break inviting a coffee.
  const lintInputs = () =>
    narratedRecs
      .filter((r) => r.s.stopType !== 'break')
      .map((r) => ({ seq: r.s.seq, stopType: r.s.stopType, script: r.script }))

  // The FREE per-stop panel: tts on every stop (every clip is synthesized verbatim, breaks
  // included), diversity on story/scenic. Diversity is CROSS-stop, so a candidate script is
  // judged by swapping it into the assembled set and keeping only this stop's eval — the
  // same trick the old loop used, now expressed as an evaluator optimize() can drive.
  // Evaluate ONE stop's FREE dims (tts + cross-stop diversity) with `script` swapped into a
  // given assembled `set`. `cheapPanel` passes the LIVE set (snapshot-at-call); the concurrent
  // regen loops below pass a FROZEN snapshot so a parallel retake can't read a sibling
  // mid-mutation (diversity is cross-stop). One helper, three callers.
  const cheapPanelVs = (
    set: ReturnType<typeof lintInputs>,
    rec: { s: StopPlan },
    script: string,
  ): StopEval[] => {
    const evals: StopEval[] = [evaluateTts({ seq: rec.s.seq, script })]
    if (rec.s.stopType !== 'break') {
      const swapped = set.map((r) => (r.seq === rec.s.seq ? { ...r, script } : r))
      evals.push(...evaluateDiversity(swapped, persona.kit).filter((e) => e.seq === rec.s.seq))
    }
    return evals
  }
  const cheapPanel = (rec: { s: StopPlan; script: string }, script: string): StopEval[] =>
    cheapPanelVs(lintInputs(), rec, script)

  // COST GUARD: hard caps on re-narration attempts. TWO pools — the free-dim passes + the
  // closer judge draw on one, the grounding pass on its own — so a tic-heavy tour can't
  // starve the crown-jewel dimension to zero regens. When a pool runs out, each stop keeps
  // its best take so far (safe — accept-if-not-worse) and the cap is logged.
  const panelBudget = { left: EVAL_REGEN_BUDGET }
  const groundingBudget = { left: GROUNDING_REGEN_BUDGET }
  const passTraces: EvalPassTrace[] = []

  // Full-context re-narration of one stop: the same prompt threading as the old lint loop —
  // FULL awareness of every OTHER stop's opener/closer/kit/motifs (not just the trailing-3
  // window) plus the avoid-notes. optimize() owns accept/stop; this owns the prompt.
  const regenScript = async (rec: { s: StopPlan; script: string }, avoid: string[]) => {
    const others = narratedRecs.filter((r) => r.s.seq !== rec.s.seq)
    const { script } = await narrateStop(
      {
        ...baseReq(rec.s),
        recentOpeners: others.map((r) => openerOf(r.script)),
        recentClosers: others.map((r) => closerOf(r.script)),
        recentKitBeats: [
          ...new Set(
            others.filter((r) => r.s.stopType !== 'break').flatMap((r) => kitBeatsOf(r.script)),
          ),
        ],
        recentMotifs: [
          ...new Set(
            others.filter((r) => r.s.stopType !== 'break').flatMap((r) => motifBeatsOf(r.script)),
          ),
        ],
        avoid,
      },
      persona.systemPrompt,
    )
    return script
  }

  // optimize()'s regenerate hook: budget-capped and never-throwing. On a spent budget or a
  // narration failure it returns the PREVIOUS take — optimize() scores it identical, holds
  // the best, and stops (thrash guard) — so a mid-loop failure can't discard an improvement
  // already accepted, and the loop can never block a valid tour. `seed` carries findings an
  // evaluator can't re-derive (the closer judge's notes).
  const regenerateFor =
    (rec: { s: StopPlan; script: string }, budget: { left: number }, seed: string[] = []) =>
    async (avoid: string[], prev: string): Promise<string> => {
      if (budget.left <= 0) {
        console.warn(`  stop ${rec.s.seq}: regen budget exhausted — keeping best take.`)
        return prev
      }
      budget.left--
      try {
        return await regenScript(rec, [...seed, ...avoid])
      } catch (e) {
        console.warn(`  stop ${rec.s.seq} regen failed (${(e as Error).message}) — keeping best take.`)
        return prev
      }
    }

  // One pass of the free panel: optimize every flagged stop once (the OUTER pass loop is the
  // round budget — fixing stop A changes the set stop B is linted against, so flagging is
  // recomputed each pass). Each engagement's history lands in the trace.
  const optimizeFlagged = async (phase: string): Promise<number> => {
    const flagged = narratedRecs.filter((r) => findingScore(cheapPanel(r, r.script)) > 0)
    if (flagged.length === 0) return 0
    console.log(`Eval panel (${phase}): ${flagged.length} stop(s) flagged.`)
    // Freeze the assembled set for this pass so the concurrent regens below judge each
    // candidate against the tour as it stood at pass START — the grounding-pass pattern. A
    // sibling improved DURING this pass is invisible until the next pass re-lints the LIVE set
    // (the outer for-loop is the round budget), so convergence is unharmed; the only cost is
    // the occasional redundant regen the live serial loop would have skipped (safe —
    // accept-if-not-worse, budget-capped). The shared panelBudget is race-free (regenerateFor's
    // synchronous check+decrement), and each task mutates only its OWN rec.script.
    const frozen = lintInputs()
    await mapLimit(flagged, PANEL_REGEN_CONCURRENCY(), async (rec) => {
      const findings = cheapPanelVs(frozen, rec, rec.script).flatMap((e) => e.findings)
      console.log(`  regen stop ${rec.s.seq} (${rec.s.name}): ${findings.join('; ')}`)
      const entryScript = rec.script
      const result = await optimize<string>(rec.script, {
        evaluate: (script) => cheapPanelVs(frozen, rec, script),
        regenerate: regenerateFor(rec, panelBudget),
        maxRounds: 1,
      })
      rec.script = result.item
      if (result.rounds > 0 && result.item === entryScript)
        console.warn(`  stop ${rec.s.seq}: take unchanged (regen rejected or unavailable).`)
      passTraces.push({
        seq: rec.s.seq,
        phase,
        rounds: result.rounds,
        stop: result.stop,
        history: result.history,
        ...(result.rounds > 0 && result.item === entryScript ? { unchanged: true } : {}),
      })
    })
    return flagged.length
  }

  for (let pass = 1; pass <= EVAL_MAX_PASSES; pass++) {
    if (panelBudget.left <= 0) break
    if ((await optimizeFlagged(`panel pass ${pass}`)) === 0) break
  }

  // Optional semantic-closer judge (one extra model call): catches closing-move monotony
  // the deterministic lint can't see — e.g. several stops personifying the place in
  // different words. A semantic finding can't be re-derived by the free panel, so it rides
  // in as a SEED on one guarded regen per flagged stop (accepted only if the free panel
  // isn't worse — the same never-trade-a-tic guard), then one cleanup pass re-checks the
  // set. Best-effort: a judge error never blocks the tour.
  if (judgeClosers) {
    try {
      const judged = await judgeCloserDiversity(
        narratedRecs.map((r) => ({ seq: r.s.seq, script: r.script })),
      )
      if (judged.length > 0) {
        console.log(`Closer judge: ${judged.length} stop(s) flagged for closing-move monotony.`)
        // Same parallel-safe shape as the panel passes: judge each retake against a snapshot
        // frozen before the concurrent regens, share panelBudget via regenerateFor's atomic
        // check+decrement, mutate only the task's own rec.script. The post-judge
        // optimizeFlagged below re-lints the LIVE settled set.
        const frozen = lintInputs()
        await mapLimit(judged, PANEL_REGEN_CONCURRENCY(), async (f) => {
          const rec = narratedRecs.find((r) => r.s.seq === f.seq)
          if (!rec) return
          console.log(`  regen stop ${f.seq} (${rec.s.name}): ${f.reasons.join('; ')}`)
          const before = cheapPanelVs(frozen, rec, rec.script)
          const candidate = await regenerateFor(rec, panelBudget, f.avoid)([], rec.script)
          const unchanged = candidate === rec.script // budget/failure — kept the take, already logged
          const after = cheapPanelVs(frozen, rec, candidate)
          const accepted =
            !unchanged && findingScore(after) <= findingScore(before) && gatesNotWorse(after, before)
          if (accepted) rec.script = candidate
          else if (!unchanged)
            console.warn(`  stop ${f.seq} regen would add findings — keeping previous take.`)
          passTraces.push({
            seq: f.seq,
            phase: 'closer-judge',
            rounds: 1,
            stop: accepted && findingScore(after) === 0 ? 'clean' : 'converged',
            history: [
              { round: 1, avoid: f.avoid, candidateScore: findingScore(after), accepted },
            ],
            ...(unchanged ? { unchanged: true } : {}),
          })
        })
        await optimizeFlagged('post-judge pass')
      } else {
        console.log('Closer judge: closers are varied.')
      }
    } catch (e) {
      console.warn(`Closer judge skipped (${(e as Error).message}).`)
    }
  }

  // GROUNDING — the crown-jewel dimension, run ONCE per story/scenic stop after the free
  // passes settle (N Opus calls, not N×rounds; breaks stay covered by the offline eval
  // CLI). A failing stop gets a bounded targeted re-narration seeded with its ungrounded
  // claims via optimize() — gate-weighted, so killing a violation outweighs any advisory
  // tic the retake picks up. RECORDED + regen-driving ONLY: per CLAUDE.md ("Deferred — DO
  // NOT build: any automated groundedness gate"), a still-failing stop NEVER blocks the
  // tour from `ready` — it surfaces on the scorecard for the human review pass.
  const groundingFinal = new Map<number, StopEval>()
  if (GROUNDING_EVAL()) {
    const gRecs = narratedRecs.filter((r) => r.s.stopType !== 'break')
    const inputFor = (rec: { s: StopPlan }, script: string): GroundingInput => ({
      seq: rec.s.seq,
      stopType: rec.s.stopType,
      placeName: rec.s.name || undefined,
      script,
      well: buildGroundingWell(rec.s),
      region: shell.regionName,
      corridor: shell.headline,
      // Callback carve-out: only stops BEFORE this one — the narrator is fed earlier stops,
      // so a "callback" to a later place would be invention and must not be blessed.
      tourStops: narratedRecs
        .filter((r) => r.s.stopType === 'story' && r.s.seq < rec.s.seq)
        .map((r) => r.s.name),
    })
    console.log(`Grounding audit: ${gRecs.length} story/scenic stops (one judge call each)...`)
    // The first sweep is concurrent (the SDK retries 429s) and SETTLED, never failed: an
    // errored eval just leaves that stop un-audited (logged, absent from the scorecard) —
    // an eval outage must never block generation (the never-gates invariant, in practice).
    const firstPass = await Promise.allSettled(
      gRecs.map((rec) => evaluateGrounding(inputFor(rec, rec.script))),
    )
    const audited: { rec: (typeof gRecs)[number]; first: StopEval }[] = []
    for (let i = 0; i < gRecs.length; i++) {
      const rec = gRecs[i]!
      const first = firstPass[i]!
      if (first.status === 'rejected') {
        console.warn(
          `  stop ${rec.s.seq} ("${rec.s.name}"): grounding eval failed (${(first.reason as Error)?.message ?? first.reason}) — stop not audited.`,
        )
        continue
      }
      audited.push({ rec, first: first.value })
    }

    // PARALLEL-SAFE advisory panel for the concurrent regens below: the live cheapPanel
    // reads sibling scripts mid-mutation, so each candidate is judged against the set as
    // it stood when grounding BEGAN (own script swapped in). Cross-stop truth is unharmed:
    // the final scorecard below re-runs the LIVE panel over the settled scripts.
    const frozenSet = lintInputs()
    const cheapPanelFrozen = (rec: { s: StopPlan }, script: string): StopEval[] =>
      cheapPanelVs(frozenSet, rec, script)

    // The per-stop regen loops run CONCURRENTLY — independent by construction: per-stop
    // memo, the shared budget is spent with a SYNCHRONOUS check+decrement (regenerateFor —
    // no await between, so no over-spend race), traces carry seq (array order is not
    // meaningful), and the advisory panel uses the frozen snapshot above. Wall-clock falls
    // from rounds×stops in series to ~the slowest single stop. SECOND accepted difference
    // vs the serial loop (review-named): regenScript's prompt context (recent openers/
    // closers/kit/motifs) reads sibling scripts LIVE, so a concurrent retake sees siblings
    // nondeterministically mid- or post-regen — advisory prompt context only; the final
    // LIVE scorecard below records any resulting cross-stop collision for the human pass.
    await mapLimit(audited, GROUNDING_REGEN_CONCURRENCY(), async ({ rec, first }) => {
      // Memoize per-script evals so optimize()'s re-evaluation of the initial take is free.
      const memo = new Map<string, StopEval>([[rec.script, first]])
      const evalGrounding = async (script: string): Promise<StopEval> => {
        let g = memo.get(script)
        if (!g) {
          g = await evaluateGrounding(inputFor(rec, script))
          memo.set(script, g)
        }
        return g
      }
      if (!first.pass && groundingBudget.left <= 0) {
        // No silent caps: a failing stop skipped on an exhausted pool is still recorded
        // (its sweep verdict lands on the scorecard) but must be SAID, not swallowed.
        console.warn(
          `  stop ${rec.s.seq} ("${rec.s.name}"): ${first.findings.length} ungrounded claim(s), grounding regen budget exhausted — recorded for human review.`,
        )
      }
      if (!first.pass && groundingBudget.left > 0) {
        console.log(
          `  stop ${rec.s.seq} ("${rec.s.name}"): ${first.findings.length} ungrounded claim(s) — targeted re-narration...`,
        )
        const entryScript = rec.script
        try {
          const result = await optimize<string>(rec.script, {
            evaluate: async (script) => [
              await evalGrounding(script),
              ...cheapPanelFrozen(rec, script),
            ],
            regenerate: regenerateFor(rec, groundingBudget),
            maxRounds: GROUNDING_REGEN_MAX_ROUNDS,
          })
          rec.script = result.item
          passTraces.push({
            seq: rec.s.seq,
            phase: 'grounding',
            rounds: result.rounds,
            stop: result.stop,
            history: result.history,
            ...(result.rounds > 0 && result.item === entryScript ? { unchanged: true } : {}),
          })
        } catch (e) {
          // A candidate's re-audit threw (regenerate never throws): keep the initial take —
          // its sweep verdict is already in the memo — and move on. Never block the tour.
          console.warn(
            `  stop ${rec.s.seq} grounding regen pass failed (${(e as Error).message}) — keeping take.`,
          )
        }
      }
      groundingFinal.set(rec.s.seq, memo.get(rec.script)!)
    })
  }

  // The final scorecard: free dims re-run over the SETTLED scripts + the grounding verdicts.
  // It RIDES the result (and the --json artifact) for the human review pass; the tour
  // proceeds regardless — the eval records, the ear decides.
  const finalEvals: StopEval[] = [
    ...narratedRecs.map((r) => evaluateTts({ seq: r.s.seq, script: r.script })),
    ...evaluateDiversity(lintInputs(), persona.kit),
    ...groundingFinal.values(),
  ]
  const scorecard = buildScorecard({
    slug: shell.slug,
    tourName: shell.headline,
    evaluatedAt: new Date().toISOString(),
    stops: finalEvals,
  })
  for (const d of scorecard.dimensions) {
    console.log(
      `Eval ${d.dimension} (${d.kind}): ${d.pass ? 'pass' : 'FAIL'} · score ${d.score.toFixed(2)} · ${d.stopsFailed}/${d.stopsEvaluated} stop(s) flagged`,
    )
  }
  const regens = {
    panel: { used: EVAL_REGEN_BUDGET - panelBudget.left, budget: EVAL_REGEN_BUDGET },
    grounding: { used: GROUNDING_REGEN_BUDGET - groundingBudget.left, budget: GROUNDING_REGEN_BUDGET },
  }
  console.log(
    (scorecard.pass
      ? 'Eval scorecard: gates clean'
      : 'Eval scorecard: a gate dimension still fails — recorded for human review, NOT blocking ready') +
      ` (regen attempts: panel ${regens.panel.used}/${regens.panel.budget}, grounding ${regens.grounding.used}/${regens.grounding.budget}).`,
  )
  const evalReport: TourEvalReport = { scorecard, passes: passTraces, regens }
  lap('evalPanel')
  const scriptBySeq = new Map(narratedRecs.map((r) => [r.s.seq, r.script]))

  // Intro + outro brackets — the drive's FRAME (persona-only, no fact sheet). The
  // personal KIT, banned from stops, lives in the intro; the sentimental bow in the
  // outro. Mandatory (the ready-gate requires both), so a narration failure aborts.
  console.log('Narrating intro + outro brackets...')
  // Two independent calls (the bracket prompt threads no cross-stop state) — run together.
  const [introScript, outroScript] = await Promise.all([
    narrateIntro(
      {
        region: shell.regionName,
        startAnchor: shell.startAnchorName,
        endAnchor: shell.endAnchorName,
        jokeLevel,
        headline: shell.headline,
        hostName: persona.hostName,
      },
      persona.bracketPrompt,
    ).then((r) => r.script),
    narrateOutro(
      {
        region: shell.regionName,
        endAnchor: shell.endAnchorName,
        jokeLevel,
      },
      persona.bracketPrompt,
    ).then((r) => r.script),
  ])
  const bracketPlan: { kind: BracketKind; script: string }[] = [
    { kind: 'intro', script: introScript },
    { kind: 'outro', script: outroScript },
  ]
  lap('bracketNarration')

  // ---- Run spend: the sunk LLM tally + the TTS estimate (the --max-cost gate). --------
  // This is the LAST moment a cap can save real money: narration/judging is already paid
  // (and recorded per call in pipeline/spend.ts); TTS + R2 are the one cost still ahead.
  const ttsEstimate = estimateTtsUsd(
    [...plan.map((s) => scriptBySeq.get(s.seq)!), ...bracketPlan.map((b) => b.script)],
    persona.ttsStyle.length,
  )
  for (const line of llmSpendLines()) console.log(line)
  const llmUsd = llmSpentUsd()
  console.log(
    `TTS estimate: ~$${ttsEstimate.usd.toFixed(2)} (~${Math.round(ttsEstimate.estSeconds / 60)} min audio)` +
      ` · run total ≈ $${(llmUsd + ttsEstimate.usd).toFixed(2)}`,
  )
  // An unpriced model would read as $0 spend — with a cap set that must fail SAFE
  // (treat as exceeded), never silently under-count (review-caught).
  const unpriced = unpricedModels()
  if (opts.maxCostUsd !== undefined && unpriced.length > 0) {
    console.warn(
      `⚠ --max-cost is set but spend for ${unpriced.join(', ')} is UNPRICED — add it to ` +
        `MODEL_PRICING (pipeline/spend.ts). Failing safe: treating the cap as exceeded.`,
    )
  }
  const costCapped =
    !dryRun &&
    opts.maxCostUsd !== undefined &&
    (unpriced.length > 0 || llmUsd + ttsEstimate.usd > opts.maxCostUsd)
  if (costCapped) {
    console.warn(
      `⛔ --max-cost $${opts.maxCostUsd!.toFixed(2)} would be exceeded (≈$${(llmUsd + ttsEstimate.usd).toFixed(2)})` +
        ` — skipping TTS/R2/tour-state writes. Scripts + the eval record still land below.`,
    )
  }

  // ---- Dry run (or cost-capped): finalized scripts, NO tour-state writes. ---
  if (dryRun || costCapped) {
    // Every stop now has a script (breaks included) — print them all so the named
    // break narration can be eyeballed before any TTS spend.
    const stops: StopSummary[] = plan.map((s) => ({
      seq: s.seq,
      stopType: s.stopType,
      source: s.source,
      sourceId: s.sourceId,
      name: s.name,
      alongSec: s.alongSec,
      ...(sayableKind(s) ? { kind: sayableKind(s)! } : {}),
      ...(s.sideOfRoad ? { sideOfRoad: s.sideOfRoad } : {}),
      script: scriptBySeq.get(s.seq),
      // STORY carries the exact (deepened) fact sheet so the dry-run artifact can be
      // audited script-vs-sheet; SCENIC/BREAK have no Wikipedia facts by construction.
      ...(s.stopType === 'story' ? { facts: s.facts } : {}),
      // Geology (story + scenic), Wikidata (story), and merged co-located landmarks are
      // part of the well too — surface them all so the audit sees the narrator's full sheet.
      ...(s.geology?.length ? { geology: s.geology } : {}),
      ...(s.wikidata?.length ? { wikidata: s.wikidata } : {}),
      ...(s.mergedFeatures?.length
        ? { mergedFeatures: s.mergedFeatures.map((m) => ({ name: m.name, facts: m.facts })) }
        : {}),
    }))
    const dryResult: GenerateResult = {
      tourId: shell.id,
      slug: shell.slug,
      tourName: shell.headline,
      region: shell.regionName,
      regionSlug: shell.regionSlug,
      narrationModel: NARRATION_MODEL,
      durationBucket,
      jokeLevel,
      totalSec,
      // Cost-capped runs report dryRun too — it is the honest record shape (no tour state
      // was written); `costCapped` is what distinguishes them in the artifact.
      dryRun: true,
      stops,
      brackets: bracketPlan.map((b) => ({ kind: b.kind, script: b.script })),
      eval: evalReport,
      timings: finishTimings(),
      ...(costCapped ? { costCapped: true } : {}),
    }
    // Record the eval run durably (eval_runs/eval_scores — observability, not tour state;
    // the ONE thing a dry run writes). Best-effort: a recording failure never kills a run.
    await recordGenerationEval(dryResult).catch((e) =>
      console.warn(`eval record failed (non-fatal): ${(e as Error).message}`),
    )
    return dryResult
  }

  // ---- Full run: narrate -> TTS -> R2 -> persist -> atomic ready-gate. -----
  // The tour SHELL already exists (seeded draft); we FILL it. Each stop becomes a segment +
  // a track: the segment + track ids are generated up front so the clip key
  // (clips/<tourId>/<trackId>) is known before upload, and the fully-populated rows land in
  // one atomic ready-gate batch.
  const tourId = shell.id
  // The frozen host of every segment this run writes — resolve the persona's id once.
  const personaId = await resolvePersonaId(persona.personaKey)
  await markTourGenerating(tourId)
  try {
    const finalStops: FinalStop[] = []
    const finalBrackets: FinalBracket[] = []
    const summaries: StopSummary[] = []

    // Per-stop identity first (facts hash, per-run segment + track ids), then the poi upserts
    // as a bounded fan-out — independent rows, kept OUT of the synth pool so a DB hiccup
    // surfaces before any TTS spend.
    const prep = plan.map((s) => {
      // Every stop anchors to a POI (break stops included). Story stops carry facts;
      // the facts_hash is the narration's grounding fingerprint (staleness detector).
      const facts =
        s.stopType === 'story'
          ? { extract: s.facts.join(' '), title: s.wikiTitle, url: s.wikiUrl, pageId: s.wikiPageId }
          : null
      return {
        s,
        facts,
        factsHash: hashFacts(facts),
        // The stop's place-anchor (segment) + its narration (track). The track id is the
        // clip key — every stop, break included, synthesizes to a TOUR-scoped per-run key.
        // (Break clips name the curated Places anchor; no Wikipedia text, no attribution.)
        segmentId: crypto.randomUUID(),
        trackId: crypto.randomUUID(),
        script: scriptBySeq.get(s.seq)!,
      }
    })
    const poiIds = await mapLimit(prep, 6, (p) => {
      // Speakable anchor is NOT set here — it's seeded by the region sweep (pois.speakable) and
      // owned by the admin; this persist must not clobber it (the upsert coalesce keeps existing).
      return upsertPoi({
        source: p.s.source,
        sourceId: p.s.sourceId,
        name: p.s.name,
        kind: p.s.kind,
        lat: p.s.lat,
        lng: p.s.lng,
        summary: p.s.stopType === 'story' ? firstSentence(p.s.facts) : null,
        facts: p.facts,
        factsHash: p.factsHash,
        // Cache-HIT stops carry their row's ORIGINAL fetch stamp; fetched stops carry the
        // run's overrides-snapshot instant. Never persist-time now() — see UpsertPoiInput.
        factsFetchedAt: p.factsHash ? (factsStampBySeq.get(p.s.seq) ?? factsSnapshotAt) : null,
      })
    })

    // ONE bounded synth+upload pool over every clip — all stops plus both frames. The
    // clips are independent (scripts frozen above, ids per-run), so wall-clock is bounded
    // by the longest clip, not the sum (the serial loop measured ~10 min on a 27-min
    // tour). A failure rejects the pool and the catch below restores status; in-flight
    // siblings settle as orphaned R2 objects — the same accepted per-run-key trade as a
    // failed serial run. Frame (intro/outro) keys are PER-RUN (see bracketKey) so this run
    // can never overwrite the live telling's frame bytes before its own ready-gate commits.
    const bracketRunId = crypto.randomUUID()
    const synthOne = async (script: string, key: string, label: string) => {
      console.log(`Synthesizing ${label}...`)
      // The tail-collapse retake rides every synth: a take whose closing sentences
      // collapse in level gets ONE re-synth, and the better take ships (pipeline/tts.ts).
      const { audio, durationMs, tail } = await synthesizeWithTailRetake(
        script,
        persona.voice,
        persona.ttsStyle,
        label,
      )
      const audioUrl = await uploadAudio(key, audio)
      return { audioUrl, durationMs, tail }
    }
    console.log(
      `Synthesizing ${prep.length} stop clips + ${bracketPlan.length} brackets (concurrency ${TTS_CONCURRENCY()})...`,
    )
    const clipTasks: (() => Promise<{
      audioUrl: string
      durationMs: number
      tail: TailOutcome | null
    }>)[] = [
      ...prep.map(
        (p) => () =>
          synthOne(p.script, clipKey(tourId, p.trackId), `stop ${p.s.seq} (${p.s.stopType}) "${p.s.name}"`),
      ),
      ...bracketPlan.map(
        (b) => () => synthOne(b.script, bracketKey(tourId, b.kind, bracketRunId), `${b.kind} bracket`),
      ),
    ]
    const clips = await mapLimit(clipTasks, TTS_CONCURRENCY(), (task) => task())

    // Assemble the final rows in plan order (mapLimit preserves item order: first the
    // stops, then the two brackets).
    for (const [i, p] of prep.entries()) {
      const s = p.s
      const poiId = poiIds[i]!
      const { audioUrl, durationMs } = clips[i]!
      const { segmentId, trackId, script, factsHash } = p

      // Frozen attribution — an ARRAY, one entry per source this clip drew on. Story
      // clips reuse Wikipedia extract text (CC BY-SA, required). Any stop — story OR
      // scenic — that got Macrostrat geology carries a CC BY entry too; a sparse story
      // enriched with Wikidata facts carries a CC0 entry. A scenic/break clip with no
      // geology and no Wikidata draws on no external text, so its attribution stays null.
      const attribution: AttributionSnapshot[] = []
      if (s.stopType === 'story') {
        attribution.push({
          source: 'wikipedia',
          sourceId: String(s.wikiPageId),
          title: s.wikiTitle,
          url: s.wikiUrl,
          license: 'CC BY-SA 4.0',
          retrievedAt: new Date().toISOString(),
        })
      }
      // Each merged co-located landmark contributed its own Wikipedia text — credit every one.
      for (const m of s.mergedFeatures ?? []) {
        attribution.push({
          source: 'wikipedia',
          sourceId: String(m.wikiPageId),
          title: m.wikiTitle,
          url: m.wikiUrl,
          license: 'CC BY-SA 4.0',
          retrievedAt: new Date().toISOString(),
        })
      }
      if (s.geologyAttribution) attribution.push(s.geologyAttribution)
      if (s.wikidataAttribution) attribution.push(s.wikidataAttribution)

      finalStops.push({
        segmentId,
        trackId,
        seq: s.seq,
        poiId,
        personaId,
        stopType: s.stopType,
        script,
        audioUrl,
        audioDurationMs: durationMs,
        attribution: attribution.length > 0 ? attribution : null,
        // Only fact-grounded (story) stops carry a facts_hash → only they can go fact-stale.
        factsHash: s.stopType === 'story' ? factsHash : null,
        triggerRadiusM: s.triggerRadiusM,
        triggerLat: s.triggerLat,
        triggerLng: s.triggerLng,
        approachHeadingDeg: s.approachHeadingDeg,
      })
      summaries.push({
        seq: s.seq,
        stopType: s.stopType,
        source: s.source,
        sourceId: s.sourceId,
        name: s.name,
        alongSec: s.alongSec,
        ...(sayableKind(s) ? { kind: sayableKind(s)! } : {}),
        ...(s.sideOfRoad ? { sideOfRoad: s.sideOfRoad } : {}),
        script,
        // Carry the STORY fact sheet so the SERVED tour's scripts can be audited
        // (grounding) straight from the result JSON, same as the dry-run artifact.
        ...(s.stopType === 'story' ? { facts: s.facts } : {}),
        ...(s.geology?.length ? { geology: s.geology } : {}),
        ...(s.wikidata?.length ? { wikidata: s.wikidata } : {}),
        ...(s.mergedFeatures?.length
          ? { mergedFeatures: s.mergedFeatures.map((m) => ({ name: m.name, facts: m.facts })) }
          : {}),
        durationMs,
        audioUrl,
      })
    }

    // Bracket rows — their clips came through the same pool, after the stop entries.
    const bracketSummaries: BracketSummary[] = []
    for (const [j, b] of bracketPlan.entries()) {
      const { audioUrl, durationMs } = clips[prep.length + j]!
      finalBrackets.push({ kind: b.kind, script: b.script, audioUrl, audioDurationMs: durationMs })
      bracketSummaries.push({ kind: b.kind, script: b.script, durationMs })
    }

    // Fold the tail-collapse verdicts into the recorded scorecard (the panel scored the
    // SCRIPTS pre-synthesis; eval_runs must also describe the shipped AUDIO). A fixed
    // retake rides as detail; a still-collapsed shipped take fails that stop's tts gate
    // row — recorded for the human pass, never blocking ready (the standing posture).
    // Brackets get the same retake in the pool but have no per-seq eval rows; their
    // outcomes surface in the retake log lines + the summary count here.
    const allTails = clips.map((c) => c.tail)
    const retakes = allTails.filter((t) => t?.retook).length
    if (retakes > 0) {
      const stillCollapsed = allTails.filter((t) => t?.shippedCollapsed).length
      console.log(
        `Tail check: ${retakes}/${clips.length} clip(s) retaken; ` +
          (stillCollapsed > 0
            ? `${stillCollapsed} still collapsed — flagged on the tts dim for the human pass.`
            : 'all shipped takes clean.'),
      )
      const tailBySeq = new Map<number, TailOutcome | null>(
        prep.map((p, i) => [p.s.seq, clips[i]!.tail]),
      )
      evalReport.scorecard = buildScorecard({
        slug: shell.slug,
        tourName: shell.headline,
        evaluatedAt: evalReport.scorecard.evaluatedAt,
        stops: applyTailOutcomes(finalEvals, tailBySeq),
      })
    }
    lap('tts')

    // Ready-gate guard: EVERY stop must have audio before we flip — breaks included
    // (break audio is mandatory; a tour never goes ready with a silent stop). The
    // intro/outro bracket audio is enforced inside finalizeTourReady.
    for (const fs of finalStops) {
      if (!fs.audioUrl) {
        throw new Error(
          `Stop ${fs.seq} (${fs.stopType}) has no audio — refusing to mark tour ready.`,
        )
      }
    }

    await finalizeTourReady(tourId, finalStops, finalBrackets)
    lap('finalize')
    console.log(
      `Tour ${tourId} is READY (${finalStops.length} stops, ${finalBrackets.length} frames).`,
    )
    const liveResult: GenerateResult = {
      tourId,
      slug: shell.slug,
      tourName: shell.headline,
      region: shell.regionName,
      regionSlug: shell.regionSlug,
      narrationModel: NARRATION_MODEL,
      durationBucket,
      jokeLevel,
      totalSec,
      dryRun: false,
      stops: summaries,
      brackets: bracketSummaries,
      eval: evalReport,
      timings: finishTimings(),
    }
    // Record the eval run durably (observability — see the dry path's note).
    await recordGenerationEval(liveResult).catch((e) =>
      console.warn(`eval record failed (non-fatal): ${(e as Error).message}`),
    )
    return liveResult
  } catch (e) {
    // Restore the pre-run status: a failed REGEN of a ready tour stays 'ready' (its old
    // telling is fully intact — the deletes live inside the never-run finalize batch);
    // anything else concludes 'failed'.
    await restoreAfterFailedRun(tourId, shell.status).catch(() => {})
    throw e
  }
}
