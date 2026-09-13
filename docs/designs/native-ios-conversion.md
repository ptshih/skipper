# Complete conversion to native iOS

**Status**: IMPLEMENTED / CHECKPOINT PREPARATION 2026-09-12. The reviewed simulator snapshot passed 333/333 tests (315 unit, 18 UI). Subsequent reviewed DEBUG receipt/download fixtures and strengthened UI persistence checks passed their focused suites; the immutable release pipeline must select the whole native suite again. Final documentation/checkpoint handoff is pending. Physical-device and distribution acceptance remain incomplete. The shipped client stays in `apps/mobile` until coordinated cutover. Native development/configuration/skills are active; release tooling has passed independent code review, while actual delivery remains unverified.

## Intent and chosen direction

Replace the Expo/React Native client with a **Swift and SwiftUI iPhone app**, preserving
Skipper's identity while simplifying ordinary UI around iOS conventions. There will be
no cross-platform client framework or Android target. Any future Android application
will be a completely separate implementation; do not design for shared client code.

The founder chose a **complete conversion**, rather than a prototype or isolated driving
slice. The motivation is a smaller, easier-to-understand mobile stack: preserve brand
colors, typography, Skipper's conversation, and the driving experience; use standard
iOS navigation, forms, settings, dialogs, and common controls where custom work adds
little. Swift becomes another repository language alongside the retained TypeScript
backend; client engine logic needs a Swift counterpart.

Founder requirements also include seamless upgrades for existing riders, keeping the
App Store identity and recoverable state, native Google Maps, and continuing development
through Codex or Claude Code, including an orchestrator inside Herdr. The founder allows
a newer minimum iOS version. **iOS 17 is the accepted engineering default for implementation**,
enabling SwiftUI Observation without raising the floor beyond a demonstrated need.
The founder authorized implementing this plan on 2026-09-12; the exact floor originated
as an engineering recommendation and does not require another question round.

Keep accounts, credits, saved drives, and recoverable on-device state. The backend stays
TypeScript. This is a complete client replacement; CarPlay, background GPS, and unrelated
product features remain outside the conversion.

## Native implementation

Create a **tracked Xcode project in `apps/ios`**, with application, unit-test, and UI-test
targets. The existing generated `apps/mobile/ios` directory is ignored and is not the
new project. Use Swift concurrency and Observation, with small services that tests can
replace. Avoid a custom application framework or additional state-management dependency.

| Responsibility | Implementation |
| --- | --- |
| Screens, navigation, state | SwiftUI, Observation, UIKit where required |
| Maps | Native Google Maps iOS SDK |
| HTTP and planner streaming | URLSession, Codable, native SSE parsing |
| Credentials | Security framework and Keychain |
| Location | Core Location |
| Audio and system playback controls | AVFoundation and MediaPlayer |
| Downloads and local storage | URLSession, FileManager, existing JSON/audio formats |
| Analytics and crash reporting | Native PostHog SDK |

Pin Google Maps and PostHog through Swift Package Manager. Use Apple frameworks for
everything else. Google Maps preserves compatibility with existing Google Routes
content and its [display requirements](https://developers.google.com/maps/documentation/routes/policies).
Before implementing external library/API features, consult current Context7 coverage
and official vendor documentation as required by the repository instructions.

Implement the complete existing feature surface:

- **App shell and design:** preserve brand typography, semantic day/dusk colors,
  iconography, and distinctive driving presentation. Use native navigation, sheets,
  forms, menus, and alerts. Preserve theme settings, deep links, accessibility, legal
  information, and version notices.
- **Planner:** preserve the streaming conversation, route proposals, server-selected
  preview clip, account wall, and explicit “Make this drive” action. Keep conversation
  state through sign-in. Preserve terminal-event replacement and failed-turn handling;
  do not automatically retry paid requests or persist transcripts.
- **Accounts:** preserve anonymous sessions, email OTP, password fallback/reset, profile
  changes, sign-out, and account deletion. Anonymous sessions remain distinct from accounts.
- **Library and drive detail:** preserve filtering, offline fallback, route/list views,
  stop attribution, local audio previews, seeking, deletion, and all download/start states.
- **Offline storage:** preserve shared clips, per-drive manifests, download
  progress/cancellation/retry, repair, completeness checks, and existing partial-offline
  playback behavior. Continue playing downloaded local bytes.
- **Driving:** preserve GPS filtering and route progress, speed-aware triggers, narration
  queues, music, pause/replay/completion, map following, lock-screen controls, exclusive
  audio focus, and interruption recovery. Retain foreground location, When-In-Use
  permission, and screen-awake behavior.
- **Diagnostics:** preserve admin-only simulation and trace tools, privacy-constrained
  analytics, native crash reporting, and symbol uploads.

Port only the engine behavior used by the client into Swift: GPS mapping, route snapping,
triggers, playback decisions, and client diagnostics. Keep server-only selection and
drive-building logic in TypeScript.

## Upgrade and API continuity

**Keep the public API compatible.** No new endpoints or database migrations are required
by the conversion. Swift request/response models must reproduce existing validation,
missing/null handling, fallback values, errors, and SSE semantics. Existing installed
clients continue using the same backend.

Preserve bundle ID `fm.skipper.app`, signing/access-group continuity, URL scheme,
associated domain, and App Store listing.

Implement an idempotent first-launch migration:

- **Credentials:** import the existing SecureStore cookie and session-cache keys,
  including Better Auth's chunked values. Match the installed Expo implementation's
  service lookup order and exact Keychain attributes. Write and verify the native
  credential before cleaning up known legacy keys; preserve rotated cookies before cleanup.
- **Offline sign-in:** use valid imported cached session state for existing local access.
  A locked Keychain, timeout, or unavailable network defers migration; it must not create
  a replacement anonymous identity, erase credentials, or delete downloads. Refresh and
  validate with the server when reachable.
- **Downloaded drives:** retain the existing Documents directories and relative filenames.
  Support current v5 manifests and the existing v4-to-v5 migration, preserving valid
  complete and partial downloads. There is no promised recovery for v1–v3 manifests.
- **Damaged or unknown data:** retain the original files, avoid claiming unavailable
  clips are playable, and offer repair when possible. Garbage collection remains disabled
  whenever manifest inspection is incomplete or unsafe.
- **Preferences:** migrate the existing theme, player-view, simulation, and update-notice
  preferences into native storage. Preserve the public region cache.
- **Account cleanup:** retain explicit sign-out and deletion cleanup. Migration failures
  must never invoke those destructive cleanup paths.

Do not introduce a new database or rewrite the offline format during this conversion.

### Compatibility details to carry into implementation

The planning investigation identified the following installed-client storage details.
Verify against the legacy implementation and capture fixtures before replacing it:

- SecureStore uses generic-password Keychain rows, looking up services `app:no-auth`,
  then `app:auth`, then `app`. Both the account and generic attributes are
  `Data(exactKey.utf8)`, not Swift string attributes.
- Known Better Auth storage keys are `skipper_cookie` and `skipper_session_data`.
  Chunk keys append `.0`, `.1`, and so on. The base value's marker is
  `\u0001ba-chunks:<n>` (leading U+0001); reconstruct the named chunks without
  enumerating the Keychain.
- Legacy writes use `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, with no Keychain
  synchronization. `skipper_cookie` is JSON mapping cookie names to `{value, expires}`;
  reconstruct the HTTP Cookie header from unexpired entries, never send the raw JSON.
  The literal `{}` is the signed-out sentinel for **both** credential keys.
  `skipper_session_data` is the cached get-session body, gated by `session.expiresAt`.
- Anonymous minting is one-shot per process: the session read must have settled without
  error, returned no session of either kind, and the device must be online. A preexisting
  account **or anonymous** session consumes the one-shot; same-process sign-out/deletion
  cannot mint again. Offline does not consume the attempt. An authoritative get-session
  null can permit minting; transport/non-2xx/Keychain errors mean unknown, never signed out.
- Mint one lowercase idempotency UUID per proposal **card**, retain it through the account
  wall/sign-in, and reuse it on every retry or lost acknowledgement. Use the server-returned
  canonical lowercase drive ID for local `drives/<id>` keys. An other-user collision (409)
  permits a new key; preserve existing soft-delete/recreate server behavior.
- Preferences are SecureStore keys `skipper.themeMode`, `skipper.simMode`,
  `skipper.drivePlayerView`, and `skipper.updateNudgeDismissed`, not AsyncStorage.
- Fresh cached sessions preserve offline access. Distinguish expired credentials from
  credentials temporarily unverifiable because of connectivity or Keychain access;
  never let deferred migration mint an anonymous identity or purge local state.

## Implementation and agent workflow

Development remains **Codex/Claude Code driven**, including within Herdr. Full Xcode
stays installed; its GUI need not remain open for routine editing, building, or testing.
Agents use Apple's [command-line development tools](https://developer.apple.com/documentation/xcode/xcode-command-line-tool-reference),
simulator commands, and XCTest UI automation. Signing access and physical-device
validation remain necessary.

Deliver the full conversion in this order:

1. **Capture compatibility fixtures.** Turn existing contract, engine, and storage
   scenarios into deterministic fixtures before replacing their implementations.
2. **Establish the native foundation.** Create the tracked project, native build
   configuration, design tokens, transport/auth services, storage interfaces, and
   migration coordinator.
3. **Implement the complete app.** Build account/planner/library/settings flows and
   driving/offline services under explicit ownership, with one owner for shared project
   configuration and contracts.
4. **Integrate and verify parity.** Resolve behavioral differences and complete
   independent review of authentication, migration, playback, and release compatibility.
5. **Retire the legacy client.** Once the native replacement passes acceptance, remove
   `apps/mobile`, its Expo/React Native dependencies, EAS configuration, and obsolete
   client platform scaffolding. Git retains the historical implementation.
6. **Update operating documentation.** Replace active Expo-specific development,
   simulator, verification, and release instructions with the native workflow. Update
   repository guidance, design-system guidance, shared skills, and affected document
   statuses while retaining historical release records.

Keep the existing app available throughout implementation. There is no permanent hybrid
runtime or ongoing Expo development after cutover. Retained server TypeScript packages
remain; the final client contains no React Native or Expo runtime.

## Verification and release

Keep root `bun run check` for the retained TypeScript code. Add `bun run ios:check`,
invoking the native simulator build and test suite through `xcodebuild`; require both
checks before release. Use mocked services and isolated local fixtures for automated
integration testing. The native script is implemented; a scoped test pass does not establish full conversion acceptance.

Required acceptance coverage:

- **API and planner:** DTO compatibility, fragmented SSE, cancellation, failed streams,
  account-wall continuity, and prevention of duplicate paid actions.
- **Engine parity:** identical discrete outcomes against shared fixtures, with explicit
  numeric tolerances. Cover noisy GPS, invalid speed/heading, jumps, high-speed approaches,
  duplicate prevention, route completion, queue ordering, and stalled playback.
- **Migration:** chunked credentials, locked Keychain, offline first launch, expired
  versus temporarily unverifiable sessions, interrupted migration, v4/v5 manifests,
  shared clips, partial downloads, and malformed data without destructive cleanup.
- **UI:** all user flows, day/dusk/system themes, VoiceOver, text scaling, small supported
  iPhones, permissions, and offline states.
- **Real devices:** local audio decoding, calls and other interruptions, Bluetooth
  changes, lock-screen controls, GPS behavior, and an actual driving pass. Simulator
  success alone does not satisfy driving acceptance.
- **Distribution:** signed archive, entitlements, privacy declarations, map attribution,
  crash symbols, and inspection confirming the client contains no React Native/Expo runtime.

Release the replacement through TestFlight under the existing app identity. Rehearse an
update from the shipped app with populated credentials and downloads, including first
launch without connectivity.

After acceptance, use the existing manual App Store release process. Do not raise the
backend version floor to force iOS 16 riders into an unavailable update; preserve
compatibility for their installed client. On 2026-09-12, the founder authorized autonomous
implementation and all actions necessary to complete this conversion, including its
verification and release work, without further routine approval stops. This authority
is scoped to the conversion; unrelated paid corpus/operator runs are not needed or
included. Preserve the repository's shared-work and rider-data invariants.

**Completion means:** the full native app passes parity and upgrade verification, the
legacy client is retired, and the repository's documented development and release
workflow operates through Xcode's native toolchain.

## Foundation implementation record (2026-09-12)

The tracked Xcode source lives in `apps/ios/Skipper.xcodeproj`, with synchronized app,
unit-test and UI-test groups, scheme `Skipper`, bundle `fm.skipper.app`, and iOS 17 floor.
Google Maps 11.1.0 and PostHog 3.74.0 are exact SPM pins. Root scripts `ios:configure`
and `ios:check` provide local public SDK configuration and simulator verification.
The native app foundation includes branded fonts/assets, URLSession/Codable/SSE transport,
explicit Keychain credentials, migration, SessionStore, and injectable App dependencies.
The reviewed native implementation is under final checkpoint preparation; this is not release acceptance.

QA's retained build-25 log and signed build-26 IPA establish team/prefix `L24UJYJ5DK`
and application identifier/default Keychain group `L24UJYJ5DK.fm.skipper.app`. Native
project settings now use that team, with no explicit access-group override. Archive and
installed-device readback remain required; see [verification evidence](../guides/native-ios-verification.md)
and the [native release guide](../guides/native-ios-release.md).

Corrupt credentials offer explicit manual email/password recovery while transient Keychain
failures continue to defer. Recovery writes an independent verified native record, preserving
unknown-version native data and legacy bytes in place. It never automatically mints an
anonymous session or purges downloads. When the previous identity is unknown, saved drives
remain inaccessible until a successful owner-scoped server list/detail confirms each drive
belongs to the recovered account. Ownership evidence is retained with that account's native
credentials. Explicit sign-out stops audio and purges before clearing identity; deletion
keeps the shipped server-delete-then-local-purge order, with no purge on server failure.

The current backend does not enable Better Auth email changes, and the shipped client has
no change-email flow. Native sign-in/signup, password reset, name editing and deletion use
the retained endpoints; enabling a new email-change server capability remains outside the
current no-backend-change implementation. Do not present a control that cannot succeed.

Storage transfer ownership moved from the Storage worker to Generalist for final concurrency
corrections. Every transfer, including drive-local audio, uses a unique staging file and a
registered consumer lifetime. Explicitly canceling a drive cancels its unused inner URLSession
task; another drive can retain its shared transfer. Canceling a screen's awaiting task affects
only that waiter: downloads and top-ups outlive screens until explicit Cancel or purge. Run identities guard retry cleanup and progress,
and a purge epoch prevents late callbacks from committing old-account bytes. GC waits for
both full downloads and top-ups to finish manifest commits. Focused tests use real native wire
models and deterministic registry/IO barriers; combined simulator and device acceptance remain
separate checks. The App now consumes the playback heard edge through the closed analytics
contract and retains the version-policy controller for the launch. Required updates replace
normal navigation and dismiss driving. Recommendations overlay the retained app subtree,
wait beneath active sheets/driving covers, and do not stop audio or discard a planner card.

Native prerequisite cutover is prepared without deleting the Expo workspace: native-only
configuration reads ignored `.scratch/ios/client-config.json` or explicit `SKIPPER_*`
environment settings, useful SVG masters and a native asset generator are retained, and
active agent/build/QA skills use Xcode. Root workspaces and backend `@better-auth/expo`
remain unchanged. Simulator QA defaults to ad-hoc signing; unsigned builds do not prove
SystemKeychain access. The version-policy request runs concurrently with session startup
after preference migration, so a slow policy response cannot delay account/library readiness.

The coordinator reports seven actual simulator upgrade rehearsal cases passed, including
chunked SecureStore import, retained preferences/cache/download bytes and interrupted-write
recovery. The [QA-owned rehearsal record](../guides/native-ios-upgrade-rehearsal.md) owns exact
observations and limits; this does not establish distribution access groups or real-device
acceptance. Final UI and release evidence remain separate gates.

Library ownership has transferred from the workhorse to Generalist. Refreshes keep rows,
region facets, selection, and credits coherent; cancellation leaves the snapshot unchanged
and failed online refreshes remain visible with a retry. Confirmed offline with no playable
verified local files has its own empty state, without claiming the cloud library is empty. MainTab retains the Library model and routes
successful detail deletion to its local removal method. Responses already in flight cannot
restore a just-deleted row; account changes clear the retained snapshot and reject old-account
responses. Networking preserves server-authored and update/offline guidance as user-facing
errors. Actual app-target tests initially passed Library 8/8, Networking 12/12, and delayed startup 1/1.
The later Library 9/9 plus DEBUG transport 3/3 run verifies a playable partial download uses
its offline banner/list without a redundant refresh error; 401/403/500, contract and unknown
transport failures retain their guidance. No Library layout change was needed.
Two hosted late-nudge tests then passed with retained planner/card state and a running native
playback controller backed by injected audio; this is lifecycle proof, not real-device audio QA.

The root script test command uses an explicit `./scripts/` directory. Bun's filename-filter
form produced empty subprocess output in real release fixtures; the explicit directory
preserves all suites and their assertions. Generalist's root check after the landmark registry
addition passed 279 script tests across seven suites; this is separate from native UI and
release acceptance.

A QA crash established a separate initialization defect: UI-test launches skipped Maps SDK
registration while mounting the production renderer. Valid fixture launches now initialize
Maps alone before views; PostHog, credentials and app API calls remain isolated. Unit/rejected
launches skip Maps, and the map owner's production guard avoids GMS construction unless key
registration succeeded. Subsequent simulator UI execution confirms the initialization crash
is resolved; full UI, device and distribution acceptance remain separate gates.

## Accepted simulator evidence and checkpoint boundary

The coordinator accepted Fable's review of Proposal containment, Detail title/header,
Library offline error gating and the DEBUG cancellation barrier: no HIGH/MEDIUM findings.
These accepted results retain their original source/build authority:

- Playback's canonical Detail UI tests passed 2/2 across three account-retry/lost-ack Day/Dusk
  runs. Each actual receipt recorded two attempts, one stable key and one commit, with no
  pre-sign-in create, anonymous mint, purge or unexpected request.
- QA's deterministic reset passed 1/1: barrier reached, one actual stream cancellation,
  zero terminal deliveries, and zero proposal/create/mint/unexpected requests.
- QA's later recommended-update test passed 1/1, preserving the same proposal and draft with
  one plan, one proposal and zero create/unexpected requests. Earlier 4/4 evidence does not
  cover this test's subsequently added readiness wait.
- Corrected SE AX5 scrolling passed 1/1 across Day/Dusk on the preserved 16:19 source. Six
  inspected screenshots showed the readable 1-of-2 badge, reachable row, full Detail missing-
  audio explanation, and visible/enabled/hittable Start. Start was not tapped; this is not
  playback evidence. The original failure was the gesture origin, not proven Library clipping.

FinalCheckpoint's 213 matching before/after input hashes remain a historical snapshot.
GeneralistFinalReplacement captures the reviewed replacement with 215 native/fixture inputs
and unchanged source/configuration/product hashes. QA subsequently executed all 333 tests
(315 unit, 18 UI), all passed with zero skipped; its matching SE AX5 subset passed 3/3.
The [verification guide](../guides/native-ios-verification.md) preserves the exact source,
artifacts, screenshots and historical failures.

Later receipt audits found two DEBUG evidence gaps, not supported production failures.
The real GET /version counter now persists compatibly with older mock state; helper tests
passed 6/6 and all four version UI cases passed with exact request counts 1/2/1/1. The two
create fixtures now supply valid audio metadata and a tiny generated silent AAC asset. A
DEBUG downloader restricted to those validated runs and one exact synthetic URL writes only
Storage staging bytes; the real Storage actor commits the canonical manifest and referenced
audio. Its helper tests passed 3/3. Strengthened account-retry/lost-ack UI passed 2/2 across
three runs, with filesystem/timestamp audits proving exact manifest/audio bytes before
relaunch and identical bytes afterward; financial receipts have zero mismatches. The asset
was verified inside the matching Debug app bundle. Independent reviews cleared these deltas
without HIGH/MEDIUM findings. Release fixture exclusion still requires archive inspection.

The completed 333-test snapshot remains historical to these bounded, focused-tested changes.
The final immutable release pipeline must execute the complete suite from its accepted SHA;
focused follow-ups are not relabeled as a second full run. QA's guide and retained-receipt
audits are complete, including the independent pre-sign-in counter audit and negative controls.
After that freeze, the Detail subtitle received one authorized copy-only correction from
“1 stops” to “1 stop” for one clip, retaining the plural otherwise. Historical screenshots
remain before-copy evidence; no new simulator run is claimed for that expression change.
The final root check and checkpoint handoff follow this documentation reconciliation.

Maps ownership transferred from Workhorse to Playback for the final corrections. Astra
cleared deferred fitting versus driving follow, diagnostic isolation/privacy, stale readiness
after route changes, and initial positioning of replacement geometry after a pan. A fresh
renderer may take one initial overview before a manual camera exists without resuming rider
follow; real pans retain priority. Diagnostics are restricted to the validated fixture run
directory, and generation-scoped readiness invalidates prior-route evidence.

On the reviewed `bcfce382` Map revision, actual lifecycle tests passed 9/9 and the unchanged
known-land UI test passed 1/1 across Day/Dusk. Playback inspected recognizable Golden Gate Park
tiles, visible route and Google attribution; receipts recorded a nonzero viewport, four route
points, fit true, snapshot/tile completion, and one plan/proposal with zero create/mint/purge/
unexpected requests. QA corrected the new fixture to longitude/latitude wire order; the five
earlier financial/reset/recovery cases remain unchanged. Their offshore 0,0 geometry never
established tile failure. The earlier `1e53d517` candidate and its results remain historical.
These are accepted focused results, not physical-device or distribution proof.

## Retained Linux CI boundary

A read-only repository audit found no retained Cloud Build job invoking root `bun run check`
or `test:scripts`, and no tracked GitHub Actions workflow. The API/admin/studio pipelines
invoke Docker builds through [cloudbuild.yaml](../../cloudbuild.yaml),
[cloudbuild.admin.yaml](../../cloudbuild.admin.yaml), and
[cloudbuild.studio.yaml](../../cloudbuild.studio.yaml). Their Dockerfiles install the relevant
workspace closure; Admin additionally runs its SPA build. The site pipeline runs
`bun install --frozen-lockfile && bun --filter @skipper/site build` in
[cloudbuild.site.yaml](../../cloudbuild.site.yaml). These paths do not run native release tests.

The new root script suite is not fully Linux-portable: the real `xcrun clang`/`dsymutil`/`lipo`
test in `scripts/test/ios-symbols-eas.test.ts` has a Darwin-only guard, but real plist encoding
and inspection in `scripts/test/ios-release.test.ts` invoke `plutil` without a platform guard.
Thus no current pipeline invocation mismatch was found, but running the full root check on
ordinary Linux would need a separate portability change. This audit changed no CI command or
assertion and ran no Linux build or live trigger inspection. Native release remains Mac-only.

## Resume and orchestration continuity

On 2026-09-12, the founder explicitly requested a goal to implement this complete plan
autonomously while away for several hours, authorized all necessary actions, and directed
the coordinator to continue without routine approval stops. An active implementation
goal has been created. The implementation, full simulator snapshot, focused follow-ups and
seven-case simulator upgrade rehearsal have succeeded. Final checkpoint documentation/checks,
physical-device acceptance and actual release delivery remain unfinished.

The managed Herdr agents have launched in separate tabs, with the selected model
and effort visible. Generalist, Workhorse, and iOS QA have completed onboarding; Fable
is performing independent review. Full Xcode/toolchain access is available to the agents;
report actual device or signing constraints encountered during verification rather than
assuming a blocker or treating simulator success as real-device proof.

| Role | Model and effort | Responsibility |
| --- | --- | --- |
| Generalist | Astra, high (founder allowed medium/high; coordinator selected high) | iOS architecture, App/Auth integration, final Storage concurrency, and Library state/view ownership |
| Reviewer | Claude Fable 5.1, xhigh (specific to this review role) | Independent correctness review |
| Workhorse | Gemini Flash 3.8, high | Implementation workhorse |
| iOS QA / build verification | Astra, high | Fixtures, simulator, upgrade, device, and build verification |
| Storage | Gemini Flash 3.8, high | Initial offline core implemented; source and tests handed to Generalist for final corrections |
| Playback / location / Maps | Astra, high | Native audio, location, driving surface, detail/navigation, final Maps corrections, and matching tests |
| Settings / release corrections | Internal `save_session_records`; model/effort not independently visible here | Settings and matching tests; transferred release code, tests, and guide for final blocker corrections |
| Release research | Gemini Flash 3.8, high | Read-only EAS symbol-only job research using the existing secret configuration; no cloud execution |
| Upgrade QA | Codex Astra, high (coordinator-reported) | Dedicated simulator; actual legacy SecureStore and Downloads replacement rehearsal; owns `.scratch/ios-upgrade/**` and the new upgrade rehearsal guide |

Upgrade QA reports seven passed actual in-place simulator replacement cases using legacy
SecureStore records and download files with native SystemKeychainStore and Documents access,
separate from DEBUG fixture persistence. Its [evidence record](../guides/native-ios-upgrade-rehearsal.md)
owns source receipts and limits; simulator success does not establish distribution Keychain
access or real-device behavior. Scratch instrumentation leaves production ownership unchanged.
The canonical production API origin `https://api.skipper.fm` was independently confirmed;
ignored Release configuration is prepared, while QA continues signing and ASC verification.

The coordinator reports Settings compilation and root checks complete. Its internal owner,
`save_session_records`, now also owns the former Release worker's scripts, export options,
ASC helper, tests, and release guide. Those release corrections passed independent code
review: immutable source/configuration/export inputs, signed entitlements and the default
Keychain group, ASC completeness, Mach-O inspection and PostHog host handling. Actual signed
archive/export, cloud symbol upload/readback and Apple delivery remain unverified. Generalist retains
root package/lockfile, native configuration helpers, and Xcode project ownership. These
handoffs do not authorize an integration commit or establish release acceptance.

The founder reports unlimited tokens for the workhorse model; this is user-reported
resource context, separate from the conversion authorization above. The coordinator has
full authority to add useful agents or retire existing ones, preserving ownership and
unfinished work. Internal subagents are permitted alongside managed long-running Herdr
agents. For this Skipper roster, use **separate Herdr tabs**, not split panes, and keep
the Orchestrator tab focused during coordination. Keep project execution delegated when
acting as the selected orchestrator; ordinary task-agent defaults are explained in
[the delegation guide](../guides/agent-delegation.md).

**Next action:** run the final root check against the frozen candidate and inspect final drift.
After accepted docs/checks and the coordinator's concrete checkpoint
go, commit the adopted conversion paths atomically; preserve the legacy client for the later
retirement step. Physical-device and actual distribution verification remain separate.
On a new session, discover current Herdr agents
and bounded recent reports before assigning work; do not assume prior live identities
or pane labels remain valid. Continue the active authorized goal without repeating
routine approval questions. The permanent agents own subsequent implementation records.
