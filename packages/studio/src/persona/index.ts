// The generation-side persona registry — resolves the host persona from a PERSONA KEY, defaulting
// to the Skipper so an unknown/absent key is never persona-less. In v2 generation calls
// `personaFromKey('skipper')` directly (one host per region; the persona is baked into the
// narration's AUDIO, NOT stored on the row). Adding a host = a new PersonaDef + one entry here
// (a backend deploy, never an app update). Background: docs/ideas/region-skippers.md.

import { SKIPPER } from './skipper'
import type { PersonaDef } from './types'

const PERSONAS: Record<string, PersonaDef> = {
  [SKIPPER.personaKey]: SKIPPER,
}

/** Resolve the generation persona for a persona key (defaults to the Skipper). */
export const personaFromKey = (key: string): PersonaDef => PERSONAS[key] ?? SKIPPER

export { SKIPPER }
export type { PersonaDef } from './types'
