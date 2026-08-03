// The region sheet behind the home chip — the picker `RegionChip`'s caret promises.
//
// A bottom sheet rather than an inline row, and that is the whole reason this file exists: a wrapped
// row of chips was the shape the cold-open redesign removed, and it re-creates itself the moment a
// fourth region ships. A sheet costs one tap and scales to any N.
//
// ⚠ Deliberately a near-clone of `AttributionButton`'s local Modal (scrim + bottom card + swallowed
// inner press + `onRequestClose` for the Android back button) rather than a new shared primitive.
// There are now two sheets in the app; a third is the point at which extracting one is justified, and
// inventing the abstraction on the second would be guessing at what they have in common.
//
// ⚠ It renders the CURRENT selection with a check, not a filled row: this is a list of places the
// skipper knows, and a filled row reads as "active" in a design system where fill means a pressed
// enamel control (FilterChip). The check says "this is the one" without borrowing that meaning.
import { Modal, Pressable, StyleSheet } from 'react-native'
import { border, hit, radius, space } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'
import { Icon } from './Icon'
import { Text } from './Text'
import { voice } from './voice'

/** Just enough of a region to name and identify it — never the bbox, never the anchors. */
export interface PickableRegion {
  id: string
  displayName: string
}

export interface RegionPickerProps {
  visible: boolean
  regions: readonly PickableRegion[]
  /** The region the conversation is currently pinned to, or null before one is chosen. */
  selectedId: string | null
  /** Called with the chosen id. The screen closes the sheet; this component never assumes it. */
  onSelect: (id: string) => void
  onClose: () => void
}

export function RegionPicker({ visible, regions, selectedId, onSelect, onClose }: RegionPickerProps) {
  const { colors } = useTheme()
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={[styles.scrim, { backgroundColor: colors.scrim }]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={voice.region.close}
      >
        {/* Swallowed so only the scrim dismisses — a tap that lands on the sheet must never close it
            out from under a thumb reaching for a row. */}
        <Pressable
          style={[styles.sheet, { backgroundColor: colors.surfaceRaised, borderColor: colors.rule }]}
          onPress={() => {}}
        >
          <Text variant="label" color="accentWarm">
            {voice.region.heading}
          </Text>
          {regions.map((r) => {
            const selected = r.id === selectedId
            return (
              <Pressable
                key={r.id}
                onPress={() => onSelect(r.id)}
                accessibilityRole="button"
                // ⚠ `selected`, not a label suffix: a screen reader announces the state itself, so
                // baking "current" into the name would make VoiceOver say it twice.
                accessibilityState={{ selected }}
                accessibilityLabel={r.displayName}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                {/* Uncapped on purpose — a region name is a server string of unbounded length and
                    this sheet is a scrollable, non-driving surface, so it may wrap at AX sizes. */}
                <Text variant="body" color="ink" style={styles.name}>
                  {r.displayName}
                </Text>
                {selected ? <Icon name="passed" size={18} color="accent" /> : null}
              </Pressable>
            )
          })}
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            hitSlop={{ top: space.sm, bottom: space.sm }}
            style={styles.close}
          >
            <Text variant="bodyStrong" color="accent">
              {voice.region.close}
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  // Bottom-anchored: thumb-reachable while parked, and the same place the attribution sheet appears,
  // so the app has one answer to "where do sheets come from".
  scrim: { flex: 1, justifyContent: 'flex-end', padding: space.lg },
  sheet: { borderRadius: radius.lg, borderWidth: border.keyline, padding: space.lg, gap: space.xs },
  // `hit.min` as a real minHeight rather than hitSlop: these rows are stacked and adjacent, so slop
  // would overlap its neighbours and hand a near-miss to the wrong region.
  row: {
    minHeight: hit.min,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  name: { flex: 1 },
  pressed: { opacity: 0.7 },
  close: { alignSelf: 'flex-end', marginTop: space.xs },
})
