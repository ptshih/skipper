// Tail-collapse detection — the guard against Gemini-TTS's take-variance "mumble".
//
// Measured 2026-06-10 over all 30 live clips (founder-ear-confirmed): takes are
// non-deterministic in LEVEL, and some collapse over the final sentence(s) — the worst
// (Lake Tahoe Dam) ended its closing words near-silent, −22.5 dB below the body. Fresh
// takes of the same scripts come out clean → TAKE variance, not the voice and not the
// style prompt. So the TTS phase measures every take's tail (last 12 s) against its
// body (everything before) with a read-only ffmpeg `volumedetect` pass — no re-encode,
// the synthesized MP3 bytes ship untouched — and a drop ≥ 3 dB earns ONE re-synth,
// keeping the better take (the retake loop lives in pipeline/tts.ts).
//
// ffmpeg is OPTIONAL tooling: when it's absent, errors, or the clip is too short to
// have a meaningful body, the probe returns null and the take ships unmeasured —
// synthesis must never fail because a QA probe couldn't run.

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unlink, writeFile } from 'node:fs/promises'

/** The tail window (s) — long enough to span a collapsed closing sentence or two. */
export const TAIL_WINDOW_SEC = 12
/** Tail-vs-body mean-volume drop (dB) that marks a take collapsed (the measured 8/30 line). */
export const TAIL_COLLAPSE_DB = 3
/** Below this duration there's no body meaningfully longer than the tail — skip the probe
 *  (15 s break clips skip; ~60 s roam encounters and ~2 min story stops measure). */
export const MIN_MEASURABLE_SEC = TAIL_WINDOW_SEC * 2

export interface TailMeasure {
  /** Mean volume (dB) of everything before the tail window. */
  bodyDb: number
  /** Mean volume (dB) of the final TAIL_WINDOW_SEC. */
  tailDb: number
  /** body − tail: positive = the tail is QUIETER than the body. */
  dropDb: number
}

/** Pull `mean_volume: -23.4 dB` out of ffmpeg's volumedetect stderr. Exported for tests. */
export function parseMeanVolumeDb(ffmpegStderr: string): number | null {
  const m = /mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/.exec(ffmpegStderr)
  return m ? Number(m[1]) : null
}

/** Which take ships after a retake: the smaller measured drop wins; an UNMEASURABLE retake
 *  wins over the known-collapsed first take (fresh takes of a collapsed script come out
 *  clean on the measured odds — better an unknown than a known mumble). Exported for tests. */
export function keepFirstTake(first: TailMeasure, retake: TailMeasure | null): boolean {
  return retake !== null && first.dropDb <= retake.dropDb
}

// Warn ONCE per process when ffmpeg is unavailable — a full run synthesizes dozens of
// clips and a per-clip warning would drown the log for a known, accepted degradation.
let warnedUnavailable = false
const warnUnavailableOnce = (reason: string): void => {
  if (warnedUnavailable) return
  warnedUnavailable = true
  console.warn(`  tail check skipped (${reason}) — takes ship unmeasured this run.`)
}

/** One volumedetect pass over a slice of the file; null on any failure. */
async function meanVolumeDb(file: string, sliceArgs: string[]): Promise<number | null> {
  // -f null - decodes (read-only) without writing; volumedetect reports on stderr.
  const proc = Bun.spawn(
    ['ffmpeg', '-hide_banner', '-nostats', ...sliceArgs, '-i', file, '-af', 'volumedetect', '-f', 'null', '-'],
    { stdout: 'ignore', stderr: 'pipe' },
  )
  const stderr = await new Response(proc.stderr).text()
  if ((await proc.exited) !== 0) return null
  return parseMeanVolumeDb(stderr)
}

/**
 * Measure a clip's tail-vs-body mean volume. Returns null (probe skipped, never a throw)
 * when the clip is too short, ffmpeg is absent, or a pass fails/can't be parsed.
 */
export async function measureTailCollapse(
  audio: Uint8Array,
  durationMs: number,
): Promise<TailMeasure | null> {
  const durationSec = durationMs / 1000
  if (durationSec < MIN_MEASURABLE_SEC) return null
  // volumedetect can't read a pipe slice-by-slice, so the bytes land in a temp file for
  // the two passes (body via -t, tail via -sseof) and are removed in finally.
  const file = join(tmpdir(), `skipper-tail-${crypto.randomUUID()}.mp3`)
  try {
    await writeFile(file, audio)
    const bodySec = durationSec - TAIL_WINDOW_SEC
    const [bodyDb, tailDb] = await Promise.all([
      meanVolumeDb(file, ['-t', bodySec.toFixed(2)]),
      meanVolumeDb(file, ['-sseof', `-${TAIL_WINDOW_SEC}`]),
    ])
    if (bodyDb === null || tailDb === null) {
      warnUnavailableOnce('ffmpeg pass failed or produced no mean_volume')
      return null
    }
    return { bodyDb, tailDb, dropDb: bodyDb - tailDb }
  } catch (e) {
    warnUnavailableOnce(`ffmpeg unavailable: ${(e as Error).message}`)
    return null
  } finally {
    await unlink(file).catch(() => {})
  }
}
