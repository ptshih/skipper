import { useCallback, useRef, useState } from 'react'
import { ActionSheetIOS, Alert, Animated, Platform, StyleSheet, View } from 'react-native'
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { ApiError, getTour, type TourDetail } from '@/lib/api'
import {
  deleteTourDownload,
  downloadTour,
  isTourDownloaded,
  loadManifest,
  type DownloadProgress,
} from '@/lib/offline'
import { cleanPlaceName, stopLabel } from '@/lib/labels'
import { space } from '@/theme/tokens'
import {
  AccountGate,
  Button,
  Card,
  Divider,
  HeaderIconButton,
  Icon,
  RouteTrack,
  Screen,
  StateView,
  StopList,
  Text,
  stopIcon,
  voice,
} from '@/ui'

// Tour detail. Open to anyone (the detail fetch uses the `preview` funnel path), so every
// tour is browsable + previewable anonymously. The wall is on the LIVE DRIVE + OFFLINE
// download (their gated fetches still 401 anonymous → AccountGate). Offers the live GPS
// drive (the M1 phone player, fed by a simulated fix source) + the couch preview + manifest.
export default function TourScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const [tour, setTour] = useState<TourDetail | null>(null)
  const [needsAccount, setNeedsAccount] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // True when the detail fetch failed but a saved download carried us (dead-zone fallback).
  const [offline, setOffline] = useState(false)
  // Offline download state — Tahoe has dead zones, so a rider can save the whole drive.
  const [downloaded, setDownloaded] = useState(false)
  const [downloading, setDownloading] = useState<DownloadProgress | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  // The signature rig, parked at the trailhead (~0.06) on the placard's static trail. Created
  // once, never animated — a still motif (the Start CTA owns this screen's one amber glow).
  const parked = useRef(new Animated.Value(0.06)).current

  const startDownload = useCallback(async () => {
    if (!id) return
    setDownloadError(null)
    setDownloading({ done: 0, total: 0 })
    try {
      await downloadTour(id, setDownloading)
      setDownloaded(true)
    } catch (e) {
      // A gated (non-preview) tour download 401s when the account lapsed — show the
      // AccountGate. Everything else is a network/verify failure (no useful raw message for
      // a rider), so speak the persona line instead of leaking e.message.
      if (e instanceof ApiError && e.needsAccount) setNeedsAccount(true)
      else setDownloadError(voice.error.download)
    } finally {
      setDownloading(null)
    }
  }, [id])

  const removeDownload = useCallback(() => {
    if (!id) return
    deleteTourDownload(id)
    setDownloaded(false)
  }, [id])

  // Secondary/utility actions live in a header ⋯ menu (native iOS action sheet) instead of
  // stacked buttons — the offline download (state-aware) + the dev-only on-device simulator.
  const openMenu = useCallback(() => {
    const actions: { label: string; onPress: () => void; destructive?: boolean }[] = []
    if (downloaded) {
      actions.push({ label: 'Remove offline download', onPress: removeDownload, destructive: true })
    } else if (!downloading) {
      actions.push({ label: 'Download for offline', onPress: () => void startDownload() })
    }
    if (__DEV__) {
      actions.push({ label: voice.cta.simDrive, onPress: () => router.push(`/tours/${id}/play`) })
    }
    if (actions.length === 0) return
    const destructive = actions.findIndex((a) => a.destructive)
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...actions.map((a) => a.label), 'Cancel'],
          cancelButtonIndex: actions.length,
          destructiveButtonIndex: destructive >= 0 ? destructive : undefined,
        },
        (i) => actions[i]?.onPress(),
      )
    } else {
      Alert.alert('Tour options', undefined, [
        ...actions.map((a) => ({
          text: a.label,
          onPress: a.onPress,
          style: a.destructive ? ('destructive' as const) : undefined,
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ])
    }
  }, [downloaded, downloading, id, router, startDownload, removeDownload])

  // Don't render a dead header button: download/remove is offer-able except mid-download;
  // the dev simulator is always there in __DEV__.
  const hasMenuActions = __DEV__ || downloaded || !downloading

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    setNeedsAccount(false)
    try {
      // Open funnel: any tour's detail is viewable anonymously so the Preview CTA is reachable.
      setTour(await getTour(id, { preview: true }))
      setOffline(false)
    } catch (e) {
      if (e instanceof ApiError && e.needsAccount) setNeedsAccount(true)
      else {
        // Offline-first: if this drive is downloaded, render from the saved manifest so "Start
        // the drive" + the preview stay reachable in a dead zone (the player is offline-first).
        // Otherwise surface the error. (The error wall used to hide a fully-downloaded drive.)
        const m = loadManifest(id)
        if (m) {
          setTour(m.detail)
          setOffline(true)
        } else {
          setError(e instanceof Error ? e.message : voice.error.generic)
        }
      }
    } finally {
      setLoading(false)
    }
  }, [id])

  useFocusEffect(
    useCallback(() => {
      load()
      if (id) setDownloaded(isTourDownloaded(id))
    }, [load, id]),
  )

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

  const durationMin = tour.tour.durationSeconds
    ? Math.round(tour.tour.durationSeconds / 60)
    : null

  return (
    <Screen scroll padded edges={['bottom']} contentContainerStyle={styles.body}>
      <Stack.Screen
        options={{
          // The header is a breadcrumb (the region) — the Alfa-Slab hero in the placard owns the
          // tour name, so the two no longer say the same thing within one glance.
          title: tour.region.displayName,
          ...(hasMenuActions
            ? {
                headerRight: () => (
                  <HeaderIconButton name="more" accessibilityLabel="More actions" onPress={openMenu} />
                ),
                // iOS 26: strip the Liquid Glass capsule so the chip isn't a second glow (mirrors index).
                unstable_headerRightItems: () => [
                  {
                    type: 'custom',
                    hidesSharedBackground: true,
                    element: (
                      <HeaderIconButton
                        name="more"
                        accessibilityLabel="More actions"
                        onPress={openMenu}
                      />
                    ),
                  },
                ],
              }
            : {}),
        }}
      />

      {/* THE TRAILHEAD SIGN — a carved ranger placard: region kicker → headline → start→end
          anchors → the trail with the rig parked at the start → a stamped permit line. */}
      <Card framed style={styles.placard}>
        <Text variant="label" color="accentWarm">
          {tour.region.displayName.toUpperCase()}
        </Text>
        <Text variant="display" color="ink">
          {tour.tour.headline}
        </Text>
        <Text variant="label" color="inkFaint">
          {tour.tour.startAnchor.name} → {tour.tour.endAnchor.name}
        </Text>
        <View style={styles.trail}>
          <RouteTrack progress={parked} glow={false} />
        </View>
        <Divider dashed />
        <View style={styles.permitRow}>
          <Text variant="monoStrong" color="inkDim">
            {tour.stops.length} STOPS{durationMin ? ` · ~${durationMin} MIN` : ''}
          </Text>
          {/* Offline state rides here as a compact chip — the ACTION lives in the ⋯ menu. */}
          {downloading ? (
            <Text variant="label" color="inkFaint">
              Saving {downloading.done}/{downloading.total || '…'}
            </Text>
          ) : downloaded ? (
            <View style={styles.savedChip}>
              <Icon name="downloaded" size={14} color="accent" />
              <Text variant="label" color="accent">
                Saved offline
              </Text>
            </View>
          ) : null}
        </View>
      </Card>

      {/* The crown-jewel blurb — finally shown (it was authored but never rendered anywhere). */}
      {tour.tour.summary ? (
        <Text variant="body" color="inkDim">
          {tour.tour.summary}
        </Text>
      ) : null}

      {offline ? (
        <Text variant="dim" color="inkFaint">
          {voice.offline.detail}
        </Text>
      ) : null}

      {/* Two real choices only — the live drive (M1 headline) + the free couch preview (the
          funnel, and the only play path for anonymous riders). The dev simulator + offline
          download moved to the header ⋯ menu so this stays glanceable. */}
      <Button icon="car" title={voice.cta.drive} onPress={() => router.push(`/tours/${id}/play?mode=live`)} />
      <Text variant="dim" color="inkDim">
        {voice.drive.blurb}
      </Text>

      <Button
        variant="secondary"
        icon="play"
        title={voice.cta.preview}
        onPress={() => router.push(`/tours/${id}/play?mode=preview`)}
      />

      {downloadError ? (
        <Text variant="dim" color="danger">
          {downloadError}
        </Text>
      ) : null}

      {/* THE ITINERARY — the shared StopList (same card + hairline-ruled rows as the in-drive
          player). No raw per-stop seconds — the tally lives on the sign. */}
      <StopList
        title={`THE ROUTE · ${tour.stops.length} STOPS`}
        items={tour.stops.map((s) => ({
          seq: s.seq,
          name: cleanPlaceName(s.name),
          sublabel: stopLabel(s.stopType),
          icon: stopIcon(s.stopType),
        }))}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: { gap: space.md },
  placard: { gap: space.sm },
  trail: { marginTop: space.xs },
  permitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  savedChip: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
})
