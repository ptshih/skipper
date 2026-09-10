// generate-cluster-narrations — the FUSED telling for a group of places (phase 4, spec §3).
//
// A cluster is a group a driver experiences as ONE stop (Emerald Bay = Vikingsholm + Fannette Island
// + Eagle Falls). This writes the single telling that covers it: a `narrations` row with `cluster_id`
// set and `poi_id` NULL, grounded on the members' fact sheets through the SAME `mergedFeatures`
// channel the narrator already understands — which is why the fail-closed grounding gate needs no
// change, confirmed on a real take (it caught an ungrounded Sinatra claim unmodified).
//
// ⚠ WHAT IT DOES NOT DO: retire the member clips. Every place in a fused cluster keeps its own
// narration until step 6, deliberately — retiring good audio before hearing its replacement has no
// fallback. `--apply` here only ADDS.
//
// Blast radius: SPENDS $ (LLM + TTS) and MUTATES DB — both in EVERY mode. ⚠ A preview is NOT free
// and NOT read-only: it narrates and scores (an apply minus the TTS) and records the dry eval run.
// What `--apply` gates is the CONTENT — the narration upsert and the R2 write.
//
//   dotenvx run -f .env.development -- bun packages/studio/src/generate-cluster-narrations.ts --limit 1
//   ... --apply             synthesize + upload + upsert (the first irreversible step)
//   --region <slug>         scope to a region's bbox via its members (REQUIRED unless --include-ids)
//   --limit N               only the first N generatable clusters, WIDEST first (cost control)
//   --query <substr>        narrow to cluster titles containing <substr>
//   --include-ids a,b,c     regenerate EXACTLY these cluster ids (skips the region scope + --limit;
//                           implies --force, since you named the set)
//   --force                 re-narrate even clusters whose fused clip is still fresh
//   --max-cost <usd>        stop launching work once spend crosses this

import { inArray, sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import { narrations, poiClusters } from '@skipper/db/schema'
import type { FactSheetEntry } from '@skipper/db/schema'
import { announce, assertReady, day, maxCostFlag, numericFlag, parseFlags } from './pipeline/ops'
import { requireRegionBboxes, requireRegionKey, resolveRegion } from './pipeline/region'
import { regionLabel } from './pipeline/geo'
import { synthesizeWithTailRetake, type TailOutcome } from './pipeline/tts'
import type { LoudnessOutcome } from './pipeline/loudnorm'
import { narrationClipKey, uploadAudio } from './pipeline/storage'
import { factSheetToAttribution } from './pipeline/persist'
import { withRetry } from './pipeline/http'
import { mapLimit } from './pipeline/concurrency'
import { runJob } from './pipeline/job-progress'
import {
  ensurePoiOverridesLoaded,
  OVERRIDE_STALE_LIST_CAP,
  stalePoiOverrideSources,
} from './pipeline/poi-overrides'
import { personaFromKey } from './persona'
import { lengthForRegister, ttsStyleFor } from './models'
import { buildGroundingWell } from './eval/grounding'
import { applyLoudnessOutcomes, applyTailOutcomes } from './eval/tts'
import { clusterIdsInBbox, loadDiversityContext } from './pipeline/diversity-context'
import { gateNarration } from './pipeline/gate'
import { buildScorecard } from './eval/scorecard'
import { DIMENSION_KIND, type StopEval } from './eval/types'
import { recordEvalRun, type ClipIdentity } from './eval/record'
import { llmSpendLines, llmSpentUsd, unpricedModels } from '@skipper/shared'
import { TTS_ESTIMATE_SAFETY, estimateTtsUsd } from './pipeline/spend'
import {
  GROUNDING_EVAL,
  NARRATION_CONCURRENCY,
  TTS_CONCURRENCY,
  WORDS_PER_SECOND,
} from './config'
import {
  clusterGenerationBlock,
  clusterGroundingHash,
  loadClusterMembers,
  nameKey,
  tellableMembers,
  type ClusterMemberRow,
} from './pipeline/cluster'
import type { DeliveryRegister } from '@skipper/shared'

/** Seconds added to the length target per NAMEABLE place beyond the first (spec §3.3). The risk a
 *  fused telling actually runs is NAME DENSITY, not duration — a 180 s telling naming 3 places is
 *  comfortable, a 120 s one naming 9 is a recital — so the aim grows with the names, capped by the
 *  register's own researched ceiling. */
const SECONDS_PER_EXTRA_NAME = 20

interface Fused {
  id: string
  title: string
  highlights: string[]
  dropped: string[]
  subjectPoiId: string | null
  /** The set the telling is written over — well, attribution, facts_hash and geometry ALL derive from
   *  this one array (pipeline/cluster.ts), never from a second query. */
  tellable: ClusterMemberRow[]
  members: ClusterMemberRow[]
  register: DeliveryRegister
  targetSeconds: number
  maxSeconds: number
  lat: number
  lng: number
}

interface GatedFused {
  f: Fused
  seq: number
  script: string | null
  evals: StopEval[]
  shipped: boolean
}

// Parsed at module scope, like the poi generator, so `runJob` can stamp the studio_jobs row before
// main() starts — that row is how the admin console shows status and captures logs at all.
const flags = parseFlags(process.argv.slice(2), { valueFlags: ['region', 'limit', 'query', 'max-cost', 'include-ids'] })
const apply = flags.has('apply')
const maxCostUsd = maxCostFlag(flags)
// ⚠ MUTATES DB unconditionally — a PREVIEW writes rows too. It persists no narration and no R2
// object (that half really is gated on --apply), but it records the dry eval run + its score rows
// (`recordRun(true)`, added so a preview's withheld clips are queryable). The poi path carried the
// same under-declaration and was widened for the same reason; same label, different rows.
announce({ tool: 'generate-cluster-narrations', blast: ['SPENDS $', 'MUTATES DB'], apply })
if (apply) assertReady(['r2', 'tts'])
// A targeted --include-ids run has no region scope, so it keys on nothing and surfaces as "All".
// ⚠ Every other run REQUIRES --region, and this line is where that fails — before main() spends.
const clusterTargetRegion = (flags.value('include-ids') ?? '').trim()
  ? undefined
  : requireRegionKey(flags.value('region'))

async function main(): Promise<void> {
  // Same first move as the solo generator. This CLI never loaded overrides at all, which made it the
  // WORSE half of the same gap: a fused telling speaks its members' text aloud, so an uncorrected
  // member sentence gets baked into a paid clip with nothing anywhere saying so.
  await ensurePoiOverridesLoaded()
  const limit = numericFlag(flags, 'limit', { fallback: 1 })
  const query = flags.value('query')?.toLowerCase()
  // An explicit id list is a TARGETED re-run (regenerate exactly these), so it bypasses the region
  // scope and the limit — the caller has already decided the set.
  const includeIds = (flags.value('include-ids') ?? '').split(',').map((x) => x.trim()).filter(Boolean)
  // `--include-ids` IMPLIES regeneration — you asked for those exact clusters, so don't freshness-skip
  // them. Same rule the solo generator uses, for the same reason.
  const force = flags.has('force') || includeIds.length > 0

  // ⚠ An explicit id list spans NO single region, so it must not resolve one. This used to fall back to
  // a default region slug: a targeted re-run of clusters anywhere in the corpus scored its diversity lint
  // against lake-tahoe's tellings and filed its eval_run under lake-tahoe. The job row already went
  // NULL for this case (`clusterTargetRegion` above); the eval run and the lint did not agree with it.
  // A null bbox loads the WHOLE corpus for diversity — a superset, and more context is never worse —
  // and the admin surfaces a null region as "All", exactly as the solo generator does.
  const isExplicitRun = includeIds.length > 0 && !flags.value('region') && !query
  const region = isExplicitRun ? null : await resolveRegion(flags.value('region'))
  const bbox = region ? requireRegionBboxes(region) : null
  const scopeLabel = region ? region.displayName : 'All (explicit ids)'

  // A cluster is in the region the same geometry-first way everything else is — by where its members
  // are (poi_clusters stores no coordinates, deliberately). Shared with the diversity-context loader,
  // which has to resolve the exact same membership for fused tellings. Only consulted on the
  // region-scoped path — an explicit run selects by id and never reads it.
  const inRegion = bbox ? clusterIdsInBbox(bbox) : null
  const clusters = await db
    .select({
      id: poiClusters.id,
      title: poiClusters.title,
      treatment: poiClusters.treatment,
      highlights: poiClusters.highlights,
      dropped: poiClusters.dropped,
      subjectPoiId: poiClusters.subjectPoiId,
    })
    .from(poiClusters)
    // ⚠ NO `treatment` filter, and that is deliberate (2026-07-30, founder go). Phase 4 shipped
    // CLUSTER-ONLY because a DISTRICT "cannot be a point trigger" — but `treatment` is a NAMING
    // verdict (`highlights.length` against the clip band), never a geometry one, and letting it decide
    // triggerability conflated the two. `clusterGenerationBlock` answers the geometry question
    // directly and correctly. Measured over the 5 districts: three PASS the 600 m gate
    // (Virginia City 265 m — tighter than Emerald Bay, which already shipped; Historic Downtown
    // Carson City 411 m; Historic Carson City 552 m) and two do not (Reno's Historic Homes 698 m,
    // Downtown Reno 914 m). The gate defers those two exactly as it defers the UNR campus.
    .where(
      includeIds.length > 0
        ? inArray(poiClusters.id, includeIds)
        : sql`${poiClusters.id} in ${inRegion!}`,
    )

  const membersByCluster = await loadClusterMembers(clusters.map((c) => c.id))
  const queue: Fused[] = []
  const blocked: string[] = []
  for (const c of clusters) {
    if (query && !c.title.toLowerCase().includes(query)) continue
    const members = membersByCluster.get(c.id) ?? []
    const block = clusterGenerationBlock(members, c.dropped ?? [])
    if (block) {
      blocked.push(`  [${c.treatment}] ${c.title} — ${block}`)
      continue
    }
    const tellable = tellableMembers(members)
    // §3.1: `highlights` is a SUBSET COUNT for the length band, never a lookup key — the names are the
    // model's own free text and match `pois.name` only ~89% of the time.
    const nameable = Math.max(1, (c.highlights ?? []).length)
    const subject = tellable.find((m) => m.id === c.subjectPoiId)
    const register: DeliveryRegister = subject?.deliveryRegister ?? 'story'
    const band = lengthForRegister(register)
    queue.push({
      id: c.id,
      title: c.title,
      highlights: c.highlights ?? [],
      dropped: c.dropped ?? [],
      subjectPoiId: c.subjectPoiId,
      tellable,
      members,
      register,
      targetSeconds: Math.min(band.maxSeconds, band.targetSeconds + SECONDS_PER_EXTRA_NAME * (nameable - 1)),
      maxSeconds: band.maxSeconds,
      lat: tellable.reduce((s, m) => s + (m.speakableLat ?? m.lat), 0) / tellable.length,
      lng: tellable.reduce((s, m) => s + (m.speakableLng ?? m.lng), 0) / tellable.length,
    })
  }

  // ── Freshness ───────────────────────────────────────────────────────────────────────────────────
  // ⚠ This generator had NO freshness gate at all. Every `--apply` re-narrated, re-gated and
  // re-synthesized EVERY generatable cluster, overwriting `narrations.script` in place — and there is
  // no history table, so that regeneration cannot be undone, only fixed forward (the ops SOP's first
  // "judging a paid run" trap). `clusterGroundingHash` was written for precisely this comparison —
  // its own docstring tells the caller to consult freshness — and until now was only ever WRITTEN,
  // never read back, which is the shape of a design that was finished everywhere except its use.
  //
  // Same contract as the solo generator: FRESH = a fused clip already exists AND its stored
  // `facts_hash` equals the one this run would stamp. A null hash is never fresh (nothing tellable),
  // which is why the docstring insists the block above runs first — a null reads as permanently stale
  // and would re-queue the cluster for paid narration forever.
  const clipHashByCluster = new Map<string, string | null>()
  if (queue.length > 0) {
    const existing = await db
      .select({ clusterId: narrations.clusterId, factsHash: narrations.factsHash })
      .from(narrations)
      .where(inArray(narrations.clusterId, queue.map((q) => q.id)))
    for (const r of existing) if (r.clusterId) clipHashByCluster.set(r.clusterId, r.factsHash)
  }
  const generatable: Fused[] = []
  let freshSkipped = 0
  for (const f of queue) {
    const hash = clusterGroundingHash(f, f.members)
    const clipHash = clipHashByCluster.get(f.id)
    if (!force && hash !== null && clipHash !== undefined && clipHash === hash) {
      freshSkipped++
      continue
    }
    generatable.push(f)
  }

  console.log(`\nRegion: ${scopeLabel}  ·  ${clusters.length} group(s) in scope (clusters AND districts — the GATE decides, not the treatment)`)
  console.log(
    `${generatable.length} to generate, ${freshSkipped} already fresh (skipped${force ? '' : ' — pass --force to re-narrate'}), ${blocked.length} blocked:`,
  )
  for (const b of blocked.slice(0, 4)) console.log(b)
  if (blocked.length > 4) console.log(`  …+${blocked.length - 4} more`)

  // Widest first — the density stress case is the one worth reading, and the one worth spending on
  // first when the run is capped.
  generatable.sort((a, b) => b.tellable.length - a.tellable.length)
  const picked = includeIds.length > 0 ? generatable : generatable.slice(0, Math.max(0, limit))

  // ⚠ OVERRIDE-STALE members. Wikipedia corrections need refetching and Wikidata corrections need re-enrichment; a member whose
  // facts predate its newest correction still holds the SUPERSEDED text — and a fused telling reads
  // that text out under the group's name. Checked over `tellable`, the set the telling is actually
  // written over. ADVISORY: it warns and does not block, matching the solo generator — halting a
  // legitimate paid run on a stamp comparison is the worse failure, and re-fetching inside a
  // generator is a mutation nobody asked for.
  const staleMembers = queue.flatMap((f) =>
    f.tellable
      .filter((m) => stalePoiOverrideSources(m).length > 0)
      .map((m) => ({ group: f.title, m })),
  )
  if (staleMembers.length > 0) {
    console.warn(
      `\n⚠ OVERRIDE-STALE: ${staleMembers.length} member(s) of the eligible group(s) carry a curated fact ` +
        `CORRECTION newer than their cached facts — narrating now bakes the superseded sentence into a paid clip:`,
    )
    for (const { group, m } of staleMembers.slice(0, OVERRIDE_STALE_LIST_CAP)) {
      console.warn(
        `  • [${group}] ${m.name} (${m.id}) — facts fetched ${day(m.factsFetchedAt)}, ` +
          `stale sources: ${stalePoiOverrideSources(m).map((s) => `${s.source}:${s.sourceId} cached ${day(s.cachedAt)}, corrected ${day(s.correctedAt)}`).join('; ')}`,
      )
    }
    if (staleMembers.length > OVERRIDE_STALE_LIST_CAP) {
      console.warn(`  …and ${staleMembers.length - OVERRIDE_STALE_LIST_CAP} more.`)
    }
    console.warn(
      `  Fix: refetch-poi.ts <poiId> --apply (FREE), then enrich-pois.ts --include-ids <poiId> --force --apply ` +
        `(SPENDS — Wikidata-only corrections need re-enrichment; Wikipedia needs both).\n` +
        `  Advisory only — this run is NOT blocked.`,
    )
  }
  if (picked.length === 0) return console.log('\nNothing to narrate.')
  console.log(`\nNarrating + gating ${picked.length} of them (${includeIds.length > 0 ? 'explicit ids' : `--limit ${limit}`}).\n`)

  const persona = personaFromKey('skipper')

  // ── Diversity context: every telling already in this region, fused AND solo ─────────────────────
  // The cross-clip lint can only see repetition it is handed, and this generator used to hand it a
  // single-element array — in which every cross-clip rule is a no-op by arithmetic. Solo generation was
  // fixed in 0f80d97; this is the same fix for the fused path.
  // ⚠ Deliberately BOTH kinds, not just fused: a fused telling replaces its members on the read paths,
  // so one that echoes the member clips it retired is the same defect wearing a hat — and the member
  // audio still exists, so a rider with a saved drive can hear both.
  // ⚠ A fused narration carries `poi_id` NULL (`narrations_subject_xor`), so it has no poi to take a
  // bbox from — reaching for one and coalescing the NULL away would have silently dropped every fused
  // clip from its own context. Region membership resolves per subject kind: solo by its poi's point,
  // fused by the same `inRegion` member-geometry the cluster query above uses.
  const diversityContext: string[] = await loadDiversityContext(bbox)
  console.log(`Diversity context: ${diversityContext.length} existing tellings ${region ? 'in this region' : 'across the corpus'}.\n`)

  /** The nameable/background split (§3.2), plus the well BOTH the narrator and the judge see. */
  async function inputsFor(f: Fused) {
    // ⚠ Keyed off `dropped`, NOT `highlights`. Both lists are the model's free text, but measured live
    // `dropped` matches `pois.name` 68 of 69 while `highlights` manages 165 of 186 — so the fuzzy match
    // goes on the near-exact list, and a miss fails SAFE (an unmatched member stays NAMEABLE, which is
    // the old behaviour, rather than silently muting a place the telling is for).
    const droppedKeys = new Set(f.dropped.map(nameKey))
    const matched = new Set<string>()
    const mergedFeatures = f.tellable
      .map((m) => {
        const key = nameKey(m.name)
        const background = droppedKeys.has(key)
        if (background) matched.add(key)
        return { name: m.name, facts: (m.factSheet ?? []).map((x) => x.text), background }
      })
      .filter((m) => m.facts.length > 0)
    const unmatched = f.dropped.filter((d) => !matched.has(nameKey(d)))
    const base = {
      region: await regionLabel(f.lat, f.lng),
      stopType: 'story' as const,
      place: { name: f.title },
      mergedFeatures,
      targetSeconds: f.targetSeconds,
      maxSeconds: f.maxSeconds,
      selfContained: true,
    }
    // The judge reads the SAME mergedFeatures, so its well can't drift from the narrator's sheet —
    // background members included, since they are grounded even though their names are not spoken.
    const well = buildGroundingWell({ stopType: 'story', name: f.title, facts: [], mergedFeatures })
    return { base, well, mergedFeatures, unmatched }
  }

  async function gateOne(f: Fused, seq: number): Promise<GatedFused> {
    const { base, well, mergedFeatures, unmatched } = await inputsFor(f)
    if (unmatched.length) {
      console.warn(`  ⚠ ${f.title}: ${unmatched.length} drop entr(ies) matched no member — they stay NAMEABLE: ${unmatched.join(' · ')}`)
    }
    const { script, evals, shipped } = await gateNarration({
      seq,
      name: f.title,
      base,
      well,
      targetSeconds: f.targetSeconds,
      maxSeconds: f.maxSeconds,
      diversityContext,
      systemPrompt: persona.systemPrompt,
    })
    const named = mergedFeatures.filter((m) => !m.background).length
    console.log(
      `  ${f.title} — ${named} nameable / ${mergedFeatures.length - named} background · ` +
        `${shipped ? `${script.split(/\s+/).filter(Boolean).length} words` : 'WITHHELD (gate)'}`,
    )
    return { f, seq, script, evals, shipped }
  }

  // ⚠ COST CEILING, and it sits HERE — above the gating loop — rather than after the preview exit
  // where the poi generator puts its equivalent. That difference is the whole point: a fused PREVIEW
  // narrates and scores (only persistence is gated), so narration money is spent before the preview
  // ever returns. Until this landed, --max-cost bounded nothing on this path but TTS: the first cap
  // check was inside the synthesis loop, so a capped run paid for every narration and its Opus
  // grounding judge first, then discovered the ceiling.
  //
  // The TTS dummy clip must carry real WORDS — estimateTtsUsd derives audio tokens from the word
  // count, so a space-less blob reads as ONE word and collapses the estimate ~100× (that mistake
  // under-quoted a full-region poi run by ~$28 and silently defeated the cap).
  const llmUsdPerClip = GROUNDING_EVAL() ? 0.15 : 0.1
  const ttsPreEst = estimateTtsUsd(
    picked.map((f) => Array(Math.round(f.targetSeconds * WORDS_PER_SECOND)).fill('word').join(' ')),
    persona.ttsStyle.length,
  )
  const estSpendUsd = picked.length * llmUsdPerClip + ttsPreEst.usd * TTS_ESTIMATE_SAFETY
  console.log(
    `\nEstimated spend: narration+gate ~$${(picked.length * llmUsdPerClip).toFixed(2)} ± half ` +
      `+ TTS ~$${ttsPreEst.usd.toFixed(2)} (${picked.length} fused clip(s)` +
      `${GROUNDING_EVAL() ? '' : '; grounding gate OFF'})`,
  )
  if (estSpendUsd > maxCostUsd) {
    // THROW, not return: runJob's catch settles the studio_jobs row as FAILED. A bare return would
    // record 'succeeded' — indistinguishable from a clean run that did the work.
    throw new Error(
      `⛔ Estimated spend ~$${estSpendUsd.toFixed(2)} exceeds --max-cost=$${maxCostUsd.toFixed(2)} — aborting before any spend. Narrow with --limit or raise --max-cost.`,
    )
  }

  const gated = await mapLimit(picked, NARRATION_CONCURRENCY(), async (f, i): Promise<GatedFused> => {
    try {
      return await gateOne(f, i)
    } catch (e) {
      // Fault isolation: one clip's narrate/eval throw must not abort a paid batch.
      const msg = e instanceof Error ? e.message : String(e)
      console.warn(`  ⚠ ${f.title}: narrate/eval failed — WITHHELD. ${msg.slice(0, 160)}`)
      return {
        f,
        seq: i,
        script: null,
        shipped: false,
        evals: [{ seq: i, dimension: 'grounding', pass: false, score: 0, findings: [`gate error: ${msg.slice(0, 200)}`] }],
      }
    }
  })

  const shippedClips = gated.filter((g): g is GatedFused & { script: string } => g.shipped && g.script !== null)
  const withheld = gated.filter((g) => !g.shipped)
  const tailBySeq = new Map<number, TailOutcome>()
  const loudnessBySeq = new Map<number, LoudnessOutcome>()

  // Observability: the same eval record the poi path writes, with the CLUSTER as the case identity.
  //
  // ⚠ Called on EVERY exit, not just the applied one — a preview and an abort are exactly the runs you
  // most want a scorecard for, since they are how you inspect quality before paying for TTS. The poi
  // path has always recorded its dry runs ("observability without synth/persist"); this path recorded
  // only on success, so a fused preview left nothing in eval_runs and its withheld clips were flagged
  // nowhere queryable. `tailBySeq`/`loudnessBySeq` are empty on a dry run, which the apply- helpers
  // treat as a no-op, exactly as they do for the poi path.
  const recordRun = (dryRun: boolean, synthesized?: number): Promise<unknown> =>
    recordEvalRun({
      region: region ? region.slug : null,
      kind: 'generation',
      dryRun,
      scorecard: buildScorecard({
        slug: region ? region.slug : null,
        runName: `fused clusters — ${scopeLabel}`,
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
          { poiId: null, clusterId: g.f.id, qid: null, name: g.f.title, withheld: !g.shipped, script: g.shipped ? null : g.script },
        ]),
      ),
    }).catch((e) => console.warn(`  ⚠ eval record failed (observability only): ${e}`))

  const printScorecard = (g: GatedFused) => {
    for (const e of g.evals) {
      console.log(
        `  ${e.pass ? '✓' : '✗'} ${DIMENSION_KIND[e.dimension] === 'gate' ? 'GATE ' : 'info '}` +
          `${e.dimension.padEnd(14)} ${e.score.toFixed(2)}` +
          (e.findings.length ? `  — ${e.findings.slice(0, 2).join('; ')}` : ''),
      )
    }
  }

  if (!apply) {
    for (const g of gated) {
      console.log(`\n${'='.repeat(78)}\n▸ ${g.f.title}  [${g.shipped ? 'would ship' : 'WITHHELD'}]`)
      console.log(`  highlights: ${g.f.highlights.join(' · ') || '—'}`)
      if (g.f.dropped.length) console.log(`  dropped:    ${g.f.dropped.join(' · ')}`)
      if (g.script) {
        const words = g.script.split(/\s+/).filter(Boolean).length
        console.log(`\n${g.script}\n`)
        console.log(`  ${words} words ≈ ${Math.round(words / WORDS_PER_SECOND)}s spoken (aim ${g.f.targetSeconds}s)`)
      }
      printScorecard(g)
    }
    await recordRun(true) // a DRY eval run — observability without synth/persist
    for (const l of llmSpendLines()) console.log(l)
    console.log(
      `\nSpent $${llmSpentUsd().toFixed(2)}. PREVIEW — no audio synthesized, no narration persisted ` +
        `(a dry eval run IS recorded, so this shows up in the admin Evals view). Re-run with --apply.`,
    )
    return
  }

  // Fail-safe the cap on an UNPRICED model: a model we called with no MODEL_PRICING entry tallies its
  // tokens but reads $0, so llmSpentUsd() silently under-counts and --max-cost can't bind. Abort loudly
  // rather than spend TTS under a defeated cap. (No-op when --max-cost is unset, or all models priced.)
  //
  // ⚠ This guard was in `generate-narrations.ts` and NOT here for as long as this file has existed —
  // the two generators share ~90 lines of hand-copied gate wiring, and this is what that duplication
  // cost: the fused path could run a whole synthesis under a cap that silently read $0. Whatever else
  // changes, these two must not disagree about when spending is allowed.
  const unpriced = unpricedModels()
  if (maxCostUsd !== Infinity && unpriced.length > 0) {
    await recordRun(true) // the gating work is done and paid for — keep its scorecard
    throw new Error(
      `⛔ --max-cost is set but these models are UNPRICED (their spend reads $0, defeating the cap): ${unpriced.join(', ')}. Add them to MODEL_PRICING (@skipper/shared) or re-run without --max-cost.`,
    )
  }

  // The gate's retakes can overrun the pre-flight estimate, so re-check against ACTUAL narration spend
  // before committing to the TTS. Mirrors the poi path; the eval run is recorded first so a run that
  // aborts here still leaves its scorecard.
  const ttsEstNow = estimateTtsUsd(shippedClips.map((g) => g.script), persona.ttsStyle.length)
  const ttsCapEst = ttsEstNow.usd * TTS_ESTIMATE_SAFETY // honour the cap against the upper bound
  if (llmSpentUsd() + ttsCapEst > maxCostUsd) {
    await recordRun(true)
    throw new Error(
      `⛔ Spend after narrate+gate ($${llmSpentUsd().toFixed(2)}) + est TTS ($${ttsCapEst.toFixed(2)}, incl. safety margin) exceeds --max-cost=$${maxCostUsd.toFixed(2)} — aborting before synthesis. Eval recorded.`,
    )
  }

  /* ── APPLY: synthesize, upload, upsert. The first irreversible step. ── */
  console.log(`\nSynthesizing ${shippedClips.length} clip(s); ${withheld.length} withheld by the gate.`)
  let ttsSpentUsd = 0
  let costCapped = false
  let done = 0
  const results = await mapLimit(shippedClips, TTS_CONCURRENCY(), async (g) => {
    const f = g.f
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
        ttsStyleFor(persona.ttsStyle, f.register),
        `"${f.title}"`,
      )
      // × `takes` — the synth chain re-rolls on an overlong or collapsed take (see tts.ts); billing one
      // per clip hid the retake spend from the running cap. Same text every take, so this is exact.
      ttsSpentUsd += estimateTtsUsd([g.script], persona.ttsStyle.length).usd * takes
      // ⚠ The key stays under the `narration/` prefix — that prefix is the ONLY thing `sweep-orphans`
      // protects, so a cluster clip filed anywhere else would be reaped as an orphan on the next sweep.
      const audioUrl = await withRetry(() => uploadAudio(narrationClipKey(f.id, clipId), audio), {
        label: `upload(${f.title})`,
      })
      // CC BY-SA is legal, not optional, and a fused clip draws on EVERY tellable member — including
      // the background ones, whose facts are in the well even though their names are never spoken. The
      // union dedupes by (source, sourceId); `narrations_story_attribution` makes it structural.
      const sheets: FactSheetEntry[] = f.tellable.flatMap((m) => m.factSheet ?? [])
      const retrievedAt = f.tellable.reduce<Date | null>(
        (max, m) => (m.enrichedAt && (!max || m.enrichedAt > max) ? m.enrichedAt : max),
        null,
      )
      const attribution = factSheetToAttribution(sheets, (retrievedAt ?? new Date()).toISOString())
      // The staleness fingerprint over the SAME tellable set the well was built from (§6).
      const factsHash = clusterGroundingHash(f, f.members)
      await withRetry(
        () =>
          db
            .insert(narrations)
            .values({
              clusterId: f.id,
              poiId: null, // the XOR CHECK: a fused telling is about the CLUSTER, never a member
              form: 'story',
              script: g.script,
              audioUrl,
              audioDurationMs: durationMs,
              attribution,
              factsHash,
            })
            .onConflictDoUpdate({
              target: narrations.clusterId,
              // `releasedAt` is deliberately absent — release is monotonic, so a regen must never
              // un-publish a clip riders already have.
              set: {
                form: 'story',
                script: g.script,
                audioUrl,
                audioDurationMs: durationMs,
                attribution,
                factsHash,
                updatedAt: new Date(),
              },
            }),
        { label: `upsert fused(${f.title})` },
      )
      // Both are null when the measurement itself couldn't run (no ffmpeg probe); recording only the
      // real outcomes keeps a missing measurement out of the eval record as a false pass.
      if (tail) tailBySeq.set(g.seq, tail)
      if (loudness) loudnessBySeq.set(g.seq, loudness)
      done++
      console.log(`  [${done}/${shippedClips.length}] ${f.title} (${(durationMs / 1000).toFixed(0)}s)`)
      return { title: f.title, durationMs }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn(`  ⚠ SKIP ${f.title}: synthesis failed (clip dropped) — ${msg.slice(0, 200)}`)
      return null
    }
  })

  const ok = results.filter((r): r is { title: string; durationMs: number } => r !== null)
  const totalSec = ok.reduce((a, r) => a + r.durationMs, 0) / 1000

  await recordRun(false, ok.length)

  for (const g of gated) {
    console.log(`\n▸ ${g.f.title}  [${g.shipped ? 'shipped' : 'WITHHELD'}]`)
    printScorecard(g)
  }
  for (const l of llmSpendLines()) console.log(l)
  console.log(
    `\n✓ ${ok.length}/${shippedClips.length} fused clip(s) synthesized (${(totalSec / 60).toFixed(1)} min), ` +
      `${withheld.length} withheld. ~$${(llmSpentUsd() + ttsSpentUsd).toFixed(2)} spent.`,
  )
  console.log('  Member clips are UNTOUCHED — retiring them is step 6, after a listen.')
  console.log('  A fused clip lands STAGED; publish it with the region release in the admin console.')
}

// runJob owns begin → run → finish → exit, so the admin console gets a status row and this script's
// stdout. Skipping it is why this generator was CLI-only: it was dispatchable in principle and
// invisible in practice.
await runJob(
  'generate_cluster_narrations',
  { dryRun: !apply, targetSlug: clusterTargetRegion, targetId: clusterTargetRegion },
  main,
)
