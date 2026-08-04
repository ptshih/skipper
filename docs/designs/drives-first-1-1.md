# 1.1 — Drives first: remove roam, plan a drive by talking

> **Status:** ✅ **BUILT AND SHIPPED TO PROD — steps 0–12's in-repo half is DONE and the push EXECUTED
> 2026-08-02** (`9dc3987..ecc30f7`, four builds green; the record and the template for the next push is
> [../guides/1-1-cutover-runbook.md](../guides/1-1-cutover-runbook.md)). ⚠ **Deployed is not RELEASED**
> — what remains is all outside the API: the native rebuild + TestFlight, **RISK-1 (drive one for real)**,
> the on-device sweep ([../guides/device-verification-runbook.md](../guides/device-verification-runbook.md)),
> and the App Store Connect metadata + screenshots that step 12 could not close from the repo. Greenlit
> **2026-07-31** (founder). Supersedes the roam-first PRODUCT
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
→ ⚠ **THE MITIGATION THIS INVARIANT ORIGINALLY NAMED — "deploy 8a before the mobile mint" — WAS THE
WRONG CONTROL, and was replaced in step 8** (review §1.3/§3.3, confirmed against the code by three
independent design passes). Today *and after a correct 8a*, `GET /drives` sits behind a gate and the
mint is harmless regardless of deploy order. **The hazard is INTRA-8a**: it opens only if 8a drops the
gate from a route that WRITES. Deploy ordering cannot detect a missing gate; a test can.
→ **THE CONTROL IS `apps/api/test/drive-access.test.ts`.** It asserts the five owner routes 401 for an
anonymous session, that an anonymous `GET /drives` never reaches `ensureFreeGrant` (the hazard is a
WRITE — a 401 issued *after* the ledger row was written is still a 401), and — the highest-value part —
a **route-table completeness guard** that pins the gated set and fails when any NEW route is added
without a gate. Deploying 8a before the mint remains the correct operational sequence; it is simply no
longer what makes this safe.
→ ⚠ **`!userId` STOPPED BEING A BACKSTOP THE DAY THE MINT SHIPPED, and re-commenting it was not
enough.** It worked only because an anonymous caller had no session; afterwards every rider carries one
and an anonymous user HAS an id, so an id-presence check is `false` forever and guards nothing. Every
such site is now keyed on `c.get('tier') === 'free'` — the same predicate the gate uses, so the wall and
the backstop cannot disagree.
→ Gate the mint on `!isPending && !session` (ANY session) behind a module-level once-guard:
`/sign-in/anonymous` refuses only a caller who already holds an anonymous session, and will otherwise
sign a real rider **out of their own account and drives**. ⚠ The once-guard must also be **consumed by
observing a session it did not mint** — otherwise a process that launched signed-in still holds it
unspent, and the moment that rider signs out *or deletes their account* the app mints them a fresh
undeletable row (found by the step-8 adversary, fixed there).

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

**0 — SNAPSHOT.** ✅ **DONE 2026-07-31 (D5), and local-only is ACCEPTED** — there is no offsite copy and
none is owed. ⚠ This line read "Still owed: the offsite copy. No `db:push` / `db:migrate` / destructive
data work until it exists" until 2026-08-02, which contradicted D5 in the same document and gated work
D5 had authorized. D5 is the current record (founder, 2026-08-02).
⚠ What the snapshot does NOT make safe, and what still governs destructive work: dev and prod are ONE
Neon host, so there is no staging to rehearse on, and the snapshot lives under a gitignored `.scratch/`
sharing a failure domain with the working tree — which is why CLAUDE.md's ban on `git clean` is
load-bearing. `scripts/db-preflight.ts` refuses a table-dropping `db:generate`/`db:push` on THAT basis,
not on the backup's location.

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

**3 — Remove roam.** ✅ **DONE 2026-08-01, in three layered commits** (mobile → api/wire → engine),
each with root + `apps/mobile` `bun run check` green. ~5,200 lines deleted; **zero live roam code
remains** — what is left repo-wide is prose vocabulary ("roam narration" for the shared corpus), which
belongs to the step-10 sweep, not here.

⚠ **STILL BLOCKED ON A FOUNDER DECISION BEFORE IT CAN BE *PUSHED*.** Probed read-only 2026-07-31:
**1.0.0 is `WAITING_FOR_REVIEW`** (MANUAL release, created 2026-06-10). This step deletes
`GET /roam/sample` — **the exact endpoint `docs/guides/app-store-submission.md` §12 tells the reviewer
to check** — and `skipper-api-deploy` ships push-to-main at 100% traffic with no canary. The no-push
rule holds it shut; the decision (withdraw 1.0.0? wait for review? something else?) must be MADE before
the first push, not discovered at push time. ⚠ This is also the commit after which `main` stops being
1.0-compatible — everything before it could still have been pushed safely.

Three things worth keeping from the execution:
- ⚠ **A stale `.expo/types/router.d.ts` is a SUPERSET**, so `tsc` stays green on a dangling
  `router.push('/roam')`. Type-checking does NOT catch a deleted route; the hrefs had to be found by
  hand, and the types regenerated afterwards to become a tripwire.
- ⚠ **Deleting a feature does not delete its bytes.** Roam's offline pack (up to ~138 MB) was
  reclaimable only by `deleteRoamPack()`, which went with roam — leaving it permanently unreachable on
  every device that ever tapped Save. New `reclaimLegacyRoamPack()` runs once at launch. Any future
  feature deletion owes the same check.
- ⚠ **Comments were the only surviving record of two field-found bugs** (the iOS `-1` heading sentinel;
  the drive stall watchdog's "sheet frozen at 0:00 on thin 5G"). Both cross-referenced roam code. They
  were rewritten to stand alone rather than deleted with it.

`create.tsx` **deliberately survives** despite the removal table: deleting it now leaves no
drive-creation path at all until step 7 lands the conversation — a broken app across four commits,
against RISK-1. The build notes' point was not to INVEST in it, which is different.

**4 — THE WIRE COMMIT.** ✅ **DONE 2026-08-01.** `packages/shared/src/schemas.ts` visited once, as
planned. `regionAnchor` gains `id` (from the already-existing `places.id` — no migration); propose and
create now carry **anchor ids only**, hydrated server-side by `hydrateAnchors` which re-asserts
`endpoint_eligible` **in the query** and 400s before any Routes call; `driveClip` gains `subjectId` +
`subjectKind` (INV-16); `driveProposal` echoes `startId`/`endId`/`via` (the ids create must re-send)
alongside `viaResolved` (the same midpoints with name+coords, for display).

⚠ **`via` GOES THROUGH THE ALLOWLIST TOO** — it was `z.array(resolvedEndpoint)` while start/end were
being hardened, which satisfies "reject a non-anchor ENDPOINT" exactly while still shipping 8 arbitrary
billable coordinates. Guarding both ends of a route and leaving the middle open is not a partial
guarantee, it is none. Pinned by a test.

Three things worth keeping:
- ⚠ **The eligibility re-assert is in the QUERY, not after it**, so a row that exists but has been
  de-curated is indistinguishable from one that never existed — otherwise the 400 becomes an oracle for
  the curated set. Verified it is not vacuous: 32 places, 26 eligible, **6 ineligible**, and both an
  ineligible id and a bogus one fail to resolve.
- ⚠ **`hydrateAnchors` preserves the CALLER's order**, not the database's. `inArray` returns rows in
  whatever order Postgres likes and these are route WAYPOINTS — reordering them silently produces a
  different, still-billable drive.
- ⚠ In create it runs **after** the idempotent-replay branch, deliberately: replay is the hot path for a
  lost-ACK retry and should not pay for a lookup it does not need.

⚠ **`driveClip.poiId` stays** (nullish, null for a fused telling) but is no longer the identity —
`subjectId`/`subjectKind` are. A store keyed on `poiId` cannot tell a fused clip from a broken one, and
one keyed on `seq` is keyed on a position in ONE drive.

**5 — INV-11 pricing move.** ✅ **DONE 2026-08-01.** `MODEL_PRICING` + the token tally moved from
`packages/studio/src/pipeline/spend.ts` to **`packages/shared/src/spend.ts`**; TTS pricing stayed in
studio. The 13 studio import sites now pull `recordModelUsage` etc. from `@skipper/shared`, and studio's
`spend.ts` deliberately does **not** re-export them — one import path, no second home to drift from.

`CLAUDE_MODELS.planner = 'claude-opus-5'` is a **NEW key**, priced at $5/$25 per MTok (verified against
the `claude-api` skill's catalog, not memory). ⚠ Never bump `opus` in place — that silently repoints
`NARRATION_MODEL`, `JUDGMENT_MODEL`, `ENRICH_MODELS.opus` and two admin job models at once.

⚠ **THE DRIFT GUARD WAS THE POINT, AND IT WAS VACUOUS.** It iterated a hand-written
`[NARRATION_MODEL, JUDGMENT_MODEL]` — two models maintained by memory — so a model added anywhere else
stayed unpriced, tallying **$0 forever with nothing failing**. It now iterates the RECORD
(`Object.values(CLAUDE_MODELS)`) in `@skipper/shared`, plus every studio tier constant including
`ENRICH_MODELS`, so adding a key cannot be forgotten. **Mutation-checked**: deleting the planner's
pricing row fails the guard; restoring it passes 8/8.

New `usageUsd(model, usage)` prices ONE call without touching the process tally — the shape the request
path needs, since a long-lived API process accumulating a global total would grow without bound and
mean nothing. Pinned against the tally so the two arithmetics cannot diverge.

**6 — Planner (server).** ✅ **DONE 2026-08-01.** Built by a parallel agent team on disjoint file
ownership (designers → builders → an adversary that re-read from disk), with the orchestrator holding
the contended files. `planner-prompt.ts` (persona + the `plan_route` tool), `planner.ts` (the call and
the six-outcome classifier), `plan-route.ts` (the handler), the wire DTOs, and 18 tests.

✅ **Mounting VERIFIED BY BEHAVIOUR, not by reading:** anonymous `POST /drives/plan` → **400** (reached
the handler), anonymous `GET /drives` → **401** (the wall still stands). Registered above the mount.

⚠ **`say` IS A TEXT BLOCK, not a tool field** — the open question from the review, settled by the design
pass. Text streams natively token-by-token; a `say` nested in tool JSON would mean accumulating
`input_json_delta` partials on both sides for no gain, and would leave a chatting rider (no route yet)
with nothing to stream at all. Only the ROUTE rides in the tool call.

⚠ **The classifier keys on `stop_reason` FIRST, never on "is there a tool block".** A truncated turn is
HTTP 200 with a half-parsed tool call — byte-identical, from the caller's side, to "the planner chose
not to route". One is a chat beat, the other is a paid call that produced nothing, and conflating them
is how a rider says yes and watches nothing happen. Pinned by test.

Four things the adversary caught, three fixed: spend was keyed on the **echoed** model rather than the
requested one (invisible to the step-5 drift guard, which validates requested ids); the transcript sat
**outside** the cached prefix and was re-billed in full every turn; and an `onSay` throw — an SSE write
to a rider who closed the app, the ordinary case — was classified as a vendor outage. The fourth is
recorded, not fixed: `PLANNER_MAX_TOKENS` caps thinking **plus** output and nothing has measured p99.
The instrumentation is emitted; read it before this opens to riders.

⚠ `checkTranscript` lives in `limits.ts`, not with the route — the route module reaches
`drives → entitlements → auth`, which throws at module load without `BETTER_AUTH_SECRET`, so a cap rule
defined there is unreachable from a test. Caps live with caps, and zero imports is what keeps them
testable.

**7 — Planner (client)** + the `expo/fetch` streaming seam (D33a). ✅ **DONE 2026-08-01, in three
commits** (transport → wire → client), each with root + `apps/mobile` `bun run check` green. Built by a
parallel agent team on disjoint file ownership, with the orchestrator holding the contended files
(`voice.ts`, `ui/index.ts`, `Icon.tsx`, `FilterChip.tsx`, `index.ts`) and two adversaries re-reading
from disk afterwards.

⚠ **THE SERVER HALF OF THE SEAM DID NOT EXIST.** `planner.ts` shipped an `onSay` delta hook in step 6
and **nothing consumed it** — `plan-route.ts` returned `c.json`. So step 7 owned both ends. `Accept:
text/event-stream` now streams; without the header the JSON response is byte-identical to step 6's
(diffed), and every pre-stream path — 413, both 400s, the cap wrap-up, the unknown region, 429 —
answers the same JSON on both Accepts.

⚠ **A LIVE DEFECT IN SHIPPED STEP-6 CODE WAS FOUND HERE, AND IT IS THE MOST IMPORTANT THING IN THIS
STEP.** Bun's default socket `idleTimeout` is **10 seconds and it fires while a handler is still
running**, so `POST /drives/plan` was capped at ~12s wall clock against a 45s model deadline: the
socket closed, the rider saw a failure, and **the Opus call kept generating and billing to completion**.
Undetected because nothing had exercised a slow turn, and `thinking.display: 'omitted'` puts zero bytes
on the wire during thinking — so it sat exactly on the boundary. Measured: 12s → 200, 16s → dead at
~12s, `idleTimeout: 60` → 200 at 25s. **No test can catch a regression** (an in-process `app.fetch`
never touches a socket), so `limits.ts` pins the RELATIONSHIP and `PLANNER_TIMEOUT_MS` moved there to
make that assert writable. ⚠ The assert stays green whether or not anything READS the constant — the
adversary caught it dead-coded once already.

⚠ **`mock.module` IS PROCESS-WIDE UNDER BUN, and the design pass got this wrong.** A probe said module
mocks do not leak between test files; the full suite says otherwise — `plan-stream.test.ts` replaced
`../src/planner` for `planner.test.ts` too, and `bun test` ran **96 pass / 9 fail** (the entire
six-outcome classifier) while every file was green in isolation. It failed *loudly* only by luck: the
leftover stub happened to be a promise that never resolves. Had it resolved, those tests would have
**passed while exercising a mock**. Every mock in that file now spreads the real module and delegates
when idle.

Also landed, and each was a decision rather than an inheritance:
- **`region.exampleAnchors`** (review §1.11) — names only, `.catch([])` so a cosmetic field can never
  brick home through mobile's ContractError wall. See the commit for the sort/collation reasoning.
  ⚠ **IT BRIEFLY STOPPED BEING COSMETIC ON 2026-08-03, AND THEN GOT ITS OWN FIELD.** For one commit
  an empty array was the client's whole test for "this region has no curated endpoints", and that
  test HIDES THE COMPOSER (founder — every turn in such a region is a billed Opus call the planner
  can only refuse). That conflated the two causes of `[]`: a genuinely uncurated region, and
  `.catch([])` swallowing a malformed payload. The second read as the first, so one sloppy `?? null`
  in the handler would have told a rider in a fully curated region that the skipper runs no roads
  there and left them nothing to type into — the exact brick the `.catch` was chosen to prevent,
  arriving by another door.
- **`region.ready`** — the fix for that, and now the ONLY thing the composer gate reads. A capability
  (`does this region hold ≥1 curated endpoint-eligible place`), computed server-side in the same
  containment pass that picks the anchors — one pass, because two readers of "is this point in this
  bbox" is the drift this file was already burned by. It is set from CONTAINMENT ALONE, above the
  display cap and the blank/duplicate name filtering, so a region whose only endpoint has an
  unpublishable name stays drivable. Biases are deliberately OPPOSITE and in both places: the server
  fails CLOSED (`?? false` — it looked and found nothing, which is a fact), the DTO fails OPEN
  (`.catch(true)` — an absent or malformed field means the client has no answer and must not invent a
  "no" that blanks the screen). That also makes the rollout safe in the direction it will actually
  happen: a client that knows the field against an API that does not yet send it degrades to the old
  always-on composer. ⚠ `ready` inherits `EXAMPLE_ANCHOR_SCAN_LIMIT` — a region whose only endpoints
  sit in the un-featured tail beyond that limit would be reported not-ready and lose its composer.
  Harmless at tens of curated rows; a second reason to revisit the constant as it fills.
  ⚠ The escape hatch out of a not-ready region is the region chip, gated on `hasRegions` and never on
  the selection. Remove that and this becomes a dead screen.
- **`GET /drives/anchors` deleted end to end.** Not deferred: step 8a moves `requireAccount` off the
  `/drives*` mount and `/anchors` is not one of the five owner routes, so it would have become an
  unauthenticated dump of the curated allowlist **with exact lat/lng** the day 8a deployed.
- **SINGLE-REGION is now a decision, not an accident** (review §1.11's open half). The server has always
  been single-region; `create.tsx`'s selector dying made that implicit. Auto-select at one region, a
  chip row above the hero beyond that.
- **Turn 1 costs zero dollars** (review §1.15c): an example chip seeds a hand-authored rider ask AND
  the skipper's reply with no model call.
- **`toWire` merges consecutive same-role turns.** Anthropic's own docs contradict each other on
  whether `messages` must alternate; merging is byte-equivalent under the permissive reading and legal
  under the strict one, so it is correct either way. Left unmerged and the strict reading true, the
  failure is the worst shape available: the server catches the vendor 400 and answers 200 with the
  in-persona outage line, so the rider watches the skipper apologise forever and **nothing is logged on
  either end**. The natural output of the wire filter — drop a display-only skipper turn from between
  two rider turns — produces exactly that violation.

⚠ **D33a's stated premise is STALE and the spec should not be trusted on it.** "RN's global fetch is
XHR-backed and cannot expose `response.body`" is no longer true: under expo 57 the global fetch **is**
`expo/fetch` unless `EXPO_PUBLIC_USE_RN_FETCH` is set. The import is still explicit, because a flag, a
devtools shim, or a change in expo's global-install order would otherwise swap in a buffering fetch
whose only symptom is every delta arriving at once at the end — a bug with no error and no stack.

⚠ **Deliberately NOT built here, with reasons:** the anonymous preview CLIP (it needs `/propose` open to
anonymous plus INV-5's release-filtered presign — that is 8a), and therefore review §1.12(b)'s pinned
mini-transport and §1.12(c)'s exclusive-audio-focus reversal, which only exist once a clip plays there.
`PreviewCard` carries the empty slot. ⚠ §1.12(c) remains a REVERSAL of two shipped surfaces whose
comments argue the opposite — flip it without rewriting both and the next agent flips it back.

⚠ **Owed, and not a defect:** every route the planner emits auto-fires `POST /drives/propose` with no
confirming tap. That satisfies D11 (the model only emits a route after the rider says yes in words), but
the guarantee is prompt-held, not structural — a model that emitted a route unprompted would bill Google
Routes. Worth a founder eye before real traffic, alongside RISK-4.

⚠ **THAT PREDICTION CAME TRUE, and half of it is now structural (2026-08-03).** Observed on device: the
planner answered *"What's your name?"* with *"…drawn up just as you said"* and re-emitted the route it
had already given, so one transcript held three cards for two distinct drives. Each redraw is another
billed Routes call for a drive already on screen — and two indistinguishable cards for one drive are two
chances to spend a non-refundable credit on it. `drawUp` dedupes on `proposeKey` (mobile
`src/lib/planner-route.ts`) — the stringified `/propose` body, so the test is literally "would this bill
a call we have already made?" and cannot drift from the request. The claim is released if the propose
FAILS (a call that bought nothing owes nothing) and cleared when the conversation resets;
`needsAccount` keeps its claim, the card being alive.

⚠ **A DUPLICATE NOW MOVES THE CARD; IT DOES NOT REFUSE SILENTLY (2026-08-03, founder-reported).** The
first cut answered a duplicate with `bumpScroll()` and a comment claiming the rider was "still taken to
the drive". They were not: `bumpScroll` scrolls to the END of the transcript while the card it means
sits where it was first drawn, often several exchanges up — and `undrawnRoute` finds that same card and
so suppresses the "Draw it up" bar too, leaving no recovery path. The founder hit it as the chat
*"refusing to redraw the route after changing it up and chatting more"*. It bit three ways: returning to
an earlier plan, a duration-only change (`proposeKey` drops `targetMinutes` by design, so "make it
shorter" collides), and any bare repeat. `reflowDrawnCard` now moves the existing card to the END of the
array AND re-slots its `afterTurn` — **both halves are required**, since `afterTurn` picks the transcript
slot while array position decides `newestCardId`, which gates the live map. Every property the dedupe
exists for survives: one billed Routes call, one card per distinct drive, one idempotency key.
⚠ Still prompt-held: a model emitting a NOVEL route unprompted. The dedupe bounds repeats, not
invention.

⚠ **The prompt half landed separately, and it needed TWO fixes rather than one.** Root cause: the model
cannot see that it ever called the tool — `toWire` carries role + text only, the route is client state
and is dropped, so its whole evidence of having drawn is its own sentence. Everything in the prompt
described the run-up to a draw and nothing described after it, so an unrelated turn fell back into
drawing. `== Once it is drawn ==` supplies the after-state, and the example exchange gained a fourth
beat (chit-chat right after "Consider it drawn") because an example that stops at the draw teaches the
drive as the end of the conversation. Measured against the live model afterwards: substantive
post-draw turns stopped re-emitting outright, and bare acknowledgements ("cool", "nice", "thanks")
went from re-emitting reliably to 5-of-6 clean once the prompt named them.
⚠ The second fix is the one the first UNCOVERED. A tool call carries no *guaranteed* text block, and on
those low-content turns the model returned `{ say: '', route }` — which was survivable only while a
duplicate CARD still appeared beside the empty bubble. With the client refusing to redraw, an empty
`say` made the whole turn render as NOTHING: the rider types and the screen does not move. `toResponse`
now backstops an empty `say` on the route branch too (a distinct line from `retry` — the drive is fine
and about to appear) and counts it as `route_wordless`, a degradation whose spike means the prompt
slipped rather than an outage. ⚠ A residual re-emit still gets through on words the prompt does not
name; it is contained by BOTH structural guards (no second billed call, and always a line), which is
the intended division of labour — the prompt reduces it, the code contains it.

⚠ **THE THIRD PROMPT FIX, AND IT IS THE ONE THAT OWNED THE FOUNDER'S BUG (2026-08-03).** A ten-lens
review found the redraw dead end was never really a client defect: `== Once it is drawn ==` named **"a
different length"** among the axes that earn a second `plan_route` call, while `toProposeRequest`
DROPS `targetMinutes` — so two routes differing only in the duration the rider asked for key
identically. And because the prompt forbids the model any distances at all, re-emitting the same two
ends with a smaller `target_minutes` was the ONLY compliant emission it had for *"shorter"*. **D9
compliance was what manufactured the dead end.** The reflow above fixed the SILENCE; it could not fix
the falsehood — the rider asked for shorter, the skipper said he redrew it, and an identical card slid
down. A confident claim over an unchanged drive is a worse honesty failure than a frozen screen.
The prompt now teaches the arithmetic instead: *"a shorter drive means a nearer far end… Until they
pick which end moves, there is nothing new to draw"*, and hands back the choice. The tool description
single-sources drive identity against `proposeKey` (`start` + `end` + `via`, **`target_minutes`
included**) and its unscopeable *"never call this a second time"* absolute is gone — that clause also
closed the client's own propose-failure retry path.

⚠ **`say` IS NOW A REQUIRED FIELD ON `plan_route`, REVERSING A LONG-STANDING DECISION — and it was
reversed by MEASUREMENT (2026-08-03).** The new planner eval panel (`apps/api/eval`) replayed 11
scripted conversations on its first run and failed two gates. The cause was not a wording problem:
on **every** `tool_use` turn the model emitted 160 output tokens — the tool JSON alone, with **no text
block at all** — while every `end_turn` turn spoke normally in 34-42. A direct probe reproduced it
against the **pre-rewrite** prompt too, so it is a model behaviour that no prose fixes. `route_wordless`
was therefore never the occasional low-content-turn defect this doc described: **every rider heard the
one fixed server fallback (`VOICE.drawnWordless`) instead of the Skipper saying their drive back** —
and it destroyed the model's only record of what it drew, which is upstream of the re-emit defect.

The old argument against the field rested on a premise that is simply false: that putting `say` in the
input "forces `tool_choice: 'any'` on EVERY turn". It does not. With `tool_choice` left on **auto**, the
probe showed a chat turn still returning `end_turn` with a text block, the draw turn carrying its own
line inside the call, and a bare *"sweet"* after a draw returning `end_turn` with text and **no call at
all** — where the same turn without the field had produced a silent re-draw. The one real cost the old
argument named survives and is worth naming honestly: `say` no longer streams as native `text_delta` on
a draw turn. ⚠ **That costs nothing today** — there was no text on those turns to stream. Chat turns,
where streaming actually works, are untouched. The effort hypothesis was tested and **refuted**: the
same failure reproduces at `effort: 'medium'`, so the production value stays where it is.

⚠ **INV-8's FAILURE MODE WAS OBSERVED FOR THE FIRST TIME (2026-08-03), and it is no longer theoretical.**
On a replay turn that should have drawn, the model serialized the tool call into the rider-visible line —
`say` came back as `<invoke name="plan_route"><parameter name="say">…` — and no route was emitted. The
turn succeeds, no error is raised, nothing upstream can tell, and the rider reads raw markup in a chat
bubble. `toResponse` now suppresses any `say` carrying tool-call markup **before any other branch** and
returns the retry line, counting it as a new `plan_degraded` reason (`say_leaked_tool_call`); the eval
panel counts it too, because a defect suppressed in production and invisible to the panel grows in the
dark. ⚠ It SUPPRESSES rather than salvages: parsing a route back out of prose the model was told not to
write would mean reconstructing a billed request from untrusted text, which is the exact hole INV-1's
wire re-assert exists to close.

⚠ **THE FOUR 2026-08-04 HARDENING ITEMS BELOW ARE ON `main` AND NOT DEPLOYED.** Steps 0–12 went to prod
on 2026-08-02; these landed after and have not been pushed, so "now" in them means *on main*, not *in
production*. The live revision still hands a rider a card for a fabricated anchor id, still passes a
namespace-prefixed tool-call leak through to the chat bubble, still cannot count a missing
`ANTHROPIC_API_KEY`, and still bills two Routes calls for an A→A route. Ship them with the next push.

⚠ **AND THE SUPPRESSION MISSED THE FORM THE MODELS ACTUALLY EMIT — widened 2026-08-04.** The first cut
matched the bare tag names only (`<invoke`, `<parameter`), which is the shape that day's leak happened to
take; a **namespace-qualified** tag (`<ns:invoke`) matched nothing and went straight through to the rider's
bubble. `LEAKED_TOOL_CALL` now allows an optional `word:` prefix on open and close tags. Verified by probe
in both directions: it catches bare and prefixed forms, and still ignores prose using those words
("the parameter road", "the Invoke overlook") because the `<` stays required. Knowingly still out of scope:
a call the model writes as JSON prose — every pattern loose enough to catch that also flags a legitimate
object, and it already degrades to `route_untranslatable`, i.e. ugly prose but never a wrong drive.

⚠ **THREE MORE `plan_degraded` REASONS, AND A GUARD THE CODE CLAIMED TO HAVE (2026-08-04).**
`planner.ts` documented that the caller "re-asserts every id against the same allowlist this turn was
given" and drops the route if any misses — **it never did**, and `plan-stream.test.ts` pinned the absence by
feeding random UUIDs through and expecting them to translate. INV-1's real enforcement was, and remains, at
the WIRE (`hydrateAnchors`); the consequence of the missing plan-time check was that a **fabricated** id
reached the rider as a tappable card whose tap was a 400. `toPlannedRoute` now takes the roster as a Set and
refuses `start`, `end`, every `via` **and `return_anchor_id`** against it, counting `route_off_roster` —
deliberately distinct from `route_untranslatable`, because only this one says the tool's "copy ids exactly,
never compose one" instruction has stopped landing. ⚠ It is a **UX guard, not INV-1**, and strictly weaker
on purpose: the roster is memoized (`PLAN_ROSTER_MEMO_TTL_MS`), so it catches a fabricated id but not a
place de-curated a minute ago. Do not consolidate the two — the stale one cannot be the guard, and the
authoritative one cannot run before the rider taps.
Also now counted: **`not_configured`** and **`bad_transcript`**, the two `PlannerTurnError` reasons raised
BEFORE the model call — so `logPlanSpend` never ran and no line existed anywhere, while the rider still got
HTTP 200 and an in-persona apology. A deployed revision with no `ANTHROPIC_API_KEY` was therefore countable
by nothing: `/health` green, no 5xx, one unstructured stderr line no log-based metric can read. `timeout`,
`upstream` and `client_gone` stay OFF that list — the first two are already a structured `plan_spend` with
`outcome: 'failed'`, and the third is a rider closing the app, which must never page anyone.

⚠ **The zero-distance route is refused at parse now, on both billed paths (2026-08-04).** `start === end`
with an empty `via` is not a drive: it materializes as a near-zero polyline that `retraceFraction` scores 0
(it needs ~1.5 km of along-route distance to see a doubling-back), so the no-same-road gate passed it,
`/propose` billed Google and answered 200 with `estStopCount: 0`, and only CREATE rejected it — after
billing a **second** Routes call. `isDegenerateRoute` (`@skipper/shared`) is one predicate refined onto
`driveProposeRequest` + `createDriveRequest` and read by `toPlannedRoute`, so the rider never sees the card.
⚠ `plannedRoute` is deliberately NOT refined: it also types `drawn`, whose rule is that a bad entry is
DROPPED, never a 400. ⚠ And the guard is "same ends **AND** nothing in between" — a loop IS `end === start`
with midpoints, so a rule written as "reject `start === end`" would refuse every round trip in the product.

⚠ Landed with it, from the same review: the example no longer teaches **"Consider it drawn"** (the
prompt quotes that exact phrase as its canonical violation, and a few-shot beats an instruction — the
observed device failure was that string verbatim); the draw beat now RESTATES the drive, which is also
the only record the model keeps of what it drew. Route-metric questions ("how far?", "how long?") got
an honest line for the first time — they previously fell through to the place-spoiling deflection.
Midpoints, which the tool has always accepted, now exist in the prose at all. Quoted SPEECH is
contracted (the contraction-free style was a test convenience that had leaked into the voice). And
**every `wire: true` client line in `apps/mobile/src/ui/voice.ts` is now recognised as PROMPT SURFACE**
— three of them stated things the prompt forbids and rode back to the model as its own precedent.
⚠ Founder call, same day: a rider who sincerely asks whether they are talking to a machine gets **the
truth, in persona**. Dodging it would have the honesty spine tell the one lie the character is built
not to tell.

⚠ **Unverified without a device** (stated rather than implied): that deltas render progressively over
URLSession; `keyboardVerticalOffset={useHeaderHeight()}` (`ConversationScreen.tsx` carries the concrete
on-device check — do it first); the three client timers; `AbortSignal.any` on device; and that closing
the HTTP stream actually stops Anthropic billing, which is the premise of the whole cancellation feature.

**8 — Anonymous split.** ✅ **DONE 2026-08-01, in four commits** (API → mobile session → the preview
clip's playback → the mint), each with root + `apps/mobile` `bun run check` green. Built by a parallel
agent team with two adversaries re-reading from disk.

⚠ **INV-15'S CONTROL CHANGED — see INV-15 above.** The request-level test replaces deploy ordering as
the mitigation, and the `!userId` backstops are re-keyed on TIER because id-presence becomes a no-op
the day the mint ships. Those two are the load-bearing half of this step.

**Pre-work (folded into the API commit, because it is what makes the test possible):** `auth.ts` is now
a **memoized** `buildAuth()` behind `createLazyProxy`, so importing `drives.ts` costs no env. ⚠ The
memoization is a SECURITY property, not an optimization: `createLazyProxy` runs its factory on every
property read, so an un-memoized build would construct a fresh auth context per request — including a
new in-memory rate-limit store, silently disabling the brute-force guard on `/sign-in/email` with
nothing failing. Mutation-checked. Boot-time fail-fast moves to an explicit `assertAuthEnv()` in
`index.ts`; ⚠ it was briefly left un-wired and the adversary caught it — a constant nobody reads, which
is the exact step-7 failure repeated. Verified by running the API with the secret deleted.

**The preview clip (INV-5).** `/propose` already had the release-filtered corpus in a local variable, so
the clip is `stops[0]` — **the drive's opening beat**, so the taste and the product can never disagree
(ranking by clip length overrides `buildDrive`'s own judgement and spends the best moment before the
drive starts). The build corpus is now **branded** (`BuildCorpus`), which makes the swap INV-5 forbids a
COMPILE error: the filtered and unfiltered maps are structurally identical, which is precisely why that
mistake would otherwise typecheck clean and publish unreleased work to a stranger. Mutation-checked both
ways — including a type-level probe that fails if the brand itself is ever "simplified" away.

⚠ **The audio flip (D35) created a regression the adversary caught: nothing handed the session BACK.**
Under the old `mixWithOthers` nothing was ever interrupted, so nothing needed returning; `doNotMix`
moved three surfaces into the class `useDrive` had already solved and none inherited the solution.
Pausing a player does NOT release the session — iOS resumes the rider's music only on deactivation — so
a rider who tapped the taste would have had Spotify paused permanently, with no control on screen that
fixed it. `setIsAudioActiveAsync(false)` now runs on stop, on natural end, and on unmount, on all three.
**Any future surface that takes exclusive focus owes the same.**

⚠ **Cost posture, unchanged but re-premised (founder-visible):** `PROPOSE_RATE` (15/min per IP per
instance) was set when `/propose` sat behind an account wall — the wall was the first-order guard and
the limiter was defence-in-depth. It is now the ONLY guard on a billed Google Routes call reachable by
any stranger, forever. The number was not changed and is not being recommended as a change; its premise
moved, and per CLAUDE.md's STOP rule that is a founder call, not a refactor.

⚠ **Owed, NOT decided (RISK-3, and it got sharper):** whether minting at app open counts as account
creation under 5.1.1(v). The rider cannot delete that row in-app — `deleteUser` sits behind
`sensitiveSessionMiddleware` and an anonymous user has no credential. If the answer is yes, the fix
already ships in the installed package (`deleteAnonymousUser`, exposed by `anonymousClient()`) and is
~15 lines. **Decide before submission.**

⚠ **Skipped deliberately:** review §1.10's ~3-stop floor — an unargued product number the review itself
calls "a product judgement with no right answer". The honest floor now on the wire for free is
`previewClip != null`: a proposal with a clip has at least one stop and at least one thing to say.

⚠ **Unverified without a device:** that `doNotMix` actually pauses Spotify and that the session release
resumes it; the mint round-trip and its SecureStore write; whether `status.error` is populated for a 403
on a stale presign (if not, `clipUnavailable` is dead copy — ten seconds on a device settles it). Step
7's still-ASSUMED `keyboardVerticalOffset` is still owed a look, but now against the COMPOSER — the
footer holds nothing else.

⚠ **THE PINNED MINI-TRANSPORT (review §1.12(b)) WAS REMOVED 2026-08-03** (founder), so the card's own
disc is the ONE transport for the preview clip. It duplicated that disc rather than backing it up:
`activeCardId` stays set for the rest of the conversation, so a rider looking straight at the card got
two pause buttons and the same clip titled twice. What it was guarding — audio still playing when the
composer goes null (offline, failed regions load) — is covered by the blur stop in `useFocusEffect`,
by `startFresh`, and by the unconditional session hand-back on `didJustFinish`. Knowingly given up: the
progress readout, and the explicit ✕ that released the audio session mid-clip (a rider who PAUSES now
holds it under `doNotMix` until they leave the screen). `src/ui/ClipBar.tsx` has no callers left and is
a prune candidate for the simplification sweep.

**9 — Offline subject-keyed store.** ✅ **DONE 2026-08-01.** Bytes are now shared and subject-keyed in
`Paths.document/clips/`; every drive keeps its own seq→bytes `manifest.json` (INV-6). The v4→v5 re-key
runs with **zero network** and moves bytes rather than re-fetching them.

⚠ **THE STORE KEY CARRIES THE REVISION, and that was not in the spec.** Collapsing N copies to one
creates a failure nothing could see: drive A stores subject S; the operator re-synths S; drive B's
manifest correctly names the new revision; the top-up asks "is S present?" → yes → skips; **B plays A's
old telling forever.** `isDownloadStale` cannot catch it — it compares MANIFESTS, and both manifests are
right; the BYTES are wrong and nothing compared bytes to manifest. Under per-drive storage this was
structurally impossible. Putting the revision in the filename makes it impossible again *and* makes
every collision provably byte-identical, which is what lets the collision rule ("delete the SOURCE") be
lossless by construction.

⚠ **The everyday "Update" re-pull was a bigger hazard than the rare drive delete** review §1.9 focused
on: `runDownload` opened with `deleteDriveDownload` as a deliberate clean slate, which under sharing
reaches bytes another drive depends on, on a path that already tolerates partial failure. A re-pull is
now a top-up — fetch, diff, download only what is absent. **Nothing but the sweep may remove a shared
byte**, and the sweep is fail-closed: it deletes nothing if any manifest is unreadable, if a transfer is
in flight, or if the keep-set is empty. **A refcount was rejected** — a persisted count is a second
source of truth that drifts silently in the DELETING direction; the manifests ARE the refcount.

⚠ **`clipsPresentOnDisk` was all-or-nothing** and gated four functions, so any one of these failures
would have made a whole drive vanish from the offline list and error-wall the player rather than costing
one stop. Fixing that predicate was the cheapest safety in the step.

⚠ **The adversaries caught a defect the build itself introduced:** a failed top-up rewrote the manifest
from the fresh plan alone, dropping a seq whose OLD bytes were on disk and playing fine — then orphaned
them for the sweep to delete. Silent, automatic, no rider action. A seq now carries forward its saved
entry when the planned byte is absent (`resolveClipRef`, pure and mutation-checked): stale-but-playable
beats a gap, and `missingSeqs` still counts it so the "N left to save" chip fires.

Verified in the native source rather than assumed: `move()` **throws** on collision and touches nothing;
`overwrite: true` is a non-atomic `removeItem` then `moveItem`; a **Directory** destination silently
keeps the SOURCE filename — the one failure that throws nothing and would pass any "no exception" test.
`file.size` returns **null**, not 0, for a missing file, so `(size ?? 0) > 0` is the only correct
presence check.

⚠ **Deferred, recorded:** promoting a legacy drive-local clip into the shared store once its subject
becomes nameable (the FIELD landed; the promotion did not), and a disk-full migration leaving that drive
at 2× storage permanently. Both cost space, never audio.

⚠ **Unverified without a device, and unverifiable by a fresh install:** the migration itself only runs
when a build that saved v4 downloads is upgraded in place. Install the previous build, download two or
three overlapping drives, then install this one over it — a fresh install never exercises it, which is
exactly how a broken migration ships green.

**10 — Simplification sweep** (D36). ✅ **DONE 2026-08-01, in six atomic commits by explicit path** —
no codemod, `curate-places` untouched (INV-2), root `bun run check` green after each.

Cut, each verified to have zero readers first: `durationBucket` + `interest` (never imported, survived
two pivots — sediment, not vocabulary); `wave` off `driveClipForm` (roam is gone, so no drive can
contain one; the corpus is 458/458 `story`); `areaFill`/`areaStroke` (the district hull they coloured
went with the area trigger, three steps earlier); `drive_demand` (D25 — a non-idempotent write on the
credit-spending path, read by nothing); `GET /sources` + `apps/api/src/sources.ts` (two homes for one
CC BY-SA list, where the "credit a source without a release" argument was never true because the app
had to bundle a byte-identical fallback anyway); the two dead studio CLIs and `golden.ts`'s two
disconnected case tables (D26); the `detours` structural tests (D27 — zero writers).

**One parser for `regions.bbox`.** There were FOUR, agreeing by luck, and one difference was real: the
admin's trimmed and the other three did not, so a bbox typed with a space after a comma resolved in the
console and matched zero pois everywhere else. Now `parseRegionBbox`/`pointInRegionBbox` in
`@skipper/engine`, tested including that case. ⚠ `bboxError`/`MAX_BBOX_SPAN_DEG` deliberately stay in
the admin — an operator WRITE-boundary guard against a paid-run runaway is different semantics.

**One definition of "signed in"** (`packages/shared/src/access.ts`). The API's and the app's copies
agreed by comment, not by construction, while INV-9 makes that predicate decide both what a rider sees
and whether the server hands them a gated route — and a drift had already happened (the client's
`isAdmin` did not exclude anonymous until step 8b). Mutation-checked.

⚠ **The three untyped success literals in `drives.ts` now `satisfies` their DTOs.** They matched
already; the point is that an optional field was previously invisible to tsc in BOTH directions.
Mutation-checked that the guard bites.

⚠ **Roam prose that described a LIVE surface** is corrected — most importantly the admin Reference
page, which CLAUDE.md requires to stay true and which no test can catch drifting. It told an operator
that Released meant "playable in roam + drives" on the page they consult before doing something
permanent. ~140 incidental historical mentions are deliberately left; a mechanical rename across the
console is the codemod-shaped churn this sweep exists to avoid.

⚠ **NOT cut, with reasons** — all from `post-1-1-slate.md` §3:
- **`drives.route_sig` (§3.1).** The evidence is sound (no SELECT reads it; zero hits outside the API),
  but the column is **NOT NULL**, so the code cut and the DDL must land together or `POST /drives`
  breaks on the first insert. That pairing is a deliberate production act against the one shared Neon
  host, not a side effect of a sweep commit. Owed as its own change.
- **`test-mastering-chain.ts`**, which D26 names as dead. Its premise is wrong for that file:
  `audio-loudness-spec.md` cites it twice as the harness to run before any mastering-chain change.
  Rarely used is not dead. Raised rather than resolved against a live decision record.
- **Hard-delete drives (§3.5)** — the slate itself says "right after 1.1", and it carries a real
  behaviour change (the idempotent replay must re-key off the ledger or a replay becomes a free drive).
- **Drive music (§3.8)** — contradicts D28 and is explicitly founder taste.
- **The conditional-spread idiom (§3.6)** beyond the typed literals — churn across files steps 4 and 8a
  both edited, for a guard the `satisfies` now provides at the boundary that matters.

✅ **Already resolved by earlier steps, recorded so they are not re-proposed:** §3.10 (`places.featured`
is now fed — step 8's `exampleAnchors` orders by it) and §3.11 (the `GET /drives` credit block sits
behind `requireAccount` after 8a, and its backstop is tier-keyed).

**11 — Instrumentation + remaining boundary tests** (D31/D32). ✅ **DONE 2026-08-02, in five atomic
commits** (API tests → the INV-12 re-homing → API instrumentation → the mobile contract → the mobile
funnel), root + `apps/mobile` `bun run check` green after each. The spec body was one line, so the
content came from the review's §2.3 and §1.7(b) — **both of which had to be corrected against the code
before they could be built; the corrections are recorded in that doc's §4.**

**The COST half of D32 existed only as prose.** Step 8a shipped the access half; a grep for
`hydrateAnchors|NOT_AN_ANCHOR|materializeRoute` across `apps/api/test` returned one hit and it was a
comment — including for the criterion this spec's own Acceptance list states ("rejects a non-anchor
start, end, **OR `via` midpoint** … BEFORE any Routes call"). Four new files close it, each mutation-
checked. ⚠ `anchor-allowlist.test.ts`'s fixture RENDERS the query's WHERE clause and honours the
predicates it finds: a fixture that simply returned "the eligible rows" stays green through the exact
production regression it exists to catch. ⚠ `drive-body-caps.test.ts`'s create case drives an ACCOUNT
session deliberately — `requireAccount` answers 401 *before* the body is read, so an anonymous fixture
asserts the wrong boundary and passes for the wrong reason.
⚠ **`plan-route.ts:12` and `index.ts` had BOTH asserted in prose, for four steps, that a test pinned
the anonymous plan mount. There was none.** `app-mount.test.ts` finally writes it; it needed no
production change (`cors.test.ts` already imports the whole app).

**Rider-triggered spend is now countable.** Four single-line-JSON events — `plan_spend`,
`plan_degraded`, `route_spend`, `rate_limited` — so Cloud Logging parses them into `jsonPayload` where
a budget alert can key on them (a plain line lands in `textPayload` and no metric can query it).
⚠ `POST /drives/propose` previously logged **nothing** on success, so the billed Google Routes call —
half of what INV-11 names — was entirely invisible. ⚠ On severity: the `severity` field is the
DOCUMENTED lever (Cloud Logging lifts it onto the LogEntry); the stderr⇒ERROR fallback is agent
behaviour documented for GKE/Functions and is **not** stated on Cloud Run's logging page. Two files
had drifted into contradicting each other about this; both now state it the same way.
⚠ **`recordModelUsage` is NOT a guard on this path, and `planner.ts` used to claim it was.** The tally
is a process-global `Map` with no reader anywhere in `apps/api`, on an instance created and recycled at
will — a readout would report an unknown fraction of the fleet's spend as if it were the number. The
per-call line is the guard; the comment now says so. (The deploy-config half of §1.7 — `--max-instances`,
the budget alert, the log-based metric — is out-of-repo and tracked in `TODO.md`; nothing in
`bun run check` can assert it exists.)

**The full event set (D31) ships typed, and the `identify()` ban is enforced by the SDK.** ⚠ THE
FAILURE MODE HERE IS SILENCE: `track()` is `posthog?.capture()` and `posthog` is undefined without
`EXPO_PUBLIC_POSTHOG_KEY`, so a fully typed, fully green analytics module that emits NOTHING is
indistinguishable from a working one on any machine without a key — the repo's thrice-hit dead-symbol
trap, as the default outcome. **The exit gate is `grep -rn '\btrack(' apps/mobile/app apps/mobile/src`,
not `bun run check`.** Ten events, 16 call sites.
⚠ Both `track()` parameters are narrowed, not just the name — a name-only union still compiles
`track('plan_turn_sent', { text: riderInput })`, which is INV-13's actual hole.
⚠ `personProfiles: 'never'` makes seven person-mutating SDK methods no-ops, and a comment-stripped
source-text tripwire (mutation-checked in both directions) fails on `.identify(`/`.reset(` anywhere in
`app/`/`src/`. This is not a funnel preference: the App Privacy label filed with Apple declares Product
Interaction **Linked = No** and justifies its Device ID row with "PostHog gets no `identify()` call
anywhere in the app" (`../guides/app-store-submission.md` §8). ⚠ `reset()` is NOT gated by that option
and is deliberately absent — with no `identify()` there is nothing account-scoped in PostHog for an
erasure to reach, while `reset()` WOULD destroy the device spine the funnel runs on (INV-4).

Three placement traps, each recorded at its call site because the obvious answer is wrong in every
case: `turn_index` is a per-conversation COUNTER, because `seedExample` stamps its pair `wire: true` so
BOTH transcript-derived counts report a chip-tapper's first billed turn as 2 while a cold typist
reports 1; `round_trip` is `startId === endId` and never `via.length` (a one-way route KEEPS its via);
and `preview_clip_played`'s completion does not ride `didJustFinish` alone, because expo-audio drops it
across an OS audio interruption and completion RATE is the entire reason the event emits twice.

⚠ **Known and accepted, not a bug to rediscover:** `drive_started`'s latch is never cleared, and iOS
suspends rather than terminates — so it counts FIRST starts per drive per process. Read it as reach,
never engagement. Clearing on `end()` recovers most of it; deliberately not done in the pass that
introduced the event, so a baseline exists before the semantics move.

**11a — D12's wrap-up had no producer.** ✅ **FIXED 2026-08-02.** Surfaced by step 11's dead-constant
sweep and left open at the time: `wrapUpNotice` was typed AND consumed in `planner.ts`, and the prompt's
`== Wrapping up ==` section already ended in "or you are told the conversation is near its end" — but
**nothing anywhere set it**, so the model was never told, and D12 was prose describing behaviour the
server could not produce. `limits.ts` meanwhile cited that wrap-up as the reason `MAX_PLAN_MESSAGES` is
safe to set at 24. The fourth instance of this repo's most-repeated bug, and again invisible: an optional
field that is always absent is never wrong, so tsc and every planner test stayed green.

Now produced in `plan-route.ts` at `PLAN_WRAP_UP_AFTER_MESSAGES` (16 — the top of the normal 3-8 exchange
band in MESSAGES, leaving ~4 exchanges of runway before the hard stop). ⚠ Also a COST fix, which is why
the tests assert block ORDER: the notice is a third system block rendered AFTER the cache breakpoint, so
a future "tidy-up" that splices it into the prompt or the roster would rewrite the cached prefix on
exactly the turns it appears and re-bill the whole prompt, with nothing but the invoice to show for it.
All three assertions were mutation-checked (producer removed → red; block moved before the breakpoint →
red; `>` relaxed to `>=` → red).

⚠ **Units corrected while here:** `MAX_PLAN_MESSAGES` counts MESSAGES, but its "~2x the wrap-up point"
note read in EXCHANGES. Against the number it actually compares to it is 1.5x, not 2x.

⚠ **THE ROSTER CAP TRUNCATED IN THE WRONG ORDER, AND SAID NOTHING — fixed 2026-08-04.**
`MAX_PLAN_ANCHORS` is applied twice: as a SQL `LIMIT` in `loadRegionAnchors` and again in
`buildRosterBlock`, which re-sorts by `byAnchorRank` (`featured` FIRST) before trimming. The query ordered
by name alone, so whichever rows it dropped were gone **before** that ranking was ever applied — a
curator's `featured` pick whose name sorts late would be deleted from the skipper's world *because of its
spelling*, silently inverting the one ranking a curator controls. And because the query fetched EXACTLY
the cap, `buildRosterBlock`'s truncation warning — the only operator signal — was **unreachable from
production**; the test proving it worked called the function directly with cap + 1, so it was green while
the path was dead. The query now leads with `desc(places.featured)` (NOT NULL, so no NULLS-first hazard),
fetches `cap + 1`, emits a queryable name-free `anchor_roster_truncated` line, then trims.
⚠ **Latent, not live, and measured rather than assumed:** Lake Tahoe is **109 eligible / 16 featured / 91
headroom** and Yosemite 0 (read-only count, 2026-08-04) — nothing is being dropped today. But `limits.ts`
records Tahoe going 26 → 111 in a single day, so the margin is one curation pass wide. Count the DB.

**12 — Docs + store.** ✅ **The in-repo half is DONE 2026-08-02** (`add97ee`, `6f07de9`, `f81794c`).
CLAUDE.md was already rewritten (`0c268cf`).

- **`.env.example`** — the `ANTHROPIC_API_KEY` scoping was the least of it. Diffing every
  `process.env` / `requireEnv` / `hasEnv` read against the catalog found **seven live vars missing**
  (`TRUSTED_PROXY_HOPS`, `EMAIL_REPLY_TO`, `ADMIN_CURATE_MODEL`, `SKIPPER_GROUNDING_VOTES`,
  `SKIPPER_LAN_HTTP`, `SKIPPER_ALLOW_DESTRUCTIVE_DDL`, `SNAPSHOT_STAMP`) and **two documented that
  nothing reads**. Also: the sample route was still `/roam/sample`, and the narration/TTS concurrency
  defaults were documented as 6 when the code says 12.
- **Roam decision records** — seven got status changes in place, plus five code comments that named
  `GET /roam` or the "taps Ride Along, gets 0 pins" dead-end in the present tense. The one worth
  reading is `create-a-drive-architecture.md`: 1.1 looks like a revert to the free-text planning that
  record killed, and isn't — free-text died because the server GEOCODED a name; the planner emits
  anchor ids the wire re-asserts.
- **App Store listing** — §§3/4/10 now carry 1.1 replacement blocks beside the live text (the doc's
  own rule: it is a RECORD of ASC, and re-pasting a stale copy reverts the founder's edits). §12's
  pre-flight probed `GET /roam/sample`, which **404s on a healthy 1.1 deploy** — it would have read a
  working sample as broken.

⚠ **Three parts of this step cannot be closed from the repo, and none is a docs edit:**

1. **The metadata is written, not entered.** Pasting it into ASC is blocked on §3.1's founder call —
   `1.0.0` is still in review selling the old product, and that decision expires silently the day a
   reviewer picks it up.
2. **Screenshots need a real recapture** (§9): home is replaced, the roam encounter shot is of a
   deleted mode, and the hero is the removed START/END picker. Signed Release build + dark mode +
   `simctl status_bar` + the frame compositor. It serializes behind the UI settling.
3. **The §10 reviewer notes need an on-device pass.** They were written from `voice.ts` and the
   screens, which is not the same as having walked them.

**Then RISK-1: drive one for real.**

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

⚠ **RISK-3 — Minting on launch creates a row the rider cannot delete in-app.** Accepted knowingly;
mitigate by tightening `/sign-in/anonymous` (INV-14), and decide before submission whether this counts
as account creation.

> ✅ **DECIDED 2026-08-03 (founder): the mint is NOT account creation under 5.1.1(v); 1.1 ships with no
> anonymous delete affordance** — [../decisions/anonymous-mint-and-account-deletion.md](../decisions/anonymous-mint-and-account-deletion.md).
> ⚠ That record also corrects this paragraph's original reasoning, which was wrong on the mechanism: the
> barrier was never "no credential to re-auth with". The anonymous plugin mounts its OWN
> `POST /delete-anonymous-user`, it is live here, and it asks for a session — not a password. So the
> omission is a JUDGEMENT that survives on its own merits, and the residual risk is one review cycle.

⚠ **RISK-4 — No global spend ceiling.** The limiter is per-instance and Cloud Run autoscales, so the
real bound is limit × instances. Accepted for an unlaunched app; revisit before real traffic.

⚠ **RISK-5 — A live persona has no grounding gate.** The routes-only boundary is structural via
tool-use output, but the prose deflection is prompt-held. Hold it in review.
