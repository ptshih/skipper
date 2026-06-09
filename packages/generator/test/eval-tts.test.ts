import { describe, expect, test } from 'bun:test'
import { evaluateTts } from '../src/eval/tts'

const ev = (script: string) => evaluateTts({ seq: 0, script })

describe('evaluateTts — deterministic cleanliness gate', () => {
  test('clean spoken prose passes — em-dashes, ellipses, quotes, parens, apostrophes are fine', () => {
    const e = ev(
      'Coming up on the right — Emerald Bay, folks. It is, frankly, a beaut... and yes, ' +
        '"the jewel of the lake" (their words, not mine). Don\'t blink.',
    )
    expect(e.pass).toBe(true)
    expect(e.score).toBe(1)
    expect(e.dimension).toBe('tts')
    expect(e.findings).toHaveLength(0)
  })

  test('flags markdown emphasis / code', () => {
    expect(ev('it is **really** something').pass).toBe(false)
    expect(ev('a _quiet_ cove').pass).toBe(false)
    expect(ev('the `lighthouse`').pass).toBe(false)
  })

  test('flags a markdown link and a bare URL', () => {
    expect(ev('see [the bay](https://x.y)').findings.some((f) => f.includes('link'))).toBe(true)
    expect(ev('more at https://tahoe.example').findings.some((f) => f.includes('URL'))).toBe(true)
  })

  test('flags list markers at line start and headings', () => {
    expect(ev('Stops:\n- the bay\n- the castle').pass).toBe(false)
    expect(ev('## Emerald Bay\nhere we are').pass).toBe(false)
  })

  test('flags an SSML/HTML tag', () => {
    expect(ev('wait for it <break time="500ms"/> there').pass).toBe(false)
  })

  test('flags emoji (renders as tofu, TTS chokes)', () => {
    expect(ev('what a view 😍').pass).toBe(false)
  })

  test('a year like 1960 is NOT flagged (digits are intentionally not gated)', () => {
    const e = ev('back in 1960, the games came to Squaw Valley')
    expect(e.pass).toBe(true)
  })
})
