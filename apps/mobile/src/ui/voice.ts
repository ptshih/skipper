// The skipper's voice, in the UI. Microcopy is brand-critical here — the persona
// is the product, so loading/empty/error/CTA strings stay in character. Keep them
// warm, corny, and SHORT (glanceable). Facts never live here; this is delivery.
export const voice = {
  loading: {
    app: 'Firing up the engine, folks. She starts when she’s good and ready.',
    corridors: 'Charting the good roads…',
    tour: 'Pulling the logbook…',
    preview: 'Warming up the route…',
  },
  empty: {
    corridors:
      'No drives charted here yet. We’re still out mapping the good roads — check back soon.',
    tours: 'No tours run this corridor yet. The skipper’s still scouting it.',
    tour: 'This tour took a wrong turn. Head back and pick another.',
  },
  error: {
    generic: 'Well, that’s a kink in the hose. Give her another pull?',
    retry: 'Give her another pull',
  },
  cta: {
    play: 'Let’s roll', // short: the center CTA is now flanked by the ±15s skip buttons
    pause: 'Hold here',
    resume: 'Roll on again',
    restart: 'Run it again, skipper',
    preview: 'Take the simulated drive',
  },
  gate: {
    title: 'Grab your ticket',
    body: 'The full-length tour needs a (free) ticket — ten seconds, and the skipper never stops talking.',
    action: 'Get my free ticket',
    secondary: 'Just take the sample ride',
  },
  player: {
    buffering: 'Warming up the skipper…',
    stall: 'Couldn’t load that stop — skipping ahead.',
    nowPlaying: 'NOW PLAYING', // emoji kept OUT of label strings (custom font = tofu)
    rolling: 'ROLLING', // between stops — road-trip, not the flat "DRIVING"
    pitStop: 'PIT STOP', // a rest stop
  },
  greeting: 'Pick a drive. I’ll do the talking.',
  driveComplete: 'That’s the end of the road, folks. Watch your step climbing out.',
  auth: {
    signInHeader: 'Welcome back, traveler',
    signUpHeader: 'Come along for the ride',
    subhead: 'Mind the gap.',
  },
  guest: 'Riding as a guest',
} as const
