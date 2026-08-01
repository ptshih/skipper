// The tappable example asks (D17) — three authored ask/reply PAIRS the rider can seed the
// conversation with for zero dollars and zero server work.
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

/** One chip: the rider's line, and the skipper's hand-authored answer to it. */
export interface ExampleAsk {
  ask: string
  reply: string
}

/** The `{a}`/`{b}` templates, straight from `voice.plan`. */
export interface ExampleAskTemplates {
  aToB: string
  aToBReply: string
  loop: string
  loopReply: string
  open: string
  openReply: string
}

// A placeholder with no name behind it is LEFT IN PLACE rather than filled with '' — an empty
// substitution would read as "A loop out of ." and slip past the leftover-brace guard below, which is
// the whole reason that guard exists.
const fill = (template: string, a: string | undefined, b: string | undefined): string => {
  let s = template
  if (a !== undefined) s = s.replaceAll('{a}', a)
  if (b !== undefined) s = s.replaceAll('{b}', b)
  return s
}

/**
 * Build the chips for a region's example anchors.
 *
 * Three shapes, not three destinations — three destinations would rebuild the picker D7 deleted. Each
 * chip demonstrates a different way to ASK: A→B one-way, a round trip with a duration target, and a
 * fully open-ended line that names no place at all.
 *
 * Degrades by how many names the region has: ≥2 → all three; 1 → the loop + the open one; 0 (or a
 * region that never loaded) → only the open one, which needs no facts. It never returns a chip whose
 * text would show a rider an empty gap where a place name belongs.
 */
export function buildExampleAsks(
  names: readonly string[],
  t: ExampleAskTemplates,
): ExampleAsk[] {
  // `places.name` carries Wikipedia/Google ", California" suffixes; a chip is spoken-voice copy, so it
  // gets the same view-boundary cleaning every displayed name gets. Blanks and duplicates are dropped
  // first — "Tahoe City to Tahoe City, the scenic way" is not an example of anything.
  const clean: string[] = []
  for (const raw of names) {
    const n = cleanPlaceName(raw).trim()
    if (n.length > 0 && !clean.includes(n)) clean.push(n)
  }

  const a = clean[0]
  const b = clean[1]
  const out: ExampleAsk[] = []
  if (clean.length >= 2) out.push({ ask: fill(t.aToB, a, b), reply: fill(t.aToBReply, a, b) })
  if (clean.length >= 1) out.push({ ask: fill(t.loop, a, b), reply: fill(t.loopReply, a, b) })
  out.push({ ask: fill(t.open, a, b), reply: fill(t.openReply, a, b) })

  // A structural wall, not a belt: voice.ts changes under a different review than this file, so a
  // `{b}` added to the loop template one day must degrade to "one fewer chip", never render braces at
  // a rider. Cheaper than a lint rule and it fails at the only place that can see both halves.
  return out.filter((e) => !/\{[ab]\}/.test(e.ask) && !/\{[ab]\}/.test(e.reply))
}
