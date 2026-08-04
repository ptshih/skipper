// A Screen whose scrolling is owned by a FlatList, so only the rows actually on screen are built.
//
// ⚠ NOT a `virtualized` flag on <Screen>, and not a style preference: Screen's scroll path IS a
// ScrollView, and a VirtualizedList may not nest inside one. They are two shells by construction. This
// is the same call the barrel already records for `ConversationScreen` — a specialised shell beside
// Screen rather than another flag on it.
//
// What it must reproduce, because these are Screen's rules and a list that quietly loses one looks
// broken rather than different:
//
//   · THE BOTTOM SAFE-AREA INSET RIDES THE CONTENT, NEVER THE FRAME. A frame `paddingBottom` turns the
//     home-indicator strip into an opaque dead band the content cannot scroll under, which CLIPS the
//     last row at that line. So the list fills to the physical bottom edge and the inset becomes
//     content padding, added to the base pad so it never shrinks it.
//   · The standard gutter when `padded`.
//   · Overflow-aware edge fades from the SHARED `useScrollEdgeFades` — the same hook Screen and
//     ConversationScreen use, so a slack or throttle fix still lands in exactly one place.
//
// The prop surface is deliberately narrower than Screen's (no `center`, no `edges`, no `fadeEdges`):
// there is one caller today and an unused prop is a maintenance claim nobody is making. Widen it when
// a second surface needs it, not before.
import type { ReactElement } from 'react'
import { FlatList, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { space } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'
import { EdgeFade } from './EdgeFade'
import { useScrollEdgeFades } from './useScrollEdgeFades'

export interface ScreenListProps<T> {
  data: readonly T[]
  /** Takes the item directly rather than FlatList's `{ item }` wrapper — the call sites read better
   *  and nothing here needs the index or the separators. ⚠ Returns a single ELEMENT (or null), not a
   *  ReactNode: that is FlatList's own contract for a row, not a narrowing invented here. */
  renderItem: (item: T) => ReactElement | null
  keyExtractor: (item: T) => string
  /** Rides above the first row and scrolls with it. Spaced by `contentContainerStyle`'s gap like any
   *  other row, so a header cannot drift out of the list's rhythm. */
  ListHeaderComponent?: ReactElement | null
  padded?: boolean
  contentContainerStyle?: StyleProp<ViewStyle>
}

export function ScreenList<T>({
  data,
  renderItem,
  keyExtractor,
  ListHeaderComponent,
  padded,
  contentContainerStyle,
}: ScreenListProps<T>) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const bg = { backgroundColor: theme.colors.surface }
  const { showTopFade, showBottomFade, onScroll, onLayout, onContentSizeChange } =
    useScrollEdgeFades()

  const baseBottom = padded ? space.gutter : 0

  return (
    <SafeAreaView edges={SIDE_EDGES} style={[styles.flex, bg]}>
      {/* Relative wrapper so the EdgeFade strips overlay the scroll viewport's top/bottom edges. */}
      <View style={styles.flex}>
        <FlatList
          data={data as T[]}
          renderItem={({ item }) => renderItem(item)}
          keyExtractor={keyExtractor}
          ListHeaderComponent={ListHeaderComponent}
          contentContainerStyle={[
            padded && styles.padded,
            { paddingBottom: baseBottom + insets.bottom },
            contentContainerStyle,
          ]}
          onLayout={onLayout}
          onContentSizeChange={onContentSizeChange}
          onScroll={onScroll}
          scrollEventThrottle={16}
          // ⛔ PINNED OFF ON PURPOSE. Android defaults this to true, and the prior art
          // (chat-render-performance's ⛔ section) shipped it and pulled it one commit later: it
          // remounts variable-height rows when they are yanked back into view. Drive labels are
          // uncapped Dynamic Type, so these rows ARE variable-height. iOS already defaults to false;
          // this only stops the two platforms disagreeing about it silently.
          removeClippedSubviews={false}
        />
        {/* Each fade mounts only when its edge is genuinely clipped, so a short list shows none. */}
        {showTopFade || showBottomFade ? (
          <EdgeFade top={showTopFade} bottom={showBottomFade} />
        ) : null}
      </View>
    </SafeAreaView>
  )
}

/** Screen's default edges minus 'bottom' — the bottom inset rides the content instead (see above). */
const SIDE_EDGES = ['left', 'right'] as const

const styles = StyleSheet.create({
  flex: { flex: 1 },
  padded: { padding: space.gutter },
})
