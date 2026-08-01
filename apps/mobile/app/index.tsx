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
import { Animated, StyleSheet, View, type TextInput } from 'react-native'
import { Stack, useFocusEffect, useRouter } from 'expo-router'
import type { PlannedRoute } from '@skipper/shared'
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
import { useSession } from '@/lib/auth'
import { useIsOffline } from '@/lib/connectivity'
import { listDownloadedDrives } from '@/lib/offline'
import { cleanPlaceName } from '@/lib/labels'
import { isPlanAborted, planTurn } from '@/lib/planner'
import { buildExampleAsks, type ExampleAsk } from '@/lib/planner-examples'
import { toCreateRequest, toProposeRequest } from '@/lib/planner-route'
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
import { emptySayBuffer, pushDelta, settle, tickHold } from '@/lib/say-buffer'
import { uuidV4 } from '@/lib/uuid'
import { space } from '@/theme/tokens'
import {
  Badge,
  Button,
  Card,
  Composer,
  ConversationScreen,
  Divider,
  ExampleAsks,
  FilterChip,
  HeaderIconButton,
  PlannerUnavailableCard,
  PreviewCard,
  RouteTrack,
  Skeleton,
  SkeletonGroup,
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
const CREDIT_HINT_THRESHOLD = 5

/** How often the max-hold flush is re-evaluated while a turn streams. Not a token bucket and not a
 *  cap — it is only the resolution at which `tickHold` can notice that a fragment has waited out
 *  SAY_MAX_HOLD_MS. Six ticks per hold is plenty; a faster interval would re-render for nothing. */
const HOLD_TICK_MS = 100

/** ⚠ INV-9, AND THIS IS THE ONE PLACE IT IS DECIDED ON THIS SCREEN. A truthy `session` is NOT
 *  "signed in": the Better Auth anonymous plugin mints a REAL user row, so an anonymous rider has a
 *  perfectly truthy session and owns nothing — they cannot list drives and cannot hold a credit.
 *  Mirrors the server's `tierOf` ('anonymous' | 'free').
 *
 *  ⚠ THIS BELONGS IN `src/lib/auth.ts` BESIDE `isAdmin()`, and build step 8b owns putting it there
 *  (nothing mints an anonymous session yet, so today it is only this screen's problem). It is written
 *  here as one exported-shaped helper, structurally typed, so 8b has exactly ONE call-shape to move
 *  and every check on this screen changes with it. Do not inline `!!session` anywhere below. */
const isSignedIn = (s: { user?: unknown } | null | undefined): boolean => {
  // `user` is read through a cast rather than a structural parameter type on purpose: the anonymous
  // plugin is not installed on the CLIENT (see auth.ts's plugin list), so `session.user` carries no
  // `isAnonymous` in its type and a structurally-typed parameter is rejected outright as a weak type.
  // The field is server-set and present at runtime; `!== true` is what makes a missing one mean
  // "a real account", which is the correct reading today and after 8c mints anonymous sessions.
  const user = s?.user as { isAnonymous?: boolean | null } | null | undefined
  return !!user && user.isAnonymous !== true
}

/** One route card living in the transcript.
 *
 *  `afterTurn` is the transcript LENGTH when the card was created, i.e. the slot it occupies between
 *  turns. Cards are held apart from `Turn[]` deliberately: a transcript is what the model is re-sent
 *  (`toWire`), and a card is a local artifact of a Routes call the model never sees.
 *
 *  ⚠ `idempotencyKey` and the in-flight guard are PER-CARD (see the header). The key is minted once
 *  per card and REUSED across retries of that same create so a lost-ACK retry dedupes server-side; a
 *  new route is a new card, and therefore a new key. */
interface PreviewItem {
  id: string
  afterTurn: number
  route: PlannedRoute
  state: PreviewCardState
  proposal: DriveProposal | null
  errorMessage?: string
  driveId?: string
}

export default function HomeScreen() {
  const router = useRouter()
  const { data: session } = useSession()
  const signedIn = isSignedIn(session)
  // Drives the offline INVERSION below (MY DRIVES first, no composer) and the reconnect self-heal.
  // Fails OPEN — an unknown verdict means online — so the degraded layout only ever appears on a
  // DEFINITE offline (see connectivity.ts).
  const isOffline = useIsOffline()

  // ── MY DRIVES (the archive) ─────────────────────────────────────────────────────────────────
  const [drives, setDrives] = useState<DriveSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // True when the /drives fetch failed but saved downloads carried us (dead-zone fallback).
  const [offline, setOffline] = useState(false)
  // Free-tier credit balance for the gentle "N free drives left" hint. Null = hidden: anonymous, paid
  // (server sends credits:null for uncapped), or an older server without the field.
  const [credits, setCredits] = useState<{ remaining: number; cap: number } | null>(null)

  // ── The conversation ────────────────────────────────────────────────────────────────────────
  const [regions, setRegions] = useState<Region[] | null>(null)
  const [regionId, setRegionId] = useState<string | null>(null)
  const [regionsFailed, setRegionsFailed] = useState(false)
  const [turns, setTurns] = useState<Turn[]>(() => resetTranscript())
  const [cards, setCards] = useState<PreviewItem[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [buf, setBuf] = useState(emptySayBuffer)
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
  const cardKeysRef = useRef<Map<string, string>>(new Map())

  // Monotonic conversation id, bumped by "Start fresh". ⚠ A SPEND CONTROL, not bookkeeping, and
  // `turnAbortRef.current?.abort()` is not enough on its own: abort() on an already-settled fetch is a
  // no-op, so a turn that resolved microseconds before the tap still runs its continuation — which
  // would stamp the whole discarded transcript back over the empty one AND fire `drawUp`, a billed
  // Google Routes call for a conversation the rider just threw away. Same shape as `loadSeq` below.
  // It also keys the transcript's bubbles, so a reused row cannot inherit the previous
  // conversation's one-shot "announced" state (see the transcript render).
  const convSeq = useRef(0)

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

  // The signature car token, parked at the trailhead (~0.12). STATIC: created once and never
  // animated. It is the screen's SOLE amber glow, and the hero collapses the moment the rider
  // speaks — which is what keeps it from colliding with a route card's amber MIN badge (DESIGN §8).
  const parkedAnim = useRef(new Animated.Value(0.12)).current

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
      setCredits(r.credits ?? null) // null for paid/uncapped (or an older server) → hint hidden
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

  useFocusEffect(
    useCallback(() => {
      navigatingRef.current = false // any in-flight nav settled (or the rider backed out)
      // ⚠ Re-reads CREDITS on the way back from sign-up, which is exactly what the disclosure on a
      // gated card needs. It must NOT re-fire the create — the rider taps once more (see doCreate).
      void load()
    }, [load]),
  )

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
    const iv = setInterval(() => setBuf((b) => tickHold(b, Date.now())), HOLD_TICK_MS)
    return () => clearInterval(iv)
  }, [sending])

  // Leaving the screen cancels the turn — a spend control, not tidiness (see turnAbortRef).
  useEffect(() => () => turnAbortRef.current?.abort(), [])

  const region = useMemo(
    () => (regionId ? (regions?.find((r) => r.id === regionId) ?? null) : null),
    [regions, regionId],
  )
  // The degraded cards' roster: this region's names when we have them, else the last good ones on
  // disk. Offline, the cache is the only source there is.
  const anchorNames = region?.exampleAnchors ?? cachedRegion?.exampleAnchors ?? []

  const patchCard = useCallback((id: string, patch: Partial<PreviewItem>) => {
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }, [])

  /** Materialize a planned route on Google Routes (billed, no credit) so the rider sees the drive
   *  before spending one. Sets the card's terminal state; never throws. */
  const doPropose = useCallback(
    async (cardId: string, route: PlannedRoute) => {
      patchCard(cardId, { state: 'proposing', proposal: null, errorMessage: undefined })
      try {
        // ⚠ INV-1: anchor IDS, verbatim, straight off the planner's route object. Nothing here
        // reconstructs an endpoint from a display string.
        const p = await proposeDrive(toProposeRequest(route))
        // ⚠ STRICT `=== 0`. `estStopCount` is nullish-able and null means UNKNOWN, not zero.
        const quiet = p.estStopCount === 0
        patchCard(cardId, { state: quiet ? 'noStops' : 'ready', proposal: p })
        if (quiet) {
          // Hand the rider back to the CONVERSATION instead of leaving them on a dead card, and tell
          // the model so it doesn't cheerfully offer the same road again — hence `wire: true`. Safe
          // under D9: "that road is quiet" is ROUTE information, not a fact about any place on it.
          setTurns((ts) => appendSkipper(ts, voice.proposal.noStopsSay, { wire: true }))
        }
      } catch (e) {
        if (e instanceof ApiError && e.needsAccount) patchCard(cardId, { state: 'needsAccount' })
        else patchCard(cardId, { state: 'error', errorMessage: errorMessage(e, voice.proposal.drawFailed) })
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
      setCards((cs) => [...cs, { id, afterTurn, route, state: 'proposing', proposal: null }])
      bumpScroll()
      void doPropose(id, route)
    },
    [bumpScroll, doPropose],
  )

  /** THE ONE CALL THAT SPENDS A CREDIT. Non-refundable, and a delete never refunds it. */
  const doCreate = useCallback(
    async (cardId: string, proposal: DriveProposal) => {
      if (creatingRef.current.has(cardId)) return // a double-tap must not double-POST
      creatingRef.current.add(cardId)
      let key = cardKeysRef.current.get(cardId)
      if (!key) {
        key = uuidV4()
        cardKeysRef.current.set(cardId, key)
      }
      patchCard(cardId, { state: 'creating', errorMessage: undefined })
      try {
        const m = await createDrive(toCreateRequest(proposal, key))
        const driveId = m.driveId
        if (driveId) {
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
        if (e instanceof ApiError && e.needsAccount) patchCard(cardId, { state: 'needsAccount' })
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
   *  line — this never appends one, so the outage retry can re-send the identical transcript. */
  const runTurn = useCallback(
    async (next: Turn[]) => {
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
      sendingRef.current = true
      setSending(true)
      setPlannerOutage(false)
      setBuf(emptySayBuffer())
      const ctrl = new AbortController()
      turnAbortRef.current = ctrl
      // Captured BEFORE the await; every write below is gated on it still being current. See convSeq.
      const seq = convSeq.current
      const isCurrent = () => convSeq.current === seq
      try {
        const resp = await planTurn(
          { turns: wire, regionId },
          {
            onDelta: (d) => setBuf((b) => pushDelta(b, d, Date.now())),
            signal: ctrl.signal,
          },
        )
        // The rider started over while this was in flight. Drop the whole turn on the floor — most of
        // all `drawUp`, which would bill Google Routes for a conversation that no longer exists.
        if (!isCurrent()) return
        // ⚠ The terminal frame is AUTHORITATIVE and its `say` may differ from the deltas — a refusal
        // REPLACES, a truncation APPENDS. `settle` assigns verbatim, which covers both without this
        // screen ever having to know which happened.
        setBuf((b) => settle(b, resp.say))
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
        setBuf(emptySayBuffer())
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
    [drawUp, regionId],
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
    void runTurn(next)
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
    void runTurn(turns)
  }, [focusComposer, runTurn, turns])

  /** "Start fresh" — back to the cold open. It must not touch MY DRIVES and must not fetch anything
   *  paid. Autofocus IS correct here: the rider explicitly asked for an empty field. */
  const startFresh = useCallback(() => {
    turnAbortRef.current?.abort()
    // ⚠ Bump BEFORE clearing state, and take over the in-flight turn's guards. The bump makes any
    // turn still in flight discard its own continuation (convSeq) — which also means its `finally`
    // will not run, so this has to be the thing that reopens the composer. Doing one without the
    // other is a screen that can never send again.
    convSeq.current += 1
    turnAbortRef.current = null
    sendingRef.current = false
    setSending(false)
    setTurns(resetTranscript())
    setCards([])
    cardKeysRef.current.clear()
    creatingRef.current.clear()
    setBuf(emptySayBuffer())
    setDone(false)
    setPlannerOutage(false)
    setInput('')
    focusComposer()
  }, [focusComposer])

  const exampleAsks: ExampleAsk[] = useMemo(
    () =>
      buildExampleAsks(anchorNames, {
        aToB: voice.plan.exampleAToB,
        aToBReply: voice.plan.exampleAToBReply,
        loop: voice.plan.exampleLoop,
        loopReply: voice.plan.exampleLoopReply,
        open: voice.plan.exampleOpen,
        openReply: voice.plan.exampleOpenReply,
      }),
    [anchorNames],
  )

  /** A tapped example chip seeds BOTH halves of an authored exchange and makes NO model call — the
   *  app's highest-traffic turn costs zero dollars. Both ride the wire (the model must see the answer
   *  it "already gave"), and the pair ends on a skipper turn so it is never sendable alone. */
  const pickExample = useCallback(
    (i: number) => {
      const ex = exampleAsks[i]
      if (!ex) return
      setTurns((ts) => seedExample(ts, ex.ask, ex.reply))
      bumpScroll()
    },
    [bumpScroll, exampleAsks],
  )

  const riderTurnCount = turns.reduce((n, t) => (t.role === 'rider' ? n + 1 : n), 0)
  const collapsed = riderTurnCount > 0 || isOffline
  const plannerDown = plannerOutage || regionsFailed
  const showExamples = riderTurnCount === 0 && !isOffline && !plannerDown && !sending

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

  // ── The hero ────────────────────────────────────────────────────────────────────────────────
  // Uncollapsed: the travel-poster masthead — a faint WPA sunburst behind the enamel kicker → the
  // big Alfa-Slab headline → the signature trail with the parked rig → tagline.
  // Collapsed: sunburst + kicker only, ≈180pt reclaimed for the conversation.
  //
  // ⚠ THE COLLAPSE IS LOAD-BEARING, not a space saving. `RouteTrack glow` is the screen's ONE amber
  // (DESIGN §8) and it must be gone before a route card's amber MIN badge — or the TypingDots —
  // appears. Collapsing on the first rider turn guarantees exactly that ordering. It is a plain
  // conditional render, deliberately un-animated: no LayoutAnimation, no Reduce-Motion question.
  const hero = (
    <View style={styles.hero}>
      <View style={styles.heroSunburst} pointerEvents="none">
        <Sunburst size={168} opacity={0.09} />
      </View>
      <Text variant="label" color="accentWarm">
        {voice.home.kicker}
      </Text>
      {collapsed ? null : (
        <>
          <Text variant="display" color="ink" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5} style={styles.heroHeadline}>
            {voice.greeting}
          </Text>
          <View style={styles.heroTrail}>
            <RouteTrack progress={parkedAnim} glow />
          </View>
          <Text variant="dim" color="inkDim">
            {voice.tagline}
          </Text>
        </>
      )}
    </View>
  )

  const renderCard = (c: PreviewItem, newest: boolean): ReactNode => {
    // ⚠ A 401 on /drives/PROPOSE leaves no proposal, and PreviewCard's account-wall state needs one
    // (its no-proposal branch is the propose-FAILED branch). That is the dominant path in step 7,
    // where `requireAccount` is still on the whole /drives* mount — so the wall is rendered here
    // instead, from primitives. It stays INLINE for the same reason the card's does: <AccountGate>
    // is a whole <Screen> and mounting it would destroy the transcript.
    // ⚠ Step 8a moves `requireAccount` per-route and opens /propose, which retires this branch.
    if (c.state === 'needsAccount' && !c.proposal) {
      return (
        <Card key={c.id} style={styles.gateCard}>
          <Text variant="label" color="accentWarm">
            {voice.proposal.kicker}
          </Text>
          <Text variant="body" color="inkDim">
            {voice.gate.body}
          </Text>
          <Button icon="ticket" title={voice.gate.action} onPress={() => router.push('/sign-in?mode=up')} />
          {/* ⚠ NEVER auto-fired on return from sign-up. The fresh account's grant does not exist
              until after signup, so the number D29 requires us to disclose does not exist at wall
              time — the rider comes back to a re-read balance and taps once more, on purpose. */}
          <Button variant="secondary" title={voice.error.retry} onPress={() => void doPropose(c.id, c.route)} />
          <Button
            variant="ghost"
            title={voice.proposal.adjust}
            onPress={() => {
              setCards((cs) => cs.filter((x) => x.id !== c.id))
              focusComposer()
            }}
          />
        </Card>
      )
    }
    return (
      <PreviewCard
        key={c.id}
        state={c.state}
        proposal={c.proposal}
        // Only the newest card instantiates a native MapView — and wears the one amber glow.
        mapEnabled={newest}
        disclosure={signedIn ? voice.proposal.costNote : voice.proposal.ownershipNote}
        errorMessage={c.errorMessage}
        ctaLabel={voice.proposal.cta}
        onMake={() => c.proposal && void doCreate(c.id, c.proposal)}
        onAdjust={focusComposer}
        onOpenDrive={() =>
          c.driveId &&
          navigateOnce(() => router.push({ pathname: '/drives/[id]', params: { id: c.driveId! } }))
        }
        onSignUp={() => router.push('/sign-in?mode=up')}
        onDismissGate={() => patchCard(c.id, { state: 'ready' })}
      />
    )
  }

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
        announceOnSettle={i === lastSkipperIdx && !sending}
      />,
    )
    for (const c of cards)
      if (c.afterTurn === i + 1) transcript.push(renderCard(c, c.id === newestCardId))
  })

  const conversation = (
    <>
      <Text variant="body" color="ink" style={styles.opening}>
        {/* An uncurated region gets the honest in-persona "not my country yet" instead of an
            invitation the skipper cannot honour. While regions are still loading it reads as the
            normal open — which it will be, for every region that has ever been curated. */}
        {region && region.exampleAnchors.length === 0
          ? voice.plan.openingUncurated
          : voice.plan.opening}
      </Text>
      {transcript}
      {sending ? (
        <>
          {buf.shown ? <TurnBubble role="skipper" text={buf.shown} streaming /> : null}
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
      {showExamples ? (
        <>
          <ExampleAsks asks={exampleAsks.map((e) => e.ask)} onPick={pickExample} />
          {/* Cold-open escape hatch, and it OUTLIVED the reason it was added: it existed because Ride
              Along needed Tahoe proximity, so a first-timer anywhere else hit "I don't know these
              roads yet." The conversation has the same wall (curated endpoints are Tahoe-only) plus an
              account at the end of it, so a one-tap permission-free clip is if anything more
              load-bearing now — it is the only thing an App Review tester 2,000 miles away can
              actually hear. Ghost, so it never competes with the composer. */}
          <Button
            variant="ghost"
            title={voice.sample.homeLink}
            onPress={() => navigateOnce(() => router.push('/sample'))}
            fullWidth={false}
          />
        </>
      ) : null}
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
  const footer = isOffline || regionsFailed ? null : done ? (
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
      placeholder={voice.plan.composerPlaceholder}
      inputRef={composerRef}
    />
  )

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
          headerLeft: () => (signedIn ? undefined : signInButton),
          headerRight: () => settingsButton,
          unstable_headerLeftItems: () =>
            signedIn ? [] : [{ type: 'custom', hidesSharedBackground: true, element: signInButton }],
          unstable_headerRightItems: () => [
            { type: 'custom', hidesSharedBackground: true, element: settingsButton },
          ],
        }}
      />

      {/* D-J: a region row appears ONLY if a second region ever ships. Above the hero, not in the
          conversation — the skipper is per-region and the choice precedes talking to him. */}
      {regions && regions.length > 1 ? (
        <View style={styles.regionRow}>
          {regions.map((r) => (
            <FilterChip
              key={r.id}
              label={r.displayName}
              active={regionId === r.id}
              onPress={() => setRegionId(r.id)}
              accessibilityLabel={`Region: ${r.displayName}`}
            />
          ))}
        </View>
      ) : null}

      {hero}

      {/* ⚠ OFFLINE INVERTS THE SCREEN. Out here MY DRIVES is not the archive, it is the product — the
          only thing on the phone that still works — so it goes FIRST and the honest "can't plan out
          here" card goes below it. The composer is absent entirely (see `footer`). */}
      {isOffline ? (
        <>
          {myDrives}
          <Divider dashed />
          <PlannerUnavailableCard reason="offline" anchorNames={anchorNames} />
        </>
      ) : (
        <>
          {conversation}
          {myDrives}
        </>
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
  regionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  hero: { paddingTop: space.sm, paddingBottom: space.sm, overflow: 'hidden' },
  heroSunburst: { position: 'absolute', top: -54, right: -38 },
  heroHeadline: { marginTop: space.sm },
  heroTrail: { marginTop: space.md, marginBottom: space.md },
  // The cold open is prose on the paper, like every other skipper turn — but it carries no speaker
  // rule: nothing has been said yet for it to be answering.
  opening: { marginTop: space.sm },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  gateCard: { gap: space.md },
  wrapUp: { gap: space.sm },
  section: { marginTop: space.lg },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md, marginBottom: space.sm },
  offlineNote: { marginBottom: space.sm },
  list: { gap: space.md },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  zeroState: { gap: space.md, alignItems: 'center', paddingVertical: space.md },
  skLine: { marginTop: space.sm },
})
