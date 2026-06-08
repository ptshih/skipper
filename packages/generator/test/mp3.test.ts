import { describe, expect, test } from 'bun:test'
import { mp3DurationMs } from '../src/pipeline/mp3'

// Build one valid MPEG audio frame (4-byte header + zero filler to the frame length).
// The parser reads only the header to derive length + duration, so zero filler is fine.
//   kind 'v2l3-32-24k' : MPEG2 Layer III, 32 kbps, 24 kHz → 576 samples, 96-byte frames,
//                        24.000 ms each. (This is the Cloud TTS "MP3 at 32kbps" profile.)
//   kind 'v1l3-128-44k': MPEG1 Layer III, 128 kbps, 44.1 kHz → 1152 samples, 417-byte
//                        frames, 26.122 ms each.
function frame(kind: 'v2l3-32-24k' | 'v1l3-128-44k'): Uint8Array {
  let b2: number, b3: number, length: number
  if (kind === 'v2l3-32-24k') {
    b2 = 0xf3 // 111 (sync) 10 (MPEG2) 01 (Layer III) 1 (no CRC)
    b3 = 0x44 // bitrate idx 4 (=32k) << 4 | samplerate idx 1 (=24000) << 2 | pad 0
    length = 96
  } else {
    b2 = 0xfb // 111 11 (MPEG1) 01 (Layer III) 1
    b3 = 0x90 // bitrate idx 9 (=128k) << 4 | samplerate idx 0 (=44100) << 2 | pad 0
    length = 417
  }
  const f = new Uint8Array(length)
  f[0] = 0xff
  f[1] = b2
  f[2] = b3
  f[3] = 0xc4 // channel mode etc — ignored by the parser
  return f
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

describe('mp3DurationMs', () => {
  test('sums MPEG2 Layer III frames (the 32kbps/24kHz Cloud TTS profile) — 24ms each', () => {
    const bytes = concat(Array.from({ length: 10 }, () => frame('v2l3-32-24k')))
    expect(mp3DurationMs(bytes)).toBe(240) // 10 × 576/24000 s
  })

  test('handles MPEG1 Layer III frames (44.1kHz/128kbps) — 1152 samples each', () => {
    const bytes = concat(Array.from({ length: 100 }, () => frame('v1l3-128-44k')))
    expect(mp3DurationMs(bytes)).toBe(Math.round((100 * 1152) / 44100 * 1000)) // 2612 ms
  })

  test('skips a leading ID3v2 tag (size in synchsafe bytes 6..9)', () => {
    // ID3v2 header: 'ID3', version 0x03 0x00, flags 0x00, synchsafe size = 4 (a 4-byte body).
    const id3 = new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0, 0, 0, 4, 0xaa, 0xbb, 0xcc, 0xdd])
    const bytes = concat([id3, frame('v2l3-32-24k'), frame('v2l3-32-24k')])
    expect(mp3DurationMs(bytes)).toBe(48) // the ID3 body must NOT be parsed as audio
  })

  test('tolerates trailing junk after the frame run (e.g. an ID3v1 tag)', () => {
    const junk = new Uint8Array([0x54, 0x41, 0x47, 1, 2, 3]) // 'TAG' + bytes
    const bytes = concat([frame('v2l3-32-24k'), frame('v2l3-32-24k'), junk])
    expect(mp3DurationMs(bytes)).toBe(48)
  })

  test('returns 0 for empty or non-MP3 input (so the synth guard rejects it)', () => {
    expect(mp3DurationMs(new Uint8Array(0))).toBe(0)
    expect(mp3DurationMs(new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]))).toBe(0)
  })
})
