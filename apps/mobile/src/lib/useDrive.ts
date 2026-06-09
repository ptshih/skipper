// useDrive — the live, GPS-triggered driving player.
//
// This is the Phase-2 core: it owns the trigger engine, the audio player, the
// lock-screen Now Playing, and the fire-queue, and it's driven by a swappable
// `GpsFixSource` (today the simulated one — couch-testable on the iOS Simulator).
//
// It REUSES the preview player's proven audio machinery verbatim (clip load/play,
// lock-screen metadata, the stall watchdog + re-sign for expired presigned URLs, seek).
// What it REPLACES is the clock: instead of a `setTimeout(previewMs)` segment driver
// that auto-advances on `didJustFinish`, each GpsFix runs `engine.update(fix)` and any
// stop that fires is queued and played. A finished clip returns to ducked-quiet and
// WAITS for the next GPS trigger — it never advances by a clip ending. See
// docs/gps-player-spec.md §3.5.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Animated, AppState, Linking } from 'react-native'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import {
  bracketKindForSeq,
  cumulativeMeters,
  DEFAULT_MAX_OFF_ROUTE_M,
  DEFAULT_TRIGGER,
  INTRO_SEQ,
  OUTRO_SEQ,
  snapStopsToRoute,
  TriggerEngine,
  type GpsFix,
} from '@skipper/drive-core'
import { ApiError } from './api'
import { loadPlayback, resignPlayback } from './offline'
import {
  ensureDrivePermission,
  getDrivePermission,
  liveSource,
  simulatedSource,
  type FixSubscription,
} from './gps'
import { useDriveMusic } from './driveMusic'
import { voice } from '@/ui'

// Grace before a clip that hasn't started is treated as stalled — same generous window
// as the preview (32k MP3 clips, 1h presigned URLs → re-sign once on a stall).
const CLIP_STALL_MS = 12_000

// Lock-screen / NOW-card title for a bracket clip (intro/outro aren't in the stop list).
const bracketTitle = (kind: 'intro' | 'outro'): string =>
  kind === 'intro' ? 'Welcome aboard' : 'One for the road'

// Real drive speed for the simulator (mph). A FIXED 60 for now; the trigger lead is
// speed-adaptive in @skipper/drive-core, so this is the only knob that matters here.
const SIM_MPH = 60
// "Fast" sim multiplier: replay the same fixes 8× sooner so a full drive triggers in
// a couple minutes on the couch (the fix DATA — speeds, headings — is unchanged).
const SIM_FAST_SCALE = 8

// The audio interruption mode for the drive. KEPT as 'doNotMix' (the proven-safe default that
// keeps lock-screen Now Playing working on the simulator). Phase 0 — the audio-duck spike —
// flips this ONE line to 'duckOthers' and verifies on a device that ducking the rider's music
// and lock-screen Now Playing coexist (the spec's riskiest assumption). Since Phase 4 forces a
// dev build anyway, do the flip + Spotify test in that same session. The flip is JS-only
// (hot-reloadable, no native rebuild). See spec §3.5 / §7 (Phase 0).
const DRIVE_INTERRUPTION_MODE = 'doNotMix' as const

// Keep-awake lock tag — the foreground GPS watch dies on screen-lock, so hold the screen on
// while actively driving (scoped to `driving`, not the whole screen). (spec §5)
const KEEP_AWAKE_TAG = 'skipper-drive'

// No accepted live fix for this long → surface a "searching for GPS" note rather than a silently
// frozen screen (covers slow acquisition + persistently poor accuracy). (review #6)
const GPS_SEARCH_MS = 8_000

interface DriveStop {
  seq: number
  name: string
  stopType: string
  lat: number
  lng: number
  triggerRadiusM: number
  audioDurationMs: number | null | undefined
}

interface DriveData {
  tourName: string
  region: string
  /** The narrating host's display name, from the API — never bundled (host-agnostic). */
  hostName: string
  polyline: [number, number][]
  /** Total route length (m) — for projecting a fix's alongM onto a 0..1 progress dot. */
  totalM: number
  stops: DriveStop[]
}

export type DrivePhase =
  | 'loading'
  | 'error'
  | 'gate'
  | 'locationGate'
  | 'ready'
  | 'driving'
  | 'done'

export interface DriveStopView {
  seq: number
  name: string
  stopType: string
}

export interface UseDrive {
  phase: DrivePhase
  error: string | null
  retry: () => void

  tourName: string
  region: string
  /** The narrating host's display name, served by the API (never bundled). */
  hostName: string
  stops: DriveStopView[]
  totalStops: number
  firedCount: number

  /** 0..1 route position for `RouteTrack`, driven imperatively by each GPS fix. */
  progress: Animated.Value
  /** The stop whose clip is currently loaded/playing, or null between stops (ducked-quiet).
   *  A bracket carries its sentinel seq; use `activeBracket` to tell intro/outro apart. */
  activeSeq: number | null
  /** Set while the intro/outro bracket clip is the active audio (vs a real stop or quiet). */
  activeBracket: 'intro' | 'outro' | null
  /** Seqs whose trigger has fired (for the stop list's passed/active states). */
  firedSeqs: Set<number>
  /** First not-yet-fired stop, for the "ROLLING · next stop: X" strip. */
  nextSeq: number | null

  nowPlaying: boolean
  buffering: boolean
  stallNote: string | null
  /** True while a live drive is getting no usable GPS fixes — show a "searching" cue. (review #6) */
  gpsSearching: boolean
  paused: boolean

  // In-clip scrub (drive/quiet segments have no timeline).
  positionMs: number
  durationMs: number
  canSeek: boolean
  seekToMs: (ms: number) => void
  seekBy: (deltaSec: number) => void
  setScrubbing: (active: boolean) => void

  // Sim setup (pre-drive only).
  fast: boolean
  setFast: (fast: boolean) => void

  // Location permission (live mode only; null/true in sim mode).
  /** When a live drive is blocked on a denied permission: can the OS still prompt? (false → Settings). */
  locationCanAskAgain: boolean
  /** Deep-link to the app's system Settings (for `canAskAgain === false`). */
  openLocationSettings: () => void

  // Lifecycle.
  start: () => void
  togglePause: () => void
  end: () => void
  restart: () => void
}

export interface UseDriveOptions {
  /** 'sim' = the on-device drive simulator (default, couch-testable); 'live' = real device GPS (Phase 4). */
  mode?: 'sim' | 'live'
}

export function useDrive(tourId: string | undefined, opts: UseDriveOptions = {}): UseDrive {
  const mode = opts.mode ?? 'sim'
  const [data, setData] = useState<DriveData | null>(null)
  const [urls, setUrls] = useState<Map<number, string>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [needsAccount, setNeedsAccount] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const [driving, setDriving] = useState(false)
  const [paused, setPaused] = useState(false)
  const [done, setDone] = useState(false)
  const [activeSeq, setActiveSeq] = useState<number | null>(null)
  const [firedSeqs, setFiredSeqs] = useState<Set<number>>(new Set())
  const [stallNote, setStallNote] = useState<string | null>(null)
  const [fast, setFast] = useState(false)
  // Set when a live drive is blocked on a denied location permission (carries whether the OS
  // will still prompt). null = no block (always so in sim mode). Drives the 'locationGate' phase.
  const [locationDenied, setLocationDenied] = useState<{ canAskAgain: boolean } | null>(null)
  // True while a live drive is getting no usable GPS fixes (acquiring / poor accuracy) — so the
  // rider sees "searching" instead of a silently frozen screen. (review #6)
  const [gpsSearching, setGpsSearching] = useState(false)

  const player = useAudioPlayer()
  const status = useAudioPlayerStatus(player)

  const dot = useRef(new Animated.Value(0)).current

  // Drive engine + fire-queue (refs: mutated from the source's timer callbacks).
  const engineRef = useRef<TriggerEngine | null>(null)
  const queue = useRef<number[]>([]) // fired seqs waiting to play, FIFO
  const clipBusy = useRef(false) // a clip is currently loaded+playing (gates the pump)
  const reachedEnd = useRef(false) // the simulated source has run out of fixes
  const subRef = useRef<FixSubscription | null>(null)
  const mountedRef = useRef(true) // false after unmount — guards setState in the async permission flow (review #4)
  const permPending = useRef(false) // a permission request is in flight — blocks double-tap (review #4)
  const lastFixAt = useRef(0) // ms of the last accepted live fix — feeds the no-GPS watchdog (review #6)
  // Which brackets this tour has (set on load); the intro is queued at start, the outro
  // (once) at the end. Refs so the queueing reads current values without dep churn.
  const bracketsRef = useRef<{ intro: boolean; outro: boolean }>({ intro: false, outro: false })
  const outroQueued = useRef(false)

  // Audio-playback refs (cloned from the preview player).
  const loadedSeq = useRef<number | null>(null) // which clip is loaded in the player
  const sawFresh = useRef(false) // have we seen the LOADED clip actually play yet?
  const finishedSeq = useRef<number | null>(null) // guard didJustFinish double-fire per clip
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clipRetried = useRef<Set<number>>(new Set()) // seqs re-signed once after a stall
  const scrubbing = useRef(false) // a drag is live — hold the clip-finished handler
  const seekTarget = useRef<number | null>(null) // last commanded seek (sec), so ±15 taps add up

  const teardownSource = useCallback(() => {
    subRef.current?.stop()
    subRef.current = null
  }, [])

  // ---- load: tour geometry + presigned audio + the audio session ----
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!tourId) return
      setError(null)
      setNeedsAccount(false)
      try {
        await setAudioModeAsync({
          playsInSilentMode: true,
          shouldPlayInBackground: true,
          interruptionMode: DRIVE_INTERRUPTION_MODE,
        }).catch(() => {})
        // OFFLINE-FIRST: a downloaded tour loads detail + local file:// clips with zero
        // network; otherwise this fetches + signs and streams. The url map keys stops by
        // seq and the brackets under INTRO_SEQ/OUTRO_SEQ, either way.
        const { detail: tour, urls } = await loadPlayback(tourId)
        if (cancelled) return
        const polyline = tour.tour.polyline as [number, number][]
        if (polyline.length < 2) throw new Error('This tour has no drivable route.')
        const cum = cumulativeMeters(polyline)
        bracketsRef.current = { intro: urls.has(INTRO_SEQ), outro: urls.has(OUTRO_SEQ) }
        setUrls(urls)
        setData({
          tourName: tour.tour.headline,
          region: tour.region.displayName,
          hostName: tour.host.name,
          polyline,
          totalM: cum.length > 0 ? (cum[cum.length - 1] ?? 0) : 0,
          stops: tour.stops.map((s) => ({
            seq: s.seq,
            name: s.name,
            stopType: s.stopType,
            lat: s.lat,
            lng: s.lng,
            triggerRadiusM: s.triggerRadiusM,
            audioDurationMs: s.audioDurationMs,
          })),
        })
      } catch (e) {
        if (cancelled) return
        if (e instanceof ApiError && e.needsAccount) setNeedsAccount(true)
        else setError(e instanceof Error ? e.message : 'Failed to load the drive')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [tourId, reloadKey])

  // ---- re-sign expired presigned URLs (online stall only; downloaded files never expire) ----
  const resign = useCallback(async (): Promise<boolean> => {
    if (!tourId) return false
    try {
      const fresh = await resignPlayback(tourId) // local map when downloaded, else freshly re-signed
      if (sawFresh.current) return true // clip started during the re-sign — leave it alone
      loadedSeq.current = null
      setUrls(fresh)
      return true
    } catch {
      return false // offline / 503 — the caller skips the stop so the drive never hangs
    }
  }, [tourId])

  // ---- the whole drive finished (sim ran out + nothing left to play) ----
  const finishDrive = useCallback(() => {
    teardownSource()
    try {
      player.pause()
    } catch {}
    try {
      player.setActiveForLockScreen(false)
    } catch {}
    setActiveSeq(null)
    setDriving(false)
    setDone(true)
  }, [player, teardownSource])

  // ---- pump: if idle, play the next queued stop; else, end the drive if the road's done ----
  const pump = useCallback(() => {
    if (clipBusy.current) return // a clip is playing — wait for it (sequential, no overlap)
    const next = queue.current.shift()
    if (next !== undefined) {
      clipBusy.current = true
      setActiveSeq(next)
      return
    }
    if (reachedEnd.current) finishDrive()
  }, [finishDrive])

  // ---- a clip finished (or was skipped): return to ducked-quiet, then pump the queue ----
  const onClipDone = useCallback(
    (_seq: number) => {
      clipBusy.current = false
      setActiveSeq(null)
      pump()
    },
    [pump],
  )

  // ---- each GPS fix: advance the route dot + run the trigger engine ----
  const handleFix = useCallback(
    (fix: GpsFix) => {
      lastFixAt.current = Date.now() // a usable fix arrived — feed the no-GPS watchdog (review #6)
      setGpsSearching(false) // no-op when already false (React bails on unchanged state)
      const total = data?.totalM ?? 0
      dot.setValue(total > 0 ? Math.min(1, Math.max(0, fix.alongM / total)) : 0)
      const events = engineRef.current?.update(fix) ?? []
      if (events.length === 0) return
      setFiredSeqs((prev) => {
        const n = new Set(prev)
        for (const e of events) n.add(e.seq)
        return n
      })
      for (const e of events) queue.current.push(e.seq)
      pump()
    },
    [data, dot, pump],
  )

  const handleEnd = useCallback(() => {
    reachedEnd.current = true
    // Outro bracket — queued LAST (after any pending stops), so the sign-off plays before
    // the drive actually ends. Queued at most once.
    if (bracketsRef.current.outro && !outroQueued.current) {
      outroQueued.current = true
      queue.current.push(OUTRO_SEQ)
    }
    pump() // plays the outro (or any remaining stop); ends the drive once the queue drains
  }, [pump])

  // ---- reset all drive state back to the pre-drive "ready" line ----
  const resetForReady = useCallback(() => {
    teardownSource()
    if (watchdog.current) {
      clearTimeout(watchdog.current)
      watchdog.current = null
    }
    try {
      player.pause()
    } catch {}
    try {
      player.setActiveForLockScreen(false)
    } catch {}
    engineRef.current = null
    queue.current = []
    clipBusy.current = false
    reachedEnd.current = false
    loadedSeq.current = null
    sawFresh.current = false
    finishedSeq.current = null
    clipRetried.current.clear()
    outroQueued.current = false
    seekTarget.current = null
    dot.setValue(0)
    setActiveSeq(null)
    setFiredSeqs(new Set())
    setStallNote(null)
    setPaused(false)
    setDone(false)
    setDriving(false)
    setLocationDenied(null)
    setGpsSearching(false)
  }, [player, dot, teardownSource])

  // ---- the live fix source couldn't produce GPS (watch failed to acquire) — surface, don't hang ----
  const handleSourceError = useCallback(() => {
    resetForReady()
    setError(voice.player.gpsError) // → 'error' phase with a retry, instead of a silent frozen drive
  }, [resetForReady])

  // ---- begin the drive: fresh engine (TriggerEngine has no reset) + subscribe the source ----
  // The source is the one seam between the simulator and the real drive: a `simulatedSource`
  // (couch-testable) or the `liveSource` (real device GPS), interchangeable behind GpsFixSource.
  const beginDrive = useCallback(() => {
    if (!data) return
    resetForReady()
    // Re-snap RAW POI coords to the route (the API ships raw coords, not trigger points),
    // then drop stops too far off-route to have an honest trigger point. (spec §3.2)
    const snapped = snapStopsToRoute(
      data.polyline,
      data.stops.map((s) => ({
        seq: s.seq,
        lat: s.lat,
        lng: s.lng,
        triggerRadiusM: s.triggerRadiusM,
        durationMs: s.audioDurationMs,
        name: s.name,
        stopType: s.stopType,
      })),
    )
    const triggerable = snapped.filter((s) => s.offRouteM <= DEFAULT_MAX_OFF_ROUTE_M)
    engineRef.current = new TriggerEngine(triggerable, { leadSeconds: DEFAULT_TRIGGER.leadSeconds })
    setDriving(true)
    // Intro bracket — the welcome, played FIRST (before any geofence trigger fires).
    if (bracketsRef.current.intro) {
      queue.current.push(INTRO_SEQ)
      pump()
    }
    const source =
      mode === 'live'
        ? liveSource(data.polyline)
        : simulatedSource(data.polyline, { mph: SIM_MPH, timeScale: fast ? SIM_FAST_SCALE : 1 })
    subRef.current = source(handleFix, handleEnd, handleSourceError)
  }, [data, mode, fast, resetForReady, handleFix, handleEnd, handleSourceError, pump])

  // ---- start: in live mode, gate on location permission first; sim starts immediately ----
  const start = useCallback(() => {
    if (!data) return
    if (mode !== 'live') {
      beginDrive()
      return
    }
    if (permPending.current) return // ignore a double-tap while the OS prompt is up (review #4)
    permPending.current = true
    void (async () => {
      try {
        setLocationDenied(null)
        const perm = await ensureDrivePermission()
        if (!mountedRef.current) return // navigated away during the dialog — don't setState/subscribe
        if (!perm.granted) {
          setLocationDenied({ canAskAgain: perm.canAskAgain })
          return
        }
        beginDrive()
      } catch {
        // requestForegroundPermissionsAsync threw (misconfig / concurrent request) — show the gate
        // with a retry instead of letting the tap silently do nothing.
        if (mountedRef.current) setLocationDenied({ canAskAgain: true })
      } finally {
        permPending.current = false
      }
    })()
  }, [data, mode, beginDrive])

  const togglePause = useCallback(() => {
    setPaused((p) => {
      const next = !p
      if (next) subRef.current?.pause()
      else subRef.current?.resume()
      return next
    })
  }, [])

  const end = useCallback(() => {
    resetForReady()
  }, [resetForReady])

  const restart = useCallback(() => {
    start()
  }, [start])

  const retry = useCallback(() => setReloadKey((k) => k + 1), [])

  // Deep-link to system Settings (the canAskAgain===false recovery; AppState re-checks on return).
  const openLocationSettings = useCallback(() => {
    void Linking.openSettings()
  }, [])

  // ---- clip load / play (cloned from the preview): keyed on the active stop ----
  useEffect(() => {
    if (!data || activeSeq === null) return
    if (watchdog.current) {
      clearTimeout(watchdog.current)
      watchdog.current = null
    }
    const uri = urls.get(activeSeq)
    if (!uri) {
      // No audio for this stop — treat it as instantly finished and move on. But NOT while
      // paused: arming (or re-arming, on every pause toggle) the skip timer would advance a
      // held drive through audio-less stops.
      if (paused) return
      const t = setTimeout(() => onClipDone(activeSeq), 400)
      return () => clearTimeout(t)
    }
    if (loadedSeq.current !== activeSeq) {
      loadedSeq.current = activeSeq
      sawFresh.current = false
      setStallNote(null)
      // Stop the old clip before the async replace() so it doesn't bleed into the new one.
      try {
        player.pause()
      } catch {}
      player.replace({ uri })
      const bk = bracketKindForSeq(activeSeq)
      const stopName = bk
        ? bracketTitle(bk)
        : (data.stops.find((s) => s.seq === activeSeq)?.name ?? data.hostName)
      try {
        player.setActiveForLockScreen(true, {
          title: stopName,
          artist: data.hostName,
          albumTitle: data.tourName,
        })
      } catch {}
    }
    if (paused) {
      try {
        player.pause()
      } catch {}
      return
    }
    player.play()
    // A clip that never starts (expired 403 / decode fail / dead zone) never fires
    // didJustFinish. After a grace, re-sign ONCE (reloads the clip); if it STILL won't
    // start on the second pass, skip the stop.
    watchdog.current = setTimeout(() => {
      if (sawFresh.current) return
      if (!clipRetried.current.has(activeSeq)) {
        clipRetried.current.add(activeSeq)
        // Re-sign once. On SUCCESS the fresh URLs reload the clip and re-arm this watchdog
        // (a still-dead clip is then skipped on the second pass). On FAILURE (offline / dead
        // zone) there is no re-run, so skip the stop NOW — otherwise clipBusy stays set and
        // the sequential pump (and the end-of-drive) hangs forever on a silent clip.
        void resign().then((ok) => {
          if (!ok && !sawFresh.current && loadedSeq.current === activeSeq) {
            setStallNote(voice.player.stall)
            onClipDone(activeSeq)
          }
        })
        return
      }
      setStallNote(voice.player.stall)
      onClipDone(activeSeq)
    }, CLIP_STALL_MS)
    return () => {
      if (watchdog.current) {
        clearTimeout(watchdog.current)
        watchdog.current = null
      }
    }
  }, [activeSeq, urls, data, paused, player, onClipDone, resign])

  // ---- clip end → ducked-quiet (NOT next-stop): wait for the next GPS trigger ----
  useEffect(() => {
    if (activeSeq === null) return
    if (status.playing && !status.didJustFinish) {
      sawFresh.current = true
      if (watchdog.current) {
        clearTimeout(watchdog.current)
        watchdog.current = null
      }
    }
    if (
      status.didJustFinish &&
      sawFresh.current &&
      finishedSeq.current !== activeSeq &&
      !scrubbing.current
    ) {
      finishedSeq.current = activeSeq
      onClipDone(activeSeq)
    }
  }, [status.playing, status.didJustFinish, activeSeq, onClipDone])

  // A new active clip → drop any seek target carried from the last one.
  useEffect(() => {
    seekTarget.current = null
  }, [activeSeq])

  // Between stops (ducked-quiet) while driving: relinquish the lock screen. Otherwise the
  // narration player keeps the FINISHED clip up as "Now Playing" — with transport controls
  // bound to a dead clip — for the minutes of transit to the next stop. The clip-load effect
  // re-claims it when the next stop fires. (If a stop is queued, activeSeq goes null→next in
  // one batch, so this never deactivates mid-handoff.)
  useEffect(() => {
    if (driving && !done && activeSeq === null) {
      try {
        player.setActiveForLockScreen(false)
      } catch {}
    }
  }, [driving, done, activeSeq, player])

  // ---- drive soundtrack: audible between stops (quiet, not paused, mid-drive); fades at end ----
  // segmentKind drives the shuffled track ROTATION (a fresh song per narrated leg): 'clip'
  // while a stop plays, 'drive' between stops — the rotation advances when we leave a 'clip'.
  useDriveMusic({
    active: driving && !done && !paused && activeSeq === null,
    ended: done,
    segmentKind: activeSeq !== null ? 'clip' : 'drive',
  })

  // ---- hold the screen awake while actively driving (foreground GPS dies on screen-lock) ----
  // Scoped to `driving && !paused` so 'ready'/'done' and a long pause don't hold the lock and burn
  // battery (review #7). The `active` flag releases the lock if the drive ends before the async
  // activate resolves, so it can't stick on (review #8). expo-keep-awake needs no config plugin. (spec §5)
  useEffect(() => {
    if (!driving || paused) return
    let active = true
    void activateKeepAwakeAsync(KEEP_AWAKE_TAG)
      .then(() => {
        if (!active) void deactivateKeepAwake(KEEP_AWAKE_TAG)
      })
      .catch(() => {})
    return () => {
      active = false
      void deactivateKeepAwake(KEEP_AWAKE_TAG)
    }
  }, [driving, paused])

  // ---- track mount state for the async permission flow (review #4) ----
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // ---- recover from a permanent denial: re-check permission when the rider returns from Settings ----
  // The canAskAgain===false branch only opens Settings; without this re-check they'd be stuck on the
  // gate after granting there. Only active while the gate is up. (review #5)
  useEffect(() => {
    if (!locationDenied) return
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return
      void getDrivePermission().then((perm) => {
        if (perm.granted && mountedRef.current) setLocationDenied(null)
      })
    })
    return () => sub.remove()
  }, [locationDenied])

  // ---- no-GPS watchdog (live drive only): if usable fixes stop arriving, show "searching" instead
  // of a silently frozen screen — covers slow acquisition AND a persistently poor-accuracy signal. (review #6)
  useEffect(() => {
    if (mode !== 'live' || !driving || paused) return
    lastFixAt.current = Date.now() // grace period before the first "searching"
    setGpsSearching(false)
    const iv = setInterval(() => {
      if (Date.now() - lastFixAt.current > GPS_SEARCH_MS) setGpsSearching(true)
    }, 2_000)
    return () => clearInterval(iv)
  }, [mode, driving, paused])

  // ---- unmount: stop the drive cleanly (back-swipe / nav away) ----
  useEffect(() => {
    return () => {
      teardownSource()
      try {
        player.pause()
      } catch {}
      try {
        player.setActiveForLockScreen(false)
      } catch {}
      if (watchdog.current) clearTimeout(watchdog.current)
    }
  }, [player, teardownSource])

  // ---- derived view-model ----
  const phase: DrivePhase = needsAccount
    ? 'gate'
    : error
      ? 'error'
      : !data
        ? 'loading'
        : locationDenied
          ? 'locationGate'
          : done
            ? 'done'
            : driving
              ? 'driving'
              : 'ready'

  const clipLoaded = activeSeq !== null
  const buffering = clipLoaded && !paused && (!status.isLoaded || !!status.isBuffering)
  const nowPlaying = clipLoaded && !!status.playing && !paused && !status.didJustFinish

  const dur = status.duration ?? 0
  const canSeek = clipLoaded && !!status.isLoaded && dur > 0 && !buffering
  const positionMs = (status.currentTime ?? 0) * 1000
  const durationMs = dur * 1000

  const seekToMs = useCallback(
    (ms: number) => {
      if (!canSeek) return
      const target = Math.min(dur, Math.max(0, ms / 1000))
      seekTarget.current = target
      try {
        player.seekTo(target)
      } catch {}
    },
    [canSeek, dur, player],
  )

  const seekBy = useCallback(
    (deltaSec: number) => {
      if (!canSeek) return
      const base = Math.max(seekTarget.current ?? 0, status.currentTime ?? 0)
      seekToMs((base + deltaSec) * 1000)
    },
    [canSeek, status.currentTime, seekToMs],
  )

  const setScrubbing = useCallback((active: boolean) => {
    scrubbing.current = active
  }, [])

  const stops: DriveStopView[] =
    data?.stops.map((s) => ({ seq: s.seq, name: s.name, stopType: s.stopType })) ?? []
  const nextSeq = data?.stops.find((s) => !firedSeqs.has(s.seq))?.seq ?? null

  return {
    phase,
    error,
    retry,
    tourName: data?.tourName ?? '',
    region: data?.region ?? '',
    hostName: data?.hostName ?? '',
    stops,
    totalStops: stops.length,
    firedCount: firedSeqs.size,
    progress: dot,
    activeSeq,
    activeBracket: activeSeq === null ? null : bracketKindForSeq(activeSeq),
    firedSeqs,
    nextSeq,
    nowPlaying,
    buffering,
    stallNote,
    gpsSearching,
    paused,
    positionMs,
    durationMs,
    canSeek,
    seekToMs,
    seekBy,
    setScrubbing,
    fast,
    setFast,
    locationCanAskAgain: locationDenied?.canAskAgain ?? true,
    openLocationSettings,
    start,
    togglePause,
    end,
    restart,
  }
}
