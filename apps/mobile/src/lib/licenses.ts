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

/** Display host for a source link, e.g. "macrostrat.org" — protocol + www. stripped. */
export const sourceHost = (url: string): string =>
  url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '')
