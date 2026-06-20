// Mastering — loudness-normalize + AAC-encode the shipped TTS take in ONE ffmpeg pass.
//
// This is the ONLY lossy encode on the audio path: synthesize() returns a LOSSLESS LINEAR16
// WAV take, and this step (a) levels it and (b) encodes it to AAC-LC 48 kbps in an .m4a.
// Encoding here (rather than requesting Cloud TTS's fixed 32k MP3) avoids a SECOND lossy
// generation and lets us choose codec/bitrate — see docs/decisions/audio-compression-spike.md.
//
// LEVELING — a true-peak LIMITER, then a single-pass dynamic LOUDNORM (the MASTERING_CHAIN):
//   Gemini-TTS takes are quiet (~−19 to −22 LUFS) but PEAK-BOUND — they already crest at ~0 dBFS,
//   so there's no headroom to gain up. A plain loudnorm to −14 therefore UNDERSHOOTS, inconsistently
//   (measured −14.7 … −15.5 across clips). The fix (validated on 3 clips spanning LRA 4→10, 2026-06-20)
//   is the broadcast move: an `alimiter` pushes the body up and brick-walls the transient peaks,
//   creating the headroom; then `loudnorm` normalizes to −14 LUFS. It lands a CONSISTENT ~−14.1…−14.5.
//
//   SINGLE-PASS (dynamic loudnorm), not the old two-pass linear: with a stateful filter (the limiter)
//   in front, the two-pass design breaks — pass 1 measures a different signal than pass 2 gains, so its
//   true-peak limit is computed against the wrong peaks and the AAC encode overshoots into CLIPPING
//   (that bug shipped once, 2026-06-19→20, then was reverted). A single pass has no measure/apply gap.
//
//   PRE-ENCODE TP = −2 dBTP, not −1: the 48 kbps AAC encoder adds inter-sample overshoot (up to ~+2 dB),
//   so a −1 pre-encode ceiling clips post-encode. −2 leaves the headroom; the final .m4a lands ~−1.5 dBTP,
//   under the AUDIO_LOUDNESS −1.0 delivery ceiling. The limiter only touches transient peaks, so it does
//   not reintroduce tail-collapse (the quiet tail sits far below the brick-wall). See docs/decisions/
//   audio-loudness-spec.md.
//
// ffmpeg is REQUIRED (it IS the encoder, not just QA): a missing/failed encode THROWS rather than ship
// a mislabeled clip. The Cloud Run image carries ffmpeg (packages/studio/Dockerfile); a bare local box
// without it must install it. Leveling is part of the single encode pass — not a separable, skippable step.

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { LOUDNORM_RANGE_LU, LOUDNORM_TARGET_LUFS } from '../models'

/** Output AAC bitrate — AAC-LC@48k: ~8× smaller than the LINEAR16 WAV, clearly better than
 *  MP3@32k at ~the same size, and iOS AVPlayer (expo-audio) plays it. */
const AAC_BITRATE = '48k'
/** Output sample rate — pinned to the TTS native 24 kHz (loudnorm runs at 192 kHz internally,
 *  so without this the muxed file would inherit 192 kHz). */
const OUT_SAMPLE_RATE = '24000'

// --- The mastering chain: true-peak limiter (makes headroom) → single-pass dynamic loudnorm (hits −14).
/** `alimiter` input gain — ~+9.5 dB pushed into the brick-wall. This is what makes the clip LOUDER:
 *  it raises the body while the limiter holds the peaks. Higher = louder + denser; tuned (2026-06-20)
 *  so −14 lands consistently across clips without crushing dynamics (LRA cost ~1 LU). */
const LIMITER_INPUT_GAIN = 3
/** `alimiter` true-peak ceiling (linear, ≈ −2.25 dBFS) — the brick-wall the input gain limits into. */
const LIMITER_CEILING = 0.794
/** loudnorm PRE-ENCODE true-peak ceiling (dBTP). −2 (not the −1 delivery ceiling) leaves headroom for
 *  AAC inter-sample overshoot so the final .m4a lands ~−1.5 dBTP — under AUDIO_LOUDNESS's −1.0. */
const PRE_ENCODE_TP_DBTP = -2.0

/** The full `-af` mastering filter: limiter, then single-pass dynamic loudnorm to the spec.
 *  Exported for tests (guards the limiter-before-loudnorm order + the params). */
export function masteringChain(): string {
  return (
    `alimiter=level_in=${LIMITER_INPUT_GAIN}:limit=${LIMITER_CEILING},` +
    `loudnorm=I=${LOUDNORM_TARGET_LUFS}:TP=${PRE_ENCODE_TP_DBTP}:LRA=${LOUDNORM_RANGE_LU}`
  )
}

/** Master + encode in ONE ffmpeg pass: the limiter→loudnorm chain fused with the AAC encode.
 *  Returns false on any ffmpeg failure/absence (the caller turns that into a hard throw). */
async function encode(file: string, out: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(
      [
        'ffmpeg', '-hide_banner', '-nostats', '-y', '-i', file,
        '-af', masteringChain(),
        '-ar', OUT_SAMPLE_RATE, '-ac', '1', '-c:a', 'aac', '-b:a', AAC_BITRATE,
        '-movflags', '+faststart', out,
      ],
      { stdout: 'ignore', stderr: 'pipe' },
    )
    await new Response(proc.stderr).text()
    return (await proc.exited) === 0
  } catch {
    return false
  }
}

/**
 * Master one shipped take (lossless WAV) to the final AAC `.m4a` clip: the limiter→loudnorm
 * mastering chain (MASTERING_CHAIN) fused with the single AAC encode. Returns the .m4a bytes.
 * The take's PCM duration is preserved to within the encoder's edit-list priming, so the caller's
 * stored duration still matches.
 *
 * THROWS if ffmpeg can't produce the clip (absent or failed encode) — ffmpeg is the encoder on this
 * path, not optional QA. Leveling is part of the same pass, so it is not separately skippable.
 */
export async function normalizeAndEncode(audio: Uint8Array): Promise<Uint8Array> {
  const id = crypto.randomUUID()
  const inFile = join(tmpdir(), `skipper-master-in-${id}.wav`)
  const outFile = join(tmpdir(), `skipper-master-out-${id}.m4a`)
  try {
    await writeFile(inFile, audio)
    if (!(await encode(inFile, outFile))) {
      throw new Error(
        'ffmpeg AAC encode failed — ffmpeg is REQUIRED for the LINEAR16→AAC clip path. ' +
          'Install ffmpeg (the Cloud Run image already carries it).',
      )
    }
    const out = new Uint8Array(await readFile(outFile))
    if (!out.length) throw new Error('ffmpeg produced an empty .m4a clip.')
    return out
  } finally {
    await unlink(inFile).catch(() => {})
    await unlink(outFile).catch(() => {})
  }
}
