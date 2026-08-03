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
import { Pressable, StyleSheet, View, type TextInput } from 'react-native'
import { Stack, useFocusEffect, useIsFocused, useRouter } from 'expo-router'
import type { PlannedRoute } from '@skipper/shared'
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
import { cleanPlaceName } from '@/lib/labels'
import { isPlanAborted, planTurn } from '@/lib/planner'
import { buildExampleAsks, type ExampleAsk } from '@/lib/planner-examples'
import { markListenRowSeen, shouldShowListenRow } from '@/lib/client-flags'
import {
  buildPlaceholderExamples,
  placeholderAt,
  shouldRotatePlaceholder,
  PLACEHOLDER_ROTATE_MS,
} from '@/lib/placeholder-util'
import { durationDrift, toCreateRequest, toProposeRequest } from '@/lib/planner-route'
import {
  appendRider,
  appendSkipper,
  lastRouteOf,
  resetTranscript,
  seedExample,
  toWire,
  type Turn,
} from '@/lib/planner-transcript'
import { readCachedRegion, writeCachedRegion } from '@/lib/region-cache'
import { emptySayBuffer, pushDelta, settle, tickHold, type SayBuffer } from '@/lib/say-buffer'
import { useRoutePreview } from '@/lib/useRoutePreview'
import { uuidV4 } from '@/lib/uuid'
import { useReducedMotion, useTheme } from '@/theme'
import { hit, radius, space } from '@/theme/tokens'
import {
  AttributionButton,
  Badge,
  Button,
  Card,
  ClipBar,
  Composer,
  ConversationScreen,
  Divider,
  HeaderIconButton,
  Icon,
  PlannerUnavailableCard,
  PreviewCard,
  Skeleton,
  SkeletonGroup,
  RegionChip,
  RegionPicker,
  type IconName,
  SuggestionRow,
  ListenRow,
  Sunburst,
  Text,
  TurnBubble,
  TypingDots,
  voice,
  type PreviewCardState,
} from '@/ui'

/** Show the remaining-drives hint only at or below this balance. Not derived from the server's grant
 *  amount on purpose: the rider's grant is FROZEN at signup while the server default moves, so a
 *  ratio ("show under 10%") would mean different things to two riders on the same screen. An absolute
 *  count is the thing a rider can act on — it answers "should I be careful?", which a percentage of a
 *  number they never saw does not. */
// One glyph per ask SHAPE — keyed on `ExampleAsk.shape`, never on list position, because the list
// degrades in regions with fewer than two curated names and position stops identifying a shape there.
const EXAMPLE_ICONS: Record<ExampleAsk['shape'], IconName> = {
  aToB: 'region', // a pin: somewhere to somewhere
  loop: 'restart', // a closed circuit — out and back around
  open: 'scenic', // the skipper's own eye picks it
}

const CREDIT_HINT_THRESHOLD = 5

/** How often the max-hold flush is re-evaluated while a turn streams. Not a token bucket and not a
 *  cap — it is only the resolution at which `tickHold` can notice that a fragment has waited out
 *  SAY_MAX_HOLD_MS. Six ticks per hold is plenty; a faster interval would re-render for nothing. */
const HOLD_TICK_MS = 100

/** One route card living in the transcript.
 *
 *  `afterTurn` is the transcript LENGTH when the card was created, i.e. the slot it occupies between
 *  turns. Cards are held apart from `Turn[]` deliberately: a transcript is what the model is re-sent
 *  (`toWire`), and a card is a local artifact of a Routes call the model never sees.
 *
 *  ⚠ `idempotencyKey` and the in-flight guard are both PER-CARD (see the header) — a screen-level
 *  guard would let card #1 block card #2, or worse, let card #2 dedupe against card #1's key. */
interface PreviewItem {
  id: string
  afterTurn: number
  route: PlannedRoute
  state: PreviewCardState
  proposal: DriveProposal | null
  /** The create key for THIS card, minted with it. ⚠ A FIELD, not a side table: it was a parallel
   *  `Map<cardId, key>` ref that had to be torn down in lockstep with `cards` (and this very comment
   *  described it as if it already lived here). One lifetime, one structure — a card cannot now exist
   *  without its key, and clearing the cards cannot leave a key behind. */
  idempotencyKey: string
  errorMessage?: string
  driveId?: string
}

export default function HomeScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const { data: session } = useSession()
  // ⚠ INV-9 — the ONE client-side "is this rider signed in?" (src/lib/auth.ts). A truthy `session` is
  // NOT signed in: after D16's mint every rider carries one and an anonymous rider owns nothing.
  // Never inline `!!session` anywhere below.
  const signedIn = isSignedIn(session)
  // ONE expo-audio player for the whole conversation, keyed by CARD id (see useRoutePreview). The
  // screen owns the audio; PreviewCard and ClipBar stay pure presentation, same rule as everything
  // else here that spends or holds state.
  const preview = useRoutePreview()
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
  const [input, setInput] = useState('')
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

  // Navigation in-flight guard: expo-router does NOT de-dupe identical pushes, so a fast
  // double-tap would stack two identical screens. Set on the first push, cleared on refocus.
  const navigatingRef = useRef(false)
  const navigateOnce = useCallback((go: () => void) => {
    if (navigatingRef.current) return
    navigatingRef.current = true
    go()
  }, [])

  // Monotonic request id: the focus load, the reconnect self-heal and a Better Auth session refetch
  // can all fire within the same moment (they share the network edge), and without this the SLOWER
  // of two overlapping loads wins and can stamp a stale list — or a stale error — over a good one.
  // Only the newest run is allowed to write.
  const loadSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    const isCurrent = () => loadSeq.current === seq
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
  }, [signedIn])

  // The regions load. ⚠ It is the conversation's PREREQUISITE, not a nicety: POST /drives/plan
  // requires a regionId, so a failed load means there is nothing to talk to — hence the outage card
  // and no composer rather than a field that 400s on send.
  //
  // D-J / 1.1: SINGLE-REGION. Auto-select at length 1 (the Tahoe-launch case); a chip row appears
  // above the hero only if a second region ever ships. The planner is given no cross-region
  // vocabulary, so the rider must be talking to exactly one skipper.
  const loadRegions = useCallback(async () => {
    setRegionsFailed(false)
    try {
      const rs = await listRegions()
      setRegions(rs)
      const only = rs.length === 1 ? rs[0] : null
      if (only) {
        setRegionId(only.id)
        // Names only, for the degraded cards. See region-cache.ts's header for what this may hold.
        writeCachedRegion({
          regionId: only.id,
          displayName: only.displayName,
          exampleAnchors: only.exampleAnchors,
        })
      }
    } catch {
      // The message is never shown — the outage card speaks for itself, in persona.
      setRegionsFailed(true)
    }
  }, [])

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
      navigatingRef.current = false // any in-flight nav settled (or the rider backed out)
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

  // The first clip of the conversation starting SHRINKS the scroll viewport: `clipBar` appears in
  // the footer and takes ~80pt off the bottom of the ScrollView. That is a LAYOUT change and not a
  // content change, so ConversationScreen's `onContentSizeChange` never fires — nothing scrolls, and
  // the card's "Make this drive" CTA plus the disclosure line under it slide under the fold at the
  // exact moment the rider is being sold (confirmed on device). `scrollSignal` is the sanctioned way
  // to ask for the re-pin: it overrides where the rider had scrolled to, which is only ever allowed
  // for an action the RIDER took, and tapping the play disc is one.
  //
  // ⚠ EDGE-TRIGGERED (null → non-null), never "a clip is loaded". The bar mounts once and stays for
  // the rest of the conversation, so a later tap costs no height and must not yank back a rider who
  // deliberately scrolled up mid-clip — the one thing ConversationScreen's pin rule exists to stop.
  const clipBarShownRef = useRef(false)
  useEffect(() => {
    const shown = preview.activeCardId != null
    if (shown && !clipBarShownRef.current) bumpScroll()
    clipBarShownRef.current = shown
  }, [bumpScroll, preview.activeCardId])

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
        // patch, rather than from inside PreviewCard — the card is not memoized and re-renders on
        // every composer keystroke, so a render-time emit would report typing speed. The `quiet`
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
            duration_min: Math.round(p.durationSeconds / 60),
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
        } else patchCard(cardId, { state: 'error', errorMessage: errorMessage(e, voice.proposal.drawFailed) })
      }
    },
    [patchCard],
  )

  /** A route arrived (or the wrap-up bar asked for the last one) → a new card, drawn immediately.
   *  The planner only emits a route once the rider has said yes in words, so the yes has already
   *  happened; the tap that costs money is the one INSIDE the card. */
  const drawUp = useCallback(
    (route: PlannedRoute, afterTurn: number) => {
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
          { turns: wire, regionId },
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

  const send = useCallback(() => {
    const text = input.trim()
    // ⚠ The regionId guard is HERE, before the rider's line is appended — `runTurn` bails on a
    // missing region too, and if that were the only guard a send during the regions load would put
    // the rider's words on screen and then silently do nothing with them. The send disc is disabled
    // over the same window, so this is the belt to that brace.
    if (text === '' || sendingRef.current || !regionId) return
    const next = appendRider(turns, text)
    setTurns(next)
    setInput('')
    bumpScroll()
    void runTurn(next, false)
  }, [bumpScroll, input, regionId, runTurn, turns])

  const focusComposer = useCallback(() => {
    bumpScroll()
    composerRef.current?.focus()
  }, [bumpScroll])

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

  /** "Start fresh" — back to the cold open. It must not touch MY DRIVES and must not fetch anything
   *  paid. Autofocus IS correct here (the rider explicitly asked for an empty field) but it cannot
   *  happen from in here — see `resetSeq` and the effect below. */
  const startFresh = useCallback(() => {
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
    applyBuf(emptySayBuffer)
    setDone(false)
    setPlannerOutage(false)
    setInput('')
    // The autofocus is DEFERRED, not dropped. "Start fresh" only exists in the `done` wrap-up bar,
    // and in that branch the composer is not rendered at all — so `composerRef.current` is null for
    // the whole of this handler and the focus() that used to sit here has never once fired. Publish
    // the intent; the effect below claims it after the composer is back on screen.
    setResetSeq((n) => n + 1)
  }, [applyBuf, preview.stop])

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
      buildExampleAsks(anchorNames, {
        aToBTitle: voice.plan.exampleAToBTitle,
        aToB: voice.plan.exampleAToB,
        aToBReply: voice.plan.exampleAToBReply,
        loopTitle: voice.plan.exampleLoopTitle,
        loop: voice.plan.exampleLoop,
        loopReply: voice.plan.exampleLoopReply,
        openTitle: voice.plan.exampleOpenTitle,
        open: voice.plan.exampleOpen,
        openRegion: voice.plan.exampleOpenRegion,
        openReply: voice.plan.exampleOpenReply,
      },
      // ⚠ The REGION name, not an anchor — it makes the open-ended row region-specific like the other
      // two while staying the one ask that still has a form when a region has no curated anchors.
      regionLabel ?? undefined),
    [anchorNames, regionLabel],
  )

  /** A tapped example chip seeds BOTH halves of an authored exchange and makes NO model call — the
   *  app's highest-traffic turn costs zero dollars. Both ride the wire (the model must see the answer
   *  it "already gave"), and the pair ends on a skipper turn so it is never sendable alone. */
  const pickExample = useCallback(
    (i: number) => {
      const ex = exampleAsks[i]
      if (!ex) return
      setTurns((ts) => seedExample(ts, ex.ask, ex.reply))
      // ⚠ FOCUS, not just the scroll pin (`focusComposer` does both). Every authored reply ends on a
      // direct question — "About how long do you want to be out?" — so the seeded turn hands the ball
      // straight back to the rider, and leaving the cursor nowhere makes them find the field for a
      // question that was just asked of them. "Change it up" already earns this; so does this.
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
  const showExamples = coldOpen && !plannerDown && !sending

  // ⚠ LAZY INITIALISER, NOT A LIVE CALL — the contract `shouldShowListenRow` states, and §16's guard
  // for it: read once at mount so the answer cannot change underneath a rider. Home stays MOUNTED
  // under a push, so a live read would re-evaluate when they came back from /sample and pull the row
  // out mid-glance. Evaluated once here, it is true by construction rather than by care.
  const [showListenRow] = useState(shouldShowListenRow)

  // Only worth a sheet when there is more than one answer. Single-sourced so the chip's affordance and
  // the sheet's existence can never disagree — a caret with no sheet behind it is the failure mode.
  const multiRegion = (regions?.length ?? 0) > 1
  const [regionPickerOpen, setRegionPickerOpen] = useState(false)

  // ── The rotating placeholder ────────────────────────────────────────────────────────────────
  // The rows teach WHAT kinds of thing to ask for; this teaches HOW CASUALLY you may say it. Every
  // decision lives in `placeholder-util` (pure, tested); this is only the timer and the vetoes.
  const [fieldFocused, setFieldFocused] = useState(false)
  const [tick, setTick] = useState(0)
  const reduceMotion = useReducedMotion()
  const placeholderExamples = useMemo(
    () => buildPlaceholderExamples(anchorNames, voice.plan.placeholderShapes),
    [anchorNames],
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
  const placeholder = placeholderAt(placeholderExamples, tick, voice.plan.composerPlaceholder)

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
  const pendingRoute = lastRouteOf(turns)
  const undrawnRoute =
    pendingRoute && !cards.some((c) => c.route === pendingRoute) ? pendingRoute : null

  const settingsButton = (
    <HeaderIconButton name="settings" accessibilityLabel="Settings" onPress={() => router.push('/settings')} />
  )
  const signInButton = (
    <Button variant="ghost" title="Sign in" fullWidth={false} onPress={() => router.push('/sign-in')} />
  )
  // ⚠ THE HEADER-LEFT SLOT WAS ALREADY EMPTY FOR EXACTLY THIS AUDIENCE — `signedIn ? undefined :
  // signInButton` left it doing nothing for signed-in riders, who are the only ones who can own a
  // drive. So moving MY DRIVES off the page costs NO new chrome: the slot swaps by auth state, which
  // is what it already did.
  const drivesButton = (
    <HeaderIconButton name="list" accessibilityLabel="My drives" onPress={() => router.push('/drives')} />
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
  const watermark = (
    <View style={styles.watermark} pointerEvents="none">
      <Sunburst size={128} opacity={0.09} />
    </View>
  )

  // The region this conversation is pinned to, and the dashed atlas rule running off it to the right
  // edge. The rule lives INSIDE RegionChip: it starts at the chip and is meaningless without one, so
  // keeping them together makes the no-region case a single early return instead of two conditions
  // that must agree.
  const masthead = (
    <RegionChip
      // The cached name covers the offline and outage reads; null only when no /regions call has ever
      // succeeded on this device, which RegionChip renders as nothing rather than an empty pill (§12).
      regionName={regionLabel}
      // ⚠ Pressable ONLY when there is genuinely something to pick. With one released region this is
      // a plain label — RegionChip renders that state itself — because a caret onto a list of one is
      // a control that does nothing. The sheet is built and wired; it simply has no work to do until
      // region 2 ships, at which point this turns on with no further change.
      onPress={multiRegion ? () => setRegionPickerOpen(true) : undefined}
    />
  )

  /** The in-card taste (D14/INV-5): ONE clip the server chose from THIS route's own release-filtered
   *  selection — the drive's opening beat, so the preview and the product can never disagree.
   *
   *  ⚠ NO AUTOPLAY, ever. The clip takes EXCLUSIVE audio focus (D35), so a card that lands mid-
   *  conversation and starts talking would PAUSE the rider's music with no tap — hostile in a way the
   *  old mixing behaviour would have hidden. Tap to play, always.
   *
   *  A null clip is a normal outcome (a 0-stop route, or a presign that failed) — the card renders
   *  without the slot and nothing here says so; there is no missing-clip copy because there is no
   *  missing thing from the rider's point of view. */
  const renderClipRow = (c: PreviewItem): ReactNode => {
    const clip = c.proposal?.previewClip
    if (!clip) return null
    // The presign is DEAD and this surface cannot mint another (`/drives/:id/assets/sign` is an owner
    // route). So the disc goes away with it: leaving a play button under copy that says "make the
    // drive instead" invites a tap that provably cannot work.
    if (preview.failedCardId === c.id) {
      return (
        <View style={styles.clipRow}>
          <Text variant="label" color="accentWarm">
            {voice.proposal.clipKicker}
          </Text>
          <Text variant="dim" color="danger">
            {voice.proposal.clipUnavailable}
          </Text>
        </View>
      )
    }
    const active = preview.activeCardId === c.id
    const playing = active && preview.playing
    return (
      <View style={styles.clipRow}>
        <View style={styles.clipHead}>
          <Pressable
            onPress={() => preview.play(c.id, clip.url)}
            accessibilityRole="button"
            accessibilityLabel={playing ? voice.proposal.clipPauseA11y : voice.proposal.clipPlayA11y}
            style={({ pressed }) => [
              styles.clipDisc,
              { backgroundColor: colors.primaryFill },
              pressed && styles.clipPressed,
            ]}
          >
            <Icon name={playing ? 'pause' : 'play'} size={22} color="onPrimary" />
          </Pressable>
          <View style={styles.flex}>
            <Text variant="label" color="accentWarm">
              {voice.proposal.clipKicker}
            </Text>
            {/* The place NAME comes from the server, never from the planner — it is a fact about a
                stop, and D9 keeps facts out of the conversation. `places.name` carries Wikipedia's
                ", California" disambiguation, hence cleanPlaceName. */}
            <Text variant="bodyStrong" color="ink" numberOfLines={1}>
              {cleanPlaceName(clip.name)}
            </Text>
          </View>
          {/* ⚠ NOT decoration. Wikipedia is CC BY-SA, and this is the most-seen anonymous surface in
              the app — the credit rides the clip wherever the adapted work is presented. It renders
              nothing for a clip with no sources (scenic/break ground on none). */}
          <AttributionButton items={clip.attribution} />
        </View>
        <Text variant="dim" color="inkDim">
          {voice.proposal.clipHint}
        </Text>
      </View>
    )
  }

  /** The skipper's line when the drawn drive doesn't match the duration the rider named, or undefined
   *  when it does (or when they never named one, which is the common case). The RULE is pure and
   *  tested — `durationDrift` in @/lib/planner-route; this only picks the words. */
  const durationNoteFor = (c: PreviewItem): string | undefined => {
    if (!c.proposal) return undefined
    const drift = durationDrift(c.route.targetMinutes, c.proposal.durationSeconds)
    if (!drift) return undefined
    return drift.direction === 'short'
      ? voice.proposal.durationShort(drift.askedMinutes, drift.actualMinutes)
      : voice.proposal.durationLong(drift.askedMinutes, drift.actualMinutes)
  }

  const renderCard = (c: PreviewItem, newest: boolean): ReactNode => (
    <PreviewCard
      key={c.id}
      state={c.state}
      proposal={c.proposal}
      // Only the newest card instantiates a native MapView — and wears the one amber glow.
      mapEnabled={newest}
      disclosure={signedIn ? voice.proposal.costNote : voice.proposal.ownershipNote}
      // ⚠ Computed HERE because this screen is the only place both halves exist: the rider's stated
      // target rides on `c.route` (the PlannedRoute) and is dropped before `/propose`, so `c.proposal`
      // — all the card ever sees — cannot know what was asked for.
      durationNote={durationNoteFor(c)}
      previewClip={renderClipRow(c)}
      errorMessage={c.errorMessage}
      ctaLabel={voice.proposal.cta}
      onMake={() => c.proposal && void doCreate(c.id, c.proposal, c.idempotencyKey)}
      onAdjust={focusComposer}
      onOpenDrive={() =>
        c.driveId &&
        navigateOnce(() => router.push({ pathname: '/drives/[id]', params: { id: c.driveId! } }))
      }
      // ⚠ NEVER auto-fired on return from sign-up. The fresh account's grant does not exist until
      // after signup, so the number D29 requires us to disclose does not exist at wall time — the
      // rider comes back to a re-read balance and taps "Make this drive" once more, on purpose.
      // Neither POST /drives NOR the billed POST /drives/propose may re-fire on refocus; the focus
      // effect above calls `load()` and nothing else. (This rule used to live on the screen-level
      // gate card that step 8a retired — /propose is open to anonymous now, so `needsAccount` can
      // only arrive WITH a proposal, and PreviewCard's hoisted wall IS the wall.)
      onSignUp={() => router.push('/sign-in?mode=up')}
      onDismissGate={() => patchCard(c.id, { state: 'ready' })}
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
  const transcript: ReactNode[] = []
  for (const c of cards) if (c.afterTurn <= 0) transcript.push(renderCard(c, c.id === newestCardId))
  turns.forEach((t, i) => {
    transcript.push(
      <TurnBubble
        // ⚠ Keyed by CONVERSATION as well as position. Keyed on the index alone, "Start fresh" empties
        // the array and the next exchange re-occupies t0/t1 — React reconciles by key and type, so it
        // REUSES the same component instances, and TurnBubble's one-shot "already announced" ref is
        // still set. The skipper's first reply after a reset would then never be spoken on iOS
        // (VoiceOver has no live region there; the announce is the whole mechanism).
        key={`c${convSeq.current}t${i}`}
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
      />,
    )
    for (const c of cards)
      if (c.afterTurn === i + 1) transcript.push(renderCard(c, c.id === newestCardId))
  })

  const conversation = (
    <>
      {/* An uncurated region gets the honest in-persona "not my country yet" instead of an
          invitation the skipper cannot honour, and it stays a single paragraph — there is no question
          to ask, so it gets no question typography. While regions are still loading this reads as the
          normal open, which is what it will be for every region that has ever been curated. */}
      {region && region.exampleAnchors.length === 0 ? (
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
  const myDrives = (
    <View style={styles.section}>
      <Divider dashed />
      <View style={styles.sectionHead}>
        <Text variant="label" color="accentWarm" style={styles.flex}>
          MY DRIVES
        </Text>
        {/* Gentle credit hint — informational, and deliberately SILENT until the balance is actually
            low. The comment here used to claim it was "not a depleting X-left-of-N toll gauge" while
            rendering unconditionally, which was true only while the allotment was small enough to be
            interesting. With the allotment generous (2026-07-31) an always-on counter is worse than
            none: it hangs a meter on a charm-first screen to report a wall roughly a decade away.
            It reappears with enough runway to matter, which is the only moment it informs anything. */}
        {credits && credits.remaining <= CREDIT_HINT_THRESHOLD ? (
          <Text variant="label" color="inkFaint">
            {credits.remaining > 0
              ? `${credits.remaining} free ${credits.remaining === 1 ? 'drive' : 'drives'} left`
              : 'No free drives left'}
          </Text>
        ) : null}
      </View>
      {offline ? (
        <Text variant="dim" color="inkFaint" style={styles.offlineNote}>
          {voice.offline.home}
        </Text>
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
        <View style={styles.list}>
          {drives.map((dr) => {
            const min = dr.durationSeconds ? Math.round(dr.durationSeconds / 60) : null
            return (
              <View
                key={dr.driveId}
                accessible
                accessibilityRole="button"
                accessibilityLabel={`${dr.label}${dr.clipCount ? `, ${dr.clipCount} stops` : ''}${min ? `, ${min} minutes` : ''}`}
              >
                <Card onPress={() => navigateOnce(() => router.push({ pathname: '/drives/[id]', params: { id: dr.driveId } }))}>
                  <Text variant="title" color="ink" numberOfLines={2}>
                    {cleanPlaceName(dr.label)}
                  </Text>
                  <View style={styles.metaRow}>
                    <Text variant="label" color="inkFaint" style={styles.flex}>
                      {dr.clipCount} {dr.clipCount === 1 ? 'stop' : 'stops'}
                    </Text>
                    {min ? <Badge tone="amber" label={`${min} MIN`} /> : null}
                  </View>
                </Card>
              </View>
            )
          })}
        </View>
      )}
    </View>
  )

  // ── The footer ──────────────────────────────────────────────────────────────────────────────
  // ⚠ The composer is REPLACED, never greyed out — a disabled field reads as broken, and neither of
  // the two states below is a malfunction. Offline and a failed regions load are dead ends (the card
  // above carries the honest line); `done` is the skipper bowing out in character (D12).
  //
  // ⚠ INV-3/INV-12: nothing on this screen knows a cap NUMBER. There is no `maxLength`, no message
  // count and no character budget anywhere under apps/mobile — the client keys on the server's
  // `done: true` and on nothing else. The caps have ONE home, apps/api/src/limits.ts.
  const composer = isOffline || regionsFailed ? null : done ? (
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
      value={input}
      onChangeText={setInput}
      onSend={send}
      // `!regionId` rides the same flag: a turn cannot be posted without a region, and until the
      // regions call lands there genuinely IS something in flight. Disabled, not hidden — the field
      // stays typeable, so a rider composing during a cold start loses nothing.
      sending={sending || !regionId}
      placeholder={placeholder}
      onFocus={() => setFieldFocused(true)}
      onBlur={() => setFieldFocused(false)}
      inputRef={composerRef}
    />
  )

  // ⚠ THE PINNED CLIP BAR SITS OUTSIDE THE null BRANCH ABOVE, ON PURPOSE. `composer` goes null both
  // offline and on a failed regions load — and roam already paid for what happens next: a clip
  // playing when the bars drop would leave audio running with its only transport off-screen and no
  // way to stop it short of killing the app. Whenever a clip is loaded, the bar is on screen.
  //
  // ⚠ Keyed on the PLAYER's active card, not on finding one: if a card ever vanishes mid-clip the
  // transport must survive it. (Today the only path that removes a card is "Start fresh", which
  // stops the clip first — the `?? ''` is the belt to that brace, not a live case.)
  const activeClip =
    cards.find((c) => c.id === preview.activeCardId)?.proposal?.previewClip ?? null
  const clipBar = preview.activeCardId ? (
    <ClipBar
      playing={preview.playing}
      name={activeClip?.name ?? ''}
      progress={preview.durationMs > 0 ? preview.positionMs / preview.durationMs : 0}
      onToggle={preview.toggle}
      onDismiss={preview.stop}
    />
  ) : null

  // One wrapper so the two stack with a gap; ConversationScreen's footer slot supplies the gutter
  // padding and the safe-area inset, and renders nothing at all when this is null.
  const footer =
    clipBar || composer ? (
      <View style={styles.footerStack}>
        {clipBar}
        {composer}
      </View>
    ) : null

  return (
    <ConversationScreen footer={footer} scrollSignal={scrollSignal} contentContainerStyle={styles.body}>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <Text variant="wordmark" color="ink">
              SKIPPER
            </Text>
          ),
          headerTitleAlign: 'center',
          headerLeft: () => (signedIn ? drivesButton : signInButton),
          headerRight: () => settingsButton,
          unstable_headerLeftItems: () => [
            {
              type: 'custom',
              hidesSharedBackground: true,
              element: signedIn ? drivesButton : signInButton,
            },
          ],
          unstable_headerRightItems: () => [
            { type: 'custom', hidesSharedBackground: true, element: settingsButton },
          ],
        }}
      />

      {/* ⚠ The dormant `regions.length > 1` FilterChip row that used to sit here is DELETED, not
          disabled. It was invisible (one region auto-selects), so leaving it alongside the new chip
          would have shipped TWO region switchers that both only appear the day region 2 lands —
          a defect with no symptom until the moment it is most confusing. */}
      {watermark}

      {masthead}

      {/* Mounted only when it can do something — `visible` alone would keep a Modal in the tree on
          every single-region launch, which is the overwhelmingly common case today. */}
      {multiRegion ? (
        <RegionPicker
          visible={regionPickerOpen}
          regions={regions ?? []}
          selectedId={regionId}
          onSelect={(id) => {
            // ⚠ Switching region does NOT clear the transcript, and that is deliberate: the planner is
            // handed one regionId per turn, so the next turn simply goes to the new region's curated
            // set. Wiping the conversation would punish a rider for answering "which country" after
            // they had already started describing a drive.
            setRegionId(id)
            setRegionPickerOpen(false)
          }}
          onClose={() => setRegionPickerOpen(false)}
        />
      ) : null}

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
          {myDrives}
          <Divider dashed />
          <PlannerUnavailableCard reason="offline" anchorNames={anchorNames} />
        </>
      ) : (
        conversation
      )}
    </ConversationScreen>
  )
}

// A drive card's silhouette while the list loads. Inert; the enclosing SkeletonGroup owns the pulse.
function DriveCardSkeleton() {
  return (
    <Card>
      <Skeleton width="72%" height={20} />
      <Skeleton width="48%" height={12} style={styles.skLine} />
    </Card>
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
  watermark: { position: 'absolute', top: -8, right: -8 },
  // The cold open is prose on the paper, like every other skipper turn — but it carries no speaker
  // rule: nothing has been said yet for it to be answering.
  opening: { marginTop: space.sm },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  // The in-card taste. Flat, never lit: DESIGN §8 allows ONE amber glow on screen and the card's own
  // "Make this drive" CTA plus its MIN badge already spend it.
  clipRow: { gap: space.sm },
  clipHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  // hit.min, not the ~44 the design sketch showed — the in-car ≥48pt floor is a habit, not a
  // per-surface judgement, and this rider is one tap from a drive.
  clipDisc: {
    width: hit.min,
    height: hit.min,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clipPressed: { opacity: 0.85 },
  footerStack: { gap: space.sm },
  wrapUp: { gap: space.sm },
  section: { marginTop: space.lg },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md, marginBottom: space.sm },
  offlineNote: { marginBottom: space.sm },
  list: { gap: space.md },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  zeroState: { gap: space.md, alignItems: 'center', paddingVertical: space.md },
  skLine: { marginTop: space.sm },
})
