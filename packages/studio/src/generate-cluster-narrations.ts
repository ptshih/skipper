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
// Blast radius: SPENDS $ (LLM + TTS) and MUTATES DB + WRITES R2 on `--apply`. ⚠ A preview is NOT
// free: it narrates and scores, so it costs an apply minus the TTS. Only the persistence is gated.
//
//   dotenvx run -f .env.development -- bun packages/studio/src/generate-cluster-narrations.ts --limit 1
//   ... --apply             synthesize + upload + upsert (the first irreversible step)
//   --region <slug>         scope to a region's bbox via its members (default: lake-tahoe)
//   --limit N               only the first N generatable clusters, WIDEST first (cost control)
//   --query <substr>        narrow to cluster titles containing <substr>
//   --include-ids a,b,c     regenerate EXACTLY these cluster ids (skips the region scope + --limit)
//   --max-cost <usd>        stop launching work once spend crosses this

import { and, between, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import { narrations, poiClusters, pois } from '@skipper/db/schema'
import type { FactSheetEntry } from '@skipper/db/schema'
import { announce, assertReady, maxCostFlag, parseFlags } from './pipeline/ops'
import { resolveRegion, requireRegionBbox } from './pipeline/region'
import { regionLabel } from './pipeline/geo'
import { narrateStop } from './pipeline/narrate'
import { synthesizeWithTailRetake, type TailOutcome } from './pipeline/tts'
import type { LoudnessOutcome } from './pipeline/loudnorm'
import { narrationClipKey, uploadAudio } from './pipeline/storage'
import { factSheetToAttribution } from './pipeline/persist'
import { withRetry } from './pipeline/http'
import { mapLimit } from './pipeline/concurrency'
import { personaFromKey } from './persona'
import { getAnthropic, lengthForRegister, ttsStyleFor } from './models'
import { buildGroundingWell, evaluateGrounding } from './eval/grounding'
import { applyLoudnessOutcomes, applyTailOutcomes, evaluateTts } from './eval/tts'
import { evaluateDiversityAgainst } from './eval/diversity'
import { evaluateLaterality } from './eval/laterality'
import { evaluatePacing } from './eval/pacing'
import { optimize } from './eval/optimize'
import { exciseUngrounded, makeExciseCall } from './eval/excise'
import { buildScorecard } from './eval/scorecard'
import { DIMENSION_KIND, type StopEval } from './eval/types'
import { recordEvalRun, type ClipIdentity } from './eval/record'
import { estimateTtsUsd, llmSpendLines, llmSpentUsd } from './pipeline/spend'
import {
  DEFAULT_REGION_SLUG,
  GROUNDING_EVAL,
  GROUNDING_REGEN_MAX_ROUNDS,
  NARRATION_CONCURRENCY,
  TTS_CONCURRENCY,
  WORDS_PER_SECOND,
} from './config'
import {
  clusterGenerationBlock,
  clusterGroundingHash,
  loadClusterMembers,
  tellableMembers,
  type ClusterMemberRow,
} from './pipeline/cluster'
import type { DeliveryRegister } from '@skipper/shared'

/** Seconds added to the length target per NAMEABLE place beyond the first (spec §3.3). The risk a
 *  fused telling actually runs is NAME DENSITY, not duration — a 180 s telling naming 3 places is
 *  comfortable, a 120 s one naming 9 is a recital — so the aim grows with the names, capped by the
 *  register's own researched ceiling. */
const SECONDS_PER_EXTRA_NAME = 20

/** Fold a name for comparing the classifier's free-text lists against `pois.name`: case- and
 *  punctuation-insensitive, whitespace collapsed. Same shape as `pipeline/clustering`'s `titleKey`,
 *  kept local because that one folds TITLES and this one folds place names — one changing should not
 *  silently move the other. */
const nameKey = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

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

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2), { valueFlags: ['region', 'limit', 'query', 'max-cost', 'include-ids'] })
  const apply = flags.has('apply')
  const maxCostUsd = maxCostFlag(flags)
  announce({ tool: 'generate-cluster-narrations', blast: apply ? ['SPENDS $', 'MUTATES DB'] : ['SPENDS $'], apply })
  if (apply) assertReady(['r2', 'tts'])

  const region = await resolveRegion(flags.value('region') ?? DEFAULT_REGION_SLUG)
  const bbox = requireRegionBbox(region)
  const limit = Number(flags.value('limit') ?? 1)
  const query = flags.value('query')?.toLowerCase()
  // An explicit id list is a TARGETED re-run (regenerate exactly these), so it bypasses the region
  // scope and the limit — the caller has already decided the set.
  const includeIds = (flags.value('include-ids') ?? '').split(',').map((x) => x.trim()).filter(Boolean)

  // A cluster is in the region the same geometry-first way everything else is — by where its members
  // are (poi_clusters stores no coordinates, deliberately).
  const inRegion = db
    .selectDistinct({ id: pois.clusterId })
    .from(pois)
    .where(
      and(
        isNotNull(pois.clusterId),
        between(pois.lat, bbox.swLat, bbox.neLat),
        between(pois.lng, bbox.swLng, bbox.neLng),
      ),
    )
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
        : sql`${poiClusters.id} in ${inRegion}`,
    )

  const membersByCluster = await loadClusterMembers(clusters.map((c) => c.id))
  const queue: Fused[] = []
  const blocked: string[] = []
  for (const c of clusters) {
    if (query && !c.title.toLowerCase().includes(query)) continue
    const members = membersByCluster.get(c.id) ?? []
    const block = clusterGenerationBlock(members)
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

  console.log(`\nRegion: ${region.displayName}  ·  ${clusters.length} group(s) in scope (clusters AND districts — the GATE decides, not the treatment)`)
  console.log(`${queue.length} generatable, ${blocked.length} blocked:`)
  for (const b of blocked.slice(0, 4)) console.log(b)
  if (blocked.length > 4) console.log(`  …+${blocked.length - 4} more`)

  // Widest first — the density stress case is the one worth reading, and the one worth spending on
  // first when the run is capped.
  queue.sort((a, b) => b.tellable.length - a.tellable.length)
  const picked = includeIds.length > 0 ? queue : queue.slice(0, Math.max(0, limit))
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
  const soloIn = db
    .selectDistinct({ id: pois.id })
    .from(pois)
    .where(and(between(pois.lat, bbox.swLat, bbox.neLat), between(pois.lng, bbox.swLng, bbox.neLng)))
  const diversityContext: string[] = (
    await withRetry(
      () =>
        db
          .select({ script: narrations.script })
          .from(narrations)
          .where(
            and(
              isNotNull(narrations.script),
              sql`(${narrations.poiId} in ${soloIn} or ${narrations.clusterId} in ${inRegion})`,
            ),
          ),
      { label: 'load diversity context' },
    )
  )
    .map((r) => r.script)
    .filter((s): s is string => !!s)
  console.log(`Diversity context: ${diversityContext.length} existing tellings in this region.\n`)

  /** The nameable/background split (§3.2), plus the well BOTH the narrator and the judge see. */
  function inputsFor(f: Fused) {
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
      region: regionLabel(f.lat, f.lng),
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
    const { base, well, mergedFeatures, unmatched } = inputsFor(f)
    if (unmatched.length) {
      console.warn(`  ⚠ ${f.title}: ${unmatched.length} drop entr(ies) matched no member — they stay NAMEABLE: ${unmatched.join(' · ')}`)
    }
    const evaluate = async (script: string): Promise<StopEval[]> => {
      const evals: StopEval[] = [
        evaluateTts({ seq, script }),
        // Scored against the rest of the region, not against itself — see `diversityContext` above.
        ...evaluateDiversityAgainst({ seq, stopType: 'story', script }, diversityContext),
        evaluateLaterality({ seq, script }),
        evaluatePacing({ seq, script, targetSeconds: f.targetSeconds, maxSeconds: f.maxSeconds }),
      ]
      if (GROUNDING_EVAL()) {
        evals.push(await evaluateGrounding({ seq, stopType: 'story', placeName: f.title, script, well, region: base.region }))
      }
      return evals
    }
    // Same asymmetry as the poi path: an ungrounded claim is EXCISED from the prior take rather than
    // re-rolled (re-rolling just reaches for a different flourish); everything else re-narrates.
    const exciseCall = makeExciseCall(() => getAnthropic('grounding excision'))
    const regenerate = async (avoid: string[], prev: string): Promise<string> => {
      const ungrounded = avoid.filter((a) => a.startsWith('ungrounded place-claim'))
      if (ungrounded.length > 0) {
        console.log(`  ✂ ${f.title}: excising ${ungrounded.length} ungrounded claim(s)`)
        return exciseUngrounded(prev, ungrounded, well, exciseCall)
      }
      return (await narrateStop({ ...base, avoid }, persona.systemPrompt)).script
    }
    const { script: initial } = await narrateStop(base, persona.systemPrompt)
    const result = await optimize(initial, { evaluate, regenerate, maxRounds: GROUNDING_REGEN_MAX_ROUNDS })
    const shipped = result.evals.filter((e) => DIMENSION_KIND[e.dimension] === 'gate').every((e) => e.pass)
    // Feed a shipped take back in so later clips in THIS batch are checked against it too — the 31
    // fused clips were generated in one run, so without this they only ever see the pre-existing corpus
    // and can converge on each other freely. Best-effort: generation is concurrent, so how much context
    // a clip sees depends on completion order (advisory scoring only; gates are per-clip).
    if (shipped && result.item) diversityContext.push(result.item)
    const named = mergedFeatures.filter((m) => !m.background).length
    console.log(
      `  ${f.title} — ${named} nameable / ${mergedFeatures.length - named} background · ` +
        `${shipped ? `${result.item.split(/\s+/).filter(Boolean).length} words` : 'WITHHELD (gate)'}`,
    )
    return { f, seq, script: result.item, evals: result.evals, shipped }
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
    for (const l of llmSpendLines()) console.log(l)
    console.log(`\nSpent $${llmSpentUsd().toFixed(2)}. PREVIEW — nothing written. Re-run with --apply to synthesize + persist.`)
    return
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
      const { audio, durationMs, tail, loudness } = await synthesizeWithTailRetake(
        g.script,
        persona.voice,
        ttsStyleFor(persona.ttsStyle, f.register),
        `"${f.title}"`,
      )
      ttsSpentUsd += estimateTtsUsd([g.script], persona.ttsStyle.length).usd
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

  // Observability: the same eval record the poi path writes, with the CLUSTER as the case identity.
  const stops = applyLoudnessOutcomes(applyTailOutcomes(gated.flatMap((g) => g.evals), tailBySeq), loudnessBySeq)
  await recordEvalRun({
    region: region.slug,
    kind: 'generation',
    dryRun: false,
    scorecard: buildScorecard({
      slug: region.slug,
      runName: `fused clusters — ${region.displayName}`,
      evaluatedAt: new Date().toISOString(),
      stops,
    }),
    total: gated.length,
    shipped: ok.length,
    withheld: withheld.length,
    identityBySeq: new Map<number, ClipIdentity>(
      gated.map((g) => [
        g.seq,
        { poiId: null, clusterId: g.f.id, qid: null, name: g.f.title, withheld: !g.shipped, script: g.shipped ? null : g.script },
      ]),
    ),
  }).catch((e) => console.warn(`  ⚠ eval record failed (observability only): ${e}`))

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

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
