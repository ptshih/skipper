// Mastering — loudness-normalize + AAC-encode the shipped TTS take in ONE ffmpeg pass.
//
// This is the ONLY lossy encode on the audio path: synthesize() returns a LOSSLESS LINEAR16
// WAV take, and this step (a) levels it and (b) encodes it to AAC-LC (48 or 64 kbps, per the active
// master) in an .m4a. Encoding here (rather than requesting Cloud TTS's fixed 32k MP3) avoids a SECOND
// lossy generation and lets us choose codec/bitrate — see docs/decisions/audio-compression-spike.md.
//
// LEVELING — a true-peak LIMITER, then a single-pass dynamic LOUDNORM (the masteringChain), at one of
// two parked presets (MASTERS below; `normal14` active, `loud13` validated-but-off):
//   Gemini-TTS takes are quiet (~−19 to −22 LUFS) but PEAK-BOUND — they already crest at ~0 dBFS, so
//   there's no headroom to gain up, and a plain loudnorm undershoots the target inconsistently (−14.7 …
//   −15.5). The fix is the broadcast move: an `alimiter` pushes the body up and brick-walls the transient
//   peaks, making the headroom; then `loudnorm` normalizes to the target (−14 natural, or −13 Spotify-"Loud").
//
//   SINGLE-PASS (dynamic loudnorm), not two-pass linear: with a stateful filter (the limiter) in front,
//   the two-pass design breaks — pass 1 measures a different signal than pass 2 gains, so its true-peak
//   limit is computed against the wrong peaks and the AAC encode overshoots into CLIPPING (that bug
//   shipped once, 2026-06-19→20, then was reverted). A single pass has no measure/apply gap.
//
//   Each preset's PRE-ENCODE TP ceiling sits below the −1 delivery ceiling to leave room for AAC inter-
//   sample overshoot, so final clips land ~−1.5…−2 dBTP. The louder −13 preset needs MORE headroom AND
//   64k AAC (at 48k the overshoot clipped some clips to +1.4 dBTP). The limiter only touches transient
//   peaks, so it does not reintroduce tail-collapse (the quiet tail sits far below the brick-wall). See
//   docs/decisions/audio-loudness-spec.md.
//
// ffmpeg is REQUIRED (it IS the encoder, not just QA): a missing/failed encode THROWS rather than ship
// a mislabeled clip. The Cloud Run image carries ffmpeg (packages/studio/Dockerfile); a bare local box
// without it must install it. Leveling is part of the single encode pass — not a separable, skippable step.

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { LOUDNORM_RANGE_LU } from '../models'

/** One narration master = the limiter→single-pass-loudnorm chain at a chosen loudness. */
interface NarrationMaster {
  /** loudnorm integrated target (LUFS). */
  targetLufs: number
  /** `alimiter` input gain — the loudness lever (pushes the body up into the brick-wall). */
  limiterGain: number
  /** `alimiter` true-peak ceiling (linear; kept == preEncodeTp so loudnorm needn't re-attenuate). */
  limiterCeiling: number
  /** loudnorm PRE-ENCODE true-peak ceiling (dBTP) — headroom for AAC overshoot (final ~−1.5…−2). */
  preEncodeTp: number
  /** Output AAC bitrate — a louder master needs more (less inter-sample overshoot). */
  bitrate: string
}

/**
 * Two VALIDATED narration masters (2026-06-20) — flip `MASTER` to switch; BOTH stay in code so the
 * tuning work is never lost:
 *   - normal14 (−14): the SAFE default — natural dynamics, gentle limiter, 48k AAC. Validated on 3 clips.
 *   - loud13  (−13): Spotify-"Loud" — ~1 dB louder + denser. Needs MORE limiter gain AND 64k AAC (at 48k
 *     the inter-sample overshoot clipped some clips to +1.4 dBTP). Validated on the 6-clip Reno corpus
 *     through the REAL resynth path. −13 is at the EDGE of clean AAC overshoot — don't push past it.
 * When loud13 is active the VOICE diverges from the −14 music bed (AUDIO_LOUDNESS). docs/decisions/
 * audio-loudness-spec.md has the full history (incl. the reverted clip bug + the 48k→64k raise).
 */
const MASTERS: Record<'normal14' | 'loud13', NarrationMaster> = {
  normal14: { targetLufs: -14, limiterGain: 3, limiterCeiling: 0.794, preEncodeTp: -2.0, bitrate: '48k' },
  loud13: { targetLufs: -13, limiterGain: 6, limiterCeiling: 0.707, preEncodeTp: -3.0, bitrate: '64k' },
}

/** The ACTIVE narration master. `normal14` (−14, the safe default) for now; flip to `MASTERS.loud13`
 *  for the founder-validated Spotify-"Loud" −13 (parked, not active). */
const MASTER: NarrationMaster = MASTERS.normal14

/** Output AAC bitrate (from the active master). iOS AVPlayer (expo-audio) plays AAC-LC. */
const AAC_BITRATE = MASTER.bitrate
/** Output sample rate — pinned to the TTS native 24 kHz (loudnorm runs at 192 kHz internally,
 *  so without this the muxed file would inherit 192 kHz). */
const OUT_SAMPLE_RATE = '24000'

/** The full `-af` mastering filter: limiter (makes the headroom), then single-pass dynamic loudnorm to
 *  the active target. Exported for tests (guards the limiter-before-loudnorm order + the active params). */
export function masteringChain(): string {
  return (
    `alimiter=level_in=${MASTER.limiterGain}:limit=${MASTER.limiterCeiling},` +
    `loudnorm=I=${MASTER.targetLufs}:TP=${MASTER.preEncodeTp}:LRA=${LOUDNORM_RANGE_LU}`
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
