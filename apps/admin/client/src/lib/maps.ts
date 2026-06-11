// Shared Google Maps JS loader. ONE Loader instance per page (the library rejects a second
// Loader constructed with different options) — both the editable WaypointMap (Create Tour)
// and the read-only RouteMap (tour detail) load through here. The browser key is referrer-
// restricted (Maps JavaScript API), distinct from the server-side Routes/Geocoding key.
import { Loader } from '@googlemaps/js-api-loader'

export const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY as string | undefined

let loaderPromise: Promise<typeof google> | null = null
export function loadMaps(key: string): Promise<typeof google> {
  loaderPromise ??= new Loader({ apiKey: key, version: 'weekly' }).load()
  return loaderPromise
}
