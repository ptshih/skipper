# Admin ops console — build spec

> **Status:** spec, **BUILT (code-complete) 2026-06-10** on branch `feat/admin-ops-v0`, pending
> deploy — greenlit 2026-06-10 (promoted from the `docs/ideas/admin-ops-console.md` brainstorm,
> which this supersedes). **Reviewed under a microscope + hardened 2026-06-10:** GCP claims
> re-verified against current docs, internal contracts spot-checked against the code, and the work
> **sequenced v0 (the Job = cloud execution) → v1 (the admin app = UX/monitoring)** — see §1, §11.
> **Create Tour** (LLM-proposed, human-approved runtime authoring) added to v1 per founder
> requirement 2026-06-10 — see §5b. Builder infra, not a charm feature. Substrate (**Cloud Run
> Jobs**) + auth (**Google IAP, founder-only**) are GA and confirmed.
> **Built:** v0 (`gen_jobs` + migration `0005` + the `job-progress` hook + the `skipper-gen` Job
> image) and v1 (`apps/admin-api` API — IAP gate, monitor reads, job trigger/reconcile, Create Tour —
> + the `apps/admin-web` React/Vite/Tailwind/shadcn SPA with the Google-Maps Create-Tour flow + the
> admin Dockerfile/cloudbuild). All packages typecheck/build, 238 generator tests pass.
> **Pending (founder-gated):** apply migrations `0005`/`0006`; the GCP one-time setup + deploy
> (§10); a local visual pass on the blind-built SPA; merge to main.
> Contracts below (line numbers, SA emails, project id) are real as of writing — the
> code wins if they drift. Pairs with [the Cloud Run deploy guide](../guides/gcp-cloud-run-deploy.md)
> and [the ops-scripts SOP](../guides/ops-scripts-sop.md) (whose safe-by-default contract the
> UI buttons MUST honor).

## 1. Goal & scope

Move tour operations off the founder's laptop into the cloud, fronted (eventually) by a
deployed, founder-only admin app that both **triggers** ops and **monitors** the catalog.

**Sequenced** (the microscope's highest-leverage finding: the core ask is met by the Job alone):

- **v0 — cloud execution.** The `skipper-gen` Cloud Run **Job** wrapping the four existing CLIs
  (generate / patch-clip / resynth / sweep), triggered with `gcloud run jobs execute …` from the
  laptop or a phone. This alone moves execution off-machine — near-zero new surface, immediate value.
- **v1 — the admin app.** `apps/admin-api` (Vite SPA + Hono) behind **IAP**, the `gen_jobs` run
  record, the ear-pass/eval monitor, **and Create Tour** (§5b) — the UX + observability + authoring
  layer on top of v0.

**Create Tour is a v1 requirement** (founder, 2026-06-10): author a brand-new drive at runtime — an
**LLM proposes** named waypoints from a prompt (region + rough start/end + loop/direction), Geocoding
resolves coords, **you approve/edit on a map**, then Routes freezes the rails into a `draft` shell — then
Generate it. See §5b. This **keeps** the "rails hand-curated + frozen" doctrine: the human-approval gate
is the curation (the LLM only drafts), and the freeze just moves from a committed JSON to the DB.

**Out of scope (both):** **dev-DB cloud runs** (prod only — §3); scheduled/autonomous regens; a real
byte-level offline wall. (Tour *seeding* is no longer laptop-only — it moves into the admin per §5b;
the existing committed-seed path stays for the original Tahoe tours.)

## 2. Architecture

```
[Vite SPA] ──/admin/*──> [Hono admin-api]  ── jobs:run ──> [Cloud Run JOB: skipper-gen]   ← v0
  one Cloud Run service (skipper-admin),         │           ENTRYPOINT dotenvx -f .env.production -- bun
  behind Google IAP (founder-only)   ← v1        │           args pick run.ts | patch-clip.ts | resynth | sweep
        │                                          │           writes Neon + R2, spends GCP, ADC→TTS
        ├── creates/polls gen_jobs ◄──────────────┴── job updates gen_jobs (phase/cost/status)
        ├── reconciles status from the Run execution (backstop)
        ├── reads eval_runs / eval_scores  (monitor)
        └── presigns R2  (ear-pass audio)
```

In v0 the laptop's `gcloud` plays the role of the admin-api (trigger only). `skipper-admin` is a
**separate service** from the public `skipper-api` so a routing bug can't leak ops onto the funnel.
The SPA calls `/admin/*` same-origin, so IAP's auth flows naturally.

## 3. Decisions (resolving the idea doc's open questions)

| # | Question | Decision | Why |
|---|---|---|---|
| 1 | Reuse API image or dedicated? | **Dedicated `skipper-gen` Job image** (own Dockerfile mirroring `apps/api/Dockerfile`, workspace trimmed to `generator+db+shared+storage`) | The generator's install closure (Anthropic SDK, google-auth, eval) differs from the API's |
| 2 | DB target dev vs prod? | **Prod only.** ENTRYPOINT bakes `-f .env.production`; dev experiments stay on the laptop CLI | Cloud ops exist to operate the *live* catalog (the canonical demo is in prod) |
| 3 | Live phase/cost surfacing? | A no-op-unless-`GEN_JOB_ID` **`pipeline/job-progress.ts`**, wired ONLY at the 4 ops entrypoint boundaries — never inside `generate.ts`. NB: **cost is not persisted anywhere today** (§9), so the hook is the *only* source of `gen_jobs.costUsd` | Keeps the CLI byte-identical (laptop has no `GEN_JOB_ID`) and risky edits out of `generate.ts` |
| 4 | Light ops same Job or inline? | **All four CLIs through the one `skipper-gen` Job**; override `args` pick the script | Uniform secrets/logging/guardrails + keeps generator deps out of the admin image |
| 5 | IAM identities | **Dedicated SAs:** `skipper-gen@` (Job runtime) and `skipper-admin@` (admin service) | Scopes the spend + trigger surface |

## 4. Data model — `gen_jobs`

New table in `packages/db/src/schema.ts` on the main **neon-http** client (the `db` proxy;
no interactive tx needed). `id` doubles as the `GEN_JOB_ID` the Job receives.

```ts
export const genJobKind = pgEnum('gen_job_kind', ['generate', 'patch_clip', 'resynth', 'sweep_orphans'])
export const genJobStatus = pgEnum('gen_job_status', ['queued', 'running', 'succeeded', 'failed', 'canceled'])

export const genJobs = pgTable('gen_jobs', {
  id: uuid('id').defaultRandom().primaryKey(),            // == GEN_JOB_ID
  kind: genJobKind('kind').notNull(),
  status: genJobStatus('status').notNull().default('queued'),
  targetSlug: text('target_slug'),                        // generate
  tourId: uuid('tour_id').references(() => tours.id, { onDelete: 'set null' }),
  targetId: text('target_id'),                            // stop/bracket/tour id for ops
  args: jsonb('args').notNull(),                          // the exact override args (audit + replay)
  dryRun: boolean('dry_run').notNull().default(true),
  phase: text('phase'),                                   // best-effort: discovery|narration|tts|finalize|…
  costUsd: doublePrecision('cost_usd'),                   // exact LLM + ESTIMATED TTS; null if the run crashed pre-finishJob (§9)
  evalRunId: uuid('eval_run_id').references(() => evalRuns.id, { onDelete: 'set null' }),
  cloudRunExecution: text('cloud_run_execution'),         // execution resource name (logs/cancel/reconcile)
  triggeredBy: text('triggered_by').notNull(),            // IAP-asserted email (v0: 'cli')
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
})
```

Migration: add the table → `bun run db:generate` (emits SQL in `packages/db/drizzle/`) →
`bun run db:migrate` (dev) and `bun run db:migrate:prod` (prod). Additive, no destructive change.

> `gen_jobs` is part of **v0** too — even gcloud-triggered runs should record. In v0 the Job's
> `job-progress.ts` hook creates the row itself (no admin-api) and `triggeredBy='cli'`.

## 5. The `skipper-gen` Cloud Run Job (v0)

- **Image:** new `packages/generator/Dockerfile` mirroring `apps/api/Dockerfile`: `FROM oven/bun:1`,
  trim the workspace to `generator+db+shared+storage`, `bun install --production`, COPY src + the
  dotenvx-encrypted `.env.production`. Pushed to
  `us-east4-docker.pkg.dev/lithe-window-491818-k8/skipper/skipper-gen`.
- **ENTRYPOINT:** `["dotenvx","run","-f",".env.production","--","bun"]`. The per-execution
  override `args` supply the script path + flags, so one Job serves all four CLIs.
- **Runtime SA** `skipper-gen@lithe-window-491818-k8.iam.gserviceaccount.com`:
  `roles/secretmanager.secretAccessor` on `dotenv-private-key-production`. **TTS needs NO extra IAM
  role** — `texttospeech.googleapis.com` enabled + the SA's metadata access token at `cloud-platform`
  scope + billing is sufficient (verified: Cloud TTS has no granular synthesize permission;
  `pipeline/tts.ts` `getAuth()` reads the token off the Cloud Run metadata server — no key file).
  `GOOGLE_CLOUD_PROJECT` + R2 vars come from the decrypted `.env.production`.
- **Create:** `gcloud run jobs deploy skipper-gen --image=… --region=us-east4
  --set-secrets=DOTENV_PRIVATE_KEY_PRODUCTION=dotenv-private-key-production:latest
  --service-account=skipper-gen@… --max-retries=0 --task-timeout=3600` (`jobs deploy` is
  create-or-update; **`--max-retries=0`** so a half-run regen never silently re-fires; 60-min
  timeout covers the ~13-min worst case AND is the only hard wall on a runaway run — see §12).

### Override-args contract (admin-api / gcloud builds these per kind)

Verified against the live parsers. **Value flags MUST use the `=` form** — `ops.ts:40`
(`!next.startsWith('--')`) makes the space form drop any value beginning with `--`, which patch text
can (`run.ts`'s own parser already requires `=`):

| kind | `args` array |
|---|---|
| `generate` | `["packages/generator/src/run.ts", "<slug>", "--max-cost=<usd>", "--joke-level=<notch>", "--duration=<bucket>"]` (+ bare `--dry-run`, `--no-judge-closers`) |
| `patch_clip` | `["packages/generator/src/patch-clip.ts", "<stopOrBracketId>", "--find=<text>", "--replace=<text>"]` (+ bare `--all`, `--apply`) — **`=` form, not space** |
| `resynth` | `["packages/generator/src/resynth-tour.ts", "<tourId>"]` (+ bare `--apply`, `--keep-old`) |
| `sweep_orphans` | `["packages/generator/src/sweep-orphans.ts", "<tourId>"]` or `["…/sweep-orphans.ts","--all"]` (+ bare `--apply`, + `--yes` when `--all --apply`) |

**Trigger call** (admin-api v1, with its SA's metadata **access** token as Bearer):
`POST https://run.googleapis.com/v2/projects/lithe-window-491818-k8/locations/us-east4/jobs/skipper-gen:run`
```json
{ "overrides": { "containerOverrides": [
  { "args": ["packages/generator/src/run.ts","emerald-bay","--max-cost=3"],
    "env": [{ "name": "GEN_JOB_ID", "value": "<gen_jobs.id>" }] }
] } }
```
Because this sends an `overrides` body, the caller SA needs `run.jobs.runWithOverrides` — see §10.

## 5b. Create Tour — LLM-proposed, human-approved (v1)

**Today** authoring is a 3-step commit operation: a `TourSpec` in `packages/db/seed/tour-specs.ts`
(slug, region, headline, summary, anchors, **ordered `waypoints[{label,lat,lng}]`**) → `materialize.ts`
calls **Google Routes v2** (`routes.googleapis.com/directions/v2:computeRoutes`, `GOOGLE_MAPS_API_KEY`,
`HIGH_QUALITY`) to snap the pins into a frozen `[lng,lat]` polyline + distance/duration → a **committed**
`seed/data/<slug>.json` → `seed.ts` upserts the region + a `draft` row.

**The admin replaces the hand-written spec with an LLM-drafted, human-approved one** (founder decision
2026-06-10). The flow is deliberately two-phase so the **human-approval gate is structural, not UI
convention** — the route does not freeze until you approve.

### Doctrine check (principle #2: "rails hand-curated + frozen, never derived")
The **LLM drafts; you curate by approving; then it freezes.** The approval gate IS the curation — a person
with taste signs off before anything is frozen — so "hand-curated" stays true and the route is still
frozen-once (never re-derived at request time). This was an explicit founder check, not a quiet
reinterpretation; a *one-shot* prompt→tour with no gate would have amended the doctrine and was rejected.
**On build, principle #2 gets a one-line clarification** ("LLM-drafted, human-approved, then frozen").
Keep this separate from the content rule: the LLM proposes **the rails only** — the narratable **stops**
are still discovered independently by the generator from the corridor (Wikidata/Wikipedia/Places). Don't
let the route-LLM pick content; that re-tangles the exact separation #2 protects.

### Labor split (each tool does what it's good at)
- **LLM →** the *itinerary*: named, ordered waypoints + a one-line rationale each, plus draft headline /
  summary / anchor names. Taste + geographic knowledge. (Anthropic call, Opus-class; one call, cheap.)
- **Google Geocoding/Places →** the *coords*: resolve each name, **region-bbox-biased**, with a confidence
  signal. NOT the LLM emitting raw lat/lng (hallucination). Reuses `GOOGLE_MAPS_API_KEY`.
- **Routes v2 →** *routability*: snaps + proves the road exists (a bad pick shows as a wrong polyline).
- **You →** approval on the map.

### The flow (cheap, inline — NOT the Job)
1. **Refactor** `seed/materialize.ts` to export a file-free **`materializeRoute(waypoints) →
   {polyline, distanceMeters, durationSeconds, provenance}`** (Routes call + decode, no JSON write); the
   CLI keeps wrapping it to write `seed/data/*.json`, the admin-api calls it directly.
2. **Propose** — `POST /admin/tours/propose` `{regionSlug, regionName?, roughStart, roughEnd,
   loopOrDirection, vibe?}` → 1 LLM call → named waypoints → geocode each (region-biased) → return the
   proposal `{waypoints:[{label,lat,lng,rationale,geocodeConfidence}], headline, summary, anchors}`.
   **No DB write, no freeze** — just data for the map.
3. **Curate** — you edit/reorder/drop/add/rename pins on the map and fix the slug/metadata.
4. **Freeze** — `POST /admin/tours` `{slug, region…, headline, summary, anchors, waypoints[] (approved),
   proposal}` → validate (unique slug; ≥2 waypoints) → `materializeRoute(approved)` (one Routes request,
   seconds, ~sub-cent) → upsert region + insert a `draft` tour with the polyline + **`tours.routeProvenance`
   jsonb** (the *prompt* + the *LLM proposal* + model id + *your edits* + Routes totals — a far richer
   "why this route exists" trail than the old committed JSON) → return the draft.
5. **Generate** — you hit Generate → the existing `skipper-gen` Job (§5) fills the stops.

**Schema add:** `routeProvenance: jsonb('route_provenance')` on `tours` (additive; storage break-freely).
Both propose + freeze are cheap synchronous calls, so Create Tour runs **inline in the admin-api**, not as
a Cloud Run Job (only generation is Job-worthy).

> Couplings (see §12): admin-created routes live in the DB, not a committed file; a **brand-new region**
> may still need a `PersonaDef` in code for a bespoke host (an existing region like `lake-tahoe` is fully
> runtime); and the propose-prompt should be seeded with the region/persona taste so picks aren't generic.

## 6. The `apps/admin-api` service (v1)

One bun + Hono container (same stack as `apps/api`) that serves the built **Vite SPA** (React +
TS) as static assets AND exposes the `/admin/*` JSON API:

| Route | Does |
|---|---|
| `POST /admin/jobs` | Validate + guard (§8), insert a `gen_jobs` row (`queued`), call `jobs:run` with `GEN_JOB_ID`, store `cloudRunExecution`, return the row |
| `GET /admin/jobs` / `GET /admin/jobs/:id` | List/poll runs; on read, reconcile a stale `running` row against the Run execution status (backstop) |
| `GET /admin/tours` / `GET /admin/tours/:id` | Catalog + full tour (stops/brackets/scripts/eval) for the ear-pass |
| `GET /admin/tours/:id/sign` | Presigned R2 URLs for inline audio (reuse `@skipper/storage` + the api's sign logic) |
| `GET /admin/evals?slug=` | `eval_runs`/`eval_scores` history; the UI auto-diffs latest-vs-prior |
| `POST /admin/tours/propose` | **Create Tour, phase 1** (§5b): prompt → 1 LLM call → named waypoints → geocode (region-biased) → return the proposal for the map. No DB write, no freeze |
| `POST /admin/tours` | **Create Tour, phase 2** (§5b): the approved waypoints → `materializeRoute()` (inline Routes call) → upsert region + insert `draft` + `routeProvenance` → return the draft |
| `GET /admin/regions` | List regions for the Create-Tour form |

The SPA: a **Runs** view (table + a "New run" form, dry-run default, live status poll), a **Tour**
ear-pass view (ordered stops/brackets, inline audio, grounding/diversity/charm verdicts), and an
**Evals** view (per-slug trend + auto prior-vs-latest diff — the "0.818→0.909" done by hand today).

`apps/admin-api` joins the bun workspace; declare its phantom deps explicitly (the mobile workspace's
isolated-linker lesson) — it's a server+SPA, so lower-risk than the RN app.

## 7. Auth — Google IAP, founder-only (v1)

- Enable IAP **directly** on `skipper-admin` (GA; no load balancer; covers the `run.app` URL and all
  ingress). One-time OAuth brand/consent setup (org-level).
- Grant `user:ptshih@gmail.com` `roles/iap.httpsResourceAccessor` on the service's IAP resource.
- Deploy WITHOUT `--no-invoker-iam-check`; enabling IAP adds a
  `serviceAccount:service-666110297056@gcp-sa-iap.iam.gserviceaccount.com → roles/run.invoker`
  binding — **which DRS will block; see §10.**
- **Belt-and-suspenders:** Hono middleware asserts `X-Goog-Authenticated-User-Email` == the founder
  email on every `/admin/*` request. For the signature-verified version, validate
  `X-Goog-IAP-JWT-Assertion` with the **direct-Cloud-Run audience**
  `/projects/666110297056/locations/us-east4/services/skipper-admin` — **NOT** the load-balancer
  `…/global/backendServices/…` form (that audience would reject every request).

## 8. Guardrails (the SOP, carried into buttons)

- **Dry-run is the default** in the "New run" form; spending requires an explicit toggle.
- **Cost preview before spend:** show the `spend.ts` estimate (`llmSpentUsd` exact post-narration;
  `estimateTtsUsd` for audio) and always send `--max-cost` (a UI-set ceiling). NB the cap fires
  *pre-TTS only* (§12).
- **Every prod spend requires a typed confirm.** `tours.isPreview` was dropped 2026-06-09 (a CLAUDE.md
  invariant), so there is **no DB flag** for "the canonical demo" — rather than reintroduce one, treat
  *all* prod generate/resynth/patch/sweep as demo-sensitive: a typed confirm gates every spending run.
  (Optional extra friction: a `PROTECTED_SLUGS` config constant the UI double-flags.) `eval_runs.artifact`
  already snapshots the prior telling for rollback reasoning.
- **Idempotency:** create the `gen_jobs` row before `jobs:run`; only trigger when
  `status='queued' AND cloud_run_execution IS NULL`, and persist the execution name before any
  retry — so neither a UI double-click nor a lost-response retry can double-spend.
- `--all --apply` (sweep) sends `--yes` only behind the same typed confirm.

## 9. Observability — the `gen_jobs` lifecycle

1. **Trigger** (admin-api in v1; the hook itself in v0) inserts the row (`queued`) + stores
   `cloudRunExecution`.
2. **Job** (`pipeline/job-progress.ts`, active only when `GEN_JOB_ID` is set): flips `running` +
   `startedAt` at entry; on the existing `lap(phase)` calls (`discovery, places, deepenFacts, geology,
   scout, narration, evalPanel, bracketNarration, tts, finalize`), best-effort `UPDATE … SET phase,
   cost_usd = llmSpentUsd()+ttsEst`; on exit sets `succeeded|failed` + `endedAt` + `error` + links
   `evalRunId` (from `recordGenerationEval`'s return). Wired ONLY in the 4 entrypoints' top-level
   `main()` (each already has a `main().catch()` boundary — confirmed).
3. **admin-api reconcile (backstop):** on any read of a non-terminal row whose `updatedAt` is stale,
   fetch the Run execution; if `Failed`/`Cancelled`/`Succeeded`, settle the row.

> **Cost caveat (verified):** the DB persists **no** cost today — `eval_runs` has no cost column and the
> `spend.ts` tally dies with the process. So `gen_jobs.costUsd` comes *only* from the `finishJob` hook;
> a **hard crash before the hook leaves `costUsd` null** (the reconcile backstop can settle *status*
> but cannot recover cost). And the TTS half is an **estimate** (`estimateTtsUsd`), not GCP billing
> truth — only LLM spend is exact. Don't read `costUsd` as authoritative spend.

A truly minimal first cut can defer step 2's per-phase tick — terminal status + final cost +
`evalRunId` still come from the entry/exit hooks; the reconcile backstop covers crashes.

## 10. Deploy / CD (mirrors the existing api + site triggers)

- `apps/admin-api/Dockerfile` (v1 admin service) + `packages/generator/Dockerfile` (v0 Job image), each
  pushed to the `skipper` Artifact Registry repo.
- **`cloudbuild.gen.yaml`** (v0) — build → push → `gcloud run jobs deploy skipper-gen` (create-or-update).
- **`cloudbuild.admin.yaml`** (v1) — build → push → `gcloud run deploy skipper-admin` (IAP, not public).
- Cloud Build triggers on the existing `skipper-gh` connection, path-filtered: `packages/generator/**`
  (+ db/shared/storage) → the gen Job; `apps/admin-api/**` → admin.
- **One-time IAM / setup:**
  - Create the two SAs. `skipper-gen@`: `secretmanager.secretAccessor` on the dotenv key. `skipper-admin@`:
    **`roles/run.developer` on the `skipper-gen` job** — *not* `run.invoker`: invoker carries
    `run.jobs.run` but **not** `run.jobs.runWithOverrides`, and we always send an overrides body;
    `run.developer` also grants `run.executions.get` for the reconcile backstop. Plus
    `secretmanager.secretAccessor`.
  - Enable `iap.googleapis.com` + `texttospeech.googleapis.com`.
  - **DRS landmine (this project IS under Domain Restricted Sharing):** enabling IAP tries to bind the
    out-of-domain IAP service agent (`gcp-sa-iap`) as `run.invoker` — the legacy
    `iam.allowedPolicyMemberDomains` constraint blocks Google-managed service-agent grants, the same
    policy that forced `--no-invoker-iam-check` for the public API. **Temporarily relax DRS (or add a
    managed-policy/custom-policy exception for `gcp-sa-iap`) to register the binding**, then restore.
    Needs `roles/orgpolicy.policyAdmin`.

## 11. Build plan

**v0 — cloud execution (ship first, gcloud-triggered):**
1. `gen_jobs` table + migration (additive, no behavior change).
2. `pipeline/job-progress.ts` + the 4 one-line entrypoint wirings (no-op without `GEN_JOB_ID`);
   verify the laptop CLI is byte-identical.
3. `skipper-gen` Job: Dockerfile, image, `jobs deploy`, the two SAs/IAM, TTS-via-ADC. Smoke-test a
   `--dry-run` generate via `gcloud run jobs execute`. **← v0 done: execution is in the cloud.**

**v1 — the admin app (fast-follow):**
4. `apps/admin-api`: Hono `/admin/jobs` (create + list/poll + reconcile) + a minimal Vite Runs view
   (dry-run-default form). IAP (incl. the DRS step). **← the v1 MVP slice.**
5. **Create Tour** (§5b): the `materializeRoute()` refactor + the `tours.routeProvenance` migration +
   `POST /admin/tours/propose` (LLM + region-biased geocode) + `POST /admin/tours` (freeze) +
   `GET /admin/regions` + the **map review/edit UI** (the propose proposal → approve gate).
6. The ear-pass tour view + presign, the eval-diff view, then per-phase live ticking.

## 12. Watch-items, scope & risks

- **Create Tour moves authoring into the admin (v1 requirement) — three couplings to mind:**
  - **Routes for admin-created tours live in the DB** (`tours.polyline` + `routeProvenance`), NOT a
    committed `seed/data/*.json`, so the repo no longer fully describes the catalog. Acceptable under
    no-users / destructive-OK storage; the committed-seed path stays for the original Tahoe tours.
    (Optional: have `POST /admin/tours` also emit a downloadable seed JSON if a committed copy is ever wanted.)
  - **New regions may still need code:** persona resolves from the region slug (`personaForRegion` →
    `PersonaDef`); a brand-new region with no `PersonaDef` falls back to the default skipper. Creating
    tours in an EXISTING region (`lake-tahoe`) is fully runtime; a bespoke new-region host is still a
    code commit (the region-skippers idea).
  - **The seed's Tahoe-bbox sanity check** (validates the polyline sits in a Tahoe bounding box) must be
    generalized/parameterized by region — or dropped — before creating tours outside Tahoe.
- **`--max-cost` is pre-TTS only:** it aborts before audio, but LLM spend is already sunk and there's
  no Ctrl-C in the cloud — a runaway narration is capped only by the 60-min task-timeout. Keep it tight.
- **Concurrent executions** on the same slug can race the ready-gate (Jobs allow parallel executions);
  the §8 idempotency gate covers the common double-trigger, not two deliberately different ops at once.
- **Crashed `running` rows** linger until someone opens the UI to trigger the reconcile (fine, single-user).
- **Risk:** generation writes to **prod** — the typed-confirm guard + `--max-cost` + dry-run default
  are the only things between a button and a burned demo; treat them as load-bearing, not polish.

## 13. Refs

- `docs/guides/gcp-cloud-run-deploy.md` (project `lithe-window-491818-k8`/us-east4, Compute SA, Dockerfile + cloudbuild + Secret-Manager-dotenvx pattern, the api + site triggers to mirror, the DRS history)
- `docs/guides/ops-scripts-sop.md` (the safe-by-default contract)
- `packages/generator/src/{run,patch-clip,resynth-tour,sweep-orphans}.ts`, `pipeline/{ops,spend,generate,persist,tts}.ts` (arg contracts incl. the `=`-form value-flag rule at `ops.ts:40`; the `lap()` phase points; eval/cost recording; the seed requirement at `persist.ts:85`; TTS ADC)
- `packages/db/src/schema.ts` (`eval_runs`/`eval_scores` — note: no cost column; `gen_jobs` + `tours.routeProvenance` land here), `packages/db/drizzle/` (migrations)
- `packages/db/seed/{tour-specs,materialize,seed}.ts` + `seed/data/*.json` (the today authoring chain Create Tour refactors: `materializeRoute()` extraction, Routes v2 + Geocoding/Places via `GOOGLE_MAPS_API_KEY`, the `draft` upsert, the Tahoe-bbox check to generalize)
- **GCP docs verified 2026-06-10:** [`jobs:run` overrides](https://docs.cloud.google.com/run/docs/execute/jobs) · [IAP-for-Cloud-Run (GA, direct)](https://docs.cloud.google.com/run/docs/securing/identity-aware-proxy-cloud-run) · [IAP signed-header audience](https://docs.cloud.google.com/iap/docs/signed-headers-howto) · [run IAM roles](https://docs.cloud.google.com/iam/docs/roles-permissions/run) · `run.invoker` lacks `runWithOverrides`: [issuetracker 298810674](https://issuetracker.google.com/issues/298810674) · [TTS auth](https://docs.cloud.google.com/text-to-speech/docs/authentication) · [DRS](https://docs.cloud.google.com/organization-policy/domain-restricted-sharing)
