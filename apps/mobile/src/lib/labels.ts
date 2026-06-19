// Brand-voiced labels for domain enums, mapped at the VIEW boundary. The API/DTOs
// keep the raw enum values (story/scenic/break); screens never show those — the
// skipper does the talking. Keep these warm and SHORT.
//
// (Glyphs + badge tones for stop types live in `@/ui` `stops.ts`; this is the text.)
//
// NOTE: there's no jokeLabel — the Dad-Joke-O-Meter notch is a generation input, not
// stored/surfaced state (M1 = dadpocalypse-only), so no screen renders it. Re-add a notch
// label here when the 1-N notch ships and a tour actually varies its corniness.

const STOP_LABEL: Record<string, string> = {
  story: 'Tale from the trail',
  scenic: 'Enjoy the view',
  break: 'Pit stop',
  wave: 'Passing by', // a brief roam-style call-out that can ride along a drive
}

const titleize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export const stopLabel = (type?: string): string =>
  type ? (STOP_LABEL[type] ?? titleize(type)) : ''

// Wikipedia disambiguates place TITLES with a trailing ", <US State>" — "Tahoe Keys,
// California", "Rubicon, California". Stripped at the VIEW boundary so a scraped article
// title reads like a place a person would actually say. DISPLAY-ONLY: the data layer keeps
// the raw name, and the baked narration/coords/facts are untouched — this is delivery, not
// facts. Global so it also cleans a teaser that strings several names together
// ("A, California & B, California" → "A & B"). The state set covers the live + roadmapped
// regions (Tahoe → Yosemite → Moab); extend it when a new region's state can appear.
const STATE_SUFFIX =
  /,\s+(?:California|Nevada|Utah|Arizona|Oregon|Washington|Idaho|Wyoming|Colorado|Montana|New Mexico)\b/g

export const cleanPlaceName = (name: string): string => name.replace(STATE_SUFFIX, '')
