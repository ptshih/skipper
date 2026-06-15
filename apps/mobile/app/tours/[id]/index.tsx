import { useCallback, useEffect, useRef, useState } from 'react'
import { ActionSheetIOS, Alert, Animated, Linking, Platform, Share, StyleSheet, View } from 'react-native'
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { ApiError, errorMessage, getTour, type TourDetail } from '@/lib/api'
import {
  deleteTourDownload,
  downloadTour,
  InsufficientStorageError,
  isDownloadStale,
  isTourDownloaded,
  loadManifest,
  type DownloadProgress,
} from '@/lib/offline'
import { cleanPlaceName } from '@/lib/labels'
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
  Skeleton,
  SkeletonGroup,
  StateView,
  StopList,
  Text,
  stopIcon,
  voice,
} from '@/ui'

// The shareable web face of a drive — the AASA-claimed universal link (apps/api/src/share.ts,
// app/t/[id].tsx). Override per-environment; defaults to the canonical brand domain.
const SHARE_BASE = process.env.EXPO_PUBLIC_WEB_URL ?? 'https://skipper.fm'
// "Report an issue" opens the rider's mail composer (no in-app support backend yet — alpha).
// Set EXPO_PUBLIC_SUPPORT_EMAIL to the real inbox; the default is a brand-domain placeholder.
const SUPPORT_EMAIL = process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? 'feedback@skipper.fm'

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
  // True when this drive IS downloaded but the server has re-cut its clips since (a re-synth or
  // regen). Detected on the online detail fetch; offers a re-pull. Never blocks offline play.
  const [updatable, setUpdatable] = useState(false)
  // The signature rig, parked at the trailhead (~0.06) on the placard's static trail. Created
  // once, never animated — a still motif (the Start CTA owns this screen's one amber glow).
  const parked = useRef(new Animated.Value(0.06)).current
  // Mirror of `tour` so load() can skip the full-screen spinner on a refocus refetch. (audit #531)
  const tourRef = useRef<TourDetail | null>(null)
  // Cancels an in-flight download (Cancel tap / screen unmount). (audit #816)
  const downloadAbort = useRef<AbortController | null>(null)

  const startDownload = useCallback(async () => {
    if (!id) return
    setDownloadError(null)
    setNeedsAccount(false) // a prior gate latch must not outlive a fresh attempt (audit #278)
    setDownloading({ done: 0, total: 0 })
    const ctrl = new AbortController()
    downloadAbort.current = ctrl
    try {
      await downloadTour(id, setDownloading, ctrl.signal)
      setDownloaded(true)
      setUpdatable(false) // a fresh pull writes the current tokens — no longer behind the server
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        // Canceled (navigated away / Cancel tap) — silent, no error toast.
      } else if (e instanceof ApiError && e.needsAccount) {
        // A gated (non-preview) download 401s when the account lapsed. Route to sign-in instead of
        // swapping the whole detail for a full-screen gate — the loaded tour + open preview stay
        // usable underneath. (audit #269)
        router.push('/sign-in')
      } else if (e instanceof InsufficientStorageError) {
        setDownloadError(voice.error.storage)
      } else {
        // Network/verify failure — no useful raw message for a rider; speak the persona line.
        setDownloadError(voice.error.download)
      }
    } finally {
      if (downloadAbort.current === ctrl) downloadAbort.current = null
      setDownloading(null)
    }
  }, [id, router])

  const removeDownload = useCallback(() => {
    if (!id) return
    deleteTourDownload(id)
    setDownloaded(false)
  }, [id])

  const cancelDownload = useCallback(() => {
    downloadAbort.current?.abort()
  }, [])

  // Cancel an in-flight download if the screen is torn down (audit #816). NOT on blur — the screen
  // stays mounted under the pushed player, so a download keeps running while the rider previews.
  useEffect(() => () => downloadAbort.current?.abort(), [])

  // Share the drive's universal link (skipper.fm/t/<id>) via the OS share sheet.
  const shareTour = useCallback(() => {
    if (!id) return
    const url = `${SHARE_BASE}/t/${id}`
    const headline = tour?.tour.headline
    void Share.share({
      message: headline ? `${headline} — a narrated road-trip drive on Skipper\n${url}` : url,
      url, // iOS attaches the link as its own item
    })
  }, [id, tour])

  // Report an issue → the rider's mail composer, pre-filled with the drive's context (no
  // in-app support backend yet — alpha). The address is env-configurable (SUPPORT_EMAIL).
  const reportIssue = useCallback(() => {
    const subject = encodeURIComponent('Skipper — report an issue')
    const body = encodeURIComponent(`\n\n—\nDrive: ${tour?.tour.headline ?? id ?? '—'}\nID: ${id ?? '—'}`)
    void Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`).catch(() => {})
  }, [id, tour])

  // Secondary/utility actions live in a header ⋯ menu (native iOS action sheet) instead of
  // stacked buttons — the offline download (state-aware) + the dev-only on-device simulator.
  const openMenu = useCallback(() => {
    const actions: { label: string; onPress: () => void; destructive?: boolean }[] = []
    actions.push({ label: 'Share this drive', onPress: shareTour })
    if (downloading) {
      actions.push({ label: 'Cancel download', onPress: cancelDownload, destructive: true })
    } else if (downloaded) {
      if (updatable) {
        // Re-pull overwrites the saved manifest + clips with the server's fresh cut.
        actions.push({ label: voice.offline.update, onPress: () => void startDownload() })
      }
      actions.push({ label: 'Remove download', onPress: removeDownload, destructive: true })
    } else {
      actions.push({ label: 'Download for offline', onPress: () => void startDownload() })
    }
    actions.push({ label: 'Report an issue', onPress: reportIssue })
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
  }, [
    downloaded,
    downloading,
    updatable,
    id,
    router,
    startDownload,
    removeDownload,
    cancelDownload,
    shareTour,
    reportIssue,
  ])

  // The ⋯ always has actions now — Share + Report are always offer-able (download/remove are
  // the state-aware extras).
  const hasMenuActions = true

  const load = useCallback(async () => {
    if (!id) return
    if (!tourRef.current) setLoading(true) // keep the loaded detail on a refocus refetch — no full-screen spinner flash (audit #531)
    setError(null)
    setNeedsAccount(false)
    try {
      // Open funnel: any tour's detail is viewable anonymously so the Preview CTA is reachable.
      const fresh = await getTour(id, { preview: true })
      setTour(fresh)
      tourRef.current = fresh
      setOffline(false)
      // Online: flag a saved copy whose clips the server has re-cut since the download (free —
      // we already hold the fresh detail). Returns false when nothing's downloaded.
      setUpdatable(isDownloadStale(id, fresh))
    } catch (e) {
      if (e instanceof ApiError && e.needsAccount) setNeedsAccount(true)
      else {
        // Offline-first: if this drive is downloaded, render from the saved manifest so "Start
        // the drive" + the preview stay reachable in a dead zone (the player is offline-first).
        // Otherwise surface the error. (The error wall used to hide a fully-downloaded drive.)
        const m = loadManifest(id)
        if (m) {
          setTour(m.detail)
          tourRef.current = m.detail
          setOffline(true)
          setUpdatable(false) // dead zone: no fresh detail to compare — never nag offline
        } else {
          setError(errorMessage(e, voice.error.generic))
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

  if (loading) return <TourDetailSkeleton />
  if (needsAccount)
    // A download 401 swaps the whole detail for the gate; "Keep browsing" dismisses BACK to the
    // tour (clears the gate) rather than the old back() that popped all the way to home.
    return (
      <AccountGate
        secondaryAction={{ label: voice.gate.keepBrowsing, onPress: () => setNeedsAccount(false) }}
      />
    )
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
              {/* Until the file count is known (total still 0), show a bare "Saving…" rather
                  than a "0/…" fraction that flickers as the manifest resolves. */}
              {downloading.total
                ? `Saving ${downloading.done}/${downloading.total}`
                : 'Saving…'}
            </Text>
          ) : downloaded && updatable ? (
            // A re-cut waits on the server — amber to read as "there's something new" (the ACTION
            // is in the ⋯ menu). Offline play still uses the saved copy until the rider re-pulls.
            <View style={styles.savedChip}>
              <Icon name="update" size={14} color="accentWarm" />
              <Text variant="label" color="accentWarm">
                {voice.offline.updateReady}
              </Text>
            </View>
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
          funnel, and the only play path for anonymous riders). Flattened: ONE bold primary
          with its caption tucked under it, and the preview demoted to a ghost link. The dev
          simulator + offline download live in the header ⋯ menu so this stays glanceable. */}
      <View style={styles.ctaGroup}>
        <Button icon="car" title={voice.cta.drive} onPress={() => router.push(`/tours/${id}/play?mode=live`)} />
        <Text variant="dim" color="inkFaint" align="center">
          {voice.drive.blurb}
        </Text>
      </View>

      <Button
        variant="ghost"
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
          icon: stopIcon(s.stopType),
        }))}
      />
    </Screen>
  )
}

// The trailhead-placard silhouette shown while the detail loads — mirrors the real layout
// (placard → blurb → CTA → route list) so the screen reveals in place. Reuses the screen's own
// layout styles so the skeleton lines sit exactly where the real text will. The enclosing
// SkeletonGroup owns the single pulse; the persona line rides as the VoiceOver label.
function TourDetailSkeleton() {
  return (
    <Screen scroll padded edges={['bottom']}>
      <Stack.Screen options={{ title: 'Tour' }} />
      <SkeletonGroup accessibilityLabel={voice.loading.tour} style={styles.body}>
        <Card framed style={styles.placard}>
          <Skeleton width="40%" height={12} />
          <Skeleton width="80%" height={28} />
          <Skeleton width="60%" height={12} />
          <View style={styles.trail}>
            <Skeleton width="100%" height={6} radius="pill" />
          </View>
          <Divider dashed />
          <Skeleton width="46%" height={14} />
        </Card>
        <View style={styles.skLines}>
          <Skeleton width="100%" height={14} />
          <Skeleton width="92%" height={14} />
        </View>
        <View style={styles.ctaGroup}>
          <Skeleton width="100%" height={48} radius="md" />
          <Skeleton width="56%" height={12} style={styles.skCtaCaption} />
        </View>
        <Skeleton width="40%" height={12} />
        <Card>
          <View style={styles.skLines}>
            <Skeleton width="70%" height={14} />
            <Skeleton width="64%" height={14} />
            <Skeleton width="72%" height={14} />
            <Skeleton width="58%" height={14} />
          </View>
        </Card>
      </SkeletonGroup>
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
  ctaGroup: { gap: space.xs }, // the bold Start CTA + its tucked caption read as one unit
  skLines: { gap: space.sm }, // a cluster of skeleton lines (a blurb paragraph / route rows)
  skCtaCaption: { alignSelf: 'center' },
})
