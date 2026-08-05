// buildExampleAsks AS TESTS — the chip set degrades by how many curated names the region has, and no
// rider ever sees a `{a}` or a gap where a place name belongs. Runs under `bun test`.
import { describe, expect, test } from 'bun:test'
import {
  buildExampleAsks,
  EXAMPLE_ROTATION_STRIDE,
  rotateNames,
  type ExampleAskTemplates,
} from './planner-examples'

// Shaped like voice.plan's real templates (the prose lives there; these only need the placeholders).
const T: ExampleAskTemplates = {
  aToBTitle: 'Drive somewhere',
  aToB: '{a} to {b}, the scenic way.',
  viaTitle: 'Pass through somewhere',
  via: '{a} to {b}, by way of {c}.',
  fromStartTitle: "Say where I'm starting",
  fromStart: 'Starting from {a}.',
  toEndTitle: "Say where I'm going",
  toEnd: 'Take me to {b}.',
  openTitle: 'Let the skipper pick',
  open: 'Surprise me — somewhere pretty.',
  openRegion: 'Surprise me — somewhere pretty around {r}.',
}

/** Eight names, as EXAMPLE_ANCHORS_PER_REGION sends. */
const EIGHT = ['Tahoe City', 'Emerald Bay', 'Incline Village', 'Kings Beach', 'Truckee', 'Stateline', 'Carson City', 'Genoa']

describe('shape degradation', () => {
  test('a full region fills every shape, and NO NAME IS SAID TWICE', () => {
    const asks = buildExampleAsks(EIGHT, T)
    expect(asks.map((e) => e.shape)).toEqual(['aToB', 'via', 'fromStart', 'toEnd', 'open'])
    expect(asks[0]?.ask).toBe('Tahoe City to Emerald Bay, the scenic way.')
    expect(asks[1]?.ask).toBe('Incline Village to Kings Beach, by way of Truckee.')
    expect(asks[2]?.ask).toBe('Starting from Stateline.')
    expect(asks[3]?.ask).toBe('Take me to Carson City.')
    // ⚠ THE ASSERTION THIS FILE EXISTS FOR, now that five rows share one pool. The complaint that
    // started this area was ONE town saying itself in every slot; indexing each shape from clean[0]
    // would rebuild it exactly. The cursor is what prevents it, so the property is pinned directly
    // rather than inferred from the strings above.
    const said = asks.flatMap((e) => EIGHT.filter((n) => e.ask.includes(n)))
    expect(said).toEqual([...new Set(said)])
    // ⚠ Titles stay paired with their own shape. The list is built by separate pushes under different
    // conditions, so a mis-paired title is a one-character edit away.
    expect(asks.map((e) => e.title)).toEqual([
      'Drive somewhere',
      'Pass through somewhere',
      "Say where I'm starting",
      "Say where I'm going",
      'Let the skipper pick',
    ])
  })

  // ⚠ THE POINT OF `shape`, pinned: the list degrades, so POSITION does not identify a shape. A screen
  // pairing icons by array index looks right on a two-name region and mis-pairs on a one-name one —
  // i.e. it breaks only where nobody is looking. These two assertions are what make that unnecessary.
  test('shape survives degradation, so position never has to be trusted', () => {
    // ⚠ SKIPPED, NOT TERMINAL — a shape it cannot afford is passed over and the CHEAPER ones still
    // render. Three names cannot buy the three-name pass-through after A→B has taken two, but there is
    // still one left for a single-ended row. Getting this wrong the other way (stop at the first
    // unaffordable shape) would silently strip thin regions back to the open ask alone.
    expect(buildExampleAsks(['Tahoe City', 'Emerald Bay', 'Incline Village'], T).map((e) => e.shape)).toEqual([
      'aToB',
      'fromStart',
      'open',
    ])
    expect(buildExampleAsks(['Tahoe City', 'Emerald Bay'], T).map((e) => e.shape)).toEqual(['aToB', 'open'])
    expect(buildExampleAsks(['Tahoe City'], T).map((e) => e.shape)).toEqual(['fromStart', 'open'])
    expect(buildExampleAsks([], T).map((e) => e.shape)).toEqual(['open'])
  })

  test('one name still buys a chip — the single-ended shapes cost one each', () => {
    const asks = buildExampleAsks(['Tahoe City'], T)
    expect(asks.map((a) => a.ask)).toEqual(['Starting from Tahoe City.', 'Surprise me — somewhere pretty.'])
  })

  test('a region name makes the open-ended ask region-specific too', () => {
    const asks = buildExampleAsks(['Tahoe City'], T, 'Lake Tahoe')
    expect(asks.at(-1)?.ask).toBe('Surprise me — somewhere pretty around Lake Tahoe.')
    // ⚠ And WITHOUT one it must still produce an ask — this is the shape that has to survive a region
    // with no curated anchors, so it can never be allowed to depend on a name of any kind.
    expect(buildExampleAsks([], T).at(-1)?.ask).toBe('Surprise me — somewhere pretty.')
    // A blank/whitespace region name is the same as none, not an empty gap on screen.
    expect(buildExampleAsks([], T, '   ').at(-1)?.ask).toBe('Surprise me — somewhere pretty.')
  })

  test('no names → only the ask that needs no facts', () => {
    // Whole-object, not just `.ask`: this is the one case where every field has to be right at once,
    // because a region that never loaded is the state a rider is most likely to meet first.
    expect(buildExampleAsks([], T)).toEqual([
      { shape: 'open', title: T.openTitle, ask: T.open, reply: T.openReply },
    ])
  })
})

describe('the names themselves', () => {
  test('cleanPlaceName runs before interpolation', () => {
    const asks = buildExampleAsks(['Tahoe Keys, California', 'Rubicon, California'], T)
    expect(asks[0]?.ask).toBe('Tahoe Keys to Rubicon, the scenic way.')
  })

  test('blank and duplicate names are dropped, so no chip reads back an empty gap', () => {
    // Two names that clean to the SAME place would produce "X to X" — one chip's worth of nonsense.
    // Three raw entries collapse to ONE real name here, which is below A→B's floor, so what survives is
    // the single-ended row and the open ask. That is the point: the dedupe happens before the count is
    // taken, never after — counted first, this would read as three names and render "Tahoe City to
    // Tahoe City".
    const asks = buildExampleAsks(['  ', 'Tahoe City', 'Tahoe City, California'], T)
    expect(asks.map((a) => a.ask)).toEqual(['Starting from Tahoe City.', 'Surprise me — somewhere pretty.'])
  })

  // ⚠ THE OPPOSITE ASSERTION TO THE ONE THAT USED TO BE HERE. This test read "the reply is
  // interpolated too — it ships into the transcript, not just onto a chip". There is no reply now: a
  // chip carries the RIDER's line only, because authored skipper prose here drifted from the planner
  // prompt and kept asking a banned question with no model turn for any check to catch (2026-08-04).
  // A `reply` reappearing on this type is the regression, so the type itself is what is pinned.
  test('a chip carries no skipper prose — only the rider line', () => {
    const asks = buildExampleAsks(['Tahoe City', 'Emerald Bay'], T)
    expect(asks[0]?.ask).toBe('Tahoe City to Emerald Bay, the scenic way.')
    for (const e of asks) expect(Object.keys(e)).not.toContain('reply')
  })
})

describe('no placeholder ever reaches a rider', () => {
  test('nothing emitted contains a literal {a} or {b}', () => {
    for (const names of [[], ['Tahoe City'], ['Tahoe City', 'Emerald Bay']]) {
      for (const e of buildExampleAsks(names, T)) {
        expect(e.ask).not.toMatch(/\{[ab]\}/)
      }
    }
  })

  test('a template that grows a token degrades to one fewer chip, never to braces on screen', () => {
    // voice.ts changes under a different review than this file — this is that seam's guard. ⚠ The
    // grown token is `{c}`, one this file has NEVER filled, because that is the real case: the guard
    // has to catch a token nobody here has heard of, not just a known one in a new slot.
    const grown = { ...T, aToB: '{a} to {b} by way of {c}.' }
    const asks = buildExampleAsks(['Tahoe City', 'Emerald Bay'], grown)
    expect(asks.map((a) => a.ask)).toEqual(['Surprise me — somewhere pretty.'])
  })
})

describe('rotateNames — the client’s entire share of the selection', () => {
  const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']

  test('rotation 0 is the server order, untouched', () => {
    expect(rotateNames(names, 0)).toEqual(names)
  })

  test('it rotates left and wraps', () => {
    expect(rotateNames(names, 3)).toEqual(['d', 'e', 'f', 'g', 'h', 'a', 'b', 'c'])
    expect(rotateNames(names, 8)).toEqual(names)
    expect(rotateNames(names, 11)).toEqual(rotateNames(names, 3))
  })

  test('consecutive cold opens share NO name at the stride the screen uses', () => {
    // ⚠ THE WHOLE REASON THE STRIDE IS 3 RATHER THAN 1. Advancing one slot would leave a name on
    // screen in a different role, which reads as a glitch rather than as variety.
    // ⚠ THE WINDOW IS 2 AND THE STRIDE IS 3, and they are no longer the same number — a cold open
    // spends the A→B start and end, and the loop row that spent a third name is gone
    // (no-same-road-loops.md §8). The stride did NOT follow the window down to 2, deliberately: see
    // the next test, which is the reason.
    const WINDOW = 2
    const windowAt = (launch: number) =>
      rotateNames(names, launch * EXAMPLE_ROTATION_STRIDE).slice(0, WINDOW)
    expect(windowAt(0)).toEqual(['a', 'b'])
    expect(windowAt(1)).toEqual(['d', 'e'])
    expect(windowAt(2)).toEqual(['g', 'h'])
    expect(windowAt(3)).toEqual(['b', 'c'])
    for (const launch of [0, 1, 2, 3, 4]) {
      const here = new Set(windowAt(launch))
      expect(windowAt(launch + 1).some((n) => here.has(n))).toBe(false)
    }
  })

  test('no name is stuck in the shop window — every one visits slot 0', () => {
    // The literal complaint, as a test: `Carson City` led every launch because slot 0 never moved.
    // ⚠ THIS IS WHY THE STRIDE MUST STAY COPRIME WITH THE NAME COUNT, and why it did not drop to 2
    // when the window did. At a stride of 2 over 8 names only the even slots ever lead, `leads.size`
    // is 4, and half the region's names never open a cold open — the original complaint, re-created
    // by arithmetic. Changing EXAMPLE_ROTATION_STRIDE to "match" the window fails right here.
    const leads = new Set(
      Array.from({ length: names.length }, (_, i) =>
        rotateNames(names, i * EXAMPLE_ROTATION_STRIDE)[0],
      ),
    )
    expect(leads.size).toBe(names.length)
  })

  test('a corrupt counter off disk degrades to the first window, never to NaN', () => {
    // region-cache.ts already sanitises, so this is the second wall. A NaN index would blank every
    // chip on the cold open — the one screen with nothing else on it.
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, -0.5]) {
      expect(rotateNames(names, bad)).toEqual(names)
    }
  })

  test('an empty or single-name region is not an error', () => {
    expect(rotateNames([], 5)).toEqual([])
    expect(rotateNames(['only'], 5)).toEqual(['only'])
  })
})
