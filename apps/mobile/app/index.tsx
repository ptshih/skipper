import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Animated, FlatList, RefreshControl, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Stack, useFocusEffect, useRouter } from 'expo-router'
import { errorMessage, listTours, type TourList } from '@/lib/api'
import { useSession } from '@/lib/auth'
import { listDownloadedTours } from '@/lib/offline'
import { cleanPlaceName } from '@/lib/labels'
import { useDrivesFilter } from '@/lib/drives-filter'
import { deriveRegions, filterByRegion } from '@/lib/regions'
import { useTheme } from '@/theme'
import { space } from '@/theme/tokens'
import { Badge, Button, Card, Divider, EdgeFade, FilterChip, HeaderIconButton, Icon, RouteTrack, Screen, Sunburst, Text, voice } from '@/ui'

// Browse drives — anonymous-friendly. A tour is the whole self-contained drive now, so a
// card opens straight into the drive (gated). The top is a framed travel-poster hero with
// the signature car-token-on-the-trail motif; below it the "THE DRIVES" seam carries a
// location filter ("Where to?") — a region chip, live whenever the catalog has a region.
export default function DrivesScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { data: session } = useSession()
  const { regions, setRegions, selectedRegion, setSelectedRegion } = useDrivesFilter()
  const [tours, setTours] = useState<TourList['tours']>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // True when the catalog fetch failed but saved downloads carried us (dead-zone fallback).
  const [offline, setOffline] = useState(false)

  // The signature car token, parked at the trailhead (~0.12 — clearly ON the road, not
  // flush at the gutter, the rig "ready to roll"). STATIC: created once and never
  // animated, so it satisfies both the one-thing-animating and the one-glowing-amber
  // rules. The home has no NOW card, so this halo is the screen's sole amber glow.
  const parkedAnim = useRef(new Animated.Value(0.12)).current

  const load = useCallback(async () => {
    try {
      setError(null)
      const r = await listTours()
      setTours(r.tours)
      setOffline(false)
    } catch (e) {
      // Offline-first: in a dead zone the catalog fetch fails — fall back to the drives the
      // rider has saved so they stay browsable (and reachable) rather than a blank error wall.
      const saved = listDownloadedTours()
      if (saved.length > 0) {
        setTours(saved)
        setOffline(true)
      } else {
        setError(errorMessage(e, voice.error.generic))
      }
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
    const opts = deriveRegions(tours)
    setRegions(opts)
    setSelectedRegion((cur) => (cur && opts.some((o) => o.slug === cur) ? cur : null))
  }, [tours, setRegions, setSelectedRegion])

  // The drives shown, narrowed to the picked region (null = all).
  const visibleTours = useMemo(
    () => filterByRegion(tours, selectedRegion),
    [tours, selectedRegion],
  )
  const selectedRegionName = regions.find((o) => o.slug === selectedRegion)?.name ?? null

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

  // The travel-poster hero, a FRAMELESS MASTHEAD over the two CO-EQUAL mode sections below
  // (Ride along / The drives — founder 2026-06-11: roam promoted from a guest card to a peer):
  // a faint WPA sunburst watermark behind the enamel kicker → big Alfa-Slab headline (the
  // persona's line) → the signature trail with the parked rig (the one amber glow) → the
  // quiet "what is this" tagline (now naming BOTH modes).
  const hero = (
    <View style={styles.hero}>
      <View style={styles.heroSunburst} pointerEvents="none">
        <Sunburst size={168} opacity={0.09} />
      </View>
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
    </View>
  )

  // The hero + the dashed seam that introduces the list (and carries the location filter),
  // used as the FlatList header so it scrolls away as you browse. (Loading/error render the
  // hero alone — without the seam — so the seam never dangles above a spinner.)
  const listHeader = (
    <>
      {hero}
      {/* RIDE ALONG — a CO-EQUAL mode SECTION, peer to THE DRIVES (never a tab). De-framed
          from its old card to a flat section that MATCHES the drives header below, so the home
          reads as "two modes" rather than a tours list with a roam card wedged in. NO glow —
          the hero's parked rig owns the home screen's one amber glow. */}
      <View style={styles.section}>
        <Divider dashed />
        <View style={styles.sectionHead}>
          <Text variant="label" color="accentWarm" style={styles.flex}>
            {voice.roam.entryKicker}
          </Text>
          <Badge tone="teal" label={voice.roam.entryAlpha} />
        </View>
        <Text variant="body" color="inkDim" style={styles.sectionBlurb}>
          {voice.roam.entryBlurb}
        </Text>
        <Button
          icon="car"
          title={voice.roam.start}
          onPress={() => router.push('/roam')}
          glow={false}
          fullWidth
        />
      </View>
      {/* THE DRIVES — the peer section; the tours list renders below as this section's content.
          Same header treatment as RIDE ALONG (matching dashed seam + accentWarm kicker) so the
          two sit at equal altitude. */}
      <View style={styles.section}>
        <Divider dashed />
        <View style={styles.sectionHead}>
          <Text variant="label" color="accentWarm" style={styles.flex}>
            {voice.home.section}
          </Text>
          {/* Show the region filter whenever there's a region to pick. (With one region
              today, picking it is a no-op — but the chip + picker are live.) */}
          {regions.length > 0 ? (
            <FilterChip
              label={selectedRegionName ?? voice.home.where.all}
              active={selectedRegion !== null}
              onPress={() => router.push('/regions')}
              accessibilityLabel={`Filter drives by region: ${selectedRegionName ?? voice.home.where.all}`}
            />
          ) : null}
        </View>
        {offline ? (
          <Text variant="dim" color="inkFaint" style={styles.offlineNote}>
            {voice.offline.home}
          </Text>
        ) : null}
      </View>
    </>
  )

  // The FlatList scrolls, so it owns the bottom safe-area inset as content paddingBottom (drop
  // 'bottom' from Screen's frame edges): the last card scrolls clear of the home indicator
  // instead of clipping at an opaque inset band — same rationale as Screen's scroll path.
  return (
    <Screen edges={[]}>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <Text variant="wordmark" color="ink">
              SKIPPER
            </Text>
          ),
          // The wordmark sits DEAD-CENTER, so the two affordances balance across it: "Sign in"
          // rides headerLeft, the gear headerRight (gear-only once signed in). Without this the
          // one-sided [Sign in + gear] cluster shoved SKIPPER off to the left.
          // headerTitleAlign keeps it centered on Android too (iOS centers by default).
          headerTitleAlign: 'center',
          // headerLeft / headerRight cover Android + iOS<26; the *Items API below overrides
          // them on iOS 26 to strip the Liquid Glass capsule. (Home is root — no back button
          // contends for headerLeft.)
          headerLeft: () => (session ? undefined : signInButton),
          headerRight: () => settingsButton,
          // iOS 26: every nav-bar button MUST carry hidesSharedBackground:true or its bright
          // Liquid Glass capsule becomes a second glowing element on the dusk bar (it would
          // break the one-amber-glow budget). Mirrors the back/gear handling in _layout.tsx.
          unstable_headerLeftItems: () =>
            session
              ? []
              : [{ type: 'custom', hidesSharedBackground: true, element: signInButton }],
          unstable_headerRightItems: () => [
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
              {voice.loading.drives}
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
        // The scrolling drives list owns the soft top/bottom edge fades — content dissolves
        // under the header and at the bottom edge, like every Screen-scroll surface.
        <View style={styles.flex}>
        <FlatList
          data={visibleTours}
          keyExtractor={(t) => t.id}
          ListHeaderComponent={listHeader}
          contentContainerStyle={[styles.list, { paddingBottom: space.gutter + insets.bottom }]}
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
                  title={voice.home.where.showAll}
                  fullWidth={false}
                  onPress={() => setSelectedRegion(null)}
                />
              </View>
            ) : (
              <Text variant="body" color="inkDim" align="center" style={styles.pad}>
                {voice.empty.drives}
              </Text>
            )
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Card
                onPress={() => router.push({ pathname: '/tours/[id]', params: { id: item.id } })}
              >
                <Text variant="title" color="ink">
                  {item.headline}
                </Text>
                <View style={styles.metaRow}>
                  <Text variant="label" color="inkFaint" style={styles.flex} numberOfLines={1}>
                    {item.startAnchorName} → {item.endAnchorName}
                  </Text>
                  {item.durationSeconds ? (
                    <Badge tone="amber" label={`${Math.round(item.durationSeconds / 60)} MIN`} />
                  ) : null}
                </View>
                {item.teaser ? (
                  // The teaser is a names list ("A & B") — clean the ", California" title suffix
                  // off each (safe here; summary is prose, so it's left untouched).
                  <Text variant="body" color="inkDim" numberOfLines={1} style={styles.summary}>
                    {cleanPlaceName(item.teaser)}
                  </Text>
                ) : item.summary ? (
                  <Text variant="body" color="inkDim" style={styles.summary}>
                    {item.summary}
                  </Text>
                ) : null}
              </Card>
            </View>
          )}
        />
        <EdgeFade />
        </View>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // Hero + seam each carry their own horizontal gutter so they line up whether rendered
  // standalone (loading/error) or inside the FlatList, whose content padding is vertical.
  hero: { paddingHorizontal: space.gutter, paddingTop: space.sm, paddingBottom: space.md, overflow: 'hidden' },
  heroSunburst: { position: 'absolute', top: -54, right: -38 },
  heroHeadline: { marginTop: space.sm },
  heroTrail: { marginTop: space.md, marginBottom: space.md },
  // Two co-equal mode sections (Ride along / The drives) share this header treatment so they
  // sit at equal altitude — a dashed seam, an accentWarm kicker, matching gutters.
  section: { paddingHorizontal: space.gutter, marginTop: space.lg },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.md,
    marginBottom: space.sm,
  },
  sectionBlurb: { marginBottom: space.md },
  list: { paddingVertical: space.gutter, gap: space.md },
  row: { paddingHorizontal: space.gutter },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  summary: { marginTop: space.xs },
  offlineNote: { marginTop: space.sm },
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
