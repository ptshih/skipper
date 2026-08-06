// SOURCE ASSERTIONS over the home screen.
//
// ⚠ THESE ARE A DELIBERATE EXCEPTION, NOT A PATTERN. Asserting on source text is normally a smell —
// it pins spelling rather than behaviour and breaks on innocent refactors. It earns its place for
// exactly the defects whose failure has NO RUNTIME SYMPTOM TODAY, which is the case for both below:
// one deletes a decoration nobody would miss until the identity quietly thinned, and the other only
// becomes visible the day a second region ships, which could be months out. Everything else about
// this screen fails loudly the moment someone opens the app, and belongs in a real test.
//
// The rule for adding to this file: if you can see the defect by launching the app, it does not go
// here.
import { describe, expect, test } from 'bun:test'

const RAW = await Bun.file(new URL('../../app/index.tsx', import.meta.url)).text()

// ⚠ COMMENTS ARE STRIPPED BEFORE ASSERTING, and the first cut of this file proved why: the assertion
// that the dormant chip row is gone matched the COMMENT explaining that it was removed. A source
// assertion cannot tell code from prose, so it has to be handed only the code — otherwise the fix for
// a false positive is to water down a comment that is doing real work.
// Deliberately crude (it would also blank a `//` inside a string literal); this file only ever asks
// "does this identifier appear in the code", and there are no URLs or regexes in the way.
const HOME = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

describe('home keeps the decorations that cannot fail loudly', () => {
  // The decoration used to be `Ridgeline`, which lived INSIDE the hero block; deleting that block
  // would have taken it with it, silently, leaving a screen that still looked fine and had lost its
  // last poster reference. `HomePoster` replaced it (docs/designs/home-hero-poster.md) and inherits
  // the same hazard: it is decorative and cold-open-only, so losing it breaks no behaviour and fails
  // no other test — the screen just quietly goes plain again, which is the exact complaint that
  // produced it.
  test('the cold-open poster is still rendered', () => {
    expect(HOME).toContain('<HomePoster')
  })

  // ⚠ WHERE it is rendered is the load-bearing part, and this is the assertion with teeth. The
  // poster must be handed to the SHELL's `backdrop` slot so it paints behind the scroll content and
  // against the bottom edge. Rendered as an ordinary child of the content container it would scroll
  // away with the cards — a defect that looks fine on a first glance at a full screen and only shows
  // up once someone scrolls, which is precisely the "no loud symptom" bar this file exists for.
  test('the poster is handed to the shell as a backdrop, not rendered inline', () => {
    expect(HOME).toContain('backdrop={backdrop}')
    expect(HOME).toMatch(/const backdrop = coldOpen \?/)
  })
})

describe('home has exactly one region switcher', () => {
  // ⚠ THE DEFECT THIS GUARDS IS INVISIBLE UNTIL REGION 2 SHIPS. A dormant `regions.length > 1` chip
  // row sat here for months rendering nothing, because one region auto-selects. Leaving it beside the
  // new RegionChip would have shipped TWO switchers that both appear for the first time on the day a
  // second region lands — i.e. the defect surfaces at the exact moment it is most confusing, and no
  // amount of looking at the app today would reveal it.
  // ⚠ THE OBVIOUS ASSERTION HERE WAS A FAKE, and a mutation check is the only reason that is known:
  // the first cut asserted the literal `regions.length > 1`, then a deliberate re-introduction spelled
  // `regions?.length` and sailed straight through. Pinning a SPELLING catches only the exact previous
  // author. These pin the two things that are actually structural instead.
  test('the region affordance is declared exactly once', () => {
    // ⚠ DECLARED, not rendered — and the difference is deliberate. This counts the JSX element, so
    // duplicating the `{masthead}` USAGE slips past it (mutation-checked: it does). That is the right
    // division of labour for this file: two chips side by side is a defect you cannot miss the second
    // you launch the app, whereas a second SWITCHER quietly declared for a multi-region future is
    // invisible until that future arrives. Only the second kind belongs here.
    expect(HOME.match(/<RegionChip/g) ?? []).toHaveLength(1)
  })

  test('FilterChip — the deleted row\'s primitive — does not appear on home', () => {
    // Home has no other use for it, so its reappearance IS the deleted row being rebuilt. Mutation-
    // checked: adding one back fails this.
    expect(HOME).not.toContain('<FilterChip')
  })
})
