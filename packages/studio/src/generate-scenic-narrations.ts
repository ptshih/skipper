// SCENIC NAMED call-outs — the smoke test for the tier that has never been generated
// (docs/designs/scenic-stops-spec.md §11).
//
// ⚠ WHY THIS EXISTS AS ITS OWN CLI, like the b-side one. Every narration in the live corpus is a
// `story` — 458 of 458 — while a real drive runs 79% silent and 925 named, fact-less POIs sit along
// those routes saying nothing. `narrate.ts` has supported `stopType: 'scenic'` all along; what was
// missing is a generator, because `generate-narrations.ts` skips any poi without a fact sheet (the
// scenic "wave" form that was going to cover them was CUT — docs/decisions/cut-wave-form.md). This
// answers the ONE ear question that gates the tier — "is naming the thing you are looking at worth
// fifteen seconds?" — on a handful of places, with NO migration, NO TTS and NO persistence.
//
// ⚠ IT PERSISTS NOTHING — not a `narrations` row, not an R2 object, not a TTS call. Same discipline
// as the b-side CLI: the question is whether the CONTENT is any good, and answering it must not
// commit the schema, the corpus, or a rider's ears to anything.
//
// SAFE BY DEFAULT (ops-scripts-sop): preview unless `--apply`. ⚠ As with the b-side CLI, `--apply`
// does NOT mean "write to the DB" — it means "make the model calls", because on a script-only run
// the CALL is the spend. Preview assembles and prints the exact prompts and spends nothing.
//
//   bun packages/studio/src/generate-scenic-narrations.ts                  # preview, $0
//   bun packages/studio/src/generate-scenic-narrations.ts --apply          # 💸 founder go required
//   ... --limit 6 --spread                                                 # sample ACROSS kinds
//   ... --limit 6 --kind mountain                                          # the WORST case: one kind
//   ... --offset 2                                                         # keep a re-test off the
//                                                                          #   repair population
//
// ⚠ TWO TRAPS INHERITED FROM THE CUT WAVE BUILD (cut-wave-form.md), both handled here:
//  1. MONOTONY IS STRUCTURAL in a low-input form — with two input fields (name + kind) the model
//     converges hard. Handled by an OPENING SHAPE ASSIGNED ROUND-ROBIN BY QUEUE INDEX
//     (`openingAngleFor`), which holds at any concurrency and needs no shared mutable state.
//     ⚠ THE ALTERNATIVE WAS TRIED HERE AND FAILED, so do not "simplify" back to it: a rolling
//     recent-openers/closers buffer left 4 of 4 clips closing alike on the first smoke, then 3 of 6
//     once closers were added — and the three that collapsed were clips 1, 2 and 3, the ones
//     generated against an empty history. It also cannot persist across RUNS: both smoke rounds' PARK
//     opened "that green patch". `81f6ca5` verified the rotation on six mountains — same kind on
//     purpose, the worst case — and got six distinct openers.
//  2. THE GROUNDING GATE CANNOT CATCH A CLAIM DERIVED FROM THE PLACE'S NAME ("Cathedral Peak" →
//     "there's a peak out there", asserting a kind the card never gave). So this REQUIRES a non-null
//     `kind` up front rather than trusting the gate to notice it is missing. It also requires a
//     road-snapped anchor: a call-out about what you are looking at is worthless if it fires a
//     kilometre before you can see it.

import { db } from '@skipper/db'
import { pois, narrations } from '@skipper/db/schema'
import { and, eq, isNull, isNotNull } from 'drizzle-orm'
// `recordModelUsage` is NOT imported — `runNarration` already records every call, so tallying here
// too would double-count the exact spend this run exists to report.
import { llmSpendLines } from '@skipper/shared'
import { narrateStop, buildFactSheet, openingAngleFor, type NarrationRequest } from './pipeline/narrate'
import { regionLabel } from './pipeline/geo'
import { SKIPPER_SYSTEM_PROMPT } from './persona/skipper'

// A GLANCE, NOT A STORY — the prompt's own words for this branch. ⚠ Deliberately NOT
// `lengthForRegister('landscape')` (60 s / 100 s): that band is written for a natural feature that
// HAS facts ("wonder over inventory, not a factless glance"), and handing a factless place sixty
// seconds to fill is precisely how a name turns into an invented story. The cut WAVE band was
// 15 s / 20 s; this sits just above it so the voice has room to be a voice.
const SCENIC_TARGET_SECONDS = 20
const SCENIC_MAX_SECONDS = 30

const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const spread = argv.includes('--spread')
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const limit = Number(flag('--limit') ?? 3)
const poiFilter = flag('--poi')?.toLowerCase()
// ⚠ `--kind` EXISTS TO RUN THE WORST CASE. `--spread` samples ACROSS kinds, which is the EASY case for
// monotony — a lake and a peak have different words available, so they diverge for free. The failure
// mode this tier actually has is six of the SAME kind converging on one sentence, which is exactly
// what `81f6ca5` verified its rotation against ("six MOUNTAINS — same kind on purpose"). A green
// spread run proves nothing about it.
const kindFilter = flag('--kind')?.toLowerCase()

// The eligible population: named, KIND-bearing, road-snapped, fact-less, un-narrated, un-excluded,
// and not a member of a cluster that already speaks for it.
const rows = await db
  .select({
    id: pois.id,
    name: pois.name,
    kind: pois.kind,
    lat: pois.lat,
    lng: pois.lng,
    speakableLat: pois.speakableLat,
    speakableLng: pois.speakableLng,
  })
  .from(pois)
  .leftJoin(narrations, eq(narrations.poiId, pois.id))
  .where(
    and(
      isNull(narrations.id),
      isNull(pois.excludedReason),
      isNull(pois.clusterId),
      isNull(pois.facts), // a poi WITH facts belongs to the story path, not here
      isNotNull(pois.kind), // trap #2 — never let the NAME imply the kind
      isNotNull(pois.speakableLat), // fire where the rider can actually see it
    ),
  )
  .orderBy(pois.name)

const filtered = rows
  .filter((r) => (poiFilter ? r.name.toLowerCase().includes(poiFilter) : true))
  .filter((r) => (kindFilter ? (r.kind ?? '').toLowerCase() === kindFilter : true))

// ⚠ SAMPLE ACROSS KINDS, not down one. The b-side CLI's `--spread` exists because "green on rich
// proves nothing about thin"; the same argument applies to KIND here, and harder — a lake and a peak
// are different sayability problems ("the water's general blue" is available to a lake and meaningless
// for a ridge). Taking the first N alphabetically would test one letter, not one tier.
const byKind = new Map<string, typeof filtered>()
for (const r of filtered) {
  const k = r.kind ?? '(none)'
  const list = byKind.get(k)
  if (list) list.push(r)
  else byKind.set(k, [r])
}
// ⚠ `--offset` EXISTS TO KEEP A RE-RUN OFF THE REPAIR POPULATION. Without it `--spread` returns
// `list[0]` of each kind every time, so a second run after a prompt or wiring change re-generates the
// SAME places — and `ops-scripts-sop.md`'s tail-collapse lessons are explicit that validating a fix on
// the clips it was built from flatters it badly (a re-roll reads as a repair). Bump the offset and the
// re-test lands on places the fix has never seen.
const offset = Number(flag('--offset') ?? 0)
const kindsBySize = [...byKind.entries()].sort((a, b) => b[1].length - a[1].length)
const picked = spread
  ? kindsBySize
      .slice(0, limit)
      .map(([, list]) => list[Math.min(offset, list.length - 1)]!)
  : filtered.slice(offset, offset + limit)

// ⚠ THE OPENING SHAPE IS ASSIGNED BY INDEX, not learned from a buffer — and both alternatives are
// measured. The rolling-buffer approach this CLI shipped with FAILED on 2026-08-03: feeding
// `recentOpeners` alone left 4 of 4 clips closing alike; adding `recentClosers` took it to 3 of 6, and
// the three that collapsed were clips 1, 2 and 3 — the ones generated against an empty history, which
// is exactly the weakness cut-wave-form.md predicted in writing. A buffer also cannot persist ACROSS
// runs: both smoke rounds' PARK opened "that green patch". `81f6ca5` verified the index rotation on
// six mountains — same kind on purpose, the worst case — and got six distinct openers.
const requestFor = (
  r: (typeof filtered)[number],
  index: number,
): NarrationRequest => ({
  region: regionLabel(r.speakableLat ?? r.lat, r.speakableLng ?? r.lng),
  stopType: 'scenic',
  place: { name: r.name, ...(r.kind ? { kind: r.kind } : {}) },
  facts: [], // by definition — this tier is the places that have none
  targetSeconds: SCENIC_TARGET_SECONDS,
  maxSeconds: SCENIC_MAX_SECONDS,
  selfContained: true,
  openingAngle: openingAngleFor(index),
})

console.log(
  `\neligible (named · kind · anchored · fact-less · un-narrated): ${rows.length}` +
    `${poiFilter ? ` · matching "${poiFilter}": ${filtered.length}` : ''}` +
    ` · across ${byKind.size} kinds · previewing ${picked.length}${spread ? ' (spread across kinds)' : ''}\n`,
)

if (!apply) {
  for (const [i, r] of picked.entries()) {
    console.log('═'.repeat(100))
    console.log(`${r.name}  —  kind: ${r.kind}`)
    console.log('═'.repeat(100))
    console.log(buildFactSheet(requestFor(r, i)))
    console.log('')
  }
  console.log('─'.repeat(100))
  console.log(`PREVIEW ONLY — no model calls, $0 spent. ${picked.length} scenic call-out(s) would be generated.`)
  console.log(`Band: ~${SCENIC_TARGET_SECONDS}s target / ${SCENIC_MAX_SECONDS}s max — a glance, not a story.`)
  console.log(`System prompt: SKIPPER_SYSTEM_PROMPT (${SKIPPER_SYSTEM_PROMPT.length} chars, cached across calls).`)
  console.log(`Re-run with --apply to generate. 💸 That is an OPERATOR PAID RUN — founder go required.`)
  console.log('─'.repeat(100) + '\n')
  process.exit(0)
}

let generated = 0
let failed = 0
for (const [i, r] of picked.entries()) {
  console.log('═'.repeat(100))
  console.log(`${r.name}  —  kind: ${r.kind}`)
  console.log('═'.repeat(100))
  try {
    const result = await narrateStop(requestFor(r, i), SKIPPER_SYSTEM_PROMPT)
    generated++
    const words = result.script.split(/\s+/).filter(Boolean).length
    console.log(`\n${result.script}\n`)
    console.log(`(${words} words ≈ ${Math.round(words / 2.5)}s)\n`)
  } catch (err) {
    failed++
    console.log(`\n(FAILED: ${err instanceof Error ? err.message : String(err)})\n`)
  }
}

// "A run that did nothing must not settle GREEN; a paid one reports what it BILLED, not what it
// planned." The tally is actual usage, and a run that produced nothing exits non-zero.
console.log('─'.repeat(100))
console.log(`generated=${generated}  failed=${failed}  (of ${picked.length} attempted)`)
console.log(`NOTHING PERSISTED — no narrations row, no R2 object, no TTS. Scripts only.`)
for (const line of llmSpendLines()) console.log(line)
console.log('─'.repeat(100) + '\n')
if (generated === 0) {
  console.error('No scenic call-out was produced. Not settling green.')
  process.exit(1)
}
