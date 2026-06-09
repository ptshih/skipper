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
    drive: 'Start the drive', // open the live, GPS-triggered player (simulated on-phone for now)
    endDrive: 'Pull over', // stop the drive and head back to the start line
  },
  gate: {
    title: 'Grab your ticket',
    body: 'The full-length tour needs a (free) ticket — ten seconds, and the skipper never stops talking.',
    action: 'Get my free ticket',
    secondary: 'Just take the sample ride',
  },
  // The live, GPS-triggered drive (vs the couch `preview`): the skipper talks when
  // the road reaches a stop, not on a timer. Kept short + glanceable for the mount.
  drive: {
    ready: 'READY TO ROLL', // pre-drive placard kicker
    readyBody: 'Mount up and start when you’re on the road. I’ll pipe up when we reach the good stuff.',
    sim: 'SIMULATED DRIVE', // the on-device sim setup — no real GPS yet
    live: 'LIVE DRIVE', // real device GPS (Phase 4)
    nextStop: 'next stop', // "ROLLING · next stop: <name>"
    // Location-permission gate (live drive only): two states — can re-ask vs. must visit Settings.
    locationNeeded: 'I steer by your GPS — switch on location and I’ll call out each stop as we reach it.',
    locationBlocked: 'Location’s switched off for me. Flip it on in Settings and we’ll hit the road.',
    locationAllow: 'Switch on location',
    locationSettings: 'Open Settings',
  },
  player: {
    buffering: 'Warming up the skipper…',
    stall: 'Couldn’t load that stop — skipping ahead.',
    nowPlaying: 'NOW PLAYING', // emoji kept OUT of label strings (custom font = tofu)
    paused: 'PAUSED', // a held clip — the NOW card must not keep saying "NOW PLAYING"
    rolling: 'ROLLING', // between stops — road-trip, not the flat "DRIVING"
    pitStop: 'PIT STOP', // a rest stop
    gpsSearching: 'Looking for the satellites — hang tight.', // live drive, no usable fix yet
    gpsError: 'Lost the GPS signal, folks. Pull over and give her another go.', // live watch failed
  },
  greeting: 'Hop in. I’ll do the talking.',
  // The cold-open descriptor: a newcomer should know WHAT this is before any audio
  // plays. Clear first, persona second — the deadpan stays, just aimed.
  tagline: 'Narrated road-trip audio tours — one corny guide, all the good stops.',
  // The home hero's enamel flourishes: a departures-board kicker ABOVE the headline
  // (deliberately NOT repeating the tagline) + the section seam that turns the corridor
  // list into "routes posted on the board". Warm, corny, glanceable, no facts.
  home: {
    kicker: 'NOW DEPARTING',
    section: 'THE DRIVES',
    // The location filter ("Where to?"): the picker title, the default/clear label, the
    // soft-degrade empty line (we never dead-end — show what's charted), and the reserved
    // near-me shortcut label (deferred to v2, behind expo-location).
    where: {
      all: 'All regions',
      title: 'Where are we headed?',
      empty: 'No charted roads out that way yet — here’s everything I’ve mapped so far.',
      nearMe: 'Drives near you',
    },
  },
  driveComplete: 'That’s the end of the road, folks. Watch your step climbing out.',
  auth: {
    signInHeader: 'Welcome back, traveler',
    signUpHeader: 'Come along for the ride',
    subhead: 'Mind the gap.',
  },
  settings: {
    account: 'ACCOUNT',
    appearance: 'APPEARANCE',
    // Explains all three options + reassures that the default needs no fiddling: a
    // night drive dims itself. Persona-light, still informative.
    appearanceHint:
      'Auto rides with your phone — dusk-dark when the sun clocks out, bright by day. Pin Day or Dusk to hold one mood.',
    credits: 'CREDITS',
    creditsAction: 'Sources & licenses', // → /legal
  },
  // The legal/attribution page (Settings → Credits). Intro is the skipper's; the
  // source list + license codes are FACTS, kept in @/lib/licenses, never here.
  legal: {
    title: 'Sources & Licenses',
    intro:
      'The skipper does his homework. Every tale, every rock, every pit stop on a drive is built from the sources below — and we keep the credit where it’s due.',
    musicHeading: 'The road music',
    musicIntro: 'And the songs between stops — the skipper’s glovebox playlist, credited where it counts.',
    footer: 'Tap a license or a source name to read it in full.',
  },
  guest: 'Riding as a guest',
} as const
