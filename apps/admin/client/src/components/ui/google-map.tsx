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
import { parseRegionBboxes } from '@skipper/engine'
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
  /** The place row's id — the handle the /places TABLE uses to open this pin's window from a row click. */
  id: string
  lat: number
  lng: number
  name: string
  featured: boolean
  endpointEligible: boolean
  breakEligible?: boolean
  /** Humanized place kind for the click popup (e.g. "scenic spot"); null when unknown. */
  kind?: string | null
  /** How likely a visitor is to NAME this place, 1 = most; null = unranked. Shown in the popup. */
  rank: number | null
}

function placePinFill(p: PlacePin): string {
  return p.featured ? PLACE_PIN_COLORS.featured : p.endpointEligible ? PLACE_PIN_COLORS.endpoint : PLACE_PIN_COLORS.break
}

/**
 * Corners of every box a region is made of. Pure (no google).
 *
 * ⚠ PARSES THROUGH @skipper/engine RATHER THAN SPLITTING ON ','. This file used to carry its own
 * `bbox.split(',')` parser, which is how it BROKE the moment a region became several boxes: a
 * multi-box value splits into 7 fields, one of them `NaN`, so the whole thing read as malformed and
 * the map silently drew NO region outline at all. That is the fifth independently-written parser of
 * this one string in this repo's history, and the reason there is now exactly one
 * (docs/decisions/multi-bbox-regions.md). The engine is zero-dep and browser-safe, so importing it
 * here costs nothing.
 */
function bboxCorners(bbox: string | null): { south: number; west: number; north: number; east: number }[] {
  return parseRegionBboxes(bbox).map((b) => ({ south: b.swLat, west: b.swLng, north: b.neLat, east: b.neLng }))
}

/** Center of a region's whole extent, or the Tahoe default. Pure (used for the uncontrolled
 *  defaultCenter at first paint). Spans every box, so a two-box region opens showing both. */
function centerOfBbox(bbox: string | null): google.maps.LatLngLiteral {
  const cs = bboxCorners(bbox)
  if (cs.length === 0) return DEFAULT_CENTER
  const south = Math.min(...cs.map((c) => c.south))
  const north = Math.max(...cs.map((c) => c.north))
  const west = Math.min(...cs.map((c) => c.west))
  const east = Math.max(...cs.map((c) => c.east))
  return { lat: (south + north) / 2, lng: (west + east) / 2 }
}

/** Bounds enclosing EVERY box — the camera frame, so a multi-box region fits entirely on screen.
 *  ⚠ This is the one place a region's HULL is the right answer: it is a viewport, not a membership
 *  test. Nothing is decided from it. Call only once the API is loaded. */
function boundsFromBbox(bbox: string | null): google.maps.LatLngBounds | null {
  const cs = bboxCorners(bbox)
  if (cs.length === 0) return null
  const bounds = new google.maps.LatLngBounds()
  for (const c of cs) {
    bounds.extend({ lat: c.south, lng: c.west })
    bounds.extend({ lat: c.north, lng: c.east })
  }
  return bounds
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

/** The committed-bbox outline (solid green; google.maps.Rectangle has no native dash).
 *  ⚠ ONE RECTANGLE PER BOX, never one around the hull — a region of several boxes does NOT include the
 *  ground between them, and drawing the hull would show an operator a region that does not exist. */
function BboxOutline({ bbox }: { bbox: string | null }) {
  const map = useMap()
  useEffect(() => {
    if (!map) return
    const rects = bboxCorners(bbox).map(
      (c) =>
        new google.maps.Rectangle({
          map,
          bounds: new google.maps.LatLngBounds({ lat: c.south, lng: c.west }, { lat: c.north, lng: c.east }),
          clickable: false,
          strokeColor: BBOX_GREEN,
          strokeOpacity: 1,
          strokeWeight: 2,
          fillColor: BBOX_GREEN,
          fillOpacity: 0.05,
        }),
    )
    return () => rects.forEach((r) => r.setMap(null))
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
 *  box (the map won't pan); on release it fills the field and exits draw mode. Normal drag = pan.
 *
 *  ⚠ TWO MODES SINCE A REGION MAY BE SEVERAL BOXES. "Draw bbox" REPLACES the whole field, which is
 *  what redrawing a region means; on a multi-box region that would silently discard the other boxes,
 *  so "＋ Add box" APPENDS instead. The distinction has to be in the BUTTON rather than inferred,
 *  because both are legitimate intentions against the same gesture, and guessing wrong destroys work
 *  the operator cannot see happening. The add button only appears once there is something to add to. */
export function BboxMap({ bbox, onBbox, className }: { bbox: string; onBbox: (bbox: string) => void; className?: string }) {
  const [drawing, setDrawing] = useState<null | 'replace' | 'append'>(null)
  const existing = bboxCorners(bbox).length
  if (!BROWSER_KEY) return <MapUnavailable className={className} />
  const emit = (drawn: string) => onBbox(drawing === 'append' && bbox.trim() ? `${bbox.trim()};${drawn}` : drawn)
  return (
    <div className={`relative w-full overflow-hidden rounded-lg border ${className ?? 'h-72'}`}>
      <div className="absolute right-2 top-2 z-10 flex gap-1">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setDrawing((d) => (d === 'replace' ? null : 'replace'))
        }}
        className="rounded-md border bg-background/90 px-2 py-1 text-xs font-medium shadow-sm hover:bg-background"
      >
        {drawing === 'replace' ? 'Drawing… drag a box' : existing > 1 ? '✏ Replace all' : '✏ Draw bbox'}
      </button>
      {existing > 0 && (
        <button
          type="button"
          title="Draw an ADDITIONAL box — the region becomes every box, and the ground between them is NOT included"
          onClick={(e) => {
            e.stopPropagation()
            setDrawing((d) => (d === 'append' ? null : 'append'))
          }}
          className="rounded-md border bg-background/90 px-2 py-1 text-xs font-medium shadow-sm hover:bg-background"
        >
          {drawing === 'append' ? 'Drawing… drag a box' : '＋ Add box'}
        </button>
      )}
      </div>
      <APIProvider apiKey={BROWSER_KEY}>
        <Map {...MAP_OPTIONS} defaultCenter={centerOfBbox(bbox)} defaultZoom={bboxCorners(bbox).length > 0 ? 9 : 8}>
          {/* While drawing, stop re-fitting so the camera holds still under the drag. */}
          <FitBounds bbox={drawing ? null : bbox} />
          {/* ⚠ Keep the committed boxes VISIBLE while appending — you cannot place a second box
              sensibly without seeing the first. Replacing hides them, because they are about to go. */}
          {drawing !== 'replace' && <BboxOutline bbox={bbox} />}
          <DrawController active={drawing !== null} onBbox={emit} onDone={() => setDrawing(null)} />
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
            {/* ⚠ The name MUST name its own color. The bubble is portaled into Google's always-WHITE
                InfoWindow, but `color` still inherits down the DOM — so under the console's dark theme
                the title rendered near-white on white and the one word identifying the pin was the one
                word you couldn't read. Every other line here already sets a color, which is why only
                this one was invisible. */}
            <div style={{ fontWeight: 600, color: '#0f172a' }}>{pin.name}</div>
            {pin.kind && <div style={{ fontSize: 12, color: '#64748b' }}>{pin.kind}</div>}
            {/* RANK, not roles. This line used to read "● endpoint" on every pin — true of every row
                since roles were deleted (2026-08-04), so it identified nothing. Rank is the one thing
                that still separates two pins, and this bubble is now what a table row click opens. */}
            <div
              style={{ marginTop: 4, fontSize: 11, color: pin.featured ? PLACE_PIN_COLORS.featured : '#64748b' }}
            >
              {pin.rank != null ? `${pin.featured ? '★ ' : ''}rank ${pin.rank}` : 'unranked'}
            </div>
          </div>
        </InfoWindow>
      )}
    </>
  )
}

/** The clickable place-pin layer. Selection is CONTROLLED by the page, so one id drives both the open
 *  InfoWindow and the highlighted table row — a pin and its row can never disagree about what's picked. */
function PlaceMarkerLayer({
  places,
  selectedId,
  onSelect,
}: {
  places: PlacePin[]
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  return (
    <>
      {places.map((p) => (
        <PlaceMarker
          key={p.id}
          pin={p}
          selected={selectedId === p.id}
          onSelect={() => onSelect(p.id)}
          onClose={() => onSelect(null)}
        />
      ))}
    </>
  )
}

/**
 * Center the camera on a pin when the PAGE asks (a table row click), never when the operator clicks the
 * pin itself — that pin is already under their cursor and yanking the map out from under it is hostile.
 *
 * ⚠ Both halves of the signature are load-bearing:
 *  - It keys on a NONCE, not on the position, for two reasons. A pin click changes the position without
 *    meaning "move the camera", and clicking the SAME row twice (to come back after panning away) does
 *    not change the position at all — an effect watching lat/lng would fire on the first and sit still
 *    on the second, which is exactly backwards. The position rides a ref for the same reason.
 *  - It PANS and does not zoom. The map is fit to the region bbox, and that overview is the operator's
 *    working context; a pin centered under an open name bubble already answers "which one is it"
 *    without spending their zoom level, which nothing here could restore.
 */
function FocusPin({ pos, nonce }: { pos: google.maps.LatLngLiteral | null; nonce: number }) {
  const map = useMap()
  const posRef = useRef(pos)
  posRef.current = pos
  useEffect(() => {
    // nonce 0 = nobody has asked yet; don't hijack the initial bbox fit on mount.
    if (!map || nonce === 0) return
    const p = posRef.current
    if (p) map.panTo(p)
  }, [map, nonce])
  return null
}

/** A multi-pin map of a region's CURATED places, fit to the region bbox. Amber = top-ranked, teal = the
 *  rest; CLICK a pin (or its table row) for an InfoWindow with its name/kind/rank. Empty `places` just
 *  shows the bboxed region. Selection is controlled — see PlaceMarkerLayer and FocusPin. */
export function PlacesMap({
  places,
  bbox,
  className,
  selectedId,
  onSelect,
  focusNonce,
}: {
  places: PlacePin[]
  bbox: string | null
  className?: string
  /** Which pin's InfoWindow is open (null = none). */
  selectedId: string | null
  /** A pin was clicked, or its window closed (null). */
  onSelect: (id: string | null) => void
  /** Bump to re-center on `selectedId`. A counter, not a boolean — see FocusPin. */
  focusNonce: number
}) {
  if (!BROWSER_KEY) return <MapUnavailable className={className} />
  const focused = places.find((p) => p.id === selectedId) ?? null
  return (
    <div className={`relative w-full overflow-hidden rounded-lg border ${className ?? 'h-72'}`}>
      <APIProvider apiKey={BROWSER_KEY}>
        <Map {...MAP_OPTIONS} defaultCenter={centerOfBbox(bbox)} defaultZoom={bboxCorners(bbox).length > 0 ? 9 : 8}>
          <FitBounds bbox={bbox} />
          <BboxOutline bbox={bbox} />
          <PlaceMarkerLayer places={places} selectedId={selectedId} onSelect={onSelect} />
          <FocusPin pos={focused ? { lat: focused.lat, lng: focused.lng } : null} nonce={focusNonce} />
        </Map>
      </APIProvider>
    </div>
  )
}

/* ── Route map (a DRIVE's frozen geometry) ─────────────────────────────────── */

// The drive route line. Amber so it reads over both hybrid imagery and the roadmap basemap, and so it
// can't be mistaken for the green region bbox.
const ROUTE_LINE = '#f59e0b'
// Stop pins: a released stop is teal (same teal as a curated endpoint — "this is live"), a stop whose
// telling is missing or staged is slate, so a silent drive is legible at a glance without a legend.
const STOP_LIVE = '#0f766e'
const STOP_DIM = '#64748b'

/** One frozen stop, as the map needs it. */
export interface RouteStopPin {
  lat: number
  lng: number
  label: string
  /** Renders the pin live-teal vs dim-slate. False for a missing OR staged telling. */
  live: boolean
}

/** The route line, drawn imperatively (same reason as BboxOutline — no dependency on a React wrapper
 *  being exported). `path` is [lng, lat] pairs, the order a drive's polyline is stored in. */
function RouteLine({ path }: { path: [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    if (!map || path.length < 2) return
    const line = new google.maps.Polyline({
      map,
      path: path.map(([lng, lat]) => ({ lat, lng })),
      clickable: false,
      strokeColor: ROUTE_LINE,
      strokeOpacity: 0.95,
      strokeWeight: 4,
    })
    return () => line.setMap(null)
  }, [map, path])
  return null
}

/**
 * A DRIVE's frozen route: the polyline plus a pin per stop, fit to the drive's own bbox.
 *
 * ⚠ Fits to the DRIVE's stored bbox, not to the region's — a drive is the thing being inspected here,
 * and its route rectangle is frozen alongside the polyline, so the camera always frames exactly the
 * geometry the rider bought. No bbox outline is drawn: the region is derived context on this page, not
 * the subject.
 */
export function RouteMap({
  polyline,
  stops,
  className,
}: {
  polyline: [number, number][]
  stops: RouteStopPin[]
  className?: string
}) {
  if (!BROWSER_KEY) return <MapUnavailable className={className} />
  // Reuse the bbox contract ("swLng,swLat,neLng,neLat") for the camera fit rather than inventing a
  // second fitting path — FitBounds already handles it. Derived from the polyline so the frame matches
  // what is actually drawn even if a stop pin sits slightly off the line.
  const lngs = polyline.map(([lng]) => lng)
  const lats = polyline.map(([, lat]) => lat)
  const bbox =
    polyline.length > 0
      ? `${Math.min(...lngs)},${Math.min(...lats)},${Math.max(...lngs)},${Math.max(...lats)}`
      : null
  return (
    <div className={`relative w-full overflow-hidden rounded-lg border ${className ?? 'h-72'}`}>
      <APIProvider apiKey={BROWSER_KEY}>
        <Map {...MAP_OPTIONS} defaultCenter={centerOfBbox(bbox)} defaultZoom={bbox ? 10 : 8}>
          <FitBounds bbox={bbox} />
          <RouteLine path={polyline} />
          {stops.map((s, i) => (
            <AdvancedMarker
              key={`${s.lat},${s.lng},${i}`}
              position={{ lat: s.lat, lng: s.lng }}
              title={s.label}
              anchorPoint={AdvancedMarkerAnchorPoint.BOTTOM_CENTER}
            >
              <img src={dataUri(pinSvg(s.live ? STOP_LIVE : STOP_DIM))} width={20} height={25} alt="" style={MARKER_SHADOW} />
            </AdvancedMarker>
          ))}
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
