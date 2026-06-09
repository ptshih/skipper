// The live, GPS-triggered driving player. The skipper talks when the road reaches a
// stop, not on a timer. THREE clocks behind one code path (the `?mode=` param), all in
// `useDrive`: the couch SIMULATOR (default — testable on the iOS Simulator, no device
// GPS), the real device GPS (`?mode=live`, Phase 4), and the map-less PREVIEW
// (`?mode=preview`) — the anonymous-friendly couch SIMULATED DRIVE that walks a
// compressed segment timeline (clip / drive / rest), tappable stops, no GPS or permission
// gate. Reuses the @/ui player primitives; the clock + fire-queue + source swap live in
// `useDrive`.
import { useCallback, useEffect, useRef } from 'react'
import { ActivityIndicator, Alert, Animated, PixelRatio, ScrollView, StyleSheet, View } from 'react-native'
import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { useDrive } from '@/lib/useDrive'
import { useSession } from '@/lib/auth'
import { stopLabel } from '@/lib/labels'
import { useReducedMotion, useTheme } from '@/theme'
import { duration, space } from '@/theme/tokens'
import {
  AccountGate,
  Badge,
  Button,
  Divider,
  NowCard,
  RouteTrack,
  Screen,
  Scrubber,
  StateView,
  StopList,
  STOP_ROW_HEIGHT,
  Text,
  TransportBar,
  stopIcon,
  stopTone,
  voice,
} from '@/ui'
import type { BadgeTone } from '@/ui'

// mm:ss for the preview header's "X preview of a Y drive" subtitle.
const mmss = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`

export default function DriveScreen() {
  const theme = useTheme()
  const { id, mode } = useLocalSearchParams<{ id: string; mode?: string }>()
  // 'live' = real device GPS (Phase 4); 'preview' = the couch SIMULATED DRIVE (anonymous,
  // no GPS, tappable stops). An unrecognized/missing mode falls back to the dev simulator in
  // dev, but to the open couch PREVIEW in release — the dev clock must never be one malformed
  // deep link away from a production rider.
  const driveMode = mode === 'live' ? 'live' : mode === 'preview' ? 'preview' : __DEV__ ? 'sim' : 'preview'
  const d = useDrive(id, { mode: driveMode })
  const isPreview = driveMode === 'preview'
  const listRef = useRef<ScrollView | null>(null)
  const navigation = useNavigation()
  const router = useRouter()
  const { data: session } = useSession()

  // Returning from /sign-in lands back on this STILL-MOUNTED screen, but useDrive's load
  // effect watches only [tourId, reloadKey, mode] — nothing the session — so a rider who just
  // got their free ticket would otherwise sit on the same gate. Re-check ONCE per signed-in
  // user while gated; retry() bumps reloadKey → re-fetches → drops them straight into the drive.
  const sessionUserId = session?.user?.id ?? null
  const retriedForUser = useRef<string | null>(null)
  useEffect(() => {
    if (d.phase === 'gate' && sessionUserId && retriedForUser.current !== sessionUserId) {
      retriedForUser.current = sessionUserId
      d.retry()
    }
  }, [d.phase, sessionUserId, d.retry])

  // A rolling drive must not die on one stray tap. The header back chevron dispatches a JS
  // GO_BACK (HeaderBack → router.back()), which beforeRemove reliably catches → confirm. The
  // edge-swipe is disabled outright while driving (gestureEnabled below), since the native
  // gesture can complete before a JS confirm resolves. 'ready'/'done' stay freely poppable.
  const exitConfirmed = useRef(false)
  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', (e) => {
      if (d.phase !== 'driving' || exitConfirmed.current) return
      e.preventDefault()
      Alert.alert(voice.confirm.endTitle, undefined, [
        { text: voice.confirm.keepRolling, style: 'cancel' },
        {
          text: voice.confirm.end,
          style: 'destructive',
          onPress: () => {
            exitConfirmed.current = true // let the re-dispatched action through (no loop)
            navigation.dispatch(e.data.action)
          },
        },
      ])
    })
    return sub
  }, [navigation, d.phase])

  // Confirm the in-card "Pull over" too — it runs the same unrecoverable reset as a back-out.
  const confirmEnd = useCallback(() => {
    Alert.alert(voice.confirm.endTitle, undefined, [
      { text: voice.confirm.keepRolling, style: 'cancel' },
      { text: voice.confirm.end, style: 'destructive', onPress: d.end },
    ])
  }, [d.end])

  // Auto-scroll the stop list to the active (or next) stop as the drive progresses.
  // Scale the row height by the user's font scale — rows are minHeight + grow with
  // Dynamic Type, so a fixed STOP_ROW_HEIGHT would undershoot the target at large text.
  const focusSeq = d.activeSeq ?? d.nextSeq
  // Row index of the current segment's stop (preview's passed/active stop-list state).
  const focusRow = focusSeq != null ? d.stops.findIndex((s) => s.seq === focusSeq) : -1
  // Don't yank the list back while the rider is browsing the itinerary: mark a drag live on
  // begin, and keep it "browsing" for a grace window after they let go so a stop transition
  // mid-browse doesn't snatch the list — auto-scroll resumes on the next transition at rest.
  const userBrowsing = useRef(false)
  const browseGrace = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onScrollBeginDrag = useCallback(() => {
    userBrowsing.current = true
    if (browseGrace.current) clearTimeout(browseGrace.current)
  }, [])
  const onScrollSettled = useCallback(() => {
    if (browseGrace.current) clearTimeout(browseGrace.current)
    browseGrace.current = setTimeout(() => {
      userBrowsing.current = false
    }, 5000)
  }, [])
  useEffect(
    () => () => {
      if (browseGrace.current) clearTimeout(browseGrace.current)
    },
    [],
  )
  // Keyed on focusRow (a NUMBER) — NOT d.stops, which rebuilt every audio tick and re-fired
  // this scroll several times a second, pinning the list. Now it moves only when the focused
  // stop actually changes, and never while the rider is browsing.
  useEffect(() => {
    if (focusRow < 0 || userBrowsing.current) return
    const rowH = STOP_ROW_HEIGHT * PixelRatio.getFontScale()
    listRef.current?.scrollTo({ y: Math.max(0, (focusRow - 1) * rowH), animated: true })
  }, [focusRow])

  // Drive-complete beat: on arrival, ease the rig in to the end of the trail — "pulled into
  // the driveway". Reduce Motion jumps straight to 100%. (The stamp cascade rides StopRow.)
  const reduce = useReducedMotion()
  useEffect(() => {
    if (d.phase !== 'done') return
    if (reduce) {
      d.progress.setValue(1)
      return
    }
    Animated.timing(d.progress, {
      toValue: 1,
      duration: duration.slow,
      useNativeDriver: false,
    }).start()
  }, [d.phase, reduce, d.progress])

  if (d.phase === 'gate')
    // Only the LIVE/SIM drive can gate — preview uses the open `?preview=1` funnel and never
    // 401s, so it never reaches this phase (every tour is previewable; the wall is the drive).
    return (
      <AccountGate
        note={voice.gate.driveNote}
        // "Just take the sample ride" now keeps its promise: swap the gated live drive for the
        // open couch preview (the funnel), instead of a no-op back().
        secondaryAction={{
          label: voice.gate.secondary,
          onPress: () => router.replace(`/tours/${id}/play?mode=preview`),
        }}
      />
    )

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
      ? voice.player.bracketIntro
      : voice.player.bracketOutro
    : (activeStop?.name ?? d.hostName)
  const nextStop = d.nextSeq != null ? d.stops.find((s) => s.seq === d.nextSeq) : undefined
  const nextName = nextStop?.name

  // ── ONE player card, FIVE states ──────────────────────────────────────────────
  // Collapse the done / ready / rest / active-clip / rolling variants into a single
  // config (kicker, title, optional badge + timer, glow, and which transport to show),
  // then render ONE elevated card instead of five sibling cards. `mid` is the card's
  // state-dependent middle: a body line (ready/done) or the Scrubber (driving). The
  // transport stays at the bottom of the same card.
  const restState = d.currentKind === 'rest'
  const showReady = !isPreview && d.phase === 'ready'
  const showScrubber = !showReady && d.phase !== 'done'

  type CardConfig = {
    kicker: string
    title: string
    body?: string
    timer?: string
    badge?: { tone: BadgeTone; label: string }
    glow: boolean
  }
  let card: CardConfig
  if (d.phase === 'done') {
    card = {
      kicker: voice.player.driveCompleteKicker,
      title: voice.player.arrived,
      body: voice.driveComplete,
      timer: `${d.totalStops} STOPS`, // the trip tally as a stamped odometer reading
      glow: true, // the final beat: the done card takes the screen's one amber glow
    }
  } else if (showReady) {
    card = {
      kicker: voice.drive.ready,
      title: d.tourName,
      body: voice.drive.readyBody,
      glow: false,
    }
  } else if (restState) {
    // A silent break stop — a "good spot to stretch" pit-stop (no halo).
    card = { kicker: voice.player.pitStop, title: nextName ?? voice.player.restFallback, glow: false }
  } else if (d.activeSeq != null) {
    // A loaded clip. A held clip dims the halo and stops claiming "NOW PLAYING".
    card = {
      kicker: d.nowPlaying ? voice.player.nowPlaying : voice.player.paused,
      title: nowTitle,
      glow: d.nowPlaying,
      badge: activeStop
        ? { tone: stopTone(activeStop.stopType), label: stopLabel(activeStop.stopType) }
        : undefined,
    }
  } else {
    // Between stops: transit, not a stop — the amber halo stays OFF (the route track
    // keeps the single between-stops glow). kicker → big destination title → next badge.
    card = {
      kicker: nextName ? `${voice.player.rolling} · ${voice.drive.nextStop}` : voice.player.rolling,
      title: nextName ?? voice.player.rollingOpen,
      timer:
        d.rollingDistanceM != null ? `~${(d.rollingDistanceM / 1609).toFixed(1)} mi` : undefined,
      glow: false,
      badge: nextStop
        ? { tone: stopTone(nextStop.stopType), label: stopLabel(nextStop.stopType) }
        : undefined,
    }
  }

  const transport =
    d.phase === 'done' ? (
      <TransportBar
        single={{
          icon: 'restart',
          title: voice.cta.restart,
          onPress: d.restart,
          glow: false, // the lit done card owns the glow now (one-amber budget)
          secondary: { title: voice.cta.backToTrailhead, onPress: () => navigation.goBack() },
        }}
      />
    ) : showReady ? (
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
        secondary={isPreview ? undefined : { title: voice.cta.endDrive, onPress: confirmEnd }}
      />
    )

  return (
    <Screen edges={['bottom']}>
      {/* Edge-swipe back is allowed when parked but DISABLED while a drive is rolling (a stray
          swipe shouldn't kill the run — the back chevron confirms instead). Also stop the
          Scrubber drag from triggering the iOS-26 whole-screen back gesture (preview's fix). */}
      <Stack.Screen
        options={{
          title: isPreview ? 'Preview drive' : 'Drive',
          gestureEnabled: d.phase !== 'driving',
          fullScreenGestureEnabled: false,
        }}
      />

      <View style={styles.header}>
        <Text variant="title" color="ink">
          {d.tourName}
        </Text>
        <Text variant="dim" color="inkDim">
          {isPreview ? (
            // Rider-facing: no "simulated drive" dev-vocab — the "preview of the full drive"
            // line already says what this is.
            <>
              {d.region}
              {d.totalPreviewMs != null && d.totalRealMs != null
                ? ` · ${mmss(d.totalPreviewMs)} preview of the full ${mmss(d.totalRealMs)} drive`
                : ' · preview'}
            </>
          ) : (
            <>
              {d.region} · {driveMode === 'live' ? 'live drive' : 'simulated drive'} ·{' '}
              {d.firedCount}/{d.totalStops} stops
            </>
          )}
        </Text>
      </View>

      {/* Route trail with the car token. The halo is a DRIVING cue only — lit between stops
          while rolling. In ready the Play CTA owns the glow; in done the lit card does; while
          a clip plays the NOW card does. So the §8 one-amber budget holds in every state. */}
      <RouteTrack
        progress={d.progress}
        glow={d.activeSeq === null && d.phase === 'driving'}
        style={styles.track}
      />

      {/* Itinerary — the middle (flex:1) between the trail and the player. The same StopList
          card as tour detail, but here it's a FIXED shell: all four rounded corners stay put
          while only the rows scroll inside it. Tappable in PREVIEW (jump there); read-only on
          a real/sim drive — the hint sits right above. The drive-complete cascade stamps the
          passed checks in. */}
      {isPreview ? (
        <Text variant="dim" color="inkFaint" style={styles.hint}>
          {voice.player.previewHint}
        </Text>
      ) : null}
      <StopList
        scroll
        scrollRef={listRef}
        onScrollBeginDrag={onScrollBeginDrag}
        onScrollEndDrag={onScrollSettled}
        onMomentumScrollEnd={onScrollSettled}
        style={styles.listCard}
        onPressItem={isPreview ? d.jumpToStop : undefined}
        enterStamp={d.phase === 'done' && !reduce}
        items={d.stops.map((s, i) => {
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
          return {
            seq: s.seq,
            name: s.name,
            sublabel: stopLabel(s.stopType),
            icon: stopIcon(s.stopType),
            state,
          }
        })}
      />

      {/* ── PLAYER CARD ── now-playing + scrubber + transport, contained in ONE elevated
          card anchored to the bottom edge. A dashed rule fences it off from the itinerary
          above; the card sizes to its content (no fixed reserve) so it hugs the bottom. */}
      <Divider dashed style={styles.divider} />

      {/* GPS acquisition — a missing fix reads as a "still finding you" status, not a
          fault with the current clip. Sits just above the card. */}
      {d.gpsSearching && !d.paused ? (
        <View style={styles.gpsSearch} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color={theme.colors.accent} />
          <Text variant="dim" color="inkFaint">
            {voice.player.gpsSearching}
          </Text>
        </View>
      ) : null}

      {/* Sim setup — pre-drive only, SIM mode only (the on-device drive simulator's one knob;
          a live drive runs at real GPS speed, so the time-scale toggle is meaningless). Sits
          just above the card so the card stays purely the player. */}
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

      <View style={styles.cardWrap}>
        <NowCard
          liveRegion
          glow={card.glow}
          kicker={card.kicker}
          title={card.title}
          timer={card.timer}
          right={card.badge ? <Badge tone={card.badge.tone} label={card.badge.label} /> : undefined}
          transport={transport}
        >
          {card.body ? (
            <Text variant="body" color="inkDim">
              {card.body}
            </Text>
          ) : null}

          {/* In-clip position bar — mounted only while a clip is loaded. Between stops it
              COLLAPSES (no reserved height): the rolling card hugs kicker → title →
              transport, and the scrubber reappearing at the next clip reads as part of
              that wholesale state swap, not a layout jump. (Founder call 2026-06-09 — the
              old reserved-but-hidden scrubber read as unnecessary blank space.) */}
          {showScrubber && d.activeSeq != null ? (
            <Scrubber
              positionMs={d.positionMs}
              durationMs={d.durationMs}
              onSeek={d.seekToMs}
              onScrubbingChange={d.setScrubbing}
              disabled={!d.canSeek}
            />
          ) : null}

          {d.buffering ? (
            <View style={styles.buffering}>
              <ActivityIndicator size="small" color={theme.colors.accent} />
              <Text variant="dim" color="inkFaint">
                {voice.player.buffering}
              </Text>
            </View>
          ) : d.stallNote ? (
            <Text variant="dim" color="danger">
              {d.stallNote}
            </Text>
          ) : null}
        </NowCard>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: space.gutter, paddingTop: space.md, gap: space.xs },
  track: { marginHorizontal: space.gutter, marginTop: space.md },
  // paddingBottom stacks with the safe-area inset where one exists, and supplies a minimum of
  // air on zero-bottom-inset devices (button-nav Android, SE-class) so the card + its "Pull
  // over" ghost never land flush on the bezel.
  cardWrap: { paddingHorizontal: space.gutter, marginTop: space.sm, paddingBottom: space.sm },
  buffering: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  gpsSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.gutter,
    marginTop: space.md,
  },
  hint: { paddingHorizontal: space.gutter, paddingTop: space.md, paddingBottom: space.sm }, // preview only
  simRow: { paddingHorizontal: space.gutter, marginTop: space.lg, gap: space.sm },
  simBtns: { flexDirection: 'row', gap: space.sm },
  divider: { marginTop: space.sm, marginBottom: space.sm }, // fence between the list and the player dock
  // The fixed itinerary shell: fills the slack between the trail and the player dock, with the
  // gutter margins the rest of the screen uses. Only its rows scroll (StopList `scroll`).
  listCard: { flex: 1, marginHorizontal: space.gutter, marginTop: space.sm },
})
