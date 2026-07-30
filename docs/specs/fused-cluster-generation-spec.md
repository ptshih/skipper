# Fused cluster generation — phase 4 of the legibility layer

> **Status:** BUILD-READY spec — **2026-07-30**. Promoted from `docs/ideas/poi-legibility-layer.md` on
> founder intent ("let's prepare to do phase 4"). Phases 1–3 are BUILT and APPLIED, and the grouping was
> re-applied on 2026-07-30 after the third district-merge fix: **64 clusters** (60 cluster / 4 district)
> over 295 members, all 64 carrying `highlights` / `dropped`, 33 with a real `subject_poi_id`. The four
> districts are Downtown Reno (46), Historic Carson City (33), Virginia City (15), Stateline's Casino
> Row (9). ⚠ §7.5 is now CLEARED — Carson City fused from two districts into one.
> **Nothing here is built.** This is the first step that SPENDS on audio and the first that a rider
> hears. Read `poi-legibility-layer.md` §4–§5 first — it records why the shape is what it is, including
> two designs that were tried and replaced.

## 1. What phase 4 is

Today every member of a cluster still has its own clip, and the grouping is inert. Phase 4 produces
**one fused telling per cluster** and makes the read paths serve it.

The stop count doesn't just shrink — it converts. Emerald Bay stops being "three clips of which a drive
plays one" and becomes "one clip that names all three."

## 2. The two halves, and the one that gets forgotten

**(a) Generation** — write a `narrations` row with `cluster_id` set and `poi_id` NULL.

**(b) Read paths** — ⚠ **without this, phase 4 generates audio nobody ever hears.** Every read path
today inner-joins `pois` (`/roam`, `loadCorpusForRoute`, `loadCorpusByPoiIds`), which was the deliberate
safe default when `poi_id` became nullable: a cluster telling is invisible rather than mis-attributed.
That default has to be lifted here, or the spend buys nothing.

Ship (a) and (b) together. There is no useful intermediate state.

## 3. Generation

### 3.1 Input — generate from `highlights`, never raw membership

⚠ The single most important constraint. CLUSTER groups of 7–9 members exist (Stateline's casino row is
9), which looks like a violation of the "seven or more → district" rule and is not: the model counts
the members it would NAME, after its `drop` list. Stateline drops 4 of 9, leaving 5.

So the telling is written over `poi_clusters.highlights`, with `dropped` members contributing **facts but
never a mention**. Generating from raw membership produces a nine-name recital.

### 3.2 Grounding — the mechanism already exists

`buildGroundingWell` already accepts `mergedFeatures: { name, facts }[]` and emits `"<name>: <fact>"`
lines; it is live in `narrate.ts` and populated via `poi-overrides.ts`. A fused clip's well is the
members' fact sheets mapped into that shape — **no change to the gate**, which is the happiest finding
in this design. The fail-closed grounding gate then applies unmodified.

⚠ Ground on ALL members' sheets (including `dropped` ones — their facts are real, only their names are
uninteresting), but permit only `highlights` to be NAMED. That asymmetry is new and the prompt must say
it explicitly, or the model will name whatever it grounds on.

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

**Therefore two mechanisms, not one:**

- **CLUSTER** — a point trigger works. Small clusters measure ~240 m worst-member. Position: the
  subject's speakable anchor when one exists, else the **medoid** (the member minimising worst distance
  to the others) preferring a through-road anchor. Radius: `worstMemberDistance + ANCHORED_TRIGGER_RADIUS_M`.
- **DISTRICT** — needs an AREA trigger ("am I inside the members' bbox?"), not a proximity one. That is
  a genuinely new trigger mode in `@skipper/engine`, and it is the single biggest unbudgeted piece of
  phase 4. ⚠ If that is too much scope, the honest fallback is to ship CLUSTER fusion only and leave
  districts as they are today — 4 districts vs 60 clusters, so most of the value lands either way.

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

**Scale (re-measured after the 2026-07-30 re-apply):** 421 tellings → **~271** (207 solo + 64 fused).
**~214 member clips retire — roughly half the corpus.**

⚠ **Sequence this so good audio is never retired before its replacement is heard.** Generate the fused
clips and listen BEFORE retiring members; a fused Emerald Bay telling that is worse than the individual
Vikingsholm one would be a regression with no fallback. Retirement is reversible while the clips exist in
R2 — run `sweep-orphans` only after the listen, not as part of the same pass.

## 5. Cost and blast radius

~67 fused clips ≈ **$10–15** LLM + TTS. Cheap. What is NOT cheap is that this is the first irreversible
step: fused audio in R2, and 214 member clips retired (§4.2).

Sequence: `--apply` per region, preview first, and run `sweep-orphans` after — the corpus is currently at
a clean 421 objects / 421 referenced / 0 orphans, so any drift is attributable to this run.

## 6. Staleness — resolved 2026-07-30

A fused clip grounds on N sheets, so one member's article moving makes it stale. The existing check joins
`narrations.facts_hash` to ONE `pois.facts_hash` and cannot express that.

**Rule:** a cluster narration's `facts_hash` is a hash over its members' hashes, ORDER-INDEPENDENT:

```
clusterFactsHash = sha256( members.map(p => p.facts_hash).filter(Boolean).sort().join(',') )
```

Sorting (rather than XOR) keeps it deterministic, collision-resistant, and debuggable — you can print the
input. Membership itself is part of the identity: if a member is added or removed the set changes and the
hash changes, which is correct, because the telling should be rewritten.

The staleness query becomes a `GROUP BY cluster_id` computing the same aggregate and comparing. ⚠ Settle
this BEFORE generating: retrofitting means recomputing hashes for all 64 clips, and until it exists fused
clips are silently immortal — never stale, never regenerated, drifting away from their sources forever.

## 7. Open questions to settle before building

(The "do members stay active" question was here and is now SETTLED in §4.2 — they do not.)

1. **§3.3** — the length bands are guesses; pin them on a listen.
2. **§4.1** — cluster position when there is no subject (31 of 67 clusters).
3. **§6** — how the union hash plugs into the existing staleness join.
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

- ✅ 67 clusters applied with `highlights`/`dropped` populated
- ✅ `narrations.cluster_id` + XOR CHECK + unique index (migrations 0036–0038)
- ✅ containment keeps parks/ranges/roads out of clusters entirely (0039–0040)
- ✅ `buildGroundingWell` already accepts merged features
- ⚠ NOT met: a real Tahoe drive. Every number in §3.3 and §4.1 is a desk estimate, and this is the step
  that turns a desk estimate into 67 pieces of paid audio.
