// useRoam — the FREE-ROAM session hook (alpha). The skipper rides shotgun on the rider's
// OWN drive: no route, no tour shape — fetch the roam pins near here, feed live GPS fixes
// to the RoamEngine (proximity + heading + governors; @skipper/drive-core/roam), and play
// each fired encounter through a FIFO queue.
//
// Deliberate differences from useDrive (the tour player):
//   - AUDIO SESSION = `duckOthers`, not `doNotMix`: roam's whole premise is piping up OVER
//     the rider's podcast/music and getting out of the way. And NO lock-screen Now Playing
//     claim — `setActiveForLockScreen` is documented to want doNotMix, and an ambient 60s
//     encounter doesn't need transport controls (alpha cut; revisit with the duck-flip).
//   - No offline pack (alpha streams presigned URLs), no re-sign-on-stall (a stalled clip
//     just skips — the manifest's URLs outlive any one session), no music bed (the rider's
//     own audio IS the bed), no end-of-route (the session ends when the rider ends it).
//
// Sim mode (couch/dev): replays the first ready tour's polyline through the SAME engine —
// same fix data a real drive would produce, so triggers behave exactly as on the road.

import { useCallback, useEffect, useRef, useState } from 'react'
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import * as Location from 'expo-location'
import { RoamEngine } from '@skipper/drive-core'
import type { LngLat } from '@skipper/drive-core'
import { errorMessage, getRoamManifest, getTour, listTours } from './api'
import type { RoamManifest } from './api'
import { ensureDrivePermission, liveRoamSource, simulatedSource } from './gps'
import type { FixSubscription } from './gps'
import { voice } from '@/ui/voice'

export type RoamMode = 'live' | 'sim'

export type RoamPhase =
  | 'idle' // pre-session (the start card)
  | 'locationGate' // live only: permission denied / reduced
  | 'loading' // locating + fetching the manifest
  | 'error'
  | 'noCoverage' // manifest came back empty — outside the known roads
  | 'roaming' // session live

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

export interface RoamState {
  phase: RoamPhase
  mode: RoamMode
  error: string | null
  gate: RoamGateInfo | null
  /** Pins in range (the manifest), for the "<n> stories in range" line. */
  pinCount: number
  /** The encounter currently PLAYING (null = companionable silence). */
  activeName: string | null
  /** Encounters told this session. */
  toldCount: number
  gpsSearching: boolean
  start: () => void
  end: () => void
}

export function useRoam(mode: RoamMode): RoamState {
  const [phase, setPhase] = useState<RoamPhase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [gate, setGate] = useState<RoamGateInfo | null>(null)
  const [pinCount, setPinCount] = useState(0)
  const [activePoiId, setActivePoiId] = useState<string | null>(null)
  const [toldCount, setToldCount] = useState(0)
  const [gpsSearching, setGpsSearching] = useState(false)

  const engineRef = useRef<RoamEngine | null>(null)
  const pinsRef = useRef<RoamManifest['pins']>([])
  const queueRef = useRef<string[]>([]) // fired poiIds waiting to play (FIFO)
  const clipBusy = useRef(false)
  const subRef = useRef<FixSubscription | null>(null)
  const mountedRef = useRef(true)
  const startPending = useRef(false) // a start flow is in flight — blocks double-tap
  const lastFixAt = useRef(0)
  const finishedPoi = useRef<string | null>(null) // didJustFinish double-fire guard
  const stallTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sawFresh = useRef(false)

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
      setToldCount((n) => n + 1)
      setActivePoiId((cur) => (cur === poiId ? null : cur))
      clipBusy.current = false
      pump()
    },
    [pump],
  )

  // Clip load/play, keyed on the active encounter (the useDrive pattern, leaner: no
  // pause, no re-sign — a clip that won't start within the grace is skipped).
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
      if (!sawFresh.current) onClipDone(activePoiId)
    }, CLIP_STALL_MS)
    return () => {
      if (stallTimer.current) {
        clearTimeout(stallTimer.current)
        stallTimer.current = null
      }
    }
  }, [activePoiId, player, onClipDone])

  // Clip end → back to companionable silence (ducked audio restores itself).
  useEffect(() => {
    if (activePoiId === null) return
    if (status.playing && !status.didJustFinish) sawFresh.current = true
    if (status.didJustFinish && sawFresh.current && finishedPoi.current !== activePoiId) {
      finishedPoi.current = activePoiId
      onClipDone(activePoiId)
    }
  }, [status.playing, status.didJustFinish, activePoiId, onClipDone])

  // Live GPS quiet-watchdog (roaming only): surface "looking for satellites".
  useEffect(() => {
    if (phase !== 'roaming' || mode !== 'live') return
    const t = setInterval(() => {
      setGpsSearching(Date.now() - lastFixAt.current > GPS_QUIET_MS)
    }, 2_000)
    return () => clearInterval(t)
  }, [phase, mode])

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
        engineRef.current = new RoamEngine(
          manifest.pins.map((p) => ({
            poiId: p.poiId,
            lat: p.lat,
            lng: p.lng,
            durationMs: p.durationMs,
            name: p.name,
          })),
        )

        const source =
          mode === 'sim'
            ? simulatedSource(simPolyline!, { mph: 45, timeScale: 6 })
            : liveRoamSource()
        lastFixAt.current = Date.now()
        subRef.current = source(
          (fix) => {
            lastFixAt.current = Date.now()
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
        setPhase('roaming')
      } catch (e) {
        if (!mountedRef.current) return
        setError(errorMessage(e, voice.error.generic))
        setPhase('error')
      } finally {
        startPending.current = false
      }
    })()
  }, [mode, pump, teardown])

  const end = useCallback(() => {
    teardown()
    setActivePoiId(null)
    setPhase('idle')
    setGpsSearching(false)
  }, [teardown])

  const activeName =
    activePoiId === null
      ? null
      : (pinsRef.current.find((p) => p.poiId === activePoiId)?.name ?? null)

  return {
    phase,
    mode,
    error,
    gate,
    pinCount,
    activeName,
    toldCount,
    gpsSearching,
    start,
    end,
  }
}
