import { useEffect, useRef } from 'react'
import { loadMaps, MAPS_KEY } from '@/lib/maps'

export interface RouteAnchor {
  name: string
  lat: number
  lng: number
}
export interface RouteStopPin {
  seq: number
  name: string
  stopType: 'story' | 'scenic' | 'break'
  lat: number
  lng: number
  radiusM?: number | null
}

// Stop-pin colors by type (match the legend in TourDetailView).
export const STOP_TYPE_COLOR: Record<RouteStopPin['stopType'], string> = {
  story: '#f59e0b', // amber
  scenic: '#22d3ee', // cyan
  break: '#a78bfa', // violet
}

type Overlay = google.maps.Marker | google.maps.Polyline | google.maps.Circle

// Read-only route review: the frozen polyline + a numbered pin at every stop's TRIGGER point
// (where the clip fires on the road, not the raw POI) with its trigger radius, plus start/end
// anchors. Numbers cross-reference the itinerary list below. polyline is [lng, lat] (drive-core
// convention); Google wants {lat, lng}.
export function RouteMap({
  polyline,
  start,
  end,
  stops,
}: {
  polyline: [number, number][]
  start: RouteAnchor
  end: RouteAnchor
  stops: RouteStopPin[]
}) {
  const ref = useRef<HTMLDivElement>(null)
  const gRef = useRef<typeof google | null>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const overlaysRef = useRef<Overlay[]>([])

  useEffect(() => {
    if (!MAPS_KEY || !ref.current) return
    let cancelled = false
    void loadMaps(MAPS_KEY).then((g) => {
      if (cancelled || !ref.current) return
      gRef.current = g
      mapRef.current = new g.maps.Map(ref.current, {
        mapTypeId: 'terrain',
        disableDefaultUI: true,
        zoomControl: true,
      })
      draw()
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    draw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polyline, stops, start, end])

  function draw() {
    const g = gRef.current
    const map = mapRef.current
    if (!g || !map) return
    overlaysRef.current.forEach((o) => o.setMap(null))
    overlaysRef.current = []
    const bounds = new g.maps.LatLngBounds()

    const path = polyline.map(([lng, lat]) => ({ lat, lng }))
    path.forEach((p) => bounds.extend(p))
    if (path.length >= 2) {
      overlaysRef.current.push(
        new g.maps.Polyline({ path, map, strokeColor: '#64748b', strokeWeight: 4, strokeOpacity: 0.9 }),
      )
    }

    const anchor = (a: RouteAnchor, color: string, label: string) => {
      const pos = { lat: a.lat, lng: a.lng }
      bounds.extend(pos)
      overlaysRef.current.push(
        new g.maps.Marker({
          position: pos,
          map,
          title: `${label}: ${a.name}`,
          zIndex: 1000,
          icon: { path: g.maps.SymbolPath.CIRCLE, scale: 8, fillColor: color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
        }),
      )
    }
    anchor(start, '#10b981', 'Start')
    anchor(end, '#ef4444', 'End')

    stops.forEach((s) => {
      const pos = { lat: s.lat, lng: s.lng }
      bounds.extend(pos)
      const color = STOP_TYPE_COLOR[s.stopType] ?? '#64748b'
      if (s.radiusM) {
        overlaysRef.current.push(
          new g.maps.Circle({
            center: pos,
            radius: s.radiusM,
            map,
            strokeColor: color,
            strokeOpacity: 0.6,
            strokeWeight: 1,
            fillColor: color,
            fillOpacity: 0.12,
          }),
        )
      }
      overlaysRef.current.push(
        new g.maps.Marker({
          position: pos,
          map,
          title: `#${s.seq} ${s.name} (${s.stopType})`,
          label: { text: String(s.seq), color: '#fff', fontSize: '11px', fontWeight: '600' },
          icon: { path: g.maps.SymbolPath.CIRCLE, scale: 11, fillColor: color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
        }),
      )
    })

    if (!bounds.isEmpty()) map.fitBounds(bounds, 48)
  }

  if (!MAPS_KEY) {
    return (
      <div className="flex h-[420px] items-center justify-center rounded-xl border p-4 text-center text-sm text-muted-foreground">
        Set <span className="mx-1 font-mono">VITE_GOOGLE_MAPS_BROWSER_KEY</span> to enable the map.
      </div>
    )
  }
  return <div ref={ref} className="h-[420px] w-full overflow-hidden rounded-xl border" />
}
