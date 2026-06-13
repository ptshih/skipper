// The generation-side persona registry — resolves a tour's host persona from its PERSONA KEY
// (tours.persona_key, set at create time and decoupled from region; frozen onto
// segments.persona_id at generation). Keyed by persona key, defaulting to the Skipper so an
// unknown/absent key is never persona-less. Adding a host = a new PersonaDef + one entry here
// (a backend deploy, never an app update). Background: docs/ideas/region-skippers.md.

import { SKIPPER } from './skipper'
import type { PersonaDef } from './types'

const PERSONAS: Record<string, PersonaDef> = {
  [SKIPPER.personaKey]: SKIPPER,
}

/** Resolve the generation persona for a tour's persona key (defaults to the Skipper). */
export const personaFromKey = (key: string): PersonaDef => PERSONAS[key] ?? SKIPPER

export { SKIPPER }
export type { KitBeat, PersonaDef } from './types'
