# The POI legibility layer — turning a Wikidata dump into drivable stops

> **Status:** design pass — **2026-07-29**. Founder-framed as *"a primary piece of logic unique to
> Skipper's intelligence… a moat that prevents anyone with access to an LLM and Wikidata from
> replicating us"*, and as the thing that makes **region N+1 cheap and accurate**. Grew out of the
> `TODO.md` ask "merging co-located POIs" (Camp Richardson / Emerald Bay) plus the follow-on ask to
> ensure a POI sits close enough to a **major road** to trigger well. **NOT greenlit — no build.**
> Every number below is `[measured]` against the live 460-clip Tahoe corpus and the 3 saved drives on
> 2026-07-29, reproducible from the queries described in §2. Recommendation at the end: build §5
> Phase 1 first (cheap, no schema, immediately useful), and treat §4 as the real design question.

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

**Most of the corpus has no `kind`:** 392 of 460 are `kind = null`. Two live consequences nobody has
noticed: `radiusForKind` falls to its 600 m default for 85% of pins, and the variety tiebreak in
`drive-select.ts` `better()` (`a.cand.kind !== prevKind`) compares `null` to `null` — so **the variety
rule is effectively dead for 85% of selections**. Worth fixing independently of everything below.

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

⚠ **Clustering must be corpus-level and precomputed, never per-route.** Audio is synthesized ahead of
time and a merged telling is one clip; if cluster membership depended on the route, you'd need audio
per route, which is the thing V2 exists not to do.

## 5. Entity model

Add **one nullable self-referencing column**: `pois.cluster_anchor_id`. A POI carrying it is a
satellite of that anchor; the anchor's narration is generated over the whole group's fact sheets.
This survives every hard invariant without forking one:

- `narrations_poi_uq` (1:1 with a poi) — **unchanged**; the fused telling belongs to the anchor.
- QID dedup — **unchanged**; every member keeps its own `qid` row and attribution.
- `narrations.attribution` is already an **array**, so one clip can carry the CC BY-SA credit for
  every Wikipedia-sourced member. Legal requirement satisfied by construction.
- Roam — satellites resolve to the anchor's clip instead of holding their own, so roam stops
  telling five casino stories on one block. The 300 m/15-min roam suppression becomes redundant here
  rather than a second, differently-tuned mechanism.
- `buildDrive` — an anchor is one candidate; satellites never enter the pool, so pick-one has
  almost nothing left to destroy.

Rejected: a `poi_clusters` table (a new entity to keep in sync for no gain), and generation-time-only
merging with no persisted grouping (invisible to roam and to admin, unauditable).

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
