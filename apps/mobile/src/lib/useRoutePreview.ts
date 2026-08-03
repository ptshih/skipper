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
// ⚠ WHICH MAKES REACHING THAT STATE THE WHOLE JOB, and it used to depend on the vendor's goodwill:
// every failure path ran through `status.error`, whose population for an HTTP 403 on a remote source
// is device-unverified. When it doesn't fire there is no throw, no error and no timer — the disc just
// does nothing and the rider is told nothing. A terminal state nobody can reach is not a decision, it
// is a hang. The pre-start watchdog below closes that: the verdict is now reached on a clock, and
// `status.error` only makes it arrive sooner.
//
// ⚠ INV-13: nothing here logs a url, a vendor error string, or anything else.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import { PRE_START_STALL_MS } from '@skipper/engine'
import { track } from './analytics'
import { applyPreviewAudioMode, releasePreviewAudioSession, useStartWatchdog } from './preview-audio'
import { decideFail, decideToggle, PREVIEW_END_EPS_SEC, sawFreshAudio } from './preview-util'

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
  /** Pause + unload the ACTIVE clip (a failed card stays failed — see stop()). Call on blur, and
   *  from the pinned bar's dismiss. */
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
  // The mirror IS the point (see above), and this ref is ALSO written imperatively by
  // play()/failCard()/stop() so latest-tap-wins resolves within a single tap. Moving it to an effect
  // would put the sync a paint behind the writes it has to agree with.
  // eslint-disable-next-line react-hooks/refs
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

  // The card whose COMPLETION has already been reported (see the didJustFinish effect). toggle()
  // replays a finished clip without ever passing back through play(), so an unlatched completion
  // would report twice against one start and push the completion RATE above 1 — the one number the
  // paired event exists to produce.
  const completedCardRef = useRef<string | null>(null)

  // ⚠ THE PRE-START WATCHDOG — the reason this surface does not depend on `status.error` firing. It
  // and the exclusive-focus flip are SHARED with useStopPreview (./preview-audio); read that module
  // before changing either, and change it there rather than here.
  const { arm: armStartWatchdog, clear: clearStartWatchdog } = useStartWatchdog()

  // The ONE terminal state, shared by all three ways a clip can fail to play: a synchronous throw out
  // of replace(), an asynchronous `status.error`, and the watchdog above. They were three near-copies
  // that had already drifted (one cleared the active ref unguarded, one guarded it) — and none of them
  // handed the audio session back, which under `doNotMix` leaves the rider's own music stopped with
  // nothing on screen that restarts it. That is the same obligation stop() documents; a clip that
  // failed took the session just as surely as one that played.
  const failCard = useCallback(
    (cardId: string) => {
      clearStartWatchdog()
      // Every path here has already called play() — the url arrives on the proposal, so there is no
      // "could not resolve audio" branch the way useStopPreview has one.
      const act = decideFail({ activeId: activeCardIdRef.current, failingId: cardId, playbackAttempted: true })
      if (act.clearActive) {
        setActiveCardId((c) => (c === cardId ? null : c))
        activeCardIdRef.current = null
      }
      if (act.releaseSession) releasePreviewAudioSession()
      setFailedCardId(cardId)
    },
    [clearStartWatchdog],
  )

  const durSec = status.duration && status.duration > 0 ? status.duration : 0

  // Toggle/replay the loaded clip. Shared by the in-card disc (via play() on the active card) and the
  // pinned ClipBar. The `atEnd` check is why this is not a bare `playing ? pause : play`: expo-audio
  // leaves a finished player parked at the end, so a second tap would resume nothing.
  const toggle = useCallback(() => {
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
      completedCardRef.current = null // a fresh load — this clip has reported no completion yet
      applyPreviewAudioMode()
      try {
        player.replace({ uri: url })
        player.play()
        // ── preview_clip_played: START. It lives HERE — inside the hook, past the toggle() early
        // return above — and not on the card's Pressable, because the Pressable fires on every
        // pause, resume and replay too; this is the only line that means "a NEW clip began".
        //
        // ⚠ THE EVENT IS EMITTED TWICE PER CLIP, ON PURPOSE: once here with completed:false, once at
        // didJustFinish with completed:true. The funnel step is satisfied by the FIRST; the
        // completion rate is the ratio of the two. Do not "simplify" it to a single event at the
        // end — that erases every abandoned clip, which is the half worth measuring. And do not try
        // to infer abandonment from stop() / a card switch / blur: three more code paths carrying a
        // signal worth less than their own bug surface.
        //
        // ⚠ `url` is a PRESIGNED R2 URL and `status.error` is a vendor string — neither may ever ride
        // an event (INV-13; the App Privacy label). `completed` is the entire payload, and the file
        // header's promise that nothing here logs a url stays true.
        //
        // Fires after play() rather than before replace() so a synchronous throw (a malformed
        // source) counts as no play at all. The async failure — an expired presign surfacing via
        // status.error — is unknowable at this line and does count as a start; it then simply never
        // completes, which is exactly what an abandoned-clip number should look like.
        track('preview_clip_played', { completed: false })
        // Arm the pre-start watchdog LAST, so it covers only a clip that was actually handed to the
        // player. A later tap re-enters play() and re-arms it; the guard inside is what makes the
        // superseded timer harmless if it fires first.
        armStartWatchdog(PRE_START_STALL_MS, () => {
          if (activeCardIdRef.current !== cardId) return // superseded by a later tap — not this card's verdict
          failCard(cardId)
        })
      } catch {
        // A synchronous throw is a malformed source, not a network failure — the presign 403 arrives
        // asynchronously via status.error. Both land on the same rider-facing hint.
        failCard(cardId)
      }
    },
    [activeCardId, armStartWatchdog, failCard, player, status.error, toggle],
  )

  // Real audio arrived ⇒ disarm. Mirrors useDrive's `sawFresh` exactly (playing AND past the first
  // quarter-second), because a player can report `playing` for a moment before any sound exists.
  const sawFresh = sawFreshAudio({ playing: !!status.playing, positionSec: status.currentTime ?? 0 })
  useEffect(() => {
    if (sawFresh) clearStartWatchdog()
  }, [sawFresh, clearStartWatchdog])

  // A hook that unmounts mid-load must not leave a timer that fires into a dead component.
  useEffect(() => clearStartWatchdog, [clearStartWatchdog])

  // The asynchronous half of failure: an expired/denied presign or an undecodable body never throws
  // out of replace() — it arrives here, when the vendor reports it.
  // ⚠ STILL DEVICE-UNVERIFIED: whether iOS/Android actually populate `status.error` for an HTTP 403 on
  // a remote source. That question is now a LATENCY question rather than a correctness one — the
  // pre-start watchdog reaches the same terminal state without it, so the worst case is the hint
  // arriving after PRE_START_STALL_MS instead of immediately. Still worth ten seconds on a real device
  // with a deliberately stale url, because fast is better than eventual; it is no longer load-bearing.
  useEffect(() => {
    const err = status.error ?? null
    if (!err || err === handledErrorRef.current) return
    handledErrorRef.current = err
    const card = activeCardIdRef.current
    if (!card) return
    failCard(card)
  }, [status.error, failCard])

  const stop = useCallback(() => {
    clearStartWatchdog() // a dismissed clip must not be declared "unavailable" seconds later
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
    releasePreviewAudioSession()
    activeCardIdRef.current = null
    setActiveCardId(null)
    // ⚠ `failedCardId` SURVIVES a stop, deliberately — clearing it here handed the rider back a play
    // disc on a card whose presign is dead, and this surface has no re-sign path (file header), so
    // that tap provably cannot work. Two ordinary paths reached it: card A fails → the rider plays
    // card B → ✕ on the pinned bar; and card A fails → the rider opens Settings → the screen's blur
    // effect calls stop(). Neither says anything about card A's url. The failure is CLEARED where it
    // is disproved instead: play() drops it per-card the moment a new clip actually starts on that
    // card, and "Start fresh" throws the whole conversation (cards included) away.
  }, [clearStartWatchdog, player])

  // A clip that simply RAN OUT must hand the session back too — the rider took no action, so nothing
  // else will. Without this the common case (listen to the whole taste, carry on planning) is exactly
  // the one that strands their music.
  useEffect(() => {
    if (!status.didJustFinish) return
    releasePreviewAudioSession()
  }, [status.didJustFinish])

  // ── preview_clip_played: COMPLETION — the other half of the pair emitted in play().
  // ⚠ DELIBERATELY NOT RIDING `didJustFinish` ALONE, and the asymmetry is the reason this is its own
  // effect rather than a line inside the hand-back above. expo-audio can DROP didJustFinish across an
  // OS audio interruption — a phone call over the last seconds of a clip — and both sibling surfaces
  // (app/sample.tsx, useDrive) already defend with an `atEnd` position check for exactly that. Here it
  // matters more than anywhere: this event is emitted TWICE precisely so completion RATE is readable,
  // so a dropped signal does not lose a nicety, it silently moves a listener into the abandoned bucket
  // and biases the one number the pair exists to produce.
  // ⚠ The session hand-back above stays on didJustFinish alone and stays UNCONDITIONAL — it is an
  // audio-focus obligation, not a metric, and firing it off a position estimate would hand the session
  // back mid-clip. Two different questions, two different signals; do not merge them back.
  const atEnd = durSec > 0 && (status.currentTime ?? 0) >= durSec - PREVIEW_END_EPS_SEC
  useEffect(() => {
    if (!status.didJustFinish && !atEnd) return
    const card = activeCardIdRef.current
    if (card && completedCardRef.current !== card) {
      completedCardRef.current = card
      track('preview_clip_played', { completed: true })
    }
  }, [status.didJustFinish, atEnd])

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
