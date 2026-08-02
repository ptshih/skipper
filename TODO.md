# TODO — engineering backlog

> ⚠ **1.1 IS MID-BUILD AND IT DELETES ROAM.** The build truth is
> [docs/designs/drives-first-1-1.md](docs/designs/drives-first-1-1.md) (43 decisions, 16 invariants)
> with verified file:line coordinates in
> [docs/designs/drives-first-1-1-build-notes.md](docs/designs/drives-first-1-1-build-notes.md).
> Items below that assume ROAM, the client capability channel, or per-drive-only offline are
> superseded by that spec — it wins. Roam-specific sections were deleted on 2026-07-31 (git is the
> archive); anything still here mentioning roam is either historical record of shipped work or an
> item whose value survives the mode.

Carry-forward **engineering** items (the near-term layer of the truth system — see
`docs/README.md`; product ideas live in `docs/designs/`, build-ready designs in `docs/designs/`).
Each item has enough context to action without re-deriving the reasoning. **Delete items
when done** — git history is the archive.

## Mobile technical diligence (2026-08-02) — validated against Expo's current docs

A read of `apps/mobile` against external best practice. **Version currency is a genuine asset and
needs no work**: SDK 57 is the current release (2026-06-30), RN 0.86, React 19.2 — the app is ON the
latest, not two SDKs behind. The gaps are all in the ENFORCEMENT layer, not the code.

✅ DONE 2026-08-02: ESLint (`eslint-config-expo`) wired into mobile `check` (`c1e21db`) and its first
findings fixed (`576e031`). See `apps/mobile/CLAUDE.md` for the ESLint-9 pin and the suppressions rule.

- [x] ~~**NEXT: switch `react-native-maps` → `expo-maps`**~~ — **REJECTED 2026-08-02 after reading
      expo-maps' actual API against what `DriveMap.tsx` does. Do NOT re-propose without re-checking
      the three blockers below; they are capability gaps, not effort.** I recommended this earlier the
      same day on the strength of "react-native-maps is fragile + Apple Maps is arguably better for a
      driving app", having checked that expo-maps EXISTS and is Expo-maintained but NOT that it can
      express this map. It cannot, today:
      1. **Custom React marker views are not supported — image icons only.** Our puck is a `<Marker>`
         wrapping a halo, a `rotate(${heading}deg)` wedge and a dot; stop markers are styled views
         keyed to remount on passed/active/upcoming. A rotating heading wedge cannot be an image icon
         at GPS rates without pre-rendering a sprite per heading.
      2. **`setCameraPosition()` animation duration is unsupported on iOS.** `DriveMap` calls
         `animateCamera(…, { duration: 500 })` throttled to 1/sec. Losing the tween turns camera
         follow into a hard jump-cut every second *while the rider is driving* — a regression exactly
         where the product is least forgiving.
      3. **It is ALPHA** — Expo's own words: "currently in alpha and will frequently experience
         breaking changes." Trading a stable-if-crusty dependency for an alpha one on the screen
         riders stare at is the wrong direction, whatever the API looked like.
      Also lost: `mapStyle.ts`'s 68-line dusk tint. Custom JSON styling is `GoogleMapsMapStyleOptions`
      — Android only; AppleMaps gets `colorScheme` light/dark and `mapType`, nothing more.
      ⚠ **What WOULD reopen it**, so the re-check is cheap rather than a re-derivation: expo-maps
      leaving alpha, AND either custom marker views or (at minimum) an animated iOS camera landing.
      The prize is unchanged and still worth wanting — dropping `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`, its
      billing surface, and `app.config.ts`'s whole `react-native-maps` plugin block.
      ⚠ **The underlying concern is still real and unaddressed** — see the next item.
      ⚠ **AND the premise I built it on was wrong.** I called `react-native-maps@1.27.2` "the only
      exact-pinned dependency, which reads like someone already got burned". Both halves are false:
      `react` and `react-native` are exact too, and Expo's own SDK 57 `bundledNativeModules.json`
      specifies `react-native-maps: 1.27.2` — **exact, with no tilde, where `react-native-screens` and
      `react-native-safe-area-context` get `~`**. The pin is `expo install`'s output verbatim, it has
      never been bumped (one commit, `dda5dc9`, the original map feature), and `expo-doctor` does not
      flag it. **Loosening it would be the regression**, not the fix: it would admit unvalidated
      releases of the most fragile native dep in the app and desync us from what doctor validates
      against. Documented at its one home, `apps/mobile/CLAUDE.md`, 2026-08-02.
- [ ] **Prove `react-native-maps` renders correctly on SDK 57, on a device.** The remaining reason to
      look: there is an open Expo issue for this combination on iOS with Google Maps
      (expo/expo#43288) — but that issue is **SDK 55**, and we are on 57, so the risk may be entirely
      theoretical. This is a ten-minute device check, not a migration: open a drive, confirm the tinted
      basemap, the stop pins, the puck and camera-follow all render. If it works, write that down
      (with the date + SDK) and close the question. If it does NOT, the decision reopens — and the
      fallback already exists in code: no Google key → Apple Maps, and List mode is the
      offline/accessibility-complete equivalent.
- [ ] **`eslint-suppressions.json` — 13 left across 6 files, and ALL 13 ARE TRIAGED AND BENIGN.**
      47 → 25 → 13 over `b7e6614` and `dccabb2`. **Nothing here is a bug**; each remaining report is a
      legitimate instance of a category the rule flags, which is the useful thing to know before
      anyone treats the file as a pile of latent defects. Read this before spending time on it:
      - **8 `set-state-in-effect`** — every one is an async load resolving (`void load()`), an
        event-driven reset (a new clip clears the scrubber's drag state; a live drive clears the GPS
        "searching" flag), a reconnect handler, or a form field seeded from the session. None loops.
      - **5 `refs`** — the Scrubber's lazily-built `PanResponder` read back in JSX (3), plus two refs
        read inside a `map`/`forEach` during render.
      ⚠ **The only mechanical fix left is the Scrubber's PanResponder**, which could become a lazy
      `useState` initialiser like the ones already converted. It is gesture code and cannot be
      typechecked into confidence — do it WITH a device pass, not before one.
      What was cleared and how, so nobody redoes the analysis: 22 by moving
      `useRef(new Animated.Value(x)).current` → RN's `useAnimatedValue`; 4 by moving two lazy-init refs
      to lazy `useState` initialisers; 8 by per-site `eslint-disable` carrying the reason at the code
      (the mirror-of-state refs, and expo-audio handle mutation in driveMusic).
      ⚠ `eslint-disable-next-line` means literally the NEXT LINE — a directive followed by a
      continuation comment disables nothing, silently. Cost me eight of them before the error count
      failed to move.
      Also 5 warnings left deliberately unfixed (4 × missing `preview` dep, 1 × `anchorNames` useMemo)
      — all render-churn judgement calls in the planner and drive-detail screens.
      ⚠ `b7e6614` is NOT visually verified (animation call sites, semantically identical swap) — worth
      a glance at typing dots, skeletons and the stop-row stamp next time the app is open.
- [x] ~~7 patch-version drifts against SDK 57~~ — **DONE 2026-08-02 (`44642c6`)** via
      `expo install --fix` (not `bun update`, so each version is the one `bundledNativeModules`
      specifies). Verified by `expo export` producing a real iOS bundle, not by typecheck. ⚠ **A native
      rebuild is still owed before this ships** — `ios/`/`android/` are gitignored prebuild output so
      nothing in-repo is inconsistent, but the installed pods match 0.86.0 until someone runs prebuild.
      ⚠ Doctor still reports "node_modules may be corrupted / multiple copies": known FALSE positive
      against bun's isolated linker (see `apps/mobile/CLAUDE.md`) — never "fix" it by forcing hoisted.
- [ ] **There is no CI.** No `.github/workflows` anywhere, and `cloudbuild.yaml` is build → push →
      deploy with NO test step — so the entire quality bar is "an agent remembered to run
      `bun run check`", in a repo where several agents share one working tree. Want: one workflow on
      push/PR running root `bun run check` + `bun --filter @skipper/mobile check`. ~30 lines. It can
      land before the first push and starts paying the moment one happens. **This was finding #1 of the
      diligence pass** — ESLint went first only because it catches bugs the same afternoon.
- [x] ~~The four hooks that own the risky behaviour have zero coverage~~ — **PREVIEW HALF DONE
      2026-08-02.** `src/lib/preview-util.ts` (`0531085`) now owns the decisions both preview players
      share, with 14 tests; extracting them proved the two siblings had already drifted, and `ffac245`
      fixed the three defects that found in `useStopPreview` (no session hand-back when a clip ran out
      → the rider's music stayed dead; none on a failed play; and NO reader for async failure at all,
      so an expired presign left a row lit "now playing" in silence forever).
- [ ] **Still uncovered: `useDrive` and `useLocationPriming`.** `useDrive` is the big one — the
      fire-queue, the two watchdogs and the trigger→play→handback loop. Same approach: move decisions
      into pure modules (`@skipper/engine`'s `player.ts` is the established home for what BOTH real
      players share; `preview-util.ts` is the pattern for what does not). Expo's documented setup is
      jest-expo + `@testing-library/react-native` (`react-test-renderer` is deprecated, no React 19+)
      — ⚠ still prefer extraction FIRST and only add a second test runner if it proves insufficient.
- [ ] **React Compiler — deliberately NOT yet.** Available via `experiments.reactCompiler` with Babel
      auto-configured on SDK 54+, still experimental and off by default. This codebase would benefit
      unusually much (it is dense with hand-rolled `useCallback`/`useMemo`/ref memoization). But it
      REQUIRES strict adherence to the Rules of React — which is precisely what the 47 suppressed
      errors above say is not true today. Do it after the backlog and after CI, or not at all.

## ⚠ REGRESSION I SHIPPED: the 2026-07-30 regeneration raised tail collapse 2% → 21%

**72 released solo clips were regenerated** (2026-07-30, ~$20) to pick up three prompt fixes — the
`"here's the …"` ban, the `"the card"` leak, and SHARED-fact marking. All three worked. But the same
run raised TAIL COLLAPSE by an order of magnitude, and the clips are LIVE.

**Measured, on the SAME 72 places** (so it is not a property of the places): earlier runs flagged
**2 of 125 tts rows (2%)**; this regeneration flagged **15 of 72 (21%)**. 8 of the 15 were "structural"
— a fresh retake re-collapsed identically, so `tail.ts` stopped retrying and shipped the best take
flagged for a human pass.

⚠ **NOT the shared-fact marker**, which was the obvious suspect: clips that got a `[SHARED]` note
collapsed at 24%, clips that got none at **18%** — both far above 2%, so the cause is a change that
touches EVERY clip. The widened `"here's the …"` ban is the broadest candidate (the model used that
construction to run up to its payoff and now has to find another way in), with the HARD-tier retake
weighting second (it changes which take is accepted).
⚠ **NOT closer length** — flagged closers median 8 words vs clean 10. They are the persona's quiet
signature deflate ("Not bad company.", "This one just earns the view.", "That is what I call a soft
landing."), which TTS renders soft.

⚠ **THE PREVIOUS SCRIPTS ARE GONE.** Regeneration overwrites `narrations.script` in place and there is
no history table, so this is NOT revertible — only fixable forward.

✅ **RESOLVED to 6.5% — and the cause was NOT what any of us thought. 2026-07-30.**

⚠ **SOLO TAIL COLLAPSE IS MOSTLY STOCHASTIC IN THE SYNTH, NOT DETERMINED BY THE SCRIPT.** A
`resynth-narration` pass — the SAME scripts, TTS re-rolled, best-of-3 again — cleared **22 of 35
flagged clips for $1.25**. Corpus went 21% → **13 of 201 (6.5%)**. Nothing was re-narrated.

That directly contradicts the note the fused closer rule was built on ("all three retakes collapse
identically, which means the SCRIPT determines it"). That finding was real FOR FUSED TALLIES and does
not generalise: a fused clip ending on a verbless list has nothing to land on in any take, while a
solo clip ending on a wry sentence is a coin-flip the sampler sometimes loses.

⚠ **The durable lessons from this episode live in `docs/guides/ops-scripts-sop.md`** ("Judging a paid
run: five traps that each produced a wrong conclusion") — reversibility before the first `--apply`,
baseline before the intervention, never validate on the repair population, no conclusion from a sample
that cannot answer, and cheap lever first. Recorded there rather than here because this section gets
deleted when done and those outlive it.

- [x] **The solo closer rule shipped anyway (`968a0ab`) and is worth keeping, but do not credit it
      with much:** measured 21% → 17% on fresh generation. It was justified by 15 → 3 on the clips that
      were already broken — a REPAIR population, which flattered it badly. The clips it "fixed" were
      mostly re-rolls. ⚠ The rule is followed (flagged closers now carry finite verbs at the same rate
      as clean ones, median 10 words vs 12), so closer SHAPE is not the mechanism.
- [ ] **13 clips remain flagged** at median 5.6 dB (max 9.3, vs the fused disaster's 14.4). Cheapest
      next move is another `resynth` round on just those (~$0.50); a few are genuinely structural and
      want an ear, not another re-roll.
- [ ] **Standing regression test for any persona-prompt change**: same places, tail-flagged rows,
      before vs after. A prompt edit moved this 10× without failing a single gate.

## The POI legibility layer — cluster / district / road-relevance (founder ask 2026-07-29)

Founder, from the road: stacked POIs don't all play — one fires and the car is already past the rest
(**Camp Richardson**, **Emerald Bay**). Follow-on asks: make sure a POI is **close enough to a major
road** to trigger well, and make the whole thing **region-agnostic** so adding Yosemite is a sweep,
not hand-curation. Founder framing: this is *"a primary piece of logic unique to Skipper's
intelligence… a moat"* — LLM spend is explicitly fine here.

**Full design + all measurements: `docs/designs/poi-legibility-layer.md` (2026-07-29, NOT greenlit).**
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
      11 subjects reseated, no re-spend. Still INERT. See `docs/designs/poi-legibility-layer.md` §5.
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
      BETTER there (22/31 vs Tahoe's 13/36). See `docs/designs/poi-legibility-layer.md` §4d.
- [x] **3f. Containers can't seed — FIXED 2026-07-29.** Nothing already stored separated a container from
      a stop (`Sierra Nevada` and `Half Dome` share `kind='mountain'` with article lengths within 15%;
      `Carson Range` is a container with a SHORT article). The signal is EXTENT: new
      `backfill-poi-extent.ts` (free, WDQS P2046) fills `pois.area_km2`, and a POI ≥ 100 km² may be a
      group MEMBER but never a SEED. 11 barred corpus-wide (Sierra Nevada, Yosemite NP, Lake Tahoe,
      the wildernesses, plus `Diocese of Reno` and `Ferguson Fire` as bonus catches); settlements stay
      seedable. Verified: Half Dome now seeds its own group. ⚠ `Carson Range` claims no area so it is NOT
      caught — worst offenders, not all. See `docs/designs/poi-legibility-layer.md` §4e.
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
      See `docs/designs/poi-legibility-layer.md` §4f.
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
      `docs/designs/fused-cluster-generation-spec.md`. Steps 1-3 spend nothing; **step 4 is the commitment
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
      - [x] **TAIL COLLAPSE — diagnosed, fixed, verified. Was 11 of 31 (35%) vs ~2% on solo, now 1 of
            31. ⚠ I called this wrong at n=1 first.** After the first clip collapsed I checked history (7 of 365 solo),
            concluded "pre-existing, don't tune", and proceeded. At n=31 that reverses: a 17× rate, and
            severity 4.2-14.4 dB vs solo's 3.3-4.6. Worst is `1960 Olympic Ski Stadium Site` at 14.4 dB
            — its last line should be near-inaudible. ⚠ The fix belongs in the NARRATION prompt (a fused
            telling ends on a summarising falling-intonation fragment, and all 3 retakes collapse
            identically because the SCRIPT determines it), NOT in `SKIPPER_TTS_STYLE_PROMPT` whose
            anti-fade clause is already maximal and ear-locked.
            ✅ **Closer rule shipped** (`mergedFeatureLines`, scoped to `named.length >= 2` so solo clips
            can't inherit it): "END ON ONE OF THEM — a full sentence about a single place… not a tally".
            Probed on the WORST clip: **14.4 dB → 1.8 dB, clean after one retake.** Then VERIFIED at
            n=10 on exactly the failing population ($4.44): 5 clean outright, 4 clean after one retake,
            1 still flagged. **Corpus-wide 11 → 1 flagged, 35% → 3.2%** — the single-place baseline.
            ⚠ Survivor is `Historic Esmeralda Avenue, Minden` (4.6 dB, "structural" per tail.ts — a
            fresh take re-collapsed identically, so it stopped retrying). One clip at baseline is not a
            pattern; worth an ear, not another retake.
      - [ ] **Diversity advisory failed 16 of 31 (52%).** The single-clip retake that took Stateline
            0.00 → 1.00 was not representative; naming five places pulls toward enumeration, the
            NAME-DENSITY tension §3.3 predicted. Never withheld a clip, but half a run is a signal.
      - [ ] **⚠ …and that 52% is only HALF the picture: the fused generator's diversity lint cannot see
            another clip.** `generate-cluster-narrations.ts:244` still calls
            `evaluateDiversity([{ seq, stopType: 'story', script }])` — a SINGLE-element array, in which
            every cross-clip rule is a no-op by arithmetic (`hits.slice(1)` on one hit is empty; the
            opener/closer maps have nothing to collide with). `generate-narrations.ts` had the identical
            bug and was fixed in `0f80d97` with `evaluateDiversityAgainst(current, context)`; the fused
            generator was mid-edit in the shared tree that day and was deliberately left for its owner.
            **Read the numbers above correctly:** the 16/31 failures and Stateline's 0.00 → 1.00 are
            REAL — they come from the PER-stop rules (banned wind-ups, list/inventory shape, tidy-bow
            closers, within-stop repetition), which always worked at n=1. What has never been measured
            even once is whether the 31 fused clips repeat EACH OTHER. Do not read "diversity 52%" as
            "diversity is working here".
            ✅ **MEASURED 2026-07-30 — and it downgrades this item.** Ran the real `lintScripts` over the
            released corpus (free, deterministic, no spend): **fused-vs-fused is 0 of 31.** They are NOT
            repeating each other, so the "worst population to be blind on" framing this entry originally
            carried was wrong. Corpus-wide the cross-clip rules flag only **16 of 451 (3.5%)**, and none
            of those are repetition a rider would notice ("the whole works" ×3, "take your pick" ×2).
            ⚠ **The real lesson is the opposite of the one this item started with: fixing the CALL is the
            cheap half, and nearly worthless alone.** What actually repeats is invisible to
            `STOCK_PHRASES` — an n-gram sweep found "the national register of historic places" in
            **60/420 solo (14%) and 7/31 fused (23%)** — fused is DENSER — and the granite age range in
            20/420 solo. The load-bearing fix is the RULE, not the call:
            **"any content n-gram appearing in ≥N clips in the region"** (~15 lines in `lint.ts`), which
            would have caught both without anyone having to predict them.
            Fix is the one-line swap plus a context seed. Two things not to get wrong: **the take under
            test must go LAST** (every cross-stop rule keeps the FIRST occurrence and flags later ones,
            so any other order flags the corpus and lets the repeating take pass clean), and the context
            should include the region's SOLO tellings too, not just the fused ones — a fused clip that
            echoes the member clips it replaced is the same defect wearing a hat.
            ⚠ The 31 released clips are NOT retroactively fixed by this; it only changes what the NEXT
            run produces. Worth doing before Yosemite's 30 (the item below) or any fused regeneration —
            re-generating into the same blind spot buys the same defect at full price.
            ✅ **ALL BUILT** — call fixed on both generators (`0f80d97`, `ab86ce5`), context made
            fused-aware and explicit-run-safe (`d73d681`), n-gram + opener-shape rules (`f08dc9b`).
      - [ ] **⛔ DO NOT REGENERATE FOR MONOTONY YET — a $1.68 preview says it does not work.**
            Ran `--scripts-only` over the 12 worst repeat offenders (6 generated; the other 6 were
            correctly skipped as superseded by fused tellings) with all of the above live, and diffed
            the new scripts against the old through the same lint:
            **NRHP 5→3 · geology 1→1 · total cross-clip findings 14→14.** No net improvement, and
            `Alamo Ranchhouse` got WORSE (2→4): it dropped the NRHP phrase and landed on three other
            shared ones. The corpus is saturated enough that a rephrase mostly finds another worn groove.
            **Why, mechanically** (`eval/optimize.ts`): the loop runs while `bestScore > 0`, but breaks
            on the first round that fails to STRICTLY improve. A worn-phrase finding is usually not
            fixable in one round, so the clip spends a retake, does not improve, and stops. Measured
            cost of that: $1.68 actual against a $0.90 estimate for 6 clips — about one extra narration
            round each, on the ~38% of clips carrying a worn phrase. At 420 clips that is real money for
            no gain.
            ⚠ **The diagnosis this changes: NRHP and the granite age are a SOURCE problem wearing a
            wording problem's clothes.** Both come from the same fact being handed to dozens of POIs
            (one Macrostrat map unit per batholith; one NRHP listing sentence), so no per-clip "say it
            differently" note can fix what is upstream of the clip.
            ✅ **ADDRESSED 2026-07-30 — by telling the narrator what it could not know.** The sheet now
            marks a line carried by >3 other places as `[SHARED — N other places near here carry this
            exact line]`, with one note demoting it ("REGIONAL character, not this place's story…never
            open on it, never close on it, never spend your groaner on it"). Measured corpus-wide: 4013
            distinct fact lines, **17** shared — the granite pair at **24 places each**, the generic
            NRHP designation at 11, then the andesite/Cenozoic and intrusive/Mesozoic pairs. Tight, not
            spraying.
            ⚠ **The carriers are NOT thin cards** (most have 3-5 other facts), so the old "it had
            nothing else to say" theory was wrong — the model was *choosing* granite, 24 times, because
            from inside one call it is a vivid specific fact and nothing said otherwise. Same shape as
            the two tic bugs: not a rule ignored, a fact never communicated.
            ⚠ Marking beats GATING: dropping the fact would rob the one clip where a rider meets it
            first, and any "first N places may say it" rule picks arbitrarily which peak gets the good
            line.
            ✅ **VERIFIED on a paid probe, 2026-07-30 ($2.48).** 8 clips whose sheet carries the
            24-place granite pair and whose script spoke it: **30 mentions → 13**, max per clip 4 → 2.
            The telling now leads with what is unique (Maggies Peaks opens on there being TWO of them,
            with the sibling joke) and the rock lands mid-telling as texture.
            ⚠ **Honest non-finding: opens/closes were ALREADY 0 before the change** (measured on the
            same 8 released clips), so the "never open on it, never close on it" half of the note
            changed nothing here — do not read the zeros as a win. The measurable effect is DENSITY.
            ⚠ **Dead-code finding en route: the `geology` narration channel is unreachable.** Only two
            callers of `narrateStop` exist and NEITHER sets it, so `geologyLines` — with its careful
            "do not close on the rock / no deep-time reflection" cues — has never fired. V2 enrichment
            folds macrostrat sentences into `facts` as ordinary bullets. That is why the monotony those
            cues were written to prevent happened anyway. Left in place (an authored-tour path may want
            it) but commented as not-live; do not read it as coverage.
      - [x] **"OPENER monotony" — RE-MEASURED 2026-07-30, and it is neither an opener problem nor a
            detection one.** (a) DETECTION was already done: `f08dc9b` shipped `openerShape` (a coarse
            2-word key with a tolerance), which flags 49 of 457 against the exact key's 7.
            (b) The real shape of it, over all 457 released clips: **155 (34%) carry a hard-banned tic
            SOMEWHERE, 148 of those the `"here's the …"` family — but only 32 open with one.** So it is
            a whole-script tic, not an opening habit, and every one was caught at generation time.
            ⚠ **ROOT CAUSE, and it was in the prompt, not the machinery.** The persona prompt banned
            exactly three completions ("the kicker / the wild part / the thing") while the lint bans a
            nine-way family — so the model dutifully avoided those three and wrote "here is the part I
            like" (10 clips), "here is a place that", "here is what happened", none of which it had ever
            been told not to write. **And the prompt demonstrated the construction twice in its own
            voice** ("Here is the heart of you…", "So here is how it works."). Fixed: the prompt now
            states the family and the reason ("that construction is a runway you do not need"), and its
            own two instances are gone.
            ✅ Mechanical backstop, second: `optimize()` gained a HARD advisory tier
            (`LintFinding.hard` → `StopEval.hardFindings` → `HARD_ADVISORY_WEIGHT`). A ban and a shared
            n-gram used to score identically at 1 apiece, so the loop was indifferent between clearing
            the defect the model CAN fix in a retake and the one it cannot (an n-gram is the same source
            fact handed to dozens of POIs — the $1.68 probe above). Worse, for the **50** clips whose
            only finding was a ban, a take that swapped it for any other single finding scored a TIE,
            was accepted, and tripped the thrash guard. ⚠ The weight does NOT make a gate buyable —
            `gatesNotWorse` is a separate absolute veto; do not "fix" the number.
            ⚠ **Detection is byte-identical after the change (267 of 457 flagged, before and after)** —
            only the weighting moved.
            ✅ **VERIFIED on a paid probe, 2026-07-30 ($3.54, founder-authorized).** `--scripts-only`
            over the 12 worst offenders (each carrying 1-2 instances, none superseded):
            **18 occurrences → 2. Ten of the twelve came back completely clean.** The two survivors are
            `Tevis Cup` ("now here is the part that keeps you humble") and `Indian Hills` ("here is
            where"), one each. Nothing was written to R2 or `narrations`.
            ⚠ Re-running this probe is the standing cheap test for any future prompt change: pick
            offenders, `--scripts-only`, count the construction in the printed scripts.
      - [x] **The Skipper said "the card" OUT LOUD in 18 clips — FIXED 2026-07-30.** "The card" is the
            PROMPT's internal word for the fact sheet; a rider has never heard it. Shipped examples:
            "Late Cretaceous, the card tells me", "I'm quoting the card here", "That is the whole card,
            folks", "most of what is on my card for this one".
            ⚠ **The prompt did not merely leak it, it TAUGHT it — in two places.** Its honesty
            paragraph blessed the line `"I'll tell you what's on the card…"` as *"part of the bit"*,
            and the Coyote Mesa scenic EXAMPLE narrated "That is all the card gives me". Few-shot text
            is the strongest conditioning in the prompt, so that one example plausibly seeded a large
            share of the 18. Both rewritten, and the rule is now stated outright ("never MENTION the
            card itself… it is how you know things, not a prop you hold up").
            ⚠ **The pattern is narrow ON PURPOSE — this is a casino region and cards are legitimate
            SUBJECT matter.** The leak is always "the/my card" SINGULAR; genuine use is "a card" or
            "cards" ("pick a card, any card", "a calling card", "still dealing the cards", "more
            aliases than a card shark"). Measured over all 458 scripted clips: **18 leaks caught in 18
            clips, 0 of 15 genuine mentions touched**, plus a lookahead for a real card room/table/game.
            ⚠ New `PROMPT_PROSE_EXEMPT`: the prompt must SAY "the card" to explain what the card is, so
            the guard test exempts it in PROSE — but deliberately NOT in the example narrations, which
            is the half that caught the real bug. Validated by reverting the example and watching the
            test fail.
            ✅ **VERIFIED on a paid probe, 2026-07-30 ($1.85, founder-authorized).** All 8 eligible
            clips carrying the leak, regenerated `--scripts-only`: **card 8 → 0.** Five of them also
            carried the `"here's the …"` tic, giving an independent second sample of the earlier fix:
            **ban 5 → 0.** Across both probes that is 23 → 2 on 20 clips. Voice held (the Nevada State
            Prison take still lands its groaner), and "the cards and dice went out" survived untouched
            in the same clip — the narrow pattern behaving correctly on real subject matter.
      - [ ] **`--scripts-only` DOES write to the DB, but its blast label says it does not.**
            `generate-narrations.ts` declares `blast: scriptsOnly ? ['SPENDS $'] : ['SPENDS $',
            'MUTATES DB']`, yet the run still recorded `eval_runs` + 60 `eval_scores` rows. Harmless
            in itself (observability tables, not content, and arguably worth keeping), but the blast
            line is the contract an operator reads before spending — per `ops-scripts-sop.md` it has to
            be true. Either widen the label or skip the eval record on scripts-only.
      - [ ] **Yosemite's 30 clusters** — still un-generatable (zero enriched members); needs a
            founder-gated `enrich-pois --region yosemite` run first. `generate-cluster-narrations.ts` is
            complete: narrate → fail-closed gate with excision retakes → TTS → loudnorm → R2 → upsert
            on `narrations_cluster_uq` → eval record keyed to the cluster. **`--limit 1 --apply` is the
            cheap path to ONE real clip to listen to** (well under $1) before committing all 31
            (~$12-16). ⚠ A PREVIEW is not free either — it narrates and scores; only persistence is
            gated. ⚠ Cost was corrected UP: halving the original $10-15 along with the clip count was
            wrong, because per-clip cost RISES (a fused well is 9 sheets and the script runs to the
            180 s ceiling, not the 90 s story aim).
      - [x] **Step 5 — LISTEN: PASSED (founder, 2026-07-30, "clips sound fine").**
      - [x] **Step 6 — member retirement BUILT + INERT.** `supersededByFusedTelling` drops a member from
            `/roam` and the drive BUILD corpus once its cluster has a fused telling the caller can see.
            ⚠ Keyed on "the cluster HAS a visible fused clip", NEVER on `cluster_id IS NOT NULL` — that
            naive version would have been a disaster: 304 pois carry a cluster_id but only **104** have a
            fused clip, so the other **200** (un-enriched Yosemite + the gated UNR campus) would have
            vanished with nothing replacing them. Measured: public 0 suppressed (all staged ⇒ no-op),
            admin-preview 104 — exactly §4.2's number. ⚠ REVERSIBLE and deletes NOTHING: it is read-path
            suppression, member rows + R2 survive, so `sweep-orphans` is not part of this step.
      - [x] **RELEASED 2026-07-30 (founder go). PHASE 4 IS LIVE.** 31 fused clips stamped, 0 other
            clips affected (pre-flight confirmed nothing else was staged in the bbox). Rider-visible
            effect verified: **Stateline went 18 pins → 6**, the 9 casino members replaced by one
            148-second telling; Emerald Bay is fused. 104 member clips retired from the read paths
            (reversible — the rows and R2 objects survive).
      - [x] **The AREA trigger — engine BUILT 2026-07-30** (founder: "this will help when we open up
            new regions"). `@skipper/engine/area.ts` (convex hull, ray-crossing containment, signed
            boundary distance) + an area branch in BOTH trigger loops. 125 engine tests pass including
            the whole existing point suite — the branch is additive. Design notes in spec §10; every
            choice is measured (hull beats bbox because a bbox's over-cover is all in the CORNERS,
            which is where the highway-clip failure lives).
      - [x] ⚠ **THE AREA TRIGGER CANNOT SHIP WITHOUT AN APP STORE RELEASE, and there is no per-client
            withhold.** Every trigger decision is in the app binary; the server half is ~10% and does
            nothing alone. There is NO client-version signal on the wire, so "send districts to
            everyone" / "to no one" are the only options — the founder chose EVERYONE (66435e9),
            protected by the capped point fallback rather than a withhold. Remaining work is now
            tracked in the two items directly below; the client-capability channel has its own section.
      - [x] **Mobile ROAM half — BUILT 2026-07-30.** The ring was already on riders' devices (server
            sends it, Zod parses it) and was being discarded by ONE hand-written field list in
            `adoptPins` (`useRoam.ts`), so every district fired its capped 600 m point fallback. Now
            threaded into `RoamPinRef`, plus the hull DRAWN as a `<Polygon>` on the roam map (new
            `areaFill`/`areaStroke` theme roles, teal — pine is the story-dot colour and the one amber
            is the puck). Districts are split OUT of `cullPins`: it keys on a pin's single point, and a
            district whose centre is off-screen can still have half its boundary in view.
            ⚠ The field is optional at all four hops, so a dropped thread compiles clean and silently
            degrades to point-firing — verify by BEHAVIOUR (a fix inside a hull fires), never by
            `bun run check`. ⚠ Still needs an App Store release to reach riders.
      - [x] **buildDrive's second admission rule — BUILT 2026-07-30, and it closed a LIVE hole.**
            ⚠ The spec claimed the drive path passed `areaCapable: false` "deliberately". **It does
            not exist** — `areaCapable` appears nowhere in any `.ts`, and `drives.ts` had zero `area`
            references, so `loadClusterTellings` fed wide districts into drive selection as capped
            600 m points snapped from their off-road 1-centre, and `drives.selection` FREEZES that at
            create against a credit that never refunds. Measured: 0 frozen today, but only because all
            3 saved drives are Tahoe-basin — the first Reno drive would have baked one in. `area` now
            reaches `DriveCandidate` for the express purpose of being REFUSED, with 2 regression tests
            (refused when its point would be admitted; still admitted without a hull, which guards the
            mapper). When a drive can carry a ring end-to-end, this branch becomes the real rule:
            admit iff the polyline ENTERS the ring, `alongSec` from the entry vertex.
      - [x] **⚠ "Nothing bounds a clip that OUTLIVES its place" — MEASURED, and it is not an area
            problem.** At 40 mph the three area clusters give 34–46 s inside the hull against 148–185 s
            clips. But every one of the 34 **point**-triggered fused clips already shipped is WORSE on
            the same metric: Emerald Bay is ~7 s of extent against a 127 s clip, Truckee ~0 s against
            150 s. It is a general property of a 2–3 minute telling at road speed, not something the
            area mode introduces, and bounding it would mean cutting clips off mid-sentence across the
            live corpus. Recorded rather than actioned. (Re-run: `packages/studio/.scratch` is
            gitignored; the query is member anchors → `clusterTrigger` → mean chord = πA/P.)
      - [ ] **Latent: a DEGENERATE hull that needs an area is dropped to silence.** `clusters.ts`
            refuses to serve a `ring.length < 3` area ("no honest polygon"). Measured: 16 clusters hull
            down to a 2-vertex ring and **0 are dropped** — not because they are small, but because
            every one is under `CLUSTER_MAX_TRIGGER_RADIUS_M`, so `needsArea` is false and the guard is
            never reached (14 sit at the 250 m floor; Truckee is 302 m, Mount Rose Summit 255 m). Only
            three clusters exceed the cap today and all three have honest polygons (Downtown Reno 914 m
            /9 vtx, UNR 903 m/5 vtx, Historic Homes 698 m/9 vtx).
            ⚠ **The quantity that matters is DISTINCT ANCHORS, not members.** `convexHull` dedupes
            co-located points and `speakableLat ?? lat` snapping co-locates them routinely — Truckee is
            4 members over **2** distinct anchors, hull area exactly 0. So it bites the first time a
            cluster with ≤2 distinct anchors spans >1.2 km, whatever its member count; triaging by
            member count clears exactly the cluster that would be dropped.
            ⚠ The near-miss that is NOT this bug is **Virginia City alone** (15 distinct anchors,
            6-vertex hull, 384 m² — a genuine main-street sliver). It is point-triggered at 265 m, so no
            `area` is served and `insideArea`'s 60 m margin never runs on it. A sliver behaving as a
            60 m corridor down the street is what would happen IF such a district crossed the 600 m
            line — arguably the ideal district shape, and the reason the guard should treat a sliver as
            honest rather than widening it.
      - [x] **THREE districts (not two — I under-counted) shipped point-triggered, 2026-07-30, $2.39.**
            Virginia City (265 m), Historic Downtown Carson City (411 m) AND Historic Carson City
            (552 m) are all under `CLUSTER_MAX_TRIGGER_RADIUS_M`, so they needed no engine work and no
            release. Generated, all gates clean, RELEASED. Corpus is now **34 fused tellings**.
            ⚠ The pre-flight caught a stowaway: `U.S. Route 50 in Nevada` was staged and would have gone
            live with them — a 70 s telling about a 300-mile highway, un-anchored, firing at one
            arbitrary point. EXCLUDED first. It escapes `prune-corpus` because it carries no
            `length_km`, no `wikidata_types` and no `kind` — the known no-Wikidata-claim gap, now with a
            second confirmed instance after `Carson Range`. Worth a real fix when containment is next
            touched.
      - [x] **Area trigger SERVER half — BUILT 2026-07-30.** Optional `area` on `roamPin` and the hull
            in `apps/api/src/clusters.ts`. ⚠ A `GET /roam?caps=area` capability param was built and then
            REMOVED the same day (66435e9, founder call): area tellings go to EVERY client, protected
            by the capped point fallback instead. Restoring it is a one-line query-param read.
            ⚠ Two traps recorded in spec §10: suppression must take the SERVED cluster ids (not a
            predicate that re-derives them), and it must return the KEEP condition — `not(inArray(...))`
            drops every NULL cluster_id row, measured at /roam falling 46 pins → 4.
      - [x] **Step 7 trailing items — DONE 2026-07-30.** (a) `GET /admin/pois` now returns
            `coveredByCluster` and the console shows an "in a fused clip" chip; without it the console
            called 104 live places `narrationStatus: 'none'`, which reads as a generation backlog and
            would send an operator to pay for clips that already exist. (b) The per-clip release now
            resolves a POI's subject the same way the sheet does (own narration, else its cluster's), so
            publishing a regenerated fused clip no longer requires a whole-region release. (c)
            `generate-narrations` skips superseded members — verified live, **104 skipped** with the
            reason logged. ReferenceView updated (it still claimed grouping was "recorded but not yet
            acted on").
- [ ] **5. `buildDrive` reads anchors; delete pick-one.** Orphans ~169 satellite clips —
      `sweep-orphans.ts` already handles that.

## VALIDATE: four ops CLIs went from serial writes to bounded fan-out (2026-07-30)

The /simplify sweep converted four free ops CLIs from one-write-at-a-time to `mapLimit(…, 8, …)` —
the pool the paid CLIs and `classify-treatments`' DB writes already use. Typecheck and the 350 studio
tests pass, but **none of these can be exercised without writing to the live corpus**, so they ship
unvalidated by construction. dev and prod are ONE Neon database; there is no staging to rehearse in.

- [ ] **Validate with a PREVIEW first, then one small `--apply`.** In order, cheapest first:
      - `discover-pois` (both the story and scenic upsert loops) — the biggest win, and the one that
        gates the rest of the pipeline. Region-scale: Tahoe ~459 story pins, Yosemite 837.
      - `backfill-poi-extent` (whole-region `pois` update) · `prune-corpus` (flags a subset) ·
        `sweep-orphans` (R2 deletes).
      What to check: the counts printed at the end match a preview run of the same region, and no poi
      is written twice or skipped. `upsertPoi` is a QID-keyed `onConflictDoUpdate`, so a re-run is
      idempotent and a partial failure is recoverable by re-running — that property is what made the
      change safe to attempt at all.
- [ ] ⚠ **Know the one semantic change.** `mapLimit` FAILS FAST like the serial loops did, but on a
      throw the ~7 in-flight siblings settle unobserved rather than never starting. So a crashed run
      leaves a slightly larger, less predictable written prefix than before. Idempotent upserts make
      that recoverable; it is not a reason to panic if a run dies mid-way, but it IS why the counts
      should be eyeballed rather than assumed.
- [ ] `sweep-orphans` deletes R2 objects. Its preview LISTING is byte-identical to before (every key
      is logged before any delete now), so a `--apply`-less run is a safe first check.

## Production ops hardening — from the 2026-07-30 ship-readiness audit

None of this is a build; all of it is config. The premise changed on 2026-07-28: 1.0.0 is submitted, so
"prod has no users" stops being true on approval (see CLAUDE.md's storage rule, rewritten the same day).

- [ ] **⚠ FIRST: confirm `hello@skipper.fm` actually delivers somewhere you read.** Founder-owned, ~5 min,
      and it BLOCKS the alerting below (there is no point routing pages to an address nobody reads).
      It is simultaneously the App Store support contact, the privacy contact, and the **NRS 603A
      designated request address with a 60-day statutory clock** — so this is the one item here with a
      legal edge, not just an ops one. The repo's own record says the skipper.fm catch-all does NOT
      forward to the founder's Gmail (verified for `review@`, never for `hello@`), and because the
      catch-all accepts everything, SMTP probing can NEVER prove an address is read. Only a real test
      message can. Send one from a non-Workspace account to `hello@` and confirm arrival.
      ⚠ Got heavier on 2026-07-30: the in-app "Report an issue" mailto now points at `hello@` too. It
      previously pointed at a `feedback@` placeholder nobody had replaced, which shipped in builds 15
      and 16 — so this address is now the ONLY route a rider has to reach a human from inside the app.
- [ ] **Alerting — there is NONE.** No uptime checks, no alert policies, no notification channels on the
      project. Prod 500'd for **14 days** (2026-06-30 → 07-15, billing disabled) and was found by a human
      running `curl`. Want: one uptime check on `https://api.skipper.fm/health` + an email channel to
      `hello@skipper.fm`. ~10 min once the inbox above is settled.
- [ ] **GCP billing budget + alert.** The Budget API is not even enabled on the project
      (`gcloud beta billing budgets list` → `SERVICE_DISABLED`). Billing — not code — is the documented
      root cause of the only real outage this project has had. ~5 min.
      ⚠ Got heavier after 1.1 step 8: it is now the ONLY control anywhere that bounds AGGREGATE spend.
      Every cap in `limits.ts` keys on client IP, so each bounds one caller and none bounds the total —
      see [rider-spend-exposure.md](docs/research/rider-spend-exposure.md).
- [ ] **Set `--max-instances` on the API deploy** (`cloudbuild.yaml`, one line). The deploy passes no
      scaling flags at all, so the multiplier in RISK-4's "limit × live instances" is Cloud Run's
      **default cap of 100** — a number nobody chose and that appears nowhere in the repo. Both paid
      rider endpoints lost their account wall in 1.1 step 8, so the limiter is now their only guard.
      A small value bounds the worst case while sitting far above any pre-launch demand, and it is
      trivially raised at launch. ~2 min. Findings + the arithmetic:
      [rider-spend-exposure.md](docs/research/rider-spend-exposure.md).
      ⚠ Related but NOT the same bug, and not fixed by this: `PLAN_RATE_HOUR`'s 3,600 s window lives in
      an in-memory map that dies with the instance, and with no `--min-instances` Cloud Run recycles
      idle instances in minutes — so the long cap is largely unenforced even at ONE instance. A shared
      store is the real fix and `rate-limit.ts` already puts it at M4.
- [ ] **Re-accept RISK-4 deliberately, or re-price it** (founder, STOP rule — not a refactor).
      `PROPOSE_RATE` was set when `/propose` sat behind an account wall: the wall was the first-order
      guard, the limiter was defence-in-depth. After D14/D15 the limiter is the only guard on a billed
      Google Routes call reachable by any stranger, forever. The number was not changed and no change is
      being recommended — its PREMISE moved, and per CLAUDE.md that is a founder call. Same question
      applies to `PLAN_RATE_MINUTE`/`PLAN_RATE_HOUR`, which never had a wall in front of them.
- [x] **The snapshot gate contradicted itself — RESOLVED 2026-08-02 (founder): D5 is current.**
      D5 recorded that a local-only snapshot was ACCEPTED; step 0 still said the offsite copy was owed
      and blocked all destructive DB work, gating work D5 had authorized. Not inert prose —
      `scripts/db-preflight.ts` cited the step-0 half, so the repo's newest guard argued from a lifted
      rule. Step 0 now matches D5, and the guard (plus the `drive_demand` tombstone in schema.ts)
      argues from what is actually true instead: one Neon host with no staging twin, and a backup
      under a gitignored `.scratch/` that shares a failure domain with the working tree. The refusal
      itself is unchanged — it was always about an accidental DROP, not about where the backup lives.
- [x] **`skipper-api-deploy` had an EMPTY `includedFiles` — FIXED 2026-07-30.** It was the only one of the
      four Cloud Build triggers without a path filter, so ANY commit rebuilt and redeployed the API at
      100% traffic with no test step and no canary. Not theoretical: the build history showed it firing
      on five docs-only commits that day (`24d0934`, `0b73667`, `09f7659`, …) while 1.0.0 sat in App
      Review — a stray commit could swap the backend under the reviewer.
      Filter now matches the API's real closure (its workspace deps + the Dockerfile's COPY list):
      `apps/api/** packages/db/** packages/engine/** packages/routing/** packages/shared/**
      packages/storage/** cloudbuild.yaml bun.lock package.json`.
      ⚠ Two notes for anyone editing it again: `gcloud builds triggers update github` REJECTS this
      trigger (it is a 2nd-gen `repositoryEventConfig` connection, not the legacy `github` block) — use
      `triggers import` with the full spec. And the dangerous direction is TOO NARROW, not too wide: an
      over-broad filter is merely noisy, while a missing path makes a real API fix look shipped when it
      never deployed.
- [ ] **`apps/api/Dockerfile` never copies `bun.lock`**, so every production image resolves dependencies
      fresh (lockfile `better-auth` 1.6.23 vs 1.6.25 on npm today), and `RUN bun add -g @dotenvx/dotenvx`
      is completely unpinned on the container's secret-decryption ENTRYPOINT. `COPY bun.lock` + pin the
      dotenvx version.
- [ ] **No Cloud Run instance/resource bounds** (`cloudbuild.yaml` sets no `--min-instances` /
      `--max-instances` / `--cpu` / `--memory`), so defaults apply and every first tap after idle pays a
      cold start plus a Neon wake. Only worth it if the cold start is actually felt in the car.
- [ ] **Neon PITR / backup retention is unverified** and lives nowhere in git. It is the only thing
      between a mistaken migration and permanent loss of the append-only `credit_entries` ledger, which
      never refunds and has no second copy. Check the retention setting; record it here.

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

## LLM answer-discovery (GEO/AEO) — research DONE, the cheap moves SHIPPED

The research pass and the two cheap builds landed 2026-07-28 (`c286f29`, `a9f6474`). Verdict, evidence
and per-claim source-quality labels live in `docs/designs/llm-discovery-marketing.md` — read that, not a
summary of it.

The short version, so nobody re-opens the expensive half: the founder premise was **half right**. The
answer surface genuinely is not the breadth/comparison grid, and entity legibility was worth the hour.
But the big build — programmatic per-POI pages generated from our own corpus — is **dead on the merits,
not on cost**: our corpus is downstream of Wikipedia, Wikipedia is the single most-cited source in that
surface, and we cannot out-cite our own supplier with a CC BY-SA-encumbered restatement of it.

- ✅ **A — app entity JSON-LD.** `MobileApplication` + `sameAs` in `apps/site/src/layouts/Base.astro`.
      Bought because "Skipper" collides with a cluster of *boating* apps in entity space, and being
      unresolvable is a mechanical cost that refusing-the-category doesn't cover. ⚠ `sameAs` /
      `installUrl` stay omitted until `APP_STORE_URL` is set post-approval — pointing them at a 404
      would be worse than omitting. Tracked in `docs/guides/app-store-submission.md` §13, not here.
- ✅ **B — an answer-shaped self-description page.** `apps/site/src/pages/about.astro`. A
      *self-description* (who it's for, where it works, what it costs, what it does NOT cover), never a
      comparison. ⚠ Do not write "Skipper vs Shaka Guide" — our honest Tahoe-only limits make that a
      table we LOSE, which is exactly `autio-content-moat.md`'s trap.
- ⛔ **C — naming AI crawlers in `robots.txt`: SKIPPED ON PURPOSE.** A functional no-op (the blanket
      `Allow: /` already permits every one of them) plus a real drift footgun. Don't "fix" this.
- 🧊 **D — programmatic corpus→web pages: SHELVED** on the merits, see above.
- [ ] **E — off-domain presence: FOUNDER-OWNED, unstarted, free half only.** ⚠ The observed pass killed
      the Reddit plan *for this vertical*: the queries a rider actually asks return OTA/marketplace
      listings (Viator, TripAdvisor, even a Marriott white-label) — **zero Reddit threads, zero Autio,
      zero Skipper**. The cross-vertical "Reddit is ~40% of AI citations" stat is someone else's
      average. The high-return move here is becoming a marketplace supplier: business development, not
      engineering, and it collides with the free-app + credits model. Flagged, not recommended.

⚠ **Unresolved, and it undercuts the whole channel:** an LLM-sourced install is very likely **invisible
to every instrument we have** (doc §6). A channel you cannot attribute is one you cannot iterate on —
so treat the shipped moves as cheap insurance against being mis-resolved, NOT as a measurable channel.

## The conversation cannot survive an unmount — INTENDED, revisit later (founder call 2026-08-02)

**Not a bug, and not to be "fixed" opportunistically.** D10 makes the planner stateless: no
`conversations` table, no server copy, and INV-13 forbids persisting rider content on the client. So
the transcript is React state in `app/index.tsx` and it is the ONLY copy that exists anywhere. The
founder confirmed this is intended; it is logged here so the cost stays visible rather than becoming
folklore.

What it costs today: an iOS background memory kill, a crash, or any navigation that unmounts home
destroys a conversation the rider may have spent several BILLED turns building, with no way back. The
screen already bends around this — the account wall and the route card render inline, never
`<AccountGate>` and never `router.replace`, purely so home stays mounted. That is a real constraint on
every future change to that screen, and the kind that gets violated by someone who doesn't know why.

- [ ] Revisit whether a middle ground exists that does not weaken INV-13 or D10. Sketches worth an
      hour, none endorsed: rehydrate the last PROPOSAL (a typed route object, not prose — arguably not
      rider content at all) so a killed app returns to "here's the drive we landed on" instead of a
      blank composer; or keep the transcript in memory across a *navigation* unmount (a module-level
      ref that dies with the process) which costs nothing and covers the common case, leaving only the
      OS-kill case lost. ⚠ Both need a founder call BEFORE building — the first stores something new,
      and "it's only the route object" is exactly the argument that erodes an invariant.

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

**Stage 4 — the funnel ends at `drive_started`, and the drive is the product.** (Raised 2026-08-02
from a read of `analytics.tsx`'s typed event map; founder said add it as a TODO.)
- [ ] The contract covers acquisition end-to-end — `planner_ready` → `plan_turn_sent` →
      `proposal_shown` → `preview_clip_played` → `wall_shown` → `signup_completed` → `drive_created` →
      `drive_started` — and then stops. **There is no event for a stop firing, a clip playing on the
      road, a stop skipped for missing audio, or a drive reaching its end.** So the measured part is
      everything BEFORE the thing the app exists to do, and the unmeasured part is RISK-1's part: the
      one no rider has ever completed.
      ⚠ The specific blind spot worth closing first is the **silent skip**. `useDrive`'s clip-load
      effect advances past a stop with no uri after 400 ms and deliberately shows NO note (the note is
      reserved for a clip that had a uri and wouldn't play). That is correct — it is `clip-store`'s job
      to make it impossible — but it means a store regression is invisible from BOTH ends: the rider
      hears silence and never learns a stop was there, and no signal reaches us. A drive that plays 3
      of 11 stops is indistinguishable from a quiet stretch of road.
      ⚠ INV-13 constrains the shape, not the existence: counts and closed unions only — no place name,
      no coordinate, no drive id, no url. `{ stops_total, stops_fired, stops_skipped_no_audio }` at
      drive end carries the whole signal and names nothing.

## Location: When-In-Use → background updates (deferred half of permission priming; NO "Always")

The pre-permission **explainer** shipped 2026-06-13 in front of the *When-In-Use* prompt
(`docs/decisions/location-permission-priming.md`). The **background-updates** escalation — screen-off /
phone-in-pocket triggering (foreground `watchPositionAsync` dies on lock, so the drive holds the screen
awake via `expo-keep-awake`; if it ever locks, audio plays on but GPS triggering silently stops) — is now
a **build-ready spec: `docs/designs/background-location-spec.md`**.

- [ ] Build it — but ONLY after a real-device drive shows foreground + keep-awake triggering is
      insufficient locked/pocketed (the founder's empirical gate). ⚠ This path is **When-In-Use ONLY, NOT
      "Always"**: a source-level read of the installed expo-location proved `startLocationUpdatesAsync` needs
      only foreground permission (expo PR #33617), so the review scope is the standard nav-app one, not the
      heightened Always scope. Work: transport re-architecture (foreground `watchPositionAsync` → a
      `startLocationUpdatesAsync` TaskManager task; adds `expo-task-manager`), flip `isIosBackgroundLocationEnabled`
      (KEEP the Always strings false; never call `requestBackgroundPermissionsAsync`), a small copy tweak,
      review notes, and a native rebuild. Full checklist + source proof + gotchas in the spec.

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

## Make the app fully functional without internet (founder ask 2026-07-31)

> ⚠ **Direction SETTLED by 1.1** — the offline store is re-keyed by narration SUBJECT ID and filled from the `DriveManifest` (spec step 9). The REGION PACK is **cut** (D21). The verified findings below still hold and are why the store survives largely intact — read them, but take the direction from the spec.

Surveyed the real behaviour before writing this (2026-07-31) — the gap is NOT where it looks.

✅ **A DOWNLOADED DRIVE IS ALREADY OFFLINE-COMPLETE, and well-hardened. Do not rebuild it.**
`loadPlayback` short-circuits before any fetch; the on-disk manifest **nulls every clip url** and
rebuilds `file://` uris at read time, so presigned expiry structurally cannot bite a saved drive.
Soundtrack, fonts, lock-screen art and CC BY-SA attribution are all bundled or frozen in the manifest;
GPS triggering imports only `expo-location` + `@skipper/engine` (no fetch anywhere in engine). The
drive LIST and DETAIL both fall back to disk. The downloader is partial-tolerant with retries and a
size verify. Refs: `offline.ts:369,425-434,566-585`, `useDrive.ts:296`, `app/index.tsx:56-68`.

✅ **ROAM WORKS OFFLINE (2026-07-30) — the pack shipped.** `src/lib/roam-pack.ts` saves ONE artifact
holding pins AND audio; `useRoam` resolves its pin set from the network when it can reach it and from
the pack when it can't, and prefers saved BYTES over a presigned url even on a live session (so a
thin-signal stall on a clip we already hold is now impossible, and the whole expired-presign stall
class is a no-op). Sim mode rides the same path, so the couch replay is no longer network-bound
either. Saved from Settings → RIDE ALONG OFFLINE, anchored on wherever the rider last rode — which is
why it needs no location permission of its own.

⚠ **Pins and audio ship together, deliberately** (`playablePins` in `roam-pack-util.ts`). A cached pin
whose bytes never landed would fire its trigger, buffer for `CLIP_STALL_MS` and skip in silence — a
rider watching a sheet spin. Only pins with audio on disk are ever narrated from a pack; the filter is
the feature, not a detail. Same reason the pack refuses to move its anchor once audio exists: a drive
to another basin must not silently orphan ~138 MB.

- [ ] **Mid-session signal loss still costs ~24 s of dead air per encounter for a clip the pack does
      NOT hold** (3 s skeleton → 12 s stall → one futile recovery → 12 s stall → `onClipDone`), and
      `sawFresh` never flips so the "N stories told" pill stays at 0 — no evidence anything was even
      attempted. Unchanged for an un-saved rider; a saved pack sidesteps it entirely.

✅ **CONNECTIVITY AWARENESS IS BUILT (2026-07-30) — the app knows, and says so.** One app-wide verdict
in `src/lib/connectivity.ts`; `api.ts` throws `OfflineError` INSTEAD of attempting a request the device
can't carry, so every dead-zone fallback that used to wait out the 15 s timeout is now an instant disk
read, and every failure surface says the honest thing instead of the generic in-voice line. Home shows
an honest heads-up (a NUDGE — the CTAs stay live, and Ride Along genuinely works with a pack) and
self-heals on the offline→online edge; the drive player opens on List when offline (DERIVED and
LATCHED at mount — it never overwrites the rider's persisted preference, and flapping coverage must
not re-lay-out the in-car screen).

⚠ **The verdict SELF-HEALS rather than being trusted forever, and that is load-bearing.** An offline
verdict is trusted for `OFFLINE_TRUST_MS`; past that the next request goes through as a PROBE, and any
successful response clears a stale verdict outright. Without it a dead event stream (see below) that
last said "offline" would short-circuit every request for the life of the process. ⚠ Do NOT replace
the probe with a plain expiry: parked in a dead zone no new events arrive, so a plain TTL would switch
the feature off exactly where it earns its keep. One call opts out of the pre-flight entirely —
`signDriveAudio` — because it runs from the mid-drive stall watchdog where the request timeout is a
deliberate second chance for a slow clip, not latency to save.

⚠ **Three landmines are documented in `connectivity.ts` and must not be undone.** (1) We never call
`getNetworkStateAsync()`: read expo-network's `ios/NetworkModule.swift` — with no path in hand it spins
a temporary `NWPathMonitor` and blocks on a semaphore up to 5 s, and on TIMEOUT returns
`isConnected: false`, i.e. it can FABRICATE an offline verdict. (2) The listener is registered once and
never removed, because the native module cancels `NWPathMonitor` in `OnStopObserving` and a cancelled
monitor is final — which is also why expo-network's own `useNetworkState()` hook must not be used in a
component. (3) It is armed from `index.js` ABOVE `expo-router/entry`, because expo-modules-core's
`removeAllListeners` fires `stopObserving` whenever the prior listener count was ≥ 1 rather than only
at zero (`common/cpp/EventEmitter.cpp`), and `@better-auth/expo` registers and tears down its own
network listener — so holding the count above zero from the start is what stops someone else's
teardown taking our stream with it. The verdict fails OPEN throughout: never having observed an event
reads as ONLINE, so a missing native module degrades to exactly the old behaviour, not a bricked app.

✅ **A SAVED MANIFEST NOW MIGRATES INSTEAD OF VANISHING (2026-07-30).** The old
`version !== MANIFEST_VERSION → null` gate was silent data loss — all seven `loadManifest` callers
read null as "never downloaded", so an app update retired every saved drive (gone from the offline
list, error wall in a dead zone, the live player silently downgraded to streaming) while its audio
sat on disk unreachable and unswept, and backed up to iCloud. It had already happened twice. Now an
ADDITIVE change gets an entry in `MANIFEST_MIGRATIONS`, not a bump; the walk (`migrateToVersion`) is
pure + unit-tested; and `downloadDirState` reports "a download is here that I can't read"
independently of the version, so the reclaim stays reachable — it used to be gated on `downloaded`,
i.e. unreachable in exactly the case that needed it.

✅ **REPAIR BEATS SWEEP, and it is BUILT (2026-07-31).** `repairDownload` re-fetches the few-KB
manifest and re-adopts the audio ALREADY on the phone, instead of deleting hundreds of MB to fix a
few KB of unreadable JSON — the clip files are named deterministically from the seq, so a fresh
manifest is all that's needed. NON-DESTRUCTIVE (it only writes a manifest), and safe on older bytes:
`savedAt` comes from the download's own mtime, so a repaired copy can't read as freshly pulled, and
the content diff still flags a superseded cut afterwards. Offered on the drive detail ⋯ menu whenever
`dirState === 'unreadable'`. Also fixed a leak the pack itself introduced: keeping verified bytes
across saves (so a cancel resumes) stranded files for places that left the corpus — invisible to the
size readout; now swept after each save.

✅ **DOWNLOADS ARE DEVICE DATA, AND ONLY ERASURE DELETES THEM (2026-07-31).** An ownership sweep was
built and then removed the same day, on the founder's follow-up: do downloads need a user at all?
Mostly no — a drive's audio IS the shared roam corpus (roam serves those same clips anonymously to
anyone near Tahoe), so the only account-specific part is the route/label, a few KB of JSON. Scoping
drives to a user while the roam pack was device-scoped applied two rules to the same bytes.
Where it DOES matter is account DELETION — and the sweep missed exactly that case, because after
`deleteUser` the rider is anonymous, so the owner reconcile never fired while `listDownloadedDrives`
would hand the deleted account's drives to the next person holding the phone. `deleteAllDriveDownloads`
now runs in the delete-account flow (roam pack left alone — anonymous device content).
`sweepUnknownDownloads` went too: if it were ever wrong the rider loses every saved drive silently,
possibly right before Tahoe, and all it bought was disk reclaimed from a drive deleted on another
device. Nothing in the app deletes downloads automatically now except that one erasure path.

- [ ] **⚠ The gap that follows: leftovers sit until the rider removes them** — a drive deleted on
      another device, a previous account's, or one this build can't read. And a drive missing from
      the server list can't be tapped into, so the per-drive Remove is unreachable. A Settings
      "free up space" line is the honest fix; NOT built yet, pending the direction below.
- [ ] **⭐ DIRECTION (founder 2026-07-31): treat downloads as REGION PACKS, not per-drive.** Most of
      the offline machinery above — versioned per-drive manifests, migrations, repair, orphan
      classes, ownership — exists to manage a per-drive download. A region-shaped store dissolves
      most of it and matches what the architecture already says ("the NARRATION is the shared atom;
      ASSEMBLE per drive"). Today a rider holding a roam pack AND a drive stores the same clips
      twice under two filing systems. **Design is SETTLED** in
      `docs/designs/offline-region-packs.md` — region pack + per-drive top-up (no new endpoint, because
      the top-up is structurally required either way: only a drive's OWN manifest is authoritative for
      a FROZEN selection), region as the only rider-facing action, and sync that auto-applies only
      off-session, on wifi, under a size cap. ⚠ Build NOT greenlit (founder 2026-07-31). Prerequisite
      when it is: `revisedAt` on `roamPin` — the same `narrations.updatedAt` column the drive corpus
      already selects.
- [ ] **Verify on a real device.** None of the offline work has run on hardware. Two specifics: a
      COLD LAUNCH in airplane mode (the listener arms at import, but home's `load()` may still beat
      the first pushed event — if it reproduces, the bounded fix is a one-time race against a ~250 ms
      delay inside the FIRST `fetchJson` only; ⚠ never an await on `getNetworkStateAsync`, see the
      landmines), and a real Tahoe drive running off a saved roam pack.
- [ ] **Better Auth's transport is deliberately NOT covered** (`src/lib/auth.ts` has its own fetch),
      so sign-in / sign-up / password-reset / delete-account get no offline line and no timeout at
      all — offline they hang on RN's untimed fetch, then print the generic line. Named as a non-goal
      rather than left silent; the fix is a custom `fetch` passed into `createAuthClient`.

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
