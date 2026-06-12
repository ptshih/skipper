// Loudness normalization — the guard against Gemini-TTS's take-variance in LEVEL.
//
// Measured 2026-06-10 over all 30 live clips (founder-ear-confirmed): takes are
// non-deterministic in LOUDNESS — body means ranged −26.7 → −19.5 dB (a 7.2 dB
// stop-to-stop jump), and the whole mix read ~20–25% quiet vs a Spotify reference.
// So every SHIPPED take runs through an ffmpeg two-pass LINEAR loudnorm to the
// EBU R128 target in models.ts (−14 LUFS integrated, −1.5 dBTP ceiling):
//   pass 1 MEASURES the take's integrated loudness / true-peak / range,
//   pass 2 applies a single LINEAR gain (linear=true) to hit the target exactly.
// Linear (not dynamic) is the point: it scales the whole clip uniformly, so every clip
// lands at the same integrated level (killing the spread) WITHOUT touching the speech
// dynamics — and because it scales tail and body equally, it can never reintroduce the
// tail-collapse the retake just fixed. The −1.5 dBTP ceiling is why this isn't a flat
// `volume=+NdB`: bringing a −26 dB clip up to −14 could clip without true-peak limiting.
//
// ffmpeg is OPTIONAL tooling (same contract as pipeline/tail.ts): when it's absent,
// errors, or its JSON can't be parsed, this returns null and the caller ships the
// UN-normalized take — synthesis must never fail because a QA tool couldn't run. (The
// Cloud Run image DOES carry ffmpeg — packages/generator/Dockerfile — so unattended
// admin-triggered generations normalize; a bare local box without it degrades to today.)

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { LOUDNORM_RANGE_LU, LOUDNORM_TARGET_LUFS, LOUDNORM_TRUE_PEAK_DB } from '../models'
import { mp3DurationMs } from './mp3'

/** The shipped clip after normalization — same shape as tts.ts's SynthResult. */
export interface NormalizedClip {
  audio: Uint8Array
  durationMs: number
}

/** Output MP3 bitrate (kbps) — matches Gemini-TTS's fixed 32k so the re-encode is level-only. */
const MP3_BITRATE = '32k'
/** Output sample rate — pinned to the TTS native 24 kHz (loudnorm runs at 192 kHz internally,
 *  so without this the muxed MP3 would inherit 192 kHz). */
const OUT_SAMPLE_RATE = '24000'

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

// Warn ONCE per process when ffmpeg is unavailable — a full run normalizes dozens of clips
// and a per-clip warning would drown the log for a known, accepted degradation.
let warnedUnavailable = false
const warnUnavailableOnce = (reason: string): void => {
  if (warnedUnavailable) return
  warnedUnavailable = true
  console.warn(`  loudness normalize skipped (${reason}) — takes ship un-normalized this run.`)
}

/** Pass 1: measure. Reads the clip, runs loudnorm in analysis mode, returns the stats JSON. */
async function measure(file: string): Promise<LoudnormStats | null> {
  const proc = Bun.spawn(
    ['ffmpeg', '-hide_banner', '-nostats', '-i', file, '-af', loudnormFilter(), '-f', 'null', '-'],
    { stdout: 'ignore', stderr: 'pipe' },
  )
  const stderr = await new Response(proc.stderr).text()
  if ((await proc.exited) !== 0) return null
  return parseLoudnormStats(stderr)
}

/** Pass 2: apply the measured linear gain and re-encode to a 32k MP3 at `out`. */
async function apply(file: string, out: string, stats: LoudnormStats): Promise<boolean> {
  const proc = Bun.spawn(
    [
      'ffmpeg', '-hide_banner', '-nostats', '-y', '-i', file,
      '-af', loudnormFilter(stats),
      '-ar', OUT_SAMPLE_RATE, '-ac', '1', '-c:a', 'libmp3lame', '-b:a', MP3_BITRATE,
      out,
    ],
    { stdout: 'ignore', stderr: 'pipe' },
  )
  await new Response(proc.stderr).text()
  return (await proc.exited) === 0
}

/**
 * Normalize one shipped clip to LOUDNORM_TARGET_LUFS via a two-pass linear loudnorm.
 * Returns the normalized MP3 + its recomputed exact duration, or null (probe skipped,
 * never a throw) when ffmpeg is absent, a pass fails, or the stats can't be parsed —
 * in which case the caller ships the un-normalized take.
 */
export async function normalizeLoudness(audio: Uint8Array): Promise<NormalizedClip | null> {
  const id = crypto.randomUUID()
  const inFile = join(tmpdir(), `skipper-ln-in-${id}.mp3`)
  const outFile = join(tmpdir(), `skipper-ln-out-${id}.mp3`)
  try {
    await writeFile(inFile, audio)
    const stats = await measure(inFile)
    if (!stats) {
      warnUnavailableOnce('ffmpeg analysis failed or produced no loudnorm JSON')
      return null
    }
    if (!(await apply(inFile, outFile, stats))) {
      warnUnavailableOnce('ffmpeg normalize/encode pass failed')
      return null
    }
    const out = new Uint8Array(await readFile(outFile))
    const durationMs = mp3DurationMs(out)
    // A re-encode that lost the frames (0 duration) is worse than the original — ship the
    // original rather than a broken clip.
    if (!out.length || durationMs <= 0) {
      warnUnavailableOnce('normalized output was empty or unparseable')
      return null
    }
    return { audio: out, durationMs }
  } catch (e) {
    warnUnavailableOnce(`ffmpeg unavailable: ${(e as Error).message}`)
    return null
  } finally {
    await unlink(inFile).catch(() => {})
    await unlink(outFile).catch(() => {})
  }
}
