import { useCallback, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { Link, Stack, useFocusEffect } from 'expo-router'
import { listCorridors, type CorridorList } from '@/lib/api'
import { signOut, useSession } from '@/lib/auth'

// Browse corridors — anonymous-friendly. (Tapping a corridor will open its tour
// once the API exposes a corridor->tour route; today tours are fetched by id.)
export default function CorridorsScreen() {
  const { data: session } = useSession()
  const [corridors, setCorridors] = useState<CorridorList['corridors']>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      const r = await listCorridors()
      setCorridors(r.corridors)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load corridors')
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load]),
  )

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Skipper' }} />
      <View style={styles.authRow}>
        {session ? (
          <>
            <Text style={styles.dim}>Signed in · {session.user.email}</Text>
            <Pressable onPress={() => signOut()}>
              <Text style={styles.link}>Sign out</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.dim}>Browsing as guest</Text>
            <Link href="/sign-in" style={styles.link}>
              Sign in
            </Link>
          </>
        )}
      </View>

      {loading ? (
        <ActivityIndicator style={styles.pad} />
      ) : error ? (
        <Text style={[styles.pad, styles.error]}>{error}</Text>
      ) : (
        <FlatList
          data={corridors}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
          ListEmptyComponent={<Text style={[styles.pad, styles.dim]}>No corridors yet.</Text>}
          renderItem={({ item }) => (
            <Link href={{ pathname: '/corridor/[id]', params: { id: item.id, name: item.name } }} asChild>
              <Pressable style={styles.card}>
                <Text style={styles.title}>{item.name}</Text>
                <Text style={styles.dim}>
                  {item.region}
                  {item.durationSeconds ? ` · ~${Math.round(item.durationSeconds / 60)} min` : ''}
                </Text>
                {item.summary ? <Text style={styles.body}>{item.summary}</Text> : null}
              </Pressable>
            </Link>
          )}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  authRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  list: { padding: 16, gap: 12 },
  card: { padding: 16, borderRadius: 12, backgroundColor: '#f3f3f3', gap: 4 },
  title: { fontSize: 18, fontWeight: '600' },
  body: { fontSize: 14, color: '#333', marginTop: 4 },
  dim: { fontSize: 13, color: '#666' },
  link: { fontSize: 15, color: '#1e6fd9', fontWeight: '600' },
  error: { color: '#b00020' },
  pad: { padding: 16 },
})
