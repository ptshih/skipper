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
// Keyed by the `persona` enum: `Record<Persona, ...>` makes TypeScript reject adding a new
// persona without giving it a host here — the completeness guard is the type itself.

import type { HostIdentity, Persona } from '@skipper/shared'

const HOSTS: Record<Persona, HostIdentity> = {
  // The original Tahoe host. `name` is what the lock-screen Now Playing shows as the
  // "artist" today (was hard-coded 'Skipper' in the app before this contract landed).
  skipper: {
    name: 'Skipper',
    tagline: 'Your road-trip guide — every stop, every story, and an unreasonable number of puns.',
    backstory:
      'A deadpan pun-machine who knows this lake by heart, drives a cranky old truck that starts when it feels like it, and has strong opinions about coffee. Here to point things out the window and groan at his own jokes.',
    portraitUrl: null,
    voiceSampleUrl: null,
  },
}

/** Resolve the narrating host's display identity for a tour's persona. */
export const hostForPersona = (persona: Persona): HostIdentity => HOSTS[persona]
