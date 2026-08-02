// Player decision helpers — the pure, testable bits of the in-car clip player the drive hook
// (useDrive) needs — extracted when a second hook needed it identically. Each hook keeps its own refs,
// effects, and side-effects; this module owns only the safety-critical DECISIONS + the magic
// thresholds, so the two players can't silently desync the logic — and it gets unit coverage the
// stateful hooks can't give it. (The hook-level extraction was declined because the surrounding
// state lifecycles legitimately differ; the DECISIONS do not.)

/** A clip that never produces audio AT ALL within this window is dead — an expired presign (403), a
 *  decode failure, or a dead-zone stream that buffers forever. Generous on purpose: the clips are 64k
 *  AAC-LC over ~1h presigned URLs, and the callers' shared asymmetry is that a false "unavailable" is
 *  a lie printed over audio that would have played, while a late verdict costs only a few seconds of
 *  waiting. ⚠ Every surface that plays a presigned clip needs this, because expo-audio surfacing
 *  `status.error` for an HTTP 403 on a remote source is DEVICE-UNVERIFIED — without a timer, a
 *  surface that trusts `status.error` alone shows nothing at all when it doesn't fire. */
export const PRE_START_STALL_MS = 12_000
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

/** What the fire-queue pump should do this tick. */
export type PumpAction =
  /** A clip is playing. Do nothing — the drive is strictly sequential and clips never overlap. */
  | { kind: 'wait' }
  /** Dequeue the head and play it. */
  | { kind: 'play'; seq: number }
  /** The road is done AND nothing is queued — end the drive. */
  | { kind: 'finish' }
  /** Nothing queued, road not finished — wait for the next GPS trigger. */
  | { kind: 'idle' }

/** Decide the pump action. Pure; the CALLER dequeues when the action is 'play'.
 *
 *  This is the heart of the in-car player and the ORDER OF THE CHECKS IS THE WHOLE THING — each one
 *  is a rule that is invisible once it works and expensive when it breaks:
 *
 *  1. **Busy beats everything.** Two clips talking over each other is the single worst failure this
 *     player can produce, and it is not self-correcting: the rider cannot pause their way out of it.
 *  2. **A queued stop beats finishing.** Ending the drive while audio is still pending silently
 *     swallows a stop the rider drove past and paid a credit for. The road reaching its end is NOT
 *     permission to stop talking — only a drained queue is.
 *  3. **Finishing requires BOTH** a drained queue and a finished road. Either alone is a mid-drive
 *     silence, not an ending.
 *
 *  ⚠ `queue` is read, never mutated — a pure function that shifted its input would work exactly once
 *  under test and diverge the moment anything called it twice. */
export function decidePump(s: {
  /** Is a clip currently loaded and playing? */
  clipBusy: boolean
  /** Fired seqs waiting to play, FIFO — head first. */
  queue: readonly number[]
  /** Has the route's end been reached? */
  reachedEnd: boolean
}): PumpAction {
  if (s.clipBusy) return { kind: 'wait' }
  const next = s.queue[0]
  if (next !== undefined) return { kind: 'play', seq: next }
  return s.reachedEnd ? { kind: 'finish' } : { kind: 'idle' }
}

/** Clamp a seek (ms) to [0, durationSec], returned in seconds. */
export function clampSeekSec(ms: number, durationSec: number): number {
  return Math.min(durationSec, Math.max(0, ms / 1000))
}

/** Has the clock landed on the committed seek target (within the drop epsilon)? */
export function seekTargetReached(currentTime: number, target: number): boolean {
  return Math.abs(currentTime - target) < SEEK_REACHED_EPS_SEC
}
