# Skipper — working notes for agents

A toy/lifestyle project: an AI-narrated, GPS-triggered driving audio tour with a Jungle-Cruise-skipper
persona, played as phone audio (CarPlay later). **Optimize for charm, not scale — the persona is the
product.** When a choice trades polish-for-the-builder against scale-for-a-market, pick polish.

⚠ **1.1 is DEPLOYED to prod (2026-08-02) but NOT released to riders** — roam is REMOVED entirely (git is
the archive) and Create-a-Drive IS a conversation. **What is left is one guide:
`docs/guides/1-1-submission-sweep.md`** — the builds, the on-device sweep, then the listing (the push
itself is recorded in `docs/guides/1-1-cutover-runbook.md`). RISK-1's real drive is OFF the critical path
(founder, 2026-08-03); that guide's §0 owns what the desk passes can't prove, so don't re-argue it here.
`docs/designs/drives-first-1-1.md` is the build truth — read it before touching `apps/api` or `apps/mobile`.

## STOP — the expensive or irreversible mistakes

- **💸 An OPERATOR paid run needs an explicit founder "go" — NEVER inferred.** `enrich`,
  `generate-narrations --apply`, `classify-treatments`, `curate-places`, TTS, any Cloud Run job spends
  real GCP credits. Studio CLIs preview by default and only spend on `--apply` — the spend itself waits
  for a human yes, never a guess. ("Correctness over cost" governs the DESIGN, never a license to RUN.)
  ⚠ **Every corpus CLI REQUIRES `--region`** (explicit-id runs exempt); no default region, no fallback
  sweep bbox — a defaulted one billed the wrong corpus GREEN (`docs/decisions/no-default-region.md`).
- **💸 RIDER-triggered spend is a DIFFERENT rule — it is governed by CAPS, not by a go-per-run.**
  `POST /drives/plan` (model tokens) and `POST /drives/propose` (Google Routes) spend on EVERY rider
  request, forever, anonymously, with no `--apply` and no human in the loop. Their only guards are:
  `max_tokens`, a bounded request body and the limiter's numbers — single-sourced in
  `apps/api/src/limits.ts`, which imports NOTHING on purpose, so the other two guards live where they
  can: the pinned model id (`CLAUDE_MODELS.planner`, `@skipper/shared`) and the token tally
  `planner.ts` records. **Adding a new rider-triggered paid call is
  itself a founder decision; weakening an existing cap is a cost regression, not a UX tweak.**
- **🌳 The working tree AND git index are SHARED across agents.** NEVER `git stash` / `reset --hard` /
  `checkout -- .` / `restore .` / `clean` / `rebase` (they silently eat everyone's uncommitted work —
  one `git stash` pockets all of it), and NEVER `git add -A` / `.` / `commit -a`. Commit ATOMICALLY by
  explicit path (`git commit path/a path/b`) at the very end — never leave changes staged; re-check the
  file is still SOLELY yours first (`git diff --stat path/a path/b`) and leave a now-mixed file for its
  owner. No repo-wide auto-fixers (`prettier --write .`, `eslint --fix`, codemods). ⚠ 1.1 orders a
  "repo-wide simplification sweep" — that means **by explicit path, atomic commits**, never a codemod.
  This bullet and the spend rules above are ENFORCED, not merely documented: a `PreToolUse` hook
  (`scripts/guard-hook.ts`) hard-denies the NEVER list and prompts on spend. `/guard` is the
  cheat-sheet — read it before working around a block, and every rule must trace back to a line here.
- **🖥 Don't boot or restart dev servers** — the human keeps them running continuously; just use them
  (find ports with `lsof -nP -iTCP:<port> -sTCP:LISTEN`). ⚠ **METRO (:8081) IS THE EXCEPTION (founder,
  2026-08-03): stopping and starting it for a simulator visual pass is ALWAYS fine, no need to ask.**
  It is the app's own bundler, not a shared service, and a mobile change cannot be verified without
  it — `cd apps/mobile && bun run start` in the background, then relaunch the app. The rule protects
  the API/admin/site servers, whose state the human is often mid-way through.
- **✅ Verify before committing:** root `bun run check` — the doc/type/enum lints, then every typecheck
  and test suite, `scripts/` included (`package.json` holds the list; don't re-enumerate it here, it
  drifts). If you touched `apps/mobile`, ALSO run `bun run check` there (the real delta is
  `lint:tokens` + `lint` — root `test`/`typecheck` already filter into the workspace). ⚠ `lint` is ESLint,
  which exists ONLY in `apps/mobile` and only for `react-hooks` (the hooks are unreachable by `bun test`);
  pin it to 9.x and treat `eslint-suppressions.json` as a backlog — see `apps/mobile/CLAUDE.md`.
  ⚠ **A new package needs its `test` script in the SAME commit** — `bun --filter '*' test` SILENTLY skips
  one without it, so an absent script is indistinguishable from a passing suite (it hid two packages).

## Git workflow

- **Never create or switch branches without confirming first.** No `git switch -c` / `checkout -b` /
  moving onto another branch on your own — the repo default is to **commit directly to `main`** (multiple
  agents share one tree; unannounced switches are disruptive). 1.1 ships on `main` too — that was decided
  once, up front. (Commit hygiene + the shared-tree rules live in STOP above.)
- **Docs ride along with the change.** If your work ships / supersedes / invalidates anything in `docs/`
  (or this file), flip that doc's status line in the SAME commit — **statuses change in place; a doc file
  NEVER moves.** `bun run lint:docs` (a hook + first in `bun run check`) fails on a missing `**Status**`
  line, a loose/unknown docs location, a `*-handoff.md`, a bare `docs/<file>.md` path, or CLAUDE.md over
  its ceiling.
- **The admin Reference page rides along too.** Any `apps/admin` change that adds/removes a console PAGE
  or run kind, or changes what an action SPENDS / DELETES / RELEASES, isn't DONE until the operator
  cheat-sheet (`apps/admin/client/src/views/ReferenceView.tsx`) reflects it — in the SAME commit. It's
  static (no test fails when it drifts), so the same-commit habit is the only guard.

## Hard invariants (enforced in code; don't regress them)

- **Hand-authored tours are DEFERRED; the ONE rider artifact is the user-owned DRIVE.** Auth is Better
  Auth (anonymous → free account; there is NO paid tier — premium is bought as CREDITS, a comp is a large
  admin grant; `docs/decisions/cut-tiers.md`). The open anonymous front door is the **PLANNER**:
  `POST /drives/plan`, `POST /drives/propose`, ONE presigned preview clip from the rider's own route, and
  `GET /sample`. The wall lands at `POST /drives` — "Make this drive". A **DRIVE is user-OWNED**
  (`drives.user_id`, never a shared content table). ⚠ `requireAccount` is **per-ROUTE, never on the
  `driveRoutes.use('*', …)` mount** — re-mounting it there silently re-walls the whole preview. Free
  credits are an append-only `credit_entries` ledger (a `FREE_DRIVE_CAP` grant at SIGNUP + lazy backstop;
  value in `apps/api/src/credits.ts` + env, never in prose — −1 at `POST /drives` co-committed via `db.batch`;
  `idempotency_key` UNIQUE = exactly-once; **delete never refunds**). Audio is PRIVATE in R2 (presigned,
  short TTL, after the tier check). See `docs/decisions/credit-ledger.md`.
- **An anonymous session is a REAL user row, DELETED at link — never upgraded.** The Better Auth anonymous
  plugin hard-deletes it on link-to-account and creates a fresh user (verified in the installed plugin
  source). So state that must survive signup lives **on the client** and is re-sent — never keyed on the
  anonymous user id; never write `drives`/`credit_entries` against one; never bulk-delete anonymous rows
  (a reaper breaks conversations mid-flight). ⚠ On the CLIENT, `session` truthiness is **not** "signed
  in" — an anonymous session is truthy; every check goes through the one helper excluding `isAnonymous`,
  mirroring the server's `tierOf`.
- **In-app account deletion is REQUIRED and must PURGE, not just unlink** (App Store 5.1.1(v) — an app
  that creates accounts must delete them from inside; removing this = rejection). `drives.user_id` /
  `credit_entries.user_id` are SOFT refs across the auth pool boundary — **no FK, so no cascade**:
  Better Auth's `deleteUser` alone would orphan a rider's drives + ledger. `purgeUserData`
  (`apps/api/src/account.ts`) runs on **`databaseHooks.user.delete.before`** — the DATABASE hook (not
  `deleteUser.beforeDelete`, which misses the live admin remove-user route), and BEFORE, never after.
  Both choices rest on vendor implementation details and are pinned by
  `apps/api/test/auth-delete-hook.test.ts` — **don't delete that test**; the full argument is in the
  decision record below. Erasure is
  immediate + total; re-signup mints a fresh grant, knowingly. ⚠ The ANONYMOUS mint is NOT account
  creation under 5.1.1(v) — anonymous riders get no in-app delete (founder, 2026-08-03). See
  `docs/decisions/account-deletion-and-recovery.md` + `anonymous-mint-and-account-deletion.md`.
- **Public read paths serve `released_at IS NOT NULL` only; `isAdmin` is the sole bypass.**
  `loadCorpusBySubjectIds`/`corpusForSelection` deliberately apply NO release filter and pass
  `includeStaged: true` — correct, since they resolve a FROZEN selection a rider paid a non-refundable
  credit for, and safe ONLY while every caller is owner-scoped behind `requireAccount`. ⚠ Never put that
  path behind an unauthenticated route — the anonymous preview clip comes from the release-filtered BUILD
  path (`loadCorpusForRoute`), exactly one clip, server-chosen. `docs/decisions/region-release-gate.md`.
- **Curated endpoints are an ALLOWLIST enforced at the WIRE, not in a prompt.** The planner emits **anchor
  ids**, never coordinates; the server re-asserts `endpoint_eligible` per row, and an unknown/ineligible id
  is a 400 **before** any billed Routes call. An off-list ask gets the in-persona "don't know that one" —
  never a geocode. This is what makes "grounded by construction" true, and why `curate-places` is product
  surface, not a leftover CLI.
- **Region is a BBOX — or SEVERAL, `;`-separated — never a stored FK.** POI region = point-in-ANY-box; a drive
  derives region by intersecting its route bbox — NO `region_id`. ⚠ the SINGULAR `parseRegionBbox` REFUSES a multi-box value (fail-closed). `docs/decisions/geometry-first-regions.md` + `multi-bbox-regions.md`.
- **`pois` deduped by Wikidata QID (`pois_qid_uq`).** Every poi is Wikidata-discovered (`source` ∈
  {wikipedia, wikidata}); `(source, source_id)` is a secondary guard, not the arbiter (it survives a
  scenic↔story tier flip). Keep `source`/`source_id` for attribution — Wikipedia is **CC BY-SA**, so the
  studio pipeline MUST freeze credit in `narrations.attribution` for every wikipedia-sourced clip (legal,
  not optional). Google break anchors AND curated drive endpoints are NOT pois — they're the role-tagged
  `places` table (`endpoint_eligible`/`break_eligible`; `google_places` = attribution-only).
- **Persona lives in DELIVERY, never in FACTS.** "Make it funny" never loosens accuracy; a POI with thin/no
  Wikipedia is downgraded to scenic — **silence beats a hallucinated battle**. Persona, voice, and the one
  corny delivery are GENERATION parameters baked into the audio — never live playback toggles (changing any
  = a different telling). Persona resolves in CODE (`personaFromKey`, default `'skipper'`) — no persona/voice
  column on `narrations`; v2 is one host (`'Skipper'`, Charon) at one fixed delivery. The **joke notch is
  CUT** — `jokeLevel` is gone everywhere; delivery variation returns as DIFFERENT NARRATORS (M4), never a
  corniness notch. `docs/decisions/cut-joke-notch.md`.
- **The live PLANNER talks about WHERE, never WHAT.** It is the first time the persona speaks ungated —
  the fail-closed eval panel covers generated clips, not a live turn. It is grounded by CONSTRUCTION: its
  output is TOOL USE (a typed route object + one `say` field; only `say` is shown), and it is given no
  fact sheets and no corpus access. A place question is DEFLECTED in persona ("I'll tell you all about it
  when we get there") — which is also what manufactures the anticipate beat. Grounded place answers are
  and remain `docs/designs/ask-the-skipper-spec.md`, deferred.
- **A narration is only live once it has non-null audio.** A narration is about EXACTLY ONE subject —
  a poi (`narrations_poi_uq`) **or** a `poi_clusters` row (`narrations_cluster_uq`), enforced by the
  `narrations_subject_xor` CHECK. Both FKs are nullable; neither-or-both is a constraint violation. A
  CLUSTER is a group of places told as one thing (Emerald Bay = Vikingsholm + Eagle Falls + Eagle Lake);
  members point at it via `pois.cluster_id`. **Fused tellings are BUILT on both sides** — generation
  (`generate-cluster-narrations.ts`, CLI-only) and serving (`apps/api/src/clusters.ts`, which synthesizes
  the geometry `poi_clusters` doesn't store). A fused clip lands **STAGED**, publishes with the region
  release, and `releasedAt` is never cleared by a regen (release is monotonic). ⚠ Do NOT hang a fused
  telling off one member's `poi_id` — that first cut made `narrations.poi_id → 3rd Street Flats` for a clip
  about downtown Reno. `audio_url` is NOT NULL at the DB boundary. **Break audio is a SEPARATE
  place-anchored `detours` table** (1:1 per place, **DEFERRED/stubbed — nothing writes it yet**); a break is
  NOT a `narrations` row. Only story narrations carry a `facts_hash`; scenic/break are never fact-stale.
  ⚠ There is no drive readiness STATE to wait on (`drives` has no status column; the `'ready'` you'll find
  is a client player phase) — both corpus loaders inner-join the audio, so a silent stop can never enter a
  selection in the first place.
- **Break stops MAY name the place + category, but bake NO VOLATILE data** (hours, rating, popularity) —
  a baked Places name in a frozen R2 clip outlives the DB anchor; mind Places ToS. Volatile data is fetched
  fresh at drive-load.
- **`@skipper/shared` (Zod DTOs) vs `@skipper/db/schema` (Drizzle rows) can collide by NAME at different
  SHAPES** (enforced: `bun run lint:types`). Use Zod types at boundaries; import a DB ROW type only from the
  `@skipper/db/schema` subpath, ALIASED (`import type { Region as RegionRow }`); never `export *` from both
  in one barrel. Today's only live collision is `Region`.
- **`@skipper/db` import is side-effect-free** — the client is lazy (`getDb()` / the `db` proxy build on
  first query), so importing it never requires `DATABASE_URL`; env-free routes like `GET /health` keep booting.

## Two principles that govern the architecture

1. **Fetch FACTS once per place; the NARRATION is the shared atom; ASSEMBLE per drive.** `pois` is the facts
   cache (deduped by QID, re-fetched on a TTL — `facts_fetched_at` is the clock; refresh is operator-run via
   `refetch_facts`/re-sweep). Each place has ONE shared telling: a `narrations` row. **A DRIVE reuses those
   tellings pre-ordered along its route** — content resolves LIVE via subject id, so a regenerated telling
   auto-improves every saved drive. When a re-fetch materially changes a poi's facts (`pois.facts_hash`),
   every narration grounded on them is stale and must regenerate. The corpus pipeline is
   **`discover` → `enrich` → `generate`**: a free sweep populates `pois` for a region bbox
   (`discover-pois.ts`); a PAID `enrich` (`enrich-pois.ts`) scouts each story poi into a curated verbatim
   fact sheet (`pois.fact_sheet`) that drives ground on. A STORY telling REQUIRES a sheet — an un-enriched
   POI is downgraded to scenic. Drives are user-created at runtime (`POST /drives` → `buildDrive`). See
   `docs/decisions/region-corpus-discovery.md` + `corpus-enrichment.md`.
2. **The route is the rails; generation is everything inside.** A drive's route is materialized from the
   rider's A→B (Google Routes) and frozen — the LLM resolves ONLY the ROUTE (endpoints as anchor ids, `via`,
   round-trip, duration target); the SELECTION of which narrations ride it is deterministic (`buildDrive`).
   The failure mode to avoid is letting "curated" creep into the CONTENTS — if the model just reads a fixed
   script, you've rebuilt Shaka Guide with extra steps.

## Stack notes

- **bun everywhere** (package manager + runtime). Internal packages export `.ts` source (no dist build); bun
  runs it, `tsc --noEmit` type-checks. No `tsx`, no `@hono/node-server`.
- Verified majors (exact pins live in `package.json`): TS 6 — do NOT bump to 7: the native/tsgo compiler drops
  the programmatic TS API, and expo's dynamic-config loader `@expo/require-utils` `require('typescript')`s it
  to transpile `app.config.ts`; under 7 `expo prebuild`/`export` die with `ModuleKind` undefined, and
  `tsc --noEmit` alone passes and HIDES it. zod 4 (`z.enum`, top-level `z.uuid()`/`z.url()`); drizzle
  (neon-http, stateless — no interactive transactions; use `db.batch`).
- **The live planner runs a model IN THE REQUEST PATH** — configured unlike a batch call. Model id from a
  named constant in `@skipper/shared`; **thinking stays ON** (disabling it on Opus 5 can emit a tool call as
  plain TEXT — turn succeeds, no error, call never runs — and can leak `<thinking>` tags); LOW effort is the
  latency lever; stream. **Low `maxRetries` (0–1)** + an explicit timeout inside the Cloud Run budget — do
  NOT copy studio's `maxRetries: 5`, tuned for a batch run that already spent. `ANTHROPIC_API_KEY` is now a
  RUNTIME requirement of `apps/api`. ⚠ Never log a request body; never persist a transcript (a
  `conversations` table is new personal data `purgeUserData` must chase — needs a founder call).
- **TTS = Google Cloud Text-to-Speech via REST** (no SDK — raw `fetch` to `…/v1/text:synthesize`), model
  `gemini-3.1-flash-tts-preview`, Gemini-TTS voice **"Charon"** (a fixed function of persona;
  `TTS_MODEL`/`SKIPPER_VOICE_ID` in `models.ts`), OAuth/ADC via `google-auth-library`, NO API key. Output is
  **AAC-LC `.m4a`** (bitrate = `AAC_BITRATE` in `pipeline/loudnorm.ts` — ONE home): TTS returns LINEAR16,
  then ONE ffmpeg pass (`pipeline/loudnorm.ts` `normalizeAndEncode`) does loudnorm + the single AAC encode.
  **ffmpeg is REQUIRED on ship paths** (the encoder, not just QA — throws if absent; Cloud Run carries it).
  `docs/decisions/audio-compression-spike.md`.
- **R2 = Bun's native `S3Client`** (no `@aws-sdk`; `region: "auto"`); studio tsconfig needs `types: ["node","bun"]`.
- **Auth = Better Auth** (`apps/api/src/auth.ts`). It needs interactive transactions, so it runs on its OWN
  `drizzle-orm/neon-serverless` Pool client (`apps/api/src/auth-db.ts`) while the rest stays on neon-http.
  Tables live in the `@skipper/db/auth-schema` subpath (CLI-generated: `bunx @better-auth/cli generate`, then
  `db:generate` + `db:migrate`). There is NO `user.tier` column — premium is CREDITS, not a plan
  (`docs/decisions/cut-tiers.md`); `accessTier` ('anonymous'|'free') is the derived per-request access
  level in `@skipper/shared` (`free` = any signed-in account).
- **Secrets via dotenvx.** `.env.development`/`.env.production` are committed ENCRYPTED; private keys live
  only in gitignored `.env.keys` (onboarding = get it from a teammate — if `dotenvx` can't decrypt, you're
  missing it; stop and ask). Root scripts wrap commands with `dotenvx run -f .env.development`; edit a value
  with `dotenvx set KEY "v" -f .env.development`; `.env.example` is the plaintext catalog. Deploy: set
  `DOTENV_PRIVATE_KEY_PRODUCTION` in the host env.
- **The paid studio pipeline runs from the admin console** (`apps/admin`, behind IAP) or the CLIs in
  `packages/studio/src` — **safe-by-default: preview unless `--apply`** (`docs/guides/ops-scripts-sop.md`).
  `snap-speakable-anchors`, `prune-corpus`, `backfill-poi-extent`, `snapshot-corpus` are FREE (run the last
  before ANY destructive work); `classify-treatments` + `curate-places` SPEND — founder go. ⚠ `curate-places`
  is LOAD-BEARING: the curated `places` set IS the planner's allowlist.
- **Local dev servers stay UP** (the human runs them) — ports: API `bun run dev:api`; admin `bun run dev:admin`
  = vite client **:5173** proxying `/admin`+`/health` → Hono admin-api **:8788** (`ADMIN_DEV_BYPASS=1` skips
  IAP locally); site `bun run dev:site`.
- **Shell is zsh and `~/.zshrc` rides every Bash command** — an unmatched glob ABORTS the command and
  interactive aliases apply. A `CLAUDECODE`-gated guard in the founder's `~/.zshrc` neutralizes both, but
  it is MACHINE-LOCAL: prefer Read/Grep/Glob over shell, guard globs (`2>/dev/null`, `find`), absolute
  paths — ⚠ the Bash **cwd PERSISTS between calls**, so one `cd` silently re-roots every later relative
  path and a grep/`git diff -- path` then matches NOTHING and reads as "clean". Cost two false results.
- **There are TWO skipper prompts and they are NOT interchangeable.** (1) The **narration** prompt
  (`packages/studio/src/persona/skipper.ts`) governs baked audio, is written around the fact sheet and stop
  kinds, and is enforced by the fail-closed eval gate — still the highest-leverage prose in the repo, iterate
  on it more than anything. (2) The **planner** prompt governs the live conversation and has NO gate in front
  of it; it lives where `apps/api` can import it (`apps/api` does NOT depend on `@skipper/studio`). Same
  voice, different job. Never copy fact-sheet / stop-kind language into the planner, or the deflection into
  the narration prompt. Each changes under its own review.
- **`apps/mobile` has a real design system ("Trailhead 89") — never hand-roll a style or a raw color.** The
  rules + what enforces them live in `apps/mobile/CLAUDE.md` (loads when you work there) + `DESIGN.md`.

## Posture & doctrine

- **Correctness over cost.** Choose the right architecture and let the model/tooling do the judgment even
  when a cheap heuristic would save a few dollars (don't keep an arbitrary char-count pre-filter ahead of a
  paid `enrich` — let the enricher decide). This governs DESIGN; *running* a paid job still needs the founder
  OK (STOP).
- **STORAGE IS BREAK-FREELY AGAIN (founder, 2026-07-31): 1.0 will probably never be released.** The
  "assume real riders / additive migrations only" rule is VOID — its premise was a shipped 1.0. Destructive
  migrations are allowed, corpus tables included. ⚠ Two things keep this from being reckless: (1) a corpus +
  R2 **snapshot must exist before any destructive work** — the released corpus cost real money and the ledger
  has no second copy; (2) **`.env.development` and `.env.production` point at the SAME Neon DB and the SAME
  R2**, so there is no staging — `db:push` (drizzle-kit push DROPS to match the schema) and `dev:admin`
  (`ADMIN_DEV_BYPASS=1`, unauthenticated, full delete authority) are aimed at PRODUCTION despite the
  "development" label. The **wire contract** may also break freely: we owe the unreleased 1.0 nothing, there
  is no URL versioning, and the `/version` floor is seeded at a no-op and gates nobody until deliberately
  raised (`docs/decisions/api-versioning-posture.md`).
- **Ground tooling/version decisions in authoritative docs, not memory.** The stack moves fast (bun, Expo/RN,
  drizzle, the SDKs) and training data goes stale — pull the actual current docs for a build/resolution/config
  question and decide from what they SAY; cite what you found so the next agent can re-check (a real miss:
  forcing the bun `linker = "hoisted"` papered over an undeclared `expo-font` import the default isolated
  linker had correctly flagged).
- **Count, authorise, and ACT from ONE expression.** The most-repeated bug class here is two copies of
  "the same" set drifting: `prune-corpus --restore` counted on one predicate and UPDATEd on another
  (restored nothing, printed `✓ N`); the admin confirm counted VISIBLE rows while the body posted
  hand-picked ids. Both fixes deleted the second copy — if a dialog names what a job does, one value.
- **A run that did nothing must not settle GREEN; a paid one reports what it BILLED, not what it
  planned.** `main()` returned void so `runJob` settled `{ok:true}`: a run that gated, billed and
  synthesized NOTHING showed green — as did a judge that never ran, and a truncated verdict scoring
  1.0. The `--max-cost` tally counted one synth per clip while synthesis RE-ROLLS retakes, under-counting
  exactly the spend it bounded. Absence of failure is not success; assert the work happened.
- **A new gate is blind to some SUBJECT KIND — name which before shipping.** The diversity lint could
  never see a second clip; the diversity context could not see FUSED tellings; the fused generator was
  blind to the REGION; renaming a member left its fused clip FRESH. Solo-vs-cluster and per-region are
  the axes that keep getting missed — green on one kind proves nothing about the other.
- **Comments explain WHY, not WHAT.** The dense decision-journal style (rationale, dated founder calls,
  source citations, `⚠` gotchas) is deliberate and earns its keep — KEEP it; "self-documenting code instead"
  would delete the project's memory. But never restate what a line already says, and never bake a VOLATILE
  fact into prose — a bitrate, timeout, dep pin, migration number, table/provider name, or "today only X
  exists" claim. Each has ONE home (the constant, `cloudbuild`/`package.json`, the schema, a
  `docs/decisions/` entry); point there, don't duplicate the value where it silently drifts.
- **Close a task in PLAIN ENGLISH; END with the next step.** A wrap-up REACHING THE FOUNDER opens with a few
  sentences a non-engineer could follow — what changed, what it MEANS — and closes with a scannable
  `**Next:**` line of its own, even when the answer is "nothing"; paths/symbols are the DETAIL between, never
  the explanation. Keys on DESTINATION, not producer — a subagent reporting to an ORCHESTRATOR stays dense
  and structured; the relay gets the treatment. ⚠ Judge by the WORK, not step count. `/wrap-up` = the craft.

## Milestones

(The ladder is ONE artifact: the user-owned DRIVE. Roam removed in 1.1; hand-authored tours stay DEFERRED.
The phone-player bet is unchanged — the artifact is a region's shared `narrations` corpus, reused in order.)

0–2. **BUILT** — Tahoe corpus, the phone player (offline → simulated drive → speed-adaptive triggering +
   debounce → audio + lock-screen Now Playing), the conversational planner, and `apps/api` (`/sample`,
   `/regions`, `/drives/plan`, `/drives/propose` anonymous+capped; the rest of `/drives*` behind PER-ROUTE
   `requireAccount`; signed R2 URLs). CarPlay stays deferred past the MVP — the phone plays via
   mount/Bluetooth. ⚠ **The one step still owed is the one that was always the point: drive it once for
   real** (RISK-1 — see the sweep guide's §0).
3. **Breadth:** more regions' corpora; live break-stop Places data.
4. **Earn the machinery:** `route_sig` dedup + caching, human-review/feedback, more regions
   (Yosemite → Moab; mind seasons).

## Deferred — DO NOT build in v1

Segment trimming / arbitrary start points; the cache-variant + dedup machinery (until M4); **CarPlay
entirely** (both the audio Now-Playing + map templates, revisited only after the phone player proves the
bet); Android Auto; multilingual; the **GROUNDED place-facts Q&A agent** + its on-device fallback
(`docs/designs/ask-the-skipper-spec.md`). ⚠ That is NOT the drive PLANNER — the planner IS built in 1.1 and
IS a live conversational agent; what stays deferred is letting it answer questions about PLACES.

⚠ The **automated grounding gate is BUILT, not deferred**, and it is FAIL-CLOSED: `generate-narrations.ts`
scores every clip through the eval panel and WITHHOLDS one whose grounding/tts gate stays dirty after the
bounded `optimize()` retakes — never synthesized, never persisted, flagged in `eval_scores`. Veracity
stays advisory (no auto-judge for world-truth). `docs/decisions/automated-grounding-gate.md`.

## In-car player landmines (when you get there)

- **Triggering:** do NOT rely on fixed-radius background polling — the OS throttles background GPS and a car
  sails through a 350 m geofence at 60 mph. Use a continuous high-rate foreground service + speed-adaptive
  lead time; `trigger_radius_m` is a floor. Heading gate only above ~5 mph.
- **Audio:** `expo-audio` (NOT `expo-av`, removed in SDK 55); background playback via config plugin. The
  skipper takes EXCLUSIVE focus (`doNotMix`) whenever he speaks — the drive IS the audio (curated soundtrack
  + narration), NOT a voice-over that ducks the rider's music, and pre-drive audio (`GET /sample`, the route
  preview clip) owns the channel the same way. Don't "flip" it to `duckOthers` — ducking was tried and
  rejected. `setAudioModeAsync` is PROCESS-WIDE, so only one surface may own it at a time. See
  `docs/decisions/drive-audio-exclusive-focus.md`.
- **Offline-first:** the store is keyed by NARRATION SUBJECT ID and filled from the `DriveManifest` the app
  already holds (create/open/refresh all return one). ⚠ **Only a drive's own manifest is authoritative for
  that drive** — no bbox-level eligibility rule can guarantee coverage of a selection frozen under a
  different rule, which is why there is no region pack. `docs/designs/offline-region-packs.md`.

## Where truth lives

- **This file = operating truth** — doctrine, hard invariants, stack, workflow; only what an agent must know
  to avoid breaking something or burning money. When something here is superseded, DELETE it and record the
  history in `docs/decisions/` — no strikethrough graveyards.
- **`TODO.md` = engineering backlog** — worked by `/todo`; delete when done — git history is the archive.
- **`docs/` = durable records**, foldered by KIND with a dated **Status** line: `decisions/` (why,
  append-only), `designs/` (future truth at any maturity — the Status line carries idea → build-ready →
  built, not the folder), `research/`, `guides/`. Index: `docs/README.md`. A post-MVP idea defaults to NOT
  scheduled, but **a doc's own Status line wins** — one a greenlit spec pulled in is in scope. North-star
  delighter: **"Ask the Skipper"** (live, grounded, in-persona voice Q&A mid-drive).
- **Code = the rest of current truth** — a doc that disagrees with the code is wrong; fix the doc. Handoff
  docs are ephemeral (deleted once consumed).
