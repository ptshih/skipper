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
import { Animated, AppState, Image, Linking, useAnimatedValue } from 'react-native'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import {
  useAudioPlayer,
  useAudioPlayerStatus,
} from 'expo-audio'
import { applyExclusiveBackgroundAudio, releaseAudioSession } from './audio-session'
import {
  clampSeekSec,
  cumulativeMeters,
  decidePump,
  decideStall,
  LOCAL_CLIP_STALL_MS,
  OFF_ROUTE_MAX_M,
  seekTargetReached,
  snapStopsToRoute,
  TraceRecorder,
  TriggerEngine,
  type GpsFix,
  type TraceMeta,
} from '@skipper/engine'
import type { Attribution } from '@skipper/shared'
import { track, type StopSkipReason } from './analytics'
import { ApiError, errorMessage } from './api'
import { isAdmin, useSession } from './auth'
// ⚠ The IMPERATIVE read, not `useIsOffline`. The gate is an entry guard latched at load; subscribing
// would make it live again and re-gate a rolling drive the moment coverage returns.
import { isOfflineNow } from './connectivity'
import { cleanPlaceName } from './labels'
import { loadPlayback } from './offline'
// Pure + native-free (offline-util.ts's whole reason for existing), so importing it here costs this
// hook nothing and keeps both the GAP MATH and the GATE single definitions shared with the downloader
// and the drive-detail CTA — a second local copy of either is how the count and the download, or the
// CTA and the player, quietly disagree.
import { decideDriveGate, missingAudioSeqs } from './offline-util'
import Constants from 'expo-constants'
import { getDrivePermission, liveSource, simulatedSource, type FixSubscription, type RawFix } from './gps'
import { saveTrace } from './trace-export'
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

// ── THE IN-DRIVE TRACE ────────────────────────────────────────────────────────────────────────
// One mutable record per drive RUN, carried in a ref and read by every emit site below.
//
// ⚠ THE REF IS THE POINT, not a shortcut. `mode` and `data` are both state/props, and reading them
// at the emit sites would put them into the dependency arrays of finishDrive → pump →
// handleFix — and handleFix is the callback the GPS source CAPTURES ONCE at beginDrive (audit
// #377). Adding telemetry must not be able to move that callback graph: these events exist to
// verify the player, so an instrumentation-induced change in WHEN a stop fires would corrupt the
// very run they are measuring.
interface DriveTrace {
  mode: 'sim' | 'live'
  /** ms of beginDrive; 0 = no run in progress. Every emitter checks it first — without the
   *  sentinel a stray late callback would report `elapsed_sec` as seconds-since-the-epoch. */
  startedAt: number
  /** Seqs whose audio genuinely STARTED. A Set rather than a counter because it does double duty:
   *  it is also what keeps a rider-tapped REPLAY — which legitimately re-runs the freshness edge on
   *  an already-heard clip — from landing a second `stop_fired` for the same stop. */
  played: Set<number>
  /** Seqs already counted as SILENT — the mirror of `played`, and for the same reason. A stop fires at
   *  most once per drive (the engine debounces), so a SECOND skip for one seq can only come from a
   *  rider-tapped replay: tap a passed stop whose local clip is present but undecodable and it runs the
   *  watchdog again, emitting a second `stop_skipped` and inflating the `stops_skipped` that
   *  `drive_completed` reports. A funnel counter that over-fires corrupts silently. */
  skippedSeqs: Set<number>
  /** `drive_completed` latch. pump() is re-entrant by design; a double completion would inflate the
   *  one number that says the drive worked, and a funnel event that over-fires corrupts silently. */
  completed: boolean
}

function newTrace(mode: 'sim' | 'live', startedAt: number): DriveTrace {
  return { mode, startedAt, played: new Set(), skippedSeqs: new Set(), completed: false }
}

const elapsedSec = (t: DriveTrace): number => Math.max(0, Math.round((Date.now() - t.startedAt) / 1000))

/** The event payload a stop is allowed to carry — an ORDINAL and a closed form union, and nothing
 *  else. ⚠ INV-13: the stop's name, its coordinates and its clip url are all in scope at every call
 *  site below and NONE of them may ride an event (see analytics.tsx AnalyticsEventProps). Module
 *  scope so the emitters can be called from inside effects without entering one dependency array. */
function stopProps(t: DriveTrace, stops: DriveStop[] | undefined, seq: number) {
  // -1 when the seq isn't in the itinerary — unreachable today (every seq here came from it), and
  // an out-of-range ordinal is the honest report if it ever happens.
  const index = stops?.findIndex((s) => s.seq === seq) ?? -1
  const form = index >= 0 ? stops?.[index]?.stopType : undefined
  // ⚠ The ANNOTATION is what keeps this closed. `stopType` is a plain `string` off the manifest, and
  // an object-literal property widens an inferred literal union straight back to `string` — i.e. the
  // event would compile with whatever the wire happened to send. Naming the union here re-narrows
  // it, so a form we don't know lands as 'other' instead of becoming an open text channel.
  const stopForm: 'story' | 'scenic' | 'break' | 'other' =
    form === 'story' || form === 'scenic' || form === 'break' ? form : 'other'
  return {
    mode: t.mode,
    elapsed_sec: elapsedSec(t),
    stop_index: index,
    stop_form: stopForm,
  }
}

/** The drive's heartbeat: this stop's audio actually reached the rider. */
function emitStopFired(t: DriveTrace, stops: DriveStop[] | undefined, seq: number): void {
  if (t.startedAt === 0 || t.played.has(seq)) return
  t.played.add(seq)
  track('stop_fired', stopProps(t, stops, seq))
}

/** A stop went by in SILENCE. The counter it bumps is what `drive_completed` reports, so every
 *  silent branch must come through here — a skip emitted anywhere else would be missing from the
 *  drive's own summary. */
function emitStopSkipped(
  t: DriveTrace,
  stops: DriveStop[] | undefined,
  seq: number,
  reason: StopSkipReason,
): void {
  if (t.startedAt === 0) return
  // ⚠ ONCE PER SEQ. See `skippedSeqs` — a replay of a passed-but-broken stop re-runs the watchdog, and
  // without this the drive's own summary counts one silent stop twice.
  if (t.skippedSeqs.has(seq)) return
  t.skippedSeqs.add(seq)
  track('stop_skipped', { ...stopProps(t, stops, seq), reason })
}

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
  /** How long the skipper talks at this stop — the itinerary's trailing meta. Nullable because a
   *  manifest clip can ship without a measured duration; the row then shows nothing there. */
  durationMs?: number | null
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
  /** How many stops the rider has HEARD — `playedSeqs.size`. Named for what it counts: it was
   *  `firedCount` (triggers fired) while the list's checks came from the same set, so the two
   *  agreed by accident; they now agree on purpose. */
  playedCount: number
  /** The route as [lng, lat] pairs — for the map overlay's route line. */
  polyline: [number, number][]

  /** 0..1 route position for `RouteTrack`, driven imperatively by each GPS fix. */
  progress: Animated.Value
  /** The stop whose clip is currently loaded/playing, or null between stops (ducked-quiet). */
  activeSeq: number | null
  /**
   * Seqs the rider has actually HEARD — a clip that ran to its end, or one that was skipped for
   * having no audio. This is what the itinerary's "passed" check means.
   *
   * ⚠ The fired set is deliberately NOT exposed beside this one. It stays internal (it feeds
   * `nextSeq` and the engine's bookkeeping) precisely so no screen can reach for "the road got
   * there" when it means "the rider heard it" — which is the bug this pair was split to kill.
   *
   * ⚠ NOT the same set as `firedSeqs`, and conflating them was a real bug (founder, 2026-08-03:
   * "a bunch of stops are getting checked off even though they haven't played"). A trigger fires when
   * the CAR reaches a stop; the clip then joins a FIFO queue and plays only once the current one
   * finishes. Any gap between those two clocks shows up as checkmarks for stops nobody has heard.
   * The simulator's 8× makes it unmissable — the road runs at 8× while audio still runs at 1×, so the
   * queue backs up several stops deep — but it is NOT a sim-only artifact: `handleFix` already warns
   * when several stops fire on ONE fix, which is the same thing at real speed on a tight cluster.
   */
  playedSeqs: Set<number>
  /** First not-yet-fired stop, for the "ROLLING · next stop: X" strip. */
  nextSeq: number | null

  nowPlaying: boolean
  buffering: boolean
  stallNote: string | null
  /** True while a live drive is getting no usable GPS fixes — show a "searching" cue. (review #6) */
  gpsSearching: boolean
  /**
   * How many stops this session has NO audio for — the size of the silent gap, surfaced ONCE on the
   * ready card before the drive rolls.
   *
   * ⚠ WHY THIS EXISTS AT ALL. `loadPlayback` deliberately serves a PARTIAL local map rather than
   * error-walling a rider who has 39 of 40 stops (offline.ts), and a seq with no uri is then skipped
   * after 400 ms with NO note. So the gap was SILENT BY CONSTRUCTION: the rider drove past those stops
   * hearing nothing while the player said only what a COMPLETE copy says. The drive-detail screen
   * tracked the gap the whole time; it simply never reached the player.
   *
   * ⚠ It is deliberately NOT a mid-drive warning. The rider is told while PARKED, on the ready card,
   * where they could still act on it — and never again, because a note that fires at each silent stop
   * is exactly the eyes-off-the-road interruption the in-car doctrine forbids.
   *
   * Non-zero only on a PARTIAL copy: the gate below refuses to roll an incomplete drive wherever a
   * download could fix it, so the count reaches a rider exactly on the offline escape hatch — the one
   * path that rolls with a gap because blocking it would help nobody.
   */
  missingClipCount: number
  /**
   * The drive may NOT be driven from what is on disk — the copy is incomplete and a download could
   * fix it (`decideDriveGate`). The screen shows the gate instead of the player; `start` refuses
   * while it is true.
   *
   * ⚠ It is asserted HERE, not only on the drive-detail CTA, because `skipper://drives/<id>/play` is
   * a real deep link: a gate that lives only on the CTA is not a guard. Same expression on both
   * sides — authorising in one place and acting in another is the failure this repo keeps re-learning.
   */
  needsDownload: boolean
  paused: boolean

  // In-clip scrub (drive/quiet segments have no timeline).
  positionMs: number
  durationMs: number
  canSeek: boolean
  seekToMs: (ms: number) => void
  seekBy: (deltaSec: number) => void
  setScrubbing: (active: boolean) => void

  // Re-hear a stop the road already passed — fills the between-stops gap the scrubber can't reach.
  /** Re-play a PASSED stop's clip (live/sim only). No-op unless `isReplayable(seq)`; a live GPS
   *  trigger preempts an in-progress replay. Pure playback — does not alter trigger/fired state. */
  replayStop: (seq: number) => void
  /** Re-play the last completed stop clip — `replayStop` aimed at the replay-last control. */
  replayLast: () => void
  /** May this seq be re-heard right now? True when the ROAD has already passed the stop, we hold its
   *  audio, and we are in the between-stops quiet. The predicate is the surface; the "road got there"
   *  set behind it is not (see `playedSeqs` for why that set never leaves this hook). */
  isReplayable: (seq: number) => boolean
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
  /** 'live' = real device GPS (Phase 4, and the DEFAULT); 'sim' = the on-device drive simulator,
   *  which no rider can reach — it is the admin-only Settings→Developer toggle. (The map-less couch
   *  'preview' clock was cut — auditioning is the drive-detail mini-preview now; see
   *  docs/decisions/detail-page-mini-preview.md.) */
  mode?: 'sim' | 'live'
  /** Seed the sim fast-replay (8×) ON. Used when the GLOBAL Settings→Developer sim toggle
   *  forced this drive into sim — couch-testing a full drive at real 1× is impractical (a
   *  30-min drive takes 30 real min), so default to fast there; the pre-drive knob still
   *  lets the rider switch back to real-time for trigger-timing tests. (Ignored unless sim.) */
  defaultFast?: boolean
}

export function useDrive(driveId: string | undefined, opts: UseDriveOptions = {}): UseDrive {
  // ⚠ The default is 'live', and it is load-bearing. The caller's mode is now a one-liner off the
  // (admin-only) sim setting, and a one-liner prop is exactly the kind a later cleanup drops as
  // tidying — with a 'sim' default, dropping it would silently SIMULATE every production drive: real
  // GPS never subscribed, the road never actually driven, and nothing anywhere reporting a fault.
  const mode = opts.mode ?? 'live'
  const { data: session } = useSession()
  const [data, setData] = useState<DriveData | null>(null)
  const [urls, setUrls] = useState<Map<number, string>>(new Map())
  // See `missingClipCount` on the returned surface for why the gap is measured at all. Computed ONCE,
  // from the map actually handed to the player, so it counts what will really be silent rather than
  // what the manifest hoped for.
  const [missingClipCount, setMissingClipCount] = useState(0)
  /**
   * THE GATE'S VERDICT, LATCHED AT LOAD — deliberately NOT a live expression.
   *
   * ⚠ IT IS AN ENTRY GUARD: it answers "should this screen have opened at all", which is a question
   * about how the player was REACHED. Deriving it at render time from a REACTIVE connectivity verdict
   * made it a live condition, and that is a mid-drive catastrophe on exactly the rider §2's escape
   * hatch exists for: park in a dead zone with 19 of 20 stops (offline+partial ⇒ 'play'), start
   * driving, crest a ridge into coverage — the verdict flips to 'needs-download' and the player screen
   * swaps itself for the save-it-first wall WHILE THE CAR IS MOVING. The hook stays mounted, so the
   * clip keeps talking and the GPS keeps running; the rider just loses the map, the scrubber, pause
   * and "Pull over", and the only offered action asks them to END the drive. Coverage flapping does it
   * repeatedly.
   *
   * `play.tsx` had already learned this exact lesson one screen over — it latches `offlineAtOpen` with
   * the note that "Tahoe coverage flaps — so reading the live verdict would re-lay-out the screen,
   * mid-drive, repeatedly, with the rider touching nothing." Same reasoning, same latch.
   *
   * The other two inputs (`urls`, `missingClipCount`) are already frozen at load, so connectivity was
   * the only thing that could move — which is why an imperative `isOfflineNow()` read at load is the
   * whole fix. A rider who gains signal while PARKED here can back out; the drive-detail CTA reads the
   * live verdict and will gate them properly on the way back in.
   */
  const [needsDownload, setNeedsDownload] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsAccount, setNeedsAccount] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const [driving, setDriving] = useState(false)
  const [paused, setPaused] = useState(false)
  const [done, setDone] = useState(false)
  const [activeSeq, setActiveSeq] = useState<number | null>(null)
  // "The road reached this stop" — INTERNAL (feeds `nextSeq` + trigger bookkeeping); never the
  // itinerary's checkmarks. See `playedSeqs` on the returned interface for why the two are split.
  const [firedSeqs, setFiredSeqs] = useState<Set<number>>(new Set())
  const [playedSeqs, setPlayedSeqs] = useState<Set<number>>(new Set())
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

  const dot = useAnimatedValue(0)

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
  // This run's analytics trace (see DriveTrace). Idle until beginDrive replaces it — `startedAt: 0`.
  const trace = useRef<DriveTrace>(newTrace('sim', 0))

  // The black box for THIS run (dev-only, live drives only). Its metadata is captured at beginDrive
  // and carried here rather than read at flush time, which is what keeps `teardownSource`'s dep array
  // EMPTY — this callback is upstream of finishDrive → pump → handleFix, the one the GPS source
  // captures once, so a dep added here silently rebuilds the whole chain mid-drive.
  const recorderRef = useRef<{ rec: TraceRecorder; meta: TraceMeta } | null>(null)
  // Whether THIS rider may record. Mirrored into a ref by the effect near `dataRef` — see there.
  const isAdminRef = useRef(false)

  // ── THE TWO WAYS THE AUDIO STOPS, and the distinction that was missing ──────────────────────
  // `silence` quiets the player and drops the lock screen. `endAudio` does that AND hands the audio
  // session back.
  //
  // ⚠ THEY ARE NOT INTERCHANGEABLE, and reading them as if they were is what broke this: a drive
  // holds an EXCLUSIVE `doNotMix` session for its whole length, which means it STOPPED the rider's
  // own music, and pausing the player does not give it back — iOS resumes them only once the session
  // is deactivated. Only `finishDrive` ever did that, so a rider who tapped "Pull over" or swiped
  // back mid-drive was left with silence where their podcast used to be, until something else
  // happened to grab focus. Every way OUT of a drive owes the session back; `resetForReady` is the
  // one caller that must not, because it is also how a drive is prepared — it runs inside
  // `beginDrive`, moments before the first clip plays.
  const silence = useCallback(() => {
    try {
      player.pause()
    } catch {}
    try {
      player.setActiveForLockScreen(false)
    } catch {}
  }, [player])

  const endAudio = useCallback(() => {
    silence()
    releaseAudioSession()
  }, [silence])

  const teardownSource = useCallback(() => {
    subRef.current?.stop()
    subRef.current = null
    // Flush the trace HERE, at the single choke point every ending passes through — an abandoned
    // drive ("Pull over", a back-out) is worth recording at least as much as a completed one, since
    // "why did I give up on it" is exactly the question a trace answers. Best-effort by construction:
    // a failed write must never take the drive down with it.
    const held = recorderRef.current
    recorderRef.current = null
    if (held && held.rec.count > 0) {
      held.rec.stop()
      saveTrace(held.rec.envelope(held.meta))
    }
  }, [])

  // ---- load: drive geometry + the saved audio + the audio session ----
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!driveId) return
      setError(null)
      setNeedsAccount(false)
      try {
        await applyExclusiveBackgroundAudio()
        // DISK ONLY, always: the saved manifest plus local file:// clips, zero network (offline.ts).
        // A drive's audio is never streamed any more, so there is no "else" branch here to pick — the
        // url map keys those local files by seq, and it throws when nothing is saved at all.
        const { detail: manifest, urls, expectedSeqs } = await loadPlayback(driveId)
        if (cancelled) return
        const polyline = manifest.polyline as [number, number][]
        if (polyline.length < 2) throw new Error('This drive has no drivable route.')
        const cum = cumulativeMeters(polyline)
        // A drive's clips are place NARRATIONS, each with coords (V2 has no placeless framing —
        // asides were deleted; see docs/decisions/geometry-first-regions.md).
        const narrationClips = manifest.clips.filter(
          (c): c is typeof c & { lat: number; lng: number } => c.lat != null && c.lng != null,
        )
        setUrls(urls)
        // The silent gap, measured against the map the player will actually read. ⚠ The expected list
        // comes off the SAVED manifest (`Playback.expectedSeqs`, captured at download time) rather than
        // being re-derived from `manifest.clips`: a saved clip has no `url` by TYPE, so the "should have
        // audio" predicate reads every stop as un-downloadable and the count came out 0 — silent
        // exactly where the offline escape hatch depends on the rider being told.
        const missing = missingAudioSeqs(expectedSeqs, urls.keys()).length
        setMissingClipCount(missing)
        // THE GATE, decided ONCE, here — see the ⚠ on `needsDownload`. `isOfflineNow()` is the
        // imperative read on purpose: subscribing would make an entry guard live again.
        setNeedsDownload(
          decideDriveGate({
            online: !isOfflineNow(),
            hasAnyLocal: urls.size > 0,
            missingCount: missing,
          }) !== 'play',
        )
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

  // ---- the whole drive finished (sim ran out + nothing left to play) ----
  const finishDrive = useCallback(() => {
    teardownSource()
    endAudio()
    setActiveSeq(null)
    setDriving(false)
    setDone(true)
    // ── drive_completed. HERE and nowhere else: finishDrive is only reachable from decidePump's
    // 'finish' (the road ran out AND the fire-queue drained), so a rider "Pull over" / back-out —
    // which runs resetForReady instead — stays an ABANDON and is not counted as an arrival.
    // ⚠ Reads the trace ref, not `firedSeqs`/`data` state, so this callback's deps are unchanged:
    // pump and handleFix hang off it (see DriveTrace).
    const t = trace.current
    if (t.startedAt > 0 && !t.completed) {
      t.completed = true
      track('drive_completed', {
        mode: t.mode,
        elapsed_sec: elapsedSec(t),
        // The itinerary's own length — `stops_played + stops_skipped` leaves the stops that never
        // triggered at all, which is a trigger/route question rather than an audio one.
        stops_total: dataRef.current?.stops.length ?? 0,
        stops_played: t.played.size,
        stops_skipped: t.skippedSeqs.size,
      })
    }
  }, [endAudio, teardownSource])

  // ---- pump: if idle, play the next queued stop; else, end the drive if the road's done ----
  const pump = useCallback(() => {
    // The decision (and the ORDER of its checks — busy beats queued beats finishing) lives in
    // @skipper/engine's player.ts, where it is unit-tested; this owns only the side effects.
    const action = decidePump({
      clipBusy: clipBusy.current,
      queue: queue.current,
      reachedEnd: reachedEnd.current,
    })
    if (action.kind === 'play') {
      queue.current.shift() // decidePump reads the head; dequeuing is the caller's job
      clipBusy.current = true
      setActiveSeq(action.seq)
      return
    }
    if (action.kind === 'finish') finishDrive()
    // 'wait' (a clip is playing) and 'idle' (nothing queued, road unfinished) both do nothing.
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
      // HEARD — the itinerary's checkmark. This is the one place a clip ends, for both outcomes that
      // count as "the rider is done with this stop": it played out, or it was skipped for having no
      // audio (a silent stop the road still went past). A REPLAY lands here too and re-adds a seq
      // already in the set, which is a no-op by construction.
      setPlayedSeqs((prev) => (prev.has(_seq) ? prev : new Set(prev).add(_seq)))
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

  // ---- re-hear a stop the road already PASSED (the "wait — what did he just say?" gap the scrubber
  //      can't reach: the scrubber covers the ACTIVE clip, this covers one that already ENDED).
  //
  // ⚠ THE "ONLY IN THE BETWEEN-STOPS QUIET" HALF IS LOAD-BEARING, not a UX nicety, and it is the half
  // a generalization drops. `replayingSeq` is a SINGLE ref, and it is set at ENQUEUE time — sound only
  // because this refuses unless the queue is quiet, so the pushed seq becomes the active clip
  // immediately. Allow two queued replays and one ref must mark both: the second is silently
  // un-preemptible, and the ROAD stops winning over rider-initiated playback — which is the one
  // priority rule the in-car doctrine actually has. Widen this to a queue and `replayingSeq` must
  // become a Set in the same change; do not do the first half alone.
  //
  // ⚠ Audio we HOLD, too: replaying a stop with no local clip would re-run the no-audio branch and
  // emit a second `stop_skipped` for a stop the rider already drove past in silence — a rewind that
  // inflates the very number that measures the silence. You can't re-hear silence.
  const isReplayable = useCallback(
    (seq: number): boolean =>
      driving && !paused && !done && activeSeq === null && firedSeqs.has(seq) && urls.has(seq),
    [driving, paused, done, activeSeq, firedSeqs, urls],
  )

  // A pure playback action — it feeds the existing queue → pump → clip-load path and does NOT touch
  // firedSeqs or the engine, so trigger/debounce state is untouched (the stop stays "fired").
  // `replayingSeq` marks it preemptible so a live GPS trigger wins (handleFix). (replay-last-stop)
  const replayStop = useCallback(
    (seq: number) => {
      if (!isReplayable(seq)) return
      // Force the clip to RELOAD from its start: the clip-load effect skips replace() when loadedSeq
      // already equals activeSeq, and didJustFinish is guarded by finishedSeq — both can still hold
      // the seq we're replaying. The same reset restart uses to force a reload from the head.
      loadedSeq.current = null
      finishedSeq.current = null
      replayingSeq.current = seq // mark it preemptible — a live GPS trigger wins (handleFix)
      queue.current.push(seq)
      pump()
    },
    [isReplayable, pump],
  )

  // The replay-last control's aim: the last clip that actually PLAYED. One mechanism, no second
  // notion of "replayable" — `replayStop` re-asserts the predicate.
  const replayLast = useCallback(() => {
    if (lastCompletedSeq !== null) replayStop(lastCompletedSeq)
  }, [lastCompletedSeq, replayStop])

  // ---- reset all drive state back to the pre-drive "ready" line ----
  const resetForReady = useCallback(() => {
    teardownSource()
    if (watchdog.current) {
      clearTimeout(watchdog.current)
      watchdog.current = null
    }
    silence()
    engineRef.current = null
    queue.current = []
    clipBusy.current = false
    reachedEnd.current = false
    loadedSeq.current = null
    sawFresh.current = false
    staleStatus.current = false
    finishedSeq.current = null
    replayingSeq.current = null
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
    setPlayedSeqs(new Set())
    setStallNote(null)
    setPaused(false)
    setDone(false)
    setDriving(false)
    setLocationBlock(null)
    setGpsSearching(false)
  }, [silence, dot, teardownSource])

  // ---- the live fix source couldn't produce GPS (watch failed to acquire) — surface, don't hang ----
  const handleSourceError = useCallback(() => {
    resetForReady()
    releaseAudioSession() // the drive is over before it began — don't sit on the rider's music
    setError(voice.player.gpsError) // → 'error' phase with a retry, instead of a silent frozen drive
  }, [resetForReady])

  // ---- begin the drive: fresh engine (TriggerEngine has no reset) + subscribe the source ----
  // The source is the one seam between the simulator and the real drive: a `simulatedSource`
  // (couch-testable) or the `liveSource` (real device GPS), interchangeable behind GpsFixSource.
  const beginDrive = useCallback(() => {
    if (!data) return
    resetForReady()
    // ⚠ RE-APPLY THE SESSION ON EVERY START, not just on load. Ending a drive releases it, and a
    // release switches audio off app-wide (see ./audio-session) — so a rider who pulls over and rolls
    // again would otherwise drive a completely silent route. The load effect cannot cover this: it is
    // keyed on the drive id, and starting again reloads nothing.
    void applyExclusiveBackgroundAudio()
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
    // A fresh trace per RUN — `restart` produces a second complete trace, never a continuation of
    // the first. Set before the emits below, which are already part of this run.
    trace.current = newTrace(mode, Date.now())
    // ── stop_skipped / 'off_route'. The ONE place this class of silence is visible: a stop dropped
    // here never enters the engine, so it is absent from firedSeqs exactly like a stop the road
    // hasn't reached yet — while the itinerary still lists it and the rider still drives past it.
    // Emitted per dropped stop (normally none) rather than as a count, so "which stops went quiet"
    // has a single answer covering all five silent branches.
    for (const s of snapped) {
      if (s.offRouteM > OFF_ROUTE_MAX_M) emitStopSkipped(trace.current, data.stops, s.seq, 'off_route')
    }
    // All trigger params (lead, heading gate, cone) come from DEFAULT_TRIGGER in engine — pass
    // nothing so a future change there takes effect here instead of being silently pinned by a
    // partial opts object that READS as if it were configured. (audit #933)
    engineRef.current = new TriggerEngine(triggerable)
    setDriving(true)
    // ── the black box. Live drives only (a synthetic drive's fixes are already reproducible from the
    // polyline, so recording them banks nothing), and ADMINS only.
    //
    // ⚠ Admin, deliberately NOT `__DEV__` (founder, 2026-08-03). Under `__DEV__` the only build that
    // records is one launched from Xcode — and the drives that matter will be driven on TestFlight,
    // so the gate would have silently discarded exactly the traces this exists to capture. That loss
    // is the one that cannot be undone: a drive not recorded is gone. `isAdmin` is the same
    // server-set role that already gates the Developer screen these traces are read from, so this
    // widens nothing a non-admin can reach. Traces remain LOCAL-ONLY — nothing here uploads, and the
    // only exit is an explicit tap into the share sheet. See @skipper/engine trace.ts.
    //
    // Attached BEFORE the accuracy gate so the trace keeps the fixes the gate threw away; a post-gate
    // trace always replays clean and therefore proves nothing.
    let onRaw: ((raw: RawFix) => void) | undefined
    // `driveId` is narrowed here rather than asserted: `data` only ever loads for a real id, but the
    // type does not know that, and a trace stamped with an empty id cannot be matched to a route.
    if (mode === 'live' && isAdminRef.current && driveId) {
      const rec = new TraceRecorder()
      recorderRef.current = {
        rec,
        meta: {
          driveId,
          label: data.driveName,
          recordedAt: new Date().toISOString(),
          appVersion: Constants.expoConfig?.version,
          polyline: data.polyline,
        },
      }
      onRaw = rec.record
    }
    const source =
      mode === 'live'
        ? liveSource(data.polyline, onRaw)
        : simulatedSource(data.polyline, { mph: SIM_MPH, timeScale: fast ? SIM_FAST_SCALE : 1 })
    subRef.current = source(handleFix, handleEnd, handleSourceError)
    // ── drive_started. The engine is armed and the fix source is subscribed: this is the one line in
    // the app where a drive genuinely BEGINS. Every entry point either reaches it or ends in nothing
    // — the detail page's "Start the drive" tap dead-ends while the copy is still coming down, and
    // "Let's roll" routes through the location prime and can terminate at the permission gate (whose
    // own Allow handler is a third caller of start()). Instrumenting any of those counts intentions.
    // ⚠ `mode` is the DERIVED drive mode handed down by the player screen — one expression off the
    // (admin-only) sim setting, with no route param in it — so do not re-derive it here.
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

  // ---- THE GATE, asserted here as well as on the drive-detail CTA ----
  // ONE expression, shared with that CTA (`decideDriveGate`) — the player asks it because
  // `skipper://drives/<id>/play` is a real deep link, so a gate that lives only on the CTA is not a
  // guard at all. It asks nothing about MODE: a simulated drive plays the same local files.
  // ⚠ Only meaningful once `data` is loaded; before that the empty url map would read as "nothing
  // saved" on every drive. `loadPlayback` throws when the disk holds nothing, so a loaded drive
  // always has SOME audio — leaving this a straight complete-vs-partial question, with the offline
  // escape hatch (never block a rider we cannot help) inside the shared expression.
  // (The verdict itself is latched at load — see `needsDownload`'s declaration for why it must not be
  // a live expression. This block is only the record of WHERE it is asked and why the player asks at
  // all.)

  // ---- start: live mode primes BEFORE the first (one-shot) OS prompt; sim starts at once ----
  const start = useCallback(() => {
    // The gate REFUSES, rather than merely being reported: a screen that forgot to render it would
    // otherwise roll an incomplete drive, which is exactly the deep-link hole above.
    if (!data || needsDownload) return
    if (mode !== 'live') {
      beginDrive()
      return
    }
    startPrimedDrive()
  }, [data, needsDownload, mode, beginDrive, startPrimedDrive])

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
    // "Pull over" is a way OUT of the drive, so the session goes back — see `endAudio`. (Not folded
    // into resetForReady, which also runs on the way IN, inside beginDrive.)
    releaseAudioSession()
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
      const t = setTimeout(() => {
        // ── stop_skipped / 'no_audio' — the silent hole this whole event was built for. Emitted
        // INSIDE the timer, beside onClipDone, not when the branch is entered: the effect re-runs
        // (a pause toggle re-arms this timer), and only the timer that actually completes is a
        // stop the rider really drove past.
        emitStopSkipped(trace.current, data.stops, activeSeq, 'no_audio')
        onClipDone(activeSeq)
      }, 400)
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
    // A clip that never produces real audio (a truncated or undecodable download) never fires
    // didJustFinish, and clipBusy would stay set — the sequential pump, and the end of the drive,
    // hang forever on a silent clip. So: one grace window, then skip the stop.
    //
    // ⚠ ONE PASS, and that HALVES THE DEAD AIR. The old ladder re-signed the url first and re-armed
    // this same timer, so a dead clip cost 2× the window before the drive moved on. There is nothing
    // to re-sign now — the uri is a `file://` on this device, it cannot expire, and reloading it
    // re-resolves to the identical bytes.
    // ⚠ And the window itself is the SHORT one (LOCAL_CLIP_STALL_MS, not the remote budget): a local
    // file decodes or it does not. That value is still a desk estimate and owes a real-device check —
    // if local decode state lags the way a stream's did, too short trades dead air for lost stops,
    // which is the worse currency.
    watchdog.current = setTimeout(() => {
      if (sawFresh.current) return
      setStallNote(voice.player.stall)
      emitStopSkipped(trace.current, data.stops, activeSeq, 'load_timeout')
      onClipDone(activeSeq)
    }, LOCAL_CLIP_STALL_MS)
    return () => {
      if (watchdog.current) {
        clearTimeout(watchdog.current)
        watchdog.current = null
      }
    }
  }, [activeSeq, urls, data, paused, player, onClipDone])

  // ---- clip end → ducked-quiet (NOT next-stop): wait for the next GPS trigger ----
  // FRESH means audio actually ADVANCED — expo-audio flips `playing` true on the play() INTENT,
  // before a single sample has been decoded, so trusting it lets a clip that never starts evade the
  // watchdog. ⚠ This is a FIELD-OBSERVED failure, not a hypothetical: a sheet frozen at 0:00 on thin
  // 5G, on this same player stack. That observation came from a STREAM, which a drive no longer has —
  // but it is evidence about expo-audio's status reporting, not about the network, and the pre-start
  // window it guards is now seconds rather than tens of them. Do not relax it back to `playing`.
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
      // ── stop_fired, on the freshness EDGE — the one instant we know audio truly reached the
      // rider, and the same instant the pre-start watchdog is disarmed just below. Read before the
      // assignment rather than restructured around it: the three statements in this branch must
      // keep running exactly when they ran before (a watchdog re-armed by a pause/resume is still
      // cleared here on every later tick), so the emit is added, nothing is moved.
      if (!sawFresh.current) emitStopFired(trace.current, dataRef.current?.stops, activeSeq)
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
          // The rider heard PART of this one before it froze — deliberately its own reason, since
          // a mid-clip death (call / Siri / Bluetooth handoff / buffer death) is a different defect
          // from a stop that was silent from the first second. 'completeAtEnd' above is NOT a skip:
          // the clip effectively finished, didJustFinish simply never arrived.
          emitStopSkipped(trace.current, dataRef.current?.stops, seq, 'stalled_mid_clip')
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

  // ---- mirror admin into a ref, for the same reason `data` is mirrored below: `beginDrive` sits
  // upstream of the callback the GPS source captures once, so reading a session value directly there
  // would put it in that dep array. A ref keeps the recorder gate out of the callback graph entirely.
  useEffect(() => {
    isAdminRef.current = isAdmin(session)
  }, [session])

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
      endAudio() // navigating away is an exit too — the rider's music must come back
      if (watchdog.current) clearTimeout(watchdog.current)
    }
  }, [endAudio, teardownSource])

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
        durationMs: s.audioDurationMs,
        attribution: s.attribution,
      })) ?? [],
    [data],
  )

  // The "next stop" strip: the first not-yet-fired stop.
  const nextSeq = data?.stops.find((s) => !firedSeqs.has(s.seq))?.seq ?? null

  // Offer replay only in the between-stops quiet, once a clip has completed — the scrubber
  // (seek-to-0) already covers "restart the ACTIVE clip". (replay-last-stop §3) Asked THROUGH
  // `isReplayable` so the button and the action can never disagree about what "replayable" means.
  const canReplay = lastCompletedSeq !== null && isReplayable(lastCompletedSeq)

  return {
    phase,
    error,
    retry,
    driveName: data?.driveName ?? '',
    hostName: data?.hostName ?? '',
    stops,
    totalStops: stops.length,
    // The header counter counts what the rider has HEARD, so it can never disagree with the checks
    // in the list right below it — one claim, one set.
    playedCount: playedSeqs.size,
    polyline: data?.polyline ?? [],
    progress: dot,
    activeSeq,
    playedSeqs,
    nextSeq,
    nowPlaying,
    buffering,
    stallNote,
    gpsSearching,
    missingClipCount,
    needsDownload,
    paused,
    positionMs,
    durationMs,
    canSeek,
    seekToMs,
    seekBy,
    setScrubbing,
    replayStop,
    replayLast,
    isReplayable,
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
