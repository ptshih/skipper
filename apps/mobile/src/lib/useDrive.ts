// useDrive — the live, GPS-triggered driving player.
//
// This is the Phase-2 core: it owns the trigger engine, the audio player, the
// lock-screen Now Playing, and the fire-queue, and it's driven by a swappable
// `GpsFixSource` — the `simulatedSource` (couch-testable on the iOS Simulator, the dev
// `sim` mode) or the real-device `liveSource`, interchangeable behind GpsFixSource.
//
// The clock is the GPS fix stream: each GpsFix runs `engine.update(fix)` and any stop that
// fires is queued and played. A finished clip returns to ducked-quiet and WAITS for the
// next GPS trigger — it never advances by a clip ending. (The old map-less couch "simulated
// drive" — a compressed segment-timeline PREVIEW clock — was CUT; auditioning a drive is now
// the native per-stop mini-preview on the drive-detail page, so this hook is just sim + live.
// See docs/decisions/detail-page-mini-preview.md.) See docs/designs/gps-player-spec.md §3.5.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, AppState, Image, Linking } from 'react-native'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import {
  setAudioModeAsync,
  setIsAudioActiveAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
} from 'expo-audio'
import {
  clampSeekSec,
  cumulativeMeters,
  decideStall,
  OFF_ROUTE_MAX_M,
  PRE_START_STALL_MS,
  seekTargetReached,
  snapStopsToRoute,
  TriggerEngine,
  type GpsFix,
} from '@skipper/engine'
import type { Attribution } from '@skipper/shared'
import { track } from './analytics'
import { ApiError, errorMessage } from './api'
import { cleanPlaceName } from './labels'
import { loadPlayback, resignPlayback } from './offline'
import { getDrivePermission, liveSource, simulatedSource, type FixSubscription } from './gps'
import { useLocationPriming } from './useLocationPriming'
import { useDriveMusic } from './driveMusic'
import { voice } from '@/ui'


// V2 drives carry no host on the manifest (persona is decoupled + single in v2), so the lock-screen
// "artist" is the persona name. The Skipper is the only host today.
const DRIVE_HOST_NAME = 'Skipper'

// Real drive speed for the simulator (mph). A FIXED 60 for now; the trigger lead is
// speed-adaptive in @skipper/engine, so this is the only knob that matters here.
const SIM_MPH = 60
// "Fast" sim multiplier: replay the same fixes 8× sooner so a full drive triggers in
// a couple minutes on the couch (the fix DATA — speeds, headings — is unchanged).
const SIM_FAST_SCALE = 8

// The audio interruption mode for the drive. 'doNotMix' BY DESIGN (founder-decided 2026-06-19) — the
// drive takes EXCLUSIVE focus: it IS the audio experience (the Skipper's curated soundtrack owns the
// drive, the voice owns the stops — see driveMusic.ts), NOT a narration that ducks the rider's own music.
// Do NOT "flip" this to 'duckOthers' — ducking leaves the rider's playlist competing under the Skipper
// (it was tried and rejected) and breaks lock-screen Now Playing. See docs/decisions/drive-audio-exclusive-focus.md.
const DRIVE_INTERRUPTION_MODE = 'doNotMix' as const

// Keep-awake lock tag — the foreground GPS watch dies on screen-lock, so hold the screen on
// while actively driving (scoped to `driving`, not the whole screen). (spec §5)
const KEEP_AWAKE_TAG = 'skipper-drive'

// No accepted live fix for this long → surface a "searching for GPS" note rather than a silently
// frozen screen (covers slow acquisition + persistently poor accuracy). (review #6)
const GPS_SEARCH_MS = 8_000
// POST_START_STALL_MS (the post-start interruption threshold) + the decideStall ladder live in
// @skipper/engine/player now, single-sourced + unit-tested. (It was extracted to be shared with the
// free-roam player; that caller is gone, but the engine is where the stall ladder belongs regardless.)

// Bundled lock-screen / Now Playing artwork so the in-car lock screen isn't a blank thumbnail (the
// persona is the product — the lock screen is a brand surface). A bundled asset URI works offline. (audit)
const LOCK_ARTWORK_URI: string | undefined =
  Image.resolveAssetSource(require('../../assets/icon.png'))?.uri

// The `drive_started` latch — MODULE scope, not a ref, and that is the whole point. `restart` runs
// beginDrive again on the same mount, and backing out of a rolling drive and re-opening the player
// remounts this hook outright, so a per-mount ref re-arms on exactly the paths that would inflate
// the number. Keyed by MODE as well as drive: a rider who couch-tests a drive in sim and later
// actually drives it live has begun two genuinely different things, and sim-vs-live is the
// distinction the event exists to draw.
// ⚠ The drive id here is a LOCAL latch key and never leaves this module — it sits beside
// `drives.user_id` server-side, so it may not ride an event (see analytics.tsx AnalyticsEventProps).
// ⚠ IT IS NEVER CLEARED, AND THE COST IS LARGER THAN "one app run" SOUNDS. iOS suspends rather than
// terminates, so a process routinely survives days — a rider who drives this route again next weekend
// re-arms nothing and is not counted, unless the OS happened to evict the app in between. So
// `drive_started` counts FIRST starts per drive per process, not every start; read it as reach, never
// as engagement. The direction is chosen on purpose (a funnel event that double-fires corrupts a
// denominator silently, while one that under-fires is merely conservative), but `restart` is a
// first-class transport control rather than an edge affordance, so the undercount is real traffic.
// Clearing on `end()` — the rider explicitly finishing — would recover most of it without re-arming on
// the remount and `restart` paths this Set exists to absorb; deliberately not done in the same pass
// that introduced the event, so the baseline is measured before the semantics move.
const startedDrives = new Set<string>()

interface DriveStop {
  seq: number
  name: string
  stopType: string
  lat: number
  lng: number
  triggerRadiusM: number
  audioDurationMs: number | null | undefined
  /** The clip's frozen source credit — carried so the player can show it while the clip plays
   *  (CC BY-SA attribution rides the WORK, not a settings screen). Absent on scenic/break forms,
   *  which ground on no source text. */
  attribution?: Attribution[]
}

interface DriveData {
  driveName: string
  /** The narrating host's display name (the persona — "Skipper"). */
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
  | 'locationPrime'
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
  /** Raw POI coordinates — for the map's stop markers. */
  lat: number
  lng: number
  /** The clip's frozen source credit, for the player's SourceCredit line. */
  attribution?: Attribution[]
}

export interface UseDrive {
  phase: DrivePhase
  error: string | null
  retry: () => void

  driveName: string
  /** The narrating host's display name (the persona — "Skipper"). */
  hostName: string
  stops: DriveStopView[]
  totalStops: number
  firedCount: number
  /** The route as [lng, lat] pairs — for the map overlay's route line. */
  polyline: [number, number][]

  /** 0..1 route position for `RouteTrack`, driven imperatively by each GPS fix. */
  progress: Animated.Value
  /** The stop whose clip is currently loaded/playing, or null between stops (ducked-quiet). */
  activeSeq: number | null
  /** Seqs whose trigger has fired (for the stop list's passed/active states). */
  firedSeqs: Set<number>
  /** First not-yet-fired stop, for the "ROLLING · next stop: X" strip. */
  nextSeq: number | null

  nowPlaying: boolean
  buffering: boolean
  stallNote: string | null
  /** True while a live drive is getting no usable GPS fixes — show a "searching" cue. (review #6) */
  gpsSearching: boolean
  /** True when playback is served entirely from the on-disk download (no network) — drives a quiet
   *  "playing from download" chip so the rider knows a dead zone won't interrupt the drive. (M7) */
  offline: boolean
  paused: boolean

  // In-clip scrub (drive/quiet segments have no timeline).
  positionMs: number
  durationMs: number
  canSeek: boolean
  seekToMs: (ms: number) => void
  seekBy: (deltaSec: number) => void
  setScrubbing: (active: boolean) => void

  // Replay the last COMPLETED stop — fills the between-stops gap the scrubber can't reach.
  /** Re-play the last completed stop clip (live/sim only). No-op unless `canReplay`; a live GPS
   *  trigger preempts an in-progress replay. Pure playback — does not alter trigger/fired state. */
  replayLast: () => void
  /** True in the between-stops quiet when a completed clip exists to re-hear (drives the Replay button). */
  canReplay: boolean

  // Sim setup (pre-drive only).
  fast: boolean
  setFast: (fast: boolean) => void

  // Location permission (live mode only; null/true in sim mode).
  /** The explainer's single CTA: fire the OS location prompt. */
  confirmLocationPrime: () => void
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
}

export interface UseDriveOptions {
  /** 'sim' = the on-device drive simulator (default, couch-testable); 'live' = real device GPS
   *  (Phase 4). (The map-less couch 'preview' clock was cut — auditioning is the drive-detail
   *  mini-preview now; see docs/decisions/detail-page-mini-preview.md.) */
  mode?: 'sim' | 'live'
  /** Seed the sim fast-replay (8×) ON. Used when the GLOBAL Settings→Developer sim toggle
   *  forced this drive into sim — couch-testing a full drive at real 1× is impractical (a
   *  30-min drive takes 30 real min), so default to fast there; the pre-drive knob still
   *  lets the rider switch back to real-time for trigger-timing tests. (Ignored unless sim.) */
  defaultFast?: boolean
}

export function useDrive(driveId: string | undefined, opts: UseDriveOptions = {}): UseDrive {
  const mode = opts.mode ?? 'sim'
  const [data, setData] = useState<DriveData | null>(null)
  const [urls, setUrls] = useState<Map<number, string>>(new Map())
  // True when playback is served entirely from the on-disk download (zero network) — surfaced as a
  // quiet "playing from download" chip so the rider knows a dead zone won't bite. (M7)
  const [offline, setOffline] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsAccount, setNeedsAccount] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const [driving, setDriving] = useState(false)
  const [paused, setPaused] = useState(false)
  const [done, setDone] = useState(false)
  const [activeSeq, setActiveSeq] = useState<number | null>(null)
  const [firedSeqs, setFiredSeqs] = useState<Set<number>>(new Set())
  // The last clip that ACTUALLY PLAYED — the "replay that" target. State (not a ref) so `canReplay`
  // re-renders the Replay button as it appears/disappears between stops. (replay-last-stop)
  const [lastCompletedSeq, setLastCompletedSeq] = useState<number | null>(null)
  const [stallNote, setStallNote] = useState<string | null>(null)
  const [fast, setFast] = useState(opts.defaultFast ?? false)
  // Set when a live drive is blocked on location: either DENIED (carries whether the OS will still
  // prompt — false → Settings-only) or granted-but-REDUCED (iOS approximate location; Settings-only,
  // since SDK 56 can't upgrade accuracy in-app). null = no block (always so in sim mode). Both kinds
  // drive the 'locationGate' phase and recover via the same on-return-from-Settings re-check.
  const [locationBlock, setLocationBlock] = useState<LocationBlock | null>(null)
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
  const mountedRef = useRef(true) // false after unmount — guards setState in the async drive flows (review #4)
  const lastFixAt = useRef(0) // ms of the last accepted live fix — feeds the no-GPS watchdog (review #6)
  // Audio-playback refs.
  const loadedSeq = useRef<number | null>(null) // which clip is loaded in the player
  const sawFresh = useRef(false) // have we seen the LOADED clip actually play yet?
  // True from a replace() until the player's clock rewinds to the new clip's head — every status in
  // that window still describes the OUTGOING clip. See the clip-end effect. (replay-last-stop)
  const staleStatus = useRef(false)
  const finishedSeq = useRef<number | null>(null) // guard didJustFinish double-fire per clip
  const replayingSeq = useRef<number | null>(null) // set while a REPLAY is the active clip — a live GPS trigger preempts it (replay-last-stop)
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clipRetried = useRef<Set<number>>(new Set()) // seqs re-signed once after a stall
  const scrubbing = useRef(false) // a drag is live — hold the clip-finished handler
  const seekTarget = useRef<number | null>(null) // last commanded seek (sec), so ±15 taps add up
  const finishedWhileScrubbing = useRef<number | null>(null) // didJustFinish fired DURING a drag — replay on release (audit #6)
  const activeSeqRef = useRef<number | null>(null) // mirror of activeSeq for stable callbacks/intervals
  const pausedRef = useRef(false) // mirror of `paused` so togglePause's setState updater stays pure
  // Post-start playback-progress tracking for the interruption/stall recovery (audit #1).
  const lastProgressAt = useRef(0) // ms of the last forward progress on the loaded clip
  const lastProgressTime = useRef(0) // last observed currentTime (sec)
  const durationRef = useRef(0) // last observed clip duration (sec)
  const resumeTried = useRef(false) // already attempted a resume for the current stall
  const dataRef = useRef<DriveData | null>(null) // current `data` for the source-captured handleFix (audit #377)

  const teardownSource = useCallback(() => {
    subRef.current?.stop()
    subRef.current = null
  }, [])

  // ---- load: drive geometry + presigned audio + the audio session ----
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!driveId) return
      setError(null)
      setNeedsAccount(false)
      try {
        await setAudioModeAsync({
          playsInSilentMode: true,
          shouldPlayInBackground: true,
          interruptionMode: DRIVE_INTERRUPTION_MODE,
        }).catch(() => {})
        // OFFLINE-FIRST: a downloaded drive loads its manifest + local file:// clips with zero
        // network; otherwise this fetches the manifest (clips pre-signed inline) and streams. The
        // url map keys place narrations by seq.
        const { detail: manifest, urls, offline: fromDisk } = await loadPlayback(driveId)
        if (cancelled) return
        setOffline(fromDisk)
        const polyline = manifest.polyline as [number, number][]
        if (polyline.length < 2) throw new Error('This drive has no drivable route.')
        const cum = cumulativeMeters(polyline)
        // A drive's clips are place NARRATIONS, each with coords (V2 has no placeless framing —
        // asides were deleted; see docs/decisions/geometry-first-regions.md).
        const narrationClips = manifest.clips.filter(
          (c): c is typeof c & { lat: number; lng: number } => c.lat != null && c.lng != null,
        )
        setUrls(urls)
        setData({
          driveName: manifest.label,
          hostName: DRIVE_HOST_NAME,
          polyline,
          totalM: cum.length > 0 ? (cum[cum.length - 1] ?? 0) : 0,
          stops: narrationClips.map((c) => ({
            seq: c.seq,
            name: cleanPlaceName(c.name ?? ''), // display-only: drops Wikipedia's ", California" suffix
            stopType: c.form, // the clip's form (story|scenic|break) — the view-model treatment axis
            lat: c.lat,
            lng: c.lng,
            triggerRadiusM: c.triggerRadiusM ?? 120,
            audioDurationMs: c.durationMs,
            attribution: c.attribution,
          })),
        })
      } catch (e) {
        if (cancelled) return
        if (e instanceof ApiError && e.needsAccount) setNeedsAccount(true)
        else setError(errorMessage(e, voice.error.generic))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [driveId, reloadKey])

  // ---- re-sign expired presigned URLs (online stall only; downloaded files never expire) ----
  const resign = useCallback(async (): Promise<boolean> => {
    if (!driveId) return false
    try {
      // local map when downloaded, else freshly re-signed off the drive's clips
      const fresh = await resignPlayback(driveId)
      if (sawFresh.current) return true // clip started during the re-sign — leave it alone
      loadedSeq.current = null
      setUrls(fresh)
      return true
    } catch {
      return false // offline / 503 — the caller skips the stop so the drive never hangs
    }
  }, [driveId])

  // ---- the whole drive finished (sim ran out + nothing left to play) ----
  const finishDrive = useCallback(() => {
    teardownSource()
    try {
      player.pause()
    } catch {}
    try {
      player.setActiveForLockScreen(false)
    } catch {}
    // Hand the audio session BACK at the end of the drive. A drive holds an EXCLUSIVE `doNotMix`
    // session for its whole length (by design — the drive IS the audio, not a voice-over), and pausing
    // the player does not release it: iOS resumes the rider's own music/podcast only once the session
    // is deactivated. Without this the car stays silent after "you've arrived" until something else
    // happens to grab focus. `setIsAudioActiveAsync` is a real expo-audio export (native on iOS and
    // Android) and is what its own docs point at for this; fire-and-forget, since a failure here must
    // never block finishing the drive.
    void setIsAudioActiveAsync(false).catch(() => {})
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

  // ---- a clip finished (or was skipped): return to ducked-quiet, then pump the trigger fire-queue
  // (a finished clip WAITS for the next GPS trigger — it never advances by ending). ----
  const onClipDone = useCallback(
    (_seq: number) => {
      clipBusy.current = false
      replayingSeq.current = null // this clip (a stop OR a replay) is over — no replay is in progress now
      // Remember the last clip that ACTUALLY PLAYED (sawFresh) as the replay-last target; a
      // skipped/stalled-before-start stop (sawFresh false) never becomes replayable — you can't
      // re-hear silence (replay-last-stop §4/§7).
      if (sawFresh.current) setLastCompletedSeq(_seq)
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
      // Read `data` through a ref: the GPS source captures handleFix ONCE at beginDrive, so a
      // closed-over `data` would go stale if it ever changed mid-drive. (audit #377)
      const total = dataRef.current?.totalM ?? 0
      dot.setValue(total > 0 ? Math.min(1, Math.max(0, fix.alongM / total)) : 0)
      const events = engineRef.current?.update(fix) ?? []
      if (events.length === 0) return
      // A live GPS trigger is time-sensitive (you're physically passing the place) and PREEMPTS an
      // in-progress replay, which is merely re-hearable ("stops win" — replay-last-stop §3). Cut the
      // replay by freeing the pump: the clip-load effect then REPLACES the replay audio with this stop
      // (activeSeq changes → replace()). A real stop is NEVER preempted; only a replay is.
      if (replayingSeq.current !== null) {
        replayingSeq.current = null
        clipBusy.current = false
      }
      // Multiple stops on ONE fix play back-to-back with no gap (relies on the studio pipeline's spacing). Not a
      // crash, but surface it in dev so a too-tight cluster is visible rather than silent. (audit #296)
      if (events.length > 1 && __DEV__) console.warn(`[drive] ${events.length} stops fired on one fix`)
      setFiredSeqs((prev) => {
        const n = new Set(prev)
        for (const e of events) n.add(e.seq)
        return n
      })
      for (const e of events) queue.current.push(e.seq)
      pump()
    },
    [dot, pump],
  )

  const handleEnd = useCallback(() => {
    reachedEnd.current = true
    pump() // plays any remaining queued stop; ends the drive once the queue drains
  }, [pump])

  // ---- replay the last COMPLETED stop (the "wait — what did he just say?" gap the scrubber can't
  //      reach: the scrubber covers the ACTIVE clip, this covers the one that already ENDED). A pure
  //      playback action — it feeds the existing queue → pump → clip-load path and does NOT touch
  //      firedSeqs or the engine, so trigger/debounce state is untouched (the stop stays "fired").
  //      `replayingSeq` marks it preemptible so a live GPS trigger wins (handleFix). (replay-last-stop) ----
  const replayLast = useCallback(() => {
    if (activeSeqRef.current !== null || lastCompletedSeq === null) return // only in the between-stops quiet
    // Force the just-ended clip to RELOAD from its start: the clip-load effect skips replace() when
    // loadedSeq already equals activeSeq, and didJustFinish is guarded by finishedSeq — both still hold
    // the seq we're replaying. The same reset restart uses to force a reload from the head.
    loadedSeq.current = null
    finishedSeq.current = null
    clipRetried.current.clear()
    replayingSeq.current = lastCompletedSeq // mark it preemptible — a live GPS trigger wins (handleFix)
    queue.current.push(lastCompletedSeq)
    pump()
  }, [lastCompletedSeq, pump])

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
    staleStatus.current = false
    finishedSeq.current = null
    replayingSeq.current = null
    clipRetried.current.clear()
    seekTarget.current = null
    finishedWhileScrubbing.current = null
    pausedRef.current = false
    lastProgressAt.current = 0
    lastProgressTime.current = 0
    durationRef.current = 0
    resumeTried.current = false
    dot.setValue(0)
    setActiveSeq(null)
    setLastCompletedSeq(null)
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
    const triggerable = snapped.filter((s) => s.offRouteM <= OFF_ROUTE_MAX_M)
    // All trigger params (lead, heading gate, cone) come from DEFAULT_TRIGGER in engine — pass
    // nothing so a future change there takes effect here instead of being silently pinned by a
    // partial opts object that READS as if it were configured. (audit #933)
    engineRef.current = new TriggerEngine(triggerable)
    setDriving(true)
    const source =
      mode === 'live'
        ? liveSource(data.polyline)
        : simulatedSource(data.polyline, { mph: SIM_MPH, timeScale: fast ? SIM_FAST_SCALE : 1 })
    subRef.current = source(handleFix, handleEnd, handleSourceError)
    // ── drive_started. The engine is armed and the fix source is subscribed: this is the one line in
    // the app where a drive genuinely BEGINS. Every entry point either reaches it or ends in nothing
    // — the detail page's "Start the drive" tap can dead-end in the unsaved-download alert, and
    // "Let's roll" routes through the location prime and can terminate at the permission gate (whose
    // own Allow handler is a third caller of start()). Instrumenting any of those counts intentions.
    // ⚠ `mode` is the DERIVED drive mode handed down by the player screen (the Settings sim toggle
    // outranks `?mode=`, and one entry point carries no param at all) — do not re-derive it here.
    // Without it a simulated drive is indistinguishable from a real one on the launch dashboard,
    // because `app_env` tags the BUILD, not the clock.
    const startKey = `${driveId}:${mode}`
    if (!startedDrives.has(startKey)) {
      startedDrives.add(startKey)
      track('drive_started', { mode })
    }
  }, [data, driveId, mode, fast, resetForReady, handleFix, handleEnd, handleSourceError])

  // ---- location-permission priming (live mode) — the prime → prompt → result SHELL, shared with
  // useLocationPriming. This hook owns the pending-ref double-tap guard, the no-prompt
  // status read → undetermined-gate, the request-through, the defensive catch, and the finally;
  // it hands the RESULT back so we map it into THIS player's LocationBlock + sync beginDrive. ----
  const { priming: locationPriming, start: startPrimedDrive, confirmLocationPrime } =
    useLocationPriming({
      // Granted + precise → roll. beginDrive is sync (the live source subscribe is synchronous).
      onGranted: () => {
        beginDrive()
      },
      onDenied: ({ granted, canAskAgain }) => {
        // useDrive splits the gate: a hard DENIAL (canAskAgain decides re-prompt vs Settings) vs
        // granted-but-REDUCED (iOS approximate location — fixes too coarse to trigger; Settings-only,
        // since SDK 56 can't upgrade accuracy in-app). `granted` distinguishes them.
        if (!granted) setLocationBlock({ kind: 'denied', canAskAgain })
        else setLocationBlock({ kind: 'reduced' })
      },
      onError: () => {
        // requestForegroundPermissionsAsync threw (misconfig / concurrent request) — show the gate
        // with a retry instead of letting the tap silently do nothing.
        setLocationBlock({ kind: 'denied', canAskAgain: true })
      },
    })

  // ---- start: live mode primes BEFORE the first (one-shot) OS prompt; sim starts at once ----
  const start = useCallback(() => {
    if (!data) return
    if (mode !== 'live') {
      beginDrive()
      return
    }
    startPrimedDrive()
  }, [data, mode, beginDrive, startPrimedDrive])

  const togglePause = useCallback(() => {
    // Keep the setState updater PURE — drive the GPS side effect off a ref mirror instead. (audit nit)
    const next = !pausedRef.current
    pausedRef.current = next
    setPaused(next)
    if (next) subRef.current?.pause()
    else subRef.current?.resume()
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
    // .catch parity — if the Settings deep-link rejects, swallow it rather than
    // letting the tap silently do nothing with an unhandled rejection. (M14)
    void Linking.openSettings().catch(() => {})
  }, [])

  // ---- clip load / play: keyed on the active stop ----
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
      staleStatus.current = true // the player reports the OUTGOING clip until replace() lands (clip-end effect)
      setStallNote(null)
      // Stop the old clip before the async replace() so it doesn't bleed into the new one.
      try {
        player.pause()
      } catch {}
      player.replace({ uri })
      const stopName = data.stops.find((s) => s.seq === activeSeq)?.name ?? data.hostName
      try {
        player.setActiveForLockScreen(true, {
          title: stopName,
          artist: data.hostName,
          albumTitle: data.driveName,
          artworkUrl: LOCK_ARTWORK_URI, // bundled badge so the lock screen isn't a blank thumbnail (audit)
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
    // A clip that never produces real audio (expired 403 / decode fail / dead zone /
    // a stream buffering forever) never fires didJustFinish. After a grace, re-sign ONCE
    // (reloads the clip); if it STILL won't start on the second pass, skip the stop.
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
    }, PRE_START_STALL_MS)
    return () => {
      if (watchdog.current) {
        clearTimeout(watchdog.current)
        watchdog.current = null
      }
    }
  }, [activeSeq, urls, data, paused, player, onClipDone, resign])

  // ---- clip end → ducked-quiet (NOT next-stop): wait for the next GPS trigger ----
  // FRESH means audio actually ADVANCED — expo-audio flips `playing` true on the play()
  // INTENT while a stream buffers forever, so trusting it lets a stalled clip evade the
  // watchdog. ⚠ This is a FIELD-OBSERVED failure, not a hypothetical: a sheet frozen at 0:00 on thin
  // 5G, on this same player stack. Do not relax the freshness check back to `playing`.
  useEffect(() => {
    if (activeSeq === null) return
    const t = status.currentTime ?? 0
    // replace() is async: until it lands the player still reports the OUTGOING clip's clock, and those
    // statuses must not be read against the INCOMING seq. The clock REWINDING to the head is the
    // handover signal (expo-audio reports t=0 once the new source loads). Gating on `playing` alone is
    // not enough — the progress tracker below takes `t` unconditionally, so ONE stale tick pins
    // lastProgressTime past the new clip's whole runtime; its real ticks then never look like progress,
    // lastProgressAt freezes, and the post-start stall recovery gives up and SKIPS the stop behind a
    // false "couldn't load". Only reachable when the outgoing clip was still mid-play at the swap —
    // i.e. a GPS trigger preempting a replay. A clip that never loads keeps this set, which is right:
    // the pre-start watchdog owns that case. (replay-last-stop)
    if (staleStatus.current) {
      if (t > 0.5) return
      staleStatus.current = false
    }
    if (status.duration != null && status.duration > 0) durationRef.current = status.duration
    if (status.playing && t > 0.25) {
      sawFresh.current = true
      if (watchdog.current) {
        clearTimeout(watchdog.current)
        watchdog.current = null
      }
    }
    // Track forward progress for the post-start interruption/stall recovery below: every advance
    // resets the stall clock and clears a pending resume attempt. (audit #1)
    if (t > lastProgressTime.current + 0.05) {
      lastProgressTime.current = t
      lastProgressAt.current = Date.now()
      resumeTried.current = false
    }
    if (status.didJustFinish && sawFresh.current && finishedSeq.current !== activeSeq) {
      if (scrubbing.current) {
        // didJustFinish is a ONE-SHOT; if it lands mid-drag the finish path is suppressed and the clip
        // would never advance. Latch it and replay on scrub release (see setScrubbing). (audit #6)
        finishedWhileScrubbing.current = activeSeq
      } else {
        finishedSeq.current = activeSeq
        onClipDone(activeSeq)
      }
    }
  }, [status.playing, status.didJustFinish, status.currentTime, status.duration, activeSeq, onClipDone])

  // A new active clip → drop the carried seek target, mirror activeSeq into a ref for the stable
  // callbacks/interval below, and reset the post-start progress trackers. (audit #1, #6)
  useEffect(() => {
    seekTarget.current = null
    activeSeqRef.current = activeSeq
    lastProgressAt.current = Date.now()
    lastProgressTime.current = 0
    resumeTried.current = false
    finishedWhileScrubbing.current = null
  }, [activeSeq])

  // ---- post-start interruption / stall recovery (audit #1) ----
  // Once a clip has STARTED (sawFresh), expo-audio fires NO didJustFinish if the OS pauses it for an
  // interruption (call / Siri / Bluetooth or headphone handoff) or it buffer-dies mid-clip — and the
  // pre-start watchdog already disarmed. Without this, clipBusy latches and every later GPS-triggered
  // stop only enqueues: the skipper goes silent for the rest of the drive. Poll for a frozen clock,
  // try to resume once; if that doesn't take, complete the clip so the fire-queue keeps pumping.
  useEffect(() => {
    if (activeSeq === null || paused) return
    const iv = setInterval(() => {
      const seq = activeSeqRef.current
      if (seq === null || !sawFresh.current || finishedSeq.current === seq) return
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
          finishedSeq.current = seq
          onClipDone(seq)
          return
        case 'resume':
          resumeTried.current = true
          try {
            player.play() // resume after the interruption (no-op if already playing)
          } catch {}
          lastProgressAt.current = Date.now() // grace window for the resume to take
          return
        case 'giveUp': // resume didn't take — don't strand the drive on a dead clip
          setStallNote(voice.player.stall)
          onClipDone(seq)
          return
      }
    }, 2_000)
    return () => clearInterval(iv)
  }, [activeSeq, paused, player, onClipDone])

  // Drop the pending seek target once the clock catches up to it, so a LATER ±15 tap re-bases
  // on the real position instead of a stale committed target. (Pairs with seekBy above.)
  useEffect(() => {
    if (seekTarget.current != null && status.currentTime != null && seekTargetReached(status.currentTime, seekTarget.current)) {
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
      void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {}) // symmetric with the guarded activate (audit)
    }
  }, [driving, paused])

  // ---- track mount state for the async permission flow (review #4) ----
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // ---- mirror `data` into a ref so the GPS-source-captured handleFix always reads the latest (audit #377) ----
  useEffect(() => {
    dataRef.current = data
  }, [data])

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

  // ---- backgrounding recovery (live drive): a manual screen-lock or app-switch suspends the
  // foreground GPS watch (watchPositionAsync is foreground-only; keep-awake only blocks AUTO-sleep),
  // so triggering silently stops and any stop passed while backgrounded is missed. On return to the
  // foreground, restart the no-GPS grace window and show the "searching" cue until the next fix
  // arrives, so the gap is at least visible rather than a silently dead drive. (audit #4)
  useEffect(() => {
    if (mode !== 'live' || !driving) return
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return
      lastFixAt.current = Date.now()
      setGpsSearching(true) // honest "reconnecting" cue; handleFix clears it on the next usable fix
    })
    return () => sub.remove()
  }, [mode, driving])

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
        : locationBlock
          ? 'locationGate'
          : locationPriming
            ? 'locationPrime'
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
      const target = clampSeekSec(ms, dur)
      seekTarget.current = target
      try {
        void player.seekTo(target).catch(() => {}) // async rejection (media reset / unloaded source) (audit)
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

  const setScrubbing = useCallback(
    (active: boolean) => {
      scrubbing.current = active
      // A clip that finished DURING the drag had its one-shot didJustFinish latched — replay it on
      // release so the drive advances instead of dead-ending on a finished clip. (audit #6)
      if (!active && finishedWhileScrubbing.current !== null) {
        const seq = finishedWhileScrubbing.current
        finishedWhileScrubbing.current = null
        if (seq === activeSeqRef.current && finishedSeq.current !== seq) {
          finishedSeq.current = seq
          onClipDone(seq)
        }
      }
    },
    [onClipDone],
  )

  // Stable identity across renders — this rebuilt a fresh array every audio tick, which made
  // the player's auto-scroll effect (keyed on it) re-fire ~2×/sec and pin the stop list.
  const stops: DriveStopView[] = useMemo(
    () =>
      data?.stops.map((s) => ({
        seq: s.seq,
        name: s.name,
        stopType: s.stopType,
        lat: s.lat,
        lng: s.lng,
        attribution: s.attribution,
      })) ?? [],
    [data],
  )

  // The "next stop" strip: the first not-yet-fired stop.
  const nextSeq = data?.stops.find((s) => !firedSeqs.has(s.seq))?.seq ?? null

  // Offer replay only in the between-stops quiet, once a clip has completed — the scrubber
  // (seek-to-0) already covers "restart the ACTIVE clip". (replay-last-stop §3)
  const canReplay = driving && !paused && !done && activeSeq === null && lastCompletedSeq !== null

  return {
    phase,
    error,
    retry,
    driveName: data?.driveName ?? '',
    hostName: data?.hostName ?? '',
    stops,
    totalStops: stops.length,
    firedCount: firedSeqs.size,
    polyline: data?.polyline ?? [],
    progress: dot,
    activeSeq,
    firedSeqs,
    nextSeq,
    nowPlaying,
    buffering,
    stallNote,
    gpsSearching,
    offline,
    paused,
    positionMs,
    durationMs,
    canSeek,
    seekToMs,
    seekBy,
    setScrubbing,
    replayLast,
    canReplay,
    fast,
    setFast,
    confirmLocationPrime,
    locationCanAskAgain: locationBlock?.kind === 'denied' ? locationBlock.canAskAgain : true,
    locationReduced: locationBlock?.kind === 'reduced',
    openLocationSettings,
    start,
    togglePause,
    end,
    restart,
  }
}
