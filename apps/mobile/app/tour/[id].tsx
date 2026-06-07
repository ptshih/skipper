import { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Link, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { ApiError, getTour, signTourAudio, type SignedAudio, type TourDetail } from '@/lib/api'

// Tour detail. Anonymous can open only the preview tour; other tours return 401
// -> we prompt for a free account. Audio URLs are fetched on demand (gated). The
// actual PHONE PLAYER (expo-audio + speed-adaptive triggering) is the MVP and is
// still TODO (see apps/mobile/README.md) — this screen stops at "ready". CarPlay
// is deferred past the MVP, no longer a gate.
export default function TourScreen() {
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
      else setError(e instanceof Error ? e.message : 'Failed to load tour')
    } finally {
      setLoading(false)
    }
  }, [id])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load]),
  )

  const loadAudio = async () => {
    if (!id) return
    try {
      setAudio(await signTourAudio(id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to sign audio')
    }
  }

  if (loading) return <ActivityIndicator style={styles.pad} />

  if (needsAccount) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Members only' }} />
        <Text style={styles.title}>Create a free account to play this tour</Text>
        <Text style={styles.dim}>Anonymous play is limited to the preview tour.</Text>
        <Link href="/sign-in" style={styles.button}>
          Sign in / Sign up
        </Link>
      </View>
    )
  }

  if (error) return <Text style={[styles.pad, styles.error]}>{error}</Text>
  if (!tour) return null

  return (
    <ScrollView contentContainerStyle={styles.list}>
      <Stack.Screen options={{ title: tour.corridor?.name ?? 'Tour' }} />
      <Text style={styles.title}>{tour.corridor?.name ?? 'Tour'}</Text>
      <Text style={styles.dim}>
        {tour.corridor?.region} · {tour.tour.durationBucket} · {tour.tour.jokeLevel}
        {tour.tour.isPreview ? ' · preview' : ''}
      </Text>

      <Link href={`/preview/${id}`} style={styles.linkButton}>
        ▶ Preview the drive
      </Link>
      <Text style={styles.dim}>Hear the whole tour from your couch — no driving to the GPS coordinates.</Text>

      <Pressable style={styles.secondary} onPress={loadAudio}>
        <Text style={styles.secondaryText}>Load audio URLs (debug)</Text>
      </Pressable>

      {tour.stops.map((s) => {
        const signed = audio?.urls.find((u) => u.seq === s.seq)
        return (
          <View key={s.seq} style={styles.card}>
            <Text style={styles.stopTitle}>
              {s.seq + 1}. {s.name}
            </Text>
            <Text style={styles.dim}>{s.stopType.toUpperCase()}</Text>
            <Text style={styles.dim}>
              {s.lat.toFixed(4)}, {s.lng.toFixed(4)} · trigger {s.triggerRadiusM} m
              {s.audioDurationMs ? ` · ${Math.round(s.audioDurationMs / 1000)}s` : ''}
            </Text>
            {signed ? <Text style={styles.signed}>audio ready ✓</Text> : null}
          </View>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 10 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },
  card: { padding: 14, borderRadius: 10, backgroundColor: '#f3f3f3', gap: 2 },
  title: { fontSize: 20, fontWeight: '700' },
  stopTitle: { fontSize: 15, fontWeight: '600' },
  dim: { fontSize: 13, color: '#666' },
  signed: { fontSize: 13, color: '#137333', marginTop: 2 },
  button: { backgroundColor: '#1e6fd9', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', color: '#fff' },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  linkButton: { backgroundColor: '#1e6fd9', borderRadius: 10, paddingVertical: 14, paddingHorizontal: 16, textAlign: 'center', color: '#fff', fontSize: 16, fontWeight: '700', overflow: 'hidden' },
  secondary: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center', backgroundColor: '#f0f0f0' },
  secondaryText: { color: '#666', fontSize: 13, fontWeight: '600' },
  error: { color: '#b00020' },
  pad: { padding: 16 },
})
