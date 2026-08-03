# 1.1 build notes — verified coordinates

> **Status:** COMPANION to [drives-first-1-1.md](drives-first-1-1.md), written 2026-07-31 at `57fca21`.
> The spec holds DECISIONS and INVARIANTS; this holds the **file:line facts an 8-agent pre-flight
> verified against the actual code**, so an implementing agent doesn't re-derive them. ⚠ Line numbers
> drift — **code wins**, and re-grep anything that looks off. Nothing here is a decision; where
> pre-flight found a decision was needed, the spec carries it.

## Spec corrections — read these first

**Stale in our favour (less work than the spec says):**
- **`places.id` already exists** — `packages/db/src/schema.ts:459`, `uuid().defaultRandom().primaryKey()`.
  INV-1 says "add a stable id to `places`/`RegionAnchor`"; only the **Zod half** is real work. **No migration.**
- **`@anthropic-ai/sdk` is already declared AND installed** in `apps/api` (`package.json:13`), carried
  unused since `adc376e`. `import Anthropic from '@anthropic-ai/sdk'` works today — nothing to add.
- **`@skipper/shared` already hosts model ids** (`packages/shared/src/models.ts:10-14`, `CLAUDE_MODELS`).
- **INV-5 is nearly free** — `/propose` already calls `selectStopsForRoute` (`drives.ts:421`), so the
  correct release-filtered preview clip is already in a local variable in the right handler.
- **Half the offline migration needs zero network** — a saved v4 manifest still carries `clips[].poiId`
  (`offline.ts:257` strips only `url`), so poi-subject clips re-key offline. Only cluster clips need the wire.

**Wrong in the spec (more work, or a trap):**
- **Engine tests live in `test/`, not `src/`** — `packages/engine/test/{roam,area}.test.ts`, plus a **third,
  unlisted** one: `test/area-trigger.test.ts` (imports both `convexHull` and `RoamEngine`).
- **`PackPin` is in `roam-pack-util.ts:18`**, not `roam-pack.ts` as the spec says.
- **`create.tsx` dies at step 3 (the roam sweep), not later** — anything invested in hardening it has a
  roughly one-commit lifespan. This is why D41 cuts the old step 1.
- **Never bump `opus` in `models.ts`** — it silently repoints `NARRATION_MODEL` (`studio/src/models.ts:55`),
  `JUDGMENT_MODEL` (`:69`), `ENRICH_MODELS.opus` (`:80`) and two admin job models
  (`apps/admin/server/index.ts:323,:527`). Add a NEW key.

## Step 1 — `limits.ts` + the bounded body read — ✅ BUILT 2026-07-31

Kept as the record of what the pre-flight found and what it got wrong. Three corrections from the build:
- **The "four call sites" figure is right for `rateLimit()` and wrong as a cap inventory** — a sweep found
  ~30 more rider-facing caps, including a SECOND independent rider-facing limiter (Better Auth's own
  `customRules` in `auth.ts`), the only cap that bounds a paid call's shape (`via.max(8)` in
  `schemas.ts`), and three list endpoints (`GET /drives`, `loadRegionAnchors`, `GET /regions`) with no
  bound at all. `limits.ts` owns the caps it can honestly own and POINTS at the rest — never re-exports
  them, since a re-export is a second import path that invites a second home.
- **`limits.ts` imports NOTHING, deliberately**, and `readBoundedText` takes a `Request` rather than a
  hono `Context` for the same reason: `drives.ts:46` → `entitlements.ts:7` → `auth.ts` throws at module
  load without `BETTER_AUTH_SECRET`, so a single value import would make every future limits test seed a
  secret. Zero imports closes that question permanently.
- **A second rate-limit WINDOW does not need a limiter rewrite.** Each `rateLimit()` call closes over its
  own bucket map, so `app.use(path, rateLimit(MINUTE), rateLimit(HOUR))` gives two independent windows —
  verified by probe. An earlier read concluded the opposite, which would have meant accepting the
  per-day exposure instead of writing one line.

- ~~`apps/api/src/limits.ts` **does not exist**. Create it.~~ Created.
- `readJsonBody` is at `apps/api/src/drives.ts:728-742`, **module-private**, callers `:405` (propose) and
  `:452` (POST /). Its first act is `await c.req.json()` at `:735` — **no** Content-Length check, no cap.
  ⚠ INV-3's "reject before parsing" is therefore not a one-liner: bound the **bytes actually consumed**
  and 413 on overflow. `Content-Length` is caller-supplied and absent on chunked bodies — not a guard.
- `rateLimit()` returns `next()` unconditionally under `NODE_ENV=test` (`apps/api/src/rate-limit.ts:72`).
- Minor spec inaccuracy: limits are **four call sites across two files** (`index.ts:142,:157,:313`;
  `drives.ts:440`), not "four files".

## Step 3 — Remove roam: work from THIS list, not the spec table

Every entry in the spec's table exists. These are the **unlisted importers that will break the build**:

| Unlisted | Why it breaks |
|---|---|
| `packages/engine/src/drive-select.ts` | ⚠ **CRITICAL.** Imports `AreaRef` (`:16`), carries `area?` (`:56`), and `:169` `if (cand.area) continue` is a **production guard** (comment `:151-168`). D40 orders districts first so this dies honestly. |
| `apps/mobile/src/lib/clientIdentity.ts` | ⚠ **CRITICAL.** Imports the deleted `CLIENT_CAPS`/`clientIdentityHeader` (`:11`); exports `APP_VERSION` (`:30`) → `VersionGate.tsx:16` (the shipped force-upgrade hatch) and `CLIENT_IDENTITY_VALUE` (`:42`) → a header on **every** request (`api.ts:38`). Re-home `APP_VERSION` in the same commit. |
| `apps/mobile/src/lib/roam-pack{,-util}.ts` + `roam-pack-util.test.ts` | Import `RoamPin` / `getRoamManifest`. Carry `PackPin` forward here or step 9's harvest source is gone. |
| `apps/mobile/app/developer.tsx:6,48` | Consumes `DiagnosticsPicker` — a **non-roam** screen. |
| `apps/mobile/src/ui/voice.ts:346-369, :393` | `voice.settings.roamPack*` (~18 keys) + `voice.settings.diagnostics`. |
| `apps/mobile/src/ui/index.ts:30,31` | Barrel exports `Duck` + `DiagnosticsPicker`. |
| `apps/mobile/app/sample.tsx:6,9,50,69` + `api.ts:17,33,214-215` | Still say Roam/`getRoamSample`; `api.ts:215` **hardcodes** `/roam/sample`. |
| `apps/api/src/index.ts:349` | The surviving sample handler types attribution as `RoamPin['attribution']` — retype off `attributionList` (`schemas.ts:160`). |
| `apps/api/src/drives.ts` | Passes `areaCapable: true` (`:295,:897`), declares `area?` (`:174`), spreads `r.area` (`:261,:337`). |
| `apps/api/src/entitlements.ts` | `ApiEnv.Variables.client`. |
| `apps/api/test/client.test.ts` | A **second** client test the table doesn't name. |
| `packages/db/test/schema.test.ts:12,200` | Imports `driveDemand`. |
| `packages/engine/src/index.ts:5,11` | Barrel `export * from './roam'` / `'./area'`. |

⚠ **Do NOT delete `notSupersededByServedCluster`** (`clusters.ts:76`) — `drives.ts:313` still calls it, and
its NULL-safe SQL comment (`:79-85`) records a measured production failure: **46 pins collapsed to 4**.

⚠ Regenerate router types after deleting screens (`bunx expo customize tsconfig.json`) or mobile typecheck
fails. Run root **and** `apps/mobile` `bun run check` **per sub-commit**, not once at the end.

## Step 4 — the wire commit

- `loadRegionAnchors` (`drives.ts:88-108`) selects only `{name,lat,lng,primaryType,featured}` at `:95` —
  needs `places.id` projected **and** a new by-id query (`inArray(places.id, ids)` + re-assert
  `endpointEligible`) that does not exist.
- The clean seam: `drives.ts`'s internal `ResolvedEndpoint` (`:111-115`) is **local**, not the Zod type — so
  hydrating ids at the top of each handler leaves `routeWaypoints`/`routeSigOf`/`materializeRoute`/
  `selectStopsForRoute` untouched.
- `driveClip` (`schemas.ts:247-268`) has no `subjectId`/`subjectKind`; `drives.ts:354` sets only `poiId`, and
  a fused cluster clip carries `poiId: null` **by design** (`:243-244`, documented `:351-353`).
- `driveProposal` (`schemas.ts:219-230`) has no credits field — relevant if the cost disclosure reads a number.

## Step 5 — the pricing move (INV-11)

`spend.ts` must **SPLIT, not move**: `MODEL_PRICING` (`:20`) + `recordModelUsage` (`:48`) + the usage type go
to `@skipper/shared`; `estimateTtsUsd` (`:129`) **stays** — it imports `WORDS_PER_SECOND` from `../config`.
Six importers follow: `curate-places.ts`, `pipeline/classify-register.ts`, `pipeline/narrate.ts`,
`pipeline/job-progress.ts`, `generate-narrations.ts`, `generate-cluster-narrations.ts`, plus `test/spend.test.ts`.

⚠ `tallyUsd` (`:60`) returns **0** for an unpriced model, and the drift guard (`test/spend.test.ts:53-59`)
iterates only `[NARRATION_MODEL, JUDGMENT_MODEL]` — so without both the pricing row **and** an extended
guard, the planner's token tally reads **$0 forever with nothing failing**.

## Steps 6–7 — the planner

- ⚠ **Mount `/drives/plan` OUTSIDE `driveRoutes`** or it inherits `drives.ts:376`'s blanket `requireAccount`
  and every anonymous plan 401s until step 8.
- Prompt in `apps/api/src/planner-prompt.ts` — **not** `@skipper/shared`, which `apps/mobile` imports and
  would ship the system prompt into the app bundle.
- No streaming seam exists on **either** side: zero `streamSSE`/`ReadableStream` in `apps/api`; mobile is
  uniformly `parseDto(schema, await fetchJson(...))` over RN's XHR-backed fetch. `expo/fetch` **is**
  installed (expo ~57.0.8) and is the only viable RN path. Hono 4.12.30 ships `streamSSE`.
- `.env.example:18` still scopes `ANTHROPIC_API_KEY` to "narration". ⚠ Whether the deployed Cloud Run API
  carries the key at all is **unverified** — check before the first prod deploy or `/drives/plan` 500s.

## Step 8 — the anonymous split

- **The seven bare-`session` call sites** (INV-9): `index.tsx:56,180,183`; `settings.tsx:36,182,185`;
  `play.tsx:111`.
- `apps/mobile/src/lib/auth.ts:51-55` — `isAdmin` has **already drifted** from the server's `tierOf`
  (then `apps/api/src/tiers.ts:19`) by omitting the `isAnonymous` exclusion. Fix it with the helper.
  ⚠ Since done, and further than "fixed": step 8b unified both copies into `packages/shared/src/access.ts`
  and `tiers.ts` is gone, so this drift is now unrepresentable rather than merely repaired.
- `anonymousClient` is **not registered** (`auth.ts:26-36`); it is exported by the installed better-auth.
- INV-14's rate rule goes in `auth.ts:143-146` (`customRules`) — the spec assigns it to no step.
- **The wall sheet has no primitive.** No `Sheet` in `src/ui`, no `@gorhom/bottom-sheet`. Precedent to build
  on: the RN `Modal` at `src/ui/AttributionButton.tsx:45`.
- **Test harness blocker:** importing `drives.ts` pulls `./entitlements` → `./auth`, which **throws at module
  load** without `BETTER_AUTH_SECRET` (`auth.ts:53-59`), and root `bun test` runs unwrapped by dotenvx. Stub
  it in a bun test preload, or extract the route→gate matrix into a pure table.

## Step 9 — the offline store

- `MANIFEST_MIGRATIONS` (`offline.ts:311`) exists, is **empty**, and is already unit-tested — the seam is there.
- Re-key with `File.moveSync`/`Directory.moveSync` (present in the installed expo-file-system 57.0.1).
- The credential strip is **duplicated** at `offline.ts:257` and `:405` — replacing both with `PackPin` is the
  harvest.
- Twelve read paths resolve names relative to `driveDir`; follow all of them.
- Consider also harvesting `roam-pack.ts`'s `sweepPackOrphans` — a subject-keyed store creates exactly the
  orphan class it solves.

## Step 10 — the sweep

`routeSigOf` **survives** dropping `drive_demand`: `drives.route_sig` is NOT NULL (`schema.ts:705`) and on the
wire (`schemas.ts:226`). ⚠ Announce and claim paths before starting — D36's "repo-wide" is exactly the work
any concurrent cleanup agents do.
