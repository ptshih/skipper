// The M1 generator pipeline — assemble ONE tour for ONE corridor.
//
//   corridor (DB)
//     -> Wikipedia geosearch + extracts      (grounded story facts)
//     -> Google Places searchAlongRoute       (food/rest BREAK anchors)
//     -> select stops by drive TIME           (pace, not distance)
//     -> Skipper narration (Anthropic)        (story + scenic + break)
//     -> TTS (Google Cloud, Gemini-TTS) -> R2 (audio + duration)
//     -> tours + ordered tour_stops (Neon)    (atomic ready-gate)
//
// Invariants honored here:
//   - Persona lives in delivery, never in facts: story stops get a fact sheet;
//     scenic stops carry none; break stops carry only the curated NAME + KIND
//     (sayable), never volatile data (hours/rating/features — live at tour-load).
//   - Story attribution (CC BY-SA) is snapshotted on every story clip.
//   - EVERY stop — story, scenic, AND break — gets a poi_content row with non-null
//     audio; a tour reaches `ready` only via the atomic batch, after every stop has it.
// M1 scope: no cache reuse, no dedup beyond the (source,source_id) upsert, no
// feedback. Break narration names the curated Places anchor; the volatile live data
// (open-now/rating) is still fetched fresh at tour-load (and "ask the skipper" later).

import type { DurationBucket } from '@skipper/shared'
import type { AttributionSnapshot } from '@skipper/db/schema'
import {
  ANTHROPIC_READY,
  GOOGLE_TTS_READY,
  FALLBACK_SPEED_MPS,
  GEOSEARCH_STEP_M,
  GOOGLE_READY,
  PACING,
  R2_READY,
  requireEnv,
} from '../config'
import { SKIPPER_DEFAULTS } from '../persona/skipper'
import { cumulativeMeters, encodePolyline, sampleAlong, totalMeters } from './geo'
import type { LngLat } from './geo'
import { discoverWikipediaPois, fetchDeepExtracts } from './wikipedia'
import { searchBreakStops, spokenKind } from './places'
import type { BreakAnchor } from './places'
import { selectStops, toFacts } from './select'
import type { StopPlan } from './select'
import { narrateStop } from './narrate'
import type { NarrationRequest } from './narrate'
import { lintScripts } from './lint'
import type { LintFinding } from './lint'
import { judgeCloserDiversity } from './judge'
import { synthesize } from './tts'
import { clipKey, uploadAudio } from './storage'
import {
  createTour,
  finalizeTourReady,
  loadCorridor,
  markTourFailed,
  upsertPoi,
  upsertPoiContent,
} from './persist'
import type { FinalStop } from './persist'

export interface GenerateOptions {
  slug: string
  durationBucket?: DurationBucket
  /** Narrate + print scripts only; skip TTS, R2, and all DB writes. */
  dryRun?: boolean
  /** Flag this tour as the anonymous-playable sample (tours.isPreview). */
  preview?: boolean
  /** Run the optional semantic-closer judge (one extra model call) after the lint. */
  judgeClosers?: boolean
}

export interface StopSummary {
  seq: number
  stopType: StopPlan['stopType']
  name: string
  alongSec: number
  /** STORY only: which side of the road the place is on, when the geometry called it. */
  sideOfRoad?: 'left' | 'right'
  script?: string
  /** STORY only: the grounded fact sheet the model was given — emitted on dry-run so
   *  the script can be audited against its exact well of facts (grounding invariant). */
  facts?: string[]
  durationMs?: number
  audioUrl?: string
}

export interface GenerateResult {
  tourId?: string
  corridor: string
  region: string
  durationBucket: DurationBucket
  totalSec: number
  dryRun: boolean
  stops: StopSummary[]
}

const firstSentence = (facts: string[]): string | null => facts[0] ?? null

export async function generateTour(opts: GenerateOptions): Promise<GenerateResult> {
  const durationBucket: DurationBucket = opts.durationBucket ?? 'standard'
  const dryRun = Boolean(opts.dryRun)
  const judgeClosers = Boolean(opts.judgeClosers)
  const { persona, voice, jokeLevel } = SKIPPER_DEFAULTS

  if (!ANTHROPIC_READY()) throw new Error('ANTHROPIC_API_KEY is not set (narration requires it).')
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

  // 1. Corridor geometry + drive time (the pacing clock).
  const corridor = await loadCorridor(opts.slug)
  const polyline = corridor.polyline as LngLat[]
  const cumulative = cumulativeMeters(polyline)
  const totalM = totalMeters(cumulative)
  const totalSec = corridor.durationSeconds ?? Math.round(totalM / FALLBACK_SPEED_MPS)
  console.log(
    `Corridor "${corridor.name}" (${corridor.region}): ${(totalM / 1609.344).toFixed(1)} mi, ~${Math.round(totalSec / 60)} min` +
      (corridor.durationSeconds ? '' : ' [estimated drive time]'),
  )

  // 2. Grounded POIs from Wikipedia.
  const samples = sampleAlong(polyline, cumulative, GEOSEARCH_STEP_M)
  console.log(`Probing Wikipedia at ${samples.length} points along the route...`)
  const wikiPois = await discoverWikipediaPois(samples)
  console.log(`Found ${wikiPois.length} unique Wikipedia POIs.`)

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

  // Deepen the fact sheets for the CHOSEN story stops. Selection ranked + classified
  // candidates on the cheap batched LEAD extract; a fuller, longer telling needs more
  // than the lead, so we now pull the full article (capped, meta-trimmed) for each
  // story stop and use it as the fact well. Grounding is unchanged — still only that
  // POI's Wikipedia text — and any per-POI failure falls back to its lead facts.
  const storyStops = plan.filter(
    (s): s is StopPlan & { wikiPageId: number } =>
      s.stopType === 'story' && s.wikiPageId !== undefined,
  )
  if (storyStops.length > 0) {
    console.log(
      `Deepening fact sheets for ${storyStops.length} story stops (full-article extracts)...`,
    )
    const deep = await fetchDeepExtracts(storyStops.map((s) => s.wikiPageId))
    for (const s of storyStops) {
      const text = deep.get(s.wikiPageId)
      if (text && text.length > s.facts.join(' ').length) s.facts = toFacts(text)
    }
    console.log(`Deepened ${deep.size}/${storyStops.length} story fact sheets.`)
  }

  // Each stop is an independent narration call, so the model can't see its own
  // prior output. We feed it (a) recent place names for earned callbacks and
  // (b) how the last few stops OPENED, so it can vary its entry instead of
  // reusing "coming up off the bow" every time.
  const priorStops: string[] = []
  const recentOpeners: string[] = []
  const recentClosers: string[] = []
  const recentKit: string[][] = [] // personal-kit beats used per remembered stop
  const openerOf = (script: string) => script.trim().split(/\s+/).slice(0, 8).join(' ')
  const closerOf = (script: string) => script.trim().split(/\s+/).slice(-8).join(' ')
  // Detect which personal-kit beats a script leaned on, so later (independently
  // generated) stops can be told they're spent — the load-bearing fix for kit
  // overuse, since each stop is narrated in isolation with no view of its siblings.
  const KIT_BEATS: [RegExp, string][] = [
    [/dock guy/i, 'the dock guy ("coming Tuesday")'],
    [/\bRay\b/, 'cousin Ray'],
    [/\bengine\b/i, 'the boat engine'],
    [/\bcoffee\b/i, 'his coffee opinions'],
  ]
  const kitBeatsOf = (script: string) =>
    KIT_BEATS.filter(([re]) => re.test(script)).map(([, label]) => label)
  const baseReq = (s: StopPlan): NarrationRequest => ({
    region: corridor.region,
    corridor: corridor.name,
    stopType: s.stopType,
    jokeLevel,
    targetSeconds: s.targetSeconds,
    // STORY: name + facts (+ side of road, when geometry calls it). BREAK: the curated
    // name + kind (no facts). SCENIC: neither.
    ...(s.stopType === 'story'
      ? { place: { name: s.name, kind: s.kind }, facts: s.facts, ...(s.sideOfRoad ? { sideOfRoad: s.sideOfRoad } : {}) }
      : s.stopType === 'break'
        ? { place: { name: s.name, kind: spokenKind(s.kind) } } // normalize raw primaryType
        : {}),
  })
  // First-pass narration: thread the trailing-3 window of cross-stop context.
  const narrate = (s: StopPlan) =>
    narrateStop({
      ...baseReq(s),
      priorStops: priorStops.slice(-3),
      recentOpeners: recentOpeners.slice(-3),
      recentClosers: recentClosers.slice(-3),
      recentKitBeats: [...new Set(recentKit.slice(-3).flat())],
    })
  const rememberStop = (s: StopPlan, script: string) => {
    // Story names the real place (callback-able); break + scenic push a GENERIC token so
    // a later stop can't call back to a transient food spot and characterize it ("that
    // nice café back there" = volatile/opinion the break rule forbids).
    priorStops.push(
      s.stopType === 'story' ? s.name : s.stopType === 'break' ? 'a rest stop' : 'a quiet stretch',
    )
    recentOpeners.push(openerOf(script))
    recentClosers.push(closerOf(script))
    // Breaks are invisible to kit accounting (a café break inviting "a coffee" is a
    // generic cue, not the coffee-opinion kit) AND don't occupy a slot in the trailing-3
    // window, so they can't flush a real narrated kit beat out of it early.
    if (s.stopType !== 'break') recentKit.push(kitBeatsOf(script))
  }

  // Narrate every stop up front — cheap (no TTS yet), so the lint can see the whole
  // tour and regenerate outliers BEFORE we pay to synthesize. Breaks are narrated too
  // (named, mandatory audio) with cross-stop opener/closer context, but they're kept
  // OUT of the diversity lint + kit accounting below (short generic cues).
  const narratedRecs: { s: StopPlan; script: string }[] = []
  for (const s of plan) {
    console.log(`Narrating stop ${s.seq} (${s.stopType}) "${s.name}"...`)
    const { script } = await narrate(s)
    rememberStop(s, script)
    narratedRecs.push({ s, script })
  }

  // Post-assembly diversity lint: regenerate cross-stop outliers (Anthropic only,
  // still no TTS). Each flagged stop is re-narrated with the finding's `avoid` notes
  // plus FULL awareness of every OTHER stop's opener/closer/kit (not just the
  // trailing-3 window). A regen failure or a stubborn finding falls back to the
  // current script, so the lint can never block a valid tour.
  // Breaks are excluded from the diversity lint — short generic cues, and the kit
  // detector's /coffee/ would misfire on a café break inviting a coffee.
  const lintInputs = () =>
    narratedRecs
      .filter((r) => r.s.stopType !== 'break')
      .map((r) => ({ seq: r.s.seq, stopType: r.s.stopType, script: r.script }))
  const regenForFindings = async (findings: LintFinding[]) => {
    for (const f of findings) {
      const rec = narratedRecs.find((r) => r.s.seq === f.seq)
      if (!rec) continue
      console.log(`  regen stop ${f.seq} (${rec.s.name}): ${f.reasons.join('; ')}`)
      const others = narratedRecs.filter((r) => r.s.seq !== f.seq)
      try {
        const { script } = await narrateStop({
          ...baseReq(rec.s),
          recentOpeners: others.map((r) => openerOf(r.script)),
          recentClosers: others.map((r) => closerOf(r.script)),
          recentKitBeats: [
            ...new Set(
              others.filter((r) => r.s.stopType !== 'break').flatMap((r) => kitBeatsOf(r.script)),
            ),
          ],
          avoid: f.avoid,
        })
        // Accept the regen ONLY if it doesn't INCREASE this stop's deterministic lint
        // findings. A later round or the closer-judge pass must never trade one tic for
        // another (observed: a closer-fix regen reintroducing a banned wind-up). This
        // makes "kept best available" actually keep the cleaner take, not just the latest.
        const inputs = lintInputs()
        const before = lintScripts(inputs).filter((x) => x.seq === rec.s.seq).length
        const candidate = inputs.map((r) => (r.seq === rec.s.seq ? { ...r, script } : r))
        const after = lintScripts(candidate).filter((x) => x.seq === rec.s.seq).length
        if (after <= before) rec.script = script
        else
          console.warn(
            `  stop ${f.seq} regen would add findings (${before}→${after}) — keeping previous take.`,
          )
      } catch (e) {
        console.warn(`  stop ${f.seq} regen failed (${(e as Error).message}) — keeping original.`)
      }
    }
  }

  // 4 rounds (was 2): long-form stops surface more per-stop findings (tic-stacking,
  // list shape, tidy bows) that can take extra regens to fully clear, and the
  // accept-only-if-not-worse guard above can hold a take across a round. Still cheap
  // (Anthropic only, no TTS) and each round is a no-op once the lint comes back clean.
  const LINT_ROUNDS = 4
  for (let round = 0; round < LINT_ROUNDS; round++) {
    const findings = lintScripts(lintInputs())
    if (findings.length === 0) break
    console.log(`Diversity lint (round ${round + 1}): ${findings.length} stop(s) flagged.`)
    await regenForFindings(findings)
  }

  // Optional semantic-closer judge (one extra model call): catches closing-move
  // monotony the deterministic lint can't see — e.g. several stops personifying the
  // place in different words. Best-effort (a judge error never blocks the tour);
  // any regen it triggers is re-checked by one more deterministic lint pass.
  if (judgeClosers) {
    try {
      const judged = await judgeCloserDiversity(
        narratedRecs.map((r) => ({ seq: r.s.seq, script: r.script })),
      )
      if (judged.length > 0) {
        console.log(`Closer judge: ${judged.length} stop(s) flagged for closing-move monotony.`)
        await regenForFindings(judged)
        const after = lintScripts(lintInputs())
        if (after.length > 0) await regenForFindings(after)
      } else {
        console.log('Closer judge: closers are varied.')
      }
    } catch (e) {
      console.warn(`Closer judge skipped (${(e as Error).message}).`)
    }
  }
  const stillFlagged = lintScripts(lintInputs())
  console.log(
    stillFlagged.length === 0
      ? 'Diversity lint: clean.'
      : `Diversity lint: ${stillFlagged.length} finding(s) remain after ${LINT_ROUNDS} rounds (kept best available).`,
  )
  const scriptBySeq = new Map(narratedRecs.map((r) => [r.s.seq, r.script]))

  // ---- Dry run: print finalized scripts, no writes. -----------------------
  if (dryRun) {
    // Every stop now has a script (breaks included) — print them all so the named
    // break narration can be eyeballed before any TTS spend.
    const stops: StopSummary[] = plan.map((s) => ({
      seq: s.seq,
      stopType: s.stopType,
      name: s.name,
      alongSec: s.alongSec,
      ...(s.sideOfRoad ? { sideOfRoad: s.sideOfRoad } : {}),
      script: scriptBySeq.get(s.seq),
      // STORY carries the exact (deepened) fact sheet so the dry-run artifact can be
      // audited script-vs-sheet; SCENIC/BREAK have no facts by construction.
      ...(s.stopType === 'story' ? { facts: s.facts } : {}),
    }))
    return {
      corridor: corridor.name,
      region: corridor.region,
      durationBucket,
      totalSec,
      dryRun: true,
      stops,
    }
  }

  // ---- Full run: narrate -> TTS -> R2 -> persist -> atomic ready-gate. -----
  const tourId = await createTour({
    corridorId: corridor.id,
    durationBucket,
    persona,
    jokeLevel,
    isPreview: Boolean(opts.preview),
  })
  try {
    const finalStops: FinalStop[] = []
    const summaries: StopSummary[] = []

    for (const s of plan) {
      // Every stop anchors to a POI (break stops included).
      const poiId = await upsertPoi({
        source: s.source,
        sourceId: s.sourceId,
        name: s.name,
        kind: s.kind,
        lat: s.lat,
        lng: s.lng,
        summary: s.stopType === 'story' ? firstSentence(s.facts) : null,
        facts:
          s.stopType === 'story'
            ? {
                extract: s.facts.join(' '),
                title: s.wikiTitle,
                url: s.wikiUrl,
                pageId: s.wikiPageId,
              }
            : null,
      })

      // Every stop — break included — now narrates + synthesizes. (Break clips name
      // the curated Places anchor; no Wikipedia text, so no attribution snapshot.)
      const script = scriptBySeq.get(s.seq)!
      console.log(`Synthesizing stop ${s.seq} (${s.stopType}) "${s.name}"...`)
      const { audio, durationMs } = await synthesize(script, voice)
      const audioUrl = await uploadAudio(clipKey(poiId, persona, voice, jokeLevel), audio)

      // CC BY-SA attribution is required for story clips (they reuse extract text).
      // Scenic + break clips reuse no Wikipedia text, so no attribution is snapshotted.
      const attribution: AttributionSnapshot | null =
        s.stopType === 'story'
          ? {
              source: 'wikipedia',
              sourceId: String(s.wikiPageId),
              title: s.wikiTitle,
              url: s.wikiUrl,
              license: 'CC BY-SA 4.0',
              retrievedAt: new Date().toISOString(),
            }
          : null

      const poiContentId = await upsertPoiContent({
        poiId,
        persona,
        voice,
        jokeLevel,
        script,
        audioUrl,
        audioDurationMs: durationMs,
        attribution,
      })

      finalStops.push({
        seq: s.seq,
        poiId,
        poiContentId,
        stopType: s.stopType,
        triggerRadiusM: s.triggerRadiusM,
        triggerLat: s.triggerLat,
        triggerLng: s.triggerLng,
        approachHeadingDeg: s.approachHeadingDeg,
      })
      summaries.push({
        seq: s.seq,
        stopType: s.stopType,
        name: s.name,
        alongSec: s.alongSec,
        ...(s.sideOfRoad ? { sideOfRoad: s.sideOfRoad } : {}),
        script,
        // Carry the STORY fact sheet so the SERVED tour's scripts can be audited
        // (grounding) straight from the result JSON, same as the dry-run artifact.
        ...(s.stopType === 'story' ? { facts: s.facts } : {}),
        durationMs,
        audioUrl,
      })
    }

    // Ready-gate guard: EVERY stop must have audio before we flip — breaks included
    // (break audio is now mandatory; a tour never goes ready with a silent stop).
    for (const fs of finalStops) {
      if (!fs.poiContentId) {
        throw new Error(
          `Stop ${fs.seq} (${fs.stopType}) has no audio — refusing to mark tour ready.`,
        )
      }
    }

    await finalizeTourReady(tourId, finalStops)
    console.log(`Tour ${tourId} is READY (${finalStops.length} stops).`)
    return {
      tourId,
      corridor: corridor.name,
      region: corridor.region,
      durationBucket,
      totalSec,
      dryRun: false,
      stops: summaries,
    }
  } catch (e) {
    await markTourFailed(tourId).catch(() => {})
    throw e
  }
}
