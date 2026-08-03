# Scenic stops spec — deliberately adding scenic stops

**Status:** design, agreed in a PM session (2026-06-08). NOT built — KEEP + REWRITE for V2
(re-anchored 2026-06-19). The CONCEPT survives the V1→V2 pivot, but its implementation plan was
written against storage that no longer exists; read the V2 banner below before building.

> ✅ **SCOPED 2026-08-03 — read §11 first.** The demand is now measured (every one of the 458 live
> narrations is a `story`; the scenic tier has NEVER been generated, while a real drive runs 79%
> silent), the population is counted (925 fact-less POIs, **312** with both a kind and a road-snapped
> anchor — the honest first run), and most of the build is **recoverable** from the cut WAVE form
> (`fd2df45` + `81f6ca5`), whose two traps already have fixes. ⚠ It punctuates the silence, it does
> not fill it. 💸 Any real test spends.
>
> ⚠ **Its core mechanism was BUILT AND REJECTED — read
> [scenic-filler-and-the-empty-stretch](../decisions/scenic-filler-and-the-empty-stretch.md) FIRST**
> (added 2026-08-03). `SCENIC_ANCHORS` — the factless curated-overlook table this spec proposes at
> §210/§233 — was implemented and reverted on **2026-06-09** (`d2a2056`); the founder's words were
> *"too neutered"*, and the paired `FEATURED_STOPS` force-include died alongside it because famous
> spots should be **grounded, not factless**. The call: candidate-less stretches **stay silent**, real
> stops only. That decision was never written down until now, which is why this spec still reads as
> live. It was REOPENED 2026-08-03, but not in this shape — see §3 of that record.

> **Schema-names note (updated 2026-06-19 for the V2 roam-first model):** the V1 authored-tour
> storage this spec assumes is GONE (migration 0009 dropped `tours`/`tour_stops`/`segments`/`tracks`/
> `tour_brackets` — see `packages/db/src/schema.ts`). Re-anchor onto V2:
> - A scenic stop is a **`narrations` row with `form='scenic'`**, 1:1 with a `pois` row
>   (`narration_form` already includes `scenic`). It is place-owned/shared, NOT per-tour.
> - **The original "scenic = a Wikipedia POI too thin to narrate" premise is OBSOLETE.** V2 already
>   produces scenic two ways without a new enum value: (1) scenic pins are **discovered from
>   Wikidata** (a named bay/beach with no Wikipedia article owns its `pois` row, CC0 name — see the
>   `poiSourceEnum` comment), and (2) a story POI with NO enrich `fact_sheet` is **downgraded to
>   scenic** (the #1 invariant: silence beats a bad telling). So the spec's reason-to-exist
>   ("deliberate, not accidental, scenic") is largely met by discovery + the downgrade; what's left
>   to decide is the **synthetic-anchor / founder-placed-overlook** case (a pretty stretch with no
>   POI at all — §3).
> - The V1 `'curated'` `poiSourceEnum` value does NOT exist (live enum: **`wikipedia`/`wikidata`** —
>   Wikidata-spine ONLY, deduped by the QID) and the factless scenic-anchor approach was built then
>   REVERTED. Don't re-add it without first deciding it's still needed given Wikidata discovery (§3).
>   **`google_places` is NO LONGER a poi/discovery source** — Google break anchors live in their own
>   `places` table (keyed by `place_id`, no QID); `google_places` survives only as an *attribution*
>   source. So a scenic stop is **always** a Wikidata-spine `pois` row.
> - `tour_brackets` (intro/outro) had no surviving home: the placeless `asides` table that briefly
>   carried intro/outro frames in early V2 was itself **DELETED in migration 0019**
>   ([geometry-first-regions](../decisions/geometry-first-regions.md)); placeless framing **returns in
>   v3 with guided tours**. (Scenic stops don't need it — they are route-anchored `narrations`, §4.)
>   `poi_content` is GONE (no content cache; narration is place-owned). `finalizeTourReady` is GONE —
>   readiness derives from non-null `audio_url`. `select.ts` lives at
>   `packages/studio/src/pipeline/select.ts`; `generate.ts` → `packages/studio/src/generate-narrations.ts`;
>   `persist.ts` stays. Re-locate every seam by function name, not line number.
> - The V2 zero-reuse + atom model: [tour-data-model-zero-reuse](../decisions/tour-data-model-zero-reuse.md).

Sits on top of: the **geology channel** (committed — `pipeline/macrostrat.ts`, scenic stops are
auto-enriched at their trigger point) and the **Wikidata channel** (committed — `pipeline/wikidata.ts`,
a sibling enrichment for sparse story stops). Note story enrichment is now scout-decided
([enrichment-scout](../decisions/enrichment-scout.md)); the old `GEOLOGY_ICONIC_STOPS` const (cited
below as the pattern for `SCENIC_ANCHORS`) no longer exists, though the curated-anchor TABLE pattern
itself is still fine.

---

## 1. What & why

**Goal:** deliberately create SCENIC stops, as rest beats and gap-fillers — not only as a fallback.

**V2 already produces scenic two ways (see the banner)** — Wikidata-discovered pins with no
Wikipedia article, and story POIs DOWNGRADED to scenic when they lack an enrich `fact_sheet` (the #1
"silence beats a bad telling" invariant). So scenic is no longer purely "a Wikipedia POI too thin to
narrate." **What's still missing** is the *deliberately placed* scenic — a founder-chosen pretty
stretch with no POI at all — plus the anti-monotony discipline (§5) that keeps a run of scenics from
collapsing into "look at that water."

**Why we want them:**
1. **Pacing / breathing room** — a wall of dense ~2-min story stops is exhausting; the persona
   prompt itself says "let real moments breathe." Scenic stops are the rest beats.
2. **Geology's headline win** — the scenic-geology rescue (a factless pretty stretch + the real rock
   under you) fires on scenic stops; deliberate scenics give it more to land on.
3. **Fill long story-gaps** — stretches with no Wikipedia POI for miles get something to FEEL
   instead of dead air.

**What a scenic stop is (the contract):** delivery-only ambient audio, no fact sheet. The persona
names NO peak / town / island / landmark (naming one is a fact it wasn't given). Region framing IS
allowed ("the West Shore") — but a SHARED scenic telling reused both directions must stay
direction-NEUTRAL (§4). **Geology is the one grounded exception** — a scenic stop may state the
bedrock + rough age (from Macrostrat) and nothing more. It is a `narrations` row with `form='scenic'`
+ non-null `audio_url` (the readiness boundary). `TARGET_SECONDS.scenic = 20`.

---

## 2. The plan (both adversarial lenses agreed)

**One-line:** *curate/freeze the WHERE, generate the WHAT with a tracked scenic-mode rotation, and
let the existing geology channel light up underneath.*

| Mechanism | Where the scenic stop comes from | Data | Verdict |
|---|---|---|---|
| **Curated/frozen scenic anchors** | hand-picked coord + non-naming label, as a config table (the old `GEOLOGY_ICONIC_STOPS` const is gone, but the curated-anchor TABLE pattern is fine) | none (config + geometry) | **Ship first (if §3 keeps it)** |
| **Rotating scenic-mode palette** | — (content layer, §5) | none | **Mandatory, build with #1** |
| **Gap-fill (auto aside)** | time-gap between narrated stops > threshold → scenic at a route VERTEX | none | Strong, next |
| **Terrain/elevation-derived** | pass-crests, the lake-reveal, from the elevation profile | USGS 3DEP/EPQS (offline) | Later (expansion) |
| **OSM/Overpass viewpoints** | external viewpoint/natural features | Overpass (runtime) | **Pass** |

- **Ship-first = curated anchors.** For a toy with one+ frozen routes, founder taste placing the
  overlook by ear beats any heuristic — it *is* the "polish over scale" value. Pure config, zero
  API, faithful trigger, dedup-clean. This is the smallest path to firing the geology rescue.
- **Why not OSM:** flaky runtime API, off-route snapping (fires the stop in the WRONG place), ODbL
  attribution surface, and the sharpest hazard — the real landmark NAME ("Inspiration Point") would
  sit on `pois.name`, one careless refactor from the skipper speaking an ungrounded place.
- **Gap-fill** is the natural automatic placement once curated anchors prove out. Note: `nearestOnRoute`
  snaps to the nearest VERTEX, so picking a polyline vertex directly is leaner than interpolating a
  point with `pointAtAlong` and throwing it away on the snap.

---

## 3. The POI-anchor decision (a scenic `narrations` row references a `pois` row 1:1)

Every telling — scenic included — is a `narrations` row 1:1 with a `pois` row (`narrations.poiId` is
NOT NULL). **In V2, most scenic anchors already have a real `pois` row** and need no synthetic
source:
- A named bay/beach/park with no Wikipedia article is **discovered from Wikidata** (CC0 name, its own
  `pois` row) → it can be told scenic directly.
- A story POI with no enrich `fact_sheet` is **downgraded to scenic** → it already has its `pois` row.

So the **only** case still needing a synthetic anchor is a *truly placeless pretty stretch* — a
founder-placed overlook with no POI of any kind. **Decide whether that case is worth a new source at
all** before re-adding the reverted `'curated'` enum value; for a single frozen-route toy, a
hand-picked Wikidata-or-discovered anchor near the overlook may cover it without new schema.

**IF a synthetic anchor is still wanted** (founder-placed overlooks the engine should fire at a
chosen coord), the V1 sketch transposes to V2 as:
- A scenic-only POI source. The V1 `'curated'` `poiSourceEnum` value was REVERTED and is NOT in the
  live enum (now **`wikipedia`/`wikidata`** only — Wikidata-spine; `google_places` is no longer a
  discovery source); re-add `'curated'` only in **lockstep** across `packages/db/src/schema.ts`
  `poiSourceEnum` + `packages/shared/src/enums.ts` `poiSource`. **Footgun:** `ALTER TYPE poi_source ADD
  VALUE 'curated'` can't run inside a transaction on some Postgres — verify the generated migration
  applies on neon-http. (Per CLAUDE.md the wire contract is no longer break-freely once shipped, but
  the `pois`/`poiSource` enum is studio-side STORAGE — still destructive-OK.)
- **The bigger schema obstacle (NEW under the QID-spine model):** `pois` now dedups on the Wikidata QID
  (`pois_qid_uq`, `qid` NOT NULL) — `(source, source_id)` survives only as a secondary guard. A curated
  overlook has **no QID**, so re-adding `'curated'` means *also* relaxing the NOT-NULL `qid` /
  `pois_qid_uq` constraint (e.g. a nullable QID for non-Wikidata sources, or a synthetic-QID scheme).
  Decide this before re-adding the enum — it's a deeper change than V1's `(source, source_id)`-only
  world implied. If a curated row IS added, `sourceId = "${region-or-drive-slug}:${anchorId}"` (e.g.
  `'lake-tahoe:overlook-1'`) keys it via the secondary `(source, source_id)` guard so regeneration
  upserts the SAME row. **`anchorId` is immutable** (like a migration key); renaming it orphans the row.
- `pois.name` = a **generic, non-landmark label** ("a pull-out high over the bay") — stored (NOT
  NULL) but **never spoken** (the scenic narration omits `place`). **Pin this with a unit test** so
  a future refactor can't leak the label into narration.
- **`attributionSource` needs NO `'curated'` entry** — a curated anchor owns no copyrightable text; a
  curated scenic clip credits only Macrostrat (when geology hits) or carries `attribution: null`.

---

## 4. ⚠️ The V2 shared-corpus tension (the direction-dependence problem, transposed)

V1 framed this as an entanglement with a per-direction "tour-structure / directionality" model. That
model is GONE (V2 drives are user-created A→B routes that REUSE a shared place-owned `narrations`
corpus, pre-ordered along the route — see
[tour-data-model-zero-reuse](../decisions/tour-data-model-zero-reuse.md)). But the load-bearing
insight survives and gets SHARPER under V2:

- **Scenic framing is DIRECTION-DEPENDENT, and a scenic narration is SHARED.** "The climb out of the
  basin" is a climb one way and a descent the other; a reveal happens in one direction only. In V1
  that meant "scenic anchors live per-direction." In V2 there is exactly ONE `narrations` row per
  poi, reused by drives going BOTH ways — so a scenic telling that says "as you climb" is **wrong for
  half its riders.** This is the core constraint: **a shared scenic telling must be
  direction-NEUTRAL** (mood / light / region-frame that reads either way), OR the CLIMB/REGION-FRAME
  mode (§5) needs a direction-aware variant axis that V2's 1:1 atom deliberately doesn't have yet
  (the deferred multi-telling axis). For v1, keep shared scenic tellings direction-neutral.
- **Intro/outro need no scenic anchor.** They are placeless framing (no poi) — fully decoupled from
  scenic anchoring. (That framing is itself v3-deferred: its `asides` storage was deleted in 0019, see
  the banner. It's irrelevant to scenic stops either way.) There is no shared synthetic-anchor scheme
  to "settle jointly."
- **The selection seams moved.** Scenic insertion is now in `packages/studio/src/pipeline/select.ts`
  (`resolveStoryGrounding` + the stop-plan build) and `packages/studio/src/generate-narrations.ts`;
  drive-time ordering is `buildDrive` in `@skipper/engine`. Re-locate every seam by function name,
  not line number.
- **engine stays form-naive** → the scenic plan's "player/sim = zero changes" still holds.
  `TriggerEngine` is form-agnostic; a scenic narration with normal trigger geometry fires
  identically. Only VERIFY short-clip (~20s) overlap in the simulator.
- **Headline derivation** uses the marquee POI — make sure generic-named scenic POIs are excluded
  from any headline/teaser derivation so they can't become a card title.

---

## 5. Content + anti-monotony plan (MANDATORY for any source)

A scenic stop's only grounded content is geology, so N of them risk collapsing into "look at that
water" — the #1 charm risk the persona prompt already frets about. Make anti-monotony **structural**:

**The palette — ~6 fact-free MODES** (none introduce a place-fact):
1. **GEOLOGY** — lead on the rock underfoot (the headline win; the only mode citing a fact).
2. **WATER/LIGHT MOOD** — color, glare, quiet (the classic — *rationed*, not the default).
3. **CLIMB / REGION FRAME** — "as you pull up out of the basin" (allowed without facts; **direction-
   dependent** — see §4).
4. **FACT-FREE DAD JOKE** — a standalone groaner off road/weather/truck/coffee.
5. **HONEST EMPTY** — "no story to this bend, folks — just look at that." Very on-persona.
6. **CALLBACK** — a sparse, earned nod to an earlier stop's motif.

**Enforcement — reuse the existing tracking, don't invent a new system.** `generate-narrations.ts`
already maintains recent-opener / recent-closer / recent-motif tracking threaded into every narrated
request.
- Add a parallel `recentScenicModes` + a cursor that **avoids the immediately-preceding mode**.
- Thread `scenicMode` into the narration request **only** for `form === 'scenic'` (beside the
  geology/wikidata blocks already there).
- `narrate.ts`: add `scenicMode?` to `NarrationRequest`; in the scenic branch emit a per-mode
  directive + a "recent scenic modes (vary from these)" line, mirroring the recent-openers scaffold.
- `lint.ts`: add a scenic-mode-repeat check feeding the **existing** regen hook.
- The persona prompt (`packages/studio/src/persona/skipper.ts` — the highest-leverage file): expand
  the SCENIC section with the palette + the iron rule — modes vary, none assert a place-fact, geology
  is the one exception, keep the existing bans (no peak/town/island name; **no "deep-time vs our brief
  lives" geology closer**; vary openers/closers).

**Note:** even one region's corpus will place scenic stops close enough in register to feel same-y;
the mode rotation also keeps a run of geology-only scenics from going monotone.

---

## 6. Code changes (re-locate seams against current code)

In dependency order (the mode-palette work, §5, is the part that survives cleanly; the synthetic
anchor, §3, is conditional on deciding it's still needed over Wikidata discovery):
1. **(Only if §3's synthetic anchor is kept)** `packages/db/src/schema.ts` + `shared/enums.ts` — the
   scenic-only `'curated'` `poiSourceEnum`/`poiSource` value (lockstep) + migration (txn footgun
   above).
2. **`config.ts`** — `interface ScenicAnchor { id; label; lat; lng }` (+ optional `direction`?);
   `SCENIC_ANCHORS: Record<slug, ScenicAnchor[]>`; `SCENIC_MODES` rotation list; `SCENIC_GENERIC_NAME`
   fallback. (Later: `SCENIC_GAP_SEC` per bucket ≈ `2×minGapSec` + `SCENIC_MAX_STOPS` for gap-fill.)
3. **`select.ts`** (`packages/studio/src/pipeline/select.ts`, where scenic grounding resolves) — a
   `selectCuratedScenic(params, snapOf)` helper that snaps each anchor via the existing snap closure
   (→ `triggerLat/Lng/approachHeadingDeg/alongSec`), drops off-route (`> OFF_ROUTE_MAX_M`), emits a
   plan with `form:'scenic'`, the synthetic source, no fact sheet, `targetSeconds:TARGET_SECONDS.scenic`;
   merge **before** the along-route sort; add a **min-gap drop pass** (drop a scenic within `minGapSec`
   of a narrated stop) so scenic is breathing room, never clustered / on top of a story.
4. **`generate-narrations.ts`** — pass the scenic anchors into selection. Geology enrichment + TTS +
   the `narrations` upsert already handle `form:'scenic'` and arbitrary `source` generically — **keep
   the geology scenic-rescue working** (it enrolls every scenic stop at the trigger point). Only add:
   thread `scenicMode` into the scenic narration request (§5). Readiness derives from non-null
   `audio_url` on the row — no batched ready-gate to extend.
5. **`narrate.ts` + the persona prompt (`persona/skipper.ts`)** — the scenic-mode palette + directives
   (§5). No contract change.
6. **Player / sim / engine** — ZERO changes; only verify short-clip overlap in the simulator.

---

## 7. First experiment (smallest end-to-end proof)

1. Pick the anchor SOURCE: a Wikidata-discovered pin near the overlook (no new enum), or — only if
   that won't cover it — the §3 synthetic `'curated'` source (lockstep + migrate).
2. Add **ONE** `SCENIC_ANCHORS` entry for the canonical region — **founder eyeballs the overlook coord
   on a map**, landed ON the road so the snap is faithful.
3. Add `selectCuratedScenic` + the min-gap drop; thread the anchors through `generate-narrations.ts`.
4. (Optionally defer the full mode palette for the very first smoke test — a single scenic stop can't
   be monotone against itself — but at least wire the `scenicMode` plumbing.)

**Success:** the studio pipeline log shows `1 scenic` in the breakdown (the deliberate birth path the
accidental one never hits) and `(1 scenic …)` in the geology line; the scenic clip **names no peak/
town/island**, asserts **only** the granite + rough age, sets a mood, ~20s; its `narrations` row has
non-null `audioUrl` + `audioDurationMs` with `attribution` carrying the Macrostrat CC BY entry; the
drive reaches playable. **Dry-run** via the studio dry-run path (dump the scenic script + fact sheet,
eyeball grounding — no leaked landmark name) + load into the simulator (triggers at the snapped point,
~20s clip doesn't overlap a neighbor). `bun run check` green after any enum change.

---

## 8. Open founder decisions
- **Is a synthetic anchor even needed?** Decide whether Wikidata-discovered pins + the
  un-enriched→scenic downgrade (§3) already cover the deliberate-scenic need, or whether a
  founder-placed-overlook (no POI at all) still warrants re-adding the reverted `'curated'`
  `poiSourceEnum` value.
- **Build the full mode palette now, or ship one geology-mode anchor first** as a smoke test, then
  layer modes.
- **Direction-neutral shared scenic vs a deferred direction-aware variant axis** — the V2 1:1
  `narrations` atom forces one shared telling per place reused both ways (§4); decide if the
  CLIMB/REGION-FRAME mode stays direction-neutral or waits on the deferred multi-telling axis.

## 9. Invariants to honor
Persona lives in DELIVERY not FACTS; scenic names no landmark (geology the one exception); frozen
rails (don't let "curated WHERE" leak into curated WHAT — the words stay generated); every telling has
a trigger point + non-null `audio_url` (the readiness boundary); a SHARED scenic telling stays
direction-neutral (§4); keep the geology + Wikidata enrichment channels working unchanged.

## 11. SCOPE (2026-08-03) — the demand is measured, and most of the build is recoverable

Added after a measurement pass that started somewhere else entirely (how to fill the silence between
far-apart POIs) and landed here. **Read §1–§10 as the 2026-06-08 design; read this as the current
state of the world.**

### 11.1 The demand, measured

⚠ **Every narration in the live corpus is a `story` — 458 of 458. The scenic tier has never been
generated once.** Meanwhile a real drive is **79% silence** with gaps of 3:33–6:15, and neither more
stops nor b-side leftovers can close it — both tested and both negative. Full numbers:
[scenic-filler-and-the-empty-stretch §5](../decisions/scenic-filler-and-the-empty-stretch.md).

### 11.2 The population, counted

Un-narrated, un-excluded, un-clustered POIs with **no facts at all** — the places that are silent
today precisely because a story needs a sheet:

| set | count |
| --- | --- |
| total | **925** |
| ...with a `kind` (the require-a-kind gate; 9 were dropped for a null kind at wave cut-time) | 880 |
| ...with a road-snapped `speakable` anchor | 318 |
| ...**both — the safest subset to run first** | **312** |

Top kinds: mountain 214, lake 168, valley 88, park 88, meadow 70, spring 47, hill 46, ridge 40.
On the flagship drive specifically, **19** sit reachable along the route (Eagle Rock, Emerald Point,
Inspiration Point, Rubicon Bay, Baldwin Beach, Lester Beach, Calawee Cove Beach, McKinney Bay…).

⚠ Most are NATURAL features, so most carry the fat kind-aware trigger floor (1500 m for a peak,
1200 m for a lake or valley) and only 318 of 925 are road-snapped. Anchoring is the difference
between a call-out that lands where you can see the thing and one that fires a kilometre early.

### 11.3 ⚠ This was BUILT and CUT — do not spec it from scratch

The **WAVE form** (`cut-wave-form.md`) was exactly this: a ~15 s call-out naming a place and its
kind, built for the 932 bare `source='wikidata'` Tahoe pins. Built 2026-07-24 (`fd2df45`, `81f6ca5`),
smoke-tested twice, **cut 2026-07-26** before the v2 release with zero rows ever written. The build
is **recoverable in full from those two commits**, and the pre-run scope at cut time was **378
eligible clips, ~$29–31, ≈95 minutes**.

⚠ **`narrate.ts` already supports scenic and is NOT part of what was cut** — `stopType === 'scenic'`
branches are live, including the anti-invention guard: *"FACT SHEET: (none — no real facts available.
Treat this as a scenic moment; do not invent a story.)"* What is missing is the GENERATOR path:
`generate-narrations.ts` skips any poi without a fact sheet, and its comment says so, pointing at the
wave cut.

⚠⚠ **Reviving it for DRIVES is a NEW decision, not a restore.** Wave was built for ROAM, and
`loadCorpusForRoute` carried an explicit `ne(narrations.form, 'wave')` exclusion — drives deliberately
filtered it out. Roam is gone; the exclusion went with the backout. Whoever revives this must decide
the drive question on its own merits rather than inheriting a roam-era answer.

### 11.4 The two traps, and their fixes (both already written)

From `cut-wave-form.md` §"Two traps" — the real yield of that build, and **properties of any form
whose sheet is a name + a kind**, so they apply here in full:

1. **Monotony is STRUCTURAL, not a weak prompt.** With two input fields the model converges hard —
   measured, 2 of the first 3 smoke clips were the same sentence template. ✅ Fix in `81f6ca5`:
   **assign the opening shape round-robin by queue index**, never a rolling recent-openers buffer (a
   buffer leaves the first `NARRATION_CONCURRENCY` clips generating against empty history and
   colliding). Verified at the time on 6 pins of the same kind → 6 distinct openers.
2. **The grounding gate CANNOT catch a claim derived from the place's NAME.** "Cathedral Peak" with a
   null kind produced "there's a peak out there" — a kind the card never gave; the gate passes it
   because the claim traces to the name, and the name is legitimately on the grounding well. ✅ Fix:
   **require the sayable fields up front** (the require-a-kind filter) rather than trusting the gate.
   ⚠ This is why the 312 "kind AND anchored" subset is the honest first run, not the 925.

### 11.5 ⚠ What a scenic run does NOT do

**It punctuates the silence; it does not fill it.** A 15–20 s call-out inside a 6-minute gap leaves
~5:45 still quiet. Nothing short fills a six-minute gap and nothing long can be written for a place
with no facts, so the [scenic-filler](../decisions/scenic-filler-and-the-empty-stretch.md) decision
survives. The question this tier actually answers is narrower and worth stating plainly: **is naming
the thing you are looking at worth 15 seconds?** That is an ear question, and it is the one the
smallest run should be sized to answer.

### 11.7 ✅ SMOKED 2026-08-03 (founder go) — 10 clips, $0.11, nothing persisted

Ran `generate-scenic-narrations.ts` (new; modelled on the b-side CLI — preview by default, `--apply`
makes the model calls, persists NOTHING). Two rounds: 4 clips across 4 kinds, then **6 FRESH places
across 6 kinds** with `--offset 1` so the re-test never touched the first round's population.

**✅ THE EAR QUESTION IS ANSWERED: yes, naming what you are looking at is worth twenty seconds.**
The form carries the voice on two input fields:

> *"That one out there, standing tall — that's **Alder Hill**. Now, hill's right there in the name,
> but it's a mountain, so somebody was clearly aiming low."*

**✅ Trap #2 (name-derived claims) is handled BY THE EXISTING PROMPT** — no new guard needed. The
model actively refuses what the name implies: *"**Badger Spring**… Now I cannot promise you a badger,
and I cannot even promise you the water from here"*; *"**Amazon Gulch** — big name for a quiet cut of
ground, and no jungle in sight"*; *"**Butler Peak** — called a peak, but really it is more of a
hill."* The `namedScenic` block is doing exactly the job it was written for.

**⚠ Trap #1 (monotony) is NOT fixed by a rolling buffer — the round-robin-by-index fix in `81f6ca5`
is REQUIRED.** Measured: feeding `recentOpeners` alone left **4 of 4** clips closing on the same wry
generalisation. Adding `recentClosers` took it to **3 of 6** — and the three that collapsed were clips
**1, 2 and 3**, while 4–6 diverged cleanly once the buffer had content. That is precisely the failure
`cut-wave-form.md` predicted: *"a rolling buffer leaves the first `NARRATION_CONCURRENCY` clips
generating against an empty history and colliding with each other."*
⚠ Worse, a buffer does not persist ACROSS runs: round 1's park opened *"Off out there, that green
patch — that's Amione Park"* and round 2's opened *"Out there, that green patch — that is Ardmore
Park."* Same kind ⇒ same sentence.
⚠ **And the worst case has NOT been tested.** These rounds spread across KINDS, which is the easy
case; the wave build verified its fix on **6 pins of the SAME kind**. Do that before any full run.

**⚠ A prompt contradiction was found by the FREE preview, before any spend** — and it had never fired
because this branch has never been generated. The `namedScenic` block granted *"say… which side it is
on"* while the `selfContained` block forbids naming a side outright (the shared atom cannot know
direction). Fixed in `narrate.ts` by dropping the scenic half; the self-contained rule is the
architecturally correct one. ⚠ It is inside `if (namedScenic)`, so no story or break telling was ever
affected.

### 11.8 Round 3 — the WORST case, and a failure the wave build never saw

Ran six MOUNTAINS (`--kind mountain --offset 2`) — same kind on purpose, which is the case `--spread`
cannot test, since a lake and a peak diverge for free on vocabulary alone.

**✅ THE OPENING ROTATION HOLDS AT THE WORST CASE.** Six distinct openings, each visibly following its
assigned angle: *"See that peak lifting up out there…"* (the thing, unnamed) · *"**Basalt Mesa** —
somebody looked at that thing and picked those two words and made them stick"* (turning the name
over) · *"I love this kind of light…"* (own reaction) · *"They call it **Billy Hill** — which is a
funny name for a mountain, but nobody asked me. Billy went and got himself a promotion, hill to
mountain, and never looked back."* That last is a genuinely free groaner off a name and a kind and
nothing else — the form's best argument for itself so far.

**⚠ AND IT EXPOSED A SEPARATE FAILURE: the CLOSERS collapse on their own.** *"Some of them you just
look at" · "Some of them you just tip your hat to and keep rolling" · "Some peaks you just tip your
hat to and let stand"*, plus *"doing all the talking anyway"* twice in six. Across all **16** smoke
clips, roughly **10 end on the same "Some X you just Y" move**, and "tip your hat" now spans three
clips in two runs.

⚠ **The wave build could not have found this**, which is why `81f6ca5` reports "six distinct openers"
and stops there: a ~15 s wave is one breath with no room for a closing gesture. At the 20–30 s band
this tier needs, there IS room, and the model reaches for the same move every time. **Fixing the
opener does not fix the closer** — they are independent failures of the same low-input cause.

✅ Fixed the same way, since the mechanism just proved itself: `SCENIC_CLOSERS` + `closingAngleFor`,
assigned by index. ⚠ **FIVE closers against SIX openers, on purpose** — co-prime, so pairings cycle 30
clips before repeating rather than locking into six fixed couples. ⚠ One shape is **"DO NOT CLOSE AT
ALL"**, which is the direct antidote: stopping early is itself a shape.
⚠ **Assigned, not BANNED**, and that is a repo lesson, not a preference: the persona prompt once
banned three completions of *"here's the …"* while the lint banned nine, so the model wrote a fourth
nobody had forbidden. Structure beats prohibition in a form this low-input.

### 11.9 ✅ VERIFIED — the collapse is gone (round 4, 6 fresh mountains, $0.06)

Same kind as round 3 so the comparison is clean, fresh `--offset 8` so it never touched the repair
population, **one variable changed**: closers now assigned too.

| round | mechanism | clips ending on "Some X you just Y" |
| --- | --- | --- |
| 1 | rolling buffer, openers only | **4 of 4** |
| 2 | rolling buffer, openers + closers | 3 of 6 |
| 3 | index-assigned **openers** | 3 of 6 (openers fixed, closers untouched) |
| 4 | index-assigned openers **+ closers** | **0 of 5 observed** |

Every closer visibly followed its assigned shape — *Brockway Summit* landed the joke (*"the view
really is on the summit of things"*), *Bullshead* ended mid-gesture on a literal dash (*"just the
look of it, and —"*), *Burned Hill* took DO-NOT-CLOSE and stopped at 34 words (the shortest clip of
the whole smoke), *C Hill* closed on the name (*"And wouldn't you know it, I can see it just fine"*).
"tip your hat" vanished entirely.

⚠ **0 of FIVE, not six** — the sixth clip scrolled off the captured output. Recorded as observed
rather than rounded up.
⚠ Worth keeping: **Bullshead declined the obvious crude joke** and stayed on "a mountain, plain and
true". That is the ceiling holding under temptation, not luck.
⚠ A DO-NOT-CLOSE clip lands SHORT (34 words ≈ 14 s against a 20 s aim). That is correct doctrine, not
a defect — `cut-wave-form.md` recorded the same thing ("lengths ran 4-9s, under the 15s aim… a
name-only wave lands short and evaluatePacing never flags short"). Do not tune it back up.

**Total smoke: 22 clips, $0.25, nothing persisted.** The content question is closed.

### 11.10 ✅ RESOLVED — the blocker below is FIXED; the drive now plays the tier

**Built 2026-08-03, $0.** `DriveCandidate.glance` + a fill pass in `buildDrive` (step 4b), run AFTER
the stop selection is final. Re-measured on the same drive:

| | stops | scenic | coverage | quiet | **longest gap** |
| --- | --- | --- | --- | --- | --- |
| today | 8 | 0 | 23% | 80% | 6:12 |
| **with the glance fill** | **13** | **5** | 27% | 75% | **3:40** |

**The worst silence nearly halves.** Coverage moves only 4 points — which is the point: a glance
PUNCTUATES the quiet rather than filling it, exactly as §11.5 said it would. The five it picked are
Kasian Recreation Area, Kailua Park, Lonely Gulch, Eagle Point and Baldwin Beach — real named
features spread along the route.

⚠ **The eight stories are bit-identical** (audio 9:03 → 10:43, i.e. +1:40 = exactly 5 × 20 s). That
is the design constraint, not a happy result: a glance must never displace a telling, so the fill runs
after selection and cannot perturb it. Pinned by a test asserting the non-glance stops come back
unchanged.

Rules, each with a reason:
- **ONE glance per quiet window**, and it must clear `GLANCE_EDGE_SEC` (45 s) on BOTH sides — of the
  clip that just finished PLAYING (not merely of its trigger: the FIFO means a stop's audio outlives
  its trigger by its whole duration) and of the next stop's trigger.
- **Glances ignore `driveMaxStops`.** That cap keeps a drive from becoming a lecture at ~1 stop / 4
  min; a 20-second call-out inside a 6-minute silence is not what it protects against, and counting
  them would make the cap starve the very gaps this fills.
- **Earliest eligible wins**, because a glance's `alongSec` is where the place physically IS — you
  call a thing out as you pass it, and the runner-up is simply further down the road.
- **Never within `DRIVE_MIN_SEPARATION_M` of a selected stop** — the co-located rule the stop pass
  applies to itself, applied across the two passes.

**MUTATION-CHECKED:** setting `GLANCE_EDGE_SEC` to 0 fails 1 test; letting glances compete in the main
pass instead of filling fails 3. Engine 130 → 135 tests.

⚠ Still true, and the reason this is not "done": the fill proves a scenic clip WOULD be selected. It
does not generate one. The machinery in §11.9's closing paragraph (TTS, loudnorm, R2, the eval gate
against an empty fact well, the never-used write path) is unchanged and still ahead of the ~$29–31 run.

<details>
<summary>The original blocker, kept as the record of what was wrong</summary>

### ⛔ BLOCKER (2026-08-03, now fixed) — a scenic clip is NEVER SELECTED

Measured free, 2026-08-03, **before** any generation spend — and it would have been a ~$30 mistake.
Simulated the real Tahoe drive with the scenic tier added as candidates (20 s each, the band the smoke
produced):

| run | stops | of which scenic | coverage | quiet |
| --- | --- | --- | --- | --- |
| today (story only) | 8 | 0 | 23% | 80% |
| **with the scenic tier added** | 8 | **0** | 23% | 80% |
| scenic ONLY (no stories) | 7 | **7** | 6% | 94% |

**Adding 30 eligible scenic candidates changes the drive by nothing.** The isolation run is the
diagnosis: scenics ARE reachable, DO survive the 1 km co-located dedupe, and DO clear the pacing
floor — they lose purely to **competition**. `buildDrive` step 3 picks ONE winner per `minGapSec`
window and `better()` ranks on `audioDurationMs`, so a 60–90 s story beats a 20 s glance every time.
A tier generated today would be invisible in the only mode that exists.

⚠ **This is the same shape as the fused-telling refusal** (§4.3): audio paid for, released, and
unreachable because a selection rule never learned about it. It was caught this time only because the
question was asked BEFORE the spend, not after.

**The fix is a PLACEMENT rule, not a content or generation change.** A glance must not contend for a
3-minute stop slot against a full telling under one comparator. The shape that works:

1. select STORIES first, exactly as today (unchanged — a scenic must never displace a telling);
2. compute the quiet windows that result (`SimReport.quietWindows`, `@skipper/engine`);
3. drop scenics into windows over some floor, consuming **no stop slot** and ignoring `driveMaxStops`.

⚠ **That is the downtime-callout scheduler's problem, restated** — "play something in the gap without
competing for a stop" — so the two threads converge here and should share one mechanism rather than
grow two. See [downtime-callouts-spec](downtime-callouts-spec.md) §0.6, whose gap measurement is
already the tool for both.

⚠ **Sequence, so nobody pays out of order:** placement rule → re-run this simulation and see scenics
actually selected → THEN the machinery no smoke has touched (TTS, loudnorm, R2, the fail-closed eval
gate against an empty fact well, and the `narrations` write path for a form that has never had a row)
→ THEN the ~$29–31 generation run. **The content is ready; the drive cannot play it yet.**

</details>

**Cost discipline, for the next run's estimate:** 16 script-only clips cost **$0.19** total ($0.06 +
$0.05 + $0.08), heavily prompt-cached. That is scripts only — TTS, loudnorm, R2 and the eval gate are
all still ahead of any real run.

### 11.6 💸 Spend gate — and note the trap

Any real test **SPENDS**: `--scripts-only` narrates and prints (`apply: apply || scriptsOnly`), so
only the no-flag dry run is free. An **operator paid run needs an explicit founder "go" per run** and
is never inferred from a design pass. Precedent worth copying: the two wave smoke runs cost **$0.66
total at 3 and 6 clips, and each found a real defect** — a small paid smoke before any full run is
the established, cheap move here.

---

*Source: 9-agent design workflow + two adversarial lenses (charm/pacing vs engineering/grounding),
2026-06-08; V2 re-anchor 2026-06-19; §11 scope 2026-08-03. Memory: `scenic-stops-plan.md`.*
