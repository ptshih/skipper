// Host presentation registry — the "meet your host" / Now Playing display layer the API
// serves to the app, so the client RENDERS host identity instead of bundling it. That is
// the whole host-agnostic contract: a new region/host then ships with a backend deploy
// (this file + a content batch), NEVER an App Store release.
//
// This is PRESENTATION only. The GENERATION persona — the system prompt, the personal-kit
// regexes, the TTS voice — lives in @skipper/generator's persona registry and never reaches
// the client. Portrait/voice-sample are URLs (R2 once art exists), never bundled assets,
// for the same App-Store reason.
//
// Keyed by REGION SLUG (regions are a table now, not a finite enum). v1 has a single host
// (the Skipper) for every region; per-region host identities are the deferred upgrade
// path — add a slug entry here and it ships with a backend deploy. Unknown/new regions
// fall back to the Skipper so a freshly-seeded region is never host-less.

import type { HostIdentity } from '@skipper/shared'

const SKIPPER: HostIdentity = {
  // `name` is what the lock-screen Now Playing shows as the "artist".
  name: 'Skipper',
  tagline: 'Your road-trip guide — every stop, every story, and an unreasonable number of puns.',
  backstory:
    'A deadpan pun-machine who knows this lake by heart, drives a cranky old truck that starts when it feels like it, and has strong opinions about coffee. Here to point things out the window and groan at his own jokes.',
  portraitUrl: null,
  voiceSampleUrl: null,
}

const HOSTS: Record<string, HostIdentity> = {
  'lake-tahoe': SKIPPER,
}

/** Resolve the narrating host's display identity for a tour's region slug. */
export const hostForRegion = (regionSlug: string): HostIdentity => HOSTS[regionSlug] ?? SKIPPER
