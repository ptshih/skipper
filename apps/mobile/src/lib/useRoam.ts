// useRoam — the FREE-ROAM session hook (alpha). The skipper rides shotgun on the rider's
// OWN drive: no route, no tour shape — fetch the roam pins near here, feed live GPS fixes
// to the RoamEngine (proximity + heading + governors; @skipper/drive-core/roam), and play
// each fired encounter through a FIFO queue. State machine per the design handoff:
//   idle → sessionStart → roaming ⇄ (encounter sheet) ; roaming → signoff → idle
//
// Deliberate differences from useDrive (the tour player):
//   - AUDIO SESSION = `duckOthers`, not `doNotMix`: roam's whole premise is piping up OVER
//     the rider's podcast/music and getting out of the way. And NO lock-screen Now Playing
//     claim — `setActiveForLockScreen` is documented to want doNotMix, and an ambient 60s
//     encounter doesn't need transport controls (alpha cut; revisit with the duck-flip).
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
  /** Clip progress for the sheet's thin non-interactive bar. */
  clipElapsedSec: number
  clipDurationSec: number
  /** Encounters told this session (the stat pill + the sign-off tally). */
  toldCount: number
  /** Alpha drive-test diagnostics: seconds since the last accepted fix + straight-line
   *  distance to the nearest pin. The line that lets a real road test self-diagnose. */
  diag: { fixAgeSec: number | null; nearestM: number | null }
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
  const [activePoiId, setActivePoiId] = useState<string | null>(null)
  const [toldCount, setToldCount] = useState(0)
  const [openerLine, setOpenerLine] = useState<string>(voice.roam.sessionStart[0]!)
  const [chattiness, setChattinessState] = useState<ChattinessLevel>('normal')
  const [gpsSearching, setGpsSearching] = useState(false)
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
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sawFresh = useRef(false)
  const clipRetried = useRef<Set<string>>(new Set()) // poiIds given the one stall recovery

  const player = useAudioPlayer()
  const status = useAudioPlayerStatus(player)

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
    if (settleTimer.current) {
      clearTimeout(settleTimer.current)
      settleTimer.current = null
    }
    try {
      player.pause()
    } catch {}
    deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {})
  }, [player])

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
      // The tally counts encounters that made SOUND — a stall-skipped clip the rider
      // never heard isn't a story told.
      if (sawFresh.current) setToldCount((n) => n + 1)
      setActivePoiId((cur) => (cur === poiId ? null : cur))
      clipBusy.current = false
      pump()
    },
    [pump],
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
    finishedPoi.current = null
    try {
      player.pause()
    } catch {}
    player.replace({ uri: pin.url })
    player.play()
    stallTimer.current = setTimeout(() => {
      if (sawFresh.current) return
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
    }
  }, [activePoiId, reloadKey, player, onClipDone, recoverStalledClip])

  // Clip end → back to companionable silence (ducked audio restores itself).
  // FRESH means audio actually ADVANCED — expo-audio flips `playing` true on the play()
  // INTENT while a stream buffers forever, so trusting it let a stalled clip evade the
  // watchdog (the field hang: a sheet frozen at 0:00 on thin 5G).
  useEffect(() => {
    if (activePoiId === null) return
    if (status.playing && (status.currentTime ?? 0) > 0.25) sawFresh.current = true
    if (status.didJustFinish && sawFresh.current && finishedPoi.current !== activePoiId) {
      finishedPoi.current = activePoiId
      onClipDone(activePoiId)
    }
  }, [status.playing, status.didJustFinish, status.currentTime, activePoiId, onClipDone])

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
        // duckOthers: encounters pipe up over the rider's own audio and get out of the way.
        await setAudioModeAsync({
          playsInSilentMode: true,
          shouldPlayInBackground: true,
          interruptionMode: 'duckOthers',
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
    setGpsSearching(false)
    setPhase('signoff') // toldCount survives for the tally; finishSignoff resets
  }, [teardown])

  const finishSignoff = useCallback(() => {
    setPhase('idle')
  }, [])

  const activeName =
    activePoiId === null
      ? null
      : (pinsRef.current.find((p) => p.poiId === activePoiId)?.name ?? null)
  const activeDurationMs =
    activePoiId === null
      ? 0
      : (pinsRef.current.find((p) => p.poiId === activePoiId)?.durationMs ?? 0)

  return {
    phase,
    mode,
    error,
    gate,
    pinCount,
    activeName,
    clipElapsedSec: status.currentTime ?? 0,
    clipDurationSec: activeDurationMs / 1000,
    toldCount,
    diag,
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
