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
//   ... --charm                  add the advisory charm judge (ONE Opus call over the batch — cheap)
//   ... --veracity               add the advisory veracity web-check (Opus + web_search, per clip — pricey)
//   ... --limit N                smoke a cheap N first   ... --max-cost <usd>   hard spend ceiling

import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import { narrations, pois } from '@skipper/db/schema'
import type { FactSheetEntry, PoiFacts } from '@skipper/db/schema'
import { STORY_TASTE_DENYLIST } from '@skipper/shared'
import { announce, maxCostFlag, numericFlag, parseFlags } from './pipeline/ops'
import { resolveRegion, requireRegionBbox } from './pipeline/region'
import { runJob } from './pipeline/job-progress'
import { regionLabel } from './pipeline/geo'
import { resolveStoryGrounding } from './pipeline/select'
import { withRetry } from './pipeline/http'
import { mapLimit } from './pipeline/concurrency'
import { ANTHROPIC_READY, DEFAULT_REGION_SLUG, NARRATION_CONCURRENCY, NARRATION_FALLBACK_CHARS } from './config'
import { llmSpendLines, llmSpentUsd } from '@skipper/shared'
import { JUDGMENT_MODEL } from './models'
import { buildGroundingWell, evaluateGrounding } from './eval/grounding'
import { charmEvaluator } from './eval/charm'
import { evaluateVeracity } from './eval/veracity'
import { evaluateTts } from './eval/tts'
import { evaluateDiversity } from './eval/diversity'
import { evaluateLaterality } from './eval/laterality'
import { buildScorecard } from './eval/scorecard'
import { DIMENSION_KIND, type StopEval } from './eval/types'
import { recordEvalRun, type ClipIdentity } from './eval/record'
import type { FinishOutcome } from './pipeline/job-progress'

// The CORRIDOR line handed to the grounding judge. It says "no route" ON PURPOSE: a shared clip is
// route-agnostic (it plays on ANY drive that reaches the place), so nothing about a specific stretch
// is sayable and the region is the only frame. Named, never a fact.
// ⚠ The literal REACHES A MODEL. It still opens with the roam-era phrase "Free roam" — left verbatim
//   through the 1.1 roam sweep because re-wording a judge input re-scores the whole shipped corpus,
//   which is a founder call and a paid re-run, not a rename. The constant's NAME (code-facing) was
//   de-roamed; the string was not.
// ⚠ Generation itself passes NO corridor at all (generate-narrations.ts), so this line is a small,
//   deliberate divergence between the audit and the run it audits — not the "same framing" the old
//   comment here claimed.
const ROUTE_AGNOSTIC_CORRIDOR = 'Free roam — an unplanned drive, no route'
// Rough per-clip cost estimates (ONE forced-tool Opus call each) for the preview + the pre-flight cap
// check. ESTIMATES, not the bill — the --max-cost cap is the real guard. Veracity also bills per
// web_search (a few per clip), so it's the priciest and opt-in.
const GROUNDING_USD_PER_CLIP = 0.06
const VERACITY_USD_PER_CLIP = 0.15
const CHARM_USD_FLAT = 0.06 // one batch Opus call over the whole queue

const flags = parseFlags(process.argv.slice(2), {
  valueFlags: ['limit', 'region', 'max-cost', 'query', 'include-ids', 'exclude-ids'],
})
const apply = flags.has('apply')
const doCharm = flags.has('charm')
const doVeracity = flags.has('veracity')
const maxCostUsd = maxCostFlag(flags)
// ⚠ `numericFlag`, not `Number(...)`: this limit is compared as `queue.length >= limit` (the break
// below), and NaN >= NaN is false — so a typo'd `--limit` silently audited the WHOLE corpus at full
// judge spend, which is the opposite of the "smoke a cheap N first" this flag exists to offer.
const limit = numericFlag(flags, 'limit', { fallback: Infinity })
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
  // NULL (not a sentinel) when the run spans no single region; the admin shows it as "All".
  const runRegion = region ? region.slug : null

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
  // ⚠ Laterality is a GATE dimension at generation (pipeline/gate.ts runs it on every clip) but the
  // audit did not run it, so a RELEASED clip naming a side of the road — the exact thing generation
  // would have withheld it for — audited clean. An audit that applies a weaker bar than the gate
  // cannot answer the question it exists to answer ("would today's gate still ship this?"). Free,
  // deterministic, no spend.
  const latEvals: StopEval[] = queue.map((c, i) => evaluateLaterality({ seq: i, script: c.script }))
  const ttsBad = ttsEvals.filter((e) => !e.pass).length
  const divBad = divEvals.filter((e) => !e.pass).length
  const latBad = latEvals.filter((e) => !e.pass).length
  const spendEst =
    queue.length * GROUNDING_USD_PER_CLIP +
    (doVeracity ? queue.length * VERACITY_USD_PER_CLIP : 0) +
    (doCharm ? CHARM_USD_FLAT : 0)
  const judgeList = ['grounding', ...(doCharm ? ['charm'] : []), ...(doVeracity ? ['veracity'] : [])].join(' + ')

  if (!apply) {
    console.log(`\nFree checks: ${ttsBad} TTS-unsafe, ${latBad} naming a side of the road, ${divBad} diversity-flagged (of ${queue.length}).`)
    for (const e of divEvals.filter((x) => !x.pass).slice(0, 10))
      console.log(`  diversity · ${queue[e.seq]?.name}: ${e.findings.slice(0, 1).join('')}`)
    console.log(
      `\nPaid judges on --apply: ${judgeList} (Opus${doVeracity ? ' + web_search' : ''}) ≈ ~$${spendEst.toFixed(2)} ` +
        `estimated (rough) over ${queue.length} clip(s). Add --charm / --veracity for the advisory judges. ` +
        `Run with --apply to score + record the audit eval_run.`,
    )
    return { ok: true }
  }

  // Fail fast on a missing key rather than discovering it once per clip. Without this, `getAnthropic`
  // throws inside the per-clip catch below, which records the miss as a GATE FAILURE — so a revoked key
  // wrote "every released clip is ungrounded" into the audit's system of record. Same guard
  // `enrich-pois` and `curate-places` already put on their --apply branch.
  if (!ANTHROPIC_READY()) {
    throw new Error('ANTHROPIC_API_KEY is not set — `audit-corpus --apply` needs it to run the judges.')
  }

  // Pre-flight spend guard — abort BEFORE any Opus call if the estimate already exceeds the cap.
  if (spendEst > maxCostUsd) {
    throw new Error(
      `⛔ Estimated spend (${judgeList} ≈ $${spendEst.toFixed(2)}) exceeds --max-cost=$${maxCostUsd.toFixed(2)}. ` +
        `Narrow with --limit/--region/--query, drop --veracity, or raise the cap.`,
    )
  }

  // PER-CLIP judges: grounding (always) + veracity (opt-in, web_search) — fault-isolated so one
  // failure can't abort the paid audit. The well is built once per clip and shared by both.
  console.log(`\nScoring ${judgeList} on ${queue.length} clip(s) (concurrency ${NARRATION_CONCURRENCY()})...`)
  let done = 0
  // Clips whose grounding judge THREW (infrastructure), as opposed to clips the judge scored as
  // ungrounded (content). The two are indistinguishable in `eval_scores` — both land pass:false — so
  // they have to be counted apart here, while the difference is still visible.
  let judgeErrors = 0
  const perClip = await mapLimit(queue, NARRATION_CONCURRENCY(), async (c, i): Promise<StopEval[]> => {
    const grounding = resolveStoryGrounding(c.facts, c.factSheet, c.enrichedAt, {
      fallbackChars: NARRATION_FALLBACK_CHARS,
      retrievedAt: (c.factsFetchedAt ?? new Date()).toISOString(),
    })
    const well = buildGroundingWell({ stopType: 'story', name: c.name, kind: c.kind, facts: grounding.facts })
    const evals: StopEval[] = []
    try {
      evals.push(
        await evaluateGrounding({
          seq: i, stopType: 'story', placeName: c.name, script: c.script, well,
          region: regionLabel(c.lat, c.lng), corridor: ROUTE_AGNOSTIC_CORRIDOR,
        }),
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      judgeErrors++
      console.warn(`  ⚠ ${c.name}: grounding eval failed — ${msg.slice(0, 160)}`)
      evals.push({ seq: i, dimension: 'grounding', pass: false, score: 0, findings: [`audit error: ${msg.slice(0, 200)}`] })
    }
    if (doVeracity) {
      // Advisory + pricey — a failure is SKIPPED (not recorded as a fail), never aborts the run.
      try {
        evals.push(await evaluateVeracity({ seq: i, name: c.name, script: c.script, well }))
      } catch (e) {
        console.warn(`  ⚠ ${c.name}: veracity eval skipped — ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`)
      }
    }
    done++
    const g = evals.find((e) => e.dimension === 'grounding')
    console.log(`  [${done}/${queue.length}] ${c.name} — ${g?.pass ? 'grounded' : `${g?.findings.length ?? 0} ungrounded`}`)
    return evals
  })
  // SYSTEMIC-failure guard, mirroring enrich-pois. If EVERY clip's judge threw, that is an outage /
  // revoked key / sustained 429 — not a corpus that went ungrounded overnight.
  //
  // ⚠ Without this the run recorded a FAKE gate failure per clip (pass:false, withheld:true), wrote
  // `eval_runs.pass = false`, and then returned `{ ok: true }` so the job row settled SUCCEEDED. The
  // fail-closed gate's own system of record would have said every released clip was ungrounded, in a
  // run the console showed as green. Throwing settles the row failed and leaves eval_runs alone.
  if (judgeErrors === queue.length && queue.length > 0) {
    throw new Error(
      `audit: all ${queue.length} clip(s) failed the grounding judge with an ERROR (not an ungrounded verdict) — ` +
        'likely systemic (auth / rate-limit / outage). Nothing recorded; re-run once the cause is fixed.',
    )
  }
  const grounded = perClip.flat()

  // CHARM — ONE batch Opus call over the whole queue (advisory; a failure is non-fatal, skipped).
  let charmEvals: StopEval[] = []
  if (doCharm) {
    try {
      charmEvals = await charmEvaluator(queue.map((c, i) => ({ seq: i, stopType: 'story', name: c.name, script: c.script })))
      console.log(`Charm: scored ${charmEvals.length} clip(s), ${charmEvals.filter((e) => !e.pass).length} below the bar.`)
    } catch (e) {
      console.warn(`  ⚠ charm judge skipped — ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`)
    }
  }

  // GATE fail = grounding/tts (the audit's "withheld", for run.pass + the report's withheld section).
  // ADVISORY fail = charm/veracity/diversity — surfaced separately, never counts toward withheld.
  const allEvals = [...grounded, ...charmEvals, ...ttsEvals, ...divEvals, ...latEvals]
  const gateFailedBySeq = new Map<number, boolean>()
  const advisoryFailedBySeq = new Map<number, boolean>()
  for (const e of allEvals) {
    if (e.pass) continue
    if (DIMENSION_KIND[e.dimension] === 'gate') gateFailedBySeq.set(e.seq, true)
    else advisoryFailedBySeq.set(e.seq, true)
  }
  const flagged = [...gateFailedBySeq.values()].filter(Boolean).length
  const advisoryCount = [...advisoryFailedBySeq.values()].filter(Boolean).length

  const identityBySeq = new Map<number, ClipIdentity>(
    queue.map((c, i) => [
      i,
      {
        poiId: c.poiId, qid: c.qid, name: c.name,
        withheld: gateFailedBySeq.get(i) ?? false,
        // Keep the script for ANY flagged clip (gate OR advisory) so the report can show the telling.
        script: gateFailedBySeq.get(i) || advisoryFailedBySeq.get(i) ? c.script : null,
      },
    ]),
  )

  const scorecard = buildScorecard({
    slug: runRegion,
    runName: 'offline_audit',
    evaluatedAt: new Date().toISOString(),
    stops: allEvals,
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

  console.log(`\nAudit complete: ${queue.length} scored, ${flagged} gate-flagged, ${advisoryCount} advisory-flagged.`)
  for (const line of llmSpendLines()) console.log(line)
  console.log(`LLM spend this audit: ~$${llmSpentUsd().toFixed(2)}`)
  return { ok: true, evalRunId }
}

// A region run keys the lock on its slug; a whole-corpus explicit-id run leaves slug+target NULL
// (no fake-region sentinel) — the admin shows it as "All".
const auditTargetRegion = isExplicit ? undefined : (regionRaw ?? DEFAULT_REGION_SLUG)
await runJob(
  'offline_audit',
  { dryRun: !apply, targetSlug: auditTargetRegion, targetId: auditTargetRegion },
  main,
)
