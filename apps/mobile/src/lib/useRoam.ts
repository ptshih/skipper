// useRoam — the FREE-ROAM session hook (alpha). The skipper rides shotgun on the rider's
// OWN drive: no route, no tour shape — fetch the roam pins near here, feed live GPS fixes
// to the RoamEngine (proximity + heading + governors; @skipper/drive-core/roam), and play
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
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import * as Location from 'expo-location'
import { haversineMeters, RoamEngine } from '@skipper/drive-core'
import type { LngLat } from '@skipper/drive-core'
import { errorMessage, getRoamManifest, getTour, listTours } from './api'
import type { RoamManifest } from './api'
import { ensureDrivePermission, liveRoamSource, simulatedSource } from './gps'
import type { FixSubscription } from './gps'
import type { ChattinessLevel } from '@/ui'
import { voice } from '@/ui/voice'

export type RoamMode = 'live' | 'sim'

export type RoamPhase =
  | 'idle' // pre-session (the entry/start surface)
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
  /** Skip the playing encounter (the sheet's ghost action / scrim tap). */
  skip: () => void
  /** Hand-end the session → the sign-off state (teardown happens here). */
  end: () => void
  /** Leave the sign-off → back to idle/entry. */
  finishSignoff: () => void
}

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
  const startPending = useRef(false) // a start flow is in flight — blocks double-tap
  const lastFixAt = useRef(0)
  const lastFixPos = useRef<{ lat: number; lng: number } | null>(null)
  const finishedPoi = useRef<string | null>(null) // didJustFinish double-fire guard
  const stallTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skeletonTimer = useRef<ReturnType<typeof setTimeout> | null>(null) // present-the-sheet-anyway fallback
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sawFresh = useRef(false)
  const clipRetried = useRef<Set<string>>(new Set()) // poiIds given the one stall recovery
  const pausedRef = useRef(false) // mirrors clipPaused for the stall watchdog
  const scrubbingRef = useRef(false) // a scrub drag is live — hold the clip-finished handler
  const seekTarget = useRef<number | null>(null) // pending seek (sec), so ±15 taps accumulate

  const player = useAudioPlayer()
  const status = useAudioPlayerStatus(player)

  // Pause+resume focus toggle (founder 2026-06-11): the rider's audio is interrupted ONLY
  // while the skipper is actually talking. exclusive=true → `doNotMix` (pauses the rider's
  // app); exclusive=false → `mixWithOthers` (hands focus back so it resumes). expo-audio has
  // no explicit session-deactivate — flipping the interruption mode IS the release mechanism
  // (SDK 56 docs). Fire-and-forget; a failed flip just leaves the prior focus, never throws.
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
      setSheetPoiId((cur) => (cur === poiId ? null : cur)) // dismiss the sheet (or its skeleton)
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
          if (fresh.pins.length > 0) pinsRef.current = fresh.pins
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

  // Drop the pending seek target once the clock catches it, so a later ±15 tap re-bases on
  // the real position instead of a stale target (mirrors useDrive's seek bookkeeping).
  useEffect(() => {
    if (
      seekTarget.current != null &&
      status.currentTime != null &&
      Math.abs(status.currentTime - seekTarget.current) < 0.4
    ) {
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
      // Surface the position on the same bounded tick (the roam map's puck) — a glanceable
      // 2s cadence, so the screen doesn't re-render on every raw fix.
      setPosition(pos ? { lat: pos.lat, lng: pos.lng } : null)
    }, 2_000)
    return () => clearInterval(t)
  }, [phase, mode])

  const setChattiness = useCallback((level: ChattinessLevel) => {
    setChattinessState(level)
    engineRef.current?.setMinGap(CHATTINESS_GAP_SEC[level])
  }, [])

  const start = useCallback(() => {
    if (startPending.current) return
    startPending.current = true
    ;(async () => {
      try {
        setError(null)
        setGate(null)
        if (mode === 'live') {
          const perm = await ensureDrivePermission()
          if (!mountedRef.current) return
          if (!perm.granted || perm.reduced) {
            setGate({ canAskAgain: perm.canAskAgain, reduced: perm.reduced })
            setPhase('locationGate')
            return
          }
        }
        setPhase('loading')
        // Open in the SHARED mode: the rider's audio plays untouched through the quiet idle —
        // we only take exclusive focus (doNotMix) when a clip actually starts sounding.
        await setAudioModeAsync({
          playsInSilentMode: true,
          shouldPlayInBackground: true,
          interruptionMode: 'mixWithOthers',
        }).catch(() => {})

        // Where are we? (sim: the demo polyline's start — same roads the corpus covers.)
        let here: { lat: number; lng: number }
        let simPolyline: LngLat[] | null = null
        if (mode === 'sim') {
          const tours = await listTours()
          const first = tours.tours[0]
          if (!first) throw new Error('No ready tour to simulate along.')
          const detail = await getTour(first.id, { preview: true })
          simPolyline = detail.tour.polyline as LngLat[]
          const [lng, lat] = simPolyline[0]!
          here = { lat, lng }
        } else {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          })
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
      } finally {
        startPending.current = false
      }
    })()
  }, [mode, chattiness, pump, teardown])

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
      const target = Math.min(clipDurSec, Math.max(0, ms / 1000))
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
    skip,
    end,
    finishSignoff,
  }
}
