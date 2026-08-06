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
import {
  filterDrivesByRegion,
  initialRegionFilter,
  regionFacets,
  shouldOfferRegionFilter,
} from '@/lib/drive-filter'
import { readCachedRegion } from '@/lib/region-cache'
import { useLatestRun } from '@/lib/useLatestRun'
import { useNavigateOnce } from '@/lib/useNavigateOnce'
import { isSignedIn, useSession } from '@/lib/auth'
import { useIsOffline } from '@/lib/connectivity'
import { listDownloadedDrives } from '@/lib/offline'
import { space } from '@/theme/tokens'
import {
  cardSegment,
  CardSegmentRule,
  CreditHint,
  DriveCard,
  DriveCardSkeleton,
  FilterChip,
  hasCreditHint,
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
  // Which region the list is scoped to; null = ALL. Server-derived per drive and never stored
  // (`DriveSummary.region`), so this is pure presentation — no request carries it.
  const [regionFilter, setRegionFilter] = useState<string | null>(null)
  // ⚠ Has the RIDER chosen, as opposed to the screen defaulting for them? Without this, the focus
  // refetch below would silently undo their choice every time they came back from a drive — this
  // screen reloads on FOCUS, not mount, so that is the common path, not an edge case.
  const filterTouched = useRef(false)
  // True when the /drives fetch failed but saved downloads carried us (dead-zone fallback).
  const [offline, setOffline] = useState(false)

  // ⚠ THE FILTERED ROWS, DERIVED ONCE AND UP HERE — the list renders them and `renderDriveCard` needs
  // their COUNT to know where the segmented run ends, and that callback is a hook that must sit above
  // the early returns (see the note below). Deriving it a second time down at the render would be the
  // repo's most-repeated bug shape: two copies of "the same" set, free to drift. The region control's
  // reasoning lives with `facets`, further down.
  const visible = filterDrivesByRegion(drives, regionFilter)
  const visibleCount = visible.length

  // Monotonic request id: the focus load, the reconnect self-heal and a Better Auth `$sessionSignal`
  // refetch all share the same network edge and can fire in one moment. Without this the SLOWER of two
  // overlapping loads wins and can stamp a stale list — or a stale error — over a good one.
  const beginReload = useLatestRun()

  // The double-push guard, and its release on refocus (src/lib/useNavigateOnce).
  const navigateOnce = useNavigateOnce()

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
  // ⚠ `visibleCount`, NOT `drives.length`: the region filter is what decides how long this run is, and
  // reading the unfiltered total would leave the last VISIBLE row wearing a middle row's square bottom
  // — the one corner nobody looks at until it is wrong. It is also why the count is threaded through a
  // ref-free dependency: the segment must be recomputed when a chip changes the length, not only when
  // the rows change.
  const renderDriveCard = useCallback(
    (dr: DriveSummary, i: number) => (
      <DriveCard drive={dr} onPress={onPressDrive} segment={cardSegment(i, visibleCount)} />
    ),
    [onPressDrive, visibleCount],
  )

  // Keep the filter honest against whatever rows just arrived. Both branches exist for ONE reason —
  // this screen must never show an empty list to a rider who owns drives:
  //   · untouched → default from their cached region chip, but ONLY if they have drives there
  //     (`initialRegionFilter`); a chip pointing somewhere they have never driven falls back to All.
  //   · touched → keep their choice, unless that region stopped appearing (they just deleted the last
  //     drive in it on the detail screen and came back), in which case fall back to All.
  // Together these make "filtered to empty" unreachable: every non-null value is a facet id, and a
  // facet exists only because at least one drive produced it.
  const reconcileRegionFilter = useCallback((rows: readonly DriveSummary[]) => {
    const facets = regionFacets(rows)
    if (!filterTouched.current) {
      setRegionFilter(initialRegionFilter(facets, readCachedRegion()?.regionId ?? null))
      return
    }
    setRegionFilter((cur) => (cur && facets.some((f) => f.id === cur) ? cur : null))
  }, [])

  const reload = useCallback(async () => {
    const isCurrent = beginReload()
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
      reconcileRegionFilter(r.drives)
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
        // ⚠ The dead-zone list gets the same reconciliation, and it matters MORE here: a summary
        // saved before `region` existed carries none, so these often produce no facets at all —
        // which must land on ALL (everything visible), never on a stale region that hides the lot.
        reconcileRegionFilter(saved)
        setOffline(true)
      } else {
        // `errorMessage` maps an OfflineError to "No signal out here", so a dead-zone failure with
        // nothing saved speaks plainly instead of offering a retry that cannot work.
        setError(errorMessage(e, voice.error.generic))
      }
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [beginReload, signedIn, reconcileRegionFilter])

  // FOCUS, not mount, and both halves matter: a drive deleted on the detail screen must fall out of
  // this list on the way back, and a return from sign-up must repopulate it.
  useFocusEffect(
    useCallback(() => {
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
        message={voice.empty.drivesSignedOut}
        action={{
          label: voice.gate.action,
          onPress: () => navigateOnce(() => router.push('/sign-in')),
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
        message={voice.empty.drives}
        action={{ label: voice.empty.drivesAction, onPress: goBackToPlanner }}
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
  // screen is uncapped. ⚠ It renders ONLY here — `credits` is set by a successful `listDrives()` and
  // nothing else, and a credit cannot be spent offline anyway. The threshold and the sentence both
  // live in `<CreditHint>`; this screen and home used to carry a copy each.
  const offlineNote = offline ? (
    <Text variant="dim" color="inkFaint">
      {voice.offline.home}
    </Text>
  ) : null

  // ⚠ NULL when neither applies, never an empty <View>. `styles.header`'s own `marginBottom` spaces
  // the header off the first card, so a zero-height header would still hang an unexplained band of air
  // at the top of the list. ⚠ `hasCreditHint` rather than a re-derived `remaining <= 5`: it is the same
  // expression `<CreditHint>` acts on, so this test cannot fall out of step with what renders.
  // The region scope control. ⚠ IT APPEARS ONLY WHEN IT CAN DO SOMETHING — two or more regions among
  // these drives (`shouldOfferRegionFilter`). That is what keeps it invisible at a single region
  // rather than parking a permanently useless control at the top of the list, and it means this rung
  // needed no "wait for the second region" flag: the condition IS the gate.
  //
  // ⚠ EVERY region present gets a chip, plus ALL. So nothing is ever hidden without a visible way
  // back to it — the §4.2 requirement that a 1:1 filter must never be the only view. A drive with no
  // region (outside every released bbox, or an offline summary predating the field) has no chip of
  // its own by design and lives under ALL.
  const facets = regionFacets(drives)
  const chooseRegion = (id: string | null) => {
    filterTouched.current = true
    setRegionFilter(id)
  }
  const filterRow = shouldOfferRegionFilter(facets) ? (
    <View style={styles.filterRow}>
      <FilterChip
        label={voice.filter.allRegions}
        accessibilityLabel={voice.filter.allRegionsA11y}
        active={regionFilter === null}
        onPress={() => chooseRegion(null)}
      />
      {facets.map((f) => (
        <FilterChip
          key={f.id}
          label={f.displayName}
          active={regionFilter === f.id}
          onPress={() => chooseRegion(f.id)}
        />
      ))}
    </View>
  ) : null

  const header =
    hasCreditHint(credits) || offlineNote || filterRow ? (
      <View style={styles.header}>
        <CreditHint credits={credits} />
        {offlineNote}
        {filterRow}
      </View>
    ) : null

  return (
    <>
      <Stack.Screen options={SCREEN_OPTIONS} />
      <ScreenList
        data={visible}
        keyExtractor={keyOfDrive}
        renderItem={renderDriveCard}
        ListHeaderComponent={header}
        ItemSeparatorComponent={CardSegmentRule}
        padded
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
    <Screen scroll padded>
      <Stack.Screen options={SCREEN_OPTIONS} />
      {/* ⚠ NO gap between the two silhouettes — it mirrors the flush list below, and a skeleton whose
          rhythm disagrees with the real rows reveals as a jump. Same reason they carry SEGMENTS and a
          rule between them: a pair of separate rounded cards resolving into one segmented run is that
          jump, just in the corners instead of the spacing. */}
      <SkeletonGroup accessibilityLabel={voice.loading.drives}>
        <DriveCardSkeleton segment="first" />
        <CardSegmentRule />
        <DriveCardSkeleton segment="last" />
      </SkeletonGroup>
    </Screen>
  )
}

// ⚠ THE LIST HAS NO ROW GAP (founder, 2026-08-05): the cards stack flush, so the rhythm is carried by
// each card's own padding and keyline rather than by air between them. That is why the header owns the
// space beneath ITSELF (`header.marginBottom`) — a `gap` on the content container would space the
// header correctly and put the air straight back between every pair of cards.
const styles = StyleSheet.create({
  // ⚠ WRAPS, and it is not decorative: one chip per region present, and each carries a real region's
  // display name at the AX Dynamic Type sizes this uncapped screen supports. A single row would push
  // the later regions off the edge exactly for the riders reading largest.
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  header: { gap: space.md, marginBottom: space.md },
})
