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

/** The `{a}`/`{b}` templates, straight from `voice.plan`. */
export interface ExampleAskTemplates {
  // ⚠ The `*Title`s carry no `{a}`/`{b}` and are passed straight through unfilled — they are
  // delivery, not facts. The leftover-brace wall below therefore never has to consider them.
  aToBTitle: string
  aToB: string
  /** Pass-through: `{a}` to `{b}` by way of `{c}`. Costs THREE names, the most of any shape. */
  viaTitle: string
  via: string
  /** One end only. Both cost a single name, which is why they survive regions the A→B row cannot. */
  fromStartTitle: string
  fromStart: string
  toEndTitle: string
  toEnd: string
  openTitle: string
  open: string
  /** The same open-ended ask, but naming the REGION (`{r}`). Used when a region name is known.
   *
   *  ⚠ `{r}` is the region's display name — NOT one of the curated anchor names `{a}`/`{b}` come
   *  from. Keeping them separate is what lets this row be region-specific like the other two while
   *  still having a form that survives a region with zero curated anchors. */
  openRegion: string
}

// A placeholder with no name behind it is LEFT IN PLACE rather than filled with '' — an empty
// substitution would read as "Tahoe City to ." and slip past the leftover-brace guard below, which is
// the whole reason that guard exists.
const fill = (template: string, a?: string, b?: string, c?: string): string => {
  let s = template
  if (a !== undefined) s = s.replaceAll('{a}', a)
  if (b !== undefined) s = s.replaceAll('{b}', b)
  if (c !== undefined) s = s.replaceAll('{c}', c)
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
  t: ExampleAskTemplates,
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

  // ⚠ NAMES ARE SPENT FROM A CURSOR, NEVER INDEXED PER SHAPE, and that is what stops two rows saying
  // the same town. Five shapes want seven names between them; the server sends
  // EXAMPLE_ANCHORS_PER_REGION (8), so a full region fills every row with a DIFFERENT name. Indexing
  // each shape independently would have put `clean[0]` in three rows at once, which is the "one town
  // shouting" complaint this whole area exists to fix, rebuilt with more chips.
  let cursor = 0
  const take = (n: number): string[] | null => {
    if (clean.length - cursor < n) return null
    const out = clean.slice(cursor, cursor + n)
    cursor += n
    return out
  }

  const out: ExampleAsk[] = []
  // ⚠ ORDER IS DISPLAY ORDER **AND** PRIORITY, because the cursor is greedy: whatever comes first gets
  // the names. A→B leads because it is the shape the product is actually for. ⚠ A shape that cannot be
  // afforded is SKIPPED, not terminal — the one-name rows still render in a region too thin for the
  // three-name one, which is the degradation that matters (a 4-name region gets A→B plus both ends
  // rather than A→B alone).
  const ab = take(2)
  if (ab) out.push({ shape: 'aToB', title: t.aToBTitle, ask: fill(t.aToB, ab[0], ab[1]) })

  const abc = take(3)
  if (abc) out.push({ shape: 'via', title: t.viaTitle, ask: fill(t.via, abc[0], abc[1], abc[2]) })

  const from = take(1)
  if (from) out.push({ shape: 'fromStart', title: t.fromStartTitle, ask: fill(t.fromStart, from[0]) })

  const to = take(1)
  if (to) out.push({ shape: 'toEnd', title: t.toEndTitle, ask: fill(t.toEnd, undefined, to[0]) })

  const regionLabel = regionName?.trim()
  out.push({
    shape: 'open',
    title: t.openTitle,
    ask: regionLabel ? t.openRegion.replaceAll('{r}', regionLabel) : t.open,
  })

  // A structural wall, not a belt: voice.ts changes under a different review than this file, so a
  // `{b}` added to a one-name template one day must degrade to "one fewer chip", never render braces at
  // a rider. Cheaper than a lint rule and it fails at the only place that can see both halves.
  // ⚠ ANY `{…}` token, not just `{a}`/`{b}`: `{r}` joined the vocabulary and the next one will not
  // announce itself either. A guard that only knows the tokens it was written against is a guard that
  // silently stops covering the newest one.
  const UNFILLED = /\{[^}]*\}/
  return out.filter((e) => !UNFILLED.test(e.ask))
}
