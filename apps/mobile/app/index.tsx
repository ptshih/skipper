import { useCallback, useState } from 'react'
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native'
import { Stack, useFocusEffect, useRouter } from 'expo-router'
import { listCorridors, type CorridorList } from '@/lib/api'
import { signOut, useSession } from '@/lib/auth'
import { useTheme } from '@/theme'
import { space } from '@/theme/tokens'
import { Badge, Button, Card, Screen, Text, voice } from '@/ui'

// Browse corridors — anonymous-friendly. (Tapping a corridor opens its tours.)
export default function CorridorsScreen() {
  const theme = useTheme()
  const router = useRouter()
  const { data: session } = useSession()
  const [corridors, setCorridors] = useState<CorridorList['corridors']>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      const r = await listCorridors()
      setCorridors(r.corridors)
    } catch (e) {
      setError(e instanceof Error ? e.message : voice.error.generic)
    } finally {
      setLoading(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load]),
  )

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <Text variant="wordmark" color="ink">
              SKIPPER
            </Text>
          ),
        }}
      />

      <View style={styles.intro}>
        <Text variant="body" color="inkDim">
          {voice.greeting}
        </Text>
        {/* One-line descriptor so a cold newcomer knows what Skipper IS before any
            audio plays — the "smile before a word" thesis needs a what, not just a wink. */}
        <Text variant="dim" color="inkFaint">
          {voice.tagline}
        </Text>
        {session ? (
          <View style={styles.authRow}>
            <Text variant="dim" color="inkFaint" numberOfLines={1} style={styles.flex}>
              Riding as {session.user.email}
            </Text>
            <Button variant="ghost" title="Sign out" fullWidth={false} onPress={() => signOut()} />
          </View>
        ) : (
          <View style={styles.authRow}>
            <Text variant="dim" color="inkFaint" style={styles.flex}>
              {voice.guest}
            </Text>
            <Button
              variant="ghost"
              title="Sign in"
              fullWidth={false}
              onPress={() => router.push('/sign-in')}
            />
          </View>
        )}
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={theme.colors.accent} />
          <Text variant="dim" color="inkFaint" align="center">
            {voice.loading.corridors}
          </Text>
        </View>
      ) : error ? (
        <View style={styles.loading}>
          <Text variant="body" color="danger" align="center">
            {error}
          </Text>
          <Button variant="secondary" title={voice.error.retry} fullWidth={false} onPress={load} />
        </View>
      ) : (
        <FlatList
          data={corridors}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={theme.colors.accent}
            />
          }
          ListEmptyComponent={
            <Text variant="body" color="inkDim" align="center" style={styles.pad}>
              {voice.empty.corridors}
            </Text>
          }
          renderItem={({ item }) => (
            <Card
              onPress={() =>
                router.push({
                  pathname: '/corridor/[id]',
                  params: { id: item.id, name: item.name },
                })
              }
            >
              <Text variant="title" color="ink">
                {item.name}
              </Text>
              <View style={styles.metaRow}>
                <Text variant="label" color="inkFaint">
                  {item.region}
                </Text>
                {item.durationSeconds ? (
                  <Badge tone="amber" label={`${Math.round(item.durationSeconds / 60)} MIN`} />
                ) : null}
              </View>
              {item.summary ? (
                <Text variant="body" color="inkDim" style={styles.summary}>
                  {item.summary}
                </Text>
              ) : null}
            </Card>
          )}
        />
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  intro: {
    paddingHorizontal: space.gutter,
    paddingTop: space.sm,
    paddingBottom: space.xs,
    gap: space.xs,
  },
  authRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.sm,
  },
  list: { padding: space.gutter, gap: space.md },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs },
  summary: { marginTop: space.xs },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    padding: space.xxl,
  },
  pad: { padding: space.gutter },
})
