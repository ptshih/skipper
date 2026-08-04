// The route itinerary — ONE raised card of StopRows separated by hairline rules (the carved
// "route panel"). Shared by the drive-detail screen AND the in-drive player so the stop UX is
// identical on both. Rows carry per-stop state on the player (active / passed); the detail
// passes none (all upcoming). The active row reads as a SUNKEN well inside this raised card
// (see StopRow), so the single-card treatment works in every context.
//
// Two layouts:
//   • default — the card sizes to its rows (the host screen scrolls). Drive detail.
//   • scroll  — the card is a FIXED shell (the caller gives it flex:1); only the rows scroll,
//               inside it, clipped to the rounded corners. The in-drive player, so all four
//               corners stay put while the itinerary scrolls.
import { Fragment, memo, useCallback, useEffect, useRef } from 'react'
import { PixelRatio, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { space } from '../theme/tokens'
import { Card } from './Card'
import { Divider } from './Divider'
import { EdgeFade } from './EdgeFade'
import type { IconName } from './Icon'
import { STOP_ROW_EDGE, STOP_ROW_HEIGHT, STOP_ROW_INSET, StopRow, type StopState } from './StopRow'
import { Text } from './Text'
import { useScrollEdgeFades } from './useScrollEdgeFades'

export interface StopListItem {
  seq: number
  name: string
  /** Trailing meta — clip length, prefixed by the stop type when it isn't a story (see StopRow). */
  meta?: string
  /** The spoken twin of `meta` (screen readers). */
  metaLabel?: string
  icon?: IconName
  state?: StopState
}

/** How long after a rider's drag the list still counts as "being browsed" and refuses to follow. */
const BROWSE_GRACE_MS = 5000

export interface StopListProps {
  items: StopListItem[]
  /** Optional header label inside the card, aligned to the rows (e.g. "3 of 8 stops"). */
  title?: string
  /** Optional trailing half of that header, right-aligned on the meta line (e.g. the SIM tag).
   *  Separate from `title` rather than concatenated so it lands in the meta column. */
  titleRight?: string
  /** Tap a row to jump there (preview only); omit for a read-only itinerary. */
  onPressItem?: (seq: number) => void
  /** Drive-complete beat: passed rows "stamp" their check in, staggered down the list. */
  enterStamp?: boolean
  /** Fixed-shell mode: rows scroll inside the card (caller gives the card flex:1). */
  scroll?: boolean
  /**
   * Keep this row in view as the drive moves down the itinerary (`scroll` mode; -1 to follow
   * nothing). The list scrolls ITSELF for it.
   *
   * ⚠ THE SCROLL LIVES HERE BECAUSE THE FADES DO. The player used to hold a ref into this
   * ScrollView and scroll it from outside, which split one behaviour across two components: the
   * screen moved the list, this component measured it, and a programmatic scroll delivers no
   * `onScroll` — so the edge fades froze at the last DRAG and lied about the clipping for the rest
   * of the drive. One owner, one expression (`noteScrollTo` returns the offset it records), and the
   * browsing suppression below travels with it because it is the same behaviour.
   */
  followRow?: number
  style?: StyleProp<ViewStyle>
}

function StopListBase({
  items,
  title,
  titleRight,
  onPressItem,
  enterStamp,
  scroll,
  followRow = -1,
  style,
}: StopListProps) {
  // Stable per-seq onPress so the memoized StopRow only re-renders rows whose props actually change
  // (e.g. state), not every row on every parent render. The cached handler reads the latest
  // onPressItem via a ref, so it stays referentially stable across renders. (audit #621)
  // Measured unconditionally (the hook is cheap and gating STATE on a prop would report a stale
  // geometry on the first frame after a flip) but only consumed in `scroll` mode.
  const fades = useScrollEdgeFades(scroll)
  const scrollRef = useRef<ScrollView | null>(null)

  // ── Follow the drive, without fighting the rider ────────────────────────────────────────────
  // Don't yank the list back while the rider is browsing the itinerary: a drag marks browsing live,
  // and it stays live for a grace window after they let go, so a stop transition mid-browse cannot
  // snatch the list away. Following resumes at the next transition once they have settled.
  const userBrowsing = useRef(false)
  const browseGrace = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onScrollBeginDrag = useCallback(() => {
    userBrowsing.current = true
    if (browseGrace.current) clearTimeout(browseGrace.current)
  }, [])
  const onScrollSettled = useCallback(() => {
    if (browseGrace.current) clearTimeout(browseGrace.current)
    browseGrace.current = setTimeout(() => {
      userBrowsing.current = false
    }, BROWSE_GRACE_MS)
  }, [])
  useEffect(
    () => () => {
      if (browseGrace.current) clearTimeout(browseGrace.current)
    },
    [],
  )

  // ⚠ Keyed on the ROW NUMBER, never on the items array: that array is rebuilt on every audio tick
  // (twice a second for a whole drive) and re-firing this scroll pinned the list to the car. It
  // moves only when the focused stop actually changes.
  // `PixelRatio.getFontScale()` because STOP_ROW_HEIGHT is a minHeight that grows with Dynamic Type,
  // so a fixed row height would undershoot the target for a rider on large text.
  const { noteScrollTo } = fades
  useEffect(() => {
    if (!scroll || followRow < 0 || userBrowsing.current) return
    const rowH = STOP_ROW_HEIGHT * PixelRatio.getFontScale()
    // One expression decides where this lands AND tells the fades — the split that broke it.
    const y = noteScrollTo(Math.max(0, (followRow - 1) * rowH))
    scrollRef.current?.scrollTo({ y, animated: true })
  }, [followRow, noteScrollTo, scroll])

  const onPressRef = useRef(onPressItem)
  // The mirror IS the point (see above). An effect would land after paint, so a row tapped in that
  // window would call the previous render's onPressItem.
  // eslint-disable-next-line react-hooks/refs
  onPressRef.current = onPressItem
  const handlers = useRef(new Map<number, () => void>()).current
  const handlerFor = (seq: number): (() => void) => {
    let h = handlers.get(seq)
    if (!h) {
      h = () => onPressRef.current?.(seq)
      handlers.set(seq, h)
    }
    return h
  }

  const rows = items.map((it, i) => (
    <Fragment key={it.seq}>
      {i > 0 ? <Divider style={styles.rule} /> : null}
      <StopRow
        name={it.name}
        meta={it.meta}
        metaLabel={it.metaLabel}
        icon={it.icon}
        state={it.state}
        onPress={onPressItem ? handlerFor(it.seq) : undefined}
        enterStamp={!!enterStamp && it.state === 'passed'}
        stampDelayMs={i * 80}
      />
    </Fragment>
  ))

  return (
    <Card style={[styles.card, scroll && styles.cardScroll, style]}>
      {title ? (
        // The card's header: ONE tight row, and NO rule under it. It aligns to the rows beneath it
        // rather than to the card's own padding — label on the glyph line, `titleRight` on the meta
        // line — so it reads as the top of the list instead of a band sitting on it. ⚠ A rule here
        // has now been tried and rejected TWICE (founder, 2026-08-03: full-bleed first, then a
        // hairline inset to the rows' own line — "looked better without the border"). Alignment is
        // doing the work a rule would; the header belongs to the list rather than fencing it off.
        // Fixed above the rows in `scroll` mode (it labels the card, not the scroll content) and
        // supplying its own padding, since the fixed shell drops the card's.
        <View style={styles.head}>
          <Text variant="label" color="inkFaint">
            {title}
          </Text>
          {titleRight ? (
            <Text variant="label" color="inkFaint">
              {titleRight}
            </Text>
          ) : null}
        </View>
      ) : null}
      {scroll ? (
        // overflow:hidden on the card clips the scrolling rows to the rounded corners; this
        // ScrollView fills the fixed shell so only the rows move.
        //
        // ⚠ The fades are not decoration here. The indicator is hidden (below), so a clipped row
        // at the card's edge was the ONLY overflow cue — and a row sliced mid-glyph at a hard
        // rounded edge reads as a rendering fault, not as "scroll for more". `useScrollEdgeFades`
        // is the shared measurement, so a fade appears only where content is genuinely clipped;
        // `on="raised"` because this list scrolls inside the placard, not on the app surface.
        <View style={styles.scrollWrap}>
          <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            // The default scroll indicator renders as a stark white bar on the cream card — hide
            // it; the edge fades carry "there's more" instead.
            showsVerticalScrollIndicator={false}
            {...fades.scrollProps}
            onScrollBeginDrag={onScrollBeginDrag}
            onScrollEndDrag={onScrollSettled}
            onMomentumScrollEnd={onScrollSettled}
          >
            {rows}
          </ScrollView>
          <EdgeFade
            on="raised"
            height={space.xl}
            top={fades.showTopFade}
            bottom={fades.showBottomFade}
          />
        </View>
      ) : (
        rows
      )}
    </Card>
  )
}

const styles = StyleSheet.create({
  // No horizontal padding — StopRows carry their own; the title + rules inset to match.
  card: { paddingHorizontal: 0, paddingVertical: space.sm },
  // Fixed shell: drop the card's own vertical padding (the scroll content supplies it) and
  // clip the scrolling rows to the rounded rect so the corners stay crisp.
  cardScroll: { paddingVertical: 0, overflow: 'hidden' },
  // Relatively-positioned so the EdgeFade strips overlay the scroll viewport's own edges.
  scrollWrap: { flex: 1 },
  scroll: { flex: 1 },
  // flexGrow so the rows own the card's full height even when there are only two of them — the same
  // rule the screen shells follow (founder, 2026-08-04: every scrollable view). Never flex:1, which
  // would cap the content at one viewport and stop a long itinerary scrolling.
  scrollContent: { flexGrow: 1, paddingVertical: space.sm },
  // Aligned to the ROWS (STOP_ROW_INSET / STOP_ROW_EDGE), not to the card — see the header comment.
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingLeft: STOP_ROW_INSET,
    paddingRight: STOP_ROW_EDGE,
    paddingTop: space.md,
    paddingBottom: space.xs, // tight to the first row — the scroll content supplies the rest
  },
  rule: { marginHorizontal: space.md },
})

/** ⚠ MEMOIZED. The player subscribes to expo-audio's status, so its screen re-renders every 500 ms
 *  for the whole of a drive — and this list's contents only change when the car actually reaches a
 *  stop. `StopRow` was already memoized, so the ROWS bailed out, but the list still rebuilt its
 *  element tree on every one of those ticks.
 *
 *  ⚠ SO THE CALLER MUST PASS A STABLE `items`. It was a fresh `.map()` inline at the player's call
 *  site, which would have defeated this comparator completely and silently — see `stopListItems`
 *  there. The scroll handlers are already `useCallback`s; keep them that way. */
export const StopList = memo(StopListBase)
