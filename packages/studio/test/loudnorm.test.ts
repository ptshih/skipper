import { describe, expect, test } from 'bun:test'
import { judgeMasteredLoudness, masteringChain, parseEbur128Summary } from '../src/pipeline/loudnorm'

// The PROD-natural voice-master is the researched spoken-word order: corrective EQ → light denoise →
// gate → gentle compression → single-pass loudnorm. These guard the shape that matters — the stages in
// order, loudnorm LAST, the OLD heavy alimiter gone, and no two-pass measured_* handoff (the stateful-
// filter-before-two-pass bug that shipped a clipping clip, 2026-06-19→20, then was reverted).
describe('masteringChain — EQ → denoise → gate → compress → single-pass loudnorm', () => {
  test('the stages appear in the researched order, loudnorm last', () => {
    const c = masteringChain()
    const order = ['highpass', 'equalizer', 'afftdn', 'agate', 'acompressor', 'loudnorm']
    const idx = order.map((f) => c.indexOf(f))
    expect(idx.every((i) => i >= 0)).toBe(true) // every stage present
    expect(idx).toEqual([...idx].sort((a, b) => a - b)) // strictly increasing = in order
  })

  test('the old single heavy alimiter is gone (replaced by gentle compression)', () => {
    expect(masteringChain()).not.toContain('alimiter')
  })

  test('de-bass = sub-bass high-pass + a 300 Hz mud cut; the noise gate cleans the lead-in', () => {
    const c = masteringChain()
    expect(c).toContain('highpass=f=90')
    expect(c).toMatch(/equalizer=f=300:[^,]*g=-3/) // a CUT (negative gain), not a boost
    expect(c).toContain('agate')
  })

  test('loudnorm asks for −14 with a −2 dBTP PRE-ENCODE ceiling (64k-AAC overshoot headroom)', () => {
    const c = masteringChain()
    expect(c).toContain('I=-14')
    expect(c).toContain('TP=-2') // decoded lands ~−1.3 dBTP after AAC overshoot, under the −1 ceiling
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

describe('judgeMasteredLoudness — verdict vs the −14.8 landing (±1.2) + the −1 dBTP ceiling', () => {
  test('a healthy clip at the ~−14.9 landing (peak ~−1.3) passes both checks', () => {
    const v = judgeMasteredLoudness({ integratedLufs: -14.9, truePeakDb: -1.3 })
    expect(v.loudnessOk).toBe(true)
    expect(v.truePeakOk).toBe(true)
  })

  test('flags an integrated undershoot past the −16.0 floor (a clip that failed to normalize)', () => {
    expect(judgeMasteredLoudness({ integratedLufs: -16.1, truePeakDb: -1.7 }).loudnessOk).toBe(false)
  })

  test('flags too-loud past the −13.6 ceiling as well', () => {
    expect(judgeMasteredLoudness({ integratedLufs: -13.5, truePeakDb: -1.7 }).loudnessOk).toBe(false)
  })

  test('passes clips comfortably inside the ±1.2 band around the −14.8 landing', () => {
    expect(judgeMasteredLoudness({ integratedLufs: -15.9, truePeakDb: -1.7 }).loudnessOk).toBe(true)
    expect(judgeMasteredLoudness({ integratedLufs: -13.7, truePeakDb: -1.7 }).loudnessOk).toBe(true)
  })

  test('flags a true peak above the −1.0 dBTP delivery ceiling (AAC overshoot / clipping)', () => {
    expect(judgeMasteredLoudness({ integratedLufs: -14.2, truePeakDb: -0.8 }).truePeakOk).toBe(false)
    expect(judgeMasteredLoudness({ integratedLufs: -14.2, truePeakDb: 1.4 }).truePeakOk).toBe(false)
  })

  test('the −1.0 ceiling is inclusive (a clip exactly at −1.0 dBTP is in spec)', () => {
    expect(judgeMasteredLoudness({ integratedLufs: -14.2, truePeakDb: -1.0 }).truePeakOk).toBe(true)
  })
})
