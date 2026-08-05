// planner-copy — the words the APP says on the skipper's behalf, served rather than compiled in.
//
// ⚠ WHY THIS FILE EXISTS, and it is a bug rather than a preference. Two of these lines are SEEDED into
// the transcript as the skipper's own prior sentences and re-sent to the model on the next turn, which
// makes them prompt surface: a sentence the planner prompt forbids becomes in-context precedent
// contradicting the instructions before the rider has typed anything. While they lived in the app they
// could only be corrected by shipping a build, and on 2026-08-04 that is exactly what went wrong — a
// tapped suggestion seeded "About how long do you want to be out?" for a day after the prompt banned
// that ask. No test could see it (there was no model turn to score), the eval passed, and deploying the
// prompt fixed nothing. Served from here, the prompt and the words it governs deploy together.
//
// ⚠ THIS IS NOT THE PLANNER PROMPT AND MUST NOT BECOME IT. `planner-prompt.ts` governs what the model
// GENERATES; this file holds what the app says WITHOUT a model call. They are reviewed together
// precisely because they can contradict each other — but a rule for the model does not belong here, and
// a rider-facing sentence does not belong there.
//
// ⚠ WHAT IS SAFE TO PUT HERE. A chip's `ask` is the RIDER's line, and a rider sentence cannot
// contradict the prompt — there are no rules about what a rider may say. `adjustSay` and `noStopsSay`
// are the SKIPPER's, and those are the ones that need this file. Adding another skipper line is fine;
// adding one that answers a question the prompt says he must ask is not.
//
// ⚠ THE TEMPLATES NEVER LEAVE THIS FILE. `{a}`/`{b}`/`{c}` are filled HERE and the wire carries finished
// sentences (founder, 2026-08-04). The first cut sent templates for the app to fill, which split one job
// across two codebases — the server chose the tokens, the app chose how many names to pour in — and they
// disagreed immediately: `toEnd` said "Take me to {b}." against a one-name budget, so the app's
// leftover-brace guard DROPPED the row and the chip silently vanished. Composing here deletes the seam
// rather than guarding it.
//
// No DB read, no model call, nothing billed: this is string work over names the caller already loaded.

import { cleanPlaceName, type PlannerExample } from '@skipper/shared'

/** A suggestion BEFORE composition. ⚠ It is not the wire type and must not become it: `askRegion` is a
 *  choice this file resolves, and `ask` still holds `{a}`/`{b}`/`{c}`. What leaves here is a finished
 *  `PlannerExample` with neither — the whole point of composing server-side. */
interface ExampleTemplate {
  shape: PlannerExample['shape']
  title: string
  ask: string
  askRegion?: string
}

/**
 * The cold-open suggestions, in DISPLAY ORDER.
 *
 * ⚠ SHAPES, NOT DESTINATIONS. A list of places would rebuild the tap-to-pick picker that 1.1 deleted;
 * each row instead demonstrates a different way to ASK, and the region's own names are poured in
 * client-side. Order is also PRIORITY: the client spends names from a shared cursor down this list, so
 * whatever sits first is what a thin region can still afford.
 *
 * ⚠ NO LOOP SHAPE, and adding one is a product decision rather than a copy change. A loop is an
 * explicit-ask exception (docs/decisions/no-same-road-loops.md §8) — the skipper may not offer a shape
 * he cannot know the roads support, and a suggestion the app authored makes that offer in his voice.
 *
 * ⚠ NO SEEDED REPLY, ever. Each of these is only the rider's line; the planner answers it for real. The
 * reply that used to ride alongside is the drift this whole file exists to stop.
 */
const EXAMPLES: readonly ExampleTemplate[] = [
  // ⚠ The two-name row leads because it is the shape the product is actually for.
  { shape: 'aToB', title: 'Drive somewhere', ask: '{a} to {b}, the scenic way.' },
  // Costs three names — the first row a thin region loses.
  { shape: 'via', title: 'Pass through somewhere', ask: '{a} to {b}, by way of {c}.' },
  // One name each. These are what survive a region too thin for the rows above.
  { shape: 'fromStart', title: "Say where I'm starting", ask: 'Starting from {a}.' },
  // ⚠ `{a}`, NOT `{b}` — the tokens are POSITIONAL (1st/2nd/3rd name this row was given), never roles.
  // `{b}` reads more naturally for a destination and is wrong: a one-name row is handed one name, so
  // `{b}` would never be filled and the client's leftover-brace guard would silently DROP the row
  // rather than render a brace. Caught exactly that way, on the live endpoint, before it shipped.
  { shape: 'toEnd', title: "Say where I'm going", ask: 'Take me to {a}.' },
  // ⚠ Costs NO names, so it is the one row that survives a region with none at all — including one
  // that has not loaded yet. It can therefore never be allowed to depend on a place name.
  // ⚠ `askRegion` names the REGION (`{r}`), which is a different source from the curated anchor names
  // the other rows use. Keeping them separate is what lets this row be region-specific while still
  // having a form that works when there is nothing curated to name.
  {
    shape: 'open',
    title: 'Let the skipper pick',
    ask: 'Surprise me: somewhere pretty.',
    askRegion: 'Surprise me: somewhere pretty around {r}.',
  },
]

/**
 * The whole payload. A plain constant: no DB, no session, no model, nothing to bill.
 *
 * ⚠ Both `*Say` lines below are SEEDED as skipper turns and ride the WIRE, so they are re-read by the
 * model as its own words. Change them only against the current planner prompt.
 */
export const PLANNER_COPY = {
  // ⚠ "longer, shorter" IS DELIBERATE and is not a duration ask sneaking back in. It is what riders
  // genuinely want to say, and the prompt was taught to answer it honestly rather than the copy being
  // bent to hide it: `== Once it is drawn ==` teaches that shorter means a NEARER far end and asks
  // which end moves. Do not "fix" this line to avoid the request — the conversation is the product.
  adjustSay: 'What would you change — longer, shorter, somewhere else?',
  // ⚠ States that the road came back quiet ON HIM, never that the road is dull. The prompt gives the
  // character no basis for judging a road ("not whether it is any good"), so a verdict about the place
  // would be him claiming knowledge he was never given.
  noStopsSay: 'That road came back quiet on me — nothing to tell out that way. Give me another pair and I’ll see what I’ve got.',
}

/* -------------------------------------------------------------------------- */
/*  Composition — names in, finished sentences out.                            */
/* -------------------------------------------------------------------------- */

/** How many of the region's names each shape spends. Private on purpose: nothing outside this file
 *  needs it now that filling happens here, and exporting it is what let it drift from the templates. */
const NAME_COST: Record<PlannerExample['shape'], number> = {
  aToB: 2,
  via: 3,
  fromStart: 1,
  toEnd: 1,
  open: 0,
}

/**
 * How far the name window ADVANCES per launch, given how many names this region actually has.
 *
 * ⚠ IT IS COMPUTED, NOT A CONSTANT, AND THAT IS A BUG FIX. It was a fixed 3, with a note saying it must
 * stay coprime with "the server's name count (8)". Eight is a MAXIMUM, not a guarantee — a region with
 * fewer curated places sends fewer — and a stride sharing a factor with the count strands names: at 6
 * names only 2 of the 6 windows are ever reachable, at 3 names only one. The rider then sees the same
 * town leading every single launch, which is the exact complaint the rotation was built to fix. Nobody
 * would have noticed while one region existed and it happened to have 8.
 *
 * So: the first stride from 3 upward that is coprime with `n`, falling back to 1 (always coprime).
 * Advancing by 1 is the least interesting rotation — the window slides a single slot, so consecutive
 * launches share most names in shifted roles — which is why it is the fallback rather than the rule.
 */
function strideFor(n: number): number {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  for (let s = 3; s < 3 + n; s++) if (gcd(s, n) === 1) return s
  return 1
}

/** The region's names, rotated so a different window leads this launch. `rotation` is the client's own
 *  launch counter and may be any non-negative integer; it wraps. ⚠ Guarded against a corrupt counter
 *  off the caller's disk: a negative or non-finite value would produce NaN indices and blank every row. */
function rotate(names: readonly string[], rotation: number): string[] {
  if (names.length === 0) return []
  const stride = strideFor(names.length)
  const r =
    Number.isFinite(rotation) && rotation > 0
      ? (Math.floor(rotation) * stride) % names.length
      : 0
  return [...names.slice(r), ...names.slice(0, r)]
}

export interface RegionCopy {
  examples: PlannerExample[]
  /** The cleaned, deduped, rotated names the sentences were built from — handed back so the composer
   *  placeholder can name the same places without re-deriving the rotation. */
  names: string[]
}

/**
 * Compose one region's cold-open suggestions.
 *
 * ⚠ NAMES ARE SPENT FROM ONE CURSOR, never indexed per shape. Five shapes want seven names between them
 * and a full region sends eight, so every row names something DIFFERENT. Indexing each shape from the
 * first name would put one town in three rows at once — the "one town shouting" complaint this rotation
 * exists to fix, rebuilt with more chips.
 *
 * ⚠ A shape it cannot afford is SKIPPED, not terminal: a thin region keeps the one-name rows rather
 * than collapsing to the open ask. Order is therefore priority as well as display order.
 */
export function composeRegionCopy(
  rawNames: readonly string[],
  regionName: string | null,
  rotation: number,
): RegionCopy {
  // `places.name` carries the Wikipedia/Google ", California" disambiguator; a suggestion is
  // spoken-voice copy, so it gets the same cleaning a displayed name gets. Blanks and duplicates go
  // first, which is what makes "Tahoe City to Tahoe City" unreachable rather than merely unlikely.
  const clean: string[] = []
  for (const raw of rawNames) {
    const n = cleanPlaceName(raw).trim()
    if (n.length > 0 && !clean.includes(n)) clean.push(n)
  }
  const names = rotate(clean, rotation)

  let cursor = 0
  const out: PlannerExample[] = []
  const label = regionName?.trim()
  for (const e of EXAMPLES) {
    // ⚠ `?? 0` is not defensive padding: a shape with no cost entry is one this file forgot to budget
    // for, and treating it as free renders it with no names rather than dropping it silently — the
    // unfilled-token wall below then catches it loudly at the last moment.
    const cost = NAME_COST[e.shape] ?? 0
    if (names.length - cursor < cost) continue
    const taken = names.slice(cursor, cursor + cost)
    cursor += cost
    let ask = label && e.askRegion ? e.askRegion.replaceAll('{r}', label) : e.ask
    ;(['{a}', '{b}', '{c}'] as const).forEach((token, i) => {
      const name = taken[i]
      if (name !== undefined) ask = ask.replaceAll(token, name)
    })
    // ⚠ A structural wall, not a belt. A template that grows a token its shape has no budget for must
    // cost one ROW, never render a brace at a rider — and since the sentence is finished here, this is
    // the last place that can tell. ANY `{…}`, not just the ones this file fills today.
    if (/\{[^}]*\}/.test(ask)) continue
    out.push({ shape: e.shape, title: e.title, ask })
  }
  return { examples: out, names }
}
