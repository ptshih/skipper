import { formatMmssMs } from '@skipper/engine'

// Brand-voiced labels for domain enums, mapped at the VIEW boundary. The API/DTOs
// keep the raw enum values (story/scenic/break); screens never show those — the
// skipper does the talking. Keep these warm and SHORT.
//
// (Glyphs + badge tones for stop types live in `@/ui` `stops.ts`; this is the text.)
//
// NOTE: there's no jokeLabel — v2 cut the joke notch entirely (one delivery voice). If
// delivery ever varies, it returns as different NARRATORS (a host/persona label), not a
// corniness notch — surface THAT here then.

const STOP_LABEL: Record<string, string> = {
  story: 'Tale from the trail',
  scenic: 'Enjoy the view',
  break: 'Pit stop',
}

const titleize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export const stopLabel = (type?: string): string =>
  type ? (STOP_LABEL[type] ?? titleize(type)) : ''

// ── The itinerary's trailing meta ────────────────────────────────────────────
// The stop type, SHORT — and only when it is NOT a story. `stopLabel` above is the
// full-voice label and it stays that, but a LIST is a different job from a card: the
// player card names exactly one stop at a time, while the itinerary repeats its label
// down every row. A drive is mostly story stops, so "Tale from the trail" rendered
// eight times running read as wallpaper, and the row's book glyph was already saying
// it a second time. Story therefore returns '' on purpose — the type earns its
// characters only where it changes what the rider should expect (a view, a pit stop).
const STOP_META: Record<string, string> = {
  scenic: 'View',
  break: 'Pit stop',
}

export const stopMeta = (type?: string): string => (type ? (STOP_META[type] ?? '') : '')

/**
 * Clip length as a stamped odometer reading — `2:10`.
 *
 * The mm:ss arithmetic is `@skipper/engine`'s `formatMmssMs` (the Scrubber's timer face), NOT a
 * second copy: the itinerary and the scrubber must never disagree about what "2:10" means. All this
 * adds is the LIST's own rule — an absent or zero duration renders NOTHING rather than the
 * scrubber's honest "0:00", because a row is not a clock and "0:00" beside a stop name reads as a
 * broken clip rather than as a missing number.
 */
export const clipLength = (ms?: number | null): string =>
  ms == null || !Number.isFinite(ms) || ms <= 0 ? '' : formatMmssMs(ms)

/**
 * The same length as a screen reader should HEAR it. `2:10` is a glance format; VoiceOver reads a
 * colon literally, so every surface that shows one owes a spoken twin.
 *
 * ⚠ ONE expression, two renderings — the Scrubber's a11y value speaks through this too. It carried
 * its own private copy of exactly this arithmetic, which is the drift shape this repo keeps paying
 * for: a fix to one wording would silently have left the itinerary saying the other.
 */
export const spokenLength = (ms: number): string => {
  const t = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(t / 60)
  const s = t % 60
  return `${m} minute${m === 1 ? '' : 's'} ${s} second${s === 1 ? '' : 's'}`
}

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
