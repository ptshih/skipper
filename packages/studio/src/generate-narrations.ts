// generate-narrations — the shared NARRATION corpus: narrate + synthesize one telling per POI.
// SPENDS $ (Anthropic narration + Cloud TTS) and MUTATES DB + R2 on --apply.
//
// Writes the shared NARRATION layer (V2): pois = shared FACTS, and a poi's ONE narration (1:1, the
// `narrations` table) = the shared telling that ROAM plays by proximity AND every DRIVE reuses
// (pre-ordered along its route) — so each clip must accommodate BOTH modes. Regenerated when the
// place's facts_hash moves (the staleness contract). The Skipper's stop prompt rides unchanged; the
// sheet adds the SELF-CONTAINED frame (route-agnostic, no order, no baked laterality — narrate.ts),
// targets the register length band (per delivery_register), threads no callbacks, and names no
// corridor. A narration is placeless: form='story', no segment, no route geometry (a drive snaps a
// trigger point onto its route at assemble time; roam triggers on the poi's own location).
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
import { synthesizeWithTailRetake, type TailOutcome } from './pipeline/tts'
import { narrationClipKey, uploadAudio } from './pipeline/storage'
import { storyFactsHash } from './pipeline/persist'
import { wikiUrlForPageId } from './pipeline/wikipedia'
import { withRetry } from './pipeline/http'
import { mapLimit } from './pipeline/concurrency'
import { personaFromKey } from './persona'
import {
  DEFAULT_REGION_SLUG,
  GROUNDING_EVAL,
  GROUNDING_REGEN_MAX_ROUNDS,
  NARRATION_CONCURRENCY,
  NARRATION_FALLBACK_CHARS,
  TTS_CONCURRENCY,
  WORDS_PER_SECOND,
} from './config'
import { estimateTtsUsd, llmSpendLines, llmSpentUsd, unpricedModels, TTS_ESTIMATE_SAFETY } from './pipeline/spend'
import { STORY_TASTE_DENYLIST, type DeliveryRegister } from '@skipper/shared'
import { NARRATION_MODEL, JUDGMENT_MODEL, ttsStyleFor, lengthForRegister } from './models'
import { buildGroundingWell, evaluateGrounding } from './eval/grounding'
import { applyTailOutcomes, evaluateTts } from './eval/tts'
import { evaluateDiversity } from './eval/diversity'
import { evaluateLaterality } from './eval/laterality'
import { evaluatePacing } from './eval/pacing'
import { optimize } from './eval/optimize'
import { buildScorecard } from './eval/scorecard'
import { DIMENSION_KIND, type StopEval } from './eval/types'
import { recordEvalRun, type ClipIdentity } from './eval/record'

// Roam encounter length is now REGISTER-VARIED (REGISTER_LENGTH / lengthForRegister in ./models): a
// landscape glance is shorter than a rich story (research-grounded 2026-06-19; the old single 150/180
// "Autio-register" band fought the "let the facts set the length" doctrine). Eligibility for a roam
// STORY is still "has a curated fact sheet" (#1); "never pad past the facts" governs the ACTUAL length
// within the band, so a thin pin lands honestly short. An ENRICHED poi grounds on its sheet.

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
          deliveryRegister: pois.deliveryRegister,
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
    /** The poi's stored delivery register (classify-registers) — picks the TTS read + length band.
     *  null = not yet classified → reads on the `story` base (the additive default). */
    deliveryRegister: DeliveryRegister | null
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

  // Cost ceiling: abort BEFORE any narration/TTS if the estimate exceeds --max-cost. A roam run
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
  // the single fetch point, the "real step 1"), so roam narrates on the stored extract with NO
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
    // SAME resolver tours + drives use, so the well the auditor builds matches the narrator's sheet.
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
      // No corridor: the shared atom plays on its own (roam) OR on any route (a drive reusing it), so
      // it names only the stable REGION, never a specific stretch.
      stopType: 'story' as const,
      place: { name: c.name, ...(c.kind ? { kind: c.kind } : {}) },
      facts: grounding.facts,
      targetSeconds: band.targetSeconds,
      maxSeconds: band.maxSeconds,
      selfContained: true,
    }
    // The permitted well, built from the SAME facts the narrator saw (buildGroundingWell is the
    // shared seam, so the auditor's well can never drift from the narrator's sheet).
    const well = buildGroundingWell({ stopType: 'story', name: c.name, kind: c.kind, facts: grounding.facts })

    // The per-clip panel: free dims always (tts-cleanliness + diversity = within-clip tics/bows) +
    // laterality (a free grounding backstop); GROUNDING (one Opus call) behind SKIPPER_GROUNDING_EVAL.
    // evaluate() is what optimize() scores each take on; regenerate() is narrateStop with avoid folded in.
    const evaluate = async (script: string): Promise<StopEval[]> => {
      const evals: StopEval[] = [
        evaluateTts({ seq, script }),
        ...evaluateDiversity([{ seq, stopType: 'story', script }]),
        evaluateLaterality({ seq, script }),
        evaluatePacing({ seq, script, targetSeconds: band.targetSeconds, maxSeconds: band.maxSeconds }),
      ]
      if (GROUNDING_EVAL())
        evals.push(
          await evaluateGrounding({
            seq,
            stopType: 'story',
            placeName: c.name,
            script,
            well,
            region: base.region,
          }),
        )
      return evals
    }
    const regenerate = async (avoid: string[]): Promise<string> =>
      (await narrateStop({ ...base, avoid }, persona.systemPrompt)).script

    const { script: initial } = await narrateStop(base, persona.systemPrompt)
    const result = await optimize(initial, { evaluate, regenerate, maxRounds: GROUNDING_REGEN_MAX_ROUNDS })
    // SHIP gate = every GATE dimension clean (grounding + tts; a laterality slip rides grounding).
    // Diversity is advisory — it drives the retake but never withholds an otherwise-clean clip.
    const shipped = result.evals.filter((e) => DIMENSION_KIND[e.dimension] === 'gate').every((e) => e.pass)
    return { c, seq, script: result.item, evals: result.evals, shipped }
  }

  console.log(`\nNarrating + gating ${queue.length} encounters (concurrency ${NARRATION_CONCURRENCY()})...`)
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
  const runRegion = region ? region.slug : 'roam-corpus'
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
  const recordRun = (dryRun: boolean): Promise<unknown> =>
    recordEvalRun({
      region: runRegion,
      kind: 'generation',
      dryRun,
      narrationModel: NARRATION_MODEL,
      judgeModel: GROUNDING_EVAL() ? JUDGMENT_MODEL : null,
      scorecard: buildScorecard({
        slug: runRegion,
        runName: 'generate_narrations',
        evaluatedAt: new Date().toISOString(),
        stops: applyTailOutcomes(baseStops, tailBySeq),
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
      `⛔ --max-cost is set but these models are UNPRICED (their spend reads $0, defeating the cap): ${unpriced.join(', ')}. Add them to MODEL_PRICING (pipeline/spend.ts) or re-run without --max-cost.`,
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
      const { audio, durationMs, tail } = await synthesizeWithTailRetake(
        script,
        persona.voice,
        ttsStyleFor(persona.ttsStyle, c.deliveryRegister ?? 'story'),
        `"${c.title}"`,
      )
      // The TTS is now paid — count it toward the running cap even if the upload/upsert below fails.
      ttsSpentUsd += estimateTtsUsd([script], persona.ttsStyle.length).usd
      // Idempotent (same key + bytes), so a transient R2 blip after a paid synth retries instead of
      // wasting the synth.
      const audioUrl = await withRetry(() => uploadAudio(narrationClipKey(c.poiId, clipId), audio), {
        label: `upload(${c.name})`,
      })
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
      // Record this shipped clip's tail-collapse outcome so a still-collapsed closer lands as a FAILED
      // tts row in the eval record (the human-review flag) rather than a silent pass.
      tailBySeq.set(g.seq, tail)
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
  await recordRun(false)
  for (const line of llmSpendLines()) console.log(line)
  console.log(`LLM spend this run: ~$${llmSpentUsd().toFixed(2)}`)
  const ttsActual = estimateTtsUsd(
    shippedClips.map((g) => g.script),
    persona.ttsStyle.length,
  )
  console.log(`TTS spend (estimated from chars): ~$${ttsActual.usd.toFixed(2)}`)
}

await runJob(
  'generate_narrations',
  { dryRun: !apply && !scriptsOnly, targetId: isExplicit ? 'roam-corpus' : (regionRaw ?? DEFAULT_REGION_SLUG) },
  main,
)
