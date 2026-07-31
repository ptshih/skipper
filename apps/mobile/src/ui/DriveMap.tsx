// The live-drive MAP — a tinted Google basemap (Trailhead 89, day/dusk) with our
// brand-owned overlay drawn on top: the route line (traveled pine / untraveled dashed
// tan), the stop markers (passed / upcoming / active), and the live-position puck. The
// puck rides the ROUTE at `progress` — the same 0..1 the car token uses on `RouteTrack`
// — so it's mode-agnostic (live GPS, sim, and the couch preview all drive `progress`)
// and always sits on the road, never in the gutter.
//
// Camera follows the puck and re-frames as it moves; panning the map drops follow mode
// and floats a "recenter" chip (the standard nav pattern). The basemap tint is Google-
// only — without a key (EXPO_PUBLIC_GOOGLE_MAPS_API_KEY) iOS falls back to Apple Maps
// (untinted) and List mode stays the offline + accessibility-complete equivalent.
import { bearingDeg } from '@skipper/engine'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, StyleSheet, View } from 'react-native'
import MapView, { Marker, Polyline, type LatLng, type Region } from 'react-native-maps'
import { baseMapProps, puckStyles, RecenterChip, toLatLng } from './mapChrome'
import { border, radius, space } from '../theme/tokens'
import { useReducedMotion, useTheme } from '../theme'

/** A map stop = a place to pin, with its current drive state (mirrors the StopList rows). */
export interface DriveMapStop {
  seq: number
  name: string
  lat: number
  lng: number
  state: 'passed' | 'active' | 'upcoming'
}

export interface DriveMapProps {
  /** The route as [lng, lat] pairs (GeoJSON axis order — same as the API ships). */
  polyline: [number, number][]
  stops: DriveMapStop[]
  /** 0..1 route position — drives the puck + the traveled/untraveled split. */
  progress: Animated.Value
  /** A clip is playing → the NOW sheet owns the screen's one amber glow, so dim the map's
   *  amber accents (DESIGN §8 one-amber budget). */
  clipActive?: boolean
  /** Hide the recenter chip (e.g. while the player sheet is expanded over the map). */
  hideRecenter?: boolean
  /** Lift the recenter chip above a floating sheet (px from the bottom). */
  recenterBottom?: number
  /** Tap a stop marker (the drive-detail mini-preview browses stops on the map, tap a pin to play).
   *  Omit for the live/sim drive, where markers are read-only. */
  onPressStop?: (seq: number) => void
  /** Drop the live-position puck (+ the traveled/untraveled split): the detail mini-preview has no
   *  live position — it's a static route + pins with the active stop highlighted, driven only by the
   *  passed-in `progress` (held at 0). The in-drive player leaves this off so the puck rides. */
  hidePuck?: boolean
}



// memo: the player re-renders ~2×/sec from the audio status tick; with a memoized `stops` + stable
// `progress`/`polyline`, this skips re-rendering the whole map subtree on those ticks. (audit #549)
function DriveMapBase({
  polyline,
  stops,
  progress,
  clipActive,
  hideRecenter,
  recenterBottom,
  onPressStop,
  hidePuck,
}: DriveMapProps) {
  const { colors, isDark } = useTheme()
  const reducedMotion = useReducedMotion()
  const mapRef = useRef<MapView | null>(null)
  const [following, setFollowing] = useState(true)
  const followingRef = useRef(true)
  followingRef.current = following

  // Cumulative along-route distances — for projecting `progress` (a fraction) to a point.
  const cum = useMemo(() => {
    const out = [0]
    for (let i = 1; i < polyline.length; i++) {
      const a = polyline[i - 1]!
      const b = polyline[i]!
      // Weight the E-W delta by cos(latitude) so a longitude degree isn't over-counted vs a latitude
      // degree at Tahoe's ~39°N (else the puck mis-weights E-W vs N-S on diagonal roads). (audit #576)
      const latMid = (((a[1] + b[1]) / 2) * Math.PI) / 180
      const dx = (b[0] - a[0]) * Math.cos(latMid)
      const dy = b[1] - a[1]
      out.push(out[i - 1]! + Math.hypot(dx, dy))
    }
    return out
  }, [polyline])
  const total = cum[cum.length - 1] ?? 0

  // The route framed as a region (first paint shows the whole drive before follow kicks in).
  const routeRegion = useMemo<Region | undefined>(() => {
    if (polyline.length === 0) return undefined
    let minLat = Infinity
    let maxLat = -Infinity
    let minLng = Infinity
    let maxLng = -Infinity
    for (const [lng, lat] of polyline) {
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
      if (lng < minLng) minLng = lng
      if (lng > maxLng) maxLng = lng
    }
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max(0.02, (maxLat - minLat) * 1.5),
      longitudeDelta: Math.max(0.02, (maxLng - minLng) * 1.5),
    }
  }, [polyline])

  // The full route as LatLng, computed ONCE per polyline — the static untraveled base layer. NOT
  // rebuilt per tick (the old project() re-sliced + re-mapped both full arrays every fix and re-pushed
  // them to native — the hour-long-drive CPU/GC + bridge regressor). (audit #7)
  const latlngs = useMemo(() => polyline.map(toLatLng), [polyline])

  // Project a 0..1 fraction to the puck point + the segment index it's in (NO array building).
  const project = useCallback(
    (frac: number): { puck: LatLng | null; heading: number; idx: number } => {
      if (latlngs.length < 2 || total <= 0) return { puck: latlngs[0] ?? null, heading: 0, idx: 0 }
      const target = Math.max(0, Math.min(1, frac)) * total
      let i = 0
      while (i < cum.length - 2 && (cum[i + 1] ?? 0) < target) i++
      const a = polyline[i]!
      const b = polyline[i + 1] ?? a
      const segLen = (cum[i + 1] ?? cum[i]!) - cum[i]!
      const segFrac = segLen > 0 ? (target - cum[i]!) / segLen : 0
      return {
        puck: {
          latitude: a[1] + (b[1] - a[1]) * segFrac,
          longitude: a[0] + (b[0] - a[0]) * segFrac,
        },
        heading: bearingDeg(a, b),
        idx: i,
      }
    },
    [polyline, latlngs, cum, total],
  )

  const initial = project(0)
  // The puck rides every tick (a cheap single-Marker move); the traveled SPLIT only advances when the
  // integer segment index changes (per ~13 m vertex, not per sub-segment tick). (audit #7)
  const [puck, setPuck] = useState<LatLng | null>(initial.puck)
  const [heading, setHeading] = useState(initial.heading)
  const [segIdx, setSegIdx] = useState(initial.idx)

  // Traveled overlay = route up to the last crossed vertex (the puck Marker covers the sub-vertex
  // remainder over the static dashed base). Rebuilt only when segIdx changes. (audit #7)
  const traveled = useMemo(() => latlngs.slice(0, segIdx + 1), [latlngs, segIdx])

  // Follow `progress` (GPS/sim/preview): move the puck every tick, advance the split only on a vertex
  // change, and glide the camera onto the puck while following — THROTTLED to ~1/sec so a 60fps
  // preview tween doesn't re-issue animateCamera every frame. A small epsilon ignores sub-pixel
  // ticks. (audit #7, #540)
  const lastFrac = useRef(-1)
  const lastCamAt = useRef(0)
  useEffect(() => {
    const id = progress.addListener(({ value }) => {
      if (Math.abs(value - lastFrac.current) < 0.0005) return
      lastFrac.current = value
      const next = project(value)
      setPuck(next.puck)
      setHeading(next.heading)
      setSegIdx((prev) => (prev === next.idx ? prev : next.idx))
      if (followingRef.current && next.puck) {
        const now = Date.now()
        if (now - lastCamAt.current >= 1000) {
          lastCamAt.current = now
          mapRef.current?.animateCamera(
            { center: next.puck, zoom: 14 },
            { duration: reducedMotion ? 0 : 500 },
          )
        }
      }
    })
    return () => progress.removeListener(id)
  }, [progress, project, reducedMotion])

  const recenter = () => {
    setFollowing(true)
    lastCamAt.current = Date.now() // reset the follow throttle so the next tick doesn't immediately re-glide
    // No live position (the detail mini-preview, hidePuck): "recenter" FRAMES THE WHOLE DRIVE — fit every
    // stop marker + the route into view so all POIs are visible, not zoom to a single point.
    if (hidePuck) {
      const coords = [...latlngs, ...stops.map((s) => ({ latitude: s.lat, longitude: s.lng }))]
      if (coords.length >= 2) {
        mapRef.current?.fitToCoordinates(coords, {
          edgePadding: { top: 64, right: 48, bottom: 64, left: 48 },
          animated: !reducedMotion,
        })
      } else if (coords.length === 1) {
        mapRef.current?.animateCamera(
          { center: coords[0]!, zoom: 14 },
          { duration: reducedMotion ? 0 : 400 },
        )
      }
      return
    }
    if (puck) {
      mapRef.current?.animateCamera(
        { center: puck, zoom: 14 },
        { duration: reducedMotion ? 0 : 400 },
      )
    }
  }

  const amber = clipActive ? colors.trackInactive : colors.amberToken // dim while a clip owns the glow

  return (
    <View style={styles.fill}>
      <MapView
        ref={mapRef}
        {...baseMapProps(isDark)}
        style={styles.fill}
        initialRegion={routeRegion}
        onPanDrag={() => following && setFollowing(false)}
      >
        {/* Untraveled base: the FULL route, dashed tan — static (identity stable), so it isn't
            re-serialized to native each tick; the traveled pine grows over it. NOTE: lineDashPattern
            is iOS-only on Polyline — on Android the untraveled line is solid tan (color/width carry
            the distinction). (audit #7, #472) */}
        {latlngs.length > 1 ? (
          <Polyline
            coordinates={latlngs}
            strokeColor={colors.trackInactive}
            strokeWidth={4}
            lineDashPattern={[2, 10]}
          />
        ) : null}
        {traveled.length > 1 ? (
          <Polyline coordinates={traveled} strokeColor={colors.trackActive} strokeWidth={5} />
        ) : null}

        {/* Stop markers — passed (filled pine), upcoming (hollow), active (amber, larger). */}
        {stops.map((s) => {
          const active = s.state === 'active'
          const passed = s.state === 'passed'
          return (
            <Marker
              // Key on seq+state: with tracksViewChanges=false the native bitmap is snapshotted ONCE,
              // so a passed/active/upcoming change must REMOUNT the marker to redraw. (audit #242)
              key={`${s.seq}-${s.state}`}
              coordinate={{ latitude: s.lat, longitude: s.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
              title={s.name}
              tracksViewChanges={false}
              // Detail mini-preview: a pin tap plays that stop (a11y label carries the now-playing state,
              // since the tiny dot has no text). Read-only (no handler) on the live/sim drive.
              onPress={onPressStop ? () => onPressStop(s.seq) : undefined}
              accessibilityLabel={
                onPressStop
                  ? `${s.name}${active ? ', now playing' : passed ? ', played' : ''}`
                  : undefined
              }
            >
              <View style={styles.markerBox}>
                {active ? (
                  <View
                    style={[
                      styles.activeHalo,
                      { backgroundColor: clipActive ? 'transparent' : colors.glow },
                    ]}
                  />
                ) : null}
                <View
                  style={[
                    styles.stopDot,
                    active
                      ? {
                          width: 22,
                          height: 22,
                          borderRadius: 11,
                          backgroundColor: amber,
                          borderColor: colors.surface,
                          borderWidth: 3,
                        }
                      : passed
                        ? { backgroundColor: colors.trackActive }
                        : {
                            backgroundColor: colors.surface,
                            borderColor: colors.trackInactive,
                            borderWidth: 2,
                          },
                  ]}
                >
                  {active ? (
                    <View style={[styles.activeCore, { backgroundColor: colors.onAmber }]} />
                  ) : null}
                </View>
              </View>
            </Marker>
          )
        })}

        {/* The live-position puck — "you are here", riding the route at `progress`. tracksViewChanges
            stays at its default (true): the heading wedge transform changes per tick, so the bitmap
            must re-snapshot — an inherent cost of the rotating wedge. (audit #567) Hidden on the
            detail mini-preview (no live position — just route + pins). */}
        {!hidePuck && puck ? (
          <Marker coordinate={puck} anchor={{ x: 0.5, y: 0.5 }} flat>
            <View style={styles.markerBox}>
              <View style={[puckStyles.halo, { backgroundColor: colors.glow }]} />
              <View style={[styles.puckWedge, { transform: [{ rotate: `${heading}deg` }] }]}>
                <View style={[styles.wedgeTriangle, { borderBottomColor: amber }]} />
              </View>
              <View
                style={[puckStyles.dot, { backgroundColor: amber, borderColor: colors.surface }]}
              />
            </View>
          </Marker>
        ) : null}
      </MapView>

      {/* Recenter chip — appears once the rider pans the map away from the puck (and isn't
          hidden behind an expanded player sheet). */}
      {!following && !hideRecenter ? (
        <RecenterChip
          onPress={recenter}
          label={hidePuck ? 'Fit the whole drive on screen' : 'Recenter the map on me'}
          bottom={recenterBottom}
        />
      ) : null}
    </View>
  )
}

export const DriveMap = memo(DriveMapBase)

const styles = StyleSheet.create({
  fill: { flex: 1 },
  markerBox: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  stopDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeHalo: { position: 'absolute', width: 38, height: 38, borderRadius: 19, opacity: 0.6 },
  activeCore: { width: 6, height: 6, borderRadius: 3 },
  // the heading wedge sits just outside the dot, pointing in travel direction
  puckWedge: { position: 'absolute', width: 56, height: 56, alignItems: 'center' },
  wedgeTriangle: {
    width: 0,
    height: 0,
    marginTop: 2,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderBottomWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  recenter: {
    position: 'absolute',
    right: space.md,
    bottom: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: border.hair,
    // The cast is a cross-platform boxShadow set inline (it needs the theme's shadowCast color). (M4)
  },
})
