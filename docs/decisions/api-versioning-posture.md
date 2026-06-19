# API versioning posture

**Status:** ✅ **DECIDED + BUILT 2026-06-09**; the GATE MECHANISM still holds. The launch-time update
gate ships now (pre-submission): `GET /version` + the mobile `VersionGate` + the `ContractError`
self-defense. This doc is the single source of truth for the versioning posture; it closes the
`TODO.md` "API contract" item and supersedes the CLAUDE.md forward-reference.

**Scope addendum (V2, 2026-06-18):** the additive-only **freeze had NOT engaged yet** when V2 landed —
v1 never shipped to the App Store, so there were zero installed clients to protect, and the V2 migration
**deliberately broke the wire contract** (`/tours` routes + tour DTOs removed → `/drives*` + `/regions`;
see `create-a-drive-architecture.md`). This is consistent with §5 below, not an exception to it: "ship the
gate in v1" means the *gate code* ships before submission (it does), NOT that the contract is frozen
before then. The additive-only rule (§2) and the freeze it implies **engage at the first App Store
submission** — until that moment the contract is break-freely (CLAUDE.md's STORAGE doctrine scope-note
already states this). Everything else in this doc — no URL versioning, the `/version` floor, client
self-defense — is unchanged and live.

## Context

CLAUDE.md's "break things freely" doctrine is scoped to STORAGE. Once the mobile app is in the App
Store, installed clients lag (review + slow updaters), so the **wire contract** (`@skipper/shared`
DTOs + `apps/api` routes) freezes at the first submission — we needed a posture before then. Skipper's
situation narrows the choice: a **single first-party client**, a tiny surface (3 DTO routes), and a
toy/charm lens (no third-party consumers, no scale pressure).

## Decision

1. **No URL versioning (no `/v1`).** For a single first-party client the prefix is the least
   load-bearing piece; the universal mobile pattern is **additive, backward-compatible evolution**.
   Researched 2026 prior art (SideKit / App Upgrade SaaS, the Firebase-Remote-Config tutorial genre,
   OSS `react-native-version-check`, and the GraphQL/tRPC "versionless" camp) all converge on
   evolve-in-place + a force-upgrade gate, not URL forks. Consequence: with no `/v2` fallback, the
   force-upgrade gate is the **sole** escape hatch for a hard break — "make it additive, or raise the
   floor and force-update" is the only path.

2. **Additive-only evolution is the rule.** Never remove/rename/retype a DTO field; only add optional
   ones. The client is already a tolerant reader (Zod strips unknown keys — no `.strict()` anywhere).

3. **A custom `GET /version` endpoint holds the floor** (not PostHog/Firebase/a SaaS). A per-platform
   policy (`minimum`/`recommended`/`storeUrl`) lives in `apps/api/src/version-policy.ts`, so the floor
   is raised by a **backend deploy — never an App Store release**. The client compares its own semver
   marketing version (`Constants.expoConfig?.version`, via `@skipper/shared` `gateFor`) and shows a
   dismissible **nudge** (`< recommended`) or a blocking **wall** (`< minimum`). Gating on the semver
   marketing version (not a build number) matches the prior art and needs no native dependency.

4. **Client-side self-defense.** `parseDto` turns an HTTP-OK-but-unparseable response into a typed
   `ContractError` → a plain "please update" message, instead of the in-voice fallback. The hard WALL
   stays driven only by the server `/version` floor: a parse error does NOT auto-wall (a transient
   server bug must not force-update everyone).

5. **Ship in v1.** You can only force-upgrade a device that already has the gate code (Orosz,
   *Building Mobile Apps at Scale*), so the gate ships before the first submission. Floors are seeded
   at a no-op (`minimum = recommended = "0.0.0"`) until deliberately raised.

## Rejected alternatives

- **`/v1` prefix** — cheap, but the least load-bearing; dropped at founder call (the gate is the real
  lever). Re-addable in one Hono `app.route('/v1', …)` move if ever forced.
- **PostHog / Firebase Remote Config / SaaS (SideKit, App Upgrade)** — all valid (PostHog version
  targeting is slick), but add a launch-path dependency for what is today one integer. A ~15-line
  endpoint on infra we already run is lighter; migration stays trivial (same client shape).
- **`expo-in-app-updates`** — good native Android install UX, but the wrong control model (gates on
  "store has a newer build," not our server floor) and adds native-module risk on the SDK-56/new-arch
  Release-build edge. iOS can't do native in-app install anyway.

## Follow-ups

- Fill the iOS `storeUrl` with the real App Store numeric ID at submission (placeholder until then).
- Raise the seeded floors deliberately when the app version is bumped for the first submission.
