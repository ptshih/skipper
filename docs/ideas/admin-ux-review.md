# Admin ops-console UX review — gaps + flow proposals

**Status:** idea / partially-built — 2026-06-19. A full visual pass of the admin (Runs/Regions/POIs/
Reference + dialogs, dark mode, ⌘K) cross-referenced against the admin server routes, the studio
pipeline, and the DB/public-API surface (5-agent capability-map workflow + direct browser pass).
**Tier 1 BUILT** (`a01fb47`): per-POI Regenerate + a spend-cap field. **Tier 2 BUILT** (`0af9c23` +
this change): the `offline_audit` "Re-score corpus" job (grounding/tts/diversity over existing
narrations, no regen) PLUS opt-in charm + veracity advisory judges, the report drawer's advisory-flags
section, and the Reference-glossary honesty fix. Tiers 3–4 remain the backlog below. Code wins —
line/symbol anchors were true at capture and will drift.

## What's strong (don't regress)

- **Safe-by-default spend pattern** — every paid/destructive action defaults to a free Preview
  dry-run, then a server `confirm:true` gate (412 otherwise) + a confirm dialog. (`job-action-dialog.tsx`)
- **Per-POI ear-pass** — inline presigned R2 audio player + script + WPM/duration/facts-hash + a
  `<90 wpm` duplicate-audio defect flag. The "curate by ear" surface works. (`PoisView` NarrationTab)
- **Corpus-health axes** — story-eligibility / enriched / sheet-drift / narration fresh·stale /
  attribution / duration-defect, with clickable KPI pills that set filters. Dense + genuinely useful.
- Gmail-style bulk-select for Enrich; dark-mode-first honored; HealthBanner + crash guards; the
  Reference cheat-sheet as onboarding.

## The 6 themes the gaps cluster into

1. **The user side is invisible** — no surface for drives, credit_entries, the auth user table, or
   drive_demand. The founder cannot see a single user-created drive or comp a user without DB surgery.
2. **Spend safety has a hole + a missing knob** — paid console runs couldn't be cost-capped from the
   UI (FIXED, Tier 1); `bbox-lookup` still spends an Opus call outside the confirm gate.
3. **Charm & veracity trust is under-served** — the two judges that matter most for a charm-first toy
   (`eval/charm.ts`, `eval/veracity.ts`) exist but never run, and the Reference page promises them.
4. **Curation was region-batch-only** — fixing one clip meant a whole-region paid job (FIXED, Tier 1).
5. **Geography is text, not map** — bboxes/pins/anchors are raw coordinate strings.
6. **Stranded CLI flags** the server already accepts (model A/B, limit, max-cost) have no dialog field.

## Tier 1 — BUILT 2026-06-19 (client-only; server plumbing already existed)

- **Per-POI "Regenerate narration"** — a Regenerate action in the Narration tab next to Re-synth,
  firing `generate_narrations` with `includeIds=[poiId]`, `force`, `apply`, `confirm`. Closes the
  ear-pass → fix-a-fact → re-hear loop as a single-POI flow instead of a whole-region paid batch.
  (Re-synth = re-voice the same script; Regenerate = fresh script from current facts/corrections.)
- **Spend cap (USD) field** on the paid dialogs (Enrich + Generate) — rendered by `JobActionDialog`
  whenever `spends`, forwarded as `maxCostUsd` → the studio's `--max-cost` hard ceiling (aborts before
  billing if the estimate exceeds it; stops mid-run once actual spend crosses it). Blank = no cap.

## Tier 2 — charm / veracity / honesty — BUILT 2026-06-19

All ON-DEMAND (no generation-gate change → the written "automated groundedness gate — human ear
instead" deferral is untouched; inline auto-gating on every generate stays deferred). Pairs with
`docs/ideas/eval-panel-rewire.md`.

- ✅ **"Re-score corpus" (offline_audit) keystone** (`0af9c23`). `packages/studio/src/audit-corpus.ts`
  scores EXISTING `narrations.script` (grounding via Opus; tts + cross-clip diversity free) with NO
  regeneration/TTS, rebuilding each well via the shared `resolveStoryGrounding`→`buildGroundingWell`
  seam so the audit can't drift from generation; records an `eval_run{kind:'offline_audit'}` + scores.
  `offline_audit` job kind + a "Re-score corpus" POIs dialog (Preview free; Apply spends, with the
  spend-cap field). Dry smoke flagged a corpus-wide repeated "here is the/where…" wind-up for $0.
- ✅ **charm + veracity as advisory judges.** `charmEvaluator` (one batch Opus call) + `evaluateVeracity`
  (per-clip Opus + web_search) wired into the audit behind `--charm` / `--veracity` (opt-in checkboxes
  in the Re-score dialog → forwarded by `jobs.ts`). Both advisory (never gate/withhold); a veracity
  contradiction carries the correction + source straight into the existing Corrections fact-edit flow.
- ✅ **Report drawer surfaces advisory findings.** The Runs eval-report drawer showed ONLY withheld
  (gate) places; now it has an "Advisory flags" section (charm/veracity/diversity failures on
  otherwise-clean clips) + charm/veracity rollup scores computed client-side (no eval_runs column).
- ✅ **Reference glossary honest.** Each dimension marked gate-vs-advisory + where it runs; `pacing`
  annotated "reserved — no evaluator yet"; the Re-score row added to the run-kinds table.

## Tier 3 — geography & power-operator (code-only items BUILT 2026-06-19; map pending)

- **Map view** (Leaflet + OSM, no key): draw-the-bbox in the Regions dialog; pin + draggable
  speakable-anchor in the POI Corrections tab. The `bbox-lookup` helper + the too-far anchor guard are
  textual compensations for this missing map. *Effort L.* — **PENDING**: needs a `bun add`
  (react-leaflet@5 + leaflet) which rewrites the shared root `bun.lock`; deferred to a quiet-tree
  moment to avoid lockfile collisions with the other agents' in-flight dep churn.
- ✅ **⌘K is useful** — BUILT. The palette now searches the POI corpus by name (shared `['pois']`
  cache, capped at 8) + has action commands (Discover / Generate Narration / Re-score corpus). Deep-link
  via typed `/pois?poi=<id>` / `?act=<discover|generate|rescore>` search params (`validateSearch`, no
  zod dep; consumed via `getRouteApi('/pois')`, one-shot then stripped). Verified: action deep-link
  opens the dialog + strips the param.
- ✅ **`audit-speakable` as a corpus-health flag** — BUILT. `GET /admin/pois` computes `speakableDrift`
  per row via `checkSpeakableAnchor` (only for pois carrying an anchor); surfaced as a `speakable drift`
  badge, a "Speakable: drifted" flag facet, and inclusion in the Retire tab (its own label/tone/desc).
- ✅ **Enrich "Advanced": model A/B + smoke-limit** — BUILT. An Advanced disclosure on the Enrich
  dialog with a model toggle (Sonnet default / Opus) + a "Smoke-test first N" field, threaded into the
  job body (server already forwarded `--model`/`--limit`).

## Tier 4 — when real users arrive (stage behind a flag)

- **Users & Drives surface** — the admin imports only corpus+ops tables. Add (read-first): a Drives
  table + replay of the frozen selection (diagnose a bad drive); a per-user credit ledger + an
  `admin_grant` make-good button (the ledger source is reserved but has no writer); a comp-to-`paid`
  toggle on `user.tier`; a `drive_demand` leaderboard (top route_sigs by hits/distinct_users). *L.*

## Small consistency fixes

- Detail-by-modal: no `/pois/:id` or `/runs/:id` routes → can't bookmark/share a POI or run.
- `bbox-lookup` spends outside the confirm gate — debounce the Search button + disclose "uses a small AI call".
- Dead `GET /admin/jobs` endpoint (+ `api.jobs()`) has zero UI callers; legacy `generate`/`patch_clip`/
  `resynth` job kinds remain in the enum but are un-dispatchable (display-only in the Runs labels).
