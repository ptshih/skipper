// The two ways the conversation cannot happen, in one card: no signal (D18) and a transport/model
// outage (RISK-2). Both are dead ends for the composer, so home REPLACES it with this rather than
// greying it out — a disabled field reads as broken, and only one of these two is anyone's fault.
//
// ⚠ The anchor names are the whole reason this is a component and not a shrug. A stuck screen that
// still says something TRUE — here is the country the skipper actually runs — beats one that only
// apologises, and offline it is the only place a rider can learn what this app knows. They come from
// `region.exampleAnchors` (public place NAMES, cached by the screen so they survive the outage that
// makes them worth showing); this card is handed the list and renders it, nothing more.
//
// ⚠ `outage` is reachable ONLY from a TRANSPORT failure. `POST /drives/plan` catches every planner
// failure and answers 200 with its own in-persona line (deliberately — INV-13 keeps the vendor error
// away from the rider), so there is no status code to detect and NO heuristic on what `say` contains
// may ever be built here.
import { StyleSheet, View } from 'react-native'
import { cleanPlaceName } from '@/lib/labels'
import { space } from '../theme/tokens'
import { Badge } from './Badge'
import { Button } from './Button'
import { Card } from './Card'
import { Text } from './Text'
import { voice } from './voice'

export interface PlannerUnavailableCardProps {
  reason: 'offline' | 'outage'
  /** The region's curated endpoint names, already fetched or cached by the screen. */
  anchorNames: readonly string[]
  /** Re-sends the SAME transcript — the rider's line is already in it, so a retry costs no typing.
   *  Ignored on `offline`, where there is nothing to retry into. */
  onRetry?: () => void
}

export function PlannerUnavailableCard({
  reason,
  anchorNames,
  onRetry,
}: PlannerUnavailableCardProps) {
  const offline = reason === 'offline'
  return (
    // framed: DESIGN §6 reserves the carved double-keyline for non-driving surfaces and empty states.
    // A home that cannot hold a conversation is exactly that.
    <Card framed style={styles.card}>
      <Text variant="placardTitle" color="ink">
        {offline ? voice.plan.offlineTitle : voice.plan.outageTitle}
      </Text>
      <Text variant="body" color="inkDim">
        {offline ? voice.plan.offlineBody : voice.plan.outageBody}
      </Text>

      {/* No names, no promise: an empty roster must not leave the intro line dangling over nothing. */}
      {anchorNames.length > 0 ? (
        <>
          <Text variant="dim" color="inkDim">
            {voice.plan.anchorsIntro}
          </Text>
          {/* Non-tappable on purpose. These are what the skipper KNOWS, not a picker — tapping one
              would rebuild the endpoint form the conversation replaced (1.1 D7). */}
          <View style={styles.names}>
            {anchorNames.map((n, i) => (
              // Index in the key: the roster is server-authored and two curated places can legitimately
              // share a name once the ", California" suffix is stripped off for display.
              <Badge key={`${n}:${i}`} tone="neutral" label={cleanPlaceName(n)} />
            ))}
          </View>
        </>
      ) : null}

      {!offline && onRetry ? (
        <Button variant="secondary" title={voice.plan.outageRetry} onPress={onRetry} />
      ) : null}
    </Card>
  )
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  names: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
})
