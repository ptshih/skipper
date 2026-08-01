// The skipper's voice, in the UI. Microcopy is brand-critical here — the persona
// is the product, so loading/empty/error/CTA strings stay in character. Keep them
// warm, corny, and SHORT (glanceable). Facts never live here; this is delivery.
export const voice = {
  loading: {
    drives: 'Charting the good roads…',
    drive: 'Pulling the logbook…',
  },
  empty: {
    drive: 'This drive took a wrong turn. Head back and pick another.',
  },
  error: {
    generic: 'Well, that’s a kink in the hose. Give her another pull?',
    retry: 'Give her another pull',
    download: 'Couldn’t pull the clips down — signal’s thin out here. Give it another go?',
    storage: 'No room left in the hold — clear some space and we’ll stow the drive.',
  },
  cta: {
    play: 'Let’s roll', // short: the center CTA is now flanked by the ±15s skip buttons
    pause: 'Hold here',
    resume: 'Roll on again',
    restart: 'Run it again, skipper',
    drive: 'Start the drive', // open the live, GPS-triggered player (real device GPS)
    simDrive: 'Simulate the drive (dev)', // dev-only: the on-device drive simulator, no real GPS
    endDrive: 'Pull over', // stop the drive and head back to the start line
    backToTrailhead: 'Back to the trailhead', // leave the drive-complete card without replaying
  },
  // The drive-detail mini-preview: tap a stop (a list row or a map pin) to hear that ONE clip on the
  // couch, before ever driving. Discrete stop-by-stop — the old full-screen couch "simulated drive"
  // was cut (docs/decisions/detail-page-mini-preview.md). Glanceable, warm.
  preview: {
    viewLabel: 'Route view', // segmented-toggle group a11y label
    viewList: 'List',
    viewMap: 'Map',
    hint: 'Tap a stop to hear it.',
    nowPlaying: 'NOW PLAYING',
    // A tapped stop whose audio can't be resolved here (a partial download that never landed this clip).
    unplayable: 'That stop didn’t come down with the rest — pull the drive again and I’ll have it.',
  },
  gate: {
    title: 'Grab your ticket',
    body: 'The full drive needs a (free) ticket — ten seconds, and the skipper never stops talking.',
    action: 'Get my free ticket',
    secondary: 'Just take the sample ride', // the play-screen gate → routes to /sample (the postcard)
    keepBrowsing: 'Keep browsing', // the detail download-gate → dismiss back to the drive
    // Context line for the live-drive gate — carries ONLY what the body lacks (the body
    // already makes the ticket ask), so the two don't stutter "needs a (free) ticket" twice.
    driveNote: 'This is the live, on-the-road drive.',
  },
  // The live, GPS-triggered drive: the skipper talks when the road reaches a stop, not on
  // a timer. Kept short + glanceable for the mount.
  drive: {
    ready: 'READY TO ROLL', // pre-drive placard kicker
    readyBody: 'Mount up and start when you’re on the road. I’ll pipe up when we reach the good stuff.',
    blurb: 'The skipper talks as you reach each stop on the real roads.', // drive-detail explainer under the Start CTA
    sim: 'SIMULATED DRIVE', // the on-device sim setup — no real GPS yet
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
    // Pre-permission PRIMING (live drive, first time only — shown right before iOS's
    // one-shot location prompt). A short in-character "why I need your location" so a cold ask
    // doesn't get denied. HARD RULE (App Store 5.1.1(iv)): a pre-prompt must NOT carry a
    // "Not Now"/dismiss — its only action leads straight into the system prompt (the rider backs
    // out, if at all, via the nav-bar BEFORE it). Worded to survive the future When-In-Use→Always
    // escalation without a rewrite.
    locationPrimeKicker: 'BEFORE WE ROLL',
    locationPrimeTitle: 'I steer by your GPS',
    locationPrimeBody:
      'I call out each stop the moment we roll up to it — so I need your location while we’re on the drive. Your phone will ask next; let me know it’s a yes.',
    locationPrimeReassure: 'Only while you’re on a drive. Parked, I’m off the clock — no tracking.',
    locationPrimeCta: 'Switch on location',
  },
  player: {
    buffering: 'Warming up the skipper…',
    stall: 'Couldn’t load that stop — skipping ahead.',
    nowPlaying: 'NOW PLAYING', // emoji kept OUT of label strings (custom font = tofu)
    paused: 'PAUSED', // a held clip — the NOW card must not keep saying "NOW PLAYING"
    rolling: 'ROLLING', // between stops — road-trip, not the flat "DRIVING"
    rollingOpen: 'On the open road', // rolling-card title when there's no next stop queued yet
    replay: 'Replay that', // re-hear the stop that just ended — plain chrome, NOT the skipper's voice (replay-last-stop)
    gpsSearching: 'Looking for the satellites — hang tight.', // live drive, no usable fix yet
    gpsError: 'Lost the GPS signal, folks. Pull over and give her another go.', // live watch failed
    driveCompleteKicker: 'DRIVE COMPLETE', // the done-card kicker
    arrived: 'You’ve arrived', // the done-card title
    // A quiet, non-alarming chip in the live player (M7): the drive is running entirely off the saved
    // download (so a dead zone won't bite). Mirrors the drive-detail "Saved offline" chip's tone.
    offlinePlayback: 'Playing from download',
  },
  // The "postcard" — one curated Tahoe clip a stranger anywhere can hear (the /sample screen). The
  // front-door taste for everyone outside the corpus AND the App Review path. Fact-free (the poi
  // name is a FACT, served by the API, never baked here). Warm, corny, glanceable.
  sample: {
    kicker: 'POSTCARD FROM LAKE TAHOE',
    badge: 'A TASTE', // teal — honest "this is a sample, not a live drive"
    loading: 'Cueing up something good from the lake…',
    endTitle: 'That’s the taste, friend.',
    endBody:
      'One stop of a few hundred up around the lake. Point me at a road up there and I’ll do this the whole drive.',
    endCta: 'Plan a drive',
    endSecondary: 'Maybe later',
    // Home cold-open ghost link, under the primary CTA — the guaranteed, permission-free path for a
    // first-timer nowhere near Tahoe. No number promised (the clip runs about a minute).
    homeLink: 'Not near Tahoe? Hear a quick sample.',
  },
  greeting: 'Hop in. I’ll do the talking.',
  // The cold-open descriptor: a newcomer should know WHAT this is before any audio
  // plays. Clear first, persona second — the deadpan stays, just aimed.
  // ⚠ Named BOTH modes until roam was removed (it had been co-equal on home, founder 2026-06-11).
  // Now there is one artifact, so the line says one thing. (Wording is a quick founder tweak.)
  tagline: 'Narrated road trips — you pick the road, I’ll do the talking. One corny guide the whole way.',
  // The home hero's enamel flourish: a departures-board kicker ABOVE the headline
  // (deliberately NOT repeating the tagline). Warm, corny, glanceable, no facts.
  home: {
    kicker: 'NOW DEPARTING',
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
    // The honest failure. Stands in for voice.error.generic whenever the request never left the
    // phone (see api.ts OfflineError) — the generic "kink in the hose" line covers a 500, a parse
    // blip and a GPS timeout equally, and pairs with a retry button that cannot possibly work out
    // here. Same "No signal out here" opening as its two siblings above so the three read as one
    // idea; the second clause is the part that changes (nothing saved to fall back ON).
    noSignal: 'No signal out here — and this one needs a bar or two. Try again when they’re back.',
    // Home, offline: ONE heads-up note above the CTA. The CTA stays LIVE and tappable — a nudge,
    // never a block, like every other offline call in this app ("never strand a rider", "Start
    // anyway"): the app fails instantly and in voice rather than spinning, so the tap costs nothing.
    // The note names the one thing that truly can't happen out here (creating a drive needs the
    // network) and doesn't pretend to speak for the rest — saved drives play fine.
    needsSignal: 'No signal out here — creating a drive will have to wait for a bar or two.',
    // Appended when there ARE saved drives, so the screen ends on what still works rather than on
    // what doesn't. Omitted when the list is empty (it would promise nothing).
    needsSignalSaved: 'Your saved drives below still play.',
    // A saved drive whose clips were re-cut on the server: the chip flag + the ⋯ menu action to
    // re-pull. Never forced — offline play keeps working on the copy you’ve got.
    updateReady: 'Fresh cut ready',
    update: 'Pull the fresh copy',
    // A PARTIAL download (H2): some clips didn't come down (thin signal), but the rest are saved and
    // playable. Honest, not alarming — the count is filled in by the caller; the ⋯ re-pull grabs the
    // stragglers.
    partialSuffix: 'left to save', // → "3 left to save" (chip)
    retryPartial: 'Finish the download', // ⋯ menu re-pull for a partial
    // A download past its freshness TTL (OFFLINE_TTL_DAYS, ~30d): the saved bytes still play, but may
    // carry stale facts / a superseded cut the content-diff never caught (a copy saved once and never
    // re-opened, or held in a dead zone). SOFT — a nudge, never a block.
    expired: 'Saved a while back', // chip
    refresh: 'Refresh the download', // ⋯ menu re-pull for an expired copy
    // NOT saved — the honest counterpart to the "Saved offline" chip. This slot used to render
    // NOTHING when a drive wasn't downloaded, so streaming (and the dead-zone stop-skipping it
    // invites) was the silent, invisible default. Neutral tone: streaming is a legitimate choice on
    // a road with signal, so this states a fact, it doesn't scold.
    notSaved: 'Not saved',
    // Bytes on disk that THIS build can't read — a saved manifest in a format with no migration
    // across (see offline.ts MANIFEST_MIGRATIONS). Distinct from "Not saved" because it is
    // actionable and costs real space: the ⋯ menu offers a re-pull and a remove. Short, because it
    // rides in a chip; the ⋯ actions carry the what-to-do.
    unreadable: 'Saved copy needs refreshing',
    // The ⋯ action for the state above. The audio is all still on the phone — only the little index
    // file is unreadable — so the honest offer is "put it back together", NOT "download it again".
    // Says "without downloading it again" because that is the whole point to the rider.
    repair: 'Recover it without downloading again',
    // Repair ran but matched nothing on disk (bytes for a different cut, or a stripped dir). Points
    // at the two things that DO work from here; both live in the same ⋯ menu.
    repairFailed:
      'Couldn’t match what’s on the phone to this drive. Download it again, or remove the leftovers.',
    save: 'Save for offline', // the main-path button under the Start CTA (was ⋯-menu-only)
    saveHint: 'Tahoe has dead zones — best done before you lose signal.',
    // The one warning in front of a live drive that hasn't been saved. NEVER a block: the rider may
    // be on a road with good signal, or just auditioning from the couch. `useDrive`'s stall watchdog
    // skips any clip that won't load, so an unsaved drive through a dead zone loses those stops
    // SILENTLY — this is the only moment we can say so while it's still fixable.
    unsavedTitle: 'This drive isn’t saved yet',
    unsavedBody:
      'Out where the signal drops, any stop that can’t load gets skipped — you’d drive right past it in silence. Saving it first takes a moment, and then the whole drive plays off your phone.',
    unsavedSave: 'Save it first',
    unsavedStart: 'Start anyway',
  },
  auth: {
    // "folks" is the skipper's address everywhere else (loading, GPS, drive-complete) — keep
    // it consistent here instead of the one-off "traveler".
    signInHeader: 'Welcome back, folks',
    signUpHeader: 'Come along for the ride',
    // Road idiom, not the London-Underground "Mind the gap" (the persona is a road-trip guide).
    subhead: 'Mind the potholes.',
    // Password reset — the ONLY way back into a locked-out account (email/password is the only
    // sign-in method in prod, and there's no email verification). The rider here is anxious and
    // possibly about to lose their drives and credits, so the copy drops the bit and just helps.
    forgot: 'Forgot your password?',
    resetHeader: 'Let’s get you back in',
    resetHint:
      'Give us the email you signed up with and we’ll send a link to set a new password. The link works once and runs out after an hour.',
    resetSend: 'Send the link',
    // ⚠ Deliberately enumeration-safe: this reads the SAME whether or not the account exists,
    // mirroring the server's own reply. Anything more specific ("no such account") would turn the
    // form into an oracle for which emails are registered.
    resetSent:
      'If that address is one of ours, the link is on its way. Go check your email — and mind the spam bin.',
  },
  settings: {
    account: 'ACCOUNT',
    appearance: 'APPEARANCE',
    // Explains all three options + reassures that the default needs no fiddling: a
    // night drive dims itself. Persona-light, still informative.
    appearanceHint:
      'Auto rides with your phone — dusk-dark when the sun clocks out, bright by day. Pin Day or Dusk to hold one mood.',
    // "SOURCES", not "CREDITS": this section is ATTRIBUTION (where the facts and music came from —
    // credits as in a film's credits). The app now has literal drive CREDITS (the credit_entries
    // ledger, surfaced on Home), and one label meaning both sent riders here looking for a balance.
    sources: 'SOURCES',
    sourcesAction: 'Sources & licenses', // → /legal
    // The two public documents the App Store listing points at. They open on the web (skipper.fm)
    // rather than shipping as in-app copy, so a policy fix never waits on a release.
    legal: 'LEGAL',
    privacyAction: 'Privacy policy',
    termsAction: 'Terms of use',
    // Account deletion — App Store Guideline 5.1.1(v) requires it in-app for any app that creates
    // accounts. Every word is load-bearing and the persona stays out of it: deletion is immediate,
    // total, and forfeits unspent credits (the ledger never refunds — docs/decisions/credit-ledger.md).
    // A rider must not be able to read this as a fancier "Sign out".
    deleteAccount: 'Delete account',
    deleteIntro:
      'This removes your account, your saved drives, and any credits you have left. It happens straight away and can’t be undone.',
    deletePasswordLabel: 'Enter your password to confirm',
    deleteAction: 'Permanently delete',
    deleteTitle: 'Delete your account?',
    deleteBody:
      'Your account, your drives, and your remaining credits go for good. This can’t be undone.',
    deleteCta: 'Delete forever',
    deleteFailed: 'Could not delete your account',
    // Developer: an admin-only sub-screen (Settings → Developer → /developer), gated on the
    // server-set user.role (Better Auth admin plugin) === 'admin'. `developer` labels the entry
    // row; the controls (sim GPS) live on the sub-screen. They used to sit inline on Settings for
    // everyone — they moved behind the gate once the admin role existed.
    developer: 'DEVELOPER',
    developerAction: 'Developer tools', // → /developer (admin-only)
    developerTitle: 'Developer',
    developerIntro:
      'Admin-only tools. These ride along with you on field drives — leave them off unless you’re testing.',
    developerLoading: 'Checking your credentials…',
    developerLocked: 'These tools are for admins only.',
    simModeLabel: 'SIMULATED GPS',
    developerHint:
      'Simulated GPS replays a recorded Tahoe drive through the real engine — test the live drive from the couch, no car required. Takes effect next time you start one.',
    simModeReal: 'Real GPS',
    simModeSimulated: 'Simulated',
    simModeA11y: 'GPS source',
  },
  // The unified source-credit reveal — the ⓘ on the drive player + sample, and the
  // sheet it opens. `open` is the button's a11y label; `adapted` is the modification notice CC
  // BY-SA / CC BY require wherever an adapted work is presented. The work titles, license codes,
  // and deed links are FACTS (rendered by SourceCredit from @/lib/licenses), never here. Distinct
  // from the app-wide catalog below (legal — Settings → Sources).
  attribution: {
    open: 'Show sources',
    heading: 'SOURCES',
    adapted: 'The skipper’s telling is adapted and condensed from:',
    close: 'Done',
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
