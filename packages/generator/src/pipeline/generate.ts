// The M1 generator pipeline — assemble ONE tour for ONE corridor.
//
//   corridor (DB)
//     -> Wikipedia geosearch + extracts      (grounded story facts)
//     -> Google Places searchAlongRoute       (food/rest BREAK anchors)
//     -> select stops by drive TIME           (pace, not distance)
//     -> Skipper narration (Anthropic)        (facts-only; story + scenic)
//     -> TTS (ElevenLabs) -> R2               (audio + duration)
//     -> tours + ordered tour_stops (Neon)    (atomic ready-gate)
//
// Invariants honored here:
//   - Persona lives in delivery, never in facts: only story stops get a fact
//     sheet; scenic/break stops carry no place-facts.
//   - Story attribution (CC BY-SA) is snapshotted on every story clip.
//   - Only break stops carry no audio (poiContentId null); story + scenic each
//     get a poi_content row with non-null audio.
//   - A tour reaches `ready` only via the atomic batch, after every story/scenic
//     stop has audio.
// M1 scope: no cache reuse, no dedup beyond the (source,source_id) upsert, no
// feedback. Break stops are silent location anchors (live data + narration = M3).

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
import { discoverWikipediaPois } from './wikipedia'
import { searchBreakStops } from './places'
import type { BreakAnchor } from './places'
import { selectStops } from './select'
import type { StopPlan } from './select'
import { narrateStop } from './narrate'
import type { NarrationRequest } from './narrate'
import { lintScripts } from './lint'
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
}

export interface StopSummary {
  seq: number
  stopType: StopPlan['stopType']
  name: string
  alongSec: number
  script?: string
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
      breakAnchors = await searchBreakStops(encodePolyline(polyline), requireEnv('GOOGLE_MAPS_API_KEY'))
      console.log(`Found ${breakAnchors.length} break-stop anchors.`)
    } catch (e) {
      console.warn(`Break-stop search failed (continuing without breaks): ${(e as Error).message}`)
    }
  } else {
    console.warn('GOOGLE_MAPS_API_KEY not set — skipping break stops.')
  }

  // 4. Select + time-pace stops.
  const plan = selectStops({ polyline, totalSec, wikiPois, breakAnchors, pacing: PACING[durationBucket] })
  const narratedCount = plan.filter((s) => s.stopType !== 'break').length
  if (narratedCount === 0) throw new Error(`No narratable stops found for "${opts.slug}".`)
  console.log(
    `Planned ${plan.length} stops: ${plan.filter((s) => s.stopType === 'story').length} story, ` +
      `${plan.filter((s) => s.stopType === 'scenic').length} scenic, ` +
      `${plan.filter((s) => s.stopType === 'break').length} break.`,
  )

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
  const kitBeatsOf = (script: string) => KIT_BEATS.filter(([re]) => re.test(script)).map(([, label]) => label)
  const baseReq = (s: StopPlan): NarrationRequest => ({
    region: corridor.region,
    corridor: corridor.name,
    stopType: s.stopType,
    jokeLevel,
    targetSeconds: s.targetSeconds,
    ...(s.stopType === 'story' ? { place: { name: s.name, kind: s.kind }, facts: s.facts } : {}),
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
    priorStops.push(s.stopType === 'story' ? s.name : 'a quiet stretch')
    recentOpeners.push(openerOf(script))
    recentClosers.push(closerOf(script))
    recentKit.push(kitBeatsOf(script))
  }

  // Narrate every story/scenic stop up front — cheap (no TTS yet), so the lint can
  // see the whole tour and regenerate outliers BEFORE we pay to synthesize.
  const narratedRecs: { s: StopPlan; script: string }[] = []
  for (const s of plan) {
    if (s.stopType === 'break') continue
    console.log(`Narrating stop ${s.seq} (${s.stopType}) "${s.name}"...`)
    const { script } = await narrate(s)
    rememberStop(s, script)
    narratedRecs.push({ s, script })
  }

  // Post-assembly diversity lint: regenerate cross-stop outliers (Anthropic only,
  // still no TTS). Each flagged stop is re-narrated with the lint's `avoid` notes
  // plus FULL awareness of every OTHER stop's opener/closer/kit (not just the
  // trailing-3 window). Bounded rounds; a regen failure or a stubborn finding
  // falls back to the current script, so the lint can never block a valid tour.
  const LINT_ROUNDS = 2
  const lintInputs = () => narratedRecs.map((r) => ({ seq: r.s.seq, stopType: r.s.stopType, script: r.script }))
  for (let round = 0; round < LINT_ROUNDS; round++) {
    const findings = lintScripts(lintInputs())
    if (findings.length === 0) break
    console.log(`Diversity lint (round ${round + 1}): ${findings.length} stop(s) flagged.`)
    for (const f of findings) {
      const rec = narratedRecs.find((r) => r.s.seq === f.seq)!
      console.log(`  regen stop ${f.seq} (${rec.s.name}): ${f.reasons.join('; ')}`)
      const others = narratedRecs.filter((r) => r.s.seq !== f.seq)
      try {
        const { script } = await narrateStop({
          ...baseReq(rec.s),
          recentOpeners: others.map((r) => openerOf(r.script)),
          recentClosers: others.map((r) => closerOf(r.script)),
          recentKitBeats: [...new Set(others.flatMap((r) => kitBeatsOf(r.script)))],
          avoid: f.avoid,
        })
        rec.script = script
      } catch (e) {
        console.warn(`  stop ${f.seq} regen failed (${(e as Error).message}) — keeping original.`)
      }
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
    const stops: StopSummary[] = plan.map((s) =>
      s.stopType === 'break'
        ? { seq: s.seq, stopType: s.stopType, name: s.name, alongSec: s.alongSec }
        : { seq: s.seq, stopType: s.stopType, name: s.name, alongSec: s.alongSec, script: scriptBySeq.get(s.seq) },
    )
    return { corridor: corridor.name, region: corridor.region, durationBucket, totalSec, dryRun: true, stops }
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
            ? { extract: s.facts.join(' '), title: s.wikiTitle, url: s.wikiUrl, pageId: s.wikiPageId }
            : null,
      })

      if (s.stopType === 'break') {
        // M1: break stops are silent anchors — no content, no audio.
        finalStops.push({ seq: s.seq, poiId, poiContentId: null, stopType: 'break', triggerRadiusM: s.triggerRadiusM })
        summaries.push({ seq: s.seq, stopType: s.stopType, name: s.name, alongSec: s.alongSec })
        continue
      }

      const script = scriptBySeq.get(s.seq)!
      console.log(`Synthesizing stop ${s.seq} (${s.stopType}) "${s.name}"...`)
      const { audio, durationMs } = await synthesize(script, voice)
      const audioUrl = await uploadAudio(clipKey(poiId, persona, voice, jokeLevel), audio)

      // CC BY-SA attribution is required for story clips (they reuse extract text).
      // Scenic clips reuse no Wikipedia text, so no attribution is snapshotted.
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

      finalStops.push({ seq: s.seq, poiId, poiContentId, stopType: s.stopType, triggerRadiusM: s.triggerRadiusM })
      summaries.push({ seq: s.seq, stopType: s.stopType, name: s.name, alongSec: s.alongSec, script, durationMs, audioUrl })
    }

    // Ready-gate guard: every story/scenic stop must have audio before we flip.
    for (const fs of finalStops) {
      if (fs.stopType !== 'break' && !fs.poiContentId) {
        throw new Error(`Stop ${fs.seq} (${fs.stopType}) has no audio — refusing to mark tour ready.`)
      }
    }

    await finalizeTourReady(tourId, finalStops)
    console.log(`Tour ${tourId} is READY (${finalStops.length} stops).`)
    return { tourId, corridor: corridor.name, region: corridor.region, durationBucket, totalSec, dryRun: false, stops: summaries }
  } catch (e) {
    await markTourFailed(tourId).catch(() => {})
    throw e
  }
}
