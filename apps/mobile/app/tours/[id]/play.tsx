// The live, GPS-triggered driving player. The skipper talks when the road reaches a
// stop, not on a timer. THREE clocks behind one code path (the `?mode=` param), all in
// `useDrive`: the couch SIMULATOR (default — testable on the iOS Simulator, no device
// GPS), the real device GPS (`?mode=live`, Phase 4), and the map-less PREVIEW
// (`?mode=preview`) — the anonymous-friendly couch SIMULATED DRIVE that walks a
// compressed segment timeline (clip / drive / rest), tappable stops, no GPS or permission
// gate. Reuses the @/ui player primitives; the clock + fire-queue + source swap live in
// `useDrive`.
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Animated, PixelRatio, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import * as SecureStore from 'expo-secure-store'
import { useDrive } from '@/lib/useDrive'
import { useSession } from '@/lib/auth'
import { useSimMode } from '@/lib/sim-mode'
import { stopLabel } from '@/lib/labels'
import { useReducedMotion, useTheme } from '@/theme'
import { border, duration, radius, space } from '@/theme/tokens'
import {
  AccountGate,
  Badge,
  Button,
  Divider,
  Icon,
  LocationPrime,
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
import { DriveMap } from '@/ui/DriveMap'
import type { BadgeTone } from '@/ui'

// Map vs List is a per-rider preference that survives sessions (real-map spec §4).
const VIEW_KEY = 'skipper.drivePlayerView'
type PlayerView = 'map' | 'list'
import { formatMmssMs, METERS_PER_MILE } from '@skipper/drive-core'

export default function DriveScreen() {
  const theme = useTheme()
  const { id, mode } = useLocalSearchParams<{ id: string; mode?: string }>()
  // 'live' = real device GPS (Phase 4); 'preview' = the couch SIMULATED DRIVE (anonymous,
  // no GPS, tappable stops). An unrecognized/missing mode falls back to the dev simulator in
  // dev, but to the open couch PREVIEW in release — the dev clock must never be one malformed
  // deep link away from a production rider.
  // The global Settings → Developer sim toggle swaps the real-GPS 'live' drive (and the
  // release fallback) for the on-device SIMULATOR — but never overrides an explicit
  // `?mode=preview` (that anonymous funnel is GPS-less by design and stays untouched).
  const { simMode } = useSimMode()
  const driveMode =
    mode === 'preview'
      ? 'preview'
      : simMode
        ? 'sim'
        : mode === 'live'
          ? 'live'
          : __DEV__
            ? 'sim'
            : 'preview'
  // When the GLOBAL dev toggle forced sim, default the replay to fast (couch-testing a full
  // tour at 1× is impractical); explicit ?mode=sim / the dev fallback keep real-time so
  // trigger-timing tests are unchanged. The pre-drive knob still lets the rider switch.
  const d = useDrive(id, { mode: driveMode, defaultFast: simMode && driveMode === 'sim' })
  const isPreview = driveMode === 'preview'

  // Map ⇄ List — the real map (route + live puck) or the bare itinerary. List stays the
  // offline + accessibility-complete equivalent; the choice persists across sessions.
  const [view, setView] = useState<PlayerView>('map')
  useEffect(() => {
    SecureStore.getItemAsync(VIEW_KEY)
      .then((v) => {
        if (v === 'map' || v === 'list') setView(v)
      })
      .catch(() => {})
  }, [])
  const changeView = useCallback((next: PlayerView) => {
    setView(next)
    SecureStore.setItemAsync(VIEW_KEY, next).catch(() => {})
  }, [])
  // Map mode floats the player as an expandable PEEK sheet (mini-bar ↔ full card). Pre-drive
  // (ready) and arrival (done) force the full card — there's nothing to peek past.
  const [expanded, setExpanded] = useState(false)

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

  if (d.phase === 'locationPrime')
    // Pre-permission explainer, shown ONCE before iOS's one-shot prompt (live drive, first time).
    // Single CTA into the OS prompt — no dismiss button (App Store 5.1.1(iv)); back out via the header.
    return <LocationPrime title="Drive" onContinue={d.confirmLocationPrime} />

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
        d.rollingDistanceM != null ? `~${(d.rollingDistanceM / METERS_PER_MILE).toFixed(1)} mi` : undefined,
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

  // Per-stop state, shared by the itinerary List rows and the Map markers.
  const stopViews = d.stops.map((s, i) => {
    const state: 'passed' | 'active' | 'upcoming' = isPreview
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
    return { seq: s.seq, name: s.name, stopType: s.stopType, lat: s.lat, lng: s.lng, state }
  })

  // The Map ⇄ List header switch (real-map spec §4). Hidden in preview-on-a-zero-route
  // edge cases by simply having no polyline → the map shows an empty basemap, still valid.
  const viewToggle = () => (
    <View style={[styles.toggle, { backgroundColor: theme.colors.surfaceRaised, borderColor: theme.colors.rule }]}>
      {(['map', 'list'] as const).map((m) => {
        const on = view === m
        return (
          <Pressable
            key={m}
            onPress={() => changeView(m)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={m === 'map' ? 'Map view' : 'List view'}
            style={[styles.toggleBtn, on && { backgroundColor: theme.colors.accent }]}
          >
            <Icon name={m} size={15} color={on ? 'onPrimary' : 'inkDim'} />
          </Pressable>
        )
      })}
    </View>
  )

  // The player card — now-playing + scrubber + transport in ONE elevated card. Shared by the
  // List dock and the Map mode's expanded sheet.
  const playerCard = (
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
  )

  // ── MAP mode: a full-bleed map with the player floating as an expandable PEEK sheet ──
  // Collapsed = a mini-bar (play/pause + title + progress); tap to expand to the full card
  // (scrubber + ±15 transport). Ready/done force the full card. Recenter chip rides on the map.
  if (view === 'map') {
    const sheetExpanded = d.phase !== 'driving' || expanded
    const pct = Math.min(100, (d.positionMs / Math.max(1, d.durationMs)) * 100)
    return (
      <Screen edges={['bottom']}>
        <Stack.Screen
          options={{
            title: isPreview ? 'Preview drive' : 'Drive',
            gestureEnabled: d.phase !== 'driving',
            fullScreenGestureEnabled: false,
            headerRight: viewToggle,
          }}
        />
        <View style={styles.mapFill}>
          <DriveMap
            polyline={d.polyline}
            stops={stopViews}
            progress={d.progress}
            clipActive={d.activeSeq != null}
            hideRecenter={sheetExpanded}
            recenterBottom={96}
          />

          {d.gpsSearching && !d.paused ? (
            <View
              style={[styles.mapGps, { backgroundColor: theme.colors.surfaceRaised, borderColor: theme.colors.rule }]}
              accessibilityLiveRegion="polite"
            >
              <ActivityIndicator size="small" color={theme.colors.accent} />
              <Text variant="dim" color="inkFaint">
                {voice.player.gpsSearching}
              </Text>
            </View>
          ) : null}

          <View style={styles.sheetWrap}>
            {sheetExpanded ? (
              <View>
                {d.phase === 'driving' ? (
                  <Pressable
                    onPress={() => setExpanded(false)}
                    accessibilityRole="button"
                    accessibilityLabel="Collapse player"
                    style={styles.collapseHandle}
                  >
                    <View style={[styles.handleBar, { backgroundColor: theme.colors.rule }]} />
                  </Pressable>
                ) : null}
                {playerCard}
              </View>
            ) : (
              <Pressable
                onPress={() => setExpanded(true)}
                accessibilityRole="button"
                accessibilityLabel="Expand player"
                style={[
                  styles.peekBar,
                  { backgroundColor: theme.colors.surfaceRaised, borderColor: theme.colors.amberToken, shadowColor: theme.colors.shadowCast },
                ]}
              >
                <Pressable
                  onPress={d.togglePause}
                  accessibilityRole="button"
                  accessibilityLabel={d.paused ? voice.cta.resume : voice.cta.pause}
                  style={[styles.peekPlay, { backgroundColor: theme.colors.primaryFill }]}
                >
                  <Icon name={d.paused ? 'play' : 'pause'} size={22} color="onPrimary" />
                </Pressable>
                <View style={styles.peekText}>
                  <Text variant="label" color="accentWarm">
                    {card.kicker}
                  </Text>
                  <Text variant="bodyStrong" color="ink" numberOfLines={1}>
                    {card.title}
                  </Text>
                  {d.activeSeq != null ? (
                    <View style={[styles.peekTrack, { backgroundColor: theme.colors.surfaceSunken }]}>
                      <View style={[styles.peekFill, { backgroundColor: theme.colors.trackActive, width: `${pct}%` }]} />
                    </View>
                  ) : null}
                </View>
                <Icon name="chevronUp" size={20} color="inkFaint" />
              </Pressable>
            )}
          </View>
        </View>
      </Screen>
    )
  }

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
          headerRight: viewToggle,
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
                ? ` · ${formatMmssMs(d.totalPreviewMs)} preview of the full ${formatMmssMs(d.totalRealMs)} drive`
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

      {/* The itinerary (flex:1) — a FIXED shell: all four rounded corners stay put while only
          the rows scroll; tappable in PREVIEW (jump there), read-only on a real/sim drive (the
          hint sits right above); the drive-complete cascade stamps the passed checks in. (Map
          mode is a separate full-bleed layout above.) */}
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
        items={stopViews.map((s) => ({
          seq: s.seq,
          name: s.name,
          sublabel: stopLabel(s.stopType),
          icon: stopIcon(s.stopType),
          state: s.state,
        }))}
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

      <View style={styles.cardWrap}>{playerCard}</View>
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
  // ── Map mode: a full-bleed map with the player floating as a peek/expand sheet ──
  mapFill: { flex: 1 },
  mapGps: {
    position: 'absolute',
    top: space.md,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: border.hair,
  },
  sheetWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.sm, paddingBottom: space.sm },
  collapseHandle: { alignItems: 'center', paddingTop: space.xs, paddingBottom: space.sm },
  handleBar: { width: 40, height: 4, borderRadius: 2 },
  peekBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.lg,
    borderWidth: border.keyline,
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: -4 },
    elevation: 8,
  },
  peekPlay: { width: 50, height: 50, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  peekText: { flex: 1, minWidth: 0, gap: 3 },
  peekTrack: { height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 2 },
  peekFill: { height: '100%' },
  // Map ⇄ List header segmented control.
  toggle: { flexDirection: 'row', padding: 2, gap: 2, borderRadius: radius.pill, borderWidth: border.hair },
  toggleBtn: {
    minWidth: 36,
    height: 30,
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
