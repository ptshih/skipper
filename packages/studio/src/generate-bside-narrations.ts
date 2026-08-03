// "Tell me more" B-SIDES — the deeper-cut generator (docs/designs/tell-me-more-spec.md).
//
// ⚠ THIS IS THE SPEC'S EAR-TUNE STEP, PULLED TO THE FRONT. The spec's build order (§8) runs
// generation → schema → API → player → ear-tune, which retires its ONLY fatal risk last: §8.5 asks
// "does the deeper cut feel like a genuine B-side or a leftover-scraps dump?" — and if the answer is
// scraps, every earlier phase was wasted. So this CLI answers that question alone, on a handful of
// stops, with NO migration, NO DTO and NO button.
//
// ⚠ IT PERSISTS NOTHING — not a `narrations` row, not an R2 object, not a TTS call. Deliberate, and
// NOT merely "phase 1 isn't done yet": a b-side is a SECOND telling of one poi and the live schema
// carries `narrations_poi_uq` (UNIQUE(poi_id)), so there is nowhere to put one until that constraint
// is reconciled (tell-me-more-spec §3 — relax to UNIQUE(poi_id, form), or hang bside_* columns off
// the main row). Writing before that decision would mean picking it by accident.
//
// SAFE BY DEFAULT (ops-scripts-sop): preview unless `--apply`. Note the mapping differs from the
// other studio CLIs and that is the point — here `--apply` does not mean "write to the DB", it means
// "make the model calls", because on a script-only run the CALL *is* the spend. Preview assembles and
// prints the exact prompts and spends nothing.
//
//   bun packages/studio/src/generate-bside-narrations.ts                 # preview, $0
//   bun packages/studio/src/generate-bside-narrations.ts --apply         # 💸 founder go required
//   ... --limit 3 --poi "Harvey's"                                       # narrow the selection
import { db } from '@skipper/db'
import { pois, narrations } from '@skipper/db/schema'
import { and, eq, isNotNull } from 'drizzle-orm'
// `recordModelUsage` is NOT imported: runNarration already records every call, so tallying here too
// would double-count the exact spend this run exists to report.
import { llmSpendLines } from '@skipper/shared'
import { narrateDeeperCut, buildFactSheet, type NarrationRequest } from './pipeline/narrate'
import { resolveStoryGrounding } from './pipeline/select'
import { regionLabel } from './pipeline/geo'
import { lengthForRegister } from './models'
import { NARRATION_FALLBACK_CHARS } from './config'
import { SHARED_NGRAM_MIN_CLIPS } from './pipeline/lint'
import { SKIPPER_SYSTEM_PROMPT } from './persona/skipper'

const SHARED_FACT_MIN_OTHERS = SHARED_NGRAM_MIN_CLIPS - 1

const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const limit = Number(flag('--limit') ?? 3)
const poiFilter = flag('--poi')?.toLowerCase()

const rows = await db
  .select({
    id: pois.id,
    name: pois.name,
    kind: pois.kind,
    lat: pois.lat,
    lng: pois.lng,
    facts: pois.facts,
    factSheet: pois.factSheet,
    enrichedAt: pois.enrichedAt,
    factsFetchedAt: pois.factsFetchedAt,
    deliveryRegister: pois.deliveryRegister,
    script: narrations.script,
  })
  .from(pois)
  .innerJoin(narrations, eq(narrations.poiId, pois.id))
  .where(and(isNotNull(narrations.audioUrl), eq(narrations.form, 'story')))

// The shared-fact map, built over the WHOLE corpus exactly as generate-narrations does.
// ⚠ Load-bearing for a b-side specifically, more than for the main telling: regional boilerplate is
// the material a tight first telling most often SKIPS, so it is sitting right at the top of the
// leftover pile. Without this marking the b-side is the single most likely clip in the corpus to open
// on the granite line 24 other places also carry.
const factCarriers = new Map<string, number>()
for (const r of rows) {
  if (!r.facts) continue // a story telling with no facts row at all cannot carry a shared line
  const g = resolveStoryGrounding(r.facts, r.factSheet, r.enrichedAt, {
    fallbackChars: NARRATION_FALLBACK_CHARS,
    retrievedAt: (r.factsFetchedAt ?? new Date()).toISOString(),
  })
  for (const f of new Set(g.facts.map((x) => x.trim()))) {
    factCarriers.set(f, (factCarriers.get(f) ?? 0) + 1)
  }
}

type Candidate = { row: (typeof rows)[number]; req: NarrationRequest; leftoverChars: number }
const candidates: Candidate[] = []
for (const row of rows) {
  // No script → nothing to condition the b-side ON; no facts → nothing to ground it IN. Both are
  // "not a candidate", not an error: the exhaustion gate handles thin, this handles absent.
  if (!row.script || !row.facts) continue
  if (poiFilter && !row.name.toLowerCase().includes(poiFilter)) continue
  const grounding = resolveStoryGrounding(row.facts, row.factSheet, row.enrichedAt, {
    fallbackChars: NARRATION_FALLBACK_CHARS,
    retrievedAt: (row.factsFetchedAt ?? new Date()).toISOString(),
  })
  const band = lengthForRegister(row.deliveryRegister ?? 'story')
  const req: NarrationRequest = {
    region: regionLabel(row.lat, row.lng),
    stopType: 'story',
    place: { name: row.name, ...(row.kind ? { kind: row.kind } : {}) },
    facts: grounding.facts,
    sharedFacts: Object.fromEntries(
      grounding.facts
        .map((f) => [f, (factCarriers.get(f.trim()) ?? 1) - 1] as const)
        .filter(([, others]) => others >= SHARED_FACT_MIN_OTHERS),
    ),
    targetSeconds: band.targetSeconds,
    maxSeconds: band.maxSeconds,
    selfContained: true,
  }
  // Crude leftover estimate, used ONLY to rank which stops to preview first — the real eligibility
  // gate is the model's own exhaustion call inside narrateDeeperCut (spec §2), never this number.
  const spoken = new Set((row.script.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []))
  const leftoverChars = grounding.facts
    .filter((f) => {
      const toks = [...new Set(f.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [])]
      if (!toks.length) return false
      return toks.filter((t) => spoken.has(t)).length / toks.length < 0.5
    })
    .reduce((n, f) => n + f.length, 0)
  candidates.push({ row, req, leftoverChars })
}

candidates.sort((a, b) => b.leftoverChars - a.leftoverChars)
const picked = candidates.slice(0, limit)

console.log(`\ncorpus: ${rows.length} live story tellings · candidates: ${candidates.length} · previewing ${picked.length}\n`)

if (!apply) {
  for (const c of picked) {
    console.log('═'.repeat(100))
    console.log(`${c.row.name}  —  ~${c.leftoverChars} chars of unspoken sheet material`)
    console.log('═'.repeat(100))
    console.log(buildFactSheet(c.req))
    console.log('\n[the B-SIDE block follows the sheet above; see deeperCutBlock in pipeline/narrate.ts]\n')
  }
  console.log('─'.repeat(100))
  console.log(`PREVIEW ONLY — no model calls, $0 spent. ${picked.length} b-side(s) would be generated.`)
  console.log(`System prompt: SKIPPER_SYSTEM_PROMPT (${SKIPPER_SYSTEM_PROMPT.length} chars, cached across calls).`)
  console.log(`Re-run with --apply to generate. 💸 That is an OPERATOR PAID RUN — founder go required.`)
  console.log('─'.repeat(100) + '\n')
  process.exit(0)
}

let generated = 0
let exhausted = 0
let failed = 0
for (const c of picked) {
  console.log('═'.repeat(100))
  console.log(`${c.row.name}`)
  console.log('═'.repeat(100))
  console.log(`\n--- THE MAIN TELLING (already heard) ---\n${c.row.script}\n`)
  try {
    const result = await narrateDeeperCut(c.req, SKIPPER_SYSTEM_PROMPT, c.row.script!)
    if (!result) {
      exhausted++
      console.log(`--- THE B-SIDE ---\n(exhausted — the model declined; no b-side for this place)\n`)
      continue
    }
    generated++
    const words = result.script.split(/\s+/).filter(Boolean).length
    console.log(`--- THE B-SIDE (${words} words ≈ ${Math.round(words / 2.5)}s) ---\n${result.script}\n`)
  } catch (err) {
    failed++
    console.log(`--- THE B-SIDE ---\n(FAILED: ${err instanceof Error ? err.message : String(err)})\n`)
  }
}

// "A run that did nothing must not settle GREEN; a paid one reports what it BILLED, not what it
// planned." Both halves apply: the tally below is actual usage, and an all-exhausted/all-failed run
// exits non-zero so it cannot read as a successful generation.
console.log('─'.repeat(100))
console.log(`generated=${generated}  exhausted=${exhausted}  failed=${failed}  (of ${picked.length} attempted)`)
for (const line of llmSpendLines()) console.log(line)
console.log('─'.repeat(100) + '\n')
if (generated === 0) {
  console.error('No b-side was produced. Not settling green.')
  process.exit(1)
}
