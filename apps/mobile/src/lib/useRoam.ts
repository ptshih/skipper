// useRoam — the FREE-ROAM session hook (alpha). The skipper rides shotgun on the rider's
// OWN drive: no route, no tour shape — fetch the roam pins near here, feed live GPS fixes
// to the RoamEngine (proximity + heading + governors; @skipper/engine/roam), and play
// each fired encounter through a FIFO queue. State machine per the design handoff:
//   idle → sessionStart → roaming ⇄ (encounter sheet) ; roaming → signoff → idle
//
// Deliberate differences from useDrive (the tour player):
//   - AUDIO SESSION = PAUSE+RESUME, not duck (founder 2026-06-11): roam takes EXCLUSIVE focus
//     (`doNotMix` — pauses the rider's podcast/music) ONLY while a clip is actually sounding,
//     and HANDS IT BACK (`mixWithOthers` — the rider's audio resumes) the instant the clip
//     ends or is held. Ducking left the rider's music competing UNDER the skipper (distracting).
//     The focus toggles on the sawFresh edge (real audio), so a silent pre-buffer / dead-zone
//     skip never strands the rider's music paused. Still NO lock-screen Now Playing claim
//     (alpha cut; the flip moots the old doNotMix-vs-lock-screen note). ⚠ Whether iOS RESUMES
//     Spotify/podcasts when we relinquish to mixWithOthers is DEVICE-ONLY — verify on a real
//     device (resume after a 60s encounter, re-pause on the next) before relying on it.
//   - CHATTINESS (quiet/normal/talkative) retunes the engine's min-gap governor live — a
//     SELECTION knob (which/how-many encounters fire), never a generation knob.
//   - No offline pack (alpha streams presigned URLs), no re-sign-on-stall (a stalled clip
//     just skips — a missed encounter is invisible by design), no music bed (the rider's
//     own audio IS the bed), no end-of-route (the session ends when the rider ends it).
//
// Sim mode (couch/dev): replays the first ready tour's polyline through the SAME engine —
// same fix data a real drive would produce, so triggers behave exactly as on the road.

import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import * as Location from 'expo-location'
import {
  clampSeekSec,
  decideStall,
  haversineMeters,
  POST_START_STALL_MS,
  RoamEngine,
  seekTargetReached,
} from '@skipper/engine'
import type { LngLat } from '@skipper/engine'
import { errorMessage, getRoamManifest } from './api'
import type { RoamManifest } from './api'
import { liveRoamSource, simulatedSource } from './gps'
import type { FixSubscription } from './gps'
import { useLocationPriming } from './useLocationPriming'
import type { ChattinessLevel } from '@/ui'
import { voice } from '@/ui/voice'

export type RoamMode = 'live' | 'sim'

export type RoamPhase =
  | 'idle' // pre-session (the entry/start surface)
  | 'locationPrime' // live only, first time: the pre-permission explainer (before the OS prompt)
  | 'locationGate' // live only: permission denied / reduced
  | 'loading' // locating + fetching the manifest
  | 'error'
  | 'noCoverage' // manifest came back empty — outside the known roads
  | 'sessionStart' // the opener line card (~2.5s, or a tap)
  | 'roaming' // session live (idle base; encounters overlay)
  | 'signoff' // hand-ended: the warm out + session tally

export interface RoamGateInfo {
  canAskAgain: boolean
  reduced: boolean
}

const KEEP_AWAKE_TAG = 'skipper-roam'
/** A clip that never starts (expired URL / dead zone) is SKIPPED after this grace — roam
 *  has no re-sign machinery (alpha); a missed encounter is invisible by design. */
const CLIP_STALL_MS = 12_000
// POST_START_STALL_MS (the post-start interruption threshold) + the decideStall ladder live in
// @skipper/engine/player now, single-sourced + unit-tested (shared with useDrive).
/** getCurrentPositionAsync has no built-in timeout; a cold/indoor/canyon fix can never resolve, wedging
 *  the session in 'loading' forever (no watchdog runs there). Bound the locate step. (audit #156) */
const LOCATE_TIMEOUT_MS = 12_000
/** Pre-buffer grace: the sheet normally waits for REAL audio before sliding up (so it never
 *  sits frozen at 0:00). If the buffer drags past this (thin signal / dead zone), present the
 *  sheet anyway in a loading skeleton — better a "pulling this up…" sheet than a silent void
 *  while the stall watchdog (CLIP_STALL_MS) still runs underneath. */
const CLIP_SKELETON_MS = 3_000
/** Live roam watchdog: no accepted fix for this long → show the GPS-searching note. */
const GPS_QUIET_MS = 8_000
/** The session-start card settles into the quiet idle on its own. */
const SESSION_START_MS = 2_500
/** Chattiness → the engine's min-gap governor (seconds between encounter STARTS). */
const CHATTINESS_GAP_SEC: Record<ChattinessLevel, number> = {
  quiet: 240,
  normal: 75,
  talkative: 30,
}

export interface RoamState {
  phase: RoamPhase
  mode: RoamMode
  error: string | null
  gate: RoamGateInfo | null
  /** Pins in range (the manifest), for honesty lines. */
  pinCount: number
  /** The encounter currently PLAYING (null = companionable silence). */
  activeName: string | null
  /** The encounter clip's transport — roam reuses the EXACT tour-player controls
   *  (Scrubber + play/pause + ±15s jogs) so both players feel identical (founder call,
   *  superseding the alpha's read-only progress bar). */
  clipPositionMs: number
  clipDurationMs: number
  clipPlaying: boolean
  clipCanSeek: boolean
  /** The sheet is up but the clip hasn't started yet — a dead-zone skeleton (the sheet
   *  now waits for real audio before presenting, so this only shows on a slow buffer). */
  clipBuffering: boolean
  /** Pause/resume the encounter clip (music un-ducks while held). */
  toggleClipPlay: () => void
  /** Seek to an absolute position (scrubber release / a11y jog). */
  seekClipTo: (ms: number) => void
  /** Jog ±seconds (the ±15s buttons). */
  seekClipBy: (deltaSec: number) => void
  /** Hold the clip-finished auto-dismiss while a scrub drag is live. */
  setClipScrubbing: (active: boolean) => void
  /** Encounters told this session (the stat pill + the sign-off tally). */
  toldCount: number
  /** Alpha drive-test diagnostics: seconds since the last accepted fix + straight-line
   *  distance to the nearest pin. The line that lets a real road test self-diagnose. */
  diag: { fixAgeSec: number | null; nearestM: number | null }
  /** Live position for the glanceable roam map — null until the first fix (updates ~2s). */
  position: { lat: number; lng: number } | null
  /** The manifest's story-pins, for the roam map (set once when the session loads). */
  mapPins: { poiId: string; name: string; lat: number; lng: number }[]
  /** The session-start opener line (rotates per session). */
  openerLine: string
  chattiness: ChattinessLevel
  setChattiness: (level: ChattinessLevel) => void
  gpsSearching: boolean
  start: () => void
  /** Re-attempt the session after an error (mirrors useDrive.retry). Unlike `start` (which is
   *  semantically "begin a session" and start-pending-guarded), this clears the error and
   *  re-runs the begin flow — the dead-end error screen's CTA. */
  retry: () => void
  /** The pre-permission explainer's single CTA (live, first time): fire the OS location prompt. */
  confirmLocationPrime: () => void
  /** Skip the playing encounter (the sheet's ghost action / scrim tap). */
  skip: () => void
  /** Hand-end the session → the sign-off state (teardown happens here). */
  end: () => void
  /** Leave the sign-off → back to idle/entry. */
  finishSignoff: () => void
}

/**
 * @param mode  live | sim
 */
export function useRoam(mode: RoamMode): RoamState {
  const [phase, setPhase] = useState<RoamPhase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [gate, setGate] = useState<RoamGateInfo | null>(null)
  const [pinCount, setPinCount] = useState(0)
  const [activePoiId, setActivePoiId] = useState<string | null>(null) // the clip LOADING/playing
  const [sheetPoiId, setSheetPoiId] = useState<string | null>(null) // what the sheet SHOWS (gated on ready/skeleton)
  const [clipReady, setClipReady] = useState(false) // real audio has started for the sheet's clip
  const [toldCount, setToldCount] = useState(0)
  const [openerLine, setOpenerLine] = useState<string>(voice.roam.sessionStart[0]!)
  const [chattiness, setChattinessState] = useState<ChattinessLevel>('normal')
  const [gpsSearching, setGpsSearching] = useState(false)
  const [clipPaused, setClipPaused] = useState(false) // encounter held by hand (music un-ducks)
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null) // roam-map puck
  const [mapPins, setMapPins] = useState<{ poiId: string; name: string; lat: number; lng: number }[]>([])
  const [diag, setDiag] = useState<{ fixAgeSec: number | null; nearestM: number | null }>({
    fixAgeSec: null,
    nearestM: null,
  })

  const engineRef = useRef<RoamEngine | null>(null)
  const pinsRef = useRef<RoamManifest['pins']>([])
  const queueRef = useRef<string[]>([]) // fired poiIds waiting to play (FIFO)
  const clipBusy = useRef(false)
  const subRef = useRef<FixSubscription | null>(null)
  const mountedRef = useRef(true)
  const startPending = useRef(false) // a start flow is in flight — blocks double-tap (sim; live is guarded inside useLocationPriming)
  const lastFixAt = useRef(0)
  const lastFixPos = useRef<{ lat: number; lng: number } | null>(null)
  const lastPublishedPos = useRef<{ lat: number; lng: number } | null>(null) // last position pushed to the map puck (audit #603)
  const finishedPoi = useRef<string | null>(null) // didJustFinish double-fire guard
  const stallTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skeletonTimer = useRef<ReturnType<typeof setTimeout> | null>(null) // present-the-sheet-anyway fallback
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sawFresh = useRef(false)
  const clipRetried = useRef<Set<string>>(new Set()) // poiIds given the one stall recovery
  const pausedRef = useRef(false) // mirrors clipPaused for the stall watchdog
  const scrubbingRef = useRef(false) // a scrub drag is live — hold the clip-finished handler
  const seekTarget = useRef<number | null>(null) // pending seek (sec), so ±15 taps accumulate
  // Post-start interruption/stall recovery tracking (mirrors useDrive). (audit #1)
  const lastProgressAt = useRef(0) // ms of the last forward progress on the loaded clip
  const lastProgressTime = useRef(0) // last observed currentTime (sec)
  const durationRef = useRef(0) // last observed clip duration (sec)
  const resumeTried = useRef(false) // already attempted a resume for the current stall

  const player = useAudioPlayer()
  const status = useAudioPlayerStatus(player)

  // Pause+resume focus toggle (founder 2026-06-11): the rider's audio is interrupted ONLY
  // while the skipper is actually talking. exclusive=true → `doNotMix` (pauses the rider's
  // app); exclusive=false → `mixWithOthers` (hands focus back so it resumes). expo-audio has
  // no explicit session-deactivate — flipping the interruption mode IS the release mechanism
  // (SDK 56 docs). Fire-and-forget; a failed flip just leaves the prior focus, never throws.
  // NOTE (audit #454): setAudioModeAsync is PROCESS-WIDE — the tour drive (useDrive) also mutates it
  // (doNotMix + a lock-screen claim). Navigation can't co-mount the drive + roam screens, so they
  // don't fight today; a structural assumption, not a guarded one.
  // NOTE (audit #436): roam deliberately uses mixWithOthers and NEVER calls setActiveForLockScreen
  // (which requires doNotMix) — so on ANDROID a backgrounded roam clip is cut by the OS after ~3 min.
  // iOS is the only shipped platform; accepted iOS-first-alpha limitation.
  const setExclusiveAudio = useCallback((exclusive: boolean) => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: exclusive ? 'doNotMix' : 'mixWithOthers',
    }).catch(() => {})
  }, [])

  const teardown = useCallback(() => {
    subRef.current?.stop()
    subRef.current = null
    engineRef.current = null
    queueRef.current = []
    clipBusy.current = false
    if (stallTimer.current) {
      clearTimeout(stallTimer.current)
      stallTimer.current = null
    }
    if (skeletonTimer.current) {
      clearTimeout(skeletonTimer.current)
      skeletonTimer.current = null
    }
    if (settleTimer.current) {
      clearTimeout(settleTimer.current)
      settleTimer.current = null
    }
    try {
      player.pause()
    } catch {}
    setExclusiveAudio(false) // never leave a session with the rider's audio interrupted
    deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {})
  }, [player, setExclusiveAudio])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      teardown()
    }
  }, [teardown])

  // ---- FIFO pump: load + play the next fired encounter (one at a time) ----
  const pump = useCallback(() => {
    if (clipBusy.current) return
    const next = queueRef.current.shift()
    if (next === undefined) return
    clipBusy.current = true
    setActivePoiId(next)
  }, [])

  const onClipDone = useCallback(
    (poiId: string) => {
      if (stallTimer.current) {
        clearTimeout(stallTimer.current)
        stallTimer.current = null
      }
      if (skeletonTimer.current) {
        clearTimeout(skeletonTimer.current)
        skeletonTimer.current = null
      }
      // The tally counts encounters that made SOUND — a stall-skipped clip the rider
      // never heard isn't a story told.
      if (sawFresh.current) setToldCount((n) => n + 1)
      setExclusiveAudio(false) // clip over → hand focus back so the rider's audio resumes
      setActivePoiId((cur) => (cur === poiId ? null : cur))
      // Keep the sheet UP if another encounter is queued (don't slide down then back up between
      // back-to-back encounters) — but ADVANCE it to the next queued poi NOW so the buffering sheet
      // shows the UPCOMING story's name, not the finished one's (which would flash the wrong title until
      // the next clip's audio starts). pump() shifts this same head; sawFresh re-confirms it. (audit #1023 / #11)
      const nextQueued = queueRef.current[0]
      if (nextQueued !== undefined) setSheetPoiId(nextQueued)
      else setSheetPoiId((cur) => (cur === poiId ? null : cur))
      setClipReady(false)
      clipBusy.current = false
      pump()
    },
    [pump, setExclusiveAudio],
  )

  // Stall recovery: ONE re-fetch of the manifest (fresh presigned URLs — covers both a
  // transient cellular stall and a >1h session's expired signs) + a clip reload; a second
  // stall skips. Field-found (first live drive): a clip hung at 0:00 forever on thin 5G.
  const [reloadKey, setReloadKey] = useState(0)
  const recoverStalledClip = useCallback(
    async (poiId: string) => {
      try {
        const pos = lastFixPos.current
        if (pos) {
          const fresh = await getRoamManifest(pos.lat, pos.lng)
          // Only adopt fresh pins if they still include the ACTIVE poi — else the clip-load reload
          // below can't find it (silent drop) while the engine keeps the old pins. (audit #1004)
          if (fresh.pins.some((p) => p.poiId === poiId)) pinsRef.current = fresh.pins
        }
      } catch {} // offline/dead zone: the reload below retries the old URL — then skips
      // Audio may have started playing during the async manifest fetch — if sawFresh flipped
      // true in that window the stall resolved itself; reloading here would restart the clip.
      if (sawFresh.current) return
      setReloadKey((k) => k + 1) // re-run the clip-load effect for the SAME poi
    },
    [],
  )

  // Clip load/play, keyed on the active encounter (the useDrive pattern, leaner).
  // A clip that never produces REAL audio within the grace gets one recovery, then skips
  // — a missed encounter is invisible by design; a frozen sheet is not.
  useEffect(() => {
    if (activePoiId === null) return
    const pin = pinsRef.current.find((p) => p.poiId === activePoiId)
    if (!pin) {
      onClipDone(activePoiId)
      return
    }
    sawFresh.current = false
    setClipReady(false)
    finishedPoi.current = null
    // Reset post-start progress trackers for the interruption/stall recovery below. (audit #1)
    lastProgressAt.current = Date.now()
    lastProgressTime.current = 0
    resumeTried.current = false
    try {
      player.pause()
    } catch {}
    player.replace({ uri: pin.url })
    player.play()
    setClipPaused(false) // a fresh encounter always opens playing
    pausedRef.current = false
    seekTarget.current = null
    // Pre-buffer: hold the sheet until real audio starts (the status effect promotes it on
    // sawFresh). If the buffer drags past the skeleton grace, present the sheet anyway in a
    // loading state — never a silent void, while the stall watchdog below still runs.
    skeletonTimer.current = setTimeout(() => {
      if (sawFresh.current || !mountedRef.current) return
      setSheetPoiId((cur) => (cur === null ? activePoiId : cur))
    }, CLIP_SKELETON_MS)
    stallTimer.current = setTimeout(() => {
      if (sawFresh.current || pausedRef.current) return
      if (!clipRetried.current.has(activePoiId)) {
        clipRetried.current.add(activePoiId)
        void recoverStalledClip(activePoiId)
        return
      }
      onClipDone(activePoiId)
    }, CLIP_STALL_MS)
    return () => {
      if (stallTimer.current) {
        clearTimeout(stallTimer.current)
        stallTimer.current = null
      }
      if (skeletonTimer.current) {
        clearTimeout(skeletonTimer.current)
        skeletonTimer.current = null
      }
    }
  }, [activePoiId, reloadKey, player, onClipDone, recoverStalledClip])

  // Clip end → back to companionable silence (ducked audio restores itself).
  // FRESH means audio actually ADVANCED — expo-audio flips `playing` true on the play()
  // INTENT while a stream buffers forever, so trusting it let a stalled clip evade the
  // watchdog (the field hang: a sheet frozen at 0:00 on thin 5G).
  useEffect(() => {
    if (activePoiId === null) return
    const t = status.currentTime ?? 0
    if (status.duration != null && status.duration > 0) durationRef.current = status.duration
    // Track forward progress for the post-start interruption/stall recovery below. (audit #1)
    if (t > lastProgressTime.current + 0.05) {
      lastProgressTime.current = t
      lastProgressAt.current = Date.now()
      resumeTried.current = false
    }
    if (status.playing && (status.currentTime ?? 0) > 0.25 && !sawFresh.current) {
      // Real audio is advancing — take EXCLUSIVE focus (pause the rider's audio) only NOW, not
      // at clip-load, so a silent pre-buffer / dead-zone skip never interrupts it. Present the
      // sheet on a live clip (not a frozen 0:00), upgrading any skeleton the grace showed first.
      sawFresh.current = true
      setExclusiveAudio(true)
      setClipReady(true)
      setSheetPoiId(activePoiId)
      if (skeletonTimer.current) {
        clearTimeout(skeletonTimer.current)
        skeletonTimer.current = null
      }
    }
    if (
      status.didJustFinish &&
      sawFresh.current &&
      !scrubbingRef.current && // a scrub through the final seconds isn't an end
      finishedPoi.current !== activePoiId
    ) {
      finishedPoi.current = activePoiId
      onClipDone(activePoiId)
    }
  }, [status.playing, status.didJustFinish, status.currentTime, activePoiId, onClipDone, setExclusiveAudio])

  // ---- post-start interruption / stall recovery (audit #1) ----
  // Mirrors useDrive: once a clip has STARTED (sawFresh), expo-audio fires no didJustFinish if the OS
  // pauses it for an interruption (call / Siri / Bluetooth or headphone handoff) or it buffer-dies
  // mid-clip — and the pre-start stall watchdog already bailed. Without this, clipBusy latches and the
  // roam companion goes silent for the session. Poll for a frozen clock; resume once, then complete.
  useEffect(() => {
    if (activePoiId === null) return
    const iv = setInterval(() => {
      if (pausedRef.current) return // user-paused — don't fight it
      const poi = activePoiId
      if (!sawFresh.current || finishedPoi.current === poi) return
      switch (
        decideStall({
          now: Date.now(),
          lastProgressAt: lastProgressAt.current,
          lastProgressTime: lastProgressTime.current,
          duration: durationRef.current,
          resumeTried: resumeTried.current,
        })
      ) {
        case 'wait':
          return
        case 'completeAtEnd': // effectively at the end but didJustFinish never fired (don't replay)
          finishedPoi.current = poi
          onClipDone(poi)
          return
        case 'resume':
          resumeTried.current = true
          try {
            player.play() // resume after the interruption (no-op if already playing)
          } catch {}
          lastProgressAt.current = Date.now() // grace window for the resume to take
          return
        case 'giveUp':
          onClipDone(poi) // resume didn't take — don't strand the session on a dead clip
          return
      }
    }, 2_000)
    return () => clearInterval(iv)
  }, [activePoiId, player, onClipDone])

  // Drop the pending seek target once the clock catches it, so a later ±15 tap re-bases on
  // the real position instead of a stale target (mirrors useDrive's seek bookkeeping).
  useEffect(() => {
    if (seekTarget.current != null && status.currentTime != null && seekTargetReached(status.currentTime, seekTarget.current)) {
      seekTarget.current = null
    }
  }, [status.currentTime])

  // Session tick (roaming only): the GPS quiet-watchdog (live) + the diagnostics line
  // (fix age + nearest pin) that lets a real-road alpha test self-diagnose.
  useEffect(() => {
    if (phase !== 'roaming') return
    const t = setInterval(() => {
      if (mode === 'live') setGpsSearching(Date.now() - lastFixAt.current > GPS_QUIET_MS)
      const pos = lastFixPos.current
      // nearestM feeds both the (dev/sim/showDiag) diagnostics readout AND the idle RoamMotif's
      // loop-speed "breathing" (the car token quickens as a pin nears) — charm, so it runs every
      // tick. Cheap: O(pins) haversines over a few hundred rows / 2s. The per-GPS-fix hot path is
      // the RoamEngine, which is spatially bucketed (@skipper/engine), not this readout tick.
      let nearestM: number | null = null
      if (pos) {
        for (const p of pinsRef.current) {
          const d = haversineMeters([pos.lng, pos.lat], [p.lng, p.lat])
          if (nearestM === null || d < nearestM) nearestM = d
        }
      }
      setDiag({
        fixAgeSec: lastFixAt.current ? Math.round((Date.now() - lastFixAt.current) / 1000) : null,
        nearestM: nearestM === null ? null : Math.round(nearestM),
      })
      // Surface the position on the same bounded tick (the roam map's puck) — a glanceable 2s
      // cadence — but ONLY when it actually moved, so a stationary rider doesn't churn a fresh
      // position object (and re-render the memoized RoamMap) every 2s. (audit #603)
      const prev = lastPublishedPos.current
      if ((pos?.lat ?? null) !== (prev?.lat ?? null) || (pos?.lng ?? null) !== (prev?.lng ?? null)) {
        lastPublishedPos.current = pos ? { lat: pos.lat, lng: pos.lng } : null
        setPosition(pos ? { lat: pos.lat, lng: pos.lng } : null)
      }
    }, 2_000)
    return () => clearInterval(t)
  }, [phase, mode])

  // Defensive: a dropped setExclusiveAudio(false) flip (fire-and-forget) could leave the rider's audio
  // paused. On return to the foreground while NOT actively narrating, re-issue the release. (audit #210)
  useEffect(() => {
    if (phase !== 'roaming') return
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && !clipBusy.current) setExclusiveAudio(false)
    })
    return () => sub.remove()
  }, [phase, setExclusiveAudio])

  const setChattiness = useCallback((level: ChattinessLevel) => {
    setChattinessState(level)
    engineRef.current?.setMinGap(CHATTINESS_GAP_SEC[level])
  }, [])

  // The session body AFTER permission is settled (live) or for sim: locate → manifest → engine →
  // subscribe the source → opener. Shared by start()'s already-granted path and the explainer CTA.
  const beginRoamSession = useCallback(async () => {
    try {
      setPhase('loading')
      // A new session must not read the prior one's last fix (a stale puck / nearest-pin flash at the
      // next start until the first fresh fix lands). (audit #1014)
      lastFixPos.current = null
      lastPublishedPos.current = null
      lastFixAt.current = 0
      // Open in the SHARED mode: the rider's audio plays untouched through the quiet idle —
      // we only take exclusive focus (doNotMix) when a clip actually starts sounding.
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: true,
        interruptionMode: 'mixWithOthers',
      }).catch(() => {})

      // Where are we? (sim: a fixed demo polyline through the corpus's basin — same roads it covers.)
      let here: { lat: number; lng: number }
      let simPolyline: LngLat[] | null = null
      if (mode === 'sim') {
        // Drive a FIXED demo line through the South/West shore (no tour/drive dependency — a fresh
        // rider has neither). Enough points for simulatedSource to roll the rider past roam pins.
        const demo: LngLat[] = [
          [-119.977, 38.945],
          [-120.01, 38.935],
          [-120.045, 38.93],
          [-120.08, 38.94],
          [-120.1, 38.954],
          [-120.11, 38.965],
        ]
        simPolyline = demo
        const [lng, lat] = demo[0]!
        here = { lat, lng }
      } else {
        // Time-box the cold-fix locate — getCurrentPositionAsync has no built-in timeout, and the
        // 'loading' phase has no watchdog, so an indoor/canyon start would wedge here forever. (audit #156)
        const loc = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Location timed out.')), LOCATE_TIMEOUT_MS),
          ),
        ])
        here = { lat: loc.coords.latitude, lng: loc.coords.longitude }
      }

      const manifest = await getRoamManifest(here.lat, here.lng)
      if (!mountedRef.current) return
      if (manifest.pins.length === 0) {
        setPhase('noCoverage')
        return
      }
      pinsRef.current = manifest.pins
      setPinCount(manifest.pins.length)
      setMapPins(
        manifest.pins.map((p) => ({ poiId: p.poiId, name: p.name, lat: p.lat, lng: p.lng })),
      )
      setToldCount(0)
      clipRetried.current.clear() // a new session earns every clip a fresh recovery
      engineRef.current = new RoamEngine(
        manifest.pins.map((p) => ({
          poiId: p.poiId,
          lat: p.lat,
          lng: p.lng,
          durationMs: p.durationMs,
          // Kind-aware server radius (areal places get room); engine floor covers absence.
          ...(p.radiusM != null ? { radiusM: p.radiusM } : {}),
          name: p.name,
        })),
        { minGapSec: CHATTINESS_GAP_SEC[chattiness] },
      )

      const source =
        mode === 'sim'
          ? simulatedSource(simPolyline!, { mph: 45, timeScale: 6 })
          : liveRoamSource()
      lastFixAt.current = Date.now()
      subRef.current = source(
        (fix) => {
          lastFixAt.current = Date.now()
          lastFixPos.current = { lat: fix.lat, lng: fix.lng }
          const events = engineRef.current?.update(fix) ?? []
          if (events.length > 0) {
            for (const e of events) queueRef.current.push(e.poiId)
            pump()
          }
        },
        undefined, // a roam session has no end-of-route
        (err) => {
          if (!mountedRef.current) return
          setError(errorMessage(err, voice.player.gpsError))
          setPhase('error')
          teardown()
        },
      )
      activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {})
      // Session start: one line from the placeless rotating pool, then settle into idle.
      const pool = voice.roam.sessionStart
      setOpenerLine(pool[Math.floor(Math.random() * pool.length)]!)
      setPhase('sessionStart')
      settleTimer.current = setTimeout(() => {
        if (mountedRef.current) setPhase((p) => (p === 'sessionStart' ? 'roaming' : p))
      }, SESSION_START_MS)
    } catch (e) {
      if (!mountedRef.current) return
      setError(errorMessage(e, voice.error.generic))
      setPhase('error')
    }
  }, [mode, chattiness, pump, teardown])

  // ---- location-permission priming (live mode) — the prime → prompt → result SHELL, shared with
  // useDrive via useLocationPriming. The hook owns the double-tap guard, the no-prompt status read →
  // undetermined-gate, the request-through, the defensive catch, and the finally; it hands the RESULT
  // back so we route it into THIS session's `gate` object + phase setter + async beginRoamSession. ----
  const { priming, start: startPrimedRoam, confirmLocationPrime } = useLocationPriming({
    // Granted + precise → begin the session. beginRoamSession is async (locate → manifest → engine);
    // useLocationPriming awaits it, so the request-through holds its pending guard until it settles.
    onGranted: beginRoamSession,
    // Roam FOLDS a hard denial and granted-but-reduced into ONE gate object (`granted` is unused):
    // either way the recovery is the same Settings-or-reprompt gate carrying {canAskAgain, reduced}.
    onDenied: ({ canAskAgain, reduced }) => {
      setGate({ canAskAgain, reduced })
      setPhase('locationGate')
    },
    // The request threw (misconfig / concurrent ask) — show the re-askable gate instead of letting
    // the tap silently do nothing (mirrors useDrive's defensive handling).
    onError: () => {
      setGate({ canAskAgain: true, reduced: false })
      setPhase('locationGate')
    },
  })

  // Reflect the explainer-up signal into the session phase. The pre-permission prime is just another
  // phase for roam's explicit state machine (unlike useDrive, which derives its phase from `priming`):
  // when the hook raises the explainer we enter 'locationPrime'; leaving it is the result-routing's job
  // (beginRoamSession → 'loading', onDenied/onError → 'locationGate'), so we never flip it back here.
  useEffect(() => {
    if (priming) setPhase('locationPrime')
  }, [priming])

  const start = useCallback(() => {
    if (startPending.current) return
    startPending.current = true
    ;(async () => {
      try {
        setError(null)
        setGate(null)
        if (mode === 'live') {
          // The shared shell: prime before iOS's one-shot prompt (first time), else request straight
          // through. Its own double-tap guard + the result-routing callbacks above carry it the rest.
          startPrimedRoam()
          return
        }
        await beginRoamSession()
      } finally {
        startPending.current = false
      }
    })()
  }, [mode, beginRoamSession, startPrimedRoam])

  // Re-attempt after an error (the dead-end error screen's CTA). The fix-source error path runs
  // teardown(), so a retry must rebuild the WHOLE session — re-run the begin flow. We clear the
  // pending guard first so a retry never no-ops on a stuck guard (mirrors useDrive.retry, which
  // re-runs its load effect rather than reusing the "start" action). (audit: roam dead-end)
  const retry = useCallback(() => {
    startPending.current = false
    start()
  }, [start])

  const skip = useCallback(() => {
    if (activePoiId !== null) {
      try {
        player.pause()
      } catch {}
      onClipDone(activePoiId)
    }
  }, [activePoiId, player, onClipDone])

  const end = useCallback(() => {
    teardown()
    setActivePoiId(null)
    setSheetPoiId(null)
    setClipReady(false)
    setGpsSearching(false)
    setPosition(null) // drop the map puck; mapPins reset on the next start
    setPhase('signoff') // toldCount survives for the tally; finishSignoff resets
  }, [teardown])

  const finishSignoff = useCallback(() => {
    setPhase('idle')
  }, [])

  // The sheet keys on sheetPoiId, NOT activePoiId: a clip is selected (activePoiId) and loads
  // SILENTLY; the sheet only appears once it's ready to play (or the skeleton grace fires).
  const activeName =
    sheetPoiId === null
      ? null
      : (pinsRef.current.find((p) => p.poiId === sheetPoiId)?.name ?? null)
  const activeDurationMs =
    sheetPoiId === null
      ? 0
      : (pinsRef.current.find((p) => p.poiId === sheetPoiId)?.durationMs ?? 0)
  // The sheet is up but audio hasn't started — a slow-buffer / dead-zone skeleton.
  const clipBuffering = sheetPoiId !== null && !clipReady

  // ---- encounter transport (the standard story-player controls, reused 1:1) ----
  // Prefer the real decoded duration; the manifest's durationMs covers the pre-load gap.
  const clipDurSec =
    status.duration && status.duration > 0 ? status.duration : activeDurationMs / 1000
  const clipCanSeek = activePoiId !== null && !!status.isLoaded && clipDurSec > 0

  const seekClipTo = useCallback(
    (ms: number) => {
      if (!clipCanSeek) return
      const target = clampSeekSec(ms, clipDurSec)
      seekTarget.current = target
      try {
        player.seekTo(target)
      } catch {}
    },
    [clipCanSeek, clipDurSec, player],
  )

  const seekClipBy = useCallback(
    (deltaSec: number) => {
      if (!clipCanSeek) return
      // Prefer the pending command over the lagging clock so rapid taps accumulate.
      const base = seekTarget.current ?? status.currentTime ?? 0
      seekClipTo((base + deltaSec) * 1000)
    },
    [clipCanSeek, status.currentTime, seekClipTo],
  )

  const toggleClipPlay = useCallback(() => {
    if (activePoiId === null) return
    setClipPaused((p) => {
      const next = !p
      pausedRef.current = next
      try {
        // Pausing hands focus back so the rider's audio resumes while held; resuming re-takes
        // exclusive focus (re-pauses it) under the skipper. Release focus AFTER pausing our
        // clip, re-take it BEFORE resuming, so the two streams never both sound.
        if (next) {
          player.pause()
          setExclusiveAudio(false)
        } else {
          setExclusiveAudio(true)
          player.play()
        }
      } catch {}
      return next
    })
  }, [activePoiId, player, setExclusiveAudio])

  const setClipScrubbing = useCallback((active: boolean) => {
    scrubbingRef.current = active
  }, [])

  return {
    phase,
    mode,
    error,
    gate,
    pinCount,
    activeName,
    clipPositionMs: (status.currentTime ?? 0) * 1000,
    clipDurationMs: clipDurSec * 1000,
    clipPlaying: !clipPaused,
    clipCanSeek,
    clipBuffering,
    toggleClipPlay,
    seekClipTo,
    seekClipBy,
    setClipScrubbing,
    toldCount,
    diag,
    position,
    mapPins,
    openerLine,
    chattiness,
    setChattiness,
    gpsSearching,
    start,
    retry,
    confirmLocationPrime,
    skip,
    end,
    finishSignoff,
  }
}
