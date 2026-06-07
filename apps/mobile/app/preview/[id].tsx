import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Link, Stack, useLocalSearchParams } from 'expo-router'
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import { ApiError, getTour, signTourAudio } from '@/lib/api'
import { buildPreviewTimeline, type PreviewSegment } from '@/lib/preview'

// The in-app "simulated drive" preview: play the tour from a couch, no GPS. We walk
// a compressed timeline (clip / drive / rest) — clips play full length via expo-audio
// and advance on finish; the silent drive between stops becomes a short dot "zip".
// Map-less: a route progress line + an auto-scrolling stop list. This is the live
// driving player minus GPS (later: swap the segment clock for expo-location).

const ROW_H = 56

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
  const { id } = useLocalSearchParams<{ id: string }>()
  const [data, setData] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [needsAccount, setNeedsAccount] = useState(false)
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [done, setDone] = useState(false)

  const player = useAudioPlayer()
  const status = useAudioPlayerStatus(player)
  const dot = useRef(new Animated.Value(0)).current
  const loadedSeq = useRef<number | null>(null) // which clip is loaded in the player
  const finishedIdx = useRef<number>(-1) // guard didJustFinish double-advance
  const sawFresh = useRef(false) // have we seen the LOADED clip actually playing yet?
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const listRef = useRef<ScrollView | null>(null)

  // ---- load: tour geometry + presigned audio + the compressed timeline ----
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!id) return
      setError(null)
      setNeedsAccount(false)
      try {
        await setAudioModeAsync({ playsInSilentMode: true }).catch(() => {})
        const [tour, signed] = await Promise.all([getTour(id), signTourAudio(id)])
        if (cancelled) return
        if (!tour.corridor) throw new Error('This tour has no route to drive.')
        const tl = buildPreviewTimeline(
          tour.stops.map((s) => ({ seq: s.seq, stopType: s.stopType, name: s.name, lat: s.lat, lng: s.lng, audioDurationMs: s.audioDurationMs })),
          tour.corridor.polyline as [number, number][],
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
        return
      }
      setIdx(next)
    },
    [data],
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
        player.replace({ uri })
      }
      player.play()
      // advance happens in the didJustFinish effect below
    } else {
      // drive / rest: animate the dot across the gap, then advance after previewMs.
      const from = seg.fromProgress ?? seg.routeProgress
      dot.setValue(from)
      Animated.timing(dot, { toValue: seg.routeProgress, duration: seg.previewMs, useNativeDriver: false }).start()
      timer.current = setTimeout(() => advance(idx + 1), seg.previewMs)
    }

    return () => {
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
      }
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
    if (status.playing && !status.didJustFinish) sawFresh.current = true
    if (status.didJustFinish && sawFresh.current && finishedIdx.current !== idx) {
      finishedIdx.current = idx
      advance(idx + 1)
    }
  }, [status.playing, status.didJustFinish, data, idx, playing, advance])

  // ---- auto-scroll the stop list to the active stop ----
  const activeSeq = data?.segments[idx]?.seq
  useEffect(() => {
    if (!data || activeSeq == null) return
    const row = data.stops.findIndex((s) => s.seq === activeSeq)
    if (row >= 0) listRef.current?.scrollTo({ y: Math.max(0, row * ROW_H - ROW_H), animated: true })
  }, [activeSeq, data])

  const restart = () => {
    loadedSeq.current = null
    finishedIdx.current = -1
    dot.setValue(0)
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
    }
  }, [player])

  // Tap a stop to jump the drive there and play it from the start.
  const jumpToStop = (seq: number) => {
    if (!data) return
    const target = data.segments.findIndex((s) => s.seq === seq && s.kind !== 'drive')
    if (target < 0) return
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    loadedSeq.current = null // force the target clip to (re)load from its start
    finishedIdx.current = -1
    dot.setValue(data.segments[target]!.routeProgress)
    setDone(false)
    setIdx(target)
    setPlaying(true)
  }

  const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`

  if (needsAccount) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Members only' }} />
        <Text style={styles.title}>Create a free account to preview this tour</Text>
        <Text style={styles.dim}>Anonymous preview is limited to the sample tour.</Text>
        <Link href="/sign-in" style={styles.button}>
          Sign in / Sign up
        </Link>
      </View>
    )
  }
  if (error) return <Text style={[styles.pad, styles.error]}>{error}</Text>
  if (!data) return <ActivityIndicator style={styles.pad} />

  const seg = data.segments[idx]
  const nextStopName = seg ? data.stops.find((s) => s.seq === seg.seq)?.name : undefined

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Preview drive' }} />

      <View style={styles.header}>
        <Text style={styles.title}>{data.tourName}</Text>
        <Text style={styles.dim}>
          {data.region} · simulated drive · {mmss(data.totalPreviewMs)} preview of a {mmss(data.totalRealMs)} drive
        </Text>
      </View>

      {/* Route progress line with the moving dot */}
      <View style={styles.track}>
        <Animated.View
          style={[
            styles.dot,
            { left: dot.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
          ]}
        />
      </View>

      {/* NOW card */}
      <View style={styles.now}>
        {done ? (
          <Text style={styles.nowBig}>🏁 Drive complete</Text>
        ) : seg?.kind === 'drive' ? (
          <>
            <Text style={styles.nowKicker}>🚗 driving</Text>
            <Text style={styles.nowBig}>~{((seg.distanceM ?? 0) / 1609).toFixed(1)} mi to {nextStopName ?? 'the next stop'}</Text>
          </>
        ) : seg?.kind === 'rest' ? (
          <>
            <Text style={styles.nowKicker}>☕ rest stop</Text>
            <Text style={styles.nowBig}>{nextStopName ?? 'A good spot to stretch'}</Text>
          </>
        ) : (
          <>
            <Text style={styles.nowKicker}>▶ now playing · {seg?.stopType}</Text>
            <Text style={styles.nowBig}>{nextStopName ?? 'Skipper'}</Text>
            {status.duration ? (
              <Text style={styles.dim}>
                {mmss((status.currentTime ?? 0) * 1000)} / {mmss((status.duration ?? 0) * 1000)}
              </Text>
            ) : null}
          </>
        )}
      </View>

      <View style={styles.controls}>
        {done ? (
          <Pressable style={styles.button} onPress={restart}>
            <Text style={styles.buttonText}>↺ Drive it again</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.button} onPress={() => setPlaying((p) => !p)}>
            <Text style={styles.buttonText}>{playing ? '❚❚ Pause' : '▶ Start the drive'}</Text>
          </Pressable>
        )}
      </View>

      <Text style={styles.hint}>Tap any stop to jump there</Text>

      {/* Stop list (map-less timeline) — tap to jump */}
      <ScrollView ref={listRef} style={styles.list} contentContainerStyle={{ paddingBottom: 24 }}>
        {data.stops.map((s) => {
          const active = s.seq === activeSeq && !done
          return (
            <Pressable
              key={s.seq}
              onPress={() => jumpToStop(s.seq)}
              style={({ pressed }) => [styles.row, active && styles.rowActive, pressed && styles.rowPressed]}
            >
              <View style={[styles.bullet, active && styles.bulletActive]} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowName, active && styles.rowNameActive]} numberOfLines={1}>
                  {s.name}
                </Text>
                <Text style={styles.dim}>{s.stopType}</Text>
              </View>
              <Text style={styles.chev}>{active ? '♪' : '▶'}</Text>
            </Pressable>
          )
        })}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  header: { paddingHorizontal: 16, paddingTop: 12, gap: 2 },
  track: { height: 6, marginHorizontal: 16, marginTop: 14, marginBottom: 6, borderRadius: 3, backgroundColor: '#e6e6e6', justifyContent: 'center' },
  dot: { position: 'absolute', width: 14, height: 14, borderRadius: 7, marginLeft: -7, backgroundColor: '#1e6fd9' },
  now: { paddingHorizontal: 16, paddingVertical: 14, gap: 4 },
  nowKicker: { fontSize: 13, color: '#1e6fd9', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  nowBig: { fontSize: 22, fontWeight: '700' },
  controls: { paddingHorizontal: 16, paddingBottom: 8 },
  list: { flex: 1, marginTop: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#eee' },
  hint: { fontSize: 12, color: '#999', paddingHorizontal: 16, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, height: ROW_H, paddingHorizontal: 16 },
  rowActive: { backgroundColor: '#eef4fd' },
  rowPressed: { backgroundColor: '#e3e3e3' },
  bullet: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#ccc' },
  bulletActive: { backgroundColor: '#1e6fd9' },
  rowName: { fontSize: 15, fontWeight: '500', color: '#333' },
  rowNameActive: { color: '#0a0a0a', fontWeight: '700' },
  chev: { fontSize: 14, color: '#bbb' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },
  title: { fontSize: 20, fontWeight: '700' },
  dim: { fontSize: 13, color: '#666' },
  button: { backgroundColor: '#1e6fd9', borderRadius: 10, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  error: { color: '#b00020' },
  pad: { padding: 16 },
})
