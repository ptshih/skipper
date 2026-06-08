// MP3 duration — Cloud TTS returns no duration field, and (unlike LINEAR16) MP3 is
// NOT byte-linear, so we can't divide byte length by a byte rate. Instead we walk the
// MPEG audio frames and sum each frame's playback time. This is EXACT (each frame is a
// fixed number of samples at a known rate) and handles CBR or VBR, a leading Xing/Info
// header frame (it's just another frame), and an optional leading ID3v2 tag.
//
// Pure functions, no deps — unit-tested in test/mp3.test.ts (and cross-checked against
// a real ffmpeg-LAME 32kbps file during the audio-compression spike; see
// docs/audio-compression-spike.md). Mirrors wav.ts in spirit: parse the container,
// derive the duration.
//
// Header reference: an MPEG audio frame begins with an 11-bit sync (0xFFE) followed by
// version/layer/bitrate/samplerate/padding fields. See the MPEG-1/2 audio spec.

/** Samples per frame, keyed by [isV1][layer] — fixed by the MPEG version + layer. */
const SAMPLES_PER_FRAME = {
  // MPEG2 / 2.5: Layer III is 576 (half of MPEG1's 1152).
  v2: { 1: 384, 2: 1152, 3: 576 },
  v1: { 1: 384, 2: 1152, 3: 1152 },
} as const

/** Sampling rate (Hz) by version, indexed by the 2-bit samplerate field (0..2; 3 = reserved). */
const SAMPLE_RATES: Record<'mpeg1' | 'mpeg2' | 'mpeg25', readonly number[]> = {
  mpeg1: [44100, 48000, 32000],
  mpeg2: [22050, 24000, 16000],
  mpeg25: [11025, 12000, 8000],
}

// Bitrate (kbps) tables, indexed by the 4-bit bitrate field (0 = free, 15 = bad → invalid).
const BR_V1_L1 = [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0]
const BR_V1_L2 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0]
const BR_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
const BR_V2_L1 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0]
const BR_V2_L23 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0] // V2 Layer II & III

interface FrameInfo {
  /** Total frame length in bytes (so we can step to the next frame). */
  lengthBytes: number
  /** Samples this frame represents (fixed by version+layer). */
  samples: number
  /** Sampling rate (Hz). */
  sampleRate: number
}

/** Skip a leading ID3v2 tag if present; returns the byte offset where MPEG frames start. */
function skipId3v2(bytes: Uint8Array): number {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0 // 'ID3'
  // Bytes 6..9 are a synchsafe (7 bits per byte) size of the tag body, excluding the 10-byte header.
  const size =
    (bytes[6]! & 0x7f) * 0x200000 + (bytes[7]! & 0x7f) * 0x4000 + (bytes[8]! & 0x7f) * 0x80 + (bytes[9]! & 0x7f)
  return 10 + size
}

/** Parse one frame header at `off`. Returns null if it isn't a valid frame start. */
function parseFrame(bytes: Uint8Array, off: number): FrameInfo | null {
  if (off + 4 > bytes.length) return null
  const b1 = bytes[off]!
  const b2 = bytes[off + 1]!
  const b3 = bytes[off + 2]!
  // Frame sync: 11 bits all set (0xFFE).
  if (b1 !== 0xff || (b2 & 0xe0) !== 0xe0) return null

  const versionBits = (b2 >> 3) & 0x3 // 0b00=2.5, 0b01=reserved, 0b10=2, 0b11=1
  const layerBits = (b2 >> 1) & 0x3 // 0b00=reserved, 0b01=III, 0b10=II, 0b11=I
  if (versionBits === 1 || layerBits === 0) return null // reserved version / layer

  const isV1 = versionBits === 3
  const version = versionBits === 3 ? 'mpeg1' : versionBits === 2 ? 'mpeg2' : 'mpeg25'
  const layer = (4 - layerBits) as 1 | 2 | 3 // bits 11→I(1), 10→II(2), 01→III(3)

  const brIndex = (b3 >> 4) & 0xf
  const srIndex = (b3 >> 2) & 0x3
  if (brIndex === 0 || brIndex === 15 || srIndex === 3) return null // free/bad bitrate or reserved sample rate

  const brTable = isV1
    ? layer === 1
      ? BR_V1_L1
      : layer === 2
        ? BR_V1_L2
        : BR_V1_L3
    : layer === 1
      ? BR_V2_L1
      : BR_V2_L23
  const bitrateKbps = brTable[brIndex]!
  const sampleRate = SAMPLE_RATES[version][srIndex]!
  const samples = (isV1 ? SAMPLES_PER_FRAME.v1 : SAMPLES_PER_FRAME.v2)[layer]
  const padding = (b3 >> 1) & 0x1

  // Frame length in bytes. Layer I uses a slot of 4 bytes; II/III use 1-byte slots.
  const bitrate = bitrateKbps * 1000
  const lengthBytes =
    layer === 1
      ? (Math.floor((12 * bitrate) / sampleRate) + padding) * 4
      : Math.floor((samples / 8 * bitrate) / sampleRate) + padding
  if (lengthBytes < 4) return null
  return { lengthBytes, samples, sampleRate }
}

/**
 * Duration (ms) of an MP3 buffer, by summing every frame's playback time. Skips a
 * leading ID3v2 tag; tolerates trailing non-frame bytes (ID3v1, junk) by stopping at
 * the first byte that isn't a valid frame. Returns 0 if no frames are found.
 */
export function mp3DurationMs(bytes: Uint8Array): number {
  let off = skipId3v2(bytes)
  let seconds = 0
  let frames = 0
  // Resync tolerance: if we land on a non-frame byte but have already seen frames, the
  // stream has ended (or hit a trailing tag) — stop. Before the first frame, scan a
  // little for the initial sync (some files have a few junk bytes before frame 1).
  while (off + 4 <= bytes.length) {
    const frame = parseFrame(bytes, off)
    if (frame) {
      seconds += frame.samples / frame.sampleRate
      frames++
      off += frame.lengthBytes
    } else if (frames === 0) {
      off++ // still hunting for the first frame
    } else {
      break // end of the frame run
    }
  }
  return frames === 0 ? 0 : Math.round(seconds * 1000)
}
