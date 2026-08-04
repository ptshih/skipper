// The saved-drive card — ONE definition, two surfaces.
//
// ⚠ WHY THIS FILE EXISTS, and it is not tidiness. This card was written out twice — once on MY DRIVES
// (`app/drives/index.tsx`), once in home's offline branch (`app/index.tsx`) — and the two copies had
// ALREADY DRIFTED before this file was created: MY DRIVES' VoiceOver label ran the place name through
// `cleanPlaceName` while home's carried the RAW one, so a screen reader read "Tahoe Keys comma
// California" on home where the card itself said "Tahoe Keys". One surface got the fix, the other kept
// the bug, and nothing failed. That is what a second copy costs, so there is now one.
//
// ⚠ THE SHARED ATOM IS THE ROW, NOT THE LIST, and that is forced rather than chosen: the two surfaces
// scroll differently. MY DRIVES virtualizes through `<ScreenList>` (only on-screen rows are built);
// home's offline branch is a SECTION inside home's own ScrollView, where nesting a VirtualizedList is
// an error, not a preference. `DriveList` below is the plain mapped column for that second case — the
// row is identical either way, which is the property worth protecting.
import { memo } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import type { DriveSummary } from '@/lib/api'
import { cleanPlaceName } from '@/lib/labels'
import { space } from '../theme/tokens'
import { Badge } from './Badge'
import { Card } from './Card'
import { Skeleton } from './Skeleton'
import { Text } from './Text'

export interface DriveCardProps {
  drive: DriveSummary
  /** Receives the drive id. ⚠ Callers wrap their own navigation guard around this (expo-router does
   *  not de-dupe identical pushes, so a fast double-tap stacks two detail screens) — the card does
   *  not own that, because the two surfaces guard on different state. */
  onPress: (driveId: string) => void
}

/**
 * One saved drive: its route label, the stop count, and a duration badge.
 *
 * ⚠ MEMOIZED, and the caller must pass a STABLE `onPress` or this does nothing and fails silently —
 * the memo-no-op trap that has now bitten `TranscriptCard`, `Composer` and `StopList` in turn. Both
 * call sites hand it a `useCallback`. `drive` is compared by identity, which is correct: the rows only
 * ever change by a refetch replacing the array.
 */
export const DriveCard = memo(function DriveCard({ drive, onPress }: DriveCardProps) {
  const min = drive.durationSeconds ? Math.round(drive.durationSeconds / 60) : null
  // ⚠ CLEANED ON BOTH SIDES — the drift this file exists to end. `cleanPlaceName` strips Wikipedia's
  // disambiguator and is display-only, which is exactly what a SPOKEN label is too.
  const label = cleanPlaceName(drive.label)
  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${label}${drive.clipCount ? `, ${drive.clipCount} stops` : ''}${min ? `, ${min} minutes` : ''}`}
    >
      <Card onPress={() => onPress(drive.driveId)}>
        {/* ⚠ NO `numberOfLines`, and this is the reconciliation of the second drift: MY DRIVES ran
            uncapped while home clamped to 2. Uncapped wins on purpose — both surfaces are scrollable
            and non-driving, so Dynamic Type is uncapped including the AX sizes, and a clamp truncates
            a real route label ("Emerald Bay to Incline Village, the scenic way") for exactly the
            riders who need it largest. */}
        <Text variant="title" color="ink">
          {label}
        </Text>
        <View style={styles.metaRow}>
          <Text variant="label" color="inkFaint" style={styles.flex}>
            {drive.clipCount} {drive.clipCount === 1 ? 'stop' : 'stops'}
          </Text>
          {/* A fill, not a glow — inside DESIGN §8's one-amber budget. */}
          {min ? <Badge tone="amber" label={`${min} MIN`} /> : null}
        </View>
      </Card>
    </View>
  )
})

export interface DriveListProps {
  drives: readonly DriveSummary[]
  onPressDrive: (driveId: string) => void
  style?: StyleProp<ViewStyle>
}

/**
 * The un-virtualized mapped column, for a drives list that sits INSIDE another scroll view (home's
 * offline branch). ⚠ On a surface that owns its own scrolling, reach for `<ScreenList>` instead — it
 * builds only the rows on screen.
 */
export function DriveList({ drives, onPressDrive, style }: DriveListProps) {
  return (
    <View style={[styles.list, style]}>
      {drives.map((dr) => (
        <DriveCard key={dr.driveId} drive={dr} onPress={onPressDrive} />
      ))}
    </View>
  )
}

/** A drive card's silhouette. Inert; the enclosing `SkeletonGroup` owns the pulse. Shared for the same
 *  reason the card is: it mirrors the card's shape, so a card change that skips it is a visible seam. */
export function DriveCardSkeleton() {
  return (
    <Card>
      <Skeleton width="72%" height={20} />
      <Skeleton width="48%" height={12} style={styles.skLine} />
    </Card>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { gap: space.md },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.sm,
    marginTop: space.xs,
  },
  skLine: { marginTop: space.sm },
})
