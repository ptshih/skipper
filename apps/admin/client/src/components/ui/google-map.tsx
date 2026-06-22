// Google Maps (hybrid satellite) for the admin — the ONLY file that imports @vis.gl/react-google-maps,
// so the heavy Maps JS API + its gotchas live in one place and split into the `maps` chunk. All three
// maps default to HYBRID (satellite + labels) so a curator can verify a pin sits on the real-world spot
// (lakeside road, an actual trailhead), not just an abstract basemap; the maptype control flips back to
// roadmap. The browser key (VITE_GOOGLE_MAPS_BROWSER_KEY) is a PUBLIC, referrer-restricted key baked at
// build (dev: client/.env.development.local; prod: cloudbuild.admin.yaml --build-arg → Dockerfile ARG).
//
//  - bbox string is the load-bearing contract: "lng_min,lat_min,lng_max,lat_max" (swLng,swLat,neLng,neLat).
//  - Markers are <AdvancedMarker> (the modern, non-deprecated marker) with the inline-SVG pins as custom
//    content. AdvancedMarker REQUIRES a cloud Map ID on the <Map> — VITE_GOOGLE_MAPS_MAP_ID, falling back
//    to Google's DEMO_MAP_ID (works everywhere but stamps a "for development" watermark, so set a real
//    Map ID — GCP console → Map Management → Create Map ID, raster — before prod leans on this).
//  - The committed bbox outline AND the press-drag draw-rectangle are drawn IMPERATIVELY via
//    google.maps.Rectangle (useMap), so they never depend on the React <Rectangle> wrapper being exported.
//    (google.maps.Rectangle has no native dashed stroke, so the box is a solid green outline.)

import { useEffect, useRef, useState } from 'react'
import {
  APIProvider,
  Map,
  AdvancedMarker,
  AdvancedMarkerAnchorPoint,
  InfoWindow,
  useAdvancedMarkerRef,
  useMap,
} from '@vis.gl/react-google-maps'

const BROWSER_KEY = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY
// AdvancedMarker needs a cloud Map ID; DEMO_MAP_ID is Google's always-available dev id (watermarked).
const MAP_ID = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID'

// Tahoe basin center — a sane default so a blank "create region" map isn't staring at open ocean.
const DEFAULT_CENTER: google.maps.LatLngLiteral = { lat: 39.0968, lng: -120.0324 }

// Shared Map config — ONE source so every admin map renders identically: hybrid default, a maptype
// toggle to drop back to roadmap, no street-view/fullscreen clutter, and POI labels aren't click-through.
const MAP_OPTIONS = {
  mapId: MAP_ID,
  mapTypeId: 'hybrid',
  gestureHandling: 'greedy',
  disableDefaultUI: false,
  zoomControl: true,
  mapTypeControl: true,
  streetViewControl: false,
  fullscreenControl: false,
  clickableIcons: false,
} as const

// Region bbox is always drawn green — one hex, one rectangle style, so the region drawer (BboxMap) and
// the /places map render the box identically. (Markers render outside the Tailwind/token system.)
const BBOX_GREEN = '#16a34a'

// Inline-SVG marker art (→ data URI, rendered as AdvancedMarker content). Colors are hardcoded here
// because markers render outside the token system. A teardrop map pin (crisp white border + inner dot)
// for POIs/places, and a distinct amber "grab" knob for the draggable speakable anchor. The pin path's
// tip sits at the bottom-center of its 24×30 viewBox, so BOTTOM_CENTER lands the tip on the coord; the
// knob is CENTER-anchored. A soft drop shadow (MARKER_SHADOW) lifts both off busy satellite imagery.
const pinSvg = (fill: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="25" viewBox="0 0 24 30"><path d="M12 1C5.9 1 1 5.9 1 11c0 7.2 11 19 11 19s11-11.8 11-19C23 5.9 18.1 1 12 1Z" fill="${fill}" stroke="#ffffff" stroke-width="2"/><circle cx="12" cy="11" r="4.4" fill="#ffffff"/></svg>`
const POI_SVG = pinSvg('#0f766e')
const ANCHOR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#d97706" stroke="#ffffff" stroke-width="2.5"/><circle cx="12" cy="12" r="3" fill="#ffffff"/></svg>'

const dataUri = (svg: string): string => 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg)
const MARKER_SHADOW = { filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.45))' }

// Role pin colors, EXPORTED so the /places legend keys the EXACT pin hex (no by-eye palette drift).
export const PLACE_PIN_COLORS = { featured: '#d97706', endpoint: '#0f766e', break: '#64748b' } as const

interface PlacePin {
  lat: number
  lng: number
  name: string
  featured: boolean
  endpointEligible: boolean
  breakEligible?: boolean
  /** Humanized place kind for the click popup (e.g. "scenic spot"); null when unknown. */
  kind?: string | null
}

function placePinFill(p: PlacePin): string {
  return p.featured ? PLACE_PIN_COLORS.featured : p.endpointEligible ? PLACE_PIN_COLORS.endpoint : PLACE_PIN_COLORS.break
}

/** Parse "lng_min,lat_min,lng_max,lat_max" → corner numbers, or null. Pure (no google). */
function bboxCorners(bbox: string): { south: number; west: number; north: number; east: number } | null {
  const p = bbox.split(',').map(Number)
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n))) return null
  const [swLng, swLat, neLng, neLat] = p as [number, number, number, number]
  return { south: swLat, west: swLng, north: neLat, east: neLng }
}

/** Center of a bbox, or the Tahoe default. Pure (used for the uncontrolled defaultCenter at first paint). */
function centerOfBbox(bbox: string | null): google.maps.LatLngLiteral {
  const c = bbox ? bboxCorners(bbox) : null
  return c ? { lat: (c.south + c.north) / 2, lng: (c.west + c.east) / 2 } : DEFAULT_CENTER
}

/** A google.maps.LatLngBounds from a bbox string — call only once the API is loaded. */
function boundsFromBbox(bbox: string | null): google.maps.LatLngBounds | null {
  if (!bbox) return null
  const c = bboxCorners(bbox)
  if (!c) return null
  return new google.maps.LatLngBounds({ lat: c.south, lng: c.west }, { lat: c.north, lng: c.east })
}

/** Re-fit the camera to the bbox whenever it changes (so editing a saved region shows its box). */
function FitBounds({ bbox }: { bbox: string | null }) {
  const map = useMap()
  useEffect(() => {
    if (!map) return
    const b = boundsFromBbox(bbox)
    if (b) map.fitBounds(b, 24)
  }, [map, bbox])
  return null
}

/** The committed-bbox outline (solid green; google.maps.Rectangle has no native dash). */
function BboxOutline({ bbox }: { bbox: string | null }) {
  const map = useMap()
  useEffect(() => {
    if (!map) return
    const bounds = boundsFromBbox(bbox)
    if (!bounds) return
    const rect = new google.maps.Rectangle({
      map,
      bounds,
      clickable: false,
      strokeColor: BBOX_GREEN,
      strokeOpacity: 1,
      strokeWeight: 2,
      fillColor: BBOX_GREEN,
      fillOpacity: 0.05,
    })
    return () => rect.setMap(null)
  }, [map, bbox])
  return null
}

/** Press-drag-release rectangle. Active only while `active` (else the map pans normally); disables map
 *  dragging/gestures while active so a drag draws instead. Emits the canonical bbox string on release. */
function DrawController({ active, onBbox, onDone }: { active: boolean; onBbox: (bbox: string) => void; onDone: () => void }) {
  const map = useMap()
  // Refs so the listener effect depends only on [map, active] — a parent re-render that hands new
  // onBbox/onDone identities won't tear down + re-subscribe the listeners mid-drag.
  const onBboxRef = useRef(onBbox)
  const onDoneRef = useRef(onDone)
  onBboxRef.current = onBbox
  onDoneRef.current = onDone

  useEffect(() => {
    if (!map || !active) return
    map.setOptions({ draggable: false, gestureHandling: 'none' })
    let start: google.maps.LatLng | null = null
    let rect: google.maps.Rectangle | null = null
    const boundsBetween = (a: google.maps.LatLng, b: google.maps.LatLng) =>
      new google.maps.LatLngBounds(
        { lat: Math.min(a.lat(), b.lat()), lng: Math.min(a.lng(), b.lng()) },
        { lat: Math.max(a.lat(), b.lat()), lng: Math.max(a.lng(), b.lng()) },
      )
    const down = map.addListener('mousedown', (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return
      start = e.latLng
      rect = new google.maps.Rectangle({
        map,
        bounds: boundsBetween(e.latLng, e.latLng),
        clickable: false,
        strokeColor: BBOX_GREEN,
        strokeWeight: 2,
        fillColor: BBOX_GREEN,
        fillOpacity: 0.1,
      })
    })
    const move = map.addListener('mousemove', (e: google.maps.MapMouseEvent) => {
      if (!start || !rect || !e.latLng) return
      rect.setBounds(boundsBetween(start, e.latLng))
    })
    const up = map.addListener('mouseup', (e: google.maps.MapMouseEvent) => {
      if (!start || !e.latLng) return
      const swLng = Math.min(start.lng(), e.latLng.lng())
      const neLng = Math.max(start.lng(), e.latLng.lng())
      const swLat = Math.min(start.lat(), e.latLng.lat())
      const neLat = Math.max(start.lat(), e.latLng.lat())
      start = null
      rect?.setMap(null)
      rect = null
      onDoneRef.current()
      if (neLng - swLng < 1e-5 || neLat - swLat < 1e-5) return // a click, not a drag — ignore
      onBboxRef.current(`${swLng.toFixed(6)},${swLat.toFixed(6)},${neLng.toFixed(6)},${neLat.toFixed(6)}`)
    })
    return () => {
      down.remove()
      move.remove()
      up.remove()
      rect?.setMap(null)
      map.setOptions({ draggable: true, gestureHandling: MAP_OPTIONS.gestureHandling })
    }
  }, [map, active])
  return null
}

/** Shown when the build has no browser key, so a map area degrades to a legible note instead of a blank. */
function MapUnavailable({ className }: { className?: string }) {
  return (
    <div
      className={`flex w-full items-center justify-center rounded-lg border bg-muted px-3 text-center text-xs text-muted-foreground ${className ?? 'h-72'}`}
    >
      Map unavailable — VITE_GOOGLE_MAPS_BROWSER_KEY is not set for this build.
    </div>
  )
}

/** A draw-a-rectangle bbox picker. Shows the current bbox, and a "Draw bbox" toggle: while on, drag a
 *  box (the map won't pan); on release it fills the field and exits draw mode. Normal drag = pan. */
export function BboxMap({ bbox, onBbox, className }: { bbox: string; onBbox: (bbox: string) => void; className?: string }) {
  const [drawing, setDrawing] = useState(false)
  if (!BROWSER_KEY) return <MapUnavailable className={className} />
  return (
    <div className={`relative w-full overflow-hidden rounded-lg border ${className ?? 'h-72'}`}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setDrawing((d) => !d)
        }}
        className="absolute right-2 top-2 z-10 rounded-md border bg-background/90 px-2 py-1 text-xs font-medium shadow-sm hover:bg-background"
      >
        {drawing ? 'Drawing… drag a box' : '✏ Draw bbox'}
      </button>
      <APIProvider apiKey={BROWSER_KEY}>
        <Map {...MAP_OPTIONS} defaultCenter={centerOfBbox(bbox)} defaultZoom={bboxCorners(bbox) ? 9 : 8}>
          {/* While drawing, stop re-fitting so the camera holds still under the drag. */}
          <FitBounds bbox={drawing ? null : bbox} />
          {!drawing && <BboxOutline bbox={bbox} />}
          <DrawController active={drawing} onBbox={onBbox} onDone={() => setDrawing(false)} />
        </Map>
      </APIProvider>
    </div>
  )
}

/** One curated-place pin. Clicking it opens an InfoWindow identifying the place + its roles (the marker
 *  ref is needed to anchor the window). `selected` is lifted to the layer so only one window is open. */
function PlaceMarker({
  pin,
  selected,
  onSelect,
  onClose,
}: {
  pin: PlacePin
  selected: boolean
  onSelect: () => void
  onClose: () => void
}) {
  const [markerRef, marker] = useAdvancedMarkerRef()
  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={{ lat: pin.lat, lng: pin.lng }}
        title={pin.name}
        anchorPoint={AdvancedMarkerAnchorPoint.BOTTOM_CENTER}
        onClick={onSelect}
      >
        <img src={dataUri(pinSvg(placePinFill(pin)))} width={20} height={25} alt="" style={MARKER_SHADOW} />
      </AdvancedMarker>
      {selected && (
        // Inline styles (not Tailwind) — the InfoWindow content is portaled into the Google bubble,
        // outside the app's CSS scope.
        <InfoWindow anchor={marker} onClose={onClose}>
          <div style={{ minWidth: 132, lineHeight: 1.35 }}>
            <div style={{ fontWeight: 600 }}>{pin.name}</div>
            {pin.kind && <div style={{ fontSize: 12, color: '#64748b' }}>{pin.kind}</div>}
            <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 11 }}>
              {pin.featured && <span style={{ color: PLACE_PIN_COLORS.featured }}>★ featured</span>}
              {pin.endpointEligible && <span style={{ color: PLACE_PIN_COLORS.endpoint }}>● endpoint</span>}
              {pin.breakEligible && <span style={{ color: PLACE_PIN_COLORS.break }}>● break</span>}
            </div>
          </div>
        </InfoWindow>
      )}
    </>
  )
}

/** The clickable place-pin layer — holds the single open-InfoWindow selection. */
function PlaceMarkerLayer({ places }: { places: PlacePin[] }) {
  const [selected, setSelected] = useState<number | null>(null)
  return (
    <>
      {places.map((p, i) => (
        <PlaceMarker
          key={`${p.lat},${p.lng},${i}`}
          pin={p}
          selected={selected === i}
          onSelect={() => setSelected(i)}
          onClose={() => setSelected(null)}
        />
      ))}
    </>
  )
}

/** A multi-pin map of a region's CURATED places, fit to the region bbox. Pins are color-coded by role
 *  (amber=featured, teal=endpoint, slate=break); CLICK a pin for an InfoWindow with its name/kind/roles.
 *  Empty `places` just shows the bboxed region. */
export function PlacesMap({ places, bbox, className }: { places: PlacePin[]; bbox: string | null; className?: string }) {
  if (!BROWSER_KEY) return <MapUnavailable className={className} />
  return (
    <div className={`relative w-full overflow-hidden rounded-lg border ${className ?? 'h-72'}`}>
      <APIProvider apiKey={BROWSER_KEY}>
        <Map {...MAP_OPTIONS} defaultCenter={centerOfBbox(bbox)} defaultZoom={bbox && bboxCorners(bbox) ? 9 : 8}>
          <FitBounds bbox={bbox} />
          <BboxOutline bbox={bbox} />
          <PlaceMarkerLayer places={places} />
        </Map>
      </APIProvider>
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
  if (!BROWSER_KEY) return <MapUnavailable className="h-80" />
  const pos = anchor ?? poi
  return (
    <div className="h-80 w-full overflow-hidden rounded-lg border">
      <APIProvider apiKey={BROWSER_KEY}>
        <Map {...MAP_OPTIONS} defaultCenter={{ lat: poi.lat, lng: poi.lng }} defaultZoom={16}>
          <AdvancedMarker position={{ lat: poi.lat, lng: poi.lng }} anchorPoint={AdvancedMarkerAnchorPoint.BOTTOM_CENTER}>
            <img src={dataUri(POI_SVG)} width={20} height={25} alt="" style={MARKER_SHADOW} />
          </AdvancedMarker>
          <AdvancedMarker
            position={{ lat: pos.lat, lng: pos.lng }}
            draggable
            anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
            onDragEnd={(e: google.maps.MapMouseEvent) => {
              if (e.latLng) onAnchor({ lat: e.latLng.lat(), lng: e.latLng.lng() })
            }}
          >
            <img
              src={dataUri(ANCHOR_SVG)}
              width={22}
              height={22}
              alt=""
              // A distinct MOVE cursor (4-arrow) over the anchor. The map's own pan cursor is an open
              // hand, so `grab`/`grabbing` would look identical to it — `move` reads clearly as "drag me".
              className="cursor-move"
              style={MARKER_SHADOW}
            />
          </AdvancedMarker>
        </Map>
      </APIProvider>
    </div>
  )
}
