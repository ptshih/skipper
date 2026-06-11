// The skipper's voice, in the UI. Microcopy is brand-critical here — the persona
// is the product, so loading/empty/error/CTA strings stay in character. Keep them
// warm, corny, and SHORT (glanceable). Facts never live here; this is delivery.
export const voice = {
  loading: {
    drives: 'Charting the good roads…',
    tour: 'Pulling the logbook…',
  },
  empty: {
    drives:
      'No drives charted here yet. We’re still out mapping the good roads — check back soon.',
    tour: 'This tour took a wrong turn. Head back and pick another.',
  },
  error: {
    generic: 'Well, that’s a kink in the hose. Give her another pull?',
    retry: 'Give her another pull',
    download: 'Couldn’t pull the clips down — signal’s thin out here. Give it another go?',
  },
  cta: {
    play: 'Let’s roll', // short: the center CTA is now flanked by the ±15s skip buttons
    pause: 'Hold here',
    resume: 'Roll on again',
    restart: 'Run it again, skipper',
    preview: 'Take the simulated drive',
    drive: 'Start the drive', // open the live, GPS-triggered player (real device GPS)
    simDrive: 'Simulate the drive (dev)', // dev-only: the on-device drive simulator, no real GPS
    endDrive: 'Pull over', // stop the drive and head back to the start line
    backToTrailhead: 'Back to the trailhead', // leave the drive-complete card without replaying
  },
  gate: {
    title: 'Grab your ticket',
    body: 'The full-length tour needs a (free) ticket — ten seconds, and the skipper never stops talking.',
    action: 'Get my free ticket',
    secondary: 'Just take the sample ride', // the play-screen gate → routes to the open preview
    keepBrowsing: 'Keep browsing', // the detail download-gate → dismiss back to the tour
    // Context line for the live-drive gate — carries ONLY what the body lacks (the body
    // already makes the ticket ask), so the two don't stutter "needs a (free) ticket" twice.
    driveNote: 'This is the live, on-the-road drive.',
  },
  // The live, GPS-triggered drive (vs the couch `preview`): the skipper talks when
  // the road reaches a stop, not on a timer. Kept short + glanceable for the mount.
  drive: {
    ready: 'READY TO ROLL', // pre-drive placard kicker
    readyBody: 'Mount up and start when you’re on the road. I’ll pipe up when we reach the good stuff.',
    blurb: 'The skipper talks as you reach each stop on the real roads.', // tour-detail explainer under the Start CTA
    sim: 'SIMULATED DRIVE', // the on-device sim setup — no real GPS yet
    live: 'LIVE DRIVE', // real device GPS (Phase 4)
    nextStop: 'next stop', // "ROLLING · next stop: <name>"
    // Location-permission gate (live drive only): three states — can re-ask, must visit Settings
    // (denied), or location’s on but only APPROXIMATE (iOS Precise Location off → fixes too coarse
    // to trigger stops; the only fix is the Settings toggle, so it routes there like a hard denial).
    locationNeeded: 'I steer by your GPS — switch on location and I’ll call out each stop as we reach it.',
    locationBlocked: 'Location’s switched off for me. Flip it on in Settings and we’ll hit the road.',
    locationReduced:
      'You’ve handed me approximate location — at that blur I’d sail right past the stops. Switch on “Precise Location” in Settings and I’ll call them on the nose.',
    locationAllow: 'Switch on location',
    locationSettings: 'Open Settings',
  },
  player: {
    buffering: 'Warming up the skipper…',
    stall: 'Couldn’t load that stop — skipping ahead.',
    nowPlaying: 'NOW PLAYING', // emoji kept OUT of label strings (custom font = tofu)
    paused: 'PAUSED', // a held clip — the NOW card must not keep saying "NOW PLAYING"
    rolling: 'ROLLING', // between stops — road-trip, not the flat "DRIVING"
    rollingOpen: 'On the open road', // rolling-card title when there's no next stop queued yet
    pitStop: 'PIT STOP', // a rest stop
    gpsSearching: 'Looking for the satellites — hang tight.', // live drive, no usable fix yet
    gpsError: 'Lost the GPS signal, folks. Pull over and give her another go.', // live watch failed
    // The intro/outro bracket clips aren't stops — these title them on BOTH the NOW card and
    // the lock-screen Now Playing (single source, so the two can't silently diverge).
    bracketIntro: 'Welcome aboard',
    bracketOutro: 'One for the road',
    driveCompleteKicker: 'DRIVE COMPLETE', // the done-card kicker
    arrived: 'You’ve arrived', // the done-card title
    restFallback: 'A good spot to stretch', // pit-stop card title when the break carries no name
    previewHint: 'Tap any stop to jump ahead', // above the preview itinerary
  },
  // FREE-ROAM (alpha): no route, no plan — the skipper rides shotgun and pipes up when
  // the road passes something he knows. Silence is the DEFAULT state, so the copy's whole
  // job is making quiet feel companionable (the ambient contract, set IN COPY up front).
  // Strings follow the design handoff (design_handoff_roam); encounter NAMES + tellings
  // come from roam_clips (grounded) — never from here.
  roam: {
    entry: 'Roam', // the mode's display title (home card + screen header)
    entryKicker: 'NEW · RIDE ALONG', // home card kicker (label face uppercases anyway)
    entryAlpha: 'ALPHA', // tiny honesty badge
    entryBlurb: 'No route, no plan — I pipe up when we pass something I know a story about.',
    start: 'Ride along',
    end: 'End', // ghost header affordance → the sign-off
    // First-run ambient contract — the dead-air inoculation, done as a bit, shown ONCE.
    contract:
      'Here’s the deal: I talk when there’s something worth saying. The rest of the time I’m enjoying the view. It’s not awkward unless you make it awkward.',
    contractReassure:
      'You can change how chatty I am anytime — and a quiet drive is a perfectly good drive.',
    contractCta: 'Got it — let’s ride',
    // Session start — one line from a small placeless rotating pool, then settle into idle.
    sessionKicker: 'NOW ROLLING',
    sessionStart: [
      'Mornin’. Don’t mind me — just along for the ride.',
      'Hop in, hop in. Pretend I’m not even here.',
      'Go where you’re going — I’ll mind the scenery.',
      'Well, look who’s driving. I’ll keep an eye out for the good stuff.',
    ],
    // Riding-along idle — alive, never a spinner.
    ridingKicker: 'Riding along',
    simBadge: 'SIMULATED', // couch/dev clock
    idleTitle: 'All quiet — and that’s fine.',
    idle: 'Enjoying the view. I’ll pipe up when there’s something worth saying.',
    // The idle "wandering thought" — a placeless, time-of-day-keyed murmur pool that slow-
    // crossfades under idleTitle so the quiet reads as a person enjoying the ride, not a paused
    // app. PLACELESS + no facts (DESIGN §7) — pure companionable presence; the SELECTION knob
    // (clock bucket) picks, nothing generates. Screen-side of the "time-of-day opener" idea.
    idleMurmur: {
      morning: [
        'Roads are ours this hour. Half the world’s still asleep.',
        'Light’s still soft. Good time to be moving.',
        'Empty road, full tank. Can’t beat it.',
        'Fog’ll burn off up ahead. Patience — it’ll be a looker.',
        'Morning shift, just you and me. Drive easy.',
        'Nothing like an early start. I’ll mind the quiet.',
      ],
      day: [
        'Sun’s up, road’s open. This is the good part.',
        'Just here for the scenery, same as you.',
        'No rush. The good stuff finds us when it finds us.',
        'Plenty of road behind us, plenty ahead.',
        'Windows-down kind of light, if you ask me.',
        'Quiet stretch. Don’t mind me — I’m watching the hills.',
      ],
      dusk: [
        'Light’s going gold. My favorite hour to ride.',
        'Sun’s clocking out. Roads get honest about now.',
        'Headlights and quiet. Suits me fine.',
        'Cooler now. Engine likes it, so do I.',
        'Stars’ll be out before long. Keep her steady.',
        'Long shadows, easy pace. No place I’d rather be.',
      ],
    },
    storiesNearby: 'nearby', // stat pill before first encounter: "<n> nearby"
    storiesTold: 'told', // stat pill once encounters fire: "<n> told"
    musicPlaying: 'Your music · playing',
    musicDucked: 'Your music · ducked',
    musicHeld: 'Held · music back up', // encounter PAUSED — the rider's audio un-ducks
    // Chattiness — a SELECTION knob (which/how-many encounters fire), never a generation one.
    chattiness: {
      quiet: 'Quiet',
      normal: 'Normal',
      talkative: 'Talkative',
      a11y: 'How chatty the skipper is',
    },
    storyBadge: 'STORY', // encounter sheet badge (waves/B-sides arrive with their clips)
    skip: 'Skip',
    // Sign-off — the only ending; hand-ended sessions deserve a warm out.
    signoff: 'That’s me out, friend. Holler when you want company.',
    signoffTally: 'stories this drive',
    done: 'Done',
    locating: 'Getting my bearings…',
    loading: 'Checking which stories live out here…',
    noCoverage: 'I don’t know these roads yet, folks. Get me near Lake Tahoe and I’ve got stories.',
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
    // The location filter ("Where to?"): the picker title, the default/clear label, and the
    // soft-degrade empty line (we never dead-end — show what's charted).
    where: {
      all: 'All regions',
      title: 'Where are we headed?',
      empty: 'No charted roads out that way yet — here’s everything I’ve mapped so far.',
      showAll: 'Show all drives', // reset the region filter from the (near-impossible) empty state
    },
  },
  driveComplete: 'That’s the end of the road, folks. Watch your step climbing out.',
  // Confirm before ending a live drive — one stray thumb shouldn't wipe a run in progress.
  confirm: {
    endTitle: 'Pull over and end the drive?',
    end: 'Pull over',
    keepRolling: 'Keep rolling',
  },
  // Offline-first fallback notes: shown when the network's gone but a saved copy carries us.
  offline: {
    home: 'No signal out here — showing the drives you’ve saved.',
    detail: 'No signal out here — running on the saved copy.',
    // A saved drive whose clips were re-cut on the server: the chip flag + the ⋯ menu action to
    // re-pull. Never forced — offline play keeps working on the copy you’ve got.
    updateReady: 'Fresh cut ready',
    update: 'Pull the fresh copy',
  },
  auth: {
    // "folks" is the skipper's address everywhere else (loading, GPS, drive-complete) — keep
    // it consistent here instead of the one-off "traveler".
    signInHeader: 'Welcome back, folks',
    signUpHeader: 'Come along for the ride',
    // Road idiom, not the London-Underground "Mind the gap" (the persona is a road-trip guide).
    subhead: 'Mind the potholes.',
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
    // Developer section: the sim-mode toggle (Settings → Developer). Visible on every
    // build for now (zero real users) — gate before GA if it ever needs hiding.
    developer: 'DEVELOPER',
    developerHint:
      'Simulated GPS replays a recorded Tahoe drive through the real engine — test free-roam and the live drive from the couch, no car required. Takes effect next time you start one.',
    simModeReal: 'Real GPS',
    simModeSimulated: 'Simulated',
    simModeA11y: 'GPS source',
    showDiagShow: 'Show',
    showDiagHide: 'Hide',
    showDiagA11y: 'Diagnostics overlay',
    showDiagHint:
      'Show the pin count + GPS fix age + nearest-pin distance on the roam canvas. Useful for field-testing real drives; hidden by default so the idle reads clean.',
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
