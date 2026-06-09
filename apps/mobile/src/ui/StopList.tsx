// The route itinerary — ONE raised card of StopRows separated by hairline rules (the carved
// "route panel"). Shared by the tour-detail screen AND the in-drive player so the stop UX is
// identical on both. Rows carry per-stop state on the player (active / passed); the detail
// passes none (all upcoming). The active row reads as a SUNKEN well inside this raised card
// (see StopRow), so the single-card treatment works in every context.
//
// Two layouts:
//   • default — the card sizes to its rows (the host screen scrolls). Tour detail.
//   • scroll  — the card is a FIXED shell (the caller gives it flex:1); only the rows scroll,
//               inside it, clipped to the rounded corners. The in-drive player, so all four
//               corners stay put while the itinerary scrolls.
import { Fragment, type Ref } from 'react'
import {
  ScrollView,
  StyleSheet,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { space } from '../theme/tokens'
import { Card } from './Card'
import { Divider } from './Divider'
import type { IconName } from './Icon'
import { StopRow, type StopState } from './StopRow'
import { Text } from './Text'

export interface StopListItem {
  seq: number
  name: string
  sublabel?: string
  icon?: IconName
  state?: StopState
}

type ScrollHandler = (e: NativeSyntheticEvent<NativeScrollEvent>) => void

export interface StopListProps {
  items: StopListItem[]
  /** Optional section label inside the card (e.g. "THE ROUTE · 10 STOPS"). */
  title?: string
  /** Tap a row to jump there (preview only); omit for a read-only itinerary. */
  onPressItem?: (seq: number) => void
  /** Drive-complete beat: passed rows "stamp" their check in, staggered down the list. */
  enterStamp?: boolean
  /** Fixed-shell mode: rows scroll inside the card (caller gives the card flex:1). */
  scroll?: boolean
  scrollRef?: Ref<ScrollView>
  onScrollBeginDrag?: ScrollHandler
  onScrollEndDrag?: ScrollHandler
  onMomentumScrollEnd?: ScrollHandler
  style?: StyleProp<ViewStyle>
}

export function StopList({
  items,
  title,
  onPressItem,
  enterStamp,
  scroll,
  scrollRef,
  onScrollBeginDrag,
  onScrollEndDrag,
  onMomentumScrollEnd,
  style,
}: StopListProps) {
  const rows = items.map((it, i) => (
    <Fragment key={it.seq}>
      {i > 0 ? <Divider style={styles.rule} /> : null}
      <StopRow
        name={it.name}
        sublabel={it.sublabel}
        icon={it.icon}
        state={it.state}
        onPress={onPressItem ? () => onPressItem(it.seq) : undefined}
        enterStamp={!!enterStamp && it.state === 'passed'}
        stampDelayMs={i * 80}
      />
    </Fragment>
  ))

  return (
    <Card style={[styles.card, scroll && styles.cardScroll, style]}>
      {title ? (
        <Text variant="label" color="inkFaint" style={styles.title}>
          {title}
        </Text>
      ) : null}
      {scroll ? (
        // overflow:hidden on the card clips the scrolling rows to the rounded corners; this
        // ScrollView fills the fixed shell so only the rows move.
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          onScrollBeginDrag={onScrollBeginDrag}
          onScrollEndDrag={onScrollEndDrag}
          onMomentumScrollEnd={onMomentumScrollEnd}
        >
          {rows}
        </ScrollView>
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
  scroll: { flex: 1 },
  scrollContent: { paddingVertical: space.sm },
  title: { paddingHorizontal: space.md, marginBottom: space.xs },
  rule: { marginHorizontal: space.md },
})
