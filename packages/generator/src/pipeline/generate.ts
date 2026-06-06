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
  ELEVENLABS_READY,
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
    if (!ELEVENLABS_READY()) throw new Error('ELEVENLABS_API_KEY is not set (needed for TTS; use --dry-run to skip).')
    if (!R2_READY()) {
      throw new Error('R2_* env (ACCOUNT_ID, ACCESS_KEY_ID, SECRET_ACCESS_KEY, BUCKET, PUBLIC_BASE_URL) is not set.')
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

  const priorStops: string[] = []
  const narrate = (s: StopPlan) =>
    narrateStop({
      region: corridor.region,
      corridor: corridor.name,
      stopType: s.stopType,
      jokeLevel,
      targetSeconds: s.targetSeconds,
      priorStops: priorStops.slice(-3),
      ...(s.stopType === 'story' ? { place: { name: s.name, kind: s.kind }, facts: s.facts } : {}),
    })
  const rememberStop = (s: StopPlan) => priorStops.push(s.stopType === 'story' ? s.name : 'a quiet stretch')

  // ---- Dry run: narrate story/scenic, print, no writes. -------------------
  if (dryRun) {
    const stops: StopSummary[] = []
    for (const s of plan) {
      if (s.stopType === 'break') {
        stops.push({ seq: s.seq, stopType: s.stopType, name: s.name, alongSec: s.alongSec })
        continue
      }
      console.log(`Narrating stop ${s.seq} (${s.stopType}) "${s.name}"...`)
      const { script } = await narrate(s)
      rememberStop(s)
      stops.push({ seq: s.seq, stopType: s.stopType, name: s.name, alongSec: s.alongSec, script })
    }
    return { corridor: corridor.name, region: corridor.region, durationBucket, totalSec, dryRun: true, stops }
  }

  // ---- Full run: narrate -> TTS -> R2 -> persist -> atomic ready-gate. -----
  const tourId = await createTour({ corridorId: corridor.id, durationBucket, persona, jokeLevel })
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

      console.log(`Narrating + synthesizing stop ${s.seq} (${s.stopType}) "${s.name}"...`)
      const { script } = await narrate(s)
      rememberStop(s)

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
