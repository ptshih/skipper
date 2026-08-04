// HOME IS THE CONVERSATION (1.1 D6). The rider plans a drive by TALKING to the skipper; there is no
// form, no picker, no endpoint list — `app/create.tsx` and `GET /drives/anchors` were both deleted in
// this step. MY DRIVES stays below as the archive.
//
// This screen is the ONLY place the planner's moving parts are assembled, and it holds three things
// nothing else does:
//   1. THE TRANSCRIPT. D10 — the planner is stateless, there is no `conversations` table and no server
//      copy, so this React state is the ONLY copy of the conversation that exists anywhere. Anything
//      that unmounts home destroys it, which is why the account wall and the route card render INLINE
//      (never `<AccountGate>`, never a `router.replace`).
//   2. THE SPEND. Every send bills an anonymous Opus call; every drawn route bills a Google Routes
//      call; every "Make this drive" spends a NON-REFUNDABLE credit. So: no auto-retry (a retry is a
//      rider tap), no auto-fire on return from sign-up, and a synchronous double-tap guard that is
//      PER-CARD — a conversation can hold several cards and a screen-level guard would let card #1
//      block card #2 (or worse, let card #2 dedupe against card #1's idempotency key).
//   3. THE WIRE SHAPE. Everything sent goes through `toWire()`; see the ⚠ at `send` below.
//
// ⚠ INV-13: nothing here logs. Every string on this screen is rider content or model output, and none
// of it is persisted — not to disk, not to the region cache (which holds public place NAMES only).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { StyleSheet, View, type TextInput } from 'react-native'
import { Stack, useFocusEffect, useIsFocused, useRouter } from 'expo-router'
import { MAX_PLAN_DRAWN, type PlannedRoute } from '@skipper/shared'
// ⚠ The TYPED contract, and the only analytics surface there is (src/lib/analytics.tsx owns the raw
// client, unexported). Every property below is a number, a boolean or a closed union — INV-13 applies
// to analytics exactly as it applies to logs: no rider prose, no place name, no coordinate, no url, no
// drive id. A property that does not typecheck against that map is a signal to drop the property.
import { track } from '@/lib/analytics'
import {
  ApiError,
  createDrive,
  errorMessage,
  listDrives,
  listRegions,
  proposeDrive,
  type DriveProposal,
  type DriveSummary,
  type Region,
} from '@/lib/api'
import { isSignedIn, useSession } from '@/lib/auth'
import { useIsOffline } from '@/lib/connectivity'
import { listDownloadedDrives } from '@/lib/offline'
import { isPlanAborted, planTurn } from '@/lib/planner'
import {
  buildExampleAsks,
  EXAMPLE_ROTATION_STRIDE,
  rotateNames,
  type ExampleAsk,
} from '@/lib/planner-examples'
import { markListenRowSeen, shouldShowListenRow } from '@/lib/client-flags'
import { driveMinutes } from '@/lib/labels'
import { useLatestRun } from '@/lib/useLatestRun'
import { useNavigateOnce } from '@/lib/useNavigateOnce'
import {
  buildPlaceholderExamples,
  placeholderAt,
  shouldRotatePlaceholder,
  PLACEHOLDER_ROTATE_MS,
} from '@/lib/placeholder-util'
import {
  proposeKey,
  reflowDrawnCard,
  toCreateRequest,
  toProposeRequest,
} from '@/lib/planner-route'
import {
  appendRider,
  appendSkipper,
  lastRouteOf,
  resetTranscript,
  seedAdjust,
  seedExample,
  toWire,
  type Turn,
} from '@/lib/planner-transcript'
import { readCachedRegion, writeCachedRegion } from '@/lib/region-cache'
import { pickRegionId } from '@/lib/region-select'
import { emptySayBuffer, pushDelta, settle, tickHold, type SayBuffer } from '@/lib/say-buffer'
import { useRoutePreview } from '@/lib/useRoutePreview'
import { uuidV4 } from '@/lib/uuid'
import { useReducedMotion } from '@/theme'
import { space } from '@/theme/tokens'
import {
  Button,
  Card,
  Composer,
  ConversationScreen,
  CreditHint,
  Divider,
  DriveCardSkeleton,
  DriveList,
  HeaderIconButton,
  Icon,
  useFloatingHeaderInset,
  PlannerUnavailableCard,
  SkeletonGroup,
  RegionChip,
  Ridgeline,
  useRegionPicker,
  type IconName,
  SuggestionRow,
  ListenRow,
  Text,
  TranscriptCard,
  TurnBubble,
  TypingDots,
  voice,
  type PreviewItem,
} from '@/ui'

// One glyph per ask SHAPE — keyed on `ExampleAsk.shape`, never on list position, because the list
// degrades in regions with fewer than two curated names and position stops identifying a shape there.
const EXAMPLE_ICONS: Record<ExampleAsk['shape'], IconName> = {
  aToB: 'trailSign', // a routed signpost: somewhere to somewhere
  open: 'scenic', // the skipper's own eye picks it
}

/** How often the max-hold flush is re-evaluated while a turn streams. Not a token bucket and not a
 *  cap — it is only the resolution at which `tickHold` can notice that a fragment has waited out
 *  SAY_MAX_HOLD_MS. Six ticks per hold is plenty; a faster interval would re-render for nothing. */
const HOLD_TICK_MS = 100

/** The ridge's resting offset inside the content box. NAMED because the element adds the floating
 *  bar's height to it at the call site, and a style object cannot be read back for that arithmetic
 *  without lying about the type of `top` (a DimensionValue, not a number). */
const WATERMARK_TOP = 4

// ⚠ `PreviewItem` MOVED to `src/ui/TranscriptCard.tsx` and is imported from `@/ui` — the card owns
// its own contract, and `src/ui` may not import from `app/`.

export default function HomeScreen() {
  const router = useRouter()
  const { data: session } = useSession()
  // ⚠ INV-9 — the ONE client-side "is this rider signed in?" (src/lib/auth.ts). A truthy `session` is
  // NOT signed in: after D16's mint every rider carries one and an anonymous rider owns nothing.
  // Never inline `!!session` anywhere below.
  const signedIn = isSignedIn(session)
  // ONE expo-audio player for the whole conversation, keyed by CARD id (see useRoutePreview). The
  // screen owns the audio; PreviewCard stays pure presentation, same rule as everything else here
  // that spends or holds state.
  const preview = useRoutePreview()
  // Only the watermark needs this, and only because it is absolutely positioned — see its comment.
  const headerInset = useFloatingHeaderInset()
  // Drives the offline INVERSION below (MY DRIVES first, no composer) and the reconnect self-heal.
  // Fails OPEN — an unknown verdict means online — so the degraded layout only ever appears on a
  // DEFINITE offline (see connectivity.ts).
  const isOffline = useIsOffline()
  // ⚠ AN ACCESSIBILITY GUARD, not a render optimisation — it gates the VoiceOver announce below, and
  // the reason it is needed at all is the same fact that keeps the transcript alive: home STAYS
  // MOUNTED under a push. A turn in flight is not aborted when the rider leaves (only unmount aborts
  // it), so a reply settling while they are in Settings or inside a drive would push itself to
  // VoiceOver over a screen it has nothing to do with. `useIsFocused` re-renders on the focus edge,
  // which is what lets a held announce arrive when the rider actually comes back.
  const focused = useIsFocused()

  // ── MY DRIVES (the archive) ─────────────────────────────────────────────────────────────────
  const [drives, setDrives] = useState<DriveSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // True when the /drives fetch failed but saved downloads carried us (dead-zone fallback).
  const [offline, setOffline] = useState(false)
  // Free credit balance for the gentle "N free drives left" hint. Null = hidden, and there are only
  // two ways to get there: an anonymous rider (no gated call is made at all) or a server old enough
  // to predate the field (it is nullish on the wire). There is NO uncapped/paid case to hide for —
  // premium is credits, not a plan, so every account has a balance (docs/decisions/cut-tiers.md).
  const [credits, setCredits] = useState<{ remaining: number; cap: number } | null>(null)

  // ── The conversation ────────────────────────────────────────────────────────────────────────
  const [regions, setRegions] = useState<Region[] | null>(null)
  const [regionId, setRegionId] = useState<string | null>(null)
  const [regionsFailed, setRegionsFailed] = useState(false)
  const [turns, setTurns] = useState<Turn[]>(() => resetTranscript())
  const [cards, setCards] = useState<PreviewItem[]>([])
  // ⚠ THE COMPOSER DRAFT IS NOT HERE, ON PURPOSE. It used to be, and it was the screen's single
  // biggest render cost: one full re-render of this ~500-line body per CHARACTER, measured, on the
  // latency path where the character is supposed to appear. It lives in `Composer` now and arrives
  // as an argument to `send`. Re-lifting it is a performance regression, not a refactor.
  const [sending, setSending] = useState(false)
  // ⚠ THE BUFFER IS A REF; ONLY ITS VISIBLE STRING IS STATE. `pushDelta` runs once per streamed
  // TOKEN, but of the four fields it maintains only `shown` is ever rendered, and `shown` advances
  // only at a sentence boundary (or the max hold). Holding the whole buffer in state therefore
  // re-rendered this entire screen — the full transcript array, every TurnBubble, every PreviewCard,
  // and the newest card's native MapView — ~10x more often than the output actually changed, for the
  // whole duration of every turn. Writing `shown` through a second setState costs nothing when it is
  // unchanged: React bails out on an Object.is-equal value, so a token that only moves `pending`
  // re-renders nothing. This is the same rule say-buffer.ts's header states for TalkBack, now true of
  // the render pass as well as the announcement.
  const bufRef = useRef(emptySayBuffer())
  const [shown, setShown] = useState('')
  /** Apply a pure say-buffer transition and publish only what changed on screen. */
  const applyBuf = useCallback((next: (b: SayBuffer) => SayBuffer) => {
    bufRef.current = next(bufRef.current)
    setShown(bufRef.current.shown)
  }, [])
  const [done, setDone] = useState(false)
  // A TRANSPORT-class failure of a turn. ⚠ NOT a model outage: the server catches every planner
  // failure and answers 200 with its own in-persona line (INV-13 keeps the vendor error away from the
  // rider), so there is no status code for that and no heuristic on `say` may ever be built here.
  const [plannerOutage, setPlannerOutage] = useState(false)
  const [scrollSignal, setScrollSignal] = useState(0)
  const bumpScroll = useCallback(() => setScrollSignal((n) => n + 1), [])

  const composerRef = useRef<TextInput | null>(null)
  // The rider's own cancel: leaving the screen mid-turn must stop billing a model call nobody will
  // read. Aborting rejects planTurn with PlanAbortedError, which the catch swallows silently.
  const turnAbortRef = useRef<AbortController | null>(null)
  // Synchronous in-flight guards. setState is async, so two fast taps would fire two requests before
  // React re-rendered — on POST /drives that is two non-refundable credits.
  const sendingRef = useRef(false)
  const creatingRef = useRef<Set<string>>(new Set())
  // Every route already DRAWN in this conversation, by `proposeKey`. Not an in-flight guard like the
  // two above — it lasts the whole conversation, because the thing it prevents is not a double-tap
  // but the PLANNER re-emitting a route it already gave (see `drawUp`). A ref rather than derived
  // state for the same reason `creatingRef` is one: the decision is made synchronously, before the
  // setCards it would otherwise have to read back.
  // ⚠ A MAP, NOT A SET, AND THE VALUE IS THE POINT. The key still answers "have we drawn this?"; the
  // value is now sent to the server as `drawn` so the MODEL can be told what it already drew. The
  // transcript is text-only (`toWire` drops the route), so without that the skipper's only evidence of
  // having drawn is his own sentence — the defect class behind answering "what do I call you?" with
  // "Consider it drawn". One structure rather than two: a parallel list of routes would be a second
  // copy of this set's membership, and keeping two copies of "the same" set in step is the bug this
  // file has already paid for more than once.
  const drawnRef = useRef<Map<string, PlannedRoute>>(new Map())

  /** Bumped by "Start fresh", and its ONLY job is to schedule the autofocus below.
   *
   *  ⚠ STATE, not `convSeq` — and the split is forced, not duplication for its own sake. `convSeq`
   *  is a ref because it is captured before an await and compared after (a state read in a closure
   *  would be the render-time value, which is the opposite of what those guards need); a ref cannot
   *  drive an effect. So the reset publishes an ordinal, and the effect keyed on it runs AFTER the
   *  commit that swaps the wrap-up bar back to the composer.
   *
   *  An ordinal rather than a boolean flag nobody clears: `done` is false immediately after a reset,
   *  so the wrap-up bar is gone and a second "Start fresh" needs another `done` to become reachable
   *  at all — but a flag that must be reset by the thing it triggers is a state machine, and this is
   *  a number that only goes up. */
  const [resetSeq, setResetSeq] = useState(0)

  /** `convSeq`'s RENDER-SAFE TWIN — bumped by both reset entrances, in the same expression.
   *
   *  Everything read during RENDER uses this; everything captured across an `await` uses the ref
   *  below. That is the whole rule, and it is why two counters of the same events is not duplication:
   *  a ref read during render is `react-hooks/refs` ("Cannot access refs during render"), and a state
   *  read inside a closure captured before an await is the render-time value, which is precisely the
   *  bug `convSeq`'s guards exist to prevent. Neither can do the other's job.
   *
   *  Two readers, both render-time: the COMPOSER's key (remounting is how a reset clears the draft,
   *  now that the draft is the composer's own state) and the transcript's BUBBLE keys (so a reused
   *  row cannot inherit the previous conversation's one-shot "announced" ref). The bubble keys used
   *  `convSeq.current` and were the file's one baselined `react-hooks/refs` suppression; moving them
   *  here burned it down rather than adding a second.
   *
   *  ⚠ NOT `resetSeq`, though the shape is identical: that ordinal also schedules the autofocus, and
   *  the region-switch entrance must clear the field WITHOUT raising a keyboard over the example asks
   *  that just changed. Different effects, different ordinals. */
  const [conversationSeq, setConversationSeq] = useState(0)

  // Monotonic conversation id, bumped by "Start fresh". ⚠ A SPEND CONTROL, not bookkeeping, and
  // `turnAbortRef.current?.abort()` is not enough on its own: abort() on an already-settled fetch is a
  // no-op, so a turn that resolved microseconds before the tap still runs its continuation — which
  // would stamp the whole discarded transcript back over the empty one AND fire `drawUp`, a billed
  // Google Routes call for a conversation the rider just threw away. Same shape as `loadSeq` below.
  // It also keys the transcript's bubbles, so a reused row cannot inherit the previous
  // conversation's one-shot "announced" state (see the transcript render).
  const convSeq = useRef(0)

  /** How many turns the rider has SENT in the current conversation — `plan_turn_sent`'s `turn_index`,
   *  and nothing else reads it.
   *  ⚠ A COUNTER, NOT A DERIVATION FROM THE TRANSCRIPT, and that is the whole point. Both obvious
   *  derivations are wrong in ways that only show up in the funnel, never in a test: counting rider
   *  turns in `next` OR in `toWire(next)` both include the pair `seedExample` stamps `wire: true`, so
   *  a rider who taps an example chip — the app's highest-traffic entry — reports their FIRST billed
   *  turn as 2 while a rider who types cold reports 1. Bucket 1 then silently means "cold typists
   *  only" and the drop-off curve is unreadable. `toWire` additionally MERGES consecutive same-role
   *  turns, so a rider line following a failed turn collapses into the previous one and the count
   *  goes backwards.
   *  ⚠ Incremented at the EMIT, not in `send`, because every guard in `runTurn` returns having posted
   *  nothing. And NOT incremented on a retry: a retry is the same turn of the conversation sent twice
   *  (it re-sends the identical transcript), so it repeats its index and is told apart by `retry`.
   *  Reset by `startFresh` — a fresh conversation restarts the curve at 1. */
  const sentTurnsRef = useRef(0)

  // The last good GET /regions, read once. It is what lets the offline card name real places instead
  // of only apologising — public place NAMES only, never ids and never coordinates (INV-1).
  const cachedRegion = useMemo(() => readCachedRegion(), [])

  // WHICH WINDOW OF THE REGION'S NAMES THIS LAUNCH SHOWS, and the value the next launch will use.
  //
  // ⚠ READ ONCE AT MOUNT, ADVANCED ON WRITE — never advanced on render, and never a live read. The
  // example asks are TAPPABLE, so unlike the composer placeholder beside them they must hold
  // absolutely still while the rider is deciding: a chip that re-labels itself under a thumb sends a
  // sentence the rider did not choose. Home also stays MOUNTED under a push, so this correctly
  // survives a trip to /sample and back rather than re-rolling on return (the same reasoning
  // `showListenRow` is built on).
  //
  // ⚠ `nextRotation` is written rather than incremented in place, which makes the write IDEMPOTENT:
  // the regions load and the region picker both persist the cache, and both storing the same computed
  // value means a rider who switches region twice does not skip two windows forward.
  const rotation = cachedRegion?.rotation ?? 0
  const nextRotation = rotation + 1

  // The double-push guard, and its release on refocus, both live in the hook (src/lib/useNavigateOnce).
  const navigateOnce = useNavigateOnce()

  // ⚠ STABLE ON PURPOSE — `DriveCard` (src/ui/DriveList.tsx) is memoized, and a freshly-built handler
  // would bust that memo on every render of this screen, which ticks at 2 Hz while a preview clip
  // plays. A memo whose caller rebuilds a prop does nothing and fails silently.
  const onPressDrive = useCallback(
    (driveId: string) => {
      navigateOnce(() => router.push({ pathname: '/drives/[id]', params: { id: driveId } }))
    },
    [navigateOnce, router],
  )

  // Only the newest load may write — the focus load, the reconnect self-heal and a Better Auth
  // session refetch all share one network edge (src/lib/useLatestRun).
  const beginLoad = useLatestRun()

  const load = useCallback(async () => {
    const isCurrent = beginLoad()
    setError(null)
    // Only an ACCOUNT can own drives. An anonymous session is truthy and owns nothing, so this goes
    // through the INV-9 helper rather than `!session` — skip the gated call and show whatever's saved
    // on disk (normally nothing → the zero-state invite to plan one).
    if (!signedIn) {
      setDrives(listDownloadedDrives())
      setOffline(false)
      setCredits(null) // anonymous (or signed-out) — no credit balance to show
      setLoading(false)
      return
    }
    try {
      const r = await listDrives()
      if (!isCurrent()) return
      setDrives(r.drives)
      setCredits(r.credits ?? null) // null only against a server predating the field → hint hidden
      setOffline(false)
    } catch (e) {
      if (!isCurrent()) return
      // Offline-first: in a dead zone the list fetch fails — fall back to the drives saved on disk
      // so they stay reachable rather than a blank error wall.
      const saved = listDownloadedDrives()
      if (saved.length > 0) {
        setDrives(saved)
        setOffline(true)
      } else {
        setError(errorMessage(e, voice.error.generic))
      }
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [beginLoad, signedIn])

  // The regions load. ⚠ It is the conversation's PREREQUISITE, not a nicety: POST /drives/plan
  // requires a regionId, so a failed load means there is nothing to talk to — hence the outage card
  // and no composer rather than a field that 400s on send.
  //
  // The planner is given no cross-region vocabulary, so the rider is always talking to exactly ONE
  // skipper — which is why a region is selected here rather than left for the rider to choose.
  // ⚠ ALWAYS SELECT SOMETHING when the list is non-empty (`pickRegionId`, src/lib/region-select.ts).
  // The old rule auto-selected only at length 1, and that was a kill switch on shipped builds: regions
  // are server data, so releasing a second one would have left every installed app with nothing
  // selected — no chip, no example asks, a composer disabled by `sending || !regionId` — and no build
  // in riders' hands able to recover. That file's header has the full account; the rule is tested
  // there because this hook is not reachable by `bun test`.
  const loadRegions = useCallback(async () => {
    setRegionsFailed(false)
    try {
      const rs = await listRegions()
      setRegions(rs)
      // Read fresh rather than closing over the mount-time `cachedRegion` memo, so a region the rider
      // picked THIS session is still honoured by a later reload.
      const picked = rs.find((r) => r.id === pickRegionId(rs, readCachedRegion()?.regionId))
      if (picked) {
        setRegionId(picked.id)
        // Names only, for the degraded cards. See region-cache.ts's header for what this may hold.
        writeCachedRegion({
          regionId: picked.id,
          displayName: picked.displayName,
          exampleAnchors: picked.exampleAnchors,
          // Advance the cold open's window for NEXT launch. Riding the regions load means the counter
          // moves once per launch for free, with no second thing to persist and nothing to schedule.
          rotation: nextRotation,
        })
      }
    } catch {
      // The message is never shown — the outage card speaks for itself, in persona.
      setRegionsFailed(true)
    }
    // `nextRotation` is derived from the mount-time cache read, so it is stable for the life of the
    // screen and this stays a once-per-mount load — the dependency is honesty for the hooks lint,
    // not a re-run.
  }, [nextRotation])

  useEffect(() => {
    void loadRegions()
  }, [loadRegions])

  // ── planner_ready — the funnel's DENOMINATOR ────────────────────────────────────────────────
  // ⚠ Neither a bare mount effect nor the focus effect below, and both wrong answers are tempting.
  // Focus re-runs on every return from a drive, settings, sign-in or the sample, which would count one
  // rider's evening as a dozen riders. Mount is wrong on its own terms: it would count a rider staring
  // at the offline or outage card, who never had a planner at all, and an inflated denominator makes
  // every downstream rate look worse while hiding the outage itself.
  // ⚠ Mount is ALSO not the "exactly once per process" it looks like — home is `initialRouteName` and
  // the funnel's own path pushes over it, but two routes `router.replace('/')` and would remount it:
  // sign-in's deep-link fallback (only when there is nothing to go back to — the wall → sign-up → back
  // path takes `router.back()` instead) and settings after an account DELETION. Both are rare rather
  // than routine, so this is a reason not to RELY on once-per-process, not a common double-count.
  //
  // So: gate on the planner being genuinely USABLE — online (the composer is absent entirely offline)
  // AND a region actually chosen (until then the send disc is disabled, i.e. the field is on screen
  // but nothing can be sent). `regionId` covers more than it looks: it is null through the regions
  // load, null forever on a failed one (so `regionsFailed` needs no separate term), and null under a
  // multi-region chip row until the rider picks — and no turn can be posted without it (see `send`).
  //
  // The latch is a per-MOUNT ref, so what this counts is planner-usable VIEWS of home. It exists to
  // stop the two things that re-run this effect from each adding a denominator: the offline→online
  // edge and the region chip row. A remount still re-fires, which is fine — with no identify() (INV-4)
  // the funnel is read per DEVICE (distinct_id), and repeat views of one device collapse there.
  const plannerReadyRef = useRef(false)
  useEffect(() => {
    if (plannerReadyRef.current || isOffline || !regionId) return
    plannerReadyRef.current = true
    track('planner_ready', {})
  }, [isOffline, regionId])

  useFocusEffect(
    useCallback(() => {
      // ⚠ Re-reads CREDITS on the way back from sign-up, which is exactly what the disclosure on a
      // gated card needs. It must NOT re-fire the create — the rider taps once more (see doCreate).
      void load()
    }, [load]),
  )

  // Leaving home stops the preview clip. ⚠ A SECOND, DEDICATED focus effect on purpose — folding it
  // into the one above would put `preview.stop` into `load()`'s dependency chain, and `load` is the
  // callback the whole credit/drives refresh hangs off.
  //
  // It is D35's corollary: the clip holds EXCLUSIVE audio focus, so one still talking behind
  // /sign-in or a drive player is not "background playback", it is the skipper interrupting himself.
  // Blur, not unmount — home stays mounted under a push (that is what keeps the transcript alive).
  useFocusEffect(useCallback(() => () => preview.stop(), [preview.stop]))

  // ⚠ THE FIRST-CLIP SCROLL BUMP IS GONE WITH THE BAR IT COMPENSATED FOR (founder, 2026-08-03). It
  // existed because mounting the pinned ClipBar took ~80pt off the bottom of the ScrollView — a
  // LAYOUT change, which `onContentSizeChange` never sees — sliding the card's CTA under the fold at
  // the exact moment the rider was being sold. With the card's own disc the only transport, playing
  // a clip changes no heights at all, so re-pinning the scroll on first play would now be an
  // unprompted yank rather than a fix. If a pinned transport ever returns, this comes back with it.

  // Self-heal on the offline→online edge: the loads that failed out here re-run the moment the bars
  // come back, so a rider who drives back into signal never has to know to tap the retry. Guarded on
  // the TRANSITION (not on `!isOffline`) so it never doubles up with the focus load above.
  // ⚠ It deliberately does NOT re-send a pending typed turn — that would be a surprise paid call.
  const wasOffline = useRef(false)
  useEffect(() => {
    if (wasOffline.current && !isOffline) {
      void load()
      if (!regionId) void loadRegions()
    }
    wasOffline.current = isOffline
  }, [isOffline, load, loadRegions, regionId])

  // The max-hold flush, running ONLY while a turn is in flight. Without it a turn that ends
  // mid-clause freezes on screen while tokens are visibly still arriving.
  useEffect(() => {
    if (!sending) return
    const iv = setInterval(() => applyBuf((b) => tickHold(b, Date.now())), HOLD_TICK_MS)
    return () => clearInterval(iv)
  }, [sending, applyBuf])

  // Leaving the screen cancels the turn — a spend control, not tidiness (see turnAbortRef).
  useEffect(() => () => turnAbortRef.current?.abort(), [])

  const region = useMemo(
    () => (regionId ? (regions?.find((r) => r.id === regionId) ?? null) : null),
    [regions, regionId],
  )
  // The degraded cards' roster: this region's names when we have them, else the last good ones on
  // disk. Offline, the cache is the only source there is.
  // ⚠ MEMOISED, and not for speed: a fresh `[]` every render made it an unstable dependency of the
  // two useMemos below, which ESLint flagged once and then twice as consumers were added. The
  // stable identity is what stops the example asks and the placeholder set rebuilding on every
  // keystroke — and rebuilding the placeholder list would restart its rotation timer.
  const anchorNames = useMemo(
    () => region?.exampleAnchors ?? cachedRegion?.exampleAnchors ?? [],
    [region, cachedRegion],
  )
  // The same names, rotated to this launch's window. Feeds BOTH the example asks and the composer
  // placeholder so the two agree — they sit inches apart on the cold open, and the placeholder
  // teaching "{a} to {b}" with a different pair from the chip directly above it reads as a bug.
  // ⚠ The degraded cards keep the UNROTATED list: they render every name as a flat roster, where
  // order carries no meaning and rotating it would only make the same card look different each launch.
  // ⚠ Memoised for the identity reason the array above documents — a fresh array here would restart
  // the placeholder rotation timer on every keystroke.
  const rotatedNames = useMemo(
    () => rotateNames(anchorNames, rotation * EXAMPLE_ROTATION_STRIDE),
    [anchorNames, rotation],
  )
  // The region's own display name, on the same live-then-cached ladder as the anchors above. Feeds the
  // open-ended suggestion so all three rows name this region, and the chip so both read from one place.
  const regionLabel = region?.displayName ?? cachedRegion?.displayName ?? null

  const patchCard = useCallback((id: string, patch: Partial<PreviewItem>) => {
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }, [])

  // Coming back from sign-up UNWALLS the cards the rider was walled on. Nothing else did: the focus
  // load re-reads the balance and the drives list, and a card patched to `needsAccount` by the 401
  // stayed there — so the only way back to a drive the rider had already agreed to was the "Keep
  // browsing" ghost, a label that reads as "abandon this one", not "here is your drive again".
  //
  // ⚠ THIS RESTORES THE CARD; IT NEVER FIRES THE CREATE. `POST /drives` spends a NON-REFUNDABLE
  // credit, so the rider taps "Make this drive" once more, on purpose — the same no-auto-fire rule
  // this file's header states and `onSignUp` restates. `signedIn` (INV-9), never `!!session`: an
  // anonymous session is truthy and gets walled by the very same 401.
  //
  // ⚠ A THIRD focus effect rather than a `useEffect` on `signedIn`, and it covers strictly more:
  // useFocusEffect's inner effect depends on the CALLBACK as well as the navigation object
  // (expo-router/build/react-navigation/core/useFocusEffect.js:129 + :99), so keying the callback on
  // `signedIn` fires this BOTH when home refocuses after the sign-in screen pops AND when the Better
  // Auth session flips while home is already focused — the two orderings a return from sign-up can
  // arrive in. Kept apart from the `load()` effect above so `setCards` never joins that callback's
  // dependency chain (same reason the preview-stop effect stands alone).
  useFocusEffect(
    useCallback(() => {
      if (!signedIn) return
      setCards((cs) =>
        // The SAME array back when nothing is walled — which is every focus but the one that matters.
        // A fresh array re-renders the newest card, and with it its native MapView, for nothing.
        cs.some((c) => c.state === 'needsAccount')
          ? cs.map((c): PreviewItem => (c.state === 'needsAccount' ? { ...c, state: 'ready' } : c))
          : cs,
      )
    }, [signedIn]),
  )

  /** Materialize a planned route on Google Routes (billed, no credit) so the rider sees the drive
   *  before spending one. Sets the card's terminal state; never throws. */
  const doPropose = useCallback(
    async (cardId: string, route: PlannedRoute) => {
      // ⚠ Captured before the await for the EMIT below, not for the patch. `patchCard` already fails
      // safe when the rider has started over — its `setCards` map simply matches no id — but a
      // `track()` call has no such no-op: it would report a proposal onto a screen that was cleared
      // while this was in flight, and `proposal_shown` claims the rider SAW their drive. Same
      // convSeq discipline `runTurn` uses, for the same reason.
      const seq = convSeq.current
      patchCard(cardId, { state: 'proposing', proposal: null, errorMessage: undefined })
      try {
        // ⚠ INV-1: anchor IDS, verbatim, straight off the planner's route object. Nothing here
        // reconstructs an endpoint from a display string.
        const p = await proposeDrive(toProposeRequest(route))
        // ⚠ STRICT `=== 0`. `estStopCount` is nullish-able and null means UNKNOWN, not zero.
        const quiet = p.estStopCount === 0
        patchCard(cardId, { state: quiet ? 'noStops' : 'ready', proposal: p })
        // The beat where a rider first sees their own drive. Emitted IMPERATIVELY here, beside the
        // patch, rather than from inside the card's own render. ⚠ The original reason — "the card is
        // not memoized and re-renders on every composer keystroke, so a render-time emit would report
        // typing speed" — no longer holds: the draft left the screen and `TranscriptCard` is memoized.
        // The rule stands on better ground anyway. An analytics beat that means "the rider SAW this"
        // belongs at the moment the state that makes it true is written, not at a render, which React
        // may run more than once for one logical change. The `quiet`
        // branch counts too: a quiet road is a proposal that was SHOWN, and dropping it would hide
        // the outcome most worth seeing from the one number that would reveal it.
        // ⚠ ONE GATE, TWO WRITES, AND THEY ARE A PAIR — do not let either drift back outside it.
        // The `quiet` line is the dangerous half: `patchCard` no-ops against a cleared screen, but
        // `setTurns` does not. A rider who taps "Start fresh" while this /propose is in flight gets
        // an EMPTY transcript, and appending a `wire: true` SKIPPER line to it makes the first wire
        // turn the skipper's — which `toWire` refuses forever (planner-transcript.ts), because that
        // turn never leaves the array. Every later send then draws the outage card, and "Start
        // fresh" only exists in the `done` wrap-up bar, so the conversation is unrecoverable short
        // of relaunching. Dropping the line is the correct outcome: it belongs to a conversation the
        // rider threw away, and the route it describes went with it.
        if (convSeq.current === seq) {
          track('proposal_shown', {
            // ⚠ `?? null`, NEVER `?? 0` — the strict `=== 0` above is the same rule stated once
            // already. Null means UNKNOWN, and folding it into zero inflates the quiet-road rate
            // that drive selection gets tuned against.
            stop_count: p.estStopCount ?? null,
            duration_min: driveMinutes(p.durationSeconds),
            // ⚠ A loop is `end === start`, NEVER `via.length`. A one-way route KEEPS its via
            // midpoints (apps/api/src/plan-route.ts `toPlannedRoute` — the round-trip mapping only
            // moves the far end into `via`), so counting via would report every via'd one-way as a
            // round trip.
            round_trip: p.startId === p.endId,
            has_clip: p.previewClip != null,
          })
          if (quiet) {
            // Hand the rider back to the CONVERSATION instead of leaving them on a dead card, and
            // tell the model so it doesn't cheerfully offer the same road again — hence `wire: true`.
            // Safe under D9: "that road is quiet" is ROUTE information, not a fact about any place
            // on it.
            setTurns((ts) => appendSkipper(ts, voice.proposal.noStopsSay, { wire: true }))
          }
        }
      } catch (e) {
        if (e instanceof ApiError && e.needsAccount) {
          patchCard(cardId, { state: 'needsAccount' })
          // ⚠ THIS SHOULD BE UNREACHABLE, and that is why it is instrumented. `POST /drives/propose`
          // is open to anonymous riders as of step 8a, so a 401 here means the preview front door has
          // quietly walled itself — the shape being `requireAccount` back on the `driveRoutes` wildcard
          // mount instead of per-route. A line on this dashboard is a FINDING, not a funnel step.
          track('wall_shown', { source: 'propose' })
        } else {
          // ⚠ RELEASE THE DRAW CLAIM ON A FAILURE, and only on this branch. `drawUp` refuses a route
          // it has already drawn, so a propose that died holding the claim would lock that drive out
          // of the conversation for good: the rider asks again, the planner re-emits the same route,
          // and the screen silently declines to retry it. A failed call bought nothing, so it owes
          // nothing. (`needsAccount` above KEEPS its claim — that card is alive and showing the wall,
          // and re-drawing behind it would bill Routes a second time to put up the same ask.)
          drawnRef.current.delete(proposeKey(route))
          patchCard(cardId, { state: 'error', errorMessage: errorMessage(e, voice.proposal.drawFailed) })
        }
      }
    },
    [patchCard],
  )

  /** A route arrived (or the wrap-up bar asked for the last one) → a new card, drawn immediately.
   *  The planner only emits a route once the rider has said yes in words, so the yes has already
   *  happened; the tap that costs money is the one INSIDE the card. */
  const drawUp = useCallback(
    (route: PlannedRoute, afterTurn: number) => {
      // ⚠ ONE ROUTE, ONE CARD, ONE BILLED CALL — per conversation. The planner re-emits a route it
      // has already drawn: observed answering "What's your name?" with "…drawn up just as you said"
      // and a second identical card, and a transcript ended up holding three cards for two distinct
      // drives (device, 2026-08-03). Each redraw is another Google Routes call bought for a result
      // already on screen, and it lets the rider spend a credit twice on the same drive from two
      // cards that cannot tell each other apart.
      //
      // Enforced HERE, in code, rather than by asking the prompt not to repeat itself — the same
      // reason the endpoint allowlist is asserted at the wire: a prompt cannot be relied on to hold a
      // spend guard. (The model saying it "drew that up" when it did not is a separate defect, and it
      // belongs to the planner prompt's own review.)
      //
      const key = proposeKey(route)
      if (drawnRef.current.has(key)) {
        // ⚠ THE CARD MOVES; IT IS NOT REDRAWN. This branch was `bumpScroll(); return`, on the stated
        // theory that the rider was "still taken to the drive" — they were not. `bumpScroll` scrolls
        // to the END of the transcript while the card it means sits where it was first drawn, often
        // several exchanges up; and `undrawnRoute` below correctly finds a card for this key, so no
        // "Draw it up" bar appears either. Net effect on device: the rider asks for a change, the
        // skipper agrees in words, and the screen does nothing at all. Reported by the founder
        // 2026-08-03 as the chat "refusing to redraw the route after changing it up and chatting more".
        //
        // Re-flowing the card it already has keeps every property this guard exists for — one billed
        // Routes call, one card per distinct drive, one idempotency key, no second credit — while
        // putting the drive where the rider is looking. The move itself is `reflowDrawnCard`
        // (src/lib/planner-route.ts), pure and unit-tested; its doc owns WHY both halves of the move
        // are required, since neither is obvious from the call site.
        setCards((cs) => reflowDrawnCard(cs, route, afterTurn))
        bumpScroll()
        return
      }
      drawnRef.current.set(key, route)
      const id = uuidV4()
      // Minted WITH the card and reused across every retry of that same create, so a lost-ACK retry
      // dedupes server-side; a new route is a new card and therefore a new key.
      setCards((cs) => [
        ...cs,
        { id, afterTurn, route, state: 'proposing', proposal: null, idempotencyKey: uuidV4() },
      ])
      bumpScroll()
      void doPropose(id, route)
    },
    [bumpScroll, doPropose],
  )

  /** THE ONE CALL THAT SPENDS A CREDIT. Non-refundable, and a delete never refunds it. */
  const doCreate = useCallback(
    async (cardId: string, proposal: DriveProposal, key: string) => {
      if (creatingRef.current.has(cardId)) return // a double-tap must not double-POST
      creatingRef.current.add(cardId)
      patchCard(cardId, { state: 'creating', errorMessage: undefined })
      try {
        const m = await createDrive(toCreateRequest(proposal, key))
        const driveId = m.driveId
        if (driveId) {
          // The credit is spent and will never be refunded — so this fires on the SERVER's answer, not
          // on the tap, and before the navigation (which `navigateOnce` may legitimately swallow).
          // ⚠ NO driveId and NO routeSig. Both sit beside `drives.user_id`, so either one is joinable
          // to a person server-side — the exact leak sanitizeScreenPath already had to close once. No
          // credits number either: the only balance in scope here is the PRE-create one (the manifest
          // carries none), which would be reported as though it were the post-spend balance.
          track('drive_created', {})
          // Flip to `made` BEFORE navigating: a rider who backs out of the drive lands on a card that
          // offers to OPEN it, never a second charged tap.
          patchCard(cardId, { state: 'made', driveId })
          // ⚠ `push`, NOT `replace`. create.tsx replaced because it was a spent screen; home is not,
          // and a replace would destroy the only copy of the transcript.
          navigateOnce(() => router.push({ pathname: '/drives/[id]', params: { id: driveId } }))
        } else {
          patchCard(cardId, { state: 'error', errorMessage: voice.error.generic })
        }
      } catch (e) {
        if (e instanceof ApiError && e.needsAccount) {
          patchCard(cardId, { state: 'needsAccount' })
          // THE WALL — the funnel's numerator, and the only one that gates a spend. It is a card
          // STATE, not a screen, which is why it is emitted from the 401 rather than from a route.
          // ⚠ It DOES re-emit if the rider dismisses the gate (`onDismissGate`) and taps "Make this
          // drive" again. Deliberate: every emission follows a real 401 from a real tap, so suppressing
          // the second would under-report the wall being hit; de-duping would mean carrying wall state
          // on PreviewItem for analytics alone. The rate is read per DEVICE (distinct_id, INV-4),
          // where a second showing to the same rider changes nothing.
          track('wall_shown', { source: 'create_drive' })
        }
        // 403 = the free-drive cap. The server's own message names the limit AND the way past it, so
        // it is shown verbatim; the voice key is the fallback for an empty one.
        else if (e instanceof ApiError && e.status === 403)
          patchCard(cardId, { state: 'error', errorMessage: e.message || voice.proposal.capReached })
        else patchCard(cardId, { state: 'error', errorMessage: errorMessage(e, voice.error.generic) })
      } finally {
        // Cleared on every exit — a FAILED create may be retried sequentially against the SAME key
        // (that is what dedupes a lost ACK); the guard only ever blocked a concurrent double-tap.
        creatingRef.current.delete(cardId)
      }
    },
    [navigateOnce, patchCard, router],
  )

  /** One planner turn against an already-built transcript. `next` must already END on the rider's
   *  line — this never appends one, so the outage retry can re-send the identical transcript.
   *
   *  `retry` is REQUIRED and is THREADED, never inferred: `retryTurn` re-sends a byte-identical
   *  transcript, so from in here a retry is indistinguishable from the first attempt, and a new caller
   *  must decide which it is rather than inherit a default. */
  const runTurn = useCallback(
    async (next: Turn[], retry: boolean) => {
      if (sendingRef.current) return
      if (!regionId) return
      // ⚠ THE SHARPEST LINE ON THIS SCREEN. `toWire` drops display-only turns and enforces the shape
      // the server's `toModelMessages` requires (first AND last survivor must be the rider's). A
      // transcript it rejects would come back as HTTP 200 with the in-persona "radio's out" line —
      // a PERMANENT FAKE OUTAGE with nothing in any log, on either end. Never POST the raw array.
      const wire = toWire(next)
      // A bug guard, not a rider-facing state: unreachable unless the transcript construction above
      // broke. Surfacing it as the outage card is the honest degradation — it is at least true that
      // the conversation cannot continue, and it costs no anonymous Opus call to say so.
      if (!wire) {
        setPlannerOutage(true)
        return
      }
      // ⚠ HERE — after all three guards and BEFORE the await, and both halves matter. Every guard
      // above returns having POSTED NOTHING, so emitting earlier would count turns that never billed
      // an anonymous Opus call. Emitting on the RESOLUTION instead would be worse: a turn that times
      // out or 5xxs billed all the same, so success-only instrumentation systematically under-counts
      // exactly the failures worth seeing.
      // A retry re-sends the identical transcript, so it is the same turn billed twice — it repeats
      // its index rather than advancing the conversation. See sentTurnsRef for why this is a counter
      // and not a count over the transcript.
      if (!retry) sentTurnsRef.current += 1
      track('plan_turn_sent', {
        turn_index: sentTurnsRef.current,
        // Without this, one conversation retried three times at turn 2 reads as a funnel that keeps
        // re-entering — and each retry is a real second billed call at the SAME index.
        retry,
      })
      sendingRef.current = true
      setSending(true)
      setPlannerOutage(false)
      applyBuf(emptySayBuffer)
      const ctrl = new AbortController()
      turnAbortRef.current = ctrl
      // Captured BEFORE the await; every write below is gated on it still being current. See convSeq.
      const seq = convSeq.current
      const isCurrent = () => convSeq.current === seq
      try {
        const resp = await planTurn(
          // ⚠ `drawn` is the model's MEMORY, and it is sent from here because the server has none —
          // the planner is stateless and this client holds the only copy of the conversation (D10).
          // Ids only; the server resolves the names off its own roster, so nothing typed on this
          // screen can reach a system block. Capped at MAX_PLAN_DRAWN by the shared schema; the
          // newest are the ones worth keeping if a conversation ever exceeded it.
          { turns: wire, regionId, drawn: [...drawnRef.current.values()].slice(-MAX_PLAN_DRAWN) },
          {
            onDelta: (d) => applyBuf((b) => pushDelta(b, d, Date.now())),
            signal: ctrl.signal,
          },
        )
        // The rider started over while this was in flight. Drop the whole turn on the floor — most of
        // all `drawUp`, which would bill Google Routes for a conversation that no longer exists.
        if (!isCurrent()) return
        // ⚠ The terminal frame is AUTHORITATIVE and its `say` may differ from the deltas — a refusal
        // REPLACES, a truncation APPENDS. `settle` assigns verbatim, which covers both without this
        // screen ever having to know which happened.
        applyBuf((b) => settle(b, resp.say))
        const withSkipper = appendSkipper(next, resp.say, {
          wire: true,
          route: resp.route ?? null,
        })
        setTurns(withSkipper)
        setDone(resp.done)
        if (resp.route) drawUp(resp.route, withSkipper.length)
      } catch (e) {
        if (!isCurrent()) return
        // ⚠ D-M: the partial `say` is DROPPED — from the transcript AND from the screen. It is a
        // record of something the model never finished saying; keeping it would poison the next
        // turn's prompt prefix and show the rider half an instruction as if it were advice.
        applyBuf(emptySayBuffer)
        // The rider's own cancel. They left; they do not need an apology for it.
        if (isPlanAborted(e)) return
        if (e instanceof ApiError && e.status < 500) {
          // 413 / 400 / 429 — rejected BEFORE the model ran, and the server's message is already in
          // persona. `wire: false`: he never actually said it, so it must not ride the next turn.
          setTurns(appendSkipper(next, e.message || voice.plan.sendFailed, { wire: false }))
        } else {
          // Transport, a 5xx, a contract break, an EOF with no terminal frame. The card's retry
          // re-sends this same transcript — which still ends on the rider's line, because the line
          // above is the only thing appended on a failure and it never happens on this branch.
          setPlannerOutage(true)
        }
      } finally {
        // ⚠ Gated too. A superseded turn settling AFTER the rider hit "Start fresh" and typed again
        // would otherwise clear the guards belonging to the NEW turn — re-opening the double-send this
        // ref exists to close.
        if (isCurrent()) {
          turnAbortRef.current = null
          sendingRef.current = false
          setSending(false)
        }
      }
    },
    [applyBuf, drawUp, regionId],
  )

  // ⚠ TAKES THE TEXT AS AN ARGUMENT — the draft lives in the Composer, not here (see ComposerProps).
  // That is what keeps this callback off the per-keystroke path: its deps no longer include the
  // draft, so it is stable for the whole of a turn instead of being rebuilt on every character.
  const send = useCallback(
    (raw: string) => {
      const text = raw.trim()
      // ⚠ The regionId guard is HERE, before the rider's line is appended — `runTurn` bails on a
      // missing region too, and if that were the only guard a send during the regions load would put
      // the rider's words on screen and then silently do nothing with them. The send disc is disabled
      // over the same window, so this is the belt to that brace.
      if (text === '' || sendingRef.current || !regionId) return
      const next = appendRider(turns, text)
      setTurns(next)
      bumpScroll()
      void runTurn(next, false)
    },
    [bumpScroll, regionId, runTurn, turns],
  )

  const focusComposer = useCallback(() => {
    bumpScroll()
    composerRef.current?.focus()
  }, [bumpScroll])

  /** "Change it up" — hand the rider back to the conversation with the skipper actually ASKING for
   *  the revision, then put the cursor where the answer goes.
   *
   *  ⚠ FOCUS ALONE WAS NOT ENOUGH, and the reason is worth keeping: it works — the field really does
   *  take focus — but on the simulator a connected hardware keyboard suppresses the software one, so
   *  the entire response was a caret in an unchanged-looking field and the button was reported as
   *  dead (founder, 2026-08-03). A seeded turn answers on any device, costs nothing (no model call,
   *  like the example replies), and tells the rider WHICH things are changeable. The repeat-tap guard
   *  lives in `seedAdjust`, not here — the button is on every card and stays live after a tap. */
  const adjustDrive = useCallback(() => {
    setTurns((ts) => seedAdjust(ts, voice.proposal.adjustSay))
    focusComposer()
  }, [focusComposer])

  /** The outage retry: re-send the SAME transcript, unchanged. Its last entry is still the rider's
   *  line, so nothing needs re-typing and the wire shape is still legal. */
  const retryTurn = useCallback(() => {
    // ⚠ ONLY RETRY WHEN THERE IS SOMETHING TO RE-SEND. A client-authored beat can land AFTER the
    // rider's line — a 0-stop `/propose` for turn N resolving while turn N+1 is already in flight —
    // leaving the transcript ending on a SKIPPER turn, which `toWire` correctly refuses. Clearing the
    // card and calling `runTurn` anyway re-raised it inside the same React batch, so the button
    // produced no visible change whatsoever and the rider could tap it forever. There is nothing wrong
    // in that state: the ball is simply with them, so put the cursor there instead.
    if (!toWire(turns)) {
      setPlannerOutage(false)
      focusComposer()
      return
    }
    setPlannerOutage(false)
    // `retry: true` — same transcript, same turn ordinal, a second billed call.
    void runTurn(turns, true)
  }, [focusComposer, runTurn, turns])

  /** Wipe the conversation back to the cold open. It must not touch MY DRIVES and must not fetch
   *  anything paid.
   *
   *  ⚠ ONE reset with TWO entrances — "Start fresh" and a region SWITCH. What a stale conversation
   *  holds is a long list (an in-flight turn and its two seq guards, a playing preview clip,
   *  materialized cards, the say buffer, the outage flag), and a second copy would drift the first
   *  time one more is added to it.
   *
   *  The only difference is the KEYBOARD, hence `focusComposer`: "Start fresh" is a rider explicitly
   *  asking for an empty field, so it earns the focus; picking a region is not, and raising the
   *  keyboard there would cover the region's own example asks — the very thing that just changed. */
  const resetConversation = useCallback(({ focusComposer }: { focusComposer: boolean }) => {
    turnAbortRef.current?.abort()
    // ⚠ Bump BEFORE clearing state, and take over the in-flight turn's guards. The bump makes any
    // turn still in flight discard its own continuation (convSeq) — which also means its `finally`
    // will not run, so this has to be the thing that reopens the composer. Doing one without the
    // other is a screen that can never send again.
    convSeq.current += 1
    // A fresh conversation restarts the drop-off curve at 1 (see sentTurnsRef). Without this, turn
    // indices climb across every conversation the process ever holds and no per-conversation depth
    // can be read back out.
    sentTurnsRef.current = 0
    turnAbortRef.current = null
    sendingRef.current = false
    setSending(false)
    setTurns(resetTranscript())
    // ⚠ BEFORE the cards go: this is the only path that removes a card that might be playing, and a
    // clip whose card no longer exists is audio the rider can only stop by killing the app.
    preview.stop()
    setCards([])
    creatingRef.current.clear()
    // A fresh conversation may draw a route the old one already had — the claim is scoped to the
    // conversation, exactly like the cards it stands for.
    drawnRef.current.clear()
    applyBuf(emptySayBuffer)
    setDone(false)
    setPlannerOutage(false)
    // ⚠ NO `setInput('')` HERE ANY MORE — the draft is the Composer's own state now, so this path
    // clears it by REMOUNTING: the composer is keyed on `conversationSeq`. The other entrance ("Start
    // fresh") never needed a clear — it renders the wrap-up bar instead of the composer, so the field
    // unmounts on its own — but it bumps through here too, which is why one line covers both.
    // Deleting it would silently strand a half-typed ask from the OLD region in the new field.
    setConversationSeq((n) => n + 1)
    // The autofocus is DEFERRED, not dropped. "Start fresh" only exists in the `done` wrap-up bar,
    // and in that branch the composer is not rendered at all — so `composerRef.current` is null for
    // the whole of this handler and the focus() that used to sit here has never once fired. Publish
    // the intent; the effect below claims it after the composer is back on screen.
    if (focusComposer) setResetSeq((n) => n + 1)
  }, [applyBuf, preview.stop])

  /** "Start fresh" — the `done` wrap-up bar's control. */
  const startFresh = useCallback(
    () => resetConversation({ focusComposer: true }),
    [resetConversation],
  )

  // The deferred autofocus. Runs after the commit that put the composer back, which is the earliest
  // moment `composerRef.current` exists.
  // ⚠ `resetSeq === 0` is the COLD-LAUNCH guard and it is the whole reason this is an ordinal rather
  // than an effect on `done`: every mount runs its effects, so an unguarded version would raise the
  // keyboard over the hero on a fresh app launch — worse than the missing focus it fixes, because it
  // hides the one thing that explains what this screen is before the rider has asked for anything.
  // ⚠ `composerRef.current?.focus()`, NOT `focusComposer` — the scroll pin is wrong here and would
  // also be a setState inside an effect. `focusComposer` bumps the scroll because it is normally
  // called mid-conversation, where the rider wants the bottom of the transcript. After a reset the
  // transcript is EMPTY, so the end of the scroll view is MY DRIVES: pinning there would drag the
  // rider straight past the cold open they just asked for.
  useEffect(() => {
    if (resetSeq === 0) return
    composerRef.current?.focus()
  }, [resetSeq])

  const exampleAsks: ExampleAsk[] = useMemo(
    () =>
      buildExampleAsks(rotatedNames, {
        aToBTitle: voice.plan.exampleAToBTitle,
        aToB: voice.plan.exampleAToB,
        aToBReply: voice.plan.exampleAToBReply,
        openTitle: voice.plan.exampleOpenTitle,
        open: voice.plan.exampleOpen,
        openRegion: voice.plan.exampleOpenRegion,
        openReply: voice.plan.exampleOpenReply,
      },
      // ⚠ The REGION name, not an anchor — it makes the open-ended row region-specific like the other
      // two while staying the one ask that still has a form when a region has no curated anchors.
      regionLabel ?? undefined),
    [rotatedNames, regionLabel],
  )

  /** A tapped example chip seeds BOTH halves of an authored exchange and makes NO model call — the
   *  app's highest-traffic turn costs zero dollars. Both ride the wire (the model must see the answer
   *  it "already gave"), and the pair ends on a skipper turn so it is never sendable alone. */
  const pickExample = useCallback(
    (i: number) => {
      const ex = exampleAsks[i]
      if (!ex) return
      setTurns((ts) => seedExample(ts, ex.ask, ex.reply))
      // ⚠ FOCUS, not just the scroll pin (`focusComposer` does both), and it matters MORE since
      // 2026-08-04, not less. The A-to-B reply used to end on a direct question, which is what this
      // comment used to cite: the rider was asked something, so the cursor had to be waiting. That
      // question is gone — it asked how long they wanted to be out, which the planner prompt forbids —
      // and the reply now ends on a plain read-back. Nothing prompts the rider to speak, so the blinking
      // cursor IS the prompt. Removing this focus would leave a seeded exchange sitting there looking
      // finished. "Change it up" already earns this; so does this.
      // The keyboard covering the hero is fine: the first rider turn has already collapsed it (see
      // `collapsed`), which is the same render that puts this pair on screen.
      focusComposer()
    },
    [exampleAsks, focusComposer],
  )

  const riderTurnCount = turns.reduce((n, t) => (t.role === 'rider' ? n + 1 : n), 0)
  const plannerDown = plannerOutage || regionsFailed
  // THE COLD OPEN: nothing said yet, and the phone can actually reach the network. `!isOffline` is
  // stated here rather than inherited from the offline branch below, because it is the one condition
  // that must gate the SAMPLE too — a presigned clip cannot stream in a dead zone.
  const coldOpen = riderTurnCount === 0 && !isOffline
  // A region we KNOW has no curated endpoints. ONE expression, because it decides two things that
  // must never disagree: the opening line ("I don't run any roads around here yet") and whether the
  // example asks appear at all. They did disagree — the open-ended "Let the skipper pick" row names
  // no anchor, so it survived a region with zero of them and sat directly under the sentence saying
  // he can't help here, offering a drive he'd have to refuse (founder, 2026-08-03).
  // ⚠ `region &&` is load-bearing: before `/regions` lands `region` is undefined, and that is NOT an
  // uncurated region — it reads as the normal open, which is what it becomes for every curated one.
  // ⚠ READS THE SERVER'S `ready`, NEVER `exampleAnchors.length` (2026-08-03). The anchors are
  // DECORATION carrying `.catch([])` so a malformed payload degrades quietly; inferring capability
  // from them made a server-side glitch in a cosmetic field indistinguishable from a genuinely
  // uncurated region — and once this began hiding the composer, that glitch would have told a rider
  // in a fully curated region that the skipper runs no roads there, with nothing to type into.
  // `ready` is a capability with its own fail-OPEN default, so the degraded read is now "assume
  // plannable" instead of a dead screen.
  const uncuratedRegion = !!region && !region.ready
  const showExamples = coldOpen && !plannerDown && !sending && !uncuratedRegion

  // ⚠ LAZY INITIALISER, NOT A LIVE CALL — the contract `shouldShowListenRow` states, and §16's guard
  // for it: read once at mount so the answer cannot change underneath a rider. Home stays MOUNTED
  // under a push, so a live read would re-evaluate when they came back from /sample and pull the row
  // out mid-glance. Evaluated once here, it is true by construction rather than by care.
  const [showListenRow] = useState(shouldShowListenRow)

  // ⚠ ANY region at all, not "more than one" — and the change of heart is the point. Gating this on
  // a second region made the chip a dead label for the only configuration that ships, and the reason
  // I gave (a picker onto a list of one does nothing) was wrong about what the sheet is FOR: it
  // answers "where can I actually go?", and the list of roads the skipper knows IS the limit —
  // expressed as content rather than as the disclaimer §14 deliberately cut from the hint line.
  // One region is a short answer to that question, not the absence of one.
  // Single-sourced so the chip's affordance and the sheet's existence can never disagree.
  const hasRegions = (regions?.length ?? 0) > 0

  // The region picker is the PLATFORM's sheet now (see ui/RegionPicker), so there is no `visible`
  // state to hold and nothing to mount: the chip calls this and the sheet dismisses itself.
  const pickRegion = useRegionPicker()
  const openRegionPicker = useCallback(() => {
    pickRegion({
      regions: regions ?? [],
      selectedId: regionId,
      onSelect: (id) => {
        // ⚠ SWITCHING REGION CLEARS THE CONVERSATION (founder, 2026-08-03). This REVERSES the earlier
        // "keep it — the planner is handed one regionId per turn, so the next turn simply goes to the
        // new curated set", and the reason is correctness rather than tidiness: a proposal card
        // already in the transcript holds ANCHOR IDS from the region the rider just left. Left on
        // screen, its "Make this drive" would build a drive in the old region while the chip above
        // names the new one — and the server cannot catch that, because the ids it receives are
        // perfectly valid, just for somewhere else. The old note's worry (punishing a rider who
        // answers "which country" after describing a drive) is real but smaller: it costs them a
        // re-type, where the other costs them the wrong drive and a non-refundable credit.
        //
        // Only on a REAL change: re-picking the region you are already on must wipe nothing. And the
        // FIRST pick has no conversation to invalidate — the composer is disabled until a region
        // exists (`sending || !regionId`), so there is nothing behind it but the cold open.
        if (regionId !== null && id !== regionId) resetConversation({ focusComposer: false })
        setRegionId(id)
        // Persist the choice, or `pickRegionId` drags them back to the first region on the next
        // cold start — the cache is the ONLY record that this rider prefers a different one.
        // Same payload the load writes, so the offline card names the region they actually chose.
        const chosen = regions?.find((r) => r.id === id)
        if (chosen) {
          writeCachedRegion({
            regionId: chosen.id,
            displayName: chosen.displayName,
            exampleAnchors: chosen.exampleAnchors,
            // Same value the load wrote, deliberately — see `nextRotation`. Switching region must not
            // ALSO skip a window, or a rider comparing two regions burns through the rotation.
            rotation: nextRotation,
          })
        }
      },
    })
  }, [pickRegion, regions, regionId, resetConversation, nextRotation])

  // ── The rotating placeholder ────────────────────────────────────────────────────────────────
  // The rows teach WHAT kinds of thing to ask for; this teaches HOW CASUALLY you may say it. Every
  // decision lives in `placeholder-util` (pure, tested); this is only the timer and the vetoes.
  const [fieldFocused, setFieldFocused] = useState(false)
  // ⚠ STABLE ON PURPOSE — `Composer` is memoized, and inline arrows here would defeat its comparator
  // completely and silently. The setter identity is guaranteed stable by React, so `[]` is honest.
  const onFieldFocus = useCallback(() => setFieldFocused(true), [])
  const onFieldBlur = useCallback(() => setFieldFocused(false), [])
  const [tick, setTick] = useState(0)
  const reduceMotion = useReducedMotion()
  // ⚠ EMPTY IN AN UNCURATED REGION, and that is the ROTATION's veto as well as the copy's: the
  // name-free shapes ("just take the long way") survive a region with no anchors by design, so without
  // this the cycle would happily run — re-rendering home every few seconds to update a placeholder
  // belonging to a composer that is no longer mounted there. Routed through `exampleCount` rather
  // than a new flag on `shouldRotatePlaceholder`: zero examples already means "no rotation", and
  // "this region has nothing to teach an ask WITH" is honestly a fact about the examples.
  const placeholderExamples = useMemo(
    () =>
      uncuratedRegion ? [] : buildPlaceholderExamples(rotatedNames, voice.plan.placeholderShapes),
    [rotatedNames, uncuratedRegion],
  )
  const rotating = shouldRotatePlaceholder({
    exampleCount: placeholderExamples.length,
    reduceMotion,
    screenFocused: focused,
    fieldFocused,
    coldOpen,
  })
  // ⚠ The interval is torn down rather than paused, and the counter is LEFT WHERE IT SITS — that is
  // what makes freeze-on-focus and stop-when-unfocused the same mechanism. A rider who blurs the
  // field resumes on the next shape rather than jumping three forward in one frame.
  // ⚠ `focused` is in the veto because home stays MOUNTED under a push: without it this ticks forever
  // behind Settings and the player, re-rendering a screen nobody is looking at.
  useEffect(() => {
    if (!rotating) return
    const id = setInterval(() => setTick((n) => n + 1), PLACEHOLDER_ROTATE_MS)
    return () => clearInterval(id)
  }, [rotating])
  // ⚠ THE SAME `coldOpen` THAT VETOES THE ROTATION SWAPS THE COPY — one expression, deliberately, so
  // the two cannot drift into "the cycle stopped but the teaching line stayed". Tearing the interval
  // down freezes the example that was up; without this the reply box would keep showing an ask shape
  // ("2 hours, no highways") under a skipper turn that just asked the rider a question.
  const placeholder = coldOpen
    ? placeholderAt(placeholderExamples, tick, voice.plan.composerPlaceholder)
    : voice.plan.composerReplyPlaceholder

  // Burn the one launch the rider is owed only when the row was ACTUALLY on screen. Keyed on the same
  // two conditions that render it, so the offline home — which carries no listen row — can never spend
  // it on a screen that offered nothing. Writing the flag does not re-render: `showListenRow` was
  // already captured above, so the row stays put for the rest of this mount.
  useEffect(() => {
    if (coldOpen && showListenRow) markListenRowSeen()
  }, [coldOpen, showListenRow])

  // The wrap-up bar's CTA (design §7 case 2): the most recent route the rider was shown, but ONLY if
  // it never got drawn. Every route is drawn on arrival, so this is normally empty — it exists for
  // the case where a route landed and the card was dropped, and it is what stops the bar from
  // offering a second billed Routes call for a card already sitting in the transcript.
  //
  // ⚠ COMPARED BY `proposeKey`, NOT BY REFERENCE (===), and the two stopped agreeing the moment
  // `drawUp` began refusing duplicates. A re-emitted route rides on its own turn as a distinct
  // OBJECT, so reference equality called it undrawn and the bar offered "Draw it up" for a drive
  // already on screen — a button whose only remaining effect is a scroll. Both sides now ask the one
  // question that matters: would this bill a call we have already made?
  const pendingRoute = lastRouteOf(turns)
  const pendingKey = pendingRoute ? proposeKey(pendingRoute) : null
  const undrawnRoute =
    pendingRoute && !cards.some((c) => proposeKey(c.route) === pendingKey) ? pendingRoute : null

  // ⚠ THESE THREE ARE MEMOIZED FOR A REASON THAT IS INVISIBLE FROM HERE, and it is not tidiness.
  // expo-router's `Screen` pushes `options` through `navigation.setOptions` from a `useLayoutEffect`
  // keyed on that object, and react-navigation's updater always spreads a NEW object — so React can
  // never bail out on an equal value the way it does for `shown` above. A fresh element literal here
  // therefore forced a navigator-wide re-render plus a native-stack header re-commit, SYNCHRONOUSLY
  // before paint, on every keystroke, every streamed sentence flush and every 500 ms audio tick.
  // Nothing about the rendered header changes; only its identity is now stable across renders.
  const settingsButton = useMemo(
    () => (
      <HeaderIconButton name="settings" accessibilityLabel="Settings" onPress={() => router.push('/settings')} />
    ),
    [router],
  )
  const signInButton = useMemo(
    () => (
      <Button variant="ghost" title="Sign in" fullWidth={false} onPress={() => router.push('/sign-in')} />
    ),
    [router],
  )
  // ⚠ THE HEADER-LEFT SLOT WAS ALREADY EMPTY FOR EXACTLY THIS AUDIENCE — `signedIn ? undefined :
  // signInButton` left it doing nothing for signed-in riders, who are the only ones who can own a
  // drive. So moving MY DRIVES off the page costs NO new chrome: the slot swaps by auth state, which
  // is what it already did.
  const drivesButton = useMemo(
    () => <HeaderIconButton name="list" accessibilityLabel="My drives" onPress={() => router.push('/drives')} />,
    [router],
  )

  /** The header-left slot, resolved ONCE — it is read by both `headerLeft` and the iOS-26
   *  `unstable_headerLeftItems` pair below, and the two must never disagree about which button the
   *  slot holds. */
  const headerLeftEl = signedIn ? drivesButton : signInButton

  /** ⚠ The whole options object, memoized — see the note on the buttons above for WHY this one
   *  literal was re-rendering the navigator before every paint. `as const` on the `'custom'` tags is
   *  load-bearing: inside a `useMemo` the literal widens to `string` and stops matching the item
   *  union, which fails several files from the cause. */
  const screenOptions = useMemo(
    () => ({
      headerTitle: () => (
        <Text variant="wordmark" color="ink">
          SKIPPER
        </Text>
      ),
      headerTitleAlign: 'center' as const,
      headerLeft: () => headerLeftEl,
      headerRight: () => settingsButton,
      unstable_headerLeftItems: () => [
        { type: 'custom' as const, hidesSharedBackground: true, element: headerLeftEl },
      ],
      unstable_headerRightItems: () => [
        { type: 'custom' as const, hidesSharedBackground: true, element: settingsButton },
      ],
    }),
    [headerLeftEl, settingsButton],
  )

  // ── The masthead ────────────────────────────────────────────────────────────────────────────
  // What stood here — enamel kicker → Alfa-Slab headline → the parked rig on its trail → tagline —
  // is GONE, and the reason is not space: that stack is a LANDING PAGE, and Skipper already has one
  // at skipper.fm. In the app it re-sold someone who had already installed and was standing there
  // wanting to plan a drive. The poster survives as the watermark below.
  //
  // ⚠ THE ONE-AMBER ORDERING THIS BLOCK USED TO GUARD IS NOW SATISFIED BY CONSTRUCTION. The old
  // comment was right that `RouteTrack glow` had to be gone before a route card's amber MIN badge or
  // the TypingDots appeared, and keyed that to `collapsed` on the first rider turn. With the trail
  // deleted the cold open carries no amber at all, so there is no ordering left to keep correct —
  // which is why `collapsed` no longer gates anything here.
  //
  // ⚠ ANCHORED TO THE SCREEN, NOT TO ANY BLOCK ABOVE IT — that is the whole reason it is its own
  // element. It used to live inside the hero's View, so deleting that block (done, just above) would
  // have taken the last WPA poster reference off the screen SILENTLY, with nothing failing and no
  // test able to see it. It was moved out in its own commit FIRST, for exactly that reason.
  // ⚠ It also stopped being CLIPPED: the old `hero` style carried `overflow: 'hidden'`, so most of
  // the burst was cropped to that box. That — not the opacity — is why it read as invisible.
  // ⚠ THE INSET IS PAID HERE AND NOWHERE ELSE. This is ABSOLUTELY positioned, and Yoga measures an
  // absolute child's `top` from the parent's border box — the content padding that moves every other
  // block clear of the floating bar does not move this one. Without it the ridge climbs up behind the
  // status bar and dissolves under the bar's own fade, which is not a subtle regression: it is the
  // last WPA poster reference on the screen.
  const watermark = (
    <View style={[styles.watermark, { top: WATERMARK_TOP + headerInset }]} pointerEvents="none">
      <Ridgeline width={472} height={56} />
    </View>
  )

  // The region this conversation is pinned to.
  const masthead = (
    <RegionChip
      // The cached name covers the offline and outage reads. Null means either no /regions call has
      // ever succeeded here, or one did and returned SEVERAL — `loadRegions` auto-selects at length 1
      // only, so a longer list leaves nothing pinned until the rider picks.
      regionName={regionLabel}
      // ⚠ GATED ON "ARE THERE REGIONS", NEVER ON "IS ONE SELECTED", and the difference is the whole
      // repair (founder, 2026-08-03). `hasRegions` is true the moment a list lands, so the unpicked
      // case gets the caret and can reach the sheet. Gating on `region`/`regionLabel` instead would
      // recreate the deadlock exactly: no selection → no chip → no way to select → composer disabled
      // by `sending={sending || !regionId}`, forever.
      // ⚠ And this is NOT the hypothetical "until region 2 ships" it was written as: an admin is
      // served STAGED regions (apps/api GET /regions, `canPreview`), so a merely SEEDED second region
      // puts the signed-in founder straight into the multi-region path on the live app.
      onPress={hasRegions ? openRegionPicker : undefined}
    />
  )

  /** A STABLE play handler for the transcript's cards, and the indirection earns its lines:
   *  `preview.play` is a NEW function every 500 ms while a clip plays, because its dependency chain
   *  runs through a `toggle` that reads `status.currentTime`. Handed straight to a memoized card it
   *  would bust that memo at exactly the tick rate the memo exists to absorb.
   *
   *  ⚠ The mirror is written in an EFFECT, never during render — a ref write during render is the
   *  `react-hooks/refs` violation this file just finished burning down. Safe because an event handler
   *  always runs after the effect that armed it, so this can never serve a stale `play`. */
  const playRef = useRef(preview.play)
  useEffect(() => {
    playRef.current = preview.play
  }, [preview.play])
  const onPlayClip = useCallback((cardId: string, url: string) => {
    playRef.current(cardId, url)
  }, [])

  // The rest of a card's callbacks, hoisted to stable identities for the same reason — a memoized
  // child compares props shallowly, so an arrow rebuilt at the call site defeats it on every render.
  const onCreateCard = useCallback(
    (c: PreviewItem) => {
      if (c.proposal) void doCreate(c.id, c.proposal, c.idempotencyKey)
    },
    [doCreate],
  )
  const onOpenDriveCard = useCallback(
    (driveId: string) => {
      navigateOnce(() => router.push({ pathname: '/drives/[id]', params: { id: driveId } }))
    },
    [navigateOnce, router],
  )
  const onSignUpCard = useCallback(() => router.push('/sign-in?mode=up'), [router])
  const onDismissGateCard = useCallback(
    (id: string) => patchCard(id, { state: 'ready' }),
    [patchCard],
  )

  const renderCard = (c: PreviewItem, newest: boolean): ReactNode => (
    <TranscriptCard
      key={c.id}
      item={c}
      newest={newest}
      signedIn={signedIn}
      // Two booleans, not the preview hook: the hook's object identity changes on every 2 Hz status
      // tick, while these two only change when playback actually starts, stops or fails.
      clipPlaying={preview.activeCardId === c.id && preview.playing}
      clipFailed={preview.failedCardId === c.id}
      onCreate={onCreateCard}
      onAdjust={adjustDrive}
      onOpenDrive={onOpenDriveCard}
      onSignUp={onSignUpCard}
      onDismissGate={onDismissGateCard}
      onPlayClip={onPlayClip}
    />
  )

  // ── The transcript ──────────────────────────────────────────────────────────────────────────
  // ⚠ THE COLD OPEN IS NOT A TRANSCRIPT ENTRY, and that is structural rather than tidy. The server
  // rejects a transcript whose first turn is not the rider's, and it surfaces as a permanent fake
  // outage — so the safest place for a display-only greeting is somewhere `toWire` can never see it.
  // (`resetTranscript` still takes an opening for callers that want it in-array with `wire:false`;
  // this screen does not, because WHICH greeting is right depends on a region that loads after mount.)
  const newestCardId = cards[cards.length - 1]?.id
  const lastSkipperIdx = turns.reduce((idx, t, i) => (t.role === 'skipper' ? i : idx), -1)

  /** The bubbles, MEMOIZED APART FROM THE CARDS — and that split is the point of this block, not a
   *  tidy-up. Everything a bubble reads belongs to the CONVERSATION (the turns, which one announces,
   *  the reset ordinal); a card additionally reads live audio state, which ticks at 2 Hz for as long
   *  as a clip plays. Built in one pass, every one of those ticks re-created a `TurnBubble` element
   *  for every turn on screen — `memo()` then bailed each one out, so nothing re-RENDERED, but the
   *  elements were still allocated and the array still rebuilt, and that cost grows with the
   *  conversation. Held apart, a tick cannot reach them.
   *
   *  ⚠ It also holds for a whole STREAM. The in-progress reply is its own bubble further down
   *  (`shown`), not an entry in `turns`, so a sentence flush leaves this array untouched.
   *
   *  ⚠ `turns` BY IDENTITY is the right dep, not a fingerprint of its contents. Every write goes
   *  through `setTurns` with a fresh array (`appendRider`/`appendSkipper` never mutate), so identity
   *  already changes exactly when a bubble's text does — a fingerprint would be a second, weaker copy
   *  of a guarantee the transcript helpers already give. */
  const bubbles = useMemo(
    () =>
      turns.map((t, i) => (
        <TurnBubble
          // ⚠ Keyed by CONVERSATION as well as position. Keyed on the index alone, "Start fresh"
          // empties the array and the next exchange re-occupies t0/t1 — React reconciles by key and
          // type, so it REUSES the same component instances, and TurnBubble's one-shot "already
          // announced" ref is still set. The skipper's first reply after a reset would then never be
          // spoken on iOS (VoiceOver has no live region there; the announce is the whole mechanism).
          key={`c${conversationSeq}t${i}`}
          role={t.role}
          text={t.text}
          // Only the NEWEST skipper turn speaks itself, and only once — a live region on every
          // historical bubble would re-read the whole conversation on any re-render.
          // ⚠ `focused` is the third term and it HOLDS rather than drops: an in-flight turn keeps
          // running while the rider is on another screen (see `focused` above), so this goes false at
          // the moment the reply settles and true again when they return — TurnBubble's one-shot ref
          // then speaks it exactly once, on the screen it belongs to. Announcing nothing at all was
          // the other option and it is worse for the rider it exists for: on iOS this push IS the
          // whole mechanism (there is no live region), so a dropped announce means a VoiceOver rider
          // is simply never told the skipper answered.
          announceOnSettle={i === lastSkipperIdx && !sending && focused}
        />
      )),
    [turns, conversationSeq, lastSkipperIdx, sending, focused],
  )

  /** Cards bucketed by the slot they occupy, in ONE pass. The interleave below used to run a full
   *  scan of `cards` INSIDE `turns.forEach` — O(turns × cards) to place at most a few cards. Nobody
   *  would have felt that at today's sizes; it is fixed here because this is the pass that reads it,
   *  and a nested scan is the kind of thing that stops being free quietly.
   *
   *  ⚠ Slot 0 means "before the first turn", and it is a REAL case rather than a guard: a route can
   *  be drawn against a transcript that is still empty, which is why the original condition was
   *  `afterTurn <= 0` rather than `=== 0`. `Math.max` preserves exactly that. */
  const cardsBySlot = useMemo(() => {
    const bySlot = new Map<number, PreviewItem[]>()
    for (const c of cards) {
      const slot = Math.max(0, c.afterTurn)
      const inSlot = bySlot.get(slot)
      if (inSlot) inSlot.push(c)
      else bySlot.set(slot, [c])
    }
    return bySlot
  }, [cards])

  // ⚠ The interleave itself is deliberately NOT memoized: it only pushes already-built bubble
  // elements, and the cards it does build still depend on live clip state — memoizing those is step 6
  // of the plan, and doing it here would mean a fingerprint covering everything a card reads. Copying
  // existing references into an array is cheap; allocating the elements is not, and that half is
  // above.
  const transcript: ReactNode[] = []
  const pushCardsAt = (slot: number) => {
    for (const c of cardsBySlot.get(slot) ?? [])
      transcript.push(renderCard(c, c.id === newestCardId))
  }
  pushCardsAt(0)
  bubbles.forEach((bubble, i) => {
    transcript.push(bubble)
    pushCardsAt(i + 1)
  })

  const conversation = (
    <>
      {/* An uncurated region gets the honest in-persona "not my country yet" instead of an
          invitation the skipper cannot honour, and it stays a single paragraph — there is no question
          to ask, so it gets no question typography. While regions are still loading this reads as the
          normal open, which is what it will be for every region that has ever been curated. */}
      {uncuratedRegion ? (
        <Text variant="body" color="ink" style={styles.opening}>
          {voice.plan.openingUncurated}
        </Text>
      ) : (
        <>
          {/* ⚠ THE QUESTION IS THE HERO NOW. It was `body` 16pt sitting UNDER a `display` 30pt
              headline that said something else entirely — so the screen's largest type was marketing
              and its actual invitation was fine print. Swapping which of the two gets the display
              slot is most of the redesign, and the headline it replaced is deleted, not demoted. */}
          <Text variant="display" color="ink" style={styles.opening}>
            {voice.plan.openingQuestion}
          </Text>
          {/* The skipper's mark on the line he says. With the enamel kicker gone this is the only
              thing on the cold open that signals "he is talking" rather than "the app is labelling
              things" — cheap persona in a screen that just lost most of it. */}
          <View style={styles.hintRow}>
            <Icon name="spark" size={13} color="accentWarm" style={styles.hintSpark} />
            <Text variant="dim" color="inkDim" style={styles.flex}>
              {voice.plan.openingHint}
            </Text>
          </View>
        </>
      )}
      {transcript}
      {sending ? (
        <>
          {shown ? <TurnBubble role="skipper" text={shown} streaming /> : null}
          <View style={styles.thinking}>
            <TypingDots label={voice.plan.thinkingA11y} />
            <Text variant="dim" color="inkDim">
              {voice.plan.thinking}
            </Text>
          </View>
        </>
      ) : null}
      {plannerDown ? (
        <PlannerUnavailableCard
          reason="outage"
          anchorNames={anchorNames}
          onRetry={regionsFailed ? () => void loadRegions() : retryTurn}
        />
      ) : null}
      {/* ⚠ THE LISTEN ROW SITS ABOVE THE ASKS, INSIDE THE SAME LIST, and that placement is what makes
          the two launches structurally identical bar one row — the alternative (a hero card above the
          question) forced two authored layouts and two authored copy decks. It is still "hear him
          first" in the ACTION order: the first thing offered, just not the first thing typeset.
          ⚠ Its skin is deliberately unlike the three below it (round disc, pine keyline, its own
          kicker) so it never reads as a fourth suggestion. That distinction lives in ListenRow.
          ⚠ `coldOpen`, NOT `showExamples` — the sample is a static presigned clip that does not care
          whether the planner is up, and gating it on the examples made it vanish during an OUTAGE,
          i.e. at the exact moment it is the only audio in the app that still works. */}
      {coldOpen && showListenRow ? (
        <ListenRow
          kicker={voice.sample.rowKicker}
          title={voice.sample.rowTitle}
          subtitle={voice.sample.rowHint}
          // ⚠ Marks NOTHING here. "Seen" is recorded by the effect below, on the mount that actually
          // rendered the row; "played" is recorded in app/sample.tsx, next to the latch that already
          // fires once per load for both autoplay and a deliberate tap. Marking on tap would be a
          // third writer of the same fact and the one most likely to drift.
          onPress={() => navigateOnce(() => router.push('/sample'))}
        />
      ) : null}
      {showExamples
        ? exampleAsks.map((e, i) => (
            <SuggestionRow
              key={e.title}
              icon={EXAMPLE_ICONS[e.shape]}
              title={e.title}
              subtitle={e.ask}
              onPress={() => pickExample(i)}
            />
          ))
        : null}
    </>
  )

  // ── MY DRIVES — the rider's saved drives: a list, or a zero-state invite. ────────────────────
  // ⚠ A FUNCTION, not a const holding JSX, and the one character is worth the note: this subtree is
  // consumed ONLY in the offline branch below, which for a rider who is actually planning a drive is
  // never — yet as a const it allocated `drives.map(...)` plus ~6 elements per saved drive on every
  // single render of this screen. Building what you will not render is pure waste on the render path.
  const myDrives = () => (
    <View style={styles.section}>
      <Divider dashed />
      <View style={styles.sectionHead}>
        <Text variant="label" color="accentWarm" style={styles.flex}>
          MY DRIVES
        </Text>
        {/* Gentle credit hint — informational, and deliberately SILENT until the balance is actually
            low. ⚠ The threshold, the test and the sentence ALL live in `<CreditHint>` now. This screen
            and MY DRIVES each used to carry their own copy of all three, with a comment on the other
            side warning that this one "must not keep a copy — one home, or the two drift silently and
            nothing fails". They were still in step when they were merged; the saved-drive card next
            door was not so lucky. */}
        <CreditHint credits={credits} />
      </View>
      {offline ? (
        // ⚠ ICON *AND* THE WORD, which is the one rule worth taking from Google's offline guidance:
        // pair the cloud-off mark with text rather than relying on either alone. A glyph by itself is
        // ambiguous at a glance and unreadable to a screen reader; the sentence by itself is easy to
        // scroll past in a dead zone, which is exactly when it matters most.
        <View style={styles.offlineNote}>
          <Icon name="notDownloaded" size={14} color="inkFaint" />
          <Text variant="dim" color="inkFaint" style={styles.flex}>
            {voice.offline.home}
          </Text>
        </View>
      ) : null}

      {loading ? (
        <SkeletonGroup accessibilityLabel={voice.loading.drives} style={styles.list}>
          <DriveCardSkeleton />
          <DriveCardSkeleton />
        </SkeletonGroup>
      ) : error ? (
        <View style={styles.zeroState}>
          <Text variant="body" color="danger" align="center">
            {error}
          </Text>
          <Button variant="ghost" title={voice.error.retry} fullWidth={false} onPress={() => void load()} />
        </View>
      ) : drives.length === 0 ? (
        <Card>
          <Text variant="body" color="inkDim" align="center">
            No drives yet — plan one and it lands here for the road.
          </Text>
        </Card>
      ) : (
        // ⚠ The MAPPED column, not the virtualized <ScreenList> that MY DRIVES uses — this list is a
        // SECTION inside home's own ScrollView, and nesting a VirtualizedList in a ScrollView is an
        // error. The CARD is the same component on both surfaces, which is the part that matters: the
        // two used to be copies and had already drifted apart (this one carried the raw place name in
        // its VoiceOver label while MY DRIVES had been fixed).
        <DriveList drives={drives} onPressDrive={onPressDrive} />
      )}
    </View>
  )

  // ── The footer ──────────────────────────────────────────────────────────────────────────────
  // ⚠ The composer is REPLACED, never greyed out — a disabled field reads as broken, and none of the
  // three states below is a malfunction. Offline, a failed regions load and an UNCURATED region are
  // dead ends (the honest line is already on screen above); `done` is the skipper bowing out in
  // character (D12).
  //
  // ⚠ THE UNCURATED CASE IS ALSO A SPEND GUARD, not only a tidiness one (founder, 2026-08-03). With
  // no curated endpoints there is nothing the planner can legally propose — the allowlist is asserted
  // at the wire and an off-list ask is refused by construction — so EVERY turn a rider sends here is
  // a billed Opus call whose only possible outcome is the skipper saying no. Leaving the field live
  // under a paragraph that just said "I don't run any roads around here yet" invited exactly that,
  // once per attempt, anonymously and uncapped by anything but the rate limiter.
  //
  // ⚠ It reuses `uncuratedRegion` rather than re-deriving the test, so the sentence on screen and the
  // presence of the field can never disagree — the same one-expression rule that put the opening line
  // and the example rows on it. Its `!!region` guard is what keeps a still-loading `/regions` out of
  // this branch; without that the composer would blink away on every cold start.
  //
  // ⚠ The way OUT stays reachable: `masthead` (the region chip) sits outside `conversation` and is
  // gated on `hasRegions`, never on the selection — so a rider parked in an uncurated region can
  // still open the sheet and pick a different one. Remove the chip's escape hatch and this becomes a
  // dead screen.
  //
  // ⚠ INV-3/INV-12: nothing on this screen knows a cap NUMBER. There is no `maxLength`, no message
  // count and no character budget anywhere under apps/mobile — the client keys on the server's
  // `done: true` and on nothing else. The caps have ONE home, apps/api/src/limits.ts.
  const composer = isOffline || regionsFailed || uncuratedRegion ? null : done ? (
    <View style={styles.wrapUp}>
      {/* A CTA that cannot do anything is worse than a greyed field — with no route ever offered
          (the region-miss bow-out, or a rider who chatted the cap away) only "Start fresh" shows. */}
      {undrawnRoute ? (
        <Button
          icon="car"
          title={voice.plan.wrapUpDrawItUp}
          onPress={() => drawUp(undrawnRoute, turns.length)}
        />
      ) : null}
      <Button variant="ghost" title={voice.plan.wrapUpStartFresh} onPress={startFresh} />
    </View>
  ) : (
    <Composer
      // ⚠ THE REGION-SWITCH CLEAR. `resetConversation` no longer empties the draft itself (it cannot
      // — the draft is the Composer's), so this remount IS the clear.
      key={`c${conversationSeq}`}
      onSend={send}
      // `!regionId` rides the same flag: a turn cannot be posted without a region, and until the
      // regions call lands there genuinely IS something in flight. Disabled, not hidden — the field
      // stays typeable, so a rider composing during a cold start loses nothing.
      sending={sending || !regionId}
      placeholder={placeholder}
      onFocus={onFieldFocus}
      onBlur={onFieldBlur}
      inputRef={composerRef}
    />
  )

  // ⚠ THERE IS NO PINNED CLIP BAR ANY MORE (founder, 2026-08-03) — the card's own disc is the ONE
  // transport. The bar duplicated it: `preview.activeCardId` stays set for the rest of the
  // conversation, so a rider looking straight at the card saw two pause buttons and the same clip
  // titled twice, ~200pt apart.
  //
  // ⚠ WHAT THE BAR WAS GUARDING, so nobody restores it by halves: it sat OUTSIDE the null branch
  // above because `composer` goes null offline and on a failed regions load, and a clip playing when
  // the bars drop would leave audio with its only transport off-screen. That case is now covered by
  // the two paths that already stop the clip — the blur in `useFocusEffect`, and `startFresh` — plus
  // the unconditional session hand-back on `didJustFinish` (useRoutePreview), which is the ordinary
  // ending for a clip this short. What genuinely goes is the progress readout and the explicit ✕
  // stop: a rider who PAUSES mid-clip now holds the audio session (doNotMix) until they leave the
  // screen. Accepted knowingly — one transport beats two.
  const footer = composer

  return (
    <ConversationScreen footer={footer} scrollSignal={scrollSignal} contentContainerStyle={styles.body}>
      <Stack.Screen options={screenOptions} />

      {/* ⚠ The dormant `regions.length > 1` FilterChip row that used to sit here is DELETED, not
          disabled. It was invisible (one region auto-selects), so leaving it alongside the new chip
          would have shipped TWO region switchers that both only appear the day region 2 lands —
          a defect with no symptom until the moment it is most confusing. */}
      {watermark}

      {masthead}

      {/* ⚠ OFFLINE IS THE ONLY PLACE MY DRIVES STILL APPEARS ON HOME, and the asymmetry is the whole
          design. Online it has its own screen (`/drives`, behind the header-left control) because on
          the anonymous cold open it was a divider, a kicker and an empty card that could NEVER
          populate — an anonymous session owns no drives. Out in a dead zone it is not the archive, it
          is the product: the only thing on the phone that still works. So it goes FIRST here, the
          honest "can't plan out here" card goes below it, and the composer is absent (see `footer`).
          ⚠ Signed OUT and offline there is nothing to show at all — the sign-out purge clears the
          downloads — which is why that state is the outage card alone rather than an empty list. */}
      {isOffline ? (
        <>
          {myDrives()}
          <Divider dashed />
          <PlannerUnavailableCard reason="offline" anchorNames={anchorNames} />
        </>
      ) : (
        conversation
      )}
    </ConversationScreen>
  )
}

const styles = StyleSheet.create({
  body: { gap: space.md },
  flex: { flex: 1 },
  hintRow: { flexDirection: 'row', gap: space.sm },
  // Optically centres the mark on the first line of a 13.5pt row.
  hintSpark: { marginTop: 2 },
  // Pinned to the screen's content box, not to any block inside it — see `watermark`'s comment.
  // ⚠ THE OFFSETS ARE SMALL ON PURPOSE. At 168 with -54/-38 the burst's outer rays were cut by BOTH
  // screen edges hard enough to read as a rendering fault rather than a poster bleed. Smaller, and
  // barely overhanging, it reads as one whole sunburst that happens to sit in the corner.
  // ⚠ Higher and shorter than the first cut, and NEGATIVE horizontal insets on purpose: the ridge
  // must run OFF both screen edges. A horizon that stops short of the sides reads as a picture of a
  // mountain rather than the land the screen is sitting on.
  watermark: { position: 'absolute', top: WATERMARK_TOP, left: -16, right: -16 },
  // The cold open is prose on the paper, like every other skipper turn — but it carries no speaker
  // rule: nothing has been said yet for it to be answering.
  opening: { marginTop: space.sm },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  // The in-card taste. Flat, never lit: DESIGN §8 allows ONE amber glow on screen and the card's own
  // "Make this drive" CTA plus its MIN badge already spend it.
  wrapUp: { gap: space.sm },
  section: { marginTop: space.lg },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md, marginBottom: space.sm },
  offlineNote: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.sm },
  list: { gap: space.md },
  zeroState: { gap: space.md, alignItems: 'center', paddingVertical: space.md },
})
