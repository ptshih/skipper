// Mastering — voice-master + AAC-encode the shipped TTS take in ONE ffmpeg pass.
//
// This is the ONLY lossy encode on the audio path: synthesize() returns a LOSSLESS LINEAR16 WAV take,
// and this step (a) voice-masters it and (b) encodes it to AAC-LC 64 kbps in an .m4a. Encoding here
// (rather than requesting Cloud TTS's fixed 32k MP3) avoids a SECOND lossy generation and lets us choose
// codec/bitrate — see docs/decisions/audio-compression-spike.md.
//
// THE CHAIN (PROD-natural — founder-approved 2026-06-25 after the dogfood "too quiet / too bass-y /
// static at the start" triage + a cited deep-research pass; full history in docs/decisions/audio-loudness-spec.md).
// It follows the researched spoken-word ORDER — corrective EQ → cleanup → dynamics → loudness — and
// REPLACES the old single heavy `alimiter`. Each stage earns its place:
//   1. highpass 90 Hz       drop sub-bass rumble + proximity boom the deep "Charon" voice doesn't use (and
//                           phone/car speakers can't reproduce); the first de-bass move.
//   2. −3 dB bell @ 300 Hz  scoop the "mud" band (200–400 Hz) so the voice cuts through — this, not a
//                           hotter target, is the real fix for "feels quiet" (a CLARITY problem).
//   3. afftdn nr=6          LIGHT denoise of the TTS HF noise floor. Light on purpose: nr=12 smeared the
//                           voice ("underwater"). The de-bass above UNCOVERS this hiss (the low end had
//                           masked it), so a touch of cleanup belongs here.
//   4. agate                gate the silent lead-in + inter-word gaps so the amplified hiss can't surface
//                           there — this is what kills the "static at the beginning". Speech sits well
//                           above the threshold, so the voice itself is untouched.
//   5. acompressor 4:1      gentle crest-factor reduction = density ("louder feel") WITHOUT the brute
//                           limiting that squashes the voice (why we did NOT chase −11/−13).
//   6. loudnorm I=−14       EBU R128 normalize; its own 100 ms look-ahead / 192 kHz true-peak limiter is
//                           the FINAL peak guard, so no separate alimiter is needed for safety.
//
// LANDS ~−15.6 LUFS (median, 10-clip validation) / max −1.2 dBTP at 64k AAC — in the −14…−16 spoken-word
// window (AES TD1008, Apple −16). We do NOT force a hotter target: that needs heavy limiting (the squash
// the research warns against), and speech reads ~2–3 dB louder than music at equal LUFS, so −15.6 over the
// −14 music bed still keeps the Skipper on top. SINGLE-PASS loudnorm — two-pass linear can't reach target on this
// peak-bound source (it caps gain at the TP ceiling and undershoots), and a stateful filter before a
// two-pass measure/apply once shipped a clipping clip (2026-06-19→20, reverted).
//
// ffmpeg is REQUIRED (it IS the encoder, not just QA): a missing/failed encode THROWS rather than ship
// a mislabeled clip. The Cloud Run image carries ffmpeg (packages/studio/Dockerfile); a bare local box
// without it must install it. Leveling is part of the single encode pass — not a separable, skippable step.

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { AUDIO_LOUDNESS } from '@skipper/shared'
import { LOUDNORM_RANGE_LU } from '../models'

// ── Voice-master parameters. ONE greppable home each (CLAUDE.md: don't duplicate a volatile fact). ──
/** loudnorm integrated TARGET (LUFS) asked of the final stage. The chain LANDS ~0.9 LU under this on the
 *  peak-bound TTS source (see header); the QA meter judges the LANDING, not this asked-for value. */
const LOUDNORM_TARGET_LUFS = -14
/** loudnorm PRE-ENCODE true-peak ceiling (dBTP) — headroom for 64k-AAC inter-sample overshoot so the
 *  DECODED clip clears the −1 dBTP delivery ceiling. Deepened −2.0 → −3.0 after the 10-clip validation:
 *  64k AAC overshoots up to ~+1.4 dB on PEAKY register-varied (town/landscape) takes, so −2.0 left two of
 *  ten clips hot (−0.6/−0.9 dBTP, over the −1.0 ceiling). At −3.0 even the worst overshoot lands ~−1.6.
 *  The gentle (no brick-wall limiter) chain trades ~0.6 LU of loudness for this headroom (sub-JND); a
 *  louder target would need the squash. AES TD1008: drop the ceiling below −1 as bitrate falls. */
const PRE_ENCODE_TP = -3.0
/** Output AAC bitrate. iOS AVPlayer (expo-audio) plays AAC-LC; 64k is the compression-spike pick. */
const AAC_BITRATE = '64k'

// Per-stage filters in chain order (the WHY of each is in the header). Each is the literal ffmpeg arg
// string, kept as its own constant so a tweak has ONE home — not a magic number re-derived inline.
const VOICE_EQ = 'highpass=f=90,equalizer=f=300:t=q:w=1.0:g=-3' // de-bass: sub-bass roll-off + 300 Hz mud cut
const DENOISE = 'afftdn=nr=6' // light HF-noise cleanup (nr=12 went "underwater")
const GATE = 'agate=threshold=0.004:ratio=3:attack=5:release=180:range=0.003' // silence lead-in + gaps
const COMPRESS = 'acompressor=threshold=-22dB:ratio=4:attack=8:release=140' // gentle density, not a squash

/** The integrated loudness a HEALTHY clip is expected to MEASURE at (LUFS) — exported so read-only QA
 *  tooling (audit-loudness.ts) + the post-encode meter judge against the same number. This is the chain's
 *  LANDING, NOT the asked-for LOUDNORM_TARGET_LUFS. Set from the 10-clip validation at the −3.0 ceiling:
 *  median −15.6, p5/p95 −16.5/−15.0 (the deep AAC headroom costs ~0.7 LU vs the −2.0 trial). Re-confirm
 *  against the full resynth's audit-loudness distribution. */
export const ACTIVE_MASTER_TARGET_LUFS = -15.6

/** Output sample rate — pinned to the TTS native 24 kHz (loudnorm runs at 192 kHz internally,
 *  so without this the muxed file would inherit 192 kHz). */
const OUT_SAMPLE_RATE = '24000'

/** The full `-af` voice-master filter: corrective EQ → light denoise → gate → gentle compression →
 *  single-pass loudnorm. Exported for tests (guards the stage order + the active params). */
export function masteringChain(): string {
  return (
    `${VOICE_EQ},${DENOISE},${GATE},${COMPRESS},` +
    `loudnorm=I=${LOUDNORM_TARGET_LUFS}:TP=${PRE_ENCODE_TP}:LRA=${LOUDNORM_RANGE_LU}`
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

/** Post-encode QA tolerance: |measured integrated − ACTIVE_MASTER_TARGET_LUFS (the LANDING)| beyond this
 *  many LU is FLAGGED. The PROD-natural chain lands ~−14.9 with a per-clip spread (gentle compression + the
 *  single-pass undershoot vary with each take's crest factor), so ±1.2 LU never trips a healthy clip but
 *  still catches one that failed to normalize. Mark-and-flag only — a flagged clip is recorded, never withheld. */
const LOUDNESS_TOLERANCE_LU = 1.2

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

/** Judge a measured (integrated, true-peak) pair against the chain's expected LANDING
 *  (ACTIVE_MASTER_TARGET_LUFS) + the shared −1 dBTP delivery ceiling. PURE (no ffmpeg) so the thresholds
 *  are unit-tested; re-aims automatically if the landing constant is re-tuned after a resynth audit. */
export function judgeMasteredLoudness(m: { integratedLufs: number; truePeakDb: number }): LoudnessOutcome {
  return {
    integratedLufs: m.integratedLufs,
    truePeakDb: m.truePeakDb,
    loudnessOk: Math.abs(m.integratedLufs - ACTIVE_MASTER_TARGET_LUFS) <= LOUDNESS_TOLERANCE_LU,
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
