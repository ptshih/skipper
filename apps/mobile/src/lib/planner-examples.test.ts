// buildExampleAsks AS TESTS — the chip set degrades by how many curated names the region has, and no
// rider ever sees a `{a}` or a gap where a place name belongs. Runs under `bun test`.
import { describe, expect, test } from 'bun:test'
import { buildExampleAsks, type ExampleAskTemplates } from './planner-examples'

// Shaped like voice.plan's real templates (the prose lives there; these only need the placeholders).
const T: ExampleAskTemplates = {
  aToBTitle: 'Drive somewhere',
  aToB: '{a} to {b}, the scenic way.',
  aToBReply: '{a} out to {b}. How long do you want to be out?',
  loopTitle: 'Take a loop',
  loop: 'A loop out of {a}, couple of hours.',
  loopReply: 'Out of {a} and back around. Where do you want to turn around?',
  openTitle: 'Let the skipper pick',
  open: 'Somewhere pretty. You pick.',
  openReply: 'Happy to pick. Where are you starting from?',
}

describe('shape degradation', () => {
  test('two or more names → all three shapes', () => {
    const asks = buildExampleAsks(['Tahoe City', 'Emerald Bay', 'Incline Village'], T)
    expect(asks).toHaveLength(3)
    expect(asks[0]?.ask).toBe('Tahoe City to Emerald Bay, the scenic way.')
    expect(asks[1]?.ask).toBe('A loop out of Tahoe City, couple of hours.')
    expect(asks[2]?.ask).toBe('Somewhere pretty. You pick.')
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
      'Somewhere pretty. You pick.',
    ])
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
      'Somewhere pretty. You pick.',
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
    expect(asks.map((a) => a.ask)).toEqual(['Somewhere pretty. You pick.'])
  })
})
