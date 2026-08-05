// The cold open's action list: the three suggestion rows the rider can tap instead of facing an
// empty field, and the LISTEN row that sits above them (home-cold-open-declutter §14).
//
// PRESENTATION ONLY, the same boundary `ExampleAsks` states: these render two strings and report a
// tap. They do not build copy, do not know that a suggestion seeds an authored ask/reply pair with
// no model call, and never touch the transcript. Copy arrives as props so `voice.ts` stays its one
// home — which is also what keeps §9's generic-copy invariant (a row never names a place) enforced
// at the authoring site rather than here.
//
// TWO EXPORTS OVER ONE PRIVATE `Row` (the Skeleton/SkeletonGroup precedent). §14 asks for "distinct
// skin, same row geometry": the shell owns the geometry, the a11y contract and the text column, so
// the two CANNOT drift apart; the skin is passed in. Two exports rather than one component with a
// `variant` because the prop surfaces genuinely differ (a kicker the ask rows must never pass, an
// icon the listen row must never pass) — one component would ship four conditionally-valid props,
// which is the same failure §5 diagnosed when a selector chip was handed prose.
//
// ⚠ NOT built on `Card`, despite the borders being a deliberate echo of it (`rule` + hairline →
// `accent` + keyline, so the two stay coherent): `Card`'s `onPress` path emits
// `accessibilityState={{ selected: active }}`, which would announce the listen row as "selected".
// Nothing here is selectable — a tap is spent the moment it lands.
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { hit, radius, space } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'
import { Icon, type IconName } from './Icon'
import { Text } from './Text'

// The leading mark, square badge and round disc alike. 40 sits inside the row's `hit.min` floor
// with the vertical padding to spare, and is the largest mark that still leaves the TITLE the
// widest thing on the row — the mark is the row's category, not its subject.
const MARK_SIZE = 40

interface RowProps {
  /** The leading badge/disc. Built by the caller because only it knows the skin; the shell places it. */
  mark: ReactNode
  /** Listen-row only. Sits above the title, and is deliberately ABSENT from `accessibilityLabel`. */
  kicker?: string
  title: string
  subtitle: string
  trailing?: ReactNode
  borderWidth: number
  borderColor: string
  onPress: () => void
  accessibilityLabel: string
  accessibilityHint?: string
}

/** Geometry, press behaviour and the a11y contract — everything §14 requires the two rows to share. */
function Row({
  mark,
  kicker,
  title,
  subtitle,
  trailing,
  borderWidth,
  borderColor,
  onPress,
  accessibilityLabel,
  accessibilityHint,
}: RowProps) {
  const { colors } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      // ⚠ NO `hitSlop`, and that is deliberate rather than an omission. The row clears the 48pt
      // in-car floor unaided (the mark alone is 40 inside 2 × space.md), and these rows STACK —
      // slop would push each row's touch region into its neighbour's and let z-order decide which
      // suggestion a boundary tap seeds. `ExampleAsks` already paid for exactly that bug and its
      // 24pt gap is the fix; a stacked list should not have to re-derive it.
      // ⚠ No `accessibilityState` either: a suggestion is an ACTION, so there is nothing to
      // announce as selected and nothing to deselect (StopRow carries the same note for the
      // read-only case).
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: colors.surfaceRaised, borderWidth, borderColor },
        pressed && styles.pressed,
      ]}
    >
      {mark}
      <View style={styles.body}>
        {kicker ? (
          <Text variant="label" color="accentWarm">
            {kicker}
          </Text>
        ) : null}
        {/* No `numberOfLines` anywhere in this file: home is a scrollable, non-driving surface, so
            DESIGN §8 leaves it UNCAPPED through the AX sizes. The titles are short verbs that only
            wrap at the accessibility sizes — exactly where clipping them would cost the most. */}
        <Text variant="bodyStrong" color="ink">
          {title}
        </Text>
        <Text variant="dim" color="inkDim">
          {subtitle}
        </Text>
      </View>
      {trailing}
    </Pressable>
  )
}

export interface SuggestionRowProps {
  /** A short VERB in the RIDER's voice, addressed to the skipper (§14's POV rule — "Let the skipper
   *  pick", never "Let me pick", which reads as the rider picking and contradicts the subtitle). */
  title: string
  /** The literal utterance the tap seeds. It carries the specificity, so the title never has to. */
  subtitle: string
  icon: IconName
  onPress: () => void
  accessibilityHint?: string
}

export function SuggestionRow({
  title,
  subtitle,
  icon,
  onPress,
  accessibilityHint,
}: SuggestionRowProps) {
  const { colors } = useTheme()
  return (
    <Row
      mark={
        // ⚠ A SUNKEN well + pine glyph, not a filled pine badge — a deliberate deviation from §14's
        // "three filled badges" parenthetical, for the reason §14 itself gives two lines later. With
        // the listen disc also pine, four solid pine marks would leave the listen row distinguished
        // by SHAPE alone, and §14 is emphatic it "must never read as a fourth suggestion". Weight
        // carries the distinction instead, and it costs nothing from the pine budget §14 flags.
        // One-line flip to the literal reading if the device pass disagrees: `surfaceSunken` →
        // `accent`, and the glyph `accent` → `onPrimary`.
        // ⚠ `Badge` cannot supply this: it takes a `glyph: string` rendered through `Glyph` (the
        // system font), not an `IconName` — so reusing it would force an emoji, and this build has
        // no colour-emoji fallback (they come out as tofu).
        // ⚠ S3 (design §13): a FILLED enamel disc, not a sunken square. The square read as a form
        // field's leading affordance; the disc reads as a travel badge, which is the charm S3 was
        // chosen to put back. `accent` fill + `onPrimary` glyph is the system's contrast-safe pine
        // pairing — the same one `Badge`'s pine tone and `FilterChip`'s active state use.
        // ⚠ These discs are the screen's pine load; the region chip stays QUIET to keep it in budget.
        <View style={[styles.mark, styles.askMark, { backgroundColor: colors.accent }]}>
          <Icon name={icon} size={20} color="onPrimary" />
        </View>
      }
      title={title}
      subtitle={subtitle}
      trailing={<Icon name="chevronRight" size={16} color="inkFaint" />}
      borderWidth={StyleSheet.hairlineWidth}
      borderColor={colors.rule}
      onPress={onPress}
      // The comma is StopRow's precedent — VoiceOver reads it as the pause that separates the ask
      // from the sentence it will send.
      accessibilityLabel={`${title}, ${subtitle}`}
      accessibilityHint={accessibilityHint}
    />
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    minHeight: hit.min, // minHeight, not height — survives Dynamic Type (StopRow's rule)
  },
  body: { flex: 1, gap: 1 }, // StopRow's deliberate 1pt column gap (off-grid; a grid step is too loose)
  mark: { width: MARK_SIZE, height: MARK_SIZE, alignItems: 'center', justifyContent: 'center' },
  askMark: { borderRadius: radius.pill },
  pressed: { opacity: 0.7 },
})
