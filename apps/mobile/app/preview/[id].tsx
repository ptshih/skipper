import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import { ApiError, getTour, signTourAudio } from '@/lib/api'
import { stopLabel } from '@/lib/labels'
import { buildPreviewTimeline, type PreviewSegment } from '@/lib/preview'
import { useDriveMusic } from '@/lib/driveMusic'
import { useTheme } from '@/theme'
import { space } from '@/theme/tokens'
import {
  AccountGate,
  Badge,
  Button,
  Card,
  Divider,
  NowCard,
  RouteTrack,
  Screen,
  Scrubber,
  StateView,
  StopRow,
  STOP_ROW_HEIGHT,
  Text,
  stopIcon,
  stopTone,
  voice,
} from '@/ui'

// The in-app "simulated drive" preview: play the tour from a couch, no GPS. We walk
// a compressed timeline (clip / drive / rest) — clips play full length via expo-audio
// and advance on finish; the silent drive between stops becomes a short dot "zip".
// Map-less: a route progress line + an auto-scrolling stop list. This is the live
// driving player minus GPS (later: swap the segment clock for expo-location).

interface Loaded {
  tourName: string
  region: string
  segments: PreviewSegment[]
  urlBySeq: Map<number, string>
  stops: { seq: number; name: string; stopType: string }[]
  totalPreviewMs: number
  totalRealMs: number
}

export default function PreviewScreen() {
  const theme = useTheme()
  const { id } = useLocalSearchParams<{ id: string }>()
  const [data, setData] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [needsAccount, setNeedsAccount] = useState(false)
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [done, setDone] = useState(false)
  const [stallNote, setStallNote] = useState<string | null>(null)

  const player = useAudioPlayer()
  const status = useAudioPlayerStatus(player)
  const dot = useRef(new Animated.Value(0)).current
  const loadedSeq = useRef<number | null>(null) // which clip is loaded in the player
  const finishedIdx = useRef<number>(-1) // guard didJustFinish double-advance
  const sawFresh = useRef(false) // have we seen the LOADED clip actually playing yet?
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null) // B1: never freeze on a dead clip
  const listRef = useRef<ScrollView | null>(null)
  const scrubbing = useRef(false) // a drag is live — hold the clip-finished auto-advance
  const seekTarget = useRef<number | null>(null) // last commanded seek (sec) — so ±15 taps accumulate
  // ahead of the lagging polled clock; reset whenever the active clip changes (effect below)

  // ---- load: tour geometry + presigned audio + the compressed timeline ----
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!id) return
      setError(null)
      setNeedsAccount(false)
      try {
        // Background + lock-screen play. doNotMix (not duckOthers) is required by
        // expo-audio for lock-screen controls; the preview audio IS the content.
        await setAudioModeAsync({
          playsInSilentMode: true,
          shouldPlayInBackground: true,
          interruptionMode: 'doNotMix',
        }).catch(() => {})
        const [tour, signed] = await Promise.all([getTour(id), signTourAudio(id)])
        if (cancelled) return
        if (!tour.corridor) throw new Error('This tour has no route to drive.')
        const tl = buildPreviewTimeline(
          tour.stops.map((s) => ({
            seq: s.seq,
            stopType: s.stopType,
            name: s.name,
            lat: s.lat,
            lng: s.lng,
            audioDurationMs: s.audioDurationMs,
          })),
          tour.corridor.polyline as [number, number][],
          // Stretch the preview's compressed drive gaps to 12–20s (vs the engine's
          // short 1.2–4s default) so the between-stop drive music has room to breathe
          // in the simulated drive. Kept deliberately — this is preview-only pacing
          // (the real GPS drive uses actual elapsed time, not these compressed gaps).
          { minGapSec: 12, maxGapSec: 20 },
        )
        setData({
          tourName: tour.corridor.name,
          region: tour.corridor.region,
          segments: tl.segments,
          urlBySeq: new Map(signed.urls.map((u) => [u.seq, u.url])),
          stops: tour.stops.map((s) => ({ seq: s.seq, name: s.name, stopType: s.stopType })),
          totalPreviewMs: tl.totalPreviewMs,
          totalRealMs: tl.totalRealMs,
        })
      } catch (e) {
        if (cancelled) return
        if (e instanceof ApiError && e.needsAccount) setNeedsAccount(true)
        else setError(e instanceof Error ? e.message : 'Failed to load the preview')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  const advance = useCallback(
    (next: number) => {
      if (!data) return
      if (next >= data.segments.length) {
        setDone(true)
        setPlaying(false)
        try {
          player.setActiveForLockScreen(false)
        } catch {}
        return
      }
      setIdx(next)
    },
    [data, player],
  )

  // ---- the segment driver: react to the current segment + play state ----
  useEffect(() => {
    if (!data || done) return
    const seg = data.segments[idx]
    if (!seg) return
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (watchdog.current) {
      clearTimeout(watchdog.current)
      watchdog.current = null
    }

    if (!playing) {
      if (seg.kind === 'clip') player.pause()
      return
    }

    if (seg.kind === 'clip') {
      const uri = data.urlBySeq.get(seg.seq)
      if (!uri) {
        // No audio for this stop — skip it like a brief rest.
        timer.current = setTimeout(() => advance(idx + 1), 800)
        return
      }
      dot.setValue(seg.routeProgress)
      if (loadedSeq.current !== seg.seq) {
        loadedSeq.current = seg.seq
        sawFresh.current = false // must see THIS clip play before a finish counts
        setStallNote(null)
        // Stop the OLD clip before loading the new source: replace() loads async,
        // so without this the previous clip keeps playing until the new one is ready
        // (the audio "bleed" when jumping forward/back or tapping a stop).
        player.pause()
        player.replace({ uri })
        // B2: lock-screen Now Playing for this stop
        const stopName = data.stops.find((s) => s.seq === seg.seq)?.name ?? 'Skipper'
        try {
          player.setActiveForLockScreen(true, {
            title: stopName,
            artist: 'Skipper',
            albumTitle: data.tourName,
          })
        } catch {}
      }
      player.play()
      // B1: if the clip never starts (expired 403 / decode fail / dropped network),
      // didJustFinish never fires — so skip forward after a grace period.
      watchdog.current = setTimeout(() => {
        if (!sawFresh.current) {
          setStallNote(voice.player.stall)
          advance(idx + 1)
        }
      }, 6000)
      // advance happens in the didJustFinish effect below
    } else {
      // drive / rest: a SILENT segment — make sure no clip audio bleeds into it.
      player.pause()
      const from = seg.fromProgress ?? seg.routeProgress
      dot.setValue(from)
      // Animate the dot only when it actually moves (a drive). A break 'rest' holds
      // in place, so skip the no-op X→X timing that would spin the JS-driven
      // animation at 60fps for 2s and jank the transition.
      if (from !== seg.routeProgress) {
        Animated.timing(dot, {
          toValue: seg.routeProgress,
          duration: seg.previewMs,
          useNativeDriver: false,
        }).start()
      }
      timer.current = setTimeout(() => advance(idx + 1), seg.previewMs)
    }

    return () => {
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
      }
      if (watchdog.current) {
        clearTimeout(watchdog.current)
        watchdog.current = null
      }
      dot.stopAnimation() // freeze the trail on pause/jump instead of letting it run on
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, idx, playing, done])

  // ---- clip end → next segment ----
  // didJustFinish stays true across status updates and is still set from the PREVIOUS
  // clip at the instant we switch (replace() updates the status async), which would
  // skip the new clip. So we only advance once we've seen THIS clip actually play
  // (sawFresh) — and at most once per clip (finishedIdx).
  useEffect(() => {
    if (!data || !playing) return
    const seg = data.segments[idx]
    if (seg?.kind !== 'clip') return
    if (status.playing && !status.didJustFinish) {
      sawFresh.current = true
      if (watchdog.current) {
        clearTimeout(watchdog.current)
        watchdog.current = null
      }
    }
    // Don't let a clip that finishes UNDER an in-progress scrub yank us to the next stop.
    if (status.didJustFinish && sawFresh.current && finishedIdx.current !== idx && !scrubbing.current) {
      finishedIdx.current = idx
      advance(idx + 1)
    }
  }, [status.playing, status.didJustFinish, data, idx, playing, advance])

  // ---- auto-scroll the stop list to the active stop ----
  const activeSeq = data?.segments[idx]?.seq
  useEffect(() => {
    seekTarget.current = null // new clip → drop any seek target carried from the last one
    if (!data || activeSeq == null) return
    const row = data.stops.findIndex((s) => s.seq === activeSeq)
    if (row >= 0)
      listRef.current?.scrollTo({ y: Math.max(0, (row - 1) * STOP_ROW_HEIGHT), animated: true })
  }, [activeSeq, data])

  // ---- A11y: announce the now-playing change for screen readers ----
  useEffect(() => {
    if (!data) return
    let msg = ''
    if (done) msg = voice.driveComplete
    else {
      const s = data.segments[idx]
      const name = s ? data.stops.find((st) => st.seq === s.seq)?.name : undefined
      if (s?.kind === 'drive') msg = `Driving to ${name ?? 'the next stop'}`
      else if (s?.kind === 'rest') msg = `Rest stop. ${name ?? ''}`
      else if (s?.kind === 'clip')
        msg = `Now playing. ${name ?? 'Skipper'}, ${stopLabel(s.stopType)}`
    }
    if (msg) AccessibilityInfo.announceForAccessibility(msg)
  }, [idx, done, data])

  const restart = () => {
    loadedSeq.current = null
    finishedIdx.current = -1
    dot.setValue(0)
    setStallNote(null)
    setDone(false)
    setIdx(0)
    setPlaying(true)
  }

  // Stop playback if the screen unmounts while a clip is going (e.g. back-swipe).
  useEffect(() => {
    return () => {
      try {
        player.pause()
      } catch {}
      try {
        player.setActiveForLockScreen(false)
      } catch {}
      if (watchdog.current) clearTimeout(watchdog.current)
    }
  }, [player])

  // Drive soundtrack: a seamless loop that plays between stops (drive/rest) and
  // fades OUT under a stop's narration (clip), then back IN on the drive; an outro
  // sting plays at the end. The voice owns the stops, the music owns the drive.
  const curKind = data?.segments[idx]?.kind
  useDriveMusic({
    active: playing && !done && curKind != null && curKind !== 'clip',
    ended: done,
  })

  // Tap a stop to jump the drive there and play it from the start.
  const jumpToStop = (seq: number) => {
    if (!data) return
    const target = data.segments.findIndex((s) => s.seq === seq && s.kind !== 'drive')
    if (target < 0) return
    // Silence the current clip immediately on tap (the effect's async replace would
    // otherwise let it bleed until the new clip loads).
    try {
      player.pause()
    } catch {}
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    loadedSeq.current = null // force the target clip to (re)load from its start
    finishedIdx.current = -1
    dot.setValue(data.segments[target]!.routeProgress)
    setStallNote(null)
    setDone(false)
    setIdx(target)
    setPlaying(true)
  }

  const mmss = (ms: number) =>
    `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`

  if (needsAccount) return <AccountGate note="Anonymous preview is limited to the sample tour." />
  if (error) return <StateView title="Preview drive" message={error} tone="danger" />
  if (!data) return <StateView title="Preview drive" loading message={voice.loading.preview} />

  const seg = data.segments[idx]
  const nextStopName = seg ? data.stops.find((s) => s.seq === seg.seq)?.name : undefined
  const activeRow = data.stops.findIndex((s) => s.seq === activeSeq)
  const isClip = seg?.kind === 'clip'
  const buffering = isClip && playing && (!status.isLoaded || status.isBuffering)
  // We've ARRIVED at a stop on a clip/rest segment; a 'drive' is still EN ROUTE to it.
  // Used so a stop only lights up "active" when you reach it — not while the silent
  // drive toward it shows "ROLLING to <next>", which read as a double-navigation.
  const atStop = seg?.kind !== 'drive'

  // Seeking is only meaningful on a loaded clip with a known duration (drive/rest are
  // silent; a buffering clip has no timeline yet). seekTo never changes the play state,
  // and a seek leaves seg.seq unchanged, so the segment driver won't reload the clip —
  // it just moves the playhead within the take.
  const dur = status.duration ?? 0
  const canSeek = isClip && status.isLoaded && dur > 0 && !buffering
  const seekToSec = (sec: number) => {
    if (!canSeek) return
    const target = Math.min(dur, Math.max(0, sec))
    seekTarget.current = target
    try {
      player.seekTo(target)
    } catch {}
  }
  // Accumulate from the last commanded target when it's ahead of the polled clock — two
  // quick +15 taps within one status poll must add 30s, not read the same stale 15s twice.
  // The active-clip effect clears seekTarget so a stale target never leaks across stops.
  const seekBy = (deltaSec: number) =>
    seekToSec(Math.max(seekTarget.current ?? 0, status.currentTime ?? 0) + deltaSec)

  return (
    <Screen edges={['bottom']}>
      {/* Keep swipe-back, but stop the scrubber from triggering it. iOS 26 turned
          back-swipe into a WHOLE-screen native gesture by default (react-native-screens
          fullScreenSwipeEnabled defaults true on iOS>=26) and ignores gestureResponseDistance
          for it — so any drag on the position bar popped the screen. Turn the whole-screen
          recognizer OFF so back-swipe reverts to the classic LEFT-EDGE gesture only. */}
      <Stack.Screen
        options={{ title: 'Preview drive', gestureEnabled: true, fullScreenGestureEnabled: false }}
      />

      <View style={styles.header}>
        <Text variant="title" color="ink">
          {data.tourName}
        </Text>
        <Text variant="dim" color="inkDim">
          {data.region} · simulated drive · {mmss(data.totalPreviewMs)} preview of a{' '}
          {mmss(data.totalRealMs)} drive
        </Text>
      </View>

      {/* Route progress trail with the car token */}
      <RouteTrack progress={dot} style={styles.track} />

      {/* NOW area */}
      <View style={styles.nowWrap}>
        {done ? (
          <Card>
            <Text variant="label" color="accentWarm">
              DRIVE COMPLETE
            </Text>
            <Text variant="placardTitle" color="ink">
              You’ve arrived
            </Text>
            <Text variant="body" color="inkDim">
              {voice.driveComplete}
            </Text>
          </Card>
        ) : seg?.kind === 'drive' ? (
          // Minimized: a drive is transit, not a stop — a calm distance strip, not a
          // now-playing-sized card. The car token sliding the trail carries the motion.
          <View style={styles.driveStrip} accessibilityLiveRegion="polite">
            <Text variant="dim" color="inkFaint" align="center">
              Rolling · ~{((seg.distanceM ?? 0) / 1609).toFixed(1)} mi to the next stop
            </Text>
          </View>
        ) : seg?.kind === 'rest' ? (
          <NowCard
            liveRegion
            glow={false}
            kicker={voice.player.pitStop}
            title={nextStopName ?? 'A good spot to stretch'}
          />
        ) : (
          <NowCard
            liveRegion
            kicker={voice.player.nowPlaying}
            title={nextStopName ?? 'Skipper'}
            right={
              seg?.stopType ? (
                <Badge tone={stopTone(seg.stopType)} label={stopLabel(seg.stopType)} />
              ) : undefined
            }
          />
        )}
        {/* Position bar — scrub within the current clip (drive/rest have no timeline). */}
        {isClip ? (
          <Scrubber
            positionMs={(status.currentTime ?? 0) * 1000}
            durationMs={dur * 1000}
            onSeek={(ms) => seekToSec(ms / 1000)}
            onScrubbingChange={(active) => {
              scrubbing.current = active // hold the clip-finished auto-advance
            }}
            disabled={!canSeek}
          />
        ) : null}
        {buffering ? (
          <View style={styles.buffering}>
            <ActivityIndicator size="small" color={theme.colors.accentWarm} />
            <Text variant="dim" color="inkFaint">
              {voice.player.buffering}
            </Text>
          </View>
        ) : stallNote ? (
          <Text variant="dim" color="danger" style={styles.stall}>
            {stallNote}
          </Text>
        ) : null}
      </View>

      <View style={styles.controls}>
        {done ? (
          <Button icon="restart" title={voice.cta.restart} onPress={restart} />
        ) : (
          <View style={styles.controlsRow}>
            <Button
              variant="secondary"
              icon="back15"
              title="15"
              accessibilityLabel="Rewind 15 seconds"
              fullWidth={false}
              disabled={!canSeek}
              onPress={() => seekBy(-15)}
              style={styles.skip}
            />
            <Button
              icon={playing ? 'pause' : 'play'}
              title={playing ? voice.cta.pause : voice.cta.play}
              onPress={() => setPlaying((p) => !p)}
              style={styles.flex}
            />
            <Button
              variant="secondary"
              icon="forward15"
              title="15"
              accessibilityLabel="Forward 15 seconds"
              fullWidth={false}
              disabled={!canSeek}
              onPress={() => seekBy(15)}
              style={styles.skip}
            />
          </View>
        )}
      </View>

      <Text variant="dim" color="inkFaint" style={styles.hint}>
        Tap any stop to jump ahead
      </Text>
      <Divider dashed style={styles.divider} />

      {/* Stop list (map-less timeline) — tap to jump */}
      <ScrollView ref={listRef} style={styles.list} contentContainerStyle={styles.listContent}>
        {data.stops.map((s, i) => {
          const state =
            done || (activeRow >= 0 && i < activeRow)
              ? 'passed'
              : s.seq === activeSeq && atStop
                ? 'active'
                : 'upcoming'
          return (
            <StopRow
              key={s.seq}
              name={s.name}
              sublabel={stopLabel(s.stopType)}
              icon={stopIcon(s.stopType)}
              state={state}
              onPress={() => jumpToStop(s.seq)}
            />
          )
        })}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { paddingHorizontal: space.gutter, paddingTop: space.md, gap: space.xs },
  track: { marginHorizontal: space.gutter, marginTop: space.lg, marginBottom: space.sm },
  nowWrap: { paddingHorizontal: space.gutter, paddingTop: space.sm, gap: space.sm },
  // Reserve roughly a card's height so the controls below don't jump between a clip
  // card and the minimal drive strip; the strip sits calm and centered in it.
  driveStrip: { minHeight: 104, alignItems: 'center', justifyContent: 'center' },
  buffering: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.xs,
  },
  stall: { paddingHorizontal: space.xs },
  controls: { paddingHorizontal: space.gutter, paddingTop: space.md },
  controlsRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  // ±15 buttons: trim the wide CTA side-padding so the flanked center label keeps room
  // (it would otherwise truncate to "All a…" on a 320pt phone / large Dynamic Type).
  skip: { paddingHorizontal: space.sm },
  hint: { paddingHorizontal: space.gutter, paddingTop: space.md, paddingBottom: space.sm },
  divider: { marginHorizontal: space.gutter },
  list: { flex: 1, marginTop: space.xs },
  listContent: { paddingTop: space.xs, paddingBottom: space.xxl },
})
