// The PLANNER-conversation preview clock (1.1 step 8): ONE real narration clip from the rider's own
// proposed route, tapped on the couch, BEFORE the account wall (D14/INV-5). Sibling to
// useStopPreview.ts — same one-reused-player shape, re-keyed from a drive's `seq` to a conversation
// CARD id, because the conversation stacks N proposal cards and N cards must never mean N native
// players (expo-audio allocates one per useAudioPlayer()).
//
// ⚠ THE ONE STRUCTURAL DIFFERENCE FROM useStopPreview: there is no re-sign path. useStopPreview
// resolves through offline.loadPlayback/resignPlayback and can recover an expired presign; here the
// url arrives ON THE PROPOSAL and the only endpoint that could mint a fresh one
// (`POST /drives/:id/assets/sign`) is an OWNER route behind requireAccount — which an anonymous
// rider, the entire audience for this surface, cannot call. So a dead presign is TERMINAL: mark the
// card failed and let it say voice.proposal.clipUnavailable. That is the right answer, not a gap —
// the clip is a taste, not a download, and the honest offer is "make the drive", not a retry that
// cannot work.
//
// ⚠ INV-13: nothing here logs a url, a vendor error string, or anything else.
import { useCallback, useEffect, useRef, useState } from 'react'
import { setAudioModeAsync, setIsAudioActiveAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'

export interface RoutePreview {
  /** The card whose clip is loaded (playing OR paused); null = nothing loaded. */
  activeCardId: string | null
  /** The card whose clip failed to load (expired presign, decode error) — for a soft in-card hint. */
  failedCardId: string | null
  playing: boolean
  positionMs: number
  durationMs: number
  canSeek: boolean
  /** Tap a card's clip: switch+play a new one, or toggle/replay the active one. Latest tap wins. */
  play: (cardId: string, url: string) => void
  toggle: () => void
  /** Pause + clear. Call on blur, and from the pinned bar's dismiss. */
  stop: () => void
}

export function useRoutePreview(): RoutePreview {
  const player = useAudioPlayer()
  const status = useAudioPlayerStatus(player)

  const [activeCardId, setActiveCardId] = useState<string | null>(null)
  const [failedCardId, setFailedCardId] = useState<string | null>(null)

  // The card currently loaded into the single reused player — the latest-tap-wins guard (mirrors
  // useStopPreview's activeSeqRef / useDrive's loadedSeq). Kept in a ref as well as state because the
  // status-error effect below runs outside the tap's render and must see the CURRENT card, not the
  // one captured when the effect's closure was built.
  const activeCardIdRef = useRef<string | null>(null)
  activeCardIdRef.current = activeCardId

  // The native error string already accounted for. expo-audio surfaces a load/playback failure as
  // `status.error` and clears it only "when a new source is loaded or playback resumes successfully"
  // (expo-audio Audio.types.d.ts AudioStatus.error), so for a frame or two after a tap the status
  // still carries the PREVIOUS clip's error. Attributing that to the new card would light
  // clipUnavailable under a clip that is playing fine — so we act only on an error that differs from
  // whatever was showing when this load started.
  // ⚠ KNOWN, ACCEPTED MISS: two clips in a row failing with an IDENTICAL native message shows the
  // hint only for the first. Chosen deliberately — a missed hint is a card that just doesn't play; a
  // false positive is a lie printed over working audio. Do not "fix" it by dropping the comparison.
  const handledErrorRef = useRef<string | null>(null)

  const durSec = status.duration && status.duration > 0 ? status.duration : 0

  // ⚠ D35 (1.1): pre-drive skipper audio takes EXCLUSIVE focus, exactly like a drive — the skipper
  // never talks over the rider's music, on any surface. This mirrors the same flip in
  // useStopPreview.ts and app/sample.tsx; docs/decisions/drive-audio-exclusive-focus.md carries the
  // broadened scope. Do not soften it back to mixWithOthers.
  //
  // ⚠ RE-ASSERTED ON EVERY play(), NOT ONCE ON MOUNT. setAudioModeAsync is PROCESS-WIDE and
  // last-writer-wins, and a live drive sets `shouldPlayInBackground: true` from a screen that PUSHES
  // over this still-mounted conversation. Without the re-assert, a rider who opens a drive and comes
  // back gets a preview clip that keeps talking after they leave the app.
  const applyPreviewAudioMode = useCallback(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: 'doNotMix',
    }).catch(() => {})
  }, [])

  // Toggle/replay the loaded clip. Shared by the in-card disc (via play() on the active card) and the
  // pinned ClipBar. The `atEnd` check is why this is not a bare `playing ? pause : play`: expo-audio
  // leaves a finished player parked at the end, so a second tap would resume nothing.
  const toggle = useCallback(() => {
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

  const play = useCallback(
    (cardId: string, url: string) => {
      // Tap the already-loaded card → toggle (or replay from the top if it finished).
      if (cardId === activeCardId && activeCardIdRef.current === cardId) {
        toggle()
        return
      }
      setFailedCardId((f) => (f === cardId ? null : f))
      setActiveCardId(cardId)
      activeCardIdRef.current = cardId
      // Snapshot the error showing right now so a stale one can't be blamed on this card (above).
      handledErrorRef.current = status.error ?? null
      applyPreviewAudioMode()
      try {
        player.replace({ uri: url })
        player.play()
      } catch {
        // A synchronous throw is a malformed source, not a network failure — the presign 403 arrives
        // asynchronously via status.error. Both land on the same rider-facing hint.
        setActiveCardId((c) => (c === cardId ? null : c))
        if (activeCardIdRef.current === cardId) activeCardIdRef.current = null
        setFailedCardId(cardId)
      }
    },
    [activeCardId, applyPreviewAudioMode, player, status.error, toggle],
  )

  // The asynchronous half of failure: an expired/denied presign or an undecodable body never throws
  // out of replace() — it arrives here.
  // ⚠ DEVICE-UNVERIFIED: whether iOS/Android actually populate `status.error` for an HTTP 403 on a
  // remote source. If they do not, this degrades to "the disc does nothing" rather than showing the
  // hint — bad, but not wrong. Worth ten seconds on a real device with a deliberately stale url.
  useEffect(() => {
    const err = status.error ?? null
    if (!err || err === handledErrorRef.current) return
    handledErrorRef.current = err
    const card = activeCardIdRef.current
    if (!card) return
    setActiveCardId((c) => (c === card ? null : c))
    activeCardIdRef.current = null
    setFailedCardId(card)
  }, [status.error])

  const stop = useCallback(() => {
    try {
      player.pause()
    } catch {}
    // ⚠ HAND THE AUDIO SESSION BACK. Pausing does NOT release it: under `doNotMix` iOS resumes the
    // rider's own music only once the session is deactivated, so without this the clip stops and
    // Spotify never comes back — the rider keeps chatting with the skipper in silence, with no
    // control on screen that fixes it. This is the cost of D35's flip: under the old `mixWithOthers`
    // nothing was ever interrupted, so nothing needed handing back. `useDrive` already paid to learn
    // this at the end of a drive; the same rule applies to every surface that takes exclusive focus.
    // Fire-and-forget — a failure here must never block stopping the clip.
    void setIsAudioActiveAsync(false).catch(() => {})
    activeCardIdRef.current = null
    setActiveCardId(null)
    setFailedCardId(null)
  }, [player])

  // A clip that simply RAN OUT must hand the session back too — the rider took no action, so nothing
  // else will. Without this the common case (listen to the whole taste, carry on planning) is exactly
  // the one that strands their music.
  useEffect(() => {
    if (!status.didJustFinish) return
    void setIsAudioActiveAsync(false).catch(() => {})
  }, [status.didJustFinish])

  return {
    activeCardId,
    failedCardId,
    playing: !!status.playing,
    positionMs: (status.currentTime ?? 0) * 1000,
    durationMs: durSec * 1000,
    canSeek: !!status.isLoaded && durSec > 0,
    play,
    toggle,
    stop,
  }
}
