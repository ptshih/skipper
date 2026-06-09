# Tour structure spec — directionality, intro/outro, naming, catalog, discovery

**Status:** design, agreed in a working session (2026-06-08). NOT yet built. The build is on
hold pending (a) this design settling and (b) the concurrent uncommitted work on `schema.ts` /
generator / shared DTOs reaching a known state. **LOCKED** = agreed; **OPEN** = pending.

Sits on top of the voice/narration work already shipped this session: Algenib ·
`gemini-3.1-flash-tts-preview` · 32k MP3 · the **warmer** delivery prompt (see
docs/audio-compression-spike.md).

## 0. Governing principles

- **Frozen rails, not "curated" rails.** The load-bearing word is **frozen** — a route is
  generated ONCE, never derived per request. AI-selecting a route then freezing it satisfies the
  invariant; human→AI generation is compatible. (Reframe the CLAUDE.md wording when this lands.)
- **The persona stays curated; everything else generates. (LOCKED.)** "The persona is the
  product" → the skipper identity per region (name, backstory, kit, voice) is hand-crafted; AI
  generates the route, stops, facts, narration, intro/outro, naming, directionality, and
  variations. A new-region AI drive borrows an existing curated skipper or waits for one.
- **Assemble per request; generate content once per place.**

## 1. Entity model + directionality (LOCKED)

- **The DRIVE (= a tour) is the primary, self-contained unit.** It carries its own route geometry,
  ordered stops, intro/outro, name, and **direction**. A drive is "forward" in its own frame.
- **A "tour" is a one-way RUN.** Bidirectional routes become **two discrete drives**, each
  **independently generated** (run the generator twice over the same frozen route, once per
  direction) — NOT a mechanically-reversed mirror. This matches the incumbents (Shaka authors
  Classic vs Reverse as distinct experiences; GuideAlong records different return commentary), is
  simpler for AI generation, and **allows slight per-direction variation** (different emphasis,
  timing tips, even a stop that's only worth it one way). Budget the variation as **"slight"** —
  emphasis/timing/framing, not wholesale different drives.
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

## 3. Intro + outro = a bracket pair (LOCKED)

- **Modeled as `start` and `finish` stop-types** bracketing the real stops (anchor + audio + ride
  the existing stop machinery; ready-gate requires their audio). *Cost: two new `stopType` enum
  values — on the schema surface the parallel work touches.*
- **Both are synthesized audio clips.** The preview's silent "DRIVE COMPLETE" card becomes the
  outro's visual; the audio is the final segment.
- **The brackets are the home for the two things banned from stops:** kit → **intro**, sentimental
  bow/sign-off → **outro**. Stops stay lean (grounded facts, 1–2 best groaners, no kit, no bow).
- **Intro** = welcome + orient (region/family framing, by **destination + direction**) + the one
  big **kit** joke. Doubles as "**meet your skipper**" when region-skippers land.
- **Outro** = arrive (name the end-anchor) + warm **sign-off** (the bow) + a **notch-scaled closing
  groaner** + optional **intro callback** + a reserved **tip-jar slot** (deferred, after payoff).
- **Trigger semantics differ from stops:** `start`/intro fires **on tour-start** (never geofenced —
  unmissable for mid-route joiners; anchor coord is for naming/orientation/progress/pin only, and
  the intro is written **position-agnostic** — never "you are now at Tahoe City"). `finish`/outro
  fires on **end-anchor OR tour-end**. Stops geofence-trigger and **queue behind the intro**.
- **Notch-scaled** (#8): `off` = sincere, no big joke; `dadpocalypse` = full kit opener / closing
  groaner. The bracket prompts are notch-parameterized like the stop prompt.
- **Where-to-start guidance + practical onboarding** (download offline, mount phone, "we trigger
  automatically") live in the **pre-drive UI**, NOT the voice — same drive-detail screen as §5.

## 4. Quality-gated narration + persona-scoped kit (LOCKED)

- **dadpocalypse → quality-gated:** land your **1–2 best** groaners scaled to material, **dumb over
  clever**, **story-first** (woven through a narrative, flowing sentences, no choppy fragments),
  **no pun-chains**, **kit banned from stops**, **no bow / no mini-recap**, grounding ironclad
  ("fact survives the joke being deleted"). Two leak-fixes: **oblique kit** ("before my first cup")
  and **mini-recap** closes.
- **The kit is a per-PERSONA opener pool** (it's banned from stops, so its only job is the intro).
  The `poi_content` key already carries `persona`. **Now-action (even with one skipper):** attach
  kit + backstory overlay + opener material + **voice** to a **persona config object**, and make
  the kit-overuse lint/generate **guards read kit terms FROM that config** (not hardcoded) — so a
  region-skipper is a drop-in, not a regex rewrite.
- **Opener variety:** distinct opener per drive via the existing `recentKitBeats` avoidance,
  **lifted from per-tour to per-catalog** (within a persona). At scale the opener **blends the
  persona's kit with the drive's own identity**, so variety scales with the drive count, not the
  finite kit. Region-skippers multiply the pool.

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

- **#6 — drive-core traversal-awareness → DISSOLVED.** Discrete drives are each self-contained +
  forward (own polyline in travel direction), so drive-core stays direction-naive; no `traversal`
  param, no reverse-the-polyline.
- **#7 — shared-POI content key → DEFERRED to the M4 cache work, answer pre-decided.** Narration
  differs by direction, so **direction is a content dimension**; when cache/dedup is earned (M4),
  it joins the `poi_content` key family as a **generic forward/reverse marker** (NOT corridor-
  specific "N→S"), giving a POI up to one clip per direction, reused within a direction across
  duration/notch. **v1 (M1, generate-and-use, no reuse) → non-issue:** each directional drive
  generates its own clips fresh.
- **#8 — intro/outro notch-awareness + onboarding placement → RESOLVED.** Onboarding lives in the
  pre-drive UI (§3); the intro/outro generation is notch-parameterized (§3).

## Build phases (checkpoint the risky ones)

1. Narration prompt (`skipper.ts`): quality-gated + kit→intro + no-recap + intro/outro modes.
2. Schema: `headline` + end-anchors on the drive/family; `start`/`finish` stop-types.
3. Generator: `narrateIntro`/`narrateOutro` + **per-direction independent generation** + the
   regenerate tool. Persona config object + persona-aware kit guards (§4).
4. Shared DTO + API: serve the bracket clips + the directional name + the family/related set.
5. Mobile: bracket segments in the preview; one card per direction; the variations link; pre-drive
   UI. (drive-core needs NO traversal change — §8.)
6. Live regen of the canonical preview (needs explicit OK).
7. Later: nearby/proximity recommender (with the location-filter near-me, v2); dedup guardrail at
   generation scale.
