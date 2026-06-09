import { useCallback, useState } from 'react'
import { ActionSheetIOS, Alert, Platform, StyleSheet, View } from 'react-native'
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { ApiError, getTour, signTourAudio, type SignedAudio, type TourDetail } from '@/lib/api'
import {
  deleteTourDownload,
  downloadTour,
  isTourDownloaded,
  type DownloadProgress,
} from '@/lib/offline'
import { stopLabel } from '@/lib/labels'
import { space } from '@/theme/tokens'
import {
  AccountGate,
  Badge,
  Button,
  Card,
  HeaderIconButton,
  Icon,
  Screen,
  StateView,
  Text,
  stopIcon,
  stopTone,
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
  const [audio, setAudio] = useState<SignedAudio | null>(null)
  const [needsAccount, setNeedsAccount] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // Offline download state — Tahoe has dead zones, so a rider can save the whole drive.
  const [downloaded, setDownloaded] = useState(false)
  const [downloading, setDownloading] = useState<DownloadProgress | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const startDownload = useCallback(async () => {
    if (!id) return
    setDownloadError(null)
    setDownloading({ done: 0, total: 0 })
    try {
      await downloadTour(id, setDownloading)
      setDownloaded(true)
    } catch (e) {
      // A gated (non-preview) tour download 401s when the account lapsed — show the
      // AccountGate, not a misleading "check your signal" error (mirrors load()).
      if (e instanceof ApiError && e.needsAccount) setNeedsAccount(true)
      else setDownloadError(e instanceof Error ? e.message : 'Download failed — check your signal and try again.')
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
    } catch (e) {
      if (e instanceof ApiError && e.needsAccount) setNeedsAccount(true)
      else setError(e instanceof Error ? e.message : voice.error.generic)
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

  // Debug-only: presign + reveal the raw R2 URLs. Dead-code-eliminated in release.
  const loadAudio = async () => {
    if (!id) return
    try {
      setAudio(await signTourAudio(id))
    } catch (e) {
      setError(e instanceof Error ? e.message : voice.error.generic)
    }
  }

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

  return (
    <Screen scroll padded edges={['bottom']} contentContainerStyle={styles.body}>
      <Stack.Screen
        options={{
          title: tour.tour.headline,
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

      <View style={styles.head}>
        <Text variant="display" color="ink">
          {tour.tour.headline}
        </Text>
        <Text variant="label" color="inkFaint">
          {tour.tour.startAnchor.name} → {tour.tour.endAnchor.name}
        </Text>
        <View style={styles.metaRow}>
          <Text variant="label" color="inkFaint">
            {tour.region.displayName}
          </Text>
          {/* Offline state rides here as a compact chip — the ACTION lives in the ⋯ menu. */}
          {downloading ? (
            <Text variant="label" color="inkFaint">
              · Downloading {downloading.done}/{downloading.total || '…'}
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
      </View>

      {/* Two real choices only — the live drive (M1 headline) + the free couch preview (the
          funnel, and the only play path for anonymous riders). The dev simulator + offline
          download moved to the header ⋯ menu so this stays glanceable. */}
      <Button icon="car" title={voice.cta.drive} onPress={() => router.push(`/tours/${id}/play?mode=live`)} />
      <Text variant="dim" color="inkDim">
        The skipper talks as you reach each stop on the real roads.
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

      <Text variant="label" color="inkFaint" style={styles.sectionLabel}>
        The route · {tour.stops.length} stops
      </Text>

      {tour.stops.map((s) => {
        const signed = audio?.stops.find((u) => u.seq === s.seq)
        return (
          <Card key={s.seq}>
            <View style={styles.stopHead}>
              <Icon name={stopIcon(s.stopType)} size={16} />
              <Text variant="heading" color="ink" style={styles.flex} numberOfLines={2}>
                {s.seq + 1}. {s.name}
              </Text>
            </View>
            {/* badge on its OWN row so it never squeezes the title */}
            <View style={styles.stopMeta}>
              <Badge tone={stopTone(s.stopType)} label={stopLabel(s.stopType)} />
              {s.audioDurationMs ? (
                <Text variant="dim" color="inkDim">
                  {Math.round(s.audioDurationMs / 1000)} sec
                </Text>
              ) : null}
            </View>
            {__DEV__ ? (
              <Text variant="mono" color="inkFaint">
                {s.lat.toFixed(4)}, {s.lng.toFixed(4)} · trigger {s.triggerRadiusM}m
              </Text>
            ) : null}
            {signed ? (
              <Text variant="label" color="accent">
                audio ready
              </Text>
            ) : null}
          </Card>
        )
      })}

      {__DEV__ ? (
        <Button variant="ghost" title="Load audio URLs (debug)" onPress={loadAudio} />
      ) : null}
    </Screen>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { gap: space.md },
  head: { gap: space.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  savedChip: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  sectionLabel: { marginTop: space.sm },
  stopHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stopMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.sm,
    marginTop: space.sm,
    marginBottom: space.xs,
  },
})
