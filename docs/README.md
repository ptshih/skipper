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

### decisions/
- [tour-data-model-zero-reuse.md](decisions/tour-data-model-zero-reuse.md) — shared facts on `pois`,
  zero content reuse; the PRINCIPLE survives but the **ENTITY MODEL is SUPERSEDED by V2 (2026-06-18)** —
  the live model is `pois ─1:1─ narrations` (shared atom) + user-owned `drives`, not the old
  `tour_stops` (migration `0009` dropped `tours`/`segments`/`tracks`/`tour_frames`).
- [create-a-drive-architecture.md](decisions/create-a-drive-architecture.md) — **the V2 build record**
  (✅ BUILT 2026-06-18): the shared-corpus data model (one atom `pois`──1:1──`narrations` +
  sequences; `segments`/`tour_frames` dissolve; `drives` = user-owned sequences) + the two-phase
  Create-a-Drive flow, access/credits, and the build phases. The DATA model is still live; the
  roam-as-a-mode half of it died in 1.1. Carries a 2026-06-19 supersession addendum (asides deleted,
  regions geometry-first, credits → the ledger).
  Product rationale: [roam-first-create-a-drive.md](designs/roam-first-create-a-drive.md).
- [api-versioning-posture.md](decisions/api-versioning-posture.md) — no URL versioning; evolve the
  contract additively, with `GET /version` + the mobile `VersionGate` as the sole hard-break escape
  hatch; decided + built 2026-06-09.
- [offline-connectivity-and-roam-pack.md](decisions/offline-connectivity-and-roam-pack.md) — working
  without internet: one push-only connectivity verdict that fails OPEN and self-heals, and a
  migration seam so a `MANIFEST_VERSION` bump stops silently destroying saved downloads. ⚠ The PACK
  half went with roam (1.1); the CONNECTIVITY verdict and the three expo native landmines it records
  are still live and must not be undone. Built 2026-07-30.
- [region-corpus-discovery.md](decisions/region-corpus-discovery.md) — the discovery-first sweep
  (`discover-pois.ts` → `pois`) that populates a region's shared POI corpus; the SWEEP survives but
  its original tour-generation consumer is **CONSUMER SUPERSEDED by V2** (migration `0009`).
- [geometry-first-regions.md](decisions/geometry-first-regions.md) — a region is a BBOX, never a
  stored FK: a POI's region = point-in-bbox; a drive stores its route bbox + derives region by
  intersect — no `region_id` FK anywhere (2026-06-19).
- [credit-ledger.md](decisions/credit-ledger.md) — drive credits are a user-owned, append-only
  `credit_entries` ledger (balance = SUM), NOT a `count(drives)`; free-tier lifetime grant + per-drive
  consume live (migration `0016`), Apple IAP / Google Play purchase plumbing deferred; built 2026-06-19.
- [free-allotment-through-1-1.md](decisions/free-allotment-through-1-1.md) — the free allotment stays
  SMALL and running out is a conversation: the 403 sends the rider to `hello@skipper.fm` for a free
  admin top-up, keeping 2.0 pricing open. ⚠ Frozen grant amounts block RAISING the cap as well as
  lowering it, so any cap change owes existing riders a grant — and `hello@` is now load-bearing
  (2026-07-31).
- [cut-tiers.md](decisions/cut-tiers.md) — removed `user.tier` ('free'|'paid'): credits govern premium,
  so `accessTier` collapses to `anonymous`|`free`, every account spends the ledger, and a comp is a
  large admin grant (2026-06-20).
- [cut-intro-frame-and-persona-kit.md](decisions/cut-intro-frame-and-persona-kit.md) — why the placeless
  intro/outro frame (`asides`, dropped in `0019`) and the "cousin Ray" persona kit it housed were both
  killed 2026-06-19: the kit outlived its only legal home and leaked off-persona jokes into stops, and
  placeless content fights geometry-first selection. Backfilled 2026-07-27; the nine specs that still
  assumed either feature now point here.
- [cut-wave-form.md](decisions/cut-wave-form.md) — backed the WAVE form (the scenic tier's ~15s passing
  call-out) out of the tree before the v2 release: built + smoke-tested but never run, so zero rows and
  no audio existed and the removal was code-only; the `'wave'` enum value stays as reserved vocabulary,
  and the two traps the build surfaced (structural monotony, name-derived claims) are recorded (2026-07-26).
- [drive-density-and-the-return-leg.md](decisions/drive-density-and-the-return-leg.md) — why drives felt
  thin, measured on the four saved drives: the stop CAP was innocent (removing it changed NOTHING). The
  levers were the glance fill taking **one call-out per window however long the window**, the 180 s
  pacing floor (→ 120), a fused telling a route cannot REACH still suppressing its own members
  (Vikingsholm was silenced on the drive that passes Emerald Bay), and — found last, the most
  consequential — the **trigger-reach admission filter, which modelled a pipeline we do not run**: stops
  are served route-SNAPPED, so a POI 600 m off-road fires fine, and the filter was refusing content to
  prevent a failure that cannot occur. Admission is now the `OFF_ROUTE_MAX_M` honesty bound alone.
  31 → 41 stops, coverage 34% → 40%, worst silence 17:56 → 14:24 (2026-08-03). ⚠ Its §5 — a
  there-and-back retraces 96% of its ground and 17 of 18 candidates snap to the outbound half, so the
  return leg is structurally silent — is the measurement behind
  [no-same-road-loops.md](decisions/no-same-road-loops.md). ⚠ `driveMaxStops` now BINDS on two of four
  drives; it bound on none before.
- [sample-ride-postcard.md](decisions/sample-ride-postcard.md) — the `/sample` "postcard": one curated
  Tahoe clip anyone outside the corpus (incl. an App Review tester) can hear in one permission-free tap,
  fixing the "I don't know these roads yet" dead-end; anonymous `GET /sample` (it lost its `/roam`
  prefix with roam, no alias), three entry points, and the sim→diagnostics decouple (2026-07-16).
- [detail-page-mini-preview.md](decisions/detail-page-mini-preview.md) — cut the couch "simulated drive"
  (`?mode=preview`); the drive-detail page IS the mini-preview now — tap a stop (List row or Map pin) to
  hear one clip, no auto-drop on create. Deletes the preview clock + `buildPreviewTimeline`; `useDrive`
  is `sim | live` (2026-07-16).
- [account-deletion-and-recovery.md](decisions/account-deletion-and-recovery.md) — in-app account
  deletion (App Store 5.1.1(v)) is immediate + total and must PURGE `drives`/`credit_entries` by hand
  (soft refs, no FK cascade); password reset mails a Resend link that resolves on the web. Reset is
  inert until `RESEND_API_KEY` is set (2026-07-15).
- [anonymous-mint-and-account-deletion.md](decisions/anonymous-mint-and-account-deletion.md) — the
  anonymous mint is **not** account creation under App Store 5.1.1(v), so 1.1 ships with no in-app
  delete affordance for anonymous riders (an anonymous row holds no rider data by invariant, and the
  real sign-up flow already deletes). Closes the 1.1 spec's RISK-3. ⚠ Corrects the code comment that
  called such a button impossible: the anonymous plugin's own `POST /delete-anonymous-user` is mounted
  and asks only for a session — so this is a decision, not a limitation (2026-08-03).
- [automated-grounding-gate.md](decisions/automated-grounding-gate.md) — the founder reversed "human
  ear instead": `generate-narrations.ts` now scores every clip through the eval panel and is
  FAIL-CLOSED (a clip whose grounding/tts gate stays dirty after the bounded `optimize()` retakes is
  WITHHELD + flagged in `eval_scores`, never shipped). Replaces the two cheap guards; eval tables
  redesigned for V2; admin surfaces the runs + per-poi report. DECIDED + BUILT 2026-06-19.
- [region-release-gate.md](decisions/region-release-gate.md) — a one-way release latch so regions roll
  out slowly: `regions.released_at` + `narrations.released_at` (monotonic, never un-released = no drive
  orphans / no yanked downloads), the admin `role` as the preview gate (founder + allowlist hear staged
  content in-app), releasing a region auto-releases all its clips. The *human* gate downstream of the
  automated eval gate. ✅ BUILT 2026-06-20; preview gate moved from `user.tester` → the Better Auth
  `admin` plugin role 2026-06-20 (migration `0030`).
- [undrivable-endpoint-anchors.md](decisions/undrivable-endpoint-anchors.md) — a curated endpoint must
  be a place a car can reach: the `Spooner Lake` pin sat on the WATER, so Routes snapped it to a gated
  forest track and a Carson City round trip came back **143 min** instead of 39, with a "Make this
  drive" button under it. Routes has no avoid-unpaved/avoid-private, so `routes.warnings` is the only
  signal — now read in `@skipper/routing`, refused at both billed sites, and swept offline by
  `audit-endpoint-routability` (9 of 111 Tahoe anchors flagged). ⚠ `curate-places` restores a corrected
  pin (last-write-wins), so the sweep is the standing guard. ✅ ADOPTED + BUILT 2026-08-04.
- [corpus-enrichment.md](decisions/corpus-enrichment.md) — the paid `enrich` step that scouts story
  POIs into curated fact wells (`pois.fact_sheet`) every drive shares; ✅ BUILT 2026-06-15, RUN
  2026-06-16 (315 welled).
- [t-share-funnel-removed.md](decisions/t-share-funnel-removed.md) — the `/t/<id>` share funnel
  removed (drives are user-owned, not anonymous-shareable); the iOS universal-link capability kept
  dormant; decided + done 2026-06-19.
- [tour-structure-design-review.md](decisions/tour-structure-design-review.md) — a 2026-06-08
  adversarial pre-build critique; the design it reviewed is fully deleted, so the record is now a
  tombstone (the full body lives in git history) pointing to the live model.
- [audio-compression-spike.md](decisions/audio-compression-spike.md) — get clips off uncompressed
  WAV: MP3 32k shipped 2026-06-08, then switched to LINEAR16 → AAC-LC `.m4a` (one ffmpeg
  loudnorm+encode pass) 2026-06-14, bitrate later bumped for clean peaks; the MP3 body is historical.
- [drive-audio-exclusive-focus.md](decisions/drive-audio-exclusive-focus.md) — the drive uses
  `doNotMix` (exclusive focus) BY DESIGN: it IS the audio (curated soundtrack + narration), not a
  voice-over that ducks the rider's music; settles the old "Phase-0 duck flip". Decided 2026-06-19.
- [enrichment-scout.md](decisions/enrichment-scout.md) — story-stop enrichment decided by a
  bounded tool-using scout (judgment) instead of char-count sparse-gates; built 2026-06-09.
- [location-permission-priming.md](decisions/location-permission-priming.md) — a pre-permission
  explainer before iOS's one-shot location prompt; When-In-Use priming built 2026-06-13,
  Always/background escalation deferred (App Store 5.1.1(iv): no "Not Now"). 1.1 narrowed it to the
  single "Let's roll" caller — the whole pre-drive flow is location-free.
- [fact-overrides-and-veracity.md](decisions/fact-overrides-and-veracity.md) — the
  upstream-source-error loop (`poi_overrides` corrections + the web-checking `--veracity`
  eval) and the durable eval record (`eval_runs`/`eval_scores`); built 2026-06-09.
  (Zero-reuse gained a §9 addendum 2026-06-10 — itself superseded; V2 collapsed roam to a MODE over
  the 1:1 `pois`↔`narrations` atom, no `roam_clips` table, and 1.1 then removed the mode outright.)

### designs/
- [drives-first-1-1.md](designs/drives-first-1-1.md) — **the 1.1 release**: DRIVES become the primary
  (and only) experience, the roam experience is removed COMPLETELY (client + server + engine + DTOs;
  git is the archive), and *prepare* is rebuilt as a **conversation with the skipper in character** —
  planning a scenic drive the way you'd plan it with ChatGPT. The planner resolves the ROUTE only and
  **never discusses places** (deflects in persona — that protects the facts invariant by construction
  AND manufactures the anticipate beat); selection stays deterministic. Anonymous riders get the whole
  preview including one clip from their own route, with the wall at "Make this drive". Also: the
  subject-keyed offline store (the REGION PACK itself was cut), district re-anchoring, a repo-wide
  simplification sweep, instrumentation. ⚠ Removes the only road-tested mode — drive one before
  submitting. Greenlit 2026-07-31; steps 0–12 built and **pushed to prod 2026-08-02**, not yet released
  to riders (TestFlight, RISK-1, the on-device sweep and the ASC listing remain).
- [1-1-adversarial-review.md](designs/1-1-adversarial-review.md) — a ten-lens outside pass over the
  1.1 spec **while it was mid-build**, every code claim checked by an adversarial verifier: 15 findings
  to raise with the builder (⚠ `via` bypasses INV-1's allowlist; the `/drives/plan` mount is
  order-dependent; INV-15's mitigation doesn't cover its own hazard; D22's district re-anchor is not
  free), 6 before-submission items (the published privacy policy **denies** what 1.1 does), and three
  decisions — the sharpest being whether 1.0.0 (probed: `WAITING_FOR_REVIEW`) should ever ship.
  Findings, **not** decisions; the spec still wins. Captured 2026-07-31.
- [post-1-1-slate.md](designs/post-1-1-slate.md) — the same pass's post-1.1 half: 1.2 candidates
  (nothing reads `eval_scores`; selection still ranks by clip LENGTH), a ranked charm shelf (give
  ANTICIPATE a moment; pick the one anonymous preview clip by ear), 11 cuts to feed D36's step-10 sweep
  (⚠ `drives.route_sig` has no reader at all), and a list of things **explicitly not worth doing**, each
  with the condition that expires it. Idea shelf, nothing greenlit; 2026-07-31.
- [home-cold-open-declutter.md](designs/home-cold-open-declutter.md) — three founder notes on the
  shipped 1.1 home screen (cluttered · prompts too loud · sample CTA too prominent) traced to **one
  inversion**: the composer is the primary action and is styled as the quietest element, while the
  asks, the sample link and the hero are all drawn at button weight. Carries the before/after, the
  ⚠ that `ghost` is not a quiet tier (it renders Lora 700 · 17pt), the ⚠ that the 35pt chips are NOT
  a hit-target defect (`hitSlop={12}`), and the constraint that bounds it — the sample clip stays
  above the fold because it is the only thing an App Review tester can hear. Design pass 2026-08-03,
  **not greenlit**, and written while another agent was mid-edit in the same files.
- [fused-cluster-generation-spec.md](designs/fused-cluster-generation-spec.md) — **phase 4** of the
  legibility layer: one fused telling per cluster, and the read-path work that makes it audible.
  **BUILT, GENERATED AND RELEASED** — 37 fused tellings, all released (counted 2026-08-02); only
  Yosemite's 30 clusters remain, behind a paid `enrich` first. ⚠ Its §10 AREA trigger was cut with
  roam, so read that section (and every `/roam` measurement) as a record; the lead is the arbiter of
  state and the body is a build journal.
- [road-snapped-anchors-spec.md](designs/road-snapped-anchors-spec.md) — **1a** of the 2026-06-25 dogfood
  triage: a safe-by-default `snap-speakable-anchors` pass auto-populates `pois.speakable_lat/lng` from the
  nearest drivable road (Google Roads API), flagging POIs no road can reach; un-snappable centroids never
  trigger. Build-ready, unbuilt; paired with the trigger-precision spec below.
- [trigger-precision-spec.md](designs/trigger-precision-spec.md) — **1b** of the same triage: the trigger
  primitives (speed-adaptive lead, heading gate, debounce) already exist in `@skipper/engine`, but both
  engines fire on the raw centroid `pois.lat/lng` — so the fix is consume the 1a anchor as the trigger
  center, shrink the inflated `radiusForKind` floors, and retire passed points (the "fired after passing"
  bug). Build-ready, unbuilt; needs an on-device re-drive to tune.
- [places-endpoints-spec.md](designs/places-endpoints-spec.md) — a per-region CURATED set of Google
  Places, reusing the `places` table at zero runtime Google cost. **BUILT and RUN — Tahoe's set is
  live in prod** (32 places, 26 endpoint-eligible). 💸 Do not re-run `curate-places` to "fix an empty
  allowlist". ⚠ Its consumer moved: the picker and `GET /drives/anchors` were both deleted in 1.1, and
  the curated set is now the **planner's allowlist**, server-side only.
- [ask-the-skipper-spec.md](designs/ask-the-skipper-spec.md) — live, grounded voice Q&A mid-drive (the
  north-star delighter); build-ready, unbuilt, post-MVP.
- [gps-player-spec.md](designs/gps-player-spec.md) — the M1 live GPS phone player; mostly built (the
  duck flip is resolved → `doNotMix` by design; the real drive has since landed).
- [background-location-spec.md](designs/background-location-spec.md) — the deferred When-In-Use →
  background-updates escalation (screen-off / pocket triggering; **When-In-Use only, NO "Always"** —
  proven from the installed expo-location source): a transport re-architecture from the foreground
  `watchPositionAsync` to a `startLocationUpdatesAsync` + TaskManager task. Build-ready, unbuilt;
  empirically gated behind a real-device drive showing foreground + keep-awake is insufficient.
- [tour-structure-spec.md](designs/tour-structure-spec.md) — intro/outro brackets + quality-gated
  narration; §3/§4 built, data-model half superseded by zero-reuse. ⚠ The BRACKETS themselves were
  cut 2026-06-19 with the `asides` table that housed them
  ([cut-intro-frame-and-persona-kit.md](decisions/cut-intro-frame-and-persona-kit.md)).
- [downtime-callouts-spec.md](designs/downtime-callouts-spec.md) — persona-only beats in the quiet
  stretches (the "dead air" answer); unbuilt.
- [tell-me-more-spec.md](designs/tell-me-more-spec.md) — pre-generated deeper-cut B-side per story
  stop; unbuilt.
- [replay-last-stop-spec.md](designs/replay-last-stop-spec.md) — one-tap re-hear of the last stop;
  unbuilt, cheap, player-only.
- [skipper-opinions-spec.md](designs/skipper-opinions-spec.md) — opinionated asides ("the world off
  the rails"); unbuilt, builds on downtime-callouts.
- [drive-thesis-spec.md](designs/drive-thesis-spec.md) — the drive's through-idea (the keystone:
  plant in intro → evidence in stops → land at the payoff); unbuilt, generation-only.
- [scenic-stops-spec.md](designs/scenic-stops-spec.md) — deliberately adding scenic stops; unblocked
  but partially overtaken by the pacing rework — re-ground before building.
- [corpus-enrichment-spec.md](designs/corpus-enrichment-spec.md) — a paid `enrich` step that scouts the
  POI facts ONCE at the corpus (verbatim selection → a curated "fact well" every drive shares); the
  well becomes the narration bound, letting the raw-extract cap drop. ✅ BUILT 2026-06-15, RUN 2026-06-16.
- [admin-ops-console-spec.md](designs/admin-ops-console-spec.md) — **builder infra**: cloud-execute the
  studio CLIs (discover/enrich/generate/resynth/sweep) as **Cloud Run Jobs** (v0), then a deployed
  `apps/admin` (Vite + Hono) behind **Google IAP** with a jobs record + ear-pass/eval monitor (v1);
  ✅ BUILT + DEPLOYED 2026-06-11, **partially superseded 2026-06-19** (the §5b Create-Tour authoring
  flow was never built — hand-authored tours are V2-deferred).
- [free-roam-alpha-spec.md](designs/free-roam-alpha-spec.md) — 🔴 **REMOVED (1.1, 2026-08-01)**, kept
  as the record of what the free-roam ALPHA was (roam as a MODE over the 1:1 `narrations` atom, basin
  sweep, ~60s encounters, RoamEngine, pause+resume) + its deliberate cuts. Worth reading only because
  every field lesson the drive player inherited — trigger radii, the iOS heading sentinel, all 8
  TestFlight items, `doNotMix` — was paid for here. BUILT 2026-06-10, founder-only TestFlight.

- [drive-as-arc.md](designs/drive-as-arc.md) — **why a drive out-charms a roam session on identical
  clips**: it's an ARC (prepare → preview → anticipate → experience) and roam has only the last beat.
  The magic is manufactured in the first three, which are the cheapest to improve (no car required).
  Logs the founder call to bring back **LLM endpoint resolution** — the curated anchors let the model
  CHOOSE a start/end rather than invent one, so free text returns without loosening grounding. ⚠ Notes
  that CLAUDE.md's "the LLM resolves ONLY the endpoints" is stale against the code TODAY, and that no
  created drive has ever been driven end-to-end. Captured 2026-07-31; PROMOTED same day → [drives-first-1-1.md](designs/drives-first-1-1.md).
- [offline-region-packs.md](designs/offline-region-packs.md) — ⚠ **the REGION PACK is CUT** (founder,
  2026-07-31): its purpose was ambient proximity playback, which died with roam, and a drive can't be
  created offline anyway. What SURVIVES is its D1, now **INV-6** of 1.1 and the reason there is no
  pack: *no bbox-level eligibility rule can guarantee coverage of a selection FROZEN under a different
  rule*, so **only a drive's own manifest is authoritative for that drive** — the per-drive top-up is
  nearly free because `createDrive`/`getDrive` already return a full `DriveManifest`. The body is the
  pre-cut reasoning, kept as the argument to re-read if per-drive downloads ever prove insufficient.
- [poi-legibility-layer.md](designs/poi-legibility-layer.md) — **the claimed moat**: everything between
  "a Wikidata entity exists" and "a driver hears one coherent thing at the right moment" — the
  SOLO/CLUSTER/DISTRICT treatment split, leader (non-chaining) grouping, an Opus treatment classifier,
  and OSM road-CLASS relevance. Measured against the live Tahoe corpus 2026-07-29: drives select 8
  stops where pacing allowed 12. Region-agnostic by requirement (it's what makes region N+1 cheap).
  Design pass, NOT greenlit.
- [journey-layer.md](designs/journey-layer.md) — **the north-star vision**: Skipper as the
  entertainment/meaning layer of the journey (the self-driving age) + "any road, anywhere, generated
  live" — the demand and supply of one endgame the feature-ideas below ladder toward. Direction, not
  commitment.
- [free-roam-mode.md](designs/free-roam-mode.md) — 🔴 **CUT (1.1, 2026-08-01)**: the POI corpus as a
  proximity-triggered "skipper rides shotgun" roam mode — Autio's shape, Skipper's soul, region-gated
  by density; rung 1.5 of the journey-layer spectrum. Captured 2026-06-10, alpha shipped same day.
  Nothing in it is scheduled; why it lost is [drive-as-arc.md](designs/drive-as-arc.md).
- [roam-first-region-expansion.md](designs/roam-first-region-expansion.md) — the beachhead
  inversion: a region opens with a BBOX and a batch run (~$15), not a curated route. ⚠ Its VEHICLE
  (roam + a demand heatmap) died in 1.1; the inversion itself is how region N+1 still opens.
  Probed Yosemite/Moab/Big Sur corpora for $0 on capture day (2026-06-11).
- [roam-first-create-a-drive.md](designs/roam-first-create-a-drive.md) — **the V2 product
  structure** (founder-converged 2026-06-18): roam + on-demand "Create a Drive" as the two first-day
  experiences, hand-authored tours DEFERRED. ⚠ The PAIRING is superseded by 1.1 (drives only); the
  DATA half — journey-layer rung 2 made buildable on the batch stack via clip REUSE — is unchanged
  and load-bearing, which is why deleting a whole mode cost no content.
- [eval-panel-rewire.md](designs/eval-panel-rewire.md) — re-wiring the BUILT-but-unwired eval panel
  as one instrument over everything the LLM/TTS touches, re-keyed to V2 pois/places; STAGED — a $0
  out-of-band corpus audit + folding the two cheap inline guards in (ships now), then an inline
  grounding soft-gate via the built `optimize()` flywheel (needs a founder greenlight, crosses the
  "human ear instead" deferral). Brainstorm 2026-06-19; key finding: an upstream sheet-faithfulness
  gate is a no-op (the enricher selects verbatim spans by id).
- [llm-discovery-marketing.md](designs/llm-discovery-marketing.md) — a research pass on LLM answer
  discovery (GEO/AEO) as the distribution wedge: **do the cheap subset** (extend the site's existing
  JSON-LD with `MobileApplication` + `sameAs` — "Skipper" collides with a cluster of boating apps; one
  answer-shaped page), **shelve** the programmatic corpus→web pages (our POI stories are downstream of
  Wikipedia, the most-cited source in that query class — and CC BY-SA ShareAlike would open-license the
  asset the moat doc calls uncopyable). Reconciles with
  [autio-content-moat.md](research/autio-content-moat.md); every claim labelled primary/measured/vendor
  because GEO advice is mostly vendor marketing. Captured 2026-07-28, awaiting a founder call.
- [admin-ux-review.md](designs/admin-ux-review.md) — a full visual + capability-map review of the admin
  ops console (vs the studio pipeline + DB surface). Tier 1 BUILT (per-POI Regenerate + a paid-dialog
  spend cap); Tiers 2–4 backlog (charm/veracity/offline_audit re-score, a map view, a useful ⌘K, and a
  users/drives/credits surface for when real users arrive). Captured 2026-06-19.

The rest are post-MVP features, gated behind the proven phone player:
- [drive-complete-moment.md](designs/drive-complete-moment.md) — the payoff beat as motion + sound
  (the stage the next two plug into).
- [tip-the-skipper.md](designs/tip-the-skipper.md) — end-of-tour tip jar (IAP; delight, not extraction).
- [sponsor-read.md](designs/sponsor-read.md) — in-character intro-bracket sponsor spot (riskiest vs
  the toy lens).
- [region-skippers.md](designs/region-skippers.md) — a different named host per region (M4).
- [passport-logbook.md](designs/passport-logbook.md) — stamps + the skipper's logbook souvenir layer.
- [signature-canon-bit.md](designs/signature-canon-bit.md) — a signature recurring beat riders learn to
  wait for; DEFERRED 2026-06-10 (revisit with region-skippers, M4-ish).

### research/
- [credit-monetization-research.md](research/credit-monetization-research.md) — how modern agentic AI
  apps charge via credits, and what it implies here. ⚠ The free grant's SIZE is the only irreversible
  decision (frozen per user at signup) and gets costlier with every signup; Apple's no-expiry rule
  covers only PURCHASED credits; the revealed price of a driving tour is $14.99–$19.99, not $2.99
  (2026-07-31, not greenlit).
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
- [api-best-practices-audit.md](research/api-best-practices-audit.md) — internal `apps/api` audit
  (2026-06-23): 18 actionable findings clustered on spend/security of the paid Routes path (XFF-spoof
  rate-limit bypass, credit-consume TOCTOU, unrated `POST /drives`). **Working doc — UNTRIAGED; delete
  once the findings are actioned.**
- [rider-spend-exposure.md](research/rider-spend-exposure.md) — what the rider-facing caps actually
  bound (2026-08-01), and what nothing bounds: the RISK-4 multiplier is Cloud Run's **unchosen default
  of 100 instances**, `PLAN_RATE_HOUR`'s window outlives the process that holds it, and per-IP caps
  guard one caller while **no control anywhere bounds aggregate spend** (the GCP Budget API is not
  enabled). Ceilings with their arithmetic, not forecasts. **Findings, not decisions.**

### guides/
- [app-store-submission.md](guides/app-store-submission.md) — every App Store Connect field ready to
  paste (name/subtitle/description/keywords pre-counted against Apple's caps), the privacy nutrition
  label that must match the binary's manifest, and the App Review notes — which carry the whole
  submission, since the corpus is Tahoe-only and a reviewer in Cupertino is 200 miles outside it.
  ⚠ LISTING vs BUILD have DIVERGED: the live listing still sells roam.
- [1-1-submission-sweep.md](guides/1-1-submission-sweep.md) — **the executable pass from today's `main`
  to "Submit for Review"**, and the one to run: two builds (EAS production for TestFlight, a local dev
  build for the desk passes — the in-app simulator is `__DEV__`-gated), Pass A (in-app simulator, real
  speeds → trigger timing) + Pass B (Xcode GPX on a phone, real CoreLocation), the App Review path
  walked verbatim, then the listing. Written 2026-08-03. ⚠ Its §0 states what the desk passes CANNOT
  prove — iOS may not simulate speed, which collapses the trigger radius to its floor and can reject
  every fix outright.
- [eas-setup.md](guides/eas-setup.md) — building + running the Expo app on EAS (dev build).
- [device-verification-runbook.md](guides/device-verification-runbook.md) — the one-sitting
  on-device pass that clears the last M1 gate (phone-player feel + real GPS); checklist of what only
  a physical iPhone can verify, with the duck-flip + open native risks called out. ⚠ **Written against
  the M1 player, before the conversation was the home screen — for 1.1 use
  [1-1-submission-sweep.md](guides/1-1-submission-sweep.md).**
- [gcp-cloud-run-deploy.md](guides/gcp-cloud-run-deploy.md) — deploying `@skipper/api` to Cloud Run
  (us-east4, co-located with the Neon DB); push-to-`main` continuous deployment via Cloud Build,
  the dotenvx-secret-from-Secret-Manager model, and the one-time IAM/DRS gotchas.
- [architecture-overview.md](guides/architecture-overview.md) — orientation: the whole system from
  first principles. The two architectural principles, the three machines (studio / API / mobile), the
  route table, the data model, the rider flow, the trigger + audio engine, and the five seams that
  break quietly. ⚠ DERIVED and dated 2026-08-02 — CLAUDE.md and the code win over it; read it to get
  oriented, not to settle an argument.
- [mobile-internals.md](guides/mobile-internals.md) — the deep pass on `apps/mobile`: the pure/native
  split, the stateless-planner transcript, the GPS-driven player and its two stall paths, the
  three-module offline store, who owns the audio session, and Trailhead 89. Same DERIVED caveat.
- [1-1-cutover-runbook.md](guides/1-1-cutover-runbook.md) — the ordering for 1.1's FIRST push: the four
  triggers one push fires (the API's is unfiltered), why the cutover is code-only and therefore cheaply
  reversible, the `/roam/sample`→`/sample` flip against an in-review build, and the rollback capture
  that has to happen beforehand. Written AND **executed** 2026-08-02 — kept as the record of the first
  push and the template for the next. ⚠ One claim in it was already false when it was used (a migration
  had landed ahead of the deploy, making rollback one-way); re-measure, don't inherit.
- [ops-scripts-sop.md](guides/ops-scripts-sop.md) — the safe-by-default contract for the studio's
  one-off operational CLIs (preview unless `--apply`); reference impl `sweep-orphans.ts`; adopted
  2026-06-10.
- [create-a-drive-verification-runbook.md](guides/create-a-drive-verification-runbook.md) — the
  one-sitting on-device pass over the live Create→propose→confirm→generate→preview→drive runtime
  (needs a dev build + real Maps spend); written 2026-06-18. ⚠ **SUPERSEDED by 1.1** — its pickers are
  deleted and its "roam is the only anonymous surface" precondition is now inverted. Use
  [1-1-submission-sweep.md](guides/1-1-submission-sweep.md), which carries its Acceptance list forward
  into executable steps.
