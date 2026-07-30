// generate-cluster-narrations — the FUSED telling for a group of places (phase 4, spec §3).
//
// A cluster is a group a driver experiences as ONE stop (Emerald Bay = Vikingsholm + Fannette Island
// + Eagle Falls). This writes the single telling that covers it: a `narrations` row with `cluster_id`
// set and `poi_id` NULL, grounded on the members' fact sheets through the SAME
// `mergedFeatures` channel the narrator already understands — the happiest finding in the design, and
// the reason the fail-closed grounding gate needs no change.
//
// ⚠ PREVIEW-ONLY TODAY. It narrates, scores, and PRINTS. The synthesize-and-persist half (TTS →
// loudnorm → R2 → upsert on `narrations_cluster_uq`) is step 4 of the build order and is deliberately
// not here: the point of this pass is to read a fused telling before committing ~$12-16 and the first
// irreversible audio. There is no `--apply`; adding one is the next commit, not a flag flip.
//
// ⚠ What the first run proved (Stateline, 2026-07-30): the model names by FACT RICHNESS, not by the
// group's naming evidence — it named 2 of 4 DROPPED members and skipped 3 of 5 highlights. So spec
// §3.2's "ground on all, name only `highlights`" asymmetry is load-bearing and has no channel yet:
// `mergedFeatures` tells the narrator "you MAY name each". Fix that before any --apply.
//
// Blast radius: SPENDS $ (LLM only — one narration call per cluster, plus the grounding judge when
// SKIPPER_GROUNDING_EVAL is on). Writes NOTHING: no DB, no R2, no eval_runs.
//
//   dotenvx run -f .env.development -- bun packages/studio/src/generate-cluster-narrations.ts --limit 1
//   --region <slug>      scope to a region's bbox via its members (default: lake-tahoe)
//   --limit N            narrate only the first N generatable clusters (cost control)
//   --query <substr>     narrow to cluster titles containing <substr>

import { and, between, eq, isNotNull, sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import { poiClusters, pois } from '@skipper/db/schema'
import { announce, parseFlags } from './pipeline/ops'
import { resolveRegion, requireRegionBbox } from './pipeline/region'
import { regionLabel } from './pipeline/geo'
import { narrateStop } from './pipeline/narrate'
import { withRetry } from './pipeline/http'
import { personaFromKey } from './persona'
import { lengthForRegister } from './models'
import { buildGroundingWell, evaluateGrounding } from './eval/grounding'
import { evaluateTts } from './eval/tts'
import { evaluateDiversity } from './eval/diversity'
import { evaluateLaterality } from './eval/laterality'
import { evaluatePacing } from './eval/pacing'
import { DIMENSION_KIND, type StopEval } from './eval/types'
import { llmSpendLines, llmSpentUsd } from './pipeline/spend'
import { DEFAULT_REGION_SLUG, GROUNDING_EVAL, WORDS_PER_SECOND } from './config'
import { clusterGenerationBlock, loadClusterMembers, tellableMembers, type ClusterMemberRow } from './pipeline/cluster'
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

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2), { valueFlags: ['region', 'limit', 'query'] })
  // apply:false ALWAYS — there is no --apply here (see the header). The preamble's "pass --apply"
  // line is the shared helper's wording; this tool has nothing to apply yet.
  announce({ tool: 'generate-cluster-narrations', blast: ['SPENDS $'], apply: false })
  console.log('LLM only — no TTS, no DB write, no R2. The synthesize half is step 4.')

  const region = await resolveRegion(flags.value('region') ?? DEFAULT_REGION_SLUG)
  const bbox = requireRegionBbox(region)
  const limit = Number(flags.value('limit') ?? 1)
  const query = flags.value('query')?.toLowerCase()

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
    .where(and(eq(poiClusters.treatment, 'cluster'), sql`${poiClusters.id} in ${inRegion}`))

  const members = await loadClusterMembers(clusters.map((c) => c.id))
  const queue: typeof clusters = []
  const blocked: string[] = []
  for (const c of clusters) {
    if (query && !c.title.toLowerCase().includes(query)) continue
    const block = clusterGenerationBlock(members.get(c.id) ?? [])
    if (block) blocked.push(`  ${c.title} — ${block}`)
    else queue.push(c)
  }

  console.log(`\nRegion: ${region.displayName}  ·  ${clusters.length} cluster(s) in scope`)
  console.log(`${queue.length} generatable, ${blocked.length} blocked:`)
  for (const b of blocked.slice(0, 4)) console.log(b)
  if (blocked.length > 4) console.log(`  …+${blocked.length - 4} more`)

  // Widest first — the density stress case is the one worth reading, not the easy 2-member pair.
  queue.sort((a, b) => tellableMembers(members.get(b.id) ?? []).length - tellableMembers(members.get(a.id) ?? []).length)
  const picked = queue.slice(0, Math.max(0, limit))
  if (picked.length === 0) return console.log('\nNothing to narrate.')
  console.log(`\nNarrating ${picked.length} of them (--limit ${limit}).\n`)

  const persona = personaFromKey('skipper')
  for (const c of picked) {
    const all = members.get(c.id) ?? []
    const tellable = tellableMembers(all)
    // §3.1: the model's own naming evidence. `highlights` are free-text NAMES it authored and they do
    // NOT reliably match `pois.name` (measured: 74 of 88 match exactly), so this is a SUBSET COUNT for
    // the length band, never a lookup key.
    const nameable = Math.max(1, (c.highlights ?? []).length)
    const subject = tellable.find((m) => m.id === c.subjectPoiId)
    const register: DeliveryRegister = subject?.deliveryRegister ?? 'story'
    const band = lengthForRegister(register)
    const targetSeconds = Math.min(band.maxSeconds, band.targetSeconds + SECONDS_PER_EXTRA_NAME * (nameable - 1))

    // §3.2's asymmetry: ground on every tellable member, but mark the ones not worth naming as
    // BACKGROUND so they can't become the subject.
    //
    // ⚠ Keyed off `dropped`, NOT `highlights`, and that is the whole trick. Both lists are free-text
    // names the model authored, but they match `pois.name` at very different rates — measured over the
    // live corpus, `dropped` matches 68 of 69 while `highlights` manages 165 of 186. Inverting the
    // question ("is this member on the drop list?") puts the fuzzy matching on the list that is
    // essentially exact, and a matcher miss then fails SAFE: an unmatched member stays nameable,
    // which is today's behaviour, rather than silently muting a place the telling is for.
    const droppedKeys = new Set((c.dropped ?? []).map(nameKey))
    const matchedDrops = new Set<string>()
    const mergedFeatures = tellable
      .map((m: ClusterMemberRow) => {
        const key = nameKey(m.name)
        const background = droppedKeys.has(key)
        if (background) matchedDrops.add(key)
        return { name: m.name, facts: (m.factSheet ?? []).map((f) => f.text), background }
      })
      .filter((m) => m.facts.length > 0)
    const unmatched = (c.dropped ?? []).filter((d) => !matchedDrops.has(nameKey(d)))
    if (unmatched.length) {
      console.warn(`  ⚠ ${unmatched.length} drop entr(ies) matched no member — they stay NAMEABLE: ${unmatched.join(' · ')}`)
    }

    const centroidLat = tellable.reduce((s, m) => s + (m.speakableLat ?? m.lat), 0) / tellable.length
    const centroidLng = tellable.reduce((s, m) => s + (m.speakableLng ?? m.lng), 0) / tellable.length
    const req = {
      region: regionLabel(centroidLat, centroidLng),
      stopType: 'story' as const,
      place: { name: c.title },
      mergedFeatures,
      targetSeconds,
      maxSeconds: band.maxSeconds,
      selfContained: true,
    }

    console.log('='.repeat(78))
    console.log(`▸ ${c.title}`)
    console.log(`  ${tellable.length} tellable member(s) · ${nameable} nameable · register ${register} · ` +
      `aim ${targetSeconds}s / max ${band.maxSeconds}s`)
    console.log(`  highlights: ${(c.highlights ?? []).join(' · ') || '—'}`)
    if ((c.dropped ?? []).length) console.log(`  dropped:    ${(c.dropped ?? []).join(' · ')}`)
    console.log(`  → ${mergedFeatures.filter((m) => !m.background).length} nameable, ${mergedFeatures.filter((m) => m.background).length} background`)

    const result = await withRetry(() => narrateStop(req, persona.systemPrompt), { label: `narrate(${c.title})` })
    const script = result.script.trim()
    const words = script.split(/\s+/).filter(Boolean).length
    console.log(`\n${script}\n`)
    console.log(`  ${words} words ≈ ${Math.round(words / WORDS_PER_SECOND)}s spoken (aim ${targetSeconds}s)`)

    const well = buildGroundingWell({ stopType: 'story', name: c.title, facts: [], mergedFeatures })
    const evals: StopEval[] = [
      evaluateTts({ seq: 0, script }),
      ...evaluateDiversity([{ seq: 0, stopType: 'story', script }]),
      evaluateLaterality({ seq: 0, script }),
      evaluatePacing({ seq: 0, script, targetSeconds, maxSeconds: band.maxSeconds }),
    ]
    if (GROUNDING_EVAL()) {
      evals.push(await evaluateGrounding({ seq: 0, stopType: 'story', placeName: c.title, script, well, region: req.region }))
    } else {
      console.log('  (grounding judge OFF — set SKIPPER_GROUNDING_EVAL=1 to score it)')
    }
    for (const e of evals) {
      const gate = DIMENSION_KIND[e.dimension] === 'gate'
      console.log(`  ${e.pass ? '✓' : '✗'} ${gate ? 'GATE ' : 'info '}${e.dimension.padEnd(14)} ${e.score.toFixed(2)}` +
        (e.findings.length ? `  — ${e.findings.slice(0, 2).join('; ')}` : ''))
    }
    const dirty = evals.filter((e) => !e.pass && DIMENSION_KIND[e.dimension] === 'gate')
    console.log(dirty.length ? `  ⚠ ${dirty.length} GATE dimension(s) dirty — a real run would retake, then WITHHOLD.` : '  ✓ every gate dimension clean.')
    console.log('')
  }

  for (const l of llmSpendLines()) console.log(l)
  console.log(`\nSpent $${llmSpentUsd().toFixed(2)}. NOTHING was written — no narration, no audio, no eval run.`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
