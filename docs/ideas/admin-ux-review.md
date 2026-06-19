# Admin ops-console UX review — gaps + flow proposals

**Status:** idea / partially-built — 2026-06-19. A full visual pass of the admin (Runs/Regions/POIs/
Reference + dialogs, dark mode, ⌘K) cross-referenced against the admin server routes, the studio
pipeline, and the DB/public-API surface (5-agent capability-map workflow + direct browser pass).
**Tier 1 BUILT** (`a01fb47`): per-POI Regenerate + a spend-cap field. **Tier 2 keystone BUILT**: the
`offline_audit` "Re-score corpus" job (grounding/tts/diversity over existing narrations, no regen).
Tier 2 ② (charm/veracity dimensions) + ③ (Reference honesty) and Tiers 3–4 remain the backlog below.
Code wins — line/symbol anchors were true at capture and will drift.

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

## Tier 2 — charm / veracity / honesty (NEXT; needs a founder greenlight on the eval-wiring)

This tier crosses the written "automated groundedness gate — human ear instead" deferral, so the
**inline-on-generation** variants need an explicit founder OK; the **on-demand audit** variants do not
(they don't gate shipping — they just score). Pairs with `docs/ideas/eval-panel-rewire.md`.

- **Wire `charm` as an ADVISORY eval dimension.** CLAUDE.md's north star is charm, yet no run
  produces a charm score and `ReferenceView` lists one. Two ways: (a) fold `eval/charm.ts` into the
  generation eval panel advisory-only (scores + per-stop ship/tune/rework, never withholds — like
  diversity); or (b) cheaper/greenlight-free: expose `judge-voice` (already uses `judgeCharm`, emits
  presigned playable links + a worksheet) as a dispatchable READ-ONLY job kind. *Effort M.*
- **Veracity spot-check job.** Grounding proves claims trace to the sheet; it's blind to the sheet
  being WRONG. `eval/veracity.ts` (Opus + web_search world-check) runs nowhere. Add a dispatchable,
  read-only, advisory veracity job (region/selection-scoped, writes `eval_scores` dimension=veracity)
  → a ranked list of suspect facts that flow into the existing Corrections fact-edit flow. *Effort M.*
- ✅ **"Re-score corpus" (offline_audit) — BUILT 2026-06-19.** `packages/studio/src/audit-corpus.ts`
  scores EXISTING `narrations.script` (grounding via Opus on `--apply`; tts + cross-clip diversity free)
  with NO regeneration/TTS, rebuilding each well via the shared `resolveStoryGrounding`→`buildGroundingWell`
  seam so the audit can't drift from generation; records an `eval_run{kind:'offline_audit'}` + scores.
  Registered as the `offline_audit` job kind (jobKind enum + `jobs.ts` SCRIPTS/buildJobArgs); surfaced
  as a "Re-score corpus" dialog on the POIs page (Preview = free count+estimate; Apply = Opus + record,
  with the spend-cap field) and rendered in the Runs report drawer. Dry smoke confirmed it flags
  corpus-wide sameness (a repeated "here is the/where…" wind-up) for $0. (+charm/veracity plug in next.)
- **Make the Reference doc honest.** Its glossary lists grounding/veracity/diversity/charm/tts but
  only grounding/tts/diversity ever appear on a run (`pacing` has no evaluator at all). Either wire
  the above or annotate the unwired dims as "on-demand audit only." *Effort S.*

Suggested Tier-2 order: **offline_audit first** (the keystone harness), then charm + veracity ride on
it as dimensions, then the Reference honesty fix lands for free.

## Tier 3 — geography & power-operator

- **Map view** (Leaflet + OSM, no key): draw-the-bbox in the Regions dialog; pin + draggable
  speakable-anchor in the POI Corrections tab. The `bbox-lookup` helper + the too-far anchor guard are
  textual compensations for this missing map. *Effort L.*
- **Make ⌘K useful** — today it's navigation-only. The 850-POI corpus is already client-cached; let
  it search POIs by name and run actions (Discover/Generate/Re-score). *Effort M.*
- **`audit-speakable` as a corpus-health flag** — the corpus-wide anchor-drift check is shell-only;
  surface it like the existing `sheet-drift` flag (badge + Retire-tab filter). *Effort M.*
- **Enrich "Advanced": model A/B + smoke-limit** — `--model` and `--limit` are server-forwarded but
  have no field; add an Advanced disclosure (pairs with the new spend cap). *Effort S.*

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
