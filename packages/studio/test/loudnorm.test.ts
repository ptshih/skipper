import { describe, expect, test } from 'bun:test'
import { judgeMasteredLoudness, masteringChain, parseEbur128Summary } from '../src/pipeline/loudnorm'

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

// The post-encode QA meter re-reads the SHIPPED .m4a via ffmpeg `ebur128=peak=true` and judges it. These
// guard the stderr parse (against the REAL ffmpeg 8.x Summary format) + the verdict thresholds — the loop
// the master never closed (−14/−1 was asserted by construction, never verified per clip).
describe('parseEbur128Summary — the real ffmpeg ebur128 Summary block', () => {
  // A trailing per-frame log line (its `I:` and `TPK:` must NOT be mistaken for the Summary values),
  // then the actual Summary block as ffmpeg 8.1.1 prints it.
  const stderr =
    '[Parsed_ebur128_0 @ 0x1] t: 88.4   TARGET:-23 LUFS    M: -13.0 S: -13.5     I: -13.0 LUFS       LRA: 2.0 LU  FTPK: -1.9 dBFS  TPK: -1.5 dBFS\n' +
    '[Parsed_ebur128_0 @ 0x1] Summary:\n\n' +
    '  Integrated loudness:\n    I:         -14.2 LUFS\n    Threshold: -24.5 LUFS\n\n' +
    '  Loudness range:\n    LRA:         3.1 LU\n    Threshold: -34.6 LUFS\n    LRA low:   -15.9 LUFS\n    LRA high:  -12.8 LUFS\n\n' +
    '  True peak:\n    Peak:      -1.7 dBFS\n'

  test('reads Integrated I + True peak Peak from the Summary, not the per-frame line', () => {
    expect(parseEbur128Summary(stderr)).toEqual({ integratedLufs: -14.2, truePeakDb: -1.7 })
  })

  test('reads a positive (clipping) true peak — the +1.4 dBTP overshoot defect', () => {
    const clip = stderr.replace('Peak:      -1.7 dBFS', 'Peak:       1.4 dBFS')
    expect(parseEbur128Summary(clip)?.truePeakDb).toBe(1.4)
  })

  test('null when no Summary block (a failed/odd ffmpeg run)', () => {
    expect(parseEbur128Summary('ffmpeg: error opening input')).toBeNull()
    expect(parseEbur128Summary('')).toBeNull()
  })

  test('null on a non-finite field (e.g. -inf on digital silence)', () => {
    const silent = stderr.replace('I:         -14.2 LUFS', 'I:         -inf LUFS')
    expect(parseEbur128Summary(silent)).toBeNull()
  })
})

describe('judgeMasteredLoudness — verdict vs the active −14 target + the −1 dBTP ceiling', () => {
  test('a healthy −14 clip (lands ~−14.1…−14.5, peak ~−1.7) passes both checks', () => {
    const v = judgeMasteredLoudness({ integratedLufs: -14.3, truePeakDb: -1.7 })
    expect(v.loudnessOk).toBe(true)
    expect(v.truePeakOk).toBe(true)
  })

  test('flags an integrated undershoot past ±1 LU (the −14.7…−15.5 spread)', () => {
    expect(judgeMasteredLoudness({ integratedLufs: -15.6, truePeakDb: -1.7 }).loudnessOk).toBe(false)
  })

  test('flags too-loud past ±1 LU as well', () => {
    expect(judgeMasteredLoudness({ integratedLufs: -12.9, truePeakDb: -1.7 }).loudnessOk).toBe(false)
  })

  test('tolerance is inclusive at exactly ±1 LU', () => {
    expect(judgeMasteredLoudness({ integratedLufs: -15.0, truePeakDb: -1.7 }).loudnessOk).toBe(true)
    expect(judgeMasteredLoudness({ integratedLufs: -13.0, truePeakDb: -1.7 }).loudnessOk).toBe(true)
  })

  test('flags a true peak above the −1.0 dBTP delivery ceiling (AAC overshoot / clipping)', () => {
    expect(judgeMasteredLoudness({ integratedLufs: -14.2, truePeakDb: -0.8 }).truePeakOk).toBe(false)
    expect(judgeMasteredLoudness({ integratedLufs: -14.2, truePeakDb: 1.4 }).truePeakOk).toBe(false)
  })

  test('the −1.0 ceiling is inclusive (a clip exactly at −1.0 dBTP is in spec)', () => {
    expect(judgeMasteredLoudness({ integratedLufs: -14.2, truePeakDb: -1.0 }).truePeakOk).toBe(true)
  })
})
