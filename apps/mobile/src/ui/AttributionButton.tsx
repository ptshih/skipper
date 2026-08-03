// The unified attribution affordance — the ONE way source credit surfaces, identical on the drive
// player and the anonymous sample. A quiet ⓘ that, on tap, reveals
// THIS clip's specific source(s): the work (article link) + license (deed link) + a note that the
// telling is adapted. That specific-work credit is what CC BY-SA / CC BY require wherever the
// adapted work is presented — a general Settings catalog names the platform ("Wikipedia"), not the
// article, so it doesn't satisfy the obligation on its own; this does.
//
// It reads the clip's frozen `attribution` snapshot, which both the drive manifest (so it works
// offline) already carries — so every surface is ONE code path and one look, not
// two surfaces that can drift. Renders NOTHING when a clip has no attribution (scenic/break ground
// on no source text, so an empty ⓘ would be a lie).
import { useState } from 'react'
import { Modal, Pressable, StyleSheet } from 'react-native'
import type { Attribution } from '@skipper/shared'
import { border, radius, space } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'
import { Icon } from './Icon'
import { SourceCredit } from './SourceCredit'
import { Text } from './Text'
import { voice } from './voice'

export interface AttributionButtonProps {
  /** The clip's frozen attribution array. Undefined/empty renders nothing. */
  items?: Attribution[]
}

export function AttributionButton({ items }: AttributionButtonProps) {
  const [open, setOpen] = useState(false)
  const { colors } = useTheme()
  if (!items?.length) return null
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={voice.attribution.open}
        // A 48pt-floor tap target around an 18pt glyph — the ⓘ sits in a tight header row, so the
        // slop is symmetric and generous rather than pushing neighbours.
        // ⚠ space.lg, NOT space.md: the icon is 18pt, so 12 each side reached only 42 — under 00a78's
        // 48pt floor, on the control that opens the CC BY-SA credit. That one is a licence obligation,
        // not a nicety, so it is the last affordance that should be hard to hit. 18 + 200d716 = 50.
        hitSlop={{ top: space.lg, bottom: space.lg, left: space.lg, right: space.lg }}
      >
        <Icon name="info" size={18} color="inkFaint" />
      </Pressable>
      {/* A quiet bottom sheet — glanceable, dismissed by the scrim or Done. `onRequestClose` wires
          the Android back button. Tapping the sheet itself is swallowed so only the scrim closes. */}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          style={[styles.scrim, { backgroundColor: colors.scrim }]}
          onPress={() => setOpen(false)}
          accessibilityRole="button"
          accessibilityLabel={voice.attribution.close}
        >
          <Pressable
            style={[styles.sheet, { backgroundColor: colors.surfaceRaised, borderColor: colors.rule }]}
            onPress={() => {}}
          >
            <Text variant="label" color="accentWarm">
              {voice.attribution.heading}
            </Text>
            <Text variant="dim" color="inkDim">
              {voice.attribution.adapted}
            </Text>
            <SourceCredit items={items} />
            <Pressable
              onPress={() => setOpen(false)}
              accessibilityRole="button"
              hitSlop={{ top: space.sm, bottom: space.sm }}
              style={styles.close}
            >
              <Text variant="bodyStrong" color="accent">
                {voice.attribution.close}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  // The scrim fills the screen and anchors the sheet to the bottom (a thumb-reachable card while
  // parked). Padding keeps the sheet off the edges.
  scrim: { flex: 1, justifyContent: 'flex-end', padding: space.lg },
  sheet: { borderRadius: radius.lg, borderWidth: border.keyline, padding: space.lg, gap: space.sm },
  close: { alignSelf: 'flex-end', marginTop: space.xs },
})
