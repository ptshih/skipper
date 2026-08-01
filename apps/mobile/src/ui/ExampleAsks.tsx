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
          // An ask is a whole sentence, not the short noun a selector chip carries, so it may wrap
          // to a second line. One line would clip it mid-phrase — and a half-sentence a rider is
          // being invited to SAY reads as a bug, not as a truncation.
          numberOfLines={2}
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
