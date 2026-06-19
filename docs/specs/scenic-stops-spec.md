# Scenic stops spec — deliberately adding scenic stops

**Status:** design, agreed in a PM session (2026-06-08). NOT built — KEEP + REWRITE for V2
(re-anchored 2026-06-19). The CONCEPT survives the V1→V2 pivot, but its implementation plan was
written against storage that no longer exists; read the V2 banner below before building.

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
> - The V1 `'curated'` `poiSourceEnum` value does NOT exist (live enum: `wikipedia`/`google_places`/
>   `wikidata`) and the factless scenic-anchor approach was built then REVERTED. Don't re-add it
>   without first deciding it's still needed given Wikidata discovery (§3).
> - `tour_brackets` (intro/outro) → the placeless `asides` table. `poi_content` is GONE (no content
>   cache; narration is place-owned). `finalizeTourReady` is GONE — readiness derives from non-null
>   `audio_url`. `select.ts` lives at `packages/studio/src/pipeline/select.ts`; `generate.ts` →
>   `packages/studio/src/generate-narrations.ts`; `persist.ts` stays. Re-locate every seam by
>   function name, not line number.
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
  live enum (`wikipedia`/`google_places`/`wikidata`); re-add it only in **lockstep** across
  `packages/db/src/schema.ts` `poiSourceEnum` + `packages/shared/src/enums.ts` `poiSource`.
  **Footgun:** `ALTER TYPE poi_source ADD VALUE 'curated'` can't run inside a transaction on some
  Postgres — verify the generated migration applies on neon-http. (Per CLAUDE.md the wire contract is
  no longer break-freely once shipped, but the `pois`/`poiSource` enum is studio-side STORAGE —
  still destructive-OK.)
- `sourceId = "${region-or-drive-slug}:${anchorId}"` (e.g. `'lake-tahoe:overlook-1'`). Honors the
  `(source, source_id)` dedup invariant — regeneration upserts the SAME row. **`anchorId` is
  immutable** (like a migration key); renaming it orphans the old row.
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
- **Intro/outro need no scenic anchor.** They are placeless `asides` (no poi) — fully decoupled from
  scenic anchoring. There is no shared synthetic-anchor scheme to "settle jointly."
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

---

*Source: 9-agent design workflow + two adversarial lenses (charm/pacing vs engineering/grounding),
2026-06-08; V2 re-anchor 2026-06-19. Memory: `scenic-stops-plan.md`.*
