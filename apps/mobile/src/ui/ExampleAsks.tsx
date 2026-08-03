// The tappable example asks that sit under the cold-open conversation (1.1 step 7, D17). Three
// authored sentences the rider can say with one tap instead of facing an empty field — the
// hardest moment on a screen whose only affordance is "type something".
//
// PRESENTATION ONLY, and that boundary is the point: this component does not build the strings,
// does not know a chip is an authored ask/reply PAIR, does not know that tapping one seeds two
// turns without a model call, and never touches the transcript. It renders sentences and reports
// which index was tapped. The screen owns all of it.
//
// ⚠ The chips are ACTIONS, never a selector — `active` is never passed. A filled chip would say
// "this ask is currently selected", and there is nothing to deselect: the tap is spent the moment
// it lands and the whole row disappears on the first rider turn.
import { StyleSheet, View } from 'react-native'
import { space } from '../theme/tokens'
import { FilterChip } from './FilterChip'

export interface ExampleAsksProps {
  /** Already interpolated and display-clean. Order is the screen's; the index comes back verbatim. */
  asks: readonly string[]
  onPick: (index: number) => void
}

export function ExampleAsks({ asks, onPick }: ExampleAsksProps) {
  // Nothing to offer (an uncurated region, or no region loaded) renders nothing at all rather than
  // an empty gap the screen would have to reason about.
  if (asks.length === 0) return null
  return (
    <View style={styles.wrap}>
      {asks.map((ask, i) => (
        // Index keys: the row is authored per render, fixed-length and never reordered or
        // filtered — and two chips can legitimately carry the same sentence in a degraded region.
        <FilterChip
          key={i}
          label={ask}
          // ⚠ TYPE, not restyle (2026-08-03): the pine pill, the keyline and the hit target are the
          // selector chip's; the small-caps `label` scale is NOT. An ask is a whole SENTENCE the
          // rider is invited to say, and DESIGN §5 gives `label` (12.5 UPPER, tracked) to kickers
          // and badges — set on a sentence it shouts a category tag at the reader and loses the
          // half-second glance. `body` is §5's sentence role, and lands just under the 17pt of a
          // Button's `heading` — which is right: an ask is an offer, not the screen's CTA.
          variant="body"
          // Uncapped rather than clipped: the interpolated place names are real curated names of
          // any length ("Lake Tahoe - Nevada State Park"), so a fixed line cap truncates a
          // half-sentence at the default type size and worse at AX sizes. Wrapping is free here —
          // this is a wrapped row on a scrollable screen, not a horizontal scroller.
          wrap
          onPress={() => onPick(i)}
        />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  // Wrapped, not a horizontal scroller: a scroller hides asks 2 and 3 off-screen at exactly the
  // moment the rider needs to see that there is more than one shape of thing to ask for.
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
})
