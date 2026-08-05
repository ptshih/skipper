// The tappable example asks (D17) — authored RIDER LINES the tap sends on the rider's behalf.
//
// ⚠ THERE IS NO AUTHORED SKIPPER REPLY ANY MORE, and adding one back re-opens a bug that reached
// TestFlight (founder, 2026-08-04). Each chip used to seed BOTH sides — the rider's line and a
// hand-written skipper answer — for zero dollars. The skipper half then drifted from the planner
// prompt: it went on asking "About how long do you want to be out?" for a day after the prompt was
// changed to forbid that ask. Nothing caught it, because there was no model turn to catch — deploying
// the prompt fixed nothing and the eval passed. Worse, a seeded reply rides the WIRE, so the app was
// feeding the model a banned sentence as its OWN prior words on the highest-traffic path in the app.
// A tap now sends the rider's line and the planner answers for real, like any typed message. The chip
// can no longer put words in the skipper's mouth, which is the only durable fix: prose here cannot
// drift from a prompt it no longer duplicates.
//
// ⚠ THERE WAS A THIRD, AND IT WAS A LOOP. Removed 2026-08-03 when a loop became an EXPLICIT-ASK
// exception (docs/decisions/no-same-road-loops.md §8) — the skipper may not offer a shape he cannot
// know the roads support, and a chip we authored makes that offer in his voice. Do not add it back as
// a copy change.
//
// Pure and native-free so it runs under `bun test`.
//
// ⚠ THE TEMPLATES ARE A PARAMETER, NOT AN IMPORT. The prose lives in `src/ui/voice.ts`, which pulls
// the theme and cannot load outside React Native — importing it here would make this file untestable
// and drag the design system into a pure lib. The screen passes `voice.plan.example*` in.
//
// ⚠ Names only. `region.exampleAnchors` carries display NAMES — no ids, no coordinates — and nothing
// here reconstructs an endpoint from one (INV-1). A seeded ask is CONVERSATION: the planner resolves
// whatever the rider says back to an anchor id server-side, exactly as it does for a typed line.

import { PLANNER_EXAMPLE_NAME_COST, type PlannerExample } from '@skipper/shared'
import { cleanPlaceName } from './labels'

/** How far the name window ADVANCES per launch — deliberately NOT the window's width.
 *
 *  ⚠ The two were the same number until 2026-08-03 and are not any more: dropping the loop chip took a
 *  cold open from spending three names to spending two (the A→B start and end), and the stride stayed
 *  3. They answer different questions, so they are no longer one constant wearing two hats.
 *
 *  ⚠ **IT MUST STAY COPRIME WITH THE SERVER'S NAME COUNT (8), or names get stranded.** At a stride of
 *  2 only the even slots ever lead, so half the region's names would never open a cold open — which is
 *  the literal "Carson City led every launch" complaint this rotation was built to fix, re-created by
 *  arithmetic. 3 and 8 are coprime, so every name visits slot 0 before any repeats. Pinned in
 *  planner-examples.test.ts; changing this to 2 to "match" the window fails that test, which is the
 *  point of it.
 *
 *  ⚠ Advancing by 1 is the other failure mode: the window would slide a single slot, so two launches in
 *  a row would show the same names in different roles — a glitch, not variety. */
export const EXAMPLE_ROTATION_STRIDE = 3

/**
 * The region's names, rotated left so a different window sits at the front.
 *
 * ⚠ THE CLIENT'S ENTIRE SHARE OF THE SELECTION, and deliberately this dumb. It is given NAMES and
 * nothing else — no ids, no coordinates (INV-1) — so it cannot tell whether two names are 600 m or
 * 60 km apart, and must not pretend to. Every judgement about which names may sit together was
 * already made server-side by the farthest-point spread; this only decides which slice of that
 * ordering is on screen today. Anything smarter here would be guessing about geography it cannot see.
 *
 * `rotation` is a launch counter and may be any non-negative integer; it wraps.
 */
export function rotateNames(names: readonly string[], rotation: number): string[] {
  if (names.length === 0) return []
  // Guard the modulo against a corrupt counter off disk: a negative or non-finite value would produce
  // NaN indices and blank every chip, and the cache it comes from is explicitly "never throws,
  // degrade quietly" territory.
  const r = Number.isFinite(rotation) && rotation > 0 ? Math.floor(rotation) % names.length : 0
  return [...names.slice(r), ...names.slice(0, r)]
}

/** One suggestion: how it is LABELLED, the rider's line, and the skipper's hand-authored answer.
 *
 *  ⚠ `title` and `ask` are two different registers on purpose. The title says what SHAPE of drive
 *  this is and never names a place (pure delivery, safe to author in voice.ts); the ask is the literal
 *  sentence the tap will say, filled from the region's own curated names. Cramming the second into a
 *  chip-sized label is the defect this split exists to remove. */
export interface ExampleAsk {
  /** Which shape this is.
   *
   *  ⚠ EXISTS SO THE SCREEN NEVER INDEXES BY POSITION. The list DEGRADES — fewer than two curated
   *  names drops the A→B entry — so `asks[0]` is not always the same shape, and anything the screen
   *  pairs positionally (an icon, a glyph, an analytics label) silently mis-pairs in exactly the
   *  degraded regions nobody is looking at. A discriminator costs one field and cannot drift.
   *  ⚠ Still a UNION with one member removed rather than a boolean: the set has changed size once
   *  already, and a boolean would have to be reworked the next time rather than extended. */
  shape: 'aToB' | 'via' | 'fromStart' | 'toEnd' | 'open'
  title: string
  ask: string
}

// ⚠ The name costs live in `@skipper/shared` (PLANNER_EXAMPLE_NAME_COST), NOT here, because the SERVER
// writes the `{a}`/`{b}`/`{c}` tokens and this file decides how many names to pour in. Held separately
// the two drifted silently — a mismatch makes the leftover-brace guard drop the row, so a chip just
// stops appearing and nothing fails. That header carries the account.

// ⚠ POSITIONAL: `{a}`/`{b}`/`{c}` are simply the 1st/2nd/3rd name this row was given, NOT roles. One
// rule for every shape means the server can write a single-name row as `{a}` and nothing here has to
// know which shape it was. A token with no name behind it is LEFT IN PLACE rather than filled with ''
// — an empty substitution reads as "Tahoe City to ." and slips past the leftover-brace guard below,
// which is the whole reason that guard exists.
const fill = (template: string, taken: readonly string[]): string => {
  let s = template
  const tokens = ['{a}', '{b}', '{c}'] as const
  taken.forEach((name, i) => {
    const token = tokens[i]
    if (token) s = s.replaceAll(token, name)
  })
  return s
}

/**
 * Build the chips for a region's example anchors.
 *
 * Shapes, not destinations — destinations would rebuild the picker D7 deleted. Each chip demonstrates a
 * different way to ASK: a one-way A→B, and a fully open-ended line that names no place at all.
 *
 * Degrades by how many names the region has, and by SHAPE rather than by count: each row is skipped
 * when too few names are left to fill it, so a thin region loses the three-name pass-through and keeps
 * the one-name rows. The open-ended row needs no names at all and therefore always survives — including
 * a region that never loaded. It never returns a chip whose text would show a rider an empty gap where
 * a place name belongs.
 */
export function buildExampleAsks(
  names: readonly string[],
  examples: readonly PlannerExample[],
  regionName?: string,
): ExampleAsk[] {
  // `places.name` carries Wikipedia/Google ", California" suffixes; a chip is spoken-voice copy, so it
  // gets the same view-boundary cleaning every displayed name gets. Blanks and duplicates are dropped
  // first — "Tahoe City to Tahoe City, the scenic way" is not an example of anything.
  const clean: string[] = []
  for (const raw of names) {
    const n = cleanPlaceName(raw).trim()
    if (n.length > 0 && !clean.includes(n)) clean.push(n)
  }

  // ⚠ NAMES ARE SPENT FROM ONE CURSOR, NEVER INDEXED PER SHAPE, and that is what stops two rows saying
  // the same town. Five shapes want seven names between them and the server sends eight
  // (EXAMPLE_ANCHORS_PER_REGION), so a full region fills every row with a DIFFERENT name. Indexing each
  // shape from clean[0] would rebuild the "one town shouting" complaint this whole area exists to fix.
  let cursor = 0
  const take = (n: number): string[] | null => {
    if (clean.length - cursor < n) return null
    const out = clean.slice(cursor, cursor + n)
    cursor += n
    return out
  }

  const regionLabel = regionName?.trim()
  const out: ExampleAsk[] = []
  // ⚠ SERVER ORDER IS DISPLAY ORDER **AND** PRIORITY, because the cursor is greedy: whatever comes
  // first gets the names. Reordering the payload therefore reorders the screen AND changes what a thin
  // region can afford — one decision, made server-side, in one place.
  for (const e of examples) {
    // ⚠ An UNKNOWN shape is dropped, not guessed at. The server may ship a shape this build has never
    // heard of (that is the point of serving the copy), and it would have no name cost and no icon
    // here — rendered anyway it would be filled wrong and crash the icon lookup.
    const cost = PLANNER_EXAMPLE_NAME_COST[e.shape]
    if (cost === undefined) continue
    // ⚠ SKIPPED, not terminal: a row it cannot afford is passed over and the CHEAPER rows below still
    // render. Stopping at the first unaffordable shape would strip a thin region back to the open ask.
    const taken = take(cost)
    if (!taken) continue
    // The region-named variant when we have a region, the bare one when we do not. ⚠ The bare form is
    // not tidiness — it is the one ask that survives a region that has not LOADED, so it can never be
    // allowed to depend on a name of any kind.
    const template = regionLabel && e.askRegion ? e.askRegion.replaceAll('{r}', regionLabel) : e.ask
    out.push({ shape: e.shape, title: e.title, ask: fill(template, taken) })
  }

  // A structural wall, not a belt: the copy now changes on a SERVER deploy, with no app build and no
  // review of this file at all, so a `{b}` added to a one-name template must degrade to "one fewer
  // chip", never render braces at a rider. That seam got wider when the words moved server-side.
  // ⚠ ANY `{…}` token, not just `{a}`/`{b}`: `{r}` joined the vocabulary and the next one will not
  // announce itself either.
  const UNFILLED = /\{[^}]*\}/
  return out.filter((e) => !UNFILLED.test(e.ask))
}

