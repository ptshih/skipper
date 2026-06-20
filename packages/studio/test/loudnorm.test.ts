import { describe, expect, test } from 'bun:test'
import { masteringChain } from '../src/pipeline/loudnorm'

// The mastering chain is a true-peak LIMITER (which makes the headroom) followed by a SINGLE-PASS
// dynamic loudnorm (which hits −14). These guard the shape that matters — the limiter must come
// FIRST, and there must be no two-pass measured_* handoff (the stateful-filter-before-two-pass bug
// that shipped a clipping clip, 2026-06-19→20, then was reverted).
describe('masteringChain — limiter → single-pass loudnorm to the spec', () => {
  test('the true-peak limiter precedes loudnorm (headroom must be made before the gain)', () => {
    const c = masteringChain()
    expect(c).toContain('alimiter')
    expect(c).toContain('loudnorm')
    expect(c.indexOf('alimiter')).toBeLessThan(c.indexOf('loudnorm'))
  })

  test('the limiter pushes gain into a brick-wall ceiling (that is what makes it louder)', () => {
    const c = masteringChain()
    expect(c).toMatch(/alimiter=level_in=\d/) // input gain into the limiter
    expect(c).toMatch(/limit=0?\.\d/) // a true-peak ceiling below 0 dBFS
  })

  test('the ACTIVE master targets −14 with a −2 dBTP PRE-ENCODE ceiling (the parked −13 preset is off)', () => {
    const c = masteringChain()
    expect(c).toContain('I=-14')
    expect(c).toContain('TP=-2')
  })

  test('SINGLE-PASS — no two-pass measured_* / linear handoff (the clip bug it replaced)', () => {
    const c = masteringChain()
    expect(c).not.toContain('measured_I')
    expect(c).not.toContain('linear=true')
    expect(c).not.toContain('print_format')
  })
})
