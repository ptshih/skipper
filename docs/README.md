# docs/ — the project's durable records

How truth is managed in this repo. Four layers; each fact lives in exactly ONE of them:

| Layer | Where | What |
| --- | --- | --- |
| **Operating truth** (now) | `/CLAUDE.md` | doctrine, hard invariants, stack, workflow — only what an agent must know to avoid breaking something or burning money |
| **Engineering backlog** (near-term) | `/TODO.md` | actionable items with enough context to act on; DELETE items when done (git history is the archive) |
| **Durable records** (history + future) | `docs/` | everything below |
| **Code** (the rest of now) | the repo | if a doc and the code disagree, the code wins — fix the doc |

## The folders

- **`decisions/`** — dated decision records + spike results: *why things are the way they are.*
  Append-only history: revise by adding a dated addendum or a new record with a `Superseded by:`
  pointer — never silently rewrite a decision's rationale.
- **`specs/`** — build-ready designs for features (mostly unbuilt): *concrete future truth.* When a
  spec ships, flip its status line to shipped/built in place — the file does not move.
- **`ideas/`** — pre-spec product ideas with their charm rationale: *fuzzy future truth.* Promotion
  path: idea → spec → built.
- **`research/`** — competitive/external studies: *reference.* Inputs to decisions, not commitments.
- **`guides/`** — operational how-tos (EAS builds, etc.).

## Conventions

1. **Folders are by KIND; the status line is by STATE.** Every doc opens with a short dated
   status note under its title — what it is, whether it's built/unbuilt/superseded, and where it
   points if so. A doc never changes folders when its state changes; ship a spec and you flip its
   status line, not its path.
2. **Code wins.** Line numbers, tour ids, and column names in docs go stale; the status line should
   warn about known drift rather than pretend currency.
3. **Handoffs are ephemeral.** Agent-to-agent baton docs (the old `*-handoff.md` files) don't live
   here — they're deleted once consumed; cross-session continuity lives in agent memory, durable
   rationale lives in `decisions/`.
4. **CLAUDE.md stays lean.** It gets a paragraph only when violating it breaks an invariant or burns
   money. When something there is superseded, DELETE it and record the history in the relevant
   decision record — no strikethrough graveyards.
5. **Enforced, not aspirational.** `scripts/lint-docs.ts` (`bun run lint:docs`, first step of root
   `bun run check`, auto-run by a project hook on docs edits) fails on: a file loose at `docs/`
   root or in an unknown folder, a doc without a `**Status**` line in its first 12 lines, any
   `*-handoff.md` under `docs/`, any bare `docs/<file>.md` path reference anywhere in the repo,
   and CLAUDE.md exceeding its line ceiling. Status SEMANTICS (does the line match reality?) can't
   be linted — flip statuses in the same commit as the change (CLAUDE.md → Git workflow).

## Index

### decisions/
- [tour-data-model-zero-reuse.md](decisions/tour-data-model-zero-reuse.md) — shared facts on `pois`,
  zero content reuse; the PRINCIPLE survives but the **ENTITY MODEL is SUPERSEDED by V2 (2026-06-18)** —
  the live model is `pois ─1:1─ narrations` (shared atom) + user-owned `drives`, not the old
  `tour_stops` (migration `0009` dropped `tours`/`segments`/`tracks`/`tour_frames`).
- [create-a-drive-architecture.md](decisions/create-a-drive-architecture.md) — **the V2 build record**
  (✅ BUILT 2026-06-18): the roam-first data model (one atom `pois`──1:1──`narrations` +
  sequences; `segments`/`tour_frames` dissolve; roam = a mode; `drives` = user-owned sequences) +
  the two-phase Create-a-Drive flow, access/credits, and the build phases. Carries a 2026-06-19
  supersession addendum (asides deleted, regions geometry-first, credits → the ledger).
  Product rationale: [roam-first-create-a-drive.md](ideas/roam-first-create-a-drive.md).
- [api-versioning-posture.md](decisions/api-versioning-posture.md) — no URL versioning; evolve the
  contract additively, with `GET /version` + the mobile `VersionGate` as the sole hard-break escape
  hatch; decided + built 2026-06-09.
- [region-corpus-discovery.md](decisions/region-corpus-discovery.md) — the discovery-first sweep
  (`discover-pois.ts` → `pois`) that populates a region's shared POI corpus; the SWEEP survives but
  its original tour-generation consumer is **CONSUMER SUPERSEDED by V2** (migration `0009`).
- [geometry-first-regions.md](decisions/geometry-first-regions.md) — a region is a BBOX, never a
  stored FK: a POI's region = point-in-bbox; a drive stores its route bbox + derives region by
  intersect — no `region_id` FK anywhere (2026-06-19).
- [corpus-enrichment.md](decisions/corpus-enrichment.md) — the paid `enrich` step that scouts story
  POIs into curated fact wells (`pois.fact_sheet`) shared by roam + drives; ✅ BUILT 2026-06-15, RUN
  2026-06-16 (315 welled).
- [t-share-funnel-removed.md](decisions/t-share-funnel-removed.md) — the `/t/<id>` share funnel
  removed (drives are user-owned, not anonymous-shareable); the iOS universal-link capability kept
  dormant; decided + done 2026-06-19.
- [tour-structure-design-review.md](decisions/tour-structure-design-review.md) — adversarial
  pre-build review of the tour-structure spec (verdict: build-with-fixes); historical.
- [audio-compression-spike.md](decisions/audio-compression-spike.md) — WAV → MP3 32 kbps spike;
  shipped 2026-06-08.
- [enrichment-scout.md](decisions/enrichment-scout.md) — story-stop enrichment decided by a
  bounded tool-using scout (judgment) instead of char-count sparse-gates; built 2026-06-09.
- [location-permission-priming.md](decisions/location-permission-priming.md) — a pre-permission
  explainer before iOS's one-shot location prompt (drive + roam); When-In-Use priming built
  2026-06-13, Always/background escalation deferred (App Store 5.1.1(iv): no "Not Now").
- [fact-overrides-and-veracity.md](decisions/fact-overrides-and-veracity.md) — the
  upstream-source-error loop (`poi_overrides` corrections + the web-checking `--veracity`
  eval) and the durable eval record (`eval_runs`/`eval_scores`); built 2026-06-09.
  (Zero-reuse gained a §9 addendum 2026-06-10: `roam_clips` as the THIRD narration owner.)

### specs/
- [ask-the-skipper-spec.md](specs/ask-the-skipper-spec.md) — live, grounded voice Q&A mid-drive (the
  north-star delighter); build-ready, unbuilt, post-MVP.
- [gps-player-spec.md](specs/gps-player-spec.md) — the M1 live GPS phone player; mostly built
  (remaining: duck flip + the real drive).
- [tour-structure-spec.md](specs/tour-structure-spec.md) — intro/outro brackets + quality-gated
  narration; §3/§4 built, data-model half superseded by zero-reuse.
- [downtime-callouts-spec.md](specs/downtime-callouts-spec.md) — persona-only beats in the quiet
  stretches (the "dead air" answer); unbuilt.
- [tell-me-more-spec.md](specs/tell-me-more-spec.md) — pre-generated deeper-cut B-side per story
  stop; unbuilt.
- [replay-last-stop-spec.md](specs/replay-last-stop-spec.md) — one-tap re-hear of the last stop;
  unbuilt, cheap, player-only.
- [skipper-opinions-spec.md](specs/skipper-opinions-spec.md) — opinionated asides ("the world off
  the rails"); unbuilt, builds on downtime-callouts.
- [drive-thesis-spec.md](specs/drive-thesis-spec.md) — the drive's through-idea (the keystone:
  plant in intro → evidence in stops → land at the payoff); unbuilt, generation-only.
- [scenic-stops-spec.md](specs/scenic-stops-spec.md) — deliberately adding scenic stops; unblocked
  but partially overtaken by the pacing rework — re-ground before building.
- [corpus-enrichment-spec.md](specs/corpus-enrichment-spec.md) — a paid `enrich` step that scouts the
  POI facts ONCE at the corpus (verbatim selection → a curated "fact well" roam + drives share); the
  well becomes the narration bound, letting the raw-extract cap drop. ✅ BUILT 2026-06-15, RUN 2026-06-16.
- [admin-ops-console-spec.md](specs/admin-ops-console-spec.md) — **builder infra**: cloud-execute the
  studio CLIs (discover/enrich/generate/resynth/sweep) as **Cloud Run Jobs** (v0), then a deployed
  `apps/admin` (Vite + Hono) behind **Google IAP** with a jobs record + ear-pass/eval monitor (v1);
  ✅ BUILT + DEPLOYED 2026-06-11, **partially superseded 2026-06-19** (the §5b Create-Tour authoring
  flow was never built — hand-authored tours are V2-deferred).
- [free-roam-alpha-spec.md](specs/free-roam-alpha-spec.md) — what the free-roam ALPHA actually is
  (roam_clips third owner, basin sweep, ~60s encounters, RoamEngine, duckOthers posture) + its
  deliberate cuts; BUILT 2026-06-10, founder-only TestFlight.

### ideas/
- [journey-layer.md](ideas/journey-layer.md) — **the north-star vision**: Skipper as the
  entertainment/meaning layer of the journey (the self-driving age) + "any road, anywhere, generated
  live" — the demand and supply of one endgame the feature-ideas below ladder toward. Direction, not
  commitment.
- [free-roam-mode.md](ideas/free-roam-mode.md) — **a second product** (tours stay primary): the POI
  corpus as a proximity-triggered "skipper rides shotgun" roam mode — Autio's shape, Skipper's soul,
  region-gated by density; rung 1.5 of the journey-layer spectrum. Captured 2026-06-10; the ALPHA
  shipped same day (see [free-roam-alpha-spec.md](specs/free-roam-alpha-spec.md)) — this doc keeps
  the unbuilt vision layers.
- [roam-first-region-expansion.md](ideas/roam-first-region-expansion.md) — the beachhead
  inversion: roam (a bbox + ~$15) opens a region, the demand heatmap picks the tour to build;
  probed Yosemite/Moab/Big Sur corpora for $0 on capture day (2026-06-11).
- [roam-first-create-a-drive.md](ideas/roam-first-create-a-drive.md) — **the V2 product
  structure** (founder-converged 2026-06-18): roam + on-demand "Create a Drive" (enter A→B → route
  in seconds → roam clips pre-ordered along it, user-owned) are the two first-day experiences;
  the hand-authored tour is DEFERRED. journey-layer rung 2 made buildable on the batch stack via
  clip REUSE; zero-reuse scopes down to the authored rung; V2 may break freely (V1 never shipped).

The rest are post-MVP features, gated behind the proven phone player:
- [drive-complete-moment.md](ideas/drive-complete-moment.md) — the payoff beat as motion + sound
  (the stage the next two plug into).
- [tip-the-skipper.md](ideas/tip-the-skipper.md) — end-of-tour tip jar (IAP; delight, not extraction).
- [sponsor-read.md](ideas/sponsor-read.md) — in-character intro-bracket sponsor spot (riskiest vs
  the toy lens).
- [region-skippers.md](ideas/region-skippers.md) — a different named host per region (M4).
- [passport-logbook.md](ideas/passport-logbook.md) — stamps + the skipper's logbook souvenir layer.
- [signature-canon-bit.md](ideas/signature-canon-bit.md) — a signature recurring beat riders learn to
  wait for; DEFERRED 2026-06-10 (revisit with region-skippers, M4-ish).

### research/
- [competitive-research.md](research/competitive-research.md) — multi-agent cited research across
  the category (2026-06-07).
- [shaka-guide-ux-study.md](research/shaka-guide-ux-study.md) — teardown of THE reference comp.
- [autio-deep-dive.md](research/autio-deep-dive.md) — the roam-shaped incumbent, verified deep
  dive (2026-06-11): bimodal triggering, listen-later offline, plateaued business, the
  structural-vs-execution failure partition; corrects the four-comp study's triggering line.
- [competitor-ux-studies.md](research/competitor-ux-studies.md) — GuideAlong / Autio / VoiceMap +
  the 4-for-4 "dead air" cross-comp finding.
- [autio-content-moat.md](research/autio-content-moat.md) — Autio's real moat is the **funnel** (a
  comparison/SEO factory), not the app; the comparison table is a trap + caps at niche; "refuse the
  category, win post-install on character + region-depth"; the honest hole = acquisition still unsolved
  (2026-06-12, from their marketing).
- [jungle-cruise-skipper-craft.md](research/jungle-cruise-skipper-craft.md) — adversarially-verified
  research digest behind the persona's voice; feeds `packages/studio/src/persona/skipper.ts` +
  `SKIPPER_TTS_STYLE_PROMPT` (2026-06-09).

### guides/
- [eas-setup.md](guides/eas-setup.md) — building + running the Expo app on EAS (dev build).
- [device-verification-runbook.md](guides/device-verification-runbook.md) — the one-sitting
  on-device pass that clears the last M1 gate (phone-player feel + real GPS); checklist of what only
  a physical iPhone can verify, with the duck-flip + open native risks called out.
- [gcp-cloud-run-deploy.md](guides/gcp-cloud-run-deploy.md) — deploying `@skipper/api` to Cloud Run
  (us-east4, co-located with the Neon DB); push-to-`main` continuous deployment via Cloud Build,
  the dotenvx-secret-from-Secret-Manager model, and the one-time IAM/DRS gotchas.
- [ops-scripts-sop.md](guides/ops-scripts-sop.md) — the safe-by-default contract for the studio's
  one-off operational CLIs (preview unless `--apply`); reference impl `sweep-orphans.ts`; adopted
  2026-06-10.
- [create-a-drive-verification-runbook.md](guides/create-a-drive-verification-runbook.md) — the
  one-sitting on-device pass that clears the last V2 gate: the live Create→propose→confirm→generate→
  preview→drive runtime (needs a dev build + signed-in account + real LLM/Maps spend); written 2026-06-18.
