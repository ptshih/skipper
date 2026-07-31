# The drive is an ARC — prepare, preview, anticipate, experience

> **Status:** IDEA → **PROMOTED 2026-07-31**. This is the product rationale; the build is
> [drives-first-1-1.md](drives-first-1-1.md) (greenlit same day), which goes further
> than this doc: the route ask became a **conversation with the skipper in character**, and the pickers
> are removed entirely rather than kept as a fallback. Logs two founder calls: (1) the ARC is where a
> drive's magic comes from, (2) bring back LLM endpoint resolution now that curated anchors can ground
> it. Grounded in a same-day audit of the shipped first-run paths; line numbers here will drift —
> **code wins**. Product structure it builds on:
> [roam-first-create-a-drive.md](roam-first-create-a-drive.md); build truth:
> [../decisions/create-a-drive-architecture.md](../decisions/create-a-drive-architecture.md).

## The thesis: four beats, and roam has only the last one

> "I strongly agree with the magic of the arc: prepare, preview, anticipate, experience."
> — founder, 2026-07-31

- **Prepare** — the rider tells the skipper where they're going.
- **Preview** — they watch it come together: the route draws, the stop count lands.
- **Anticipate** — the gap between making it and driving it. The drive sits there, waiting.
- **Experience** — the road.

Roam is pure present tense. It has beat four and nothing else: nothing to prepare, nothing to
preview, nothing to look forward to, and no artifact when the engine stops. That is the compact
reason a Create-a-Drive feels more magical than a roam session **even though it plays the identical
clips** — the magic isn't in the audio, it's in the three beats that happen before it.

The design consequence is the useful part: **the first three beats are where the magic is
manufactured, and they're the cheapest to improve** — none of them requires being in a car. Polish
there compounds and can be evaluated from a desk; polish in beat four needs a road trip to judge.

This is also the lens that resolves "is roam bloat?" without cutting anything: roam isn't a competing
product, it's a **one-beat** experience sitting in front of a four-beat one.

## Where the shipped app breaks the arc

**Prepare is a form, not an ask.** Free-text endpoint resolution shipped 2026-06-18 and was replaced
by structured pickers on 2026-06-20. `apps/api` has **zero** Anthropic usage today, and
`GET /drives/anchors` says it outright: *"no free text, no geocode hop."* ⚠ CLAUDE.md's principle 2
still describes the LLM version (*"the LLM resolves ONLY the endpoints"*) — that line is **stale
against the code right now**, independent of this idea. Building this makes it true again; not
building it means the line should be fixed to match the pickers.

**Preview is behind the account wall.** `POST /drives/propose` persists nothing and spends no
credit — its own header calls it *"the confirm-before-spend interstitial"* — but the whole sub-app is
gated (`driveRoutes.use('*', withSession, requireAccount)`), `/anchors` included. A stranger must
create an account to watch the trick. The best pitch in the product sits behind the wall it exists to
earn.

**Anticipate is thin.** The drive lands on home under MY DRIVES; *"Tap a stop to hear it."* on the
detail page is the one real anticipation affordance and it's announced by a single dim caption.
Save-for-offline belongs to this beat too and reads as a chore, not a ritual.

**The arc is never named to the rider.** No surface says *make it now, drive it later* — which is the
whole promise.

## The proposal: hand the LLM the anchors and let the rider talk

> "bring back LLM-based 'create a drive' instead of drop downs (we now have the anchor places to help
> the LLM choose start and end)." — founder, 2026-07-31

What killed free text the first time was grounding: an invented endpoint is a hallucinated place. The
curated anchor set closes that hole **without** closing the input — the model doesn't *invent* a
place, it **chooses** one.

- The rider types: *"Take me from Tahoe City around the west shore to Emerald Bay, about two hours."*
- The resolver gets the region's anchors and must return **anchor ids** — never a lat/lng, never a
  name it composed. (Audit against the live DB, 2026-07-31: lake-tahoe has 26 endpoint-eligible
  anchors, 6 featured, 17 break anchors — so the menu is real, not empty.)
- Endpoints stay *grounded by construction*, which is precisely the invariant the picker was
  introduced to protect. **The grounding rule doesn't loosen; only the input does.** Same shape as
  the persona rule — charm lives in delivery, never in facts.

Free text also carries what dropdowns structurally cannot: **shape** (round trip, "the scenic way" —
there's already a `via` field and one-way/round-trip chips), **duration**, and **vibe**. Each maps to
something the selection path already understands or could.

### Open questions — not answered here

- **Fallback is mandatory.** The pickers stay as the floor. An unresolvable ask falls back to them
  *in persona* ("Don't know that one, friend — here's what I do know around here"). Never a dead end.
- **Does `/propose` become a spending path?** It already makes a paid Google Routes call, so a cheap
  model call on top is small — but it changes the endpoint's cost profile and deserves a deliberate
  call, not a drift. It already carries its own rate limiter.
- **Latency already has a home.** The create screen cycles a thinking beat (*"Charting your route…"*
  / *"Scouting the roadside…"* / *"Rounding up the good stories…"*). The resolver hides inside it —
  and arguably makes that beat *honest*, since today it's theatre over a route call.
- **Anchor breadth is the ceiling.** 26 anchors is a small menu; an ask outside it needs a graceful
  in-persona answer — and doubles as a demand signal for what to curate next.
- **Where the wall sits matters more now.** If free text *is* the magic, gating it behind
  `requireAccount` gates the magic. Worth deciding alongside, not after.

## Why this over more roam polish

The same-day audit found no user evidence on either side (the only feedback artifact in the repo is
8 TestFlight items, all founder-authored, all about roam trigger geometry — none about mode choice),
so this is a taste call and should be labelled one. The taste argument: roam's value scales with
**coverage**, which one region can't provide; a drive's value scales with **one good corridor**,
which is exactly what exists. The arc is the reason to lead with the mode that can actually deliver
its full promise today.

⚠ The honest counterweight, logged so it isn't lost: **no created drive has ever been driven
end-to-end on a real road** — the verification runbook has no recorded execution, while roam has
field miles. Before betting the front door on the arc, drive one.

## Provenance

- Founder, 2026-07-31 — both bullets above, verbatim, from a session weighing whether roam bloated
  the MVP.
- Same-session audit of the shipped first-run paths for both modes (naming, gates, coverage
  behaviour) and of the roam/drive code split. Conclusions there: the corpus is genuinely shared,
  the divergence is in *selection policy* and *addressing* — see
  [offline-region-packs.md](offline-region-packs.md) for the storage half of that finding.
