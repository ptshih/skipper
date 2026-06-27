import { describe, expect, test } from 'bun:test'
import {
  expectedDurationMs,
  isOverlongTake,
  keepFirstTake,
  MIN_MEASURABLE_SEC,
  measureTailCollapse,
  parseMeanVolumeDb,
  retakeStalled,
  tailDropDb,
} from '../src/pipeline/tail'
import type { TailMeasure } from '../src/pipeline/tail'

const m = (dropDb: number): TailMeasure => ({ bodyDb: -20, tailDb: -20 - dropDb, terminalDb: -20 - dropDb, dropDb })
/** An N-word script (the overlong guard only cares about word COUNT). */
const script = (n: number): string => Array.from({ length: n }, () => 'word').join(' ')

describe('parseMeanVolumeDb — ffmpeg volumedetect stderr', () => {
  test('parses the mean_volume line (negative, fractional)', () => {
    const stderr =
      '[Parsed_volumedetect_0 @ 0x600] n_samples: 2880000\n' +
      '[Parsed_volumedetect_0 @ 0x600] mean_volume: -23.4 dB\n' +
      '[Parsed_volumedetect_0 @ 0x600] max_volume: -4.1 dB\n'
    expect(parseMeanVolumeDb(stderr)).toBe(-23.4)
  })

  test('parses an integer value and a positive value', () => {
    expect(parseMeanVolumeDb('mean_volume: -26 dB')).toBe(-26)
    expect(parseMeanVolumeDb('mean_volume: 0.0 dB')).toBe(0)
  })

  test('null when the line is absent (a failed/odd ffmpeg run)', () => {
    expect(parseMeanVolumeDb('ffmpeg: error opening input')).toBeNull()
    expect(parseMeanVolumeDb('')).toBeNull()
  })
})

describe('tailDropDb — collapse severity = body minus the QUIETER tail window', () => {
  test('takes the worse of the 12 s tail and the 4 s terminal window', () => {
    // tail (12 s) holds level but the final 4 s dies → the terminal window drives the drop
    expect(tailDropDb(-20, -21, -27)).toBe(7) // max(1, 7)
    // the whole tail is quiet but the very end recovers → the 12 s window drives it
    expect(tailDropDb(-20, -28, -22)).toBe(8) // max(8, 2)
  })

  test('a clip that holds full level to the last word has ~no drop (passes the gate)', () => {
    expect(tailDropDb(-20, -20.2, -20.1)).toBeCloseTo(0.2, 5)
  })

  test('a louder-than-body tail yields a negative (non-collapse) drop', () => {
    expect(tailDropDb(-20, -19, -18)).toBe(-1) // max(-1, -2)
  })
})

describe('keepFirstTake — which take ships after a retake', () => {
  test('the smaller measured drop wins', () => {
    expect(keepFirstTake(m(5), m(1))).toBe(false) // retake cleaner → ship retake
    expect(keepFirstTake(m(4), m(7))).toBe(true) // retake WORSE → keep the first
  })

  test('a tie keeps the first take (no reason to churn bytes)', () => {
    expect(keepFirstTake(m(4), m(4))).toBe(true)
  })

  test('an unmeasurable retake ships anyway — the first take is KNOWN collapsed', () => {
    expect(keepFirstTake(m(6), null)).toBe(false)
  })
})

describe('retakeStalled — stop the retake loop when the collapse is STRUCTURAL', () => {
  test('a fresh take that re-collapsed at the same level is structural → stop', () => {
    expect(retakeStalled(3.5, 3.4)).toBe(true) // the documented West-Shore deadpan coda
    expect(retakeStalled(4.0, 3.9)).toBe(true)
  })

  test('a retake that materially improved the best drop keeps going (worth another take)', () => {
    expect(retakeStalled(8.0, 3.4)).toBe(false) // 8 → 3.4 is real movement, not a re-collapse
  })

  test('a retake that came back clean (below the gate) is not structural', () => {
    expect(retakeStalled(3.5, 2.0)).toBe(false) // exits via the loop's own gate, not this
  })

  test('a high-variance WORSE take is not "the same level" → allow another retry', () => {
    expect(retakeStalled(3.4, 9.0)).toBe(false)
  })

  test('the epsilon band is inclusive at exactly 1.0 dB', () => {
    expect(retakeStalled(4.0, 3.0)).toBe(true) // |3.0 − 4.0| = 1.0
    expect(retakeStalled(4.05, 3.0)).toBe(false) // 1.05 > 1.0
  })
})

describe('expectedDurationMs / isOverlongTake — the overlong (ramble) guard', () => {
  // 250 words at WORDS_PER_SEC=2.5 → 100 s expected; OVERLONG_RATIO=1.5 → the gate is 150 s.
  const s = script(250)

  test('expectedDurationMs estimates from word count', () => {
    expect(expectedDurationMs(s)).toBe(100_000) // 250 / 2.5 * 1000
    expect(expectedDurationMs('  one   two three ')).toBe(1200) // 3 / 2.5 * 1000, whitespace-tolerant
  })

  test('flags a ~2× ramble (the 196s/126s ships) and passes the corpus legit max (~1.3×)', () => {
    expect(isOverlongTake(211_000, s)).toBe(true) // 2.11× — the Mount Tallac / Museum-of-Art ramble
    expect(isOverlongTake(132_000, s)).toBe(false) // 1.32× — the legit corpus max (Nevada SR 431)
    expect(isOverlongTake(95_000, s)).toBe(false) // 0.95× — the corpus median
  })

  test('the 1.5× gate is strict (exactly 1.5× is NOT overlong; just past it is)', () => {
    expect(isOverlongTake(150_000, s)).toBe(false) // exactly 1.5× → not >
    expect(isOverlongTake(150_001, s)).toBe(true)
  })

  test('an empty/wordless script has no expectation → never overlong (unmeasurable)', () => {
    expect(isOverlongTake(999_000, '')).toBe(false)
    expect(isOverlongTake(999_000, '   ')).toBe(false)
  })
})

describe('measureTailCollapse — probe gating', () => {
  test('skips a clip too short to have a meaningful body', async () => {
    const audio = new Uint8Array(64)
    const result = await measureTailCollapse(audio, (MIN_MEASURABLE_SEC - 1) * 1000)
    expect(result).toBeNull()
  })
})

