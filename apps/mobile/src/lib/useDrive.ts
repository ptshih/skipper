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
// docs/specs/gps-player-spec.md §3.5.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, AppState, Linking } from 'react-native'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import {
  bracketKindForSeq,
  buildPreviewTimeline,
  cumulativeMeters,
  DEFAULT_MAX_OFF_ROUTE_M,
  DEFAULT_TRIGGER,
  INTRO_SEQ,
  OUTRO_SEQ,
  snapStopsToRoute,
  TriggerEngine,
  type GpsFix,
  type PreviewSegment,
} from '@skipper/drive-core'
import { ApiError, errorMessage } from './api'
import { cleanPlaceName } from './labels'
import { loadPlayback, resignPlayback } from './offline'
import {
  ensureDrivePermission,
  getDrivePermission,
  liveSource,
  simulatedSource,
  type FixSubscription,
} from './gps'
import { useDriveMusic } from './driveMusic'
import { useReducedMotion } from '@/theme'
import { voice } from '@/ui'

// Grace before a clip that hasn't started is treated as stalled — same generous window
// as the preview (32k MP3 clips, 1h presigned URLs → re-sign once on a stall).
const CLIP_STALL_MS = 12_000

// Lock-screen title for a bracket clip (intro/outro aren't in the stop list). Reads the SAME
// voice constants as the NOW-card title in play.tsx — single source, so they can't diverge.
const bracketTitle = (kind: 'intro' | 'outro'): string =>
  kind === 'intro' ? voice.player.bracketIntro : voice.player.bracketOutro

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
  /** PREVIEW only: bracket clip lengths captured from the detail response so the preview
   *  timeline can play intro/outro full-length (live/sim queue them by sentinel, no length needed). */
  introMs: number | null
  outroMs: number | null
}

export type DrivePhase =
  | 'loading'
  | 'error'
  | 'gate'
  | 'locationGate'
  | 'ready'
  | 'driving'
  | 'done'

// Why a live drive is blocked at the location gate: a hard DENIAL (canAskAgain decides re-prompt vs
// Settings) or granted-but-REDUCED (iOS approximate location — Settings-only). See gps.ts.
type LocationBlock = { kind: 'denied'; canAskAgain: boolean } | { kind: 'reduced' }

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
  /** First not-yet-fired stop, for the "ROLLING · next stop: X" strip. In preview, the
   *  destination of the current drive/rest segment. */
  nextSeq: number | null

  /** What the current beat is: a stop clip, the silent drive between stops, or a rest/pit stop.
   *  Drives the NOW-card variant. (preview = the segment kind; live/sim = clip vs drive.) */
  currentKind: 'clip' | 'drive' | 'rest' | null
  /** PREVIEW only: the along-route distance (m) of the current drive segment, for a "~X mi"
   *  label in the rolling card. null on a clip/rest and in live/sim (real distance isn't tracked). */
  rollingDistanceM: number | null
  /** PREVIEW only: total compressed preview run time (ms) and the real drive it represents,
   *  for the header subtitle. null in live/sim. */
  totalPreviewMs: number | null
  totalRealMs: number | null

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
  /** Blocked because location is granted but only APPROXIMATE (iOS Precise Location off) → Settings-only. */
  locationReduced: boolean
  /** Deep-link to the app's system Settings (for `canAskAgain === false` AND the reduced-accuracy case). */
  openLocationSettings: () => void

  // Lifecycle.
  start: () => void
  togglePause: () => void
  end: () => void
  restart: () => void
  /** PREVIEW only: tap a stop to jump the drive there and play it from the start. No-op in live/sim
   *  (you can't teleport the car on a real drive). */
  jumpToStop: (seq: number) => void
}

export interface UseDriveOptions {
  /** 'sim' = the on-device drive simulator (default, couch-testable); 'live' = real device GPS
   *  (Phase 4); 'preview' = the map-less couch SIMULATED DRIVE (anonymous-friendly open funnel,
   *  no GPS, no permission gate) — a compressed segment-timeline clock instead of a fix source. */
  mode?: 'sim' | 'live' | 'preview'
}

export function useDrive(tourId: string | undefined, opts: UseDriveOptions = {}): UseDrive {
  const mode = opts.mode ?? 'sim'
  const reducedMotion = useReducedMotion() // honor OS "Reduce Motion" for the preview token glide
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
  // Set when a live drive is blocked on location: either DENIED (carries whether the OS will still
  // prompt — false → Settings-only) or granted-but-REDUCED (iOS approximate location; Settings-only,
  // since SDK 56 can't upgrade accuracy in-app). null = no block (always so in sim mode). Both kinds
  // drive the 'locationGate' phase and recover via the same on-return-from-Settings re-check.
  const [locationBlock, setLocationBlock] = useState<LocationBlock | null>(null)
  // True while a live drive is getting no usable GPS fixes (acquiring / poor accuracy) — so the
  // rider sees "searching" instead of a silently frozen screen. (review #6)
  const [gpsSearching, setGpsSearching] = useState(false)

  // PREVIEW-ONLY clock state. The preview replaces the GPS fix source with a compressed
  // segment timeline (clip / drive / rest) the driver effect steps through; these hold it.
  const [segments, setSegments] = useState<PreviewSegment[]>([])
  const [segIdx, setSegIdx] = useState(0)
  const [totalPreviewMs, setTotalPreviewMs] = useState<number | null>(null)
  const [totalRealMs, setTotalRealMs] = useState<number | null>(null)
  const segTimer = useRef<ReturnType<typeof setTimeout> | null>(null) // the drive/rest auto-advance

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
        // seq and the brackets under INTRO_SEQ/OUTRO_SEQ, either way. PREVIEW is the OPEN
        // funnel — every ready tour is previewable anonymously (`preview: true` → ?preview=1),
        // even ones whose gated live drive + offline download stay account-walled.
        const { detail: tour, urls } = await loadPlayback(
          tourId,
          mode === 'preview' ? { preview: true } : undefined,
        )
        if (cancelled) return
        const polyline = tour.tour.polyline as [number, number][]
        if (polyline.length < 2) throw new Error('This tour has no drivable route.')
        const cum = cumulativeMeters(polyline)
        bracketsRef.current = { intro: urls.has(INTRO_SEQ), outro: urls.has(OUTRO_SEQ) }
        const introMs = tour.intro?.audioDurationMs ?? null
        const outroMs = tour.outro?.audioDurationMs ?? null
        setUrls(urls)
        setData({
          tourName: tour.tour.headline,
          region: tour.region.displayName,
          hostName: tour.host.name,
          polyline,
          totalM: cum.length > 0 ? (cum[cum.length - 1] ?? 0) : 0,
          stops: tour.stops.map((s) => ({
            seq: s.seq,
            name: cleanPlaceName(s.name), // display-only: drops Wikipedia's ", California" title suffix
            stopType: s.stopType,
            lat: s.lat,
            lng: s.lng,
            triggerRadiusM: s.triggerRadiusM,
            audioDurationMs: s.audioDurationMs,
          })),
          introMs,
          outroMs,
        })
        // PREVIEW: build the compressed segment timeline (the preview's clock). Stretch the
        // between-stop drive gaps to 12–20s (vs the engine's short default) so the drive music
        // has room to breathe — preview-only pacing (the real drive uses actual elapsed time).
        // intro/outro brackets bookend the timeline (full length, not compressed).
        if (mode === 'preview') {
          const tl = buildPreviewTimeline(
            tour.stops.map((s) => ({
              seq: s.seq,
              stopType: s.stopType,
              name: s.name,
              lat: s.lat,
              lng: s.lng,
              audioDurationMs: s.audioDurationMs,
            })),
            polyline,
            {
              minGapSec: 12,
              maxGapSec: 20,
              intro: introMs != null ? { audioDurationMs: introMs } : null,
              outro: outroMs != null ? { audioDurationMs: outroMs } : null,
            },
          )
          setSegments(tl.segments)
          setTotalPreviewMs(tl.totalPreviewMs)
          setTotalRealMs(tl.totalRealMs)
        }
      } catch (e) {
        if (cancelled) return
        if (e instanceof ApiError && e.needsAccount) setNeedsAccount(true)
        else setError(errorMessage(e, voice.error.generic))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [tourId, reloadKey, mode])

  // ---- re-sign expired presigned URLs (online stall only; downloaded files never expire) ----
  const resign = useCallback(async (): Promise<boolean> => {
    if (!tourId) return false
    try {
      // local map when downloaded, else freshly re-signed (preview uses the open-funnel sign path)
      const fresh = await resignPlayback(tourId, mode === 'preview' ? { preview: true } : undefined)
      if (sawFresh.current) return true // clip started during the re-sign — leave it alone
      loadedSeq.current = null
      setUrls(fresh)
      return true
    } catch {
      return false // offline / 503 — the caller skips the stop so the drive never hangs
    }
  }, [tourId, mode])

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

  // ---- advance the PREVIEW segment clock by one (the effect re-runs for the next segment;
  // once segIdx passes the last segment it calls finishDrive). ----
  const advanceSegment = useCallback(() => {
    setSegIdx((i) => i + 1)
  }, [])

  // ---- a clip finished (or was skipped): return to ducked-quiet, then advance the clock ----
  // PREVIEW steps the segment timeline; live/sim returns to ducked-quiet and pumps the trigger
  // fire-queue (a finished clip WAITS for the next GPS trigger — it never advances by ending).
  const onClipDone = useCallback(
    (_seq: number) => {
      clipBusy.current = false
      if (mode === 'preview') {
        setActiveSeq(null)
        advanceSegment()
        return
      }
      setActiveSeq(null)
      pump()
    },
    [mode, pump, advanceSegment],
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
    setLocationBlock(null)
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
    // PREVIEW: there is no fix source — the segment-timeline driver effect IS the clock.
    // Just go to driving and let the autostart effect seat segIdx at 0. No engine, no
    // GpsFixSource subscription, no permission gate.
    if (mode === 'preview') {
      setDriving(true)
      return
    }
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
        setLocationBlock(null)
        const perm = await ensureDrivePermission()
        if (!mountedRef.current) return // navigated away during the dialog — don't setState/subscribe
        if (!perm.granted) {
          setLocationBlock({ kind: 'denied', canAskAgain: perm.canAskAgain })
          return
        }
        if (perm.reduced) {
          // Granted, but iOS approximate location — fixes too coarse to trigger stops. Gate to
          // Settings (Precise Location) rather than starting a drive that would silently never fire.
          setLocationBlock({ kind: 'reduced' })
          return
        }
        beginDrive()
      } catch {
        // requestForegroundPermissionsAsync threw (misconfig / concurrent request) — show the gate
        // with a retry instead of letting the tap silently do nothing.
        if (mountedRef.current) setLocationBlock({ kind: 'denied', canAskAgain: true })
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
    // PREVIEW: re-seat the segment clock at the top instead of re-subscribing a fix source.
    if (mode === 'preview') {
      loadedSeq.current = null
      finishedSeq.current = null
      clipRetried.current.clear()
      dot.setValue(0)
      setStallNote(null)
      setActiveSeq(null)
      setDone(false)
      setDriving(true)
      setSegIdx(0)
      return
    }
    start()
  }, [mode, start, dot])

  // ---- PREVIEW only: tap a stop to jump the drive there and play it from the start. ----
  const jumpToStop = useCallback(
    (seq: number) => {
      if (mode !== 'preview') return // you can't teleport the car on a live/sim drive
      const target = segments.findIndex((s) => s.seq === seq && s.kind !== 'drive')
      if (target < 0) return
      // Silence the current clip immediately on tap (the load effect's async replace would
      // otherwise let it bleed until the new clip loads).
      try {
        player.pause()
      } catch {}
      if (segTimer.current) {
        clearTimeout(segTimer.current)
        segTimer.current = null
      }
      loadedSeq.current = null // force the target clip to (re)load from its start
      finishedSeq.current = null
      clipRetried.current.clear()
      dot.setValue(segments[target]!.routeProgress)
      setStallNote(null)
      setDone(false)
      setDriving(true)
      setSegIdx(target)
    },
    [mode, segments, player, dot],
  )

  const retry = useCallback(() => setReloadKey((k) => k + 1), [])

  // Deep-link to system Settings (the canAskAgain===false recovery; AppState re-checks on return).
  const openLocationSettings = useCallback(() => {
    void Linking.openSettings()
  }, [])

  // ---- PREVIEW autostart: no permission gate, no fix source — the simulated drive just rolls.
  // Seat the segment clock at 0 and go to driving as soon as the tour (and its timeline) loads.
  useEffect(() => {
    if (mode !== 'preview') return
    if (!data || driving || done) return
    setSegIdx(0)
    setDriving(true)
  }, [mode, data, driving, done])

  // ---- PREVIEW segment driver: step the compressed timeline (clip / drive / rest). The CLOCK
  // that replaces the GpsFixSource. It REUSES the shared clip-load effect (via setActiveSeq) for
  // audio + lock-screen + the stall watchdog — it never touches the player itself. A `clip` seg
  // hands off to that effect (which calls onClipDone → advanceSegment on finish); a `drive`/`rest`
  // seg is a silent timed gap that slides the route dot, then auto-advances.
  useEffect(() => {
    if (mode !== 'preview' || !data || !driving || done) return
    const seg = segments[segIdx]
    if (!seg) {
      // Ran past the last segment — the simulated drive is over.
      finishDrive()
      return
    }
    if (segTimer.current) {
      clearTimeout(segTimer.current)
      segTimer.current = null
    }
    if (seg.kind === 'clip') {
      // Hand off to the shared clip-load effect: it loads + plays the clip, sets the lock screen,
      // and arms the stall watchdog; on finish the didJustFinish effect calls onClipDone, which (in
      // preview) advances the clock. Set the dot to the stop FIRST so the trail lands on it.
      dot.setValue(seg.routeProgress)
      setActiveSeq(seg.seq)
      return
    }
    // drive / rest: a SILENT segment — no active clip. The clip-load effect relinquishes the
    // lock screen when activeSeq goes null; the drive-music effect fades the soundtrack back in.
    setActiveSeq(null)
    if (paused) return // a held drive freezes here; toggling pause re-runs this effect and resumes
    const from = seg.fromProgress ?? seg.routeProgress
    dot.setValue(from)
    // Animate the dot only when it actually moves (a drive). A break 'rest' holds in place, so skip
    // the no-op X→X timing that would spin the JS animation at 60fps and jank the transition.
    if (seg.kind === 'drive' && from !== seg.routeProgress) {
      // Reduce Motion: step the token to the segment end instead of gliding it (same end state).
      if (reducedMotion) dot.setValue(seg.routeProgress)
      else
        Animated.timing(dot, {
          toValue: seg.routeProgress,
          duration: seg.previewMs,
          useNativeDriver: false,
        }).start()
    }
    segTimer.current = setTimeout(() => advanceSegment(), seg.previewMs)
    return () => {
      if (segTimer.current) {
        clearTimeout(segTimer.current)
        segTimer.current = null
      }
      dot.stopAnimation() // freeze the trail on pause/jump instead of letting it run on
    }
  }, [mode, data, driving, done, segIdx, paused, segments, dot, advanceSegment, finishDrive, reducedMotion])

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

  // Drop the pending seek target once the clock catches up to it, so a LATER ±15 tap re-bases
  // on the real position instead of a stale committed target. (Pairs with seekBy above.)
  useEffect(() => {
    if (
      seekTarget.current != null &&
      status.currentTime != null &&
      Math.abs(status.currentTime - seekTarget.current) < 0.4
    ) {
      seekTarget.current = null
    }
  }, [status.currentTime])

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

  // ---- recover from a denial OR reduced accuracy: re-check permission when the rider returns from
  // Settings. The Settings-only branches (canAskAgain===false, and reduced accuracy) would otherwise
  // leave them stuck on the gate after fixing it there. Only active while the gate is up. (review #5)
  useEffect(() => {
    if (!locationBlock) return
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return
      void getDrivePermission().then((perm) => {
        if (!mountedRef.current) return
        if (!perm.granted) return // still denied — keep the denied gate as-is
        if (perm.reduced) setLocationBlock({ kind: 'reduced' }) // granted there, but still approximate
        else setLocationBlock(null) // granted + precise → drop the gate, ready to roll
      })
    })
    return () => sub.remove()
  }, [locationBlock])

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
      if (segTimer.current) clearTimeout(segTimer.current) // preview's drive/rest auto-advance
    }
  }, [player, teardownSource])

  // ---- derived view-model ----
  const phase: DrivePhase = needsAccount
    ? 'gate'
    : error
      ? 'error'
      : !data
        ? 'loading'
        : locationBlock
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
      // Prefer the pending command over the lagging clock in BOTH directions, so rapid taps
      // accumulate — `Math.max` broke rewinds (a back-15 target sits below currentTime, so the
      // next tap re-based on the stale clock and re-issued the same -15). seekTarget is cleared
      // once the clock catches up (below), so a later tap re-bases on the real position.
      const base = seekTarget.current ?? status.currentTime ?? 0
      seekToMs((base + deltaSec) * 1000)
    },
    [canSeek, status.currentTime, seekToMs],
  )

  const setScrubbing = useCallback((active: boolean) => {
    scrubbing.current = active
  }, [])

  // Stable identity across renders — this rebuilt a fresh array every audio tick, which made
  // the player's auto-scroll effect (keyed on it) re-fire ~2×/sec and pin the stop list.
  const stops: DriveStopView[] = useMemo(
    () => data?.stops.map((s) => ({ seq: s.seq, name: s.name, stopType: s.stopType })) ?? [],
    [data],
  )

  // The current segment (preview only) — drives currentKind / rollingDistanceM / nextSeq.
  const curSeg = mode === 'preview' ? (segments[segIdx] ?? null) : null
  // The "next stop" strip: in live/sim it's the first not-yet-fired stop; in preview it's the
  // destination of the current drive/rest segment (a clip's destination IS the active stop).
  const nextSeq =
    mode === 'preview'
      ? (curSeg && curSeg.kind !== 'clip' ? curSeg.seq : null)
      : (data?.stops.find((s) => !firedSeqs.has(s.seq))?.seq ?? null)
  // What beat we're on, for the NOW-card variant. Preview reads the segment kind directly;
  // live/sim has no rest segment (a clip is loaded, or we're driving between triggers).
  const currentKind: 'clip' | 'drive' | 'rest' | null =
    mode === 'preview' ? (curSeg?.kind ?? null) : activeSeq !== null ? 'clip' : 'drive'
  // The current drive leg's along-route distance (m) for a "~X mi" label — preview only.
  const rollingDistanceM = mode === 'preview' && curSeg?.kind === 'drive' ? (curSeg.distanceM ?? null) : null

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
    currentKind,
    rollingDistanceM,
    totalPreviewMs,
    totalRealMs,
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
    locationCanAskAgain: locationBlock?.kind === 'denied' ? locationBlock.canAskAgain : true,
    locationReduced: locationBlock?.kind === 'reduced',
    openLocationSettings,
    start,
    togglePause,
    end,
    restart,
    jumpToStop,
  }
}
