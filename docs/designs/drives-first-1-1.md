# 1.1 — Drives first: remove roam, plan a drive by talking

> **Status:** BUILD-READY, **greenlit 2026-07-31** (founder). Supersedes the roam-first PRODUCT
> structure of [roam-first-create-a-drive.md](roam-first-create-a-drive.md) (its shared-corpus DATA
> model is unchanged and load-bearing). Rationale: [drive-as-arc.md](drive-as-arc.md). Consumes
> [offline-region-packs.md](offline-region-packs.md) — ⚠ **its D1 holds; the REGION PACK itself is
> cut from 1.1.** D1's load-bearing half was always the per-drive top-up ("only a drive's own manifest
> is authoritative for that drive", and it's nearly free since `createDrive`/`getDrive` already return
> a full `DriveManifest`) — that survives as INV-6. The pack's *purpose* was ambient proximity
> playback, which dies with roam: a drives-only rider can only play clips that are in some drive's
> manifest. So "no new endpoint" is true again. Line numbers drift — **code wins**.

## Objectives

1. **Promote and fix DRIVES as the primary experience.**
2. **Drastically simplify the MVP's surface area** — fewer edge cases, less bloat, fewer bugs.

## Thesis

A drive is an **ARC**: *prepare → preview → anticipate → experience*. Roam has only the fourth beat,
which is why a drive out-charms a roam session **on identical clips**. The first three beats are where
the magic is manufactured, and they are the cheapest to improve — none of them needs a car.

1.1 rebuilds *prepare* as a **conversation with the skipper**, opens *preview* to anonymous riders in
full, and deletes the mode that only ever had beat four.

---

## Decisions

All settled. If you think one is wrong, raise it before building — don't re-litigate mid-sweep.

| # | Decision |
|---|---|
| D1 | Roam is removed **completely** — client, server, engine, DTOs. Git is the archive. |
| D2 | `GET /roam/sample` → **`GET /sample`**, no alias (see D3). The postcard survives. |
| D3 | **We owe the submitted 1.0 nothing.** No wire compat, no aliases, no `/version` floor games — the only builds in the wild are the founder's own TestFlight installs. |
| D4 | **Full greenfield storage** — destructive migrations allowed everywhere, corpus tables included. **Gated on D5.** |
| D5 | **Snapshot first**: export `pois`/`narrations`/`poi_clusters`/`regions`/`places` + all R2 audio offsite **before any destructive work**. Free, one-time, non-negotiable. |
| D6 | Home **is** the conversation. `app/create.tsx` is deleted. |
| D7 | Free text **replaces** the START/END pickers entirely. The full-screen picker sheet is deleted. |
| D8 | The planner is **the Skipper, in character** — the first time the persona speaks live. |
| D9 | The planner resolves the **ROUTE only** and **never discusses places** — it deflects in persona. Stop selection stays deterministic in `buildDrive`. |
| D10 | Conversation state is **stateless** — client holds the transcript and sends it each turn. **No `conversations` table.** |
| D11 | Paid route materialization fires **only** on an explicit rider yes ("want me to draw that up?"). |
| D12 | The per-conversation turn cap is expressed **in persona** — the skipper wraps up, never an error. ⚠ UX only; not the guard (INV-3). |
| D13 | The preview renders **inline in the conversation** as a rich card. The separate confirm screen is deleted. |
| D14 | Anonymous riders get the **whole preview** — route, duration, stop count, and **one real clip from their own route**. Wall at "Make this drive". |
| D15 | `requireAccount` moves **off** the `/drives*` sub-app mount onto individual routes. |
| D16 | The client **mints an anonymous Better Auth session at app open**. ⚠ RISK-3. |
| D17 | The blank page is solved by **tappable example asks** under the input. |
| D18 | Offline home: the conversation shows an **in-persona unavailable state**; MY DRIVES stays fully live. |
| D19 | Both tastes survive: the `GET /sample` postcard (1-tap) **and** the route-stop preview (conversion). |
| D20 | Offline is the **subject-keyed store + per-drive top-up**. The top-up alone is sufficient AND authoritative (INV-6). |
| D21 | The **REGION PACK is CUT from 1.1** — its purpose was ambient proximity playback, which dies with roam. No pack endpoint, no `bbox` on `/regions`, no ~138 MB download. Revisit only if per-drive downloads prove insufficient on a real trip; the store is already keyed so it would be additive. |
| D22 | The 5 districts are **re-anchored as points**. Verified free — all five scripts are place-scoped with zero motion-dependent phrasing, so **no regen is needed**. |
| D23 | The two near-duplicate Carson City districts **merge**; the weaker is retired via `excluded_reason`. |
| D24 | Runtime form handling collapses to `story` **only in `apps/api` + `apps/mobile`**, plus a loud guard (INV-7). The studio's scenic-downgrade path **stays**. |
| D25 | `drive_demand` — **drop the table, the upsert, the schema block, and the M4 reference.** PostHog is the demand instrument. (Resolves the earlier contradiction: there is no "fix `distinct_users`" work.) |
| D26 | Dead studio CLIs deleted: `regen-report.ts`, `rename-roam-prefix.ts`, `test-mastering-chain.ts`, and `golden.ts`'s unrun `TTS_CASES`/`DIVERSITY_CASES`. |
| D27 | `detours` structural tests removed (zero writers). The table stays until an explicit drop call. |
| D28 | **Drive music is OUT of scope** — it stays as-is. |
| D29 | Credits stay **exactly as built**. The wall is ownership *and* money; disclose the cost before spending it. |
| D30 | Ask-the-Skipper stays **deferred**. The planner gets no retrieval. |
| D31 | The full analytics event set ships with 1.1. |
| D32 | Tests cover the **access and cost boundaries** first. |
| D33 | Planner model: **`claude-opus-5`, thinking ON, effort `low`/`medium`, streaming.** ⚠ INV-8. |
| D34 | Abuse control is **session id + IP limiting**. The per-instance tail risk under autoscale is accepted; no global spend ceiling (RISK-4). |
| D35 | Preview audio takes **exclusive focus**, same as a drive. Only the drive and pre-drive skipper audio ever own the channel. |
| D36 | Simplification scope is **repo-wide, admin and studio included** — ⚠ except `curate-places` (INV-2). |
| D37 | Ships as **one 1.1**, one submission, App Store listing rewritten in the same pass. |
| D38 | Built on **`main`**, atomic commits per build step. No release branch. |
| D39 | `docs/ideas/` + `docs/specs/` merged into **`docs/designs/`** (done). |

---

## INVARIANTS — verified hazards. Do not violate.

Each was found by auditing code, not by reasoning. Breaking one is a silent production defect.

**INV-1 — The anchor allowlist is enforced at the WIRE, not in the prompt.**
Today `driveProposeRequest`/`createDriveRequest` accept a free `{name, lat, lng}` and pass it straight
into a **billed** Google Routes call, and `RegionAnchor` has **no `id` field at all**. Opening
`/propose` to anonymous without fixing this creates an unauthenticated endpoint that bills Routes for
any two points on Earth, and "grounded by construction" degrades to "the prompt asked nicely."
→ Add a stable `id` to `places`/`RegionAnchor`. The propose/create requests carry **anchor ids, never
coordinates**. The server loads each row and re-asserts `endpoint_eligible`; an unknown or ineligible
id is a **400 before any Routes call**. An off-list ask gets the in-persona "don't know that one" —
**never** a geocode.

**INV-2 — `curate-places` is load-bearing. The sweep must not touch it.**
With the pickers gone, the curated `places` set **is** the planner's allowlist — the thing that makes
INV-1 true. `curate-places.ts`, the `curate_places` job kind, and the admin `/places` page are product
surface, not leftovers. Widening the anchor set is a **PAID** run needing an explicit founder go.

**INV-3 — The turn cap is advisory; bound the REQUEST.**
A stateless server cannot count turns it does not store, and `readJsonBody` has **no body-size limit**.
One unauthenticated request could carry a megabyte transcript and bill Opus input tokens.
→ `POST /drives/plan` enforces, server-side and independent of anything the client asserts: a **max
body size** (rejected before parsing), a **max message count and max total characters** in the Zod
schema, and a hard **`max_tokens`** on the model call. Never trust a caller-supplied turn count.

**INV-4 — The anonymous user row is DELETED at link, not upgraded.**
Verified in the installed `better-auth` anonymous plugin source: `onLinkAccount` runs, then the
anonymous row is hard-deleted and a **new** user is created. `apps/api/src/auth.ts` already documents
this and `shouldGrantAtSignup` depends on it.
→ The proposal survives the wall **on the client** (the transcript is already client-held) and is
re-sent after signup. **Never** key state on the anonymous user id and read it back after signup, and
**never** write `drives`/`credit_entries` against an anonymous user id — that internal delete does not
run `purgeUserData`.

**INV-5 — The anonymous preview clip comes from the BUILD path, never the frozen-resolution path.**
`loadCorpusBySubjectIds`/`corpusForSelection` deliberately apply **no** release filter and pass
`includeStaged: true` — correct, because they resolve a frozen selection a rider paid for. That is
safe **only** while every caller is owner-scoped behind `requireAccount`. Presigning from that path
for an anonymous rider **publishes unreleased work**.
→ The preview clip comes from `loadCorpusForRoute` (release-filtered). Exactly **one** clip per
proposal, chosen server-side from that proposal's own selection — the preview is never a list. Public
read paths serve `released_at IS NOT NULL` only; `isAdmin` is the sole bypass.

**INV-6 — Only a drive's own manifest is authoritative for that drive.**
A drive's stops were frozen under a policy that has since moved — a POI later given an
`excluded_reason`, a POI later absorbed into a released cluster, or (for the founder's own drives)
STAGED clips. **No bbox-level eligibility rule can ever guarantee coverage of a frozen selection**,
which is why the per-drive top-up is structural rather than an optimization — and why a region pack
could never have replaced it (`offline-region-packs.md` D1).
→ Every time the app holds a `DriveManifest` (create, open, refresh) it fills the subject-keyed store
with any subject it lacks. Nearly free: those endpoints already return the full manifest. The
migration from `drives/<driveId>/<seq>.m4a` to the subject-keyed store must **re-key existing bytes**,
never delete-and-refetch — a rider offline at a trailhead mid-upgrade must not lose their download.

**INV-7 — Collapsing form handling must fail loudly, not silently.**
The corpus is 458/458 `story`. Collapse the runtime switch, but guard so a non-`story` narration
reaching a client **fails loudly** rather than quietly serving something the player cannot render. The
studio's scenic-downgrade path stays intact — drive pacing needs the density lever.

**INV-8 — Never disable thinking on the planner.**
On `claude-opus-5`, `thinking: {type:'disabled'}` has a documented failure mode where the model writes
a tool call into **visible text** instead of a `tool_use` block: the turn succeeds, no error is raised,
and **the call never runs**. For a planner whose whole contract is emitting a structured route, that is
a silent wrong answer — worst on tool-heavy paths. It can also leak `<thinking>` tags into rider-facing
text. Thinking is **on by default**; leave it on and use **low effort** as the latency lever.
Disabling it is rejected outright above `high` effort anyway.

**INV-9 — On the client, `session` truthiness is NOT "signed in".**
An anonymous session is truthy. Today home hides Sign-in and Settings renders the entire account block
(name, email, Sign out, Delete Account) on bare `session` truthiness — which for an anonymous user
shows a synthetic `temp-…@…` address and a delete flow that **cannot succeed** (no credential for
`sensitiveSessionMiddleware`).
→ Every client signed-in check goes through **one shared helper that excludes `isAnonymous`**,
mirroring the server's `tierOf`. A bare `session ?` in a screen is a bug. Register the anonymous client
plugin in `apps/mobile/src/lib/auth.ts` when the mint lands.

**INV-10 — There are TWO skipper prompts and they are not interchangeable.**
(1) The **narration** prompt (`packages/studio/src/persona/skipper.ts`) governs baked audio, is written
around the fact sheet and stop kinds, and is enforced by the fail-closed eval gate. Still the
highest-leverage prose in the repo. (2) The **planner** prompt — one file, importable by `apps/api`,
which does **not** depend on `@skipper/studio` — governs the live conversation and has **no gate in
front of it**. Same voice, different job: the planner knows routes and the anchor list and **nothing**
about places. Never copy fact-sheet or stop-kind language into the planner, or the deflection into the
narration prompt. Each changes under its own review.

**INV-11 — Rider-triggered spend is governed by CAPS, not a founder go-per-run.**
The STOP rule governs **operator** batch spend (studio CLIs, admin jobs) and still does. `POST
/drives/plan` and `POST /drives/propose` spend on **every rider request, forever**, with no `--apply`
and no human in the loop. Their guards are: an explicit model + `max_tokens` in code, a bounded request
(INV-3), the rate limiter, and a recorded per-call token tally. **Adding a new rider-triggered paid
call is itself a founder decision; raising an existing cap is not a refactor.**
→ The pricing table and `recordModelUsage` live in `@skipper/studio`, which `apps/api` does not depend
on. Move them to `@skipper/shared` so the request path can price what it spends.

**INV-12 — Every rider-facing cap lives in ONE module, and the turn cap is not built on `rateLimit()`.**
Limits are currently inline magic numbers across four files, and `rateLimit()` returns `next()`
unconditionally under `NODE_ENV=test` — so a cap built on it is **untestable by construction**, which
collides with D32.
→ One module (`apps/api/src/limits.ts`), named constants with rationale. Body limits and the turn cap
are enforced **in the handler**. Session-keyed limits are a convenience, not a control — anonymous
sessions are mintable on demand, so the **IP key is the real bound**, and the limiter is per-instance
(effective ceiling = limit × live instances).

**INV-13 — Planner transcripts are transient rider content.**
**Never log a request body. Never persist a transcript.** A `conversations` table is not an
optimization — it is a new class of personal data `purgeUserData` would have to chase across the
soft-ref boundary, and it needs an explicit founder call. Model errors, prompts and transcripts are
never echoed to the client.

**INV-14 — Never bulk-delete anonymous `user` rows.**
They are the identity the limiter keys on and the row the funnel runs through. A reaper (cron, admin
sweep, "clean up old users" migration) breaks conversations mid-flight and is a destructive change
needing an explicit founder OK. Tighten `/sign-in/anonymous` in `auth.ts` `customRules` — one mint per
device is normal, a hundred a minute is not.

---

## What is REMOVED

| Layer | Removed |
| --- | --- |
| Mobile | `app/roam.tsx`, `src/lib/useRoam.ts`, `src/ui/RoamMap.tsx`, `src/lib/roam-history.ts`, `src/ui/Duck.tsx`, `src/ui/DiagnosticsPicker.tsx`, `liveRoamSource()` in `gps.ts`, `getRoamManifest`/`coarsen()` in `api.ts`, the Settings "RIDE ALONG OFFLINE" block, `voice.roam.*` |
| Mobile | `app/create.tsx` (D6) and the full-screen endpoint picker (D7) |
| API | the `GET /roam` mount + handler; `GET /drives/anchors` as a **public** route — the resolver loads anchors server-side |
| Shared | `roamPin`, `roamManifest`, `areaRing` |
| Engine | `src/roam.ts` + test; `src/area.ts` + test; the `./area` import, `DriveStopRef.area`, `enterDwellSec` and the area branch in `trigger.ts` |
| Shared/API | `client-identity.ts` + test, `apps/api/src/client.ts` (`clientCan` has zero live callsites) |
| API | the `areaCapable` option, hull synthesis, and the roam-protecting radius cap in `clusters.ts` |
| DB | the `drive_demand` table + its upsert (D25) |

**Harvested, not deleted:** `roam-pack.ts`'s type-level credential strip (`PackPin = Omit<RoamPin,'url'>`)
moves into the region-pack work — strictly better than the drive side's null-a-field convention.

---

## Wire changes

Destructive is fine (D4). These must exist:

- `RegionAnchor` gains a stable **`id`**; propose/create carry **anchor ids**, not coordinates (INV-1).
- **`POST /drives/plan`** — one conversational turn. Model only.
- `POST /drives/propose` — unchanged apart from anchor ids; still the only Routes call.

## Access matrix

| Surface | anonymous | free |
| --- | --- | --- |
| `GET /sample` | ✅ | ✅ |
| `GET /regions` | ✅ | ✅ |
| `POST /drives/plan` | ✅ capped | ✅ |
| `POST /drives/propose` | ✅ rate-limited | ✅ |
| Preview clip presign (one, own route, release-filtered) | ✅ | ✅ |
| `POST /drives` (**spends a credit**) | ❌ | ✅ |
| `GET /drives`, `GET /:id`, `/assets/sign`, `DELETE` | ❌ | ✅ |

`requireAccount` moves off `driveRoutes.use('*', …)` onto individual routes. Get this wrong and either
the wall vanishes or the preview stays locked.

## The planner

**Model:** `claude-opus-5`, thinking **on**, effort `low`/`medium` (sweep before settling), **streaming**.
The model id comes from a named constant in `@skipper/shared`, never a bare string. **Low `maxRetries`
(0–1)** and an explicit request timeout inside the Cloud Run budget — do **not** copy
`packages/studio/src/models.ts`'s `maxRetries: 5`, which is deliberately tuned for a long batch run
that has already spent money. Prompt-cache the persona prompt.

**Output is TOOL USE, not prose parsing:** a typed route object (anchor ids, `via`, round-trip flag,
duration target) plus one free-text `say` field. **Only `say` is ever shown.** The planner is given no
place facts, no fact sheets, and no corpus access — its whole world is the region name and the anchor
list. That is what makes D9 structural rather than aspirational.

**Enforce what can be enforced:** a test asserting the planner prompt still contains the deflection
clause and the never-discuss-what-a-place-is clause, plus a review checklist item on any planner-prompt
diff.

**On outage:** the in-persona error state with the anchor list inline. `ANTHROPIC_API_KEY` becomes a
**runtime requirement of `apps/api`** (not just studio) — record it in `.env.example`; a key rotation
now takes drive creation down with it.

---

## Build order

One release, one submission, on `main`, atomic commits per step.

**0 — Snapshot** (D5). Corpus + R2, offsite. Nothing destructive starts until this exists.

**1 — Live defects.** Port the session re-check from `drives/[id]/play.tsx` into the create flow — a
successful signup currently strands **every** new rider. Disclose the credit before it is spent.

**2 — Remove roam.** The removal table, in one sweep. Reclaim home.

**3 — The planner.** Server: `/drives/plan`, the anchor-constrained resolver (INV-1), the persona +
deflection prompt in its named home (INV-10), `apps/api/src/limits.ts` (INV-12), request bounds (INV-3).
Client: the conversation on home, example asks, the inline preview card, the offline degraded state.

**4 — Anonymous split.** `requireAccount` per-route; anonymous mint at app open (D16) + the client
signed-in helper (INV-9); preview-clip presign from the **build** path (INV-5); the wall as a **sheet
over** the preview card — never a screen replacement, which is the root cause of defect 1.

**5 — Offline store.** Re-key the store by narration **subject id** (from `drives/<driveId>/<seq>.m4a`),
**re-keying existing bytes — never delete-and-refetch**. Fill it from the `DriveManifest` the app
already holds (INV-6). Harvest `roam-pack.ts`'s type-level credential strip on the way through. No pack
endpoint (D21).

**6 — Corpus.** Re-anchor the 5 districts as points (D22, free). Merge the Carson City duplicates (D23).

**7 — Simplification sweep** (repo-wide, admin + studio, **except `curate-places`** — INV-2). Dead CLIs
(D26). Runtime form collapse + loud guard (INV-7). `drive_demand` dropped (D25). `detours` tests (D27).
**Music stays** (D28). ⚠ By explicit path, atomic commits — **no codemods, no repo-wide auto-fixers.**

**8 — Instrumentation + tests.** Events: `conversation_started`, `route_drawn`, `preview_clip_played`,
`wall_shown`, `account_created`, `drive_created`, `drive_playback_started`, `clip_playback_completed`.
Tests cover the access and cost boundaries (D32): the anonymous split, request bounds, credit
consumption.

**9 — Docs + store, same commit as the code.** Rewrite CLAUDE.md. Mark the roam decision records
SUPERSEDED. Flip `offline-region-packs.md` (its D1 is void). Update `ReferenceView.tsx` if a run kind
changes. Rewrite the App Store listing — the "Ride Along" copy and the review notes are built entirely
around explaining that the primary button dead-ends outside Tahoe.

---

## Acceptance

- A rider 200 miles from Tahoe opens the app, plans a drive by talking, sees the route, and **hears a
  clip from it** — no account, **no location prompt**.
- **No location permission until "Let's roll."** The whole pre-drive flow is location-free.
- Signing up from the wall lands the rider on **their own proposal**, never an empty form.
- The credit is named before it is spent.
- `POST /drives/propose` **rejects** a non-anchor endpoint with a 400 **before** any Routes call.
- An anonymous preview clip is never a staged narration.
- Offline at a trailhead: conversation unavailable in persona, saved drives play.
- `bun run check` green at root and in `apps/mobile`.

## Risks accepted

⚠ **RISK-1 — The only road-tested mode is the one being removed.** Every field artifact — all 8
TestFlight items, the trigger-radius fixes, the iOS heading sentinel — came from driving *roam*. No
created drive has ever been driven end-to-end; the verification runbook has no recorded execution.
**Drive one before submitting.**

⚠ **RISK-2 — A model outage blocks all drive creation.** Accepted when the pickers were deleted. The
anchor list inline, in persona, is the only degradation path.

⚠ **RISK-3 — Minting on launch creates a row the rider cannot delete in-app.** The 5.1.1(v) flow sits
behind `sensitiveSessionMiddleware`, and an anonymous user has no credential. Accepted knowingly;
mitigate by tightening `/sign-in/anonymous` (INV-14), and decide before submission whether this counts
as account creation.

⚠ **RISK-4 — No global spend ceiling.** The limiter is per-instance and Cloud Run autoscales, so the
real bound is limit × instances. Accepted for an unlaunched app; revisit before real traffic.

⚠ **RISK-5 — A live persona has no grounding gate.** The routes-only boundary is structural via
tool-use output, but the prose deflection is prompt-held. Hold it in review.
