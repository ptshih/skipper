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

import { Platform } from 'react-native'
import { PROVIDER_GOOGLE, type LatLng } from 'react-native-maps'

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
