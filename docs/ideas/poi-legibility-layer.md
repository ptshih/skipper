# The POI legibility layer — turning a Wikidata dump into drivable stops

> **Status:** design pass — **2026-07-29**. Founder-framed as *"a primary piece of logic unique to
> Skipper's intelligence… a moat that prevents anyone with access to an LLM and Wikidata from
> replicating us"*, and as the thing that makes **region N+1 cheap and accurate**. Grew out of the
> `TODO.md` ask "merging co-located POIs" (Camp Richardson / Emerald Bay) plus the follow-on ask to
>
> **PHASES 1–3 ARE BUILT AND APPLIED (2026-07-29).** Road class + the linear-feature prune shipped; the
> silence bug §2 hinted at turned out to be a threshold inconsistency and is FIXED in `buildDrive`; the
> treatment classifier is live and has grouped Tahoe (§4c). Phase 4 — fused GENERATION, the first
> irreversible, audio-spending step — is **NOT greenlit**. Everything written so far is inert metadata
> that `--clear` undoes.
>
> Every number below is `[measured]` against the live Tahoe corpus and the 3 saved drives on 2026-07-29.
> Read §4c before phase 4: 25 groups scored under 0.85 confidence and the model wants to DROP 68 members,
> neither of which has been reviewed.

## 1. The thesis

Wikidata + an LLM gets anyone a list of 460 "points of interest" for Lake Tahoe. That part is a
commodity and will stay one. What it does **not** get you is a sequence of things worth hearing from
a moving car — and the gap between those two is almost the whole product.

Raw, today's Tahoe corpus contains 60 National-Register buildings inside one square mile of downtown
Reno, five Stateline casinos each holding its own 90-second clip, and 34 Desolation Wilderness peaks
with no drivable road within two kilometres. A drive across that corpus plays **8 stops where its own
pacing budget allowed 12**. The corpus is not the product; the *transformation* is.

Call that transformation the **legibility layer**: everything between "an entity exists in Wikidata"
and "a driver hears one coherent thing at the right moment." It's where selection, clustering,
road-relevance, and narration scope live. It is also, per the founder's framing, the defensible part —
and the reason it must be **region-agnostic**: a layer that needs Tahoe-specific tuning isn't a moat,
it's a one-off. If it works, adding Yosemite is a corpus sweep. If it doesn't, every region is
hand-curation forever.

## 2. What the corpus actually looks like `[measured]`

460 narrated POIs, 426 road-snapped, 3 saved drives replayed through the real `buildDrive`.

**Stops die in bulk, and the drive under-fills anyway:**

| drive | on-route | after pick-one | pacing ceiling | **selected** | unused slots |
| --- | --- | --- | --- | --- | --- |
| Tahoe City → South Lake (48 min) | 32 | 19 *(13 collapsed)* | 12 | **8** | 4 |
| South Lake → Incline (40 min) | 30 | 15 *(15 collapsed)* | 10 | **8** | 2 |
| Emerald Bay → Vikingsholm (5 min) | 7 | 3 *(4 collapsed)* | 3 | **2** | 1 |

That last column is the finding. `maxStops` is **not** the binding constraint — the drive leaves
slots empty. Content is destroyed by the 1 km pick-one collapse, and then the survivors clump so the
180 s min-gap walk skips more. Merging isn't only "stop losing places"; it's *"fill the drive"*.

**Road proximity is already good on-route, and bad in the tail:** every on-route POI on all three
drives is road-snapped (32/32, 30/30, 7/7), median off-route 29 m / 109 m / 5 m. Corpus-wide the
pin→road distance is p50 **19 m**, p75 40 m, p90 **221 m**, p99 **1831 m**, max 2242 m, with 34 POIs
having no drivable road in bound at all (Mount Tallac, Susie Lake, Desolation peaks). So the *snapping*
works. The gap is **which** road — see §6.

**Most of the corpus has no `kind`:** 392 of 460 are `kind = null` — *by design*: `featureKind()` is an
allowlist of evocative NATURAL features (bay, peak, cove…), so a casino or a church correctly gets
none. ⚠ **Correction, 2026-07-29:** an earlier revision of this doc claimed that leaves `radiusForKind`
defaulting for 85% of pins. **That was wrong.** `triggerRadiusForKind` returns the flat
`ANCHORED_TRIGGER_RADIUS_M` for any road-snapped POI, and 426 of 460 are snapped — so `kind` never
reaches the radius for them. It only governs the 34 un-anchored backcountry places, 20 of which *do*
carry a kind. Real exposure: **14 POIs**, not 392.

What DOES survive is the other half: the variety tiebreak in `drive-select.ts` `better()`
(`a.cand.kind !== prevKind`) compares `null` to `null` for 85% of pairs, so **the variety rule is
effectively dead outside natural features**. The fix is not a `kind` backfill (the vocabulary is
deliberately natural-only) — it needs a separate coarse category for the built world, which is a
design question, not a chore.

## 3. Why the naive fix fails — two proofs

**(a) Proximity clustering chains.** Single-linkage union-find at a 400 m radius produces a "cluster"
with a **1623 m diameter and 60 members** (A–B–C–D each 400 m apart become one blob). At 1000 m it's
4296 m and 84 members. Any transitive-closure approach is disqualified. A **leader/anchor** pass —
pick the strongest candidate, absorb only what's within R *of that anchor*, repeat — bounds the
diameter to 2R (measured: 410 m at R=250, 711 m at R=400) and is what today's pick-one loop already
does. The change is to **record** the collapsed members rather than discard them.

**(b) Proximity alone is semantically wrong.** With leader clustering at R=400, cap 5, the corpus
yields 78 merge-clusters. Some are obviously one place:

- `Vikingsholm + Eagle Falls trailhead + Eagle Lake` → Emerald Bay
- `Cave Rock Tunnel + Cave Rock`
- `Harrah's + Golden Nugget + Stateline Country Club + Caesars + Harvey's bombing` → the Stateline strip
- `Blyth Arena + ice hockey 1960 + Nordic combined 1960 + 1962 NCAA + 1960 Winter Olympics` → the Olympics site

Others share nothing but a postcode:

- `Harold's Club + Benson Dillon Billinghurst House + First United Methodist + Harrah's Reno + Renaissance Reno`

Both groups are equally "co-located." **Capping doesn't fix the second kind — it fragments it**:
a cap of 5 turns Reno's 84 into ~17 arbitrary quintets. Merging those into one telling produces
incoherence, not concision.

## 4. The real design: three treatments, not one

The mistake is asking "merge or not." There are **three** outcomes, and choosing between them is the
layer:

1. **SOLO** — one entity, one telling. Today's default; correct for Cave Rock, Mount Tallac, Fallen Leaf.
2. **CLUSTER** — 2–5 entities that a driver experiences as **one place**, fused into one telling that
   names each. Emerald Bay, the Stateline strip, the Olympic Valley venues, Camp Richardson.
3. **DISTRICT** — 10–80 entities that are a **place you drive through**, not a stop. The output is one
   telling *about the district* naming 2–3 highlights; the remaining 70 entities become **evidence for
   that telling, not stops of their own**. Downtown Reno, Carson City, Virginia City.

Treatment 3 is the move that converts 84 unusable Reno POIs into one good two-minute clip, and it is
the one no competitor gets from a Wikidata dump. **The district entity usually already exists in the
corpus** — `Virginia City Historic District`, `West Side Historic District (Carson City)`,
`Newlands Historic District`, `University of Nevada Reno Historic District` are all Wikidata entities
we already hold, several already narrated. The members should collapse *into* the district POI rather
than into an arbitrary anchor.

**Splitting in-basin from outside sizes the work honestly:** of the 78 merge-clusters, **25 are within
25 km of the lake** (absorbing 52 POIs) and **53 are Reno/Carson/Virginia City** (absorbing 117). So
CLUSTER is a ~25-item problem for Tahoe drives; DISTRICT is what handles the other 53. Doing only
CLUSTER would leave the majority of the mess untouched.

**How to decide the treatment — model judgment, not a heuristic.** CLAUDE.md's posture is explicit
("Correctness over cost… let the model/tooling do the judgment even when a cheap heuristic would save
a few dollars"), and §3(b) proves a distance threshold cannot separate Emerald Bay from five unrelated
Reno buildings. The classifier is one Opus call per candidate group at **corpus-build time** (not per
drive), grounded in the members' names, kinds, fact sheets, and Wikidata relations
(`part of` / `located in` — Vikingsholm *is* part of Emerald Bay State Park; the 1960 events *are*
part of the 1960 Winter Olympics). ~78 calls per region ≈ a few dollars, once. That is the cheapest
part of this whole design and the highest-leverage.

### 4a. Dry-run result — 2026-07-29 `[measured]`

Ran the classifier read-only over the whole corpus (leader grouping at R=600, **no cap**, so districts
could form as one group; one Opus call per multi-member group; nothing written). 460 POIs → 248 groups,
**64 with 2+ members** → **32 CLUSTER, 17 DISTRICT, 15 SOLO**. Total cost **$0.82** (96k in / 13.5k out).

**The judgment is good.** CLUSTER caught every case this doc predicted — Emerald Bay
(`Vikingsholm + Eagle Falls trailhead + Eagle Lake`), Cave Rock (`the tunnel bores through the rock
itself`), Camp Richardson, the Stateline strip, both 1960 Olympic venues, the railroad museum's five
exhibits — plus ones nobody had spotted: three licensed brothels within **40 m** of each other, and
Boca (dam + reservoir + the town it drowned). DISTRICT correctly absorbed downtown Reno (33), Carson
City (20), Virginia City (16), UNR, Truckee, Minden, Gardnerville, Sparks, Tahoe City — and picked the
**existing district QID as the anchor** where one exists (Newlands, Virginia City, West Side), exactly
as §4 hoped.

**SOLO was the surprise.** It refuses to fuse *and* it curates: "a water park and an outlet mall share
a freeway exit but are unrelated"; "keep the chapel, drop the CDP — an administrative boundary isn't a
place"; "keep the house, drop the state route"; "a never-built casino is barely worth a stop." That is
**junk-POI detection we did not ask for** — administrative abstractions, highway stubs, and phantom
projects are exactly the noise a Wikidata sweep drags in. Worth harvesting as its own output.

### 4b. Determinism tuning — 2026-07-29 `[measured]`

Four prompt variants, each run **3× over all 64 groups**, scoring per-group label agreement.
Total tuning spend ≈ $15.

| variant | agreement | split C/D/S | verdict |
| --- | --- | --- | --- |
| v1 — original, loose definitions | 92% (59/64) | 34/10/20 | baseline |
| v2 — ordered tests, "count is not the test" | **97%** (62/64) | 12/24/28 | best rate, but over-districts small settlements — **Camp Richardson regressed to DISTRICT** |
| v3 — binary `coherent`, treatment derived in code | **89%** (57/64) | — | **WORSE** — see below |
| v4 — ordered tests + naming capacity | 95% (61/64) | 34/7/23 | healthiest split; Camp Richardson recovered |
| **v4 + corpus hygiene** | 95% (54/57) | 36/7/14 | **recommended** — 31 junk entities gone, SOLO noise 23→14 |

**Four findings that outlast the prompt text:**

1. ⚠ **`temperature` is DEPRECATED on Opus 4.8** — the API 400s on it ("`temperature` is deprecated
   for this model"). The obvious determinism lever does not exist here; prompt structure and voting
   are what remain. Do not write code that passes it.
2. **Some of the non-determinism was OURS.** The dry run's grouping query had no `ORDER BY` and the
   leader sort had no tiebreak for equal clip lengths, so the *groups themselves* could differ
   between runs. Deterministic ordering is free stability and must be in the real implementation.
3. **The three-way taxonomy is LOAD-BEARING — do not collapse it.** v3 replaced CLUSTER/DISTRICT
   with a binary `coherent` flag and derived the treatment from member count in code. Agreement got
   *worse*, and specifically on the LARGE groups that had been rock-solid: downtown Reno's 33
   buildings came back `SOLO` on one pass. DISTRICT is the natural home for "these share only an
   area", and a binary has nowhere to put that.
4. **Residual instability is a CORPUS problem, not a model problem.** Every remaining flip is a
   2-member group, and before hygiene they were groups containing non-places — `California State
   Route 89`, census-designated places. Dropping 31 route-number entities cut SOLO groups from 23 to
   14 and removed Camp Richardson from the unstable set entirely. **Corpus hygiene is a prerequisite
   for classifier stability, not a separate cleanup.**

**So the residual ambiguity is confined to n=2 pairs** (e.g. `Lakeside Inn + Friday's Station` — a
modern casino and a Pony Express stage station), all scoring ≤0.85 confidence, where merging or not
barely changes a drive. Everything n≥4 was stable across every variant. Practical rule: **classify
once and persist** (§5 already requires this), and route 2-member groups under ~0.85 confidence to a
3-vote majority or admin review — a small minority of groups, so the cost stays trivial.

**Two problems, both fixable:**

1. **Borderline calls aren't stable.** The run was executed twice; the `Virginia City & the Comstock
   Lode` group (n=4, confidence 0.8) came back **CLUSTER** once and **DISTRICT** once. Treatment must
   therefore be **decided once and persisted**, never recomputed live — which the §5 entity model
   already implies. For low-confidence groups, either vote (3 calls, majority) or route to admin review.
2. **A district spans more than one spatial group.** `downtown Reno` was returned **twice** (n=33 and
   n=10), UNR twice, Carson City three times — the leader pass anchors more than once inside a big
   district. So DISTRICT needs a **merge-by-title/anchor pass after classification**, or a second,
   coarser grouping radius used only for district detection.

⚠ **Clustering must be corpus-level and precomputed, never per-route.** Audio is synthesized ahead of
time and a merged telling is one clip; if cluster membership depended on the route, you'd need audio
per route, which is the thing V2 exists not to do.

### 4c. Phase 3 BUILT + applied — 2026-07-29 `[measured]`

`classify-treatments.ts` (+ pure `pipeline/clustering.ts`, 9 unit tests) is live and has been run over
Tahoe. 430 narrated POIs → 232 groups, 55 with 2+ members, **34 CLUSTER / 4 DISTRICT / 15 SOLO**,
~$0.7. Applied: **38 anchors + 181 satellites**. It writes ONLY the grouping — no audio, nothing a
rider hears — which is what makes it safe to look at before paying for phase 4. Undo is `--apply --clear`.

Three columns rather than the one this doc originally proposed: phase 4 needs to know WHICH places fuse
(`cluster_anchor_id`), HOW (`cluster_treatment` — cluster vs district generate differently), and WHAT TO
CALL the place (`cluster_title`). Title and treatment come from the model, so re-deriving them means
paying again — they are persisted for the same reason the treatment is.

**The district merge (§4b problem 2) is solved, and the first fix was wrong.** Merging by exact folded
title left downtown Reno split in two, because the classifier returned "Downtown Reno and the Arch" (33)
and "Downtown Reno" (10) — not equal. Whole-word CONTAINMENT fuses them into one 43-member district and
takes districts 6 → 4, while still refusing to fuse "Downtown Reno" with "Newlands Historic
Neighborhood". The four districts are now clean: downtown Reno (43), Carson City (28), Newlands (16),
Virginia City (15).

**Still open, and worth knowing before phase 4:**

- **25 of 55 groups score under 0.85 confidence** — reported, not withheld. They are overwhelmingly the
  2–4 member groups, where §4b already showed confidence naturally sits at 0.72–0.85. Treat the number
  as "worth a look", not "45% broken", but do look before generating.
- **CLUSTER groups of 7–9 members exist** (Stateline's casino row = 9, UNR = 8, Minden = 7), which
  reads like a violation of the prompt's own "seven or more → DISTRICT" rule. It isn't: the model applies
  the count to the NAMEABLE members after its `drop` list, and Stateline drops 4 of 9 leaving 5. Defensible,
  but it means phase 4 must generate from `highlights`, NOT from raw membership, or those tellings run long.
- **68 members the model would DROP entirely** are reported but NOT applied — a content decision, kept
  out of a grouping pass on purpose.
- The 600 m radius is still not derived (§8).

### 4d. Facts-strength ranking + the Yosemite test — 2026-07-29 `[measured]`

Founder call, and it was the better signal: **rank candidates by FACTS STRENGTH, not clip length.** Clip
length was a noisy derivative of exactly that (a richer sheet produces a longer clip), so the old rank was
the shadow of the right thing. Measured against it, facts-strength disagrees on **7 of 10** groups and
wins the ones that matter — downtown Reno seeds from the Riverside Hotel instead of an apartment block,
Camp Richardson from the settlement instead of one estate inside it.

**The bigger consequence is pipeline ORDER.** Ranking on facts removes the `narrations` join, so grouping
no longer has to run AFTER generation. That ordering is the only reason phase 4 owes an orphan cleanup:
the Tahoe corpus contains 181 satellite clips that fused generation would discard, and they were PAID
FOR. The pipeline should be **discover → enrich → group → generate**, which never mints them. Tahoe is
the anomaly (grouped retroactively), not the template.

**It also unblocked the region-agnosticism claim, which was previously untestable.** Yosemite has 837
POIs, **0 narrated**, 292 with extracts — so the old narration-gated classifier could not run there at
all, and proving region-agnosticism would have required generating a full corpus first. Circular. Now:

| | Tahoe | Yosemite (never tuned) |
| --- | --- | --- |
| POIs with facts | 433 | 292 |
| groups (2+ members) | 54 | 36 |
| CLUSTER / DISTRICT / SOLO | 30 / 6 / 17 | **31 / 0 / 5** |
| with a real subject | 13 of 36 | **22 of 31** |
| cost | ~$0.70 | **$0.47** |

**Zero DISTRICTs in Yosemite is the right answer, not a bug** — a national park has no downtown, whereas
Tahoe's bbox swallows Reno, Carson City and Virginia City. The split tracks regional character with no
tuning, which is the claim. Subject-resolution is *better* there (22/31) because natural features usually
have a parent entity in Wikidata. Spot-checked groups are strong: `Mariposa Grove + Wawona Tree + Grove
Museum + Washington Tree` (0.95), `Mist Trail + Vernal Fall + Emerald Pool`, `Camp 4 + Midnight Lightning
+ Columbia Boulder`.

⚠ **But facts-strength introduced a NEW failure mode, and it is systematic rather than random.** Very
large CONTAINING entities have enormous articles, so they outrank the specific places inside them and
become group seeds:

- `Half Dome` group seeded by **Yosemite National Park**, absorbing Half Dome
- `Glacier Point and the Firefall` seeded by **Sierra Nevada** — a mountain range absorbing a viewpoint

`pickSubject` still recovers the right SUBJECT in both (the title names it), so the output is not wrong —
but the SEED decides group COMPOSITION, and a park's centroid absorbing whatever is within 600 m of it is
arbitrary. A national park and a mountain range are containers, not stops. **This is the next refinement
and it is unfixed:** candidate seeds probably need a size/containment exclusion. It is also precisely the
class of bug only a second region surfaces, which is the argument for having run the test.

**Not applied.** Yosemite was a dry run, and Tahoe's stored grouping still reflects the OLD clip-length
rank with no evidence columns. Both regions should be re-applied ONCE, after the containing-entity seed
question is decided — re-applying now would bake in a known-suboptimal grouping.

### 4e. Containers can't seed a group — 3f resolved 2026-07-29 `[measured]`

The failure §4d introduced: ranking by facts strength (correctly) promotes big famous entities, and the
biggest are CONTAINERS. `Half Dome`'s group was seeded by **Yosemite National Park**; `Glacier Point`'s by
the **Sierra Nevada**. A seed's coordinate defines the group's centre, and a park's nominal centroid is
arbitrary relative to anything you can see.

**Nothing we already stored could separate a container from a stop.** Measured:

| | `kind` | article chars |
| --- | --- | --- |
| Sierra Nevada *(container)* | `mountain` | 11,621 |
| **Half Dome** *(good stop)* | `mountain` | 10,138 |
| Carson Range *(container)* | `mountain` | 1,281 |

Same kind, overlapping lengths, containers at both ends of the length range. Name patterns fail too —
"Sierra Nevada" gives nothing away. Containment is SEMANTIC.

**The signal is EXTENT, and Wikidata states it: P2046.** A container is somewhere you are INSIDE for an
hour, not somewhere you pass, and that is exactly what area measures. `backfill-poi-extent.ts` (free,
WDQS, same endpoint discovery already uses) populates `pois.area_km2`; a POI at or above
**`CONTAINER_AREA_KM2` = 100** may be a group MEMBER but never a SEED (`Groupable.seedable`).

The threshold comes from the observed distribution, not taste. All 11 barred corpus-wide:

```
183506  Diocese of Reno          502  Lake Tahoe            388  Ferguson Fire
 63118  Sierra Nevada            456  Emigrant Wilderness   259  Desolation Wilderness
  3079  Yosemite National Park   407  Carson City, NV       126  Mount Rose Wilderness
  2851  Yosemite Wilderness      519  Hoover Wilderness
```

…while SETTLEMENTS stay seedable (Truckee 87, Incline Village 56, South Lake Tahoe 43, Wawona 16), because
a town's centroid IS roughly the town and makes a fine district centre. A 500 km² bar would let the
roadless wildernesses back in. `Diocese of Reno` (an administrative jurisdiction) and `Ferguson Fire` (a
wildfire) are bonus catches — neither is a place you stop.

**Verified on Yosemite:** `Half Dome` now seeds its own group with Yosemite NP absorbed as a member;
`Glacier Point` seeds from the Firefall with Sierra Nevada absorbed. Treatment split unchanged (31/0/5).

⚠ **Two honest limits.** (1) Only the big things claim P2046 at all — 53/849 in Tahoe, 11/837 in Yosemite —
which is correct (a rock face claims no area), but `Carson Range` claims none EITHER and is a genuine
container, so this catches the worst offenders, not all of them. Absence of a claim means "unknown", never
"small". (2) A barred container is still a MEMBER and could still be a SOLO stop elsewhere; whether
"Yosemite National Park" should be a stop at all is the same question as the pruned highways, and is not
answered here.

## 5. Entity model — `poi_clusters` (revised 2026-07-29 after an adversarial pass)

A group is **its own row**. `poi_clusters` carries `treatment` ('cluster'|'district'), `title`, and a
nullable `subject_poi_id`; members point at it via `pois.cluster_id`; the telling points at it via
`narrations.cluster_id`, with a `narrations_subject_xor` CHECK making "a narration is about a poi XOR a
cluster" structural.

**This replaced an anchor model, and the reasons are worth keeping.** The first cut hung
`treatment`/`title` off whichever member had the longest existing clip and pointed the narration at that
poi. It was chosen because it let me claim no hard invariant was harmed — and that claim was the weakest
part of the argument:

- **It preserved the LETTER of "narrations is 1:1 with a poi" and broke its MEANING.**
  `narrations.poi_id → 3rd Street Flats` for a clip about downtown Reno is a false statement that every
  downstream reader inherits with full referential integrity.
- **The proxy elected the wrong subject, measured 4 of 4 districts.** A real `…Historic District` QID
  sat in the group and was demoted to a satellite of an arbitrary building. A **fraternity house** ended
  up speaking for a university campus; an apartment block for 43 members of downtown Reno. Clip length
  says nothing about what a place IS. `pickSubject` now prefers a district/neighbourhood entity, then a
  member the group was named after, then **null** — and null is the honest answer for 22 of 38 groups
  (the Stateline casino strip is a real grouping that is not itself a place). Electing a stand-in was
  precisely the old model's mistake.
- **Role-dependent nullable columns with no constraints.** Three columns meaningful only on anchors, and
  nothing in the schema stopping a satellite carrying a treatment, a self-reference, or an `A→B→C` chain.
  The invariant lived in one script. A table makes all three impossible.
- **I rejected the table on a weak argument** ("an entity to keep in sync for no gain"). Membership is a
  FK either way, so there is no extra sync — it is one more table, and the gain is that the subject is
  nameable instead of impersonated.

What survives unchanged: QID dedup (every member keeps its row), and `narrations.attribution` as an
array, so one fused clip credits every Wikipedia-sourced member — CC BY-SA satisfied by construction.

⚠ **`narrations.poi_id` is now NULLABLE.** Every read path inner-joins `pois`, so a cluster telling is
simply invisible to roam and to drives until generation is taught about it — silence, never a wrong
place-name. Where a query had no join to borrow a non-null id from, it either filters explicitly or
relies on `poi_id IN (…)` never matching NULL; both are commented at the site.

**Known ceiling, not fixed:** grouping is a PARTITION, so a place has exactly one home. Fannette Island
belongs to Emerald Bay and to "Tahoe's islands"; `Emerald Bay State Park` exists in the corpus but landed
in a different spatial group, which is why "Emerald Bay at Lake Tahoe" has a null subject. Overlapping
membership is expressible in this schema (a join table) but is not built.

**Also unresolved:** treatment is a naming-CAPACITY decision (how many can I name in ~90 s) baked into
persistent data with **no staleness signal** — change the clip length band and every stored treatment is
silently wrong. The project has `facts_hash` for exactly this class of problem in the facts domain; there
is no equivalent here yet.

## 6. Road class — "close enough to a major road" `[measured]`

`snap-speakable-anchors.ts` already snaps to the nearest **drivable** road via OSM/Overpass (free,
keyless) and refuses to write an anchor beyond `speakableAnchorMaxM` (1.5 × `radiusForKind`). The
mechanism is sound. Its gap is that *"nearest drivable road"* includes residential streets and service
roads — which is exactly why downtown NRHP buildings get anchors at all, and why they then trigger
from a side street the drive never uses.

OSM already tags every way with a `highway=` class. The fix is small and rides the existing Overpass
fetch: **record the snapped road's class** (`motorway|trunk|primary|secondary|tertiary|residential|
service`), and prefer the nearest road of class ≥ `tertiary` when one is in bound. That gives:

- a real "is this triggerable from a road people actually drive" signal, region-agnostic and free;
- a **cull** for the district members (they anchor to `residential`, so they stop competing as stops);
- a sanity check that cluster members share an approach road rather than merely a postcode.

This is worth doing **first** — it's cheap, needs no schema beyond one column, requires no
regeneration, and its output is an input to §4's classifier.

## 7. Sequencing + ROI

| phase | work | spend | unblocks |
| --- | --- | --- | --- |
| 1 | Road class in `snap-speakable-anchors` (+ `pois.speakable_road_class`) | $0 (OSM) | better triggering now; feeds every later phase |
| 2 | Fix `kind = null` (85% of corpus) — revives `radiusForKind` + the variety tiebreak | $0 | independent win |
| 3 | Leader grouping + Opus treatment classifier → `cluster_anchor_id` | ~$5/region | the actual decision |
| 4 | Cluster/district-aware generation (new length band; fused telling) | ~$15/region regen | the payoff |
| 5 | `buildDrive` reads anchors; delete pick-one | $0 | fills the empty slots |

Phases 1 and 2 are worth doing **whatever happens to 3–5**. Phase 4 orphans ~169 satellite clips in
R2 — `sweep-orphans.ts` already exists for exactly that.

## 8. Open questions

- **Length band for a fused telling.** Concatenation is not an option: Emerald Bay's three run 214 s
  and the Stateline five run 489 s, against a 180 s `DRIVE_MIN_GAP_SEC` and a 45 s `DRIVE_MAX_LAG_SEC`.
  A fused clip must be *written* to a band (~120–180 s?), naming each member without reciting each.
- **Cluster radius.** 400 m is a guess that produces sane diameters; it is not derived. Phase 1's road
  data may give a better rule ("same road, same side, within X").
- **Does a district need a different trigger radius?** You're inside it for minutes, not seconds.
- **Does roam want the same treatment?** Probably yes for CLUSTER, unclear for DISTRICT — roam is
  ambient and a district telling may be too much when you're parked in it.
- **Region-agnostic proof.** The only honest test is running phases 1–3 against a second region's
  corpus (Yosemite) and checking the treatment split looks sane without tuning.

## Refs

`packages/engine/src/drive-select.ts` (pick-one, §3a; `better()`, §2), `packages/engine/src/roam.ts:86-89`
(the 300 m/15-min suppression this would subsume), `packages/studio/src/snap-speakable-anchors.ts` (§6),
`packages/studio/src/generate-narrations.ts` (where fusion lands), `docs/decisions/geometry-first-regions.md`,
`docs/decisions/region-corpus-discovery.md`, `docs/decisions/corpus-enrichment.md`.
Supersedes the `TODO.md` item "Co-located POIs: collapse a cluster into ONE telling".
