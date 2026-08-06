// generate-scenic-narrations — the SCENIC tier: a short named call-out for a place that has no facts.
//
// ⚠ WHY THIS TIER EXISTS AT ALL (docs/designs/scenic-stops-spec.md §11). Every narration in the live
// corpus is a `story` — 458 of 458 — while a real drive runs 79% silent, and 925 named, KIND-bearing
// POIs sit along those routes saying nothing, because a story REQUIRES a fact sheet and they have
// none. They are the beaches, points, bays and peaks a driver is looking at during the quiet.
// `narrate.ts` has supported `stopType: 'scenic'` all along; what was missing was a generator, since
// generate-narrations skips any poi without a sheet (the wave form that would have covered them was
// CUT — docs/decisions/cut-wave-form.md).
//
// ⚠ A GLANCE, NOT A STORY. The ceiling IS the safety story: name + kind + the plainly-visible day, and
// nothing the name implies. That rule is enforced in three independent places and all three must stay
// aligned — the narrator's sheet (narrate.ts, the `namedScenic` branch), the well
// (`buildGroundingWell`, scenic branch) and the grounding judge (eval/grounding.ts SYSTEM: "a given
// name licenses NOTHING it implies"). ⚠ The judge only APPLIES those stricter rules because
// `gateNarration` reads the stop type off the narration request; it was hardcoded 'story' until
// 2026-08-03, which would have graded every clip here under the LOOSEST rules, silently.
//
// SAFE BY DEFAULT (ops-scripts-sop): a bare run narrates nothing and writes nothing.
//
//   bun packages/studio/src/generate-scenic-narrations.ts                          # dry run, $0
//   bun packages/studio/src/generate-scenic-narrations.ts --scripts-only --limit 6 # 💸 narrate + score
//   bun packages/studio/src/generate-scenic-narrations.ts --apply --limit 3        # 💸 + TTS + R2 + DB
//   ... --kind mountain     # the WORST case for monotony — one kind; the only test of the rotation
//   ... --spread            # one per KIND instead of an alphabetical slice
//   ... --offset 2          # keep a re-test OFF the population a fix was built from
//
// ⚠ TWO TRAPS INHERITED FROM THE CUT WAVE BUILD (cut-wave-form.md), both handled, both MEASURED here:
//  1. MONOTONY IS STRUCTURAL in a low-input form. Handled by opening AND closing shapes assigned
//     round-robin by queue index (`openingAngleFor` / `closingAngleFor`), which hold at any concurrency
//     and need no shared mutable state. ⚠ The rolling-buffer alternative was tried and FAILED: openers
//     alone left 4 of 4 clips closing alike; adding closers took it to 3 of 6, and the three that
//     collapsed were the first three — the ones generated against an empty history. Assigned shapes
//     took a six-mountain worst case to six distinct openings and 0 of 5 observed closer collapses.
//  2. THE GROUNDING GATE CANNOT CATCH A CLAIM DERIVED FROM THE PLACE'S NAME ("Cathedral Peak" → "a
//     peak out there", asserting a kind never given). So a KIND is REQUIRED up front rather than
//     trusted to the gate, and a road-snapped anchor is required too: a call-out about what you are
//     looking at is worthless if it fires a kilometre before you can see it.

import { and, eq, isNull, isNotNull } from 'drizzle-orm'
import { db } from '@skipper/db'
import { inAnyBbox } from '@skipper/db/bbox'
import { narrations, pois } from '@skipper/db/schema'
import { announce, assertReady, maxCostFlag, numericFlag, parseFlags } from './pipeline/ops'
import { requireRegionBboxes, requireRegionKey, resolveRegion } from './pipeline/region'
import { regionLabel } from './pipeline/geo'
import { gateNarration } from './pipeline/gate'
import { openingAngleFor, closingAngleFor, type NarrationRequest } from './pipeline/narrate'
import { synthesizeWithTailRetake, type TailOutcome } from './pipeline/tts'
import type { LoudnessOutcome } from './pipeline/loudnorm'
import { narrationClipKey, uploadAudio } from './pipeline/storage'
import { withRetry } from './pipeline/http'
import { mapLimit } from './pipeline/concurrency'
import { runJob } from './pipeline/job-progress'
import { loadDiversityContext } from './pipeline/diversity-context'
import { buildGroundingWell } from './eval/grounding'
import { applyLoudnessOutcomes, applyTailOutcomes } from './eval/tts'
import { buildScorecard } from './eval/scorecard'
import { recordEvalRun, type ClipIdentity } from './eval/record'
import { DIMENSION_KIND, type StopEval } from './eval/types'
import { personaFromKey } from './persona'
import { ttsStyleFor } from './models'
import { llmSpendLines, llmSpentUsd } from '@skipper/shared'
import { TTS_ESTIMATE_SAFETY, estimateTtsUsd } from './pipeline/spend'
import {
  GROUNDING_EVAL,
  NARRATION_CONCURRENCY,
  TTS_CONCURRENCY,
  WORDS_PER_SECOND,
} from './config'

// A GLANCE, NOT A STORY — the prompt's own words for this branch. ⚠ Deliberately NOT
// `lengthForRegister('landscape')` (60 s / 100 s): that band is written for a natural feature that HAS
// facts ("wonder over inventory, not a factless glance"), and handing a factless place sixty seconds
// to fill is precisely how a name turns into an invented story. The cut WAVE band was 15/20 s; this
// sits just above so the voice has room to be a voice. Measured over 22 smoke clips: 14-26 s actual.
const SCENIC_TARGET_SECONDS = 20
const SCENIC_MAX_SECONDS = 30

/** The delivery register a scenic call-out is voiced in — every one of these places is a landform. */
const SCENIC_REGISTER = 'landscape' as const

/**
 * Phase offset between the opening and closing rotations.
 *
 * ⚠ WITHOUT IT, CLIP 0 OF EVERY RUN OPENS AND CLOSES ON THE NAME. The two rotations are independent
 * lists whose FIRST entries are both the name shape, so index 0 pairs "OPEN ON THE NAME" with "CLOSE
 * ON THE NAME" — and the first real paid clip proved it: *"Amione Park — and what a fine, easy sky
 * over it today. A park, plain and simple… Amione Park."* Three names in thirty words, and it lands on
 * the run's FIRST clip, which is the one a human is most likely to judge the tier by.
 *
 * 2 is chosen, not arbitrary: it clears the collision at 0 while leaving the one deliberate overlap
 * intact — index 5 pairs the GROANER opening with the JOKE close, and that closer's own text says "if
 * your opening earned a groaner, land it here", so those two belong together.
 */
const CLOSER_PHASE = 2

interface Scenic {
  id: string
  name: string
  kind: string
  lat: number
  lng: number
}

interface GatedScenic {
  s: Scenic
  seq: number
  script: string | null
  evals: StopEval[]
  shipped: boolean
}

// Parsed at module scope so `runJob` can stamp the studio_jobs row before main() starts — that row is
// how the admin console shows status and captures this script's stdout at all.
const flags = parseFlags(process.argv.slice(2), {
  valueFlags: ['region', 'limit', 'kind', 'poi', 'offset', 'max-cost'],
})
const apply = flags.has('apply')
const scriptsOnly = flags.has('scripts-only')
const maxCostUsd = maxCostFlag(flags)
// ⚠ A SCORED run MUTATES DB even without --apply, exactly like the other two generators: it records
// its eval_run + score rows so a preview's withheld clips are queryable. It persists no narration and
// no R2 object — that half really is gated on --apply. A bare dry run spends and writes nothing.
announce({
  tool: 'generate-scenic-narrations',
  blast: scriptsOnly || apply ? ['SPENDS $', 'MUTATES DB'] : [],
  apply,
})
if (apply) assertReady(['r2', 'tts'])
// ⚠ --region is REQUIRED, and this line is where that fails — before runJob opens a row or main() spends.
const scenicTargetRegion = requireRegionKey(flags.value('region'))

async function main(): Promise<void> {
  const limit = numericFlag(flags, 'limit', { fallback: 3 })
  const offset = numericFlag(flags, 'offset', { fallback: 0 })
  const kindFilter = flags.value('kind')?.toLowerCase()
  const poiFilter = flags.value('poi')?.toLowerCase()
  const spread = flags.has('spread')

  const region = await resolveRegion(scenicTargetRegion)
  const bbox = requireRegionBboxes(region)
  const persona = personaFromKey('skipper')

  // The eligible population. Every clause is a REFUSAL with a reason:
  //   no narration  — this tier is only for places that have none (a SECOND telling is a b-side)
  //   no facts      — a poi WITH facts belongs to the story path; this is the tier for the factless
  //   not excluded  — an operator-excluded poi stays excluded
  //   no cluster    — a member speaks through its fused telling, never on its own
  //   HAS a kind    — trap #2: never let the NAME imply what kind of thing this is
  //   HAS an anchor — fire where the rider can see it, not at a raw centroid
  const rows = await db
    .select({ id: pois.id, name: pois.name, kind: pois.kind, lat: pois.speakableLat, lng: pois.speakableLng })
    .from(pois)
    .leftJoin(narrations, eq(narrations.poiId, pois.id))
    .where(
      and(
        isNull(narrations.id),
        isNull(pois.facts),
        isNull(pois.excludedReason),
        isNull(pois.clusterId),
        isNotNull(pois.kind),
        isNotNull(pois.speakableLat),
        isNotNull(pois.speakableLng),
        inAnyBbox(pois.lat, pois.lng, bbox),
      ),
    )
    .orderBy(pois.name)

  const eligible: Scenic[] = rows.flatMap((r) =>
    r.kind != null && r.lat != null && r.lng != null
      ? [{ id: r.id, name: r.name, kind: r.kind, lat: r.lat, lng: r.lng }]
      : [],
  )
  const filtered = eligible
    .filter((r) => (poiFilter ? r.name.toLowerCase().includes(poiFilter) : true))
    .filter((r) => (kindFilter ? r.kind.toLowerCase() === kindFilter : true))

  // ⚠ SAMPLE ACROSS KINDS, not down one — a lake and a peak are different sayability problems ("the
  // water's general blue" is available to one and meaningless for the other), so an alphabetical slice
  // tests one letter rather than one tier. ⚠ `--kind` exists for the opposite reason: six of the SAME
  // kind is the WORST case for monotony, and the only one that tests the angle rotation at all.
  // ⚠ `--offset` keeps a re-run OFF the population a fix was built from — `ops-scripts-sop.md`'s
  // tail-collapse lessons are explicit that validating a fix on its own repair set flatters it.
  const byKind = new Map<string, Scenic[]>()
  for (const r of filtered) {
    const list = byKind.get(r.kind)
    if (list) list.push(r)
    else byKind.set(r.kind, [r])
  }
  const picked = spread
    ? [...byKind.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, limit)
        .map(([, list]) => list[Math.min(offset, list.length - 1)]!)
    : filtered.slice(offset, offset + limit)

  console.log(
    `\n${region.displayName}: ${eligible.length} scenic-eligible poi(s) across ${byKind.size} kind(s)` +
      `${kindFilter ? ` · kind="${kindFilter}": ${filtered.length}` : ''} · selected ${picked.length}` +
      `${spread ? ' (one per kind)' : ''}${offset ? ` (offset ${offset})` : ''}\n`,
  )
  if (picked.length === 0) {
    // "A run that did nothing must not settle GREEN." Nothing to narrate is an outcome, not a success.
    throw new Error('No scenic-eligible poi matched — nothing to generate. Widen --region/--kind/--limit.')
  }

  const diversityContext: string[] = await loadDiversityContext(bbox)
  console.log(`Diversity context: ${diversityContext.length} existing telling(s) in this region.\n`)

  // The narrator's sheet and the judge's well, from ONE description of the place. ⚠ They must not
  // drift: the well is what the clip is scored against, so a well RICHER than the sheet blesses claims
  // the narrator was never licensed to make, and a poorer one flags honest lines.
  const inputsFor = (s: Scenic, seq: number) => {
    const base: NarrationRequest = {
      region: regionLabel(s.lat, s.lng),
      stopType: 'scenic',
      place: { name: s.name, kind: s.kind },
      facts: [], // by definition — this tier IS the places that have none
      targetSeconds: SCENIC_TARGET_SECONDS,
      maxSeconds: SCENIC_MAX_SECONDS,
      selfContained: true,
      openingAngle: openingAngleFor(seq),
      closingAngle: closingAngleFor(seq + CLOSER_PHASE),
    }
    const well = buildGroundingWell({ stopType: 'scenic', name: s.name, kind: s.kind })
    return { base, well }
  }

  // ⚠ COST CEILING ABOVE THE GATING LOOP, like the fused path and unlike the poi one. A scored run
  // spends on narration + the Opus grounding judge before any TTS, so a cap first checked inside the
  // synthesis loop would bound nothing that had not already been billed.
  // ⚠ The TTS dummy must carry real WORDS — estimateTtsUsd derives audio tokens from the word count,
  // so a space-less blob reads as ONE word and collapses the estimate ~100×.
  const llmUsdPerClip = GROUNDING_EVAL() ? 0.05 : 0.03
  const ttsPreEst = estimateTtsUsd(
    picked.map(() => Array(Math.round(SCENIC_TARGET_SECONDS * WORDS_PER_SECOND)).fill('word').join(' ')),
    persona.ttsStyle.length,
  )
  const estSpendUsd = picked.length * llmUsdPerClip + (apply ? ttsPreEst.usd * TTS_ESTIMATE_SAFETY : 0)
  console.log(
    `Estimated spend: narration+gate ~$${(picked.length * llmUsdPerClip).toFixed(2)} ± half` +
      `${apply ? ` + TTS ~$${ttsPreEst.usd.toFixed(2)}` : ''} (${picked.length} clip(s)` +
      `${GROUNDING_EVAL() ? '' : '; grounding gate OFF'})`,
  )

  if (!apply && !scriptsOnly) {
    console.log('\nDRY RUN — nothing narrated, scored, synthesized or written. $0 spent.')
    for (const [i, s] of picked.entries()) {
      console.log(`  ${String(i).padStart(2)}. ${s.name.padEnd(38)} ${s.kind}`)
    }
    console.log('\n  --scripts-only  narrate + score + print   💸 spends; no TTS, no R2, no narration row')
    console.log('  --apply         the whole path            💸 spends; WRITES prod rows + R2 objects')
    console.log('')
    return
  }
  if (estSpendUsd > maxCostUsd) {
    // THROW, not return: runJob's catch settles the studio_jobs row FAILED. A bare return records
    // 'succeeded' — indistinguishable from a clean run that did the work.
    throw new Error(
      `⛔ Estimated spend ~$${estSpendUsd.toFixed(2)} exceeds --max-cost=$${maxCostUsd.toFixed(2)} — aborting before any spend.`,
    )
  }

  const gated = await mapLimit(picked, NARRATION_CONCURRENCY(), async (s, i): Promise<GatedScenic> => {
    try {
      const { base, well } = inputsFor(s, i)
      const { script, evals, shipped } = await gateNarration({
        seq: i,
        name: s.name,
        base,
        well,
        targetSeconds: SCENIC_TARGET_SECONDS,
        maxSeconds: SCENIC_MAX_SECONDS,
        diversityContext,
        systemPrompt: persona.systemPrompt,
      })
      const words = script.split(/\s+/).filter(Boolean).length
      console.log(`  ${s.name} (${s.kind}) — ${shipped ? `${words} words` : 'WITHHELD (gate)'}`)
      if (scriptsOnly) console.log(`      ${script}`)
      return { s, seq: i, script, evals, shipped }
    } catch (e) {
      // Fault isolation: one clip's narrate/eval throw must not abort a paid batch.
      const msg = e instanceof Error ? e.message : String(e)
      console.warn(`  ⚠ ${s.name}: narrate/eval failed — WITHHELD. ${msg.slice(0, 160)}`)
      return {
        s,
        seq: i,
        script: null,
        shipped: false,
        evals: [{ seq: i, dimension: 'grounding', pass: false, score: 0, findings: [`gate error: ${msg.slice(0, 200)}`] }],
      }
    }
  })

  const shippedClips = gated.filter((g): g is GatedScenic & { script: string } => g.shipped && g.script !== null)
  const withheld = gated.filter((g) => !g.shipped)
  const tailBySeq = new Map<number, TailOutcome>()
  const loudnessBySeq = new Map<number, LoudnessOutcome>()

  // Recorded on EVERY scored exit, not just the applied one — a scripts-only run is exactly the one
  // you most want a scorecard for, since it is how quality gets inspected before paying for TTS.
  const recordRun = (dryRun: boolean, synthesized?: number): Promise<unknown> =>
    recordEvalRun({
      region: region.slug,
      kind: 'generation',
      dryRun,
      scorecard: buildScorecard({
        slug: region.slug,
        runName: `scenic call-outs — ${region.displayName}`,
        evaluatedAt: new Date().toISOString(),
        stops: applyLoudnessOutcomes(applyTailOutcomes(gated.flatMap((g) => g.evals), tailBySeq), loudnessBySeq),
      }),
      total: gated.length,
      shipped: synthesized ?? shippedClips.length,
      withheld: withheld.length,
      groundingJudged: GROUNDING_EVAL(),
      identityBySeq: new Map<number, ClipIdentity>(
        gated.map((g) => [
          g.seq,
          { poiId: g.s.id, clusterId: null, qid: null, name: g.s.name, withheld: !g.shipped, script: g.shipped ? null : g.script },
        ]),
      ),
    }).catch((e) => console.warn(`  ⚠ eval record failed (observability only): ${e}`))

  const printScorecard = (g: GatedScenic) => {
    for (const e of g.evals) {
      console.log(
        `  ${e.pass ? '✓' : '✗'} ${DIMENSION_KIND[e.dimension] === 'gate' ? 'GATE ' : 'info '}` +
          `${e.dimension.padEnd(14)} ${e.score.toFixed(2)}` +
          (e.findings.length ? `  — ${e.findings.slice(0, 2).join('; ')}` : ''),
      )
    }
  }

  if (!apply) {
    await recordRun(true)
    for (const g of gated) {
      console.log(`\n▸ ${g.s.name}  [${g.shipped ? 'would ship' : 'WITHHELD'}]`)
      printScorecard(g)
    }
    for (const l of llmSpendLines()) console.log(l)
    console.log(
      `\nSCRIPTS ONLY — nothing synthesized, no R2 object, no narration row. ${withheld.length} withheld by the gate.`,
    )
    return
  }

  /* ── APPLY: synthesize, upload, upsert. The first irreversible step. ── */
  console.log(`\nSynthesizing ${shippedClips.length} clip(s); ${withheld.length} withheld by the gate.`)
  let ttsSpentUsd = 0
  let costCapped = false
  let done = 0
  const results = await mapLimit(shippedClips, TTS_CONCURRENCY(), async (g) => {
    const s = g.s
    try {
      if (maxCostUsd !== Infinity && llmSpentUsd() + ttsSpentUsd >= maxCostUsd) {
        if (!costCapped) {
          costCapped = true
          console.warn(`  ⛔ --max-cost=$${maxCostUsd.toFixed(2)} reached — skipping the rest.`)
        }
        return null
      }
      const clipId = crypto.randomUUID()
      const { audio, durationMs, tail, loudness, takes } = await synthesizeWithTailRetake(
        g.script,
        persona.voice,
        ttsStyleFor(persona.ttsStyle, SCENIC_REGISTER),
        `"${s.name}"`,
      )
      // × `takes` — the synth chain re-rolls a collapsed or overlong take, and billing one per clip
      // hides the retake spend from the running cap. Same text every take, so this is exact.
      ttsSpentUsd += estimateTtsUsd([g.script], persona.ttsStyle.length).usd * takes
      // ⚠ The key stays under the `narration/` prefix — that prefix is the ONLY thing `sweep-orphans`
      // protects, so a clip filed anywhere else is reaped as an orphan on the next sweep.
      const audioUrl = await withRetry(() => uploadAudio(narrationClipKey(s.id, clipId), audio), {
        label: `upload(${s.name})`,
      })
      await withRetry(
        () =>
          db
            .insert(narrations)
            .values({
              poiId: s.id,
              clusterId: null, // the XOR CHECK: this telling is about the POI
              form: 'scenic',
              script: g.script,
              audioUrl,
              audioDurationMs: durationMs,
              // ⚠ NO attribution and NO factsHash — both correct, neither an omission.
              // ATTRIBUTION: `narrations_story_attribution` is a form-CONDITIONAL check precisely
              // because a scenic clip grounds on no Wikipedia prose. Its name and kind come from
              // Wikidata, so there is no CC BY-SA obligation to freeze. ⚠ Widen that check the day a
              // fact-grounded scenic ships (its own comment says so).
              // FACTS_HASH: only a story can go fact-stale. This clip asserts nothing a re-fetch could
              // invalidate, so a hash would be a FALSE staleness signal — it would mark every scenic
              // clip dirty the first time its poi is re-swept, and buy a regeneration that changes
              // nothing.
            })
            .onConflictDoUpdate({
              target: narrations.poiId,
              // `releasedAt` deliberately absent — release is monotonic, so a regen must never
              // un-publish a clip riders already have.
              set: {
                form: 'scenic',
                script: g.script,
                audioUrl,
                audioDurationMs: durationMs,
                updatedAt: new Date(),
              },
            }),
        { label: `upsert scenic(${s.name})` },
      )
      // Both are null when the measurement itself could not run (no ffmpeg probe); recording only real
      // outcomes keeps a missing measurement out of the eval record as a false pass.
      if (tail) tailBySeq.set(g.seq, tail)
      if (loudness) loudnessBySeq.set(g.seq, loudness)
      done++
      console.log(`  [${done}/${shippedClips.length}] ${s.name} (${(durationMs / 1000).toFixed(0)}s)`)
      return { name: s.name, durationMs }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn(`  ⚠ SKIP ${s.name}: synthesis failed (clip dropped) — ${msg.slice(0, 200)}`)
      return null
    }
  })

  const ok = results.filter((r): r is { name: string; durationMs: number } => r !== null)
  const totalSec = ok.reduce((a, r) => a + r.durationMs, 0) / 1000

  await recordRun(false, ok.length)

  for (const g of gated) {
    console.log(`\n▸ ${g.s.name}  [${g.shipped ? 'shipped' : 'WITHHELD'}]`)
    printScorecard(g)
  }
  for (const l of llmSpendLines()) console.log(l)
  console.log(
    `\n✓ ${ok.length}/${shippedClips.length} scenic clip(s) synthesized (${(totalSec / 60).toFixed(1)} min), ` +
      `${withheld.length} withheld. ~$${(llmSpentUsd() + ttsSpentUsd).toFixed(2)} spent.`,
  )
  console.log('  A scenic clip lands STAGED; publish it with the region release in the admin console.')
  console.log('  ⚠ A drive only PLAYS these once its candidates carry `glance: true` — see')
  console.log('    docs/designs/scenic-stops-spec.md §11.10 (the fill pass in engine/drive-select).')
  // "A run that did nothing must not settle GREEN; a paid one reports what it BILLED."
  if (ok.length === 0) throw new Error('No scenic clip was synthesized. Not settling green.')
}

// runJob owns begin → run → finish → exit, so the admin console gets a status row and this stdout.
await runJob(
  'generate_scenic_narrations',
  { dryRun: !apply, targetSlug: scenicTargetRegion, targetId: scenicTargetRegion },
  main,
)
