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
import { useCallback, useRef, useState } from 'react'
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import { loadPlayback, resignPlayback } from './offline'

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
  /** Pause + clear the active stop — call on screen blur so this second player never talks UNDER the
   *  live drive (the detail screen stays mounted beneath the pushed player). */
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
  activeSeqRef.current = activeSeq

  const durSec = status.duration && status.duration > 0 ? status.duration : 0

  // A couch preview is POLITE, not the exclusive in-car experience: mix with other audio (never the live
  // drive's doNotMix), and don't keep talking in the background (a preview that plays on after you leave the
  // screen is surprising, and it avoids overlapping the live player). setAudioModeAsync is PROCESS-WIDE, and
  // the live drive sets doNotMix + background-on on a screen that PUSHES over this still-mounted one — so a
  // mount-only reset would leave the wrong (exclusive) mode after you return from a drive. Reassert it on
  // every play() instead (the natural await on resolveUri below gives the async call time to land). (audit)
  const applyPoliteAudioMode = useCallback(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: 'mixWithOthers',
    }).catch(() => {})
  }, [])

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

  const play = useCallback(
    (seq: number) => {
      // Tap the already-loaded stop → toggle (or replay from the top if it finished).
      if (seq === activeSeq && activeSeqRef.current === seq) {
        try {
          if (status.playing) {
            player.pause()
          } else {
            const atEnd = status.didJustFinish || (durSec > 0 && (status.currentTime ?? 0) >= durSec - 0.25)
            if (atEnd) player.seekTo(0)
            player.play()
          }
        } catch {}
        return
      }
      setUnplayableSeq(null)
      setActiveSeq(seq) // optimistic highlight; cleared below if the audio won't resolve
      activeSeqRef.current = seq
      applyPoliteAudioMode() // reassert mixWithOthers (a prior live drive left doNotMix process-wide)
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
          setActiveSeq((s) => (s === seq ? null : s))
          activeSeqRef.current = null
          setUnplayableSeq(seq)
          return
        }
        try {
          player.replace({ uri })
          player.play()
        } catch {
          setActiveSeq((s) => (s === seq ? null : s))
          activeSeqRef.current = null
          setUnplayableSeq(seq)
        }
      })()
    },
    [activeSeq, durSec, player, resolveUri, applyPoliteAudioMode, status.playing, status.currentTime, status.didJustFinish],
  )

  const togglePlay = useCallback(() => {
    try {
      if (status.playing) {
        player.pause()
      } else {
        const atEnd = status.didJustFinish || (durSec > 0 && (status.currentTime ?? 0) >= durSec - 0.25)
        if (atEnd) player.seekTo(0)
        player.play()
      }
    } catch {}
  }, [player, durSec, status.playing, status.currentTime, status.didJustFinish])

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
    try {
      player.pause()
    } catch {}
    activeSeqRef.current = null
    setActiveSeq(null)
    setUnplayableSeq(null)
  }, [player])

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
