// FREE-ROAM (alpha) — the skipper rides shotgun on YOUR drive. No route, no tour shape:
// fetch the roam pins near here, watch live GPS, and pipe up (over the rider's own audio —
// duckOthers) when the road passes a place he knows. Silence is the DEFAULT state; the
// idle card's whole job is making quiet feel companionable (the ambient contract).
// `?mode=sim` replays a ready tour's polyline through the same engine for couch testing.
import { useCallback } from 'react'
import { Alert, Linking, StyleSheet, View } from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import { useRoam } from '@/lib/useRoam'
import { space } from '@/theme/tokens'
import { Badge, Button, Card, Icon, Screen, StateView, Text, voice } from '@/ui'

export default function RoamScreen() {
  const { mode } = useLocalSearchParams<{ mode?: string }>()
  // Live GPS is the real product; the sim is a couch/dev clock (never a release rider's
  // default — but roam is alpha, so an explicit ?mode=sim works in release too).
  const roamMode = mode === 'sim' ? 'sim' : 'live'
  const r = useRoam(roamMode)

  const confirmEnd = useCallback(() => {
    Alert.alert(voice.roam.confirmEndTitle, undefined, [
      { text: voice.roam.keepRiding, style: 'cancel' },
      { text: voice.roam.end, style: 'destructive', onPress: r.end },
    ])
  }, [r.end])

  if (r.phase === 'locationGate')
    return (
      <StateView
        title={voice.roam.entry}
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
  if (r.phase === 'loading')
    return <StateView title={voice.roam.entry} loading message={voice.roam.loading} />
  if (r.phase === 'error')
    return (
      <StateView
        title={voice.roam.entry}
        message={r.error ?? voice.error.generic}
        tone="danger"
        action={{ label: voice.error.retry, onPress: r.start }}
      />
    )
  if (r.phase === 'noCoverage')
    return <StateView title={voice.roam.entry} message={voice.roam.noCoverage} />

  if (r.phase === 'roaming') {
    const talking = r.activeName !== null
    return (
      <Screen edges={['bottom']}>
        <Stack.Screen options={{ title: voice.roam.entry }} />
        <View style={styles.body}>
          <Card active={talking} style={styles.nowCard}>
            <Badge
              tone={talking ? 'amber' : 'pine'}
              label={roamMode === 'sim' ? voice.roam.simKicker : voice.roam.kicker}
            />
            <Text variant="title" color="ink" numberOfLines={3} style={styles.title}>
              {r.activeName ?? voice.roam.watching}
            </Text>
            {!talking && (
              <Text variant="body" color="inkDim">
                {voice.roam.watchingBody}
              </Text>
            )}
            <Text variant="mono" color="inkFaint" style={styles.counts}>
              {`${r.pinCount} ${voice.roam.inRange} · ${r.toldCount} ${voice.roam.told}`}
            </Text>
            {r.gpsSearching && (
              <Text variant="dim" color="inkDim">
                {voice.player.gpsSearching}
              </Text>
            )}
          </Card>
          <Button variant="secondary" fullWidth onPress={confirmEnd} title={voice.roam.end} />
        </View>
      </Screen>
    )
  }

  // idle — the start card (the ambient contract, set before any audio plays)
  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: voice.roam.entry }} />
      <View style={styles.body}>
        <Card style={styles.nowCard}>
          <View style={styles.kickerRow}>
            <Badge tone="teal" label={voice.roam.entryAlpha} />
            <Icon name="roam" size={18} color="accent" />
          </View>
          <Text variant="title" color="ink" style={styles.title}>
            {voice.roam.entry}
          </Text>
          <Text variant="body" color="inkDim">
            {voice.roam.entryBlurb}
          </Text>
          <Text variant="body" color="inkDim">
            {voice.roam.watchingBody}
          </Text>
        </Card>
        <Button variant="primary" fullWidth glow onPress={r.start} title={voice.roam.start} />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    padding: space.gutter,
    gap: space.lg,
    justifyContent: 'center',
  },
  nowCard: {
    gap: space.md,
    padding: space.xl,
  },
  kickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  title: {
    marginTop: space.xs,
  },
  counts: {
    marginTop: space.sm,
  },
})
