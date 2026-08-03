// The DETAIL-PAGE mini-preview clock: tap a stop (a list row or a map pin) to hear THAT one narration
// clip, on the couch, before ever driving. It replaces the old full-screen "simulated drive" (the couch
// PREVIEW mode) — the founder's call is discrete stop-by-stop playback, not a compressed end-to-end run
// (docs/decisions/detail-page-mini-preview.md).
//
// One reused expo-audio player across every stop (mirrors sample.tsx's single-clip shell, extended for
// multi-stop). Audio is resolved through offline.loadPlayback's seq→uri map — NEVER `clip.url` directly:
// a downloaded drive nulls every presigned url on disk (offline.ts strips credentials), so a raw clip.url
// read is silently un-playable in exactly the dead-zone case the product is built for. The map is local
// `file://` when downloaded, presigned https when streaming; we re-sign on a miss (a screen can sit open
// past the ~1h presigned TTL) and give up gracefully when a seq is genuinely absent (a partial download).
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import { PRE_START_STALL_MS } from '@skipper/engine'
import { loadPlayback, resignPlayback } from './offline'
import { applyPreviewAudioMode, releasePreviewAudioSession, useStartWatchdog } from './preview-audio'
import { decideFail, decideToggle, sawFreshAudio } from './preview-util'

export interface StopPreview {
  /** The stop whose clip is loaded (playing OR paused). Drives the row/pin "now playing" highlight. */
  activeSeq: number | null
  /** The last stop tapped whose audio couldn't be resolved (a partial-download miss) — for a soft hint. */
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
  // audio. It and the exclusive-focus flip are SHARED with useRoutePreview (./preview-audio) — same
  // shape, same constant, and the same rule useDrive keys on, because it is the same clip over the
  // same kind of url. Change it there, not here.
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
      if (act.releaseSession) releasePreviewAudioSession()
      setUnplayableSeq(seq)
    },
    [clearStartWatchdog],
  )

  const durSec = status.duration && status.duration > 0 ? status.duration : 0

  const resolveUri = useCallback(
    async (seq: number): Promise<string | null> => {
      if (!driveId) return null
      if (!urlsRef.current) {
        const pb = await loadPlayback(driveId) // offline-first: local file:// map, else presigned https
        urlsRef.current = pb.urls
      }
      let uri = urlsRef.current.get(seq)
      if (uri) return uri
      // Absent from the cached map — a presigned url that expired past its short TTL, or a not-yet-signed
      // seq. Re-sign once (a downloaded drive returns the never-expiring local map). Still absent = the
      // clip genuinely isn't available here (a partial download that never landed this seq).
      try {
        const fresh = await resignPlayback(driveId)
        urlsRef.current = fresh
        uri = fresh.get(seq)
      } catch {
        // network/sign failure — fall through to null (the caller shows an unplayable hint)
      }
      return uri ?? null
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
      applyPreviewAudioMode() // exclusive focus + foreground-only (a prior live drive left background-on)
      void (async () => {
        // resolveUri can THROW on the first tap (its loadPlayback → getDrive hits the network for a
        // not-fully-downloaded drive) — a signal drop after the page loaded lands here. Treat any throw
        // as "no audio" so it degrades to the unplayable hint instead of a stuck highlight + unhandled
        // rejection (the Tahoe dead-zone case). (audit)
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
          armStartWatchdog(PRE_START_STALL_MS, () => {
            if (activeSeqRef.current !== seq) return
            failSeq(seq)
          })
        } catch {
          // A synchronous throw is a malformed source; the presign 403 arrives asynchronously via
          // status.error or, if the vendor stays silent, via the watchdog above. Same terminal state.
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

  // The asynchronous half of failure — an expired/denied presign or an undecodable body never throws
  // out of replace(). ⚠ This surface had NO reader for it until 2026-08-02: the row simply stayed lit
  // "now playing" in silence. Whether iOS populates status.error for an HTTP 403 on a remote source is
  // device-unverified, which is exactly why the watchdog above is the backstop and this is only the
  // fast path.
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
    releasePreviewAudioSession()
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
    releasePreviewAudioSession()
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
