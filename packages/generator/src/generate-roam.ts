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
//   ... --apply                 run it (spends; writes pois facts, R2 clips, roam_clips)
//   ... --apply --limit 3      smoke run (the cheapest real ear-test)
//   ... --force                regenerate even clips whose facts_hash is still fresh
//   ... --min-extract 400     story-depth floor (lead-extract chars)
//   ... --bbox swLng,swLat,neLng,neLat   constrain the corpus geographically

import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import { pois, segments, tracks } from '@skipper/db/schema'
import type { AttributionSnapshot } from '@skipper/db/schema'
import { announce, assertReady, parseFlags } from './pipeline/ops'
import { ensurePoiOverridesLoaded } from './pipeline/poi-overrides'
import { fetchDeepExtracts } from './pipeline/wikipedia'
import { narrateStop } from './pipeline/narrate'
import { toFacts } from './pipeline/select'
import { synthesizeWithTailRetake } from './pipeline/tts'
import { roamClipKey, uploadAudio } from './pipeline/storage'
import { hashFacts, resolvePersonaId, upsertPoi } from './pipeline/persist'
import { withRetry } from './pipeline/http'
import { mapLimit } from './pipeline/concurrency'
import { personaFromKey } from './persona'
import { NARRATION_CONCURRENCY, TTS_CONCURRENCY } from './config'
import { estimateTtsUsd, llmSpendLines, llmSpentUsd } from './pipeline/spend'

const ROAM_TARGET_SECONDS = 60
/** TASTE gate: articles about violent crime / personal tragedy are never roadside
 *  encounters — a joke-forward persona cannot carry them (the sweep is breadth-first, so
 *  these slip in; the Jaycee Dugard kidnapping article surfaced on the first basin run).
 *  Historical/civic tragedy (a wildfire, a shipwreck) stays — the prompt can play those
 *  straight — but gets the founder ear. Title-keyed; widen as the corpus widens. */
const TASTE_DENYLIST = /kidnap|murder|killing of|death of|massacre|homicide|suicide|assault/i
/** Roam grounds on real material: lead extracts below this stay out of v0 (no thin tellings). */
const DEFAULT_MIN_EXTRACT = 400
/** Default corpus bbox — Tahoe–Reno corridor (matches sweep-roam-pois.ts). */
const DEFAULT_BBOX = { swLng: -120.25, swLat: 38.86, neLng: -119.55, neLat: 39.65 }

/** Rough sub-region label for the narrative context: tells the model where the driver IS. */
function regionLabel(lat: number, lng: number): string {
  if (lat > 39.35 && lng > -119.9) return 'Reno, Nevada'
  if (lat > 39.0 && lng > -119.85) return 'Carson City, Nevada'
  return 'Lake Tahoe'
}

const flags = parseFlags(process.argv.slice(2), { valueFlags: ['limit', 'min-extract', 'bbox'] })
const apply = flags.has('apply')
const force = flags.has('force')
const limit = Number(flags.value('limit') ?? Infinity)
const minExtract = Number(flags.value('min-extract') ?? DEFAULT_MIN_EXTRACT)
const bboxRaw = flags.value('bbox')
const bbox = (() => {
  if (!bboxRaw) return DEFAULT_BBOX
  const p = bboxRaw.split(',').map(Number)
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n)))
    throw new Error(`--bbox must be swLng,swLat,neLng,neLat (got "${bboxRaw}")`)
  return { swLng: p[0]!, swLat: p[1]!, neLng: p[2]!, neLat: p[3]! }
})()

announce({ tool: 'generate-roam', blast: ['SPENDS $', 'MUTATES DB'], apply })
if (apply) assertReady(['tts', 'r2'])

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
  title: string
  url: string
  factsFetchedAt: Date | null
  /** The poi's existing roam segment id (tour_id null), if any — reused so a regen keeps one
   *  roam segment per poi (the track is upserted on (segment, form, variant)). */
  segmentId: string | null
  hasFreshClip: boolean
}

const candidates: Candidate[] = []
for (const r of rows) {
  const extract = typeof r.facts?.extract === 'string' ? (r.facts.extract as string) : ''
  if (extract.length < minExtract) continue
  if (TASTE_DENYLIST.test(r.name)) {
    console.log(`  taste-gate: skipping "${r.name}"`)
    continue
  }
  const f = r.facts as { title?: string; url?: string; pageId?: number } | null
  candidates.push({
    poiId: r.id,
    pageId: f?.pageId ?? Number(r.sourceId),
    name: r.name,
    kind: r.kind,
    lat: r.lat,
    lng: r.lng,
    extract,
    title: f?.title ?? r.name,
    url: f?.url ?? `https://en.wikipedia.org/?curid=${r.sourceId}`,
    factsFetchedAt: r.factsFetchedAt,
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
  process.exit(0)
}

// Cost preview: narration ≈ system+sheet in / ~1k thinking+output out per clip (Fable 5
// $10/$50 per MTok → very roughly $0.06–0.15 per clip), TTS estimated exactly by chars.
const estClipChars = 800 // ~150 spoken words
const tts = estimateTtsUsd(
  queue.map(() => 'x'.repeat(estClipChars)),
  personaFromKey('skipper').ttsStyle.length,
)
console.log(
  `\nEstimated spend: narration ~$${(queue.length * 0.1).toFixed(2)} ± half ` +
    `+ TTS ~$${tts.usd.toFixed(2)} (${queue.length} clips ≈ ${Math.round((queue.length * ROAM_TARGET_SECONDS) / 60)} min of audio)`,
)

if (!apply) {
  console.log('\nDRY RUN — nothing narrated, synthesized, or written. Re-run with --apply.')
  process.exit(0)
}

const persona = personaFromKey('skipper')
// The frozen host on every roam segment this run writes.
const personaId = await resolvePersonaId(persona.personaKey)

// ── Deepen facts (free): full-article extracts for the queue, then re-upsert pois ──
console.log(`\nDeepening ${queue.length} fact sheets (full-article extracts)...`)
const deep = await fetchDeepExtracts(queue.map((c) => c.pageId))
const fetchedAt = new Date()
for (const c of queue) {
  const deepText = deep.get(c.pageId)
  if (deepText && deepText.length > c.extract.length) {
    c.extract = deepText
    c.factsFetchedAt = fetchedAt
    const facts = { extract: deepText, title: c.title, url: c.url, pageId: c.pageId }
    await upsertPoi({
      source: 'wikipedia',
      sourceId: String(c.pageId),
      name: c.name,
      kind: c.kind,
      lat: c.lat,
      lng: c.lng,
      summary: deepText.split(/(?<=[.!?])\s+/)[0] ?? null,
      facts,
      factsHash: hashFacts(facts),
      factsFetchedAt: fetchedAt,
    })
  }
}

// ── Narrate (parallel, blind drafts) with the two cheap guards ──
const LATERALITY = /\b(?:on|to|off to) (?:your|the) (?:left|right)\b|\b(?:left|right)(?:-hand)? side\b/i

async function narrateEncounter(c: Candidate): Promise<string> {
  const base = {
    region: regionLabel(c.lat, c.lng),
    corridor: 'Free roam — an unplanned drive, no route',
    stopType: 'story' as const,
    jokeLevel: 'dadpocalypse' as const,
    place: { name: c.name, ...(c.kind ? { kind: c.kind } : {}) },
    facts: toFacts(c.extract),
    targetSeconds: ROAM_TARGET_SECONDS,
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
    console.log(`  retake (${c.name}): ${kitHits.length > 0 ? 'kit ' : ''}${LATERALITY.test(script) ? 'laterality' : ''}`)
    ;({ script } = await narrateStop({ ...base, avoid }, persona.systemPrompt))
    if (LATERALITY.test(script) || persona.kit.beats.some((b) => b.match.test(script)))
      console.warn(`  ⚠ ${c.name}: guard still dirty after one retake — ships for the founder ear.`)
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
  const attribution: AttributionSnapshot[] = [
    {
      source: 'wikipedia',
      sourceId: String(c.pageId),
      title: c.title,
      url: c.url,
      license: 'CC BY-SA 4.0',
      retrievedAt: (c.factsFetchedAt ?? new Date()).toISOString(),
    },
  ]
  const factsHash = hashFacts({ extract: c.extract, title: c.title, url: c.url, pageId: c.pageId })
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
            set: { script, audioUrl, audioDurationMs: durationMs, attribution, factsHash, updatedAt: new Date() },
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
