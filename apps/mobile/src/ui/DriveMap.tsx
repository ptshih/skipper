// The live-drive MAP — a tinted Google basemap (Trailhead 89, day/dusk) with our
// brand-owned overlay drawn on top: the route line (traveled pine / untraveled dashed
// tan), the stop markers (passed / upcoming / active / endpoint), and the live-position puck. The
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

// THE UNTRAVELED LINE ON A STATIC OVERVIEW (`hidePuck`) IS DRAWN HEAVIER THAN IN A LIVE DRIVE, and
// the reason is that it is doing a different job. In the drive it is a BACKDROP — the traveled pine
// grows over it and the puck says where you are, so a sparse 2-on-10 dash reads as "road ahead"
// without competing. On the proposal card and the detail preview there is no puck and no traveled
// overlay, so this line IS the route: at card size (a whole lake in ~375×200pt) a 2-on-10 dash is
// ~17% ink and reads as an EMPTY map. Observed on device 2026-08-03 — the route was mistaken for
// missing entirely, which is the strongest possible evidence it was too faint.
// Still dashed, not solid: the dashed track is the design language (RouteTrack uses it too). Denser
// and thicker, not a different mark.
const STATIC_ROUTE_DASH = [6, 6]
const STATIC_ROUTE_W = 5

// THE ENDPOINT PIN IS PINE AND BIGGER THAN AN UPCOMING ONE, because on a static overview it is the
// mark the whole card is read through. `upcoming` is a 12pt disc filled with `surface` — i.e. the
// dusk basemap itself — which reads as a HOLE at card size, not a marker. A filled pine disc with a
// surface ring separates from the trail at a glance (DESIGN §2.1) and spends none of the §8 amber.
const ENDPOINT_DOT = 18

// EVERY MARKER RING IS `border.keyline` (§3's top border value), where the active dot used a raw 3
// and the endpoint/upcoming dots a raw 2. The ring's job — separating a dot from the basemap under
// it — is the same job the live PUCK's ring does, and the puck has always drawn it at `border.keyline`
// on the same tinted basemap (mapChrome `puckStyles.dot`). Two marks meant to read as one object
// class now literally share one value, and if 1.5 turns out to be too thin against a busy basemap it
// is too thin for the puck first — one screenshot settles both, and the fix lands in one place
// instead of three. (2026-08-03)

/** A map stop = a place to pin, with its state on the surface drawing it.
 *
 *  ⚠ `passed`/`active`/`upcoming` are DRIVE-PROGRESS states — `active` means "now playing", NOT
 *  "destination". `endpoint` exists because the proposal card and the detail preview have no
 *  progress at all: it means "a place this route begins or ends at", and borrowing `active` for it
 *  (as PreviewCard did until 2026-08-03) put a glowing amber halo on a surface whose CTA already
 *  owns the screen's one amber — twice over on a route with a via. */
export interface DriveMapStop {
  seq: number
  name: string
  lat: number
  lng: number
  state: 'passed' | 'active' | 'upcoming' | 'endpoint'
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
   *  passed-in `progress` (held at 0). The in-drive player leaves this off so the puck rides.
   *  ⚠ Also suppresses the active marker's amber halo: a surface with no live position has no "now
   *  playing" to glow about, and its host (the proposal card's CTA) is already spending the screen's
   *  one moving/glowing amber (DESIGN §8). */
  hidePuck?: boolean
  /** Freeze the camera — no pan, no zoom. For a map embedded in a SCROLLING page (the proposal
   *  card), where it is a picture, not a control: at RN's defaults the 200pt full-width MapView eats
   *  any vertical drag that starts on it, so the conversation will not scroll past the card. Worse,
   *  a pan drops follow mode, and that surface passes `hideRecenter` while its `progress` never
   *  ticks — so the camera listener below never re-frames and the route goes off-screen for good.
   *  ⚠ NOT keyed on `hidePuck`: the drive-detail map is also puck-less but is FULL-SCREEN, where
   *  panning to browse pins + the "fit the whole drive" chip are the point. */
  locked?: boolean
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
  locked,
}: DriveMapProps) {
  const { colors, isDark } = useTheme()
  const reducedMotion = useReducedMotion()
  const mapRef = useRef<MapView | null>(null)
  const [following, setFollowing] = useState(true)
  const followingRef = useRef(true)
  // Mirror of `following` for the progress listener below, which is registered once and would other-
  // wise close over the value at registration time and never see a pan.
  // Deliberate: an effect would land after paint, so a GPS fix arriving in that window would
  // re-centre a map the rider had just panned away from.
  // eslint-disable-next-line react-hooks/refs
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
  // ⚠ THE STOPS COUNT TOWARD THE BBOX, NOT JUST THE LINE. A polyline can be empty while the pins
  // are known — a proposal whose geometry hasn't resolved yet, or a drive stored with stops but no
  // route — and an undefined `initialRegion` hands the map its VENDOR default (a world view, or
  // Mountain View), i.e. the one framing guaranteed to contain none of the rider's drive. `recenter`
  // already fits both sets; first paint had no reason to be narrower. Undefined stays reserved for
  // the honest case: neither a line nor a pin, so there is genuinely nothing to frame. (2026-08-03)
  const routeRegion = useMemo<Region | undefined>(() => {
    let minLat = Infinity
    let maxLat = -Infinity
    let minLng = Infinity
    let maxLng = -Infinity
    const extend = (lat: number, lng: number) => {
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
      if (lng < minLng) minLng = lng
      if (lng > maxLng) maxLng = lng
    }
    for (const [lng, lat] of polyline) extend(lat, lng)
    for (const s of stops) extend(s.lat, s.lng)
    if (minLat === Infinity) return undefined
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max(0.02, (maxLat - minLat) * 1.5),
      longitudeDelta: Math.max(0.02, (maxLng - minLng) * 1.5),
    }
  }, [polyline, stops])

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
        // See `locked` — a preview map inside a scroll view is a picture, not a control.
        // ⚠ `pointerEvents` IS THE LOAD-BEARING HALF, and `scrollEnabled={false}` ALONE DOES NOT WORK
        // — verified on device 2026-08-03, twice: a swipe that began on the map still scrolled
        // nothing. Disabling the gestures stops the map panning ITSELF; the native view goes on
        // swallowing the touch instead of letting it reach the ScrollView underneath, so the effect
        // for a rider is identical to the bug (drag on the card, nothing moves). `none` is what
        // actually forwards it. The gesture flags stay: they are what keeps the camera from being
        // moved programmatically off-route, and they document the intent even where they cannot
        // enforce it.
        // ⚠ SAFE ONLY BECAUSE A LOCKED MAP HAS NO TAP TARGETS: `locked` is set by the proposal card,
        // which passes no `onPressStop`. The drive-detail preview DOES (tap a pin to play that stop)
        // and is never locked. Setting `locked` on a surface with tappable markers would silently
        // kill them.
        pointerEvents={locked ? 'none' : 'auto'}
        scrollEnabled={!locked}
        zoomEnabled={!locked}
        onPanDrag={() => following && setFollowing(false)}
        // ⚠ LABELLED BECAUSE THE NATIVE VIEW NAMES ITSELF BADLY. Observed on device 2026-08-03: the
        // Google Maps iOS view surfaces to VoiceOver as a **slider with no label** — the single
        // largest element on the proposal card announced as an unnamed control. A label is the whole
        // fix; the role is the vendor's and not worth fighting.
        // ⚠ Deliberately NOT `accessible` — setting that collapses the subtree into ONE element and
        // would swallow the stop markers, which are already exposed individually with real place
        // names (and are the only way a VoiceOver rider can enumerate the route at all).
        accessibilityLabel="Map of the route, with a marker for each stop"
      >
        {/* Untraveled base: the FULL route, dashed tan — static (identity stable), so it isn't
            re-serialized to native each tick; the traveled pine grows over it. NOTE: lineDashPattern
            is iOS-only on Polyline — on Android the untraveled line is solid tan (color/width carry
            the distinction). (audit #7, #472) */}
        {/* ⚠ THE CASING, and it is why the route survives a basemap it does not control. A single flat
            stroke CANNOT read over both dusk land (#14201B) and dusk water (#5FA7B8): measured, the tan
            that scores 4.97 on land scores 1.24 on the lake, and the value that beats the lake is the
            one that vanished into the roads. Two stacked lines solve what one colour cannot — the
            standard cartographic casing, and the same idiom this file already uses for the active
            marker's `borderColor: colors.surface`. Solid under a dashed top line reads as a track, and
            it keeps the dashed-trail language §1 asks for rather than trading it for a solid rope.
            STATIC ONLY: the live drive grows a traveled pine line over this one and carries a puck, so
            it has its own separation and its untraveled backdrop is meant to recede. */}
        {latlngs.length > 1 && hidePuck ? (
          <Polyline coordinates={latlngs} strokeColor={colors.surface} strokeWidth={STATIC_ROUTE_W + 4} />
        ) : null}
        {latlngs.length > 1 ? (
          <Polyline
            coordinates={latlngs}
            // ⚠ `routeTrail` on a basemap, NOT `trackInactive` — that one is the trail on our own
            // surfaces, and on the MAP it is the byte-identical twin of the minor roads underneath
            // (contrast 1.00, both themes). See the role's note in theme.ts.
            strokeColor={hidePuck ? colors.routeTrail : colors.trackInactive}
            strokeWidth={hidePuck ? STATIC_ROUTE_W : 4}
            lineDashPattern={hidePuck ? STATIC_ROUTE_DASH : [2, 10]}
          />
        ) : null}
        {traveled.length > 1 ? (
          <Polyline coordinates={traveled} strokeColor={colors.trackActive} strokeWidth={5} />
        ) : null}

        {/* Stop markers — passed (filled pine), upcoming (hollow), endpoint (filled pine, larger),
            active (amber, larger, haloed only where there is a live position to have). */}
        {stops.map((s) => {
          const active = s.state === 'active'
          const passed = s.state === 'passed'
          const endpoint = s.state === 'endpoint'
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
                {active && !hidePuck ? (
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
                          borderWidth: border.keyline,
                        }
                      : endpoint
                        ? {
                            width: ENDPOINT_DOT,
                            height: ENDPOINT_DOT,
                            borderRadius: ENDPOINT_DOT / 2,
                            backgroundColor: colors.trackActive,
                            borderColor: colors.surface,
                            borderWidth: border.keyline,
                          }
                        : passed
                          ? {
                              // ⚠ THE RING IS NOT DECORATION — it is the only thing separating a mark
                              // from a basemap we do not control. `passed` was the ONE state without
                              // one (its three siblings all set it), and it is pine: measured 1.05
                              // against the dusk lake, and still 1.05 under simulated deuteranopia and
                              // protanopia, so hue does not rescue it either. On a lakeside route —
                              // i.e. every Tahoe drive — a played stop simply vanished into the water.
                              // Same idiom as the route casing: `surface` is what the map is not.
                              backgroundColor: colors.trackActive,
                              borderColor: colors.surface,
                              borderWidth: border.keyline,
                            }
                          : {
                              backgroundColor: colors.surface,
                              // ⚠ `routeTrail`, NOT `trackInactive` — this marker is INVERTED (the
                              // brand colour is the RING and `surface` is the FILL), so it had the
                              // collision twice over: a disc the colour of the land, ringed in the
                              // colour of the roads (both 1.00, measured). It was a hole, not a
                              // marker. Drawing the ring in the trail's own colour is also what it
                              // means — a waypoint ON the route, not yet reached.
                              borderColor: colors.routeTrail,
                              borderWidth: border.keyline,
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
