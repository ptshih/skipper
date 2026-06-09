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
  finish: 'Last call',
}

const titleize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export const stopLabel = (type?: string): string =>
  type ? (STOP_LABEL[type] ?? titleize(type)) : ''
