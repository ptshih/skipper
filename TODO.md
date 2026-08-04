# TODO — engineering backlog

> ⚠ **1.1 IS DEPLOYED TO PROD (2026-08-02) BUT NOT RELEASED TO RIDERS, AND IT DELETED ROAM.** The push
> already happened ([docs/guides/1-1-cutover-runbook.md](docs/guides/1-1-cutover-runbook.md)); **what is
> left is one executable guide,
> [docs/guides/1-1-submission-sweep.md](docs/guides/1-1-submission-sweep.md)** — two builds (EAS
> production for TestFlight, a local dev build for the desk passes), the on-device sweep, then the
> listing. ⚠ TestFlight served a PRE-1.1 client calling the deleted `/roam/*` until **build
> 1.1.0 reached TestFlight 2026-08-03** (newest `20`); it clears once Apple finishes processing that
> build and it is attached.
> RISK-1's real drive is OFF the critical path (founder, 2026-08-03).
> The build truth is
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

## Spatial context for the planner — MEASURED 2026-08-03, and the answer is NO

**Do not build a drive-time matrix, a routing-engine dependency, or any per-place spatial context for
the live planner.** This was measured, not argued, and it cost about $1.40.

**The experiment.** A hand-written banded drive-time table for the six fixture anchors, injected as a
volatile system block after the cache breakpoint (`extraSystem`, a measurement seam on
`PlannerModelArgs`). Two arms x two pairs, 50 turns each, judge off — the deterministic metrics are
the point. Reproduce with `bun apps/api/eval/run.ts --apply [--spatial] --no-judge`.

| metric | control x2 | spatial x2 | verdict |
|---|---|---|---|
| routing failures | 2, 2 | 0, 3 | no effect |
| durations asserted as road fact | 12, 10 | 6, 12 | no effect |
| repeated phrases (6+ words) | 37, 48 | 28, 37 | spatial lower BOTH pairs |

**What it bought: nothing it was for.** Routing is flat. The `contradictory-ask` scenario — added
specifically to fail on the observed `durationDrift` defect (Emerald Bay to Incline is ~50 min; the
rider asks for two hours) — behaved IDENTICALLY in both arms. The skipper agreed to two hours with the
table in front of him. The one axis that moved consistently is repetition, ~23% lower in both pairs,
which is real but is not what the feature was for and does not justify the build.

⚠ **THE LEAK FEAR DID NOT MATERIALISE, and this is the useful negative result.** The research that
preceded this leaned hard on a study measuring 47% secret-leakage on Opus-class models, with
suppression instructions worth only ~25 points — the expectation was that a model holding drive times
it is forbidden to state would tilt or blurt. It did not: durations asserted were 6 vs 12 in the first
pair and 12 vs 10 in the second, i.e. noise in both directions. ⚠ An intermediate write-up of pair one
alone claimed the leak had HALVED. It did not replicate. Do not cite pair one.

**Cost of building it anyway, for whoever revisits.** Google's Maps terms forbid storing computed
durations outright (§3.2.3(a) names "distance matrix results" in the No-Scraping list; only place IDs
are exempt indefinitely, lat/lng for 30 days), so the only storable source is a non-Google engine —
OSRM/Valhalla/OpenRouteService — which is a real dependency, a new table, a migration, and an operator
step that `curate-places` does not have today. Paying that for a flat routing metric is not a trade.

**If it is ever revisited**, the encoding question is already settled: measured drive-time BANDS,
per-anchor, name-keyed — a measurement, not a projection, so it reads correctly on a ring, a corridor,
a hub-and-spoke and a blob alike. ⚠ Do NOT revive the projection family (1-D shore coordinate, MDS):
a ring does not collapse to 1-D under classical MDS — the double-centred matrix is circulant, PC1 is
~50%, the same score an isotropic blob and a symmetric hub get. There is no shape detector there.

## Should we adopt an LLM framework? — researched 2026-08-03, NOT scheduled

Founder asked about **BAML** and then **Vercel's AI SDK**. Both were researched against current docs
(not memory) rather than answered from impressions. **Recommendation: not for the live planner. If
one is ever adopted, `packages/studio` is the right first target and the planner is the last.**

**Why the question came up, and it is a good one.** The session's hardest bug was the model
serializing its `plan_route` call into rider-visible prose instead of emitting a tool block (INV-8,
observed live for the first time). BAML's Schema-Aligned Parsing exists for exactly that class — it
does not use native tool-calling at all, it prompts for structured output and parses whatever comes
back (broken JSON, markdown-wrapped, chain-of-thought preceding the payload). Under SAP the failure
would be a successful parse rather than a lost turn.

**BAML — the disqualifier is structural, not capability.** It is a codegen language: `.baml` files
compile to a typed client. This repo deliberately has NO build step ("internal packages export `.ts`
source; bun runs it, `tsc --noEmit` type-checks"), and `apps/api/Dockerfile` copies only
`apps/api/src`, so generated code needs a home and a story in that image. Caching is supported but
coarser (`allowed_role_metadata ["cache_control"]` plus role-level metadata) and **it is unverified
whether it can express TWO breakpoints in one request**, which is exactly what this path needs
(system block 1 + the message tail). A broken cached prefix is the single most expensive silent
regression here and shows up only on the invoice.

**Vercel AI SDK — clears every hard requirement, and the founder has already shipped it**
(`ai@6.0.190` + `@ai-sdk/react@3.0.192` in `manoa/archive/mobile`). Verified against the docs:
`providerOptions.anthropic.cacheControl` on system parts AND message parts AND tools;
`usage.inputTokenDetails.cacheReadTokens/cacheWriteTokens` (so the `cache_read: 0` tell survives);
`finishReason: 'length'` distinguishable from `'stop'`/`'tool-calls'` (the truncation case);
`thinking: { type: 'adaptive', effort }`; `disableParallelToolUse`; `abortSignal`. No build step.

**And still no, for `apps/api/planner.ts`, on three grounds that are not about capability:**
  1. **No capability gain, and the risk lands on the least testable code.** The value of that module
     is not the HTTP call — it is the six-outcome classifier, telling a rider hanging up from a
     vendor timeout, and the INV-13 guarantee that no vendor error body ever reaches a log
     (`plannerFailure` reads `APIError.type` and nothing else). `finishReason` supplies raw material;
     every one of those mappings still has to exist.
  2. **The agent-loop framing is a spend footgun.** `ToolLoopAgent` defaults to `isStepCount(20)`.
     On a path where one anonymous rider request MUST equal one billed call (INV-11), an abstraction
     whose natural mode is multi-step is the wrong thing to sit beside. `streamText` is single-step,
     but the surrounding API invites the other shape.
  3. **`display: 'omitted'` is unverified.** The docs list `'summarized'`; this code deliberately
     uses `'omitted'` because rider-facing text must never carry reasoning (INV-8). Prove it first.

⚠ **The client is a bigger commitment than it looks, and would NOT fix the lag.** `apps/mobile` does
not talk to a model — it talks to `POST /drives/plan`, which emits custom SSE frames (`event: say`,
`event: turn`). `useChat` expects the SDK's own data-stream protocol, so adopting it means changing
the WIRE CONTRACT and coupling both halves to the SDK. And manoa's smooth chat was not `useChat`
doing the work: [docs/designs/chat-render-performance.md](docs/designs/chat-render-performance.md)
found skipper's lag is render architecture (unvirtualized `ScrollView`, unmemoized rows, composer
state at the screen root). Steps 4-7 there fix it with no new dependency. Adopt the SDK as an
architecture decision if at all — never as a performance fix.

**If it is ever revisited, start at `packages/studio`**: many structured batch calls (`enrich`,
`classify-treatments`, `curate-places`, the eval judges), all forced-tool-use JSON extraction, no
latency or cache pressure, and it never deploys to Cloud Run. That is where the leverage is.

## Test-suite sweep (2026-08-02) — 94 files, ~1,240 tests

**Nothing was deleted, and that is the finding.** A sweep for stale/redundant tests came back
almost empty; what it found instead was two packages that were invisible to the runner.

Checked, so nobody repeats it: every test file grepped for the concepts 1.1 deleted (roam,
`jokeLevel`, `areaCapable`, `clientCan`, `CLIENT_CAPS`, `drive_demand`, paid tiers, authored tours)
— **every hit is either a regression guard asserting the old thing is GONE, or prose in a comment.**
Zero `.skip`/`.todo`/`xit` anywhere. Every mounted API route has at least one test file. The 10
files using `mock.module` follow the documented fix (spread the real module and delegate when idle);
one refuses to mock at all and says why; one uses a source assertion instead and says why.

✅ **THE REAL FINDING — coverage by omission.** `@skipper/routing` and `@skipper/storage` had no
`test` script, so `bun --filter '*' test` skipped them **silently** and they read as covered. Both
now have one (`f06ce85`, `1fc602c`): the polyline decoder (mutation-checked — an axis swap fails 5
of 7) and the MIME map that had already drifted once in production. ⚠ **When adding a package, add
its `test` script in the same commit** — an absent script is indistinguishable from a passing suite.

- [x] ~~Add: `materializeRoute`'s response parsing~~ — **DONE 2026-08-02 (`c871855`).** Split
      `buildRoutesRequestBody` + `shapeRoute` out of the fetch (no behaviour change; the timestamp is
      passed in rather than read from the clock). 13 tests, and the proto3 `?? 0` guard is
      MUTATION-CHECKED — a bare cast fails exactly one test. `@skipper/routing` went 0 → 20 tests.
- [x] ~~Add: `useLocationPriming`~~ — **DONE 2026-08-02 (`9a65ed5`).** Rules moved to
      `src/lib/location-util.ts`, 7 tests. MUTATION-CHECKED: dropping `|| perm.reduced` fails exactly
      one test. ⚠ The rule worth knowing before touching that hook: **granted-but-REDUCED is a
      denial** — `granted` is TRUE on that branch, so a check reading only `granted` compiles clean
      and starts a live drive on approximate location, which fires stops in the wrong place and reads
      as broken triggering rather than a permission problem.
- [x] ~~Consider: `apps/site` has 0 tests~~ — **DONE 2026-08-02 (`5abf697`)**, and it was the THIRD
      package the runner was skipping for want of a `test` script. 5 tests: the three App Store pages
      exist, none has been emptied to a stub, and every `mailto:` across `src/pages` is
      `hello@skipper.fm` (with a negative guard on gmail.com / `feedback@` / example.com — `feedback@`
      shipped in builds 15 and 16). ⚠ Scoped to `src/pages` deliberately: the personal address is a
      legitimate ACCOUNT IDENTITY elsewhere (GCP, IAP, Expo) and a broader rule would break logins.
- **Judged NOT worth changing:** `studio/test/geo.test.ts` re-tests `haversineMeters` /
  `cumulativeMeters` through studio's re-export, duplicating `engine/test/geo.test.ts`. It is ~4
  tests of ~1,240, it pins that the re-export still resolves, and deleting passing tests to lower a
  number is not an improvement. `packages/sim` having no tests is fine — it is a dev tool.

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
      `bun run check`", in a repo where several agents share one working tree. **This was finding #1 of
      the diligence pass** — ESLint went first only because it catches bugs the same afternoon.
      ⚠ **DO NOT ACT ON THIS ENTRY — it is SUPERSEDED, and its prescription was overruled.** This item
      originally asked for a GitHub Action on push/PR. The founder call of 2026-08-03 (see *Production
      ops hardening*, the ⏸ DEFERRED test-gate item) rules that out explicitly and for a reason the
      "~30 lines" framing missed: **an Action cannot stop an independent Cloud Build trigger**, so it
      would report a red check beside a deploy that had already gone out — the appearance of a gate
      without the function of one. The agreed fix is `bun run check` as **step 0 in `cloudbuild.yaml`**,
      and it is **DEFERRED until after the on-device verification pass** because the fix edits the
      release path. Kept rather than deleted only so the finding's provenance survives; the deferred
      item is the live one.
- [x] ~~The four hooks that own the risky behaviour have zero coverage~~ — **PREVIEW HALF DONE
      2026-08-02.** `src/lib/preview-util.ts` (`0531085`) now owns the decisions both preview players
      share, with 14 tests; extracting them proved the two siblings had already drifted, and `ffac245`
      fixed the three defects that found in `useStopPreview` (no session hand-back when a clip ran out
      → the rider's music stayed dead; none on a failed play; and NO reader for async failure at all,
      so an expired presign left a row lit "now playing" in silence forever).
- [x] ~~Still uncovered: `useDrive`~~ — **the extractable part is DONE 2026-08-02 (`c886064`).** The
      fire-queue pump moved to `@skipper/engine`'s `decidePump` with 7 tests pinning the check ORDER,
      which is where its two unrecoverable failures live: overlapping clips, and a drive that ends
      while a stop the rider paid for is still queued.
      ⚠ **I deliberately stopped there, and the reason matters more than the stopping point.** What
      remains in `useDrive` is side-effect orchestration and vendor interaction — `finishDrive` is a
      straight-line teardown with no branch in it (and it already hands the audio session back
      correctly); the stall ladder already routes through `decideStall`; seeks already route through
      `clampSeekSec`/`seekTargetReached`. Extracting further would produce pure functions that exist
      to raise a coverage number rather than to hold a rule, which is the failure mode this whole
      pattern is supposed to avoid. **If you want more confidence in `useDrive`, the honest next step
      is a device pass or jest-expo + RNTL — not more extraction.**
- [x] ~~`useLocationPriming` is still uncovered~~ — DONE 2026-08-02 (`9a65ed5`); see the test-sweep
      section above for what the two extracted rules are and why both directions are load-bearing.
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
- [x] **Standing regression test for any persona-prompt change — BUILT 2026-08-03, free + read-only.**
      `audit-loudness --json <path>` saves a measurement run; `--baseline <path>` diffs a later one and
      exits 1 on any clip that collapsed and did not before. Pure half + 16 tests in
      `pipeline/audit-baseline.ts`. The workflow is: capture → change the prompt → regenerate the same
      places → diff. **Nothing runs it automatically** — a paid regeneration is founder-gated, so this
      is a tool an operator reaches for, not a gate in `check`.
      Three disciplines are enforced in code because each already produced a wrong conclusion here:
      rates are computed on the INTERSECTION (a queue that changed between runs silently re-prices the
      comparison); `collapsed` is re-derived from the stored dB against ONE threshold on both sides
      (never two stored booleans — the `prune-corpus --restore` bug class); and an unmeasured clip
      LEAVES the comparison and is named rather than counting as "did not collapse".
      MUTATION-CHECKED: counting the numerator over the whole current queue fails exactly 2 tests.
      ⚠ The noise floor is `tail.ts`'s existing `STRUCTURAL_RETAKE_EPSILON_DB`, not a second number.
- [ ] **⚠ …and the tool it is built on is SOLO-ONLY, which nobody had written down.** `audit-loudness`
      inner-joins `pois`, so the **34 fused cluster tellings** (`poi_id` NULL) are never measured — and
      `resynth-narration` is poi-keyed, so it could not repair them even if they were. Fused clips are
      where tail collapse was WORST (35% at n=31 before the closer rule shipped, vs ~2% solo), so the
      blind half is the half with the history. Named in both headers + the SOP table 2026-08-03; the
      real fix is subject-keyed measurement + resynth, which is a build, not a flag.
      ⚠ Read a clean `audit-loudness` run accordingly: it is a statement about the SOLO corpus only.

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
      - [x] **Blast labels that under-declared their eval-row writes — ALL THREE FIXED 2026-08-03.**
            `generate-narrations.ts --scripts-only` was the reported one and was already widened. ⚠ The
            same defect was live on TWO SIBLINGS, found only by checking every `announce` call rather
            than the one named: `generate-cluster-narrations` (its PREVIEW records a dry eval run —
            deliberately, so withheld clips stay queryable — while declaring `SPENDS $` alone) and
            `audit-corpus` (`--apply` writes `eval_runs` + `eval_scores` while declaring `SPENDS $`
            alone). Both widened, header prose + `ops-scripts-sop.md`'s conformance table with them.
            Solo-vs-cluster again — the axis CLAUDE.md says keeps getting missed.
            ⚠ Deliberately NOT widened: `judge-voice` (writes only a local markdown file) and every
            CLI's `runJob` bookkeeping row. If job rows counted, every label would read MUTATES DB and
            the field would stop carrying signal — `blast` means CORPUS/observability rows, not the
            job's own ledger.
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
      - [x] ~~**Latent: a DEGENERATE hull that needs an area is dropped to silence.**~~ **MOOT — the
            AREA path was deleted with roam (1.1).** No hull is minted or served, so there is no
            degenerate-ring guard to trip. Kept for the ONE measurement that outlives it and would
            otherwise be re-derived: ⚠ **the quantity that matters in cluster geometry is DISTINCT
            ANCHORS, not members** — `speakableLat ?? lat` snapping co-locates points routinely
            (Truckee is 4 members over **2** distinct anchors), so any future extent work must triage
            by distinct anchors. The three clusters over `CLUSTER_MAX_TRIGGER_RADIUS_M` (Downtown Reno
            914 m, UNR 903 m, Historic Homes 698 m) are still the ones `clusterGenerationBlock`
            refuses, which is what keeps a capped point from mis-placing a district. As measured:
            `clusters.ts`
            refused to serve a `ring.length < 3` area ("no honest polygon"). Measured: 16 clusters hull
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
            ⚠ Superseded by a read-only DB count on 2026-08-02: the corpus now holds **37 fused
            tellings, all released** (32 cluster + **5** district, 75.0 min). Trust the DB, not this
            line — the fused-generation spec's Status carries the same corrected figure.
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

## The version gate's store link is dead in the CURRENT window (2026-08-03) — closes with the 1.1 release

`apps/api/src/version-policy.ts` justifies its App Store link with "it resolves by construction at
the only moment it's used": the wall can only fire once a floor is raised, and a floor can only be
raised once there IS a published version. **That condition is not met right now.** Verified
2026-08-03: `apps.apple.com/app/id6778946770` → **404**, iTunes lookup `resultCount: 0` — nothing is
published (1.0.0 is `DEVELOPER_REJECTED`).

The case that breaks the argument is the one live today: a DEAD TESTFLIGHT CLIENT. Build 16 calls
`/roam/*`, which the 1.1 API 404s (confirmed against prod) — a real reason someone would reach for
the gate BEFORE publication, which is the one window where its only button goes nowhere. And for a
TestFlight tester the App Store was never the right destination anyway; TestFlight updates its own.

**Founder call 2026-08-03: leave it — the 1.1 build is imminent and closes the window.** Recorded so
the comment's guarantee is not read as unconditional by whoever reaches for the gate mid-release.
⚠ 1.1.0 reached TestFlight 2026-08-03, newest build **20** (17 failed, 18 cancelled, 19 superseded —
`autoIncrement` burns a number at QUEUE time, so never predict one; read it back). Delete this entry
once the listing is live (the argument becomes true again) — or act on it if the release slips and
testers need a clean wall instead of bare 404s.

## `apps/api` diligence pass (2026-08-02)

Read the whole surface — mount order, limits, credits, erasure, planner config, logging. **It is in
unusually good shape**; almost every hazard is already documented at the line where it lives, usually
with the measurement that settled it. Two things came out.

✅ DONE (`8de0827`): nothing guarded that account ERASURE stays complete. `purgeUserData` hard-codes
`drives` + `credit_entries`, both SOFT refs with no FK and no cascade, so a third `user_id` table
would be erased by nothing and fail nothing — under an App Store 5.1.1(v) requirement. Now
schema-introspected and mutation-checked.

- [x] ~~`GET /regions` has no rate limit~~ — **ADDRESSED 2026-08-02 (`928cb1a`), and the fix was not a
      rate limit.** The route was paying an auth-DB session read plus TWO SEQUENTIAL queries on every
      app launch to answer a question that changes only when an operator releases a region. The two
      changes that stand: the queries now run in PARALLEL, and the rider payload is MEMOIZED for
      `REGIONS_MEMO_TTL_MS`. A burst costs one pair of queries per instance per minute.
      ⚠ A third change — making staged preview opt-in via `?includeStaged=1` to dodge the session read
      — was **REVERTED in `ecc30f7`**: it only did the server half, so the client never sent the param
      and in-app staged preview silently stopped working. The session read is a real cost and it has
      its own item above; it is not this route's to solve.
      ⚠ **The memo sits in front of a RELEASE-GATED endpoint**, which is the shape that leaks
      unreleased content. `canPreview` gates both the read and the write — an admin never reads the
      memo and never fills it — pinned in `test/regions-cache.test.ts` and mutation-checked on both
      gates. Do not add `Cache-Control` here: a shared cache serving the staged variant is the exact
      failure that test exists to prevent.
- [x] ~~The session read on every `withSession` route~~ — **DONE 2026-08-02 (`7bd7614`), founder call.**
      `session.cookieCache` is ON at **`maxAge: 60`**, so `getSession()` validates a signed copy from
      the cookie instead of a round-trip to the separate neon-serverless Pool, on `/regions` and every
      `/drives*` request. Grounded in the INSTALLED better-auth 1.6.23 source, not the docs alone.
      ⚠ **60, not the library's 300 default, and the number is the whole decision.** Cookie caching
      delays REVOCATION by `maxAge` — the server cannot delete a cookie on a device it is not talking
      to. The sharp edge is ACCOUNT DELETION: a second device holding a cached cookie can still
      authenticate for the window, and a WRITE there inserts a row against a user id `purgeUserData`
      already erased — the orphan INV-4 and 5.1.1(v) exist to prevent, with no FK to catch it. 60s is
      a deliberate 5× reduction of that window. `test/auth-cookie-cache.test.ts` fails if either
      `enabled` or `maxAge` drifts, because both are silent when they do.
      ⚠ The anonymous→account link does NOT open a matching hole despite also hard-deleting a user
      row: a stale cached ANONYMOUS session still resolves to `tier: 'anonymous'`, so `requireAccount`
      401s it before any write.
- [x] ~~**PLAN (2026-08-02): close the cookie-cache deletion window**~~ — **DONE 2026-08-02 (`5b2286d`),
      option 2; the plan and the two ruled-out alternatives are kept below because re-proposing option 1
      is the live hazard.** ⚠ **SCOPE WAS BIGGER THAN "WRITE PATHS" — the first framing was wrong.**
      **The finding that changes it:** `GET /drives` — a READ route — calls `ensureFreeGrant`
      (`drives.ts:1018`), which INSERTS a `credit_entries` grant row. So "a read cannot orphan
      anything" is false, and this is the *more likely* orphan path than `POST /drives`: the home
      screen hits it on every launch, while creating a drive is rare and rate-limited. A deleted
      rider's second device hitting the home screen inside `maxAge` writes a grant row keyed to a user
      id that no longer exists — into an APPEND-ONLY ledger with no second copy and no FK to catch it.
      **The exposed set is exactly two routes**, both behind `requireAccount`: `POST /drives` (inserts
      `drives` + a consume + `ensureFreeGrant`) and `GET /drives` (`ensureFreeGrant`). The other three
      owner routes — `GET /drives/:id`, `POST /:id/assets/sign`, `DELETE /:id` — only ever touch rows
      that `purgeUserData` has already removed, so they 404 and orphan nothing. They can stay cached.
      **Three ways to close it, cheapest first:**
      1. ~~Drop the lazy grant from the READ path.~~ **RULED OUT 2026-08-02 — do not re-propose.** I
         had this as the elegant option on the theory that `auth.ts:364`'s signup hook made the lazy
         call legacy scaffolding. `7069b86` says otherwise, explicitly: "ADDITIVE, not a swap.
         `ensureFreeGrant` stays on the read/spend paths in ./drives as the backstop: **the signup
         hook swallows its own errors** (a ledger write must NEVER fail account creation — the account
         is already committed by then), and any future user-creation path that bypasses the hook still
         can't produce a credit-less account." So it is a LIVE safety net, not scaffolding: if a
         signup grant write fails, the hook continues silently and the lazy path is the only thing
         that ever recovers that rider's credits. Removing it strands them at 0 forever, to close a
         60-second race. Wrong trade.
      2. **`withFreshSession` on the two exposed routes.** Mechanism verified in the installed
         better-auth: `auth.api.getSession({ headers, query: { disableCookieCache: true } })` — the
         session route reads `ctx.query.disableCookieCache` and merges it with a `config` argument,
         and `test/auth-cookie-cache.test.ts` already pins that the flag exists so this cannot rot
         silently. ⚠ Shape it as a SECOND MIDDLEWARE, never a boolean on `withSession`: the route
         table in `drives.ts` is what `test/drive-access.test.ts` reads to enforce INV-15, and a
         per-route middleware is visible there in a way an argument is not.
         Cost: one session read on the two hottest owner routes — so signed-in riders give back much
         of the win, while every anonymous surface (planner, propose, sample, regions) keeps all of it.
      3. **Accept it, explicitly.** The window is 60s and needs a two-device delete race. The residual
         artifact is a single grant row with no drives attached. Cheapest, but it leaves personal data
         surviving a deletion request, which is the thing 5.1.1(v) is actually about.
      ✅ **DONE 2026-08-02 (`5b2286d`)** — option 2, founder call. `withFreshSession` on `POST /drives`
      and `GET /drives`; the other three owner routes keep the cache.
      ⚠ **The ordering is the design, and the obvious version is wrong.** It runs LAST — after
      `requireAccount` (and after `createDriveLimiter` on POST) — not first. Leading with it reads more
      correct and hands an anonymous flood an auth-DB query per request, because `requireAccount` is a
      pure in-memory check placed first precisely so a flood costs nothing. The existing route-table
      test caught that on the first attempt.
      ⚠ **Which promotes the handlers' tier-keyed backstops.** A deleted account passes
      `requireAccount` (it decided on the cached session); what rejects it is
      `c.get('tier') === 'free' ? … : undefined` inside each handler, reading the session
      `withFreshSession` just replaced. Those read as defence-in-depth against a dropped gate — they
      are now also what catches an erased user. **Deleting one as "unreachable" reopens the orphan.**
      Guarded by two assertions in `test/drive-access.test.ts`: the exact SET of fresh routes (so a
      third inserting route fails until it opts in, and nobody "optimises" `GET /` off the list for
      looking like a read) and the ordering rule. Mutation-checked.
      A reaper for orphaned ledger rows was considered and rejected — new machinery for a bounded
      race, and CLAUDE.md's wariness about reapers touching rider identity applies.
- [x] ~~Cookie growth is a per-request cost~~ — **MEASURED 2026-08-02, no action.** The payload is
      fully accounted for: three plugins (`expo` adds no user fields, `anonymous` adds `isAnonymous`,
      `admin` adds `role` + `banned`) and no `additionalFields`, which is exactly the nine fields
      probed out of `parseUserOutput`. A realistic signed payload — real UUIDs, a full iOS user-agent —
      measures **~988 bytes, ~76% headroom** under the 4096-byte per-cookie limit.
      ⚠ And the limit is not a cliff: better-auth CHUNKS the cookie (`getChunkedCookie`), so exceeding
      4 KB degrades into multiple cookies rather than breaking. So the rule stands — a new `user` field
      now costs bytes on EVERY request — but the margin is large and the failure is gradual. Not worth
      a test today; revisit only if someone proposes a field that carries free text.
- [x] ~~Trace whether the mobile client's session view can lag the server's~~ — **TRACED 2026-08-02.
      Benign, and narrower than feared.**
      **On the deleting device there is no window at all.** `app/settings.tsx` already does the right
      thing after `deleteUser`: it wipes local downloads and then `await signOut()`, which runs
      better-auth's `deleteSessionCookie` — and that expires the CACHED cookie as well as the session
      token (verified in the installed source). The comment there already says why: "the token still
      sits in this device's SecureStore — clear it, or the app keeps believing it's signed in".
      **On a SECOND device the window is real but harmless.** Its cached cookie stays valid up to
      `maxAge`, so `useSession` reports signed-in — but every owner route now runs `withFreshSession`
      (`5b2286d`), resolves null, and the handler's tier backstop 401s. `api.ts`'s `ApiError.needsAccount`
      maps 401 → the AccountGate, so the rider sees "create a free account", not an error. No data loss,
      no orphan, and it self-corrects when the cache expires.
      ⚠ Recorded honestly: the cache DID widen this from immediate to ≤60s. Without it, the next request
      would resolve from the DB and find the session cascade-deleted. What that buys is a ≤60s
      cosmetically-stale signed-in state on a second device — which is the cost we accepted, now
      confirmed to be the whole of it rather than the visible part of something larger.
- [x] ~~**Optional follow-up: a rate limit on `/regions` as defence-in-depth.**~~ **DONE 2026-08-03** —
      `REGIONS_RATE` (120/60s, founder call), single-sourced in `limits.ts` beside every other
      rider-facing cap, mounted as the named `regionsLimiter`.
      ⚠ **The premise above was WRONG in a way worth keeping, because it argued the item down.** "The
      memo absorbs a burst, so an attacker gets cached bytes rather than DB load" is true of the two
      CORPUS queries and false of the request as a whole: `app.use('/regions', withSession)` runs on
      EVERY request, BEFORE the memo is consulted, on the separate neon-serverless auth Pool. The
      limiter is therefore mounted ABOVE `withSession`, and that order is the whole value: below it,
      the cap would still return 429s while bounding nothing. Pinned + MUTATION-CHECKED in
      `test/limiter-mounts.test.ts` (swapping the two mounts fails exactly one test).
      ⚠ **AND THE FIRST FIX GOT THE COST WRONG TOO — corrected 2026-08-03, same day.** It claimed every
      request pays an auth-DB round-trip, taken on trust from an `index.ts` paragraph that `7bd7614`
      obsoleted FIVE MINUTES after `ecc30f7` wrote it (cookie caching landed in the very next commit;
      ./auth runs `cookieCache: { enabled: true, maxAge: 60 }`). Verified against the installed
      better-auth 1.6.23 instead: no cookie or a bad signature → null, no DB; valid token + valid
      `sessionData` → served from the cookie, no DB; DB only when a validly-signed token arrives
      WITHOUT usable `sessionData`. The cap still earns its place, on the sharper ground that the
      remaining path is **attacker-controlled** — mint an anonymous session, then send the token and
      omit `sessionData`, and every request reaches the auth DB. ⚠ The lesson, since it bit twice in
      one session: a comment asserting a runtime cost is a CLAIM, not a source. Check the code it
      describes.
- [ ] **The SAME auth-DB path is uncapped on the `/drives` owner routes — found by the 2026-08-03
      guard-ordering audit, NOT fixed (a new rider-facing cap is a founder call, CLAIM/STOP).**
      `driveRoutes.use('*', withSession)` runs for every `/drives/*` route, but only `POST /` carries
      a limiter (`createDriveLimiter`). `GET /`, `GET /:id`, `POST /:id/assets/sign` and
      `DELETE /:id` have none — so the attacker-controlled resolve described above (a minted anonymous
      token sent without `sessionData`) reaches the auth DB on those routes too, uncapped, and only
      THEN gets its 401 from `requireAccount`. ⚠ `withSession` cannot simply be moved below
      `requireAccount` to dodge this — `requireAccount` READS the session that `withSession` sets, so
      that order is required, not incidental. The options are a limiter on the `/drives` mount or
      accepting it; both are decisions, not refactors. Cheapest framing: it is the same class as the
      `/regions` item above, on routes that are already behind a wall.
      ⚠ Everything ELSE the audit checked came back correct and deliberate: the CORS preflight sits
      ahead of the Better Auth handler; the plan and propose limiters sit above the `/drives` sub-app
      mount (pinned); `requireAccount` precedes `createDriveLimiter` on `POST /drives` by design;
      `withFreshSession` runs after the limiter, so a throttled request never pays the fresh resolve;
      and in `apps/admin`, `csrf()` precedes `requireAdmin` deliberately with both ahead of every
      route. No second instance of the `/regions` bug exists.
      Generous on purpose — caps key on client IP and CGNAT puts many riders behind one address, on
      the launch path. The graceful-degrade note above still holds (`region-cache.ts`).

## Production ops hardening — from the 2026-07-30 ship-readiness audit

None of this is a build; all of it is config. The premise changed on 2026-07-28: 1.0.0 is submitted, so
"prod has no users" stops being true on approval (see CLAUDE.md's storage rule, rewritten the same day).

- [ ] **⏸ DEFERRED (founder, 2026-08-03): there is NO test gate in front of production.** There is no
      `.github/` in this repo at all, and `cloudbuild.yaml` runs docker build → push → deploy with **no
      `bun run check` step** — so a push deploys prod at **100% traffic** with nothing having run the
      suite. Held until after the on-device verification pass, deliberately: the fix edits the release
      path, and editing the release path is the last thing you want to be doing on the way to a ship.
      **The fix when it lands: `bun run check` as step 0 in `cloudbuild.yaml`** — ⚠ *not* a GitHub
      Action. An Action cannot stop an independent Cloud Build trigger, so it would report a red check
      beside a deploy that already went out; only a step inside the build that deploys can gate it.

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
- [x] ~~**Alerting — there is NONE.**~~ **BUILT 2026-08-03.** Prod 500'd for **14 days**
      (2026-06-30 → 07-15, billing disabled) and was found by a human running `curl`; that is now
      caught in ~5 minutes. Live in `lithe-window-491818-k8` (console-only — these are NOT in git,
      which is the same invisibility that hid the max-instances default, so they are recorded here):
      - Uptime check `skipper-api /health` — `https://api.skipper.fm/health`, 300s period, 10s timeout.
        ⚠ It matches on the BODY (`"ok":true`), not just the status class, so a 200 that is not
        actually healthy still trips it.
      - Alert policy `skipper-api /health is DOWN` — fires when `check_passed` is false in **more than
        one** probe region (`REDUCE_COUNT_FALSE > 1`), so a single flaky region does not page. Carries
        runbook `documentation` inline: revision check, the ⚠ REGIONAL builds list, and the
        `update-traffic` rollback one-liner.
      - Email channel `Skipper prod alerts (email)` → `hello@skipper.fm`.
      ⚠ **STILL UNPROVEN: that the mail is READ.** The channel reports enabled with an unset
      `verificationStatus`, which is not the same as a delivered message — the open inbox item above is
      what closes this, and until then a page can fire into nothing. **Send yourself a test alert.**
      ⚠ **Admin is deliberately NOT checked**: `skipper-admin` sits behind IAP, so an unauthenticated
      probe gets a redirect, not a health signal. It needs `--service-agent-auth`, which is its own
      piece of work.
- [x] ~~**GCP billing budget + alert.**~~ **BUILT 2026-08-03.** The Budget API was not enabled at all;
      it is now, and there is a budget where there were zero. Billing — not code — is the documented
      root cause of the only real outage this project has had, and after 1.1 step 8 this is the ONLY
      control anywhere that bounds AGGREGATE spend (every cap in `limits.ts` keys on client IP, so each
      bounds one caller and none bounds the total — [rider-spend-exposure.md](docs/research/rider-spend-exposure.md)).
      `Skipper — monthly spend tripwire`, **$1,000/mo** (founder, 2026-08-03 — raised from the $100 it
      was created at), scoped to this project, on billing account
      `019BCA-9D6FC9-B3E1DC`. Thresholds **50 / 90 / 100 % actual + 100 % FORECASTED** — the forecast
      rule is the one that matters, because it fires partway through a runaway month instead of after it.
      ⚠ **A BUDGET IS AN ALERT, NOT A CAP. It does not stop a single request or a single dollar.** GCP
      has no hard spend limit; the things that actually bound spend are `maxScale`, the rate limiters
      and `max_tokens`. Do not let this entry read as "spend is now handled".
      ✅ Its delivery does NOT depend on the unproven `hello@skipper.fm` inbox: it notifies that channel
      AND, because `disableDefaultIamRecipients` is false, every billing-account admin by default.
      **The number is CHOSEN, not measured** — recorded costs in `docs/` run $0.04–$10 per operation.
      ⚠ At $1,000 the first alert lands at **$500**, which is orders of magnitude above any plausible
      normal month, so read this as a **catastrophic-runaway tripwire, not an early warning**: a
      leak burning $50/mo forever would never fire it. That is a deliberate trade for silence.
      Re-price with:
      `gcloud billing budgets update b0c32259-f947-4a8a-a612-53f1ee8c4897 --billing-account=019BCA-9D6FC9-B3E1DC --budget-amount=<n>USD`
- [x] ~~**Set `--max-instances` on the API deploy**~~ — **DONE 2026-08-03** (`cloudbuild.yaml:73`,
      `--max-instances=3`, plus the service-level `maxScale: 3` applied out of band). RISK-4's
      "limit × live instances" multiplier was Cloud Run's **default of 100** — a number nobody chose,
      appearing nowhere in the repo — and is now 3. Arithmetic:
      [rider-spend-exposure.md](docs/research/rider-spend-exposure.md); the min-vs-max asymmetry is in
      the deploy guide's *Scaling* section.
- [ ] **`PLAN_RATE_HOUR`'s window is still not durable** — related to the above but NOT fixed by it,
      and ⚠ **partly changed on 2026-08-03, so re-read before quoting the old version.** The window
      lives in an in-memory map that dies with the instance. `minScale: 1` now holds one instance warm,
      so the hour cap survives idle periods it previously did not — but this is mitigation, not a fix:
      the instance still recycles on deploy and on any Cloud Run-initiated replacement, and at
      `maxScale: 3` there are up to THREE independent maps, so the effective hourly ceiling is still
      the limit times the live instance count. A shared store is the real fix; `rate-limit.ts` puts it
      at M4.
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
- [x] ~~**`apps/api/Dockerfile` never copies `bun.lock`** → `COPY bun.lock` + pin dotenvx~~ —
      **⛔ REFUTED 2026-08-03. DO NOT ACTION THIS. The prescribed fix BREAKS PRODUCTION DEPLOYS**, and
      that is not a prediction: `apps/api/Dockerfile` (the comment block above the install step) records
      it TESTED on 2026-07-30. `bun install --production` implies `--frozen-lockfile`, and the build
      REWRITES `package.json` to trim `workspaces` to the api's closure — exactly the change a frozen
      lockfile refuses (`error: lockfile had changes, but lockfile is frozen`). `--no-frozen-lockfile`
      did not clear it. ⚠ **This entry was itself the second time an audit prescribed it**; the
      Dockerfile comment exists because the first prescription would have taken deploys down.
      The dotenvx half was simply WRONG: it is pinned exactly (`@dotenvx/dotenvx@2.14.0`), and the
      comment there calls it the one pin in the image that most deserves it.
      **If exact pinning is ever wanted the real shape is a PRUNED lock** — trim workspaces,
      `bun install`, commit that lock as its own file, COPY it — a deliberate trade (a second lockfile
      to regenerate on every dependency move), not a one-liner. Read the Dockerfile before re-opening.
- [ ] **Cloud Run `--cpu` / `--memory` are still defaults** (`cloudbuild.yaml`). ⚠ Narrowed 2026-08-03 —
      the SCALING half of this item is DONE and should not be re-raised: `--max-instances=3` is in the
      deploy step, and the service-level `maxScale: 3` / `minScale: 1` were applied out of band
      (the min/max asymmetry is deliberate and documented in `cloudbuild.yaml`'s header + the deploy
      guide's *Scaling* section). `minScale: 1` also closed the cold-start-plus-Neon-wake this item was
      originally about — 4.2 s → 0.23 s, measured. What is left is only the resource shape, which is
      worth setting only if a real workload says the defaults are wrong.
- [ ] **Neon PITR / backup retention is unverified** and lives nowhere in git. It is the only thing
      between a mistaken migration and permanent loss of the append-only `credit_entries` ledger, which
      never refunds and has no second copy.
      ⚠ **FOUNDER-OWNED, ~2 min — it CANNOT be checked from this repo** (verified 2026-08-03): there is
      no `NEON_API_KEY` in either env file and no Neon CLI installed, so the control plane is
      unreachable from an agent session. Project endpoint is `ep-super-shape-aqvlhvto`, AWS
      `us-east-1`, db `neondb`.
      **Where:** Neon Console → **Settings → Instant restore**. It is ONE project-wide history window —
      not per-branch — and PITR restores only from ROOT branches
      ([neon.com/docs/introduction/point-in-time-restore](https://neon.com/docs/introduction/point-in-time-restore)).
      **What the answer means** (checked against Neon's docs 2026-08-03, not memory): **Free defaults to
      6 HOURS**, capped at 1 GB of changes; paid plans default to 1 day; Launch/Scale raise to 7 days;
      Business/Enterprise 30. ⚠ **If this project is on Free, the real window is six hours** — a bad
      migration run in the evening and noticed the next morning is simply gone, and D4 now permits
      destructive migrations. Record the plan AND the window here once read.
- [ ] **The corpus snapshot — the OTHER half of that net — is 3 days stale.** Last one is
      `packages/studio/.scratch/snapshot-2026-07-31/`, taken `2026-07-31T14:53:52Z` and COMPLETE (458
      narrations / 785 R2 objects, 0 failed, 0 missing clips). ⚠ It **predates both the 1.1 production
      cutover (08-02) and migration 0043 (08-03)**, and its `drive_demand` rows are a table 1.1 removed
      — so it restores a schema that no longer exists. `snapshot-corpus` is READ-ONLY and spends nothing
      (no `--apply` gate by design), so re-running it is free; the STOP rule wants a current one before
      any destructive step, and there has been one since.

## ✅ CLOSED — the amber puck under-contrasted on the DAYLIGHT basemap (2026-08-03)

Kept as the record of how the map-contrast class was finally closed, because the shape recurs.

**Was:** `amberToken` in daylight is `#DD7A33` on paper land ≈ **2.47**, under the 3:1 graphical bar
(WCAG 2.1 SC 1.4.11), and its `surface` ring could not help — on the map `surface` **IS** the land, so
the ring measured 1.00 there in both themes. It was deferred because fixing it meant touching the live
drive's puck; the founder then asked for the whole class closed.

**The fix, and the part worth remembering:** swapping the ring to `ink` is the obvious move and it is
WRONG — measured, it repairs land (1.00 → 12.99) and breaks the lake (4.69 → 2.77), which the gate
caught immediately. Day land is pale and day water is dark, so no single edge colour clears both, the
same way no single stroke colour could carry the route line. The answer is a **two-tone edge**: an
inner `surface` ring inside an outer `ink` hairline. `ink` is the inverse of `surface` in both themes,
so the pair covers pale and dark layers at once — which is how a map pin has always been built.

`amberToken` is now IN `MAP_MARKS` in `apps/mobile/src/theme/theme.test.ts`; the exclusion comment that
used to point here is gone. All four instances of the class (water labels, the route polyline, `passed`
markers, `upcoming` markers) plus this one are closed, and the gate covers every mark on every layer.

## When YOSEMITE ships: the metadata that goes stale (founder ask 2026-07-28)

Content is SERVER-SIDE, so a second region goes live with no app release. That is the whole problem:
the corpus changes underneath a listing that still says Tahoe-only, and nothing forces the two back
into agreement. Trigger this list the day Yosemite narrations are RELEASED (`released_at` non-null, so
a built drive can serve them), not the day generation finishes.

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

🔴 **The roam PACK (2026-07-30) is deleted** along with the mode — `roam-pack.ts`, `roam-pack-util.ts`
and `useRoam` are gone. Two things it proved were harvested rather than lost, and both are the reason
the subject-keyed store looks the way it does:

⚠ **Bytes and their index ship together, deliberately.** A cached entry whose bytes never landed
fires its trigger, buffers for `CLIP_STALL_MS`, and skips in silence — a rider watching a spinner.
Only entries with audio ON DISK may be narrated from a saved artifact; the filter is the feature, not
a detail. (The pack's other half — a saved shape from which `url` is structurally ABSENT, so
persisting a presigned credential is a compile error — was carried forward verbatim as `Saved<T>` in
`offline-util.ts`.)

- [ ] **Mid-session signal loss still costs ~24 s of dead air per stop for a clip the phone does
      NOT hold** (3 s skeleton → 12 s stall → one futile recovery → 12 s stall → `onClipDone`), and
      `sawFresh` never flips so the progress pill stays at 0 — no evidence anything was even
      attempted. Unchanged for a rider who did not save the drive; a saved drive sidesteps it entirely.

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
Mostly no — a drive's audio IS the shared corpus (the same clips ride every rider's drive, and one of
them is served to anonymous riders as a preview), so the only account-specific part is the route/label,
a few KB of JSON. Scoping drives to a user while the (then device-scoped) pack was not applied two
rules to the same bytes.
Where it DOES matter is account DELETION — and the sweep missed exactly that case, because after
`deleteUser` the rider is anonymous, so the owner reconcile never fired while `listDownloadedDrives`
would hand the deleted account's drives to the next person holding the phone. `deleteAllDriveDownloads`
now runs in the delete-account flow.
`sweepUnknownDownloads` went too: if it were ever wrong the rider loses every saved drive silently,
possibly right before Tahoe, and all it bought was disk reclaimed from a drive deleted on another
device. Nothing in the app deletes downloads automatically now except that one erasure path.

- [ ] **⚠ The gap that follows: leftovers sit until the rider removes them** — a drive deleted on
      another device, a previous account's, or one this build can't read. And a drive missing from
      the server list can't be tapped into, so the per-drive Remove is unreachable. A Settings
      "free up space" line is the honest fix; NOT built yet, pending the direction below.
- [x] ~~**⭐ DIRECTION (founder 2026-07-31): treat downloads as REGION PACKS, not per-drive.**~~
      **RESOLVED, and NOT as written: the REGION PACK was CUT (1.1 D21).** The double-storage it
      targeted is gone anyway — deleting roam removed one filing system and step 9's subject-keyed
      clip store removed the other (bytes keyed by narration SUBJECT ID, shared across drives). Why a
      pack could never have replaced the per-drive top-up is D1 in
      [docs/designs/offline-region-packs.md](docs/designs/offline-region-packs.md), which survives as
      INV-6. The `revisedAt` prerequisite died with `roamPin`.
- [ ] **Verify on a real device.** None of the offline work has run on hardware. Two specifics: a
      COLD LAUNCH in airplane mode (the listener arms at import, but home's `load()` may still beat
      the first pushed event — if it reproduces, the bounded fix is a one-time race against a ~250 ms
      delay inside the FIRST `fetchJson` only; ⚠ never an await on `getNetworkStateAsync`, see the
      landmines), and a real Tahoe drive running off a saved DRIVE download.
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

- [x] **The three drafts are WRITTEN — `docs/guides/upstream-wikipedia-corrections.md` (2026-08-03).**
      All three errors were re-verified as still LIVE first (each row's `find` string still present in
      the article's current extract), so none of this is stale. Filing is the human's half.
      ⚠ **Three things the re-verification changed, and they are why the drafts are not equally
      filable** — the row summaries here were taken on trust and two of them do not survive contact:
      - **Emerald Bay / Palme is now the EASY one, on evidence nobody had noticed.** The sentence's own
        cited footnote (an archived vikingsholm.org page) already reads "her nephew by marriage,
        Lennart Palme, a Swedish architect" — so the article contradicts its own source and needs no
        new one. ⚠ But the row's stated reason is WRONG: Wikipedia's Vikingsholm article names **no
        architect at all** (0 occurrences of "Palme", checked 2026-08-03), so do not argue from it —
        fix the row's `reason` in the admin console. ⚠ And `vikingsholm.com`, the row's `source_url`,
        did not respond at all on 2026-08-03 (two clients) — do not cite a dead link.
      - **Pope Estate is wrong in TWO places, not one.** The infobox also carries
        `built = {{Start date|1884}}`, which the override cannot reach (it is a find→replace on the
        fetched EXTRACT, and the infobox is not in it). An upstream fix must cover both or the article
        contradicts itself. taylortallac.org verified live and says exactly what the row claims.
        ⚠ Expect the 1884 to trace to the NRHP nomination (`refnum 87000495`) — pull it before posting.
      - **Chambers Lodge is the weak one and is drafted as a QUESTION, not a correction.** The 1854
        claim is CITED (a 1968 newspaper item), and our source is `donsnotes.com` — a personal notes
        site, not a Wikipedia RS. It will not displace a newspaper citation on its own. The row also
        names Rubicon Trail Foundation / tahoecountry.com / L.W. Currey; **none was re-verified**, and
        finding one that qualifies as an RS is the real prerequisite. ⚠ Our LOCAL override stays
        correct either way — we are grounding a narration, not writing an encyclopedia.

NOT this list: the Tahoe Keys row is RETIRED (`active = false`, 2026-06-10) — Wikipedia already
removed the dated construction sentence, so there's nothing left to file.

- [ ] **Human: review + file the three drafts**, then set each row's `upstream_status` → `filed`
      (+ `upstream_url`) in the admin console. ⚠ Filing does NOT retire the local override — the fix
      has to land upstream AND propagate through a re-fetch; the pipeline's unmatched-`find` warning is
      the signal to retire, and `active = false` is how (never a delete).

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

## A round trip goes QUIET on the return leg (founder ask 2026-08-03)

Founder: *"round trip routes should probably include POIs going both directions so it isn't completely
quiet on the return trip."*

- [ ] **Give the return leg something to say.** The mechanic, traced before writing this so nobody
      re-derives it:
      - A round trip IS a real out-and-back — `toPlannedRoute` (`apps/api/src/plan-route.ts:100-105`)
        maps the model's `round_trip` to `{ start, end: start, via: [...via, end] }`, so the frozen
        polyline genuinely contains BOTH legs (`start === end` alone would materialize degenerate).
      - But **a candidate is snapped ONCE**. `buildRouteSnapper` (`packages/engine/src/pacing.ts:39`)
        calls `nearestOnRoute` (`packages/engine/src/geo.ts:155`), which scans every vertex and keeps
        the single globally-nearest one. So one POI ⇒ one `alongSec` ⇒ **at most one stop, on whichever
        leg won** — and its comparison is a strict `<`, so an exact tie breaks to the LOWEST index,
        i.e. the OUTBOUND leg. Where Google returns lane-level-different geometry per direction it is
        closer to a coin flip per POI, so the return gets a scattered few rather than literally none.
      - ⚠ **The direction-independent statement is the durable one:** a round trip has roughly HALF
        the stop density of the equivalent one-way over the same road, because the candidate supply is
        the road's POIs but the clock is doubled. The pacing budget is NOT the binding constraint —
        `driveMaxStops` (`pacing.ts:17`) is ~1 stop / 4 min of the WHOLE round trip, so a 2-hour loop
        is budgeted ~24 stops while `DRIVE_MIN_GAP_SEC` (180 s) lets the outbound half hold ~half that.
        The cap has room; the geometry never offers it anything.
      - ⚠ **The glance fill cannot rescue it** (`93867aa`). Glances are placed on the SAME geometry in
        the same step-1 loop (`drive-select.ts:249`) — they inherit the identical one-leg-only bias, so
        the quiet stretch they exist to fill is precisely the stretch they are also absent from.

      Two candidate fixes, cheapest first, NOT mutually exclusive:
      1. **Snap to every LOCAL minimum, not the global one — free, no new audio, no spend.** Let a
         candidate offer both its outbound and its return occurrence to the pacing pass and let step 3
         pick. This does not repeat a clip; it MOVES a stop the outbound leg's `minGap` crowded out
         onto the return leg, where there is room — which is why it should raise the audible stop count
         rather than just redistribute it. ⚠ **Step 2's co-located dedupe is the landmine**: it
         collapses anything within `DRIVE_MIN_SEPARATION_M` (1 km) of a kept anchor by comparing
         PLACED ANCHORS, and one place's two occurrences are ~0 m apart, so it would eat the second
         one and the whole change would no-op. It has to become "one telling appears once" (subject
         identity) rather than "two points 1 km apart are one stop" (position) — and that is a real
         rule change with its own blast radius, not a constant tweak.
      2. **Let a repeated place get a DIFFERENT telling — that is exactly the b-side.**
         `docs/designs/tell-me-more-spec.md`: generation is already BUILT (script-only,
         preview-by-default, nothing persisted), the ear check passed 2026-08-03, and storage is
         DECIDED — its own table, `narrations_poi_uq` is NOT loosened
         (`docs/decisions/bside-gets-its-own-table.md`). A return leg is arguably a better home for a
         b-side than the pull-button it was specced for. ⚠ **But do NOT plan on it as the primary
         fix**: the same spec measured that only **1 of 8** stops on a real drive carries usable
         leftover material (~90 s added to a 39-minute drive). A b-side return leg would be thin, not
         full. It also costs a founder-gated paid run; fix 1 costs nothing.

      ⛔ **Anti-goal: replaying the SAME clip on the way back.** The rider hears an identical telling
      twice inside an hour — the one outcome worse than the quiet we are fixing.

      ⚠ **Verify by BEHAVIOUR, not by unit test alone.** The symptom is a DISTRIBUTION, so the check is
      to plan one out-and-back and compare the selection's `alongSec` values against `totalSec / 2` —
      today they should pile up below it. A test that asserts "a stop exists" passes on the broken
      version. ⚠ And `drives.selection` is FROZEN at create against a non-refundable credit, so this
      only ever improves NEW drives; existing round trips keep their quiet return.
