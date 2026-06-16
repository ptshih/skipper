// generate-roam — FREE-ROAM encounter generation: narrate + synthesize the POI corpus.
// SPENDS $ (Anthropic narration + Cloud TTS) and MUTATES DB + R2 on --apply.
//
// Free-roam (docs/ideas/free-roam-mode.md) is the THIRD narration owner: pois = shared
// FACTS, a tour's segment+track = a tour's telling, a ROAM segment (tour_id null) + its
// track = the ROAM telling — one per POI in v0, regenerated when the place's facts_hash
// moves (the same staleness contract as a tour stop). Encounters are a new FORM, not a new
// persona: the Skipper's stop prompt rides unchanged; the sheet adds the FREE-ROAM ENCOUNTER
// frame (self-contained, route-agnostic, no baked laterality — narrate.ts), targets ~60s,
// and threads no callbacks. A roam segment is placeless-of-route: tour_id null, seq null,
// trigger* null (an un-snapped centroid); its single track is form='story', variant 0.
//
// ALPHA CUTS (deliberate, founder-eared instead): no eval panel / grounding audit pass,
// no diversity lint across clips (encounters play minutes apart on different drives) —
// the two cheap guards that DO run are the kit ban and the no-laterality rule (each gets
// ONE retake with an avoid note, then ships with a loud warn).
//
// SOP (docs/guides/ops-scripts-sop.md): PREVIEWS (with a cost estimate) by default;
// narrates/synthesizes/writes only on --apply.
//
// Usage:
//   dotenvx run -f .env.development -- bun packages/generator/src/generate-roam.ts
//   ... --apply                 run it (spends; writes pois facts, R2 clips, segments/tracks)
//   ... --apply --limit 3      smoke run (the cheapest real ear-test)
//   ... --force                regenerate even clips whose facts_hash is still fresh
//   ... --min-extract 800     story-depth floor (full-article chars; default STORY_MIN_EXTRACT)
//   ... --bbox swLng,swLat,neLng,neLat   constrain the corpus geographically

import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import { pois, segments, tracks } from '@skipper/db/schema'
import type { FactSheetEntry, PoiFacts } from '@skipper/db/schema'
import { announce, assertReady, parseFlags } from './pipeline/ops'
import { beginJob, finishJob } from './pipeline/job-progress'
import { ensurePoiOverridesLoaded } from './pipeline/poi-overrides'
import { narrateStop } from './pipeline/narrate'
import { resolveStoryGrounding } from './pipeline/select'
import { synthesizeWithTailRetake } from './pipeline/tts'
import { roamClipKey, uploadAudio } from './pipeline/storage'
import { resolvePersonaId, storyFactsHash } from './pipeline/persist'
import { withRetry } from './pipeline/http'
import { mapLimit } from './pipeline/concurrency'
import { personaFromKey } from './persona'
import { NARRATION_CONCURRENCY, NARRATION_FALLBACK_CHARS, TTS_CONCURRENCY } from './config'
import { estimateTtsUsd, llmSpendLines, llmSpentUsd } from './pipeline/spend'
import { STORY_MIN_EXTRACT, STORY_TASTE_DENYLIST } from '@skipper/shared'

/** Roam encounter length band + eligibility (Autio-register long-form, founder 2026-06-13).
 *  storyTargetSeconds = the AIM; storyMaxSeconds = a HARD cap so a fact-rich place doesn't sprawl
 *  into a lecture. "Never pad past the facts" governs the ACTUAL length WITHIN the band, so a thin
 *  pin lands honestly shorter (capped by its facts) rather than stretched. minExtractStory is the
 *  eligibility floor for a long-form STORY — a pin below it is WAVE-eligible (the 10–20s locked
 *  pass-2 form); until that form ships, the floor simply excludes thin articles (the `--min-extract`
 *  flag overrides). NOTE: an UN-enriched poi grounds on the FULL Wikipedia article from the corpus
 *  (deepened at sweep time to ENRICHER_INPUT_CHARS, then capped at read time to NARRATION_FALLBACK_CHARS);
 *  an ENRICHED poi grounds on its curated well instead (resolveStoryGrounding). */
const ROAM_LENGTH = {
  storyTargetSeconds: 150,
  storyMaxSeconds: 180,
  minExtractStory: STORY_MIN_EXTRACT, // single-sourced in @skipper/shared (admin table reads it too)
} as const
/** Default corpus bbox — Tahoe–Reno corridor (matches sweep-region-pois.ts). */
const DEFAULT_BBOX = { swLng: -120.25, swLat: 38.86, neLng: -119.55, neLat: 39.65 }

/** Rough sub-region label for the narrative context: tells the model where the driver IS. */
function regionLabel(lat: number, lng: number): string {
  if (lat > 39.35 && lng > -119.9) return 'Reno, Nevada'
  if (lat > 39.0 && lng > -119.85) return 'Carson City, Nevada'
  return 'Lake Tahoe'
}

const flags = parseFlags(process.argv.slice(2), { valueFlags: ['limit', 'min-extract', 'bbox', 'max-cost'] })
const apply = flags.has('apply')
const maxCostUsd = (() => {
  const v = Number(flags.value('max-cost'))
  return Number.isFinite(v) && v > 0 ? v : Infinity // unset/invalid → no cap
})()
// Narrate + PRINT the scripts, then stop — NO TTS, NO R2, NO DB writes. The cheapest way to ear-read
// the writing (e.g. a new length band) before committing to a paid synth + regen. Spends narration $.
const scriptsOnly = flags.has('scripts-only')
const force = flags.has('force')
const limit = Number(flags.value('limit') ?? Infinity)
const minExtract = Number(flags.value('min-extract') ?? ROAM_LENGTH.minExtractStory)
const bboxRaw = flags.value('bbox')
const bbox = (() => {
  if (!bboxRaw) return DEFAULT_BBOX
  const p = bboxRaw.split(',').map(Number)
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n)))
    throw new Error(`--bbox must be swLng,swLat,neLng,neLat (got "${bboxRaw}")`)
  return { swLng: p[0]!, swLat: p[1]!, neLng: p[2]!, neLat: p[3]! }
})()

announce({
  tool: 'generate-roam',
  blast: scriptsOnly ? ['SPENDS $'] : ['SPENDS $', 'MUTATES DB'],
  apply: apply || scriptsOnly, // scripts-only spends narration $, so it's not a free dry run
})
if (apply) assertReady(['tts', 'r2']) // scripts-only needs neither TTS nor R2

async function main(): Promise<void> {
  await ensurePoiOverridesLoaded()

  // ── Candidate corpus: wikipedia-sourced pois with story-grade extracts, in the bbox ──
  // The ROAM telling for a poi is its segment(tour_id null) + that segment's story track —
  // left-joined so a poi with no roam clip yet still appears (and queues).
  const rows = await withRetry(
    () =>
      db
        .select({
          id: pois.id,
          sourceId: pois.sourceId,
          name: pois.name,
          kind: pois.kind,
          lat: pois.lat,
          lng: pois.lng,
          facts: pois.facts,
          factsHash: pois.factsHash,
          factsFetchedAt: pois.factsFetchedAt,
          factSheet: pois.factSheet,
          enrichedAt: pois.enrichedAt,
          segmentId: segments.id,
          trackId: tracks.id,
          clipFactsHash: tracks.factsHash,
        })
        .from(pois)
        .leftJoin(segments, and(eq(segments.poiId, pois.id), isNull(segments.tourId)))
        .leftJoin(
          tracks,
          and(eq(tracks.segmentId, segments.id), eq(tracks.form, 'story'), eq(tracks.variant, 0)),
        )
        .where(
          and(
            eq(pois.source, 'wikipedia'),
            sql`${pois.lat} between ${bbox.swLat} and ${bbox.neLat}`,
            sql`${pois.lng} between ${bbox.swLng} and ${bbox.neLng}`,
          ),
        ),
    { label: 'load roam corpus' },
  )

  interface Candidate {
    poiId: string
    pageId: number
    name: string
    kind: string | null
    lat: number
    lng: number
    extract: string
    /** The poi's full facts object — the source for the well↔extract-head grounding switch + the
     *  grounding fingerprint (resolveStoryGrounding / storyFactsHash), shared with tours. */
    facts: PoiFacts
    title: string
    url: string
    /** Wikidata qid from the sweep's facts — preserved through the deepen re-upsert so the
     *  region-corpus contract (it rebuilds tour candidates from facts.qid) isn't broken. */
    qid: string | null
    factsFetchedAt: Date | null
    /** The poi's curated fact sheet + its enrich stamp (own columns) — grounding source + fingerprint. */
    factSheet: FactSheetEntry[] | null
    enrichedAt: Date | null
    /** The poi's existing roam segment id (tour_id null), if any — reused so a regen keeps one
     *  roam segment per poi (the track is upserted on (segment, form, variant)). */
    segmentId: string | null
    hasFreshClip: boolean
  }

  const candidates: Candidate[] = []
  for (const r of rows) {
    const extract = typeof r.facts?.extract === 'string' ? (r.facts.extract as string) : ''
    if (extract.length < minExtract) continue
    if (STORY_TASTE_DENYLIST.test(r.name)) {
      console.log(`  taste-gate: skipping "${r.name}"`)
      continue
    }
    const f = r.facts as { title?: string; url?: string; pageId?: number; qid?: string } | null
    candidates.push({
      poiId: r.id,
      pageId: f?.pageId ?? Number(r.sourceId),
      name: r.name,
      kind: r.kind,
      lat: r.lat,
      lng: r.lng,
      extract,
      facts: (r.facts ?? {}) as PoiFacts,
      title: f?.title ?? r.name,
      url: f?.url ?? `https://en.wikipedia.org/?curid=${r.sourceId}`,
      qid: f?.qid ?? null,
      factsFetchedAt: r.factsFetchedAt,
      factSheet: r.factSheet,
      enrichedAt: r.enrichedAt,
      segmentId: r.segmentId,
      // Fresh = a track exists AND grounds on the poi's CURRENT facts → skip unless --force.
      hasFreshClip: r.trackId !== null && r.clipFactsHash === r.factsHash && r.factsHash !== null,
    })
  }

  const skipped = candidates.filter((c) => c.hasFreshClip && !force)
  const queue = candidates.filter((c) => !c.hasFreshClip || force).slice(0, limit)

  console.log(
    `Corpus: ${candidates.length} story-grade pois in bbox (≥${minExtract} chars) — ` +
      `${skipped.length} already have fresh roam clips (skipped), ${queue.length} to generate.\n`,
  )
  for (const c of queue) console.log(`  ${String(c.extract.length).padStart(5)}  ${c.name}`)

  if (queue.length === 0) {
    console.log('Nothing to generate.')
    return
  }

  // Cost preview: narration ≈ system+sheet in / ~1k thinking+output out per clip (Opus 4.8
  // $5/$25 per MTok → very roughly $0.03–0.08 per clip), TTS estimated exactly by chars.
  const estClipChars = 800 // ~150 spoken words
  const tts = estimateTtsUsd(
    queue.map(() => 'x'.repeat(estClipChars)),
    personaFromKey('skipper').ttsStyle.length,
  )
  console.log(
    `\nEstimated spend: narration ~$${(queue.length * 0.1).toFixed(2)} ± half ` +
      `+ TTS ~$${tts.usd.toFixed(2)} (${queue.length} clips ≈ ${Math.round((queue.length * ROAM_LENGTH.storyTargetSeconds) / 60)} min of audio)`,
  )

  if (!apply && !scriptsOnly) {
    console.log(
      '\nDRY RUN — nothing narrated, synthesized, or written. Re-run with --apply (or --scripts-only to narrate + print, no TTS/DB).',
    )
    return
  }

  // Cost ceiling: abort BEFORE any narration/TTS if the estimate exceeds --max-cost. A roam run
  // covers a whole corpus, so an unbounded run (no --limit) can balloon — this is the hard stop.
  const estSpendUsd = (scriptsOnly ? 0 : tts.usd) + queue.length * 0.1
  if (estSpendUsd > maxCostUsd) {
    console.error(
      `⛔ Estimated spend ~$${estSpendUsd.toFixed(2)} exceeds --max-cost=$${maxCostUsd.toFixed(2)} — aborting before any spend. Narrow with --limit or raise --max-cost.`,
    )
    return
  }

  const persona = personaFromKey('skipper')
  // The frozen host on every roam segment this run writes.
  const personaId = await resolvePersonaId(persona.personaKey)

  // Facts are ALREADY the full article — the region sweep deepens at discovery time (the corpus is
  // the single fetch point, the "real step 1"), so roam narrates on the stored extract with NO
  // per-run re-fetch and NO fact mutation. (Override-freshness now lands via a re-sweep / refetch_facts,
  // not a per-run fetch.) `c.extract` carries the full article from the corpus query above.

  // ── Narrate (parallel, blind drafts) with the two cheap guards ──
  const LATERALITY =
    /\b(?:on|to|off to) (?:your|the) (?:left|right)\b|\b(?:left|right)(?:-hand)? side\b/i

  async function narrateEncounter(c: Candidate): Promise<string> {
    // Ground on the curated WELL when the place is enriched, else the positional extract head (the
    // un-enriched fallback — byte-for-byte today's behavior for existing 4k rows, a strict verbatim
    // superset once re-swept to 12k). Same resolver tours use.
    const grounding = resolveStoryGrounding(c.facts, c.factSheet, c.enrichedAt, {
      fallbackChars: NARRATION_FALLBACK_CHARS,
      retrievedAt: (c.factsFetchedAt ?? new Date()).toISOString(),
    })
    const base = {
      region: regionLabel(c.lat, c.lng),
      corridor: 'Free roam — an unplanned drive, no route',
      stopType: 'story' as const,
      jokeLevel: 'dadpocalypse' as const,
      place: { name: c.name, ...(c.kind ? { kind: c.kind } : {}) },
      facts: grounding.facts,
      targetSeconds: ROAM_LENGTH.storyTargetSeconds,
      maxSeconds: ROAM_LENGTH.storyMaxSeconds,
      encounterFrame: true,
    }
    let { script } = await narrateStop(base, persona.systemPrompt)
    const avoid: string[] = []
    if (LATERALITY.test(script))
      avoid.push(
        'Do NOT name a side of the road (no "on your left/right") — the direction of travel is unknown on a free-roam drive; say "just out there" or "right about here" instead.',
      )
    const kitHits = persona.kit.beats.filter((b) => b.match.test(script))
    if (kitHits.length > 0) avoid.push(persona.kit.dropNote)
    if (avoid.length > 0) {
      console.log(
        `  retake (${c.name}): ${kitHits.length > 0 ? 'kit ' : ''}${LATERALITY.test(script) ? 'laterality' : ''}`,
      )
      ;({ script } = await narrateStop({ ...base, avoid }, persona.systemPrompt))
      if (LATERALITY.test(script) || persona.kit.beats.some((b) => b.match.test(script)))
        console.warn(
          `  ⚠ ${c.name}: guard still dirty after one retake — ships for the founder ear.`,
        )
    }
    return script
  }

  console.log(`\nNarrating ${queue.length} encounters (concurrency ${NARRATION_CONCURRENCY()})...`)
  let done = 0
  const scripts = await mapLimit(queue, NARRATION_CONCURRENCY(), async (c) => {
    const script = await narrateEncounter(c)
    done++
    console.log(`  [${done}/${queue.length}] ${c.name} (${script.split(/\s+/).length} words)`)
    return script
  })

  if (scriptsOnly) {
    const WORDS_PER_SECOND = 2.5 // display estimate; mirrors narrate.ts (the target the model wrote to)
    console.log('\n════════ SCRIPTS — scripts-only: no TTS, no R2, no DB writes ════════')
    queue.forEach((c, i) => {
      const script = scripts[i]!
      const words = script.trim().split(/\s+/).filter(Boolean).length
      console.log(
        `\n──── ${c.name} · ${words} words ≈ ${Math.round(words / WORDS_PER_SECOND)}s · ${c.extract.length} chars source ────\n${script}`,
      )
    })
    console.log(
      `\n(band: aim ${ROAM_LENGTH.storyTargetSeconds}s, cap ${ROAM_LENGTH.storyMaxSeconds}s)`,
    )
    return
  }

  // ── Synthesize + upload + upsert rows (a row only lands COMPLETE) ──
  console.log(`\nSynthesizing ${queue.length} clips (concurrency ${TTS_CONCURRENCY()})...`)
  let synthDone = 0
  const results = await mapLimit(queue, TTS_CONCURRENCY(), async (c, i) => {
    const script = scripts[i]!
    // Reuse the poi's existing roam segment (one per poi); mint one on first generation.
    const segmentId = c.segmentId ?? crypto.randomUUID()
    const trackId = crypto.randomUUID()
    // Tail-collapse retake (pipeline/tts.ts): roam clips ship unheard, so a mumbled
    // closing sentence would reach riders' ears first — measure + retake here too.
    const { audio, durationMs } = await synthesizeWithTailRetake(
      script,
      persona.voice,
      persona.ttsStyle,
      `"${c.title}"`,
    )
    const audioUrl = await uploadAudio(roamClipKey(c.poiId, trackId), audio)
    // Well-aware credit: an ENRICHED poi credits the well's distinct sources (wikipedia + any
    // geology/wikidata kept); an un-enriched poi credits the single Wikipedia article (the
    // extract-head fallback). Same resolver tours use, so attribution can't drift between them.
    const { attribution } = resolveStoryGrounding(c.facts, c.factSheet, c.enrichedAt, {
      fallbackChars: NARRATION_FALLBACK_CHARS,
      retrievedAt: (c.factsFetchedAt ?? new Date()).toISOString(),
    })
    // The grounding fingerprint = pois.factsHash exactly (storyFactsHash on the SAME facts the
    // freshness query read), so a freshly-generated clip never reads as stale.
    const factsHash = storyFactsHash(c.facts, c.factSheet)
    // A roam telling = a placeless-of-route segment (tour_id/seq/trigger* null) + ONE story
    // track. Co-commit the segment + the track upsert: the segment is insert-or-keep (PK id;
    // a reused segment already exists), the track upserts on its (segment, form, variant)
    // unique so a regen replaces the same row's script/audio in place.
    await withRetry(
      () =>
        db.batch([
          db
            .insert(segments)
            .values({ id: segmentId, poiId: c.poiId, personaId })
            .onConflictDoNothing({ target: segments.id }),
          db
            .insert(tracks)
            .values({
              id: trackId,
              segmentId,
              form: 'story',
              variant: 0,
              script,
              audioUrl,
              audioDurationMs: durationMs,
              attribution,
              factsHash,
            })
            .onConflictDoUpdate({
              target: [tracks.segmentId, tracks.form, tracks.variant],
              set: {
                script,
                audioUrl,
                audioDurationMs: durationMs,
                attribution,
                factsHash,
                updatedAt: new Date(),
              },
            }),
        ]),
      { label: `upsert roam track(${c.name})` },
    )
    synthDone++
    console.log(`  [${synthDone}/${queue.length}] ${c.name} (${(durationMs / 1000).toFixed(0)}s)`)
    return { name: c.name, durationMs }
  })

  const totalSec = results.reduce((a, r) => a + r.durationMs, 0) / 1000
  console.log(
    `\nDone: ${results.length} roam clips, ${(totalSec / 60).toFixed(1)} min of audio total ` +
      `(avg ${(totalSec / results.length).toFixed(0)}s).`,
  )
  for (const line of llmSpendLines()) console.log(line)
  console.log(`LLM spend this run: ~$${llmSpentUsd().toFixed(2)}`)
  const ttsActual = estimateTtsUsd(scripts, persona.ttsStyle.length)
  console.log(`TTS spend (estimated from chars): ~$${ttsActual.usd.toFixed(2)}`)
}

await beginJob('generate_roam', { dryRun: !apply && !scriptsOnly, targetId: 'roam-corpus' })
try {
  await main()
  await finishJob({ ok: true })
} catch (e) {
  await finishJob({ ok: false, error: e instanceof Error ? e.message : String(e) })
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
}
