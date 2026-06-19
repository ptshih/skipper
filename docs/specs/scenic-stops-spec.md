# Scenic stops spec — deliberately adding scenic stops

> **Schema-names note (2026-06-13):** the `tour_brackets` table referenced below was renamed `tour_frames` in the 2026-06-12 segments/tracks refactor.

**Status:** design, agreed in a PM session (2026-06-08). NOT built. The original blocker (the
tour-structure / directionality work) has since LANDED (the Phase-2 migration), so this is
UNBLOCKED — but it was partially overtaken by the **gap-fill + cluster-merge pacing rework**
(`d2a2056`, 2026-06-09), which attacks the same silence problem from stop SELECTION instead of new
scenic anchors (and a factless scenic-anchor approach was built then REVERTED; the `'curated'` enum
never shipped). **Re-ground against current `select.ts` / `generate.ts` / persist seams before
building** — line numbers below are 2026-06-08 and WILL have moved. Known drift (2026-06-09):
`GEOLOGY_ICONIC_STOPS`, cited below as the pattern for `SCENIC_ANCHORS`, no longer exists — story
enrichment is now scout-decided (`docs/decisions/enrichment-scout.md`); the curated-anchor TABLE
pattern itself is still fine.

Sits on top of: the **geology channel** (committed — `pipeline/macrostrat.ts`, scenic stops are
auto-enriched at their trigger point) and the **Wikidata channel** (committed — `pipeline/wikidata.ts`,
a sibling enrichment for sparse story stops). See the geology memory for that history.

---

## 1. What & why

**Goal:** deliberately create SCENIC stops, instead of getting them by accident.

**Today scenic stops are an accident.** In `select.ts`, a chosen Wikipedia POI is classified
`story` vs `scenic` purely by extract length (`isStory = extract.length >= STORY_MIN_FACT_CHARS`,
140 chars). A scenic stop is just "a Wikipedia POI too thin to narrate truthfully." On a curated
route like `emerald-bay-run` every selected POI clears 140 chars, so it has **ZERO scenic stops**.

**Why we want them:**
1. **Pacing / breathing room** — a wall of dense ~2-min story stops is exhausting; the persona
   prompt itself says "let real moments breathe." Scenic stops are the rest beats.
2. **Geology's headline win** — the just-built scenic-geology rescue (a factless pretty stretch +
   the real rock under you) **currently never fires** because there are no scenic stops.
3. **Fill long story-gaps** — stretches with no Wikipedia POI for miles get something to FEEL
   instead of dead air.

**What a scenic stop is (the contract):** delivery-only ambient audio, `facts: []`. The persona
names NO peak / town / island / landmark (naming one is a fact it wasn't given). Region + corridor/
drive framing IS allowed ("the West Shore", "the climb out of the basin"). **Geology is the one
grounded exception** — a scenic stop may state the bedrock + rough age (from Macrostrat) and nothing
more. It still needs a `poi_content` row + non-null audio (ready-gate). `TARGET_SECONDS.scenic = 20`.

---

## 2. The plan (both adversarial lenses agreed)

**One-line:** *curate/freeze the WHERE, generate the WHAT with a tracked scenic-mode rotation, and
let the existing geology channel light up underneath.*

| Mechanism | Where the scenic stop comes from | Data | Verdict |
|---|---|---|---|
| **Curated/frozen scenic anchors** | per-drive hand-picked coord + non-naming label (mirror `GEOLOGY_ICONIC_STOPS`) | none (config + geometry) | **Ship first** |
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

## 3. The POI-anchor decision (`tour_stops.poiId` is NOT NULL)

Every stop — scenic included — must reference a `pois` row. A "pretty stretch" has no Wikipedia
article, so a deliberate scenic stop needs a **synthetic POI anchor**.

**Decision: a new `poiSourceEnum` value `'curated'`** (NOT OSM, NOT a route-point hack):
- Add in **lockstep**: `packages/db/src/schema.ts` `poiSourceEnum` + `packages/shared/src/enums.ts`
  `poiSource` (the schema comment mandates lockstep; `PoiSource` flows into `select.ts`'s
  `StopPlan.source` + `persist.ts`). Migration: `bun run db:generate && db:migrate`.
  **Footgun:** `ALTER TYPE poi_source ADD VALUE 'curated'` can't run inside a transaction on some
  Postgres — verify the generated migration applies on neon-http.
- `sourceId = "${drive-or-family-slug}:${anchorId}"` (e.g. `'emerald-bay-run:overlook-1'`). Honors
  the `(source, source_id)` dedup invariant — regeneration upserts the SAME row. **`anchorId` is
  immutable** (like a migration key); renaming it orphans the old row.
- `pois.name` = a **generic, non-landmark label** ("a pull-out high over the bay") — stored (NOT
  NULL) but **never spoken** (`baseReq` omits `place` for scenic). **Pin this with a unit test** so
  a future refactor can't leak the label into narration.
- **`attributionSource` needs NO `'curated'` entry** — a curated stop owns no copyrightable text; a
  curated scenic clip credits only Macrostrat (when geology hits) or carries `attribution: null`.
- **M4 bonus:** a `'curated'` POI is only ever scenic → it sidesteps the documented story↔scenic
  cache-flip hazard entirely. No action needed (M1 is generate-and-use, no reuse).

---

## 4. ⚠️ Entanglement with directionality (READ `docs/specs/tour-structure-spec.md` FIRST)

The directionality work changes the world this lands in. Do not build scenic stops until it settles,
and align with it:

- **Vocabulary reframe:** `corridor` → **drive-family**; `tour` → a one-way **drive** (self-contained
  directional geometry + ordered stops + intro/outro + name). "Curated rails" reframes to **frozen
  rails** (AI-generate-then-freeze is compatible). The scenic-anchor concept should be framed as
  **frozen** scenic anchors; a human picking them is one valid way to freeze them.
- ~~**NEW `start`/`finish` stop-types (intro/outro brackets) … also need a synthetic POI anchor … DO
  NOT build two parallel synthetic-anchor schemes …**~~ **SUPERSEDED 2026-06-08 (Option-B brackets,
  tour-structure-spec §3):** intro/outro are NOT stop-types and need NO anchor — they live in a separate
  **placeless** `tour_brackets` table. The bracket gap is therefore **DECOUPLED** from scenic anchoring,
  not lumped: scenic stops still need their `'curated'` POI source (a real place with thin/no Wikipedia);
  brackets need no POI at all. There is no longer a shared scheme to "settle jointly."
- **Scenic framing is DIRECTION-DEPENDENT.** "The climb out of the basin" is a climb one way and a
  descent the other; a reveal happens in one direction only. Per the spec, a stop can be "only worth
  it one way." So **scenic anchors likely live per-DRIVE (per direction), not per shared route**, or
  carry direction applicability. The CLIMB/REGION-FRAME scenic mode (§5) is the one most affected.
- **`select.ts` / `generate.ts` will be reworked** for per-direction independent generation. The
  scenic insertion seams (`selectNarrated`, `selectStops`, the `pending[]` merge + along-route sort)
  will move — re-locate them by function name, not line number.
- **drive-core stays direction-naive** (spec §8) → the scenic plan's "player/sim = zero changes"
  still holds. `TriggerEngine` is `stopType`-agnostic; a curated scenic stop with normal trigger
  geometry fires identically. Only VERIFY short-clip (~20s) overlap in the simulator.
- **Headline derivation** uses the marquee POI — make sure `'curated'` scenic POIs (generic names)
  are excluded from headline/teaser derivation so they can't become a card title.

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

**Enforcement — reuse the existing tracking, don't invent a new system.** `generate.ts` already
maintains `recentOpeners` / `recentClosers` / `recentMotifs` threaded into every narrated request.
- Add a parallel `recentScenicModes` + a cursor that **avoids the immediately-preceding mode**.
- Thread `scenicMode` into `baseReq` **only** for `stopType === 'scenic'` (beside the geology/
  wikidata blocks already there).
- `narrate.ts`: add `scenicMode?` to `NarrationRequest`; in the scenic branch emit a per-mode
  directive + a "recent scenic modes (vary from these)" line, mirroring the recent-openers scaffold.
- `lint.ts`: add a scenic-mode-repeat check feeding the **existing** 4-round regen hook.
- `skipper.ts` (highest-leverage file): expand the SCENIC section with the palette + the iron rule —
  modes vary, none assert a place-fact, geology is the one exception, keep the existing bans (no
  peak/town/island name; **no "deep-time vs our brief lives" geology closer**; vary openers/closers).

**Note:** even one curated corridor will place scenic stops close enough in register to feel same-y;
the mode rotation also keeps a run of geology-only scenics from going monotone.

---

## 6. Code changes (re-locate seams against current code)

In dependency order:
1. **`schema.ts` + `shared/enums.ts`** — `'curated'` into `poiSourceEnum`/`poiSource` (lockstep) +
   migration (txn footgun above). (Coordinate with the `start`/`finish` enum work.)
2. **`config.ts`** — `interface ScenicAnchor { id; label; lat; lng }` (+ optional `direction`?);
   `SCENIC_ANCHORS: Record<slug, ScenicAnchor[]>` mirroring `GEOLOGY_ICONIC_STOPS`; `SCENIC_MODES`
   rotation list; `SCENIC_GENERIC_NAME` fallback. (Later: `SCENIC_GAP_SEC` per bucket ≈ `2×minGapSec`
   + `SCENIC_MAX_STOPS` for gap-fill.)
3. **`select.ts`** (where scenic is born) — add `scenicAnchors?` to `SelectParams` (pre-resolved by
   `generate.ts`, like `breakAnchors`); a `selectCuratedScenic(params, snapOf)` helper that snaps
   each anchor via the existing `snapOf` closure (→ `triggerLat/Lng/approachHeadingDeg/alongSec`),
   drops off-route (`> OFF_ROUTE_MAX_M`), emits `Pending` with `stopType:'scenic'`, `source:'curated'`,
   `facts:[]`, `targetSeconds:TARGET_SECONDS.scenic`; push into `pending[]` **before** the
   along-route `pending.sort`; add a **min-gap drop pass** (drop a curated scenic within `minGapSec`
   of a narrated stop) so scenic is breathing room, never clustered / on top of a story.
4. **`generate.ts`** — pass `scenicAnchors: SCENIC_ANCHORS[slug] ?? []` into `selectStops`. Geology
   enrichment + ready-gate + TTS already handle `stopType:'scenic'` and arbitrary `source` generically
   — **keep the geology scenic-rescue working** (it already enrolls every scenic stop at the trigger
   point). Only add: thread `scenicMode` into the scenic `baseReq` (§5).
5. **`narrate.ts` + `skipper.ts`** — the scenic-mode palette + directives (§5). No contract change.
6. **Player / sim / drive-core** — ZERO changes; only verify short-clip overlap in the simulator.

---

## 7. First experiment (smallest end-to-end proof)

1. Add `'curated'` to the enum (lockstep) + migrate.
2. Add **ONE** `SCENIC_ANCHORS` entry for the canonical route — **founder eyeballs the overlook coord
   on a map**, landed ON the road so the snap is faithful.
3. Add `selectCuratedScenic` + the min-gap drop; thread `scenicAnchors` through `generate.ts`.
4. (Optionally defer the full mode palette for the very first smoke test — a single scenic stop can't
   be monotone against itself — but at least wire the `scenicMode` plumbing.)

**Success:** the generator log shows `1 scenic` in the breakdown (the deliberate birth path the
accidental one never hits) and `(1 scenic …)` in the geology line; the scenic clip **names no peak/
town/island**, asserts **only** the granite + rough age, sets a mood, ~20s; its `poi_content` row has
non-null `audioUrl` + `audioDurationMs` with `attribution` carrying the Macrostrat CC BY entry; tour
reaches `ready`. **Dry-run** via `run.ts --json` (dump the scenic script + fact sheet, eyeball
grounding — no leaked landmark name) + load into the simulator (triggers at the snapped point, ~20s
clip doesn't overlap a neighbor). `bun run check` green after the enum change.

---

## 8. Open founder decisions
- **Enum name:** `'curated'` vs `'route'` / `'scenic'` (and whether to share it with directionality's
  `start`/`finish` anchors — see §4).
- **Build the full mode palette now, or ship one geology-mode anchor first** as a smoke test, then
  layer modes.
- **Per-drive vs per-family scenic anchors** once directionality lands (direction-dependent framing).

## 9. Invariants to honor
Persona lives in DELIVERY not FACTS; scenic names no landmark (geology the one exception); frozen
rails (don't let "curated WHERE" leak into curated WHAT — the words stay generated); every stop has a
trigger point + audio (ready-gate); keep the geology + Wikidata enrichment channels working unchanged.

---

*Source: 9-agent design workflow + two adversarial lenses (charm/pacing vs engineering/grounding),
2026-06-08. Memory: `scenic-stops-plan.md`.*
