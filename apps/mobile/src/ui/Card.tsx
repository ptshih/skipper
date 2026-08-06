// The ranger placard. Plain by default (glanceable). `framed` adds the carved
// double-keyline + corner screw-dots — reserve that ornament for NON-driving
// surfaces (detail headers, empty states), never dense list rows.
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { border, radius, space } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'

/**
 * Where a card sits in a flush, SEGMENTED run — one placard split into rows (an inset-grouped table)
 * rather than a column of separate cards with air between them.
 *
 * ⚠ The run's skin lives HERE, on the card, and not in either list that draws one. It has to: MY DRIVES
 * virtualizes through `<ScreenList>` (a FlatList, which can only style rows and separators — there is no
 * element wrapping the run to hang a border on), while home's offline branch is a plain mapped column.
 * Neither can own the geometry without the other growing a second copy, which is the exact drift
 * `DriveList.tsx` was created to end.
 */
export type CardSegment = 'first' | 'middle' | 'last' | 'only'

/**
 * The ONE expression turning a row's place in a run into its segment. Both drive surfaces call it, so
 * they cannot disagree about which corners round — the failure mode being a filter that shortens one
 * list and leaves a middle row wearing the bottom of the group.
 */
export function cardSegment(index: number, total: number): CardSegment {
  if (total <= 1) return 'only'
  if (index === 0) return 'first'
  if (index === total - 1) return 'last'
  return 'middle'
}

/**
 * The rule BETWEEN two segments — hand it to `ItemSeparatorComponent`, or render it between mapped
 * rows. ⚠ It carries the run's side borders itself: the segments' left/right hairlines stop at each
 * row's edge, so without them the group's outline would break open at every seam. The rule inside is
 * inset to `space.md`, matching `StopList`'s itinerary so the two tables read as one system.
 */
export function CardSegmentRule() {
  const { colors } = useTheme()
  return (
    <View
      style={[
        styles.segmentRule,
        { backgroundColor: colors.surfaceRaised, borderColor: colors.rule },
      ]}
    >
      <View style={[styles.segmentRuleLine, { backgroundColor: colors.rule }]} />
    </View>
  )
}

/** Per-corner radii + which edges draw, for one row of a run. A middle row draws neither horizontal
 *  edge: its top is the previous rule and its bottom is the next one. */
function segmentGeometry(segment: CardSegment): ViewStyle {
  const top = segment === 'first' || segment === 'only'
  const bottom = segment === 'last' || segment === 'only'
  return {
    borderRadius: 0,
    borderTopLeftRadius: top ? radius.lg : 0,
    borderTopRightRadius: top ? radius.lg : 0,
    borderBottomLeftRadius: bottom ? radius.lg : 0,
    borderBottomRightRadius: bottom ? radius.lg : 0,
    borderTopWidth: top ? StyleSheet.hairlineWidth : 0,
    borderBottomWidth: bottom ? StyleSheet.hairlineWidth : 0,
  }
}

export interface CardProps {
  children: ReactNode
  framed?: boolean
  active?: boolean
  /** Render as one row of a flush segmented run instead of a standalone placard. */
  segment?: CardSegment
  onPress?: () => void
  style?: StyleProp<ViewStyle>
}

export function Card({ children, framed, active, segment, onPress, style }: CardProps) {
  const theme = useTheme()
  const { colors } = theme

  const base: ViewStyle = {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: active ? colors.accent : colors.rule,
    padding: space.lg,
    // ⚠ AFTER the uniform `borderWidth`/`borderRadius` above, never before — RN resolves the specific
    // edge over the shorthand only in that order, and reversing it silently restores all four sides.
    ...(segment ? segmentGeometry(segment) : null),
  }

  const inner = (
    <View style={[base, active && { borderWidth: border.keyline }, style]}>
      {framed ? (
        <>
          <View
            pointerEvents="none"
            style={[styles.keyline, { borderColor: colors.keyline, borderRadius: radius.lg - 4 }]}
          />
          <View
            pointerEvents="none"
            style={[styles.screw, styles.screwTL, { backgroundColor: colors.rule }]}
          />
          <View
            pointerEvents="none"
            style={[styles.screw, styles.screwBR, { backgroundColor: colors.rule }]}
          />
        </>
      ) : null}
      {children}
    </View>
  )

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        // `active` doubles as the selected state (e.g. the region picker's chosen row) so a
        // screen reader announces it, not just the pine border. Undefined on plain cards =
        // no selected state announced.
        accessibilityState={{ selected: active }}
        style={({ pressed }) => pressed && styles.pressed}
      >
        {inner}
      </Pressable>
    )
  }
  return inner
}

const styles = StyleSheet.create({
  keyline: {
    position: 'absolute',
    top: 5,
    left: 5,
    right: 5,
    bottom: 5,
    borderWidth: StyleSheet.hairlineWidth,
  },
  screw: { position: 'absolute', width: 4, height: 4, borderRadius: 2, opacity: 0.7 },
  screwTL: { top: 9, left: 9 },
  screwBR: { bottom: 9, right: 9 },
  pressed: { opacity: 0.9 },
  // Continues the run's outline across the seam — see `CardSegmentRule`.
  segmentRule: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  segmentRuleLine: { height: StyleSheet.hairlineWidth, marginHorizontal: space.md },
})
