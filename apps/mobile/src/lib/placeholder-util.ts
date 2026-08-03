// The composer placeholder's rotation rule (D5): which example strings exist, whether the cycle is
// allowed to run at all, and which one is on screen at tick N.
//
// Pure and native-free (no react, no react-native, no ../ui/voice, no ../theme) so it runs under
// `bun test` — the same split as preview-util.ts / location-util.ts / connectivity-util.ts. The one
// permitted import is `cleanPlaceName`, which is itself pure; `planner-examples.ts` leans on it the
// same way for the same reason.
//
// ⚠ THE SHAPES ARE A PARAMETER, NOT AN IMPORT — same seam, same reason as planner-examples.ts: the
// prose lives in `src/ui/voice.ts`, which pulls the theme and cannot load outside React Native, so
// importing it here would make this file untestable and drag the design system into a pure lib.
//
// ⚠ And the NAMES come from `region.exampleAnchors` — display names the client already holds, no ids
// and no coordinates (INV-1) — never from voice.ts. The placeholder teaches how CASUALLY you may ask;
// hardcoding a place name would both breach DESIGN §7 and risk naming a road the skipper does not run.
//
// WHY THE SPLIT IS "ARM/DISARM PREDICATE + INDEX LOOKUP", rather than an index computed from elapsed
// time: freeze-on-focus and stop-when-unfocused become the SAME mechanism — the caller tears the
// interval down and leaves its counter where it sits — so a rider who blurs the field after twelve
// seconds resumes on the next shape, not three shapes forward in one frame, and there is no second
// code path to keep in sync. An elapsed-time index would push that arithmetic back into the effect,
// which is the untestable half this file exists to empty. It also keeps the effect's dependency array
// down to one boolean: the examples array never enters a dep array, so an unmemoized rebuild upstream
// cannot thrash or restart the timer.

import { cleanPlaceName } from './labels'

/** How long one example holds the field before the next.
 *
 *  A taste number the device pass owns — deliberately unasserted in the tests, which guard the
 *  structure around it instead. */
export const PLACEHOLDER_ROTATE_MS = 4000

/** The longest example allowed to reach the field.
 *
 *  ⚠ Load-bearing, not tidiness. `exampleAnchors` are SERVER strings of unbounded length and the
 *  composer's field is `multiline`, so one long name is a placeholder that WRAPS — and a field that
 *  changes height every few seconds under the rider's thumb is strictly worse than the rotation is
 *  good. This cap is the only thing bounding an unbounded input. It can only ever shrink the list,
 *  never empty it for a real region: the name-free shapes carry no server string and always survive. */
export const PLACEHOLDER_MAX_CHARS = 36

// An absent name leaves its token IN PLACE rather than substituting '' — the leftover-token guard
// below is what turns "this shape needs a name we do not have" into "one fewer example", and an empty
// substitution would slip straight past it, reading " to , no rush".
const fill = (shape: string, a: string | undefined, b: string | undefined): string => {
  let s = shape
  if (a !== undefined) s = s.replaceAll('{a}', a)
  if (b !== undefined) s = s.replaceAll('{b}', b)
  return s
}

// ANY leftover `{…}`, not just `{a}`/`{b}`. voice.ts changes under a different review than this file,
// so a shape authored one day with a `{c}` must degrade to one fewer example rather than show a rider
// a brace — the guard has to cover tokens this file has never heard of. This is also the arity
// inference: there is no per-shape "needs N names" metadata, so adding or removing a shape stays a
// pure copy edit over in voice.ts.
const UNFILLED_TOKEN = /\{[^}]*\}/

/**
 * Compose the rotating placeholder set from a region's curated anchor names and the authored shapes.
 *
 * The FACTS/DELIVERY seam, and a deliberate near-clone of `buildExampleAsks` — same fill, same
 * leftover-token wall, same view-boundary name cleaning. Degradation falls out of the guard with no
 * arity table: two or more names light every shape, one name drops the `{b}` ones, and none still
 * leaves the name-free shapes. A region that never loaded therefore still rotates, which is a strictly
 * better floor than freezing on one static line.
 *
 * Authored order is preserved and there is no cap on count — the shape list is the editorial decision.
 */
export function buildPlaceholderExamples(
  names: readonly string[],
  shapes: readonly string[],
): string[] {
  // `places.name` carries the Wikipedia/Google ", California" disambiguator; a placeholder is
  // spoken-voice copy, so it gets the same cleaning every displayed name gets. Blanks and duplicates
  // go first, which is what makes "Tahoe City to Tahoe City" unreachable rather than merely unlikely.
  const clean: string[] = []
  for (const raw of names) {
    const n = cleanPlaceName(raw).trim()
    if (n.length > 0 && !clean.includes(n)) clean.push(n)
  }

  const a: string | undefined = clean[0]
  const b: string | undefined = clean[1]

  const out: string[] = []
  for (const shape of shapes) {
    const s = fill(shape, a, b)
    if (UNFILLED_TOKEN.test(s)) continue
    if (s.length > PLACEHOLDER_MAX_CHARS) continue
    // Deduped AFTER filling, not before: two distinct shapes can collapse to one sentence once real
    // names land, and the same line twice in a five-beat cycle reads as a stall.
    if (out.includes(s)) continue
    out.push(s)
  }
  return out
}

/** Everything the arm/disarm decision needs, as plain values the caller already has. */
export interface PlaceholderRotationFacts {
  /** `buildPlaceholderExamples(...).length`. One example is a static placeholder, not a rotation. */
  exampleCount: number
  /** The OS accessibility flag. With it on the rider sees one example and it never moves. */
  reduceMotion: boolean
  /** Is this screen the one on top? Home stays MOUNTED under a push, so without this the interval
   *  ticks forever behind Settings and the player, re-rendering a screen nobody is looking at. */
  screenFocused: boolean
  /** Is the text field focused? Text that changes while the rider is deciding what to type is a
   *  genuine distraction — the cycle stops at focus, not at the first keystroke. */
  fieldFocused: boolean
  /** No rider turn has been sent yet. The placeholder is teaching register; once the transcript is
   *  live the field is a reply box, and prose cycling next to the typing dots is motion for nothing. */
  coldOpen: boolean
}

/** Whether the caller should be running its interval at all.
 *
 *  Each veto is INDEPENDENTLY sufficient — that is the property the tests pin, because the only bug
 *  this predicate can realistically grow is an `||` where an `&&` belongs. */
export function shouldRotatePlaceholder(f: PlaceholderRotationFacts): boolean {
  return (
    f.exampleCount >= 2 &&
    !f.reduceMotion &&
    f.screenFocused &&
    !f.fieldFocused &&
    f.coldOpen
  )
}

/** The example on screen at a given tick, wrapping forever.
 *
 *  Total by construction: every input returns a string, so a blank field is unreachable even when the
 *  shapes compose to nothing (a region whose names are all too long, or a bad edit in voice.ts) — that
 *  is what `fallback` is for. The counter is a monotonically rising integer the caller never resets,
 *  so it is normalised here rather than trusted: a negative or fractional tick is a caller bug that
 *  must not become an `undefined` on screen. */
export function placeholderAt(
  examples: readonly string[],
  tick: number,
  fallback: string,
): string {
  if (examples.length === 0) return fallback
  const t = Number.isFinite(tick) ? Math.abs(Math.trunc(tick)) : 0
  return examples[t % examples.length] ?? fallback
}
