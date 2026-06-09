// The live, GPS-triggered driving player. The skipper talks when the road reaches a
// stop, not on a timer. THREE clocks behind one code path (the `?mode=` param), all in
// `useDrive`: the couch SIMULATOR (default — testable on the iOS Simulator, no device
// GPS), the real device GPS (`?mode=live`, Phase 4), and the map-less PREVIEW
// (`?mode=preview`) — the anonymous-friendly couch SIMULATED DRIVE that walks a
// compressed segment timeline (clip / drive / rest), tappable stops, no GPS or permission
// gate. Reuses the @/ui player primitives; the clock + fire-queue + source swap live in
// `useDrive`.
import { useEffect, useRef } from 'react'
import { ActivityIndicator, PixelRatio, ScrollView, StyleSheet, View } from 'react-native'
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

// mm:ss for the preview header's "X preview of a Y drive" subtitle.
const mmss = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`

export default function DriveScreen() {
  const theme = useTheme()
  const { id, mode } = useLocalSearchParams<{ id: string; mode?: string }>()
  // 'live' = real device GPS (Phase 4); 'preview' = the couch SIMULATED DRIVE (anonymous,
  // no GPS, tappable stops); anything else = the on-device drive simulator (dev default).
  const driveMode = mode === 'live' ? 'live' : mode === 'preview' ? 'preview' : 'sim'
  const d = useDrive(id, { mode: driveMode })
  const isPreview = driveMode === 'preview'
  const listRef = useRef<ScrollView | null>(null)

  // Auto-scroll the stop list to the active (or next) stop as the drive progresses.
  // Scale the row height by the user's font scale — rows are minHeight + grow with
  // Dynamic Type, so a fixed STOP_ROW_HEIGHT would undershoot the target at large text.
  const focusSeq = d.activeSeq ?? d.nextSeq
  // Row index of the current segment's stop (preview's passed/active stop-list state).
  const focusRow = focusSeq != null ? d.stops.findIndex((s) => s.seq === focusSeq) : -1
  useEffect(() => {
    if (focusSeq == null) return
    const row = d.stops.findIndex((s) => s.seq === focusSeq)
    const rowH = STOP_ROW_HEIGHT * PixelRatio.getFontScale()
    if (row >= 0)
      listRef.current?.scrollTo({ y: Math.max(0, (row - 1) * rowH), animated: true })
  }, [focusSeq, d.stops])

  if (d.phase === 'gate')
    // Only the LIVE/SIM drive can gate — preview uses the open `?preview=1` funnel and never
    // 401s, so it never reaches this phase (every tour is previewable; the wall is the drive).
    return <AccountGate note="The live drive needs a (free) ticket — same as the full tour." />

  if (d.phase === 'locationGate')
    // Three states: precise-location-off (reduced) and hard-denied-no-reprompt both route to Settings;
    // only a still-askable denial offers an in-app "Switch on location" re-prompt.
    return (
      <StateView
        title="Drive"
        message={
          d.locationReduced
            ? voice.drive.locationReduced
            : d.locationCanAskAgain
              ? voice.drive.locationNeeded
              : voice.drive.locationBlocked
        }
        tone="danger"
        action={
          d.locationReduced || !d.locationCanAskAgain
            ? { label: voice.drive.locationSettings, onPress: d.openLocationSettings }
            : { label: voice.drive.locationAllow, onPress: d.start }
        }
      />
    )
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
  // The intro/outro brackets aren't stops; give them a frame title instead of a place name.
  const nowTitle = d.activeBracket
    ? d.activeBracket === 'intro'
      ? 'Welcome aboard'
      : 'One for the road'
    : (activeStop?.name ?? d.hostName)
  const nextStop = d.nextSeq != null ? d.stops.find((s) => s.seq === d.nextSeq) : undefined
  const nextName = nextStop?.name

  return (
    <Screen edges={['bottom']}>
      {/* Keep edge-swipe back but stop the Scrubber drag from triggering the iOS-26
          whole-screen back gesture (same fix the preview uses). */}
      <Stack.Screen
        options={{
          title: isPreview ? 'Preview drive' : 'Drive',
          gestureEnabled: true,
          fullScreenGestureEnabled: false,
        }}
      />

      <View style={styles.header}>
        <Text variant="title" color="ink">
          {d.tourName}
        </Text>
        <Text variant="dim" color="inkDim">
          {isPreview ? (
            <>
              {d.region} · simulated drive
              {d.totalPreviewMs != null && d.totalRealMs != null
                ? ` · ${mmss(d.totalPreviewMs)} preview of a ${mmss(d.totalRealMs)} drive`
                : ''}
            </>
          ) : (
            <>
              {d.region} · {driveMode === 'live' ? 'live drive' : 'simulated drive'} ·{' '}
              {d.firedCount}/{d.totalStops} stops
            </>
          )}
        </Text>
      </View>

      {/* Route trail with the car token. It glows only between stops (the drive cue);
          while a stop's NOW card is lit, the card owns the single amber glow. */}
      <RouteTrack progress={d.progress} glow={d.activeSeq === null} style={styles.track} />

      {/* Itinerary — the scrolling middle (flex:1) between the trail and the player. By
          taking all the slack it pushes the player below it down to the bottom edge.
          Tappable in PREVIEW (jump the simulated drive there); read-only on a real/sim
          drive (you can't teleport the car) — the hint sits right above the stops. */}
      {isPreview ? (
        <Text variant="dim" color="inkFaint" style={styles.hint}>
          Tap any stop to jump ahead
        </Text>
      ) : null}
      <ScrollView ref={listRef} style={styles.list} contentContainerStyle={styles.listContent}>
        {d.stops.map((s, i) => {
          // PREVIEW: the current segment's seq is the active clip's, or the drive/rest
          // destination; mark earlier rows passed, and light the row "active" only once we've
          // ARRIVED (a clip/rest beat) — not while still driving TO it. Live/sim uses firedSeqs.
          const state = isPreview
            ? d.phase === 'done' || (focusRow >= 0 && i < focusRow)
              ? 'passed'
              : s.seq === focusSeq && d.currentKind !== 'drive'
                ? 'active'
                : 'upcoming'
            : d.phase === 'done' || (d.firedSeqs.has(s.seq) && s.seq !== d.activeSeq)
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
              onPress={isPreview ? () => d.jumpToStop(s.seq) : undefined}
            />
          )
        })}
      </ScrollView>

      {/* ── PLAYER ── status + controls, anchored to the bottom edge as one grounded unit
          (thumb-height for in-car) instead of floating mid-screen. A dashed rule fences it
          off from the itinerary above. */}
      <Divider dashed style={styles.divider} />

      {/* GPS acquisition — a missing fix reads as a "still finding you" status, not a
          fault with the current clip. */}
      {d.gpsSearching && !d.paused ? (
        <View style={styles.gpsSearch} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color={theme.colors.accentWarm} />
          <Text variant="dim" color="inkFaint">
            {voice.player.gpsSearching}
          </Text>
        </View>
      ) : null}

      {/* NOW area — a fixed-height reserve (see styles.nowContent) so the transport controls
          below hold a stable position as the now-content swaps between the active clip's
          NowCard and the non-glowing rolling variant. */}
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
          ) : !isPreview && d.phase === 'ready' ? (
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
          ) : d.currentKind === 'rest' ? (
            // PREVIEW: a silent break stop — a "good spot to stretch" pit-stop card (no halo).
            <NowCard
              liveRegion
              glow={false}
              kicker={voice.player.pitStop}
              title={nextName ?? 'A good spot to stretch'}
            />
          ) : d.activeSeq != null ? (
            <NowCard
              liveRegion
              // A held clip dims the halo and stops claiming "NOW PLAYING".
              glow={d.nowPlaying}
              kicker={d.nowPlaying ? voice.player.nowPlaying : voice.player.paused}
              title={nowTitle}
              right={
                activeStop ? (
                  <Badge tone={stopTone(activeStop.stopType)} label={stopLabel(activeStop.stopType)} />
                ) : undefined
              }
            />
          ) : (
            // Between stops: a calm, non-glowing sibling of the NOW card (transit, not a
            // stop) — same card chrome, but the amber halo stays OFF here so the route
            // track keeps the single between-stops glow. Mirrors the active card's shape:
            // kicker → big destination title → the next stop's type badge. PREVIEW shows the
            // compressed leg's distance in the mono timer slot.
            <NowCard
              liveRegion
              glow={false}
              kicker={
                nextName ? `${voice.player.rolling} · ${voice.drive.nextStop}` : voice.player.rolling
              }
              title={nextName ?? voice.player.rollingOpen}
              timer={
                d.rollingDistanceM != null
                  ? `~${(d.rollingDistanceM / 1609).toFixed(1)} mi`
                  : undefined
              }
              right={
                nextStop ? (
                  <Badge tone={stopTone(nextStop.stopType)} label={stopLabel(nextStop.stopType)} />
                ) : undefined
              }
            />
          )}
        </View>

        {/* In-clip position bar (only meaningful on a loaded clip). MID-DRIVE between stops
            it's kept mounted but hidden so its height stays reserved and the controls don't
            shift when it reappears on the next clip. Pre-drive (ready) and at the end (done)
            there's no clip to swap to, so it's fully collapsed — no dead band above the CTA. */}
        <View
          style={
            d.activeSeq != null
              ? undefined
              : d.phase === 'driving'
                ? styles.reservedHidden
                : styles.collapsed
          }
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

      {/* Sim setup — pre-drive only, SIM mode only (the on-device drive simulator's one knob;
          a live drive runs at real GPS speed, so the time-scale toggle is meaningless). */}
      {driveMode === 'sim' && d.phase === 'ready' ? (
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
      ) : !isPreview && d.phase === 'ready' ? (
        <TransportBar single={{ icon: 'play', title: voice.cta.play, onPress: d.start }} />
      ) : (
        // PREVIEW just plays (autostarts, no fix source to "pull over" from) — no secondary
        // "Pull over" button; the live/sim drive keeps it to end the drive.
        <TransportBar
          playing={!d.paused}
          playLabel={voice.cta.resume}
          onPlayPause={d.togglePause}
          onSeekBack={() => d.seekBy(-15)}
          onSeekForward={() => d.seekBy(15)}
          canSeek={d.canSeek}
          secondary={isPreview ? undefined : { title: voice.cta.endDrive, onPress: d.end }}
        />
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: space.gutter, paddingTop: space.md, gap: space.xs },
  track: { marginHorizontal: space.gutter, marginTop: space.md },
  nowWrap: { paddingHorizontal: space.gutter, marginTop: space.sm, gap: space.sm },
  // Reserve a clip-card's height (centered) so the controls below — and the stop list —
  // hold a stable position as the now-content swaps between the active and rolling
  // NowCards; the scrubber's height is reserved separately (it stays mounted).
  nowContent: { minHeight: NOW_AREA_RESERVE, justifyContent: 'center' },
  reservedHidden: { opacity: 0 }, // hold the scrubber's layout height without showing it
  collapsed: { display: 'none' }, // drop the scrubber from layout entirely (ready/done — no clip to reserve for)
  buffering: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  gpsSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.gutter,
    marginTop: space.md,
  },
  stall: { marginTop: space.xs },
  hint: { paddingHorizontal: space.gutter, paddingTop: space.md, paddingBottom: space.sm }, // preview only
  simRow: { paddingHorizontal: space.gutter, marginTop: space.lg, gap: space.sm },
  simBtns: { flexDirection: 'row', gap: space.sm },
  divider: { marginTop: space.sm, marginBottom: space.sm }, // fence between the list and the player dock
  list: { flex: 1 },
  listContent: { paddingHorizontal: space.gutter, paddingTop: space.sm, paddingBottom: space.sm },
})
