# V2 — roam-first + Create-a-Drive

> **Status:** IDEA → V2 PRODUCT STRUCTURE, founder-converged in a brainstorm 2026-06-18. Pre-spec:
> the architecture is being designed (a design-panel workflow) and promotes to `docs/specs/` only on
> an explicit build-greenlight. This is the larval **rung 2** of [journey-layer.md](journey-layer.md)
> made buildable on TODAY's batch stack, and the promotion of [roam-first-region-expansion.md](roam-first-region-expansion.md)
> from a region-opening *tactic* into the **first-day product shape**. **V2 may break freely** — see
> §Doctrine.

## The pivot

V1's hierarchy: a curated **tour is the product**; roam is the scrappy companion. V2 inverts it. The
first-day experience is **two things, in this order of intent:**

1. **Roam** — the ambient companion. Zero activation energy: start the car anywhere in a covered
   region and the Skipper rides shotgun, piping up at enriched POIs. The wedge. (Autio's proven turf,
   plus a persona Autio doesn't have.)
2. **Create a Drive** — the AI flex no pre-recorded competitor can match: the rider enters an
   arbitrary **A→B**, a route computes in *seconds*, and the Skipper threads the roam encounters along
   it into an ordered drive. Instant, infinite routes, **owned by the individual user**.

The hand-authored, bespoke-narration **"authored drive" is REMOVED from v1 and deferred** — we still
want it (it's the premium top of the funnel and the home of the drive arc/thesis/payoff), but it is
not a first-day experience. The funnel reads: *roam delights → the rider wants their own route
threaded → Create a Drive → (later) the rider wants the crafted film → authored drive.*

## The three-rung ladder (all on one shared corpus)

| Rung | What it is | Narration | v1/v2 status |
|---|---|---|---|
| **Roam** | No route, ambient, opportunistic | **Reused, region-owned** (already how roam works) | ship |
| **Create a Drive** | Enter A→B, sequenced along the route in seconds | **Reused roam clips** + cheap brackets + injected fillers | ship |
| **Authored drive** | Bespoke, real arc + callbacks + climax | **Minted fresh** (zero-reuse) | **deferred** |

The whole thing runs on the one region corpus + shared `fact_sheet`s that tours and roam already draw
from, and on the already-unified `segments`+`tracks` model (`tourId` NULL ⇒ roam encounter, set ⇒ tour
stop). So V2 is mostly **positioning + selection logic + ownership**, not a content rebuild.

## The accepted compromise: "roam in a nice order"

Create-a-Drive reuses roam clips because **realtime audio synthesis is too slow** (route compute is
seconds; TTS is minutes). Roam clips are written **context-free** — each POI is a self-contained
sandbox that knows nothing about any other POI, no sequence, no transitions, no callbacks. So a
Create-a-Drive is **not** the bespoke authored film; it's *roam, pre-ordered for your route.* That
quality ceiling is a **deliberate, accepted trade** — the magic comes from selection and framing, not
from new audio. The bespoke version is the deferred authored rung.

Two content-design rules make the compromise hold:

- **Lengthen + enrich roam clips as a baseline** so an island is a *good* island. But —
- **Self-contained ≠ re-contextualizing.** A clip earns "standalone" by diving straight into the
  *specific* charm of THIS place, NOT by re-narrating the region every time ("here at Lake Tahoe, the
  largest alpine lake…" eight times). Self-contained means *needs no prior clip*; it must NOT mean
  *re-explains the world*. Strip the generic region-framing; keep the specific. This is the single
  highest-leverage edit to the roam-clip authoring prompt — it's what stops a concatenation of islands
  from feeling repetitive even though nothing knows about anything else.

## What makes an instant drive *feel* curated (cheap, no new audio)

1. **Smart selection IS the curation.** A route may have 40 candidate POIs; a fast pass picks the best
   ~12 for a 45-min drive, paces them, ensures variety, and **skips the weak ones**. No synthesis.
   This is where "it feels made for me" is born. *(Leverage: the existing `selectStops` pacing engine —
   gap-fill, `mergedFeatures` cluster-merge, multiple breaks, queue-lag guard — is already
   candidate-set-agnostic. Point it at along-route roam candidates and most of this exists.)*
2. **Brackets are the cheapest charm-per-byte.** A personalized ~15s intro + outro bookend reused
   clips and make the whole thing feel bespoke. Short enough to **synth live in the pull-out-of-the-
   driveway window** (riders don't floor it instantly — 30–90s of headroom).
3. **Time/progress-anchored interstitials — the legal sequence-feel cheat (explore further).** Because
   we know the route AND the ETA, drop beats keyed to the *drive clock*, not to other POIs: "twenty
   minutes in," "halfway there," "last stretch." They reference the *journey*, never another POI — so
   they're fully compatible with context-free clips, yet they're the one thing that makes a playlist
   feel like a *journey* (the throughline context-free clips structurally can't give). A small
   pre-generated library of generic-but-charming progress beats, dropped by the pacing engine.
4. **Injected fillers in the gaps.** The known route+timing makes the silences a pacing canvas:
   sprinkle scenic/vista calls, waves, and **pit-stop / break** suggestions — and timed easter eggs.
   These map onto the existing `scenic`/`break`/`wave` track forms; the injection is the existing
   gap-fill logic.

## Doctrine implications (flag now; edit on build-greenlight, not before)

- **V2 may break freely — wire contract included.** V1 never shipped to any live users (founder-only
  TestFlight), so there are **no lagging installed clients** and the additive-only wire-contract freeze
  ([../decisions/api-versioning-posture.md](../decisions/api-versioning-posture.md), echoed in
  CLAUDE.md's "Scope (2026-06-09)") is **suspended for the V2 cutover**. Storage was already
  destructive-OK; V2 extends that to the `@skipper/shared` DTOs + `apps/api` routes. The force-upgrade
  gate already exists if a clean break is needed. *(On greenlight, this updates both CLAUDE.md and the
  api-versioning posture doc.)*
- **Zero-reuse scopes DOWN, it doesn't die.** The "narration is tour-owned, zero cross-tour reuse"
  doctrine ([../decisions/tour-data-model-zero-reuse.md](../decisions/tour-data-model-zero-reuse.md))
  was a *charm guarantee*, and it stays load-bearing **only on the deferred authored rung** (where the
  human ear-pass lives). Roam + Create-a-Drive get the explicit complementary rule: **narration is
  region-owned and shared** — two riders through Camp Richardson hear the same clip, by design,
  because you can't synth per-drive in realtime. (Roam already works exactly this way.) Corollary: the
  roam clip becomes the **load-bearing content artifact**, carrying both ambient *and* instant-drive
  duty — which is why the authoring-prompt rule above matters.
- **User-owned drives are a genuinely new concept — and must NOT touch `tours`.** "Tours stay
  anonymous/shareable — no `createdBy`" is a hard invariant; the `saved_tours` join was deliberately
  dropped. A Create-a-Drive belongs to *a user*, so the seam is a **new user-side table** (the
  [passport-logbook.md](passport-logbook.md) "lives on the USER, not the tour" pattern referencing
  `user.id`), never a column on `tours`. Sharing is **deferred** (drives are private to their owner for
  now). Whether a Create-a-Drive even persists as a row — vs. an ephemeral client-assembled timeline
  recomputed each time — is an open architecture question (below).

## The leverage finding (why this is a small build)

A code scout (2026-06-18) confirmed most pieces exist:
- **`selectStops` is candidate-set-agnostic** — `{ polyline, totalSec, wikiPois, breakAnchors, pacing }`,
  no tour-id dependency. The pacing/gap-fill/cluster-merge/break/queue-lag engine is directly reusable
  for an arbitrary route + along-route candidate set.
- **`materializeRoute` already computes routes** (Google Routes API v2 → frozen polyline + distance +
  duration), and `nearestOnRoute`/`cumulativeMeters` (engine) already snap POIs onto a polyline.
- **Roam narration is already region-owned/shared** and served open by `GET /roam` (bbox prefilter +
  haversine). Brackets already exist as placeless per-tour `tour_frames` (intro/outro).
- **Greenfield bits:** `route_sig` does not exist (anticipated as forward-compat tour-dedup — it's the
  natural cache-warming key here); there is **zero** user→content association in the codebase today;
  no live/quick bracket-synth path; no along-route candidate query exposed via the API.

## Design outcome + founder decisions (2026-06-18)

A design-panel workflow (3 architectures × 3 adversarial judge lenses) produced a build-ready
architecture; full detail is in the `v2-roam-create-a-drive-architecture` memory (a `docs/decisions/`
record is pending a build-greenlight). Workflow resolutions:

- **Persisted, not ephemeral.** A `drives` row holds a FROZEN selection manifest *referencing*
  shared roam tracks (mints nothing; preserves no-`createdBy`-on-`tours`); re-open replays it verbatim
  (resolve-and-skip dangling refs). An OPEN `POST /drives/preview` keeps the anonymous funnel-top
  friction-free; the wall stays at save/download/drive.
- **Selection** = a NEW `generateDrive()` in `engine` (co-located dedupe inverts to
  pick-one — you can't fuse finished `.m4a`s), ranking by along-route fit + real `audioDurationMs`
  best-fit + variety; runs on both server and device (offline re-pace).
- **`route_sig` + a `drive_demand` counter** ship as instrumentation ONLY; the cache-warming /
  authored-graduation infra is deferred behind a real route-concentration histogram.

Founder calls (2026-06-18):

1. **Two-phase create with a confirm gate.** Region is picked FIRST (an explicit picker, not inferred —
   bounds the LLM; out-of-region → error). Rider enters free-text origin + destination → a CHEAP
   `POST /drives/propose` (LLM resolves each to the best IN-REGION anchor — a real landmark/POI/break-
   stop, a payoff terminus, NOT a raw geocode pin — plus an accurate route preview; persists NOTHING,
   consumes NO credit). User CONFIRMS or modifies (re-propose is free) → `POST /drives` generates +
   persists. Mirrors the admin `proposeTour → freeze` pattern. The confirm protects the user's CREDIT
   (generation is cheap via reuse; the credit is the real cost — see access model), not synth spend.
2. **Sparse route = a plain "not enough here, try a different start/end."** No auto-handoff; Roam stays
   the separate ambient option, not a redirect. Degenerate-route bounds (min/max drive duration) are
   ADMIN-CONFIGURABLE.
3. **Tahoe-only at launch; Yosemite fast-follow** (Tahoe-grade corpus per the
   [roam-first-region-expansion.md](roam-first-region-expansion.md) probes — needs its paid roam-corpus
   run + a host-identity answer).
4. **Brackets = pre-generated GENERIC intro/outro only.** Live-gen / name-personalized brackets are
   POSTPONED (measured synth latency is too fragile for the mandatory first beat). The clock-anchored
   interstitials ("halfway there") survive — they are themselves pre-gen + generic + cheap.
5. **Suggested drives (cold-start) + loops.** The Create-a-Drive screen offers LLM-suggested A↔B options
   (incl. loops) for the picked region — **coverage-grounded** (generated over the enriched corpus /
   density-validated, NOT blind, or it proposes routes that hit the "not enough here" wall) and
   **precomputed + cached per region** (refreshed on corpus change), not live-LLM-per-open. Tapping one
   skips free-text resolution → straight to confirm. Suggestions are the COLD-START; popular `route_sig`s
   augment them once `drive_demand` has data (the steady state).
6. **Loops (A→A round trips).** `materializeRoute` already takes a waypoint ARRAY and `generateDrive` is
   route-shape-agnostic, so a loop (`A → via-points → A`) flows through unchanged. Work is only: a loop UX
   affordance (destination-optional + "around X" / duration hint), the LLM resolving "loop around the
   lake" → the waypoint set, and a **shape-aware `route_sig`** (endpoint-only keys collide when start≈end
   — key on via-points / a polyline hash).

## Access + monetization (RESOLVED 2026-06-18 — closes the long-open gate)

- **Anonymous = Roam ONLY.** Creating a Drive requires a FREE account. The create-action wall sits at
  account-creation — distinct from, and earlier than, the existing play/preview wall (a deliberate
  doctrine refinement for user-GENERATED artifacts: Roam + the future authored-tour catalog stay
  anonymously previewable; *generating* a drive does not). This restores the workflow's "require free
  before persist" instinct and drops the anonymous `/drives/preview` path + the `onLinkAccount` re-key.
- **Free tier caps generated drives at N** (admin-configurable) to bound cost/abuse. Beyond N →
  **one-time credit purchases** (Apple IAP consumables — NOT a subscription; matches the one-time-
  purchase + toy-lens doctrine). A credit is consumed on a confirmed `POST /drives`; propose is free;
  a FAILED generation should NOT consume one. Shares Apple-IAP groundwork with
  [tip-the-skipper.md](tip-the-skipper.md) (build the consumable-IAP layer once).
- **Entity = a new `drives` table** with a NOT-NULL `user_id` FK (text → auth `user.id`); always
  user-owned, references shared roam tracks, mints nothing — preserves no-`createdBy`-on-`tours`.

Micro-decisions SETTLED 2026-06-18: the propose/route-preview is FREE; a credit is consumed on a
confirmed generate and REFUNDED on failure; the free-tier CAP ships in core v2 with the credit IAP as a
fast-follow; **default free-tier N = 10 drives** (admin-tunable). Design is now fully locked.

## Settled V2 data model (2026-06-18) — supersedes earlier `user_drives`/`beats` mentions above

The conversation collapsed the model to a single atom + sequences over it. **`segments` and
`tour_frames` DISSOLVE.**

```
ATOM     pois ──1:1── narrations     the ONE shared telling (persona baked, region-scoped;
                                      form = story|scenic|break|wave, NO variant)
FLAVOR   asides                   shared, generic, NON-poi: intro/outro + clock-anchored
                                      "halfway there" beats   ("beat" = the spoken concept)
         authored flavor              DEFERRED, per-tour, zero-reuse — the only per-sequence narration

ROAM  = a MODE (no table): the RoamEngine plays a region's narration atoms by proximity
DRIVE = a stored USER-OWNED sequence (table `drives`): manifest [narration refs + aside refs] + per-route geom
TOUR  = the SAME sequence shape, CURATED (no user_id) + authored flavor.   DEFERRED.
```

**Tables built in V2:** `pois` (facts) · `narrations` (1:1, `poi_id` unique; = old `tracks` minus
segment + variant) · `asides` (= old `framing_clips`; intro/outro + clock-anchored "beats") · `drives`
(`user_id` NOT-NULL FK, `route_sig` indexed, `selection` jsonb manifest) · `drive_demand` (route_sig
counter) · `regions` · `personas` · auth. **Deferred:** `tours` (a SEPARATE table — no `user_id` — +
authored flavor), the route cache, the credit IAP (the cap ships in core).

**Vocabulary — schema (internal) vs UI (shown), per the 2026-06-18 terminology audit:** `drives` keeps
the word "drive" in code AND UI (founder accepted the ~442-hit `drive`/`Drive` identifier collision in
favor of the warm, consistent name — do NOT "fix" it to `trips`); schema `narrations` → UI **"stop"** (on
a drive) / **"story"** (in roam), NEVER "narration"; `asides` are unlabeled in UI ("beat" = the spoken
concept); `poi`/`region`/`persona`/`fact_sheet` stay strictly internal (UI shows the place name / "the
Skipper"). The dissolved `tour_stops` frees "stop" as pure copy — guard against a `stops` table returning.

**Three narration kinds; zero-reuse governs only #3:** (1) `narrations` 1:1/shared — the atom;
(2) `asides` region+persona/shared/generic; (3) authored flavor per-tour/zero-reuse/DEFERRED.

**A drive freezes STRUCTURE** (which POIs, order, trigger geometry, aside slots); **narration CONTENT
resolves live** via `poi_id` (a regenerated telling auto-improves a saved drive). Only a tour's authored
flavor is frozen content. **A Tour is the authored-upgrade of a Drive** (strip the owner, swap generic
asides for bespoke flavor) — making the popular-drive → tour graduation structural.

## Provenance

Founder brainstorm 2026-06-18 (this session), converged from: "should ROAM be primary with drives a
light layer on top?" → reuse roam clips on a drive's route → on-demand user-generated A→B drives →
remove authored-drive from v1 → tag V2, break freely (V1 never shipped). Parents:
[journey-layer.md](journey-layer.md) (rung 2 per-trip bespoke — realized here via *reuse*, not the
live-gen that doc assumed), [roam-first-region-expansion.md](roam-first-region-expansion.md) (roam as
beachhead → here the first-day product), [free-roam-mode.md](free-roam-mode.md) (the mode itself),
[../decisions/create-a-drive-architecture.md](../decisions/create-a-drive-architecture.md) (the V2 model that
makes roam and drives one substrate). Grounded by a 2026-06-18 code scout (the leverage finding above).
