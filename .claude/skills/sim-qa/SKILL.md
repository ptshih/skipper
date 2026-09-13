---
name: sim-qa
description: Verify native iOS changes with simulator XCTest and inspected screenshots, reporting actual flow and accessibility evidence. For "test the app", "does this screen work", "QA the mobile change", "check it in the simulator".
---

# Sim QA

Verify `apps/ios` against its actual SwiftUI views and injected services. The Expo client
is retained pending acceptance, but native QA uses Xcode and XCTest without Metro.
Read `apps/ios/CLAUDE.md`, `apps/ios/DESIGN.md` and the relevant flow contract in
`docs/guides/native-ios-verification.md` before choosing assertions.

## Evidence first

Report only what you observed. A compiled test, discovered selector, or screenshot you
have not inspected is not a passing flow. Keep the source snapshot, build receipt,
simulator/runtime, selected tests, exit status and xcresult with the report.

## Scope and build

Inspect `git status --short` plus explicit-path diffs; include untracked native files.
Map shared components to every affected screen using their actual call sites:

| Native area | Exercise |
|---|---|
| App/Auth/VersionPolicy | startup, deferred/recovered credentials, first paint and late version gates |
| Planner | streaming, account wall, explicit Make/Retry, cancellation and idempotency |
| Library/DriveDetail/Storage | filtering, partial/offline downloads, repair, local previews and Start gates |
| Driving/Playback/Location | simulated progress, controls and lifecycle; retain device limitations |
| Settings/Shared/Design | all importing screens, legal/account forms, themes and text scaling |

Coordinate the simulator execution lane with its owner. Use a dedicated simulator/run ID
and separate DerivedData for concurrent work. Do not erase all simulators or uninstall
an app holding upgrade evidence. Prefer headless `xcrun simctl` and XCTest; a visible
Simulator window is unnecessary for automation and screenshots.

From the repo root:

```bash
bun run ios:configure
SKIPPER_IOS_SIMULATOR_ID=<assigned-uuid> SKIPPER_IOS_DERIVED_DATA=.scratch/ios/<run-name> bun run ios:check
```

The script builds the real targets, then executes unit/UI tests and records an xcresult.
`--unit` and `--foundation` are scoped checks, not full acceptance. Native changes require
a rebuilt app/test target; there is no JavaScript hot reload. Root `bun run check` remains
required for retained TypeScript and tooling. Do not start or restart API/admin/site servers.

Use normal ad-hoc simulator signing (`CODE_SIGNING_ALLOWED=YES`, `CODE_SIGN_IDENTITY=-`),
as `ios:check` does. Real SystemKeychain tests require the simulator's application-identifier
entitlement; an unsigned launch can fail with -34018. This needs no distribution certificate
or provisioning profile. `CODE_SIGNING_ALLOWED=NO` is compile/mock evidence only.

## Drive the production flows

Use the registered DEBUG launch scenarios and accessibility identifiers from the QA
contract. Unknown scenarios must fail closed. Fixture services must feed the production
views/models, never substitute a lookalike screen. Reuse the same run ID when proving
persistence; use a fresh ID for independent cases. Valid UI scenarios initialize the real
native Maps renderer with the existing public bundle key before any map objects mount;
PostHog, app API requests and credentials remain isolated. Unit/rejected launches do not
initialize Maps. Do not use map IDs or Street View for this no-charge renderer verification,
contact the production app API, mint real accounts or perform billed planner/corpus calls.

Wait for observable state transitions, not fixed sleeps. Prefer accessibility identifiers
and labels to coordinates. Inspect the tree when a selector fails: a parent identifier can
hide descendants without the visual element being absent. Report coordinate taps as brittle.
For scrolling, keep the gesture inside the list viewport above persistent tab bars. A static
badge need not be tappable; verify its visible count or combined row label, then tap the row.

Map acceptance uses a separate known-land fixture in the wire's longitude/latitude order.
Keep financial/idempotency fixtures unchanged. A snapshot-ready callback alone cannot prove
visible tiles or a fitted route: inspect the route, recognizable land/street detail, and
Google attribution, with current-route viewport evidence from the isolated fixture run.

For state-changing interactions, retain before/after evidence and inspect it for truncation,
overlap, controls behind tab bars, multiline buttons, disabled gates and stale account data.
Exercise day/dusk/system, small supported iPhones and largest accessibility text. Element
presence does not establish visual acceptance or VoiceOver usability. Record exact text size
and restore simulator preferences you changed.

## Limits and follow-through

Simulator playback can prove local decoding and certain mocked/production lifecycle edges.
It does not prove real GPS, airplane-mode radio behavior, Bluetooth, call interruptions,
exclusive audio focus or real-device lock-screen behavior. Actual simulator SecureStore to
SystemKeychain in-place replacement is stronger than JSON mocks, but it still does not prove
distribution access groups, device lock behavior or App Store delivery. Keep these separate
from `docs/guides/native-ios-upgrade-rehearsal.md` observations and the real driving gate.

Report passed/failed/unreached flows with screenshots and precise reproduction steps.
When authorized to fix, preserve the failing snapshot first, edit only owned files, and
rerun affected checks against a new recorded build. During QA-only ownership, route findings
to the assigned owner; never silently repair their source or relabel an old result as new.
