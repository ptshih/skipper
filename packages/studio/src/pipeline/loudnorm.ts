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
import { AUDIO_LOUDNESS } from '@skipper/shared'
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
 * Two VALIDATED narration masters — flip `MASTER` to switch; BOTH stay in code so the tuning work is
 * never lost. They now share ONE peak discipline (limiter gain 6 → ceiling 0.707 → pre-encode TP −3 →
 * 64k AAC) and differ ONLY in the loudness target:
 *   - normal14 (−14): the ACTIVE default. RE-TUNED 2026-06-20 from the original GENTLE params (gain 3 /
 *     ceiling 0.794 / TP −2 / 48k) after a full-corpus resynth proved they ran HOT: single-pass dynamic
 *     loudnorm does NOT hard-cap true-peak, so peaky register-varied (town/landscape) takes overshot —
 *     41/460 clips clipped, the worst at +4.7 dBTP (worse than the un-mastered corpus). loud13's headroom
 *     discipline holds where the gentle params didn't, so normal14 borrows it at the −14 target.
 *   - loud13  (−13): Spotify-"Loud" — ~1 dB louder; when active the VOICE sits 1 dB above the −14 music
 *     bed (AUDIO_LOUDNESS). −13 is the EDGE of clean AAC overshoot — don't push past it.
 * 64k AAC (vs the old 48k) is the price of clean peaks at low bitrate — ~33% bigger downloads, justified
 * by the clipping data. docs/decisions/audio-loudness-spec.md has the full history.
 */
const MASTERS: Record<'normal14' | 'loud13', NarrationMaster> = {
  normal14: { targetLufs: -14, limiterGain: 6, limiterCeiling: 0.707, preEncodeTp: -3.0, bitrate: '64k' },
  loud13: { targetLufs: -13, limiterGain: 6, limiterCeiling: 0.707, preEncodeTp: -3.0, bitrate: '64k' },
}

/** The ACTIVE narration master. `normal14` (−14, the safe default) for now; flip to `MASTERS.loud13`
 *  for the founder-validated Spotify-"Loud" −13 (parked, not active). */
const MASTER: NarrationMaster = MASTERS.normal14

/** The active master's integrated-loudness target (LUFS) — exported so read-only QA tooling (e.g.
 *  audit-loudness.ts) labels its distribution against the SAME target the judge uses, following a
 *  `loud13` flip automatically instead of hardcoding −14. */
export const ACTIVE_MASTER_TARGET_LUFS = MASTER.targetLufs

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
 * mastering chain (masteringChain) fused with the single AAC encode. Returns the .m4a bytes.
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

// ─────────────────────────────────────────────────────────────────────────────
// POST-ENCODE QA METER — close the loop the master never verified.
//
// The masteringChain TARGETS −14 LUFS / −1 dBTP, but until now nothing read the SHIPPED .m4a back, so
// the −14.7…−15.5 undershoot spread (old linear loudnorm) and the +1.4/+2.4 dBTP AAC overshoot (the −13
// work) were both found BY HAND. This re-decodes the encoded clip with ffmpeg `ebur128=peak=true` and
// judges its integrated loudness + true peak. The true peak here is the DECODED-AAC true peak — the
// inter-sample overshoot the pre-encode TP ceiling (a PCM ceiling) is blind to. ADVISORY (mark-and-flag):
// the caller records the verdict, it never withholds a clip and never fails synthesis.
// ─────────────────────────────────────────────────────────────────────────────

/** Post-encode QA tolerance: |measured integrated − the active master target| beyond this many LU is
 *  FLAGGED. The limiter→loudnorm master lands ~−14.1…−14.5 on −14 (and −13.0…−13.4 on loud13), so ±1 LU
 *  never trips a healthy clip but catches the −14.7…−15.5 undershoot spread the old linear loudnorm left. */
const LOUDNESS_TOLERANCE_LU = 1.0

/** The post-encode loudness/true-peak verdict for one shipped .m4a. */
export interface LoudnessOutcome {
  /** Measured integrated loudness of the ENCODED clip (LUFS). */
  integratedLufs: number
  /** Measured true peak of the DECODED AAC (dBTP) — includes the inter-sample overshoot the pre-encode
   *  PCM ceiling can't see (the defect that clipped clips to +1.4/+2.4 dBTP). */
  truePeakDb: number
  /** Integrated loudness within ±LOUDNESS_TOLERANCE_LU of the active master target. */
  loudnessOk: boolean
  /** True peak within the shared −1 dBTP delivery ceiling (no AAC overshoot into clipping). */
  truePeakOk: boolean
}

/** Parse ffmpeg `ebur128`'s end-of-stream Summary block (PURE — unit-tested against the real 8.x format).
 *  Anchors on the "Summary:" marker because the per-frame log lines carry `I:` / `TPK:` too; inside the
 *  Summary the labels are `I:` (Integrated loudness) + `Peak:` (True peak). Returns null when the block or
 *  a field is absent / non-finite (e.g. `-inf` on digital silence) — the QA meter then ships unmeasured. */
export function parseEbur128Summary(stderr: string): { integratedLufs: number; truePeakDb: number } | null {
  const at = stderr.lastIndexOf('Summary:')
  if (at < 0) return null
  const tail = stderr.slice(at)
  const i = /\bI:\s*(-?\d+(?:\.\d+)?)\s*LUFS/.exec(tail)
  const p = /\bPeak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/.exec(tail)
  if (!i || !p) return null
  return { integratedLufs: Number(i[1]), truePeakDb: Number(p[1]) }
}

/** Judge a measured (integrated, true-peak) pair against the ACTIVE master target + the shared −1 dBTP
 *  delivery ceiling. PURE (no ffmpeg) so the thresholds are unit-tested; the target follows `MASTER`, so
 *  flipping to `loud13` (−13) re-aims the loudness check automatically. */
export function judgeMasteredLoudness(m: { integratedLufs: number; truePeakDb: number }): LoudnessOutcome {
  return {
    integratedLufs: m.integratedLufs,
    truePeakDb: m.truePeakDb,
    loudnessOk: Math.abs(m.integratedLufs - MASTER.targetLufs) <= LOUDNESS_TOLERANCE_LU,
    truePeakOk: m.truePeakDb <= AUDIO_LOUDNESS.truePeakDbtp,
  }
}

/** One read-only `ebur128=peak=true` pass over a file; null on any failure (no throw). */
async function ebur128Summary(file: string): Promise<{ integratedLufs: number; truePeakDb: number } | null> {
  try {
    // -f null - decodes (read-only) without writing; ebur128 reports its Summary on stderr at stream end.
    const proc = Bun.spawn(
      ['ffmpeg', '-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
      { stdout: 'ignore', stderr: 'pipe' },
    )
    const stderr = await new Response(proc.stderr).text()
    if ((await proc.exited) !== 0) return null
    return parseEbur128Summary(stderr)
  } catch {
    return null
  }
}

/**
 * Post-encode QA: measure the SHIPPED .m4a's integrated loudness + decoded-AAC true peak and judge them
 * against the active master target + the −1 dBTP delivery ceiling. ADVISORY — returns null (never throws)
 * when ffmpeg is absent or the read/parse fails, so a meter miss can't fail synthesis. ffmpeg's ebur128
 * is already on the ship path (the encoder is ffmpeg), so on a real run this always measures.
 */
export async function verifyMasteredLoudness(m4a: Uint8Array): Promise<LoudnessOutcome | null> {
  const file = join(tmpdir(), `skipper-meter-${crypto.randomUUID()}.m4a`)
  try {
    await writeFile(file, m4a)
    const m = await ebur128Summary(file)
    return m ? judgeMasteredLoudness(m) : null
  } catch {
    return null
  } finally {
    await unlink(file).catch(() => {})
  }
}
