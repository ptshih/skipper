// Data-source attribution + licensing — the single source of truth for the in-app
// "Sources & Licenses" screen (app/legal.tsx). These are LEGAL facts (license codes,
// the canonical license + source URLs), kept OUT of the persona layer: the skipper's
// voice colors the page intro (voice.legal), never the credit itself.
//
// This mirrors what the generator freezes onto each clip's `poi_content.attribution`
// at generation time (see packages/generator/src/pipeline: wikipedia → "CC BY-SA 4.0",
// macrostrat → "CC BY 4.0"; break anchors come from Google Places). When a new source
// lands in `@skipper/shared` `attributionSource`, add it HERE too so the public legal
// surface stays in lockstep with what a drive actually draws on.

export interface DataSource {
  /** Display name of the source. */
  name: string
  /** What this source contributes to a drive — plain + accurate, no volatile claims. */
  use: string
  /** Short license code, shown as a tappable badge. null = not a public-content license. */
  license: string | null
  /** Canonical license deed — satisfies CC's "provide a link to the license". */
  licenseUrl?: string
  /** The source's own home, for credit. */
  sourceUrl: string
  /** One-line plain-language gloss of the obligation (attribution, share-alike, …). */
  note?: string
}

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
