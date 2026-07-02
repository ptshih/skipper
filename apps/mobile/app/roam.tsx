// FREE-ROAM (alpha) — the skipper rides shotgun on YOUR drive. No route, no plan:
// fetch the roam pins near here, watch live GPS, and pipe up (pausing the rider's own
// audio while he talks — pause+resume, not ducking) when the road passes a place he knows.
// Flow: tapping "Roam" on home IS the start action — no separate entry screen. Returning
// users auto-start on mount; first-timers see the ambient contract first (shown immediately,
// not gated behind a redundant entry card). Silence is the DEFAULT state — the idle base
// must feel alive (the RoamMotif is the one moving thing), never like a spinner.
// `?mode=sim` replays a fixed demo polyline through the same engine for couch testing.
// The encounter sheet reuses the EXACT story-player transport (Scrubber + play/pause + ±15s)
// so both players feel identical (founder call, superseding the alpha's read-only bar).
// Alpha cuts vs the full design: the encounter PATTER line (grounded, from the roam track), waves
// + B-sides ("Tell me more"), and the offline region pack + logbook wait on their backends —
// honest UI shows none of them.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Animated, Linking, PanResponder, Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import * as SecureStore from 'expo-secure-store'
import { useRoam } from '@/lib/useRoam'
import { RoamMap } from '@/ui/RoamMap'
import { useSimMode } from '@/lib/sim-mode'
import { useReducedMotion, useTheme } from '@/theme'
import { border, duration, radius, space } from '@/theme/tokens'
import {
  Badge,
  Button,
  Card,
  Divider,
  Duck,
  Icon,
  LocationGate,
  LocationPrime,
  RouteTrack,
  Screen,
  Scrubber,
  StateView,
  Text,
  TransportBar,
  voice,
} from '@/ui'

const CONTRACT_SEEN_KEY = 'skipper.roamContractSeen'
/** The sheet's hidden offset (slid fully below the screen). Shared by the show/hide animation AND
 *  the handle drag-to-minimize, so a drag continues the same travel the open animation uses. */
const SHEET_HIDDEN_Y = 320
/** Drag the handle past this distance — or flick faster than this velocity — to minimize. */
const SHEET_DISMISS_DY = 64
const SHEET_DISMISS_VY = 0.5

/** Map nearest-pin distance to a motif loop duration — three calm buckets with wide
 *  dead-zones so routine GPS jitter never flips the speed between renders.
 *  14 s  → idle, no pins near (the unhurried cruise)
 *  11.5 s → a pin on the horizon (a pin has entered range)
 *  9 s   → pulling alongside (pin is close; encounter imminent) */
function toMotifLoopMs(nearestM: number | null): number {
  if (nearestM === null || nearestM > 1500) return 14_000
  if (nearestM > 300) return 11_500
  return 9_000
}

/** The riding-along base's signature: the car token gliding a dashed atlas trail — the
 *  session's ONE moving thing ("alive, not a spinner"). Parked mid-trail under Reduce
 *  Motion; the amber token glow yields while the encounter sheet owns the screen's glow.
 *  Loop speed breathes with the nearest pin: slower when the road is empty, quickening
 *  as a pin approaches — the canvas responds to the drive without adding text or chrome. */
function RoamMotif({ glow, nearestM }: { glow: boolean; nearestM: number | null }) {
  const reducedMotion = useReducedMotion()
  const loopMs = toMotifLoopMs(nearestM)
  const progress = useRef(new Animated.Value(reducedMotion ? 0.45 : 0)).current
  useEffect(() => {
    if (reducedMotion) {
      progress.setValue(0.45)
      return
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, { toValue: 1, duration: loopMs, useNativeDriver: false }),
        Animated.timing(progress, { toValue: 0, duration: 0, useNativeDriver: false }),
      ]),
    )
    loop.start()
    // Reset to 0 on cleanup so the next loop always starts clean from the trail head.
    return () => { loop.stop(); progress.setValue(0) }
  }, [reducedMotion, progress, loopMs])
  // RouteTrack is the existing trail+token primitive — the motif IS that vocabulary. A bolder
  // bed (height 10 vs the default 6) lets the trail anchor the centered idle cluster as the
  // screen's one signature move; the token stays the single moving/glowing amber element (§8).
  return <RouteTrack progress={progress} glow={glow} height={10} />
}

export default function RoamScreen() {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const reducedMotion = useReducedMotion()
  const router = useRouter()
  const { mode } = useLocalSearchParams<{ mode?: string }>()
  // The global Settings → Developer toggle forces sim; the `?mode=sim` deep link still works
  // as a one-off (either path → the simulated drive source).
  const { simMode, showDiag } = useSimMode()
  const roamMode = simMode || mode === 'sim' ? 'sim' : 'live'
  // The drive-test diagnostics line shows on dev builds / sim / the showDiag toggle.
  const diagEnabled = __DEV__ || roamMode === 'sim' || showDiag
  const r = useRoam(roamMode)
  // Glanceable map toggle — the motif is the eyes-on-road default; the map is an opt-in
  // glance (a stop, a passenger). Resets to the motif each session (local, not persisted).
  const [showMap, setShowMap] = useState(false)

  // First-run ambient contract — shown immediately on mount if not yet seen.
  // Returning users skip it and auto-start below.
  const [contractSeen, setContractSeen] = useState<boolean | null>(null)
  const [showContract, setShowContract] = useState(false)
  useEffect(() => {
    SecureStore.getItemAsync(CONTRACT_SEEN_KEY)
      .then((v) => {
        const seen = v === '1'
        setContractSeen(seen)
        if (!seen) setShowContract(true) // first-run: contract before start
      })
      .catch(() => {
        setContractSeen(false)
        setShowContract(true)
      })
  }, [])
  // Auto-start for returning users — tapping "Roam" on home IS the ride-along action.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (contractSeen === true) r.start() }, [contractSeen])
  const onContractAccept = useCallback(() => {
    setShowContract(false)
    SecureStore.setItemAsync(CONTRACT_SEEN_KEY, '1').catch(() => {})
    // The [contractSeen] effect is the SINGLE start trigger — don't ALSO r.start() here, or a
    // first-timer fires start twice (saved only by the startPending guard). (audit #996)
    setContractSeen(true)
  }, [])

  // The encounter sheet slides up over the idle base while a clip plays. It hides when the rider
  // MINIMIZES it (handle drag-down / scrim tap) — the clip plays on, and the peek bar (below) is the
  // one-tap way back. So `sheetVisible` = "a clip is up AND not tucked away".
  const sheetVisible = r.activeName !== null && !r.minimized
  // Safety net: a clip is SOUNDING but the full sheet isn't up (minimized, or any sheet-vs-audio
  // desync) — show the peek bar so audio is NEVER playing with no reachable controls.
  const peekVisible = r.clipSounding && !sheetVisible
  // The rider's own audio is paused only while the skipper is actually talking (a sounding, unheld
  // clip) — so the idle Duck reads that truth even when the sheet is tucked away.
  const musicDucked = r.clipSounding && r.clipPlaying
  const peekPct =
    r.clipDurationMs > 0 ? Math.min(100, (r.clipPositionMs / r.clipDurationMs) * 100) : 0
  const sheetAnim = useRef(new Animated.Value(0)).current
  // A live handle drag adds to the sheet's translateY, combined with the base show/hide travel so a
  // drag continues from where the sheet rests. Both are JS-driven (Animated.add can't mix drivers).
  const dragY = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (sheetVisible) dragY.setValue(0) // a fresh open ignores any leftover drag offset
    if (reducedMotion) {
      sheetAnim.setValue(sheetVisible ? 1 : 0) // appear, don't slide
      return
    }
    Animated.timing(sheetAnim, {
      toValue: sheetVisible ? 1 : 0,
      duration: duration.base,
      useNativeDriver: false,
    }).start()
  }, [sheetVisible, reducedMotion, sheetAnim, dragY])
  // The handle's drag-to-minimize gesture — built ONCE (lazy ref), reading the latest minimizeSheet
  // through a live ref so it never rebuilds mid-drag (the Scrubber's pattern). A deliberate downward
  // drag past the threshold — or a tap on the grip — tucks the sheet away; a short drag snaps back.
  const minimizeLive = useRef(r.minimizeSheet)
  minimizeLive.current = r.minimizeSheet
  const handleResponder = useRef<ReturnType<typeof PanResponder.create> | null>(null)
  if (!handleResponder.current) {
    const tuckAway = () =>
      // Slide the rest of the way down, THEN flip minimized (which unmounts the sheet off-screen —
      // no upward flash). dragY is re-zeroed by the effect above on the next open.
      Animated.timing(dragY, {
        toValue: SHEET_HIDDEN_Y,
        duration: duration.fast,
        useNativeDriver: false,
      }).start(() => minimizeLive.current())
    const snapBack = () =>
      Animated.timing(dragY, { toValue: 0, duration: duration.fast, useNativeDriver: false }).start()
    handleResponder.current = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 4 && g.dy > Math.abs(g.dx),
      // Hold the gesture — never yield to the screen's swipe-back recognizer (the Scrubber note).
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderMove: (_e, g) => {
        if (g.dy > 0) dragY.setValue(g.dy) // follow the finger downward only
      },
      onPanResponderRelease: (_e, g) => {
        const tapped = Math.abs(g.dx) < 6 && Math.abs(g.dy) < 6
        if (tapped || g.dy > SHEET_DISMISS_DY || g.vy > SHEET_DISMISS_VY) tuckAway()
        else snapBack()
      },
      onPanResponderTerminate: snapBack,
    })
  }

  // The idle "wandering thought": under the fixed idleTitle, a placeless murmur from a
  // time-of-day pool slow-crossfades every ~26s — so the quiet reads as a companion enjoying
  // the ride, not a paused app. The clock bucket is a SELECTION knob (picks a pool), never
  // generation. Frozen under Reduce Motion; paused while an encounter sheet owns the screen.
  const murmurBucket = useMemo<keyof typeof voice.roam.idleMurmur>(() => {
    const h = new Date().getHours()
    return h < 10 ? 'morning' : h < 17 ? 'day' : 'dusk'
  }, [])
  const murmurPool = voice.roam.idleMurmur[murmurBucket]
  const [murmurIdx, setMurmurIdx] = useState(() => Math.floor(Math.random() * murmurPool.length))
  const murmurOpacity = useRef(new Animated.Value(1)).current
  useEffect(() => {
    if (r.phase !== 'roaming' || sheetVisible || r.clipSounding) return
    const id = setInterval(() => {
      if (reducedMotion) {
        setMurmurIdx((i) => (i + 1) % murmurPool.length)
        return
      }
      // dip → swap the line at the trough → bring it back, so the change reads as a calm
      // crossfade, not a snap (the only motion here besides the car token).
      Animated.timing(murmurOpacity, {
        toValue: 0,
        duration: duration.fast,
        useNativeDriver: true,
      }).start(() => {
        setMurmurIdx((i) => (i + 1) % murmurPool.length)
        Animated.timing(murmurOpacity, {
          toValue: 1,
          duration: duration.base,
          useNativeDriver: true,
        }).start()
      })
    }, 26_000)
    return () => clearInterval(id)
  }, [r.phase, sheetVisible, r.clipSounding, reducedMotion, murmurPool.length, murmurOpacity])

  const title = voice.roam.entry

  if (showContract)
    return (
      <Screen edges={['bottom']}>
        <Stack.Screen options={{ title }} />
        <View style={styles.body}>
          <Card framed style={styles.card}>
            <View style={[styles.chip, { backgroundColor: colors.surfaceSunken }]}>
              <Icon name="patter" size={22} color="accent" />
            </View>
            <Text variant="placardTitle" color="ink">
              {voice.roam.contract}
            </Text>
            <Text variant="dim" color="inkDim">
              {voice.roam.contractReassure}
            </Text>
          </Card>
          <Button variant="primary" fullWidth onPress={onContractAccept} title={voice.roam.contractCta} />
        </View>
      </Screen>
    )

  if (r.phase === 'locationPrime')
    // Pre-permission explainer before iOS's one-shot prompt (live roam, first time). Single CTA
    // into the OS prompt — no dismiss (App Store 5.1.1(iv)); back out via the header affordance.
    return <LocationPrime title={title} onContinue={r.confirmLocationPrime} />

  if (r.phase === 'locationGate')
    return (
      <LocationGate
        title={title}
        reduced={!!r.gate?.reduced}
        canAskAgain={!!r.gate?.canAskAgain}
        onAllow={r.start}
        onOpenSettings={() => void Linking.openSettings().catch(() => {})}
      />
    )
  if (r.phase === 'loading') return <StateView title={title} loading message={voice.roam.loading} />
  if (r.phase === 'error')
    return (
      <StateView
        title={title}
        message={r.error ?? voice.error.generic}
        tone="danger"
        action={{ label: voice.error.retry, onPress: r.retry }}
      />
    )
  if (r.phase === 'noCoverage') return <StateView title={title} message={voice.roam.noCoverage} />

  if (r.phase === 'sessionStart')
    return (
      <Screen edges={['bottom']}>
        <Stack.Screen options={{ title }} />
        <View style={styles.body}>
          <Card framed style={styles.card}>
            <Text variant="label" color="accentWarm">
              {voice.roam.sessionKicker}
            </Text>
            <Text variant="placardTitle" color="ink">
              {r.openerLine}
            </Text>
            <Duck label={voice.roam.musicPlaying} />
          </Card>
        </View>
      </Screen>
    )

  if (r.phase === 'signoff')
    return (
      <Screen edges={['bottom']}>
        <Stack.Screen options={{ title }} />
        <View style={styles.body}>
          <Card framed style={styles.card}>
            <Text variant="placardTitle" color="ink">
              {voice.roam.signoff}
            </Text>
            <Divider dashed />
            <View style={styles.tallyRow}>
              <Icon name="story" size={18} color="accent" />
              <Text variant="bodyStrong" color="ink">
                {`${r.toldCount} ${voice.roam.signoffTally}`}
              </Text>
            </View>
          </Card>
          <Button variant="primary" fullWidth onPress={() => router.back()} title={voice.roam.done} />
        </View>
      </Screen>
    )

  if (r.phase === 'roaming') {
    return (
      <Screen edges={['bottom']}>
        <Stack.Screen
          options={{
            title,
            headerRight: () => <Button variant="ghost" onPress={r.end} title={voice.roam.end} />,
          }}
        />
        <View style={styles.base}>
          {showMap ? (
            // Glanceable map: live position + nearby story-pins. The motif stays the default;
            // this is an opt-in glance. Encounter sheet still slides over it.
            <View style={styles.mapCard}>
              <RoamMap
                position={r.position}
                pins={r.mapPins}
                heardPoiIds={r.heardPoiIds}
                clipActive={sheetVisible || peekVisible}
                recenterBottom={sheetVisible ? 360 : peekVisible ? 120 : undefined}
              />
            </View>
          ) : (
            <>
          <View style={styles.flexSpace} />
          {/* The centered idle cluster — kicker → motif → title → wandering thought → one stat.
              Symmetric flex above/below frames it as a poster's intentional negative space,
              not a top-piled block dangling over a void (the "feels unfinished" fix). */}
          <View style={styles.hero}>
            <View style={styles.kickerRow}>
              <Text variant="label" color="inkFaint">
                {voice.roam.ridingKicker}
              </Text>
              {roamMode === 'sim' && <Badge tone="teal" label={voice.roam.simBadge} />}
            </View>
            <View style={styles.motif}>
              <RoamMotif glow={!sheetVisible && !peekVisible} nearestM={r.diag.nearestM} />
            </View>
            <Text variant="heading" color="ink">
              {voice.roam.idleTitle}
            </Text>
            {/* The wandering thought — slow-crossfades through the time-of-day murmur pool. */}
            <Animated.View style={{ opacity: murmurOpacity }}>
              <Text variant="body" color="inkDim">
                {murmurPool[murmurIdx] ?? murmurPool[0]}
              </Text>
            </Animated.View>
            <View style={styles.statRow}>
              <View style={[styles.pill, { backgroundColor: colors.surfaceSunken }]}>
                <Icon name="story" size={14} color="accent" />
                <Text variant="label" color="ink">
                  {r.toldCount === 0
                    ? `${r.pinCount} ${voice.roam.storiesNearby}`
                    : `${r.toldCount} ${voice.roam.storiesTold}`}
                </Text>
              </View>
              <Duck label={musicDucked ? voice.roam.musicPaused : voice.roam.musicPlaying} active={musicDucked} />
            </View>
            {r.gpsSearching && (
              <Text variant="dim" color="inkDim">
                {voice.player.gpsSearching}
              </Text>
            )}
          </View>
          <View style={styles.flexSpace} />
          {/* Footer: DEV/SIM ONLY — the drive-test diagnostics. Hidden for shipped live riders
              so the idle reads as a clean vista; kept on dev builds + sim so a road test can
              still self-report (free-roam-mode §Idle-canvas — open Q on a TestFlight-live toggle). */}
          {diagEnabled && (
            <View style={styles.footer}>
              <Text variant="mono" color="inkFaint">
                {`${r.pinCount} pins · GPS ${r.diag.fixAgeSec ?? '—'}s · nearest ${r.diag.nearestM != null ? `${r.diag.nearestM} m` : '—'}`}
              </Text>
            </View>
          )}
            </>
          )}

          {/* Floating motif⇄map toggle — the motif is the eyes-on-road default; the map is opt-in. */}
          <Pressable
            onPress={() => setShowMap((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={showMap ? voice.roam.hideMap : voice.roam.showMap}
            // 44pt control; hitSlop lifts the effective target past 48pt. (M5)
            hitSlop={space.sm}
            style={[
              styles.mapToggle,
              {
                backgroundColor: colors.surfaceRaised,
                borderColor: colors.rule,
                // Cross-platform (boxShadow renders on iOS + Android); the cast role replaces the
                // iOS-only shadow* + elevation pair. (M4)
                boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 8, color: colors.shadowCast }],
              },
            ]}
          >
            <Icon name={showMap ? 'eye' : 'map'} size={20} color="accent" />
          </Pressable>
        </View>

        {/* The encounter sheet — slides up over the idle base; the base stays visible. Glanceable,
            never required. Tuck it away with the handle (drag down / tap) or a scrim tap — the clip
            plays ON and the peek bar offers it back; only Skip stops the story. Carries the full
            story-player transport so seeking + pause feel identical across the two players. */}
        {sheetVisible && (
          <>
            <Pressable
              // Extend PAST the bottom safe-area inset: absoluteFill is bounded by the Screen's
              // SafeAreaView content box, so a plain scrim stops at the top of the home-indicator
              // padding and leaves a bare `surface` strip bordering the very bottom (a lighter bar
              // under the dimmed screen). -insets.bottom pulls the scrim down to the true edge.
              style={[StyleSheet.absoluteFill, { bottom: -insets.bottom, backgroundColor: colors.scrim }]}
              onPress={r.minimizeSheet}
              accessibilityLabel={voice.roam.minimize}
            />
            <Animated.View
              style={[
                styles.sheet,
                {
                  backgroundColor: colors.surfaceRaised,
                  borderColor: colors.rule,
                  // Cross-platform shadow via the cast role (was iOS-only shadow* + elevation). (M4)
                  boxShadow: [{ offsetX: 0, offsetY: 6, blurRadius: 16, color: colors.shadowCast }],
                  transform: [
                    {
                      // Base show/hide travel + the live handle-drag offset (both JS-driven).
                      translateY: Animated.add(
                        sheetAnim.interpolate({ inputRange: [0, 1], outputRange: [SHEET_HIDDEN_Y, 0] }),
                        dragY,
                      ),
                    },
                  ],
                },
              ]}
            >
              {/* The grip is a real drag target now (was a decorative View): drag down — or tap — to
                  tuck the player away. A fat hit area wraps the thin bar. */}
              <View
                style={styles.handleHit}
                accessibilityRole="button"
                accessibilityLabel={voice.roam.minimize}
                {...handleResponder.current.panHandlers}
              >
                <View style={[styles.handle, { backgroundColor: colors.trackInactive }]} />
              </View>
              <View style={styles.sheetTop}>
                <Badge tone="pine" label={voice.roam.storyBadge} />
                {/* Paused while he talks; resumes (music back up) when held. */}
                <Duck
                  label={r.clipPlaying ? voice.roam.musicPaused : voice.roam.musicHeld}
                  active={r.clipPlaying}
                />
              </View>
              <Text variant="placardTitle" color="ink" numberOfLines={2}>
                {r.activeName}
              </Text>
              {r.clipBuffering ? (
                // Dead-zone skeleton: the sheet appeared before audio could buffer. Show a
                // loading row (not a frozen transport) — the scrim tap still skips.
                <View style={styles.buffering}>
                  <ActivityIndicator color={colors.accent} />
                  <Text variant="dim" color="inkDim">
                    {voice.roam.buffering}
                  </Text>
                </View>
              ) : (
                <>
                  {/* The SAME transport as the story player — interactive scrubber + center
                      play/pause + ±15s jogs — so the two players feel identical. Skip rides the
                      ghost secondary beneath the row. */}
                  <Scrubber
                    positionMs={r.clipPositionMs}
                    durationMs={r.clipDurationMs}
                    onSeek={r.seekClipTo}
                    onScrubbingChange={r.setClipScrubbing}
                    disabled={!r.clipCanSeek}
                  />
                  <TransportBar
                    playing={r.clipPlaying}
                    onPlayPause={r.toggleClipPlay}
                    canSeek={r.clipCanSeek}
                    onSeekBack={() => r.seekClipBy(-15)}
                    onSeekForward={() => r.seekClipBy(15)}
                    secondary={{ title: voice.roam.skip, onPress: r.skip }}
                  />
                  <View style={styles.muteRow}>
                    <Button variant="ghost" title={voice.roam.muteStory} onPress={r.muteCurrent} />
                  </View>
                </>
              )}
            </Animated.View>
          </>
        )}

        {/* Peek bar — the safety net. A clip is SOUNDING but the full sheet is tucked away
            (minimized, or any state desync): one tap brings the player back, so audio is never
            playing with no reachable controls (the "couldn't get it back" fix). Mirrors the
            drive player's peek bar so the two players feel identical. */}
        {peekVisible && (
          <Pressable
            onPress={r.expandSheet}
            accessibilityRole="button"
            accessibilityLabel={voice.roam.expand}
            style={[
              styles.peekBar,
              {
                backgroundColor: colors.surfaceRaised,
                borderColor: colors.amberToken,
                // Cross-platform cast; the negative offsetY lifts it toward the screen above. (M4)
                boxShadow: [{ offsetX: 0, offsetY: -4, blurRadius: 14, color: colors.shadowCast }],
              },
            ]}
          >
            <Pressable
              onPress={r.toggleClipPlay}
              accessibilityRole="button"
              accessibilityLabel={r.clipPlaying ? voice.cta.pause : voice.cta.resume}
              style={[styles.peekPlay, { backgroundColor: colors.primaryFill }]}
            >
              <Icon name={r.clipPlaying ? 'pause' : 'play'} size={22} color="onPrimary" />
            </Pressable>
            <View style={styles.peekText}>
              <Text variant="label" color="accentWarm">
                {voice.player.nowPlaying}
              </Text>
              <Text variant="bodyStrong" color="ink" numberOfLines={1}>
                {r.clipName}
              </Text>
              {r.clipDurationMs > 0 && (
                <View style={[styles.peekTrack, { backgroundColor: colors.surfaceSunken }]}>
                  <View
                    style={[styles.peekFill, { backgroundColor: colors.trackActive, width: `${peekPct}%` }]}
                  />
                </View>
              )}
            </View>
            <Icon name="chevronUp" size={20} color="inkFaint" />
          </Pressable>
        )}
      </Screen>
    )
  }

  // idle: contractSeen still loading (< 10ms) or auto-start in flight — render nothing
  return null
}

const styles = StyleSheet.create({
  body: { flex: 1, padding: space.gutter, gap: space.lg, justifyContent: 'center' },
  muteRow: { alignItems: 'center' }, // centers the ghost "don't tell me this one again" under the transport

  base: { flex: 1, padding: space.gutter },
  // Symmetric flex above + below the hero centers the idle cluster; the footer pins below it.
  flexSpace: { flex: 1 },
  hero: { gap: space.md },
  footer: { gap: space.md },
  card: { gap: space.md, padding: space.xl },
  chip: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kickerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  motif: { marginVertical: space.sm }, // a touch of extra room around the signature element
  statRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg, marginTop: space.sm },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
  },
  tallyRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  sheet: {
    position: 'absolute',
    left: space.sm,
    right: space.sm,
    bottom: space.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.xl,
    gap: space.md,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.pill,
  },
  // Fat, in-car grab area around the thin grip bar so the drag-to-minimize is easy to catch.
  handleHit: {
    alignSelf: 'center',
    alignItems: 'center',
    paddingVertical: space.sm,
    paddingHorizontal: space.xl,
  },
  // The minimized "now playing" peek bar — mirrors the drive player's peek bar (play · title ·
  // progress · expand chevron), pinned to the same bottom slot the full sheet uses.
  peekBar: {
    position: 'absolute',
    left: space.sm,
    right: space.sm,
    bottom: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.lg,
    borderWidth: border.keyline,
  },
  peekPlay: { width: 50, height: 50, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  peekText: { flex: 1, minWidth: 0, gap: 3 },
  peekTrack: { height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 2 },
  peekFill: { height: '100%' },
  sheetTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // Map mode: a rounded full-bleed map card filling the padded base, + the floating toggle.
  mapCard: { flex: 1, borderRadius: radius.lg, overflow: 'hidden' },
  mapToggle: {
    position: 'absolute',
    top: space.sm,
    right: space.sm,
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  // Skeleton row — spinner + line, roughly the height of the transport it stands in for so
  // the sheet doesn't jump when real audio arrives and the controls replace it.
  buffering: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingVertical: space.xl,
  },
})
