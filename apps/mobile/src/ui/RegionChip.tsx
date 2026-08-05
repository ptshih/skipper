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
// ⚠ "THE PRESSABLE SKIN NEVER RENDERS UNTIL REGION 2" IS WHAT THIS COMMENT USED TO SAY, AND IT WAS
// WRONG THE DAY IT WAS WRITTEN — it cost a real breakage (founder, 2026-08-03). `GET /regions` serves
// STAGED regions to an admin (`canPreview`, apps/api/src/index.ts), so with a second region merely
// SEEDED the signed-in founder gets a list of two, home's `rs.length === 1` auto-select declines to
// fire, and nothing is selected. The screen that produced was not "a chip without a caret" — it was no
// chip at all, no example asks, and a permanently disabled composer (`sending={sending || !regionId}`),
// with no way back. Hence the UNSELECTED state below: a null name is only silent when there is also no
// picker to open. Judge this on a seeded second region — which, if one is seeded, is what you have.
import { Pressable, StyleSheet, View } from 'react-native'
import { radius, space } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'
import { Icon, type IconName } from './Icon'
import { Text } from './Text'
import { voice } from './voice'

export interface RegionChipProps {
  /** Display name of the CURRENT region, or null when there is none — which covers TWO unlike reads,
   *  and conflating them is what broke this once: nothing LOADED (`regionsFailed`, or a cold first
   *  launch whose `/regions` never landed), versus a list that loaded fine and nothing is PICKED yet
   *  (more than one region came back, so home's auto-select declined). `onPress` is what tells them
   *  apart here — see the branch order below. Nullable is the §16.8 guard: the type forces every
   *  caller through the degraded path, so a half-interpolated "Region: undefined" cannot exist.
   *  ⚠ A NAME, not the `Region` DTO — two region shapes reach home (`Region` from `@skipper/shared`
   *  and `CachedRegion` from `src/lib/region-cache.ts`) and a `src/ui` primitive has no business
   *  knowing either wire type. The screen interpolates; this renders. */
  regionName: string | null
  /** Omit when there is only ONE region: the chip renders as a plain, non-pressable label — no
   *  caret. A dead dropdown at launch is worse than no affordance (§10).
   *  ⚠ PASS IT WHENEVER A LIST EXISTS, including before anything is picked — with a null name this is
   *  the ONLY control that can reach the sheet, and without it the screen has no region, no example
   *  asks and a disabled composer. Gate it on "are there regions", never on "is one selected". */
  onPress?: () => void
  /**
   * Render the picker-TRIGGER weight instead of the quiet status pill.
   *
   * ⚠ OPT-IN, AND IT MUST STAY THAT WAY. §14.1's "quiet" is a real budget decision for HOME, where
   * this chip is ambient status sitting above three pine suggestion discs and a pine send disc — it
   * is deliberately the thing that does NOT spend accent weight there. On onboarding the same control
   * has the opposite job: it is the ANSWER to the only question the screen asks, twelve points under
   * the words "Where are we driving?", so a chip that whispers is a form field nobody fills in
   * (founder, 2026-08-04: "the region selection cta needs to be bigger and more noticeable").
   *
   * ⚠ THIS IS THE VACANCY THE HEADER ABOVE NAMES. 1.1 deleted the START/END `PickerField`s and with
   * them the system's picker-trigger slot; that is why the job had nowhere to live and this control
   * was being asked to do it at status weight. Prominent fills the slot rather than inventing a
   * second component.
   *
   * ⚠ It keeps the pill SKIN — `surfaceRaised` fill plus a hairline rule — and grows only its
   * measurements and its type. Reaching for an accent outline would make it a twin of the outlined
   * `Button` directly beneath it, and two identical-looking controls stacked is a worse legibility
   * problem than a quiet one. Bigger, not louder.
   */
  prominent?: boolean
  /** A leading glyph — `map` reads as "a place selector" before the word is parsed, which is the
   *  cheapest way to add noticeability without spending accent FILL. ⚠ It costs one more pine mark on
   *  home, whose §14 budget is the reason this chip is quiet in the first place; weigh it against the
   *  three suggestion discs and the send disc already there. */
  leadingIcon?: IconName
}

export function RegionChip({ regionName, onPress, prominent, leadingIcon }: RegionChipProps) {
  const { colors } = useTheme()

  // ⚠ THE PRESSABLE BRANCH IS TESTED FIRST, AND ON `onPress` RATHER THAN ON THE NAME, because a
  // pickable chip with nothing picked yet is a REAL state — the one the old `regionName === null`
  // early return swallowed (see the header). Having a picker is what makes an unnamed chip worth
  // drawing: the caret still promises a sheet, and the sheet still has a list behind it.
  if (onPress) {
    // Names the field, not just the value — VoiceOver reading a bare "Lake Tahoe" in the middle of a
    // conversation screen says nothing about what it is. Unselected, the prompt already reads as an
    // instruction, so prefixing it would announce "Region: Pick a region".
    const a11yLabel = regionName === null ? voice.region.unset : `Region: ${regionName}`
    return (
      <View style={styles.row}>
        <Pressable
          onPress={onPress}
          // The `label` line box plus `space.sm` of vertical padding lands in the low 30s — under
          // §8's 48pt floor, so the slop is load-bearing, not polish. 12 is `FilterChip`'s
          // precedent and clears the floor with room. ⚠ Unlike `ExampleAsks`, no gap arithmetic is
          // owed against it: §10 cut the paired kicker, so this chip has no tappable neighbour
          // whose touch region it could overlap and hand to z-order.
          // ⚠ The prominent size clears the 48pt floor on its own measurements (16pt line + 12pt
          // padding each side), so the slop is the QUIET pill's crutch and only it needs one.
          hitSlop={prominent ? 0 : 12}
          accessibilityRole="button"
          accessibilityLabel={a11yLabel}
          // "a different" would be a lie with nothing selected, and this is the one state where the
          // hint is doing real work rather than restating the label.
          accessibilityHint={
            regionName === null ? 'Opens the list of regions' : 'Choose a different region'
          }
          // ⚠ No `accessibilityState`. A picker TRIGGER has neither `selected` (nothing here is one
          // of a set) nor `expanded` (the sheet is a separate surface, not this element's subtree).
          style={({ pressed }) => [
            styles.mark,
            styles.pill,
            prominent && styles.pillProminent,
            { backgroundColor: colors.surfaceRaised, borderColor: colors.rule },
            pressed && styles.pressed,
          ]}
        >
          <RegionMark
            regionName={regionName ?? voice.region.unset}
            prominent={prominent}
            leadingIcon={leadingIcon}
          />
          {/* The chip spends its one pine here rather than on the glyph: the caret IS the
              affordance, and §14 flagged the screen's total pine load (listen keyline, three row
              badges, the send disc) as the thing the quiet chip exists to keep in budget. */}
          <Icon name="expand" size={prominent ? 18 : 14} color="accent" />
        </Pressable>
      </View>
    )
  }

  // No name AND no picker: nothing true to say and nothing to do about it, so say nothing. This is
  // the genuine degraded read — `regionsFailed`, or a cold first launch whose `/regions` never
  // landed — where a pill would be an empty promise.
  // ⚠ Screen-side counterpart: whatever anchors the Ridgeline behind this row must not collapse to
  // zero height when this renders nothing.
  if (regionName === null) return null

  // ⚠ THE PILL SKIN IS WORN IN BOTH STATES — only the CARET and the press behaviour are
  // conditional. The approved design shows a quiet pill, and rendering bare text at one region
  // made the screen look unlike it for the only configuration that ships today. What must not
  // appear without a picker behind it is the CARET, which is the thing that promises one.
  // `accessible` groups glyph and name so the field name is read once; no role, because a label
  // that does nothing must not announce itself as a button.
  return (
    <View style={styles.row}>
      <View
        style={[
          styles.mark,
          styles.pill,
          prominent && styles.pillProminent,
          { backgroundColor: colors.surfaceRaised, borderColor: colors.rule },
        ]}
        accessible
        accessibilityLabel={`Region: ${regionName}`}
      >
        <RegionMark regionName={regionName} prominent={prominent} leadingIcon={leadingIcon} />
      </View>
    </View>
  )
}

/** The enamel glyph + the name — identical in both states, so the pill is a skin over the badge
 *  rather than a second rendering of it. */
function RegionMark({
  regionName,
  prominent,
  leadingIcon,
}: {
  regionName: string
  prominent?: boolean
  leadingIcon?: IconName
}) {
  return (
    <>
      {leadingIcon ? <Icon name={leadingIcon} size={prominent ? 18 : 14} color="accent" /> : null}
      {/* ⚠ NO `numberOfLines`, and no `style` prop on this component for a caller to smuggle one in
          through: home is a scrollable, non-driving surface and is therefore UNCAPPED through the AX
          Dynamic Type sizes (§8), while the region name is a server fact of arbitrary length.
          Clamping would truncate it for exactly the riders who need it largest.
          Device-pass fallback if `label`'s tracked uppercase reads too timid, or reads badly on a
          real multi-word region name: `bodyStrong` + `ink`. Not `body`/`heading` — that lands the
          chip at CTA weight and re-breaks §14's "quiet". */}
      <Text variant={prominent ? 'bodyStrong' : 'label'} color="ink" style={styles.name}>
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
  // The picker-trigger weight — see `prominent`. Only the measurements change; the skin does not.
  // 16pt line + 12pt padding each side clears DESIGN §8's 48pt floor without borrowing hit slop.
  pillProminent: { paddingHorizontal: space.lg, paddingVertical: space.md },
  pressed: { opacity: 0.7 },
})
