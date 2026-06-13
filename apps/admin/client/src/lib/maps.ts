// Shared Google Maps JS loader. ONE load per page; both the editable WaypointMap (Create Tour)
// and the read-only RouteMap (tour detail) load through here. The browser key is referrer-
// restricted (Maps JavaScript API), distinct from the server-side Routes/Geocoding key.
//
// @googlemaps/js-api-loader v2 deprecated the `Loader` class in favour of a functional API:
// setOptions() once, then importLibrary() per library. importLibrary loads the library AND
// populates the global `google.maps.*` namespace as a side effect, so callers keep using
// `g.maps.Map`, `g.maps.Marker`, etc. unchanged. We import 'maps' (Map / Polyline / Circle /
// LatLngBounds / SymbolPath) and 'marker' (the classic Marker both maps still use).
import { setOptions, importLibrary } from '@googlemaps/js-api-loader'

export const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY as string | undefined

let loaderPromise: Promise<typeof google> | undefined
export function loadMaps(key: string): Promise<typeof google> {
  loaderPromise ??= (async () => {
    setOptions({ key, v: 'weekly' })
    await Promise.all([importLibrary('maps'), importLibrary('marker')])
    return google
  })()
  return loaderPromise
}
