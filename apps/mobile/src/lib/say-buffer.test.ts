import { describe, expect, test } from 'bun:test'
import { emptySayBuffer, pushDelta, SAY_MAX_HOLD_MS, settle, tickHold } from './say-buffer'

describe('pushDelta — sentence-granularity flush', () => {
  test('flushes on each sentence terminator', () => {
    for (const end of ['.', '!', '?', '…']) {
      const b = pushDelta(emptySayBuffer(), `Hop in${end} Next`, 0)
      expect(b.shown).toBe(`Hop in${end}`)
      expect(b.pending).toBe(' Next')
    }
  })

  test('a closing quote or bracket belongs to the sentence it ends', () => {
    const q = pushDelta(emptySayBuffer(), 'He said "go." Then', 0)
    expect(q.shown).toBe('He said "go."')
    expect(q.pending).toBe(' Then')

    const p = pushDelta(emptySayBuffer(), '(so they say.) Then', 0)
    expect(p.shown).toBe('(so they say.)')
    expect(p.pending).toBe(' Then')
  })

  // The lookahead is what keeps a decimal from reading as the end of a sentence.
  test('does NOT flush on a period with no following whitespace', () => {
    const b = pushDelta(emptySayBuffer(), 'about 3.5 miles', 0)
    expect(b.shown).toBe('')
    expect(b.pending).toBe('about 3.5 miles')
    expect(b.heldSince).toBe(0)
  })

  test('flushes at the LAST boundary when a delta carries two sentences', () => {
    const b = pushDelta(emptySayBuffer(), 'One. Two. Thr', 0)
    expect(b.shown).toBe('One. Two.')
    expect(b.pending).toBe(' Thr')
  })

  test('accumulates across deltas until a boundary lands', () => {
    let b = pushDelta(emptySayBuffer(), 'Hop', 0)
    b = pushDelta(b, ' in', 10)
    expect(b.shown).toBe('')
    b = pushDelta(b, '. Ready', 20)
    expect(b.shown).toBe('Hop in.')
    expect(b.pending).toBe(' Ready')
  })
})

describe('tickHold — the max-hold escape hatch', () => {
  test('does nothing before the hold elapses', () => {
    const b = pushDelta(emptySayBuffer(), 'a long clause with no end', 0)
    expect(tickHold(b, SAY_MAX_HOLD_MS - 1)).toBe(b)
  })

  // ⚠ THE test that pays for itself. A raw flush cuts "the Emer" and reads as a rendering bug
  // rather than as speech; only whole words may reach the screen.
  test('flushes at the last WHITESPACE, never mid-word', () => {
    const b = pushDelta(emptySayBuffer(), 'past the Emer', 0)
    const t = tickHold(b, SAY_MAX_HOLD_MS)
    expect(t.shown).toBe('past the ')
    expect(t.pending).toBe('Emer')
    expect(t.heldSince).toBe(SAY_MAX_HOLD_MS)
  })

  test('an unbroken single word is held rather than cut in half', () => {
    const b = pushDelta(emptySayBuffer(), 'Vikingsholm', 0)
    const t = tickHold(b, SAY_MAX_HOLD_MS)
    expect(t.shown).toBe('')
    expect(t.pending).toBe('Vikingsholm')
    // Re-armed, so the next check is a whole hold away rather than every tick.
    expect(t.heldSince).toBe(SAY_MAX_HOLD_MS)
  })

  // If a delta reset the clock, a steady token stream with no terminator in sight would hold
  // forever and the bubble would sit frozen for the whole turn.
  test('a delta arriving mid-hold does not reset the hold clock', () => {
    let b = pushDelta(emptySayBuffer(), 'a long ', 0)
    b = pushDelta(b, 'clause still hol', 500)
    expect(b.heldSince).toBe(0)
    // Had the delta at t=500 re-armed the clock, t=600 would be only 100ms in and flush nothing.
    const t = tickHold(b, SAY_MAX_HOLD_MS)
    expect(t.shown).toBe('a long clause still ')
    expect(t.pending).toBe('hol')
  })
})

describe('settle — the terminal frame is authoritative', () => {
  // A refusal swaps the streamed text out wholesale on the server.
  test('a REPLACING terminal wins over everything streamed', () => {
    let b = pushDelta(emptySayBuffer(), "Sure, here's how to hotwire it. ", 0)
    b = settle(b, "That one's outside my beat.")
    expect(b.shown).toBe("That one's outside my beat.")
    expect(b.pending).toBe('')
    expect(b.settled).toBe(true)
  })

  // A truncation appends a retry line to the same text — assigning verbatim covers both cases
  // without the client ever having to know which happened.
  test('an APPENDING terminal is assigned, not concatenated twice', () => {
    let b = pushDelta(emptySayBuffer(), 'Heading west. ', 0)
    b = settle(b, 'Heading west. Ask me again?')
    expect(b.shown).toBe('Heading west. Ask me again?')
  })

  test('deltas that arrive after settle are ignored', () => {
    const b = settle(pushDelta(emptySayBuffer(), 'Hop in. ', 0), 'Hop in.')
    expect(pushDelta(b, ' stray', 100)).toBe(b)
    expect(tickHold(b, 10_000)).toBe(b)
  })
})
