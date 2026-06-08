// The skipper's voice, in the UI. Microcopy is brand-critical here — the persona
// is the product, so loading/empty/error/CTA strings stay in character. Keep them
// warm, corny, and SHORT (glanceable). Facts never live here; this is delivery.
export const voice = {
  loading: {
    app: 'Firing up the engine, folks. She starts when she’s good and ready.',
    corridors: 'Charting the good water…',
    tour: 'Pulling the logbook…',
    preview: 'Warming up the launch…',
  },
  empty: {
    corridors:
      'No drives charted here yet. We’re still out mapping the good water — check back soon.',
    tours: 'No tours run this corridor yet. The skipper’s still scouting it.',
    tour: 'This tour slipped its mooring. Head back and pick another.',
  },
  error: {
    generic: 'Well, that’s a knot in the line. Give her another pull?',
    retry: 'Give her another pull',
  },
  cta: {
    play: 'All aboard', // short: the center CTA is now flanked by the ±15s skip buttons
    pause: 'Hold here',
    resume: 'Shove off again',
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
    underway: 'UNDERWAY', // between stops — nautical, not "DRIVING"
    shoreLeave: 'SHORE LEAVE', // a rest stop
  },
  greeting: 'Pick a drive. I’ll do the talking.',
  driveComplete: 'That’s the dock, folks. Watch your step on the way off.',
  auth: {
    signInHeader: 'Welcome back aboard',
    signUpHeader: 'Grab a boarding pass',
    subhead: 'Mind the gap.',
  },
  guest: 'Riding as a guest',
} as const
