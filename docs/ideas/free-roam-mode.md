# Free-roam mode — the skipper rides shotgun

> **Status:** ALPHA BUILT 2026-06-10 — founder greenlit a same-day prototype; the shipped v0 (and
> its deliberate cuts) is recorded in `docs/specs/free-roam-alpha-spec.md`. THIS doc remains the
> full product vision (second product, tours primary; the grammar/logbook/monetization layers are
> still future). Originally captured + fleshed out 2026-06-10 as the buildable-now rung missing
> from [journey-layer.md](journey-layer.md)'s coverage spectrum. 2026-06-11: post-field-drive
> improvement backlog captured (§Alpha learnings); founder LOCKED waves + sonic cue +
> history/mute as the next build pass (TODO.md carries the build context).

**The idea (founder, 2026-06-10):** the POI corpus we accumulate building tours becomes a product of
its own — open the app anywhere in a covered region, just drive, and the skipper pipes up when you
pass something he knows a story about. No route, no rails, no arc. Autio's product shape
(location-pinned stories; the road sequences them) — but regional-deep, persona-led, offline-first.
Tours = the show he rehearsed; roam = the guy who just *knows things*, riding shotgun. Same app, a
second mode beside THE DRIVES — never a separate product surface. (Working mode name to consider:
**"Shotgun."**)

## Why it's charming (the toy lens)

- You're driving to the grocery store and he pipes up about the meadow you pass every day. The
  persona's omnipresence *is* the running gag — the tour guide who just lives in your car now.
- It turns Skipper from an **occasions** product (a tour is a planned outing) into a **companion**
  (every Tahoe drive is a touchpoint). Retention between tours, in character.
- Natural habitat for `docs/specs/ask-the-skipper-spec.md` — no script to interrupt; "what's that?"
  grounded on whatever's nearby.
- The cross-sell is in character: *"y'know, I do a whole show about this lake."* Roam funnels tours;
  tours unlock roam (see Monetization).
- Pairs with passenger mode ([journey-layer.md](journey-layer.md)) — roam + a passenger is the
  road-trip case Autio actually serves.

## The experience (how a session feels)

- **Start is explicit** (a big friendly "ride along" affordance on the region screen — battery and
  expectation both want a deliberate session, not always-on). He opens with one line from a small
  rotating **session-start pool** — placeless, persona-only: *"Mornin'. Don't mind me — just along
  for the ride."* No outro required; if the user ends the session by hand, a tiny sign-off.
- **The ambient contract, set by HIM on first run:** *"Here's the deal: I talk when there's
  something worth saying. The rest of the time I'm enjoying the view. It's not awkward unless you
  make it awkward."* This is the dead-air inoculation done as a bit — silence is framed as
  companionable before it ever happens. (The category's #1 wound, pre-answered in character.)
- **An encounter:** music/audio ducks (never stops), he does his 20–75s, out. Minimal glanceable
  card on screen (name + a "tell me more" affordance — see Encounter forms). No required glances.
- **Edge of coverage:** one placeless clip — *"that's past the edge of my map, friend. Wake me when
  we loop back."* — then a quiet UI state. Kills the "is it broken?" anxiety (GuideAlong's failure)
  without promising content we don't have.
- **A quiet drive is a valid drive.** The UI shows he's riding along (subtle, alive, not a spinner);
  the contract above carries the rest.

## Encounter forms (the new writing grammar)

Not every POI deserves a monologue; an ambient companion must read the room. Three forms:

- **The wave** (~10–20s): a one-liner for minor pins — *"that's Cave Rock — the road's about to go
  THROUGH it. Ask me about it sometime."* Keeps dense corridors from becoming exhausting.
- **The story** (~45–75s): the full encounter for POIs with real fact depth — self-contained, no
  callbacks, no arc assumed.
- **The B-side** (opt-in): "tell me more" on the card (or, later, asking him —
  `docs/specs/ask-the-skipper-spec.md`) plays the deeper cut. This is
  `docs/specs/tell-me-more-spec.md`'s machinery with roam as a second customer; opt-in depth is how
  roam respects the commute while still rewarding curiosity.
- **Revisit preambles:** a tiny placeless pool that gates a replay after cooldown — *"stop me if
  you've heard this one—"*. Dirt cheap (persona-only, region-agnostic), and it converts the
  repeat-fatigue failure mode into a running bit.
- **Chattiness is a SELECTION knob, not a generation knob** (doctrine-clean, same family as
  duration=skip-stops): quiet / normal / talkative changes *which and how many* pre-gen encounters
  fire (waves suppressed on quiet, etc.), never the telling itself. The Dad-Joke-O-Meter invariant
  is untouched — nothing here re-generates at playback.

## Memory, stamps, and the progression loop

A client-side **encounter history** (poiId, lastPlayedAt, count) powers three things:

1. **Cooldown** (the v1 repeat-fatigue answer) — a story doesn't re-fire for weeks.
2. **Revisit charm** — the preamble pool above; later, real revisit variants if the ear wants them.
3. **The logbook** — every encounter heard is naturally collectible. This is
   [passport-logbook.md](passport-logbook.md)'s best customer: a pin-map filling in as you roam,
   *"forty-seven stories, three regions"* read back in character. Roam gets the progression loop a
   one-shot tour structurally can't have — the reason to take the long way home.

## Roam ↔ tours (they touch in three places)

- **Different telling by design.** Roaming past Camp Richardson plays the *roam* clip, never the
  tour's — zero-reuse makes the right behavior the default (a tour stop assumes its arc; a roam
  encounter assumes nothing). What looked like a doctrine collision is actually the feature.
- **The cross-sell wave:** roaming onto a corridor that has a tour, he says so — *"I do a whole
  show on this road. Want me to put it on your list?"* → one tap saves it via the existing
  `saved_tours` join. The realistic v1 is save-for-later, not mid-drive mode-switching.
- **The someday-magic:** if you OWN that tour and you're at its start, offer to roll the show right
  there. Genuinely magical, fiddly engineering (tour expects its intro bracket; mid-corridor entry
  is a non-goal today) — capture, don't promise.

## How it slots into the north star (the missing rung)

The journey-layer spectrum runs curated corridors (1) → per-trip bespoke (2) → truly live wandering
(3). Rungs 2–3 need live generation (and on-device LLM for dead zones) — years out. **Free-roam is
rung 1.5: the pre-generated approximation of rung 3,** buildable on today's batch stack (generate →
TTS → R2 → region pack download). Within a covered region it delivers most of "wandering," and it
de-risks the climb: proves the rail-less trigger rungs 2–3 need, makes POI breadth valuable
independent of tour count (a second customer for the Wikidata-spine direction), and its
repeat-fatigue problem builds the variant machinery the later rungs want anyway.

## Doctrine reconciliation

1. **Zero-reuse (`docs/decisions/tour-data-model-zero-reuse.md`) survives via a third owner.** The
   rule's content: narration belongs to its telling-context; facts stay shared on `pois`. A tour's
   clip already replays for every driver *of that tour* — a roam clip replays for every roamer *of
   that region*. So: `roam_clips` = roam-owned narration (one telling per POI per region/persona —
   plus B-side/revisit variants later — staleness via `facts_hash`, attribution snapshot frozen on
   the clip, exactly the `tour_stops` pattern). Tours and roam NEVER cross-feed; not a `poi_content`
   resurrection. Needs a dated addendum on the decision doc when built.
2. **The rails principle ("the rails are the route") dissolves the same way journey-layer dissolved
   it for any-road:** its real content is *the model never derives routes*. Roam derives none —
   nobody picks a route at all; the user just drives.
3. **Our own research verdict — "IGNORE Autio's points model" (`docs/research/competitor-ux-studies.md`)
   — inverts on scope.** Autio's failure is points-as-PRIMARY + national + coverage-as-moat, which
   *creates* "nothing for miles" (the category's #1 wound, 4-for-4). Ours: secondary + region-gated
   where we're dense + persona-as-moat. We don't race to 23k pins; the skipper is omnipresent inside
   the basin he already knows. Autio's other anti-lessons (notification-gated triggering,
   streaming-first) we already don't copy — continuous-foreground trigger + offline packs carry over.
4. **Dead-air honesty:** in a tour, silence is a pacing failure we fight; in roam, silence is the
   DEFAULT — owned by the ambient contract (above), enforced by the density bar (below);
   `docs/specs/downtime-callouts-spec.md` beats (placeless, time-based) can soften long quiets later.

## The corpus, honestly — and the flywheel

Under zero-reuse, `pois` accumulates **FACTS, not stories** — tellings are tour-owned. The real
asset = the grounded-facts corpus (discovery sweeps wider than the stops tours select; the Wikidata
spine widens it further) + the whole narration machine (scout, grounding gates, lint, eval panel).
Roam clips are a cheap batch run away — ~300 Tahoe POIs ≈ tens of dollars of generation + roughly
$10 of TTS (~7 audio-hrs at ≈$1.80/hr) — not content already sitting in the DB.

**The flywheel:** every tour built widens the corpus → the corpus makes roam richer → roam usage is
a *demand heatmap* (where do people actually drive with nothing to say? → where to enrich next →
which tour to build next). Roam isn't just the second product; it's the **R&D instrument for the
first.** (Aggregate telemetry only — the toy lens has no appetite for surveillance vibes.)

## Shape of the build (sketch, not a spec)

- **`roam_clips`** (poiId, regionId, form wave|story|bside, script, audioUrl, durationS, factsHash,
  attribution, status) — the third narration owner.
- **`generate-roam` pipeline:** reuse scout/grounding/lint/eval wholesale; NEW form constraints:
  self-contained, no callbacks/arc, **no baked laterality** (no route → approach side unknowable;
  same rule family as break-stops' no-volatile-data), no volatile data; region-wide cluster-merge
  for co-located POIs (the Emerald Bay bay+castle+island move, applied per-region). Runs as another
  job type on the ops substrate (`docs/specs/admin-ops-console-spec.md`).
- **Rail-less trigger mode in `@skipper/drive-core`:** regional proximity index + speed-adaptive
  lead + heading-toward gate + per-POI cooldown + min-gap pacing/frequency governor + cluster
  suppression + wave/story priority. THE real engineering — tractable because the failure asymmetry
  flips: a missed stop breaks a tour's arc; a missed roam POI is invisible.
- **Mobile:** explicit Roam session (battery — not always-on), region pack download (offline-first,
  reuse `offline.ts` seams; ~300 clips ≈ **~70 MB** at MP3 32 kbps — less than a podcast episode),
  minimal ambient chrome, the encounter card.
- **API:** `/regions/:id/roam` manifest — additive wire contract (fits the no-URL-versioning
  posture).
- **Density bar (qualitative):** a region qualifies when its main roads offer an encounter within
  ~5 minutes at typical speeds. Never ship roam in a region that can't carry the contract.

## Hard parts (pre-mortem)

- **Coverage cliff / sparse silence** → the density bar + the ambient contract; the edge-of-map
  clip at boundaries.
- **Repeat fatigue** (you pass the same meadow daily) → cooldown v1 → revisit preambles → B-side
  rotation → live-gen variants as the endgame answer.
- **Rail-less trigger jank** (GPS noise, heading flapping at intersections, divided highways) —
  triggering is the category's make-or-break (Autio's cautionary tale); conservative gates +
  generous debounce, accept invisible misses.
- **Persona without an arc** — the wave/story grammar is a new writing form; real prompt work
  before it sounds like him and not a gazetteer.
- **Exhaustion on dense corridors** — the frequency governor + chattiness selection; an ambient
  companion that won't shut up is worse than one who misses things.
- **Battery** — ambient GPS on every errand is heavier than a bounded tour; explicit sessions v1.
- **Attribution** — CC BY-SA carries to every roam clip (frozen snapshot, same as `tour_stops`).

## Monetization sketch (flag, don't decide)

Roam is subscription-shaped (ongoing ambient value) — but the research is clear subscription is the
category's churning outlier. The instinct: **roam as the perk of owning any tour in the region**
("you bought a seat, so I ride along anywhere in Tahoe") — bundle-forward, anti-churn, makes tours
MORE valuable rather than cannibalized, and makes the all-Tahoe bundle obviously worth it. The free
taste mirrors the tour-preview generosity doctrine: first N encounters in a region on the house,
then the pitch — in character, never a toll mid-drive. (Autio's analog: 5 free stories.)

## v0.1 — the smallest real version (when its time comes)

Tahoe only. Batch-generate stories+waves for the existing corpus (post-spine). Explicit session;
proximity + heading + cooldown + frequency governor; session-start pool + edge-of-map clip; default
chattiness only. No B-sides, no logbook, no revisit preambles, no gating (founder-only TestFlight
toy first). **Acceptance test: does the founder grin when he pipes up unprompted on a real errand
around the basin.** That's the whole bet in one drive.

## Alpha learnings → improvement backlog (brainstormed 2026-06-11)

Two rounds with the founder, grounded in the first real field drives (the founder daily-drives
in-corpus, so roam's stress case is the REPEATED commute, not the one-shot outing). **Locked as
the next build pass: waves + the sonic cue + persistent history/mute** (the TODO.md entry carries
the build context). Everything else captured here, unscheduled.

**Locked next pass:**
- **Narrate the scenic tier as waves** (~126 swept pins sit unnarrated) — the cheapest density
  win; makes talkative-chattiness real; the wave form-clip prompt work was needed eventually anyway.
- **A pre-speech sonic cue** (~1s motif before he talks, a soft resolve when the duck releases) —
  kills the voice-in-your-podcast startle, frames the encounter, becomes the sonic brand.
- **Persistent encounter history + per-pin mute** — cooldowns that survive sessions (the daily
  commute exhausts the home pins in a week otherwise); "don't tell me this one again" on the
  sheet is the rider's relief valve AND free curation telemetry (a much-muted clip is a bad clip).

**Reliability (before any non-founder rider):**
- **Locked-screen session survival** — roam claims no Now Playing and there's no
  `UIBackgroundModes:['audio']`; a pocketed phone likely kills the session. Tours assume a mount;
  an errand companion doesn't get that assumption. Needs the device pass.
- **The offline roam pack doubles as the presign fix** — dead zones AND >1h-session stalls both
  trace to streaming presigns; one region pack (~70 MB) erases both failure classes.

**Pull, not just push:**
- **"What's that?" manual fire** — a button that plays the nearest unplayed pin's clip on demand,
  radius be damned. Rescues every pin the trigger math can't reach (the field drive's 8/77
  lesson), is Ask-the-Skipper's experience with zero live machinery, and logs real demand signal
  for the eventual agent.

**Session lifecycle:**
- **Auto-end on park** (~3 min stationary → sign-off → clean end; battery) with **kind-aware
  sign-offs** — a placeless pool keyed to the nearest pin's kind (trailhead: "go earn the view").
- **Conditions beats, selection-side** — a tiny placeless pool ("first snow of the season") fired
  at most once per session when a CLIENT-side check (date/daylight/weather-at-start) matches.
  The knob selects, never generates — doctrine-clean topicality; presence without live gen.

**Corpus & trigger engineering:**
- **Road-snap pins at sweep time** — store each pin's nearest drivable point (Overpass/OSRM at
  sweep) and trigger on THAT; the honest fix the kind-aware radii patched around. Plus a
  sweep-time **reachability report** (a pin that can never fire from a road is dead weight).
- **Deep-cuts rotation** — history shows which ~10 pins dominate real drives; generate 2nd/3rd
  tellings for JUST those and rotate (zero-reuse-clean: roam owns its variants).
- **Roam joins the eval panel + admin ear-pass** — batch the offline grounding audit over
  `roam_clips`; give the admin console ear-pass a roam tab; mute data feeds the same view.
- **A post-session debrief, client-side** — extend the sign-off tally with the silent stretches
  and passed-unreachable pins; the demand heatmap as a screenshot, zero server telemetry.

**Progression & strategy:**
- **The corpus meter** — "23 of 77 stories" on the sign-off card; the logbook's first rung,
  working before any stamp art exists.
- **Roam-first region expansion** — a roam region costs a sweep + ~$10–25 of generation, NO route
  curation; the beachhead inversion: roam opens a region, its heatmap picks the tour to build.
  The density bar still gates. **Promoted to its own idea doc 2026-06-11** (founder: intriguing,
  proceed) with $0 corpus probes of Yosemite/Moab/Big Sur:
  [roam-first-region-expansion.md](roam-first-region-expansion.md).

**One-liners:** home quiet-zone (maybe redundant under history+mute); maneuver-hold (don't talk
over the roundabout); the scenic-detour whisper (nav-adjacent, riskier, someday); time-of-day
opener selection (free charm on the existing pool).

## Open questions (founder decision surface)

1. **Name:** "Shotgun"? "Free-roam"? "Ride along"?
2. **Monetization shape:** perk-of-ownership (instinct) vs standalone sub vs part of a regional
   bundle SKU only?
3. **Chattiness default** at launch: normal or quiet?
4. **Does this tilt the Wikidata-spine punch-list up the priority list now,** or just annotate it?
5. **Free taste size:** N encounters? per region or lifetime?
6. **Revisit preambles in v0.2** (cheap, very him) — yes/no?

## Provenance

- Founder moonshot, 2026-06-10: "since we will eventually collect all these POIs with rich stories…
  a free-roam mode — sort of Autio's core product — secondary for us, guided tours primary."
  Fleshed out same session.
- Slots into [journey-layer.md](journey-layer.md) (rung 1.5 of the coverage spectrum); inverts the
  Autio IGNORE verdict by scope (`docs/research/competitor-ux-studies.md`); carve-out pending on
  `docs/decisions/tour-data-model-zero-reuse.md` when built; shares machinery with
  `docs/specs/tell-me-more-spec.md`, `docs/specs/downtime-callouts-spec.md`,
  `docs/specs/ask-the-skipper-spec.md`, [passport-logbook.md](passport-logbook.md),
  `docs/specs/admin-ops-console-spec.md` (roam batch = another ops job type).
