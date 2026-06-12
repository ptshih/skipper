// The ROAM map — a glanceable companion view for free-roam (founder 2026-06-11). Unlike
// DriveMap (a route with a puck riding it at `progress`), roam has NO rails: this draws a
// FREE position puck at the rider's real GPS and the field of nearby story-pins from the
// manifest, on the same tinted Trailhead-89 basemap. It is NOT the default surface — the
// RoamMotif stays the eyes-on-road idle; the map is an opt-in glance (a stop, a passenger,
// curiosity) and the seed of the logbook "pin-map filling in as you roam" (docs/ideas/
// free-roam-mode.md). The heard/unheard fill-in (heardPoiIds) lands with the persistent
// encounter history (pass-2); v1 ships every pin hollow ("a story here, not yet heard").
//
// Same provider/key handling as DriveMap: Google basemap with EXPO_PUBLIC_GOOGLE_MAPS_API_KEY
// (the tint applies), else Apple Maps (untinted) on iOS — never a crash for a missing key.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Platform, Pressable, StyleSheet, View } from 'react-native'
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps'
import { border, radius, space } from '../theme/tokens'
import { mapStyle } from '../theme/mapStyle'
import { useReducedMotion, useTheme } from '../theme'
import { Icon } from './Icon'
import { Text } from './Text'

/** A roam story-pin = a place near you the skipper knows a story about. */
export interface RoamMapPin {
  poiId: string
  name: string
  lat: number
  lng: number
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

const HAS_GOOGLE_KEY = !!process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY
const PROVIDER = Platform.OS === 'android' || HAS_GOOGLE_KEY ? PROVIDER_GOOGLE : undefined

export function RoamMap({ position, pins, heardPoiIds, clipActive, recenterBottom }: RoamMapProps) {
  const { colors, isDark } = useTheme()
  const reducedMotion = useReducedMotion()
  const mapRef = useRef<MapView | null>(null)
  const [following, setFollowing] = useState(true)

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

  const pinColor = clipActive ? colors.trackInactive : colors.trackActive // pine; dimmed under the sheet

  return (
    <View style={styles.fill}>
      <MapView
        ref={mapRef}
        provider={PROVIDER}
        style={styles.fill}
        customMapStyle={mapStyle(isDark)}
        initialRegion={initialRegion}
        showsUserLocation={false} // we draw our OWN puck, brand-styled
        showsCompass={false}
        showsPointsOfInterests={false}
        showsMyLocationButton={false}
        toolbarEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        onPanDrag={() => following && setFollowing(false)}
      >
        {/* Story-pins — hollow ("a story here, not yet heard"); heard ones fill in solid once
            encounter history lands (pass-2). */}
        {pins.map((p) => {
          const heard = heardPoiIds?.has(p.poiId) ?? false
          return (
            <Marker
              key={p.poiId}
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
            coordinate={{ latitude: position.lat, longitude: position.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            flat
          >
            <View style={styles.markerBox}>
              <View style={[styles.puckHalo, { backgroundColor: colors.glow }]} />
              <View
                style={[
                  styles.puckDot,
                  { backgroundColor: clipActive ? colors.trackInactive : colors.amberToken, borderColor: colors.surface },
                ]}
              />
            </View>
          </Marker>
        ) : null}
      </MapView>

      {/* Recenter chip — once the rider pans away from the puck. */}
      {!following ? (
        <Pressable
          onPress={recenter}
          accessibilityRole="button"
          accessibilityLabel="Recenter the map on me"
          style={[
            styles.recenter,
            recenterBottom != null ? { bottom: recenterBottom } : null,
            { backgroundColor: colors.surfaceRaised, borderColor: colors.rule, shadowColor: colors.shadowCast },
          ]}
        >
          <Icon name="locate" size={18} color="accent" />
          <Text variant="label" color="ink">
            Recenter
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const PUCK = 18
const styles = StyleSheet.create({
  fill: { flex: 1 },
  markerBox: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  storyDot: { width: 13, height: 13, borderRadius: 7 },
  puckHalo: { position: 'absolute', width: 34, height: 34, borderRadius: 17, opacity: 0.55 },
  puckDot: { width: PUCK, height: PUCK, borderRadius: PUCK / 2, borderWidth: border.keyline },
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
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
})
