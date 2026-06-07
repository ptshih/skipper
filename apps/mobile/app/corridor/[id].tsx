import { useCallback, useState } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { listCorridorTours, type CorridorTours } from '@/lib/api'
import { jokeLabel } from '@/lib/labels'
import { useTheme } from '@/theme'
import { space } from '@/theme/tokens'
import { Badge, Card, Screen, Text, voice } from '@/ui'

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// A corridor's available (ready) tours. Tap one to open it (gated). The free
// preview is badged.
export default function CorridorScreen() {
  const theme = useTheme()
  const router = useRouter()
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>()
  const [tours, setTours] = useState<CorridorTours['tours']>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const r = await listCorridorTours(id)
      setTours(r.tours)
    } catch (e) {
      setError(e instanceof Error ? e.message : voice.error.generic)
    } finally {
      setLoading(false)
    }
  }, [id])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load]),
  )

  return (
    <Screen scroll padded edges={['bottom']} contentContainerStyle={styles.list}>
      <Stack.Screen options={{ title: name ?? 'Tours' }} />
      {loading ? (
        <ActivityIndicator color={theme.colors.accent} style={styles.pad} />
      ) : error ? (
        <Text variant="body" color="danger">
          {error}
        </Text>
      ) : tours.length === 0 ? (
        <Text variant="body" color="inkDim">
          {voice.empty.tours}
        </Text>
      ) : (
        tours.map((t) => (
          <Card
            key={t.id}
            onPress={() => router.push({ pathname: '/tour/[id]', params: { id: t.id } })}
          >
            <View style={styles.head}>
              <Text variant="heading" color="ink">
                {cap(t.durationBucket)} tour
              </Text>
              {t.isPreview ? <Badge tone="amber" filled label="FREE PREVIEW" /> : null}
            </View>
            <View style={styles.metaRow}>
              <Badge tone="teal" label={jokeLabel(t.jokeLevel)} />
            </View>
          </Card>
        ))
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  list: { gap: space.md },
  pad: { padding: space.gutter },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm },
})
