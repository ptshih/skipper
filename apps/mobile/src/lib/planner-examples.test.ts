// buildExampleAsks AS TESTS — the chip set degrades by how many curated names the region has, and no
// rider ever sees a `{a}` or a gap where a place name belongs. Runs under `bun test`.
import { describe, expect, test } from 'bun:test'
import { buildExampleAsks, type ExampleAskTemplates } from './planner-examples'

// Shaped like voice.plan's real templates (the prose lives there; these only need the placeholders).
const T: ExampleAskTemplates = {
  aToB: '{a} to {b}, the scenic way.',
  aToBReply: '{a} out to {b}. How long do you want to be out?',
  loop: 'A loop out of {a}, couple of hours.',
  loopReply: 'Out of {a} and back around. Where do you want to turn around?',
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
  })

  test('one name → the loop and the open ask', () => {
    const asks = buildExampleAsks(['Tahoe City'], T)
    expect(asks.map((a) => a.ask)).toEqual([
      'A loop out of Tahoe City, couple of hours.',
      'Somewhere pretty. You pick.',
    ])
  })

  test('no names → only the ask that needs no facts', () => {
    expect(buildExampleAsks([], T)).toEqual([
      { ask: T.open, reply: T.openReply },
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
