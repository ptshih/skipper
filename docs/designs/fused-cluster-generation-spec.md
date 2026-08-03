# Fused cluster generation — phase 4 of the legibility layer

> **Status:** ✅ **BUILT, GENERATED AND RELEASED for Tahoe/Reno — 2026-07-30, re-counted 2026-08-02.**
> Steps 1–3 (staleness hash + member-set resolver, trigger position, read paths) spend nothing and are
> green; **step 4 — the step that SPENDS — has already spent**; step 5's founder listen passed ("clips
> sound fine"); step 6's member retirement is built. Counted read-only against the live DB 2026-08-02:
> **37 fused tellings, ALL 37 RELEASED, 75.0 min** (32 cluster + 5 district), over 219 released member
> clips whose places the fused tellings now speak for. §8b's two corpus defects are both RESOLVED.
>
> ⚠ **THIS LEAD IS THE ARBITER OF STATE; the body below is a build journal written as it happened.**
> Where a section still reads "not run", "no audio exists yet", "31 clips, all STAGED", "needs a founder
> go", or "READY TO RELEASE", it is a dated record of the moment it was written, not a live read. That
> distinction is worth money: every one of those phrasings invites paying a second time for audio that
> already exists. What is genuinely **NOT DONE** is exactly one thing — **§9 step 4c, Yosemite's 30
> clusters**, which have zero enriched members and so need a paid `enrich-pois --region yosemite`
> BEFORE a paid generation run. Both are founder-gated spends.
>
> ⚠ **Amended 2026-08-02: ROAM IS GONE (1.1 D1), so every `/roam` measurement below is a dated RECORD,
> and §10's AREA trigger is CUT** — `packages/engine/src/area.ts`, `roamPin.area`, the
> `X-Skipper-Client` capability channel and the mobile polygon all went with the mode. The FUSED
> TELLING itself survives untouched (a `narrations` row about a `poi_clusters` subject, served to
> drives), and so does everything in §§1–8.
>
> ⚠ **Amended 2026-08-03: the GENERATION gate REFUSES a too-wide group again** — `clusterGenerationBlock`
> (`packages/studio/src/pipeline/cluster.ts`) blocks a group whose enclosing radius exceeds
> `CLUSTER_MAX_TRIGGER_RADIUS_M`, matching what the SERVING side already does (`buildDrive` refuses a
> `tooWideForPoint` group outright; `apps/api/src/clusters.ts`). This **re-supersedes** §4.1b's
> "geometry NO LONGER BLOCKS" paragraph, and the reason is the amendment above it: that paragraph turned
> the geometry check into a *mode selector* because a wide group could ship as an AREA telling — and the
> area mode no longer exists, so a wide group has no mode left to ship as. Generating one now would pay
> for a clip that serving refuses to play. §4.1b's arithmetic for **why 600 m** still governs.
>
> ⚠ **Grouping counts: the body wins over this lead's older figure.** The post-merge grouping is
> **67 groups (62 CLUSTER / 5 DISTRICT)** over 295 members — see §8b and §4.2's table. This line used to
> read "64 clusters (60/4)" and list four districts including Stateline's Casino Row; both are PRE-merge
> (§8b's merge fired three times, moved Stateline DISTRICT → CLUSTER and `Reno's Historic Homes`
> CLUSTER → DISTRICT). ⚠ §7.5 is CLEARED — Carson City fused from two districts into one.
>
> Member RETIREMENT is a read-path behaviour (a member is suppressed at drive-build once its cluster has
> a released telling), not a `released_at` flip — which is why those 219 member rows are still released,
> and that is correct rather than a leftover. Promoted from `docs/designs/poi-legibility-layer.md` on
> founder intent ("let's prepare to do phase 4"); read that doc's §4–§5 first — it records why the shape
> is what it is, including two designs that were tried and replaced.

## 1. What phase 4 is

Today every member of a cluster still has its own clip, and the grouping is inert. Phase 4 produces
**one fused telling per cluster** and makes the read paths serve it.

The stop count doesn't just shrink — it converts. Emerald Bay stops being "three clips of which a drive
plays one" and becomes "one clip that names all three."

## 2. The two halves, and the one that gets forgotten

**(a) Generation** — write a `narrations` row with `cluster_id` set and `poi_id` NULL.

**(b) Read paths** — ⚠ **without this, phase 4 generates audio nobody ever hears.** Every read path
inner-joined `pois` (`/roam`, `loadCorpusForRoute`, `loadCorpusByPoiIds`), which was the deliberate
safe default when `poi_id` became nullable: a cluster telling is invisible rather than mis-attributed.

✅ **BUILT 2026-07-30 (§9 step 3), ahead of (a) rather than beside it.** The lift turned out to be
*additive* rather than a join change: `apps/api/src/clusters.ts` loads fused tellings on their own
query and synthesizes the geometry `poi_clusters` doesn't store, and the corpus is the concatenation
of the two subject kinds. Because every one of those queries is scoped to
`narrations.cluster_id IS NOT NULL` and there are zero such rows, the whole change is a runtime no-op
until generation runs — which is what makes shipping it FIRST safe, and better than shipping it
beside the audio. Verified against the running dev API: `/roam` returns the same 46 pins, and all 18
stops across the 3 existing drives still resolve.

## 3. Generation

### 3.1 Input — generate from `highlights`, never raw membership

⚠ The single most important constraint. CLUSTER groups of 7–9 members exist (Stateline's casino row is
9), which looks like a violation of the "seven or more → district" rule and is not: the model counts
the members it would NAME, after its `drop` list. Stateline drops 4 of 9, leaving 5.

So the telling is written over `poi_clusters.highlights`, with `dropped` members contributing **facts but
never a mention**. Generating from raw membership produces a nine-name recital.

⚠ **`highlights` are model-authored NAME STRINGS, not poi ids, and they do not reliably match
`pois.name`** — measured over the 30 generatable clusters: 74 of 88 highlights match a member's name
exactly, 14 are the model's paraphrase ("the Riverside" for `Riverside Hotel`). `dropped` matches
19/19. So a highlight CANNOT be resolved to a member by string equality — do not build the well by
looking each one up. The working shape is the other way round: ground on the tellable members
(§3.2), and pass `highlights` to the prompt as the naming instruction it already is.

### 3.2 Grounding — the mechanism already exists

`buildGroundingWell` (in `eval/grounding.ts`, not `narrate.ts`) already accepts
`mergedFeatures: { name, facts }[]` and emits `"<name>: <fact>"` lines. A fused clip's well is the
members' fact sheets mapped into that shape — **no change to the gate**, which is the happiest finding
in this design. The fail-closed grounding gate then applies unmodified.

⚠ Ground on ALL TELLABLE members' sheets (including `dropped` ones — their facts are real, only their
names are uninteresting), but permit only `highlights` to be NAMED. That asymmetry is new and the prompt
must say it explicitly, or the model will name whatever it grounds on.

✅ **CONFIRMED THE HARD WAY, 2026-07-30 — and it is worse than "the model MIGHT".** One fused telling
was generated for `Stateline: Tahoe's Casino Row` (9 members, 5 highlights, 4 dropped), grounded on
every tellable member through `mergedFeatures`. Result:

- it NAMED 2 of the 4 **dropped** members (`Stateline Country Club`, `Van Sickle Bi-State Park`);
- it named at most 2 of the 5 **highlights** — `Harvey's` (via the bombing) and arguably Bally's under
  its old `Sahara Tahoe` name. `Harrah's Lake Tahoe`, `Caesars Republic` and `Golden Nugget` — three of
  the five places the group is NAMED for — do not appear at all.

The model picked by FACT RICHNESS, not by the naming evidence: the Country Club's sheet carries a 1930s
menu (frog legs, $2.50, a hardwood dance floor), so it opened there and spent a third of the telling on
a dropped member. `mergedFeatures` said outright *"you MAY name each"*, so nothing was violated — there
was simply no channel for "ground on this, don't say it".

✅ **FIXED + RE-MEASURED 2026-07-30.** `mergedFeatures` entries take a `background` flag, and the fact
sheet splits into "the landmarks a driver would RECOGNISE — name each" and "BACKGROUND ONLY — do not
open on one, do not let one become the subject, prefer not to name them at all". Same cluster, same
$0.42, second take:

| | highlights named | dropped named |
| --- | --- | --- |
| before | 1–2 of 5 | **2 of 4** |
| after | **5 of 5** | **0 of 4** |

⚠ **Keyed off `dropped`, NOT `highlights`.** Both are free-text names the model authored, but they
match `pois.name` at very different rates — measured live, `dropped` matches **68 of 69** and
`highlights` **165 of 186**. Inverting the question ("is this member on the drop list?") puts the fuzzy
matching on the list that is essentially exact, and a matcher miss then fails SAFE: an unmatched member
stays NAMEABLE, which is the old behaviour, rather than silently muting a place the telling is for.
Unmatched drop entries are warned, not swallowed.

⚠ **The trade-off is visible and is the one §3.3 predicted.** Naming all five pushed the take toward
enumeration — the diversity lint (advisory) flagged "reads like a list (2 enumerated sentences)" where
the first take was flagged for wind-up tics instead. NAME DENSITY is the real constraint, and
"work every one of them in" may be a notch too strong. A wording knob to try on the next pass.

⚠ **The grounding gate caught a real one, unmodified.** The second take scored 0.97 with an ungrounded
place-claim ("Frank Sinatra Jr. came home safe" — true, but not in the well), so a real run would
retake and then WITHHOLD. That is the fail-closed gate working on a fused clip with no changes at all,
which is the last unproven assumption in §3.2.

**"Tellable" is a defined set, and it is NOT `pois.cluster_id`.** `isNarratableStoryPoi`
(`@skipper/shared`) is the one predicate: wikipedia-sourced, has facts, has a non-empty `fact_sheet`,
not taste-denied, **and `excluded_reason IS NULL`**. The exclusion clause is stricter than the solo
queue, deliberately: an excluded poi with a solo clip is merely unreachable behind a read-path filter,
but an excluded member that reaches a fused well gets NAMED ALOUD inside the telling for its
neighbours, and no filter can unsay that. Membership is assigned once at grouping time and never
re-checked, so this is where it gets re-applied. Resolver: `pipeline/cluster.ts`
(`loadClusterMembers` → `tellableMembers`) — the well, the attribution union, the trigger position, the
`facts_hash` and the retirement list must all derive from that ONE array, never from a second query.

### 3.3 Length band — researched 2026-07-30

Concatenation is not an option: Emerald Bay's three clips total 214 s and Stateline's five total 489 s,
against a 180 s `DRIVE_MIN_GAP_SEC` and a 45 s `DRIVE_MAX_LAG_SEC`. A fused telling is **written to a
band**, not assembled.

**⚠ Do NOT add a per-TREATMENT band.** An earlier draft proposed one, which would have introduced a
second, competing length axis: `REGISTER_LENGTH` already bands by DELIVERY REGISTER (landscape 60/100,
story 90/180, town 60/90, civic 70/110) with reasoning per register. A fused clip should take **its
subject's register**, with the ceiling — not a new vocabulary.

**What the research actually says.** Three sources agree the ceiling is right and the target is the
question:

- Museum-guide practice: **60–90 s for most stops, up to ~180 s for a "hero object"**; conventional
  audio tours run ~180 s per stop. A fused cluster IS the hero-object case.
- This repo's own competitive work: Autio runs **2–3 min stories across 20,000+ stops** — the band is
  validated at scale, and `competitive-research.md` already recommends staying in it.
- Driving specifically (AAA cognitive-distraction work): **pure LISTENING is the low-workload baseline**,
  explicitly benchmarked against audiobooks. The "longer messages reduce comprehension" finding is about
  INSTRUCTIONAL audio requiring action, not narrative — it does not transfer to a story you just hear.

**So duration is not the risk; NAME DENSITY is.** A 180 s telling naming 3 places is comfortable; a
120 s telling naming 9 is a recital regardless of length. That is the same constraint §3.1 arrives at
from the other direction, which is a good sign.

Proposed rule, replacing the treatment band:

```
band   = lengthForRegister(subject's register, or 'story' when there is no subject)
target = min(band.max, band.target + 20s per highlight beyond the first)
max    = band.max          ← never exceeded; 180s is the researched ceiling
```

⚠ Still pin the *feel* on a listen. The research bounds it; it does not tell you whether four names in
150 s sounds generous or rushed in this persona's voice.

### 3.4 Write

```
narrations: cluster_id = <cluster>, poi_id = NULL, form = 'story'
            attribution = union over ALL members' sources   ← CC BY-SA, non-negotiable
            facts_hash  = hash over the members' sheets       ← see §6
onConflictDoUpdate target: narrations_cluster_uq
```

The `narrations_subject_xor` CHECK enforces poi-XOR-cluster; the unique index gives 1:1 per cluster.

## 4. Read paths

### 4.1 Position + radius — measured 2026-07-30, and a DISTRICT can't be a point

Measured every candidate position against all 64 clusters, scored by worst member distance (lower =
tighter centre):

| candidate | mean worst-member distance |
| --- | --- |
| centroid | **240 m** |
| medoid on a through-road | 342 m |

No rule dominates per-cluster — for `Historic Carson City` the subject (783 m) beats the centroid
(965 m); for the railroad museum the centroid (159 m) beats the subject (271 m). But the aggregate hides
the finding, which is in the large rows:

```
Downtown Reno        46 members   centroid 1141 m   best any candidate  954 m
Historic Carson City 33 members   centroid  965 m   best any candidate  783 m
```

**⚠ A DISTRICT cannot be a point trigger at all.** Its members span ~2 km, so ANY single point leaves a
worst-member distance near a kilometre. Covering that needs a ~1 km radius — which fires most of a mile
before arrival, and directly contradicts the reachability gate shipped in `buildDrive` (a stop is only
selected if the route comes within its trigger radius). A district is somewhere you are INSIDE, which is
the same shape argument that removed parks and ranges from the corpus.

> ⚠ **REVERSED 2026-07-31 (1.1 D42) — this paragraph assumed ROAM.** The worst-member-coverage metric
> only binds when the rider can arrive from ANY direction, which is roam's model. A DRIVE knows the
> frozen polyline: where the route crosses the group, from which side, at what speed. With roam removed
> the metric does not bind, and the capped point plus `CLUSTER_MAX_TRIGGER_RADIUS_M` is the honest
> answer. ⚠ Also measured wrong here: "district" is NOT the set that needs an area — over the live
> corpus the two cross in both directions (2 district+area, 3 district+point, **1 cluster+area — UNR at
> 903 m**, 61 cluster+point). The naming-capacity conclusion and the trigger geometry are independent
> questions that shared one word. The DISTRICT vocabulary survives; the area trigger does not.

**Therefore two mechanisms, not one:**

- **CLUSTER** — a point trigger works. **BUILT 2026-07-30 as `clusterTrigger` in `@skipper/engine`,
  and both halves of the rule proposed here were WRONG on the measurement** (see §4.1b).
- **DISTRICT** — needs an AREA trigger, not a proximity one. ✅ **The engine half is BUILT
  (2026-07-30, founder go: "this will help when we open up new regions").** See §10.

### 4.1b The CLUSTER rule as BUILT — measured over the 30 generatable clusters

Position: the **1-CENTER** (centre of the smallest circle enclosing every tellable member). Mean
worst-member distance across the 30, computed two independent ways and agreeing within a metre:

| candidate | mean | median | max |
| --- | --- | --- | --- |
| **1-center** | **192 m** | **170 m** | **516 m** |
| centroid | 230 m (+20%) | 201 m | 653 m |
| medoid | 325 m (+69%) | 286 m | 935 m |
| subject (its 10 clusters) | 522 m (+171%) | 498 m | 1032 m |

⚠ **NOT the subject.** It never wins: on the 10 clusters that have one it TIES the medoid 6 times —
all n≤3, where the subject simply *is* the medoid, so the ties are arithmetic, not evidence — and
LOSES the other 4. The reason is structural and won't improve with more data: a subject is picked for
NAMING authority (a `…Historic District` or settlement QID), and such an entity's Wikidata point is a
label point, not a centre. Vikingsholm is the worst case in the corpus — the flagship subject, 1032 m
against the 1-center's 516.

Radius: **`max(ANCHORED_TRIGGER_RADIUS_M, enclosingRadius)`**.

⚠ **NOT `worstMember + ANCHORED_TRIGGER_RADIUS_M`.** Adding them puts 24 of 30 above the 322 m the
speed-adaptive lead already grants at 60 mph, so the floor rather than the lead would decide the fire
point for 80% of clusters — reintroducing exactly the early-and-imprecise firing
`ANCHORED_TRIGGER_RADIUS_M` was added to stop. Measured outcome of the `max()` form, re-run after the
2026-07-30 re-classify: **22 of 32 sit at the 250 m floor, and ONE exceeds the 600 m an un-anchored
kindless POI is already given today.**

⚠ **That one is `University of Nevada, Reno Campus` at 903 m, and it is the price of fixing the split**
(§8b). Merging two groups whose anchors were 1268 m apart necessarily produces a circle that covers
both ends of the campus. 903 m is ~34 s of lead at 60 mph — district territory (Downtown Reno measured
1165 m, Carson City 993 m) on a group the classifier calls a CLUSTER, which is §4.1b's own point about
`treatment` being a naming verdict rather than a geometry one, arriving from the other direction.
Everything else is unchanged: next widest is Emerald Bay at 516 m.

**SIMULATED 2026-07-30 — and 903 m does not survive it.** The trigger engine (`runDrive`) was run over
two corpora, today's poi-only and a fused one, on two corridors. Free, offline, no audio:

| | route | stops | audio | notes |
| --- | --- | --- | --- | --- |
| today | Tahoe City → South Lake Tahoe (real, 48 min) | 8 | 10 min | — |
| fused | same | **8** | 11 min | Emerald Bay fused correctly; coverage 24% → 27% |
| today | synthetic Reno corridor (15 min, city pace) | 3 | 5 min | — |
| fused | same | 3 | 6 min | **UNR fires 92 s early vs 25 s for every other stop** |

Three things came out of it:

- **Fusing does not "fill the drive" on a sparse corridor.** The west-shore route places 8 stops either
  way — the binding constraint there is GEOGRAPHY (how many places sit near that road), not the pacing
  budget. Fusing swaps content quality, not stop count. The backlog's "8 stops where the budget allowed
  12" framing holds only where places actually stack.
- **Emerald Bay is the fused case working.** `Vikingsholm` becomes `Emerald Bay and Vikingsholm`, and at
  45 mph its 516 m radius fires at 26 s lead against a 12 s baseline — earlier, but defensible for a bay
  you approach for a while.
- **903 m is not.** On the dense corridor the fused UNR clip fires with a **92-second lead** at city
  speed, against 25 s for every other stop. You would hear "the University of Nevada, Reno campus" a
  minute and a half before reaching it. No audio overlaps in either corpus (an earlier overlap reading
  was a fixture artefact — the pacing and the sim speed disagreed — and disappeared once they matched).

⚠ The Reno corridor is a SYNTHETIC straight line, so its distances are indicative rather than Google's
road geometry. The lead-time result does not depend on that: it is radius ÷ speed.

✅ **BUILT 2026-07-30 (founder go): the geometry gate.** `CLUSTER_MAX_TRIGGER_RADIUS_M = 600` in
`@skipper/engine` + `exceedsPointTrigger`, asked through `clusterGenerationBlock` (studio) so
"generatable" has ONE definition.

⚠ **RE-SUPERSEDED 2026-08-03 — geometry BLOCKS again, and the paragraph below is the middle state.**
The mode-selector reading was only ever valid while an AREA telling existed to select; roam took that
with it (Status line). `clusterGenerationBlock` refuses a too-wide group once more, agreeing with
`buildDrive`. Everything below stands as the rationale for the 600 m figure itself.

⚠ **SUPERSEDED (see §"area tellings" below, commit `66435e9`): geometry NO LONGER BLOCKS.**
`exceedsPointTrigger` now selects the trigger MODE — a wide group ships as an AREA telling served a
polygon — and `clusterGenerationBlock` returns exactly ONE reason, "no tellable members". The
paragraph below is kept for the rationale behind the 600 m figure, which still governs the mode
choice; read it as "why 600", not as "what blocks generation". (UNR, deferred at 903 m below, would
generate today.) 600 is not a taste number — it is the floor `radiusForKind` already
gives an un-anchored kindless place, so a fused telling may never trigger LOOSER than the loosest
thing already shipping. The corpus leaves a wide gap right there: 250 (×22) … 386, 416, 516, then 903.
Live result: **31 generatable, 1 deferred (UNR, 903 m), 30 awaiting enrichment.**

**The invariant that makes an off-road centre safe.** A 1-center can sit away from any road (Emerald
Bay's is ~430 m out, over the water), and `buildDrive` silently drops a candidate whose off-route
distance exceeds its reach. But every member is within `enclosingRadius` of the centre by
construction, so a route passing any member is inside the radius. Verified live: holds for all 107
members of all 30 clusters. Snapping the point to the nearest member anchor would trade that
guarantee away for a worse centre, so it is deliberately not done.

⚠ **`treatment` is a NAMING-CAPACITY verdict, not a geometry one** (it is `highlights.length` against
the clip band). So "a cluster is compact enough for a point" does NOT follow from the column, and the
measurement proves it: four CLUSTERs are more spread out than the smallest DISTRICT (Stateline's
Casino Row, 329 m) — Emerald Bay 516, UNR Campus 416, Newlands 386, Gardnerville 375. The point
trigger is defensible for the bulk (21 of 30 fit inside a plain 250 m circle); Emerald Bay and the UNR
campus are the two that want a listen before anyone calls them settled.

`DriveCandidate` gained an optional `triggerRadiusM` for this: a cluster has no `kind` to look up, and
`candidateTriggerRadiusM` is now the single source both selection and the manifest read, so a stop
can't be admitted under one radius and served under another.

### 4.2 A clustered member is NOT an active POI — SETTLED (founder, 2026-07-30)

**A member stops being a stop in BOTH modes.** It is not a roam pin and not a drive candidate; the fused
clip is the only telling for that place. Members remain rows — they keep their facts, their attribution,
and their membership — they simply stop being independently triggerable.

⚠ An earlier draft of this spec recommended keeping member clips for roam, on the theory that roam has no
slot scarcity. That was wrong, and it contradicted this layer's own design note (`poi-legibility-layer.md`
§5: *"satellites resolve to the anchor's clip … so roam stops telling five casino stories on one block"*).
The triggering problem is PHYSICAL — `Downtown Reno` has **46 members inside ~600 m**, and keeping them
active would leave a stationary rider with 46 competing pins plus a fused one. Strictly worse. Roam's
300 m / 15-minute suppression exists to paper over exactly this, and becomes redundant rather than a
second differently-tuned mechanism.

**Scale — RE-MEASURED against the live corpus 2026-07-30, and it is about HALF what this spec
originally claimed.** The old figures counted every group and every member; the real scope is narrower
on two independent axes.

| | clusters | of those, generatable today | member clips they'd retire |
| --- | --- | --- | --- |
| CLUSTER — phase 4's scope | 62 | **31** | **104** |
| DISTRICT — deferred (§4.1) | 5 | 5 | — |

**Only 30 of the 60 clusters can be generated at all**, because the other 30 are the entire Yosemite
side and have **zero enriched members** (85 of the 295 members carry no `fact_sheet`; all 85 are
Yosemite). A story telling requires a sheet, so those clusters have nothing to ground on until a paid
`enrich-pois --region yosemite` run — a separate founder-gated spend, not part of phase 4.

So phase 4 as scoped is **31 fused clips replacing 104 member clips**: 421 tellings → **348**. Not
"roughly half the corpus" — about a quarter of it. (Counts re-measured after the 2026-07-30
re-classify, which merged the split UNR campus and moved Stateline's casino row from DISTRICT to
CLUSTER — matching what §3.1 always said about it.)

⚠ **Sequence this so good audio is never retired before its replacement is heard.** Generate the fused
clips and listen BEFORE retiring members; a fused Emerald Bay telling that is worse than the individual
Vikingsholm one would be a regression with no fallback. Retirement is reversible while the clips exist in
R2 — run `sweep-orphans` only after the listen, not as part of the same pass.

## 5. Cost and blast radius

**31** fused clips ≈ **$12–16** LLM + TTS. ⚠ Corrected upward 2026-07-30 by MEASURING one: a fused clip
cost **$0.41** (narration + the grounding judge, which retried twice on a malformed response). Halving
the original $10–15 along with the clip count was wrong — per-clip cost went UP, because a fused well is
9 members' sheets and the script runs to the 180 s ceiling rather than the 90 s story aim. Still cheap.
What is NOT cheap is that this is the first irreversible step: fused audio in R2, and 104 member clips
retired.

Sequence: `--apply` per region, preview first, and run `sweep-orphans` after — the corpus is currently at
a clean 421 objects / 421 referenced / 0 orphans, so any drift is attributable to this run.

⚠ **A ~$1 `classify-treatments` run can destroy every one of these clips.** `--apply` re-baselines by
DELETING the region's `poi_clusters` rows, and `narrations.cluster_id` is `ON DELETE CASCADE` — so a
re-classification cascades the fused tellings away and orphans their paid R2 bytes before any staleness
check could fire. Guarded 2026-07-30: the tool now counts fused tellings in scope and REFUSES to
re-baseline without `--force-regroup`, printing what would be lost (both in preview and on apply).
Re-baselining is still the right move when the grouping genuinely changed — it just has to be asked
for. ⚠ The FK is still `CASCADE`; the guard is the only protection, so don't route a new clear path
around it.

## 5b. What the 31-clip run surfaced

**1. ⚠ TAIL COLLAPSE WAS FUSED-SPECIFIC — diagnosed, fixed, and verified. An earlier call in this
spec was wrong.**

After the FIRST fused clip collapsed, I checked the historical rate on solo poi clips — 6 of 335 and
1 of 30, about **2%** — and concluded it was pre-existing, not fused-specific, and not worth re-tuning
an ear-locked delivery prompt over. That was a reasonable read of n=1 and it is **wrong at n=31**:

| | clips | tail-collapsed | rate |
| --- | --- | --- | --- |
| solo poi (historical) | 365 | 7 | **~2%** |
| FUSED | 31 | **11** | **35%** |

Severity is worse too: solo collapses ran 3.3–4.6 dB, fused run **4.2–14.4 dB**. The worst
(`1960 Olympic Ski Stadium Site`, 14.4 dB below body) should be close to inaudible on its last line.
A 17× rate increase on the one clip shape that is new is not a coincidence — the likely cause is
structural rather than stochastic: a fused telling ends on a *summarising* closer after a long
multi-place body ("Four towers, a mountain of stories, and one very deep crater's worth of history"),
which is a falling-intonation fragment, and all three retakes collapse identically because the SCRIPT
is what determines it, not the sampler.

⚠ That points the fix at the NARRATION prompt (the closer's shape), NOT at
`SKIPPER_TTS_STYLE_PROMPT` — whose anti-fade clause is already maximal ("never trail off, drop low, or
swallow the closing words") and which is explicitly ear-locked. The tail check is a human-review FLAG,
not a withholding gate (same as the poi path), so all 11 shipped and are visible in `eval_scores`.

**Fix shipped + probed on the worst case.** `mergedFeatureLines` now closes a multi-subject sheet with
*"END ON ONE OF THEM — a full sentence about a single place… not a tally of everything you just named:
a closing fragment that lists them back has nothing to land on."* Scoped to `named.length >= 2` so
single-place clips, which do not have this problem, cannot inherit the rule. Regenerating the worst
clip in the run (`1960 Olympic Ski Stadium Site`):

| | tail drop | outcome |
| --- | --- | --- |
| before | **14.4 dB** | all 3 takes collapsed, shipped flagged |
| after | **1.8 dB** | clean after ONE retake |

✅ **VERIFIED at n=10, on exactly the population that failed** ($4.44). Regenerating the 10 remaining
flagged clips:

| outcome | clips |
| --- | --- |
| no collapse at all | **5** |
| collapsed once, then CLEAN after a single retake (3.5–3.9 dB) | **4** |
| still flagged | **1** (`Historic Esmeralda Avenue, Minden`, 4.6 dB, "structural") |

**Corpus-wide the flag count went 11 → 1: 35% → 3.2%**, which is the ~2% single-place baseline. The
theory held: the defect was the closing SHAPE, not the delivery, and it was fixable in the fact sheet
without touching the ear-locked TTS prompt.

⚠ The survivor is worth its own look rather than another retake — `tail.ts` calls it a *structural*
collapse (a fresh take re-collapsed at the same level, so it stopped retrying). At 4.6 dB it is the
mildest failure in the original set, and one clip at the baseline rate is not a pattern.

**2. Diversity failed 16 of 31 (52%), advisory.** The single-clip retake that took Stateline from 0.00
to 1.00 was not representative. Naming five places in one telling pulls toward enumeration, which is
exactly the NAME-DENSITY tension §3.3 predicted. Advisory only — it never withheld a clip — but at
half the run it is a real quality signal rather than noise.

## 10. The AREA trigger — BUILT 2026-07-30, then CUT WITH ROAM (1.1, 2026-08-01)

⚠ **Read this whole section as a record.** It never shipped to a rider and it no longer exists in the
tree: `packages/engine/src/area.ts`, the `roamPin.area` field, the `X-Skipper-Client` capability
channel, and the mobile `<Polygon>` all went with roam. It stays because the MEASUREMENTS are what a
future area/district trigger would otherwise have to re-derive (hull vs bbox vs disc union, why the
retire and heading cone must be bypassed, INSIDE-beats-NEAR ordering) and because of the lesson in the
`areaCapable` correction below. A drive knows its frozen polyline, so a drives-only revival is a
different design: admit iff the polyline ENTERS the ring.

`packages/engine/src/area.ts` + an area branch in both trigger loops. 125 engine tests pass,
including the whole existing point-trigger suite unchanged — the branch is additive.

**⚠ THE CONSTRAINT THAT DECIDES THE SEQUENCING: this cannot ship without an App Store release.**
Every trigger decision lives in `@skipper/engine`, which is bundled into the app binary. Server work
is ~10% of the total and changes no behaviour on its own. Worse, **there is no client-version signal
on the wire at all** — no capability flag, no `User-Agent`, nothing — so "send districts to everyone"
and "send them to no one" are currently the only two options.

And sending them to a 1.0.1 client is not acceptable: with `area` stripped by Zod it sees a 914 m
point, which reproduces the exact failure that set `CLUSTER_MAX_TRIGGER_RADIUS_M` (a 92-second
premature lead). In roam it is worse than that — `recedeMarginM` retires the pin 60 m past closest
approach and a 4-hour cooldown locks it, so the rider hears "Downtown Reno" on the freeway approach
and then **silence while actually downtown**. So: districts stay STAGED until an area-capable client
has adoption. `clusterGenerationBlock` already refuses to generate them, so nothing is at risk today.

**Design decisions, each measured rather than assumed:**

- **Convex hull, not a bbox.** Measured over the five real districts: a hull is 6–9 vertices at
  n=13..46 (cheap on the wire) and covers 44% of the enclosing circle's area on the two worst, against
  the bbox's 71%. The decisive part is not the ratio though — a bbox concentrates ALL its over-cover in
  the CORNERS, and the corner is exactly where the failure lives (a highway clipping downtown's bbox
  would fire a downtown telling at someone who never went downtown). Not a union of per-member discs
  either: measured, 250 m discs cover only 85% of downtown Reno's bbox, so a rider crossing a gap
  flips outside and back in mid-district.
- **The passed-point retire and the heading cone are BYPASSED, and that is the load-bearing bit.**
  They are not merely irrelevant for an area, they are actively harmful: distance to a district's
  centre runs 900 → 0 → 900 as you cross it, so the retire would drop the stop 40 m past the nadir —
  *while the rider is still deep inside downtown*. There is a regression test named for exactly this.
- **The entry dwell guards the BOUNDARY only.** A few seconds of consecutive containment rejects a
  stray fix; a fix more than `AREA_CONFIDENT_DEPTH_M` inside is proof rather than noise and fires at
  once. That waiver is not a nicety — with an unconditional dwell an area ALWAYS loses a race to a
  co-located point pin (the point fires first and closes the min-gap governor behind it), so
  "inside beats near" would have been true in the comparator and false in practice. A test caught it.
- **Ordering: INSIDE beats NEAR, then SMALLEST wins.** Nearest-first cannot arbitrate two districts a
  rider is inside simultaneously, and that is measured, not hypothetical: Downtown Reno and Reno's
  Historic Homes have members 54 m apart, the two Carson City districts 73 m. "Most specific" is right
  twice over — correct for nesting, and the better telling (the tight historic core over the whole
  capital).

✅ **The SERVER half is built too (2026-07-30).** Optional `area` on `roamPin` (a ring + margin), the
hull computed in `apps/api/src/clusters.ts`, and a **capability parameter**: the hull served to
EVERY client.

⚠ **A capability gate (`?caps=area`) was built and then REMOVED on a founder call (2026-07-30, risks
acknowledged).** It withheld area tellings from clients that could not fire a polygon. What protects
those clients instead is the **capped point fallback**: an area telling's `radiusM` is
`min(enclosingRadius, CLUSTER_MAX_TRIGGER_RADIUS_M)` — 600 m rather than downtown Reno's true 914 m —
so an area-unaware client degrades to today's WIDEST existing pin instead of past it.

✅ **The deeper fix — a client capability channel — EXISTS as of 2026-07-30.** The app sends
`X-Skipper-Client: v=<semver>; caps=area` from `fetchJson`; the API parses it in `withClient` and
`loadClusterTellings` takes a **required** `areaCapable`. The founder's ship-to-everyone call still
stands, so `/roam` passes `areaCapable: true` explicitly — the flip is the one line written beside it.
Verified against the live corpus by request comparison (the only way this class of bug shows up):
gated + no header ⇒ **105 pins, 0 areas**; gated + `caps=area` ⇒ **41 pins, 3 areas**. The 105 is the
point — withholding a district hands back its ~67 member pins rather than leaving a hole, because
`servedClusterIds` is derived AFTER the withhold. See `api-versioning-posture.md`'s capability
addendum for the boundary: capabilities gate CONTENT, never SHAPE.

⚠ **Suppression now takes the SERVED cluster ids, not a predicate that re-derives them.** That is the
difference between an invariant and a coincidence: a caller being withheld a district must not also
lose that district's members. The earlier form asked "does a visible fused telling EXIST", which would
have emptied downtown Reno for every area-unaware client.

⚠ **And it must return the KEEP condition, not a suppression predicate to negate.** Writing it as
`not(inArray(pois.clusterId, ids))` looks equivalent and is catastrophically wrong: `NULL IN (…)` is
NULL, so `NOT (…)` is NULL, so Postgres drops every row — measured, `/roam` fell from 46 pins to 4,
deleting every UNCLUSTERED place in the corpus. The old `NOT EXISTS` form was NULL-safe by accident;
the current one is NULL-safe on purpose.

⚠ **This section used to claim the DRIVE path passed `areaCapable: false` "deliberately". By the time
anything could exercise it, that flag was gone.** It was real for about fourteen minutes — added in
`17dc913` alongside the `?caps=area` gate and deleted with it in `66435e9` — and it dropped zero rows
in production over its whole life, because generation of wide groups was still blocked the entire time.
`66435e9` is the same commit that turned `exceedsPointTrigger` into a mode selector and released the
three area districts. So from then until 2026-07-30 the drive path had **no** `area` reference at all:
`loadClusterTellings` fed wide districts into drive selection as capped 600 m points snapped from their
off-road 1-centre, and `drives.selection` freezes that at create against a credit that never refunds.
Measured: 0 frozen, but only because all three saved drives are Tahoe-basin — the first Reno drive
would have baked one in. The protection is REAL now (below), and the lesson survives the correction:
a safety property that outlives the code enforcing it is no longer a safety property, and prose is
where that goes unnoticed.

✅ **`buildDrive`'s second admission rule — BUILT 2026-07-30.** `DriveCandidate.area` exists for the
express purpose of being REFUSED: an area candidate is skipped before the point snap, because a
district's centre is deliberately off-road and its served radius is CAPPED below its true extent — so
the point rule both mis-places the stop and voids the guarantee that justified the centre ("every
member is within the enclosing radius" holds only UNCAPPED). Two regression tests: refused even when
its point WOULD be admitted, and still admitted without a hull (guarding the mapper — `area` is
optional at every hop, so a dropped field compiles clean and silently restores the old behaviour).
When a drive can carry a ring end to end, this branch becomes the real rule: admit iff the polyline
ENTERS the ring, with `alongSec` from the entry vertex rather than the centre's projection.

✅ **Mobile ROAM wiring + map rendering — BUILT 2026-07-30.** The ring was already on riders' devices
and was being discarded by one hand-written field list in `adoptPins`; the hull now also draws as a
`<Polygon>` (teal `areaFill`/`areaStroke` roles, drawn BEFORE the markers because `zIndex` is
Google-Maps-only, and held out of `cullPins` because a district's centre can be off-screen while its
boundary is not). Still needs an App Store release to reach riders.

✅ **"Nothing bounds a clip that OUTLIVES its place" — MEASURED, and it is not an area problem.** At
40 mph the three area clusters give 34–46 s inside the hull against 148–185 s clips. But every one of
the 34 **point**-triggered fused clips already shipped is worse on the same metric: Emerald Bay has
~7 s of extent against a 127 s clip, Truckee ~0 s against 150 s. It is what a 2–3 minute telling does
at road speed, not something the area mode introduces, and bounding it would mean cutting clips off
mid-sentence across the live corpus. Recorded, not actioned.

**⚠ Two of the five districts never needed any of this.** Virginia City (265 m enclosing radius) and
Historic Downtown Carson City (411 m) are already under `CLUSTER_MAX_TRIGGER_RADIUS_M` and can ship
as point-triggered fused clips on the CURRENT client, today, for ~$1. The generation queue was changed
to ask the geometry gate rather than the `treatment` column, so they are already in scope — that is
40% of the district value for zero engine work and no release.

## 6. Staleness — BUILT 2026-07-30 (§9 step 1)

A fused clip grounds on N sheets, so one member's article moving makes it stale. The existing check joins
`narrations.facts_hash` to ONE `pois.facts_hash` and cannot express that.

**Shipped:** `clusterFactsHash` in `@skipper/db/hash`, wrapped by `clusterGroundingHash` in
`pipeline/cluster.ts`. Its payload is the TELLABLE member set (§3.2) as sorted `poiId:factsHash` pairs,
plus the cluster's naming evidence (`title`, `highlights`, `dropped`), canonicalized through the same
`stableStringify` the poi hashes use. Null — never `sha256('')` — when nothing is tellable.

Four corrections to the formula this section originally proposed, each measured:

- **Hash the tellable members, not all members.** Generation cannot ground on a sheet-less poi, so a
  bare `GROUP BY cluster_id` would hash a strictly larger set than the well — making every fused clip
  read stale forever and turning each `--apply` into a paid re-mint of identical audio. It also
  re-imports exactly the raw-article churn that `storyFactsHash`'s enriched/un-enriched switch exists
  to suppress: 85 of 295 members are un-enriched, contribute nothing to the well, and their hashes
  move on every free re-`discover`.
- **`poiId:factsHash` pairs, not bare hashes; no `.filter(Boolean)`.** Bare sorted hashes do NOT make
  membership part of the identity, which was this section's stated goal — a null-hash member is
  invisible, so `{h1}` equals `{h1, null}`. Carrying the id also makes an `excluded_reason` toggle move
  the digest, and exclusion is a free admin action that changes who is named while moving no facts at
  all.
- **Cover `title` / `highlights` / `dropped`.** §3.1 makes `highlights` the naming set, so moving a
  member from highlights to dropped rewrites the telling with byte-identical member facts. A facts-only
  hash calls that clip fresh. (`treatment` and `subject_poi_id` are deliberately OUT — both are derived
  from what is already hashed. The delivery REGISTER is also out: a poi's own `facts_hash` doesn't
  cover `pois.delivery_register` either, so a `classify-registers` re-run silently re-bands every solo
  clip too. That gap is real and repo-wide; fixing it inside a cluster helper would put the two subject
  kinds on different contracts.)
- **Compute in TS on both sides — no SQL aggregate.** There is no SQL staleness expression anywhere in
  the repo: `narrations.facts_hash IS DISTINCT FROM pois.facts_hash` appears only in comments, and both
  real detection sites (`generate-narrations.ts` `hasFreshClip`, admin `GET /admin/pois`
  `narrationStatus`) load rows and compare with `===`. A Postgres mirror would be a second
  implementation of the digest whose `ORDER BY` runs under the DB collation while JS `.sort()` runs on
  UTF-16 code units — precisely the writer/reader divergence `stableStringify` was written to prevent.
  Hence also no materialized `poi_clusters.facts_hash` column: it would be an aggregate over OTHER
  rows, invalidated by four writers (discover / enrich / refetch / classify) that know nothing about
  clusters.

⚠ **A null hash means "not generatable yet", and the caller must skip on it BEFORE consulting
freshness.** The existing freshness idiom requires a non-null hash to read fresh, so a cluster queued on
a null hash is re-narrated and re-synthesized on every non-`--force` run. Skip it the way
`generate-narrations` already skips a sheet-less poi — before `hasFreshClip` is ever read.

⚠ The one property that matters — *the hash's input set equals the well's input set* — cannot be
tested until step 4 exists. It is bought STRUCTURALLY instead: both derive from the single array
`tellableMembers()` returns. Step 4 should assert that identity at the insert rather than re-deriving it.

## 7. Open questions to settle before building

(The "do members stay active" question was here and is now SETTLED in §4.2 — they do not.)

1. **§3.3** — the length bands are guesses; pin them on a listen.
2. ✅ **CLOSED 2026-07-30 — the question dissolved.** Position never consults the subject at all
   (§4.1b), so "what happens when there isn't one" stopped being a case.
3. ✅ **CLOSED 2026-07-30 — §6 is built.** It does not plug into a staleness *join* at all: there was
   never a SQL one to plug into. See §6.
4. **Admin** — RESOLVED in shape, unbuilt: surface the fused clip on the EXISTING POI sheet rather than
   building a `/clusters` page. Every member already renders its cluster on the Location tab, so a
   "Cluster narration" block there (play / regenerate / release, mirroring the per-POI Narration tab)
   needs no new navigation, no new Reference-page section, and is reachable from any of the 295 members.
   A dedicated page only earns its keep once clusters need list-level operations.
5. ✅ **CLEARED 2026-07-30** — the grouping was re-applied on the subset-of-words merge. Carson City is
   now ONE district of 33 (exactly the 20 + 13 that were split), so generation starts from a corpus with
   no duplicate districts. The recalibrated review gate also cut the human queue from 25 groups to 15
   across both regions.

## 8. Prerequisites — all met

- ✅ 64 clusters applied with `highlights`/`dropped` populated
- ✅ `narrations.cluster_id` + XOR CHECK + unique index (migrations 0036–0038)
- ✅ containment keeps parks/ranges/roads out of clusters entirely (0039–0040)
- ✅ `buildGroundingWell` already accepts merged features
- ✅ the staleness hash + the member-set resolver (§6, §9 step 1) — no migration was needed
- ⚠ NOT met: a real Tahoe drive. Every number in §3.3 and §4.1 is a desk estimate, and this is the step
  that turns a desk estimate into 30 pieces of paid audio.

## 8b. ⚠ Two corpus defects that BLOCK step 4 — found by the position measurement, 2026-07-30

Both are in the Reno campus grouping, both survive every existing gate, and neither is a phase-4 bug —
the measurement just happened to look closely enough to see them.

**1. `UNLV Arboretum` is pinned in Reno, and it is ALREADY LIVE.** Wikidata Q7865354 carries
`39.5458, -119.817` — byte-identical to Q7895895 (`University of Nevada, Reno Arboretum`), 700 km from
the actual arboretum in Paradise, Nevada. Confirmed against Wikidata directly, so the error is
UPSTREAM and our sweep imported it faithfully. It was enriched, narrated, and RELEASED: a 71-second
clip that opens *"…the UNLV Arboretum down in Paradise, Nevada"* fires on the UNR campus today.

⚠ **This is a whole error CLASS the fail-closed grounding gate is structurally blind to.** The script
is accurate, the fact sheet is accurate, the attribution is correct — only the COORDINATE is wrong,
and nothing in the pipeline checks a place against where it says it is. Same shape as the
name-derived-claim trap in `cut-wave-form.md`: the gate verifies script↔facts and cannot see outside
that pair. Phase 4 raises the stakes rather than creating the problem — as a cluster member it would
be NAMED inside the fused Reno telling, and §3.2's exclusion clause is the only thing that could stop
it.

✅ **RESOLVED 2026-07-30 — the row is EXCLUDED** (reversible: the audio is kept and restoring needs no
regeneration), and it is gone from `/roam`. A triage detector now runs automatically in `discover-pois`
(on the swept batch, before anything is written) and `prune-corpus` (over existing rows) — see
`docs/guides/ops-scripts-sop.md` §"what the checks can't see" for why it can only FLAG and never
decide: every structured signal, ours and upstream, is wrong the same way, and only the prose is
right. Measured: 13 collisions corpus-wide, 12 genuine, so auto-excluding would bury 12 real places to
catch 1. The DECISIVE check needs to read the prose, i.e. model judgment, and belongs in the paid
`enrich` step where the article is already in context — not built. Still a contribute-back candidate
(agent drafts, human submits).

**2. ✅ RESOLVED 2026-07-30 — two cluster rows over the same campus.** `University of Nevada, Reno
Campus` (5 members) and `University of Nevada Reno Campus` (2), 1-centers 1.2 km apart, would have
shipped two fused clips about one campus. The merge pass that fixed this shape for Carson City only
considered DISTRICTs; it now covers CLUSTERs too (`mergeDuplicateGroups`), and — the half that
mattered more — **re-classifies whatever it fuses**, because a merged group used to inherit one half's
`highlights`, which is exactly what fused generation writes from.

Applied to Tahoe (~$1.50 total across preview + apply, since `--apply` re-runs the classification).
The merge fired THREE times, not the one predicted against the stored grouping: the UNR campus plus
two district splits that recur on any fresh classify. The re-classification earned its keep on the
spot — seeing all its members at once, `Reno's Historic Homes and Casinos` reconsidered itself from
CLUSTER to DISTRICT, which no half-group verdict would have caught. Result: 67 groups (62 cluster /
5 district), UNR is one cluster of 6, and Stateline's casino row moved DISTRICT → CLUSTER, agreeing at
last with what §3.1 has always used it as the example of. ⚠ The merge's side effect on trigger
geometry is in §4.1b.

Both are now resolved. What remains from them is the standing lesson in §"what the checks can't see"
of `docs/guides/ops-scripts-sop.md`, and the 903 m UNR trigger radius in §4.1b.

## 9. Build order

Sequenced so nothing irreversible happens before the thing that makes it reversible-in-practice exists.
**Steps 1–3 spend nothing and touch no audio. Step 4 is the commitment point.**

1. ✅ **Staleness hash — BUILT 2026-07-30.** `@skipper/db/hash` (`clusterFactsHash`, plus the poi
   hashers moved there so admin can reach them), `@skipper/shared`'s `isNarratableStoryPoi`,
   `pipeline/cluster.ts` (`loadClusterMembers` / `tellableMembers` / `clusterGroundingHash`), and
   `packages/db/test/hash.test.ts`. Verified read-only against the live corpus: 34 clusters resolve to a
   hash (30 CLUSTER + 4 district), 34 distinct, stable under member reordering; 30 return null as
   "not generatable yet". Went first not for the recompute cost — with zero cluster narrations there is
   nothing to backfill — but because **steps 2, 4 and 6 all consume the same member-set definition**,
   and because both failure modes cost money on a schedule: a null hash re-mints every clip on every
   run, an over-broad hash makes them immortal.
2. ✅ **Position + radius — BUILT 2026-07-30.** `clusterTrigger` in `@skipper/engine` (the 1-center +
   `max(250, enclosingRadius)`, §4.1b), plus `DriveCandidate.triggerRadiusM` /
   `candidateTriggerRadiusM` so a subject with no `kind` can supply its own floor. Both rules §4.1
   originally proposed were rejected by the measurement. Verified live: the enclosing invariant holds
   for all 107 members of all 30 clusters.
3. ✅ **Read paths — BUILT 2026-07-30.** `apps/api/src/clusters.ts` + the drive corpus and `/roam`
   union. Notes worth keeping:
   - **A subject, not a poi.** The corpus is keyed by `subjectId`, and `DriveSelectionItem` now
     freezes `subjectId` + `subjectKind` rather than `poiId`. Putting a cluster id in a field called
     `poiId` is the exact false statement the `poi_clusters` table was created to stop. `poiId`
     survives as a read-only legacy field; `selectionSubject` (in `@skipper/db/schema`, so the API and
     the simulator share one reader) coalesces it. Verified: all 18 stops in the 3 pre-existing drives
     still resolve.
   - **The wire did NOT change.** `driveClip.poiId` was already `nullish()` and nothing on the client
     reads it (a drive clip's identity is `seq`). `roamPin.poiId` is required, so a cluster pin puts
     the CLUSTER's uuid there — safe because the client treats it as an opaque token everywhere (a
     Map/Set key, a React key; it never looks a poi up), and unsafe to rename because `roamManifest`
     parses with `.parse` over `z.array`, where one bad pin rejects every pin.
   - **No bbox prefilter for clusters** — `poi_clusters` stores no coordinates, so the position only
     exists once the members are loaded. Fine at a few dozen rows; the distance trim happens after.
   - A cluster whose members have all become un-tellable yields no position and is DROPPED rather than
     fired somewhere arbitrary.
   - ⚠ `packages/sim` skips cluster stops rather than mis-placing them — the simulator has no path for
     a member-derived geometry yet. Worth revisiting once there is fused audio to simulate.
4. **Fused generation — BUILT; ONE clip generated 2026-07-30.** `--limit 1 --apply` on Stateline
   (9 members, the density stress case): **$0.90**, 2:21 of audio, every GATE dimension clean, STAGED.
   The retake loop did real work — it excised 2 ungrounded claims AND took diversity from 0.00 to 1.00,
   so the list-feel the previous take was flagged for resolved itself under `optimize()` rather than
   needing a prompt change. Row verified: `cluster_id` set, `poi_id` NULL, 9 attribution sources,
   `facts_hash` stamped.

   ⚠ **The one real defect: TAIL COLLAPSE, unresolved across all 3 takes.** The closing line measures
   6.3 dB below the body (−28.8 dB tail vs −22.5 dB body, against a 4 dB threshold), so the clip
   shipped flagged for the human pass. That is the tail-retake mechanism working as designed — it
   caught it and refused to hide it — but three failed takes on one clip is a pattern worth watching:
   a fused telling ends on a summarising closer after a long body, which may be exactly the shape that
   trails off. Needs an ear and more samples before concluding it is fused-specific.

   The remaining 30 (~$12–16) need a founder go.

4b. ✅ **Fused generation — ALL 31 GENERATED 2026-07-30.** 31/31 shipped, 0 withheld, 59.8 min of audio
   (avg 116 s), ~$16.70. Every row verified: `cluster_id` set, `poi_id` NULL on all 31, attribution
   non-empty on all 31, `facts_hash` stamped on all 31, all STAGED. Member clips untouched.

   **Grounding held perfectly at scale: 0 failures across 62 scores.** That is the design's central bet
   — a fused well through `mergedFeatures` needs no gate change — confirmed on 31 clips rather than
   argued.

   ⚠ See §5b for the two defects the run surfaced, one of which reverses an earlier call of mine.

4c. **Yosemite's 30 clusters — NOT RUN.** `generate-cluster-narrations.ts` is complete: narrate →
   fail-closed gate with excision retakes → TTS → loudnorm → R2 → upsert on `narrations_cluster_uq`,
   plus the eval-run record keyed to the CLUSTER. `--apply` is the first spend (~$12–16 for all 31)
   and the first audio, so it **needs an explicit founder go**. ⚠ A PREVIEW is not free either — it
   narrates and scores; only the persistence is gated. `--limit 1` is the cheap path to one real clip
   to listen to. Notes: the R2 key stays under the `narration/` prefix (the only thing `sweep-orphans`
   protects); `releasedAt` is absent from the upsert's `set`, so a regen never un-publishes; and
   attribution unions EVERY tellable member including the background ones, whose facts are in the well
   even though their names are never spoken.
5. **LISTEN.** The gate on 6, and not automatable. A fused telling worse than its members is a
   regression with no fallback.
6. ✅ **Retire members — BUILT 2026-07-30, and it is INERT until a release.** `supersededByFusedTelling`
   (`apps/api/src/clusters.ts`) drops a member from `/roam` and from the drive BUILD corpus once its
   cluster has a fused telling the caller can see.

   ⚠ **Keyed on "its cluster HAS a visible fused telling", never on `cluster_id IS NOT NULL`.** That
   distinction is the whole safety property, and the naive version would have been a disaster: measured
   live, 304 pois carry a `cluster_id` but only **104** belong to a cluster that has a fused clip. The
   other **200** — the 30 un-enriched Yosemite clusters plus the geometry-gated UNR campus — would have
   vanished from roam and from drives with nothing to replace them.

   Measured in both modes: **public 0 suppressed** (every fused clip is staged, so it is a runtime
   no-op), **admin preview 104 suppressed** — exactly the retirement count §4.2 predicted. Verified
   live: `/roam` returns the same 46 pins it did before any of phase 4, Stateline's members included.

   ⚠ **This retirement is REVERSIBLE and deletes nothing.** It is read-path suppression, so the member
   `narrations` rows and their R2 objects survive untouched — deleting a fused telling brings its
   members straight back. Nothing here creates orphans, so `sweep-orphans` is NOT part of this step.
   The spec's earlier worry about retiring audio before hearing its replacement does not apply to the
   shape that got built.

   Still open: the queue filter in `generate-narrations` (so a run does not pay to regenerate a
   superseded member's clip). Cosmetic — it wastes money, it does not break anything.
7. **Admin surface.** Can trail; ungovernable without it, not broken.
   - ✅ **The release path was NOT trailable and is fixed (2026-07-30).** The region release stamped
     `narrations.poi_id IN (pois in bbox)`, which a fused clip's NULL `poi_id` can never match — so all
     31 clips would have been paid for, correct, and permanently STAGED, which is to say unhearable,
     since `released_at` is what every public read path filters on. It now stamps cluster subjects too,
     via the same geometry-first "a cluster is where its members are" rule, as a separate batch
     statement so each half stays an indexed lookup and the counts report apart.
   - ✅ The eval panel takes a cluster subject: `eval_scores.cluster_id` (migration 0041) and
     `ClipIdentity` is poi-XOR-cluster. ⚠ Known gap: `eval_scores_case_idx` is keyed on
     `(qid, dimension)` and a cluster has no QID, so fused clips do not join across runs for regression
     tracking. Not worth an index churn before the clips exist.
   - ⚠ **Still open:** `GET /admin/pois` renders every member of a cluster as
     `narrationStatus: 'none'`, so an operator cannot tell "covered by a fused clip" from "never
     generated"; and there is no per-clip release for a fused telling (the endpoint is poi-keyed). The
     region release covers the real workflow, so neither blocks step 4.
