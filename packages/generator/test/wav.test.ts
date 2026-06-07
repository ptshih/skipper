import { describe, expect, test } from 'bun:test'
import { GEMINI_PCM, isWav, pcmDurationMs, pcmToWav, toWavWithDuration, wavDurationMs, wavInfo } from '../src/pipeline/wav'

// 0.5 s of LINEAR16 at 24 kHz mono = 24000 * 2 * 0.5 = 24000 bytes.
const halfSecondPcm = new Uint8Array(GEMINI_PCM.sampleRate * GEMINI_PCM.channels * (GEMINI_PCM.bitsPerSample / 8) * 0.5)

describe('wav helpers', () => {
  test('pcmDurationMs is exact for LINEAR16', () => {
    expect(pcmDurationMs(48_000, GEMINI_PCM)).toBe(1000) // one second of bytes
    expect(pcmDurationMs(halfSecondPcm.length, GEMINI_PCM)).toBe(500)
  })

  test('isWav distinguishes RIFF/WAVE from raw PCM', () => {
    expect(isWav(halfSecondPcm)).toBe(false)
    expect(isWav(pcmToWav(halfSecondPcm))).toBe(true)
  })

  test('pcmToWav writes a parseable header with the right format + data size', () => {
    const wav = pcmToWav(halfSecondPcm, GEMINI_PCM)
    expect(wav.length).toBe(44 + halfSecondPcm.length)
    const { fmt, dataBytes } = wavInfo(wav)
    expect(fmt).toEqual(GEMINI_PCM)
    expect(dataBytes).toBe(halfSecondPcm.length)
    expect(wavDurationMs(wav)).toBe(500)
  })

  test('toWavWithDuration wraps raw PCM and computes duration', () => {
    const { wav, durationMs } = toWavWithDuration(halfSecondPcm, GEMINI_PCM)
    expect(isWav(wav)).toBe(true)
    expect(durationMs).toBe(500)
  })

  test('toWavWithDuration passes an existing WAV through unchanged', () => {
    const existing = pcmToWav(halfSecondPcm, GEMINI_PCM)
    const { wav, durationMs } = toWavWithDuration(existing, GEMINI_PCM)
    expect(wav).toBe(existing) // not re-wrapped
    expect(durationMs).toBe(500)
  })

  test('wavInfo throws on non-WAV input', () => {
    expect(() => wavInfo(halfSecondPcm)).toThrow()
  })
})
