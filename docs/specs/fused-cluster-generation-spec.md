# Fused cluster generation — phase 4 of the legibility layer

> **Status:** BUILD-READY spec — **2026-07-30**. Promoted from `docs/ideas/poi-legibility-layer.md` on
> founder intent ("let's prepare to do phase 4"). Phases 1–3 are BUILT and APPLIED: the corpus is
> grouped into **67 clusters** (62 cluster / 5 district) over 302 members, each carrying `treatment`,
> `title`, an optional `subject_poi_id`, and the model's `highlights` / `dropped` evidence.
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

### 3.3 Length band

Concatenation is not an option: Emerald Bay's three clips total 214 s and Stateline's five total 489 s,
against a 180 s `DRIVE_MIN_GAP_SEC` and a 45 s `DRIVE_MAX_LAG_SEC`. A fused telling is **written to a
band**, not assembled.

Proposed, and explicitly NOT derived — pin these on the first listen:

| treatment | target | max | shape |
| --- | --- | --- | --- |
| `cluster` | ~120 s | 180 s | names each highlight, one connective thread |
| `district` | ~150 s | 180 s | names 2–3 landmarks, the rest as texture |

`lengthForRegister` is the existing seam.

### 3.4 Write

```
narrations: cluster_id = <cluster>, poi_id = NULL, form = 'story'
            attribution = union over ALL members' sources   ← CC BY-SA, non-negotiable
            facts_hash  = hash over the members' sheets       ← see §6
onConflictDoUpdate target: narrations_cluster_uq
```

The `narrations_subject_xor` CHECK enforces poi-XOR-cluster; the unique index gives 1:1 per cluster.

## 4. Read paths

### 4.1 A cluster needs a POSITION and a RADIUS

A cluster has N member coordinates and no coordinate of its own. Decide:

- **Position** — the `subject_poi_id`'s speakable anchor when a subject exists (36 of 67 clusters), else
  the member closest to a through-road. ⚠ NOT the centroid: for the Stateline strip that is a car park.
- **Radius** — must cover the group, so `max(memberDistanceFromPosition) + triggerRadiusForKind`, floored
  at `ANCHORED_TRIGGER_RADIUS_M`. ⚠ Then re-check §"reachability": the drive selector now gates on the
  radius the trigger will actually use, so a fat cluster radius changes which clusters are selectable.

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

**Scale:** 421 tellings → **274** (207 solo + 67 fused). **214 member clips retire — 51% of the corpus.**

⚠ **Sequence this so good audio is never retired before its replacement is heard.** Generate the fused
clips and listen BEFORE retiring members; a fused Emerald Bay telling that is worse than the individual
Vikingsholm one would be a regression with no fallback. Retirement is reversible while the clips exist in
R2 — run `sweep-orphans` only after the listen, not as part of the same pass.

## 5. Cost and blast radius

~67 fused clips ≈ **$10–15** LLM + TTS. Cheap. What is NOT cheap is that this is the first irreversible
step: fused audio in R2, and 214 member clips retired (§4.2).

Sequence: `--apply` per region, preview first, and run `sweep-orphans` after — the corpus is currently at
a clean 421 objects / 421 referenced / 0 orphans, so any drift is attributable to this run.

## 6. Staleness

A fused clip is grounded on N sheets, so its `facts_hash` must hash the **union** of member sheets. If a
single member's article moves, the fused clip is stale. The existing per-poi staleness comparison does
not express this — it joins `narrations.facts_hash` to one `pois.facts_hash`. Needs extending, or fused
clips are silently never marked stale.

## 7. Open questions to settle before building

(The "do members stay active" question was here and is now SETTLED in §4.2 — they do not.)

1. **§3.3** — the length bands are guesses; pin them on a listen.
2. **§4.1** — cluster position when there is no subject (31 of 67 clusters).
3. **§6** — how the union hash plugs into the existing staleness join.
4. **Admin** — the console shows grouping read-only; a fused clip needs a play/regenerate surface like
   the per-POI Narration tab, or it is ungovernable.
5. ⚠ **Re-apply the grouping first.** The district merge was fixed again on 2026-07-30 (subset-of-words),
   but the STORED grouping predates it, so Carson City is currently TWO districts — `Historic Carson City`
   (20) and `Historic Downtown Carson City` (13). Generating from that produces two competing tellings
   about one downtown, which is the precise thing the merge exists to prevent. One `--apply` per region
   (~$1.20) before any audio is minted.

## 8. Prerequisites — all met

- ✅ 67 clusters applied with `highlights`/`dropped` populated
- ✅ `narrations.cluster_id` + XOR CHECK + unique index (migrations 0036–0038)
- ✅ containment keeps parks/ranges/roads out of clusters entirely (0039–0040)
- ✅ `buildGroundingWell` already accepts merged features
- ⚠ NOT met: a real Tahoe drive. Every number in §3.3 and §4.1 is a desk estimate, and this is the step
  that turns a desk estimate into 67 pieces of paid audio.
