// MY DRIVES — the rider's saved drives, on their own signed-in-only screen (home cold-open declutter
// §7, founder 2026-08-03). It used to be a section at the bottom of home, where it was GUARANTEED dead
// weight for the audience most likely to be seeing it for the first time: the section rendered
// unconditionally and an anonymous rider owns nothing (`drives.user_id` needs an account; the wall is
// `POST /drives`), so a first-timer got a divider, a kicker and an empty card that could never populate.
//
// Being a sibling of `app/drives/[id]/index.tsx` is the point of the path: `/drives → /drives/[id]` is a
// real hierarchy, so the root Stack supplies the back chevron for free. ⚠ NO `app/drives/_layout.tsx` —
// the root `<Stack>` already owns `headerLeft`/`unstable_headerLeftItems`, the header colours and
// `contentStyle`; a layout here would nest a second navigator to gain nothing.
//
// Two rules govern this file, and neither is cosmetic:
//
//   1. DRIVES BELONG TO A SPECIFIC USER (§7 ruling 1). Signed out, this screen reads NOTHING off disk.
//      Home's `load()` does — deliberately, as its dead-zone fallback — but this screen must not, or the
//      sign-out purge's premise (no surface lists a departed account's downloads) is false again the
//      moment a second account signs in on the same phone. ⚠ The CATCH branch still reads disk: that is
//      the pre-existing cross-account offline exposure §7 raises, left exactly as it is on purpose. It
//      wants its own decision and is explicitly out of this change's scope.
//
//   2. NOTHING HERE NAVIGATES HOME. `router.replace('/')` REMOUNTS home, and home's unmount aborts an
//      in-flight BILLED `/drives/plan` turn and destroys the only copy of the transcript that exists
//      anywhere (D10 — the planner is stateless, there is no `conversations` table). No line in this
//      file may replace the root route; the way back is `router.back()` and the header chevron.
import { useCallback, useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Stack, useFocusEffect, useRouter } from 'expo-router'
import { errorMessage, listDrives, type DriveSummary } from '@/lib/api'
import { isSignedIn, useSession } from '@/lib/auth'
import { useIsOffline } from '@/lib/connectivity'
import { listDownloadedDrives } from '@/lib/offline'
import { space } from '@/theme/tokens'
import {
  DriveCard,
  DriveCardSkeleton,
  Screen,
  ScreenList,
  SkeletonGroup,
  StateView,
  Text,
  voice,
} from '@/ui'

/** 'My Drives', not 'Drives': the child screen's title is 'Drive', and a back chevron reading
 *  Drive → Drives is a confusing adjacent pair. It also states rule 1 above in the chrome. One const,
 *  reused by the header and by every `StateView` title so the three degraded states cannot drift. */
const TITLE = 'My Drives'

/** ⚠ A MODULE CONSTANT, not an inline `options={{ title }}` literal. A fresh options object forces a
 *  navigator-wide re-render plus a native-stack header re-commit, synchronously before paint, on every
 *  render of this screen — the step-1 finding in `docs/designs/chat-render-performance.md`. Shared by
 *  the list and its skeleton so the two cannot disagree about the title. */
const SCREEN_OPTIONS = { title: TITLE } as const

/** FlatList identity. Module-level so it is stable without a hook. */
const keyOfDrive = (dr: DriveSummary) => dr.driveId

/** Show the remaining-drives hint only at or below this balance. Not derived from the server's grant
 *  amount on purpose: the rider's grant is FROZEN at signup while the server default moves, so a
 *  ratio ("show under 10%") would mean different things to two riders on the same screen. An absolute
 *  count is the thing a rider can act on — it answers "should I be careful?", which a percentage of a
 *  number they never saw does not.
 *  ⚠ This moved here WITH the section it belongs to. `app/index.tsx` must not keep a copy — one home,
 *  or the two drift silently and nothing fails. */
const CREDIT_HINT_THRESHOLD = 5

/** ⚠ OWED TO `src/ui/voice.ts` (three keys under the existing `empty` group: `drives`, `drivesAction`,
 *  `drivesSignedOut`). They sit here only because `voice.ts` was being edited concurrently when this
 *  screen landed and the shared-tree rule says leave a mixed file to its owner — lift them and delete
 *  this block. `drives` is a VERBATIM move of the literal that lived in home's zero state; do not
 *  re-author it while lifting, or the move hides a rewrite. Every other string on this screen already
 *  comes from `voice`, which is where they all belong. */
const OWED_VOICE = {
  drives: 'No drives yet. Plan one and it lands here for the road.',
  drivesAction: 'Plan a drive',
  drivesSignedOut:
    'Your drives ride with your ticket, friend. Grab one and they’ll be waiting right here.',
} as const

export default function MyDrivesScreen() {
  const router = useRouter()
  // ⚠ `isPending` is load-bearing, not defensive. Without it a cold `skipper://drives` deep link
  // flashes the signed-out state at a signed-in rider for the frames before /get-session settles —
  // and it is the same fact that makes a redirect unsafe (see the signed-out branch).
  const { data: session, isPending } = useSession()
  // ⚠ INV-9 — a truthy `session` is NOT signed in: every rider carries an anonymous one after D16's
  // mint, and an anonymous rider owns nothing. Never inline `!!session`.
  const signedIn = isSignedIn(session)
  // Only for the reconnect self-heal below. This is the screen a rider stares at in a dead zone, so
  // the loads that failed out here re-run the moment the bars come back.
  const isOffline = useIsOffline()

  const [drives, setDrives] = useState<DriveSummary[]>([])
  // Free credit balance for the gentle "N free drives left" hint. Null = hidden, and there are only
  // two ways to get there: no account (no gated call is made at all) or a server old enough to predate
  // the field. There is no uncapped case to hide for — premium is credits, not a plan.
  const [credits, setCredits] = useState<{ remaining: number; cap: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // True when the /drives fetch failed but saved downloads carried us (dead-zone fallback).
  const [offline, setOffline] = useState(false)

  // Monotonic request id: the focus load, the reconnect self-heal and a Better Auth `$sessionSignal`
  // refetch all share the same network edge and can fire in one moment. Without this the SLOWER of two
  // overlapping loads wins and can stamp a stale list — or a stale error — over a good one.
  const loadSeq = useRef(0)

  // Navigation in-flight guard: expo-router does NOT de-dupe identical pushes, so a fast double-tap on
  // a card stacks two identical detail screens. Set on the first push, cleared on refocus.
  const navigatingRef = useRef(false)
  const navigateOnce = useCallback((go: () => void) => {
    if (navigatingRef.current) return
    navigatingRef.current = true
    go()
  }, [])

  // ⚠ BOTH OF THESE ARE HOOKS AND THEY LIVE UP HERE ON PURPOSE, far from the list that reads them:
  // five early returns sit between this line and the render, and a hook below any of them is a
  // rules-of-hooks error. (`react-hooks` caught three of exactly this in the render-performance pass.)
  //
  // ⚠ And they must be STABLE, not merely tidy: `DriveCard` is memoized, so a freshly-built `onPress`
  // would bust the memo on every render and the memo would silently do nothing — the trap that has now
  // bitten TranscriptCard, Composer and StopList in turn.
  const onPressDrive = useCallback(
    (driveId: string) => {
      navigateOnce(() => router.push({ pathname: '/drives/[id]', params: { id: driveId } }))
    },
    [navigateOnce, router],
  )
  const renderDriveCard = useCallback(
    (dr: DriveSummary) => <DriveCard drive={dr} onPress={onPressDrive} />,
    [onPressDrive],
  )

  const reload = useCallback(async () => {
    const seq = ++loadSeq.current
    const isCurrent = () => loadSeq.current === seq
    setError(null)
    if (!signedIn) {
      // ⚠ NO `listDownloadedDrives()` here, and that omission IS rule 1. Home reads disk on this
      // branch; this screen showing a departed account's saved drives is exactly what the sign-out
      // purge exists to make impossible. Clearing the rows also means a session dying under the rider
      // cannot leave the previous account's list on screen.
      setDrives([])
      setCredits(null)
      setOffline(false)
      setLoading(false)
      return
    }
    // Safe to raise unconditionally: the skeleton branch is gated on an EMPTY list, so on a focus
    // refetch this changes nothing on screen — it only means "silhouettes on a cold open", and it is
    // what stops the empty state flashing in the frame after the session resolves to signed-in.
    setLoading(true)
    try {
      const r = await listDrives()
      if (!isCurrent()) return
      setDrives(r.drives)
      setCredits(r.credits ?? null) // null only against a server predating the field → hint hidden
      setOffline(false)
    } catch (e) {
      if (!isCurrent()) return
      // Offline-first: in a dead zone the list fetch fails — fall back to the drives saved on disk so
      // they stay reachable rather than a blank error wall. (See rule 1's ⚠: this branch is the
      // pre-existing exposure, untouched by design.)
      const saved = listDownloadedDrives()
      if (saved.length > 0) {
        setDrives(saved)
        setOffline(true)
      } else {
        // `errorMessage` maps an OfflineError to "No signal out here", so a dead-zone failure with
        // nothing saved speaks plainly instead of offering a retry that cannot work.
        setError(errorMessage(e, voice.error.generic))
      }
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [signedIn])

  // FOCUS, not mount, and both halves matter: a drive deleted on the detail screen must fall out of
  // this list on the way back, and a return from sign-up must repopulate it.
  useFocusEffect(
    useCallback(() => {
      navigatingRef.current = false // any in-flight nav settled (or the rider backed out)
      void reload()
    }, [reload]),
  )

  // Self-heal on the offline→online edge, guarded on the TRANSITION rather than on `!isOffline` so it
  // never doubles up with the focus load above.
  const wasOffline = useRef(false)
  useEffect(() => {
    if (wasOffline.current && !isOffline) void reload()
    wasOffline.current = isOffline
  }, [isOffline, reload])

  // ⚠ `router.back()`, NEVER `router.replace('/')` — see rule 2 in the header. `unstable_settings`
  // anchors `index` under a cold deep link, so `canGoBack` is true on every real path; the guard is
  // the belt to that brace.
  const goBackToPlanner = useCallback(() => {
    if (router.canGoBack()) router.back()
  }, [router])

  // ── 1 · SESSION UNKNOWN — silhouettes, never the signed-out state (see `isPending` above). ──────
  if (isPending) return <DrivesSkeleton />

  // ── 2 · SIGNED OUT ──────────────────────────────────────────────────────────────────────────────
  // ⚠ Unreachable on the main path — the entry point is a header button home renders only when
  // signedIn. It exists for the `skipper://drives` deep link and for a session dying under a mounted
  // screen (expiry, a 401 clearing Better Auth). Do not delete it as dead code.
  //
  // It NAVIGATES NOTHING, which is the whole argument: it cannot remount home, cannot abort a billed
  // planner turn, cannot bin the transcript. Evaluated live rather than latched, so a session that dies
  // under the rider takes the previous account's rows off screen without a navigation.
  //
  // ⚠ Deliberately NOT `AccountGate`: its copy is the freemium SELL in front of something being
  // withheld, and nothing is withheld here — the rider owns nothing yet. It would also overwrite this
  // screen's title, and firing `wall_shown` from a deep-linked archive would pollute the numerator of
  // the funnel's most important rate. So: no event, and no new `WallSource` member.
  if (!signedIn)
    return (
      <StateView
        title={TITLE}
        message={OWED_VOICE.drivesSignedOut}
        action={{
          label: voice.gate.action,
          onPress: () => navigateOnce(() => router.push('/sign-in?mode=up')),
        }}
      />
    )

  // ── 3 · LOADING ─────────────────────────────────────────────────────────────────────────────────
  // Gated on the empty list so a focus refetch never blanks a list the rider is already reading.
  if (loading && drives.length === 0) return <DrivesSkeleton />

  // ── 4 · ERROR — the fetch failed AND nothing was on disk. ────────────────────────────────────────
  // `StateView` pushes the message to VoiceOver on `tone="danger"` (iOS honours no live region), which
  // home's inline error branch never did.
  if (error)
    return (
      <StateView
        title={TITLE}
        message={error}
        tone="danger"
        action={{ label: voice.error.retry, onPress: () => void reload() }}
      />
    )

  // ── 5 · EMPTY ───────────────────────────────────────────────────────────────────────────────────
  if (drives.length === 0)
    return (
      <StateView
        title={TITLE}
        message={OWED_VOICE.drives}
        action={{ label: OWED_VOICE.drivesAction, onPress: goBackToPlanner }}
      />
    )

  // ── 6 · THE LIST ────────────────────────────────────────────────────────────────────────────────
  // The offline fallback is not a seventh state — it is this one with `offline === true`.
  //
  // ⚠ VIRTUALIZED (`ScreenList`), unlike home's offline branch, and the asymmetry is deliberate: this
  // screen OWNS its scrolling, so only the rows on screen are built; home's copy is a section inside
  // home's own ScrollView, where nesting a VirtualizedList is an error. The card itself is shared
  // (`src/ui/DriveList.tsx`) precisely so that difference stays a scrolling detail and never becomes a
  // second card that drifts — which is what it was before.
  //
  // ⚠ This list is UNBOUNDED — one row per drive the rider has ever made — which is why it is the one
  // list in the app that virtualizes. Do not "simplify" it back to a mapped column inside <Screen>.

  // The credit hint, on its OWN full-width line. It used to share a row with the "MY DRIVES" kicker;
  // that kicker is gone (the native header title replaces it), and a lone element beats a paired row
  // here for the reason §10/§14 settled elsewhere — a pair squeezes at AX Dynamic Type sizes and this
  // screen is uncapped. Deliberately SILENT until the balance is actually low: with a generous
  // allotment an always-on counter hangs a meter on a charm-first screen to report a wall roughly a
  // decade away. It reappears with enough runway to matter, which is the only moment it informs
  // anything. ⚠ It renders ONLY here — `credits` is set by a successful `listDrives()` and nothing
  // else, and a credit cannot be spent offline anyway.
  const creditHint =
    credits && credits.remaining <= CREDIT_HINT_THRESHOLD ? (
      <Text variant="label" color="inkFaint">
        {credits.remaining > 0
          ? `${credits.remaining} free ${credits.remaining === 1 ? 'drive' : 'drives'} left`
          : 'No free drives left'}
      </Text>
    ) : null

  const offlineNote = offline ? (
    <Text variant="dim" color="inkFaint">
      {voice.offline.home}
    </Text>
  ) : null

  // ⚠ NULL when neither applies, never an empty <View>. The content container's `gap` spaces the
  // header off the first card, so a zero-height header would still hang an unexplained band of air at
  // the top of the list.
  const header =
    creditHint || offlineNote ? (
      <View style={styles.header}>
        {creditHint}
        {offlineNote}
      </View>
    ) : null

  return (
    <>
      <Stack.Screen options={SCREEN_OPTIONS} />
      <ScreenList
        data={drives}
        keyExtractor={keyOfDrive}
        renderItem={renderDriveCard}
        ListHeaderComponent={header}
        padded
        contentContainerStyle={styles.body}
      />
    </>
  )
}

/** The list's silhouette. ⚠ A SkeletonGroup, not `StateView loading` — a spinner is a downgrade from a
 *  silhouette that reveals in place, and it is the house pattern for this list (home) and for the drive
 *  detail. Two cards: enough to read as "a list is coming", few enough not to promise a count. */
function DrivesSkeleton() {
  return (
    // ⚠ Still a plain <Screen>, NOT <ScreenList>: two silhouettes never overflow, so virtualizing
    // them would buy nothing and cost a list shell around a fixed pair.
    <Screen scroll padded contentContainerStyle={styles.body}>
      <Stack.Screen options={SCREEN_OPTIONS} />
      <SkeletonGroup accessibilityLabel={voice.loading.drives} style={styles.list}>
        <DriveCardSkeleton />
        <DriveCardSkeleton />
      </SkeletonGroup>
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: { gap: space.md },
  header: { gap: space.md },
  list: { gap: space.md },
})
