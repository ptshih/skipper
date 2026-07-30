# TODO — engineering backlog

Carry-forward **engineering** items (the near-term layer of the truth system — see
`docs/README.md`; product ideas live in `docs/ideas/`, build-ready designs in `docs/specs/`).
Each item has enough context to action without re-deriving the reasoning. **Delete items
when done** — git history is the archive.

## The POI legibility layer — cluster / district / road-relevance (founder ask 2026-07-29)

Founder, from the road: stacked POIs don't all play — one fires and the car is already past the rest
(**Camp Richardson**, **Emerald Bay**). Follow-on asks: make sure a POI is **close enough to a major
road** to trigger well, and make the whole thing **region-agnostic** so adding Yosemite is a sweep,
not hand-curation. Founder framing: this is *"a primary piece of logic unique to Skipper's
intelligence… a moat"* — LLM spend is explicitly fine here.

**Full design + all measurements: `docs/ideas/poi-legibility-layer.md` (2026-07-29, NOT greenlit).**
Read it before touching any of this — two naive approaches are already disproven there (proximity
clustering CHAINS: 400 m radius → a 1623 m/60-member blob; and proximity alone is semantically wrong:
capping Reno's 84 NRHP entries just fragments them into arbitrary quintets). Headline measurement:
real drives select **8 stops where their own pacing budget allowed 12** — this is "fill the drive",
not merely "stop losing places".

Phases, in dependency order (1 and 2 are worth doing whatever happens to the rest):

- [x] **1a. Road CLASS on the snap — BUILT 2026-07-29.** `pois.speakable_road_class` (migration 0034);
      `snap-speakable-anchors` now asks Overpass for `out tags geom`, PREFERS a through-road when one
      clears the same kind-aware bound, and records the class. New `--class-only` mode backfills the
      class for existing anchors WITHOUT moving them (`--force` would relocate hand-curated ones).
      Measured on a full re-snap preview: **628 of 699 land on a through-road, 71 on the minor layer**
      — that 10% is the "triggers from a street nobody drives" set.
- [x] **Admin exclusion + grouping surface — BUILT & VISUALLY VERIFIED 2026-07-29** (`b0b240c`,
      `ce9cab4`, + the visual-pass fixes). POI sheet shows an amber Excluded banner on every tab; Location
      shows the anchor's ROAD CLASS (amber chip on the minor layer), the GROUPING (anchor/satellite,
      treatment, title, members) read-only, and an Eligibility exclude/restore control. Verified in Chrome
      in BOTH themes against a pruned POI, a cluster anchor, a satellite and a district anchor. The pass
      caught two real bugs a typecheck+build could not: the banner ran the operator's reason straight into
      the next sentence ("…point trigger Saved drives keep it"), and a `·` list separator rendered
      asymmetrically ("Tahoe ·Caesars"). Both fixed.
- [ ] **1b-follow-on: road class still has no consumer.** The silence bug turned out to be a threshold
      inconsistency, NOT a road-class problem — every silent stop was on a MAJOR road. So
      `speakable_road_class` remains recorded-but-unused. It's now a question about CHOICE between two
      reachable stops (prefer the through-road one in `better()`?), not about reachability. Worth far
      less than it looked; decide on a real drive.
- [x] **2. Variety tiebreak REVIVED for the built world — 2026-07-30.** `kind` is a natural-feature
      allowlist and null for 85% of the corpus, so `better()`'s `a.kind !== prevKind` compared null to
      null and the rule silently no-opped everywhere except lakes and peaks. Now unblocked by the
      Wikidata types persisted for containment: **336 of the kindless narrated POIs carry one**, and they
      are exactly the needed vocabulary (house 43, hotel 33, casino 7, railway station 6, ski resort 6).
      New `@skipper/shared` `varietyKey()` maps them to coarse buckets; `DriveCandidate.varietyKey` is
      kept SEPARATE from `kind` (which still answers the physical trigger-radius question). ⚠ An UNKNOWN
      bucket now counts as DIFFERENT — treating two nulls as a repeat was the original bug.
- [x] **3. Treatment classifier — BUILT + APPLIED, then RE-ARCHITECTED 2026-07-29.** An adversarial pass
      on the first cut found the anchor model wrong: it hung treatment/title off whichever member had the
      longest clip, which elected the wrong subject in **4 of 4 districts** (a fraternity house spoke for
      a university campus) and would have made `narrations.poi_id` a false statement for every fused clip.
      Replaced with a `poi_clusters` table (migrations 0036/0037) + `narrations.cluster_id` + a
      `narrations_subject_xor` CHECK; `pickSubject` prefers a real district entity, else the member the
      group is named after, else NULL (honest for 22 of 38). 38 clusters / 219 memberships migrated with
      11 subjects reseated, no re-spend. Still INERT. See `docs/ideas/poi-legibility-layer.md` §5.
- [x] **3c. Treatment staleness — SOLVED by persisting the EVIDENCE (migration 0038).** `poi_clusters`
      now stores `highlights` + `dropped` (the model's actual lists). Fused generation reads those;
      `treatment` is a conclusion derived from `highlights.length` against the current clip band, so it
      cannot go stale. Also fixes a real bug: the lists were requested, reported, and thrown away, so
      phase 4 had nothing to generate FROM and would have had to re-classify — whose 95% stability could
      return a treatment disagreeing with the stored one. Evidence doesn't go stale; a conclusion drawn
      from a moving budget does. This also dissolves the "68 drops" decision: a dropped member stays a
      member and simply isn't named — a generation input, not an exclusion.
- [x] **3d. Rank by FACTS STRENGTH, not clip length (founder call).** Removes the `narrations` join
      entirely. Disagrees with the old rank on 7 of 10 groups and wins the ones that matter. ⚠ Two
      consequences worth keeping: grouping now belongs BEFORE generation
      (discover → enrich → group → generate) — the old order is the only reason Tahoe has 181 paid-for
      satellite clips that fused generation would discard; and the region-agnosticism test became
      possible (Yosemite: 837 POIs, 0 narrated, 292 with facts).
- [x] **3e. Region-agnosticism TESTED on Yosemite, $0.47** — 31 CLUSTER / **0 DISTRICT** / 5 SOLO with
      zero tuning. Zero districts is correct: a national park has no downtown. Subject resolution is
      BETTER there (22/31 vs Tahoe's 13/36). See `docs/ideas/poi-legibility-layer.md` §4d.
- [x] **3f. Containers can't seed — FIXED 2026-07-29.** Nothing already stored separated a container from
      a stop (`Sierra Nevada` and `Half Dome` share `kind='mountain'` with article lengths within 15%;
      `Carson Range` is a container with a SHORT article). The signal is EXTENT: new
      `backfill-poi-extent.ts` (free, WDQS P2046) fills `pois.area_km2`, and a POI ≥ 100 km² may be a
      group MEMBER but never a SEED. 11 barred corpus-wide (Sierra Nevada, Yosemite NP, Lake Tahoe,
      the wildernesses, plus `Diocese of Reno` and `Ferguson Fire` as bonus catches); settlements stay
      seedable. Verified: Half Dome now seeds its own group. ⚠ `Carson Range` claims no area so it is NOT
      caught — worst offenders, not all. See `docs/ideas/poi-legibility-layer.md` §4e.
- [x] **3g. A container is NOT a stop, and should not even be DISCOVERED — done 2026-07-30 (founder call).**
      Evidence for the discovery filter: of 59 containers in the DB, **43 were enriched AND narrated (49
      min of paid TTS)**, incl. an 86-second telling about the Diocese of Reno. Containment is now one
      tested predicate (`pipeline/containment.ts`) over THREE Wikidata signals — area ≥100 km², length
      ≥25 km, P31 type — used by `prune-corpus` (existing rows: flag, since audio exists), by
      `classify-treatments` (seed bar) and by `fetchWikidataBox` (future sweeps: reject before insert).
      Applied: 14 Tahoe, 12 Yosemite. `P31 = road` now supersedes the route-number regex and catches
      `Glacier Point Road`. ⚠ Two preview-caught corrections: `protected area` removed from the type set
      (Wikidata types TRAILHEADS that way — it flagged Eagle Falls trailhead), and `isSettlement` now
      overrides containment at any size (Carson City at 407 km² is a DISTRICT subject, not a container).
      See `docs/ideas/poi-legibility-layer.md` §4f.
- [x] **3h. Both regions re-applied + corpus PRUNED for real — 2026-07-30 (founder call).** Grouping now
      reflects the final rules: **67 clusters** (62 cluster / 5 district), 302 members, 36 with a real
      subject, and all 67 carry `highlights`. Then `prune-corpus --delete --apply` HARD-DELETED the flagged
      rows rather than leaving them flagged — 43 in Tahoe (39 narrations cascaded, 45 min of audio),
      12 in Yosemite. Corpus is now **1632 pois / 421 narrations**, `excluded_reason` count back to 0.
- [x] **3i. R2 swept — 930 orphans deleted 2026-07-30.** Only ~39 came from that day's row deletion; the
      other ~891 were accumulated regenerations and resynths (some poi dirs held 4+ clips). Re-sweep now
      reports **421 objects, 421 referenced, 0 orphans** — a clean 1:1 with `narrations`. Verified live
      afterwards: prod `/roam` serves 420 pins and 15/15 sampled clips stream.
      ⚠ TRAP when verifying presigned URLs: they are signed PER HTTP METHOD, so a HEAD against a
      `presignGet` URL returns 403 by design. Check with a ranged GET or you will diagnose a working
      corpus as entirely broken.
- [x] **Smaller-issues sweep — 2026-07-30.** (a) The credit-exhausted 403 now reports `granted` from the
      ledger, not the `FREE_DRIVE_CAP` env constant — a grant's amount is frozen at write, so a comped
      rider who spent 510 was told "you've used all 10". (b) Container-detection residue MEASURED and
      CLOSED: only 2 POIs look container-ish by name and escape all three signals, and both
      (`Tuolumne Meadows Wilderness Center`, `Eagle Lake (Desolation Wilderness)`) are genuinely good
      stops — zero false negatives. (f) The review gate was flagging 25 of 55 groups at <0.85 confidence,
      which is noise not a queue; it now flags the shape that actually flip-flopped across runs (≤2
      members AND <0.85).
- [ ] **4. Fused generation — IN BUILD. Step 1 of 7 DONE; the build order is §9 of the spec.**
      `docs/specs/fused-cluster-generation-spec.md`. Steps 1-3 spend nothing; **step 4 is the commitment
      point** (audio in R2) and needs an explicit founder go.
      ⚠ Two halves must ship together: generation, AND lifting the `pois` inner-join on every read path —
      without the second, phase 4 buys audio nobody can hear. Generate from `highlights`, never raw
      membership (Stateline is 9 members but 5 nameable). Grounding needs NO gate change:
      `buildGroundingWell` already takes `mergedFeatures`.
      **§4.2 SETTLED (founder 2026-07-30): a clustered member is NOT an active POI in either mode** —
      not a roam pin, not a drive candidate. Keeping them would leave a rider in downtown Reno with 46
      competing pins plus a fused one. Members retire only AFTER a listen — retiring good audio before
      hearing its replacement has no fallback.
      ✅ **DECIDED (founder): phase 4 is CLUSTER-ONLY.** A DISTRICT cannot be a point trigger (46 members
      over ~2 km leave a ~1 km worst-member distance under every candidate position), so it needs an AREA
      trigger — a new mode in @skipper/engine. Districts keep today's behaviour.
      ⚠ **SCOPE AND COST ARE HALF what this item used to claim** (measured against the live corpus,
      re-measured after the 2026-07-30 re-classify — spec §4.2): of the 62 clusters, only **31 are
      generatable** — 30 of the rest are the whole Yosemite side with ZERO enriched members (a story
      telling requires a fact sheet) and one is deferred by the geometry gate. So it is **31 fused
      clips (~$5-8) retiring 104 member clips**, 421 tellings → 348. Generating the Yosemite half
      first needs a separate founder-gated `enrich-pois` run.
      - [x] **Step 1 — staleness hash + the member-set resolver. BUILT 2026-07-30, no migration.**
            `@skipper/db/hash` (`clusterFactsHash`; the poi hashers moved there so the admin server can
            reach them — it cannot import studio), `@skipper/shared`'s `isNarratableStoryPoi`,
            `pipeline/cluster.ts`, `packages/db/test/hash.test.ts`. The hash covers the TELLABLE members
            as `poiId:factsHash` pairs PLUS `title`/`highlights`/`dropped` — see spec §6 for the four
            corrections to the originally-proposed formula, each of which was a paid-regeneration or a
            silent-immortality bug. Also guarded the real hazard all three review passes found: a ~$1
            `classify-treatments --apply` re-baseline cascade-DELETES every fused telling and orphans
            its audio, so it now refuses without `--force-regroup`.
      - [x] **Step 2 — trigger position + radius. BUILT 2026-07-30.** `clusterTrigger` in
            `@skipper/engine` + `DriveCandidate.triggerRadiusM`. ⚠ BOTH rules spec §4.1 proposed were
            wrong on the measurement: the SUBJECT never wins (it's a naming choice, and a district's
            Wikidata point is a label point, not a centre — Vikingsholm is the worst position in the
            corpus), and `worst + 250` would have put 24 of 30 above the speed lead, re-breaking what
            `ANCHORED_TRIGGER_RADIUS_M` was added to fix. As built (1-center, `max(250, enclosing)`):
            21 of 30 sit at the 250 m floor, max 516 m, and ZERO exceed the 600 m an un-anchored
            kindless POI already gets. See spec §4.1b.
      - [x] **Step 3 — read paths. BUILT 2026-07-30.** `apps/api/src/clusters.ts` + the `/roam` and
            drive-corpus unions. The lift was ADDITIVE, not a join change: fused tellings load on their
            own query (scoped to `cluster_id IS NOT NULL`, so it returns [] and the whole change is a
            runtime no-op until step 4). ⚠ The corpus + the frozen selection are keyed by SUBJECT now
            (`subjectId`/`subjectKind`), never a `poiId` holding a cluster id — that false statement is
            what `poi_clusters` exists to prevent; `selectionSubject` reads the legacy shape so the 3
            existing drives keep every stop. The WIRE did not change.
      - [x] **The naming channel — BUILT + VERIFIED 2026-07-30 ($0.83 across two takes).** The first
            fused telling named 2 of 4 DROPPED members and skipped 3 of 5 highlights: with everything
            equally nameable the model chose by FACT RICHNESS and opened on a dropped supper club's
            1930s dinner menu. `mergedFeatures` now takes a `background` flag and the fact sheet splits
            into "landmarks a driver would RECOGNISE — name each" vs "BACKGROUND ONLY — never the
            subject". Second take, same cluster: **5 of 5 highlights named, 0 of 4 dropped.**
            ⚠ Keyed off `dropped` not `highlights` — measured, `dropped` matches `pois.name` 68/69 and
            `highlights` 165/186, so the fuzzy match goes on the near-exact list and a miss fails SAFE
            (an unmatched member stays nameable). ⚠ Trade-off is real: naming all five nudged the take
            toward enumeration (diversity lint, advisory). "Work every one of them in" may be a notch
            too strong — a wording knob for the next pass.
      - [x] **Step 4 — FIRST CLIP GENERATED 2026-07-30 ($0.90).** Stateline (9 members, the density
            stress case): 2:21, every GATE dimension clean, STAGED, sent for a listen. The retake loop
            excised 2 ungrounded claims AND took diversity 0.00 → 1.00, so the list-feel resolved under
            `optimize()` without a prompt change. ⚠ **TAIL COLLAPSE unresolved across all 3 takes** —
            the closer is 6.3 dB below the body, shipped flagged for the human pass. Watch whether that
            is fused-specific (a summarising closer after a long body) or just this clip; needs an ear
            and more samples.
      - [x] **Step 4 COMPLETE — all 31 fused clips generated 2026-07-30 ($16.70, 59.8 min, all
            STAGED).** 31/31 shipped, 0 withheld. Verified: `poi_id` NULL on all 31, attribution
            non-empty on all 31, `facts_hash` stamped on all 31. Member clips untouched.
            ✅ **Grounding held at scale — 0 failures across 62 scores**, confirming the design's central
            bet (a fused well through `mergedFeatures` needs no gate change) on 31 clips, not an argument.
      - [ ] ⚠ **TAIL COLLAPSE IS FUSED-SPECIFIC — 11 of 31 (35%) vs ~2% on solo clips, and I called
            this wrong at n=1.** After the first clip collapsed I checked history (7 of 365 solo),
            concluded "pre-existing, don't tune", and proceeded. At n=31 that reverses: a 17× rate, and
            severity 4.2-14.4 dB vs solo's 3.3-4.6. Worst is `1960 Olympic Ski Stadium Site` at 14.4 dB
            — its last line should be near-inaudible. ⚠ The fix belongs in the NARRATION prompt (a fused
            telling ends on a summarising falling-intonation fragment, and all 3 retakes collapse
            identically because the SCRIPT determines it), NOT in `SKIPPER_TTS_STYLE_PROMPT` whose
            anti-fade clause is already maximal and ear-locked. Founder ear-test first — two clips sent.
      - [ ] **Diversity advisory failed 16 of 31 (52%).** The single-clip retake that took Stateline
            0.00 → 1.00 was not representative; naming five places pulls toward enumeration, the
            NAME-DENSITY tension §3.3 predicted. Never withheld a clip, but half a run is a signal.
      - [ ] **Yosemite's 30 clusters** — still un-generatable (zero enriched members); needs a
            founder-gated `enrich-pois --region yosemite` run first. `generate-cluster-narrations.ts` is
            complete: narrate → fail-closed gate with excision retakes → TTS → loudnorm → R2 → upsert
            on `narrations_cluster_uq` → eval record keyed to the cluster. **`--limit 1 --apply` is the
            cheap path to ONE real clip to listen to** (well under $1) before committing all 31
            (~$12-16). ⚠ A PREVIEW is not free either — it narrates and scores; only persistence is
            gated. ⚠ Cost was corrected UP: halving the original $10-15 along with the clip count was
            wrong, because per-clip cost RISES (a fused well is 9 sheets and the script runs to the
            180 s ceiling, not the 90 s story aim).
      - [ ] **Steps 5-7** — LISTEN, retire members, admin. ⚠ `isNull(pois.clusterId)` belongs in step 6,
            NOT earlier, or the 30 un-generatable clusters lose their member clips with nothing to
            replace them.
      - [x] **(a) `UNLV Arboretum` — EXCLUDED 2026-07-30.** Wikidata Q7865354 carries UNR's exact
            coordinates, so a released 71-second clip about a Las Vegas campus was firing in Reno — a
            LIVE bug, not a phase-4 one. ⚠ A class the grounding gate cannot see (facts right, PLACE
            wrong) and that NO free check can decide: P625, P131 and the Wikipedia article's own coords
            are all wrong the same way; only the prose is right. A triage detector now runs in
            `discover-pois` + `prune-corpus` (`pipeline/colocation.ts`) — it FLAGS, never excludes
            (13 collisions corpus-wide, 12 genuine). The decisive check needs to read the prose, so it
            belongs in the paid `enrich` step; NOT built. See ops-scripts-sop.md.
      - [x] **(b) The UNR campus split — FIXED + APPLIED 2026-07-30 (~$1.50).** The merge pass that
            fused Carson City now covers CLUSTERs too, and re-classifies whatever it fuses so the
            verdict names all members (it used to keep one half's `highlights`, which is exactly what
            fused generation writes from). ⚠ On the live run the merge fired THREE times, not the one
            predicted against the stored grouping — the UNR campus plus two district splits that recur
            on any fresh classify — and the re-classification immediately paid for itself: seeing all
            its members, `Reno's Historic Homes and Casinos` reconsidered CLUSTER → DISTRICT.
            Tahoe is now 37 groups; corpus-wide 67 (62 cluster / 5 district). Stateline's casino row
            moved DISTRICT → CLUSTER, agreeing at last with the spec's own §3.1 example.
            ⚠ `--apply` RE-RUNS the classification, so preview + apply is ~2× the quoted cost.
      - [x] **UNR's 903 m radius — DECIDED + GATED 2026-07-30.** Simulated through the real trigger
            engine it fired with a 92-second lead at city pace against 25 s for every other stop.
            `CLUSTER_MAX_TRIGGER_RADIUS_M = 600` (engine) + `clusterGenerationBlock` (studio) now defer
            an over-wide cluster with the districts. 600 is the floor an un-anchored kindless POI
            already gets, so a fused clip can never trigger looser than the loosest thing shipping; the
            corpus leaves a 387 m gap right there (…416, 516, then 903). Live: **31 generatable, 1
            deferred, 30 awaiting enrichment.**
      - [x] **Release path + eval plumbing — FIXED 2026-07-30.** ⚠ The region release stamped
            `narrations.poi_id IN (…)`, which a fused clip's NULL poi_id can NEVER match — all 31 clips
            would have been paid for and permanently STAGED, i.e. unhearable. Now stamps cluster
            subjects too. `eval_scores.cluster_id` added (migration 0041) + `ClipIdentity` is
            poi-XOR-cluster. ⚠ Known gap: `eval_scores_case_idx` is `(qid, dimension)` and a cluster has
            no qid, so fused clips don't join across runs for regression tracking.
      - [ ] **Still open for step 7 (neither blocks step 4):** `GET /admin/pois` shows every cluster
            member as `narrationStatus: 'none'`, so an operator can't tell "covered by a fused clip"
            from "never generated"; and there's no per-clip release for a fused telling.

- [ ] **5. `buildDrive` reads anchors; delete pick-one.** Orphans ~169 satellite clips —
      `sweep-orphans.ts` already handles that.

## When YOSEMITE ships: the metadata that goes stale (founder ask 2026-07-28)

Content is SERVER-SIDE, so a second region goes live with no app release. That is the whole problem:
the corpus changes underneath a listing that still says Tahoe-only, and nothing forces the two back
into agreement. Trigger this list the day Yosemite narrations are RELEASED (`released_at` non-null and
serving from `/roam`), not the day generation finishes.

⚠ Do NOT pre-announce Yosemite in ASC before it serves. Guideline 2.3.7 wants keywords that
"accurately describe the app", and §10's reviewer notes say in capitals that coverage is Lake Tahoe
ONLY — pre-announcing contradicts the document written to reassure the reviewer. Under-promising is
the safe direction; the reverse is what gets rejected.

**Instantly, no review (the only same-day lever):**
- [ ] **Promotional text.** Currently closes "Starting in Lake Tahoe." This is the one field editable
      without a version submission, which is exactly why geography lives here.

**Next version submission (all of these are version-scoped, so they ride one build):**
- [ ] ⚠ **Description — this becomes FACTUALLY FALSE, not merely dated.** `RIGHT NOW: LAKE TAHOE ONLY`
      and "the finished collection covers Lake Tahoe" both stop being true. Apple requires metadata be
      kept up to date, so this is an obligation rather than an improvement.
- [ ] ⚠ **§10 reviewer notes.** They tell the reviewer coverage is Tahoe only and give
      Tahoe City → South Lake Tahoe as the test drive. Leave them and the next reviewer is actively
      misled by our own instructions.
- [ ] **Keywords.** Add `Yosemite`. Currently 99/100, so something goes — `nearby` or `car` are the
      weakest. ⚠ Keep the subtitle/keywords geography coupling in mind (§5): between them they are the
      only indexed fields, so don't end up with no place name anywhere.
- [ ] **Screenshots.** The map frame is captioned "Starting in Lake Tahoe" and shows the Tahoe basin.
      Recapture per §9 (live GPS, never `?mode=sim` — it renders a SIMULATED badge).
- [ ] **App Preview.** The 28s video is an Emerald Bay postcard. Still honest, still fine; revisit only
      if Yosemite is the better hook.

Probably NO change needed: the **subtitle** is deliberately geography-free (`Scenic Drives & Local
History`), which is the entire reason it was written that way — it survives new regions untouched.

## Content + LLM-discovery marketing op — kick off during App Store review (founder ask 2026-07-24)

Dead-time play: App Store review is idle builder-time, and **distribution is the project's named
UNSOLVED existential question** — `docs/research/autio-content-moat.md` §"the honest hole" says it
outright ("acquisition is the thing still to actually solve"), and Detour "died beloved, no
distribution" (`docs/research/competitive-research.md`). Content compounds while we wait, so start now.

⚠ **This must NOT become "rebuild Autio's SEO factory."** That same doc is a founder-blessed DON'T on
exactly that: their comparison/listicle machine is a **trap** ("in a comparison table, breadth wins and
charm has no cell" — 25k stories > our ~19 stops "by construction"), and out-publishing it plays FOR
their niche-subscription plateau, not past it. CLAUDE.md's charm-not-scale + the doc's "refuse the
category" say don't fight on the breadth grid. So "match/rival Shaka + Autio" = match their *presence
and polish*, NEVER their breadth-comparison content.

**The doctrine-safe wedge (and the real point of the founder ask): LLM answer-discovery (GEO/AEO).**
When a rider asks ChatGPT/Gemini/Claude "what's a good audio tour for driving around Lake Tahoe?", the
model SYNTHESIZES an entity-grounded answer — it is NOT the breadth grid where 25k>19 wins. A
**region-deep character companion, a category of one**, can be surfaced there on merit, because the
signal is entity presence + citable structured facts — exactly the asset we already own and they don't:
- Our corpus is **Wikidata/Wikipedia-grounded** (`pois` deduped by QID, `pois.fact_sheet`, `narrations`)
  — real, sourced, structured facts, with **CC BY-SA attribution already frozen** per the CLAUDE.md
  invariant. That is the raw material LLMs cite; Autio's celebrity-voice catalog is opaque audio a model
  can't read.
- So the honest, uncopyable positioning ("category of one," region-honest, one continuous character —
  `autio-content-moat.md` §"what this steers") IS also the GEO-optimal one. For once the strategy and
  the discovery channel point the same way.

FIRST STEP is RESEARCH, not building (founder doctrine: validate ROI + pre-mortem before infra;
brainstorms land in `docs/ideas/` first — the idea→spec cadence). GEO best-practice moves fast and my
training is stale — ground it in current sources and cite.

- [ ] **Strategy pass → `docs/ideas/llm-discovery-marketing.md`.** Research current GEO/AEO tactics
      (schema.org structured data, entity SEO, the `llms.txt` proposal's real adoption, WHICH sources
      the big models actually retrieve/cite, Reddit/forum presence), pre-mortem, ROI. Reconcile with
      `autio-content-moat.md` (refuse-the-category) so we build the answer-discovery wedge, NOT a
      comparison factory. Founder greenlight promotes it to a spec + backlog work.

Concrete candidates the research pass should size (do NOT build until greenlit — several touch the live
corpus and want a design/ROI call):
- **AI-crawler posture in `apps/site/public/robots.txt`.** Today it's blanket `Allow: /` (so GPTBot /
  Google-Extended / ClaudeBot / PerplexityBot are already permitted) — since we WANT discovery, keep it
  open; consider naming them explicitly + confirm the sitemap covers any new content pages.
- **Structured data on skipper.fm** (JSON-LD: `TouristAttraction` / `TouristTrip` / `AudioObject`) so the
  entity "Skipper — Lake Tahoe driving companion" is machine-legible. `apps/site` is static Astro.
- **Programmatic region/POI content pages built FROM the corpus we already own** — a "Lake Tahoe driving
  audio tour" hub + per-POI story pages (carrying the required CC BY-SA credit). The corpus→web lever no
  competitor can match; also the biggest build, so it wants the ROI pass first.
- **Off-domain presence in the sources LLMs cite** (Reddit, r/roadtrip, authoritative Tahoe guides) — the
  doc is explicit our own domain ≠ discovery; models weight third-party mentions.

Refs: `docs/research/autio-content-moat.md` (refuse-the-category + the unsolved-acquisition hole),
`docs/research/competitive-research.md` (Detour distribution post-mortem), `apps/site` (static Astro on
skipper.fm; `astro.config.mjs` sitemap + `public/robots.txt`), the Wikidata-grounded corpus
(`pois`/`narrations`/`fact_sheet` + the CC BY-SA attribution invariant in CLAUDE.md).

## PostHog telemetry — Stage 2 (native crashes) + Stage 3 (session replay)

Stage 1 is SHIPPED (2026-07-17): `apps/mobile/src/lib/analytics.tsx` — the pure-JS PostHog base SDK
(`posthog-react-native@4.57.0`) wired at the root layout via `AnalyticsProvider`, giving product
analytics + **JS-level** crash autocapture (uncaught exceptions + unhandled rejections) + manual
expo-router screen tracking + the root `ErrorBoundary` reporting render crashes through the module
singleton `captureError`. Env: `EXPO_PUBLIC_POSTHOG_KEY`/`_HOST` (US host), in gitignored
`apps/mobile/.env` + all three `eas.json` profiles + the `.env.example` catalog. Verified: mobile
`bun run check` green + `expo export` bundles clean. This closes the analytics gap and a large share
of RN crashes — but NOT the app-killed / native-fault case.

**Stage 2 — native crash capture (the "died in the car" case).** CODE + EAS config SHIPPED
(2026-07-17); only the founder-owned native rebuild + verify remain.

Done: `@posthog/react-native-plugin@2.2.3` installed; `errorTracking.autocapture.nativeCrashes: true`
in `analytics.tsx`; the `posthog-react-native/expo` config plugin (`uploadNativeSymbols: true`) in
`app.json` (it AUTO-sets iOS `ENABLE_USER_SCRIPT_SANDBOXING=NO` — no manual Xcode step); `metro.config.js`
wrapped with `getPostHogExpoConfig`. Build-time symbol upload authenticates via EAS env vars
`POSTHOG_CLI_API_KEY` (secret personal key) + `POSTHOG_CLI_PROJECT_ID` (`517151`), set on the
`@manoa-inc/skipper` EAS project across production/preview/development — NOT in any committed file (the
public `phc_` runtime key stays in eas.json; the `phx_` upload key is EAS-secret-only). Verified: mobile
`bun run check` green + `expo export` bundles clean + `expo config` introspect loads the plugin.

Remaining (founder-owned):
- [x] ~~Confirm the Skipper PostHog project has exception autocapture on~~ — verified via API
      2026-07-17: `autocapture_exceptions_opt_in = true` on project 517151 (PostHog's default).
- [ ] **Native rebuild** — `expo prebuild --clean` + a fresh EAS/TestFlight build (a JS-only OTA won't
      link the native module or run the upload build phase).
- [ ] **Verify on a RELEASE build** (not the `expo run:ios` dev client, which skips the upload phase):
      force a native crash, confirm a SYMBOLICATED report lands in the Skipper project.
      **⚠ Verification landmines — each one silently produces a false "it's broken":**
      1. **Detach the debugger.** A native crash reporter installs a signal/Mach-exception handler;
         an attached debugger (Xcode, or a dev client) intercepts the fault FIRST, so nothing is ever
         written. Launch the TestFlight build standalone, from the phone.
      2. **Relaunch after crashing.** The report is written to disk during the fault and uploaded on
         the NEXT app launch — the dashboard stays empty until you reopen the app. Don't call it a
         failure at step 1.
      3. **Force a REAL native fault, not a JS `throw`.** A JS throw is caught by the JS autocapture
         path (already shipped in Stage 1) and proves nothing about the native module.
      4. **Confirm BOTH upload phases in the EAS build log** (dSYM/native symbols AND the Hermes
         source map) before you even install — a missing phase means the report lands unsymbolicated
         and the crash looks like it never arrived.
      5. **Do a plain launch smoke test on iOS 26 / arm64e first.** ⚠ UNVERIFIED — this came from a
         research pass citing a PostHog issue (reportedly #3562) that I could not confirm against
         source; treat it as "spend 30s ruling out a launch crash," not as established fact.
- [ ] EAS Update OTA caveat: native symbols are fixed at build time, so after each `eas update` run
      `posthog-cli hermes upload --directory dist`. Wire into a release script only if OTA channels are used.

**Stage 3 — session replay (opt-in, deferred).** A GPS/audio app: native map/camera/audio views are
ALWAYS masked on iOS by default, so it's privacy-safe, but it adds a native module + a recording
decision.
- [ ] `npx expo install posthog-react-native-session-replay` (note: consolidating into
      `@posthog/react-native-plugin` — follow the current install doc), set `enableSessionReplay: true`
      + keep `sessionReplayConfig` masking at defaults (all ON). Enable replay in project settings.
      ⚠ Do NOT enable on Android without re-checking the known new-arch replay crash ("Cannot get a
      dirty matrix!").

Refs: `apps/mobile/src/lib/analytics.tsx`, `apps/mobile/app/_layout.tsx`, `apps/mobile/app.config.ts`
(where the config plugin goes), `apps/mobile/metro.config.js` (the Metro wrap), `apps/mobile/eas.json`.

## Location: When-In-Use → background updates (deferred half of permission priming; NO "Always")

The pre-permission **explainer** shipped 2026-06-13 in front of the *When-In-Use* prompt
(`docs/decisions/location-permission-priming.md`). The **background-updates** escalation — screen-off /
phone-in-pocket triggering (foreground `watchPositionAsync` dies on lock, so the drive holds the screen
awake via `expo-keep-awake`; if it ever locks, audio plays on but GPS triggering silently stops) — is now
a **build-ready spec: `docs/specs/background-location-spec.md`**.

- [ ] Build it — but ONLY after a real-device drive shows foreground + keep-awake triggering is
      insufficient locked/pocketed (the founder's empirical gate). ⚠ This path is **When-In-Use ONLY, NOT
      "Always"**: a source-level read of the installed expo-location proved `startLocationUpdatesAsync` needs
      only foreground permission (expo PR #33617), so the review scope is the standard nav-app one, not the
      heightened Always scope. Work: transport re-architecture (foreground `watchPositionAsync` → a
      `startLocationUpdatesAsync` TaskManager task; adds `expo-task-manager`), flip `isIosBackgroundLocationEnabled`
      (KEEP the Always strings false; never call `requestBackgroundPermissionsAsync`), a small copy tweak,
      review notes, and a native rebuild. Full checklist + source proof + gotchas in the spec.

## Roam build pass 2 — LOCKED by the founder 2026-06-11 (the "companion grows up" pass)

> ⚠ **The chattiness axis (quiet/normal/talkative) was CUT** (2026-06-20 — too coarse, not useful in
> practice; `useRoam.ts`, MEMORY "Roam chattiness toggles"). Don't build anything that assumes it
> (e.g. suppressing a form of clip "on quiet") — there's ONE fixed cadence now. Cadence variety, if ever wanted,
> returns as auto-adaptation, never a user notch.

Two items locked from the 2026-06-11 brainstorm (full capture: `docs/ideas/free-roam-mode.md`
§Alpha learnings). Order within the pass is free; both are founder-facing on his daily drive.

- ~~**Waves: narrate the scenic tier.**~~ **CUT 2026-07-26 (founder) — backed out of the tree before
      the v2 release.** Built + smoke-tested 2026-07-24, never run at scale: zero `form='wave'` rows were
      ever written and no audio was ever synthesized, so the backout was code-only (no migration, no data,
      no orphaned R2). The `'wave'` enum value STAYS in `narrationForm`/`narration_form` — it predates the
      build as reserved vocabulary (like `bside`) and the label/mapping code that handles it is untouched.
      Rationale, what was removed, and the two reusable traps the build surfaced (structural monotony in
      low-input forms; the grounding gate cannot catch a claim derived from the place's own NAME) are in
      `docs/decisions/cut-wave-form.md`. Re-read that before rebuilding any name+kind-only form.
- [ ] **The sonic cue.** ~1s entry motif before every encounter (the duck gets a reason; the
      startle dies) + a soft exit/resolve note as the duck releases. Client-side bundled assets
      (`apps/mobile`), played around the clip in `useRoam`. Sound design taste-gate: founder ear
      on the motif BEFORE wiring (charm shortlist already names sound design).
      ⚠ **Name the asset/hook a "sting," never "motif"/`RoamMotif`** — that name is TAKEN by the
      VISUAL idle car component (`apps/mobile/app/roam.tsx:67`, referenced from `RoamMap.tsx` +
      `useRoam.ts`); reusing it for audio makes both unsearchable.

## TTS audio QA: clip loudness normalization

The mechanism shipped 2026-06-11: every ship path (`generate-narrations`, `resynth-narration`)
re-synths once on a ≥3 dB tail-collapse drop (the "mumble"), then linear-loudnorms the winning take
to the **master spec** (−14 LUFS / −1.0 dBTP — `AUDIO_LOUDNESS` in `@skipper/shared`; studio's
`LOUDNORM_*` derive from it) via `pipeline/tail.ts` + `pipeline/loudnorm.ts`. Kills the clip-to-clip
spread + the quiet-vs-Spotify gap. The drive-music rotation is now mastered to the SAME spec
(2026-06-19), so voice + music match. Spec + history: `docs/decisions/audio-loudness-spec.md`.

REMAINING — **founder on-device A/B vs Spotify** of the −14 / −1.0 level (narration + music together),
before the first paid full regen. If it still reads low, nudge `AUDIO_LOUDNESS.integratedLufs`
(−13/−12) or the TP ceiling further toward 0 — one edit, re-master both surfaces.

Refs: `pipeline/loudnorm.ts`, `pipeline/tts.ts`, `pipeline/tail.ts`, `models.ts` (LOUDNORM_*),
`packages/shared/src/audio.ts`, `docs/decisions/audio-loudness-spec.md`,
`docs/decisions/audio-compression-spike.md`.

## TTS delivery: differentiate the style prompt by narration FORM — DEFERRED 2026-06-19

The per-REGISTER half of this already shipped: `ttsStyleFor(baseStyle, register)` (`models.ts`) appends
a landscape/story/town/civic suffix onto the shared base (called at `generate-narrations.ts`), so the
one host already modulates his read by place type. What's still open is differentiating by narration
**form**: `SKIPPER_TTS_STYLE_PROMPT` is one static directive and the corpus is generated `form:'story'`
today, so the non-story forms have no tailored read. The win when they land: extend the suffix by form —
scenic = "slow a touch, leave air, wonder not performance"; break = "quick light aside, no ceremony";
wave = "brief passing call-out" — keeping the universal **base** (persona + the load-bearing
**anti-fade** clause) and appending a per-form suffix. One-line swap at the call site.

**Why DEFERRED (founder, 2026-06-19):** the non-story forms have **no output to act on and nothing to
ear-test** until they ship. Still true across the board as of 2026-07-26: `wave` was built and then CUT
(`docs/decisions/cut-wave-form.md`) and `break` (`detours`) is stubbed, so no non-story form emits audio
to judge. The single Skipper story read stands until one does,
and is only touched on a specific founder ear-complaint (never re-tuned blind — see the `models.ts`
warning). NOTE: there is NO per-joke "notch" axis here — the joke notch was CUT
(`docs/decisions/cut-joke-notch.md`); delivery variety returns later as different NARRATORS, not a notch.

## In-app narration volume trim — DEFERRED pending the −14 ear-gate (founder feedback 2026-06-11)

Founder ask: an in-app control to make NARRATION slightly louder/quieter, INDEPENDENT of device
volume and other apps. **Decision 2026-06-11: don't build it yet** — nail the global −14 LUFS target
at the ear-gate first and see whether a per-listener trim is even needed once levels are consistent.

Design conclusions if/when it IS built (so this isn't re-litigated):
- Mechanism is simple + standard: expo-audio's narration `AudioPlayer.volume` (0..1) is a per-player
  gain that touches NOTHING else (device volume, the rider's music, the `driveMusic.ts` bed all
  stay put). Persist a notch setting (sim-mode pattern) → set `player.volume` in `useDrive`+`useRoam`.
- **Lean toward ATTENUATION-ONLY** (default = unity = the matched −14 level; notches only go softer,
  e.g. a sleeping passenger). It has no encode coupling and doesn't fight loudness normalization —
  streaming (Spotify/Apple/YouTube) deliberately normalizes-to-target and DROPPED user loudness
  boosts, so a "push above −14" control works against the −14 work we just did. "Louder overall" is
  then a global-target call at the ear-gate, not a per-listener boost.
- The bidirectional version (Softer/Normal/Louder) is a WORKAROUND: `player.volume` clamps at 1.0
  (attenuates, can't amplify past source), so "Louder" needs clips encoded ~1.5 dB hotter than the
  playback default — which couples the notch values to the loudnorm target. Only worth it if a real
  "skipper a touch louder than my quiet-music device volume" need shows up. True >unity boost would
  need a real gain node (AVAudioEngine / Web Audio / react-native-audio-api) — overkill for v1.
Refs: `useDrive.ts` / `useRoam.ts` (the narration player), `models.ts` (LOUDNORM_* target).

## Drive music bed — CONFIRM-ON-DEVICE it plays under V2 drives (static trace: it should)

Founder ask 2026-06-19: "reintroduce / does the music play in V2 drives?" **Static investigation
(2026-06-19) found the bed is fully wired and SHOULD play — nothing was removed in the V2 reshape.**
Evidence chain:
- `useDriveMusic` (`apps/mobile/src/lib/driveMusic.ts`; 17 bundled tracks under `assets/audio/`,
  credits in `licenses.ts`) is live-wired into `useDrive.ts` (~L891), which is exactly what the V2
  player `app/drives/[id]/play.tsx` mounts (`useDrive(id, { mode: driveMode })`). No feature flag.
- `useAudioPlaylist` (+ `.play/.pause/.next/.volume`) is a REAL export in the installed expo-audio
  **56.0.12** — the API the hook depends on exists.
- The gating opens audible windows in EVERY mode: between stops `activeSeq` goes null while
  `driving` stays true (`onClipDone`→`setActiveSeq(null)`+`pump()` in sim/live; explicit `drive`/
  `rest` segments in preview), so `active: driving && !done && !paused && activeSeq === null` is true
  between stops. The earlier "the `activeSeq` gating may be the bug" guess was DISPROVEN.
- Ruled out the main two-player session suspect: the narration player's `setActiveForLockScreen(false)`
  between stops only calls `MediaController.setActivePlayer(nil)` (clears the lock-screen Now-Playing
  owner) — it does NOT deactivate the AVAudioSession (verified in expo-audio's `AudioPlayer.swift` /
  `AudioModule.swift`), so it can't silence the separate music `AVQueuePlayer`.

Could NOT do a live listen this pass: Metro (8081) was down, the app wasn't on the booted sim, and
sim audio isn't capturable anyway. So one box remains — a human ear (or instrumented proof):

- [ ] **Confirm by listening.** Start a sim drive (Settings → dev sim toggle, or `__DEV__` defaults to
      'sim') and confirm the bed fades in between stops and ducks to silence under each narration. If
      it's SILENT, the only residual static-unprovable risk is whether the two simultaneous expo-audio
      objects (narration `AVPlayer` + music `AVQueuePlayer`) actually MIX on-device vs one stealing
      focus — iOS's session model says they mix within one app, but it's the one thing a trace can't
      guarantee. (Definitive non-ear proof if wanted: temporarily log `useAudioPlaylistStatus(playlist)
      .playing` in the hook and watch it flip true between stops.)

(The drive-music **level** task is DONE 2026-06-19 — the 17 tracks were re-mastered to the −14 / −1.0
master spec; only the *audible-under-V2-drives* confirm above remains. See `audio-loudness-spec.md`.)

Refs: `apps/mobile/src/lib/driveMusic.ts` (`useDriveMusic` + the `TRACKS` rotation),
`apps/mobile/src/lib/useDrive.ts` (~L888 the soundtrack effect; `onClipDone`/`pump` at ~L397-429),
`apps/mobile/app/drives/[id]/play.tsx` (the V2 player + `driveMode`).

## Offline downloads: full re-pull only (no per-clip diff)

DONE: a re-cut clip (a `resynth-narration` or a regen) is detectable + recoverable on-device — each
stop carries a `revisedAt` token, the offline manifest embeds it, and the drive screen compares a
fresh fetch (`isDownloadStale`) → a "Fresh cut ready" chip + a "Pull the fresh copy" ⋯ action (never
forced; offline play keeps the saved bytes until the rider re-pulls).

REMAINING (post-MVP): the re-pull re-downloads EVERY clip, not just the changed ones. A per-clip diff
(download only the stale clips, merge into the existing manifest) — only matters once drives are large
or strangers hold many offline.

Refs: `apps/mobile/src/lib/offline.ts`, `apps/mobile/app/drives/[id]/index.tsx`,
`packages/shared/src/schemas.ts` (`driveManifest`/`revisedAt`), `apps/api/src/index.ts`.

## Upstream-contribution drafts for the active poi_overrides (agent drafts, human submits)

The fact-overrides loop's "contribute back" half is designed but UNBUILT: we correct upstream
source errors locally (`poi_overrides`), and the right thing is to also fix the SOURCE. Posture
(from the decision doc): **agent drafts, human submits** — Wikipedia's bot policy (WP:BOT) + COI
norms rule out autonomous editing, so an agent reads the `not_filed` rows (each already carries the
correction + an authoritative `source_url`) and drafts the talk-page post / edit; a human reviews
and files it, then sets `upstream_status` → `filed` (+ `upstream_url`).

Three ACTIVE fact_edits are draftable (all `upstream_status = not_filed`):
- **Lennart Palme** — Vikingsholm's architect (Emerald Bay State Park, wikipedia `1985884`); the
  article says "Leonard." Source: vikingsholm.com + Wikipedia's own Vikingsholm article.
- **Pope Estate builder/decade** (wikipedia `39007559`) — the article credits Lloyd Tevis / 1880s;
  correct is George Tallant (Crocker Bank) 1894, with the Tevis family buying it in 1899. Source:
  taylortallac.org history.
- **Chambers Lodge 1863** (wikipedia `32308786`) — the article says "first established in 1854";
  John McKinney established Hunter's Retreat at the site in 1863. Source: donsnotes.com + others.

NOT this list: the Tahoe Keys row is RETIRED (`active = false`, 2026-06-10) — Wikipedia already
removed the dated construction sentence, so there's nothing left to file.

- [ ] Draft a per-row talk-page correction (claim → correction → authoritative source, in
      Wikipedia's neutral register) for the 3 active rows; surface for human review + filing.

Refs: `docs/decisions/fact-overrides-and-veracity.md` ("Contribute back" + the discipline line),
the `poi_overrides` table rows (reasons + source_urls; curated via the admin console),
`poi_overrides.upstream_status` / `upstream_url` (the workflow columns).

## Autio competitive borrows (small in-car/UX wins)

From a 2026-06-10 teardown of Autio (formerly HearHere — the closest real-world comp:
curated, celebrity-narrated, GPS-triggered road-trip audio; 4.8★, ~70% renewal). Their
ceiling is coverage gaps + multi-narrator inconsistency — both things our generation +
single-Charon model already answer, so the moat (persona continuity, in-car quality) is NOT
a feature to copy. This borrow is small and serves that moat. NOT borrowing:
subscription-first pricing, celebrity narrator roster, national free-roam pin-map,
over-broad trigger radius (all anti-charm or anti-doctrine).

- [ ] **Pause+resume music in roam — DEVICE-VERIFY (built 2026-06-11).** Founder feedback: BOTH
      players pause+resume the rider's audio, never duck. The TOUR player was already `doNotMix`
      (its own bed fades to silence under narration), so this was a ROAM-only change, now IN CODE
      (`useRoam.ts`): opens `mixWithOthers` (rider's audio untouched through the quiet), takes
      exclusive `doNotMix` only on the sawFresh edge (real audio), hands focus back (`mixWithOthers`)
      on clip-end / hold / teardown. Taking focus on sawFresh (not clip-load) means a silent
      pre-buffer / dead-zone skip never strands the rider's music paused. ⚠ REMAINING: the RESUME is
      device-only — expo-audio has no session-deactivate, so we rely on iOS resuming Spotify/podcasts
      when we flip back to `mixWithOthers` (grounded in SDK 56 docs, but the actual resume is
      unverified). Run runbook §6 (resume after a 60s encounter, re-pause on the next, dead-zone skip
      never interrupts) before relying on it. Refs: `useRoam.ts`, `docs/guides/device-verification-runbook.md` §6.

Validated-already (no action): our anonymous couch preview = Autio's
tap-a-pin preview; the M3 notch/interests-as-setting = their interest-ordered queue.
