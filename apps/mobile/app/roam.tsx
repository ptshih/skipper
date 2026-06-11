// FREE-ROAM (alpha) — the skipper rides shotgun on YOUR drive. No route, no tour shape:
// fetch the roam pins near here, watch live GPS, and pipe up (over the rider's own audio —
// duckOthers) when the road passes a place he knows. Built to the design handoff
// (design_handoff_roam): entry → (first-run contract) → session start → riding-along idle
// ⇄ encounter sheet → sign-off. Silence is the DEFAULT state — the idle base must feel
// alive (the RoamMotif is the one moving thing), never like a spinner.
// `?mode=sim` replays a ready tour's polyline through the same engine for couch testing.
// Alpha cuts vs the full design: waves + B-sides ("Tell me more") wait on their clips;
// the offline region pack + logbook wait on their backends — honest UI shows none of them.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Animated, Linking, Pressable, StyleSheet, View } from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import * as SecureStore from 'expo-secure-store'
import { useRoam } from '@/lib/useRoam'
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
  RouteTrack,
  Screen,
  StateView,
  Text,
  voice,
} from '@/ui'

const CONTRACT_SEEN_KEY = 'skipper.roamContractSeen'
/** The motif's car token takes this long to glide the trail once (a calm cruise). */
const MOTIF_LOOP_MS = 9_000

/** The riding-along base's signature: the car token gliding a dashed atlas trail — the
 *  session's ONE moving thing ("alive, not a spinner"). Parked mid-trail under Reduce
 *  Motion; the amber token glow yields while the encounter sheet owns the screen's glow. */
function RoamMotif({ glow }: { glow: boolean }) {
  const reducedMotion = useReducedMotion()
  const progress = useRef(new Animated.Value(reducedMotion ? 0.45 : 0)).current
  useEffect(() => {
    if (reducedMotion) {
      progress.setValue(0.45)
      return
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, { toValue: 1, duration: MOTIF_LOOP_MS, useNativeDriver: false }),
        Animated.timing(progress, { toValue: 0, duration: 0, useNativeDriver: false }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [reducedMotion, progress])
  // RouteTrack is the existing trail+token primitive — the motif IS that vocabulary.
  return <RouteTrack progress={progress} glow={glow} />
}

export default function RoamScreen() {
  const { colors } = useTheme()
  const reducedMotion = useReducedMotion()
  const { mode } = useLocalSearchParams<{ mode?: string }>()
  const roamMode = mode === 'sim' ? 'sim' : 'live'
  const r = useRoam(roamMode)

  // First-run ambient contract — he sets the deal ONCE before the first session.
  const [contractSeen, setContractSeen] = useState<boolean | null>(null)
  const [showContract, setShowContract] = useState(false)
  useEffect(() => {
    SecureStore.getItemAsync(CONTRACT_SEEN_KEY)
      .then((v) => setContractSeen(v === '1'))
      .catch(() => setContractSeen(false))
  }, [])
  const onRideAlong = useCallback(() => {
    if (contractSeen === false) {
      setShowContract(true)
      return
    }
    r.start()
  }, [contractSeen, r.start])
  const onContractAccept = useCallback(() => {
    setShowContract(false)
    setContractSeen(true)
    SecureStore.setItemAsync(CONTRACT_SEEN_KEY, '1').catch(() => {})
    r.start()
  }, [r.start])

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

  if (r.phase === 'locationGate')
    return (
      <StateView
        title={title}
        message={
          r.gate?.reduced
            ? voice.drive.locationReduced
            : r.gate?.canAskAgain
              ? voice.drive.locationNeeded
              : voice.drive.locationBlocked
        }
        tone="danger"
        action={
          r.gate?.reduced || !r.gate?.canAskAgain
            ? { label: voice.drive.locationSettings, onPress: () => void Linking.openSettings() }
            : { label: voice.drive.locationAllow, onPress: r.start }
        }
      />
    )
  if (r.phase === 'loading') return <StateView title={title} loading message={voice.roam.loading} />
  if (r.phase === 'error')
    return (
      <StateView
        title={title}
        message={r.error ?? voice.error.generic}
        tone="danger"
        action={{ label: voice.error.retry, onPress: r.start }}
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
          <Button variant="primary" fullWidth onPress={r.finishSignoff} title={voice.roam.done} />
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
          <View style={styles.kickerRow}>
            <Text variant="label" color="inkFaint">
              {voice.roam.ridingKicker}
            </Text>
            {roamMode === 'sim' && <Badge tone="teal" label={voice.roam.simBadge} />}
          </View>
          <View style={styles.motif}>
            <RoamMotif glow={!sheetVisible} />
          </View>
          <Text variant="heading" color="ink">
            {voice.roam.idleTitle}
          </Text>
          <Text variant="body" color="inkDim">
            {voice.roam.idle}
          </Text>
          <View style={styles.statRow}>
            <View style={[styles.pill, { backgroundColor: colors.surfaceSunken }]}>
              <Icon name="story" size={14} color="accent" />
              <Text variant="label" color="ink">
                {`${r.toldCount} ${voice.roam.stories}`}
              </Text>
            </View>
            <Duck label={sheetVisible ? voice.roam.musicDucked : voice.roam.musicPlaying} active={sheetVisible} />
          </View>
          {r.gpsSearching && (
            <Text variant="dim" color="inkDim">
              {voice.player.gpsSearching}
            </Text>
          )}
          <View style={styles.spacer} />
          <Chattiness value={r.chattiness} onChange={r.setChattiness} />
        </View>

        {/* The encounter sheet — slides up over the idle base; the base stays visible.
            Glanceable, never required, dismissable (Skip / scrim). NOT a scrubber: roam
            has no seeking — the thin bar is read-only progress. */}
        {sheetVisible && (
          <>
            <Pressable
              style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}
              onPress={r.skip}
              accessibilityLabel={voice.roam.skip}
            />
            <Animated.View
              style={[
                styles.sheet,
                {
                  backgroundColor: colors.surfaceRaised,
                  borderColor: colors.rule,
                  shadowColor: colors.shadowCast,
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
                <Duck label={voice.roam.musicDucked} active />
              </View>
              <Text variant="placardTitle" color="ink" numberOfLines={2}>
                {r.activeName}
              </Text>
              <View style={styles.progressRow}>
                <View style={[styles.progressTrack, { backgroundColor: colors.trackInactive }]}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        backgroundColor: colors.trackActive,
                        width: `${Math.min(100, (r.clipElapsedSec / Math.max(1, r.clipDurationSec)) * 100)}%`,
                      },
                    ]}
                  />
                </View>
                <Text variant="mono" color="inkFaint">
                  {`${Math.floor(r.clipElapsedSec / 60)}:${String(Math.floor(r.clipElapsedSec % 60)).padStart(2, '0')}`}
                </Text>
              </View>
              <Button variant="ghost" onPress={r.skip} title={voice.roam.skip} />
            </Animated.View>
          </>
        )}
      </Screen>
    )
  }

  // idle — the start surface (the home card is the front door; this is the trailhead)
  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title }} />
      <View style={styles.body}>
        <Card framed style={styles.card}>
          <View style={styles.kickerRow}>
            <Text variant="label" color="accentWarm">
              {voice.roam.entryKicker}
            </Text>
            <Badge tone="teal" label={voice.roam.entryAlpha} />
          </View>
          <Text variant="display" color="ink">
            {voice.roam.entry}
          </Text>
          <Text variant="body" color="inkDim">
            {voice.roam.entryBlurb}
          </Text>
        </Card>
        <Button variant="primary" fullWidth glow onPress={onRideAlong} title={voice.roam.start} />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: { flex: 1, padding: space.gutter, gap: space.lg, justifyContent: 'center' },
  base: { flex: 1, padding: space.gutter, gap: space.md },
  card: { gap: space.md, padding: space.xl },
  chip: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kickerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  motif: { marginVertical: space.md },
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
  spacer: { flex: 1 },
  sheet: {
    position: 'absolute',
    left: space.sm,
    right: space.sm,
    bottom: space.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.xl,
    gap: space.md,
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.pill,
  },
  sheetTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  progressTrack: { flex: 1, height: 3, borderRadius: radius.pill, overflow: 'hidden' },
  progressFill: { height: '100%' },
})
