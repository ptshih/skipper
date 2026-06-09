// The route itinerary — ONE raised card of StopRows separated by hairline rules (the carved
// "route panel"). Shared by the tour-detail screen AND the in-drive player so the stop UX is
// identical on both. Rows carry per-stop state on the player (active / passed); the detail
// passes none (all upcoming). The active row reads as a SUNKEN well inside this raised card
// (see StopRow), so the single-card treatment works in every context.
import { Fragment } from 'react'
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
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

export interface StopListProps {
  items: StopListItem[]
  /** Optional section label inside the card (e.g. "THE ROUTE · 10 STOPS"). */
  title?: string
  /** Tap a row to jump there (preview only); omit for a read-only itinerary. */
  onPressItem?: (seq: number) => void
  /** Drive-complete beat: passed rows "stamp" their check in, staggered down the list. */
  enterStamp?: boolean
  style?: StyleProp<ViewStyle>
}

export function StopList({ items, title, onPressItem, enterStamp, style }: StopListProps) {
  return (
    <Card style={[styles.card, style]}>
      {title ? (
        <Text variant="label" color="inkFaint" style={styles.title}>
          {title}
        </Text>
      ) : null}
      {items.map((it, i) => (
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
      ))}
    </Card>
  )
}

const styles = StyleSheet.create({
  // No horizontal padding — StopRows carry their own; the title + rules inset to match.
  card: { paddingHorizontal: 0, paddingVertical: space.sm },
  title: { paddingHorizontal: space.md, marginBottom: space.xs },
  rule: { marginHorizontal: space.md },
})
