// PCM/WAV helpers — Cloud TTS returns LINEAR16 audio, and unlike ElevenLabs'
// /with-timestamps there is no duration field, so we derive duration from the
// bytes. LINEAR16 is byte-linear, so this is exact (the ready-gate needs a real
// duration). We also guarantee a playable WAV at rest: if Cloud TTS hands back a
// RIFF/WAVE container we keep it; if it hands back headerless PCM we wrap it.
//
// Pure functions, no deps — unit-tested in test/wav.test.ts.

export interface PcmFormat {
  sampleRate: number
  channels: number
  bitsPerSample: number
}

/** Gemini-TTS / Cloud TTS LINEAR16 native output: 24 kHz, 16-bit, mono, little-endian. */
export const GEMINI_PCM: PcmFormat = { sampleRate: 24_000, channels: 1, bitsPerSample: 16 }

const ascii = (bytes: Uint8Array, offset: number, len: number): string => {
  let s = ''
  for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[offset + i]!)
  return s
}

/** True if the buffer is a RIFF/WAVE container (vs. headerless PCM). */
export function isWav(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE'
}

/** Duration (ms) of raw PCM of `byteLength`, given its format. Exact for LINEAR16. */
export function pcmDurationMs(byteLength: number, fmt: PcmFormat = GEMINI_PCM): number {
  const bytesPerSecond = fmt.sampleRate * fmt.channels * (fmt.bitsPerSample / 8)
  if (bytesPerSecond <= 0) return 0
  return Math.round((byteLength / bytesPerSecond) * 1000)
}

export interface WavInfo {
  fmt: PcmFormat
  /** Size of the PCM payload in the `data` chunk (bytes). */
  dataBytes: number
}

/** Parse a RIFF/WAVE header: the `fmt ` chunk's format and the `data` chunk's size. */
export function wavInfo(bytes: Uint8Array): WavInfo {
  if (!isWav(bytes)) throw new Error('Not a WAV (RIFF/WAVE) buffer.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 12 // past "RIFF"<size>"WAVE"
  let fmt: PcmFormat | undefined
  let dataBytes: number | undefined
  while (offset + 8 <= bytes.length) {
    const id = ascii(bytes, offset, 4)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === 'fmt ') {
      fmt = {
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      }
    } else if (id === 'data') {
      dataBytes = size
    }
    offset = body + size + (size % 2) // chunks are word-aligned
  }
  if (!fmt) throw new Error('WAV missing fmt chunk.')
  if (dataBytes === undefined) throw new Error('WAV missing data chunk.')
  return { fmt, dataBytes }
}

/** Duration (ms) of a WAV buffer, from its header. */
export function wavDurationMs(bytes: Uint8Array): number {
  const { fmt, dataBytes } = wavInfo(bytes)
  return pcmDurationMs(dataBytes, fmt)
}

/** Wrap headerless PCM in a 44-byte canonical WAV header so it is playable at rest. */
export function pcmToWav(pcm: Uint8Array, fmt: PcmFormat = GEMINI_PCM): Uint8Array {
  const blockAlign = fmt.channels * (fmt.bitsPerSample / 8)
  const byteRate = fmt.sampleRate * blockAlign
  const out = new Uint8Array(44 + pcm.length)
  const view = new DataView(out.buffer)
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[off + i] = s.charCodeAt(i)
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + pcm.length, true) // file size minus 8
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM fmt chunk size
  view.setUint16(20, 1, true) // audio format = PCM
  view.setUint16(22, fmt.channels, true)
  view.setUint32(24, fmt.sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, fmt.bitsPerSample, true)
  writeStr(36, 'data')
  view.setUint32(40, pcm.length, true)
  out.set(pcm, 44)
  return out
}

/**
 * Normalize a Cloud TTS LINEAR16 response to (playable WAV bytes + exact duration),
 * whether the API returned a RIFF/WAVE container or headerless PCM.
 */
export function toWavWithDuration(raw: Uint8Array, fmt: PcmFormat = GEMINI_PCM): { wav: Uint8Array; durationMs: number } {
  if (isWav(raw)) return { wav: raw, durationMs: wavDurationMs(raw) }
  return { wav: pcmToWav(raw, fmt), durationMs: pcmDurationMs(raw.length, fmt) }
}
