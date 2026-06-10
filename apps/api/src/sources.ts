// The app-wide data-source + license catalog, served by GET /sources. The AUTHORITATIVE
// copy lives here (server-side) so a NEW fact source credits correctly with a backend
// deploy — never an App Store release. (The app keeps a bundled fallback only so the
// legal screen survives offline; the API list wins whenever it's reachable.)
//
// These are LEGAL facts (license codes, canonical license + source URLs), kept OUT of the
// persona layer. This mirrors what the generator freezes onto each clip's
// `tour_stops.attribution` at generation time (wikipedia → "CC BY-SA 4.0", macrostrat →
// "CC BY 4.0", wikidata → "CC0"; break anchors come from Google Places). When a new source lands in
// `@skipper/shared` `attributionSource`, add it HERE so the public legal surface stays in
// lockstep with what a drive actually draws on.

import type { DataSource } from '@skipper/shared'

export const DATA_SOURCES: DataSource[] = [
  {
    name: 'Wikipedia',
    use: 'The stories — the facts behind the tales the skipper tells at each stop.',
    license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    sourceUrl: 'https://www.wikipedia.org',
    note: 'Article text is reused under CC BY-SA: credit is required, and adaptations carry the same license.',
  },
  {
    name: 'Wikidata',
    use: 'The details — the dates, elevations, and namesakes behind certain stops.',
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    sourceUrl: 'https://www.wikidata.org',
    note: 'Structured data dedicated to the public domain under CC0 — free to use without attribution; credited here for transparency.',
  },
  {
    name: 'Macrostrat',
    use: 'The ground — the bedrock type and age under each stop, for the geology asides.',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceUrl: 'https://macrostrat.org',
    note: 'Built on U.S. Geological Survey geologic maps, which are in the public domain.',
  },
  {
    name: 'Google Places',
    use: 'The pit stops — the name and category of the rest and food stops along a route.',
    license: null,
    sourceUrl: 'https://www.google.com/maps',
    note: 'Used under the Google Maps Platform Terms of Service. Powered by Google.',
  },
]
