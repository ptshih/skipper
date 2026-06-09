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
    artist: 'Kevin MacLeod',
    tracks: ['Long Road Ahead', 'Americana'],
    via: 'incompetech.com',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceUrl: 'https://incompetech.com',
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

/** Display host for a source link, e.g. "macrostrat.org" — protocol + www. stripped. */
export const sourceHost = (url: string): string =>
  url
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '')
