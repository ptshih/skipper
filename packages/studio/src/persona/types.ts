// The generation-side persona definition — everything that makes a region's host sound
// like itself. Resolved by PERSONA KEY (see ./index.ts), so adding a host is a
// new PersonaDef + a registry entry, never edits scattered across generate-narrations.ts / lint.ts.
//
// PRESENTATION (the display name/tagline/backstory/portrait served to the app) has NO v2 home —
// apps/api/src/host.ts was dropped with the legacy tour tables (commit e5afa38); it returns when
// region-skippers ship (M4). This file is the GENERATION half (prompt, voice) that never reaches
// the client. Background: docs/designs/region-skippers.md.

import type { GeminiVoice } from '../models'

export interface PersonaDef {
  /** Stable slug for this code recipe. In v2 it is NOT persisted (the `personas` table was dropped,
   *  migration 0014; one host, resolved in code); it returns as a column when region-skippers ship (M4). */
  personaKey: string
  /** Ear-judged Gemini-TTS voice for this host. */
  voice: GeminiVoice
  /** Natural-language delivery directive (Cloud TTS input.prompt) — HOW the voice reads, never WHAT it says. */
  ttsStyle: string
  /** System prompt for STOP narration (grounded). */
  systemPrompt: string
}
