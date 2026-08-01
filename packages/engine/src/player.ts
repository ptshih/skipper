// Player decision helpers — the pure, testable bits of the in-car clip player that the tour
// (useDrive) needs — extracted when a second hook needed it identically. Each hook keeps its own refs,
// effects, and side-effects; this module owns only the safety-critical DECISIONS + the magic
// thresholds, so the two players can't silently desync the logic — and it gets unit coverage the
// stateful hooks can't give it. (The hook-level extraction was declined because the surrounding
// state lifecycles legitimately differ; the DECISIONS do not.)

/** No playback progress for this long AFTER a clip started (sawFresh) ⇒ an OS interruption (call /
 *  Siri / Bluetooth handoff) or a mid-clip buffer death — expo-audio fires no didJustFinish, so the
 *  player must recover or the rest of the drive/session goes silent. (audit #1) */
export const POST_START_STALL_MS = 6_000
/** Within this much of the duration, a frozen clock is "effectively finished" (didJustFinish never
 *  fired) rather than stalled — complete the clip instead of trying to resume one that already ended. */
export const CLIP_END_GRACE_SEC = 0.6
/** The committed seek target is "reached" once the clock lands within this of it — then the target is
 *  dropped so a later ±15 re-bases on the real position instead of a stale committed one. */
export const SEEK_REACHED_EPS_SEC = 0.4

/** What the post-start stall watchdog should DO this tick. The caller owns the ACTIONS (which
 *  finished-ref to set, whether to surface a stall note, calling onClipDone) — this owns the BRANCH.
 *  NOTE the asymmetry the callers rely on: `completeAtEnd` marks the clip finished; `giveUp` (a
 *  failed resume) completes WITHOUT marking it finished. */
export type StallVerdict = 'wait' | 'completeAtEnd' | 'resume' | 'giveUp'

/** Decide the post-start stall action from the current playback state. Pure. Mirrors the ladder both
 *  hooks ran inline: still progressing → wait; effectively at the end → completeAtEnd; not yet
 *  resumed → resume once; resume didn't take → giveUp. */
export function decideStall(s: {
  /** Date.now() at the tick. */
  now: number
  /** ms of the last forward progress on the loaded clip. */
  lastProgressAt: number
  /** last observed currentTime (sec). */
  lastProgressTime: number
  /** last observed clip duration (sec); 0 when unknown. */
  duration: number
  /** has a resume already been attempted for the current stall. */
  resumeTried: boolean
}): StallVerdict {
  if (s.now - s.lastProgressAt < POST_START_STALL_MS) return 'wait'
  if (s.duration > 0 && s.lastProgressTime >= s.duration - CLIP_END_GRACE_SEC) return 'completeAtEnd'
  return s.resumeTried ? 'giveUp' : 'resume'
}

/** Clamp a seek (ms) to [0, durationSec], returned in seconds. */
export function clampSeekSec(ms: number, durationSec: number): number {
  return Math.min(durationSec, Math.max(0, ms / 1000))
}

/** Has the clock landed on the committed seek target (within the drop epsilon)? */
export function seekTargetReached(currentTime: number, target: number): boolean {
  return Math.abs(currentTime - target) < SEEK_REACHED_EPS_SEC
}
