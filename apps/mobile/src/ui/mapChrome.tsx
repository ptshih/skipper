// Shared chrome for the two react-native-maps surfaces (DriveMap, RoamMap).
//
// Both files carried byte-identical copies of these. The axis converter is the one that actually
// wanted a single home: the wire format is GeoJSON `[lng, lat]` and react-native-maps wants
// `{latitude, longitude}`, and getting it backwards draws in the Indian Ocean and throws NOTHING.
// A silent failure is much easier to keep correct in one place than two — and only one of the two
// copies carried that warning, so the other was the version a reader could "tidy" without knowing.
//
// NOT shared: the puck marker (DriveMap draws a heading wedge RoamMap has no use for) and the base
// <MapView> prop block. Those still differ or would need prop plumbing that costs more than the copy.

import { Platform, Pressable, StyleSheet } from 'react-native'
import { PROVIDER_GOOGLE, type LatLng } from 'react-native-maps'
import { border, radius, space } from '../theme/tokens'
import { mapStyle } from '../theme/mapStyle'
import { useTheme } from '../theme'
import { Icon } from './Icon'
import { Text } from './Text'

/** GeoJSON-order `[lng, lat]` → react-native-maps `{latitude, longitude}`.
 *  ⚠ Getting this backwards draws in the Indian Ocean and throws nothing. */
export const toLatLng = ([lng, lat]: readonly [number, number]): LatLng => ({
  latitude: lat,
  longitude: lng,
})

// Google styling only applies to the Google provider. On Android react-native-maps is always Google;
// on iOS we need a key (else Apple Maps, untinted). No key → undefined provider (the native default)
// so it never crashes claiming a missing SDK.
const HAS_GOOGLE_KEY = !!process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY
export const MAP_PROVIDER = Platform.OS === 'android' || HAS_GOOGLE_KEY ? PROVIDER_GOOGLE : undefined

/** The shared <MapView> props — everything both maps set identically.
 *
 *  ⚠ These were copy-pasted verbatim between the two, down to the `(audit #463)` comment on the
 *  Apple-Maps fallback. That comment is the reason `userInterfaceStyle` and `mapType` are here at all:
 *  `customMapStyle` is Google-only, so without them a keyless build gets a bright untinted basemap
 *  instead of the night one. Spread this, then add what is genuinely per-map — `ref`, `style`,
 *  `initialRegion`, `onPanDrag`, and RoamMap's viewport-change hook. */
export function baseMapProps(isDark: boolean) {
  return {
    provider: MAP_PROVIDER,
    customMapStyle: mapStyle(isDark),
    userInterfaceStyle: (isDark ? 'dark' : 'light') as 'dark' | 'light',
    mapType: (MAP_PROVIDER === undefined ? 'mutedStandard' : 'standard') as 'mutedStandard' | 'standard',
    showsUserLocation: false, // both maps draw their OWN brand puck — never the raw blue dot
    showsCompass: false,
    showsPointsOfInterests: false,
    showsMyLocationButton: false,
    toolbarEnabled: false,
    rotateEnabled: false,
    pitchEnabled: false,
  } as const
}

/** Live-position puck geometry, shared so the two maps read as the same object on screen.
 *  (DriveMap adds a heading wedge around it; RoamMap has no travel direction to point.) */
export const PUCK = 18
export const puckStyles = StyleSheet.create({
  halo: { position: 'absolute', width: 34, height: 34, borderRadius: 17, opacity: 0.55 },
  dot: { width: PUCK, height: PUCK, borderRadius: PUCK / 2, borderWidth: border.keyline },
})

const chipStyles = StyleSheet.create({
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

/** The floating "Recenter" chip — the standard nav pattern both maps show once the rider pans away.
 *  Its styles were byte-identical in both files; only the accessibility label ever differed, so that
 *  is the prop. The cast shadow is set inline because it needs the theme's `shadowCast` colour. */
export function RecenterChip({
  onPress,
  label,
  bottom,
}: {
  onPress: () => void
  label: string
  /** Lift it above a floating sheet (px from the bottom). */
  bottom?: number
}) {
  const { colors } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        chipStyles.recenter,
        bottom != null ? { bottom } : null,
        {
          backgroundColor: colors.surfaceRaised,
          borderColor: colors.rule,
          // Cross-platform cast (DESIGN §4) so it lifts off the map on Android too. (M4)
          boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 8, color: colors.shadowCast }],
        },
      ]}
    >
      <Icon name="locate" size={18} color="accent" />
      <Text variant="label" color="ink">
        Recenter
      </Text>
    </Pressable>
  )
}
