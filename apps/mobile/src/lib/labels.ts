// Brand-voiced labels for domain enums, mapped at the VIEW boundary. The API/DTOs
// keep the raw enum values (story/scenic/break, off/mild/dad/dadpocalypse); screens
// never show those — the skipper does the talking. Keep these warm and SHORT.
//
// (Glyphs + badge tones for stop types live in `@/ui` `stops.ts`; this is the text.)

const STOP_LABEL: Record<string, string> = {
  story: 'Tale from the trail',
  scenic: 'Enjoy the view',
  break: 'Pit stop',
  finish: 'Last call',
}

const JOKE_LABEL: Record<string, string> = {
  off: 'Just the facts',
  mild: 'Mild seasoning',
  dad: 'Full dad',
  dadpocalypse: 'Dadpocalypse',
}

const titleize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export const stopLabel = (type?: string): string =>
  type ? (STOP_LABEL[type] ?? titleize(type)) : ''
export const jokeLabel = (level?: string): string =>
  level ? (JOKE_LABEL[level] ?? titleize(level)) : ''
