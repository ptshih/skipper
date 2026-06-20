// Mastering — loudness-normalize + AAC-encode the shipped TTS take in ONE ffmpeg pass.
//
// This is the ONLY lossy encode on the audio path: synthesize() returns a LOSSLESS LINEAR16
// WAV take, and this step (a) levels it and (b) encodes it to AAC-LC 64 kbps in an .m4a.
// Encoding here (rather than requesting Cloud TTS's fixed 32k MP3) avoids a SECOND lossy
// generation and lets us choose codec/bitrate — see docs/decisions/audio-compression-spike.md.
//
// LEVELING — a true-peak LIMITER, then a single-pass dynamic LOUDNORM (the masteringChain):
//   Gemini-TTS takes are quiet (~−19 to −22 LUFS) but PEAK-BOUND — they already crest at ~0 dBFS, so
//   there's no headroom to gain up. A plain loudnorm therefore UNDERSHOOTS the target, inconsistently
//   (−14.7 … −15.5). The fix is the broadcast move: an `alimiter` pushes the body up and brick-walls the
//   transient peaks, creating the headroom; then `loudnorm` normalizes to the NARRATION target (−13 LUFS,
//   Spotify-"Loud"-ish — the voice is the product). Validated 2026-06-20 on the 6-clip Reno corpus →
//   consistent −13.0…−13.4, clean peaks (−1.6…−2.1).
//
//   SINGLE-PASS (dynamic loudnorm), not two-pass linear: with a stateful filter (the limiter) in front,
//   the two-pass design breaks — pass 1 measures a different signal than pass 2 gains, so its true-peak
//   limit is computed against the wrong peaks and the AAC encode overshoots into CLIPPING (that bug
//   shipped once, 2026-06-19→20, then was reverted). A single pass has no measure/apply gap.
//
//   PRE-ENCODE TP = −3 dBTP (not the −1 delivery ceiling): the AAC encoder adds inter-sample overshoot,
//   so the pre-encode ceiling must leave room for it — final clips land ~−1.6…−2.1. −13 is at the EDGE
//   of what AAC can hold clean: at 48 kbps it overshot some clips to +1.4 dBTP (clipping), so the bitrate
//   was raised to 64k (less overshoot). The limiter only touches transient peaks, so it does not
//   reintroduce tail-collapse (the quiet tail sits far below the brick-wall). See docs/decisions/
//   audio-loudness-spec.md.
//
// ffmpeg is REQUIRED (it IS the encoder, not just QA): a missing/failed encode THROWS rather than ship
// a mislabeled clip. The Cloud Run image carries ffmpeg (packages/studio/Dockerfile); a bare local box
// without it must install it. Leveling is part of the single encode pass — not a separable, skippable step.

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { LOUDNORM_RANGE_LU } from '../models'

/** NARRATION integrated target (LUFS) — the VOICE is the product, so it runs hotter than the shared
 *  AUDIO_LOUDNESS −14 (which still governs the drive-music bed). −13 (founder, 2026-06-20) = Spotify
 *  "Loud"-ish; the limiter makes the headroom for it. The voice/bed are decoupled by 1 dB on hand-off
 *  (music ducks to silence UNDER the voice, so the gap only shows when music swells back) — flagged
 *  for on-device check in docs/decisions/audio-loudness-spec.md. */
const NARRATION_TARGET_LUFS = -13

/** Output AAC bitrate — AAC-LC@64k: raised from 48k (2026-06-20) so the louder −13 master survives the
 *  encoder's inter-sample overshoot (48k overshot some clips to +1.4 dBTP = clipping; 64k lands ~−1.6).
 *  Still ~6× smaller than the LINEAR16 WAV; iOS AVPlayer (expo-audio) plays it. */
const AAC_BITRATE = '64k'
/** Output sample rate — pinned to the TTS native 24 kHz (loudnorm runs at 192 kHz internally,
 *  so without this the muxed file would inherit 192 kHz). */
const OUT_SAMPLE_RATE = '24000'

// --- The mastering chain: true-peak limiter (makes headroom) → single-pass dynamic loudnorm (hits −13).
/** `alimiter` input gain — ~+12 dB pushed into the brick-wall. This is what makes the clip LOUDER:
 *  it raises the body while the limiter holds the peaks. Higher = louder + denser; tuned (2026-06-20)
 *  so −13 lands across clips with clean peaks. (−13 is at the edge of what 48 kbps AAC overshoot can
 *  hold — peaks are non-monotonic in this gain — so the ceilings below are deliberately conservative.) */
const LIMITER_INPUT_GAIN = 6
/** `alimiter` true-peak ceiling (linear, ≈ −3.0 dBFS) — the brick-wall the input gain limits into;
 *  kept equal to the loudnorm TP so loudnorm never has to re-attenuate the limited signal. */
const LIMITER_CEILING = 0.707
/** loudnorm PRE-ENCODE true-peak ceiling (dBTP). −3 (not the −1 delivery ceiling) leaves headroom for
 *  AAC inter-sample overshoot (~+2 dB on hot speech) so the final .m4a lands ~−1 dBTP at the louder −13. */
const PRE_ENCODE_TP_DBTP = -3.0

/** The full `-af` mastering filter: limiter, then single-pass dynamic loudnorm to the narration target.
 *  Exported for tests (guards the limiter-before-loudnorm order + the params). */
export function masteringChain(): string {
  return (
    `alimiter=level_in=${LIMITER_INPUT_GAIN}:limit=${LIMITER_CEILING},` +
    `loudnorm=I=${NARRATION_TARGET_LUFS}:TP=${PRE_ENCODE_TP_DBTP}:LRA=${LOUDNORM_RANGE_LU}`
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
