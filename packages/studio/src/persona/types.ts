// The generation-side persona definition — everything that makes a region's host sound
// like itself. Resolved per tour by region slug (see ./index.ts), so adding a region is a
// new PersonaDef + a registry entry, never edits scattered across generate.ts / lint.ts.
//
// PRESENTATION (the display name/tagline/backstory/portrait served to the app) lives in
// apps/api/src/host.ts, NOT here — this is the GENERATION half (prompt, voice) that
// never reaches the client. Background: docs/ideas/region-skippers.md.

import type { GeminiVoice } from '../models'

export interface PersonaDef {
  /** Stable slug bridging this code recipe to its `personas` row. In v2 it is NOT persisted on a
   *  narration (one host, resolved in code); it returns to the row when region-skippers ship (M4). */
  personaKey: string
  /** Spoken/display host name. Founder rule: ALWAYS 'Skipper' (regions differ by voice/flavor, not name). */
  hostName: string
  /** Ear-judged Gemini-TTS voice for this host. */
  voice: GeminiVoice
  /** Natural-language delivery directive (Cloud TTS input.prompt) — HOW the voice reads, never WHAT it says. */
  ttsStyle: string
  /** System prompt for STOP narration (grounded). */
  systemPrompt: string
}
