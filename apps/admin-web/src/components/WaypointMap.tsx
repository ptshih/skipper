import { useEffect, useRef } from 'react'
import { Loader } from '@googlemaps/js-api-loader'

export interface MapWaypoint {
  label: string
  lat: number | null
  lng: number | null
}

let loaderPromise: Promise<typeof google> | null = null
function loadMaps(key: string): Promise<typeof google> {
  loaderPromise ??= new Loader({ apiKey: key, version: 'weekly' }).load()
  return loaderPromise
}

// Draggable waypoint markers + the connecting line, on a Google terrain basemap. Dragging a
// pin calls onMove(index, lat, lng) so the parent owns the (approved) coordinates — the map is
// the review surface for the LLM's proposal, the human curates here before freezing.
export function WaypointMap({
  waypoints,
  onMove,
}: {
  waypoints: MapWaypoint[]
  onMove: (i: number, lat: number, lng: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const gRef = useRef<typeof google | null>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const markersRef = useRef<google.maps.Marker[]>([])
  const lineRef = useRef<google.maps.Polyline | null>(null)
  const onMoveRef = useRef(onMove)
  onMoveRef.current = onMove
  const key = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY as string | undefined

  useEffect(() => {
    if (!key || !ref.current) return
    let cancelled = false
    void loadMaps(key).then((g) => {
      if (cancelled || !ref.current) return
      gRef.current = g
      mapRef.current = new g.maps.Map(ref.current, {
        center: { lat: 39.09, lng: -120.03 },
        zoom: 9,
        mapTypeId: 'terrain',
        disableDefaultUI: true,
        zoomControl: true,
      })
      sync()
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    sync()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waypoints])

  function sync() {
    const g = gRef.current
    const map = mapRef.current
    if (!g || !map) return
    markersRef.current.forEach((m) => m.setMap(null))
    markersRef.current = []
    const path: google.maps.LatLngLiteral[] = []
    const bounds = new g.maps.LatLngBounds()
    waypoints.forEach((w, i) => {
      if (w.lat == null || w.lng == null) return
      const pos = { lat: w.lat, lng: w.lng }
      path.push(pos)
      bounds.extend(pos)
      const marker = new g.maps.Marker({ position: pos, map, label: String(i + 1), draggable: true, title: w.label })
      marker.addListener('dragend', (e: google.maps.MapMouseEvent) => {
        if (e.latLng) onMoveRef.current(i, e.latLng.lat(), e.latLng.lng())
      })
      markersRef.current.push(marker)
    })
    if (lineRef.current) lineRef.current.setMap(null)
    lineRef.current = new g.maps.Polyline({ path, map, strokeColor: '#22d3ee', strokeWeight: 3, strokeOpacity: 0.9 })
    if (!bounds.isEmpty()) map.fitBounds(bounds, 48)
  }

  if (!key) {
    return (
      <div className="flex h-[420px] items-center justify-center rounded-lg border p-4 text-center text-sm text-muted-foreground">
        Set <span className="mx-1 font-mono">VITE_GOOGLE_MAPS_BROWSER_KEY</span> to enable the map.
      </div>
    )
  }
  return <div ref={ref} className="h-[420px] w-full overflow-hidden rounded-lg border" />
}
