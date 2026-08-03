// The home cold open's region affordance: a quiet pill naming the region the skipper is pinned to.
//
// ⚠ NO TRAILING ATLAS RULE, and it was removed on purpose (founder, 2026-08-03). §13's S1 put a
// dashed rule running off the chip to the right edge so the chip would not look lonely. It cost four
// failed fixes — `Divider dashed` paints via `borderTopWidth` and a border-only View in a ROW renders
// nothing, which I misread twice as layout and once as contrast before proving it with a temporary
// coloured box. The pill skin gives the chip its own presence, so the rule was buying little for what
// it cost. ⚠ The underlying trap is still live for anyone else: do not put `Divider dashed` in a row.
//
// ⚠ THE DESIGN DOC NAMES `FilterChip` FOR THIS (§10 R3, §15 step 1) AND THAT IS THE ONE CALL NOT
// FOLLOWED. `FilterChip`'s own header states the condition that makes it the wrong host: it carries
// no caret *because* "a tap SELECTS directly (no picker opens)", and it defers the picker-trigger
// job to the START/END `PickerField`s — a control 1.1 deleted, so the system's picker-trigger slot
// is a vacancy, not a filled one. Hosting this there would need `onPress` optional (N=1 is not
// pressable), `accessibilityRole` inverted, `accessibilityState={{selected}}` announced on a thing
// with no selection, a second inverted palette sharing zero colour decisions with the toggle, and —
// the disqualifier — it would keep `wrap`, i.e. `numberOfLines`, the exact footgun §16.6 wants
// structurally absent here. The founder's §14.1 call was about WEIGHT (surfaceRaised fill, rule
// hairline, ink label, accent caret, NOT the pine outline); that weight is reproduced below
// verbatim. Only the host file differs.
//
// ⚠ At 1.1 Tahoe is the only region, so the PRESSABLE skin below never renders until region 2 —
// what ships is glyph + name + rule. Judge the pill on a seeded second region, not on launch.
import { Pressable, StyleSheet, View } from 'react-native'
import { radius, space } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'
import { Icon } from './Icon'
import { Text } from './Text'

export interface RegionChipProps {
  /** Display name of the CURRENT region, or null when none is loaded (`regionsFailed`, or a cold
   *  first launch whose `/regions` call failed). Nullable is the §16.8 guard: the type forces every
   *  caller through the degraded path, so a half-interpolated "Region: undefined" cannot exist.
   *  ⚠ A NAME, not the `Region` DTO — two region shapes reach home (`Region` from `@skipper/shared`
   *  and `CachedRegion` from `src/lib/region-cache.ts`) and a `src/ui` primitive has no business
   *  knowing either wire type. The screen interpolates; this renders. */
  regionName: string | null
  /** Omit when there is only ONE region: the chip renders as a plain, non-pressable label — no
   *  fill, no border, no caret. A dead dropdown at launch is worse than no affordance (§10). */
  onPress?: () => void
}

export function RegionChip({ regionName, onPress }: RegionChipProps) {
  const { colors } = useTheme()
  // Nothing true to say, so say nothing — and the dashed rule goes with it in the SAME return. The
  // rule is meaningless without a marker to leave from, and owning both here means the degraded
  // state is one branch instead of a condition the screen has to keep in sync with this one.
  // ⚠ Screen-side counterpart: whatever anchors the Sunburst behind this row must not collapse to
  // zero height when this renders nothing.
  if (regionName === null) return null

  // Names the field, not just the value — VoiceOver reading a bare "Lake Tahoe" in the middle of a
  // conversation screen says nothing about what it is. Same string the dormant chip row used, so
  // the announcement does not change when that row is deleted.
  const a11yLabel = `Region: ${regionName}`

  return (
    <View style={styles.row}>
      {onPress ? (
        <Pressable
          onPress={onPress}
          // The `label` line box plus `space.sm` of vertical padding lands in the low 30s — under
          // §8's 48pt floor, so the slop is load-bearing, not polish. 12 is `FilterChip`'s
          // precedent and clears the floor with room. ⚠ Unlike `ExampleAsks`, no gap arithmetic is
          // owed against it: §10 cut the paired kicker, so this chip has no tappable neighbour
          // whose touch region it could overlap and hand to z-order.
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={a11yLabel}
          accessibilityHint="Choose a different region"
          // ⚠ No `accessibilityState`. A picker TRIGGER has neither `selected` (nothing here is one
          // of a set) nor `expanded` (the sheet is a separate surface, not this element's subtree).
          style={({ pressed }) => [
            styles.mark,
            styles.pill,
            { backgroundColor: colors.surfaceRaised, borderColor: colors.rule },
            pressed && styles.pressed,
          ]}
        >
          <RegionMark regionName={regionName} />
          {/* The chip spends its one pine here rather than on the glyph: the caret IS the
              affordance, and §14 flagged the screen's total pine load (listen keyline, three row
              badges, the send disc) as the thing the quiet chip exists to keep in budget. */}
          <Icon name="expand" size={14} color="accent" />
        </Pressable>
      ) : (
        // ⚠ THE PILL SKIN IS WORN IN BOTH STATES — only the CARET and the press behaviour are
        // conditional. The approved design shows a quiet pill, and rendering bare text at one region
        // made the screen look unlike it for the only configuration that ships today. What must not
        // appear without a picker behind it is the CARET, which is the thing that promises one.
        // `accessible` groups glyph and name so the field name is read once; no role, because a label
        // that does nothing must not announce itself as a button.
        <View
          style={[
            styles.mark,
            styles.pill,
            { backgroundColor: colors.surfaceRaised, borderColor: colors.rule },
          ]}
          accessible
          accessibilityLabel={a11yLabel}
        >
          <RegionMark regionName={regionName} />
        </View>
      )}
    </View>
  )
}

/** The enamel glyph + the name — identical in both states, so the pill is a skin over the badge
 *  rather than a second rendering of it. */
function RegionMark({ regionName }: { regionName: string }) {
  return (
    <>
      {/* Decorative (Icon is already hidden from the a11y tree). `inkDim`, not pine — see the
          caret's note on the pine budget. */}
      <Icon name="region" size={16} color="inkDim" />
      {/* ⚠ NO `numberOfLines`, and no `style` prop on this component for a caller to smuggle one in
          through: home is a scrollable, non-driving surface and is therefore UNCAPPED through the AX
          Dynamic Type sizes (§8), while the region name is a server fact of arbitrary length.
          Clamping would truncate it for exactly the riders who need it largest.
          Device-pass fallback if `label`'s tracked uppercase reads too timid, or reads badly on a
          real multi-word region name: `bodyStrong` + `ink`. Not `body`/`heading` — that lands the
          chip at CTA weight and re-breaks §14's "quiet". */}
      <Text variant="label" color="ink" style={styles.name}>
        {regionName}
      </Text>
    </>
  )
}

const styles = StyleSheet.create({
  // ⚠ `flexShrink`, not a width: at AX sizes a long region name would otherwise hold its intrinsic
  // width and push past the screen edge. Shrinking lets it wrap inside the pill instead.
  // ⚠ `alignSelf: 'flex-start'` on the row is what keeps the pill hugging its content — without it
  // the row stretches and the pill becomes a full-width bar.
  row: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' },
  mark: { flexDirection: 'row', alignItems: 'center', gap: space.xs, flexShrink: 1 },
  name: { flexShrink: 1 },
  // No `alignSelf` (FilterChip needs it because it lands in COLUMN containers that would stretch
  // it full-width; this one's container is a row it owns).
  pill: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    // Hairline, not `border.keyline` — the quiet weight is the whole point of §14.1, and this is
    // the same physical hairline `Divider` draws, so the chip sits in the same system.
    borderWidth: StyleSheet.hairlineWidth,
  },
  pressed: { opacity: 0.7 },
})
