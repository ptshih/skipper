import { useCallback, useEffect, useRef, useState } from 'react'
import { Animated, StyleSheet, View } from 'react-native'
import { Stack, useFocusEffect, useRouter } from 'expo-router'
import { errorMessage, listDrives, type DriveSummary } from '@/lib/api'
import { useSession } from '@/lib/auth'
import { useIsOffline } from '@/lib/connectivity'
import { listDownloadedDrives } from '@/lib/offline'
import { cleanPlaceName } from '@/lib/labels'
import { space } from '@/theme/tokens'
import { Badge, Button, Card, Divider, HeaderIconButton, RouteTrack, Screen, Skeleton, SkeletonGroup, Sunburst, Text, voice } from '@/ui'

// Home — the two first-day modes, ranked by friction. RIDE ALONG (roam) is the PRIMARY CTA: it
// works anonymously, no plan, the front door for a new rider. CREATE A DRIVE is the secondary,
// higher-intent action (account-gated at the create tap). MY DRIVES — the rider's saved drives —
// sits at the bottom as a list (or a zero-state). A framed travel-poster hero crowns it.
export default function HomeScreen() {
  const router = useRouter()
  const { data: session } = useSession()
  // Both mode CTAs open with a fetch, so with no network they lead nowhere. Dim them and say so
  // rather than let two live-looking amber buttons hand the rider a spinner and an error.
  const isOffline = useIsOffline()
  const [drives, setDrives] = useState<DriveSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // True when the /drives fetch failed but saved downloads carried us (dead-zone fallback).
  const [offline, setOffline] = useState(false)
  // Free-tier credit balance for the gentle "N free drives left" hint. Null = hidden: anonymous, paid
  // (server sends credits:null for uncapped), or an older server without the field.
  const [credits, setCredits] = useState<{ remaining: number; cap: number } | null>(null)

  // Navigation in-flight guard: expo-router does NOT de-dupe identical pushes, so a fast
  // double-tap would stack two identical screens. Set on the first push, cleared on refocus.
  const navigatingRef = useRef(false)
  const navigateOnce = useCallback((go: () => void) => {
    if (navigatingRef.current) return
    navigatingRef.current = true
    go()
  }, [])

  // The signature car token, parked at the trailhead (~0.12). STATIC: created once and never
  // animated. The home has no NOW card, so this halo is the screen's sole amber glow.
  const parkedAnim = useRef(new Animated.Value(0.12)).current

  const load = useCallback(async () => {
    setError(null)
    // Anonymous riders can't own drives (creating one needs a free account), so skip the gated
    // call and show whatever's saved on disk (normally nothing → the zero-state invite to create).
    if (!session) {
      setDrives(listDownloadedDrives())
      setOffline(false)
      setCredits(null) // anonymous (or signed-out) — no credit balance to show
      setLoading(false)
      return
    }
    try {
      const r = await listDrives()
      setDrives(r.drives)
      setCredits(r.credits ?? null) // null for paid/uncapped (or an older server) → hint hidden
      setOffline(false)
    } catch (e) {
      // Offline-first: in a dead zone the list fetch fails — fall back to the drives saved on disk
      // so they stay reachable rather than a blank error wall.
      const saved = listDownloadedDrives()
      if (saved.length > 0) {
        setDrives(saved)
        setOffline(true)
      } else {
        setError(errorMessage(e, voice.error.generic))
      }
    } finally {
      setLoading(false)
    }
  }, [session])

  useFocusEffect(
    useCallback(() => {
      navigatingRef.current = false // any in-flight nav settled (or the rider backed out)
      load()
    }, [load]),
  )

  // Self-heal on the offline→online edge: the load that failed out here re-runs the moment the bars
  // come back, so a rider who drives back into signal never has to know to tap the retry. Guarded on
  // the TRANSITION (not on `!isOffline`) so it never doubles up with the focus load above.
  const wasOffline = useRef(false)
  useEffect(() => {
    if (wasOffline.current && !isOffline) load()
    wasOffline.current = isOffline
  }, [isOffline, load])

  const settingsButton = (
    <HeaderIconButton name="settings" accessibilityLabel="Settings" onPress={() => router.push('/settings')} />
  )
  const signInButton = (
    <Button variant="ghost" title="Sign in" fullWidth={false} onPress={() => router.push('/sign-in')} />
  )

  // The travel-poster hero — a frameless masthead: a faint WPA sunburst behind the enamel kicker →
  // big Alfa-Slab headline → the signature trail with the parked rig (the one amber glow) → tagline.
  const hero = (
    <View style={styles.hero}>
      <View style={styles.heroSunburst} pointerEvents="none">
        <Sunburst size={168} opacity={0.09} />
      </View>
      <Text variant="label" color="accentWarm">
        {voice.home.kicker}
      </Text>
      <Text variant="display" color="ink" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5} style={styles.heroHeadline}>
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

  // RIDE ALONG — the PRIMARY CTA (amber). Lowest friction: anonymous, no plan. CREATE A DRIVE —
  // the secondary action just under it. Each carries a one-line blurb.
  const modes = (
    <View style={styles.modes}>
      {/* Offline: one honest note, and the CTAs below it dimmed to match. Both modes OPEN with a
          fetch (roam pulls its pin manifest, create lists regions), so out here the tap has nothing
          behind it. The note ends on what still works whenever there IS something saved. */}
      {isOffline ? (
        <Text variant="dim" color="inkFaint" align="center">
          {drives.length > 0
            ? `${voice.offline.needsSignal} ${voice.offline.needsSignalSaved}`
            : voice.offline.needsSignal}
        </Text>
      ) : null}
      <View style={styles.modeBlock}>
        <Button icon="car" title={voice.roam.start} disabled={isOffline} onPress={() => navigateOnce(() => router.push('/roam'))} fullWidth />
        <Text variant="dim" color="inkFaint" align="center">
          Pull over for stories as you go — no plan needed.
        </Text>
        {/* Cold-open escape hatch: Ride Along needs Tahoe proximity, so a first-timer anywhere else
            (and an App Review tester) hits "I don't know these roads yet." This ghost link — no amber,
            doesn't demote the primary — lets ANYONE hear one curated clip in one permission-free tap. */}
        <Button
          variant="ghost"
          title={voice.sample.homeLink}
          disabled={isOffline}
          onPress={() => navigateOnce(() => router.push('/sample'))}
          fullWidth={false}
        />
      </View>
      <View style={styles.modeBlock}>
        <Button variant="secondary" icon="map" title="Create a Drive" glow={false} disabled={isOffline} onPress={() => navigateOnce(() => router.push('/create'))} fullWidth />
        <Text variant="dim" color="inkFaint" align="center">
          Pick a start and end; the skipper lines up the stories.
        </Text>
      </View>
    </View>
  )

  return (
    <Screen scroll padded edges={['bottom']} contentContainerStyle={styles.body}>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <Text variant="wordmark" color="ink">
              SKIPPER
            </Text>
          ),
          headerTitleAlign: 'center',
          headerLeft: () => (session ? undefined : signInButton),
          headerRight: () => settingsButton,
          unstable_headerLeftItems: () =>
            session ? [] : [{ type: 'custom', hidesSharedBackground: true, element: signInButton }],
          unstable_headerRightItems: () => [
            { type: 'custom', hidesSharedBackground: true, element: settingsButton },
          ],
        }}
      />

      {hero}
      {modes}

      {/* MY DRIVES — the rider's saved drives at the bottom: a list, or a zero-state invite. */}
      <View style={styles.section}>
        <Divider dashed />
        <View style={styles.sectionHead}>
          <Text variant="label" color="accentWarm" style={styles.flex}>
            MY DRIVES
          </Text>
          {/* Gentle, free-tier-only credit hint — informational, not a depleting "X-left-of-N" toll gauge. */}
          {credits ? (
            <Text variant="label" color="inkFaint">
              {credits.remaining > 0
                ? `${credits.remaining} free ${credits.remaining === 1 ? 'drive' : 'drives'} left`
                : 'No free drives left'}
            </Text>
          ) : null}
        </View>
        {offline ? (
          <Text variant="dim" color="inkFaint" style={styles.offlineNote}>
            {voice.offline.home}
          </Text>
        ) : null}

        {loading ? (
          <SkeletonGroup accessibilityLabel={voice.loading.drives} style={styles.list}>
            <DriveCardSkeleton />
            <DriveCardSkeleton />
          </SkeletonGroup>
        ) : error ? (
          <View style={styles.zeroState}>
            <Text variant="body" color="danger" align="center">
              {error}
            </Text>
            <Button variant="ghost" title={voice.error.retry} fullWidth={false} onPress={load} />
          </View>
        ) : drives.length === 0 ? (
          <Card>
            <Text variant="body" color="inkDim" align="center">
              No drives yet — plan one and it lands here for the road.
            </Text>
          </Card>
        ) : (
          <View style={styles.list}>
            {drives.map((dr) => {
              const min = dr.durationSeconds ? Math.round(dr.durationSeconds / 60) : null
              return (
                <View
                  key={dr.driveId}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={`${dr.label}${dr.clipCount ? `, ${dr.clipCount} stops` : ''}${min ? `, ${min} minutes` : ''}`}
                >
                  <Card onPress={() => navigateOnce(() => router.push({ pathname: '/drives/[id]', params: { id: dr.driveId } }))}>
                    <Text variant="title" color="ink" numberOfLines={2}>
                      {cleanPlaceName(dr.label)}
                    </Text>
                    <View style={styles.metaRow}>
                      <Text variant="label" color="inkFaint" style={styles.flex}>
                        {dr.clipCount} {dr.clipCount === 1 ? 'stop' : 'stops'}
                      </Text>
                      {min ? <Badge tone="amber" label={`${min} MIN`} /> : null}
                    </View>
                  </Card>
                </View>
              )
            })}
          </View>
        )}
      </View>
    </Screen>
  )
}

// A drive card's silhouette while the list loads. Inert; the enclosing SkeletonGroup owns the pulse.
function DriveCardSkeleton() {
  return (
    <Card>
      <Skeleton width="72%" height={20} />
      <Skeleton width="48%" height={12} style={styles.skLine} />
    </Card>
  )
}

const styles = StyleSheet.create({
  body: { gap: space.md },
  flex: { flex: 1 },
  hero: { paddingTop: space.sm, paddingBottom: space.md, overflow: 'hidden' },
  heroSunburst: { position: 'absolute', top: -54, right: -38 },
  heroHeadline: { marginTop: space.sm },
  heroTrail: { marginTop: space.md, marginBottom: space.md },
  modes: { gap: space.lg },
  modeBlock: { gap: space.xs }, // a CTA + its tucked caption read as one unit
  section: { marginTop: space.lg },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md, marginBottom: space.sm },
  offlineNote: { marginBottom: space.sm },
  list: { gap: space.md },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  zeroState: { gap: space.md, alignItems: 'center', paddingVertical: space.md },
  skLine: { marginTop: space.sm },
})
