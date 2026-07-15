// Data-source attribution + licensing for the in-app "Sources & Licenses" screen
// (app/legal.tsx). The AUTHORITATIVE catalog now lives SERVER-SIDE (apps/api/src/sources.ts,
// served by GET /sources) so a new fact source credits without an App Store release; the app
// fetches it via `getSources()`. The constant below is ONLY an offline fallback so the legal
// screen never dead-ends in a dead zone — the API list wins whenever it's reachable, so this
// copy may lag a release without legal harm (new-source content can't be reached offline
// without first downloading it online, where the live list was available).
//
// These are LEGAL facts (license codes, the canonical license + source URLs), kept OUT of the
// persona layer: the skipper's voice colors the page intro (voice.legal), never the credit.

export type { DataSource } from '@skipper/shared'
import type { DataSource } from '@skipper/shared'

/** The public legal documents, on the marketing site (apps/site/src/pages/). They live on the WEB,
 *  not in the app, because the App Store listing must point at a URL and a reviewer — plus anyone
 *  deciding whether to install — has to read them BEFORE there's an app to read them in. Settings
 *  links out to the same documents so a signed-in rider isn't sent hunting. Not localized, not
 *  versioned in-app: the site is the single copy, so a policy update never waits on a release. */
export const PRIVACY_POLICY_URL = 'https://skipper.fm/privacy'
export const TERMS_URL = 'https://skipper.fm/terms'

/** Canonical license deeds, keyed by the license CODE frozen on a clip's attribution
 *  (`narrations.attribution[].license`). Creative Commons requires a LINK to the license wherever
 *  the adapted work appears, and the frozen snapshot stores only the code — so this is the one place
 *  that maps code → deed. Keep in step with FALLBACK_DATA_SOURCES below (same URLs, different key:
 *  that catalog is per-SOURCE, this is per-LICENSE, and one source's license can change over time
 *  while old clips keep crediting the license they were actually built under).
 *  An unknown code renders as plain text — credit without a link beats a link to the wrong license. */
const LICENSE_DEEDS: Record<string, string> = {
  'CC BY-SA 4.0': 'https://creativecommons.org/licenses/by-sa/4.0/',
  'CC BY 4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'CC0 1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
}

/** The deed URL for a frozen license code, or undefined if we don't know it. */
export const licenseDeedUrl = (license: string): string | undefined => LICENSE_DEEDS[license]

/** Human label for an `attributionSource` code (the wire carries the code, riders read the name). */
const SOURCE_LABELS: Record<string, string> = {
  wikipedia: 'Wikipedia',
  wikidata: 'Wikidata',
  macrostrat: 'Macrostrat',
  google_places: 'Google Places',
}

/** Display name for an attribution source code; falls back to the raw code rather than dropping
 *  the credit if a new source ships before this map learns it. */
export const attributionSourceLabel = (source: string): string => SOURCE_LABELS[source] ?? source

/** Offline fallback for the credits screen. Source of truth is GET /sources — keep this in
 *  rough sync, but it is non-authoritative (the live list overrides it whenever online). */
export const FALLBACK_DATA_SOURCES: DataSource[] = [
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
    use: 'The ground — the bedrock type and age under each stop, for the geology notes.',
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

// The drive soundtrack — a shuffled rotation of royalty-free instrumentals (the audio
// files + their full source list live in assets/audio/SOURCE.md). Unlike the fact
// sources above, the music is BUNDLED in the app binary, so its credits version WITH the
// app and live here (client-side) rather than on GET /sources — and so they stay visible
// offline. Most tracks are under the Pixabay Content License (no attribution required);
// the ones below are CC BY 4.0, which REQUIRES visible credit. Keep in lockstep with the
// CC-BY entries in assets/audio/SOURCE.md.

export interface MusicCredit {
  /** Artist/creator name — the required CC BY attribution. */
  artist: string
  /** Track title(s) by this artist used in the soundtrack. */
  tracks: string[]
  /** Where we obtained / credit the work (e.g. "incompetech.com", "Free Music Archive"). */
  via: string
  /** Short license code, shown as a tappable badge. */
  license: string
  /** Canonical license deed — satisfies CC's "provide a link to the license". */
  licenseUrl: string
  /** The artist/track credit page. */
  sourceUrl: string
}

export const MUSIC_CREDITS: MusicCredit[] = [
  {
    artist: 'Scott Buckley',
    tracks: ['Homeward', 'Simplicity', 'Wanderlust', 'Journeys', 'Felicity', 'Ice Cream'],
    via: 'scottbuckley.com.au',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceUrl: 'https://www.scottbuckley.com.au',
  },
  {
    artist: 'Jason Shaw',
    tracks: ['Green Leaves', 'Redwood Trail', 'Paper Wings', 'Landra’s Dream'],
    via: 'Audionautix',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceUrl: 'https://audionautix.com',
  },
  {
    artist: 'Mr Smith',
    tracks: ['Small Town'],
    via: 'Free Music Archive',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceUrl: 'https://freemusicarchive.org/music/mr-smith/',
  },
  {
    artist: 'Beat Mekanik',
    tracks: ['Strummin’ with Robin Smith'],
    via: 'Free Music Archive',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceUrl: 'https://freemusicarchive.org/music/beat-mekanik/',
  },
]

/** The other drive-music tracks need no attribution — credited voluntarily. */
export const MUSIC_FREE_NOTE =
  'Additional drive music by Sonican, kaazoom, and Moonpub, free under the Pixabay Content License.'

/** Display host for a source link, e.g. "macrostrat.org" — protocol, www., and any
 *  path stripped (the link target keeps the full URL; only the visible label is the bare
 *  host, so a deep path like /music/beat-mekanik/ can't overflow the credit row). */
export const sourceHost = (url: string): string =>
  url
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
