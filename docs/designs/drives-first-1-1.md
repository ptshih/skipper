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
| D5 | **Snapshot first — DONE 2026-07-31.** ⚠ WIDENED past the five tables first listed: D4 authorizes destroying everything, so it captures the **whole `public` schema + the Better Auth pool** (17 tables / 6,856 rows — incl. `credit_entries`, append-only with no second copy, `poi_overrides`' hand-authored corrections, and `eval_runs`/`eval_scores`) **plus the whole R2 bucket** (785 objects / 500 MB; 458 referenced clips, 0 missing). CLI: `snapshot-corpus` — read-only, free, resumable, and coupled to zero files anyone may be editing (tables come from `information_schema` via `sql.raw`). **Local-only is ACCEPTED** (founder) — no offsite copy. ⚠ Two consequences: it shares a failure domain with the working tree, and it lives under `.scratch/`, which is **gitignored** — so `git clean -xdf` deletes it. CLAUDE.md already bans `clean`; that ban is now load-bearing. |
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
| D22 | ⚠ **WITHDRAWN 2026-07-31 — there is nothing to re-anchor.** `poi_clusters` has no coordinate column (`schema.ts:424`: "a cluster's extent is its members' coordinates"), so "re-anchor the districts as points" has no mechanism. Its scope was also wrong: 3 of the 5 districts are ALREADY under the cap (Virginia City 265 m, Historic Downtown Carson City 411 m, Historic Carson City 552 m), and the over-cap set includes **UNR, which is a `cluster`, not a district**. Replaced by the area deletion (D42). |
| D23 | ⚠ **WITHDRAWN 2026-07-31 — the merge CREATES the problem D40 wanted removed.** Measured over exactly the two named districts (33 anchors): merged `clusterTrigger` radius is **741 m**, over the 600 m cap — so the merge would manufacture a NEW area-shaped group at the moment the plan wants none left. Once D42 lands, the merge is harmless (741 m just becomes a capped point) and optional; it is no longer part of 1.1. |
| D42 | **The AREA MODE is deleted; the REFUSAL and the DISTRICT vocabulary are KEPT** (founder 2026-07-31, amended same day after an outside review). They were never one concept — measured, "district" and "needs an area trigger" cross in both directions (2 district+area, 3 district+point, **1 cluster+area — UNR at 903 m**, 61 cluster+point). The classifier's DISTRICT clause is a **naming-capacity** instruction ("name the 2–3 most recognisable, background the rest"), is **mode-neutral**, and is the only thing in the repo that turns 46 competing Reno POIs into one good clip. The AREA TRIGGER answered "a roamer can arrive from any direction", which a drive never can. `treatment` stays as-is (one runtime reader: an admin badge). |
| D42a | ⚠ **DELETING `area` DOES NOT LEAVE `drive-select.ts:169` WITH "NOTHING TO GUARD" — IT FLIPS IT FROM REFUSE TO ADMIT.** `if (cand.area) continue` is the ONLY thing keeping the three over-cap groups out of drives. Once `cand.area` is permanently undefined they become ordinary candidates firing from the **un-snapped, off-road enclosing-circle centre** at a capped radius — the exact two failure modes `drive-select.ts:151-168` documents (fires on the freeway approach, or never fires), **frozen into `drives.selection` against a credit that never refunds.** The right reading of D42 is that a drive can't arrive from an arbitrary direction, which argues for deleting the MODE — never for admitting a 914 m group as a 600 m point. **Keep the refusal, re-keyed off GEOMETRY.** ⚠ And it must be an explicit boolean carried from `clusters.ts`, **not** a recomputation: that file serves `triggerRadiusM: min(trigger.radiusM, CLUSTER_MAX_TRIGGER_RADIUS_M)`, so the cap **destroys the evidence** before the candidate is built and `exceedsPointTrigger(cand.triggerRadiusM)` would read 600 and answer `false` for all three. Compute it where the uncapped radius still exists. |
| D24 | Runtime form handling collapses to `story` **only in `apps/api` + `apps/mobile`**, plus a loud guard (INV-7). The studio's scenic-downgrade path **stays**. |
| D25 | `drive_demand` — **drop the table, the upsert, the schema block, and the M4 reference.** PostHog is the demand instrument. (Resolves the earlier contradiction: there is no "fix `distinct_users`" work.) |
| D26 | Dead studio CLIs deleted: `regen-report.ts`, `rename-roam-prefix.ts`, `test-mastering-chain.ts`, and `golden.ts`'s unrun `TTS_CASES`/`DIVERSITY_CASES`. |
| D27 | `detours` structural tests removed (zero writers). The table stays until an explicit drop call. |
| D28 | **Drive music is OUT of scope** — it stays as-is. |
| D29 | Credits stay **exactly as built**. The wall is ownership *and* money; disclose the cost before spending it. |
| D30 | Ask-the-Skipper stays **deferred**. The planner gets no retrieval. |
| D31 | The full analytics event set ships with 1.1. |
| D32 | Tests cover the **access and cost boundaries** first. |
| D33 | Planner model: **`claude-opus-5`, thinking ON, effort `low`/`medium`, streaming.** ⚠ INV-8. The model id is a **NEW key** in `packages/shared/src/models.ts` — ⚠ **never bump `opus` in place**: that silently repoints `NARRATION_MODEL`, `JUDGMENT_MODEL`, `ENRICH_MODELS.opus` and two admin job models — a paid-run behaviour change disguised as a constant edit. Add the `$5/$25` pricing row AND extend the drift guard (it iterates only two models today, so an unpriced planner tallies **$0 forever** with nothing failing). |
| D33a | **Streaming is built in 1.1 via the `expo/fetch` seam** (installed with expo ~57; RN's global fetch is XHR-backed and cannot expose `response.body`). ⚠ Because output is tool-use, streaming the rider-visible `say` means accumulating `input_json_delta` partials — budget it as a real build on both sides, not a flag. |
| D34 | Abuse control is **session id + IP limiting**. The per-instance tail risk under autoscale is accepted; no global spend ceiling (RISK-4). |
| D35 | Preview audio takes **exclusive focus**, same as a drive. Only the drive and pre-drive skipper audio ever own the channel. |
| D36 | Simplification scope is **repo-wide, admin and studio included** — ⚠ except `curate-places` (INV-2). |
| D37 | Ships as **one 1.1**, one submission, App Store listing rewritten in the same pass. |
| D38 | Built on **`main`**, atomic commits per build step. No release branch. |
| D39 | `docs/ideas/` + `docs/specs/` merged into **`docs/designs/`** (done). |
| D40 | ⚠ **DISSOLVED 2026-07-31.** Its ordering constraint existed to make no cluster area-shaped before deleting `area.ts`. D42 deletes the area path end-to-end in ONE commit — including the MINT site (`clusters.ts`), so no `area` is ever constructed, `cand.area` is permanently undefined, and `drive-select.ts:169` deletes honestly with nothing red-typechecking. No corpus work is needed first, so there is no ordering constraint left to state. |
| D41 | **Spec step 1 is CUT as dead work.** It hardened `app/create.tsx`, which step 2 deletes one commit later, and D37+D3 mean no build ships in between. Its two durable halves survive: the INV-9 signed-in helper moves into the mobile leg, and the credit-disclosure copy lands on the preview card. |

---

## INVARIANTS — verified hazards. Do not violate.

Each was found by auditing code, not by reasoning. Breaking one is a silent production defect.

**INV-1 — The anchor allowlist is enforced at the WIRE, not in the prompt.**
Today `driveProposeRequest`/`createDriveRequest` accept a free `{name, lat, lng}` and pass it straight
into a **billed** Google Routes call, and `RegionAnchor` has **no `id` field at all**. Opening
`/propose` to anonymous without fixing this creates an unauthenticated endpoint that bills Routes for
any two points on Earth, and "grounded by construction" degrades to "the prompt asked nicely."
→ ✅ **`places.id` ALREADY EXISTS** (`packages/db/src/schema.ts:458`) — **no migration needed**; only the
Zod `RegionAnchor` lacks it. Add it there, project it from `loadRegionAnchors`, and carry **anchor ids,
never coordinates**. The server loads each row and re-asserts `endpoint_eligible`; an unknown or ineligible
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
→ ✅ Cheaper than it reads: `/propose` **already** calls `selectStopsForRoute`, so the correct
release-filtered clip is already in a local variable in the right handler.
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

**INV-15 — ⚠ THE SHARPEST ONE. The anonymous mint silently re-types three authorization guards.**
`c.get('session')?.user.id` today means "proof of an account". After D16 it means "any warm body" — and
three sites treat it as authorization: `drives.ts:449` (POST /, which then **spends a credit**), `:663`
(GET /, which then calls `ensureFreeGrant`), and the owner-scoped loaders. An anonymous rider merely
opening the home screen would write a `free:<anonUserId>` grant into `credit_entries` — against a user
id better-auth is about to **hard-delete with no cascade and no `purgeUserData`** — stranding a row
forever in an append-only ledger with no second copy. An INV-4 breach by OMISSION, not by writing code.
→ Mitigation is **DEPLOY ordering, not merge ordering**: the API's per-route `requireAccount` must be
**deployed** before the mobile mint ships. Keep the `!userId` checks as backstops but demote them in
their comments — they are no longer the wall. Gate the mint on `!isPending && !session` (ANY session)
behind a module-level once-guard: `/sign-in/anonymous` refuses only a caller who already holds an
anonymous session, and will otherwise sign a real rider **out of their own account and drives**.

**INV-16 — `driveClip` cannot key the offline store yet.**
It has no `subjectId`/`subjectKind`, and `drives.ts:354` sets only `poiId` — a fused cluster clip
reaches the client with `poiId: null` **by design**. Server-side subject identity exists but is never
projected to the wire. Step "offline store" cannot start until it is.

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

⚠ **The removal table is INCOMPLETE — pre-flight found these, and two are architectural:**
- `packages/engine/src/area.ts` — load-bearing for `drive-select.ts:169`'s frozen-drive guard until D40
  lands. Do step 2 first and it dies honestly. `drives.ts` and `entitlements.ts` also need listing.
- `packages/shared/src/client-identity.ts` — its `APP_VERSION` feeds `VersionGate`, the shipped
  force-upgrade hatch. **Re-home `APP_VERSION` in the same commit** or that gate breaks.
- Unlisted mobile fallout: `voice.settings.roamPack*` (~18 keys) + `voice.settings.diagnostics`,
  `app/developer.tsx`, `sim-mode.tsx`, `sample.tsx`'s `router.replace('/roam')`, the home modes block.
- ⚠ Engine tests live in `test/`, **not** `src/` — and there is a third: `test/area-trigger.test.ts`.
- ⚠ Do **NOT** delete `notSupersededByServedCluster` — `drives.ts:313` still calls it, and its comment
  records a measured 46-pins-to-4 production failure.

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

⚠ **Re-ordered after a pre-flight pass against the code** — the original sequence did not survive
contact. One atomic commit per step unless noted. On `main`, explicit paths only, no codemods.

**0 — SNAPSHOT.** ✅ DONE locally 2026-07-31 (D5). **Still owed: the offsite copy.** No `db:push` /
`db:migrate` / destructive data work until it exists — dev and prod share one Neon host.

**1 — `apps/api/src/limits.ts` + the bounded body read** (INV-3, INV-12). ✅ **DONE 2026-07-31.**
`readBoundedText` measures the ACTUAL stream and never reads `Content-Length`; `readJsonBody` takes a
required, undefaulted `maxBytes` and 413s before `JSON.parse`. 15 tests, and the two load-bearing ones
were mutation-checked against a Content-Length-trusting and a `String.length`-based implementation —
both wrong versions return `ok: true` where the tests assert `false`.
⚠ **`hono/body-limit` was evaluated and REJECTED**, so nobody re-litigates it: its fast path is
`contentLength > maxSize ? onError : next()` with the stream never measured — literally what INV-3
forbids — and its default `onError` throws an `HTTPException` that `index.ts`'s handler converts into a
`500 {"error":"internal"}`.
⚠ **The planner caps ship with no consumer** (`MAX_PLAN_*`, `PLANNER_MAX_TOKENS`, `PLAN_RATE_*`) so
step 6 inherits an argued number instead of inventing one under deadline. `PLAN_RATE_HOUR` is the
highest-leverage: 20/min alone permits ~28,800 req/day per IP per instance. Enforce it by mounting
**both** limiters — verified that a second `rateLimit()` is an independent bucket map, so it is one
extra line, not a limiter rewrite.
⚠ `SERVER_MAX_BODY_BYTES` is wired into the Bun default export — verified by probe that Bun honours
`maxRequestBodySize` in the `export default { … }` object form, not only via `Bun.serve({ … })`. It is
process-wide, so it also bounds the otherwise-unbounded `/api/auth/*` mount.
⚠ Left for their owners: `index.ts:157`/`:313` (roam, deleted/re-pathed by step 3) keep their inline
values rather than buy a merge conflict; and `loadRegionAnchors` has **no `LIMIT` and no `ORDER BY`** —
that set becomes the planner's allowlist and rides in the cached prompt prefix on every turn, so an
unstable row order is a silent prompt-cache invalidator. **Fix in step 6.**

**2 — DELETE THE AREA PATH (D42). Rewritten 2026-07-31; the old corpus step is withdrawn.** One atomic
deletion, **no corpus work, no `excluded_reason` retirements, no regeneration, no spend**, and it is
NOT gated on step 0 (nothing destructive touches data).

⚠ **A LATENT SILENCE BUG lives here — record it, do NOT try to fix it in this step.** `drives.ts` loads
fused tellings with `areaCapable: true`, whose cluster ids feed `notSupersededByServedCluster` and
suppress every member of every loaded cluster — and then `drive-select.ts:169` refuses the area ones. So
for the three over-cap groups the fused clip is loaded, its members are silenced, and the clip itself is
dropped: **Downtown Reno 46 released member clips + 1 fused → 0 audible; Reno's Historic Homes 15 + 1 →
0; UNR Campus 6 + 1 → 0.**

⚠ **CORRECTION (2026-07-31): an earlier draft of this step claimed deleting the area path "fixes it for
free". That was WRONG** — see D42a. It converts silence into a *frozen, possibly mis-placed* trigger,
which is worse: silence costs a rider nothing, a mis-fire is baked into `drives.selection` against a
non-refundable credit. The three groups have only unattractive answers today: (a) refuse + suppress =
silence, (b) refuse + un-suppress = 46 individual candidates where pick-one ranks by clip length and
elects *3rd Street Flats* over the Reno Arch, (c) admit as a capped point = the frozen mis-fire. The
honest fix needs a **route-aware trigger point** (the route is the rails: snap to where the polyline
comes closest to the members — no hull required), which is new machinery and not this step.

✅ **It is safe to defer, and measured so:** all **26** `endpoint_eligible` places are Tahoe-basin
(lat 38.93–39.25, lng −120.16 to −119.93) and the three groups sit **33.0 / 32.7 / 34.7 km** from the
nearest one — **no A→B drive between curated endpoints can reach them.** ⚠ That immunity ends the day a
paid `curate-places` run adds a Reno endpoint, which is exactly why the REFUSAL must survive this step.

✅ **DONE 2026-07-31 — and the SCOPE CHANGED once the code was read.** `area.ts` cannot be deleted yet:
`roam.ts` imports six symbols from it (`areaDwellSatisfied`, `ringAreaM2`, `trackAreaEntry`,
`signedDistanceM`, `AreaRef`, …), so the module dies **with roam, in step 3**. That turns out to be the
better order anyway, because the load-bearing half is severing the DRIVE path from `area` — after which
deleting the module cannot flip anything, since no refusal keys on it any more.

What shipped: `DriveCandidate.area` → **`tooWideForPoint: boolean`**, `drive-select.ts`'s second
admission rule re-keyed to it (comment rewritten to say the refusal is geometric), `ClusterTelling`
gains the flag computed in `clusters.ts` **where the uncapped radius still exists**, `drives.ts`'s
`NarrationRow.area` → the flag at both mapper sites, and `cluster.ts`'s threshold comment rewritten
(third revision: defer → select-a-mode → plain threshold).

✅ **Verified by BEHAVIOUR against the live loader + real `buildDrive`, not by typecheck** — the field is
optional at every hop, so a dropped thread compiles clean and silently re-admits. Exactly **3** tellings
carry the flag (Downtown Reno, Reno's Historic Homes, UNR), all served at `triggerRadiusM = 600` (the cap
that destroys the evidence). On a route running straight over each centre — precisely the case the point
rule admits — **with the flag: 0 stops, 3/3 refused. Without it: 1 stop, 3/3 admitted.**

Still owed at step 3, with roam: `area.ts` + its two tests + the `index.ts` re-export; the area branch in
`trigger.ts` and in `roam.ts`; the hull mint + `areaCapable` in `clusters.ts`; `areaRing` + `roamPin.area`
in `packages/shared`; the `<Polygon>` + `area` threading and its theme roles in mobile; and the
`CLIENT_CAPS`/`clientCan` channel, whose ONLY token is `area` and which has no production caller.
⚠ That last one is entangled with re-homing `APP_VERSION` out of `clientIdentity.ts` (it feeds the
shipped `VersionGate`), which is why it belongs to step 3 rather than here.

⚠ **KEEP, do not delete: the REFUSAL** (D42a) — re-keyed from `cand.area` to an explicit geometry
boolean set in `clusters.ts` where the uncapped radius still exists, carried on `ClusterTelling` →
`DriveCandidate`. `drive-select.ts:169` becomes `if (cand.tooWideForPoint) continue`, keeping its
`:151-168` comment (rewritten to say the refusal is now geometric, not mode-based). Its two regression
tests survive with the field renamed.

⚠ **KEEP, with the comment rewritten:** `CLUSTER_MAX_TRIGGER_RADIUS_M` + `exceedsPointTrigger`. They
live in `cluster.ts`, NOT `area.ts`, so they survive the deletion untouched — with areas gone they stop
selecting a MODE and become the refusal threshold. `cluster.ts`'s comment ("the area trigger exists now,
so it SELECTS THE MODE") becomes false and must be rewritten in the same commit.

⚠ **KEEP `treatment` and the classifier's DISTRICT clause untouched** (D42).

**3 — Remove roam** — ⚠ **BLOCKED ON A FOUNDER DECISION, not on code.** Probed read-only 2026-07-31:
**1.0.0 is `WAITING_FOR_REVIEW`** (release type MANUAL, created 2026-06-10). Step 3 deletes
`GET /roam/sample` — **the exact endpoint `docs/guides/app-store-submission.md` §12 tells the reviewer
to check** — and `skipper-api-deploy` ships **push-to-main at 100% traffic with no canary**. So the
sequence that breaks a live review is: land step 3 → push → a reviewer picks 1.0.0 up → the endpoint
their own instructions name is gone. The no-push rule holds this shut for now, but the decision must be
MADE (withdraw 1.0.0? wait for review? keep `/sample` alive under its new path first?) before step 3
lands, not discovered at push time. — then, in layered commits. ⚠ The removal table is INCOMPLETE — see its footnotes; two
omissions are architectural, not mechanical. Regenerate router types (`bunx expo customize tsconfig.json`)
or mobile typecheck fails. Carry `PackPin` forward in the same commit that deletes it, or step 9's
harvest source is gone. **Move `drive_demand` OUT of this step** into the sweep — it is destructive DDL,
not roam.

**4 — THE WIRE COMMIT** (batched — `packages/shared/src/schemas.ts` is visited **once**, additively,
instead of four times on a shared tree). One atomic change spanning shared + its API producers + its
mobile consumers: `regionAnchor` gains `id` (from the already-existing `places.id` — no migration);
propose/create carry **anchor ids**, server re-asserts `endpoint_eligible` and 400s **before** any Routes
call (INV-1); `driveClip` gains `subjectId` + `subjectKind` (INV-16); `driveProposal` gains the preview
clip **including `attribution`** (CC BY-SA is legal, not optional). Unblocks steps 8, 9 and 11.

⚠ **`via` MUST go through the allowlist too — INV-1 currently stops at start/end.** Verified: `via` is
`z.array(resolvedEndpoint).max(8)` (`schemas.ts:206`) and flows straight into `routeWaypoints` →
`materializeRoute` at `drives.ts:427` (propose) and `:539` (create), never touching `places`. Hydrate it
through the **same by-id + `endpoint_eligible` re-assert** as the endpoints. Without this, step 4 can
satisfy the acceptance line exactly and still ship an **unauthenticated endpoint that bills Google
Routes for 8 arbitrary points on Earth** — "grounded by construction" degrades to "grounded at both
ends". ⚠ The acceptance line below says "a non-anchor ENDPOINT", which is why this gap was invisible;
it is corrected there in the same breath.

**5 — INV-11 pricing move**, own commit, announced first: `MODEL_PRICING` + `recordModelUsage` move to
`@skipper/shared` (TTS pricing stays in studio). Add the planner model's row and extend the drift guard.

**6 — Planner (server).** Prompt in `apps/api/src/planner-prompt.ts` — ⚠ **not** in `@skipper/shared`,
which mobile imports and would ship the system prompt into the app bundle. `@anthropic-ai/sdk` is already
declared in `apps/api`. Tool-use output, thinking ON (INV-8), effort low, hard `max_tokens`, lazy client
with `maxRetries` 0–1 and an explicit timeout. ⚠ Register `/drives/plan` **ABOVE the
`app.route('/drives', driveRoutes)` mount**, not merely "outside" it — hono matches in registration
order, so below the mount it is swallowed by `driveRoutes`' blanket `requireAccount` and every anonymous
plan 401s. **Pin it with a test asserting 200 WITHOUT a session**, since the failure is a plain 401 that
reads like an auth bug rather than a routing one. Include the deflection-clause test.

**7 — Planner (client)** + the `expo/fetch` streaming seam (D33a). Conversation on home, example asks,
inline preview card, in-persona offline state. Requires `bun run check` inside `apps/mobile`.

**8 — Anonymous split — THREE commits with a MANDATORY DEPLOY GATE** (INV-15). Pre-work: a request-level
test harness for `apps/api` (importing `drives.ts` pulls `auth.ts`, which throws at module load without
`BETTER_AUTH_SECRET`). **(8a)** API: `requireAccount` off the mount onto the five owner routes, keep
`withSession` on the mount, preview presign from `loadCorpusForRoute`. **DEPLOY THIS.** **(8b)** mobile:
register `anonymousClient`; flip the seven bare-`session` call sites (INV-9). **(8c)** mint at app open
behind the once-guard, the wall as a sheet over the preview, and INV-14's `/sign-in/anonymous` rule.

**9 — Offline subject-keyed store.** Unblocked by step 4. Add a v4→v5 entry to the existing (empty,
unit-tested) `MANIFEST_MIGRATIONS` ladder. **Re-key bytes with `File.moveSync`, never delete-and-refetch.**
A saved v4 manifest still carries `clips[].poiId`, so the poi half migrates with **zero network**.

**10 — Simplification sweep** (D36, plus `drive_demand` from step 3). ⚠ Announce and claim paths first —
this collides with any concurrent workspace-cleanup agents far harder than docs work did. `curate-places`
untouched (INV-2). `routeSigOf` survives the table drop.

**11 — Instrumentation + remaining boundary tests** (D31/D32).

**12 — Docs + store.** CLAUDE.md is already rewritten (`0c268cf`). Still owed: `.env.example` still scopes
`ANTHROPIC_API_KEY` to narration; the roam decision records need SUPERSEDED lines; the App Store listing is
built entirely around "Ride Along" copy that no longer exists. **Then RISK-1: drive one for real.**

## Acceptance

- A rider 200 miles from Tahoe opens the app, plans a drive by talking, sees the route, and **hears a
  clip from it** — no account, **no location prompt**.
- **No location permission until "Let's roll."** The whole pre-drive flow is location-free.
- Signing up from the wall lands the rider on **their own proposal**, never an empty form.
- The credit is named before it is spent.
- `POST /drives/propose` **rejects** a non-anchor **start, end, OR `via` midpoint** with a 400 **before**
  any Routes call. ⚠ The `via` half is stated explicitly because it was missing: the earlier wording
  ("a non-anchor endpoint") is satisfiable while `via` still carries 8 arbitrary billable coordinates.
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
