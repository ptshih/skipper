import { describe, expect, test } from 'bun:test'
import {
  keepFirstTake,
  MIN_MEASURABLE_SEC,
  measureTailCollapse,
  parseMeanVolumeDb,
  TAIL_COLLAPSE_DB,
  TAIL_WINDOW_SEC,
} from '../src/pipeline/tail'
import type { TailMeasure } from '../src/pipeline/tail'

const m = (dropDb: number): TailMeasure => ({ bodyDb: -20, tailDb: -20 - dropDb, dropDb })

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

describe('constants — the measured 2026-06-10 thresholds', () => {
  test('the collapse line is 3 dB over a 12 s tail; measurable from 2× the window', () => {
    expect(TAIL_COLLAPSE_DB).toBe(3)
    expect(TAIL_WINDOW_SEC).toBe(12)
    expect(MIN_MEASURABLE_SEC).toBe(24)
  })
})
