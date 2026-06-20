// regen-report — READ-ONLY post-regen QA report. Run AFTER a roam-corpus regeneration to confirm the
// new single-voice corpus landed clean, in ONE shot. Three sections:
//
//   A. WITHHOLDS — every clip the FAIL-CLOSED grounding gate held back in the latest `generation`
//      eval_run (`eval_scores.withheld`). Each is SUPPOSED to be a true catch (an ungrounded claim not
//      on the fact sheet — e.g. the Virginia City "just sagebrush and nothing" embellishment), so the
//      report prints the failed dimension(s), the findings, and the held-back script to eyeball each as
//      a correct withhold rather than a false positive. A withheld clip ships NOTHING (no narration row).
//   B. ATTRIBUTION — any STORY narration shipping with null/empty `attribution` (a CC BY-SA violation).
//      The `narrations_story_attribution` DB CHECK makes this impossible to insert, so this is a 0-row
//      belt-and-suspenders confirm (and a place to notice if the constraint ever regresses).
//   C. COUNTS — live narrations by form + the latest run's total/shipped/withheld tally, vs the ~459
//      the Tahoe roam corpus held before the regen.
//
// READ-ONLY: SELECT only — no --apply, no writes, no spend, no eval_run/studio_job record. Safe to run
// anytime, INCLUDING mid-regen (it just reflects current state; numbers are PARTIAL until the run ends).
//
// Usage:
//   dotenvx run -f .env.development -- bun packages/studio/src/regen-report.ts
//   ... --region <slug>     the region's `generation` eval_runs (default: lake-tahoe)

import { and, desc, eq, isNull, or, sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import { evalRuns, evalScores, narrations } from '@skipper/db/schema'
import { parseFlags } from './pipeline/ops'
import { DEFAULT_REGION_SLUG } from './config'

const flags = parseFlags(process.argv.slice(2), { valueFlags: ['region'] })
const region = flags.value('region') || DEFAULT_REGION_SLUG

const fmt = (v: number | null) => (v == null ? '—' : v.toFixed(3))
const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)

async function main() {
  console.log(`\n=== Regen QA report — region: ${region} ===`)
  console.log('READ-ONLY snapshot. If a regen is still running, these numbers are PARTIAL.\n')

  // --- Latest `generation` eval_runs for the region (a full regen records one per generate batch) ---
  const runs = await db
    .select()
    .from(evalRuns)
    .where(and(eq(evalRuns.region, region), eq(evalRuns.kind, 'generation')))
    .orderBy(desc(evalRuns.createdAt))
    .limit(5)

  if (!runs.length) {
    console.log('No `generation` eval_runs for this region yet — nothing has regenerated.\n')
  } else {
    const latest = runs[0]!
    console.log(`Latest generation run ${latest.id.slice(0, 8)} @ ${latest.createdAt.toISOString()}`)
    console.log(`  total=${latest.total}  shipped=${latest.shipped}  withheld=${latest.withheld}  pass=${latest.pass}`)
    console.log(`  scores: grounding=${fmt(latest.groundingScore)} tts=${fmt(latest.ttsScore)} diversity=${fmt(latest.diversityScore)}`)
    console.log(`  narrationModel=${latest.narrationModel ?? '—'}  judge=${latest.judgeModel ?? '—'}  gitSha=${latest.gitSha?.slice(0, 8) ?? '—'}`)
    if (runs.length > 1) console.log(`  (${runs.length}+ recent generation runs; the sections below cover the LATEST run only)`)
    console.log()

    // --- A. WITHHOLDS in the latest run (withheld is denormalized onto every poi×dimension row) ---
    const held = await db
      .select()
      .from(evalScores)
      .where(and(eq(evalScores.runId, latest.id), eq(evalScores.withheld, true)))

    const byPoi = new Map<string, typeof held>()
    for (const r of held) {
      const k = r.poiId ?? r.qid ?? r.id
      const arr = byPoi.get(k)
      if (arr) arr.push(r)
      else byPoi.set(k, [r])
    }

    console.log(`--- A. WITHHOLDS — ${byPoi.size} place(s) held back by the fail-closed gate ---`)
    if (!byPoi.size) {
      console.log('  (none — every clip in the latest run cleared the gate)\n')
    } else {
      console.log('  Each SHOULD be a true catch (ungrounded claim, not on the sheet). Eyeball each:\n')
      for (const rows of byPoi.values()) {
        const name = rows[0]!.name ?? rows[0]!.qid ?? '(unknown place)'
        const failedDims = [...new Set(rows.filter((r) => !r.pass).map((r) => r.dimension))]
        console.log(`  • ${name}   [failed: ${failedDims.join(', ') || '—'}]`)
        const findings = [...new Set(rows.flatMap((r) => r.findings ?? []))].slice(0, 4)
        for (const f of findings) console.log(`      - ${f}`)
        const script = rows.find((r) => r.script)?.script
        if (script) console.log(`      held-back script: "${truncate(script, 240)}"`)
      }
      console.log()
    }
  }

  // --- B. ATTRIBUTION integrity (CC BY-SA) ---
  const [missing] = await db
    .select({ n: sql<number>`count(*)` })
    .from(narrations)
    .where(
      and(
        eq(narrations.form, 'story'),
        or(isNull(narrations.attribution), sql`jsonb_array_length(${narrations.attribution}) = 0`),
      ),
    )
  const missingCount = Number(missing?.n ?? 0)
  console.log('--- B. ATTRIBUTION (CC BY-SA) ---')
  console.log(`  story narrations missing attribution: ${missingCount}   ${missingCount === 0 ? '✓ (DB CHECK enforces 0)' : '⚠ INVESTIGATE — a CHECK regression'}\n`)

  // --- C. LIVE NARRATIONS by form (region is bbox-derived, not a column, so this is the whole corpus) ---
  const counts = await db
    .select({ form: narrations.form, n: sql<number>`count(*)` })
    .from(narrations)
    .groupBy(narrations.form)
    .orderBy(narrations.form)
  console.log('--- C. LIVE NARRATIONS by form (whole corpus) ---')
  let total = 0
  for (const c of counts) {
    const n = Number(c.n)
    total += n
    console.log(`  ${c.form.padEnd(8)} ${n}`)
  }
  console.log(`  ${'TOTAL'.padEnd(8)} ${total}   (the Tahoe roam corpus held ~459 before the regen)\n`)
}

await main()
