# Tour structure spec — intro/outro brackets + quality-gated narration

> **Schema-names note (2026-06-13):** the `tour_brackets` table referenced below was renamed `tour_frames` in the 2026-06-12 segments/tracks refactor — read `tour_brackets`→`tour_frames` throughout.

**Status:** design, 2026-06-08; **largely SUPERSEDED by V2 (2026-06-19)** — the durable survivors are
**§0 (frozen-rails doctrine)** and **§4 (quality-gated narration + persona kit)**, both still load-bearing
and absorbed into CLAUDE.md + the live persona. The quality-gated prompt + intro/outro narration modes
shipped (67e9313/7860b3f). Everything structural in §1/§2/§3/§5/§6/§7 is HISTORY — see the V2 banner.

> 🟥 **SUPERSEDED — STRUCTURE FULLY DISSOLVED IN V2 (updated 2026-06-19).** The canonical entity model is
> **`docs/decisions/tour-data-model-zero-reuse.md`** §9 + the live [`packages/db/src/schema.ts`](../../packages/db/src/schema.ts) —
> read those, not this, for the model. The dissolutions, latest first:
> 1. **(V2 2026-06-18, then DELETED 2026-06-19) `tour_brackets`/`tour_frames` are GONE — and so is their
>    successor.** They first collapsed into shared, region-owned `asides` (the `asides` table), but that
>    table was then **deleted entirely** (migration `0019`, geometry-first regions) — placeless intro/outro
>    framing is removed from v2 and returns in v3 with guided tours. Between-story texture is now the PLACED
>    `break` (Places-anchored) + `scenic` forms, which have real coords (see
>    `docs/decisions/geometry-first-regions.md`). So **§3's entire `tour_brackets`-as-a-per-tour-table
>    design — the Concrete-Table-Inheritance vs STI reasoning, the `finalizeTourReady` co-commit seam, the
>    placeless-subtype modeling — is MOOT**: brackets were never a per-tour table in the shipped model, no
>    placeless-bracket table survives at all, and `tours`/`tour_stops`/`corridors` are all dropped. Keep §3
>    only as a record of the design thinking.
> 2. **(V2 2026-06-18) `tours` → user-owned `drives`; narration → the shared 1:1 `narrations` atom.** A
>    drive REUSES region narrations pre-ordered along an A→B route; hand-authored tours are DEFERRED.
> 3. **(2026-06-08) Every tour INDEPENDENT** — no `direction`/reverse/forward, no "drive family." → §1, §2,
>    §5's directional/"2-ways" framing, §6 (wrong-direction), §7's both-directions heuristic, §8 #6/#7 moot.
> 4. **(2026-06-08) `corridors` MERGED, then dropped** — no corridor/tour split.
> 5. **No variant matrix** — duration/notch/interests are NOT separate tours. → §5's "{drive + duration +
>    notch}" cards moot.
> 6. **§4a persona model SUPERSEDED.** `region` did NOT become a `pgEnum` (regions are a minimal **TABLE**,
>    schema.ts) and persona is NOT a 1:1 region registry resolved by a `Record<Region>` — the one host is
>    resolved in CODE via **`personaFromKey('skipper')`** ([`packages/studio/src/persona/`](../../packages/studio/src/persona/)),
>    baked into the audio; per-region hosts are the deferred region-skippers (M4). The §4a R2-path/region-pgEnum
>    migration notes are moot.
>
> **Still LIVE (the durable survivors):** **§0 (governing principles — frozen rails)** and **§4 (quality-gated
> narration + persona kit)**. Treat §1/§2/§3/§5/§6/§7 + §4a as history.

Sits on top of the voice/narration work already shipped this session: Algenib ·
`gemini-3.1-flash-tts-preview` · 32k MP3 · the **warmer** delivery prompt (see
docs/decisions/audio-compression-spike.md).

## 0. Governing principles

- **Frozen rails, not "curated" rails.** The load-bearing word is **frozen** — a route is
  generated ONCE, never derived per request. AI-selecting a route then freezing it satisfies the
  invariant; human→AI generation is compatible. (Reframe the CLAUDE.md wording when this lands.)
- **The persona stays curated; everything else generates. (LOCKED.)** "The persona is the
  product" → the skipper identity per region (name, backstory, kit, voice) is hand-crafted; AI
  generates the route, stops, facts, narration, intro/outro, naming, directionality, and
  variations. A new-region AI drive borrows an existing curated skipper or waits for one.
- **Assemble per request; fetch FACTS once per place, generate NARRATION per tour.** `pois`
  caches facts (deduped, TTL-refreshed); narration is **tour-owned, never reused** across tours
  (zero-reuse — see docs/decisions/tour-data-model-zero-reuse.md). [Updated 2026-06-08; supersedes the
  earlier "generate content once per place."]

## 1. Entity model + directionality (LOCKED)

- **The DRIVE (= a tour) is the primary, self-contained unit.** It carries its own route geometry,
  ordered stops, intro/outro, name, and **direction**. A drive is "forward" in its own frame.
- **A "tour" is a one-way RUN.** Bidirectional routes become **two discrete drives**, each
  **independently generated** (run the studio pipeline twice over the same frozen route, once per
  direction) — NOT a mechanically-reversed mirror. This matches the incumbents (Shaka authors
  Classic vs Reverse as distinct experiences; GuideAlong records different return commentary) and
  is simpler for AI generation. **Under zero-reuse (docs/decisions/tour-data-model-zero-reuse.md) each
  direction's narration is fully tour-owned** — the two drives share only the deduped `pois` facts,
  never a clip — so independent per-direction telling is the default, free, and collision-proof
  (this is why design-review B1 dissolves). The two still SHOULD read as two ways of one drive, so
  budget the *editorial* variation as **"slight"** (emphasis/timing/framing, a stop that's only
  worth it one way) — a charm guideline now, not a technical limit on divergence.
- **The CORRIDOR reframes to a "DRIVE FAMILY"** — a lightweight grouping carrying `region` +
  `headline` and owning the set of **related drives** (the directional pair; later, loop/short
  variants). It is no longer shared geometry — each drive is self-contained.
- **"Is a point-to-point worth both directions?"** is the one non-mechanical call (loop vs
  point-to-point is geometry). Needs a **heuristic + default** + human override at AI scale
  (through-road w/ lodging both ends → both; dead-end out-and-back → one). Governs the 2× cost.
- **Named-landmark + advance-notice phrasing, NOT hard "on your left/right"** — the incumbents
  avoid baked left/right (GPS heading flips; documented Shaka complaint). The prompt's existing
  "say 'coming up' when side unknown" fallback becomes the default; side-of-road, if surfaced, is
  a player visual or a rare reliable-heading garnish.

## 2. Rail data + naming (LOCKED)

- **Each drive carries:** its own route geometry (polyline in its travel direction), ordered stops,
  and two **end-anchors** `{name, coord}` (start + end). The **family** carries `region` +
  **`headline`** ("Emerald Bay").
- **AI-derivable:** headline = the marquee POI (Wikipedia prominence; fallback = road/segment
  name); anchor coords = polyline endpoints; anchor names = reverse-geocoded recognizable towns
  via the **curated-Places-anchor pattern** (non-volatile, validated — they're charm-load-bearing).
- **Naming = `[Headline], [Start] to [End]`** ("Emerald Bay, Tahoe City to South Lake Tahoe");
  loops → `[Headline] Loop`. **Each direction is its own card titled by this directional name**
  (headline + direction); the **headline is the family/relation label** ("Emerald Bay — 2 ways").
  The full composed name is the card identity (this REVERTS the earlier headline-browses/
  endpoints-toggle idea, since #5a flipped to one-card-per-direction).
- The end-anchor dataset now does **five jobs**: card name, intro/outro anchoring, intro
  orientation, GPS-start pin, **and the proximity recommender (§5).**

## 3. Intro + outro = a drive-FRAME bracket pair (LOCKED — model REVISED to Option B, 2026-06-08)

Intro/outro are the drive's **frame**, NOT stops. The earlier "model them as `start`/`finish`
`stopType` values riding the existing stop machinery" is **RETIRED** — it would force
`tour_stops.poiId` nullable and make the pure geofence trigger engine special-case placeless rows.
A cited DB-modeling review (Fowler STI vs Concrete-Table-Inheritance; Karwin; the Postgres CHECK
three-valued-logic trap; GitLab "don't start new tables as STI") favors **separate homogeneous
tables** for placeless, fixed-count, integrity-load-bearing subtypes like this. (Upgrade path noted
at the end; full reasoning in docs/decisions/tour-data-model-zero-reuse.md and the design-review.)

- **`tour_brackets` — the drive's frame (its own table).** Exactly one `intro` + one `outro` row per
  drive: `(id, tourId→tours, kind ∈ {intro,outro}, script, audioUrl, audioDurationMs, reviewed)` —
  **NO `poiId`, NO trigger coords, by construction** (they're about the DRIVE, not a place; attribution
  is empty — brackets carry no facts). `tour_stops` stays STRICT: every row a real geofenced POI stop
  (NOT-NULL `poiId` FK + trigger point). **NO new `stopType` enum values.**
- **Both are synthesized audio clips** (tour-owned, like every stop's narration under zero-reuse).
  The preview's silent "DRIVE COMPLETE" card becomes the outro's visual; the audio is the final segment.
- **DTO = a drive `{ intro, outro, stops[] }`** — frame + contents, self-documenting. **Ready-gate:**
  every `tour_stops` row has audio AND both brackets have audio. ⚠ **Build seam to pin:** the atomic
  ready-gate (`finalizeTourReady`'s `db.batch`) is `tour_stops`-only today — the two `tour_brackets`
  inserts must co-commit in that SAME batch as the `status='ready'` flip, or the all-or-nothing invariant
  has no bracket enforcement point.
- **The brackets are the home for the two things banned from stops:** kit → **intro**, sentimental
  bow/sign-off → **outro**. Stops stay lean (grounded facts, 1–2 best groaners, no kit, no bow).
- **Intro** = welcome + orient (region/family framing, by **destination + direction**) + the one big
  **kit** joke. Doubles as "**meet your skipper**" when region-skippers land. Written
  **position-agnostic** — names the start-anchor descriptively, never "you are now at Tahoe City".
- **Outro** = arrive (name the end-anchor) + warm **sign-off** (the bow) + a **notch-scaled closing
  groaner** + optional **intro callback** + a reserved **tip-jar slot** (deferred, after payoff).
- **Triggers are drive-LIFECYCLE, owned by the player — NOT the geofence engine** (which stays pure,
  consuming only `tour_stops`):
  - **intro** fires **on tour-start** (immediately, position-agnostic — unmissable for mid-route
    joiners *precisely because it isn't geofenced at all*). Geofenced stops that fire while it plays
    **queue behind it** (existing queue behavior).
  - **outro** fires on a **compound** condition the player owns: reaching the drive's **end-anchor**
    (a drive property, §2) **OR** tour-end (stops exhausted). The geofence engine can't express the
    "…or otherwise ended" fallback — another reason brackets live outside it. ⚠ **Build seam to pin:**
    the tour-end arm needs a player dispatch that doesn't exist today — `finishDrive` (useDrive.ts)
    currently plays nothing; wire the outro into it when brackets land.
  - The drive's start/end anchors live on the drive/family (§2), so neither bracket needs its own coord.
- **Notch-scaled** (#8): `off` = sincere, no big joke; `dadpocalypse` = full kit opener / closing
  groaner. The bracket prompts are notch-parameterized like the stop prompt.
- **Where-to-start guidance + practical onboarding** (download offline, mount phone, "we trigger
  automatically") live in the **pre-drive UI**, NOT the voice — same drive-detail screen as §5.
- **Upgrade path (deferred, honest).** If mid-drive NON-geofenced playables ("ask the guide" inserts,
  asides, ads) ever become a PRIMARY requirement and all playables assemble as one ordered timeline,
  the documented move is **Class Table Inheritance** — a shared `playable_item` parent (seq + script +
  audio) + a child `stop` (NOT-NULL `poiId` + coords) — buying one ordered timeline AND enforceable
  integrity. Those playables are Deferred today (CLAUDE.md), so the `tour_brackets` Concrete-Table model
  is right-sized now and graduates via a rename if/when they land.

## 4. Quality-gated narration + persona-scoped kit (LOCKED)

- **dadpocalypse → quality-gated:** land your **1–2 best** groaners scaled to material, **dumb over
  clever**, **story-first** (woven through a narrative, flowing sentences, no choppy fragments),
  **no pun-chains**, **kit banned from stops**, **no bow / no mini-recap**, grounding ironclad
  ("fact survives the joke being deleted"). Two leak-fixes: **oblique kit** ("before my first cup")
  and **mini-recap** closes.
- **The kit is the host's opener pool** (banned from stops, so its only job is the intro). It lives
  in the per-region host **registry** (§4a) alongside the voice + prompt-overlay, and the
  kit-overuse lint/generate **guards read kit terms FROM that registry** (not hardcoded) — so a new
  region host is a drop-in, not a regex rewrite. The PRESENTATION half already shipped
  (`host.ts`, the "meet your skipper" data); this registry is the GENERATION half.
- **Opener variety:** distinct opener per drive via the existing `recentKitBeats` avoidance,
  **lifted from per-tour to per-catalog** (within a persona). At scale the opener **blends the
  persona's kit with the drive's own identity**, so variety scales with the drive count, not the
  finite kit. Region-skippers multiply the pool.

### 4a. Persona / host model (LOCKED)

- **Curated + code-defined** (not data/user/AI-driven) — the add-a-host friction is the curation
  gate; "the persona is the product."
- **Keyed by REGION, 1:1.** The standalone `persona` axis is **DROPPED**; the curated dimension is
  **`region`**, and each region has exactly ONE host (its headline attribute). Matches
  "region-specific skipper identities" + the region-keyed DRIVES picker, and collapses two curated
  axes into one. *(Forecloses multi-host-per-region, host-across-regions, and non-geographic
  personas — all unplanned; the notch covers tone. Reintroduce a persona axis only if a
  non-regional host is ever wanted.)*
- **One registry, keyed by region:** `Record<Region, { host: HostIdentity, voice, prompt-overlay,
  kit, opener }>`; **`Region` type = registry keys**; every `Record<Region>` guard derives from it;
  adding a region = ONE entry. host.ts's presentation `Record<Persona>` becomes `Record<Region>`;
  replaces the scattered enum + `PERSONA_VOICE` + hardcoded kit regexes.
- **`region` becomes a `pgEnum`** cache-key dimension (was free text) — a DB migration per new
  region, for integrity (the dedup key can't fragment on a typo). Since a POI sits in one region,
  region is derivable-from-POI → a **denormalized-but-explicit** key dim (kept explicit for clarity
  + a future user-selectable voice).
- **First region = `lake-tahoe`** (display "Lake Tahoe"), hosted **— for now — by "Skipper".** The
  host *name* is a display attribute, **decoupled from the region key**, so renaming later is a
  one-line registry edit with **NO migration**. His kit (cousin Ray, the "Tuesday" mechanic, the
  cranky truck, coffee opinions) lives in his entry.
- ⚠ **Migration:** the cache-key dimension changes `persona`→`region` (value `skipper`→`lake-tahoe`,
  pgEnum, **R2 path** `clips/skipper/…`→`clips/lake-tahoe/…`) — **fold into the canonical-preview
  regen** the build already requires; never a standalone edit (it would orphan live clips). The host
  display name ("Skipper") is unchanged.

## 5. Catalog + discovery (LOCKED)

- **Browse: Region → Drives.** Region = the DRIVES picker (and where "meet your skipper" lands).
- **ONE CARD PER DIRECTION** (this is the #5a *reversal*: two discrete drives → two cards, NOT one
  card + a toggle). Each card is titled by its directional name; the **family clusters them**
  ("Emerald Bay — 2 ways") so a pair reads as a set, not two stray look-alikes.
  - This is Shaka's separate-cards model, **minus** its weakness: Shaka needs a "which one?"
    comparison page; our **related-drives link** is that answer, built in. The NN/G duplication
    risk is defused by three things together: distinct **directional names**, **slight content
    variation** (different teaser/emphasis), and the explicit **related link**.
- **"Related drives" = two signals on the shared anchor data:**
  1. **Variations — "other ways to drive *this*."** Same-family siblings (directions + loop/short
     variants). **Explicit** (the family grouping), surfaced on the drive detail. **Immediate.**
  2. **Nearby — "you might also like."** Cross-family, **computed** by anchor-proximity to a
     **base** (GPS, or an explicit "where are you staying?" — e.g. a family in South Lake Tahoe sees
     Emerald Bay *and* East Shore). This IS the existing discovery doctrine — **"string filters,
     coordinate sorts," anchor coord → distance sort, Airbnb comp.** **Enabled now** by the anchors;
     **surfaced when the location-filter's near-me lands (v2).**
- **Duration = a per-drive chooser; corniness (notch) = a setting** (global default `dadpocalypse`,
  optional per-drive override; in the settings screen). Neither is catalog cards. The played
  variant is **assembled per request** from {drive + duration + notch}.
- **The drive-detail screen converges:** the play CTA + where-to-start & onboarding (§3) +
  duration/corniness settings + the variations link.

## 6. Wrong-direction handling — DEFERRED (LOCKED)

Assume the right pick for now — it's entirely a **live-GPS-drive** concern, and the live drive
isn't built (the preview has none). The **directional name is the guard**. Defer position-suggest
+ mid-drive switch to the **real-GPS-player phase**. **No data lock-in** (anchors + the family's
sibling list already support it). Note for that phase: make triggering **proximity-based** so a
wrong pick degrades to "confusing," not "silent."

## 7. AI-generated drives — fit + scale guardrails (LOCKED)

The model fits — almost everything is **derived from {route geometry + end-anchors + persona +
facts}**. Frozen rails (§0); persona human (§0); everything else generates.

- **Variations cost only what we budgeted:** generate-per-direction (the discrete decision) +
  trivial family grouping. The one judgment is "**both directions?**" (§1).
- **Nearby costs ZERO to generate:** the proximity recommender is **computed at query time from the
  anchor coordinates**, never authored. Each generated drive auto-joins the proximity graph. It's
  **synergistic with scale** — more drives → better discovery, free — and leans on the **robust
  coords**, not the fuzzy name-derivation.
- **Heuristics / human flags needed at scale:**
  - **"Both directions?"** (§1) — governs the 2× generation.
  - **Headline / anchor quality** — derivable but validate + fallback (charm-load-bearing).
  - **NEW — dedup / overlap scale guardrail:** at volume, don't generate a drive that's ~the same
    road as an existing one, or the nearby rail shows near-identical twins. The discovery layer
    *surfaces* this, doesn't cause it; cheap to add from the same anchor/route data.
- **New infra:** AI route generation adds a routing/maps dependency (Directions API / OSM).

## 8. OPEN gaps — now mostly closed

- **#6 — engine traversal-awareness → DISSOLVED.** Discrete drives are each self-contained +
  forward (own polyline in travel direction), so engine stays direction-naive; no `traversal`
  param, no reverse-the-polyline.
- **#7 — shared-POI content key → DISSOLVED by zero-reuse (2026-06-08).** The earlier answer (add
  a forward/reverse marker to the `poi_content` key at M4) is moot: **there is no content cache and
  no content key.** Narration is tour-owned (`tour_stops`), so each direction narrates the shared
  POI independently by construction — no shared clip to key, no collision, nothing to defer to M4.
  (This resolves design-review blocker B1; the shared `pois` row still supplies the facts both
  directions ground on. See docs/decisions/tour-data-model-zero-reuse.md.)
- **#8 — intro/outro notch-awareness + onboarding placement → RESOLVED.** Onboarding lives in the
  pre-drive UI (§3); the intro/outro generation is notch-parameterized (§3).

## Build phases (checkpoint the risky ones)

1. Narration prompt (`skipper.ts`): quality-gated + kit→intro + no-recap + intro/outro modes.
2. Schema: the full **`docs/decisions/tour-data-model-zero-reuse.md`** migration — merge `corridors` into `tours`
   (route + `headline` + end-anchors + `region_id`), the `regions` table, the **`tour_brackets`** intro/outro
   table (NOT stop-types; §3), the **zero-reuse reshape** (drop `poi_content`, narration onto `tour_stops`,
   `pois.facts_hash`/`facts_fetched_at`), and drop `durationBucket`/`interests[]`/`persona`. Clean + destructive (no users).
3. Studio: `narrateIntro`/`narrateOutro` + **one independent tour per route** + the regenerate tool.
   Persona config object + persona-aware kit guards (§4).
4. Shared DTO + API: serve the bracket clips; the tour DTO = a drive `{ intro, outro, stops[] }` carrying
   route/anchors/region. (Nearby/proximity recommender deferred to v2.)
5. Mobile: bracket segments in the preview; **one card per tour**; pre-drive UI. (engine needs NO
   traversal change — there is no direction concept.)
6. Live regen of the canonical preview (needs explicit OK).
7. Later: nearby/proximity recommender (with the location-filter near-me, v2); dedup guardrail at
   generation scale.

## Reconciliation with landed main (re-grounded 2026-06-08)

A large parallel batch landed while this was being designed. State vs. this spec:

- **Data model → ZERO-REUSE (decided 2026-06-08; supersedes the §0/§1 wording above and the old
  `poi_content` cache).** Facts are shared on `pois` (deduped, TTL + `facts_hash`); narration is
  tour-owned on `tour_stops` (no content cache, no cross-tour reuse — "tour 1's Camp Richardson ≠
  tour 2's"). Dissolves §8 #7 and design-review B1, and shrinks the persona→region migration. Full
  design + migration: docs/decisions/tour-data-model-zero-reuse.md.
- **§4 persona — presentation half BUILT.** `apps/api/src/host.ts` (`Record<Persona, HostIdentity>`,
  served via the API, host-agnostic player, type-guarded). Generation half (a unified persona
  registry: prompt-overlay + kit + opener + voice, with guards reading from it) is still TODO and
  mirrors that pattern. The `persona` enum is still `['skipper']` (one persona); the multi-persona
  infra (HostIdentity + the completeness guard) is ready.
- **Attribution is now an ARRAY** (`AttributionSnapshot[]`) — multi-source enrichment landed
  (Wikidata CC0 + Macrostrat CC BY; a `/sources` catalog page; `/sign` returns `contentType`). New
  content (intro/outro + any new stop type) must carry the array shape.
- **GPS Phase 2 player exists** (simulated fix source, commit `e7496a6`) — so "wrong-direction
  deferred to the GPS phase" (§6) has a partial scaffold; real device GPS is still Phase 4.
- **Still TODO:** the `docs/decisions/tour-data-model-zero-reuse.md` migration (merge `corridors`→`tours` with
  `headline`/end-anchors/`region_id`; the `regions` table; `tour_brackets`; the zero-reuse reshape; drop
  the variant columns), the generation persona registry, and the canonical-preview regen. (The
  quality-gated prompt + intro/outro modes are DONE — committed 67e9313/7860b3f. Voice/codec — 3.1-flash
  + 32k MP3 + Algenib — is in and intact.)
