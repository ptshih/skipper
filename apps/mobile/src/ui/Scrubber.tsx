// The playback POSITION BAR — scrub within the current clip. Trailhead-89 language:
// a sunken atlas well (the track bed), a pine "traveled" fill, and an amber boat-token
// disc as the draggable thumb, with stamped mono time labels.
//
// Tap anywhere to seek; drag the thumb to scrub. Correctness notes (each a fixed review
// finding):
//  - The PanResponder is built ONCE (a lazy ref) and reads the latest seekable/duration/
//    onSeek from refs. If we rebuilt it per render, an in-flight drag would be handed a
//    fresh, zeroed gestureState mid-gesture (the parent re-renders on every audio tick),
//    snapping the thumb back to its start. Built once, the handlers never swap mid-drag.
//  - Children are pointerEvents="none" so the ROW is always the touch target — otherwise
//    grabbing the thumb measures locationX against the 18px thumb, not the bar.
//  - On release we hold the committed fraction until the player clock catches up, so the
//    thumb doesn't flash back to the pre-seek position while seekTo() is in flight.
//  - onScrubbingChange lets the player suppress its clip-finished auto-advance while a
//    drag is live, so a scrub through a clip's final seconds isn't yanked to the next stop.
// Screen-reader users get an `adjustable` role announcing a spoken time, whose
// increment/decrement jog ±15s (mirrors the skip buttons).
import { useEffect, useRef, useState } from 'react'
import { PanResponder, StyleSheet, View } from 'react-native'
import { border, hit, space } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'
import { Text } from './Text'

export interface ScrubberProps {
  positionMs: number
  durationMs: number
  /** Seek target, in ms. Called once on release / on a tap / on an a11y jog. */
  onSeek: (ms: number) => void
  /** Fired true on drag start, false on release/terminate — so the player can hold its auto-advance. */
  onScrubbingChange?: (active: boolean) => void
  disabled?: boolean
}

const THUMB = 18
const TRACK_H = 6
const ROW_H = hit.min // a fat, in-car touch target around a thin visual bar
const JOG_MS = 15_000 // a11y increment/decrement = the same 15s the skip buttons use
const CAUGHT_UP = 0.02 // drop the optimistic committed frac once the clock is within 2%

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)

const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const spokenTime = (ms: number) => {
  const t = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(t / 60)
  const s = t % 60
  return `${m} minute${m === 1 ? '' : 's'} ${s} second${s === 1 ? '' : 's'}`
}

export function Scrubber({
  positionMs,
  durationMs,
  onSeek,
  onScrubbingChange,
  disabled,
}: ScrubberProps) {
  const { colors } = useTheme()
  const [width, setWidth] = useState(0)
  const [dragFrac, setDragFrac] = useState<number | null>(null)
  const [committed, setCommitted] = useState<number | null>(null) // optimistic post-release position
  const widthRef = useRef(0)
  const startFrac = useRef(0) // fraction at gesture grant, for dx-relative dragging

  const seekable = !disabled && durationMs > 0
  const baseFrac = durationMs > 0 ? clamp01(positionMs / durationMs) : 0
  const frac = dragFrac ?? committed ?? baseFrac

  // Latest values for the once-built responder to read (so it never goes stale yet never rebuilds).
  const live = useRef({ seekable, durationMs, onSeek, onScrubbingChange })
  live.current = { seekable, durationMs, onSeek, onScrubbingChange }

  // Once the real clock lands near the committed seek, stop overriding with it.
  useEffect(() => {
    if (committed != null && Math.abs(baseFrac - committed) < CAUGHT_UP) setCommitted(null)
  }, [baseFrac, committed])

  // A new clip (duration changes) resets any pending drag/committed override.
  useEffect(() => {
    setDragFrac(null)
    setCommitted(null)
  }, [durationMs])

  const responderRef = useRef<ReturnType<typeof PanResponder.create> | null>(null)
  if (!responderRef.current) {
    const fracAtGrantX = (x: number) => {
      const w = widthRef.current
      return w > 0 ? clamp01(x / w) : 0
    }
    const fracAtMove = (dx: number) => {
      const w = widthRef.current
      return clamp01(startFrac.current + (w > 0 ? dx / w : 0))
    }
    responderRef.current = PanResponder.create({
      onStartShouldSetPanResponder: () => live.current.seekable,
      onMoveShouldSetPanResponder: () => live.current.seekable,
      // Hold the drag once we have it — never yield to a competing recognizer (the
      // screen's swipe-back gesture), so a horizontal scrub can't pop the screen.
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (e) => {
        const f = fracAtGrantX(e.nativeEvent.locationX)
        startFrac.current = f
        live.current.onScrubbingChange?.(true)
        setDragFrac(f)
      },
      onPanResponderMove: (_e, g) => setDragFrac(fracAtMove(g.dx)),
      onPanResponderRelease: (_e, g) => {
        const f = fracAtMove(g.dx)
        setDragFrac(null)
        setCommitted(f)
        live.current.onSeek(f * live.current.durationMs)
        live.current.onScrubbingChange?.(false)
      },
      onPanResponderTerminate: () => {
        setDragFrac(null)
        live.current.onScrubbingChange?.(false)
      },
    })
  }

  return (
    <View style={disabled ? styles.disabled : undefined}>
      <View
        style={styles.row}
        onLayout={(e) => {
          widthRef.current = e.nativeEvent.layout.width
          setWidth(e.nativeEvent.layout.width)
        }}
        accessibilityRole="adjustable"
        accessibilityLabel="Playback position"
        accessibilityState={{ disabled: !!disabled }}
        accessibilityValue={{
          min: 0,
          max: Math.round(durationMs / 1000),
          now: Math.round((frac * durationMs) / 1000),
          text: spokenTime(frac * durationMs),
        }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(ev) => {
          if (!seekable) return
          const cur = frac * durationMs
          const next =
            ev.nativeEvent.actionName === 'increment'
              ? Math.min(durationMs, cur + JOG_MS)
              : Math.max(0, cur - JOG_MS)
          onSeek(next)
        }}
        {...responderRef.current.panHandlers}
      >
        <View
          pointerEvents="none"
          style={[styles.bed, { backgroundColor: colors.surfaceSunken }]}
        />
        <View
          pointerEvents="none"
          style={[styles.fill, { width: frac * width, backgroundColor: colors.trackActive }]}
        />
        <View
          pointerEvents="none"
          style={[
            styles.thumb,
            {
              // Travel the thumb's LEFT EDGE across [0, width-THUMB] so the disc edges stay
              // flush with the bar ends — left edge at the gutter (the NOW card's border) at
              // 0%, instead of half the disc hanging past it.
              left: frac * Math.max(0, width - THUMB),
              backgroundColor: colors.amberToken,
              borderColor: colors.onAmber, // hairline edge so it reads on the pale daylight bed
            },
          ]}
        />
      </View>
      <View style={styles.times}>
        <Text variant="mono" color="inkDim">
          {mmss(frac * durationMs)}
        </Text>
        <Text variant="mono" color="inkDim">
          {mmss(durationMs)}
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  disabled: { opacity: 0.45 },
  row: { height: ROW_H, justifyContent: 'center' },
  bed: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
  },
  fill: {
    position: 'absolute',
    left: 0,
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
  },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    borderWidth: border.thin,
  },
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: space.xs,
  },
})
