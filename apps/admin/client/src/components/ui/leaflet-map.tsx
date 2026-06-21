// Leaflet (OSM, no API key) maps for the admin — the only file that imports react-leaflet/leaflet,
// so the heavy bundle splits into the `maps` chunk and the gotchas live in one place:
//  - leaflet's default marker PNGs break under Vite → we use inline-SVG `divIcon`s (no asset URLs).
//  - a map mounted inside a Dialog/Sheet computes tile positions before layout settles → invalidateSize.
//  - bbox string is the load-bearing contract: "lng_min,lat_min,lng_max,lat_max" (swLng,swLat,neLng,neLat).
// Leaflet's CSS is imported once in main.tsx (`leaflet/dist/leaflet.css`).

import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { MapContainer, Marker, Rectangle, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'

// Tahoe basin center — a sane default so a blank "create region" map isn't staring at open ocean.
const DEFAULT_CENTER: [number, number] = [39.0968, -120.0324]
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'

// Inline-SVG divIcons (no PNG → no Vite asset-URL gotcha). Colors are hardcoded here because leaflet
// markers render outside the Tailwind/token system; teal pin = the fixed POI, amber ring = drag-me anchor.
const POI_ICON = L.divIcon({
  className: '',
  html: '<svg width="24" height="24" viewBox="0 0 24 24" fill="#0f766e" stroke="white" stroke-width="1.5"><path d="M12 22s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="11" r="2.4" fill="white"/></svg>',
  iconSize: [24, 24],
  iconAnchor: [12, 22],
})
const ANCHOR_ICON = L.divIcon({
  className: '',
  html: '<svg width="22" height="22" viewBox="0 0 24 24" fill="#d97706" stroke="white" stroke-width="2"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.6" fill="white"/></svg>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
})

// Curated-place pins (the /places map). Color codes the role at a glance: amber = featured (the
// popular subset floated to the top of the picker), teal = an endpoint hub, slate = a break-only
// pitstop. Hardcoded colors (leaflet renders outside the token system), echoing POI_ICON's teal.
const pinSvg = (fill: string): string =>
  `<svg width="22" height="22" viewBox="0 0 24 24" fill="${fill}" stroke="white" stroke-width="1.5"><path d="M12 22s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="11" r="2.4" fill="white"/></svg>`
// Role pin colors, EXPORTED so the /places legend keys the EXACT pin hex (no by-eye palette drift).
export const PLACE_PIN_COLORS = { featured: '#d97706', endpoint: '#0f766e', break: '#64748b' } as const
const FEATURED_PIN = L.divIcon({ className: '', html: pinSvg(PLACE_PIN_COLORS.featured), iconSize: [22, 22], iconAnchor: [11, 22] })
const ENDPOINT_PIN = L.divIcon({ className: '', html: pinSvg(PLACE_PIN_COLORS.endpoint), iconSize: [22, 22], iconAnchor: [11, 22] })
const BREAK_PIN = L.divIcon({ className: '', html: pinSvg(PLACE_PIN_COLORS.break), iconSize: [22, 22], iconAnchor: [11, 22] })

interface PlacePin {
  lat: number
  lng: number
  name: string
  featured: boolean
  endpointEligible: boolean
}
function placePinIcon(p: PlacePin): L.DivIcon {
  if (p.featured) return FEATURED_PIN
  return p.endpointEligible ? ENDPOINT_PIN : BREAK_PIN
}

/** Parse "lng_min,lat_min,lng_max,lat_max" → leaflet bounds [[swLat,swLng],[neLat,neLng]], or null. */
function bboxToBounds(bbox: string): L.LatLngBoundsLiteral | null {
  const p = bbox.split(',').map(Number)
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n))) return null
  const [swLng, swLat, neLng, neLat] = p as [number, number, number, number]
  return [
    [swLat, swLng],
    [neLat, neLng],
  ]
}

/** Leaflet miscomputes tile positions when mounted in a dialog before layout settles — fix once. */
function InvalidateOnMount() {
  const map = useMap()
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 80)
    return () => clearTimeout(t)
  }, [map])
  return null
}

/** Re-fit the view to the current bbox whenever it changes (so editing a saved region shows its box). */
function FitBounds({ bbox }: { bbox: string }) {
  const map = useMap()
  useEffect(() => {
    const b = bboxToBounds(bbox)
    if (b) map.fitBounds(b, { padding: [20, 20] })
  }, [map, bbox])
  return null
}

/** Press-drag-release rectangle. Only active while `active` (else the map pans normally); disables
 *  map dragging while active so a drag draws instead. Emits the canonical bbox string on release. */
function DrawRectangle({ active, onBbox, onDone }: { active: boolean; onBbox: (bbox: string) => void; onDone: () => void }) {
  const [start, setStart] = useState<L.LatLng | null>(null)
  const [current, setCurrent] = useState<L.LatLng | null>(null)
  const map = useMapEvents({
    mousedown(e) {
      if (!active) return
      setStart(e.latlng)
      setCurrent(e.latlng)
    },
    mousemove(e) {
      if (active && start) setCurrent(e.latlng)
    },
    mouseup(e) {
      if (!active || !start) return
      const end = e.latlng
      const swLng = Math.min(start.lng, end.lng)
      const neLng = Math.max(start.lng, end.lng)
      const swLat = Math.min(start.lat, end.lat)
      const neLat = Math.max(start.lat, end.lat)
      setStart(null)
      setCurrent(null)
      onDone()
      if (neLng - swLng < 1e-5 || neLat - swLat < 1e-5) return // a click, not a drag — ignore
      onBbox(`${swLng.toFixed(6)},${swLat.toFixed(6)},${neLng.toFixed(6)},${neLat.toFixed(6)}`)
    },
  })
  useEffect(() => {
    if (active) map.dragging.disable()
    else map.dragging.enable()
    return () => {
      map.dragging.enable()
    }
  }, [active, map])
  return active && start && current ? (
    <Rectangle bounds={[[start.lat, start.lng], [current.lat, current.lng]]} pathOptions={{ color: '#16a34a', weight: 2 }} />
  ) : null
}

/** A draw-a-rectangle bbox picker. Shows the current bbox, and a "Draw bbox" toggle: while on, drag a
 *  box (the map won't pan); on release it fills the field and exits draw mode. Normal drag = pan. */
export function BboxMap({ bbox, onBbox, className }: { bbox: string; onBbox: (bbox: string) => void; className?: string }) {
  const [drawing, setDrawing] = useState(false)
  const bounds = bboxToBounds(bbox)
  const center: [number, number] = bounds
    ? [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2]
    : DEFAULT_CENTER
  return (
    <div className={`relative w-full overflow-hidden rounded-lg border ${className ?? 'h-72'}`}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setDrawing((d) => !d)
        }}
        className="absolute right-2 top-2 z-[1000] rounded-md border bg-background/90 px-2 py-1 text-xs font-medium shadow-sm hover:bg-background"
      >
        {drawing ? 'Drawing… drag a box' : '✏ Draw bbox'}
      </button>
      <MapContainer center={center} zoom={bounds ? 9 : 8} scrollWheelZoom={false} style={{ height: '100%', width: '100%' }}>
        <TileLayer attribution={OSM_ATTRIBUTION} url={OSM_URL} />
        <InvalidateOnMount />
        <FitBounds bbox={bbox} />
        {bounds && !drawing && <Rectangle bounds={bounds} pathOptions={{ color: '#16a34a', weight: 2, dashArray: '4' }} />}
        <DrawRectangle active={drawing} onBbox={onBbox} onDone={() => setDrawing(false)} />
      </MapContainer>
    </div>
  )
}

/** A read-only multi-pin map of a region's CURATED places, fit to the region bbox. Pins are
 *  color-coded by role (amber=featured, teal=endpoint, slate=break) with a hover tooltip of the name —
 *  so the curator can eyeball whether hubs are spread sensibly or clustered. Empty `places` just shows
 *  the bboxed region. */
export function PlacesMap({
  places,
  bbox,
  className,
}: {
  places: PlacePin[]
  bbox: string | null
  className?: string
}) {
  const bounds = bbox ? bboxToBounds(bbox) : null
  const center: [number, number] = bounds
    ? [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2]
    : DEFAULT_CENTER
  return (
    <div className={`relative w-full overflow-hidden rounded-lg border ${className ?? 'h-72'}`}>
      <MapContainer center={center} zoom={bounds ? 9 : 8} scrollWheelZoom={false} style={{ height: '100%', width: '100%' }}>
        <TileLayer attribution={OSM_ATTRIBUTION} url={OSM_URL} />
        <InvalidateOnMount />
        {bbox && <FitBounds bbox={bbox} />}
        {bounds && <Rectangle bounds={bounds} pathOptions={{ color: '#16a34a', weight: 1, dashArray: '4', fillOpacity: 0 }} />}
        {places.map((p, i) => (
          <Marker key={`${p.lat},${p.lng},${i}`} position={[p.lat, p.lng]} icon={placePinIcon(p)}>
            <Tooltip>{p.name}</Tooltip>
          </Marker>
        ))}
      </MapContainer>
    </div>
  )
}

/** POI pin (fixed) + a draggable speakable anchor. Dragging the anchor calls onAnchor with its coords;
 *  if no anchor yet, the draggable marker starts on the pin so dragging it off creates one. */
export function AnchorMap({
  poi,
  anchor,
  onAnchor,
}: {
  poi: { lat: number; lng: number }
  anchor: { lat: number; lng: number } | null
  onAnchor: (a: { lat: number; lng: number }) => void
}) {
  const markerRef = useRef<L.Marker>(null)
  const pos: [number, number] = anchor ? [anchor.lat, anchor.lng] : [poi.lat, poi.lng]
  return (
    <div className="h-64 w-full overflow-hidden rounded-lg border">
      <MapContainer center={[poi.lat, poi.lng]} zoom={15} scrollWheelZoom={false} style={{ height: '100%', width: '100%' }}>
        <TileLayer attribution={OSM_ATTRIBUTION} url={OSM_URL} />
        <InvalidateOnMount />
        <Marker position={[poi.lat, poi.lng]} icon={POI_ICON} />
        <Marker
          position={pos}
          icon={ANCHOR_ICON}
          draggable
          ref={markerRef}
          eventHandlers={{
            dragend() {
              const ll = markerRef.current?.getLatLng()
              if (ll) onAnchor({ lat: ll.lat, lng: ll.lng })
            },
          }}
        />
      </MapContainer>
    </div>
  )
}
