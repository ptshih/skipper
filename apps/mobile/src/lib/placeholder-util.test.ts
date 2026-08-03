// The rotating composer placeholder AS TESTS. Three questions, all answerable with plain values:
// which examples survive a region's names, whether the cycle is armed, and what is on screen at tick
// N. Runs under `bun test` — ⚠ NO FAKE TIMERS, no mocks, nothing async, by design: the interval is
// the caller's, and the whole point of the arm/disarm + index split is that the part worth testing
// never touches a clock.
//
// DELIBERATELY NOT TESTED, so the next reader does not add them:
// - `PLACEHOLDER_ROTATE_MS` / `PLACEHOLDER_MAX_CHARS` get no assertion of their own. They are taste
//   numbers the device pass owns, and a test on either would only restate the constant. What IS
//   guarded is the structure around them: that a cap exists, that it can only shrink the list, and
//   that the floor stays at two examples for any real region.
// - That `voice.ts` contains no place name. Unreachable from `bun test` (voice.ts pulls the theme);
//   the `{a}`/`{b}` parameterization is the mechanism and code review is the guard.
import { describe, expect, test } from 'bun:test'
import {
  buildPlaceholderExamples,
  placeholderAt,
  PLACEHOLDER_MAX_CHARS,
  shouldRotatePlaceholder,
  type PlaceholderRotationFacts,
} from './placeholder-util'

// Shaped like voice.plan.placeholderShapes (the prose lives there; these only need the tokens and the
// arity spread: two-name, one-name-b, one-name-a, and two that need no facts at all).
const SHAPES = [
  '{a} to {b}',
  '{b}, no rush',
  '90 min from {a}',
  'anywhere with a view',
  'surprise me',
] as const

describe('buildPlaceholderExamples — shape degradation', () => {
  test('two or more names → every shape survives, in authored order', () => {
    expect(
      buildPlaceholderExamples(['Tahoe City', 'Emerald Bay', 'Incline Village'], SHAPES),
    ).toEqual([
      'Tahoe City to Emerald Bay',
      'Emerald Bay, no rush',
      '90 min from Tahoe City',
      'anywhere with a view',
      'surprise me',
    ])
  })

  test('one name → the {b} shapes drop, order preserved', () => {
    expect(buildPlaceholderExamples(['Tahoe City'], SHAPES)).toEqual([
      '90 min from Tahoe City',
      'anywhere with a view',
      'surprise me',
    ])
  })

  test('no names → only the shapes that need no facts, and still enough to rotate', () => {
    // ⚠ The floor that matters: a region-less cold start (first launch, /regions still in flight, or
    // failed) rotates two name-free lines rather than freezing on one static string.
    const out = buildPlaceholderExamples([], SHAPES)
    expect(out).toEqual(['anywhere with a view', 'surprise me'])
    expect(out.length).toBeGreaterThanOrEqual(2)
  })

  test('only the first two names are ever consumed', () => {
    const out = buildPlaceholderExamples(['Tahoe City', 'Emerald Bay', 'Incline Village'], SHAPES)
    expect(out.join(' | ')).not.toContain('Incline Village')
  })

  test('a shape reaching for a third name is dropped, not rendered with a brace', () => {
    // The guard covers tokens this module has never heard of, which is what makes "only a and b are
    // consumed" safe to state: a `{c}` authored into voice.ts costs one example, never a brace.
    const out = buildPlaceholderExamples(
      ['Tahoe City', 'Emerald Bay', 'Incline Village'],
      ['{a} to {c}', 'surprise me'],
    )
    expect(out).toEqual(['surprise me'])
  })
})

describe('buildPlaceholderExamples — the names themselves', () => {
  test('cleanPlaceName runs before interpolation', () => {
    const out = buildPlaceholderExamples(['Tahoe Keys, California', 'Rubicon, California'], SHAPES)
    expect(out[0]).toBe('Tahoe Keys to Rubicon')
  })

  test('blank and duplicate names are dropped, so "X to X" is unreachable', () => {
    // The second and third clean to the SAME place — one name's worth of facts, so this behaves
    // exactly as the one-name case rather than composing a sentence that goes nowhere.
    expect(
      buildPlaceholderExamples(['  ', 'Tahoe City', 'Tahoe City, California'], SHAPES),
    ).toEqual(buildPlaceholderExamples(['Tahoe City'], SHAPES))
  })

  test('no output ever contains a literal {a} or {b}, at any name count', () => {
    const names = ['Tahoe Keys, California', 'Rubicon', 'Incline Village']
    for (let n = 0; n <= names.length; n++) {
      for (const s of buildPlaceholderExamples(names.slice(0, n), SHAPES)) {
        expect(s).not.toMatch(/\{[ab]\}/)
      }
    }
  })

  test('a shape that grows a {b} degrades to one fewer example, never to braces on screen', () => {
    // voice.ts changes under a different review than this file — this is that seam's guard.
    const grown = SHAPES.map((s) => (s === '90 min from {a}' ? '90 min from {a} to {b}' : s))
    expect(buildPlaceholderExamples(['Tahoe City'], grown)).toEqual([
      'anywhere with a view',
      'surprise me',
    ])
  })

  test('two shapes that collapse to one sentence appear once', () => {
    const out = buildPlaceholderExamples(
      ['Tahoe City', 'Emerald Bay'],
      ['{a} to {b}', 'Tahoe City to Emerald Bay', 'surprise me'],
    )
    expect(out).toEqual(['Tahoe City to Emerald Bay', 'surprise me'])
  })
})

describe('buildPlaceholderExamples — the length cap', () => {
  test('a pathologically long anchor drops its shapes and leaves the floor intact', () => {
    // ⚠ The test that proves the cap can only ever SHRINK the list, never empty it: the name-free
    // shapes carry no server string, so a region of forty-character names still rotates.
    const out = buildPlaceholderExamples(
      ['Emerald Bay State Marine Conservation Area', 'South Lake Tahoe'],
      SHAPES,
    )
    expect(out).toEqual(['South Lake Tahoe, no rush', 'anywhere with a view', 'surprise me'])
    expect(out.length).toBeGreaterThanOrEqual(2)
  })

  test('an over-long shape with no tokens is dropped too — the cap catches authoring, not just data', () => {
    const wordy = 'anywhere with a really spectacular view of the water'
    expect(wordy.length).toBeGreaterThan(PLACEHOLDER_MAX_CHARS)
    expect(buildPlaceholderExamples([], [wordy, 'surprise me'])).toEqual(['surprise me'])
  })

  test('every output of every fixture above is within the cap', () => {
    const fixtures: readonly string[][] = [
      [],
      ['Tahoe City'],
      ['Tahoe City', 'Emerald Bay', 'Incline Village'],
      ['Tahoe Keys, California', 'Rubicon, California'],
      ['Emerald Bay State Marine Conservation Area', 'South Lake Tahoe'],
    ]
    for (const names of fixtures) {
      for (const s of buildPlaceholderExamples(names, SHAPES)) {
        expect(s.length).toBeLessThanOrEqual(PLACEHOLDER_MAX_CHARS)
      }
    }
  })

  test('every shape over the cap → an empty list, no throw and no partial string', () => {
    // An empty list is a SUPPORTED outcome, not a failure — it hands off to placeholderAt's fallback.
    expect(buildPlaceholderExamples(['Tahoe City'], ['x'.repeat(PLACEHOLDER_MAX_CHARS + 1)])).toEqual(
      [],
    )
  })
})

describe('shouldRotatePlaceholder', () => {
  const ROTATING: PlaceholderRotationFacts = {
    exampleCount: 5,
    reduceMotion: false,
    screenFocused: true,
    fieldFocused: false,
    coldOpen: true,
  }

  test('the baseline rotates', () => {
    expect(shouldRotatePlaceholder(ROTATING)).toBe(true)
  })

  test('Reduce Motion vetoes — show one and stop', () => {
    expect(shouldRotatePlaceholder({ ...ROTATING, reduceMotion: true })).toBe(false)
  })

  test('field focus vetoes, even with the screen focused and motion on', () => {
    // Freeze-on-focus. Stated as its own case because it is the one a reviewer would not think to
    // write: nothing else on the screen changes when a field takes focus.
    expect(shouldRotatePlaceholder({ ...ROTATING, fieldFocused: true })).toBe(false)
  })

  test('an unfocused screen vetoes', () => {
    // Home stays MOUNTED under a push, so this is the case that stops the interval ticking behind
    // Settings and the player rather than the case that unmounts it.
    expect(shouldRotatePlaceholder({ ...ROTATING, screenFocused: false })).toBe(false)
  })

  test('a live transcript vetoes — the placeholder is teaching register, not decoration', () => {
    expect(shouldRotatePlaceholder({ ...ROTATING, coldOpen: false })).toBe(false)
  })

  test('nothing to rotate to vetoes: 0 and 1 examples', () => {
    expect(shouldRotatePlaceholder({ ...ROTATING, exampleCount: 0 })).toBe(false)
    expect(shouldRotatePlaceholder({ ...ROTATING, exampleCount: 1 })).toBe(false)
  })

  test('each veto is independently sufficient', () => {
    // ⚠ The assertion that fails if someone writes `||` where `&&` belongs. A full truth table would
    // only restate the implementation and is deliberately not written.
    const vetoes: Partial<PlaceholderRotationFacts>[] = [
      { reduceMotion: true },
      { screenFocused: false },
      { fieldFocused: true },
      { coldOpen: false },
    ]
    for (const veto of vetoes) {
      expect(shouldRotatePlaceholder({ ...ROTATING, ...veto })).toBe(false)
    }
  })
})

describe('placeholderAt', () => {
  const E = ['one', 'two', 'three']

  test('cycles in authored order and wraps', () => {
    expect([0, 1, 2, 3].map((t) => placeholderAt(E, t, 'fallback'))).toEqual([
      'one',
      'two',
      'three',
      'one',
    ])
  })

  test('a screen left open for weeks still lands on a real example', () => {
    expect(E).toContain(placeholderAt(E, 1_000_000, 'fallback'))
  })

  test('an empty list is exactly the fallback, at every tick', () => {
    // The assertion that guarantees the field is never blank.
    for (const t of [0, 1, 7]) expect(placeholderAt([], t, 'Tell me where to')).toBe('Tell me where to')
  })

  test('a single-element list returns that element forever', () => {
    // Belt to shouldRotatePlaceholder's brace: a future caller that rotates a 1-list cannot crash.
    for (const t of [0, 1, 2, 99]) expect(placeholderAt(['only'], t, 'fallback')).toBe('only')
  })

  test('non-finite, negative and fractional ticks still return a real example', () => {
    // The signature admits any `number`, so totality is asserted rather than assumed.
    for (const t of [Number.NaN, Number.POSITIVE_INFINITY, -1, 2.7]) {
      expect(E).toContain(placeholderAt(E, t, 'fallback'))
    }
  })
})
