// The skipper's voice, in the UI. Microcopy is brand-critical here — the persona
// is the product, so loading/empty/error/CTA strings stay in character. Keep them
// warm, corny, and SHORT (glanceable). Facts never live here; this is delivery.

const SPELLED = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'] as const

/**
 * A duration the way the skipper would SAY it, not the way a form would print it.
 *
 * ⚠ This exists because the first cut read "You said about 120 minutes" back to a rider who had said
 * "about two hours" — technically the same number and completely out of character. The rider's stated
 * duration is always a ROUND, casual figure ("a couple of hours"), so echoing it in raw minutes is the
 * one place this card can sound like a receipt. Only the ASK goes through here; the materialized
 * duration stays in exact minutes, because that one is a measurement and precision is the point.
 */
export function spokenDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  const hours = h === 1 ? 'an hour' : `${SPELLED[h] ?? h} hours`
  if (m === 0) return hours
  if (m === 30) return h === 1 ? 'an hour and a half' : `${SPELLED[h] ?? h} and a half hours`
  return `${hours} ${m} minutes`
}

export const voice = {
  loading: {
    drives: 'Charting the good roads…',
    drive: 'Pulling the logbook…',
  },
  empty: {
    drive: 'This drive took a wrong turn. Head back and pick another.',
    // MY DRIVES' three degraded states. ⚠ `drives` is a VERBATIM move of the literal that lived in
    // home's zero state — it was lifted, never re-authored, so the move could not hide a rewrite.
    drives: 'No drives yet. Plan one and it lands here for the road.',
    drivesAction: 'Plan a drive',
    drivesSignedOut:
      'Your drives ride with your ticket, friend. Grab one and they’ll be waiting right here.',
  },
  filter: {
    /** MY DRIVES' region filter. ⚠ THE ESCAPE HATCH, and the reason it is not optional: with drives
     *  scoped to one region, this is the only thing standing between a rider and a library that looks
     *  emptied because a chip moved. The region chips beside it are DATA (each region's own display
     *  name, server-derived per drive), so this is the one word here that is copy.
     *  ⚠ Short on purpose — it renders through the `label` type scale, which is UPPERCASE small-caps;
     *  the spoken form below is what a screen reader gets instead. */
    allRegions: 'All',
    allRegionsA11y: 'All regions',
  },
  credits: {
    /** The gentle remaining-balance line. ⚠ THE SENTENCE ONLY — *whether* it appears at all is
     *  `<CreditHint>`'s threshold, and it lives there so the rule cannot be written twice (it already
     *  had been, on home and on MY DRIVES, and two copies of a rule drift in silence). */
    left: (remaining: number) =>
      remaining > 0
        ? `${remaining} free ${remaining === 1 ? 'drive' : 'drives'} left`
        : 'No free drives left',
  },
  error: {
    generic: 'Well, that’s a kink in the hose. Give her another pull?',
    retry: 'Give her another pull',
    download: 'Couldn’t pull the clips down. Signal’s thin out here. Give it another go?',
    storage: 'No room left in the hold. Clear some space and we’ll stow the drive.',
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
  // THE PLANNER — home IS a conversation with the skipper (1.1, D6). He plans the drive by TALKING.
  //
  // ⚠ THIS IS THE CLIENT'S HALF OF A VOICE THE SERVER ALSO SPEAKS, and the two are not the same file.
  // The live turns come from `apps/api/src/planner-prompt.ts`; everything here is the chrome around
  // them — the cold open, the canned first exchange, and the honest lines for when the machinery is
  // down. Read that prompt before editing any of this, because the two are heard as one character in
  // the same scroll view: he is warm, corny on purpose, deadpan, SHORT (one to three sentences), and
  // he never says what a place IS. Never copy the narration prompt's fact-sheet language into either.
  //
  // ⚠ NO PLACE NAMES HERE (DESIGN.md §7 — voice is delivery, never facts). The example asks are
  // TEMPLATES: `{a}`/`{b}` are filled from the region's OWN curated names (`region.exampleAnchors`),
  // so a chip can never name a place the skipper does not run. Hardcoding one would be a chip that
  // dead-ends in "do not know that one" on the highest-intent tap on the screen.
  plan: {
    // The skipper's cold open. ⚠ DISPLAY-ONLY — it must NEVER ride the wire. The server reads a
    // transcript whose first turn is not the rider's as a forged shape and fails the turn
    // (apps/api/src/planner.ts toModelMessages), which surfaces to the rider as a permanent outage
    // on a message they typed innocently. `toWire()` drops it; that is what the `wire` flag is for.
    // ⚠ SPLIT IN TWO, and the split is the layout: the QUESTION takes the screen's display slot (it
    // is the hero now — the travel-poster headline it used to sit under is gone) and the HINT stays
    // small beneath it. One string could not be typeset as two sizes. Same display-only rule applies
    // to both halves.
    // ⚠ "Well now —" was cut with the kicker (founder, 2026-08-03): at display size the tic ate a
    // line and pushed the actual question down. The register still reads as him because the hint
    // underneath carries it.
    openingQuestion: 'Where are we headed?',
    openingHint: 'A rough idea is plenty; I’ll take it from there.',
    // A region with no curated endpoints yet. Not an error and not the rider's fault — the honest
    // "coming soon", in character. (The server has its own line for an UNKNOWN region; this one is
    // for a known region whose curated set is still empty.)
    openingUncurated:
      'I don’t run any roads around here yet, friend. Check back; I’m always picking up new ones.',
    composerPlaceholder: 'Tell me where to',
    // ⚠ ONCE THE TRANSCRIPT IS LIVE THE FIELD IS A REPLY BOX, so it gets its own line. The rotation
    // is already vetoed at the first rider turn (`shouldRotatePlaceholder`'s `coldOpen`), but
    // stopping a timer only FREEZES the example that happened to be up — leaving "2 hours, no
    // highways" sitting under a skipper turn that just asked how long they want to be out, which
    // reads as a stale instruction rather than a prompt. Teaching copy has to leave when its job
    // ends. Static, and no `{a}`/`{b}`: every authored reply ends on a direct question, so this
    // only has to hand the ball back.
    composerReplyPlaceholder: 'Go on, I’m listening',
    // ⚠ SHAPES, not sentences — `{a}`/`{b}` are filled from the region's own curated names, so the
    // placeholder can never name a road the skipper does not run. The rows teach WHAT kinds of thing
    // to ask for; these teach HOW CASUALLY you may say it, which is why they are lowercase and
    // sloppy. Anything that does not fit the field is dropped rather than wrapped (a field that
    // changes height every few seconds under a thumb is worse than the rotation is good).
    // ⚠ The name-free ones are load-bearing: they are what still rotates in a region with no curated
    // anchors at all.
    // ⚠ TYPED, not written — the register they have to pass for is "someone else's message", and the
    // first cut failed it three ways: spelled-out numbers ("back by five") where a thumb types digits,
    // an article-first fragment ("a loop out of…") that reads as a menu item rather than a sentence
    // anyone sends, and an idiom sitting where the ASK goes ("the long way round" requests nothing).
    // Every line must be something the planner could actually act on, or it is copywriting wearing a
    // placeholder's clothes.
    // ⚠ The two-name shape is BARE on purpose. Anything hung off it ("…, the scenic way") pushed it
    // past the field's char cap for every real pair of curated names — a line authored, reviewed, and
    // rendered to nobody. The chips above already teach the scenic-way phrasing and carry no cap, so
    // this one spends its whole budget on the names and stays reachable wherever they are short.
    placeholderShapes: [
      '{a} to {b}',
      // ⚠ 'loop out of {a}' was REMOVED 2026-08-03 and must not come back: a loop is an EXPLICIT-ASK
      // exception now (docs/decisions/no-same-road-loops.md §8), so a placeholder teaching one is the
      // app doing precisely what the skipper was just stopped from doing — offering a shape it cannot
      // know the roads support.
      'somewhere pretty, back by 5',
      'kill an hour before dinner',
      // ⚠ '2 hours, no highways' and 'just take the long way' WERE HERE AND ARE GONE (founder,
      // 2026-08-04: "some of them don't make any sense"). They are not merely odd — they coached the
      // rider into the one ask the skipper is INSTRUCTED TO REFUSE. apps/api/src/planner-prompt.ts,
      // "When they ask about the road": *"Folks will ask for the pretty way, no highways, back by
      // five, the long way round. You pick the two ends; the map picks the road between them, and you
      // do not get a vote."* So the highest-visibility teaching copy in the app was demonstrating a
      // sentence whose scripted reply is a deflection.
      // ⚠ AND THE RULE WAS ALREADY WRITTEN, four lines up: "an idiom sitting where the ASK goes ('the
      // long way round' requests nothing)" — rejected in the first cut and back in a reworded form.
      // What a name-free placeholder may ask for is bounded by what the planner actually resolves
      // (CLAUDE.md: endpoints as anchor ids, `via`, round-trip, duration target). With no NAME in the
      // line that leaves duration, round-trip and "you pick" — which is why the replacements below
      // lean on time and shape rather than on the road.
      'out and back, about 2 hours',
      'anywhere good, i have the afternoon',
    ],
    composerA11yLabel: 'Tell the skipper where to',
    sendA11yLabel: 'Send',
    // The beat between the rider's line and the first token coming back. ⚠ Never "checking the map" —
    // the skipper is given no map, no coordinates and no distances, and says so; a line that claims
    // otherwise contradicts the character on the one screen where he speaks live.
    thinking: 'Chewing on that…',
    // Static, and it must STAY static: it labels the animated dots for a screen reader, and a label
    // that changes while a turn streams re-announces on every flush (the NowCard live-region lesson).
    thinkingA11y: 'The skipper is thinking',
    // The tappable example asks (D17). Each demonstrates a DIFFERENT ask shape — not a set of
    // destinations, which would just rebuild the picker D7 deleted.
    // ⚠ THERE IS NO LOOP CHIP, and adding one back is a product decision, not a copy decision. It was
    // removed 2026-08-03 when a loop became an EXPLICIT-ASK exception
    // (docs/decisions/no-same-road-loops.md §8): the skipper may not offer a shape he cannot know the
    // roads support, and a chip we authored is the app making that same offer with his voice. Its
    // seeded reply was the sharper problem — "Out of {a} and back around. Where do you want to turn
    // around?" put a loop the skipper had already agreed to into the transcript AND skipped the
    // way-home beat, i.e. in-context precedent teaching the model a flow the wire now refuses.
    // ⚠ Each `…Reply` is a hand-authored skipper turn seeded WITHOUT a model call: the highest-traffic
    // turn in the app costs zero dollars and is founder-quality prose. It ships INTO the transcript, so
    // the model sees what it "already said" — which is why every reply ends by asking for the one thing
    // still missing, exactly as the prompt's "ask ONE thing at a time" rule requires.
    // ⚠ THE TITLES ARE PURE DELIVERY — no `{a}`/`{b}`, so they never name a place and never need
    // filling. That is the whole seam: the TITLE says what SHAPE of drive this is (short, verb-first,
    // legible at a glance), the SUBTITLE underneath is the literal sentence the tap will say, filled
    // from the region's own names. A sentence crammed into a chip was the original complaint.
    // ⚠ THE COLD-OPEN SUGGESTIONS NO LONGER LIVE HERE (2026-08-04). Their titles and rider lines are
    // served by GET /planner/copy and filled with the region's own names on arrival — see
    // apps/api/src/planner-copy.ts, which carries the reasoning. Two things drove them out. First, the
    // chips used to seed a hand-authored SKIPPER reply alongside the rider's line; that prose drifted
    // from the planner prompt and kept asking "About how long do you want to be out?" for a day after
    // the prompt banned it, invisible to every test and unfixable by deploying. Second, once the words
    // and the prompt have to agree, they must also SHIP together — and copy in the binary cannot.
    // ⚠ Do not re-add a suggestion string here "just as a fallback". A default in the app is precisely
    // what was deleted: it is the copy nobody remembers to update, and it fails silently by looking
    // fine. No copy means no rows, which is visible.
    // The turn cap (D12). ⚠ The composer is REPLACED by these, never greyed out — a disabled field
    // reads as broken, and the skipper bowing out in character is the whole point of the cap being
    // expressed in persona rather than as an error.
    wrapUpDrawItUp: 'Draw it up',
    wrapUpStartFresh: 'Start fresh',
    // Offline (D18). The conversation genuinely cannot happen out here, so this states that plainly
    // and then points at what still works. ⚠ It does not say "below": offline, MY DRIVES moves ABOVE
    // this card.
    offlineTitle: 'Parked till the signal’s back',
    offlineBody: 'Planning a drive takes a bar or two, friend. Your saved drives play out here just fine.',
    // A model/transport outage (RISK-2). ⚠ Reachable ONLY from a transport failure — the server
    // catches every planner failure and answers 200 with its own in-persona line, deliberately, so
    // there is nothing to detect. Never build a heuristic on what `say` contains.
    outageTitle: 'Lost you for a second there',
    outageBody: 'Something between us dropped the line. Give it another go and I’ll pick up where we left off.',
    outageRetry: 'Try me again',
    // Above the region's curated names on both degraded cards — so a stuck screen still says something
    // TRUE and useful instead of only apologising.
    anchorsIntro: 'Here’s the country I run:',
    sendFailed: 'That one didn’t make it out. Give it another go?',
  },
  // The inline route card the conversation produces (D13) — the drive as drawn, before a credit is
  // spent. ⚠ Distinct from `preview` below, which is the drive-DETAIL mini-preview (tap a stop to hear
  // it). Two different surfaces; keeping one `preview` key for both is how they drift.
  proposal: {
    kicker: 'YOUR DRIVE',
    drawing: 'Drawing it up…',
    drawFailed: 'Couldn’t plot that one. Give me a different pair and I’ll try again.',
    cta: 'Make this drive',
    // ⚠ TWO disclosures, and which one shows is load-bearing (D29). Signed in: name the cost before
    // spending it. Signed OUT: name OWNERSHIP only and never a number — a fresh account's grant does
    // not exist until after signup, so any count here would be a guess printed as a fact.
    costNote: 'Uses one of your free drives.',
    ownershipNote: 'You’ll need a free account to keep this drive.',
    adjust: 'Change it up',
    // ⚠ THE TAP'S ONLY VISIBLE ANSWER, so it is not decoration. Until 2026-08-03 "Change it up" did
    // nothing but focus the composer — correct, and effectively invisible: on the simulator (where
    // every desk pass happens) a connected hardware keyboard suppresses the software one, so the
    // whole response was a caret appearing in a field that already looked identical, and it was
    // ⚠ `adjustSay` MOVED TO THE SERVER (2026-08-04) — GET /planner/copy. It is SEEDED into the
    // transcript as the skipper's own sentence and rides the wire, so the model re-reads it as
    // something he already said: prompt surface, which has to deploy with the prompt rather than with
    // an App Store release. Its reasoning (why "longer, shorter" is deliberate and must not be
    // "fixed") travels with it, in apps/api/src/planner-copy.ts.
    // ⚠ `noStopsSay` MOVED TO THE SERVER (2026-08-04) — GET /planner/copy, for the same reason as
    // `adjustSay`: it is seeded as the skipper's own turn and ships on the wire. `noStops` here is the
    // CARD's label and STAYS — it is interface text the model never sees, so it cannot contradict the
    // prompt. It is also what makes omitting the seeded beat safe when the copy fetch fails: this line
    // still states the case on the card.
    // A route the corpus has nothing to say about. The server returns 200 with zero stops, so this is
    // the only thing standing between a rider and a credit spent on a silent drive.
    noStops: 'Nothing along that road I can talk about yet.',
    // Fallback ONLY. The server's own 403 names the limit and the way past it; show that when it comes.
    capReached: 'That’s the last of your free drives, friend.',
    openMade: 'Open the drive',
    // The skipper owning up when the drive doesn't match the time the rider named. ⚠ IN PERSONA and
    // never an error: the route is perfectly good and they may well still want it. It exists because
    // the alternative is worse — he agrees to "about two hours" in the transcript and the card prints
    // 54 MIN right above the CTA, which reads as him not listening. Naming it costs one line and
    // turns a contradiction into candour. ⚠ Says nothing about WHY (that would be a place fact, D9)
    // and offers no fix — "Change it up" is already the affordance directly below.
    durationShort: (asked: number, actual: number) =>
      `You said about ${spokenDuration(asked)}; this one runs closer to ${actual} minutes. Still worth the trip.`,
    durationLong: (asked: number, actual: number) =>
      `You said about ${spokenDuration(asked)}; this one runs closer to ${actual} minutes. Longer road than you asked for.`,
    // ONE real clip from the rider's OWN route, before the wall (D14/INV-5). ⚠ The whole charm of it
    // is that it is not a generic sample — it is the first thing they will actually hear on this drive
    // — so the copy has to say "yours" without naming the place (that is a FACT, served by the API).
    clipKicker: 'A TASTE OF THIS ONE',
    clipHint: 'Here’s the first stop on that road. Go on, have a listen.',
    clipPlayA11y: 'Play the preview clip',
    clipPauseA11y: 'Pause the preview clip',
    // ⚠ Deliberately NOT retryable-sounding: the presigned url is dead and this surface has no way to
    // re-sign one (that endpoint is owner-only). Offer the drive, not a retry that cannot work.
    clipUnavailable: 'That clip’s gone cold on me. Make the drive and you’ll get the whole telling.',
    // ⚠ NOT 'NOW PLAYING'. `voice.player.nowPlaying` and `voice.preview.nowPlaying` already exist for
    // two other surfaces; a third identical string is exactly the drift this file keeps warning about.
    clipBarKicker: 'HAVE A LISTEN',
    clipBarDismissA11y: 'Stop the preview clip',
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
    unplayable: 'That stop didn’t come down with the rest. Pull the drive again and I’ll have it.',
  },
  gate: {
    title: 'Grab your ticket',
    body: 'The full drive needs a (free) ticket. Ten seconds, and the skipper never stops talking.',
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
    /**
     * REPLACES `readyBody` when the download is incomplete — the ONE time the rider is told, on the
     * ready card, while still parked and able to act on it.
     *
     * ⚠ It exists because the gap was otherwise SILENT BY CONSTRUCTION: a partial copy plays with the
     * same "Playing from download" chip a complete one shows, and a stop with no audio is skipped
     * after 400 ms with no note — so the rider drove past it hearing nothing and being told nothing.
     *
     * ⚠ Owning the gap out loud is the PERSONA, not an apology bolted onto it: the honest streak is
     * the heart of him, so he names the number and says plainly what it will sound like. No hedging,
     * no "some content may be unavailable". And no boat — "all aboard" and its family are banned
     * (see the planner + narration prompts), which is why this says "the rest of the drive is all
     * here" rather than the nautical line that wants to go there.
     */
    readyBodyPartial: (missing: number): string =>
      `${missing} ${missing === 1 ? 'stop' : 'stops'} didn’t finish saving, so I’ll be quiet when we pass ` +
      `${missing === 1 ? 'it' : 'them'}. The rest of the drive is all here.`,
    sim: 'SIMULATED DRIVE', // the on-device sim setup — no real GPS yet
    // The same fact as a TAG, for the player header where it shares a line with the stop counter.
    // The header used to spell out "live drive" / "simulated drive" on its own line; only the
    // simulator half was ever news, so only that half survived.
    simTag: 'SIM',
    nextStop: 'next stop', // "ROLLING · next stop: <name>"
    // Location-permission gate (live drive only): three states — can re-ask, must visit Settings
    // (denied), or location’s on but only APPROXIMATE (iOS Precise Location off → fixes too coarse
    // to trigger stops; the only fix is the Settings toggle, so it routes there like a hard denial).
    locationNeeded: 'I steer by your GPS. Switch on location and I’ll call out each stop as we reach it.',
    locationBlocked: 'Location’s switched off for me. Flip it on in Settings and we’ll hit the road.',
    locationReduced:
      'You’ve handed me approximate location, and at that blur I’d sail right past the stops. Switch on “Precise Location” in Settings and I’ll call them on the nose.',
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
      'I call out each stop the moment we roll up to it, so I need your location while we’re on the drive. Your phone will ask next; let me know it’s a yes.',
    locationPrimeReassure: 'Only while you’re on a drive. Parked, I’m off the clock. No tracking.',
    locationPrimeCta: 'Switch on location',
  },
  player: {
    buffering: 'Warming up the skipper…',
    stall: 'Couldn’t load that stop. Skipping ahead.',
    nowPlaying: 'NOW PLAYING', // emoji kept OUT of label strings (custom font = tofu)
    // The itinerary ROW's version of the same idea. Short because it shares a line with a stop
    // name: the card can afford "NOW PLAYING", a 48pt row next to "Round Hill Village" cannot.
    now: 'NOW',
    paused: 'PAUSED', // a held clip — the NOW card must not keep saying "NOW PLAYING"
    // The one beat the pause control was missing: he's still in the car while you're stopped. Pairs with
    // the CTAs, which already speak as him ('Hold here' / 'Roll on again'). Deliberately says NOTHING
    // about where you stopped or why — he has no eyes and no live data, and a concierge who names places
    // was cut on purpose (docs/decisions/cut-mid-drive-concierge.md). Landscape permanence is the joke;
    // it's the one observation he can always make without perceiving anything.
    pausedBody: 'Take your time. Nothing out here is going anywhere.',
    rolling: 'ROLLING', // between stops — road-trip, not the flat "DRIVING"
    rollingOpen: 'On the open road', // rolling-card title when there's no next stop queued yet
    replay: 'Replay that', // re-hear the stop that just ended — plain chrome, NOT the skipper's voice (replay-last-stop)
    gpsSearching: 'Looking for the satellites. Hang tight.', // live drive, no usable fix yet
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
    // The card's header — what this thing IS and what pressing it does (founder, 2026-08-04: "a label
    // somewhere on the onboarding screen that tells the user this is a sample").
    //
    // ⚠ IT IS NOT THE 'A TASTE' BADGE COMING BACK, and the difference is why one was cut and this one
    // earns its place. That badge's stated job was "this is a sample, not a live DRIVE" — it
    // disambiguated against a concept a first-run rider has never met, on the first screen of a fresh
    // install. This answers the question a newcomer actually has in front of an image and a play disc:
    // what happens if I press it. Nothing else on the screen says so — the artwork, the place name and
    // the transport all assume you already know.
    //
    // ⚠ Its predecessor here was 'POSTCARD FROM LAKE TAHOE', which named a region the chip twelve
    // points below already named and hardcoded a place into `voice` besides. This names no place, so
    // it survives the server swapping the sample clip.
    kicker: 'HEAR A SAMPLE',
    // ⚠ `badge` ('A TASTE') WAS DELETED HERE (2026-08-04). Its job — be honest that "this is a sample,
    // not a live drive" — was true copy on the old `/sample`, which a rider reached from home already
    // knowing what a drive was. As the first screen of a fresh install it disambiguated against a
    // concept the rider has never met, while the tagline, the section heading and the CTA all already
    // say the clip is not the product. See app/sample.tsx for the ~28pt it cost.
    loading: 'Cueing up something good from the lake…',
    // ⚠ `skip` AND ALL FOUR `end*` STRINGS WERE DELETED HERE (2026-08-04) when the postcard, the end
    // card and the region screen merged into ONE surface. `endBody`/`endCta`/`endSecondary` dressed a
    // full-screen end card that no longer exists — the clip finishes in place now, under a CTA that was
    // already on screen. `skip` ('Skip the sample') went with the separate skip control: a permanently
    // visible forward CTA IS the skip, and it never has to apologise for being one. `endTitle` ("That's
    // the taste, friend.") outlived them by an hour and then went too: with the CTA lighting up to mark
    // the end, a sentence saying the same thing is a caption on something the rider just watched
    // happen — and it grew the layout by ~39pt exactly when the primary button appears.
    // ⚠ VOICEOVER-ONLY, and the reason they exist is that `TransportBar`'s defaults are DRIVE copy:
    // this control announced itself as "Let's roll" and then "Hold here" on the first screen of a
    // fresh install, promising a drive that a one-minute postcard does not start. Caught reading the
    // accessibility tree on the simulator, invisible to every test and to a sighted glance.
    // Plain, not in persona: a screen-reader label's whole job is to say what the control does.
    playA11y: 'Play the sample',
    pauseA11y: 'Pause the sample',
    // ⚠ THE THREE `row*` STRINGS THAT SAT HERE ARE GONE (2026-08-04) — `rowKicker` / `rowTitle` /
    // `rowHint` dressed home's listen row, and the row was deleted when the taste became the first
    // screen of onboarding (founder). The reasoning they carried is worth keeping even though the
    // strings are not: the taste is the "worked example" the empty-state research puts first, because
    // for an audio product letting a newcomer HEAR the thing outranks asking them to type at it. That
    // argument is exactly why it moved to the front of the app rather than being dropped.
    // ⚠ NAMES NO PLACE. The sample clip is server-chosen and swappable, and voice is delivery, never
    // facts — so this copy sells the VOICE, not the location, and survives the clip changing. That is
    // also what lets one canonical sample stay canonical once there is more than one region.
    // ⚠ see `region` below for the picker's copy — kept out of `sample` so the region sheet does not
    // inherit postcard framing.
  },
  // The region sheet behind the home chip. ⚠ Names NO region — the list is server data; this is only
  // the framing around it, and it has to stay true the day there are six.
  region: {
    // "Roads I know" rather than "Choose a region": the rider is not configuring a setting, they are
    // asking which country this skipper actually runs. Same reason the limit was never spelled out —
    // the answer is a list of places, and the list says it.
    // ⚠ Used as a native action sheet's TITLE now, not our own sheet's heading — it renders in the
    // system font, so keep it plain text. (The old sheet's 'Done' died with the custom Modal: a
    // native sheet dismisses itself, and its trailing button is 'Cancel'.)
    heading: 'Roads I know',
    // The CHIP's label when no region is selected yet. Plain, not in-persona, and deliberately so:
    // unlike the sheet heading above, this one is the only thing standing between the rider and a
    // dead composer, so it has to read as an instruction rather than as flavour.
    // ⚠ Reachable whenever `/regions` returns more than one, which is NOT the hypothetical future it
    // sounds like — an ADMIN is served staged regions too (apps/api GET /regions, `canPreview`), so
    // this ships the moment a second region is seeded, released or not.
    unset: 'Pick a region',
    // ── Onboarding step 2. The screen asks WHERE, once, before the rider ever reaches the composer.
    // ⚠ NO LOCATION ANYTHING HERE, and that is the decision the copy has to hold up (founder,
    // 2026-08-04): the rider picks by hand, and iOS's one-shot permission prompt is still spent
    // exactly where 1.1 put it — at "Let's roll", and only if we don't already have it. A line like
    // "we'll find the closest roads for you" would be writing a cheque this flow deliberately cannot
    // cash. See docs/designs/onboarding-taste-then-where.md.
    // ⚠ `setupTitle` ('Where are we driving?') WAS DELETED (2026-08-04) with the region step itself —
    // onboarding asks a stranger nothing now. `setupCta` survives because it is still the button that
    // ends the flow. If the question ever returns, it belongs wherever the picker does.
    // ⚠ `setupBody` LIVED HERE AND IS GONE (2026-08-04). It was the coverage caption under the chip —
    // "I know every turn on these. More are coming." — and its argument was good: say the LIMIT out
    // loud, because a newcomer who learns it in that forgiving first moment is not ambushed by it
    // mid-plan. It was not refuted, it was RELOCATED. `heading` above titles the picker one tap away
    // ("Roads I know") over a list of exactly what exists, which answers the same question by showing
    // rather than promising — and the line's ~40pt bought the wordmark masthead on that screen.
    // ⚠ It also went through TWO rewrites in an hour first, both worth not repeating: it shipped
    // saying "*this* is where I know every turn" (singular — stale the day a second region releases,
    // on installed apps that could do nothing about it), then got shortened when the two onboarding
    // screens merged and it became a caption rather than a body.
    setupCta: 'Start exploring',
  },
  greeting: 'Hop in. I’ll do the talking.',
  // The line under the wordmark on the onboarding screen — the one sentence a stranger reads before
  // any audio plays.
  //
  // ⚠ IT NO LONGER NAMES THE CATEGORY, and that reverses this comment's original rule of "clear first,
  // persona second" (founder, 2026-08-04). It opened "Narrated road trips. You pick the road…" and the
  // descriptor was cut. Recorded because it is a real trade, not a tidy-up: the line stopped LABELLING
  // the product and now only demonstrates it. What makes that survivable is everything around it — a
  // postcard, an "A TASTE" badge, a transport bar and a 64-second clip are all on the same screen, so
  // "audio about places" is shown three ways before the sentence has to say it. It also earned its
  // keep on layout: at 375pt wide the longer version wrapped to two lines on the smallest phone.
  //
  // ⚠ IT HAD NO READER AT ALL FOR A DAY, which is worth recording because nothing failed. Home's
  // masthead (kicker → headline → rig → tagline) was deleted on 2026-08-03 as "a LANDING PAGE, and
  // Skipper already has one at skipper.fm" — correct for home, where the rider has already installed
  // and is standing there wanting to plan a drive. This string went dead with it and simply sat here.
  // Onboarding is the one screen where the argument does NOT apply: the rider has not decided
  // anything yet, and the postcard alone never says what the app DOES.
  //
  // ⚠ THE THIRD CLAUSE WAS CUT (founder, 2026-08-04): it read "…I'll do the talking. One corny guide
  // the whole way." Two reasons, and the second is the one that would have bitten. It wrapped to two
  // lines in this slot, and the extra line pushed the primary CTA flush against the home indicator —
  // a layout cost paid by copy nobody was reading closely. And the corniness is something the sixty
  // seconds of audio directly below it DEMONSTRATES; announcing it first is the one place this line
  // could sound like marketing rather than like him.
  //
  // ⚠ Named BOTH modes until roam was removed (it had been co-equal on home, founder 2026-06-11).
  // Now there is one artifact, so the line says one thing.
  tagline: 'You pick the road, I’ll do the talking.',
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
    home: 'No signal out here, so showing the drives you’ve saved.',
    detail: 'No signal out here, so running on the saved copy.',
    // The honest failure. Stands in for voice.error.generic whenever the request never left the
    // phone (see api.ts OfflineError) — the generic "kink in the hose" line covers a 500, a parse
    // blip and a GPS timeout equally, and pairs with a retry button that cannot possibly work out
    // here. Same "No signal out here" opening as its two siblings above so the three read as one
    // idea; the second clause is the part that changes (nothing saved to fall back ON).
    noSignal: 'No signal out here, and this one needs a bar or two. Try again when they’re back.',
    // ⚠ `needsSignal`/`needsSignalSaved` lived here until 1.1 step 7. They were a heads-up note above
    // a CTA that stayed live because the tap cost nothing — a nudge, never a block. Home is now the
    // conversation itself (D6), which genuinely cannot run offline, so the honest shape is a state,
    // not a note: see `voice.plan.offlineTitle`/`offlineBody`. The "never strand a rider" rule is
    // unchanged and still governs every other offline surface in this file.
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
    // ⚠ REGION-FREE ON PURPOSE (founder, 2026-08-03), and this one had no alternative: it sits on the
    // drive-detail Save button, and a `DriveManifest` carries no region — so unlike the /sample copy
    // (which keeps its "Lake Tahoe" deliberately) there was nothing here to template FROM. Naming a
    // region would simply have been wrong for every drive outside it. §7 holds either way: this says
    // something true about the ROAD, which is route information, not a fact about a place on it.
    // ⚠ ONE LINE, deliberately (founder, 2026-08-03) — it is a caption tucked under a button, and the
    // two-line version it replaced wrapped mid-thought and cost the itinerary a row of screen. The
    // full argument still gets made where it can act on it: the unsaved-drive alert in front of Start.
    // "Signal's thin" is the same phrasing `error.download` uses — one road, one voice.
    saveHint: 'Signal’s thin out there — best saved now.',
    // The one warning in front of a live drive that hasn't been saved. NEVER a block: the rider may
    // be on a road with good signal, or just auditioning from the couch. `useDrive`'s stall watchdog
    // skips any clip that won't load, so an unsaved drive through a dead zone loses those stops
    // SILENTLY — this is the only moment we can say so while it's still fixable.
    unsavedTitle: 'This drive isn’t saved yet',
    unsavedBody:
      'Out where the signal drops, any stop that can’t load gets skipped, and you’d drive right past it in silence. Saving it first takes a moment, and then the whole drive plays off your phone.',
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
      'If that address is one of ours, the link is on its way. Go check your email, and mind the spam bin.',
  },
  settings: {
    account: 'ACCOUNT',
    appearance: 'APPEARANCE',
    // Explains all three options + reassures that the default needs no fiddling: a
    // night drive dims itself. Persona-light, still informative.
    appearanceHint:
      'Auto rides with your phone: dusk-dark when the sun clocks out, bright by day. Pin Day or Dusk to hold one mood.',
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
      'Admin-only tools. These ride along with you on field drives, so leave them off unless you’re testing.',
    developerLoading: 'Checking your credentials…',
    developerLocked: 'These tools are for admins only.',
    simModeLabel: 'SIMULATED GPS',
    // ⚠ This used to claim it "replays a RECORDED Tahoe drive through the REAL engine". Both halves
    // oversold it and the second was the dangerous one: `simulatedSource` walks the polyline
    // SYNTHETICALLY and emits finished fixes, so it never touches the live mapping pipeline (the
    // accuracy gate, the iOS -1 sentinels, the projection cursor). Copy that invites you to trust a
    // desk pass more than it deserves is worse than no copy. docs/designs/desk-drive-harness.md.
    developerHint:
      'Simulated GPS walks this drive’s route at a steady speed and fires the stops, no car required. It tests the triggering and the audio, not the GPS itself. Takes effect next time you start a drive.',
    // ── First-run reset. ⚠ Plain and literal, not in persona: an admin tool's copy has one job, which
    // is to say exactly what the button does to this phone before it is pressed.
    onboardingLabel: 'FIRST-TIME EXPERIENCE',
    onboardingHint:
      'Onboarding — the postcard, then the region question — runs once per install. Reset it to see those two screens again on the next launch. Your drives, downloads and account are untouched; the region you already picked stays selected in the picker.',
    onboardingReset: 'Reset first-time experience',
    onboardingResetDone: 'Reset. Relaunch the app to see onboarding again.',
    tracesLabel: 'DRIVE TRACES',
    // Says what it is FOR, because the value is not obvious from the file list: a trace is the only
    // way a drive that already happened can be driven again.
    tracesHint:
      'Every live drive records its raw GPS to this phone. Share one to your Mac and it can be replayed and re-analysed forever. That’s how one real drive keeps paying off.',
    tracesEmpty: 'No traces yet. Take a live drive and one lands here.',
    tracesShare: 'Share',
    tracesDelete: 'Delete',
    tracesDeleteConfirmTitle: 'Delete this trace?',
    tracesDeleteConfirmBody: 'It’s the only copy, and the drive it came from can’t be re-recorded.',
    tracesDeleteConfirmCancel: 'Keep it',
    tracesDeleteConfirmOk: 'Delete',
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
      'The skipper does his homework. Every tale, every rock, every pit stop on a drive is built from the sources below, and we keep the credit where it’s due.',
    musicHeading: 'The road music',
    musicIntro: 'And the songs between stops: the skipper’s glovebox playlist, credited where it counts.',
    footer: 'Tap a license or a source name to read it in full.',
  },
  guest: 'Riding as a guest',
} as const
