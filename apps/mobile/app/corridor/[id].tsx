import { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Link, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { listCorridorTours, type CorridorTours } from '@/lib/api'

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// A corridor's available (ready) tours. Tap one to open it (gated). Catalog is
// visible to guests; the free preview is marked.
export default function CorridorScreen() {
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
      setError(e instanceof Error ? e.message : 'Failed to load tours')
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
    <View style={styles.container}>
      <Stack.Screen options={{ title: name ?? 'Tours' }} />
      {loading ? (
        <ActivityIndicator style={styles.pad} />
      ) : error ? (
        <Text style={[styles.pad, styles.error]}>{error}</Text>
      ) : tours.length === 0 ? (
        <Text style={[styles.pad, styles.dim]}>No tours generated for this corridor yet.</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {tours.map((t) => (
            <Link key={t.id} href={{ pathname: '/tour/[id]', params: { id: t.id } }} asChild>
              <Pressable style={styles.card}>
                <Text style={styles.title}>
                  {cap(t.durationBucket)} tour{t.isPreview ? ' · free preview' : ''}
                </Text>
                <Text style={styles.dim}>{t.jokeLevel}</Text>
              </Pressable>
            </Link>
          ))}
        </ScrollView>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: 16, gap: 12 },
  card: { padding: 16, borderRadius: 12, backgroundColor: '#f3f3f3', gap: 4 },
  title: { fontSize: 17, fontWeight: '600' },
  dim: { fontSize: 13, color: '#666' },
  error: { color: '#b00020' },
  pad: { padding: 16 },
})
