// Tail-collapse detection — the guard against Gemini-TTS's take-variance "mumble".
//
// Measured 2026-06-10 over all 30 live clips (founder-ear-confirmed): takes are
// non-deterministic in LEVEL, and some collapse over the final sentence(s) — the worst
// (Lake Tahoe Dam) ended its closing words near-silent, −22.5 dB below the body. Fresh
// takes of the same scripts come out clean → TAKE variance, not the voice and not the
// style prompt. So the TTS phase measures every take's tail (last 12 s) against its
// body (everything before) with a read-only ffmpeg `volumedetect` pass — no re-encode here,
// the take's lossless WAV bytes pass through to the master/encode step untouched — and a
// drop ≥ 3 dB earns ONE re-synth, keeping the better take (the retake loop lives in tts.ts).
//
// ffmpeg is OPTIONAL for THIS probe: when it's absent, errors, or the clip is too short to
// have a meaningful body, the probe returns null and the take ships unmeasured — a QA probe
// must never fail synthesis. (The downstream AAC encode in loudnorm.ts DOES require ffmpeg,
// so on a real ship path ffmpeg is present and this probe runs anyway.)

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unlink, writeFile } from 'node:fs/promises'

/** The tail window (s) — long enough to span a collapsed closing sentence or two. */
export const TAIL_WINDOW_SEC = 12
/** A SHORT terminal window (s) INSIDE the tail. `mean_volume` is RMS over the whole window, so a take that
 *  holds level across the 12 s tail but dies only over the final words averages out and slips the gate; a
 *  4 s window catches that "last-words mumble" (the documented residual West-Shore collapses). */
export const TERMINAL_WINDOW_SEC = 4
/** Tail-vs-body mean-volume drop (dB) that marks a take collapsed (the measured 8/30 line). */
export const TAIL_COLLAPSE_DB = 3
/** A SMALL "did the retake actually help" band (dB). The best-of-N retake exists to escape a STOCHASTIC
 *  collapse (a fresh take of the same script comes back clean — the original Dam-class finding). But a
 *  documented residual is STRUCTURAL: the script itself cues a soft landing (the Skipper's deadpan button),
 *  so every fresh take re-collapses at the SAME level and the extra synths are pure waste. When a retake
 *  re-collapses within this band of the prior best, treat it as structural and stop spending. */
export const STRUCTURAL_RETAKE_EPSILON_DB = 1.0
/** Below this duration there's no body meaningfully longer than the tail — skip the probe
 *  (15 s break clips skip; ~60 s roam encounters and ~2 min story stops measure). */
export const MIN_MEASURABLE_SEC = TAIL_WINDOW_SEC * 2

export interface TailMeasure {
  /** Mean volume (dB) of everything before the tail window. */
  bodyDb: number
  /** Mean volume (dB) of the final TAIL_WINDOW_SEC. */
  tailDb: number
  /** Mean volume (dB) of the final TERMINAL_WINDOW_SEC (the last-words window). */
  terminalDb: number
  /** Collapse severity (dB): body minus the QUIETER of the two tail windows. Positive = the tail (or just
   *  its final words) is quieter than the body. This is the value the gate + the best-of-N retake compare. */
  dropDb: number
}

/** Collapse severity = body minus the QUIETER of the two tail windows (the 12 s tail and the 4 s terminal),
 *  so a tail that dies only over the closing words is caught even when the 12 s RMS average hides it.
 *  Exported (pure) for tests. */
export function tailDropDb(bodyDb: number, tailDb: number, terminalDb: number): number {
  return Math.max(bodyDb - tailDb, bodyDb - terminalDb)
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

/** Should the best-of-N retake loop STOP early (the collapse is STRUCTURAL, not stochastic)? True when the
 *  latest fresh take is STILL collapsed AND landed at essentially the same level as the prior best (within
 *  STRUCTURAL_RETAKE_EPSILON_DB) — evidence the script cues the soft landing, so more takes can't escape it.
 *  False when the latest take comes back clean (below the gate → the loop's own condition exits) OR
 *  materially improves the best drop (worth another try) OR is just a high-variance worse take (allow a
 *  retry). Pure; tested. (Saves the final, futile synth on the documented structural West-Shore codas.) */
export function retakeStalled(prevBestDrop: number, latestDrop: number): boolean {
  return latestDrop >= TAIL_COLLAPSE_DB && Math.abs(latestDrop - prevBestDrop) <= STRUCTURAL_RETAKE_EPSILON_DB
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
  const file = join(tmpdir(), `skipper-tail-${crypto.randomUUID()}.wav`)
  try {
    await writeFile(file, audio)
    const bodySec = durationSec - TAIL_WINDOW_SEC
    const [bodyDb, tailDb, terminalDb] = await Promise.all([
      meanVolumeDb(file, ['-t', bodySec.toFixed(2)]),
      meanVolumeDb(file, ['-sseof', `-${TAIL_WINDOW_SEC}`]),
      meanVolumeDb(file, ['-sseof', `-${TERMINAL_WINDOW_SEC}`]),
    ])
    if (bodyDb === null || tailDb === null || terminalDb === null) {
      warnUnavailableOnce('ffmpeg pass failed or produced no mean_volume')
      return null
    }
    return { bodyDb, tailDb, terminalDb, dropDb: tailDropDb(bodyDb, tailDb, terminalDb) }
  } catch (e) {
    warnUnavailableOnce(`ffmpeg unavailable: ${(e as Error).message}`)
    return null
  } finally {
    await unlink(file).catch(() => {})
  }
}
