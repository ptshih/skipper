// Mastering — loudness-normalize + AAC-encode the shipped TTS take in ONE ffmpeg pass.
//
// This is the ONLY lossy encode on the audio path: synthesize() returns a LOSSLESS LINEAR16
// WAV take, and this step (a) levels it and (b) encodes it to AAC-LC 48 kbps in an .m4a.
// Encoding here (rather than requesting Cloud TTS's fixed 32k MP3) avoids a SECOND lossy
// generation and lets us choose codec/bitrate — see docs/decisions/audio-compression-spike.md.
//
// LEVELING: Gemini-TTS takes are non-deterministic in LOUDNESS — measured 2026-06-10 over all
// 30 live clips (founder-ear-confirmed): body means ranged −26.7 → −19.5 dB (a 7.2 dB
// stop-to-stop jump), and the whole mix read ~20–25% quiet vs a Spotify reference. So every
// shipped take runs an ffmpeg two-pass LINEAR loudnorm to the EBU R128 target in models.ts
// (−14 LUFS integrated, −1.0 dBTP ceiling), behind a transparent PEAK LIMITER (PEAK_LIMITER):
//   pass 1 MEASURES the (post-limiter) take's integrated loudness / true-peak / range,
//   pass 2 applies a single LINEAR gain (linear=true) to hit the target exactly, fused with
//          the AAC encode.
// Linear (not dynamic) is the point: it scales the whole clip uniformly, so every clip lands at
// the same integrated level (killing the spread) WITHOUT touching speech dynamics — and because
// it scales tail and body equally, it can never reintroduce the tail-collapse the retake just
// fixed. The −1.0 dBTP ceiling is why this isn't a flat `volume=+NdB`: bringing a −26 dB clip up
// to −14 could clip without true-peak limiting.
//
// Why the PEAK LIMITER (added 2026-06-20, founder-approved): un-limited TTS is PEAK-BOUND — its
// transient spikes (plosives/sibilants) hit the −1.0 dBTP ceiling before the linear gain reaches
// −14, so loudnorm gives up early and the clip lands ~−15 LUFS (the shipped corpus measured −14.7
// … −15.5, ~1 LU UNDER spec; raising the target number does nothing while peak-bound). A 20:1 squeeze
// above −3 dBFS shaves ONLY those top transients — the body/tail sit far below threshold, so speech
// dynamics and the tail-collapse guarantee are untouched — which frees the headroom for the linear
// gain to reach a TRUE −14. It runs in BOTH passes so the measured stats describe the post-limiter
// signal the gain is computed from. See docs/decisions/audio-loudness-spec.md.
//
// ffmpeg is REQUIRED (it IS the encoder, not just QA): a missing/failed encode THROWS rather
// than ship a mislabeled clip. The Cloud Run image carries ffmpeg (packages/studio/Dockerfile);
// a bare local box without it must install it. Only the LEVELING sub-step degrades gracefully —
// if pass-1 analysis can't be parsed, we still encode to AAC, just without the linear gain.

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { LOUDNORM_RANGE_LU, LOUDNORM_TARGET_LUFS, LOUDNORM_TRUE_PEAK_DB } from '../models'

/** Output AAC bitrate — AAC-LC@48k: ~8× smaller than the LINEAR16 WAV, clearly better than
 *  MP3@32k at ~the same size, and iOS AVPlayer (expo-audio) plays it. */
const AAC_BITRATE = '48k'
/** Output sample rate — pinned to the TTS native 24 kHz (loudnorm runs at 192 kHz internally,
 *  so without this the muxed file would inherit 192 kHz). */
const OUT_SAMPLE_RATE = '24000'

/** Transparent peak limiter, applied BEFORE loudnorm in BOTH passes (see the header for the why).
 *  20:1 above −3 dBFS = a brick-wall on transient spikes only; the body/tail are far below the
 *  threshold and pass through untouched, so it shaves the peaks that were pinning TTS at ~−15
 *  without altering speech dynamics or reintroducing tail-collapse. Validated 2026-06-20. */
const PEAK_LIMITER = 'acompressor=threshold=-3dB:ratio=20:attack=1:release=60'

/** The first-pass measurements loudnorm prints as JSON (the fields pass 2 feeds back). */
interface LoudnormStats {
  input_i: string
  input_tp: string
  input_lra: string
  input_thresh: string
  target_offset: string
}

/** The shared filter spec — same target both passes; pass 1 adds print_format=json. */
function loudnormFilter(measured?: LoudnormStats): string {
  const base = `loudnorm=I=${LOUDNORM_TARGET_LUFS}:TP=${LOUDNORM_TRUE_PEAK_DB}:LRA=${LOUDNORM_RANGE_LU}`
  if (!measured) return `${base}:print_format=json`
  return (
    `${base}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}` +
    `:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}` +
    `:offset=${measured.target_offset}:linear=true:print_format=summary`
  )
}

/** The full `-af` chain for a leveled pass: PEAK_LIMITER, then loudnorm. Same limiter both passes
 *  (pass 1 measures the limited signal; pass 2 applies the gain to it). Exported for tests. */
export function masteringFilter(measured?: LoudnormStats): string {
  return `${PEAK_LIMITER},${loudnormFilter(measured)}`
}

/** Pull loudnorm's JSON block out of ffmpeg stderr. It's the only JSON ffmpeg emits, so a
 *  greedy brace match is safe. Returns null if absent/unparseable. Exported for tests. */
export function parseLoudnormStats(ffmpegStderr: string): LoudnormStats | null {
  const m = /\{[\s\S]*\}/.exec(ffmpegStderr)
  if (!m) return null
  try {
    const j = JSON.parse(m[0]) as Partial<LoudnormStats>
    if (
      j.input_i == null ||
      j.input_tp == null ||
      j.input_lra == null ||
      j.input_thresh == null ||
      j.target_offset == null
    )
      return null
    return j as LoudnormStats
  } catch {
    return null
  }
}

// Warn ONCE per process when the loudnorm ANALYSIS can't be parsed (clips still encode, just
// un-leveled) — a full run masters dozens of clips and a per-clip warning would drown the log.
let warnedNoStats = false
const warnNoStatsOnce = (reason: string): void => {
  if (warnedNoStats) return
  warnedNoStats = true
  console.warn(`  loudnorm analysis skipped (${reason}) — clips encode to AAC un-leveled this run.`)
}

/** Pass 1: measure. Reads the clip, runs loudnorm in analysis mode, returns the stats JSON
 *  (null when ffmpeg is absent, a pass fails, or the JSON can't be parsed). */
async function measure(file: string): Promise<LoudnormStats | null> {
  try {
    const proc = Bun.spawn(
      ['ffmpeg', '-hide_banner', '-nostats', '-i', file, '-af', masteringFilter(), '-f', 'null', '-'],
      { stdout: 'ignore', stderr: 'pipe' },
    )
    const stderr = await new Response(proc.stderr).text()
    if ((await proc.exited) !== 0) return null
    return parseLoudnormStats(stderr)
  } catch {
    return null // ffmpeg absent — the mandatory encode below will throw the clear error
  }
}

/** Pass 2: encode to AAC@48k .m4a, applying the measured linear loudnorm gain when available
 *  (un-leveled encode when `stats` is null). Returns false on any ffmpeg failure/absence. */
async function encode(file: string, out: string, stats: LoudnormStats | null): Promise<boolean> {
  try {
    const proc = Bun.spawn(
      [
        'ffmpeg', '-hide_banner', '-nostats', '-y', '-i', file,
        ...(stats ? ['-af', masteringFilter(stats)] : []),
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
 * Master one shipped take (lossless WAV) to the final AAC `.m4a` clip: a two-pass linear
 * loudnorm to LOUDNORM_TARGET_LUFS fused with the single AAC encode. Returns the .m4a bytes;
 * the caller keeps the take's EXACT PCM duration (a linear gain + AAC encode preserve content
 * length, and the .m4a edit list skips encoder priming, so perceived duration matches).
 *
 * THROWS if ffmpeg can't produce the clip (absent or failed encode) — ffmpeg is the encoder on
 * this path, not optional QA. Only the LEVELING degrades: if pass-1 stats can't be parsed we
 * still encode, just un-leveled (warned once).
 */
export async function normalizeAndEncode(audio: Uint8Array): Promise<Uint8Array> {
  const id = crypto.randomUUID()
  const inFile = join(tmpdir(), `skipper-master-in-${id}.wav`)
  const outFile = join(tmpdir(), `skipper-master-out-${id}.m4a`)
  try {
    await writeFile(inFile, audio)
    const stats = await measure(inFile)
    if (!stats) warnNoStatsOnce('ffmpeg analysis failed or produced no loudnorm JSON')
    if (!(await encode(inFile, outFile, stats))) {
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
