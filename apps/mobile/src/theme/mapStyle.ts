// ─────────────────────────────────────────────────────────────────────────────
// Google Maps `customMapStyle` — the basemap tinted to Trailhead 89 (the aged
// road-atlas by day, the park at night by dusk). Google deprecated JSON styling in
// favor of cloud Map IDs, but `googleMapId` doesn't work on iOS in react-native-maps
// (#5038) while this JSON still does — so the JSON style is the cross-platform path.
//
// This is the design system's ONE sanctioned place for raw map hexes (per the
// real-map handoff spec): it lives in `src/theme`, mirrors the palette, and is driven
// by the active theme — never the OS map default. Label density is kept LOW (POIs,
// transit, and local labels hidden) so the route + the one amber position read in a
// ~0.5s in-car glance.
import { palette } from './tokens'

type MapStyleElement = {
  featureType?: string
  elementType?: string
  stylers: Array<Record<string, string | number>>
}

function buildMapStyle(isDark: boolean): MapStyleElement[] {
  const land = isDark ? palette.night : palette.paper
  const water = isDark ? palette.lakeTealNight : palette.lakeTeal
  const roadMajor = isDark ? palette.nightKeyline : palette.paperSunken
  const roadMinor = isDark ? palette.tanRuleNight : palette.tanRule
  const labelText = isDark ? palette.parchFaded : palette.inkFaded
  const labelHalo = land
  const park = isDark ? '#163326' : '#DDE3C9' // deep pine / a desaturated accent wash

  return [
    { elementType: 'geometry', stylers: [{ color: land }] },
    { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] }, // no POI pins
    { elementType: 'labels.text.fill', stylers: [{ color: labelText }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: labelHalo }] },
    // administrative outlines off — the brand-owned route is the only line that matters
    { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
    { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
    { featureType: 'administrative.neighborhood', stylers: [{ visibility: 'off' }] },
    // POIs hidden wholesale (low density); parks get a soft natural wash
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: park }] },
    { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: land }] },
    { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: land }] },
    // roads: major reads, minor recedes, labels simplified (towns + highways only)
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: roadMinor }] },
    { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: roadMajor }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: roadMajor }] },
    { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'simplified' }] },
    { featureType: 'road.local', elementType: 'labels', stylers: [{ visibility: 'off' }] },
    { featureType: 'road.highway', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    // water in the lake teal — the East Shore reads at a glance
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: water }] },
    // Hide water LABELS: faded ink on teal water computes to ~1:1 (effectively invisible), failing the
    // §4 contrast guarantee. The teal lake SHAPE is the recognizable landmark and the route + amber
    // token are the glance targets — a name isn't needed (and low label density is the doctrine). (audit #662)
    { featureType: 'water', elementType: 'labels.text', stylers: [{ visibility: 'off' }] },
  ]
}

// Precompute both variants ONCE at module load. mapStyle() returns a STABLE reference per theme so a
// re-render doesn't allocate ~25 fresh style objects and make react-native-maps re-apply the basemap
// on the hot path. (audit #558)
const MAP_STYLE_LIGHT = buildMapStyle(false)
const MAP_STYLE_DARK = buildMapStyle(true)

export function mapStyle(isDark: boolean): MapStyleElement[] {
  return isDark ? MAP_STYLE_DARK : MAP_STYLE_LIGHT
}
