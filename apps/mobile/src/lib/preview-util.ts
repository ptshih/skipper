// The pure decisions shared by the two one-clip PREVIEW players (`useStopPreview`, `useRoutePreview`).
//
// Native-free (no react, no expo-audio, no ./api) so it runs under `bun test` — the same split as
// connectivity-util.ts / gps-util.ts / offline-util.ts. Its whole reason for existing is the one
// `@skipper/engine`'s player.ts states for the in-car players: two hooks running the same rules
// inline WILL desync, and the hooks themselves are the one part of this app `bun test` cannot reach
// (they import expo-audio). So the RULES live here where they can be tested and cannot fork; each
// hook keeps its own refs, effects and side effects.
//
// ⚠ THIS IS NOT SPECULATIVE FACTORING — the fork already happened. As of 2026-08-02 the two siblings
// had drifted on every rule below: `useRoutePreview` released the audio session when a clip failed
// and when it ran out, `useStopPreview` did neither; one cleared its active-id ref guarded and the
// other did not. Same shape, three different answers.
//
// ⚠ Deliberately NOT in `@skipper/engine`: that package is shared with the drive simulator and the
// in-car player, and these are preview-only rules. engine/player.ts owns what BOTH real players
// share; this owns what the two PREVIEW surfaces share. Different questions, different homes.

/** How close to the duration counts as "already ended".
 *
 *  expo-audio parks a finished player AT the end, so a bare `playing ? pause : play` resumes nothing —
 *  a second tap on a finished clip must seek to 0 first. `didJustFinish` alone is not enough to detect
 *  that: it is a one-shot edge that expo-audio can DROP across an OS interruption (a phone call over
 *  the last seconds), which is why both hooks also compare the clock against the duration.
 *
 *  ⚠ NOT the same number as engine/player.ts's `CLIP_END_GRACE_SEC` (0.6) and must not be "unified"
 *  with it. That one decides whether a STALLED in-car clip should be completed rather than resumed —
 *  a recovery question, on a clip nobody is looking at. This one decides what a rider's TAP means on a
 *  clip they are watching, where a wrong answer is visible immediately. Same units, different jobs. */
export const PREVIEW_END_EPS_SEC = 0.25

/** The playback facts a decision needs — the subset of expo-audio's status, in plain units. */
export interface PreviewPlayback {
  playing: boolean
  /** Seconds. expo-audio reports `currentTime`; pass 0 when it is null. */
  positionSec: number
  /** Seconds; 0 when unknown (the clip has not loaded far enough to report one). */
  durationSec: number
  didJustFinish: boolean
}

/** What a tap on the ALREADY-LOADED clip means. */
export type ToggleAction =
  /** It is playing — pause it. */
  | 'pause'
  /** It finished — seek to 0, then play. */
  | 'replay'
  /** It is paused mid-clip — play from where it sits. */
  | 'resume'

/** Decide what a toggle tap does. Was duplicated inline in three places (`useStopPreview.play`,
 *  `useStopPreview.togglePlay`, `useRoutePreview.toggle`), each with its own copy of the epsilon. */
export function decideToggle(p: PreviewPlayback): ToggleAction {
  if (p.playing) return 'pause'
  const atEnd = p.didJustFinish || (p.durationSec > 0 && p.positionSec >= p.durationSec - PREVIEW_END_EPS_SEC)
  return atEnd ? 'replay' : 'resume'
}

/** True once a clip has produced real audio — the signal that disarms a pre-start watchdog.
 *  Mirrors `useDrive`'s `sawFresh`: a player can report `playing` for a frame or two before any sound
 *  exists, so position must have moved too. */
export function sawFreshAudio(p: Pick<PreviewPlayback, 'playing' | 'positionSec'>): boolean {
  return p.playing && p.positionSec > PREVIEW_END_EPS_SEC
}

/** What a failure must do to the hook's state. */
export interface FailAction {
  /** Clear the active-clip id (and its mirroring ref). False when a newer tap already owns the player. */
  clearActive: boolean
  /** Call `setIsAudioActiveAsync(false)`.
   *
   *  ⚠ THE OBLIGATION THAT WAS MISSED, TWICE. Under `doNotMix` a clip that merely ATTEMPTED to play has
   *  already interrupted the rider's own music, and iOS resumes theirs only when the session is
   *  DEACTIVATED — pausing is not enough. So a clip that fails after `play()` was called must hand the
   *  session back, or the rider is left in silence with no control on screen that fixes it. */
  releaseSession: boolean
  /** Show the rider-facing "couldn't play this one" hint for this id. Always true — a failure the
   *  rider cannot see is the hang this module exists to prevent. */
  markFailed: true
}

/** Decide the terminal state for a clip that could not play, for ANY reason: a synchronous throw out
 *  of `replace()`, an asynchronous `status.error`, a pre-start watchdog expiring, or audio that could
 *  not be resolved at all.
 *
 *  `playbackAttempted` is what separates "we never called play(), so we hold no session" (an unresolved
 *  uri — the clip was only ever an optimistic highlight) from "we called play() and it failed". Releasing
 *  a session we never took is a no-op on iOS, but it is ALSO process-wide, so getting it wrong could
 *  deactivate a session another surface owns. Ask rather than assume. */
export function decideFail<Id>(args: {
  /** The id the player currently owns (the ref, not the render-time state). */
  activeId: Id | null
  /** The id that failed. */
  failingId: Id
  /** Was `play()` actually called for `failingId`? */
  playbackAttempted: boolean
}): FailAction {
  const owns = args.activeId === args.failingId
  return {
    clearActive: owns,
    releaseSession: owns && args.playbackAttempted,
    markFailed: true,
  }
}
