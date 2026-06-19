// audit-corpus — OFFLINE re-score of the EXISTING narration corpus (no regeneration, no TTS).
//
// Every other eval_run is a side-effect of a PAID generate. This scores what's ALREADY shipped:
// it loads each region story narration's stored `script` + rebuilds the EXACT permitted well the
// narrator saw (resolveStoryGrounding → buildGroundingWell — the shared seam, so the audit can't
// drift from generation), runs the eval panel over the stored text, and records an
// `eval_run{kind:'offline_audit'}` + per-(poi×dimension) `eval_scores`. The admin reuses the SAME
// Runs report drawer to read it. Answers "how grounded/clean is what I already shipped?" WITHOUT
// paying to remake it.
//
// SPENDS $ on --apply (one Opus grounding call per clip); tts-cleanliness + cross-clip diversity are
// FREE/deterministic. It NEVER writes narrations/R2 — read-only on the corpus, write-only to the
// eval_runs/eval_scores observability tables. SOP (ops-scripts-sop.md): PREVIEWS by default (counts
// the queue + estimates the grounding spend, runs the free checks), scores + records only on --apply.
//
// Usage:
//   dotenvx run -f .env.development -- bun packages/studio/src/audit-corpus.ts            # preview
//   ... --apply                  score grounding (Opus) + record the audit eval_run
//   ... --region <slug>          a region's story corpus (default: lake-tahoe; → its bbox)
//   ... --include-ids a,b,c      audit EXACTLY these poi ids
//   ... --query <substr>         narrow to names/source-ids containing <substr>
//   ... --limit N                smoke a cheap N first   ... --max-cost <usd>   hard spend ceiling

import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import { narrations, pois } from '@skipper/db/schema'
import type { FactSheetEntry, PoiFacts } from '@skipper/db/schema'
import { STORY_TASTE_DENYLIST } from '@skipper/shared'
import { announce, maxCostFlag, parseFlags } from './pipeline/ops'
import { resolveRegion, requireRegionBbox } from './pipeline/region'
import { runJob } from './pipeline/job-progress'
import { regionLabel } from './pipeline/geo'
import { resolveStoryGrounding } from './pipeline/select'
import { withRetry } from './pipeline/http'
import { mapLimit } from './pipeline/concurrency'
import { DEFAULT_REGION_SLUG, NARRATION_CONCURRENCY, NARRATION_FALLBACK_CHARS } from './config'
import { llmSpendLines, llmSpentUsd } from './pipeline/spend'
import { JUDGMENT_MODEL } from './models'
import { buildGroundingWell, evaluateGrounding } from './eval/grounding'
import { evaluateTts } from './eval/tts'
import { evaluateDiversity } from './eval/diversity'
import { buildScorecard } from './eval/scorecard'
import { DIMENSION_KIND, type StopEval } from './eval/types'
import { recordEvalRun, type ClipIdentity } from './eval/record'
import type { FinishOutcome } from './pipeline/job-progress'

// Same corridor framing the roam generator used (so the grounding carve-out matches). Named, never a fact.
const FREE_ROAM_CORRIDOR = 'Free roam — an unplanned drive, no route'
// Rough per-clip grounding cost (ONE forced-tool Opus call) for the preview estimate + the pre-flight
// cap check. An ESTIMATE, not the bill — the --max-cost cap is the real guard.
const GROUNDING_USD_PER_CLIP = 0.06

const flags = parseFlags(process.argv.slice(2), {
  valueFlags: ['limit', 'region', 'max-cost', 'query', 'include-ids', 'exclude-ids'],
})
const apply = flags.has('apply')
const maxCostUsd = maxCostFlag(flags)
const limit = Number(flags.value('limit') ?? Infinity)
const parseIds = (v: string | undefined): string[] => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [])
const regionRaw = flags.value('region') || null
const query = (flags.value('query') ?? '').trim().toLowerCase()
const includeIds = parseIds(flags.value('include-ids'))
const excludeIds = new Set(parseIds(flags.value('exclude-ids')))
const isExplicit = includeIds.length > 0 && !regionRaw && !query

announce({ tool: 'audit-corpus', blast: apply ? ['SPENDS $'] : ['READ-ONLY'], apply })

interface Audited {
  poiId: string
  qid: string | null
  name: string
  kind: string | null
  lat: number
  lng: number
  facts: PoiFacts
  factsFetchedAt: Date | null
  factSheet: FactSheetEntry[] | null
  enrichedAt: Date | null
  script: string
}

async function main(): Promise<FinishOutcome> {
  const region = isExplicit ? null : await resolveRegion(regionRaw ?? DEFAULT_REGION_SLUG)
  const bbox = region ? requireRegionBbox(region) : null
  const runRegion = region ? region.slug : 'roam-corpus'

  // EXISTING story narrations only (the grounding-critical form): inner-join narrations so we score
  // shipped tellings, not candidates. Scoped to the region bbox (wikipedia source) XOR an id list.
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
          factsFetchedAt: pois.factsFetchedAt,
          factSheet: pois.factSheet,
          enrichedAt: pois.enrichedAt,
          script: narrations.script,
        })
        .from(pois)
        .innerJoin(narrations, eq(narrations.poiId, pois.id))
        .where(
          and(
            eq(narrations.form, 'story'),
            isExplicit
              ? inArray(pois.id, includeIds)
              : and(
                  eq(pois.source, 'wikipedia'),
                  sql`${pois.lat} between ${bbox!.swLat} and ${bbox!.neLat}`,
                  sql`${pois.lng} between ${bbox!.swLng} and ${bbox!.neLng}`,
                ),
          ),
        ),
    { label: 'load story narrations' },
  )

  const queue: Audited[] = []
  for (const r of rows) {
    if (excludeIds.has(r.id)) continue
    if (query && !`${r.name} ${r.sourceId}`.toLowerCase().includes(query)) continue
    if (!r.facts || !(Array.isArray(r.factSheet) && r.factSheet.length > 0)) continue // story grounds on the sheet
    if (!r.script?.trim()) continue
    if (STORY_TASTE_DENYLIST.test(r.name)) continue
    queue.push({
      poiId: r.id,
      qid: r.qid,
      name: r.name,
      kind: r.kind,
      lat: r.lat,
      lng: r.lng,
      facts: r.facts,
      factsFetchedAt: r.factsFetchedAt,
      factSheet: r.factSheet,
      enrichedAt: r.enrichedAt,
      script: r.script,
    })
    if (queue.length >= limit) break
  }

  const scope = isExplicit ? `${includeIds.length} hand-picked` : `region=${runRegion}`
  console.log(`Found ${queue.length} story narration(s) to audit (${scope}).`)
  if (queue.length === 0) {
    console.log('Nothing to audit.')
    return { ok: true }
  }

  // FREE deterministic checks now (no Opus): tts-cleanliness per clip + cross-clip diversity over the
  // whole set (repeated openers/bows the per-clip generation pass can't see).
  const ttsEvals: StopEval[] = queue.map((c, i) => evaluateTts({ seq: i, script: c.script }))
  const divEvals = evaluateDiversity(queue.map((c, i) => ({ seq: i, stopType: 'story' as const, script: c.script })))
  const ttsBad = ttsEvals.filter((e) => !e.pass).length
  const divBad = divEvals.filter((e) => !e.pass).length
  const groundingEst = queue.length * GROUNDING_USD_PER_CLIP

  if (!apply) {
    console.log(`\nFree checks: ${ttsBad} TTS-unsafe, ${divBad} diversity-flagged (of ${queue.length}).`)
    for (const e of divEvals.filter((x) => !x.pass).slice(0, 10))
      console.log(`  diversity · ${queue[e.seq]?.name}: ${e.findings.slice(0, 1).join('')}`)
    console.log(
      `\nGrounding (Opus): ~${queue.length} call(s) ≈ ~$${groundingEst.toFixed(2)} estimated (rough). ` +
        `Run with --apply to score grounding + record the audit eval_run.`,
    )
    return { ok: true }
  }

  // Pre-flight spend guard — abort BEFORE any Opus call if the estimate already exceeds the cap.
  if (groundingEst > maxCostUsd) {
    throw new Error(
      `⛔ Estimated grounding spend (${queue.length} × ~$${GROUNDING_USD_PER_CLIP} ≈ $${groundingEst.toFixed(2)}) ` +
        `exceeds --max-cost=$${maxCostUsd.toFixed(2)}. Narrow with --limit/--region/--query or raise the cap.`,
    )
  }

  // GROUNDING (one Opus call per clip), fault-isolated so one failure can't abort the paid audit.
  console.log(`\nScoring grounding on ${queue.length} clip(s) (concurrency ${NARRATION_CONCURRENCY()})...`)
  let done = 0
  const grounded = await mapLimit(queue, NARRATION_CONCURRENCY(), async (c, i): Promise<StopEval> => {
    try {
      const grounding = resolveStoryGrounding(c.facts, c.factSheet, c.enrichedAt, {
        fallbackChars: NARRATION_FALLBACK_CHARS,
        retrievedAt: (c.factsFetchedAt ?? new Date()).toISOString(),
      })
      const well = buildGroundingWell({ stopType: 'story', name: c.name, kind: c.kind, facts: grounding.facts })
      const g = await evaluateGrounding({
        seq: i,
        stopType: 'story',
        placeName: c.name,
        script: c.script,
        well,
        region: regionLabel(c.lat, c.lng),
        corridor: FREE_ROAM_CORRIDOR,
      })
      done++
      console.log(`  [${done}/${queue.length}] ${c.name} — ${g.pass ? 'grounded' : `${g.findings.length} ungrounded`}`)
      return g
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      done++
      console.warn(`  ⚠ ${c.name}: grounding eval failed — ${msg.slice(0, 160)}`)
      return { seq: i, dimension: 'grounding', pass: false, score: 0, findings: [`audit error: ${msg.slice(0, 200)}`] }
    }
  })

  // A clip is "flagged" (withheld, in the report's terms) when it fails any GATE dimension (grounding
  // or tts). Diversity is advisory — it never flags. The flagged clip carries its script for the report.
  const gateFailedBySeq = new Map<number, boolean>()
  for (const e of [...grounded, ...ttsEvals]) {
    if (DIMENSION_KIND[e.dimension] === 'gate' && !e.pass) gateFailedBySeq.set(e.seq, true)
  }
  const flagged = [...gateFailedBySeq.values()].filter(Boolean).length

  const identityBySeq = new Map<number, ClipIdentity>(
    queue.map((c, i) => [
      i,
      { poiId: c.poiId, qid: c.qid, name: c.name, withheld: gateFailedBySeq.get(i) ?? false, script: gateFailedBySeq.get(i) ? c.script : null },
    ]),
  )

  const scorecard = buildScorecard({
    slug: runRegion,
    runName: 'offline_audit',
    evaluatedAt: new Date().toISOString(),
    stops: [...grounded, ...ttsEvals, ...divEvals],
  })

  const evalRunId = await recordEvalRun({
    region: runRegion,
    kind: 'offline_audit',
    dryRun: false,
    narrationModel: null, // nothing was narrated — we scored stored scripts
    judgeModel: JUDGMENT_MODEL,
    scorecard,
    total: queue.length,
    shipped: queue.length - flagged,
    withheld: flagged,
    identityBySeq,
  })

  console.log(`\nAudit complete: ${queue.length} scored, ${flagged} flagged (failed a gate dimension).`)
  for (const line of llmSpendLines()) console.log(line)
  console.log(`LLM spend this audit: ~$${llmSpentUsd().toFixed(2)}`)
  return { ok: true, evalRunId }
}

await runJob(
  'offline_audit',
  { dryRun: !apply, targetId: isExplicit ? 'roam-corpus' : (regionRaw ?? DEFAULT_REGION_SLUG) },
  main,
)
