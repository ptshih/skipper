import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActionSheetIOS, Alert, Animated, Linking, Platform, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { ApiError, deleteDrive, errorMessage, getDrive, type DriveManifest } from '@/lib/api'
import { useStopPreview } from '@/lib/useStopPreview'
import { DriveMap, type DriveMapStop } from '@/ui/DriveMap'
import {
  deleteDriveDownload,
  downloadDirState,
  downloadDrive,
  InsufficientStorageError,
  isDownloadExpired,
  isDownloadStale,
  loadManifest,
  offlineStatus,
  repairDownload,
  topUpDrive,
  type DownloadDirState,
  type DownloadProgress,
} from '@/lib/offline'
import { cleanPlaceName } from '@/lib/labels'
import { useTheme } from '@/theme'
import { border, space } from '@/theme/tokens'
import {
  AccountGate,
  AttributionButton,
  Button,
  Card,
  Divider,
  HeaderIconButton,
  Icon,
  RouteTrack,
  Screen,
  Scrubber,
  Segmented,
  Skeleton,
  SkeletonGroup,
  StateView,
  StopList,
  type StopListItem,
  Text,
  TransportBar,
  stopIcon,
  voice,
} from '@/ui'

// "Report an issue" opens the rider's mail composer (no in-app support backend yet — alpha).
//
// ⚠ The default IS the address, not a placeholder. `EXPO_PUBLIC_SUPPORT_EMAIL` has never been set —
// not in either env file, eas.json or app.config — so whatever sits here is what shipped, and until
// 2026-07-30 that was a `feedback@` placeholder nobody had replaced. Every PUBLISHED contact address
// is `hello@skipper.fm` (founder rule): one inbox, the same one the legal pages, the support page and
// the App Review contact all name. The env override stays for a future real support desk; it is not
// an excuse for the fallback to be wrong.
const SUPPORT_EMAIL = process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? 'hello@skipper.fm'

// A saved drive (the rider's own, account-gated): route + stops + the native mini-preview (tap a
// stop to hear one clip, List/Map) + the live GPS drive (the M1 phone player, fed by real device
// GPS) + offline download. Reached from "My Drives" or straight after creating one (Create-a-Drive
// → here). docs/decisions/detail-page-mini-preview.md.
export default function DriveDetailScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  // The native mini-preview: tap a stop (list row or map pin) to hear that one clip on the couch. Two
  // ways to browse the same stops — a List (offline + accessibility default) and a Map (route + pins).
  const [view, setView] = useState<'list' | 'map'>('list')
  const preview = useStopPreview(id)
  // A STABLE tap handler (reads the latest preview.play through a ref): preview.play's identity churns
  // on every ~2/sec audio-status tick, and passing it straight to DriveMap would defeat DriveMap's memo
  // (re-serializing the markers to native each tick while a clip plays). (audit #549)
  const playRef = useRef(preview.play)
  playRef.current = preview.play
  const playStop = useCallback((seq: number) => playRef.current(seq), [])
  // The detail map has no live position, so its puck is hidden and `progress` stays parked at 0 (the
  // whole route reads untraveled). DriveMap requires the value; this static one satisfies it.
  const mapProgress = useRef(new Animated.Value(0)).current
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  // Measured height of the FIXED now-playing dock, reserved at the bottom so the dock never covers
  // content: as tail scroll-padding in List mode (the last stop clears the bar) and as the map's
  // bottom inset in Map mode (the map ends at the dock's top instead of being clipped behind it).
  const [dockH, setDockH] = useState(0)
  const [drive, setDrive] = useState<DriveManifest | null>(null)
  const [needsAccount, setNeedsAccount] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // True when the manifest fetch failed but a saved download carried us (dead-zone fallback).
  const [offline, setOffline] = useState(false)
  // Offline download state — Tahoe has dead zones, so a rider can save the whole drive.
  const [downloaded, setDownloaded] = useState(false)
  // Whether bytes are on disk AT ALL, independent of whether this build can read their manifest.
  // `unreadable` is the state a MANIFEST_VERSION bump used to hide completely: a real download the
  // app reports as nothing, with the only reclaim affordance gated behind `downloaded` and therefore
  // unreachable exactly when it was needed. (offline.ts MANIFEST_MIGRATIONS)
  const [dirState, setDirState] = useState<DownloadDirState>('none')
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
  // The in-flight INV-6 top-up. Separate from `downloadAbort`: a rider-initiated download and a
  // background top-up are different promises with different lifetimes, and aborting one must not
  // cancel the other.
  const topUpAbort = useRef<AbortController | null>(null)

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

  // Start the LIVE drive — but warn once if nothing is saved. Tahoe's dead zones are the named
  // landmine, and `useDrive`'s stall watchdog SKIPS any clip that won't stream (12s, one re-sign,
  // then the stop is gone), so an unsaved drive loses stops silently — the rider just sails past
  // Emerald Bay in quiet and never learns why. This is the last moment it's still fixable.
  // Deliberately NOT a block: streaming is fine on a road with signal, and a rider mid-download or
  // already saved goes straight through untouched.
  const startDrive = useCallback(() => {
    const go = () => router.push(`/drives/${id}/play?mode=live`)
    if (downloaded || downloading) {
      go()
      return
    }
    Alert.alert(voice.offline.unsavedTitle, voice.offline.unsavedBody, [
      { text: 'Cancel', style: 'cancel' },
      { text: voice.offline.unsavedSave, onPress: () => void startDownload() },
      { text: voice.offline.unsavedStart, onPress: go },
    ])
  }, [downloaded, downloading, id, router, startDownload])

  const removeDownload = useCallback(() => {
    if (!id) return
    deleteDriveDownload(id)
    setDownloaded(false)
    setExpired(false)
    setPartial(null) // the saved copy (whole or partial) is gone
    // The drive's directory went with it. ⚠ Load-bearing now that the ⋯ menu gates repair/remove on
    // `dirState !== 'none'`: a stale 'ok'/'unreadable' would keep offering to remove a dir that no
    // longer exists. (The shared clip bytes are freed by the sweep inside deleteDriveDownload, which
    // is fail-closed — a rider may see less space returned than they expect, by design.)
    setDirState('none')
  }, [id])

  const cancelDownload = useCallback(() => {
    downloadAbort.current?.abort()
  }, [])

  // Cancel an in-flight download if the screen is torn down (audit #816). NOT on blur — the screen
  // stays mounted under the pushed player, so a download keeps running while the rider previews.
  useEffect(
    () => () => {
      downloadAbort.current?.abort()
      topUpAbort.current?.abort()
    },
    [],
  )

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

  // Put a readable manifest back around audio that is already on the phone (offline.ts
  // repairDownload). Non-destructive: it only writes a manifest, so a repair that finds nothing
  // costs the rider nothing and the ⋯ menu's download/remove are still right there.
  const repair = useCallback(async () => {
    if (!id) return
    setDownloadError(null)
    try {
      const status = await repairDownload(id)
      if (!status) {
        setDownloadError(voice.offline.repairFailed)
        return
      }
      setDownloaded(true)
      setDirState('ok')
      setPartial(
        status.missingSeqs.length > 0
          ? { failed: status.missingSeqs.length, total: status.expectedCount }
          : null,
      )
      setExpired(isDownloadExpired(id)) // repair dates the copy from the BYTES, so this can fire
      setUpdatable(false) // the manifest we just wrote IS the server's current cut, by construction
    } catch (e) {
      setDownloadError(errorMessage(e, voice.error.download))
    }
  }, [id])

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
      // ⚠ A drive directory exists but nothing playable resolves from it. REPAIR comes first: the
      // audio is the expensive half and much of it may still be here, so re-fetching the few-KB
      // manifest and re-adopting the bytes beats pulling hundreds of MB again. The reclaim sits
      // alongside it and MUST stay reachable — it used to live inside the `downloaded` branch, which
      // is false in exactly this case, leaving the rider unable to free the space at all.
      //
      // ⚠ The guard is `!== 'none'`, not `=== 'unreadable'`. Under the shared clip store a SECOND
      // state reaches here: a perfectly readable manifest whose clips resolve to zero bytes on disk
      // (`dirState === 'ok'` + `downloaded === false`). Repair can recover it for free — the bytes may
      // already be in the store from another drive — and remove can clear the stale dir. Gated on
      // 'unreadable' the rider was offered NEITHER, and the only remaining option was to re-download
      // audio they might already own.
      if (dirState !== 'none') {
        actions.push({ label: voice.offline.repair, onPress: () => void repair() })
      }
      actions.push({ label: 'Download for offline', onPress: () => void startDownload() })
      if (dirState !== 'none') {
        actions.push({ label: 'Remove download', onPress: removeDownload, destructive: true })
      }
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
    dirState,
    updatable,
    partial,
    expired,
    id,
    router,
    startDownload,
    repair,
    removeDownload,
    cancelDownload,
    reportIssue,
    deleteDriveAction,
  ])

  // Re-derive the offline state from DISK — the saved/partial/expired chip and the ⋯ menu's gating.
  // Extracted so the focus pass and the top-up's completion share ONE reading: presence is now
  // per-clip (a missing byte costs one stop, not the drive), so "downloaded" and "N left to save"
  // both move as bytes land, and a top-up that closes a gap in the background must update the chip
  // without waiting for the rider to leave and come back.
  const refreshOfflineState = useCallback(() => {
    if (!id) return
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
    setDirState(downloadDirState(id))
  }, [id])

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
      // INV-6's TOP-UP, fire-and-forget. Clip bytes live in one SHARED subject-keyed store, so this
      // drive's own manifest is the only authority for what it needs: fill the store with any subject
      // that manifest names and the store lacks. Two things it actually closes — a thin-signal stop
      // that never landed (the "N left to save" gap, without making the rider find the ⋯ re-pull), and
      // a RE-SYNTHED telling, whose bytes sit under a different filename because the revision is part
      // of the name. In the common case it fetches nothing and costs N `exists` calls.
      //
      // ⚠ It lives in the ONLINE branch on purpose: in a dead zone `getDrive` has already thrown and
      // there is nothing to top up FROM. ⚠ And it never blocks the render — the drive is painted from
      // `fresh` above; this only fills in behind it. `topUpDrive` carries its own bounds (it returns
      // null unless the drive is ALREADY a saved download, so opening a drive the rider never saved
      // can't start a surprise cellular pull) — do not re-implement them here.
      //
      // Failures are swallowed deliberately: a top-up that can't finish leaves exactly the state we
      // are already in, which the chip already tells the truth about and the ⋯ re-pull already offers
      // to fix. Surfacing a second error for a background repair the rider never asked for is noise.
      // ⚠ CANCELLABLE, and that is not tidiness. The detail screen stays MOUNTED under the pushed
      // player, so a top-up started on focus would otherwise keep transferring while the live drive
      // streams its clips and the stall watchdog re-signs — the exact contention the "never on the
      // play path" bound exists to prevent, which without this is only enforced for STARTING one.
      // It also bounds the worst case: after a whole-drive re-synth `needed` is the entire drive,
      // tens of MB, with no progress UI and no rider action beyond opening the screen.
      const topUpCtrl = new AbortController()
      topUpAbort.current?.abort()
      topUpAbort.current = topUpCtrl
      void topUpDrive(id, fresh, topUpCtrl.signal)
        .then(() => refreshOfflineState())
        .catch(() => {})
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
  }, [id, refreshOfflineState])

  useFocusEffect(
    useCallback(() => {
      load()
      refreshOfflineState()
    }, [load, refreshOfflineState]),
  )

  // Pause + clear the mini-preview when the screen BLURS (e.g. tapping "Start the drive" PUSHES the live
  // player while this screen stays mounted underneath). Without this the couch clip keeps sounding UNDER
  // the live drive — doNotMix governs only OTHER apps, not our own second player. `preview.stop` is
  // bound to the audio player (stable), so this cleanup fires on real blur, not every render.
  useFocusEffect(useCallback(() => () => preview.stop(), [preview.stop]))

  // The itinerary = the place narrations (a clip with coords). Derived here (before the early returns)
  // and MEMOIZED on [drive, activeSeq] — the screen re-renders on every audio-status tick, so a fresh
  // array each render would defeat DriveMap's memo and re-serialize the markers to native every tick.
  // The `state` flips only when the playing stop changes, so the map stays put during a clip. (audit #549)
  const stops = useMemo(
    () => (drive ? drive.clips.filter((c) => c.lat != null && c.lng != null) : []),
    [drive],
  )
  const listItems = useMemo<StopListItem[]>(
    () =>
      stops.map((s) => ({
        seq: s.seq,
        name: cleanPlaceName(s.name ?? ''),
        icon: stopIcon(s.form),
        state: preview.activeSeq === s.seq ? 'active' : 'upcoming',
      })),
    [stops, preview.activeSeq],
  )
  const mapStops = useMemo<DriveMapStop[]>(
    () =>
      stops.map((s) => ({
        seq: s.seq,
        name: cleanPlaceName(s.name ?? ''),
        lat: s.lat as number,
        lng: s.lng as number,
        state: preview.activeSeq === s.seq ? 'active' : 'upcoming',
      })),
    [stops, preview.activeSeq],
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
  // The clip behind the now-playing card (name + per-clip CC BY-SA credit) while a stop plays.
  const activeClip =
    preview.activeSeq == null
      ? null
      : (drive.clips.find((c) => c.seq === preview.activeSeq) ?? null)

  // Shared across the List + Map layouts (extracted so the two branches don't duplicate them).
  const stackScreen = (
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
  )
  // The route label + the List/Map toggle — the slim header shared by both views.
  const routeHead = (
    <View style={styles.previewHead}>
      <Text variant="label" color="inkFaint">
        {`THE ROUTE · ${stops.length} STOPS`}
      </Text>
      <Segmented
        accessibilityLabel={voice.preview.viewLabel}
        options={[
          { key: 'list', label: voice.preview.viewList, icon: 'list' },
          { key: 'map', label: voice.preview.viewMap, icon: 'map' },
        ]}
        value={view}
        onChange={setView}
        style={styles.viewToggle}
      />
    </View>
  )
  const hintLine = (
    <Text variant="dim" color={preview.unplayableSeq != null ? 'danger' : 'inkFaint'}>
      {preview.unplayableSeq != null ? voice.preview.unplayable : voice.preview.hint}
    </Text>
  )

  return (
    <View style={styles.root}>
      {view === 'map' ? (
        // MAP MODE — full-bleed + NON-scrolling so the map owns the pan/zoom drag (a MapView nested in a
        // ScrollView fights it for the vertical gesture). Slim header + edge-to-edge map + the dock.
        // `edges={[]}`: the map runs to the physical bottom; the map container reserves the dock's
        // measured height (or the home-indicator strip when idle) so the fixed dock never CLIPS the map.
        <Screen edges={[]}>
          {stackScreen}
          <View style={styles.mapHeader}>
            {routeHead}
            {hintLine}
          </View>
          <View
            style={[
              styles.mapFill,
              { paddingBottom: activeClip ? dockH : insets.bottom + space.sm },
            ]}
          >
            <DriveMap
              polyline={drive.polyline}
              stops={mapStops}
              progress={mapProgress}
              hidePuck
              clipActive={preview.activeSeq != null}
              onPressStop={playStop}
            />
          </View>
        </Screen>
      ) : (
        // LIST MODE — the scrolling detail page (placard, Start CTA, itinerary); the offline + a11y default.
        <Screen scroll padded edges={['bottom']} contentContainerStyle={styles.body}>
          {stackScreen}

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
                  {downloading.total
                    ? `Saving ${downloading.done}/${downloading.total}`
                    : 'Saving…'}
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
              ) : dirState === 'unreadable' ? (
                // A saved copy this build can't read (a manifest format with no migration across).
                // Warm, not faint: unlike "Not saved" this one is actionable and costs real space —
                // the ⋯ menu offers both a re-pull and a remove.
                <View style={styles.savedChip}>
                  <Icon name="update" size={14} color="accentWarm" />
                  <Text variant="label" color="accentWarm">
                    {voice.offline.unreadable}
                  </Text>
                </View>
              ) : (
                // NOT saved. This branch used to be `null`, which made "this drive will stream, and a
                // dead zone will silently skip stops" the one state with no visual at all. Rendered
                // faint, not warm/amber: it's a fact about the drive, not a warning to act on — the
                // Save button below and the Start guard carry the actual nudge.
                <View style={styles.savedChip}>
                  <Icon name="notDownloaded" size={14} color="inkFaint" />
                  <Text variant="label" color="inkFaint">
                    {voice.offline.notSaved}
                  </Text>
                </View>
              )}
            </View>
          </Card>

          {offline ? (
            <Text variant="dim" color="inkFaint">
              {voice.offline.detail}
            </Text>
          ) : null}

          {/* The live drive is the M1 headline. The couch "simulated drive" is CUT — auditioning is now the
          native mini-preview below (tap a stop to hear it). The dev simulator lives in the header ⋯ menu
          so this stays glanceable; offline download does NOT — it earned a main-path button below,
          because hiding it made streaming the silent default on roads that can't stream. */}
          <View style={styles.ctaGroup}>
            <Button icon="car" title={voice.cta.drive} onPress={startDrive} />
            <Text variant="dim" color="inkFaint" align="center">
              {voice.drive.blurb}
            </Text>
          </View>

          {/* Save for offline — a REAL button on the main path. It lived only in the header ⋯ menu,
          which meant the default first drive STREAMED and every dead-zone stop was dropped in
          silence. Shown only when there's something to save: a downloaded (or downloading) drive
          keeps this space clean, and the ⋯ menu still owns re-pull / remove. */}
          {!downloaded && !downloading ? (
            <View style={styles.ctaGroup}>
              <Button
                variant="secondary"
                icon="update"
                title={voice.offline.save}
                onPress={() => void startDownload()}
              />
              <Text variant="dim" color="inkFaint" align="center">
                {voice.offline.saveHint}
              </Text>
            </View>
          ) : null}

          {downloadError ? (
            <Text variant="dim" color="danger">
              {downloadError}
            </Text>
          ) : null}

          {/* THE ROUTE — browse the stops as a List or a Map; tap any stop / pin to hear that one clip. */}
          {routeHead}
          {hintLine}
          <StopList items={listItems} onPressItem={playStop} />

          {/* Spacer: reserve the fixed dock's measured height at the tail of the scroll so the last stop
          can scroll clear of the now-playing bar pinned below (instead of hiding behind it). */}
          {activeClip && dockH > 0 ? <View style={{ height: dockH }} /> : null}
        </Screen>
      )}

      {/* NOW PLAYING — FIXED to the bottom of the screen (both views): the single reused mini-player,
          shown while a stop sounds. Its ⓘ reveals the playing clip's CC BY-SA credit — the same unified
          affordance as the drive player (legal, per-play). */}
      {activeClip ? (
        <View
          onLayout={(e) => setDockH(e.nativeEvent.layout.height)}
          style={[
            styles.dock,
            {
              backgroundColor: colors.surfaceRaised,
              borderTopColor: colors.rule,
              paddingBottom: insets.bottom + space.sm, // clear the home-indicator strip
              // Upward cast so the bar lifts off the scrolling content above (cross-platform, DESIGN §4).
              boxShadow: [{ offsetX: 0, offsetY: -4, blurRadius: 14, color: colors.shadowCast }],
            },
          ]}
        >
          <View style={styles.nowHead}>
            <View style={styles.nowHeadText}>
              <Text variant="label" color="accentWarm">
                {voice.preview.nowPlaying}
              </Text>
              <Text variant="bodyStrong" color="ink" numberOfLines={1}>
                {cleanPlaceName(activeClip.name ?? '')}
              </Text>
            </View>
            {/* The ⓘ source affordance — same reveal as the drive player (unified). */}
            <AttributionButton items={activeClip.attribution} />
          </View>
          <Scrubber
            positionMs={preview.positionMs}
            durationMs={preview.durationMs}
            onSeek={preview.seekToMs}
            disabled={!preview.canSeek}
          />
          <TransportBar
            playing={preview.playing}
            onPlayPause={preview.togglePlay}
            canSeek={preview.canSeek}
            onSeekBack={() => preview.seekBy(-15)}
            onSeekForward={() => preview.seekBy(15)}
          />
        </View>
      ) : null}
    </View>
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
  root: { flex: 1 },
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
  // The route label + the List/Map toggle share a row; the toggle sizes to its content on the right.
  previewHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  viewToggle: { minWidth: 168 }, // the two segments read comfortably without stretching full-width
  // MAP MODE (full-bleed, non-scrolling): a slim padded header over an edge-to-edge map that owns the
  // pan/zoom gesture (a MapView can't share the vertical drag with a ScrollView).
  mapHeader: {
    paddingHorizontal: space.gutter,
    paddingTop: space.md,
    paddingBottom: space.sm,
    gap: space.sm,
  },
  mapFill: { flex: 1 },
  // The now-playing bar PINNED to the bottom edge (full-width, a hairline-topped tray, not a floating
  // card) so it stays put while the stops scroll under it. bg/border/cast set inline (need theme colors).
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.gutter,
    paddingTop: space.md,
    gap: space.sm,
    borderTopWidth: border.hair,
  },
  // The header row: the kicker+title block on the left, the ⓘ source affordance hugged right.
  nowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  nowHeadText: { flex: 1, gap: 2 }, // the "NOW PLAYING" kicker sits tight over the stop name
  skLines: { gap: space.sm }, // a cluster of skeleton lines (the route rows)
  skCtaCaption: { alignSelf: 'center' },
})
