# Release batches

**Status:** In progress 2026-09-09. Mobile fixes implemented; root/mobile checks and iOS export pass.
Simulator playback, attribution, and trace checks pass. TestFlight 1.1.1 (26) is installable;
sign-in runtime and physical-device coverage remain pending.
Scenic investigation awaits the first route's endpoints and previous proposal. No routing change
is build-ready, and no server deployment is claimed.

## Non-iOS batch

Investigate one proposed scenic route at a time. Establish the start, destination, time budget,
and any rejected proposal first. Verify the actual drivable scenery against current authoritative
sources, then compare the route with released narration coverage and listen to the candidate clips.
Scenery and strong narration must both earn the detour. Present one route with evidence and tradeoffs;
on disagreement, replan before proposing another. Do not infer a routing algorithm from one example.
Paid operator route/model/corpus runs still require explicit founder authorization.

The handoff supplies no endpoints or prior scenic evidence. Investigation cannot honestly be
called complete until those are supplied and a route is assessed. Mobile scenic changes stay separate.

### Compatibility with the shipped app

The current API deliberately retains JSON alongside SSE in `apps/api/src/plan-route.ts`.
`packages/shared/src/schemas.ts` defines the planner, proposal, and create wire contracts.
`apps/api/src/drives.ts` materializes allowlisted anchor IDs before selecting released tellings.

| Candidate work | Independent server deployment |
| --- | --- |
| Planner wording, existing validation/fallbacks | Compatible if `say`, `done`, route fields, JSON fallback, and SSE frames retain their meaning. No additional paid calls or weakened caps. |
| Corpus loading, cluster serving, preview selection | Compatible if the proposal/manifest shapes, release gate, owner scope, and optional/null preview behavior stay stable. |
| Deterministic narration selection/pacing | Server-owned; can affect newly created drives without an app update. Preserve frozen saved selections. Requires a concrete quality finding before implementation. |
| Scenic detour routing | Pending investigation. Existing `start`, `end`, and `via` anchor IDs already express waypoints, but that capability alone does not establish good routes. |
| Pause labels, sign-in, accessibility, trace list | Bundled into the iOS binary; no independent server fix. |

Deploy a compatible server change only after its focused access/contract tests and root check pass;
verify production with the canary workflow after an authorized push. The existing shared-tree API
diff observed at task start was a cluster-loader extraction, not a scenic routing implementation; it needs its own release
review with the accompanying database/admin work. This batch does not take ownership of that work.

## One iOS update

Include the existing React header, source-sheet, and scrubber accessibility changes, plus:

- Use the explicit drive pause state for ON HOLD, including between clips. Loading audio must not
  claim the GPS watch is paused.
- Validate email, six-digit code, and nonempty password before submitting. Keep form fields and
  alternate actions still while a request is pending.
- Offer the password fallback from both email and code steps, preserving the email and clearing
  stale errors/code (TODO #79; rejection history remains in the submission guide §15).
- Give trace filenames their own row, name each share/delete control for VoiceOver, surface operation
  failures, and sort by recording timestamp across drive IDs without reading GPS payloads.

Root/mobile checks, an iOS Metro export, simulator regression coverage, and a release build validated
through App Store Connect are required. A clean release snapshot must contain the accessibility files;
building HEAD while they remain uncommitted would omit a required part of this batch.

No OTA infrastructure. Guest signup simplification stays deferred as TODO #80. Account ownership,
credits, anonymous-session handling, and the currently shipped API contract remain the constraints.

## Verification record — 2026-09-09

Root `bun run check`: exit 0. Mobile `bun run check`: exit 0, 455 tests, six existing hooks warnings.
Logs: `/tmp/skipper-release-root-check.log` and `/tmp/skipper-release-mobile-check.log` (local).
An iOS Metro export also passed; it does not prove that a signed release build reached Apple.

Sim QA — iPhone 17 Pro Max, iOS 26.5, existing dev build and Metro. Screenshots were inspected
in the task conversation. Playback used the admin simulated GPS source, at real time, on the saved
Zephyr Cove → Stateline drive. No new drive or paid operator run was created.

PASS

- Home, Settings, My Drives, drive detail, Developer, and player navigation reached through labeled
  controls. The existing React header rendered in day and dusk.
- Player: ready → playing → held clip → resume → between clips → held between clips. ON HOLD and
  the GPS explanation appeared only while held; itinerary announces “current stop.”
- Scrubber: the accessibility increment advanced the held clip from 0:06 to 0:21 without resuming.
- Attribution: Show sources opened a sheet with separate Wikipedia and CC BY-SA links and Done;
  Done closed it. Used in the player; other source-sheet importers were not all exercised.
- Developer: full filenames and individually named actions visible in day/dusk. August 6 recording
  appears above August 4 recordings from a different drive. No recordings shared or deleted.
- Restored Auto appearance and Real GPS after ending playback.

NOT VERIFIED

- Sign-in UI and actual email delivery/code redemption/password authentication. The attempted
  Safari deep link stopped at a confirmation missing from its accessibility tree. A coordinate tap
  fallback failed (`noWindowsAvailable`); no sign-in success is inferred from compilation.
- Trace share/delete failure messages, map-player variants, large Dynamic Type, all header/source
  sheet/StopRow importers, and an injected audio-buffering state.
- Real GPS outdoors, airplane-mode offline, audio focus/interruption/Now Playing, and native
  splash/icon after a fresh build require physical-device/release testing.

Coordinate taps: one attempted Safari Open confirmation (brittle, unsuccessful); application checks
above used accessibility controls. This was the pre-build simulator pass; the TestFlight outcome is recorded below.

### Concrete release snapshot

Include the mobile diffs for `_layout`, `developer`, `sign-in`, `drives/[id]/play`, `trace-export`,
`AttributionButton`, `HeaderIconButton`, `Scrubber`, `StopRow`, `voice`, and `DESIGN.md`, plus new
`src/ui/AppHeader.tsx`, `src/lib/trace-order.ts`, and `src/lib/trace-order.test.ts`. Include this record
and the signup-design update. Preserve the mixed TODO edits (#79 removed, deferred #80 added).
Do not sweep unrelated shared-tree work into an EAS commit. Recheck the exact isolated snapshot,
then submit once and read back `VALID` / `IN_BETA_TESTING` from App Store Connect.

## TestFlight execution — 2026-09-09

Founder approved an isolated checkout. Root/mobile checks and an iOS export using the production
EAS environment passed there. Version 1.1.1, build 26 was queued from commit
`2b6b28280b68fd9091df78b0318499d70bd8fede`, based on `64f9d74649560c57444185480b6f4468957dd34a`.
The shared branch and unrelated edits were not included in the snapshot commit.

- [Build](https://expo.dev/accounts/manoa-inc/projects/skipper/builds/6f1d8ddd-44e8-40e1-8b3f-3f50118239b8)
- [Submission](https://expo.dev/accounts/manoa-inc/projects/skipper/submissions/0231d835-8ce5-4dca-9aa4-b81c90c772f8)
- Local source bundle, manifest, and check logs: `.scratch/releases/1.1.1-26/`.

EAS finished the signed build, but submission stayed queued. After Apple’s local `altool`
validated the exact IPA without errors, the queued EAS submission was canceled and that binary
was uploaded directly. No second build was created.

**Verified outcome:** 1.1.1 (26), `processing=VALID`, `internal=IN_BETA_TESTING`,
`encryption=false`, uploaded 2026-09-09 15:49:44 PDT. External testing remains
`READY_FOR_BETA_SUBMISSION`; no App Store review submission or public release was performed.
Apple delivery UUID: `56a958bb-41a0-4b1e-bba1-8c1e21d0ae18`.
Source commit: `2b6b28280b68fd9091df78b0318499d70bd8fede`.
IPA SHA-256: `dc279ac6231d5b01b7f0cf6d6d19638d8da4775751fdd60faf16604eca4e9306`.

[Install/manage in TestFlight](https://appstoreconnect.apple.com/apps/6778946770/testflight/ios).
The local release archive contains the signed IPA, a git bundle of the source commit,
manifest, validation/build/upload logs, and the App Store Connect read-back. The temporary
checkout was removed after preserving these. The mobile source is integrated on main with this
record and matches the TestFlight snapshot byte for byte; `apps/mobile/app.json` says 1.1.1.

Direct upload reference: [Apple upload tools](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/).
The installed `altool --help` supplied the `--upload-package`, `--wait`, and API-key arguments;
existing ASC credentials were used without printing or copying the private key.
