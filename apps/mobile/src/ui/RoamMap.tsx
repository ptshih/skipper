// The ROAM map — a glanceable companion view for free-roam (founder 2026-06-11). Unlike
// DriveMap (a route with a puck riding it at `progress`), roam has NO rails: this draws a
// FREE position puck at the rider's real GPS and the field of nearby story-pins from the
// manifest, on the same tinted Trailhead-89 basemap. It is NOT the default surface — the
// RoamMotif stays the eyes-on-road idle; the map is an opt-in glance (a stop, a passenger,
// curiosity) and the seed of the logbook "pin-map filling in as you roam" (docs/designs/
// free-roam-mode.md). The heard/unheard fill-in (heardPoiIds) lands with the persistent
// encounter history (pass-2); v1 ships every pin hollow ("a story here, not yet heard").
//
// Same provider/key handling as DriveMap: Google basemap with EXPO_PUBLIC_GOOGLE_MAPS_API_KEY
// (the tint applies), else Apple Maps (untinted) on iOS — never a crash for a missing key.
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import MapView, { Marker, Polygon, type LatLng, type Region } from 'react-native-maps'
import { baseMapProps, puckStyles, RecenterChip, toLatLng } from './mapChrome'
import type { AreaRing } from '@skipper/shared'
import { border, radius, space } from '../theme/tokens'
import { useReducedMotion, useTheme } from '../theme'

/** A roam story-pin = a place near you the skipper knows a story about. */
export interface RoamMapPin {
  poiId: string
  name: string
  lat: number
  lng: number
  /** DISTRICT pins only — the convex hull the telling fires INSIDE of, drawn as a wash instead of
   *  a dot. `lat/lng` is still populated (it is the enclosing-circle centre + the point fallback
   *  an area-unaware client fires on), but for a district it is an arbitrary interior point that
   *  names nothing, so we deliberately do NOT also draw a marker there. */
  area?: AreaRing
}


export interface RoamMapProps {
  /** The rider's live position — null until the first fix lands. */
  position: { lat: number; lng: number } | null
  /** The story-pins in range (the manifest). */
  pins: RoamMapPin[]
  /** Future: pins already heard this session fill in solid (the logbook pin-map). Defaults
   *  to none — v1 has no persistent encounter history yet, so every pin reads unheard. */
  heardPoiIds?: ReadonlySet<string>
  /** A clip is playing → the encounter sheet owns the screen's one amber glow, so dim the
   *  map's amber puck (DESIGN §8 one-amber budget). */
  clipActive?: boolean
  /** Lift the recenter chip above the floating encounter sheet (px from the bottom). */
  recenterBottom?: number
}


// Marker culling (TestFlight 2026-06-25 #3/#4: "roam map is really laggy" / "loading way too many
// POI markers really far away — lazy-load by proximity"). A region's manifest is a few hundred pins
// scattered across the whole basin; drawing one <Marker> each chokes react-native-maps AND clutters
// the view with pins miles away. So we DRAW only the pins inside the visible viewport, capped to the
// nearest N to the viewport center. ⚠ This thins ONLY what the map RENDERS — the full pin set still
// feeds the trigger engine (useRoam's pinsRef); culling here can never miss a narration.
const MAX_MARKERS = 48
/** Render pins a little past the viewport edges so a pan reveals neighbours already placed,
 *  not popping in after onRegionChangeComplete settles. */
const VIEWPORT_MARGIN = 1.25

/** Cull the field to what the map should draw: pins inside the visible region (+ a margin),
 *  capped to MAX_MARKERS nearest the viewport center. Longitude is cos(lat)-scaled so "nearest"
 *  is geographic, not raw-degree (Tahoe ~39°N). Pure + cheap (O(pins)); the full set is unchanged. */
function cullPins(pins: RoamMapPin[], region: Region | undefined): RoamMapPin[] {
  if (pins.length <= MAX_MARKERS) return pins // small field — no point culling
  if (!region) return pins.slice(0, MAX_MARKERS) // pre-first-region: a bounded slice, never the lag
  const latHalf = (region.latitudeDelta / 2) * VIEWPORT_MARGIN
  const lngHalf = (region.longitudeDelta / 2) * VIEWPORT_MARGIN
  const cosLat = Math.cos((region.latitude * Math.PI) / 180)
  const within: { pin: RoamMapPin; d2: number }[] = []
  for (const p of pins) {
    const dLat = p.lat - region.latitude
    const dLng = p.lng - region.longitude
    if (Math.abs(dLat) > latHalf || Math.abs(dLng) > lngHalf) continue
    const dx = dLng * cosLat
    within.push({ pin: p, d2: dLat * dLat + dx * dx })
  }
  if (within.length <= MAX_MARKERS) return within.map((w) => w.pin)
  // Whole basin in view (zoomed out): everything passes the viewport test, so the cap is what
  // saves us — keep the MAX_MARKERS nearest the center the rider is looking at.
  within.sort((a, b) => a.d2 - b.d2)
  within.length = MAX_MARKERS
  return within.map((w) => w.pin)
}

// memo: RoamScreen re-renders on its 2s diagnostics tick; with a movement-guarded `position` + stable
// pins, this skips re-rendering the map subtree when nothing the map shows changed. (audit #603)
function RoamMapBase({ position, pins, heardPoiIds, clipActive, recenterBottom }: RoamMapProps) {
  const { colors, isDark } = useTheme()
  const reducedMotion = useReducedMotion()
  const mapRef = useRef<MapView | null>(null)
  const [following, setFollowing] = useState(true)
  // The currently visible viewport — drives marker culling. Seeded with the framing region so the
  // very first paint is already culled (the whole field passes the viewport test → cap kicks in),
  // then updated by onRegionChangeComplete on every follow-glide, pan, and zoom.
  const [region, setRegion] = useState<Region | undefined>(undefined)

  // First paint frames the whole field of nearby pins (+ the rider) — "here's what's around".
  const initialRegion = useMemo<Region | undefined>(() => {
    const pts: { lat: number; lng: number }[] = pins.map((p) => ({ lat: p.lat, lng: p.lng }))
    if (position) pts.push(position)
    if (pts.length === 0) return undefined
    let minLat = Infinity
    let maxLat = -Infinity
    let minLng = Infinity
    let maxLng = -Infinity
    for (const p of pts) {
      if (p.lat < minLat) minLat = p.lat
      if (p.lat > maxLat) maxLat = p.lat
      if (p.lng < minLng) minLng = p.lng
      if (p.lng > maxLng) maxLng = p.lng
    }
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max(0.04, (maxLat - minLat) * 1.4),
      longitudeDelta: Math.max(0.04, (maxLng - minLng) * 1.4),
    }
    // Frame ONCE off the initial inputs; later position ticks glide the camera, not re-frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Glide the camera onto the rider while in follow mode (position updates ~2s).
  useEffect(() => {
    if (!following || !position) return
    mapRef.current?.animateCamera(
      { center: { latitude: position.lat, longitude: position.lng } },
      { duration: reducedMotion ? 0 : 600 },
    )
  }, [position, following, reducedMotion])

  const recenter = () => {
    setFollowing(true)
    if (position) {
      mapRef.current?.animateCamera(
        { center: { latitude: position.lat, longitude: position.lng }, zoom: 13 },
        { duration: reducedMotion ? 0 : 400 },
      )
    }
  }

  // Districts are drawn as HULLS, never as dots, so they are split out of the marker path entirely.
  // ⚠ They are deliberately NOT culled: cullPins keys on a pin's single point, and a district whose
  // centre sits outside the viewport can still have half its boundary in view — routing rings through
  // the culler would make them flicker in and out on pan. There are a handful of them corpus-wide
  // (3 today) against a few hundred dots, so they cost nothing to draw unconditionally.
  const areaPins = useMemo(() => pins.filter((p) => p.area), [pins])
  const dotPins = useMemo(() => pins.filter((p) => !p.area), [pins])
  // Only the pins the map should actually DRAW — viewport-clipped + proximity-capped (see cullPins).
  // Falls back to the framing region until the first onRegionChangeComplete lands.
  const drawnPins = useMemo(
    () => cullPins(dotPins, region ?? initialRegion),
    [dotPins, region, initialRegion],
  )

  const pinColor = clipActive ? colors.trackInactive : colors.trackActive // pine; dimmed under the sheet

  return (
    <View style={styles.fill}>
      <MapView
        ref={mapRef}
        {...baseMapProps(isDark)}
        style={styles.fill}
        initialRegion={initialRegion}
        onPanDrag={() => following && setFollowing(false)}
        // The visible viewport changed (follow-glide / pan / zoom) → re-cull the drawn markers.
        onRegionChangeComplete={setRegion}
      >
        {/* District hulls — a place you are INSIDE, so it gets an extent rather than a dot.
            ⚠ Drawn FIRST on purpose: draw order is mount order, and `zIndex` is Google-Maps-only
            (the keyless iOS build falls back to Apple Maps), so JSX order is the only cross-provider
            way to keep the wash UNDER the story dots and the rider's puck. */}
        {areaPins.map((p) => (
          <Polygon
            key={`area-${p.poiId}`}
            coordinates={p.area!.ring.map(toLatLng)}
            fillColor={colors.areaFill}
            strokeColor={colors.areaStroke}
            strokeWidth={1.5}
          />
        ))}

        {/* Story-pins — hollow ("a story here, not yet heard"); heard ones fill in solid from the
            cross-session encounter history (useRoam.heardPoiIds). Drawn from the culled set (drawnPins),
            not the full field, so react-native-maps never paints hundreds of far-away markers (lag fix). */}
        {drawnPins.map((p) => {
          const heard = heardPoiIds?.has(p.poiId) ?? false
          return (
            <Marker
              // Key on poiId+heard: tracksViewChanges=false snapshots once, so the heard→solid flip
              // (a clip finishing, or reload from cross-session history) must REMOUNT to redraw. (audit #242)
              key={`${p.poiId}-${heard}`}
              coordinate={{ latitude: p.lat, longitude: p.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
              title={p.name}
              tracksViewChanges={false}
            >
              <View style={styles.markerBox}>
                <View
                  style={[
                    styles.storyDot,
                    heard
                      ? { backgroundColor: pinColor }
                      : { backgroundColor: colors.surface, borderColor: pinColor, borderWidth: 2 },
                  ]}
                />
              </View>
            </Marker>
          )
        })}

        {/* The rider — "you are here". A free puck (no route to snap to), amber like the token. */}
        {position ? (
          <Marker
            // Static appearance except the clipActive color flip → snapshot once (tracksViewChanges
            // false) and remount on the flip via the key, instead of re-rasterizing every move. (audit #567)
            key={`puck-${clipActive ? 1 : 0}`}
            coordinate={{ latitude: position.lat, longitude: position.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            flat
            tracksViewChanges={false}
          >
            <View style={styles.markerBox}>
              <View style={[puckStyles.halo, { backgroundColor: colors.glow }]} />
              <View
                style={[
                  puckStyles.dot,
                  { backgroundColor: clipActive ? colors.trackInactive : colors.amberToken, borderColor: colors.surface },
                ]}
              />
            </View>
          </Marker>
        ) : null}
      </MapView>

      {/* Recenter chip — once the rider pans away from the puck. */}
      {!following ? (
        <RecenterChip onPress={recenter} label="Recenter the map on me" bottom={recenterBottom} />
      ) : null}
    </View>
  )
}

export const RoamMap = memo(RoamMapBase)

const styles = StyleSheet.create({
  fill: { flex: 1 },
  markerBox: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  storyDot: { width: 13, height: 13, borderRadius: 7 },
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
  },
})
