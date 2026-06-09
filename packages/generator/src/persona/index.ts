// The generation-side persona registry — resolves a tour's host persona from its REGION
// SLUG. Mirrors apps/api/src/host.ts (the presentation registry): one host per region,
// defaulting to the Skipper so a freshly-seeded region is never persona-less. Adding a
// region = a new PersonaDef + one entry here (a backend deploy, never an app update).
// See docs/persona-registry-handoff.md.

import { SKIPPER } from './skipper'
import type { PersonaDef } from './types'

const PERSONAS: Record<string, PersonaDef> = {
  'lake-tahoe': SKIPPER,
}

/** Resolve the generation persona for a tour's region slug (defaults to the Skipper). */
export const personaForRegion = (regionSlug: string): PersonaDef => PERSONAS[regionSlug] ?? SKIPPER

export { SKIPPER }
export type { KitBeat, PersonaDef } from './types'
