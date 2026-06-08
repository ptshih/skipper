// The live, GPS-triggered driving player (Phase 2: driven by the SIMULATED fix
// source — couch-testable on the iOS Simulator, no device GPS). The skipper talks
// when the road reaches a stop, not on a timer. Reuses the @/ui player primitives;
// the clock + fire-queue live in `useDrive`.
import { useEffect, useRef } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import { useDrive } from '@/lib/useDrive'
import { stopLabel } from '@/lib/labels'
import { useTheme } from '@/theme'
import { space } from '@/theme/tokens'
import {
  AccountGate,
  Badge,
  Button,
  Card,
  Divider,
  NOW_AREA_RESERVE,
  NowCard,
  RouteTrack,
  Screen,
  Scrubber,
  StateView,
  StopRow,
  STOP_ROW_HEIGHT,
  Text,
  TransportBar,
  stopIcon,
  stopTone,
  voice,
} from '@/ui'

export default function DriveScreen() {
  const theme = useTheme()
  const { id } = useLocalSearchParams<{ id: string }>()
  const d = useDrive(id)
  const listRef = useRef<ScrollView | null>(null)

  // Auto-scroll the stop list to the active (or next) stop as the drive progresses.
  const focusSeq = d.activeSeq ?? d.nextSeq
  useEffect(() => {
    if (focusSeq == null) return
    const row = d.stops.findIndex((s) => s.seq === focusSeq)
    if (row >= 0)
      listRef.current?.scrollTo({ y: Math.max(0, (row - 1) * STOP_ROW_HEIGHT), animated: true })
  }, [focusSeq, d.stops])

  if (d.phase === 'gate')
    return <AccountGate note="The live drive needs a (free) ticket — same as the full tour." />
  if (d.phase === 'error')
    return (
      <StateView
        title="Drive"
        message={d.error ?? voice.error.generic}
        tone="danger"
        action={{ label: voice.error.retry, onPress: d.retry }}
      />
    )
  if (d.phase === 'loading') return <StateView title="Drive" loading message={voice.loading.tour} />

  const activeStop = d.activeSeq != null ? d.stops.find((s) => s.seq === d.activeSeq) : undefined
  const nextName = d.nextSeq != null ? d.stops.find((s) => s.seq === d.nextSeq)?.name : undefined

  return (
    <Screen edges={['bottom']}>
      {/* Keep edge-swipe back but stop the Scrubber drag from triggering the iOS-26
          whole-screen back gesture (same fix the preview uses). */}
      <Stack.Screen
        options={{ title: 'Drive', gestureEnabled: true, fullScreenGestureEnabled: false }}
      />

      <View style={styles.header}>
        <Text variant="title" color="ink">
          {d.tourName}
        </Text>
        <Text variant="dim" color="inkDim">
          {d.region} · simulated drive · {d.firedCount}/{d.totalStops} stops
        </Text>
      </View>

      {/* Route trail with the car token. It glows only between stops (the drive cue);
          while a stop's NOW card is lit, the card owns the single amber glow. */}
      <RouteTrack progress={d.progress} glow={d.activeSeq === null} style={styles.track} />

      {/* NOW area — a fixed-height reserve (see styles.nowContent) so the transport
          controls below, and the stop list, hold a stable position as the now-content
          swaps between a clip's NowCard and the short rolling strip. */}
      <View style={styles.nowWrap}>
        <View style={styles.nowContent}>
          {d.phase === 'done' ? (
            <Card>
              <Text variant="label" color="accentWarm">
                DRIVE COMPLETE
              </Text>
              <Text variant="placardTitle" color="ink">
                You’ve arrived
              </Text>
              <Text variant="body" color="inkDim">
                {voice.driveComplete}
              </Text>
            </Card>
          ) : d.phase === 'ready' ? (
            <Card>
              <Text variant="label" color="accentWarm">
                {voice.drive.ready}
              </Text>
              <Text variant="placardTitle" color="ink">
                {d.tourName}
              </Text>
              <Text variant="body" color="inkDim">
                {voice.drive.readyBody}
              </Text>
            </Card>
          ) : d.activeSeq != null ? (
            <NowCard
              liveRegion
              // A held clip dims the halo and stops claiming "NOW PLAYING".
              glow={d.nowPlaying}
              kicker={d.nowPlaying ? voice.player.nowPlaying : voice.player.paused}
              title={activeStop?.name ?? d.hostName}
              right={
                activeStop ? (
                  <Badge tone={stopTone(activeStop.stopType)} label={stopLabel(activeStop.stopType)} />
                ) : undefined
              }
            />
          ) : (
            // Between stops: a calm rolling strip, not a now-playing card (transit, not a stop).
            <View style={styles.driveStrip} accessibilityLiveRegion="polite">
              <Text variant="dim" color="inkFaint" align="center">
                {nextName
                  ? `${voice.player.rolling} · ${voice.drive.nextStop}: ${nextName}`
                  : voice.player.rolling}
              </Text>
            </View>
          )}
        </View>

        {/* In-clip position bar (only meaningful on a loaded clip). Kept MOUNTED but hidden
            between stops so its height stays reserved and the controls don't shift when it
            reappears on the next clip. */}
        <View
          style={d.activeSeq != null ? undefined : styles.reservedHidden}
          pointerEvents={d.activeSeq != null ? 'auto' : 'none'}
          accessibilityElementsHidden={d.activeSeq == null}
          importantForAccessibility={d.activeSeq != null ? 'auto' : 'no-hide-descendants'}
        >
          <Scrubber
            positionMs={d.activeSeq != null ? d.positionMs : 0}
            durationMs={d.activeSeq != null ? d.durationMs : 0}
            onSeek={d.seekToMs}
            onScrubbingChange={d.setScrubbing}
            disabled={!d.canSeek}
          />
        </View>

        {d.buffering ? (
          <View style={styles.buffering}>
            <ActivityIndicator size="small" color={theme.colors.accentWarm} />
            <Text variant="dim" color="inkFaint">
              {voice.player.buffering}
            </Text>
          </View>
        ) : d.stallNote ? (
          <Text variant="dim" color="danger" style={styles.stall}>
            {d.stallNote}
          </Text>
        ) : null}
      </View>

      {/* Sim setup — pre-drive only (the on-device drive simulator's one knob). */}
      {d.phase === 'ready' ? (
        <View style={styles.simRow}>
          <Text variant="label" color="inkFaint">
            {voice.drive.sim}
          </Text>
          <View style={styles.simBtns}>
            <Button
              title="Real time"
              variant={d.fast ? 'secondary' : 'primary'}
              glow={false}
              fullWidth={false}
              onPress={() => d.setFast(false)}
            />
            <Button
              title="8× faster"
              variant={d.fast ? 'primary' : 'secondary'}
              glow={false}
              fullWidth={false}
              onPress={() => d.setFast(true)}
            />
          </View>
        </View>
      ) : null}

      {d.phase === 'done' ? (
        <TransportBar single={{ icon: 'restart', title: voice.cta.restart, onPress: d.restart }} />
      ) : d.phase === 'ready' ? (
        <TransportBar single={{ icon: 'play', title: voice.cta.play, onPress: d.start }} />
      ) : (
        <TransportBar
          playing={!d.paused}
          playLabel={voice.cta.resume}
          onPlayPause={d.togglePause}
          onSeekBack={() => d.seekBy(-15)}
          onSeekForward={() => d.seekBy(15)}
          canSeek={d.canSeek}
          secondary={{ title: voice.cta.endDrive, onPress: d.end }}
        />
      )}

      <Divider dashed style={styles.divider} />

      {/* Stop list — read-only on a drive (you can't teleport the car). */}
      <ScrollView ref={listRef} style={styles.list} contentContainerStyle={styles.listContent}>
        {d.stops.map((s) => {
          const state =
            d.phase === 'done' || (d.firedSeqs.has(s.seq) && s.seq !== d.activeSeq)
              ? 'passed'
              : s.seq === d.activeSeq
                ? 'active'
                : 'upcoming'
          return (
            <StopRow
              key={s.seq}
              name={s.name}
              sublabel={stopLabel(s.stopType)}
              icon={stopIcon(s.stopType)}
              state={state}
            />
          )
        })}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: space.gutter, paddingTop: space.md, gap: space.xs },
  track: { marginHorizontal: space.gutter, marginTop: space.md },
  nowWrap: { paddingHorizontal: space.gutter, marginTop: space.lg, gap: space.md },
  // Reserve a clip-card's height (centered) so the controls below — and the stop list —
  // hold a stable position as the now-content swaps between a NowCard and the short
  // rolling strip; the scrubber's height is reserved separately (it stays mounted).
  nowContent: { minHeight: NOW_AREA_RESERVE, justifyContent: 'center' },
  driveStrip: { alignItems: 'center' },
  reservedHidden: { opacity: 0 }, // hold the scrubber's layout height without showing it
  buffering: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stall: { marginTop: space.xs },
  simRow: { paddingHorizontal: space.gutter, marginTop: space.lg, gap: space.sm },
  simBtns: { flexDirection: 'row', gap: space.sm },
  divider: { marginVertical: space.lg },
  list: { flex: 1 },
  listContent: { paddingHorizontal: space.gutter, paddingBottom: space.xxl },
})
