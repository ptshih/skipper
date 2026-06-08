import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Animated, FlatList, RefreshControl, StyleSheet, View } from 'react-native'
import { Stack, useFocusEffect, useRouter } from 'expo-router'
import { listCorridors, type CorridorList } from '@/lib/api'
import { useSession } from '@/lib/auth'
import { useDrivesFilter } from '@/lib/drives-filter'
import { deriveRegions, filterByRegion } from '@/lib/regions'
import { useTheme } from '@/theme'
import { space } from '@/theme/tokens'
import { Badge, Button, Card, Divider, FilterChip, HeaderIconButton, RouteTrack, Screen, Text, voice } from '@/ui'

// Browse corridors — anonymous-friendly. (Tapping a corridor opens its tours.) The top
// is a framed travel-poster hero with the signature car-token-on-the-trail motif; below it
// the "THE DRIVES" seam carries a location filter ("Where to?") — a region chip that's
// hidden until the catalog spans >=2 regions, so today's Tahoe-only build ships unchanged.
export default function CorridorsScreen() {
  const theme = useTheme()
  const router = useRouter()
  const { data: session } = useSession()
  const { regions, setRegions, selectedRegion, setSelectedRegion } = useDrivesFilter()
  const [corridors, setCorridors] = useState<CorridorList['corridors']>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The signature car token, parked at the trailhead (~0.12 — clearly ON the road, not
  // flush at the gutter, the rig "ready to roll"). STATIC: created once and never
  // animated, so it satisfies both the one-thing-animating and the one-glowing-amber
  // rules. The home has no NOW card, so this halo is the screen's sole amber glow.
  const parkedAnim = useRef(new Animated.Value(0.12)).current

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

  // Publish the regions present in the catalog into the filter context (the "Where to?"
  // picker reads them), and drop a selected region that's no longer present (e.g. after a
  // refresh removed it) so the list can't get stuck filtered to nothing.
  useEffect(() => {
    const opts = deriveRegions(corridors)
    setRegions(opts)
    setSelectedRegion((cur) => (cur && opts.some((o) => o.region === cur) ? cur : null))
  }, [corridors, setRegions, setSelectedRegion])

  // The drives shown, narrowed to the picked region (null = all).
  const visibleCorridors = useMemo(
    () => filterByRegion(corridors, selectedRegion),
    [corridors, selectedRegion],
  )

  // The settings gear (our themed circular chip), shared by headerRight (Android +
  // iOS<26) and the iOS-26 *Items API below — the latter strips the Liquid Glass capsule
  // via hidesSharedBackground. See app/_layout.tsx for the full rationale.
  const settingsButton = (
    <HeaderIconButton
      name="settings"
      accessibilityLabel="Settings"
      onPress={() => router.push('/settings')}
    />
  )

  // Sign-in is an OPTIONAL account affordance, NOT on the conversion path (the freemium
  // wall is the playback AccountGate, not the front door). So it rides quietly in the
  // header-right cluster, left of the gear — never a mid-body button competing with the
  // hero or the drives. Once signed in it disappears entirely; identity + Sign out live
  // in Settings behind the gear, so an anonymous newcomer sees ZERO account chrome below
  // the chrome line.
  const signInButton = (
    <Button
      variant="ghost"
      title="Sign in"
      fullWidth={false}
      onPress={() => router.push('/sign-in')}
    />
  )

  // The travel-poster hero: enamel kicker → big Alfa-Slab headline (the persona's line) →
  // the signature trail with the parked rig (the one amber glow) → the quiet "what is
  // this" tagline. `framed` is sanctioned here — the home is a non-driving surface.
  const hero = (
    <View style={styles.heroWrap}>
      <Card framed>
        <Text variant="label" color="accentWarm">
          {voice.home.kicker}
        </Text>
        {/* Keep the Alfa-Slab display face but auto-shrink to a single line — the headline
            is a fixed string, so adjustsFontSizeToFit fits it on every width (it wrapped to
            two lines at the full 30pt) without hardcoding a size that re-wraps on narrow phones. */}
        <Text
          variant="display"
          color="ink"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.5}
          style={styles.heroHeadline}
        >
          {voice.greeting}
        </Text>
        <View style={styles.heroTrail}>
          <RouteTrack progress={parkedAnim} glow />
        </View>
        <Text variant="dim" color="inkDim">
          {voice.tagline}
        </Text>
      </Card>
    </View>
  )

  // The hero + the dashed seam that introduces the list (and carries the location filter),
  // used as the FlatList header so it scrolls away as you browse. (Loading/error render the
  // hero alone — without the seam — so the seam never dangles above a spinner.)
  const listHeader = (
    <>
      {hero}
      <View style={styles.seam}>
        <Divider dashed />
        <View style={styles.seamRow}>
          <Text variant="label" color="inkFaint" style={styles.flex}>
            {voice.home.section}
          </Text>
          {/* Show the region filter whenever there's a region to pick. (With one region
              today, picking it is a no-op — but the chip + picker are live.) */}
          {regions.length > 0 ? (
            <FilterChip
              label={selectedRegion ?? voice.home.where.all}
              active={selectedRegion !== null}
              onPress={() => router.push('/regions')}
              accessibilityLabel={`Filter drives by region: ${selectedRegion ?? voice.home.where.all}`}
            />
          ) : null}
        </View>
      </View>
    </>
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
          // headerRight covers Android + iOS<26: a quiet ghost "Sign in" link sits left of
          // the settings gear (gear only once signed in). On iOS 26 the *Items API below
          // overrides it so we can strip the Liquid Glass capsule on BOTH chips.
          headerRight: () =>
            session ? (
              settingsButton
            ) : (
              <View style={styles.headerCluster}>
                {signInButton}
                {settingsButton}
              </View>
            ),
          // iOS 26: every nav-bar button MUST carry hidesSharedBackground:true or its bright
          // Liquid Glass capsule becomes a second glowing element on the dusk bar (it would
          // break the one-amber-glow budget). Mirrors the back/gear handling in _layout.tsx.
          unstable_headerRightItems: () =>
            session
              ? [{ type: 'custom', hidesSharedBackground: true, element: settingsButton }]
              : [
                  { type: 'custom', hidesSharedBackground: true, element: signInButton },
                  { type: 'custom', hidesSharedBackground: true, element: settingsButton },
                ],
        }}
      />

      {loading ? (
        <>
          {hero}
          <View style={styles.loading}>
            <ActivityIndicator color={theme.colors.accent} />
            <Text variant="dim" color="inkFaint" align="center">
              {voice.loading.corridors}
            </Text>
          </View>
        </>
      ) : error ? (
        <>
          {hero}
          <View style={styles.loading}>
            <Text variant="body" color="danger" align="center">
              {error}
            </Text>
            <Button variant="secondary" title={voice.error.retry} fullWidth={false} onPress={load} />
          </View>
        </>
      ) : (
        <FlatList
          data={visibleCorridors}
          keyExtractor={(c) => c.id}
          ListHeaderComponent={listHeader}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={theme.colors.accent}
            />
          }
          ListEmptyComponent={
            // With the picker only ever listing non-empty regions, a filtered dead-end is
            // near-impossible — but if it happens, soft-degrade in the skipper's voice with
            // a one-tap reset rather than a blank wall.
            selectedRegion ? (
              <View style={styles.emptyWrap}>
                <Text variant="body" color="inkDim" align="center">
                  {voice.home.where.empty}
                </Text>
                <Button
                  variant="ghost"
                  title="Show all drives"
                  fullWidth={false}
                  onPress={() => setSelectedRegion(null)}
                />
              </View>
            ) : (
              <Text variant="body" color="inkDim" align="center" style={styles.pad}>
                {voice.empty.corridors}
              </Text>
            )
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
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
            </View>
          )}
        />
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  headerCluster: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
  // Hero + seam each carry their own horizontal gutter so they line up whether rendered
  // standalone (loading/error) or inside the FlatList, whose content padding is vertical.
  heroWrap: { paddingHorizontal: space.gutter, paddingTop: space.sm },
  heroHeadline: { marginTop: space.sm },
  heroTrail: { marginTop: space.md, marginBottom: space.md },
  seam: { paddingHorizontal: space.gutter, marginTop: space.lg },
  seamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.md,
    marginBottom: space.sm,
  },
  list: { paddingVertical: space.gutter, gap: space.md },
  row: { paddingHorizontal: space.gutter },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs },
  summary: { marginTop: space.xs },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    padding: space.xxl,
  },
  emptyWrap: { padding: space.gutter, gap: space.md, alignItems: 'center' },
  pad: { padding: space.gutter },
})
