// One proposed drive AS IT SITS IN THE TRANSCRIPT — and, more to the point, the memo boundary
// between the conversation screen and that card.
//
// ⚠ THIS COMPONENT EXISTS FOR ONE MEASURED REASON, so don't dissolve it back into the screen.
// `useRoutePreview` subscribes to expo-audio's status, whose `currentTime` advances every 500 ms for
// as long as a clip plays — so HomeScreen re-renders twice a second for the whole clip (measured on
// the simulator: 500 ms gaps, dead on). NOTHING A CARD DISPLAYS CHANGES ON THOSE TICKS: the clip row
// reads only "is this card playing" and "did its presign die". The card was rebuilt on every one of
// them anyway, `previewClip` element tree and all, and the newest card carries a native MapView.
//
// ⚠ `memo()` ON `PreviewCard` INSTEAD WOULD NOT HAVE BITTEN, which is why the boundary is here rather
// than one level down. The screen handed `PreviewCard` a freshly-built `previewClip` tree plus a
// fistful of fresh arrow functions on every render, so a shallow comparator could never match.
// Everything those closures used to capture is built HERE, from props that are scalars or stable
// references — that is the whole trick, and it is what `PreviewCard` cannot do for itself.
//
// ⚠ THEREFORE: KEEP EVERY PROP SHALLOW-COMPARABLE. `item` arrives by REFERENCE, which is safe only
// because `patchCard` replaces the object on every change (a mutate-in-place would silently freeze
// this card). Clip state arrives as two BOOLEANS rather than the preview hook itself. And every
// callback must already be stable at the caller — see `onPlayClip`, which has a warning of its own.
import { memo, useMemo, type ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import type { DriveProposal } from '@/lib/api'
import { cleanPlaceName } from '@/lib/labels'
import { durationDrift } from '@/lib/planner-route'
import type { PlannedRoute } from '@skipper/shared'
import { hit, radius, space } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'
import { AttributionButton } from './AttributionButton'
import { Icon } from './Icon'
import { PreviewCard, type PreviewCardState } from './PreviewCard'
import { Text } from './Text'
import { voice } from './voice'

/** One route card living in the transcript.
 *
 *  `afterTurn` is the transcript LENGTH when the card was created, i.e. the slot it occupies between
 *  turns. Cards are held apart from `Turn[]` deliberately: a transcript is what the model is re-sent
 *  (`toWire`), and a card is a local artifact of a Routes call the model never sees.
 *
 *  ⚠ `idempotencyKey` and the in-flight guard are both PER-CARD — a screen-level guard would let card
 *  #1 block card #2, or worse, let card #2 dedupe against card #1's key.
 *
 *  ⚠ It lives HERE, next to the component that consumes it, rather than in the screen: `src/ui` may
 *  not import from `app/`, and this is the card's own contract. */
export interface PreviewItem {
  id: string
  afterTurn: number
  route: PlannedRoute
  state: PreviewCardState
  proposal: DriveProposal | null
  /** The create key for THIS card, minted with it. ⚠ A FIELD, not a side table: it was a parallel
   *  `Map<cardId, key>` ref that had to be torn down in lockstep with `cards`. One lifetime, one
   *  structure — a card cannot now exist without its key, and clearing the cards cannot leave a key
   *  behind. */
  idempotencyKey: string
  errorMessage?: string
  driveId?: string
}

export interface TranscriptCardProps {
  item: PreviewItem
  /** Only the newest card instantiates a native MapView — and wears the one amber glow. */
  newest: boolean
  signedIn: boolean
  /** This card's clip is the one currently playing. Already ANDed with "this card is the active one"
   *  by the caller, because the screen owns exactly one player for the whole conversation. */
  clipPlaying: boolean
  /** This card's presign died. The disc goes away with it: leaving a play button under copy that says
   *  "make the drive instead" invites a tap that provably cannot work. */
  clipFailed: boolean
  onCreate: (item: PreviewItem) => void
  onAdjust: () => void
  onOpenDrive: (driveId: string) => void
  onSignUp: () => void
  onDismissGate: (id: string) => void
  /** ⚠ MUST BE STABLE, and it is the one prop here that is NOT stable at its source. The preview
   *  hook's `play` depends on a `toggle` whose deps include `status.currentTime`, so it is a brand new
   *  function every 500 ms while a clip plays — passed straight through, it would bust this memo at
   *  exactly the rate the memo exists to absorb. The screen hands over a stable wrapper instead. */
  onPlayClip: (cardId: string, url: string) => void
}

function TranscriptCardBase({
  item,
  newest,
  signedIn,
  clipPlaying,
  clipFailed,
  onCreate,
  onAdjust,
  onOpenDrive,
  onSignUp,
  onDismissGate,
  onPlayClip,
}: TranscriptCardProps) {
  const { colors } = useTheme()

  /** The skipper's line when the drawn drive doesn't match the duration the rider named, or undefined
   *  when it does (or when they never named one, which is the common case). The RULE is pure and
   *  tested — `durationDrift` in @/lib/planner-route; this only picks the words. */
  const durationNote = useMemo((): string | undefined => {
    if (!item.proposal) return undefined
    const drift = durationDrift(item.route.targetMinutes, item.proposal.durationSeconds)
    if (!drift) return undefined
    return drift.direction === 'short'
      ? voice.proposal.durationShort(drift.askedMinutes, drift.actualMinutes)
      : voice.proposal.durationLong(drift.askedMinutes, drift.actualMinutes)
  }, [item.proposal, item.route.targetMinutes])

  /** The in-card taste (D14/INV-5): ONE clip the server chose from THIS route's own release-filtered
   *  selection — the drive's opening beat, so the preview and the product can never disagree.
   *
   *  ⚠ NO AUTOPLAY, ever. The clip takes EXCLUSIVE audio focus (D35), so a card that lands mid-
   *  conversation and starts talking would PAUSE the rider's music with no tap — hostile in a way the
   *  old mixing behaviour would have hidden. Tap to play, always.
   *
   *  A null clip is a normal outcome (a 0-stop route, or a presign that failed) — the card renders
   *  without the slot and nothing here says so; there is no missing-clip copy because there is no
   *  missing thing from the rider's point of view. */
  const previewClip = useMemo((): ReactNode => {
    const clip = item.proposal?.previewClip
    if (!clip) return null
    // The presign is DEAD and this surface cannot mint another (`/drives/:id/assets/sign` is an owner
    // route), so the disc goes with it.
    if (clipFailed) {
      return (
        <View style={styles.clipRow}>
          <Text variant="label" color="accentWarm">
            {voice.proposal.clipKicker}
          </Text>
          <Text variant="dim" color="danger">
            {voice.proposal.clipUnavailable}
          </Text>
        </View>
      )
    }
    return (
      <View style={styles.clipRow}>
        <View style={styles.clipHead}>
          <Pressable
            onPress={() => onPlayClip(item.id, clip.url)}
            accessibilityRole="button"
            accessibilityLabel={
              clipPlaying ? voice.proposal.clipPauseA11y : voice.proposal.clipPlayA11y
            }
            style={({ pressed }) => [
              styles.clipDisc,
              { backgroundColor: colors.primaryFill },
              pressed && styles.clipPressed,
            ]}
          >
            <Icon name={clipPlaying ? 'pause' : 'play'} size={22} color="onPrimary" />
          </Pressable>
          <View style={styles.flex}>
            <Text variant="label" color="accentWarm">
              {voice.proposal.clipKicker}
            </Text>
            {/* The place NAME comes from the server, never from the planner — it is a fact about a
                stop, and D9 keeps facts out of the conversation. `places.name` carries Wikipedia's
                ", California" disambiguation, hence cleanPlaceName. */}
            <Text variant="bodyStrong" color="ink" numberOfLines={1}>
              {cleanPlaceName(clip.name)}
            </Text>
          </View>
          {/* ⚠ NOT decoration. Wikipedia is CC BY-SA, and this is the most-seen anonymous surface in
              the app — the credit rides the clip wherever the adapted work is presented. It renders
              nothing for a clip with no sources (scenic/break ground on none). */}
          <AttributionButton items={clip.attribution} />
        </View>
        <Text variant="dim" color="inkDim">
          {voice.proposal.clipHint}
        </Text>
      </View>
    )
  }, [item.proposal, item.id, clipFailed, clipPlaying, colors.primaryFill, onPlayClip])

  return (
    <PreviewCard
      state={item.state}
      proposal={item.proposal}
      mapEnabled={newest}
      disclosure={signedIn ? voice.proposal.costNote : voice.proposal.ownershipNote}
      durationNote={durationNote}
      previewClip={previewClip}
      errorMessage={item.errorMessage}
      ctaLabel={voice.proposal.cta}
      onMake={() => onCreate(item)}
      onAdjust={onAdjust}
      onOpenDrive={() => item.driveId && onOpenDrive(item.driveId)}
      // ⚠ NEVER auto-fired on return from sign-up. The fresh account's grant does not exist until
      // after signup, so the number D29 requires us to disclose does not exist at wall time — the
      // rider comes back to a re-read balance and taps "Make this drive" once more, on purpose.
      onSignUp={onSignUp}
      onDismissGate={() => onDismissGate(item.id)}
    />
  )
}

export const TranscriptCard = memo(TranscriptCardBase)

const styles = StyleSheet.create({
  flex: { flex: 1 },
  clipRow: { gap: space.sm },
  clipHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  // hit.min, not the ~44 the design sketch showed — the in-car ≥48pt floor is a habit, not a
  // per-surface judgement, and this rider is one tap from a drive.
  clipDisc: {
    width: hit.min,
    height: hit.min,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clipPressed: { opacity: 0.85 },
})
