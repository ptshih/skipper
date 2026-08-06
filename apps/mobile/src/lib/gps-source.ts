// The GPS fix SOURCES, and the seam every drive is driven through — pure and native-free, so
// `bun test` can reach all of it. The one native source (`liveSource`, the expo-location watch) stays
// in gps.ts, which re-exports this file so call sites import from one place.
//
// ⚠ Why this file exists at all: `simulatedSource` used to sit in gps.ts next to `import * as Location
// from 'expo-location'`, which made it structurally untestable — importing the simulator pulled the
// native module. Splitting it out is what lets a desk drive be a TEST rather than a sitting.
// See docs/designs/desk-drive-harness.md.
import { generateDrive, type GpsFix, type LngLat } from '@skipper/engine'
import { createFixMapper, type RawFix } from './gps-util'

/**
 * A controller for an active fix stream. `stop()` ends it for good; `pause()`/`resume()`
 * suspend and continue emission (the simulator can freeze the road so you can inspect a
 * stop — a real GPS source maps these to stopping/restarting the watch, or no-ops them).
 */
export interface FixSubscription {
  stop: () => void
  pause: () => void
  resume: () => void
}

/**
 * Subscribe to a stream of GPS fixes.
 * - `onEnd` fires when the route is done — a finite source (the sim, a replay) running out of fixes,
 *   or the live source's position reaching the final vertex. It queues the outro + finishes the drive.
 * - `onError` fires when the source fails to produce fixes at all (e.g. the live watch can't acquire);
 *   the consumer surfaces it instead of hanging silently.
 */
export type GpsFixSource = (
  onFix: (fix: GpsFix) => void,
  onEnd?: () => void,
  onError?: (err: unknown) => void,
) => FixSubscription

/**
 * A shared timer pump: walk `items`, emit one per `dtMs`, honouring stop/pause/resume.
 *
 * ⚠ `dtMs` MAY BE A FUNCTION, re-read before every tick rather than captured once. That is what lets
 * the simulator change its own replay rate mid-drive (see `SimSourceOptions.timeScale`); a captured
 * number cannot, because the pump schedules the next tick from inside the previous one.
 */
function pumpSubscription<T>(
  items: T[],
  dtMs: number | (() => number),
  emit: (item: T) => void,
  onDone?: () => void,
): FixSubscription {
  let i = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let halted = false
  const delay = typeof dtMs === 'function' ? dtMs : () => dtMs

  const tick = () => {
    timer = null
    if (halted) return
    if (i >= items.length) {
      onDone?.()
      return
    }
    emit(items[i]!)
    i++
    // ⚠ Read AFTER emitting: `emit` is what advances the drive, so a rate that depends on drive state
    // (audio playing / not) must be sampled once that state reflects the fix just delivered.
    timer = setTimeout(tick, delay())
  }
  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }
  // Kick off on the next tick so the subscriber's first render settles first.
  timer = setTimeout(tick, 0)

  return {
    stop: () => {
      halted = true
      clear()
    },
    pause: () => {
      halted = true
      clear()
    },
    resume: () => {
      if (halted) {
        halted = false
        if (timer === null) timer = setTimeout(tick, delay())
      }
    },
  }
}

export interface SimSourceOptions {
  /** Constant drive speed (mph), passed to `generateDrive`. Default 60. */
  mph?: number
  /** Fix rate (Hz), passed to `generateDrive` — real GPS at BestForNavigation is ~1–4 Hz. Default 4. */
  tickHz?: number
  /**
   * Wall-clock compression for couch testing. 1 = real time (fixes spaced 1/tickHz s, so a
   * 30-min drive takes 30 min); 8 = 8× faster (same fix DATA, emitted 8× sooner) so you can
   * watch a whole drive trigger in a few minutes. Does NOT change speeds the trigger sees —
   * each GpsFix still reports its real `speedMps`/`tSec`; only the delivery cadence compresses.
   *
   * ⚠ **A FUNCTION MAKES IT ADAPTIVE, and that is the fix for the backlog compression causes.** The
   * road compresses; the AUDIO cannot — a clip is a fixed number of real seconds. So at a constant 8×
   * every clip takes 8× as much *drive* to finish as it would in the car, the fire-queue backs up a
   * stop at a time, and narration drifts arbitrarily far behind the map. It is not a rounding error:
   * break-even is (gap between stops ÷ clip length), which on a measured Tahoe drive is ≈2.8×, so ANY
   * meaningful fast-forward diverges. (Lowering the constant only slows the divergence.)
   *
   * Passing `() => playing ? 1 : 8` compresses only the QUIET road and runs true-time whenever the
   * skipper is speaking. Every clip then finishes in its real geographic position, and — the property
   * that matters — a GENUINE overlap still shows up, because time is never compressed while audio is
   * playing. Measured coverage on that drive was 35%, so the saving is most of what 8× ever offered.
   */
  timeScale?: number | (() => number)
}

/**
 * The synthetic `GpsFixSource`: a constant-speed walk along the polyline, replayed on a timer.
 *
 * ⚠ **It emits FINISHED `GpsFix` objects, so it bypasses the live mapping pipeline entirely** — no
 * accuracy gate, no -1 sentinels, no projection cursor, no end predicate; `alongM` comes from the
 * generator rather than being recovered. Its fixes are perfect, exactly on the polyline. That makes it
 * the right tool for exercising the TRIGGER ENGINE and everything downstream (audio, queue, UI), and
 * the WRONG tool for anything about GPS error. Use `replaySource` when you want the real path.
 */
export function simulatedSource(polyline: LngLat[], opts: SimSourceOptions = {}): GpsFixSource {
  const { mph = 60, tickHz = 4, timeScale = 1 } = opts
  return (onFix, onEnd, onError) => {
    let fixes: GpsFix[]
    try {
      fixes = generateDrive(polyline, { mph, tickHz })
    } catch (e) {
      // generateDrive throws synchronously on a bad polyline — route it to the same 'error' phase the
      // live source uses (onError) instead of an uncaught throw to beginDrive's caller. (audit #942)
      onError?.(e)
      return { stop: () => {}, pause: () => {}, resume: () => {} }
    }
    // Real spacing between fixes is 1/tickHz seconds; compress by timeScale for testing. Resolved per
    // tick rather than once, so an adaptive scale (see the option's ⚠) can change it mid-drive.
    const scaleAt = typeof timeScale === 'function' ? timeScale : () => timeScale
    const dtAt = () => Math.max(1, 1000 / tickHz / Math.max(0.0001, scaleAt()))
    return pumpSubscription(fixes, dtAt, onFix, onEnd)
  }
}

export interface ReplaySourceOptions {
  /**
   * Wall-clock compression, as `simulatedSource`. The trace's own inter-fix timing is what sets the
   * base cadence; this divides it. `0` or negative is clamped away rather than dividing by zero.
   */
  timeScale?: number
  /** Fired for each raw fix the accuracy gate REJECTED — the count no other surface can see. */
  onRejected?: (raw: RawFix) => void
}

/**
 * The replay `GpsFixSource`: feeds recorded or synthesised `RawFix`es through **the same
 * `createFixMapper` the live watch uses**. This is the one that makes a desk drive honest — it runs
 * the accuracy gate, the iOS -1 sentinel handling, the monotonic projection and the end predicate, on
 * inputs you control completely.
 *
 * ⚠ The mapper's `onEnd` fires from the END PREDICATE (position reached the final vertex), exactly as
 * on a real drive. A trace that stops short therefore never completes the drive — which is correct and
 * is itself worth testing, so the stream running dry does NOT synthesise an end. That asymmetry with
 * `simulatedSource` (a finite generator whose exhaustion IS the end) is deliberate: the live path has
 * no such thing as "the fixes ran out", it just stops hearing from the radio.
 */
export function replaySource(
  polyline: LngLat[],
  trace: RawFix[],
  opts: ReplaySourceOptions = {},
): GpsFixSource {
  const scale = Math.max(0.0001, opts.timeScale ?? 1)
  return (onFix, onEnd) => {
    const accept = createFixMapper(polyline, { onFix, onEnd })
    // Median inter-fix gap, so one wild timestamp in a recorded trace can't set the whole cadence.
    const gaps: number[] = []
    for (let i = 1; i < trace.length; i++) {
      const dt = trace[i]!.timestamp - trace[i - 1]!.timestamp
      if (Number.isFinite(dt) && dt > 0) gaps.push(dt)
    }
    gaps.sort((a, b) => a - b)
    const medianGapMs = gaps.length ? gaps[Math.floor(gaps.length / 2)]! : 1000
    const dtMs = Math.max(1, medianGapMs / scale)
    return pumpSubscription(trace, dtMs, (raw) => {
      if (!accept(raw)) opts.onRejected?.(raw)
    })
  }
}

/**
 * Drive a trace through the mapper as fast as the CPU allows, with no timers — the headless form,
 * for `bun test` and the parameter sweep. Returns what the pipeline made of it.
 *
 * This is the function that turns "a 40-minute sitting" into "a few milliseconds", which is the whole
 * economic argument of the harness: a desk drive that costs nothing gets run on every change.
 */
export function replayHeadless(
  polyline: LngLat[],
  trace: RawFix[],
): { fixes: GpsFix[]; rejected: number; ended: boolean } {
  const fixes: GpsFix[] = []
  let ended = false
  let rejected = 0
  const accept = createFixMapper(polyline, {
    onFix: (f) => fixes.push(f),
    onEnd: () => {
      ended = true
    },
  })
  for (const raw of trace) if (!accept(raw)) rejected++
  return { fixes, rejected, ended }
}
