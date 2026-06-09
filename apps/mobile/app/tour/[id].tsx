import { useCallback, useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import { ApiError, getTour, signTourAudio, type SignedAudio, type TourDetail } from '@/lib/api'
import { jokeLabel, stopLabel } from '@/lib/labels'
import { space } from '@/theme/tokens'
import {
  AccountGate,
  Badge,
  Button,
  Card,
  Icon,
  Screen,
  StateView,
  Text,
  stopIcon,
  stopTone,
  voice,
} from '@/ui'

// Tour detail. Anonymous can open only the preview tour; other tours return 401
// -> we prompt for a free account. Offers the live GPS drive (the M1 phone player,
// currently fed by a simulated fix source) + the couch preview + the route manifest.
export default function TourScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const [tour, setTour] = useState<TourDetail | null>(null)
  const [audio, setAudio] = useState<SignedAudio | null>(null)
  const [needsAccount, setNeedsAccount] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    setNeedsAccount(false)
    try {
      setTour(await getTour(id))
    } catch (e) {
      if (e instanceof ApiError && e.needsAccount) setNeedsAccount(true)
      else setError(e instanceof Error ? e.message : voice.error.generic)
    } finally {
      setLoading(false)
    }
  }, [id])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load]),
  )

  // ---- "Hear the skipper": a one-tap voice sample (the head of the first clip) so a
  // rider falls for the gravelly deadpan BEFORE committing to a whole drive. Reuses the
  // tour's existing audio — no new assets. Toggles play/stop; auto-resets at clip end.
  const samplePlayer = useAudioPlayer()
  const sampleStatus = useAudioPlayerStatus(samplePlayer)
  const [sample, setSample] = useState<'idle' | 'loading' | 'playing'>('idle')

  const toggleSample = useCallback(async () => {
    if (sample === 'playing') {
      try {
        samplePlayer.pause()
      } catch {}
      setSample('idle')
      return
    }
    if (!id) return
    try {
      setSample('loading')
      // The sample IS the content here — play even on the silent switch.
      await setAudioModeAsync({ playsInSilentMode: true }).catch(() => {})
      const signed = await signTourAudio(id) // re-sign each tap so the URL is never stale
      const first = [...signed.stops].sort((a, b) => a.seq - b.seq)[0]
      if (!first) {
        setSample('idle')
        return
      }
      samplePlayer.replace({ uri: first.url })
      samplePlayer.play()
      setSample('playing')
    } catch {
      setSample('idle')
    }
  }, [sample, id, samplePlayer])

  // Reset to idle when the sample clip finishes on its own.
  useEffect(() => {
    if (sampleStatus.didJustFinish) setSample('idle')
  }, [sampleStatus.didJustFinish])

  // Stop the sample if you leave the screen (or tap into the full drive) mid-clip.
  useEffect(
    () => () => {
      try {
        samplePlayer.pause()
      } catch {}
    },
    [samplePlayer],
  )

  // Debug-only: presign + reveal the raw R2 URLs. Dead-code-eliminated in release.
  const loadAudio = async () => {
    if (!id) return
    try {
      setAudio(await signTourAudio(id))
    } catch (e) {
      setError(e instanceof Error ? e.message : voice.error.generic)
    }
  }

  if (loading) return <StateView title="Tour" loading message={voice.loading.tour} />
  if (needsAccount) return <AccountGate />
  if (error)
    return (
      <StateView
        title="Tour"
        message={error}
        tone="danger"
        action={{ label: voice.error.retry, onPress: load }}
      />
    )
  if (!tour)
    return (
      <StateView
        title="Tour"
        message={voice.empty.tour}
        action={{ label: 'Back to tours', onPress: () => router.back() }}
      />
    )

  return (
    <Screen scroll padded edges={['bottom']} contentContainerStyle={styles.body}>
      <Stack.Screen options={{ title: tour.tour.headline }} />

      <View style={styles.head}>
        <Text variant="display" color="ink">
          {tour.tour.headline}
        </Text>
        <Text variant="label" color="inkFaint">
          {tour.tour.startAnchor.name} → {tour.tour.endAnchor.name}
        </Text>
        <View style={styles.metaRow}>
          <Text variant="label" color="inkFaint">
            {tour.region.displayName}
          </Text>
          <Badge tone="teal" label={jokeLabel(tour.tour.jokeLevel)} />
          {tour.tour.isPreview ? <Badge tone="amber" filled label="FREE PREVIEW" /> : null}
        </View>
      </View>

      {/* The live, GPS-triggered drive — the M1 headline (a simulated fix source on the
          phone for now; real device GPS lands in a later phase). */}
      <Button icon="car" title={voice.cta.drive} onPress={() => router.push(`/drive/${id}`)} />
      <Text variant="dim" color="inkDim">
        The skipper talks as you reach each stop on the real roads. Simulated on the phone for now.
      </Text>

      <Button
        variant="secondary"
        icon="play"
        title={voice.cta.preview}
        onPress={() => router.push(`/preview/${id}`)}
      />
      <Text variant="dim" color="inkDim">
        Hear the whole tour from your couch — no driving to the GPS coordinates.
      </Text>

      {/* Lower-commitment taste: one tap to hear the skipper before the whole drive. */}
      <Button
        variant="secondary"
        icon={sample === 'playing' ? 'pause' : 'play'}
        title={sample === 'playing' ? 'Stop the sample' : 'Hear the skipper'}
        loading={sample === 'loading'}
        onPress={toggleSample}
      />

      <Text variant="label" color="inkFaint" style={styles.sectionLabel}>
        The route · {tour.stops.length} stops
      </Text>

      {tour.stops.map((s) => {
        const signed = audio?.stops.find((u) => u.seq === s.seq)
        return (
          <Card key={s.seq}>
            <View style={styles.stopHead}>
              <Icon name={stopIcon(s.stopType)} size={16} />
              <Text variant="heading" color="ink" style={styles.flex} numberOfLines={2}>
                {s.seq + 1}. {s.name}
              </Text>
            </View>
            {/* badge on its OWN row so it never squeezes the title */}
            <View style={styles.stopMeta}>
              <Badge tone={stopTone(s.stopType)} label={stopLabel(s.stopType)} />
              {s.audioDurationMs ? (
                <Text variant="dim" color="inkDim">
                  {Math.round(s.audioDurationMs / 1000)} sec
                </Text>
              ) : null}
            </View>
            {__DEV__ ? (
              <Text variant="mono" color="inkFaint">
                {s.lat.toFixed(4)}, {s.lng.toFixed(4)} · trigger {s.triggerRadiusM}m
              </Text>
            ) : null}
            {signed ? (
              <Text variant="label" color="accent">
                audio ready
              </Text>
            ) : null}
          </Card>
        )
      })}

      {__DEV__ ? (
        <Button variant="ghost" title="Load audio URLs (debug)" onPress={loadAudio} />
      ) : null}
    </Screen>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { gap: space.md },
  head: { gap: space.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  sectionLabel: { marginTop: space.sm },
  stopHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stopMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.sm,
    marginTop: space.sm,
    marginBottom: space.xs,
  },
})
