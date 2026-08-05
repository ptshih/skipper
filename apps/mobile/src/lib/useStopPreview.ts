// The DETAIL-PAGE mini-preview clock: tap a stop (a list row or a map pin) to hear THAT one narration
// clip, on the couch, before ever driving. It replaces the old full-screen "simulated drive" (the couch
// PREVIEW mode) — the founder's call is discrete stop-by-stop playback, not a compressed end-to-end run
// (docs/decisions/detail-page-mini-preview.md).
//
// One reused expo-audio player across every stop (mirrors sample.tsx's single-clip shell, extended for
// multi-stop). Audio is resolved through offline.loadPlayback's seq→uri map — NEVER `clip.url` directly:
// a downloaded drive nulls every presigned url on disk (offline.ts strips credentials), so a raw clip.url
// read is silently un-playable in exactly the dead-zone case the product is built for.
//
// ⚠ THE MAP IS LOCAL `file://` AND NOTHING ELSE (docs/designs/download-before-start.md §10 N1): this
// surface plays only what is already saved on this phone. A seq missing from the map is genuinely not
// here — an auto-download still running, a partial copy, or a drive the rider never saved — and there is
// nothing left to re-sign and nothing to stream, so resolveUri answers null and the row gets the
// unplayable hint. Turning "not yet" into a saving… row is the SCREEN's job; the hook only ever answers
// "have it" or "don't".
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import { LOCAL_CLIP_STALL_MS } from '@skipper/engine'
import { loadPlayback } from './offline'
import { applyExclusiveForegroundAudio, releaseAudioSession } from './audio-session'
import { useStartWatchdog } from './preview-audio'
import { decideFail, decideToggle, sawFreshAudio } from './preview-util'

export interface StopPreview {
  /** The stop whose clip is loaded (playing OR paused). Drives the row/pin "now playing" highlight. */
  activeSeq: number | null
  /** The last stop tapped whose audio isn't on this phone (not saved yet, or a partial copy) — for a
   *  soft hint. */
  unplayableSeq: number | null
  playing: boolean
  positionMs: number
  durationMs: number
  canSeek: boolean
  /** Tap a stop: switch+play a new one, or toggle/replay the active one. */
  play: (seq: number) => void
  togglePlay: () => void
  seekToMs: (ms: number) => void
  seekBy: (sec: number) => void
  /** Pause + clear the active stop — call on screen blur so this second player never talks ACROSS the
   *  live drive (the detail screen stays mounted beneath the pushed player). ⚠ More load-bearing since
   *  D35: both players now hold EXCLUSIVE focus, so a preview left running doesn't merely overlap the
   *  drive, it fights it for the audio session and the lock-screen transport. */
  stop: () => void
}

export function useStopPreview(driveId: string | undefined): StopPreview {
  const player = useAudioPlayer()
  const status = useAudioPlayerStatus(player)

  const [activeSeq, setActiveSeq] = useState<number | null>(null)
  const [unplayableSeq, setUnplayableSeq] = useState<number | null>(null)

  // Resolved seq→uri map, built lazily on the FIRST tap (no cost until the rider actually previews).
  const urlsRef = useRef<Map<number, string> | null>(null)
  // The seq currently loaded into the single reused player — the latest-tap-wins guard for the async
  // resolve below (a fast second tap must supersede a slow first one). (mirrors useDrive's loadedSeq)
  const activeSeqRef = useRef<number | null>(null)
  // The mirror IS the point (see above), and this ref is ALSO written imperatively by
  // play()/failSeq()/stop(); the async resolve compares against it to decide whether a newer tap
  // superseded it. An effect would put that check a paint behind.
  // eslint-disable-next-line react-hooks/refs
  activeSeqRef.current = activeSeq

  // Did we actually call play() for the loaded seq? Separates "the uri never resolved, so this seq was
  // only ever an optimistic highlight and we hold no audio session" from "we started it and it died".
  const playbackAttempted = useRef(false)
  // The native error string already accounted for — expo-audio clears `status.error` only when a new
  // source loads or playback resumes, so for a frame or two after a tap it still carries the PREVIOUS
  // clip's error. Acting on that would light the unplayable hint under a clip playing fine.
  const handledErrorRef = useRef<string | null>(null)
  // ⚠ THE PRE-START WATCHDOG. Without it this surface has NO way to notice a clip that never produces
  // audio. The MACHINERY is shared with useRoutePreview (./preview-audio), as is the exclusive-focus
  // flip — change those there, not here. The BUDGET is NOT shared: this surface reads a local file
  // (§10 N1), so it takes the short LOCAL_CLIP_STALL_MS useDrive takes, while useRoutePreview still
  // streams a presigned url and keeps the generous remote one.
  const { arm: armStartWatchdog, clear: clearStartWatchdog } = useStartWatchdog()

  /** The ONE terminal state for a stop whose audio will not play, whatever the cause. */
  const failSeq = useCallback(
    (seq: number) => {
      clearStartWatchdog()
      const act = decideFail({
        activeId: activeSeqRef.current,
        failingId: seq,
        playbackAttempted: playbackAttempted.current,
      })
      if (act.clearActive) {
        setActiveSeq((s) => (s === seq ? null : s))
        activeSeqRef.current = null
      }
      if (act.releaseSession) releaseAudioSession()
      setUnplayableSeq(seq)
    },
    [clearStartWatchdog],
  )

  const durSec = status.duration && status.duration > 0 ? status.duration : 0

  const resolveUri = useCallback(
    async (seq: number): Promise<string | null> => {
      if (!driveId) return null
      if (!urlsRef.current) {
        const pb = await loadPlayback(driveId) // DISK ONLY, zero network; THROWS when nothing is saved here
        urlsRef.current = pb.urls
      }
      const uri = urlsRef.current.get(seq)
      if (uri) return uri
      // Absent from the cached map = those bytes are not on this phone — the auto-download is still
      // running, the copy is partial, or the rider never saved this drive (§10 N1/N2). Nothing to
      // re-sign, nothing to stream; the ONE recovery left is that the file may have LANDED since the
      // map was built, so re-read it from disk (still zero network) and answer once. Without this
      // re-read the map taken during a download would keep saying "unplayable" for the whole life of
      // the screen, which is exactly the ~10s window §3 creates.
      try {
        const fresh = await loadPlayback(driveId)
        urlsRef.current = fresh.urls
      } catch {
        // the drive's directory went away underneath us — keep the map we hold and answer null
      }
      return urlsRef.current.get(seq) ?? null
    },
    [driveId],
  )

  /** Toggle/replay the loaded clip. Shared by the row tap (via play() on the active stop) and the
   *  screen's transport. The `atEnd` check inside `decideToggle` is why this is not a bare
   *  `playing ? pause : play`: expo-audio parks a finished player at the end, so a second tap would
   *  resume nothing. Declared ABOVE play() so play() can call it — useRoutePreview's `toggle` already
   *  had this shape, and this one carried a verbatim second copy of the body until the 1.1 sweep. */
  const togglePlay = useCallback(() => {
    try {
      const action = decideToggle({
        playing: !!status.playing,
        positionSec: status.currentTime ?? 0,
        durationSec: durSec,
        didJustFinish: !!status.didJustFinish,
      })
      if (action === 'pause') {
        player.pause()
        return
      }
      if (action === 'replay') player.seekTo(0)
      player.play()
    } catch {}
  }, [player, durSec, status.playing, status.currentTime, status.didJustFinish])

  const play = useCallback(
    (seq: number) => {
      // Tap the already-loaded stop → toggle (or replay from the top if it finished).
      if (seq === activeSeq && activeSeqRef.current === seq) {
        togglePlay()
        return
      }
      setUnplayableSeq(null)
      setActiveSeq(seq) // optimistic highlight; cleared below if the audio won't resolve
      activeSeqRef.current = seq
      playbackAttempted.current = false // nothing started yet — a failure here holds no session
      handledErrorRef.current = status.error ?? null // snapshot, so a stale error can't blame this seq
      clearStartWatchdog()
      applyExclusiveForegroundAudio() // exclusive focus + foreground-only (a prior live drive left background-on)
      void (async () => {
        // resolveUri can THROW on the first tap: loadPlayback throws when NOTHING of this drive is on
        // disk, which after §10 is the ordinary state of a drive the rider never saved (N2) and of a
        // fresh one whose auto-download hasn't written its first clip yet. Treat any throw as "no
        // audio" so it degrades to the unplayable hint instead of a stuck highlight + unhandled
        // rejection. (audit)
        let uri: string | null = null
        try {
          uri = await resolveUri(seq)
        } catch {
          uri = null
        }
        if (activeSeqRef.current !== seq) return // a newer tap superseded this one while awaiting
        if (!uri) {
          failSeq(seq) // never played → decideFail holds the session back, correctly
          return
        }
        try {
          player.replace({ uri })
          player.play()
          playbackAttempted.current = true
          // Armed only once the clip is actually in the player. The guard inside is what makes a
          // superseded timer harmless if a later tap has already taken over.
          armStartWatchdog(LOCAL_CLIP_STALL_MS, () => {
            if (activeSeqRef.current !== seq) return
            failSeq(seq)
          })
        } catch {
          // A synchronous throw is a malformed source; a file that fails to DECODE arrives later —
          // asynchronously via status.error or, if the vendor stays silent, via the watchdog above.
          // Same terminal state.
          playbackAttempted.current = true
          failSeq(seq)
        }
      })()
    },
    [activeSeq, armStartWatchdog, clearStartWatchdog, failSeq, player, resolveUri, status.error, togglePlay],
  )

  // Real audio arrived ⇒ disarm the watchdog. Mirrors useDrive's `sawFresh` and useRoutePreview's.
  const sawFresh = sawFreshAudio({ playing: !!status.playing, positionSec: status.currentTime ?? 0 })
  useEffect(() => {
    if (sawFresh) clearStartWatchdog()
  }, [sawFresh, clearStartWatchdog])

  // The asynchronous half of failure — a file that decodes to nothing never throws out of replace().
  // ⚠ This surface had NO reader for it until 2026-08-02: the row simply stayed lit "now playing" in
  // silence. Whether expo-audio populates status.error for an undecodable LOCAL file is just as
  // device-unverified as it was for a remote 403, which is exactly why the watchdog above is the
  // backstop and this is only the fast path.
  useEffect(() => {
    const err = status.error ?? null
    if (!err || err === handledErrorRef.current) return
    handledErrorRef.current = err
    const seq = activeSeqRef.current
    if (seq === null) return
    failSeq(seq)
  }, [status.error, failSeq])

  // ⚠ A clip that simply RAN OUT must hand the audio session back too — the rider took no action, so
  // nothing else will. Under doNotMix this surface INTERRUPTS their music, and iOS resumes it only on
  // deactivation. Missing here until 2026-08-02, which made the common case — audition a stop, keep
  // reading the drive — the one that left their podcast dead until they navigated away.
  useEffect(() => {
    if (!status.didJustFinish) return
    releaseAudioSession()
  }, [status.didJustFinish])

  // A screen unmounting mid-load must not leave a timer that fires into a dead component.
  useEffect(() => clearStartWatchdog, [clearStartWatchdog])

  const seekToMs = useCallback(
    (ms: number) => {
      const sec = ms / 1000
      try {
        player.seekTo(Math.max(0, durSec > 0 ? Math.min(sec, durSec) : sec))
      } catch {}
    },
    [player, durSec],
  )
  const seekBy = useCallback(
    (sec: number) => seekToMs(((status.currentTime ?? 0) + sec) * 1000),
    [seekToMs, status.currentTime],
  )

  const stop = useCallback(() => {
    clearStartWatchdog() // a dismissed clip must not be declared unplayable seconds later
    try {
      player.pause()
    } catch {}
    // ⚠ HAND THE AUDIO SESSION BACK. Pausing does NOT release it: since D35 flipped this surface to
    // `doNotMix` it INTERRUPTS the rider's own music, and iOS only resumes theirs once the session is
    // deactivated. Without this, previewing one stop stops their podcast permanently. `useDrive` pays
    // the same cost at the end of a drive and its comment there records why it is not optional.
    releaseAudioSession()
    activeSeqRef.current = null
    setActiveSeq(null)
    setUnplayableSeq(null)
  }, [clearStartWatchdog, player])

  return {
    activeSeq,
    unplayableSeq,
    playing: !!status.playing,
    positionMs: (status.currentTime ?? 0) * 1000,
    durationMs: durSec * 1000,
    canSeek: !!status.isLoaded && durSec > 0,
    play,
    togglePlay,
    seekToMs,
    seekBy,
    stop,
  }
}
