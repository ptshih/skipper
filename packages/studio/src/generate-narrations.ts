// generate-narrations — FREE-ROAM encounter generation: narrate + synthesize the POI corpus.
// SPENDS $ (Anthropic narration + Cloud TTS) and MUTATES DB + R2 on --apply.
//
// Free-roam writes the shared NARRATION layer (V2): pois = shared FACTS, and a poi's ONE
// narration (1:1, the `narrations` table) = the shared telling that ROAM plays by proximity AND
// every DRIVE reuses (pre-ordered along its route). Regenerated when the place's facts_hash moves
// (the staleness contract). Encounters are a FORM, not a new persona: the Skipper's stop prompt
// rides unchanged; the sheet adds the FREE-ROAM ENCOUNTER frame (self-contained, route-agnostic, no
// baked laterality — narrate.ts) and targets the roam length band, threading no callbacks. A
// narration is placeless: form='story', no segment, no route geometry (a drive snaps a trigger point
// onto its route at assemble time; roam triggers on the poi's own location).
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
//   dotenvx run -f .env.development -- bun packages/studio/src/generate-narrations.ts
//   ... --apply                 run it (spends; writes R2 clips + narrations)
//   ... --apply --limit 3      smoke run (the cheapest real ear-test)
//   ... --force                regenerate even clips whose facts_hash is still fresh
//   ... --region <slug>          generate a region's roam corpus (default: lake-tahoe; → its bbox)
//   ... --include-ids a,b,c      regenerate EXACTLY these poi ids (implies --force)

import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import { narrations, pois } from '@skipper/db/schema'
import type { FactSheetEntry, PoiFacts } from '@skipper/db/schema'
import { announce, assertReady, maxCostFlag, parseFlags } from './pipeline/ops'
import { resolveRegion, requireRegionBbox } from './pipeline/region'
import { runJob } from './pipeline/job-progress'
import { ensurePoiOverridesLoaded } from './pipeline/poi-overrides'
import { regionLabel } from './pipeline/geo'
import { narrateStop } from './pipeline/narrate'
import { resolveStoryGrounding } from './pipeline/select'
import { synthesizeWithTailRetake } from './pipeline/tts'
import { narrationClipKey, uploadAudio } from './pipeline/storage'
import { storyFactsHash } from './pipeline/persist'
import { wikiUrlForPageId } from './pipeline/wikipedia'
import { withRetry } from './pipeline/http'
import { mapLimit } from './pipeline/concurrency'
import { personaFromKey } from './persona'
import {
  DEFAULT_REGION_SLUG,
  NARRATION_CONCURRENCY,
  NARRATION_FALLBACK_CHARS,
  TTS_CONCURRENCY,
  WORDS_PER_SECOND,
} from './config'
import { estimateTtsUsd, llmSpendLines, llmSpentUsd } from './pipeline/spend'
import { STORY_TASTE_DENYLIST } from '@skipper/shared'

/** Roam encounter length band (Autio-register long-form, founder 2026-06-13).
 *  storyTargetSeconds = the AIM; storyMaxSeconds = a HARD cap so a fact-rich place doesn't sprawl
 *  into a lecture. "Never pad past the facts" governs the ACTUAL length WITHIN the band, so a thin
 *  pin lands honestly shorter (capped by its facts) rather than stretched. ELIGIBILITY for a roam STORY
 *  is simply "has a curated fact sheet" (#1) — NOT a char floor (the old `minExtractStory`/`--min-extract`
 *  800-char gate was removed 2026-06-16; a sheet only exists for an enriched poi, so it subsumes it).
 *  An ENRICHED poi grounds on its curated sheet (resolveStoryGrounding). */
const ROAM_LENGTH = {
  storyTargetSeconds: 150,
  storyMaxSeconds: 180,
} as const
const flags = parseFlags(process.argv.slice(2), {
  valueFlags: ['limit', 'region', 'max-cost', 'query', 'include-ids', 'exclude-ids'],
})
const apply = flags.has('apply')
const maxCostUsd = maxCostFlag(flags)
// Narrate + PRINT the scripts, then stop — NO TTS, NO R2, NO DB writes. The cheapest way to ear-read
// the writing (e.g. a new length band) before committing to a paid synth + regen. Spends narration $.
const scriptsOnly = flags.has('scripts-only')
const limit = Number(flags.value('limit') ?? Infinity)
// Selection mirrors enrich (geometry-first): a region (default: the launch region) → its discovery bbox →
// point-in-bbox, XOR an explicit hand-picked id list. `--bbox` is gone — a region is the only geo input.
const parseIds = (v: string | undefined): string[] => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [])
const regionRaw = flags.value('region') || null
const query = (flags.value('query') ?? '').trim().toLowerCase()
const includeIds = parseIds(flags.value('include-ids'))
const excludeIds = new Set(parseIds(flags.value('exclude-ids')))
const isExplicit = includeIds.length > 0 && !regionRaw && !query
// `--include-ids` IMPLIES regeneration — you asked for those exact pois, so don't freshness-skip them.
const force = flags.has('force') || isExplicit

announce({
  tool: 'generate-narrations',
  blast: scriptsOnly ? ['SPENDS $'] : ['SPENDS $', 'MUTATES DB'],
  apply: apply || scriptsOnly, // scripts-only spends narration $, so it's not a free dry run
})
if (apply) assertReady(['tts', 'r2']) // scripts-only needs neither TTS nor R2

async function main(): Promise<void> {
  await ensurePoiOverridesLoaded()

  // Region-scoped selection (geometry-first; see pipeline/region.ts): --region → discovery bbox →
  // point-in-bbox, XOR an explicit id list. Generate is wikipedia-only (the story corpus).
  const region = isExplicit ? null : await resolveRegion(regionRaw ?? DEFAULT_REGION_SLUG)
  const bbox = region ? requireRegionBbox(region) : null

  // ── Candidate corpus: wikipedia-sourced pois with story-grade extracts, in the region ──
  // The ROAM telling for a poi is its 1:1 narration — left-joined so a poi with no narration yet
  // still appears (and queues).
  const rows = await withRetry(
    () =>
      db
        .select({
          id: pois.id,
          sourceId: pois.sourceId,
          qid: pois.qid,
          name: pois.name,
          kind: pois.kind,
          lat: pois.lat,
          lng: pois.lng,
          facts: pois.facts,
          factsHash: pois.factsHash,
          factsFetchedAt: pois.factsFetchedAt,
          factSheet: pois.factSheet,
          enrichedAt: pois.enrichedAt,
          narrationId: narrations.id,
          clipFactsHash: narrations.factsHash,
        })
        .from(pois)
        .leftJoin(narrations, eq(narrations.poiId, pois.id))
        .where(
          isExplicit
            ? inArray(pois.id, includeIds)
            : and(
                eq(pois.source, 'wikipedia'),
                sql`${pois.lat} between ${bbox!.swLat} and ${bbox!.neLat}`,
                sql`${pois.lng} between ${bbox!.swLng} and ${bbox!.neLng}`,
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
     *  grounding fingerprint (resolveStoryGrounding / storyFactsHash), shared with drives. */
    facts: PoiFacts
    title: string
    url: string
    /** Wikidata qid — the canonical identity, read from the first-class `pois.qid` column. */
    qid: string | null
    factsFetchedAt: Date | null
    /** The poi's curated fact sheet + its enrich stamp (own columns) — grounding source + fingerprint. */
    factSheet: FactSheetEntry[] | null
    enrichedAt: Date | null
    hasFreshClip: boolean
  }

  const candidates: Candidate[] = []
  for (const r of rows) {
    if (excludeIds.has(r.id)) continue // "select all matching, minus a few"
    if (query && !`${r.name} ${r.sourceId}`.toLowerCase().includes(query)) continue
    const f = r.facts
    // #1: a roam STORY encounter REQUIRES a curated fact sheet — an un-enriched poi is SKIPPED (never a
    // raw-extract telling; the scenic-tier "wave" form will cover named-but-unenriched pins later). The
    // sheet IS the eligibility gate now — no char floor (removed 2026-06-16); a sheet only exists for an
    // enriched poi, so it subsumes the old `minExtract` check. `f` guards a text-less (pin) row.
    if (!f || !(Array.isArray(r.factSheet) && r.factSheet.length > 0)) continue
    if (STORY_TASTE_DENYLIST.test(r.name)) {
      console.log(`  taste-gate: skipping "${r.name}"`)
      continue
    }
    candidates.push({
      poiId: r.id,
      pageId: f.pageId ?? Number(r.sourceId),
      name: r.name,
      kind: r.kind,
      lat: r.lat,
      lng: r.lng,
      extract: f.extract,
      facts: f,
      title: f.title ?? r.name,
      url: f.url ?? wikiUrlForPageId(r.sourceId),
      qid: r.qid,
      factsFetchedAt: r.factsFetchedAt,
      factSheet: r.factSheet,
      enrichedAt: r.enrichedAt,
      // Fresh = a narration exists AND grounds on the poi's CURRENT facts → skip unless --force.
      hasFreshClip: r.narrationId !== null && r.clipFactsHash === r.factsHash && r.factsHash !== null,
    })
  }

  const skipped = candidates.filter((c) => c.hasFreshClip && !force)
  const queue = candidates.filter((c) => !c.hasFreshClip || force).slice(0, limit)

  console.log(
    `Corpus: ${candidates.length} story-grade pois ` +
      `(${isExplicit ? `${includeIds.length} hand-picked` : `region=${region!.slug}`}, enriched — have a fact sheet) — ` +
      `${skipped.length} already have fresh roam clips (skipped), ${queue.length} to generate.\n`,
  )
  for (const c of queue) console.log(`  ${String(c.extract.length).padStart(5)}  ${c.name}`)

  if (queue.length === 0) {
    console.log('Nothing to generate.')
    return
  }

  // Cost preview: narration ≈ system+sheet in / ~1k thinking+output out per clip (Opus 4.8
  // $5/$25 per MTok → very roughly $0.03–0.08 per clip). TTS cost is DOMINATED by audio tokens,
  // which estimateTtsUsd derives from the WORD count (estSeconds = words / WORDS_PER_SECOND) — so
  // the dummy clip must contain that many real WORDS. A space-less char blob ('x'.repeat(n)) reads
  // as ONE word and collapses the audio estimate ~100× (it under-quoted a full-region run by ~$28
  // and silently defeated the --max-cost gate). Model a target-length clip's word budget.
  const estWordsPerClip = Math.round(ROAM_LENGTH.storyTargetSeconds * WORDS_PER_SECOND)
  const dummyClip = Array(estWordsPerClip).fill('word').join(' ')
  const tts = estimateTtsUsd(
    queue.map(() => dummyClip),
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
    // THROW (not return): runJob's catch settles the studio_jobs row as FAILED. A bare `return`
    // would let runJob record status 'succeeded' — indistinguishable from a clean run that did the work.
    throw new Error(
      `⛔ Estimated spend ~$${estSpendUsd.toFixed(2)} exceeds --max-cost=$${maxCostUsd.toFixed(2)} — aborting before any spend. Narrow with --limit or raise --max-cost.`,
    )
  }

  const persona = personaFromKey('skipper')

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

  // ── Synthesize + upload + upsert narrations (a row only lands COMPLETE) ──
  // RESILIENT batch: a single clip's HARD failure (e.g. a Cloud TTS 400 on an over-length script)
  // must NOT abort the whole run — roam clips are independent and land individually, so we skip +
  // warn + continue ("ship the rest with a loud warn", the alpha posture) and report the casualties
  // at the end. A skipped poi simply gets no narration (it won't be encountered) — silence beats
  // letting one bad clip drop the rest. Re-run to retry the skips (narration is non-deterministic,
  // so an over-length outlier usually narrates within limits next time). mapLimit fails fast on a
  // throw, so the try/catch — not mapLimit — is what keeps the batch going.
  console.log(`\nSynthesizing ${queue.length} clips (concurrency ${TTS_CONCURRENCY()})...`)
  let synthDone = 0
  const failures: { name: string; error: string }[] = []
  const results = await mapLimit(queue, TTS_CONCURRENCY(), async (c, i) => {
    const script = scripts[i]!
    try {
      // The R2 clip key stays poi-scoped with a fresh per-synth id (the
      // `narration/<poiId>/<id>.m4a` keys); a regen writes a NEW key + repoints audio_url, so the old
      // object orphans for sweep-orphans. The narration row's own id is independent of the clip key.
      const clipId = crypto.randomUUID()
      // Tail-collapse retake (pipeline/tts.ts): narration clips ship unheard, so a mumbled
      // closing sentence would reach riders' ears first — measure + retake here too.
      const { audio, durationMs } = await synthesizeWithTailRetake(
        script,
        persona.voice,
        persona.ttsStyle,
        `"${c.title}"`,
      )
      const audioUrl = await uploadAudio(narrationClipKey(c.poiId, clipId), audio)
      // Well-aware credit: an ENRICHED poi credits the well's distinct sources (wikipedia + any
      // geology/wikidata kept). Same resolver tours use, so attribution can't drift between roam and
      // a drive reusing the clip.
      const { attribution } = resolveStoryGrounding(c.facts, c.factSheet, c.enrichedAt, {
        fallbackChars: NARRATION_FALLBACK_CHARS,
        retrievedAt: (c.factsFetchedAt ?? new Date()).toISOString(),
      })
      // The grounding fingerprint = pois.factsHash exactly (storyFactsHash on the SAME facts the
      // freshness query read), so a freshly-generated clip never reads as stale.
      const factsHash = storyFactsHash(c.facts, c.factSheet)
      // A roam telling = the poi's ONE narration (1:1). Upsert on poi_id so a regen replaces the
      // same row's script/audio/hash in place.
      await withRetry(
        () =>
          db
            .insert(narrations)
            .values({
              poiId: c.poiId,
              form: 'story',
              script,
              audioUrl,
              audioDurationMs: durationMs,
              attribution,
              factsHash,
            })
            .onConflictDoUpdate({
              target: narrations.poiId,
              set: {
                form: 'story',
                script,
                audioUrl,
                audioDurationMs: durationMs,
                attribution,
                factsHash,
                updatedAt: new Date(),
              },
            }),
        { label: `upsert narration(${c.name})` },
      )
      synthDone++
      console.log(`  [${synthDone}/${queue.length}] ${c.name} (${(durationMs / 1000).toFixed(0)}s)`)
      return { name: c.name, durationMs }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      failures.push({ name: c.name, error })
      console.warn(`  ⚠ SKIP ${c.name}: synthesis failed (clip dropped) — ${error.slice(0, 200)}`)
      return null
    }
  })

  const ok = results.filter((r): r is { name: string; durationMs: number } => r !== null)
  const totalSec = ok.reduce((a, r) => a + r.durationMs, 0) / 1000
  console.log(
    `\nDone: ${ok.length}/${queue.length} roam clips, ${(totalSec / 60).toFixed(1)} min of audio total ` +
      `(avg ${ok.length ? (totalSec / ok.length).toFixed(0) : '0'}s).`,
  )
  if (failures.length > 0) {
    console.warn(
      `\n⚠ ${failures.length} clip(s) FAILED synthesis and were SKIPPED — re-run to retry (or patch individually):`,
    )
    for (const f of failures) console.warn(`  • ${f.name}: ${f.error.slice(0, 200)}`)
  }
  for (const line of llmSpendLines()) console.log(line)
  console.log(`LLM spend this run: ~$${llmSpentUsd().toFixed(2)}`)
  const ttsActual = estimateTtsUsd(scripts, persona.ttsStyle.length)
  console.log(`TTS spend (estimated from chars): ~$${ttsActual.usd.toFixed(2)}`)
}

await runJob(
  'generate_narrations',
  { dryRun: !apply && !scriptsOnly, targetId: isExplicit ? 'roam-corpus' : (regionRaw ?? DEFAULT_REGION_SLUG) },
  main,
)
