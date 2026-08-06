// generate-narrations — the shared NARRATION corpus: narrate + synthesize one telling per POI.
// SPENDS $ (Anthropic narration + Cloud TTS) and MUTATES DB + R2 on --apply.
//
// Writes the shared NARRATION layer (V2): pois = shared FACTS, and a poi's ONE narration (1:1, the
// `narrations` table) = the shared telling EVERY DRIVE reuses, pre-ordered along its own route — so
// one clip has to play correctly on ANY route through the place, at any position in the order.
// Regenerated when the place's facts_hash moves (the staleness contract). The Skipper's stop prompt
// rides unchanged; the sheet adds the SELF-CONTAINED frame (route-agnostic, no order, no baked
// laterality — narrate.ts), targets the register length band (per delivery_register), threads no
// callbacks, and names no corridor. A narration is placeless: form='story', no segment, no route
// geometry (a drive snaps a trigger point onto its route at assemble time).
//
// AUTOMATED QUALITY GATE (2026-06-19): every clip is scored by the eval panel (grounding via Opus
// + laterality + tts-cleanliness as GATES, diversity as advisory), auto-retaken via optimize() when
// it fails, and FAIL-CLOSED — a clip that still fails a gate after the bounded retakes is WITHHELD
// (never synthesized, never persisted) and recorded in eval_scores with withheld=true, so the admin
// sees which places were held and why. This REPLACES the old two cheap guards (kit + laterality):
// one loop, one gate, one scorecard. The founder reversed the "human ear instead" deferral
// (docs/decisions/automated-grounding-gate.md); silence (a withheld clip) beats a bad telling.
//
// SOP (docs/guides/ops-scripts-sop.md): PREVIEWS (with a cost estimate) by default;
// narrates/synthesizes/writes only on --apply.
//
// Usage:
//   dotenvx run -f .env.development -- bun packages/studio/src/generate-narrations.ts
//   ... --apply                 run it (spends; writes R2 clips + narrations)
//   ... --apply --limit 3      smoke run (the cheapest real ear-test)
//   ... --force                regenerate even clips whose facts_hash is still fresh
//   ... --region <slug>          generate a region's narration corpus (REQUIRED unless --include-ids; → its bbox)
//   ... --include-ids a,b,c      regenerate EXACTLY these poi ids (implies --force)

import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { db } from '@skipper/db'
import { inAnyBbox } from '@skipper/db/bbox'
import { narrations, pois } from '@skipper/db/schema'
import type { FactSheetEntry, PoiFacts } from '@skipper/db/schema'
import { announce, assertReady, day, maxCostFlag, numericFlag, parseFlags } from './pipeline/ops'
import { requireRegionBboxes, requireRegionKey, resolveRegion } from './pipeline/region'
import { runJob, type FinishOutcome } from './pipeline/job-progress'
import {
  ensurePoiOverridesLoaded,
  OVERRIDE_STALE_LIST_CAP,
  overrideStaleFor,
  poiOverrideFor,
} from './pipeline/poi-overrides'
import { regionLabel } from './pipeline/geo'
import { resolveStoryGrounding } from './pipeline/select'
import { synthesizeWithTailRetake, type TailOutcome } from './pipeline/tts'
import type { LoudnessOutcome } from './pipeline/loudnorm'
import { SHARED_NGRAM_MIN_CLIPS } from './pipeline/lint'
import { loadDiversityContext } from './pipeline/diversity-context'
import { gateNarration } from './pipeline/gate'
import { narrationClipKey, uploadAudio } from './pipeline/storage'
import { groundingHash } from './pipeline/persist'
import { wikiUrlForPageId } from './pipeline/wikipedia'
import { withRetry } from './pipeline/http'
import { mapLimit } from './pipeline/concurrency'
import { personaFromKey } from './persona'
import {
  GROUNDING_EVAL,
  NARRATION_CONCURRENCY,
  NARRATION_FALLBACK_CHARS,
  TTS_CONCURRENCY,
  WORDS_PER_SECOND,
} from './config'
import { llmSpendLines, llmSpentUsd, unpricedModels } from '@skipper/shared'
import { TTS_ESTIMATE_SAFETY, estimateTtsUsd } from './pipeline/spend'
import { STORY_TASTE_DENYLIST, type DeliveryRegister } from '@skipper/shared'
import { NARRATION_MODEL, JUDGMENT_MODEL, ttsStyleFor, lengthForRegister } from './models'
import { buildGroundingWell } from './eval/grounding'
import { applyLoudnessOutcomes, applyTailOutcomes } from './eval/tts'
import { buildScorecard } from './eval/scorecard'
import { DIMENSION_KIND, type StopEval } from './eval/types'
import { recordEvalRun, type ClipIdentity } from './eval/record'

// Clip length is REGISTER-VARIED (REGISTER_LENGTH / lengthForRegister in ./models): a
// landscape glance is shorter than a rich story (research-grounded 2026-06-19; the old single 150/180
// "Autio-register" band fought the "let the facts set the length" doctrine). Eligibility for a STORY
// telling is still "has a curated fact sheet" (#1); "never pad past the facts" governs the ACTUAL length
// within the band, so a thin pin lands honestly short. An ENRICHED poi grounds on its sheet.

/** How many OTHER places must carry the identical fact line before it is marked SHARED on the sheet.
 *  DERIVED from the lint's threshold rather than restated: the lint FLAGS a phrase once
 *  `SHARED_NGRAM_MIN_CLIPS` distinct clips carry it, so the sheet should WARN at the same point — this
 *  poi plus this many others. Two hand-maintained numbers with a comment promising they match is
 *  exactly how generation and evaluation end up disagreeing about what counts as worn out. */
const SHARED_FACT_MIN_OTHERS = SHARED_NGRAM_MIN_CLIPS - 1

const flags = parseFlags(process.argv.slice(2), {
  valueFlags: ['limit', 'region', 'max-cost', 'query', 'include-ids', 'exclude-ids'],
})
const apply = flags.has('apply')
const maxCostUsd = maxCostFlag(flags)
// Narrate + PRINT the scripts, then stop — NO TTS, NO R2, NO DB writes. The cheapest way to ear-read
// the writing (e.g. a new length band) before committing to a paid synth + regen. Spends narration $.
const scriptsOnly = flags.has('scripts-only')
const limit = numericFlag(flags, 'limit', { fallback: Infinity })
// Selection mirrors enrich (geometry-first): a region (default: the launch region) → its discovery bbox →
// point-in-bbox, XOR an explicit hand-picked id list. `--bbox` is gone — a region is the only geo input.
const parseIds = (v: string | undefined): string[] => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [])
const regionRaw = flags.value('region') || null
const query = (flags.value('query') ?? '').trim().toLowerCase()
const includeIds = parseIds(flags.value('include-ids'))
const excludeIds = new Set(parseIds(flags.value('exclude-ids')))
const isExplicit = includeIds.length > 0 && !regionRaw && !query
// ⚠ FAIL HERE, before anything is announced or billed. A FILTER run with no --region used to mean
// "generate lake-tahoe" — on the most expensive CLI in the repo (model + TTS + R2), that is a
// wrong-corpus charge that settles green. An EXPLICIT run names its pois and needs no region.
if (!isExplicit) requireRegionKey(regionRaw)
// `--include-ids` IMPLIES regeneration — you asked for those exact pois, so don't freshness-skip them.
const force = flags.has('force') || isExplicit

announce({
  tool: 'generate-narrations',
  // ⚠ `--scripts-only` is MUTATES DB too. It writes no narration and no R2 object — which is what the
  // flag's name promises — but it still records the eval run + its score rows (`recordRun(true)` at the
  // scripts-only exit), so a blast label of SPENDS-only under-declared it. Same label, different rows.
  blast: ['SPENDS $', 'MUTATES DB'],
  apply: apply || scriptsOnly, // scripts-only spends narration $, so it's not a free dry run
})
if (apply) assertReady(['tts', 'r2']) // scripts-only needs neither TTS nor R2

// `FinishOutcome | void`, not plain void: the early exits (nothing queued, dry run, scripts-only) have
// nothing to report and fall through to runJob's `{ ok: true }`, but the full path MUST be able to say
// it failed — see the systemic-failure guard at the end.
async function main(): Promise<FinishOutcome | void> {
  await ensurePoiOverridesLoaded()

  // Region-scoped selection (geometry-first; see pipeline/region.ts): --region → discovery bbox →
  // point-in-bbox, XOR an explicit id list. Generate is wikipedia-only (the story corpus).
  const region = isExplicit ? null : await resolveRegion(regionRaw)
  const bbox = region ? requireRegionBboxes(region) : null

  // ── Candidate corpus: wikipedia-sourced pois with story-grade extracts, in the region ──
  // A poi's telling is its 1:1 narration — left-joined so a poi with no narration yet
  // still appears (and queues).
  const rows = await withRetry(
    () =>
      db
        .select({
          id: pois.id,
          source: pois.source,
          sourceId: pois.sourceId,
          qid: pois.qid,
          name: pois.name,
          kind: pois.kind,
          deliveryRegister: pois.deliveryRegister,
          lat: pois.lat,
          lng: pois.lng,
          facts: pois.facts,
          factsHash: pois.factsHash,
          sheetHash: pois.sheetHash,
          factsFetchedAt: pois.factsFetchedAt,
          factSheet: pois.factSheet,
          enrichedAt: pois.enrichedAt,
          narrationId: narrations.id,
          clipFactsHash: narrations.factsHash,
          clusterId: pois.clusterId,
        })
        .from(pois)
        .leftJoin(narrations, eq(narrations.poiId, pois.id))
        .where(
          isExplicit
            ? inArray(pois.id, includeIds)
            : and(
                eq(pois.source, 'wikipedia'),
                inAnyBbox(pois.lat, pois.lng, bbox!),
              ),
        ),
    { label: 'load narration corpus' },
  )

  interface Candidate {
    poiId: string
    pageId: number
    /** The pois dedup identity — also the key `poi_overrides` rows are written under (admin) and
     *  applied under (the fetch seam), so it is what the override-staleness check must look up. */
    source: string
    sourceId: string
    name: string
    kind: string | null
    /** The poi's stored delivery register (classify-registers) — picks the TTS read + length band.
     *  null = not yet classified → reads on the `story` base (the additive default). */
    deliveryRegister: DeliveryRegister | null
    lat: number
    lng: number
    extract: string
    /** The poi's full facts object — the source for the well↔extract-head grounding switch,
     *  shared with drives. (The grounding FINGERPRINT is no longer derived from this; it is read
     *  off the two hash columns below — see `groundingHash`.) */
    facts: PoiFacts
    title: string
    url: string
    /** Wikidata qid — the canonical identity, read from the first-class `pois.qid` column. */
    qid: string | null
    factsFetchedAt: Date | null
    /** The poi's two grounding digests, carried VERBATIM off the row. The stamp written onto the
     *  narration is `groundingHash` of these — read, never recomputed — so the clip's hash and the
     *  poi's cannot diverge. */
    factsHash: string | null
    sheetHash: string | null
    /** The poi's curated fact sheet + its enrich stamp (own columns) — the grounding SOURCE. */
    factSheet: FactSheetEntry[] | null
    enrichedAt: Date | null
    hasFreshClip: boolean
  }

  // The clusters that already have a fused telling — the supersession set (see the skip below).
  const fusedClusterIds = new Set(
    (await db
      .select({ clusterId: narrations.clusterId })
      .from(narrations)
      .where(isNotNull(narrations.clusterId))
    ).flatMap((r) => (r.clusterId ? [r.clusterId] : [])),
  )

  const candidates: Candidate[] = []
  for (const r of rows) {
    if (excludeIds.has(r.id)) continue // "select all matching, minus a few"
    if (query && !`${r.name} ${r.sourceId}`.toLowerCase().includes(query)) continue
    const f = r.facts
    // #1: a STORY telling REQUIRES a curated fact sheet — an un-enriched poi is SKIPPED (never a
    // raw-extract telling; a named-but-unenriched pin simply gets no telling — the scenic "wave" form that
    // was going to cover them was CUT, see docs/decisions/cut-wave-form.md). The
    // sheet IS the eligibility gate now — no char floor (removed 2026-06-16); a sheet only exists for an
    // enriched poi, so it subsumes the old `minExtract` check. `f` guards a text-less (pin) row.
    if (!f || !(Array.isArray(r.factSheet) && r.factSheet.length > 0)) continue
    // A member whose cluster already carries a fused telling is SUPERSEDED — no read path serves its
    // own clip any more, so paying to (re)generate one buys audio nobody can hear. Skipped rather than
    // filtered in SQL so the reason is visible in the run log. ⚠ Keyed on "the cluster HAS a fused
    // telling", never on membership: most grouped POIs have no fused clip and still need their own.
    if (r.clusterId != null && fusedClusterIds.has(r.clusterId)) {
      console.log(`  superseded: skipping "${r.name}" — its cluster's fused telling speaks for it`)
      continue
    }
    if (STORY_TASTE_DENYLIST.test(r.name)) {
      console.log(`  taste-gate: skipping "${r.name}"`)
      continue
    }
    candidates.push({
      poiId: r.id,
      pageId: f.pageId ?? Number(r.sourceId),
      source: r.source,
      sourceId: r.sourceId,
      name: r.name,
      kind: r.kind,
      deliveryRegister: r.deliveryRegister,
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
      // The poi's own hashes, carried so the stamp below reads the SAME grounding value this
      // freshness check compared — see the `factsHash` assignment in the generate loop.
      factsHash: r.factsHash,
      sheetHash: r.sheetHash,
      // Fresh = a narration exists AND grounds on the poi's CURRENT grounding hash → skip unless
      // --force. ⚠ Against `groundingHash`, never `facts_hash` alone: for an enriched poi the
      // narration stamped the SHEET digest, so comparing raw-facts digests would call every
      // enriched clip stale and re-narrate the whole corpus.
      hasFreshClip:
        r.narrationId !== null &&
        groundingHash(r) !== null &&
        r.clipFactsHash === groundingHash(r),
    })
  }

  const skipped = candidates.filter((c) => c.hasFreshClip && !force)
  const queue = candidates.filter((c) => !c.hasFreshClip || force).slice(0, limit)

  console.log(
    `Corpus: ${candidates.length} story-grade pois ` +
      `(${isExplicit ? `${includeIds.length} hand-picked` : `region=${region!.slug}`}, enriched — have a fact sheet) — ` +
      `${skipped.length} already have fresh clips (skipped), ${queue.length} to generate.\n`,
  )
  for (const c of queue) console.log(`  ${String(c.extract.length).padStart(5)}  ${c.name}`)

  // ── Curated-correction freshness (ADVISORY pre-flight) ─────────────────────────────────────────
  // A `poi_overrides` fact correction reaches the corpus at exactly one place: the Wikipedia FETCH
  // seam (pipeline/poi-overrides.ts). Generation reads `pois.facts` as stored and re-fetches nothing,
  // so a correction adjudicated AFTER a place's last fetch is simply not in the text this run is
  // about to narrate — and the clip bakes, at real cost, the sentence the correction superseded.
  // `latestOverrideAt` recorded that instant from the start and nothing ever compared it to anything
  // (founder 2026-08-02: wire it).
  //
  // ⚠ WARN — never block, never auto-refetch. Halting a legitimate paid run over an advisory signal
  // is the worse failure (the stamp can also outrun a correction a re-sweep already applied), and
  // mutating pois from inside the generator is a side effect nobody asked for.
  //
  // ⚠ Deliberately ABOVE the empty-queue return: corrections are adjudicated by LISTENING to shipped
  // clips (the eval --veracity loop is the catch side), so the modal stale place already has a clip
  // that reads FRESH — its facts_hash cannot move while the corrected text is still unfetched — and
  // gets freshness-skipped. Warning after the return would go silent in the very case this exists for.
  const isOverrideStale = (c: Candidate): boolean =>
    overrideStaleFor(c.source, c.sourceId, c.factsFetchedAt)
  const queuedIds = new Set(queue.map((c) => c.poiId))
  const staleQueued = queue.filter(isOverrideStale)
  const staleUnqueued = candidates.filter((c) => !queuedIds.has(c.poiId) && isOverrideStale(c))
  if (staleQueued.length > 0) {
    console.warn(
      `\n⚠ OVERRIDE-STALE: ${staleQueued.length}/${queue.length} queued place(s) carry a curated fact ` +
        `CORRECTION newer than their cached facts. Corrections apply at the Wikipedia FETCH seam only, so ` +
        `these pois.facts still hold the UNCORRECTED text — narrating them now bakes a superseded ` +
        `sentence into a paid clip:`,
    )
    for (const c of staleQueued.slice(0, OVERRIDE_STALE_LIST_CAP)) {
      console.warn(
        `  • ${c.name} (${c.poiId}) — facts fetched ${day(c.factsFetchedAt)}, ` +
          `corrected ${day(poiOverrideFor(c.source, c.sourceId)?.latestOverrideAt)}`,
      )
    }
    if (staleQueued.length > OVERRIDE_STALE_LIST_CAP) {
      console.warn(`  …and ${staleQueued.length - OVERRIDE_STALE_LIST_CAP} more.`)
    }
    console.warn(
      `  Fix first, per poi (FREE):\n` +
        `    dotenvx run -f .env.development -- bun packages/studio/src/refetch-poi.ts <poiId> --apply\n` +
        `  ⚠ every candidate here is ENRICHED (the fact-sheet eligibility gate above) and narration grounds ` +
        `on the SHEET, so the re-fetch alone does NOT reach the clip — follow it with ` +
        `\`enrich-pois --include-ids <poiId> --force --apply\` (SPENDS) to rebuild the well from the ` +
        `corrected article.\n  Advisory only — this run is NOT blocked.`,
    )
  }
  if (staleUnqueued.length > 0) {
    console.warn(
      `\n⚠ ${staleUnqueued.length} story-grade place(s) OUTSIDE this run's queue are override-stale too — ` +
        `a freshness-skipped one reads FRESH forever (a correction that never reached pois.facts can't ` +
        `move a facts_hash), so it keeps serving the uncorrected telling until someone re-fetches it. ` +
        `Re-fetch + re-enrich, then regenerate with --include-ids.`,
    )
  }

  if (queue.length === 0) {
    console.log('Nothing to generate.')
    return
  }

  // ── Diversity context: the region's EXISTING tellings ──────────────────────────────────────────
  // The cross-clip lint can only see repetition it is handed. Seed it with every telling already in
  // this region so a new clip is checked against the corpus a rider actually hears — not just against
  // the handful this run happens to produce. Clips generated during the run are appended below.
  // Cheap: one scripts-only query, and the lint is deterministic string work (no LLM, no spend).
  // ⚠ An EXPLICIT-id run has no region and therefore no bbox — and that is exactly the path an operator
  // takes to fix a handful of named clips, i.e. the run that most needs to know what the rest of the
  // corpus already says. Falling back to NO context there would have quietly reproduced the original
  // bug on the most common repair path. Whole-corpus is the honest scope for it: a rider can hear two
  // clips from different regions on one drive, so repetition across them is still repetition.
  // ⚠ Must reach FUSED tellings too, and they carry poi_id NULL (`narrations_subject_xor`) — so an
  // inner join to `pois` silently drops all of them and a solo clip is never checked against the fused
  // telling it will share a drive with. Region scope therefore resolves per subject kind: solo by its
  // poi's point, fused by whether any MEMBER poi sits in the bbox (the same geometry-first rule
  // everything else uses). The fused generator loads context the same way, so the two are symmetric.
  // `bbox` is null on an --include-ids run (no region), which loadDiversityContext reads as
  // WHOLE CORPUS — see there for why that is the right scope and not a degenerate fallback.
  const diversityContext: string[] = await loadDiversityContext(isExplicit ? null : bbox)
  console.log(
    `Diversity context: ${diversityContext.length} existing tellings ` +
      `(${isExplicit ? 'whole corpus — explicit-id run has no region' : 'this region'}) will be checked against.`,
  )

  // How many DISTINCT pois carry each exact fact line, corpus-wide. The narrator gets this per stop
  // (`sharedFacts`) so it can tell a fact ABOUT THIS PLACE from regional boilerplate.
  //
  // ⚠ It cannot work this out for itself, and that is the whole point: one Macrostrat map unit hands
  // 24 Tahoe pois the byte-identical "undivided granitic rocks … Late Cretaceous, roughly 66 to 101
  // million years old", and inside a single narration call that reads as a vivid, specific fact worth
  // leading with. Measured, the carriers are NOT thin (most have 3-5 other facts), so this is a choice
  // made blind rather than a shortage of material. Corpus-wide, not region-scoped, because a rider on
  // one drive can hear clips from either side of a region boundary.
  const factCarriers = new Map<string, number>()
  for (const row of await withRetry(
    () => db.select({ sheet: pois.factSheet }).from(pois).where(isNotNull(pois.factSheet)),
    { label: 'load shared-fact counts' },
  )) {
    const items = Array.isArray(row.sheet) ? row.sheet : []
    // Count each poi ONCE per distinct line — a sheet that repeats itself must not inflate the count.
    const seen = new Set<string>()
    for (const it of items) {
      const t = (it as { text?: string })?.text?.trim()
      if (!t || seen.has(t)) continue
      seen.add(t)
      factCarriers.set(t, (factCarriers.get(t) ?? 0) + 1)
    }
  }
  const sharedLines = [...factCarriers.values()].filter((n) => n > SHARED_FACT_MIN_OTHERS).length
  console.log(
    `Shared-fact map: ${factCarriers.size} distinct fact lines, ${sharedLines} carried by more than ` +
      `${SHARED_FACT_MIN_OTHERS} places (those get marked SHARED on the sheet).`,
  )

  // Cost preview: narration ≈ system+sheet in / ~1k thinking+output out per clip (Opus 4.8
  // $5/$25 per MTok → very roughly $0.03–0.08 per clip). The automated gate adds ~1 Opus GROUNDING
  // call/clip (~$0.04) plus the odd bounded retake, so model ~$0.15/clip of LLM spend when the gate
  // is on. TTS cost is DOMINATED by audio tokens, which estimateTtsUsd derives from the WORD count
  // (estSeconds = words / WORDS_PER_SECOND) — so the dummy clip must contain that many real WORDS. A
  // space-less char blob ('x'.repeat(n)) reads as ONE word and collapses the audio estimate ~100× (it
  // under-quoted a full-region run by ~$28 and silently defeated --max-cost). Model a target-length clip.
  const llmUsdPerClip = GROUNDING_EVAL() ? 0.15 : 0.1
  // Per-clip TTS estimate uses each poi's REGISTER target (a story clip quotes longer than a landscape
  // glance); the dummy clip must carry that many real WORDS (estimateTtsUsd derives audio tokens from the
  // word count — a space-less blob reads as ONE word and collapses the audio estimate ~100×).
  const targetSecFor = (c: Candidate): number => lengthForRegister(c.deliveryRegister ?? 'story').targetSeconds
  const tts = estimateTtsUsd(
    queue.map((c) => Array(Math.round(targetSecFor(c) * WORDS_PER_SECOND)).fill('word').join(' ')),
    personaFromKey('skipper').ttsStyle.length,
  )
  const estAudioMin = Math.round(queue.reduce((s, c) => s + targetSecFor(c), 0) / 60)
  console.log(
    `\nEstimated spend: narration+gate ~$${(queue.length * llmUsdPerClip).toFixed(2)} ± half ` +
      `+ TTS ~$${tts.usd.toFixed(2)} (${queue.length} clips ≈ ${estAudioMin} min of audio` +
      `${GROUNDING_EVAL() ? '' : '; grounding gate OFF'})`,
  )

  if (!apply && !scriptsOnly) {
    console.log(
      '\nDRY RUN — nothing narrated, synthesized, or written. Re-run with --apply (or --scripts-only to narrate + print, no TTS/DB).',
    )
    return
  }

  // Cost ceiling: abort BEFORE any narration/TTS if the estimate exceeds --max-cost. A region run
  // covers a whole corpus, so an unbounded run (no --limit) can balloon — this is the hard stop.
  const estSpendUsd = (scriptsOnly ? 0 : tts.usd * TTS_ESTIMATE_SAFETY) + queue.length * llmUsdPerClip
  if (estSpendUsd > maxCostUsd) {
    // THROW (not return): runJob's catch settles the studio_jobs row as FAILED. A bare `return`
    // would let runJob record status 'succeeded' — indistinguishable from a clean run that did the work.
    throw new Error(
      `⛔ Estimated spend ~$${estSpendUsd.toFixed(2)} exceeds --max-cost=$${maxCostUsd.toFixed(2)} — aborting before any spend. Narrow with --limit or raise --max-cost.`,
    )
  }

  const persona = personaFromKey('skipper')

  // Facts are ALREADY the full article — the region sweep deepens at discovery time (the corpus is
  // the single fetch point, the "real step 1"), so generation narrates on the stored extract with NO
  // per-run re-fetch and NO fact mutation. (Override-freshness now lands via a re-sweep / refetch_facts,
  // not a per-run fetch.) `c.extract` carries the full article from the corpus query above.

  // ── Narrate + GATE each clip through the eval panel (parallel) ──
  interface GatedClip {
    c: Candidate
    seq: number
    /** The best take found, or null if narrate/eval threw (fault-isolated → withheld). */
    script: string | null
    evals: StopEval[]
    /** Cleared every GATE dimension → eligible to synthesize + persist. */
    shipped: boolean
  }

  async function gateClip(c: Candidate, seq: number): Promise<GatedClip> {
    // Ground on the curated WELL when the place is enriched, else the positional extract head — the
    // SAME resolver drives use, so the well the auditor builds matches the narrator's sheet.
    const grounding = resolveStoryGrounding(c.facts, c.factSheet, c.enrichedAt, {
      fallbackChars: NARRATION_FALLBACK_CHARS,
      retrievedAt: (c.factsFetchedAt ?? new Date()).toISOString(),
    })
    // The poi's delivery register sets BOTH the read (ttsStyleFor, at synth) and the length band.
    // null (un-classified) → 'story' base, so this is additive: classifying a poi differentiates it.
    const register: DeliveryRegister = c.deliveryRegister ?? 'story'
    const band = lengthForRegister(register)
    const base = {
      region: regionLabel(c.lat, c.lng),
      // No corridor: the shared atom plays on ANY route that reaches the place, so it names only the
      // stable REGION, never a specific stretch.
      stopType: 'story' as const,
      place: { name: c.name, ...(c.kind ? { kind: c.kind } : {}) },
      facts: grounding.facts,
      // Only the lines OTHER places also carry, with this poi discounted from its own count.
      sharedFacts: Object.fromEntries(
        grounding.facts
          .map((f) => [f, (factCarriers.get(f.trim()) ?? 1) - 1] as const)
          .filter(([, others]) => others >= SHARED_FACT_MIN_OTHERS),
      ),
      targetSeconds: band.targetSeconds,
      maxSeconds: band.maxSeconds,
      selfContained: true,
    }
    // The permitted well, built from the SAME facts the narrator saw (buildGroundingWell is the
    // shared seam, so the auditor's well can never drift from the narrator's sheet).
    const well = buildGroundingWell({ stopType: 'story', name: c.name, kind: c.kind, facts: grounding.facts })

    const { script, evals, shipped } = await gateNarration({
      seq,
      name: c.name,
      base,
      well,
      targetSeconds: band.targetSeconds,
      maxSeconds: band.maxSeconds,
      diversityContext,
      systemPrompt: persona.systemPrompt,
    })
    return { c, seq, script, evals, shipped }
  }

  console.log(`\nNarrating + gating ${queue.length} clips (concurrency ${NARRATION_CONCURRENCY()})...`)
  let done = 0
  const gated = await mapLimit(queue, NARRATION_CONCURRENCY(), async (c, i): Promise<GatedClip> => {
    try {
      const g = await gateClip(c, i)
      done++
      console.log(
        `  [${done}/${queue.length}] ${c.name} — ${g.shipped ? `${g.script!.split(/\s+/).length} words` : 'WITHHELD (gate)'}`,
      )
      return g
    } catch (e) {
      // Fault isolation: a narrate/eval throw on ONE clip must not abort the paid run (mapLimit fails
      // fast on a throw). Treat it as withheld, record the error as a gate finding, and continue.
      const msg = e instanceof Error ? e.message : String(e)
      done++
      console.warn(`  ⚠ ${c.name}: narrate/eval failed — WITHHELD. ${msg.slice(0, 160)}`)
      return {
        c,
        seq: i,
        script: null,
        shipped: false,
        evals: [{ seq: i, dimension: 'grounding', pass: false, score: 0, findings: [`gate error: ${msg.slice(0, 200)}`] }],
      }
    }
  })

  // ── Shared eval record (written on BOTH the scripts-only dry pass and the live --apply pass) ──
  const shippedClips = gated.filter(
    (g): g is GatedClip & { script: string } => g.shipped && g.script !== null,
  )
  const withheldClips = gated.filter((g) => !g.shipped)
  // NULL (not a sentinel) when the run spans no single region — an explicit-id run over the whole
  // corpus. The admin surfaces a null region/target as "All".
  const runRegion = region ? region.slug : null
  const identityBySeq = new Map<number, ClipIdentity>(
    gated.map((g) => [
      g.seq,
      // A withheld clip carries its best-attempt script (for the admin report); a shipped clip's
      // script lives in narrations, so we leave it null here.
      { poiId: g.c.poiId, qid: g.c.qid, name: g.c.name, withheld: !g.shipped, script: g.shipped ? null : g.script },
    ]),
  )
  const baseStops = gated.flatMap((g) => g.evals)
  // The shipped clips' tail-collapse outcomes (seq → outcome), filled by the synth loop below. Folded
  // into the tts dimension at record time so a clip that ships a STILL-collapsed closer records as a
  // FAILED tts row (the human-review flag) instead of a silent pass. Empty on the dry/abort paths (no
  // synthesis ran — the pre-synth script verdict stands), where applyTailOutcomes is a no-op.
  const tailBySeq = new Map<number, TailOutcome | null>()
  // The shipped clips' POST-ENCODE loudness/true-peak verdicts (seq → outcome), filled by the synth loop
  // alongside tailBySeq. Folded into the tts dimension at record time (advisory) so a clip that landed
  // off-target or over the true-peak ceiling records as a FAILED tts row for the human pass — never withheld.
  const loudnessBySeq = new Map<number, LoudnessOutcome | null>()
  const recordRun = (dryRun: boolean): Promise<unknown> =>
    recordEvalRun({
      region: runRegion,
      kind: 'generation',
      dryRun,
      narrationModel: NARRATION_MODEL,
      judgeModel: GROUNDING_EVAL() ? JUDGMENT_MODEL : null,
      groundingJudged: GROUNDING_EVAL(),
      scorecard: buildScorecard({
        slug: runRegion,
        runName: 'generate_narrations',
        evaluatedAt: new Date().toISOString(),
        stops: applyLoudnessOutcomes(applyTailOutcomes(baseStops, tailBySeq), loudnessBySeq),
      }),
      total: gated.length,
      shipped: shippedClips.length,
      withheld: withheldClips.length,
      identityBySeq,
    }).catch((e) => {
      // Observability, never product state — a record failure must not fail the run.
      console.warn(`  ⚠ eval-run record failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`)
    })

  if (withheldClips.length > 0) {
    console.warn(
      `\n⚠ ${withheldClips.length}/${gated.length} clip(s) WITHHELD by the gate — not shipped (flagged in eval_scores):`,
    )
    for (const g of withheldClips) {
      const why = g.evals
        .filter((e) => DIMENSION_KIND[e.dimension] === 'gate' && !e.pass)
        .flatMap((e) => e.findings)
      console.warn(`  • ${g.c.name}: ${why.slice(0, 2).join('; ') || 'gate failed'}`)
    }
  }

  if (scriptsOnly) {
    console.log('\n════════ SCRIPTS — scripts-only: no TTS, no R2, no narration writes ════════')
    for (const g of gated) {
      if (!g.script) {
        console.log(`\n──── ${g.c.name} · WITHHELD (narrate/eval error) ────`)
        continue
      }
      const words = g.script.trim().split(/\s+/).filter(Boolean).length
      console.log(
        `\n──── ${g.c.name} · ${g.shipped ? 'SHIP' : 'WITHHELD'} · ${words} words ≈ ${Math.round(words / WORDS_PER_SECOND)}s ────\n${g.script}`,
      )
    }
    console.log(
      `\n(register length bands, aim/cap s: ` +
        (['landscape', 'story', 'town', 'civic'] as const)
          .map((r) => `${r} ${lengthForRegister(r).targetSeconds}/${lengthForRegister(r).maxSeconds}`)
          .join(', ') +
        `)`,
    )
    await recordRun(true) // a DRY eval run — observability without synth/persist
    for (const line of llmSpendLines()) console.log(line)
    console.log(`LLM spend this run: ~$${llmSpentUsd().toFixed(2)}`)
    return
  }

  // Fail-safe the cap on an UNPRICED model: a model we called with no MODEL_PRICING entry tallies its
  // tokens but reads $0, so llmSpentUsd() silently under-counts and --max-cost can't bind. Abort loudly
  // rather than spend TTS under a defeated cap. (No-op when --max-cost is unset, or all models priced.)
  const unpriced = unpricedModels()
  if (maxCostUsd !== Infinity && unpriced.length > 0) {
    await recordRun(true)
    throw new Error(
      `⛔ --max-cost is set but these models are UNPRICED (their spend reads $0, defeating the cap): ${unpriced.join(', ')}. Add them to MODEL_PRICING (@skipper/shared) or re-run without --max-cost.`,
    )
  }

  // Runtime spend guard: the gate's retakes can overrun the pre-flight estimate. Abort BEFORE the
  // (dominant) TTS spend if narration + grounding already blew the ceiling. The eval is recorded first.
  const ttsEstNow = estimateTtsUsd(shippedClips.map((g) => g.script), persona.ttsStyle.length)
  const ttsCapEst = ttsEstNow.usd * TTS_ESTIMATE_SAFETY // the cap is honored against the upper bound (the point estimate under-counts ~5–15%)
  if (llmSpentUsd() + ttsCapEst > maxCostUsd) {
    await recordRun(true)
    throw new Error(
      `⛔ Spend after narrate+gate ($${llmSpentUsd().toFixed(2)}) + est TTS ($${ttsCapEst.toFixed(2)}, incl. safety margin) exceeds --max-cost=$${maxCostUsd.toFixed(2)} — aborting before synthesis. Eval recorded.`,
    )
  }

  // ── Synthesize + upload + upsert narrations — ONLY the gate-passing clips ──
  // RESILIENT batch: a single clip's HARD failure (e.g. a Cloud TTS 400 on an over-length script)
  // must NOT abort the whole run — clips are independent and land individually, so we skip + warn +
  // continue and report the casualties at the end. A WITHHELD clip never reaches here (the gate held
  // it); a synth failure leaves that poi without a narration (re-run to retry). mapLimit fails fast on
  // a throw, so the try/catch — not mapLimit — is what keeps the batch going.
  console.log(`\nSynthesizing ${shippedClips.length} gate-passing clips (concurrency ${TTS_CONCURRENCY()})...`)
  let synthDone = 0
  const failures: { name: string; error: string }[] = []
  // Running TTS-spend guard (mirrors enrich's): the pre-synth cap above is a point estimate and ~1-in-4
  // clips re-synthesize (the tail-collapse retake), so a collapse-heavy region can overrun. Tally the
  // actual TTS spend as clips land and STOP launching synths once it crosses --max-cost; the overshoot is
  // bounded to ~one in-flight batch (TTS_CONCURRENCY), not the whole queue. No-op when --max-cost is unset.
  let ttsSpentUsd = 0
  let costCapped = false
  const results = await mapLimit(shippedClips, TTS_CONCURRENCY(), async (g) => {
    const c = g.c
    const script = g.script
    try {
      // Running cost cap: skip the rest once actual spend crosses --max-cost (re-run to finish). Checked
      // here, not via a mapLimit throw, so it skips cleanly without aborting the resilient batch.
      if (maxCostUsd !== Infinity && llmSpentUsd() + ttsSpentUsd >= maxCostUsd) {
        if (!costCapped) {
          costCapped = true
          console.warn(
            `  ⛔ --max-cost=$${maxCostUsd.toFixed(2)} reached (~$${(llmSpentUsd() + ttsSpentUsd).toFixed(2)} spent) — skipping the remaining clips.`,
          )
        }
        return null
      }
      // The R2 clip key stays poi-scoped with a fresh per-synth id (the
      // `narration/<poiId>/<id>.m4a` keys); a regen writes a NEW key + repoints audio_url, so the old
      // object orphans for sweep-orphans. The narration row's own id is independent of the clip key.
      const clipId = crypto.randomUUID()
      // Tail-collapse retake (pipeline/tts.ts): narration clips ship unheard, so a mumbled
      // closing sentence would reach riders' ears first — measure + retake here too.
      // The poi's register modulates the READ (pace/space/energy) on the shared base; null → story base.
      const { audio, durationMs, tail, loudness, takes } = await synthesizeWithTailRetake(
        script,
        persona.voice,
        ttsStyleFor(persona.ttsStyle, c.deliveryRegister ?? 'story'),
        `"${c.title}"`,
      )
      // The TTS is now paid — count it toward the running cap even if the upload/upsert below fails.
      // ⚠ × `takes`, not once: the synth chain re-rolls on an overlong or tail-collapsed take, so a clip
      // can bill several. Counting one made the cap blind to exactly the retake spend it exists to
      // bound — the retaking clips ARE the expensive ones. Same text every take, so this is exact.
      ttsSpentUsd += estimateTtsUsd([script], persona.ttsStyle.length).usd * takes
      // Idempotent (same key + bytes), so a transient R2 blip after a paid synth retries instead of
      // wasting the synth.
      const audioUrl = await withRetry(() => uploadAudio(narrationClipKey(c.poiId, clipId), audio), {
        label: `upload(${c.name})`,
      })
      // Well-aware credit: an ENRICHED poi credits the well's distinct sources (wikipedia + any
      // geology/wikidata kept). Same resolver the gate ran above, so the credit frozen here can't
      // drift from the facts the clip was actually audited against.
      const { attribution } = resolveStoryGrounding(c.facts, c.factSheet, c.enrichedAt, {
        fallbackChars: NARRATION_FALLBACK_CHARS,
        retrievedAt: (c.factsFetchedAt ?? new Date()).toISOString(),
      })
      // ⚠ READ from the poi row, never RECOMPUTED from facts + sheet. This is the same number the
      // freshness query above compared, and the same one the admin verdict will compare later, so
      // "a freshly-generated clip cannot read as stale" is true by construction rather than by this
      // call site agreeing with three other writers about which digest to take. That agreement used
      // to be conventional, and a call site that got it wrong passed typecheck and every test.
      const factsHash = groundingHash({ factsHash: c.factsHash, sheetHash: c.sheetHash })
      // A poi's telling = its ONE narration (1:1). Upsert on poi_id so a regen replaces the
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
      // Record this shipped clip's tail-collapse + post-encode loudness outcomes so a still-collapsed
      // closer OR an off-spec master lands as a FAILED tts row in the eval record (the human-review
      // flag) rather than a silent pass.
      tailBySeq.set(g.seq, tail)
      loudnessBySeq.set(g.seq, loudness)
      synthDone++
      console.log(`  [${synthDone}/${shippedClips.length}] ${c.name} (${(durationMs / 1000).toFixed(0)}s)`)
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
    `\nDone: ${ok.length}/${shippedClips.length} clips synthesized, ${withheldClips.length} withheld by the gate, ` +
      `${(totalSec / 60).toFixed(1)} min of audio total (avg ${ok.length ? (totalSec / ok.length).toFixed(0) : '0'}s).`,
  )
  if (failures.length > 0) {
    console.warn(
      `\n⚠ ${failures.length} clip(s) FAILED synthesis and were SKIPPED — re-run to retry (or patch individually):`,
    )
    for (const f of failures) console.warn(`  • ${f.name}: ${f.error.slice(0, 200)}`)
  }
  if (costCapped) {
    const capped = shippedClips.length - ok.length - failures.length
    console.warn(
      `\n⛔ ${capped} clip(s) SKIPPED — --max-cost=$${maxCostUsd.toFixed(2)} reached mid-synthesis. Re-run (with a higher cap if needed) to finish the rest.`,
    )
  }
  const evalRunId = await recordRun(false)
  for (const line of llmSpendLines()) console.log(line)
  console.log(`LLM spend this run: ~$${llmSpentUsd().toFixed(2)}`)
  const ttsActual = estimateTtsUsd(
    shippedClips.map((g) => g.script),
    persona.ttsStyle.length,
  )
  console.log(`TTS spend (estimated from chars): ~$${ttsActual.usd.toFixed(2)}`)

  // SYSTEMIC-failure guard, mirroring enrich-pois. If EVERY clip the gate cleared then FAILED to
  // synthesize, that is an outage / bad TTS auth / exhausted quota / R2 down — not per-clip bad luck.
  //
  // ⚠ `main` returned void until 2026-08-02, so `runJob` settled `{ ok: true }` unconditionally and the
  // console showed a GREEN row for a paid run that narrated, gated, billed, and produced no audio at
  // all. Thrown (not returned) so runJob's catch records the message and exits non-zero, and placed
  // AFTER the eval record + spend lines so the run's observability still lands before it fails.
  //
  // A fully-WITHHELD run is deliberately NOT this case: `failures` is empty there, and the gate
  // withholding everything is the fail-closed design working, not an error.
  if (ok.length === 0 && failures.length > 0) {
    throw new Error(
      `generate: all ${failures.length} gate-cleared clip(s) failed synthesis — likely systemic ` +
        `(TTS auth / quota / R2 outage), not per-clip misses. First: ${failures[0]!.error.slice(0, 200)}`,
    )
  }
  // Link the eval run to the job row so the console can get from a paid run to what it scored.
  return { ok: true, ...(typeof evalRunId === 'string' ? { evalRunId } : {}) }
}

// A region run keys the lock on its slug; a whole-corpus explicit-id run leaves slug+target NULL
// (no fake-region sentinel) — the admin shows it as "All".
const genTargetRegion = isExplicit ? undefined : requireRegionKey(regionRaw)
await runJob(
  'generate_narrations',
  { dryRun: !apply && !scriptsOnly, targetSlug: genTargetRegion, targetId: genTargetRegion },
  main,
)
