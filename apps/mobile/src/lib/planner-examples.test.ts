// buildExampleAsks AS TESTS — the chip set degrades by how many curated names the region has, and no
// rider ever sees a `{a}` or a gap where a place name belongs. Runs under `bun test`.
import { describe, expect, test } from 'bun:test'
import {
  buildExampleAsks,
  EXAMPLE_NAMES_PER_COLD_OPEN,
  rotateNames,
  type ExampleAskTemplates,
} from './planner-examples'

// Shaped like voice.plan's real templates (the prose lives there; these only need the placeholders).
const T: ExampleAskTemplates = {
  aToBTitle: 'Drive somewhere',
  aToB: '{a} to {b}, the scenic way.',
  aToBReply: '{a} out to {b}. How long do you want to be out?',
  loopTitle: 'Take a loop',
  loop: 'A loop out of {a}, couple of hours.',
  loopReply: 'Out of {a} and back around. Where do you want to turn around?',
  openTitle: 'Let the skipper pick',
  open: 'Surprise me — somewhere pretty.',
  openRegion: 'Surprise me — somewhere pretty around {r}.',
  openReply: 'Happy to pick. Where are you starting from?',
}

describe('shape degradation', () => {
  test('two or more names → all three shapes', () => {
    const asks = buildExampleAsks(['Tahoe City', 'Emerald Bay', 'Incline Village'], T)
    expect(asks).toHaveLength(3)
    expect(asks[0]?.ask).toBe('Tahoe City to Emerald Bay, the scenic way.')
    // ⚠ THE THIRD NAME, not the first. Three rows naming three places is the fix for the cold open
    // reading as one town shouting — with the loop reusing `{a}`, a launch whose slot 0 was
    // `Carson City` said it in the A→B ask, its reply, the loop ask, ITS reply and the placeholder.
    expect(asks[1]?.ask).toBe('A loop out of Incline Village, couple of hours.')
    expect(asks[2]?.ask).toBe('Surprise me — somewhere pretty.')
    // ⚠ Titles ride through UNFILLED and stay paired with their own shape. The pairing is the thing
    // worth pinning: the list is built by three separate pushes under three different conditions, so
    // a mis-paired title is a one-character edit away and would label the loop "Drive somewhere".
    expect(asks.map((e) => e.title)).toEqual(['Drive somewhere', 'Take a loop', 'Let the skipper pick'])
  })

  // ⚠ THE POINT OF `shape`, pinned: the list degrades, so POSITION does not identify a shape. A screen
  // pairing icons by array index looks right on a two-name region and mis-pairs on a one-name one —
  // i.e. it breaks only where nobody is looking. These two assertions are what make that unnecessary.
  test('shape survives degradation, so position never has to be trusted', () => {
    expect(buildExampleAsks(['Tahoe City'], T).map((e) => e.shape)).toEqual(['loop', 'open'])
    expect(buildExampleAsks([], T).map((e) => e.shape)).toEqual(['open'])
  })

  test('one name → the loop and the open ask', () => {
    const asks = buildExampleAsks(['Tahoe City'], T)
    expect(asks.map((a) => a.ask)).toEqual([
      'A loop out of Tahoe City, couple of hours.',
      'Surprise me — somewhere pretty.',
    ])
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
    expect(asks[0]?.reply).toContain('Tahoe Keys out to Rubicon.')
  })

  test('blank and duplicate names are dropped, so no chip reads back an empty gap', () => {
    // Two names that clean to the SAME place would produce "X to X" — one chip's worth of nonsense.
    const asks = buildExampleAsks(['  ', 'Tahoe City', 'Tahoe City, California'], T)
    expect(asks.map((a) => a.ask)).toEqual([
      'A loop out of Tahoe City, couple of hours.',
      'Surprise me — somewhere pretty.',
    ])
  })

  test('the reply is interpolated too — it ships into the transcript, not just onto a chip', () => {
    const asks = buildExampleAsks(['Tahoe City'], T)
    expect(asks[0]?.reply).toBe('Out of Tahoe City and back around. Where do you want to turn around?')
  })
})

describe('no placeholder ever reaches a rider', () => {
  test('nothing emitted contains a literal {a} or {b}', () => {
    for (const names of [[], ['Tahoe City'], ['Tahoe City', 'Emerald Bay']]) {
      for (const e of buildExampleAsks(names, T)) {
        expect(e.ask).not.toMatch(/\{[ab]\}/)
        expect(e.reply).not.toMatch(/\{[ab]\}/)
      }
    }
  })

  test('a template that grows a {b} degrades to one fewer chip, never to braces on screen', () => {
    // voice.ts changes under a different review than this file — this is that seam's guard.
    const grown = { ...T, loop: 'A loop out of {a} by way of {b}.' }
    const asks = buildExampleAsks(['Tahoe City'], grown)
    expect(asks.map((a) => a.ask)).toEqual(['Surprise me — somewhere pretty.'])
  })
})

describe('the loop gets its own town', () => {
  test('with only two names it falls back to the first — a repeat beats a blank', () => {
    const asks = buildExampleAsks(['Tahoe City', 'Emerald Bay'], T)
    expect(asks[1]?.ask).toBe('A loop out of Tahoe City, couple of hours.')
  })

  test('three names name three places across the whole cold open', () => {
    // The regression this change exists to prevent, stated as a property rather than as three
    // separate string assertions: no name appears in more than one ROW.
    const asks = buildExampleAsks(['Truckee', 'Genoa', 'Virginia City'], T)
    expect(asks[0]?.ask).toContain('Truckee')
    expect(asks[0]?.ask).toContain('Genoa')
    expect(asks[1]?.ask).toContain('Virginia City')
    expect(asks[1]?.ask).not.toContain('Truckee')
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
    // ⚠ THE WHOLE REASON THE STRIDE IS 3 RATHER THAN 1. Advancing one slot would leave two of the
    // three names on screen, in different roles, which reads as a glitch rather than as variety.
    // With eight names (coprime with 3) each launch gets a disjoint window.
    const windowAt = (launch: number) =>
      rotateNames(names, launch * EXAMPLE_NAMES_PER_COLD_OPEN).slice(0, EXAMPLE_NAMES_PER_COLD_OPEN)
    expect(windowAt(0)).toEqual(['a', 'b', 'c'])
    expect(windowAt(1)).toEqual(['d', 'e', 'f'])
    expect(windowAt(2)).toEqual(['g', 'h', 'a'])
    for (const launch of [0, 1, 3, 4]) {
      const here = new Set(windowAt(launch))
      expect(windowAt(launch + 1).some((n) => here.has(n))).toBe(false)
    }
  })

  test('no name is stuck in the shop window — every one visits slot 0', () => {
    // The literal complaint, as a test: `Carson City` led every launch because slot 0 never moved.
    const leads = new Set(
      Array.from({ length: names.length }, (_, i) =>
        rotateNames(names, i * EXAMPLE_NAMES_PER_COLD_OPEN)[0],
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
