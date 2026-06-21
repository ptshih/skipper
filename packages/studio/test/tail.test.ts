import { describe, expect, test } from 'bun:test'
import {
  keepFirstTake,
  MIN_MEASURABLE_SEC,
  measureTailCollapse,
  parseMeanVolumeDb,
  tailDropDb,
} from '../src/pipeline/tail'
import type { TailMeasure } from '../src/pipeline/tail'

const m = (dropDb: number): TailMeasure => ({ bodyDb: -20, tailDb: -20 - dropDb, terminalDb: -20 - dropDb, dropDb })

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

describe('measureTailCollapse — probe gating', () => {
  test('skips a clip too short to have a meaningful body', async () => {
    const audio = new Uint8Array(64)
    const result = await measureTailCollapse(audio, (MIN_MEASURABLE_SEC - 1) * 1000)
    expect(result).toBeNull()
  })
})

