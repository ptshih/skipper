# The road-trip planner

> **Status:** 💡 **VISION — founder's, stated 2026-08-04; not greenlit, nothing built.** Four pieces
> given across one conversation and collected here so there is ONE thing to argue with. Its enabling
> dependency is [corpus-as-the-planners-world.md](corpus-as-the-planners-world.md) (the planner's
> vocabulary); this entry is about what the vocabulary would be FOR. ⚠ **It touches NO hard invariant** —
> an earlier draft of this entry said it did, on a misreading the founder corrected: the model NUDGES
> ROUTING and never chooses stops, so deterministic selection stands. The two pieces that would have
> collided (rider-chosen stops, branching paths) are both explicitly out of scope, and the surprise of
> writing it down is that nearly all the value sits in the vocabulary change alone.

## The vision

> Almost a road-trip planner. Choose a start, choose an end, optionally add stops in between based on
> suggestions, then save it as a self-guided navigation tour — including non-linear paths like spurs.

⚠ **Two clarifications from the founder that shrink this a great deal, and both were given after the
first draft of this entry got them wrong:**

- *"I'm not suggesting the model choose stops, but it should be able to nudge the routing."* The
  deterministic selection stays. This is a ROUTING feature, not a selection one.
- *"Spurs is what I'm thinking of."* Out-and-back side trips, not branching paths.

Read that way, the vision is much closer to the current product than it first sounds: today's planner
already resolves endpoints, `via`, round-trips and a duration target, and `buildDrive` already decides
what gets said. **The gap is almost entirely that the planner does not know enough place names to nudge
anything interesting.**

## Piece 1 — start and end, from conversation

**Mostly a vocabulary problem, and it has its own entry.** The planner's world is 103 curated `places`;
the corpus is 729 released narrations including 14 of the 15 towns riders actually name. See
[corpus-as-the-planners-world.md](corpus-as-the-planners-world.md).

Nothing here is new invariant surface — INV-1 moves from one table to another and is not weakened.

## Piece 2 — the model NUDGES THE ROUTING (it does not choose stops)

⚠ **Stated explicitly by the founder, and it is the difference between a small feature and a rework:**
the model is not picking which narrations play. **Deterministic selection stays.** *"The route is the
rails; generation is everything inside"* is untouched, and so is the hard invariant that goes with it.

What "add stops in between" means under that reading is: **the model routes the drive PAST something,
and the stop follows.** A rider says *"can we go by Sand Harbor?"*; the model adds it as a `via`; the
frozen polyline now passes it; and `buildDrive` picks its telling up because it is on the route and
within reach. The rider experiences it as adding a stop. The system never left the rails.

**Mechanically this already exists.** `via` is on the wire, capped at `MAX_ROUTE_VIA = 8`, and it goes
through the same allowlist as the endpoints — start, end and every midpoint resolve in ONE all-or-
nothing lookup, which is INV-1 and was a real hole once. Nothing needs inventing.

**So what is actually missing is small, and it is not routing — it is knowing.** The planner cannot name
Sand Harbor, because Sand Harbor is not one of the 103 curated endpoints. It has a released telling and
the planner has never heard of it. That is piece 1, again: the constraint on this whole vision is
vocabulary, not machinery.

**The residual risk is smaller than the rider-chooses version but not zero.** Routing past a place does
not guarantee its telling is selected — pacing and the spacing rules can still drop it. So a model that
knows the corpus can still say *"we'll go by Sand Harbor and I'll tell you about it"* and be wrong,
just far less often than if it were free-associating. The mitigation stays what it was: the model may
say where it is going, and must not promise what it will say when it gets there.

⚠ **The `via` budget is now doing three jobs and only has eight slots**: pass-throughs the rider asked
for, the turnaround of a round trip, and the way home that keeps a loop off its outbound road. A spur
(piece 4) spends another. Worth counting before the planner is encouraged to reach for `via` freely.

## Piece 3 — save it as a self-guided navigation tour

**The "save it" half already exists.** A drive is persisted, re-openable, offline-downloadable and
replayable; that is what `drives` IS.

⚠ **The "navigation" half is a different product and collides with a decided one.** If it means
turn-by-turn, note that the Skipper takes **EXCLUSIVE** audio focus whenever he speaks — `doNotMix`,
with ducking explicitly tried and rejected
([../decisions/drive-audio-exclusive-focus.md](../decisions/drive-audio-exclusive-focus.md)) — because
the drive IS the audio rather than a voice-over. A navigation voice wants the same channel, on the same
road, at the same moments. Two voices competing for one channel is not a settings problem; it is a
product decision about what the rider is listening to.

So: **does the drive NAVIGATE, or does it ride alongside whatever maps app the rider already has open?**
Today it is unambiguously the second. ⛔ **NOT NOW (founder, 2026-08-04)** — but sized here, because the
answer is lopsided and worth knowing before it is ever reconsidered.

### Sizing turn-by-turn — the geometry is the easy part

**Already built, and it is the bit people expect to be hard.** `nearestOnRoute` + `cumulativeMeters`
already answer "where am I along this route" every GPS tick, at speed, with a debounce, and the drive
already carries a frozen polyline plus a live puck on a map. Mapping an along-track position to "which
maneuver is next" is arithmetic on top of data the player already holds.

**Three things are genuinely hard, and only the third is engineering.**

1. **The maneuvers have to be fetched and frozen.** `routes.legs.steps.navigationInstruction` is not in
   today's field mask — the build asks for distance, duration, polyline and warnings. Adding steps means
   a bigger response frozen into the drive artifact, and ⚠ **probably a costlier Routes SKU** on the
   credit-spending path (unverified — the field→SKU table is not in the docs that were checked, and this
   is a spend change under INV-11, so it needs confirming rather than assuming).
2. **The voice channel is already spoken for.** The Skipper takes EXCLUSIVE focus (`doNotMix`); ducking
   was tried and rejected. A navigation voice wants the same channel on the same road at the same
   moments. The interesting answer is that HE gives the directions — *"hang a left at the old mill"* —
   which is very on-brand and immediately expensive: generic pre-baked maneuver clips sound generic, and
   runtime TTS is a new rider-triggered paid call with latency that also breaks offline. On-device
   speech sidesteps both and costs the thing the product is: it would not be Charon.
3. **Rerouting is what actually breaks things.** Everything else is additive; this is not. A drive's
   route is FROZEN — that is the artifact a rider bought, what the offline download is keyed to, and
   what the selection was computed against. Rerouting mid-drive means a billed Routes call in the car,
   a re-selection, and a manifest that no longer matches what was downloaded. It collides with the
   frozen artifact, with offline-first, and with one-credit-per-drive simultaneously.

**Which suggests the cheap version is a real product and the expensive one is a different app.** Freeze
the maneuvers at build, have the Skipper call the turns, and DO NOT reroute — if the rider leaves the
route, he says so and the drive goes quiet until they rejoin. That is honest, fits the frozen artifact,
keeps offline, and needs no new runtime spend. It is also, notably, how a rider on a scenic drive
actually behaves: they are not commuting.

## Piece 4 — non-linear paths

⚠ **First, the word.** `detours` is already a table: place-anchored BREAK audio, 1:1 with a `places`
row, stubbed and deferred. It means "a coffee stop the skipper mentions", NOT "a branch in the route".
This piece needs a different word before it enters any spec.

**"Non-linear" is two asks with wildly different costs.**

**A spur** — up to a viewpoint, turn around, carry on — is **still one polyline**. Routes will return
A → viewpoint → B as a single path, so it is non-linear on the map and perfectly linear in route-space.
This is close to free: it is a `via`. Two things to know:

- `nearestOnRoute` returns ONE along-track position per place, so a road driven twice is TOLD once. That
  is the measured finding behind [../decisions/no-same-road-loops.md](../decisions/no-same-road-loops.md).
- That gate is narrower than its name suggests: `refuse = loop && retrace > LOOP_MAX_RETRACE`. A one-way
  drive with a spur is **never** refused, because it is not a loop. Only a round trip whose doubled
  portion exceeds a fifth of the route is stopped. **Spurs are already legal on most shapes** — what is
  missing is the planner being able to EXPRESS one.

⚠ **Spurs are what is wanted here — confirmed by the founder — and true branching is explicitly NOT.**
The distinction is kept because the two words sound alike and the costs do not.

**True branching** — an optional side trip the rider may or may not take, so the drive has more than one
possible path — lands in `@skipper/engine`, not the planner. `cumulativeMeters`, `nearestOnRoute`,
`totalMeters` and `timeAtAlong` are single-axis by construction, and everything built on them inherits
it: pacing, the trigger debounce, the scrubber, the drive simulator, and the offline manifest's
along-track ordering. At a branch, *"how far along are you"* has no answer. **Not in scope.** Recorded
only so that a future "we already do non-linear routes" cannot be read as covering it.

## Sequencing, if it is wanted

**Nearly all of the value is in step 1**, which is the surprising part of writing this down.

1. **Vocabulary** — the corpus doc's staging. With it, "go by Sand Harbor" becomes expressible and the
   model can nudge routing toward places worth passing. Without it, nothing else here has anything to
   nudge WITH.
2. **Let the planner express a spur.** The wire already carries `via` (capped at 8, allowlisted), and
   the retrace gate already permits an out-and-back on any one-way drive. This is prompt work plus a
   `via` budget the model understands, not new machinery.
3. **Navigation** — ⛔ not now (founder, 2026-08-04). Sized above: the geometry is already built, the
   voice channel is the real cost, and REROUTING is the only piece that breaks decided positions. A
   no-reroute version is a genuine product; a rerouting one is a different app.
4. **True branching** — ⛔ out of scope by founder call. Listed only so it stays out.

⚠ Steps 1–2 are additive and touch no decided position. Neither 3 nor 4 is wanted now.

## Open questions

- **Does routing past a place reliably surface its telling?** This is the residual promise-versus-
  delivery risk. `buildDrive`'s pacing can still drop a stop the route passes, so "we'll go by X" is
  safe while "I'll tell you about X" is not. Worth measuring: over the existing drives, how often does a
  place within reach of the polyline fail to be selected?
- **Is the `via` budget of 8 enough** once it carries pass-throughs, a round trip's turnaround, the way
  home, and a spur? Cheap to answer, and it binds before anything else does.
- **Should a spur be expressible as one thing rather than two `via` points?** Out-and-back to a viewpoint
  is "go here, then resume", which the wire currently spells as a midpoint and trusts Routes to
  double back through.
- Does the drive still cost one credit when the rider shaped it heavily? The ledger charges at
  `POST /drives` for a generated artifact
  ([../decisions/credit-ledger.md](../decisions/credit-ledger.md)); nudged routing does not obviously
  change that, but a rider who iterated five times has spent five Routes calls and one credit.
