---
name: testflight
description: Use to ship a native iOS build to TestFlight — verify the accepted source, Xcode archive/export, signed identity and symbols, then exact App Store Connect readiness. For "ship a testflight build", "cut a build", "another testflight", "push a build to testers".
---

# TestFlight

The current development target is `apps/ios/Skipper.xcodeproj`, scheme `Skipper`.
The shipped Expo client remains in `apps/mobile` pending native acceptance; its presence
is not a reason to build an Expo replacement. Native release tooling has passed independent
code review; actual signing, cloud symbols and Apple delivery remain unverified. Read the
current conversion status and owner reports before execution.

## What counts as shipped

A successful archive or upload is not TestFlight availability. Match the exact intended
app, platform, version, build number and source receipt, then obtain ASC evidence of
`processingState=VALID` and internal `IN_BETA_TESTING`, including resolved compliance.
Missing records, partial queries, expired/invalid builds and absent required relationships
are not success. Preserve the release record and logs needed to reproduce that conclusion.

## Prepare the concrete release

1. Read `docs/designs/native-ios-conversion.md`, `docs/guides/native-ios-release.md`,
   `docs/guides/native-ios-verification.md` and the current release-helper implementation.
   Resolve review findings and unmet acceptance gates before archive/upload. Follow the
   user's existing authorization; do not repeat routine approval requests already settled.
   A task to inspect or prepare documentation alone does not authorize release execution.
2. Inventory source ownership and the shared index. Never stage another owner's work,
   reset/stash/clean, switch branches, or let a build tool commit files automatically.
   The release must use an accepted immutable source snapshot. A detached checkout is
   appropriate when authorized by the session; check that snapshot, not unrelated edits
   in the working tree. Never force-remove a checkout that another worker may own.
3. Configure the four native client SDK settings through `scripts/ios-configure.ts`.
   `apps/ios/CLAUDE.md` documents native JSON/environment precedence and private output.
   Capture selected local configuration and explicit environment overrides together with
   source and export options before isolation. Never print values or package private
   signing/ASC/PostHog upload credentials into the app.
4. Run root `bun run check` and full `bun run ios:check` against the intended source.
   Scoped unit or build-only success is not full UI, signed-upgrade or real-device proof.
5. Resolve the next build number from complete, fresh ASC evidence and reserve/use it
   consistently. Recheck after an upload failure or lost acknowledgement before retrying;
   do not assume the previous attempt left the number unused.

## Native execution and inspection

The root entry points are `bun run ios:release` and `bun run asc:builds`.
The helper owns archive, export, inspection, symbol handling, validation/upload and exact
ASC readiness. Read its current options before invoking it: a default preparation run
may archive, query ASC and upload symbols even without an IPA-upload flag. A dry-run is
planning evidence, never an inspected artifact or a shipped release.

Inspect the exact artifact that will be uploaded:

- Bundle identity `fm.skipper.app` and team/default Keychain continuity with retained
  signed evidence. Matching bundle ID alone does not establish migration access.
- Executable entitlements and provisioning evidence agree; do not infer signed identity
  solely from project settings or a simulator's ad-hoc signature.
- Release API/SDK configuration, permission strings, privacy manifest, native Google Maps
  attribution and native-only runtime. Backend `@better-auth/expo` compatibility stays.
- Every required architecture has matching Mach-O/dSYM UUIDs. Symbol upload uses the
  correct PostHog project/host and reports actual success; missing upload credentials or
  skipped symbols remain an explicit unresolved gate, not an equivalent pass.
- Source, configuration, export options and artifact receipts remain unchanged between
  inspection and upload. Failed tools or unreadable inspection output fail closed.

After authorized upload, use the ASC helper's exact version/build filters and wait mode.
Do not accept the latest unrelated green build. If receipt is uncertain, reconcile ASC
before another upload. TestFlight readiness does not prove an App Store release or an
installed user's successful upgrade; preserve those evidence boundaries.

## Report

Report version/build, source receipt, artifact location/hash, signed identity, symbol
status, and exact ASC state. Link the actual evidence. On failure, identify the stage,
known build-number consumption and remaining gate. Do not infer completion from elapsed
wall time. Manual App Store release and listing history remain in
`docs/guides/app-store-submission.md`; tester feedback uses `bun run tf:feedback`.
