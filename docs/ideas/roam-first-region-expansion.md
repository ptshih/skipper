# Roam-first region expansion — the beachhead inversion

> **Status:** IDEA, captured 2026-06-11 (founder: "intriguing — proceed") out of the roam
> improvement brainstorm ([free-roam-mode.md](free-roam-mode.md) §Alpha learnings). Grounded
> same day with three $0 dry-run corpus probes (numbers below). No build greenlit; the
> sequencing question is on the founder's desk after roam build pass 2 proves out.

**The thesis:** the milestone plan assumes a region opens with a TOUR (curate a route, generate,
ear-pass) and roam arrives later as the companion mode. Invert it. A roam region needs a bounding
box and a batch run — no route curation, no arc, no tour assembly, no per-region design work. So
roam can be the *beachhead*: open a region for tens of dollars, let real roaming paint the demand
heatmap, and let THAT decide which tour the region deserves (and where it should run). The tour —
the expensive, curated artifact — gets built with evidence instead of guesses.

## The cost asymmetry (why the inversion is even on the table)

| | a TOUR opens the region | ROAM opens the region |
|---|---|---|
| route | hand-curated + frozen (the rails doctrine — human taste, the scarce input) | none — the rider's own errand is the route |
| selection | pacing/gap-fill/cluster work per route | the sweep's tier filter |
| generation | narration + brackets + eval panel + regen loop | one batch of self-contained encounters |
| QA | founder ear-pass per tour | ear-pass per region (sampled), eval panel batch |
| marginal $ | ~$3–6 LLM + TTS per tour, plus curation TIME | ~$10–25 all-in for a whole region |
| output | one drive | every drive in the region |

The human-taste bottleneck (route curation) is exactly what roam doesn't have. That's the whole
inversion: regions become cheap to OPEN and expensive only to PERFECT.

## The probes (run 2026-06-11, $0 — `sweep-roam-pois` dry-runs, same tiering as Tahoe)

| region (bbox) | places | STORY | SCENIC | est. story-gen cost* |
|---|---|---|---|---|
| **Tahoe basin** (baseline, live) | 265 swept | 139 (77 narrated) | 126 | $9.64 actual (77 clips) |
| **Yosemite** Valley + 140/Wawona approaches | 399 | 110 | 143 | ~$14 |
| **Moab** (Arches, 191, river road, Island in the Sky) | 280 | 48 | 130 | ~$6 (+ waves) |
| **Big Sur** (Carmel → San Simeon, Hwy 1) | 733 | 172 | 299 | ~$21 |

*\*scaled off Tahoe's actuals; waves add ~$1–3/region once the form exists.*

What the numbers actually say:

- **Yosemite is Tahoe-grade** (110 story vs 139) — roam-ready on corpus alone, and drivable from
  Zephyr Cove for founder field validation. The obvious candidate #1.
- **Moab is story-thin but scenic-rich** (48 vs 130) — its roam viability *depends on the wave
  layer*, which is exactly what build pass 2 locks. The wave form isn't just Tahoe charm; it's
  the unlock for the whole scenic-rich/story-thin region class (most of red-rock Utah, probably).
- **Big Sur is the richest corpus of the three and the ideal roam SHAPE** — a linear corridor
  means nearly every pin sits on the one road (Tahoe's unreachable-centroid problem barely
  exists), and "the classic California drive" is roam's product story told by geography. It is
  also the acid test for the offline pack: most of Hwy 1 has no cell service.

## What a roam-first launch actually requires (the gates)

1. **The density bar, honestly measured.** Probe counts ≠ road-reachable encounters. The
   road-snap-at-sweep idea (free-roam backlog) turns the sweep into a real density report:
   encounters per 5 driving minutes on the main corridors. A region that fails the bar waits.
2. **A host identity answer.** `personaForRegion(slug)` — the Skipper is TAHOE's guy; the moat is
   regional depth, not coverage (our own Autio verdict). Cheapest honest v0: the Skipper "on
   assignment" in region 2 (one persona, self-aware about traveling); the real answer is
   [region-skippers.md](region-skippers.md) (M4) pulled earlier for region 3+.
3. **Roam gating + a monetization shape that works tourless.** Today's endpoint is open (alpha).
   The perk-of-ownership instinct breaks in a region with no tour to own — a roam-first region
   needs its own answer (free taste → region pack purchase? roam sub? decide before region 2, not
   after).
4. **The offline pack.** Mandatory for Big Sur, strongly wanted everywhere (already on the
   reliability backlog — dead zones + presign expiry).
5. **QA at a distance.** The founder can't field-drive Moab weekly. Roam joining the eval panel +
   the admin ear-pass (backlog) stops being hygiene and becomes the release gate for any region
   he can't personally validate.

## The flywheel, sharpened

Roam-first regions make the demand heatmap (client-side debrief → aggregate) the PRIMARY
instrument: where do riders actually drive, where were the silent stretches, what got
"what's-that?"-pulled. That picks the first tour's corridor with data. The loop:
sweep ($0) → roam batch (~$15) → real usage → heatmap → THE tour (curated where it counts) →
tour owners get roam as the perk → the region matures into the Tahoe shape.

## Pre-mortem (what kills it)

- **Persona dilution** — a generic skipper everywhere is Autio with extra steps. The moat is a
  host who KNOWS the region; gate 2 is the real product risk, not the corpus.
- **Density-bar self-deception** — 110 story pins that mostly sit off-road is a quiet app and one
  bad review. Gate 1 before any announcement.
- **Seasonality** — Tioga Pass closes; Moab summers are brutal. Baked clips hold no volatile
  data (doctrine), so seasons are a selection/coverage question — but a region whose main
  corridor closes half the year halves its roam value.
- **Distribution** — a roam region nobody hears about doesn't market itself (Detour died
  beloved). Roam-first lowers the COST of a region, not the cost of telling anyone.
- **Founder bandwidth** — every region added is an ear-pass + taste surface; gate 5 only
  mitigates, never removes.

## Sequencing sketch (founder's call, after pass 2)

Pass 2 (waves + history/mute + cue) proves the richer companion in Tahoe → offline pack lands →
then **Yosemite as region 2** (Tahoe-grade corpus, founder-drivable, Skipper-on-assignment
acceptable) while **Big Sur waits on the offline pack it can't live without** — or Big Sur first
precisely BECAUSE it forces the offline work the whole product wants. Moab waits for waves to
prove the scenic-region pattern in-corpus first.

## Open questions (founder decision surface)

1. Region 2: Yosemite (validation proximity) or Big Sur (corpus + shape + the offline forcing
   function)?
2. Skipper-on-assignment for region 2: charming or dilution? (One named host traveling vs
   pulling region-skippers forward.)
3. Does roam-first change the gating decision (open alpha → free account → paid) timeline?
4. Is the heatmap aggregate (server-side) acceptable under the toy lens, or does the debrief
   stay screenshot-only until it hurts?

## Provenance

Brainstormed 2026-06-11 (round 2, idea #17 — "Roam-first region expansion"); founder flagged it
intriguing and asked to proceed; probes run same day. Parents:
[free-roam-mode.md](free-roam-mode.md) (the mode itself), [journey-layer.md](journey-layer.md)
(rung 1.5 of the coverage spectrum), [region-skippers.md](region-skippers.md) (gate 2's real
answer), `docs/research/competitor-ux-studies.md` (the Autio scope inversion this leans on).
