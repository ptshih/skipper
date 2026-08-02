// The live, GPS-triggered driving player. The skipper talks when the road reaches a
// stop, not on a timer. TWO clocks behind one code path (the `?mode=` param), both in
// `useDrive`: the couch SIMULATOR (default in dev — testable on the iOS Simulator, no
// device GPS) and the real device GPS (`?mode=live`, Phase 4). (The old map-less couch
// PREVIEW clock was cut — auditioning a drive is the native per-stop mini-preview on the
// drive-detail page now; see docs/decisions/detail-page-mini-preview.md.) Reuses the @/ui
// player primitives; the clock + fire-queue + source swap live in `useDrive`.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Animated, PixelRatio, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import * as SecureStore from 'expo-secure-store'
import { useDrive } from '@/lib/useDrive'
import { track } from '@/lib/analytics'
import { isSignedIn, useSession } from '@/lib/auth'
import { isOfflineNow } from '@/lib/connectivity'
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
  LocationGate,
  LocationPrime,
  AttributionButton,
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

export default function DriveScreen() {
  const theme = useTheme()
  const { id, mode } = useLocalSearchParams<{ id: string; mode?: string }>()
  // 'live' = real device GPS (Phase 4); the default is the on-device SIMULATOR (couch-testable).
  // An unrecognized/missing mode falls back to 'sim' in DEV but to 'live' in RELEASE — the dev
  // clock must never be one malformed deep link away from a production rider (the couch PREVIEW
  // that used to be that release fallback is gone; auditioning is the drive-detail mini-preview).
  // The global Settings → Developer sim toggle swaps the real-GPS 'live' drive for the on-device
  // SIMULATOR, so it wins over an explicit `?mode=live`.
  const { simMode } = useSimMode()
  const driveMode: 'sim' | 'live' = simMode
    ? 'sim'
    : mode === 'live'
      ? 'live'
      : __DEV__
        ? 'sim'
        : 'live'
  // When the GLOBAL dev toggle forced sim, default the replay to fast (couch-testing a full drive
  // at 1× is impractical); the plain dev-fallback sim keeps real-time so trigger-timing tests are
  // unchanged. The pre-drive knob still lets the rider switch. (simMode ⟹ driveMode==='sim'.)
  const d = useDrive(id, { mode: driveMode, defaultFast: simMode })

  // Map ⇄ List — the real map (route + live puck) or the bare itinerary. List stays the
  // offline + accessibility-complete equivalent; the choice persists across sessions.
  const [savedView, setSavedView] = useState<PlayerView>('map')
  useEffect(() => {
    SecureStore.getItemAsync(VIEW_KEY)
      .then((v) => {
        if (v === 'map' || v === 'list') setSavedView(v)
      })
      .catch(() => {})
  }, [])
  // An explicit tap this session outranks the offline auto-flip below — the rider gets the last word.
  const [pickedView, setPickedView] = useState(false)
  const changeView = useCallback((next: PlayerView) => {
    setPickedView(true)
    setSavedView(next)
    SecureStore.setItemAsync(VIEW_KEY, next).catch(() => {})
  }, [])
  // Basemap tiles are network-only, so in a dead zone Map is our route line and puck floating on a
  // blank field, while List is complete. OPEN on List instead — DERIVED, never a setState: writing
  // it back would quietly overwrite a preference the rider set in town and never asked to change.
  // They can still tap Map (a blank basemap with the route drawn is a legitimate thing to want).
  //
  // ⚠ LATCHED at mount, not read live. Map and List are two different trees (Map floats the player
  // as a peek sheet; List is a fixed shell with its own scroll position), and Tahoe coverage flaps —
  // so reading the live verdict would re-lay-out the screen, mid-drive, repeatedly, with the rider
  // touching nothing. The verdict at the moment the player opens is the one that matters.
  // A lazy `useState` initialiser rather than `useRef(isOfflineNow()).current`: React runs it exactly
  // once, so the latch is the same — but the old form also CALLED `isOfflineNow()` on every render and
  // discarded the answer, and it read a ref during render (react-hooks/refs).
  const [offlineAtOpen] = useState(isOfflineNow)
  const view: PlayerView = !pickedView && offlineAtOpen && savedView === 'map' ? 'list' : savedView
  // Map mode floats the player as an expandable PEEK sheet (mini-bar ↔ full card). Pre-drive
  // (ready) and arrival (done) force the full card — there's nothing to peek past.
  const [expanded, setExpanded] = useState(false)

  const listRef = useRef<ScrollView | null>(null)
  const navigation = useNavigation()
  const router = useRouter()
  const { data: session } = useSession()

  // Returning from /sign-in lands back on this STILL-MOUNTED screen, but useDrive's load
  // effect watches only [driveId, reloadKey, mode] — nothing the session — so a rider who just
  // got their free ticket would otherwise sit on the same gate. Re-check ONCE per signed-in
  // user while gated; retry() bumps reloadKey → re-fetches → drops them straight into the drive.
  //
  // ⚠ INV-9: this goes through isSignedIn, not a bare `session?.user?.id`. After 1.1's anonymous
  // mint EVERY rider holds a session with a real user id, so a bare read is non-null for a rider
  // the server will still 401 — the retry would fire a GET /drives/:id that bounces straight back
  // to `phase: 'gate'`, one wasted round-trip per gated open. Gating on the same predicate the
  // server's tierOf keys on means the retry fires exactly when it can succeed. (The ref then holds
  // the REAL account id, so the retry after signup still runs — the anon id never enters it, which
  // is also INV-4: nothing may key state on an id better-auth hard-deletes at link.)
  const signedInUserId = isSignedIn(session) ? (session?.user?.id ?? null) : null
  const retriedForUser = useRef<string | null>(null)
  useEffect(() => {
    if (d.phase === 'gate' && signedInUserId && retriedForUser.current !== signedInUserId) {
      retriedForUser.current = signedInUserId
      d.retry()
    }
  }, [d.phase, signedInUserId, d.retry])

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
  // Row index of the focused stop (the active clip, else the next one) — the auto-scroll target.
  const focusRow = focusSeq != null ? d.stops.findIndex((s) => s.seq === focusSeq) : -1
  // Per-stop state, shared by the itinerary List rows and the Map markers. Memoized (NOT rebuilt every
  // ~500ms status tick) so the React.memo'd DriveMap doesn't re-render its marker tree on each tick.
  // Hoisted above the phase early-returns so the hook order stays unconditional. (audit #549)
  const stopViews = useMemo(
    () =>
      d.stops.map((s) => {
        const state: 'passed' | 'active' | 'upcoming' =
          d.phase === 'done' || (d.firedSeqs.has(s.seq) && s.seq !== d.activeSeq)
            ? 'passed'
            : s.seq === d.activeSeq
              ? 'active'
              : 'upcoming'
        return { seq: s.seq, name: s.name, stopType: s.stopType, lat: s.lat, lng: s.lng, state }
      }),
    [d.stops, d.phase, d.firedSeqs, d.activeSeq],
  )
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

  // wall_shown — the account wall a rider meets when they open a DRIVE without an account, which is a
  // different entrance from the one in the planner (a drive is owned, so merely loading it 401s).
  // ⚠ An EFFECT, not a line beside the `return <AccountGate/>` below: that branch re-runs on every
  // render of a gated screen, so emitting there would report render count, not walls. Latched because
  // `phase` can settle back onto 'gate' — the rider must be counted as having hit one wall, once.
  const gateSeenRef = useRef(false)
  useEffect(() => {
    if (d.phase !== 'gate' || gateSeenRef.current) return
    gateSeenRef.current = true
    track('wall_shown', { source: 'drive_play' })
  }, [d.phase])

  if (d.phase === 'gate')
    // A drive is owned (account-gated), so loading it at all needs a free account — the gate catches
    // the 401 here. "Just take the sample ride" used to route to ?mode=preview of THIS drive, which
    // re-hit the same account-gated fetch and 401'd straight back to this gate — an anonymous rider
    // looped forever. It now routes to /sample (the curated postcard), which is the real, working
    // anonymous taste — unifying the two half-built "sample" ideas into one and killing the loop.
    return (
      <AccountGate
        note={voice.gate.driveNote}
        secondaryAction={{
          label: voice.gate.secondary,
          onPress: () => router.replace('/sample'),
        }}
      />
    )

  if (d.phase === 'locationPrime')
    // Pre-permission explainer, shown ONCE before iOS's one-shot prompt (live drive, first time).
    // Single CTA into the OS prompt — no dismiss button (App Store 5.1.1(iv)); back out via the header.
    return <LocationPrime title="Drive" onContinue={d.confirmLocationPrime} />

  if (d.phase === 'locationGate')
    return (
      <LocationGate
        title="Drive"
        reduced={d.locationReduced}
        canAskAgain={d.locationCanAskAgain}
        onAllow={d.start}
        onOpenSettings={d.openLocationSettings}
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
  if (d.phase === 'loading') return <StateView title="Drive" loading message={voice.loading.drive} />

  const activeStop = d.activeSeq != null ? d.stops.find((s) => s.seq === d.activeSeq) : undefined
  const nowTitle = activeStop?.name ?? d.hostName
  // Credit follows whatever the card is currently ABOUT — so it appears with the stop and clears
  // between stops, rather than crediting a source while the skipper is talking about nothing.
  const activeAttribution = activeStop?.attribution
  const nextStop = d.nextSeq != null ? d.stops.find((s) => s.seq === d.nextSeq) : undefined
  const nextName = nextStop?.name

  // ── ONE player card, FIVE states ──────────────────────────────────────────────
  // Collapse the done / ready / rest / active-clip / rolling variants into a single
  // config (kicker, title, optional badge + timer, glow, and which transport to show),
  // then render ONE elevated card instead of five sibling cards. `mid` is the card's
  // state-dependent middle: a body line (ready/done) or the Scrubber (driving). The
  // transport stays at the bottom of the same card.
  const showReady = d.phase === 'ready'
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
      title: d.driveName,
      body: voice.drive.readyBody,
      glow: false,
    }
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
      <TransportBar
        playing={!d.paused}
        playLabel={voice.cta.resume}
        onPlayPause={d.togglePause}
        onSeekBack={() => d.seekBy(-15)}
        onSeekForward={() => d.seekBy(15)}
        canSeek={d.canSeek}
        secondary={{ title: voice.cta.endDrive, onPress: confirmEnd }}
      />
    )

  // The Map ⇄ List header switch (real-map spec §4).
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
            // The 30×36 segment is below the 48pt in-car tap floor and it's a MID-DRIVE control —
            // lift the effective target past ~48pt (height 30+24, width 36+12). (M5)
            hitSlop={{ top: 12, bottom: 12, left: 6, right: 6 }}
            style={[styles.toggleBtn, on && { backgroundColor: theme.colors.accent }]}
          >
            <Icon name={m} size={15} color={on ? 'onPrimary' : 'inkDim'} />
          </Pressable>
        )
      })}
    </View>
  )

  // Offline chip (M7): a quiet "playing from download" flag when the drive loaded entirely off the
  // saved copy (zero network). Same icon + accent tone as the drive-detail "Saved offline" chip, so
  // the two surfaces read as one idea.
  const offlineChip =
    d.offline ? (
      <View
        style={[styles.offlineChip, { backgroundColor: theme.colors.surfaceRaised, borderColor: theme.colors.rule }]}
        accessibilityLiveRegion="polite"
      >
        <Icon name="downloaded" size={14} color="accent" />
        <Text variant="label" color="accent">
          {voice.player.offlinePlayback}
        </Text>
      </View>
    ) : null

  // The player card — now-playing + scrubber + transport in ONE elevated card. Shared by the
  // List dock and the Map mode's expanded sheet.
  const playerCard = (
    <NowCard
      liveRegion
      glow={card.glow}
      kicker={card.kicker}
      title={card.title}
      timer={card.timer}
      right={
        card.badge || activeAttribution?.length ? (
          <View style={styles.headerRight}>
            {card.badge ? <Badge tone={card.badge.tone} label={card.badge.label} /> : null}
            {/* The ⓘ that reveals THIS stop's source(s) — the app-wide affordance (unified). */}
            <AttributionButton items={activeAttribution} />
          </View>
        ) : undefined
      }
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
      {/* Between stops, once a clip has ended: one big "Replay that" tap to re-hear it — the gap the
          scrubber (active-clip only) can't reach. A live GPS trigger preempts it. (replay-last-stop) */}
      {d.canReplay ? (
        <Button
          title={voice.player.replay}
          icon="restart"
          variant="secondary"
          onPress={d.replayLast}
          accessibilityLabel={voice.player.replay}
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
            title: 'Drive',
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

          {/* Top-of-map status chips: the offline flag + (when acquiring) the GPS-searching cue,
              stacked so they don't overlap. */}
          {(offlineChip || (d.gpsSearching && !d.paused)) ? (
            <View style={styles.mapChips} pointerEvents="none">
              {offlineChip}
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
                  {
                    backgroundColor: theme.colors.surfaceRaised,
                    borderColor: theme.colors.amberToken,
                    // Cross-platform cast (DESIGN §4) — renders on Android too, not a flat Material
                    // shadow. The negative offsetY lifts the cast UP toward the map above. (M4)
                    boxShadow: [{ offsetX: 0, offsetY: -4, blurRadius: 14, color: theme.colors.shadowCast }],
                  },
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
          Scrubber drag from triggering the iOS-26 whole-screen back gesture. */}
      <Stack.Screen
        options={{
          title: 'Drive',
          gestureEnabled: d.phase !== 'driving',
          fullScreenGestureEnabled: false,
          headerRight: viewToggle,
        }}
      />

      <View style={styles.header}>
        <Text variant="title" color="ink">
          {d.driveName}
        </Text>
        <Text variant="dim" color="inkDim">
          {driveMode === 'live' ? 'live drive' : 'simulated drive'} · {d.firedCount}/{d.totalStops} stops
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

      {/* The itinerary (flex:1) — a FIXED shell: all four rounded corners stay put while only the
          rows scroll; read-only on the drive (auditioning per-stop is the drive-detail mini-preview);
          the drive-complete cascade stamps the passed checks in. (Map mode is a separate full-bleed
          layout above.) */}
      <StopList
        scroll
        scrollRef={listRef}
        onScrollBeginDrag={onScrollBeginDrag}
        onScrollEndDrag={onScrollSettled}
        onMomentumScrollEnd={onScrollSettled}
        style={styles.listCard}
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

      {/* Offline flag (M7): a quiet "playing from download" chip when the drive is running off the
          saved copy. Centered, just above the card — mirrors the map mode's top chip. */}
      {offlineChip ? <View style={styles.listChip}>{offlineChip}</View> : null}

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
  // The card header's trailing cluster: the stop-type badge + the ⓘ source affordance, side by side.
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
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
  // Offline "playing from download" chip (M7) — a quiet pill, shared by both modes' status rows.
  offlineChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    borderWidth: border.hair,
  },
  listChip: { alignItems: 'center', marginTop: space.md }, // centers the offline chip in list mode
  simRow: { paddingHorizontal: space.gutter, marginTop: space.lg, gap: space.sm },
  simBtns: { flexDirection: 'row', gap: space.sm },
  divider: { marginTop: space.sm, marginBottom: space.sm }, // fence between the list and the player dock
  // The fixed itinerary shell: fills the slack between the trail and the player dock, with the
  // gutter margins the rest of the screen uses. Only its rows scroll (StopList `scroll`).
  listCard: { flex: 1, marginHorizontal: space.gutter, marginTop: space.sm },
  // ── Map mode: a full-bleed map with the player floating as a peek/expand sheet ──
  mapFill: { flex: 1 },
  // Top-of-map status stack (offline flag + GPS-searching cue) — absolutely positioned, centered.
  mapChips: { position: 'absolute', top: space.md, left: 0, right: 0, alignItems: 'center', gap: space.sm },
  mapGps: {
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
    // The cast is a cross-platform boxShadow set inline (it needs the theme's shadowCast color). (M4)
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
