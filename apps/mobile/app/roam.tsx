// FREE-ROAM (alpha) — the skipper rides shotgun on YOUR drive. No route, no tour shape:
// fetch the roam pins near here, watch live GPS, and pipe up (over the rider's own audio —
// duckOthers) when the road passes a place he knows.
// Flow: tapping "Roam" on home IS the start action — no separate entry screen. Returning
// users auto-start on mount; first-timers see the ambient contract first (shown immediately,
// not gated behind a redundant entry card). Silence is the DEFAULT state — the idle base
// must feel alive (the RoamMotif is the one moving thing), never like a spinner.
// `?mode=sim` replays a ready tour's polyline through the same engine for couch testing.
// The encounter sheet reuses the EXACT story-player transport (Scrubber + play/pause + ±15s)
// so both players feel identical (founder call, superseding the alpha's read-only bar).
// Alpha cuts vs the full design: the encounter PATTER line (grounded, from the roam track), waves
// + B-sides ("Tell me more"), and the offline region pack + logbook wait on their backends —
// honest UI shows none of them.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Animated, Linking, Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import * as SecureStore from 'expo-secure-store'
import { useRoam } from '@/lib/useRoam'
import { RoamMap } from '@/ui/RoamMap'
import { useSimMode } from '@/lib/sim-mode'
import { useReducedMotion, useTheme } from '@/theme'
import { duration, radius, space } from '@/theme/tokens'
import {
  Badge,
  Button,
  Card,
  Chattiness,
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

  // The encounter sheet slides up over the idle base while a clip plays.
  const sheetVisible = r.activeName !== null
  const sheetAnim = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (reducedMotion) {
      sheetAnim.setValue(sheetVisible ? 1 : 0) // appear, don't slide
      return
    }
    Animated.timing(sheetAnim, {
      toValue: sheetVisible ? 1 : 0,
      duration: duration.base,
      useNativeDriver: true,
    }).start()
  }, [sheetVisible, reducedMotion, sheetAnim])

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
    if (r.phase !== 'roaming' || sheetVisible) return
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
  }, [r.phase, sheetVisible, reducedMotion, murmurPool.length, murmurOpacity])

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
                clipActive={sheetVisible}
                recenterBottom={sheetVisible ? 360 : undefined}
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
              <RoamMotif glow={!sheetVisible} nearestM={r.diag.nearestM} />
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
              <Duck label={sheetVisible ? voice.roam.musicPaused : voice.roam.musicPlaying} active={sheetVisible} />
            </View>
            {r.gpsSearching && (
              <Text variant="dim" color="inkDim">
                {voice.player.gpsSearching}
              </Text>
            )}
          </View>
          <View style={styles.flexSpace} />
          {/* Footer: the set-once chattiness knob and — DEV/SIM ONLY — the drive-test
              diagnostics. Hidden for shipped live riders so the idle reads as a clean vista;
              kept on dev builds + sim so a road test can still self-report (free-roam-mode
              §Idle-canvas — open Q on a TestFlight-live toggle). */}
          <View style={styles.footer}>
            {diagEnabled && (
              <Text variant="mono" color="inkFaint">
                {`${r.pinCount} pins · GPS ${r.diag.fixAgeSec ?? '—'}s · nearest ${r.diag.nearestM != null ? `${r.diag.nearestM} m` : '—'}`}
              </Text>
            )}
            <Chattiness value={r.chattiness} onChange={r.setChattiness} />
          </View>
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

        {/* The encounter sheet — slides up over the idle base; the base stays visible.
            Glanceable, never required, dismissable (Skip / scrim). Carries the full story-
            player transport so seeking + pause feel identical across the two players. */}
        {sheetVisible && (
          <>
            <Pressable
              // Extend PAST the bottom safe-area inset: absoluteFill is bounded by the Screen's
              // SafeAreaView content box, so a plain scrim stops at the top of the home-indicator
              // padding and leaves a bare `surface` strip bordering the very bottom (a lighter bar
              // under the dimmed screen). -insets.bottom pulls the scrim down to the true edge.
              style={[StyleSheet.absoluteFill, { bottom: -insets.bottom, backgroundColor: colors.scrim }]}
              onPress={r.skip}
              accessibilityLabel={voice.roam.skip}
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
                      translateY: sheetAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [320, 0],
                      }),
                    },
                  ],
                },
              ]}
            >
              <View style={[styles.handle, { backgroundColor: colors.trackInactive }]} />
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
                </>
              )}
            </Animated.View>
          </>
        )}
      </Screen>
    )
  }

  // idle: contractSeen still loading (< 10ms) or auto-start in flight — render nothing
  return null
}

const styles = StyleSheet.create({
  body: { flex: 1, padding: space.gutter, gap: space.lg, justifyContent: 'center' },
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
