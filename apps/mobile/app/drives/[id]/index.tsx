import { useCallback, useEffect, useRef, useState } from 'react'
import { ActionSheetIOS, Alert, Animated, Linking, Platform, StyleSheet, View } from 'react-native'
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { ApiError, deleteDrive, errorMessage, getDrive, type DriveManifest } from '@/lib/api'
import {
  deleteDriveDownload,
  downloadDrive,
  InsufficientStorageError,
  isDownloadExpired,
  isDownloadStale,
  loadManifest,
  offlineStatus,
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

// "Report an issue" opens the rider's mail composer (no in-app support backend yet — alpha).
// Set EXPO_PUBLIC_SUPPORT_EMAIL to the real inbox; the default is a brand-domain placeholder.
const SUPPORT_EMAIL = process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? 'feedback@skipper.fm'

// A saved drive (the rider's own, account-gated): route + stops + the live GPS drive (the M1
// phone player, fed by real device GPS) + the couch preview + offline download. Reached
// from "My Drives" or straight after creating one (Create-a-Drive → preview → here).
export default function DriveDetailScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const [drive, setDrive] = useState<DriveManifest | null>(null)
  const [needsAccount, setNeedsAccount] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // True when the manifest fetch failed but a saved download carried us (dead-zone fallback).
  const [offline, setOffline] = useState(false)
  // Offline download state — Tahoe has dead zones, so a rider can save the whole drive.
  const [downloaded, setDownloaded] = useState(false)
  // A saved copy past its freshness TTL (OFFLINE_TTL_DAYS) — a SOFT, offline-safe nudge to re-pull
  // (fires even in a dead zone, where the content-diff `updatable` can't). Never blocks play.
  const [expired, setExpired] = useState(false)
  const [downloading, setDownloading] = useState<DownloadProgress | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  // True when this drive IS downloaded but the server has re-cut its clips since (a re-synth or
  // regen). Detected on the online fetch; offers a re-pull. Never blocks offline play.
  const [updatable, setUpdatable] = useState(false)
  // A PARTIAL download (H2): the playable clips are saved but some didn't come down (thin signal).
  // Carries the missing count so the chip + ⋯ re-pull can offer the rest. Cleared by a clean re-pull
  // or a remove. Distinct from `updatable` (which is a SERVER re-cut, different copy).
  const [partial, setPartial] = useState<{ failed: number; total: number } | null>(null)
  // The signature rig, parked at the trailhead (~0.06) on the placard's static trail. Created
  // once, never animated — a still motif (the Start CTA owns this screen's one amber glow).
  const parked = useRef(new Animated.Value(0.06)).current
  // Mirror of `drive` so load() can skip the full-screen spinner on a refocus refetch. (audit #531)
  const driveRef = useRef<DriveManifest | null>(null)
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
      const res = await downloadDrive(id, setDownloading, ctrl.signal)
      setDownloaded(true)
      setExpired(false) // a fresh pull re-stamps savedAt — no longer past the TTL
      if (res.failedSeqs.length > 0) {
        // PARTIAL (H2): the playable clips are saved, but some didn't come down (thin signal). Record
        // the gap so the chip + ⋯ re-pull can offer to grab the rest; the saved clips play meanwhile.
        setPartial({ failed: res.failedSeqs.length, total: res.total })
        setDownloadError(null)
      } else {
        setPartial(null)
        setDownloadError(null)
        setUpdatable(false) // a fresh pull writes the current tokens — no longer behind the server
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        // Canceled (navigated away / Cancel tap) — silent, no error toast.
      } else if (e instanceof ApiError && e.needsAccount) {
        // A gated download 401s when the account lapsed. Route to sign-in instead of swapping the
        // whole detail for a full-screen gate — the loaded drive stays usable underneath. (audit #269)
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
    deleteDriveDownload(id)
    setDownloaded(false)
    setExpired(false)
    setPartial(null) // the saved copy (whole or partial) is gone
  }, [id])

  const cancelDownload = useCallback(() => {
    downloadAbort.current?.abort()
  }, [])

  // Cancel an in-flight download if the screen is torn down (audit #816). NOT on blur — the screen
  // stays mounted under the pushed player, so a download keeps running while the rider previews.
  useEffect(() => () => downloadAbort.current?.abort(), [])

  // Report an issue → the rider's mail composer, pre-filled with the drive's context (no
  // in-app support backend yet — alpha). The address is env-configurable (SUPPORT_EMAIL).
  const reportIssue = useCallback(() => {
    const subject = encodeURIComponent('Skipper — report an issue')
    const body = encodeURIComponent(`\n\n—\nDrive: ${drive?.label ?? id ?? '—'}\nID: ${id ?? '—'}`)
    void Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`).catch(() => {})
  }, [id, drive])

  // Permanently delete the drive (server soft-delete). Guarded by a confirm because it's
  // irreversible AND does NOT refund the free drive it used (a credit is spent at generation, never
  // returned). On success (or a 404 = already gone) we drop the orphaned offline copy and pop back
  // to the list — which refetches on focus, so the deleted drive falls out.
  const deleteDriveAction = useCallback(() => {
    if (!id) return
    Alert.alert(
      'Delete this drive?',
      "This can't be undone — and it won't give back the free drive it used.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await deleteDrive(id)
              } catch (e) {
                if (e instanceof ApiError && e.needsAccount) {
                  router.push('/sign-in')
                  return
                }
                // 404 = already gone → fall through to cleanup + back. Anything else is a real failure.
                if (!(e instanceof ApiError && e.status === 404)) {
                  Alert.alert('Could not delete', errorMessage(e, voice.error.generic))
                  return
                }
              }
              deleteDriveDownload(id) // the drive is gone — drop its now-orphaned offline copy
              router.back()
            })()
          },
        },
      ],
    )
  }, [id, router])

  // Secondary/utility actions live in a header ⋯ menu (native iOS action sheet) instead of
  // stacked buttons — the offline download (state-aware) + the dev-only on-device simulator.
  const openMenu = useCallback(() => {
    const actions: { label: string; onPress: () => void; destructive?: boolean }[] = []
    if (downloading) {
      actions.push({ label: 'Cancel download', onPress: cancelDownload, destructive: true })
    } else if (downloaded) {
      if (updatable) {
        // Re-pull overwrites the saved manifest + clips with the server's fresh cut.
        actions.push({ label: voice.offline.update, onPress: () => void startDownload() })
      } else if (partial) {
        // A PARTIAL download (H2): re-pull to grab the clips that didn't come down (thin signal).
        actions.push({ label: voice.offline.retryPartial, onPress: () => void startDownload() })
      } else if (expired) {
        // Past the freshness TTL — offer a re-pull (soft; the saved copy still plays meanwhile).
        actions.push({ label: voice.offline.refresh, onPress: () => void startDownload() })
      }
      actions.push({ label: 'Remove download', onPress: removeDownload, destructive: true })
    } else {
      actions.push({ label: 'Download for offline', onPress: () => void startDownload() })
    }
    actions.push({ label: 'Report an issue', onPress: reportIssue })
    if (__DEV__) {
      actions.push({ label: voice.cta.simDrive, onPress: () => router.push(`/drives/${id}/play`) })
    }
    // The one truly irreversible action — always last, above Cancel.
    actions.push({ label: 'Delete drive', onPress: deleteDriveAction, destructive: true })
    if (actions.length === 0) return
    // Highlight "Delete drive" as iOS's single red button (it's the only irreversible one); the
    // reversible "Remove download" stays plain on iOS but keeps its destructive style on Android.
    const deleteIdx = actions.findIndex((a) => a.label === 'Delete drive')
    const destructive = deleteIdx >= 0 ? deleteIdx : actions.findIndex((a) => a.destructive)
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
      Alert.alert('Drive options', undefined, [
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
    partial,
    expired,
    id,
    router,
    startDownload,
    removeDownload,
    cancelDownload,
    reportIssue,
    deleteDriveAction,
  ])

  const load = useCallback(async () => {
    if (!id) return
    if (!driveRef.current) setLoading(true) // keep the loaded detail on a refocus refetch — no full-screen spinner flash (audit #531)
    setError(null)
    setNeedsAccount(false)
    try {
      const fresh = await getDrive(id)
      setDrive(fresh)
      driveRef.current = fresh
      setOffline(false)
      // Online: flag a saved copy whose clips the server has re-cut since the download (free —
      // we already hold the fresh manifest). Returns false when nothing's downloaded.
      setUpdatable(isDownloadStale(id, fresh))
    } catch (e) {
      if (e instanceof ApiError && e.needsAccount) setNeedsAccount(true)
      else {
        // Offline-first: if this drive is downloaded, render from the saved manifest so "Start the
        // drive" + the preview stay reachable in a dead zone (the player is offline-first).
        const m = loadManifest(id)
        if (m) {
          setDrive(m.detail)
          driveRef.current = m.detail
          setOffline(true)
          setUpdatable(false) // dead zone: no fresh manifest to compare — never nag offline
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
      if (id) {
        const status = offlineStatus(id)
        setDownloaded(status != null)
        // Re-derive PARTIAL from disk so a half-download surfaces as partial after an app restart
        // (when the in-memory download result is gone) instead of as a clean "Saved offline". (audit #1)
        setPartial(
          status && status.missingSeqs.length > 0
            ? { failed: status.missingSeqs.length, total: status.expectedCount }
            : null,
        )
        setExpired(isDownloadExpired(id)) // offline-safe (reads savedAt) — fires even in a dead zone
      }
    }, [load, id]),
  )

  if (loading) return <DriveDetailSkeleton />
  if (needsAccount)
    return (
      <AccountGate
        secondaryAction={{ label: voice.gate.keepBrowsing, onPress: () => setNeedsAccount(false) }}
      />
    )
  if (error)
    return (
      <StateView
        title="Drive"
        message={error}
        tone="danger"
        action={{ label: voice.error.retry, onPress: load }}
      />
    )
  if (!drive)
    return (
      <StateView
        title="Drive"
        message={voice.empty.drive}
        action={{ label: 'Back', onPress: () => router.back() }}
      />
    )

  const durationMin = drive.durationSeconds ? Math.round(drive.durationSeconds / 60) : null
  // A drive's clips are place narrations (with coords) woven with placeless framing (no coords);
  // the itinerary is the narrations.
  const stops = drive.clips.filter((c) => c.lat != null && c.lng != null)

  return (
    <Screen scroll padded edges={['bottom']} contentContainerStyle={styles.body}>
      <Stack.Screen
        options={{
          title: 'Drive',
          headerRight: () => (
            <HeaderIconButton name="more" accessibilityLabel="More actions" onPress={openMenu} />
          ),
          // iOS 26: strip the Liquid Glass capsule so the chip isn't a second glow (mirrors index).
          unstable_headerRightItems: () => [
            {
              type: 'custom',
              hidesSharedBackground: true,
              element: (
                <HeaderIconButton name="more" accessibilityLabel="More actions" onPress={openMenu} />
              ),
            },
          ],
        }}
      />

      {/* THE TRAILHEAD SIGN — a carved ranger placard: "your drive" kicker → the A→B label →
          the trail with the rig parked at the start → a stamped permit line. */}
      <Card framed style={styles.placard}>
        <Text variant="label" color="accentWarm">
          YOUR DRIVE
        </Text>
        <Text variant="display" color="ink">
          {drive.label}
        </Text>
        <View style={styles.trail}>
          <RouteTrack progress={parked} glow={false} />
        </View>
        <Divider dashed />
        <View style={styles.permitRow}>
          <Text variant="monoStrong" color="inkDim">
            {stops.length} STOPS{durationMin ? ` · ~${durationMin} MIN` : ''}
          </Text>
          {/* Offline state rides here as a compact chip — the ACTION lives in the ⋯ menu. */}
          {downloading ? (
            <Text variant="label" color="inkFaint">
              {downloading.total ? `Saving ${downloading.done}/${downloading.total}` : 'Saving…'}
            </Text>
          ) : downloaded && updatable ? (
            <View style={styles.savedChip}>
              <Icon name="update" size={14} color="accentWarm" />
              <Text variant="label" color="accentWarm">
                {voice.offline.updateReady}
              </Text>
            </View>
          ) : downloaded && partial ? (
            // PARTIAL (H2): saved + playable, but some clips are still missing — a gentle "N left"
            // nudge (warm, not alarming) toward the ⋯ re-pull.
            <View style={styles.savedChip}>
              <Icon name="update" size={14} color="accentWarm" />
              <Text variant="label" color="accentWarm">
                {`${partial.failed} ${voice.offline.partialSuffix}`}
              </Text>
            </View>
          ) : downloaded && expired ? (
            // Past the freshness TTL — a warm "saved a while back" nudge toward the ⋯ refresh. Soft:
            // the copy still plays; this just suggests a re-pull (and fires even offline).
            <View style={styles.savedChip}>
              <Icon name="update" size={14} color="accentWarm" />
              <Text variant="label" color="accentWarm">
                {voice.offline.expired}
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

      {offline ? (
        <Text variant="dim" color="inkFaint">
          {voice.offline.detail}
        </Text>
      ) : null}

      {/* Two real choices — the live drive (M1 headline) + the free couch preview. The dev
          simulator + offline download live in the header ⋯ menu so this stays glanceable. */}
      <View style={styles.ctaGroup}>
        <Button icon="car" title={voice.cta.drive} onPress={() => router.push(`/drives/${id}/play?mode=live`)} />
        <Text variant="dim" color="inkFaint" align="center">
          {voice.drive.blurb}
        </Text>
      </View>

      <Button
        variant="ghost"
        icon="play"
        title={voice.cta.preview}
        onPress={() => router.push(`/drives/${id}/play?mode=preview`)}
      />

      {downloadError ? (
        <Text variant="dim" color="danger">
          {downloadError}
        </Text>
      ) : null}

      {/* THE ITINERARY — the shared StopList (same card + hairline-ruled rows as the in-drive
          player). No raw per-stop seconds — the tally lives on the sign. */}
      <StopList
        title={`THE ROUTE · ${stops.length} STOPS`}
        items={stops.map((s) => ({
          seq: s.seq,
          name: cleanPlaceName(s.name ?? ''),
          icon: stopIcon(s.form),
        }))}
      />
    </Screen>
  )
}

// The trailhead-placard silhouette shown while the drive loads — mirrors the real layout
// (placard → CTA → route list) so the screen reveals in place.
function DriveDetailSkeleton() {
  return (
    <Screen scroll padded edges={['bottom']}>
      <Stack.Screen options={{ title: 'Drive' }} />
      <SkeletonGroup accessibilityLabel={voice.loading.drive} style={styles.body}>
        <Card framed style={styles.placard}>
          <Skeleton width="40%" height={12} />
          <Skeleton width="80%" height={28} />
          <View style={styles.trail}>
            <Skeleton width="100%" height={6} radius="pill" />
          </View>
          <Divider dashed />
          <Skeleton width="46%" height={14} />
        </Card>
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
  skLines: { gap: space.sm }, // a cluster of skeleton lines (the route rows)
  skCtaCaption: { alignSelf: 'center' },
})
