# docs/ — the project's durable records

How truth is managed in this repo. Four layers; each fact lives in exactly ONE of them:

| Layer | Where | What |
| --- | --- | --- |
| **Operating truth** (now) | `/CLAUDE.md` | doctrine, hard invariants, stack, workflow — only what an agent must know to avoid breaking something or burning money |
| **Engineering backlog** (near-term) | `/TODO.md` | actionable items with enough context to act on, one per line-anchored `#id` with area/priority/tags (legend at the top of the file; `/todo` operates it); DELETE items when done (git history is the archive) |
| **Durable records** (history + future) | `docs/` | everything below |
| **Code** (the rest of now) | the repo | if a doc and the code disagree, the code wins — fix the doc |

## Start here

- **Understand the current build:** [1.1 design](designs/drives-first-1-1.md), then the
  [architecture overview](guides/architecture-overview.md) for orientation. Code and the operating
  rules in [CLAUDE.md](../CLAUDE.md) settle questions about current behavior.
- **Find work to do:** [engineering backlog](../TODO.md). Designs record intent and history;
  their presence in this index does not mean they are scheduled.
- **Check release work:** [App Store submission record](guides/app-store-submission.md),
  [release batches](designs/release-batches.md), and [device submission sweep](guides/1-1-submission-sweep.md).
- **Operate the corpus:** [operator CLI conventions](guides/ops-scripts-sop.md) and
  [Yosemite launch plan](designs/yosemite-region-launch.md). Paid runs still require an explicit founder go.

Browse the full index: [decisions](#decisions) · [designs](#designs) ·
[research](#research) · [guides](#guides). Entries are navigation summaries; read each
record's dated Status and addenda before treating its original proposal as current guidance.

## The folders

- **`decisions/`** — dated decision records + spike results: *why things are the way they are.*
  Append-only history: revise by adding a dated addendum or a new record with a `Superseded by:`
  pointer — never silently rewrite a decision's rationale.
- **`designs/`** — *future truth at any maturity*, from a napkin sketch to a build-ready spec. The
  **Status line** carries maturity (idea → build-ready → built), not the folder. Merged from the old
  `ideas/` + `specs/` split on 2026-07-31: having BOTH a kind-folder and a status line encode maturity
  was redundant, and the redundancy produced a real contradiction (a "promotion" that had to move a
  file, against a rule saying files never move). One folder, one status line, no promotion concept.
- **`research/`** — competitive/external studies: *reference.* Inputs to decisions, not commitments.
- **`guides/`** — operational how-tos (EAS builds, etc.).

## Conventions

1. **Folders are by KIND; the status line is by STATE.** Every doc opens with a short dated
   status note under its title — what it is, whether it's built/unbuilt/superseded, and where it
   points if so. **A doc NEVER moves.** State changes in place: a `designs/` entry goes from idea to
   build-ready to built by editing its Status line, never by changing its path. No `/archive`, no
   strikethrough graveyards. (Before 2026-07-31 a "promotion" moved a file `ideas/` → `specs/`; that
   exception is gone with the folders themselves — see **The folders** above.)
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

Each entry uses its document title. Status, implementation details, and remaining work live in
the document itself, so this index does not maintain a second account of them.

### decisions/

- [Audio loudness master spec — Spotify-aligned targets for Skipper audio](decisions/audio-loudness-spec.md)
- [Cut the joke notch — v2 ships one delivery voice; variety comes from different narrators](decisions/cut-joke-notch.md)
- [Offline-download freshness TTL (soft, time-based)](decisions/offline-freshness-ttl.md)
- [Tour data model (canonical)](decisions/tour-data-model-zero-reuse.md)
- [Create-a-Drive architecture (V2 roam-first)](decisions/create-a-drive-architecture.md)
- [API versioning posture](decisions/api-versioning-posture.md)
- [Working without internet — the connectivity verdict and the roam offline pack](decisions/offline-connectivity-and-roam-pack.md)
- [Region-corpus discovery (discovery-first reorder)](decisions/region-corpus-discovery.md)
- [Geometry-first regions (a region is a bbox, never a foreign key)](decisions/geometry-first-regions.md)
- [Lake Tahoe tightens; Reno & Carson City becomes its own region](decisions/tahoe-reno-region-split.md)
- [A region may be SEVERAL boxes](decisions/multi-bbox-regions.md)
- [Which iPhones we design for](decisions/device-support-matrix.md)
- [No default region — every corpus run names the region it is for](decisions/no-default-region.md)
- [Example anchors: featured gates the pool, geometry orders it, the client rotates](decisions/example-anchor-selection.md)
- [Drive credits: a user-owned ledger (not a count of drives)](decisions/credit-ledger.md)
- [The free allotment stays small, and running out is a conversation](decisions/free-allotment-through-1-1.md)
- [Cut user tiers — credits govern premium, there is no paid plan](decisions/cut-tiers.md)
- [Cut the intro/outro frame and the "cousin Ray" personal kit](decisions/cut-intro-frame-and-persona-kit.md)
- [Cut the WAVE form — v2 ships without the scenic tier's passing call-out](decisions/cut-wave-form.md)
- [Cut the mid-drive concierge — the Skipper will not find you a coffee](decisions/cut-mid-drive-concierge.md)
- [A b-side gets its own table — narrations_poi_uq is NOT loosened](decisions/bside-gets-its-own-table.md)
- [Scenic filler, and what goes in an empty stretch](decisions/scenic-filler-and-the-empty-stretch.md)
- [Drive density: the glance fill's arity, the cluster orphan, and the return leg](decisions/drive-density-and-the-return-leg.md)
- [Two directions the live planner did NOT take](decisions/planner-directions-not-taken.md)
- [The prompt sweep — all 14 prompts under a microscope](decisions/prompt-sweep-2026-08-04.md)
- [The planner stops asking how long they want to be out](decisions/planner-stops-asking-how-long.md)
- [A loop may not drive the same road twice](decisions/no-same-road-loops.md)
- [The sample "postcard" — a curated taste for everyone outside Tahoe](decisions/sample-ride-postcard.md)
- [Cut the couch "simulated drive"; the drive-detail page IS the mini-preview](decisions/detail-page-mini-preview.md)
- [Account deletion + password recovery — the two App Store gates on identity](decisions/account-deletion-and-recovery.md)
- [The anonymous mint is not account creation — no in-app delete for anonymous riders](decisions/anonymous-mint-and-account-deletion.md)
- [Automated grounding gate — the founder reverses "human ear instead"](decisions/automated-grounding-gate.md)
- [Region release gate — staged content + a one-way release latch](decisions/region-release-gate.md)
- [A curated endpoint must be a place a car can reach](decisions/undrivable-endpoint-anchors.md)
- [Corpus enrichment (the enrich step)](decisions/corpus-enrichment.md)
- [/t/ share funnel removed (universal-link capability kept dormant)](decisions/t-share-funnel-removed.md)
- [Tour-structure design review — adversarial critique (TOMBSTONE)](decisions/tour-structure-design-review.md)
- [Audio compression spike — get clips off uncompressed WAV](decisions/audio-compression-spike.md)
- [Skipper audio takes EXCLUSIVE focus (doNotMix) — the skipper is the audio, not a voice-over](decisions/drive-audio-exclusive-focus.md)
- [Story-stop enrichment: the scout (judgment) replaces the char-count sparse-gates](decisions/enrichment-scout.md)
- [Location permission priming (explainer before the OS prompt)](decisions/location-permission-priming.md)
- [Upstream source errors: poi_overrides + the veracity eval + the durable eval record](decisions/fact-overrides-and-veracity.md)
- [Riders are real — the post-launch storage & wire posture](decisions/riders-are-real-posture.md)

### designs/

- [Release batches](designs/release-batches.md)
- [Yosemite launch and admin listening review](designs/yosemite-region-launch.md)
- [A reviewer-reachable simulated drive](designs/app-review-demo-mode.md)
- [The desk-drive harness — making a drive re-runnable](designs/desk-drive-harness.md)
- [1.1 build notes — verified coordinates](designs/drives-first-1-1-build-notes.md)
- [Does the onboarding gate still earn its place?](designs/onboarding-gate-reconsidered.md)
- [Onboarding — the first screen is pretty but does not say what this is](designs/onboarding-first-screen-legibility.md)
- [Places console — UX overhaul](designs/places-console-overhaul.md)
- [Add a female Skipper voice](designs/female-skipper-voice.md)
- [Lowest-friction signup — what the wall could ask for instead of a password](designs/lowest-friction-signup.md)
- [Studio's structured-output layer — hardened in-repo; the AI SDK stays declined](designs/studio-structured-output-hardening.md)
- [The home hero — a WPA poster behind the cold open](designs/home-hero-poster.md)
- [The road-trip planner](designs/the-road-trip-planner.md)
- [The corpus as the planner's world](designs/corpus-as-the-planners-world.md)
- [Letting the planner look things up](designs/planner-lookup-tools.md)
- [What is a drive endpoint?](designs/what-is-a-drive-endpoint.md)
- [1.1 — Drives first: remove roam, plan a drive by talking](designs/drives-first-1-1.md)
- [1.1 adversarial review — what an outside pass found in the spec](designs/1-1-adversarial-review.md)
- [Post-1.1 slate — 1.2 candidates, the charm shelf, cuts, and refusals](designs/post-1-1-slate.md)
- [My Drives legibility — making a 50-drive library findable](designs/my-drives-legibility.md)
- [Onboarding — a taste, then where](designs/onboarding-taste-then-where.md)
- [The home cold open — four CTAs and no primary](designs/home-cold-open-declutter.md)
- [The chat screen bogs down as the conversation grows](designs/chat-render-performance.md)
- [Fused cluster generation — phase 4 of the legibility layer](designs/fused-cluster-generation-spec.md)
- [Road-Snapped Speakable Anchors — Build Spec](designs/road-snapped-anchors-spec.md)
- [Trigger Precision — Build Spec](designs/trigger-precision-spec.md)
- [Drive endpoints + pitstops from a curated Places set — Build Spec](designs/places-endpoints-spec.md)
- [Ask the Skipper — Build Spec](designs/ask-the-skipper-spec.md)
- [M1 GPS Phone Player — Build Spec / Handoff](designs/gps-player-spec.md)
- [Background location — When-In-Use + background updates (screen-off / pocket triggering; NO "Always")](designs/background-location-spec.md)
- [Tour structure spec — intro/outro brackets + quality-gated narration](designs/tour-structure-spec.md)
- [Downtime callouts — build spec / handoff](designs/downtime-callouts-spec.md)
- ["Tell me more" — the deeper-cut / B-side spec](designs/tell-me-more-spec.md)
- ["Replay the last stop" — build spec / handoff](designs/replay-last-stop-spec.md)
- [The skipper's opinions ("the world off the rails") — build spec / handoff](designs/skipper-opinions-spec.md)
- [The drive's thesis — build spec](designs/drive-thesis-spec.md)
- [Scenic stops spec — deliberately adding scenic stops](designs/scenic-stops-spec.md)
- [Corpus enrichment — Build Spec](designs/corpus-enrichment-spec.md)
- [Admin ops console — build spec](designs/admin-ops-console-spec.md)
- [Free-roam ALPHA — what v0 actually is](designs/free-roam-alpha-spec.md)
- [The drive is an ARC — prepare, preview, anticipate, experience](designs/drive-as-arc.md)
- [Offline as REGION PACKS, not per-drive downloads](designs/offline-region-packs.md)
- [A drive must be SAVED before it can be driven](designs/download-before-start.md)
- [The POI legibility layer — turning a Wikidata dump into drivable stops](designs/poi-legibility-layer.md)
- [The journey layer — Skipper's north-star vision](designs/journey-layer.md)
- [Free-roam mode — the skipper rides shotgun](designs/free-roam-mode.md)
- [Roam-first region expansion — the beachhead inversion](designs/roam-first-region-expansion.md)
- [V2 — roam-first + Create-a-Drive](designs/roam-first-create-a-drive.md)
- [Re-wiring the eval panel — an instrument over everything the LLM/TTS touches](designs/eval-panel-rewire.md)
- [LLM answer-discovery (GEO/AEO) as a distribution wedge](designs/llm-discovery-marketing.md)
- [Admin ops-console UX review — gaps + flow proposals](designs/admin-ux-review.md)
- [The drive-complete payoff as a designed _moment_, not a screen](designs/drive-complete-moment.md)
- ["Tip the skipper" — an end-of-tour tip jar](designs/tip-the-skipper.md)
- ["This tour is sponsored by…" — an AI-voiced sponsor read in the intro](designs/sponsor-read.md)
- [Region-specific skipper identities — a different host per region](designs/region-skippers.md)
- ["Passport + logbook" — a souvenir/collection layer](designs/passport-logbook.md)
- [The signature canon bit — a beat riders learn to wait for](designs/signature-canon-bit.md)

### research/

- [External research: judge bias and prompt optimisation](research/llm-judge-bias-and-prompt-optimization.md)
- [Fitting one screen across 375×667 → 440×956](research/fitting-one-screen-across-iphone-sizes.md)
- [Credit monetization — research memo](research/credit-monetization-research.md)
- [Competitive & adjacent-app research — UX/product best practices for Skipper](research/competitive-research.md)
- [Shaka Guide — UX teardown (the comp we define ourselves against)](research/shaka-guide-ux-study.md)
- [Autio deep dive — the roam-shaped incumbent, six years in](research/autio-deep-dive.md)
- [Competitor UX studies — GuideAlong, Autio, VoiceMap (+ the cross-comp pattern)](research/competitor-ux-studies.md)
- [Autio's real moat is the funnel, not the product](research/autio-content-moat.md)
- [Jungle Cruise skipper craft — the verified research behind the persona's voice](research/jungle-cruise-skipper-craft.md)
- [apps/api — Best-Practices Audit](research/api-best-practices-audit.md)
- [Rider-triggered spend: what the caps actually bound](research/rider-spend-exposure.md)

### guides/

- [Agent delegation and model setup](guides/agent-delegation.md)
- [App Store Connect — the submission cheat-sheet](guides/app-store-submission.md)
- [The 1.1 submission sweep — from a clean tree to "Submit for Review"](guides/1-1-submission-sweep.md)
- [EAS setup — Skipper mobile (phone-player dev build)](guides/eas-setup.md)
- [On-device verification runbook — M1 phone player](guides/device-verification-runbook.md)
- [GCP Cloud Run deploy](guides/gcp-cloud-run-deploy.md)
- [Skipper, from first principles — an architecture orientation](guides/architecture-overview.md)
- [apps/mobile internals](guides/mobile-internals.md)
- [The 1.1 cutover — the first push](guides/1-1-cutover-runbook.md)
- [Ops-scripts SOP](guides/ops-scripts-sop.md)
- [Create-a-Drive verification runbook (V2)](guides/create-a-drive-verification-runbook.md)
- [Upstream Wikipedia corrections — drafts for a human to file](guides/upstream-wikipedia-corrections.md)
