// The live-drive MAP — a tinted Google basemap (Trailhead 89, day/dusk) with our
// brand-owned overlay drawn on top: the route line (traveled pine / untraveled solid
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
import { keptCountUpTo, simplifyIndices } from '../lib/simplify-path'
import { baseMapProps, puckStyles, RecenterChip, toLatLng } from './mapChrome'
import { border, radius, space } from '../theme/tokens'
import { useReducedMotion, useTheme } from '../theme'

// THE UNTRAVELED LINE ON A STATIC OVERVIEW (`hidePuck`) IS DRAWN HEAVIER THAN IN A LIVE DRIVE, and
// the reason is that it is doing a different job. In the drive it is a BACKDROP — the traveled pine
// grows over it and the puck says where you are, so it can recede. On the proposal card and the
// detail preview there is no puck and no traveled overlay, so this line IS the route.
// ⚠ THE ORIGINAL FINDING STANDS, ONLY ITS UNITS CHANGED. Both lines used to be DASHED, and the
// overview's was made denser and thicker because at card size (a whole lake in ~375×200pt) a sparse
// 2-on-10 dash is ~17% ink and read as an EMPTY map — observed on device 2026-08-03, the route was
// mistaken for missing entirely. Both are SOLID as of 2026-08-05 (see the Polyline below for why),
// so "enough ink to read as a route" is now carried by WIDTH alone, which is what this constant is.
// Do not thin it on the theory that a solid line needs less: the 2026-08-03 observation was about how
// much of the line is actually inked at card size, and solid is simply the honest way to get there.
/* ⚠ `STATIC_ROUTE_DASH` ([6, 6]) WAS DELETED HERE (2026-08-05) — the route line is solid now.
 * The reasoning lives at the Polyline below; the short version is that a point-space dash cannot
 * survive a HIGH_QUALITY polyline at overview zoom, and MapKit has no zoom expression to fix it. */
const STATIC_ROUTE_W = 5

/** How far the DRAWN route may stray from the real one, in metres. See the `keptIdx` memo for where
 *  this number comes from — it is derived from `STATIC_ROUTE_W`, not chosen by eye, so a change to the
 *  stroke width is a reason to revisit it. ⚠ Display only: the engine never sees a thinned route. */
const DISPLAY_EPSILON_M = 2

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

  // ── DISPLAY GEOMETRY — the drawn route, thinned. NOTHING computed reads this. ────────────────
  // ⚠ THE SPLIT IS THE WHOLE DESIGN: `polyline`/`cum`/`project()` keep every vertex, so the puck's
  // position and heading are exactly as accurate as before; only what is HANDED TO THE MAP is thinned.
  // Simplifying the computed side would drift the puck off the road, which is the failure the
  // cosine-weighted distance maths above exists to prevent.
  // ⚠ MEASURED, NOT GUESSED (Zephyr Cove → Reno, saved manifest, 2026-08-05): 4559 vertices over
  // 90.7 km, median spacing 14.1 m. At ε=2 m that is 728 kept — a 6.3x cut — and the curve is flat
  // past there (ε=5 m → 449, ε=10 m → 303), so a bigger ε buys little for real visual risk.
  // ⚠ AND ε IS DERIVED FROM THE STROKE, not tuned by eye: the line is `STATIC_ROUTE_W` = 5pt, so at
  // roughly 1 m/pt — about the tightest zoom this map reaches — a 2 m deviation still falls INSIDE the
  // line's own width. The simplified route cannot visibly leave the road it replaced.
  const keptIdx = useMemo(() => simplifyIndices(polyline, DISPLAY_EPSILON_M), [polyline])
  const dispLatlngs = useMemo(() => keptIdx.map((i) => toLatLng(polyline[i]!)), [keptIdx, polyline])

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

  // Traveled overlay = the SIMPLIFIED route up to the last crossed vertex, then a final hop to the
  // puck. Rebuilt only when segIdx changes; the puck tail is appended separately below. (audit #7)
  //
  // ⚠ `segIdx` INDEXES THE FULL POLYLINE AND `dispLatlngs` DOES NOT — `keptCountUpTo` is what maps one
  // space onto the other, and skipping it is the silent bug in this change. Slicing `dispLatlngs` by a
  // full-polyline index would run the traveled line wildly ahead of the puck (there are ~6 full
  // vertices per kept one on average, and far more on a straight).
  const traveledBase = useMemo(
    () => dispLatlngs.slice(0, keptCountUpTo(keptIdx, segIdx)),
    [dispLatlngs, keptIdx, segIdx],
  )

  // ⚠ THE PUCK TAIL IS REQUIRED, NOT A FLOURISH — and only since simplification. The old comment said
  // "the puck Marker covers the sub-vertex remainder", which was true when vertices were ~14 m apart:
  // the gap between the last drawn vertex and the puck was smaller than the marker. Kept vertices can
  // be HUNDREDS of metres apart on a straight, so without this the pine line visibly trails the puck
  // down a highway. Anchoring the last point to the puck itself makes the split exact at every zoom.
  const traveled = useMemo(
    () => (puck ? [...traveledBase, puck] : traveledBase),
    [traveledBase, puck],
  )

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

  // DAYLIGHT LIFT — the day half of the dusk halo. A marker on a pale basemap reads by sitting ABOVE
  // it, which is a shadow with an offset, not a glow: `shadowCast` is exactly what §4 reserves for
  // "daylight elevation". Null at dusk, where the amber halo does this job and a second dark shadow
  // under it would only smudge the night basemap.
  // ⚠ Inline rather than in `StyleSheet` because the colour is themed — a StyleSheet entry cannot
  // reach `colors`.
  const dayLift = isDark
    ? null
    : { boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 6, color: colors.shadowCast }] }

  // THE SEPARATING EDGE IS TWO-TONE, and it has to be — one ring cannot do this job.
  //
  // ⚠ Every ring was `colors.surface`, and `mapStyle.ts` paints the basemap's LAND from that same
  // token — so the edge scored a flat **1.00 against land in both themes**. It separated a mark from
  // water and roads and did nothing on the surface a route mostly lies on. Dusk hid it (the amber fill
  // clears dark land unaided at 7.90); daylight did not (amber on paper is 2.47, under the 3:1 bar).
  // ⚠ AND SWAPPING IT FOR `ink` DOES NOT WORK EITHER — measured, that fixes land (12.99) and breaks
  // the lake (4.69 → 2.77). Day land is pale and day water is dark, so NO single edge colour clears
  // both, the same way no single stroke colour could carry the route line.
  // So: two tones, one always opposite the other. `ink` IS the inverse of `surface` in both themes
  // (ink-brown on paper, parchment at dusk), so an inner `surface` ring inside an outer `ink` hairline
  // covers pale layers and dark layers at once — which is how a map pin has always been built.
  const ringInner = colors.surface
  const ringOuter = { boxShadow: [{ offsetX: 0, offsetY: 0, blurRadius: 0, spreadDistance: 1, color: colors.ink }] }

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
        {/* Untraveled base: the FULL route, SOLID tan — static (identity stable), so it isn't
            re-serialized to native each tick; the traveled pine grows over it.
            ⚠ IT WAS DASHED AND THE DASHES WERE DELETED (founder, 2026-08-05: "the map route dashes
            render fine when zoomed in but distorted when zoomed out"). Reproduced at the fitted
            overview on a 61-minute route: the line did not read as dashes at all, it read as a fuzzy
            speckled band.
            ⚠ THE CAUSE IS VERTEX DENSITY vs SCREEN RESOLUTION, not a bad dash length.
            `materializeRoute` asks Google for `polylineQuality: 'HIGH_QUALITY'` — deliberately, and it
            is load-bearing for speed-adaptive trigger geofencing and the drive simulator, so it must
            NOT be lowered — which puts vertices a few metres apart. Zoomed in, a segment spans several
            points and a [6,6] dash draws cleanly. Zoomed out, one 6-point dash covers ~300–600 m of
            road, i.e. a hundred-plus vertices per dash, and the dash phase plus the line joins
            collapse into noise — with the casing below showing through the wreckage, which is what
            made it look furry rather than merely dotted.
            ⚠ AND MAPKIT OFFERS NO WAY OUT. `lineDashPattern` is a fixed array in POINT space with no
            zoom expression. Engines that support dashes across zoom (Mapbox GL) do it with
            zoom-dependent `line-dasharray` expressions, and even there it is a known-rough edge
            (dashes shift at fractional zoom, clip at tile boundaries). Keeping dashes here would mean
            hand-rolling zoom-aware re-simplification against `onRegionChangeComplete` — fighting the
            platform for a decoration.
            ⚠ AND THE CONVENTION AGREES: on a map a dash is SEMANTIC — it marks a different KIND of
            path (walking leg, ferry, unpaved, approximate). Spending it on the whole driving route
            spends a signal on decoration. The dashed-trail language is not lost: it lives in
            `RouteTrack`, on our own surfaces, where we own the coordinate space and it renders exactly
            as drawn.
            ⚠ Note this also makes iOS and Android agree. `lineDashPattern` was always iOS-only here,
            so Android has ALWAYS drawn this line solid and the file already accepted that "color/width
            carry the distinction". This makes that the rule rather than the Android compromise.
            (audit #7, #472) */}
        {/* ⚠ THE CASING, and it is why the route survives a basemap it does not control. A single flat
            stroke CANNOT read over both dusk land (#14201B) and dusk water (#5FA7B8): measured, the tan
            that scores 4.97 on land scores 1.24 on the lake, and the value that beats the lake is the
            one that vanished into the roads. Two stacked lines solve what one colour cannot — the
            standard cartographic casing, and the same idiom this file already uses for the active
            marker's `borderColor: colors.surface`.
            ⚠ THE CASING OUTLIVED THE DASHES AND ITS REASON IS UNCHANGED. It was originally argued as
            "solid under a DASHED top line reads as a track" — the top line went solid on 2026-08-05,
            and the casing is if anything MORE load-bearing now: contrast against an uncontrolled
            basemap is a colour problem, not a dash problem, and a single tan stroke still cannot beat
            both land and lake. What it is no longer doing is keeping a dashed-trail language alive;
            that language lives on `RouteTrack`, on surfaces we render ourselves.
            STATIC ONLY: the live drive grows a traveled pine line over this one and carries a puck, so
            it has its own separation and its untraveled backdrop is meant to recede. */}
        {dispLatlngs.length > 1 && hidePuck ? (
          <Polyline coordinates={dispLatlngs} strokeColor={colors.surface} strokeWidth={STATIC_ROUTE_W + 4} />
        ) : null}
        {dispLatlngs.length > 1 ? (
          <Polyline
            coordinates={dispLatlngs}
            // ⚠ `routeTrail` on a basemap, NOT `trackInactive` — that one is the trail on our own
            // surfaces, and on the MAP it is the byte-identical twin of the minor roads underneath
            // (contrast 1.00, both themes). See the role's note in theme.ts.
            // ⚠ BOTH modes now, not just the static one. The live drive kept `trackInactive` for a
            // day on the theory that its untraveled line is a BACKDROP and may recede — but "recedes"
            // is a matter of WEIGHT, and this was a matter of IDENTITY: drawn in the roads' exact
            // colour, the road ahead was not quiet, it was absent. It still recedes, and by the means
            // it should: a thinner stroke than the static overview's.
            // ⚠ NO `lineDashPattern` ANY MORE — see the block above. The live drive's untraveled line
            // was `[2, 10]` and is solid now too: it still RECEDES, and by the means the comment above
            // always said it should — a thinner stroke and a quieter colour than the traveled pine —
            // rather than by a dash that only survived at one zoom.
            strokeColor={colors.routeTrail}
            strokeWidth={hidePuck ? STATIC_ROUTE_W : 4}
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
                {/* ⚠ DUSK ONLY (2026-08-03). This halo is a translucent DISC, not a shadow, and in
                    daylight it measured 1.30 against the land — it rendered nothing while still
                    costing a view. Day gets a real drop shadow on the dot instead (below), which is
                    both what §4 calls "daylight elevation" and what every map draws under a marker.
                    A grey disc would NOT have been the daylight equivalent: a shadow needs an
                    offset to read as lift, and a centred ink disc just muddies the dot. */}
                {active && !hidePuck && isDark ? (
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
                    ringOuter,
                    dayLift,
                    active
                      ? {
                          width: 22,
                          height: 22,
                          borderRadius: 11,
                          backgroundColor: amber,
                          borderColor: ringInner,
                          borderWidth: border.keyline,
                        }
                      : endpoint
                        ? {
                            width: ENDPOINT_DOT,
                            height: ENDPOINT_DOT,
                            borderRadius: ENDPOINT_DOT / 2,
                            backgroundColor: colors.trackActive,
                            borderColor: ringInner,
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
                              borderColor: ringInner,
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
              {/* Dusk only — see the stop halo above. In daylight this disc composited to 1.15
                  against the land (its `opacity: 0.55` on top of a 30% amber), i.e. it was not a
                  faint halo, it was nothing. The puck's own `dayLift` shadow does the job there. */}
              {isDark ? <View style={[puckStyles.halo, { backgroundColor: colors.glow }]} /> : null}
              <View style={[styles.puckWedge, { transform: [{ rotate: `${heading}deg` }] }]}>
                <View style={[styles.wedgeTriangle, { borderBottomColor: amber }]} />
              </View>
              <View
                style={[
                  puckStyles.dot,
                  ringOuter,
                  dayLift,
                  { backgroundColor: amber, borderColor: ringInner },
                ]}
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
