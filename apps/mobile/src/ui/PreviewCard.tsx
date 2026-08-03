// The route card the conversation produces (1.1 D13): the drive as DRAWN, sitting inline in the
// transcript, one tap away from a spent credit. It is what survives of `app/create.tsx`'s confirm
// view — the map, the route line, the stat row, the no-stories block and the CTA group are harvested
// from it; the FORM that used to precede them is gone, because the conversation is the form now.
//
// ⚠ PURE PRESENTATION. It never calls the API, never mints an idempotency key, never reads a session.
// The screen owns all three, and that split is load-bearing: a create spends a NON-REFUNDABLE credit,
// its synchronous double-tap guard and its idempotency key are PER-CARD state the screen holds (a
// conversation can produce several cards, and a screen-level guard would let card #2 be blocked by
// card #1), and the signed-in/anonymous split behind `disclosure` goes through the one INV-9 helper —
// on the client a truthy `session` is NOT "signed in".
//
// ⚠ INV-1 on the display side: everything shown here comes from `viaResolved` / `start` / `end`, which
// carry names. `proposal.via` is ANCHOR IDS and rendering it would print a uuid at a rider.
import { useMemo, type ReactNode } from 'react'
import { ActivityIndicator, StyleSheet, useAnimatedValue, View } from 'react-native'
import type { DriveProposal } from '@/lib/api'
import { cleanPlaceName } from '@/lib/labels'
import { border, radius, space } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'
import { Badge } from './Badge'
import { Button } from './Button'
import { Card } from './Card'
import { Divider } from './Divider'
import { DriveMap, type DriveMapStop } from './DriveMap'
import { Icon } from './Icon'
import { Text } from './Text'
import { voice } from './voice'

/** `proposing` — the rider said yes, `/drives/propose` is in flight (no proposal yet).
 *  `ready` — drawn, waiting on the tap that spends the credit.
 *  `noStops` — a 200 with `estStopCount === 0`: a real route the corpus has nothing to say about.
 *  `needsAccount` — the create (or the propose, until 8a moves `requireAccount`) 401'd. A STATE OF
 *    THIS CARD, never `<AccountGate>`: that is a whole `<Screen>`, and mounting it unmounts home,
 *    which holds THE ONLY COPY of the transcript (D10 — nothing persists it, here or on the server).
 *  `creating` — `POST /drives` in flight.
 *  `made` — the drive exists; the credit is spent and must never be spent twice from this card.
 *  `error` — propose or create failed; `errorMessage` carries the server's own words when it had any. */
export type PreviewCardState =
  | 'proposing'
  | 'ready'
  | 'noStops'
  | 'needsAccount'
  | 'creating'
  | 'made'
  | 'error'

export interface PreviewCardProps {
  state: PreviewCardState
  /** Null only while `proposing`, or on an `error` that killed the propose itself. */
  proposal: DriveProposal | null
  /** Render the map. ⚠ ONLY the NEWEST card may: `DriveMap` is a real native `MapView`, so N cards in
   *  one scroll view is N map instances. Superseded cards collapse to the route line + stats. It also
   *  gates the CTA's amber glow — same "this is the live card" idea, and DESIGN §8 allows exactly one
   *  glowing amber element on screen. Defaults to true (a lone card is the newest card). */
  mapEnabled?: boolean
  /** The credit-disclosure line, chosen by the SCREEN: `voice.proposal.costNote` when signed in,
   *  `ownershipNote` when not. ⚠ Never a count for an anonymous rider — a fresh account's grant does
   *  not exist until after signup, so any number here would be a guess printed as a fact. */
  disclosure?: string
  /** One in-persona line when the drive drifted materially from the duration the rider asked for, or
   *  omitted when it didn't. Chosen by the SCREEN for the same reason `disclosure` is: the rider's
   *  stated target rides on the PlannedRoute and is dropped before `/propose`, so this card never
   *  sees it. `durationDrift` (src/lib/planner-route.ts) is the rule. */
  durationNote?: string
  /** Step 8a's slot: the one presigned preview clip from the rider's own route. Renders NOTHING when
   *  omitted, and nothing in step 7 may occupy this space — 8a drops a transport in here without
   *  touching any other state of this card. */
  previewClip?: ReactNode
  errorMessage?: string
  ctaLabel: string
  onMake: () => void
  onAdjust: () => void
  onOpenDrive?: () => void
  onSignUp?: () => void
  onDismissGate?: () => void
}

export function PreviewCard({
  state,
  proposal,
  mapEnabled = true,
  disclosure,
  durationNote,
  previewClip,
  errorMessage,
  ctaLabel,
  onMake,
  onAdjust,
  onOpenDrive,
  onSignUp,
  onDismissGate,
}: PreviewCardProps) {
  const theme = useTheme()

  // DriveMap wants an Animated.Value; this map has no live position, so it stays parked at 0 and the
  // puck is hidden outright (below).
  const mapProgress = useAnimatedValue(0)

  // The pins: start, every via midpoint, and — unless this is a loop — the end.
  //
  // ⚠ A LOOP IS `startId === endId`, NOT "it has a via". A loop echoes its start back as the end, so
  // pinning both would stack two markers on one spot; its turnaround is the LAST via. But keying that
  // on `via.length` (as this did until 2026-08-03) silently dropped the DESTINATION pin from every
  // ONE-WAY route that happened to carry a midpoint — "Emerald Bay to Incline Village, via Tahoe
  // City" would have drawn a route to a place with no marker on it. The ids are the honest test and
  // the DTO carries them for exactly this kind of question.
  const endpoints = useMemo<DriveMapStop[]>(() => {
    if (!proposal) return []
    const viaShown = proposal.viaResolved ?? []
    const isLoop = proposal.startId === proposal.endId
    const pins: DriveMapStop[] = [
      {
        seq: 0,
        name: cleanPlaceName(proposal.start.name),
        lat: proposal.start.lat,
        lng: proposal.start.lng,
        state: 'upcoming',
      },
      ...viaShown.map((v, i) => ({
        seq: i + 1,
        name: cleanPlaceName(v.name),
        lat: v.lat,
        lng: v.lng,
        state: 'active' as const,
      })),
    ]
    if (isLoop) return pins
    return [
      ...pins,
      {
        seq: viaShown.length + 1,
        name: cleanPlaceName(proposal.end.name),
        lat: proposal.end.lat,
        lng: proposal.end.lng,
        state: 'active',
      },
    ]
  }, [proposal])

  const kicker = (
    <Text variant="label" color="accentWarm">
      {voice.proposal.kicker}
    </Text>
  )

  // The account wall, hoisted ABOVE the no-proposal early return on purpose. A 401 arrives from
  // `/drives/propose` — i.e. BEFORE there is a proposal to render — so with this branch left below,
  // `needsAccount` fell into the propose-FAILED case and showed "couldn't plot that one" plus a ghost,
  // with `onSignUp` unreachable. There is no live defect today only because the screen happens to
  // render its own gate for that case; the trap survives into step 8a, where this card becomes the
  // wall. Handled first, it is correct with or without a proposal.
  if (state === 'needsAccount') {
    return (
      <Card style={styles.card}>
        {kicker}
        <View style={styles.ctaGroup}>
          <Text variant="body" color="inkDim">
            {voice.gate.body}
          </Text>
          <Button icon="ticket" title={voice.gate.action} onPress={onSignUp} />
          <Button variant="ghost" title={voice.gate.keepBrowsing} onPress={onDismissGate} />
        </View>
      </Card>
    )
  }

  // No route to draw yet — either still drawing, or the propose itself died before there was one.
  if (state === 'proposing' || !proposal) {
    const failed = state !== 'proposing'
    return (
      <Card style={styles.card}>
        {kicker}
        {failed ? (
          <>
            <Text variant="body" color="danger">
              {errorMessage || voice.proposal.drawFailed}
            </Text>
            <Button variant="ghost" title={voice.proposal.adjust} onPress={onAdjust} />
          </>
        ) : (
          <View style={styles.drawing}>
            <ActivityIndicator color={theme.colors.accent} />
            <Text variant="body" color="inkDim">
              {voice.proposal.drawing}
            </Text>
          </View>
        )}
      </Card>
    )
  }

  const min = Math.round(proposal.durationSeconds / 60)
  // ⚠ STRICT `=== 0`. `estStopCount` is nullish-able and `null` means UNKNOWN, not zero — a null must
  // never disable the CTA or claim the road is quiet.
  const noStops = proposal.estStopCount === 0
  // ⚠ THE SAME TEST THE PINS USE (see the note on `endpoints` above) — and it has to be, because these
  // two render the SAME route. Keyed on `via.length`, this branch told a one-way route with a midpoint
  // it was a "Round trip from X" and never named the destination at all, while the map directly above
  // it drew A→B with an end pin. A card disagreeing with its own map is worse than either being wrong
  // alone. Caught by two independent reviewers on 2026-08-03 after the marker fix stopped one region
  // short of this one.
  const isLoop = proposal.startId === proposal.endId
  const viaShown = proposal.viaResolved ?? []
  const spent = state === 'made'

  return (
    <Card style={styles.card}>
      {kicker}

      {mapEnabled ? (
        <View style={[styles.mapFrame, { borderColor: theme.colors.rule }]}>
          {/* hidePuck: there is no live position here, and a stray amber puck would spend the
              screen's one-amber budget on a card that isn't even a drive yet. */}
          <DriveMap
            polyline={proposal.polyline}
            stops={endpoints}
            progress={mapProgress}
            hideRecenter
            hidePuck
          />
        </View>
      ) : null}

      {/* The route line, harvested from create.tsx's confirm view. Loop = start + a turnaround;
          one-way = start → end. Every displayed name goes through cleanPlaceName() — `places.name`
          carries Wikipedia's ", California" disambiguation suffixes. */}
      <View style={styles.routeLine}>
        {isLoop ? (
          <>
            <Text variant="title" color="ink">
              Round trip from {cleanPlaceName(proposal.start.name)}
            </Text>
            {viaShown[0] ? (
              <View style={styles.arrowRow}>
                <Icon name="car" size={14} color="inkFaint" />
                <Text variant="dim" color="inkFaint">
                  via {cleanPlaceName(viaShown[0].name)}
                </Text>
              </View>
            ) : null}
          </>
        ) : (
          <>
            <Text variant="title" color="ink">
              {cleanPlaceName(proposal.start.name)}
            </Text>
            <View style={styles.arrowRow}>
              <Icon name="car" size={14} color="inkFaint" />
              <Text variant="dim" color="inkFaint">
                the scenic way
              </Text>
            </View>
            <Text variant="title" color="ink">
              {cleanPlaceName(proposal.end.name)}
            </Text>
          </>
        )}
      </View>

      <View style={styles.statRow}>
        <Badge tone="amber" label={`${min} MIN`} />
        {proposal.estStopCount != null ? (
          <Badge
            tone="pine"
            label={`${proposal.estStopCount} ${proposal.estStopCount === 1 ? 'STORY' : 'STORIES'}`}
          />
        ) : null}
      </View>

      {/* The skipper owning up when the drive doesn't match the duration the rider named. Sits UNDER
          the badge it is reconciling, so the number and the acknowledgement are read together. The
          screen decides whether there is anything to say (it holds the rider's ask; this card only
          ever sees the materialized proposal). `inkDim` — it is an aside, not a warning. */}
      {durationNote ? (
        <Text variant="dim" color="inkDim" style={styles.durationNote}>
          {durationNote}
        </Text>
      ) : null}

      {/* Step 8a's slot — see `previewClip`. Empty in step 7, and the dividers only exist when it does. */}
      {previewClip ? (
        <>
          <Divider />
          {previewClip}
          <Divider />
        </>
      ) : null}

      {errorMessage ? (
        <Text variant="dim" color="danger">
          {errorMessage}
        </Text>
      ) : null}

      {noStops && !errorMessage ? (
        <Text variant="dim" color="inkDim">
          {voice.proposal.noStops}
        </Text>
      ) : null}

      {spent ? (
        // The credit is gone. Offer the drive, never a second charged tap.
        <View style={styles.ctaGroup}>
          <Button variant="ghost" icon="car" title={voice.proposal.openMade} onPress={onOpenDrive} />
        </View>
      ) : (
        <View style={styles.ctaGroup}>
          {disclosure ? (
            <Text variant="dim" color="inkDim">
              {disclosure}
            </Text>
          ) : null}
          <Button
            icon="car"
            title={ctaLabel}
            onPress={onMake}
            disabled={noStops}
            loading={state === 'creating'}
            // Only the live card wears the campfire glow — see `mapEnabled`.
            glow={mapEnabled}
          />
          <Button variant="ghost" title={voice.proposal.adjust} onPress={onAdjust} />
        </View>
      )}
    </Card>
  )
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  drawing: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  // 200, not create.tsx's 240: that was a full-screen hero, this is a card in a scrolling conversation.
  mapFrame: { height: 200, borderRadius: radius.lg, borderWidth: border.hair, overflow: 'hidden' },
  routeLine: { gap: space.xs },
  arrowRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  durationNote: { marginTop: space.sm },
  ctaGroup: { gap: space.sm },
})
