import { describe, expect, test } from 'bun:test'
import { parseLoudnormStats } from '../src/pipeline/loudnorm'

// A representative loudnorm pass-1 JSON block, as ffmpeg prints it on stderr amid banner
// and progress noise (print_format=json). The five fields pass 2 feeds back are input_i /
// input_tp / input_lra / input_thresh / target_offset.
const REAL_STDERR =
  'ffmpeg version 8.1.1 Copyright (c) 2000-2026\n' +
  '[Parsed_loudnorm_0 @ 0x600003a8] \n' +
  '{\n' +
  '\t"input_i" : "-48.55",\n' +
  '\t"input_tp" : "-44.36",\n' +
  '\t"input_lra" : "0.00",\n' +
  '\t"input_thresh" : "-58.71",\n' +
  '\t"output_i" : "-14.45",\n' +
  '\t"output_tp" : "-10.27",\n' +
  '\t"output_lra" : "0.00",\n' +
  '\t"output_thresh" : "-24.61",\n' +
  '\t"normalization_type" : "dynamic",\n' +
  '\t"target_offset" : "0.45"\n' +
  '}\n'

describe('parseLoudnormStats — ffmpeg loudnorm JSON', () => {
  test('extracts the five measured fields from noisy stderr', () => {
    const stats = parseLoudnormStats(REAL_STDERR)
    expect(stats).not.toBeNull()
    expect(stats!.input_i).toBe('-48.55')
    expect(stats!.input_tp).toBe('-44.36')
    expect(stats!.input_lra).toBe('0.00')
    expect(stats!.input_thresh).toBe('-58.71')
    expect(stats!.target_offset).toBe('0.45')
  })

  test('returns null when no JSON block is present', () => {
    expect(parseLoudnormStats('ffmpeg error: no such file\n')).toBeNull()
  })

  test('returns null when a required field is missing', () => {
    const missing =
      '{\n\t"input_i" : "-20.0",\n\t"input_tp" : "-3.0",\n\t"target_offset" : "0.1"\n}\n'
    expect(parseLoudnormStats(missing)).toBeNull()
  })

  test('returns null on malformed JSON', () => {
    expect(parseLoudnormStats('{ "input_i": not-valid }')).toBeNull()
  })
})
