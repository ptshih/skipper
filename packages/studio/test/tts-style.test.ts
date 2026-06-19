import { describe, expect, test } from 'bun:test'
import { deliveryRegister } from '@skipper/shared'
import { SKIPPER_TTS_STYLE_PROMPT, ttsStyleFor } from '../src/models'

describe('ttsStyleFor — delivery register → style suffix on the shared base', () => {
  test('story returns the base read byte-identical (the ear-tuned default is preserved)', () => {
    expect(ttsStyleFor(SKIPPER_TTS_STYLE_PROMPT, 'story')).toBe(SKIPPER_TTS_STYLE_PROMPT)
  })

  test('every register keeps the FULL base (so the persona + the anti-fade rule survive)', () => {
    for (const r of deliveryRegister.options) {
      const style = ttsStyleFor(SKIPPER_TTS_STYLE_PROMPT, r)
      // The base is always the prefix — the register only ever APPENDS, never rewrites.
      expect(style.startsWith(SKIPPER_TTS_STYLE_PROMPT)).toBe(true)
      // anti-fade is in the base, so it survives in every register.
      expect(style).toContain('never trail off')
    }
  })

  test('each non-story register actually modulates the read (a distinct, non-empty suffix)', () => {
    const seen = new Set<string>()
    for (const r of deliveryRegister.options) {
      const suffix = ttsStyleFor(SKIPPER_TTS_STYLE_PROMPT, r).slice(SKIPPER_TTS_STYLE_PROMPT.length)
      if (r === 'story') {
        expect(suffix).toBe('')
        continue
      }
      expect(suffix.length).toBeGreaterThan(0)
      expect(seen.has(suffix)).toBe(false) // landscape/town/civic each read differently
      seen.add(suffix)
    }
    expect(seen.size).toBe(3)
  })
})
