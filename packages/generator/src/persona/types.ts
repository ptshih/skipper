// The generation-side persona definition — everything that makes a region's host sound
// like itself. Resolved per tour by region slug (see ./index.ts), so adding a region is a
// new PersonaDef + a registry entry, never edits scattered across generate.ts / lint.ts.
//
// PRESENTATION (the display name/tagline/backstory/portrait served to the app) lives in
// apps/api/src/host.ts, NOT here — this is the GENERATION half (prompt, voice, kit) that
// never reaches the client. Background: docs/ideas/region-skippers.md.

import type { GeminiVoice } from '../models'

/** A personal-kit detector: the regex that spots the kit reference + the spent-beat label. */
export interface KitBeat {
  /** Matches this kit reference in a generated script. */
  match: RegExp
  /** Human label — fed to narration's "kit beats already spent" list and the gen log. */
  label: string
}

export interface PersonaDef {
  /** Stable slug bridging this code recipe to its `personas` row (the FK target). Resolved to
   *  `personas.id` at generation time (persist.resolvePersonaId) to fill `segments.persona_id`. */
  personaKey: string
  /** Spoken/display host name. Founder rule: ALWAYS 'Skipper' (regions differ by voice/flavor, not name). */
  hostName: string
  /** Ear-judged Gemini-TTS voice for this host. */
  voice: GeminiVoice
  /** Natural-language delivery directive (Cloud TTS input.prompt) — HOW the voice reads, never WHAT it says. */
  ttsStyle: string
  /** System prompt for STOP narration (grounded; kit banned). */
  systemPrompt: string
  /** System prompt for the intro/outro FRAMES (persona-only; the kit's home). */
  framePrompt: string
  /** The host's personal kit — per-persona DATA. Banned from stops, housed in the intro. */
  kit: {
    /**
     * Kit detectors — the SINGLE source for both the generator's spent-beat tracking and
     * the diversity lint's kit-in-stops ban. Keep these in lockstep with the kit prose in
     * `systemPrompt`/`framePrompt` (they describe the same kit two ways).
     */
    beats: KitBeat[]
    /** The lint's regen instruction when a stop touches the kit — names THIS kit's terms. */
    dropNote: string
  }
}
