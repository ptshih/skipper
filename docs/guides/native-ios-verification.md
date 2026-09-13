# Native iOS verification

**Status**: TESTFLIGHT DELIVERED / PHYSICAL VERIFICATION PENDING 2026-09-12. The `977cd1c5` full release passed root checks (309), 339/339 native tests, archive/manual export/inspection, signed fixture exclusion, in-process EAS symbols upload/readback, Apple validation, and upload (delivery UUID `7acfc478-b11c-4dfc-ba4b-fe3d176891db`). App Store Connect processed build 1.2.0 (27) as `VALID` and `IN_BETA_TESTING` (TestFlight internal testing available). The original pipeline script exited 1 solely due to the local delivery UUID parser on JSON output; original failed record is preserved while GeminiRelease generates a separate reconciliation receipt with fresh ASC. Earlier 333/SE/focused results, the `f1ee2eb3` 338/339 failure, and the `843d8d6c` readiness correction retain their exact source authority. A prior old-source symbols diagnostic passed, distinct from new-source delivery. Physical preparation failed because the phone was locked (`kAMDMobileImageMounterDeviceLocked`); external unlock request is pending and no physical app or road-test operation is established. See the [conversion plan](../designs/native-ios-conversion.md).

## Recorded simulator evidence

### Immutable pipeline: `9f6bc3d3` and delivered `977cd1c5`

`.scratch/releases/native-delivery-9f6bc3d3-01/` retains source-bound native evidence:
339 passed, zero failed/skipped (321 unit, 18 UI). Its `failure-handoff.json`, `inspection.json`
and `archive-debug-exclusion.json` also establish successful archive/manual export, valid native
inspection and no fixture directory/AAC in the signed archive. Root checks passed 293 tests.
The remote EAS symbols stage failed before Apple; that failure remains preserved and unresolved.
The later one-attempt symbols-only diagnostic proved exact older-artifact UUID/bytes/hash
readback and fresh authenticated EAS artifact verification, without Apple or new-source acceptance.

Current immutable source `977cd1c5b0fb1f73ec79f04e56fe29f3e8225de7` has a completed full run
at `.scratch/releases/native-delivery-977cd1c5-01/`: root check (309 tests), native check (339/339),
archive, manual export, native inspection, fixture debug exclusion, in-process EAS symbols upload and
readback (PostHog UUID `48B46270-1CF1-3060-827D-1909354B1562`), Apple validation, and upload (delivery
UUID `7acfc478-b11c-4dfc-ba4b-fe3d176891db`) all succeeded. App Store Connect processed build 1.2.0 (27)
as `VALID` and `IN_BETA_TESTING`. The original pipeline script exited 1 solely on local delivery UUID parsing
against JSON output; that execution record is preserved. Historical 333/focused/SE evidence and the readiness
failure/correction below remain intact.

Physical-phone network reachability did not establish developer readiness: the one bounded
DDI preparation attempt failed because the device was locked (`kAMDMobileImageMounterDeviceLocked`).
The retained record is `.scratch/ios-qa/ddi-preparation-attempt-20260912-1922/REPORT.md`. External unlock
is pending; no app operation, physical upgrade or actual driving proof follows from this attempt.

### Signed-out Library transition, neutral empty state, and deep-link race guard verification (2026-09-12)

A transient error flash occurred when navigating from Planner to My Drives while signed out:
`LibraryViewModel.loadDrives()` unconditionally issued `listDrives()`, throwing 401 and populating
`errorMessage` before the account gate settled. The corrected architecture replaces the inline gate
with a clarified neutral empty Library page and immediately presents the existing sign-in modal
(`account.sign-in`). Dismissing the modal leaves the stable empty drives page (`library.empty`) with zero
error flash and no reopen loop. Selecting My Drives again after switching to another tab offers sign-in again.

Implementation and verification details:
- **Model guard:** `LibraryViewModel.loadDrives()` guards against `!session.isSignedIn`, resetting
  `drives = []`, `rawSummaries = []`, `credits = nil`, `errorMessage = nil`, and `isOfflineFallback = false`
  with zero network requests. Signed-in cancelled-refresh prior-error preservation remains intact.
- **Deep-link race guard:** `AccountEntryPolicy.shouldPresentSignInOnTabChange(..., hasPendingDriveId:)`
  skips tab-driven auth presentation when `hasPendingDriveId: true` (e.g. shared-drive deep links opening
  Library with `activeDriveId`), preventing a sheet presentation race against `DriveDetailView` and
  preserving detail's own account wall.
- **Prior contaminated run boundary:** An earlier UI test run on simulator `45E44967` was contaminated
  by concurrent runner execution from the Release lane; that task (PID 20163) was terminated and its
  captures are explicitly unaccepted.
- **Fresh accepted UI evidence:** A clean rerun of `SkipperUITests/OfflineSmokeTests` passed **5/5**
  (63.49s, xcresult `.scratch/ios/LibraryFixDD/Logs/Test/Test-Skipper-2026.09.12_22-27-22--0700.xcresult`).
  Inspected attachments confirm:
  1. `01_signed_out_library_auth_sheet.png`: cold Library launch presents auth modal immediately over
     neutral empty state with zero error screen.
  2. `02_signed_out_library_dismissed_neutral.png`: Cancel dismisses modal, leaving stable empty library
     without error flash or reopen loop.
  3. `03_signed_out_library_reopened_auth_sheet.png`: Plan tab switch and back to My Drives cleanly re-presents
     the auth modal.
- **Unit test evidence:** `DeferredNavigationTests` (9/9) and `LibraryFilterTests` (10/10) passed (**19/19**,
  xcresult `.scratch/ios/LibraryFixDD/Logs/Test/Test-Skipper-2026.09.12_22-26-59--0700.xcresult`).
- **Target and limits:** This fix forms part of the ongoing stability 9/10 target. Storage completed concurrent
  Detail + Settings focused acceptance at **36/36 passed** (20 `DriveDetailStateTests`, 8 `SessionStoreTests`,
  8 `SettingsPasswordStateTests`, zero failures/skips; exact xcresult
  `.scratch/ios-drivedetail/DerivedData/Logs/Test/Test-Skipper-2026.09.12_22-33-28--0700.xcresult`), with judge final
  review pending. Physical device verification remains blocked by the locked phone (`kAMDMobileImageMounterDeviceLocked`),
  unlock request pending, with judge/physical limits strictly maintained. No current app TestFlight update is claimed
  (delivered build remains 1.2.0 (27) / `977cd1c5`).
- **Next QA items:**
  1. Residual deep-link arrival while the tab auth modal is already open.
  2. Explicit anonymous runtime UI scenario coverage across theme variants.


### Two-stop simulated driving QA cycle and playback verification (2026-09-13)

A simulated driving UI verification flow exercises the complete two-stop playback lifecycle under process-isolated `skipper.simMode = "1"`:
- **Scenario and setup:** Registered DEBUG scenario `.drivingQATwoStops` (`driving-qa-two-stops`) in `FixtureApp.swift` seeds migration manifest `v5-driving-qa-two-stops` with two stops along a calibrated 720.5m route (Civic Center / Van Ness, SF). Seeds real bundle `drive_loop.mp3` (~55s) to Stop 1 and contract AAC (`create-continuity.m4a`, 250ms) to Stop 0. Injected `NativeNarrationPlayer` drives actual AVPlayer audio decoding and lifecycle.
- **Cycle coverage:** Full automated flow in `OfflineSmokeTests.testSimulatedTwoStopDrivingCycle`:
  1. Offline Library card selection (`Two-Stop Simulated QA Drive`).
  2. Drive detail presentation and `Start Drive` trigger.
  3. Departure gate presentation and `Simulate drive` action.
  4. Real-time driving screen: initial `0 / 2 stops` counter and `SIMULATION` badge asserted stably.
  5. Stop 0 triggers and completes (250ms), advancing counter to `1 / 2 stops`.
  6. Stop 1 triggers (~55s audio), entering `NOW PLAYING`.
  7. Transport controls exercised: Pause verified (`PAUSED`), Resume verified (`NOW PLAYING`), forward 15s seek x3 verified hittable and executed.
  8. Stop 1 completion and route finish verified with completion wrap banner and summary (`That's a wrap, road crew.`, `2 stops heard. Thanks for riding along.`).
  9. `Ride again` tapped: counter cleanly resets to `0 / 2 stops` and simulation re-arms.
- **Focused UI test evidence:** Focused test executed on simulator `69401A43-2D6D-4155-BD4F-E688777CB43A` (`UI_TEST_EXIT_CODE=0`, 49.688s, 0 failures, 0 unexpected; xcresult `.scratch/ios/DrivingQA/Test-DrivingQA-Calibrated.xcresult`). All 8 inspected screenshots confirm clean visual presentation with zero clipping or overlapping controls (expected trailing ellipsis on long status line).
- **Media readback:** Seeded files read back from container `E8FAFA56-CCB5-4064-83EB-983A06B897C1` matched source fixture AAC (`7c31c2b7...`) and bundle MP3 (`934c0ae2...`) byte-for-byte.
- **Preserved failure boundaries:** Retained investigative records in `.scratch/ios/DrivingQA/` preserve earlier candidate failure boundaries (initial Plan tab default before explicit initial tab injection, and initial route vertex trigger timing before geometric calibration to 1x vehicle simulation speed).
- **Target and limits:** Prior full native suite (349 tests) and TestFlight delivery (1.2.0 (27) / `977cd1c5`) remain historical; no new full-suite count is recorded for this focused addition. Physical device verification remains blocked pending device unlock (`kAMDMobileImageMounterDeviceLocked`).


### Library offline-to-online connectivity reconnect parity and fallback verification (2026-09-13)

Shipped React Native client self-healed on an offline-to-online transition, whereas native Library previously remained on a stale "You are offline" state until manual pull-to-refresh or tab reentry. This fix establishes parity:
- **Reconnect edge detection:** Injected `NetworkAvailability` observation into `LibraryViewModel`. On a visible offline-to-online transition (`wasOffline && !isOffline`), triggers an automatic single reload (`loadDrives()`). Direct `tickConnectivity(isOffline:)` seam provides zero-latency deterministic unit testing without wall-clock polling.
- **First-tick launch race prevention:** `seedConnectivityState()` seeds `wasOffline = (await network.isOffline()) || (isOfflineFallback && errorMessage == nil)`. This ensures an initial online entry or 5xx server error starts with `wasOffline == false`, preventing spurious duplicate reloads, while an initial confirmed offline fallback correctly seeds `wasOffline == true` to re-arm the edge.
- **Sequential task coordination:** In `LibraryView`, `observeConnectivity()` is appended directly after `loadDrives()` inside `.task(id: viewModel.session.user?.id)`, eliminating any uncoordinated second `.task` race and guaranteeing the initial load completes before observation begins. The keyed task automatically cancels observation on user/owner switch.
- **Offline fallback & saved download reachability:** Maintained `if !verifiedDisplays.isEmpty || error is OfflineError` fallback condition in `LibraryViewModel`. If network errors occur (timeout, 5xx, or offline) while saved downloads exist on disk, verified local rows are presented, `isOfflineFallback = true`, and actual error messages remain visible. If non-offline errors occur with zero saved downloads, cached online rows/facets/selection are preserved and `isOfflineFallback = false`.
- **Evidence and test coverage (headless simulator `69401A43-2D6D-4155-BD4F-E688777CB43A`):**
  - Focused `LibraryFilterTests` (17/17 passed, 0 failures; xcresult `.scratch/ios/Test-lib-filter-1789284245.xcresult`).
  - Unit tests verify:
    1. Exact 1 edge reload on offline-to-online edge (`testConnectivityEdgeTriggersExactOneReloadAndClearsFallback`).
    2. Zero requests on steady online or steady offline ticks (`testConnectivityStableStatesMakeZeroRequests`).
    3. Zero requests on edge for signed-out, anonymous, and deferred sessions (`testConnectivityEdgeInSignedOutAnonymousDeferredMakesZeroRequests`).
    4. In-flight load blocks duplicate edge launch and commits cleanly (`testConnectivityHeldInFlightNoExtraAndResultCommits`).
    5. Non-offline reconnect failure preserves rows/facets/selection, sets `isOfflineFallback = false`, and surfaces actual error (`testConnectivityReconnectFailureNonOfflinePreservesRowsFacetsSelectionAndSurfacesActualError`).
    6. Owner switch discards stale in-flight response (`testConnectivityOwnerSwitchDiscardsStaleResult`).
    7. Cold load failure with saved downloads shows local row, sets `isOfflineFallback = true`, and surfaces error (`testColdLoadFailureWithSavedDownloadsShowsLocalRowFallbackTrueAndErrorVisible`).
- **Preserved failure boundary:** Retained `.scratch/ios/Test-lib-filter-1789283775.xcresult` preserves initial test diagnostic where custom error type fell back to generic message before using production `APIError`.



### Settings account lifecycle, purge readback, and GPS cue latch verification (2026-09-13)

A process-isolated Settings account lifecycle test suite exercises both authenticated user departure flows under debug scenario `.settingsAccountLifecycle` (`settings-account-lifecycle`): Run AB (password collision 409, reset request, and explicit sign-out) and Run C (deletion confirmation code issuance, verification, and permanent account deletion). Both flows assert complete local data purge, stable retention of the neutral Settings screen, and headless relaunch as an online guest session without modal lockouts.

- **Interaction and AutoFill handling:**
  - Password entry exercises `.textContentType(.newPassword)` validation: entering `< 8` characters keeps the submission action disabled; appending to `>= 8` characters enables it via settled predicate.
  - On platforms presenting the system AutoFill "Use Strong Password?" sheet in a secondary window (`GenerateStrongPasswordButton` / `Fill Strong Password`), the test safely detects the overlay, captures screenshot/hierarchy evidence, scopes the `Close` dismissal to the containing window (avoiding global cross-mark interference), and awaits software keyboard presentation before typing.
  - Delete account flow confirms the 6-digit verification code input sheet, validates deletion request delivery, and asserts immediate dismissal to the stable neutral Settings view (`account.sign-in` visible, `auth.email` absent, Settings navigation bar present, Settings tab selected).
- **External host watcher settlement & keychain readback:**
  - Dedicated external watcher (`verify-account-lifecycle.sh`) observes isolated simulator runs, excluding stale historical run UUIDs.
  - Executable verification (`verify-account-lifecycle.sh --report`) evaluates **34/34 assertions across both runs**:
    - Exact endpoint counters: Run AB records `passwordRequests == 1`, `passwordResetRequests == 1`, `signOutRequests == 1`, `purgeCalls == 1`, `unexpectedRequests == 0`; Run C records `deleteCodeSendRequests == 1`, `deleteCodeVerifyRequests == 1`, `deleteAccountRequests == 1`, `purgeCalls == 1`, `unexpectedRequests == 0`.
    - Host filesystem purge check verifies that all local drive directories are completely erased (`driveCount == 0`).
    - Fixture-isolated keychain store (`FileKeychainStore`) proves explicit signed-out state (`explicitlySignedOut == true`, null active session) prior to relaunch, followed by automatic anonymous guest mint (`mintRequests == 1`, `anonymousMinted == true`, guest active session) upon same-run relaunch.
- **Accepted UI test evidence (Run 04):**
  - Executed on headless simulator `69401A43-2D6D-4155-BD4F-E688777CB43A` (`AccountLifecycleTests`, 62.15s, 0 failures, 0 unexpected; xcresult `.scratch/ios/AccountLifecycleQA/results_account_lifecycle_revised_04.xcresult`).
  - Attachments with `.keepAlways` lifetime preserve screenshots and full accessibility hierarchy snapshots at each lifecycle transition.
- **Prior failed run boundary & overwritten bundle record:**
  - Initial Run 01 (`results.xcresult`) passed 29 unit tests but failed UI password entry; its original bundle was overwritten by an immediate rerun. Retained task logs (`task-2586.log`, `task-2624.log`) and receipt backups (`receipts_backup_01`) preserve the original diagnostic evidence.
  - Run 02 (`results_account_lifecycle_revised_02.xcresult`) passed Run C but failed on direct character count comparison against SwiftUI `SecureField`.
  - Run 03 (`results_account_lifecycle_revised_03.xcresult`) uncovered the secondary AutoFill window presence blocking direct software keyboard presentation. All three prior result bundles and receipt directories (`receipts_backup_01/`, `receipts_backup_02/`, `receipts_backup_03/`) are permanently retained.
- **Combined scoped GPS and Playback unit acceptance:**
  - Scoped native build incorporates Release GPS latch (`DrivePlaybackController.swift`, SHA `b50f4b4f...`) and 29 unit tests (**29/29 passed**): 7 `DriveLocationLifecycleTests` (SHA `d4362f10...`) and 22 `PlaybackLifecycleTests` validating location cue playback coordination.
- **Target and limits:**
  - This verification is strictly scoped to `AccountLifecycleTests`, `DriveLocationLifecycleTests`, and `PlaybackLifecycleTests`; it is not a full new native test suite run.
  - Physical device gaps remain open: real road GPS reception, audio focus interruption, incoming phone calls/Siri, Bluetooth handoff, Lock Screen Now Playing, background execution, VoiceOver accessibility, and hardware Secure Enclave keychain persistence. Physical device testing remains blocked pending hardware unlock (`kAMDMobileImageMounterDeviceLocked`).



### Exact-source delivery failure: forced-wall readiness

The `f1ee2eb3` release preflight ran **338/339** tests (321/321 unit, 17/18 UI), zero
skipped. `VersionPolicyPresentationTests` observed the required-update title at 13.64 seconds
then immediately failed Update hittability at 13.65 seconds. The original result remains
`.scratch/releases/native-delivery-f1ee2eb3-01/native-test-results/Test-1789263619390.xcresult`;
no archive or cloud action followed. Its later video frame shows the unobscured wall, but
that image alone does not prove eventual hittability.

`.scratch/ios-qa/release-force-f1ee2eb3/` retains the failed installed app/fixture evidence,
source comparisons and bounded scratch trace. Relevant code/fixtures match the earlier
`d22363e0` full 339/339 and counter 4/4 candidates. The exact-source, exact-configuration
three-run diagnostic finished **1 passed, 2 failed**: one deliberately retained immediate
Update failure and one trace-only error querying the outgoing email field during dismissal.
In the reproduced failure, actual Update hittability was false initially, then true in the
next sample (began 63 ms, completed 111 ms after title observation); email was absent and
readiness persisted through three seconds (confirmed hittable within 111 ms, not exactly at
the sample start). All three receipts contain one version request
and zero unexpected calls. Diagnostic failures are preserved, not counted as acceptance.

The authorized test-only correction waits at most five seconds for actual Update
`isHittable == true`, then retains the explicit assertion and every title, sign-in, absent
Later, blocked-action/tab and swipe-resistance check. No product/fixture change or fixed sleep.
The fresh focused run passed **4/4**, zero failures/skips, in
`.scratch/ios-qa/release-force-f1ee2eb3/acceptance/VersionUI.xcresult`. Frozen receipts match
force/recommended/delayed-force/delayed-planner request counts **1/2/1/1**, with zero
unexpected/create/mint/purge calls. Four inspected final screenshots show exclusive force
walls, preserved planner draft/card after Later, and dismissal retained across relaunch.
All 1,130 product hashes remained unchanged; root check passed 287 tests. Test SHA256 is
`8d787d363e09522cb5d1a8318b2bce23b61003950e8458109cbfd2e5abe294da`.
This focused correction does not convert the original failed release preflight into a pass
or replace exact-source full release acceptance.


### Reviewed replacement snapshot: full runtime, SE, and counter follow-up

`.scratch/ios-qa/combined-20260912-171409/` retains the matching source/build receipt,
333-test discovery, `CombinedRuntime.xcresult`, raw receipts, screenshots and
`runtime-report.md`. Actual test execution passed **315/315 unit + 18/18 UI**, zero skipped.
All 1,127 frozen product hashes remained unchanged after the full run and SE subset.
Reviewed Map source is `bcfce382…`, lifecycle tests `2c5943b7…`; the then-current fixture
was `85c04cad…`. Day/Dusk inspected images show Golden Gate Park detail, the route and
Google attribution, with 338×180 viewport, four projected points and snapshot receipts.
Reset records barrier reached, one cancellation, zero terminal deliveries/proposal/create.
Late Later dismissal retains the card and unsent draft. Canonical create titles were visible.

The 24-run receipt audit retains **seven mismatches**, separate from XCTest success:
four absent version-request counters and three absent canonical directories. The latter
were confirmed by fresh filesystem reads, not only HTTP-time snapshots. Independent review
classified missing downloadable metadata plus the rejecting fixture downloader as a fixture
coverage gap; this did not demonstrate a product persistence failure. Raw failures remain.

The same products passed **SE AX5 3/3** (`SEAccessibility.xcresult`), five scenario runs,
zero receipt mismatches. Six inspected Day/Dusk images show readable partial counts,
reachable drive rows, complete missing-audio summaries after scrolling, and enabled Start.
Transient/recovery notices, titles and tabs are separated. Start was not tapped; the static
count badge is not independently tappable or a VoiceOver proof. Transient Library prose
below the viewport was not fully scrolled in this subset. Text size was restored to `large`.

`.scratch/ios-qa/version-counter-20260912-172726/` is a separate frozen DEBUG-only
instrumentation follow-up: **4/4 unchanged version UI tests**, exact request counts
force/recommended/delayed-force/delayed-planner = **1/2/1/1**, zero receipt mismatches.
All 1,127 product hashes remained unchanged. Inspected images show exclusive forced walls,
Later still dismissed after same-run relaunch, and the retained planner card/draft. This
closes the counter evidence gap on that source; it does not overwrite older missing fields.

The authorized create fixture now supplies tiny generated silent AAC through the exact
allowlisted URL documented in `fixtures/native-ios/contracts/audio/README.md`. Financial
assertions are unchanged. `expected.persistence` requires the same canonical server ID,
committed v5 manifest and referenced exact nonempty bytes after commit and same-run relaunch.
UI awaits enabled Start; the runner independently reads files at both stages. HTTP-time
`localDriveDirectoryIds` remains a raw observation, not a substitute for settled readback.
No directories/manifests may be seeded to satisfy this assertion. The matching follow-up in
`.scratch/ios-qa/create-persistence-20260912-174051/` passed **2/2 UI tests, three runs**
(retry Day, lost-ack Day/Dusk), all three financial receipt audits and all three independent
commit/relaunch filesystem audits. Before/after copied v5 manifests and referenced 798-byte
AAC files match exactly; timestamp correlation proves the first read preceded the pre-relaunch
screenshot and the fresh read followed relaunch. All 1,130 frozen product hashes remained
unchanged. Six inspected screenshots show Saved offline/enabled Start then the fresh planner
on same-run relaunch. Start/Preview were not tapped. These preserved screenshots show the
minor one-stop subtitle “1 stops”; a subsequent authorized copy-only correction uses “1 stop”
for one clip and “stops” otherwise. No assertion was relaxed or simulator run repeated for
that string change; the immutable release pipeline will compile/test its final source.
Release archive exclusion and physical driving remain
separate gates.


### Checkpoint at 16:39:50 PDT: cancellation and late nudge

`.scratch/ios-qa/checkpoint-20260912-163950/` preserves GeneralistFinalCheckpoint's 213
matching source/resource inputs and 1,127 product hashes. Two actual focused UI cases pass
in separate results: `FocusedRuntime.xcresult` runs the late recommended nudge, and
`ResetRuntime.xcresult` runs reset. The first invocation used an incorrect reset selector
and discovered zero reset cases; that output remains, and only the subsequent actual reset
execution counts. No unit suite was repeated.

The reset receipt now proves `planStreamBarrierReached=true`, one cancellation, zero
terminal deliveries, and zero proposal/create/mint/unexpected requests. The nudge receipt
shows one plan, one proposal and zero creates. Inspected before/after images
`nudge-attachments/80777975-093C-4273-98EC-D9F2F4AA3B8F.png` and
`55A3DD8F-C9AC-453F-82CD-E8CFCB3EBF37.png` show the same proposal and unsent “Keep this draft”
across Later. A route line is now visible over the offshore fixture's water; this is not
recognizable land-tile evidence. The separate `planner-map-landmark` fixture, callback-derived
readiness and inspected render receipt are required for that check.

The first landmark fixture accidentally encoded its proposal and manifest polylines as
`[latitude, longitude]`. Production `Coordinate` decodes `[longitude, latitude]`, so the
fixture produced an invalid latitude. The reported Europe/loading frame is not evidence of
a missing SDK callback. Only the new landmark case was corrected; all five preceding cases
retain their values. `.scratch/ios-qa/landmark-coordinate-order/` preserves the bad fixture,
its failing contract test and correction hashes. New Swift production-decoder and shared-schema
assertions require endpoint agreement, Golden Gate Park bounds and nonzero route spans.
Map rendering acceptance still requires a fresh frozen build and actual inspected output.

The first isolated corrected-gesture SE run, `.scratch/ios-qa/se-gesture-20260912-1636/`,
uses unchanged 16:19 production source. It reaches a readable partial count and opens Detail;
`attachments/BE4C69D4-605F-4FA5-828B-4C3EC373F891.png` shows “Downloaded (1 of 2)”. It then
fails because fixed-distance gestures overshoot the missing-audio paragraph. The next owned
helper aligns to the observed target frame. The old Library evidence therefore does not
establish a layout clipping defect; its redundant verified-offline error is a separate model
presentation correction owned by Generalist.

The target-aligned helper passes a clean **SE AX5 1/1 test with both Day and Dusk launches**
in `.scratch/ios-qa/se-gesture-20260912-1643/SEAX5.xcresult`, still using the unchanged
16:19 production source. All six selected images under `ax5-attachments/` were inspected:
partial count, complete missing-audio prose, and fully visible enabled/hittable Start in both
themes. The actual row opens Detail; Start is not tapped in this case. The static badge is
not required to be tappable. `runtime-report.md`, source/product hashes and two zero-unexpected
receipts preserve this classification. Content size was verified before the clean run and
restored afterward. An earlier run in the same directory changed size after launch and is
explicitly excluded from static AX5 acceptance.

### Frozen integrated build at 16:19:59 PDT

`.scratch/ios-qa/combined-20260912-161959/` preserves GeneralistFinalIntegration's 212
source/resource inputs, 136 source/object records and 1,127 product hashes. Actual execution
was **317/320 passed, three failed, zero skipped: 303/303 unit and 14/17 UI**. All copied
products remained byte-identical after execution (`product-integrity-after.json`). Keep
`snapshot.json`, `Source/`, `CombinedRuntime.xcresult`, `result-summary.json`, `runtime.log`,
`attachments/` and sanitized per-run `receipts/` together.

Account retry and lost-ack UI cases fail before account creation because the hierarchy has
six `planner.proposal` matches instead of one. Inspected frames show one logical card;
the assertion is retained pending the owner's container identifier fix. Late recommended
nudge fails at the initial `proposal.make` lookup, before draft/nudge preservation is
exercised. Its video changes from estimating to a ready card around that lookup; the next
test waits for a real enabled Make control and retains exact-one-card assertions.

Reset visually passes, but its receipt records **one proposal request**, so cancellation
acceptance is **unproven**: the old three-second terminal arrives before XCTest taps Reset.
The replacement fixture holds after chunk zero until actual cancellation. Required receipt:
`planStreamBarrierReached=true`, `planStreamCancellations=1`,
`planStreamTerminalDeliveries=0`, and zero proposal/create/mint/unexpected requests.
The passing old visual check must not be relabeled as this deterministic regression.

Both offline-empty cases, corrupt recovery with same-run relaunch, deferred public tabs,
delayed force above an email sheet, and immediate force/recommended dismissal now pass.
Maps no longer crashes in this snapshot. Inspected planner video frames show the actual
Google logo on a plain map rectangle, **without visible base tiles or route line**; successful
mounting is narrower than renderer acceptance.

The same products ran three SE cases at AX5: **two passed, one failed**, retained in
`SEAccessibility.xcresult`, `se-summary.json`, `se-runtime.log` and `se-attachments/`.
Transient Retry/public tabs pass in Day and Dusk; corrupt recovery passes in Day. Inspected
notice/title/tab geometry is separated. The partial-drive test fails before Detail/Start:
after eight default swipes its hierarchy still reports 0% scroll and no drive row. The
collection extends beneath the floating tab bar, so this does not yet prove a product
scrolling defect. The next QA-only harness derives gestures above the tab bar, accepts
the count in a combined row label or readable badge, and taps the actual row. A static
badge need not be independently hittable. Count readability still requires inspected
screenshots. SE content size was restored to its original `large` setting.

Historical failures below remain evidence of their own snapshots, not current failures.

### Frozen integrated build at 16:02:59 PDT, focused rebuild at 16:07:11

`.scratch/ios-qa/combined-20260912-160259/` preserves 134 source/object records, copied
source and 1,127 product hashes from GeneralistLibraryFix. Actual enumeration and execution:
**301/311 passed, ten failed, zero skipped** (unit **293/296**, UI **8/15**).
`CombinedRuntime.xcresult`, `result-summary.json`, `runtime.log`, `snapshot.json` and
`attachments/` retain the failing snapshot. All copied products remained byte-identical
after execution. XCTest restarted the unit host after a ProposalCard test indexed an empty
request array; the three failed unit cases remain failures, not skipped or accepted checks.

The unit failures are `ProposalCardTests.testMakeDriveNavigatesImmediatelyWhileDownloadProceedsInBackground`,
`testMakeDriveRetryPreservesSameIdempotencyKey` and
`testMissingServerDriveIdFailsWithoutFallbackToCardId`. Library, Details, hosted nudge and
startup coverage actually executed. New UI failures include the expanded deferred check
exposing ordinary Sign In in Settings and two offline-empty cases showing `library.error`
with Retry instead of `library.empty`. The latter preserve the no-row/no-Start intent but
have not passed the asserted presentation contract. The late-nudge fixture was unregistered
in this compiled snapshot. No test was skipped to conceal it.

Corrupt recovery and delayed force above an already-visible email sheet now **pass**.
Inspected recovery screenshots `attachments/DAEAFED1-043F-4F58-BFE4-BA51F0DC9CE6.png`
and `A3486FF1-1194-4039-AD48-DA963338E8E3.png` show explicit recovery/public tabs and
the old drive still hidden after same-run relaunch. The top notice overlaps part of the
Library title before recovery; flow success does not close this layout finding.
The inspected delayed-force before/after pair is `E435F78C-955C-4CB3-B358-AE992F157F4B.png`
and `80592F94-C850-4942-AA9C-E9A0F436AE2C.png` under `attachments/`.

The three planner UI failures are now correlated with actual **SIGABRT map crashes**:
`+[GMSServices checkServicePreconditions]` → `GMSMapView.init(options:)` →
`GoogleRouteMapCore.makeUIView(context:)` at `GoogleRouteMap.swift:159`.
Sanitized stack/source-report hashes are in `.scratch/ios-qa/planner-maps-crash-evidence.json`.
An absent proposal or invalid Start fresh frame while the app dies does not independently
prove an accessibility identifier defect. The offline fixture service boundary needs repair
before these flows can establish planner/idempotency behavior; do not enable live services
merely to turn fixture tests green.

The registered 16:07:11 products are frozen separately in
`.scratch/ios-qa/focused-20260912-160711/`. Focused actual runtime: **one passed, one failed**.
Corrupt recovery passes again with a fresh UUID and same-run relaunch. The new late-nudge
case crashes at the same map precondition before creating the required visible card; nudge
state preservation remains unreached by UI. Settings and ProposalCard test sources were
already being edited during capture; their exact compiled source was recovered from the
previous frozen snapshot only after matching compiled-object hashes. Provenance is explicit
per file in `snapshot.json`. Both runs' receipts show zero unexpected requests (16 and two
receipts respectively); product hashes remain unchanged.

The new `AccessibilityScrollTests` source adds day/dusk scroll-to-partial-badge, Detail
summary/Start, and deferred Retry/public-tab reachability. SDK typecheck passes, but these
two tests are not in either frozen product and await the next build and SE runtime.

### Frozen integrated build at 15:40:55 PDT

`.scratch/ios-qa/combined-20260912-154055/` preserves Generalist's signed simulator products,
130 Swift source/object hashes and timestamps, copied source, and 1,127 matching product-file
hashes. All captured sources predate their compiled objects; the products were copied unchanged.
Actual enumeration and `test-without-building` executed **283 tests: 274 passed, 9 failed,
zero skipped**, on iPhone 17 / iOS 26.5. `CombinedRetry.xcresult`, `result-summary.json`,
`discovered.json`, `snapshot.json`, `retry.log`, and `attachments/` retain the evidence.
The first attempt hit SpringBoard's application-still-updating launch error; it is preserved
as infrastructure failure, not unit execution. Restarting only the assigned simulator cleared it.

Unit result: **265/269 passed**. All 14 Detail, 47 Storage, 11 Settings, ten VersionPolicy,
and both independent Features QA tests executed. Three failed owner tests supplied invalid
drive DTO fixtures (two ProposalCard create tests and LibraryFilter reconciliation); the fourth,
`ProposalCardTests.testReEmittedRouteRetriesFailedProposal`, retained failing loading/error
assertions. Five assertion records represent four failed unit test cases. No assertion was relaxed.

UI result: **9/14 passed**. The corrected zero-playable Library test now passes; partial
Library → Detail → playback preparation also passes. Immediate forced update blocks app
actions without Later; recommended Later returns to Library and remains dismissed after a
same-run relaunch. Two planner proposal waits, Start fresh hittability, missing manual recovery,
and delayed force above Sign In fail. The delayed-force hierarchy shows the actual email form,
but its field lacks the required `auth.email` identifier; wall precedence remains unreached.
The three planner receipts each record one plan and proposal request, zero creates. Reset
failed before its tap, so those counts do not prove a post-reset paid follow-up.
All 16 captured receipts have zero unexpected, mint, and purge requests. Version request
counters are absent in this snapshot, so refetch count remains unverified.

Inspected screenshots under `attachments/`:

| Image | Observation |
| --- | --- |
| `72B4376D-8305-45C8-8FFD-C0CEF6E80CCC.png`, `27176BB5-59DE-4464-9D82-44E3B0211294.png` | Day/dusk Library shows amber **Downloaded (1 of 2)**. The earlier complete-badge failure is corrected in this snapshot. |
| `4CEBF503-3FB1-451C-B4DC-70985E3E7D21.png` | Detail says one of two stops is not saved, offers Start, and exposes only the saved stop preview. |
| `4A7F1FB6-7404-4FF7-B7A8-4469CD892716.png` | Playback preparation opens and warns about one missing recording; header still reads **0 / 0 stops**. Actual driving was not started. |
| `6F4BA14A-2DE5-4009-8A19-EC0E9AFA3759.png` | Immediate forced wall, reachable Update, no Later. |
| `DC3A4F6F-B169-41ED-8591-2BA37C440291.png`, `053D0565-B0D9-445D-8435-13F01749F117.png` | Recommended nudge before Later and usable Library after same-version relaunch. |

The same frozen products passed two original presence tests on SE (3rd generation) at
`accessibility-extra-extra-extra-large`; `SEAccessibility.xcresult` and `se-attachments/`
preserve them. Inspected day `F1985754-B8B4-4AC0-8390-E3D107B3B7E6.png` and dusk
`6091881F-C3FA-4AE5-AEBB-36C2AF45B123.png` show the title wrapping rather than truncating,
but Library metadata extends below the tab bar in the first viewport. Deferred prose also
wraps and extends below the viewport (`AF68BE55-6BC6-4525-9C53-25069B4B6D0E.png`).
Scroll-to-content/control reachability was not tested, so this is not full accessibility
acceptance. The prior `large` text size was restored. These two SE tests are separate from
the 283-test total. Newly extended cross-tab deferred checks are not in this frozen build.

### Earlier integrated snapshot

QA's combined iPhone 17 / iOS 26.5 run on 2026-09-12 passed 210/210 app-target unit tests,
including both `FeaturesQAFlowTests` methods, and 2/11 UI tests (9 failures, zero skips).
Result: `.scratch/ios/Test-1789249947567.xcresult`; exported screenshots, failure hierarchies
and recordings: `.scratch/ios-qa/evidence/combined-1789249947567/`.
The removed `PlannerViewModelAsyncTests` / `DriveDetailViewModelAsyncTests` drafts were absent
and were not discovered or counted. Their owner's replacement coverage requires a later run.

Observed UI blockers: parent screen identifiers replace child Library/detail identifiers;
Planner composer identifiers are absent; corrupt recovery exposes Retry only. The ninth failure
included an incorrect QA expectation: the shipped Library correctly omits a drive with zero
present clips. That scenario now requires empty Library, no drive row, no Start and no playback;
its corrected assertion awaits a later run. Partial detail renders two stops and Start, but lacks
the required partial-audio summary. Library labels the partial download "Downloaded."
These are observations of this dated built snapshot, not claims about later owner edits.

Day/dusk Library and deferred migration screenshots were inspected on the standard iPhone.
A separate SE (3rd generation) run used `accessibility-extra-extra-extra-large` text size:
two presence tests passed, but visual acceptance **failed**. Library titles/subtitles truncate
and status text falls behind the tab bar; deferred-migration prose truncates and its button
breaks across oversized lines. Result/screenshots: `.scratch/ios-qa/evidence/SE-accessibility-1789250400.xcresult`
and `.scratch/ios-qa/evidence/SE-accessibility-1789250400/`. The prior `large` text size was restored.
Exact inspected SE evidence (all under that screenshot directory):

| Image | Affected production surface and observed failure |
| --- | --- |
| `176DAFFA-D81C-48FF-9CAF-ECD9AA244BF1.png` (day) | Library drive row: "Fixture L..." and subtitle truncate; download status reaches behind the bottom tab bar. |
| `16A8B894-881C-4E47-84A6-22A7129C679B.png` (dusk) | Same Library row and bottom-tab layout failures. |
| `79025763-8D35-4D6F-8F69-97883901F597.png` | DeferredMigrationView: "Account Temporarily Unavailable" and credential explanation truncate; "Retry Verification" breaks across three oversized lines. |

Neither run opened Simulator.app or touched a physical installation. GPS, airplane-mode radio
behavior, audio focus/interruptions and signed upgrade continuity are outside this evidence.

## Evidence boundaries

| Layer | What closes it | What does not |
| --- | --- | --- |
| Contract/unit | Actual DTO, parser, engine and migration services pass deterministic fixtures | Parsing the fixture JSON alone |
| Simulator UI | Real application flows pass XCTest with screenshots and isolated services | A build, a launch, or mocked screen lookalikes |
| Signed upgrade | Shipped installed app updates in place, retaining usable credentials and downloads, including offline first launch | Synthetic Keychain rows or simulator reinstall |
| Device/drive | Downloaded audio decoding, interruptions, Bluetooth, lock-screen controls and a recorded real driving pass | Simulated GPS or simulator audio |
| Distribution | Signed archive, identity/entitlements/privacy/attribution/symbol checks, native-only runtime, TestFlight installation | Unsigned simulator build or archive existence alone |

Fixtures are in [contracts](../../fixtures/native-ios/contracts/README.md) and
[migration](../../fixtures/native-ios/migration/README.md). They version their envelopes,
name the legacy sources, distinguish missing keys from null, and carry independent expected
semantics. No fixture uses real account data, traces or credentials. Placeholder file bytes
are intentionally not audio; passing their presence checks does not prove decoding.

Run `bun test ./scripts/test/native-ios-fixtures.test.ts` for the captured legacy oracles.
The test file states its limits: transport cancellation, request-count/idempotency lifecycle,
Keychain IO, migration transactions and whole-sweep guards need their actual native services.
The TypeScript oracle imports four frozen, test-only modules from
`fixtures/native-ios/legacy-oracles`, preserving shipped build 25 at `98a292db`.
Only two type-only shared imports are relocated; executable source is unchanged.
Per-file Git blobs and source/frozen SHA-256 provenance retain that baseline after Expo retirement;
the validator checks the frozen hashes. Public DTO checks still execute current shared
schemas. This retained validator no longer imports `apps/mobile`.

The implemented `SkipperTests/Contracts` suite calls Generalist's actual DTO decoders,
SSE parser, PlannerClient and APIClient through a recording in-memory HTTPTransport. It
checks fragmented bytes, first-terminal behavior, JSON fallback, request counts, actual
task cancellation, timeout classification, offline preflight, degenerate paid actions and
deferred-cookie rejection. Timeouts are injected transport failures here; this does not
measure URLSession's real deadline timers. Bundle `fixtures/native-ios` as a `native-ios`
folder resource in SkipperTests. Missing resources fail the suite instead of skipping it.

During foundation integration, these same model/network sources and Contracts tests can
be compiled in a temporary macOS Swift package with copied fixture resources. Such a run
proves the contract layer executes; it is not an iPhone build or simulator UI pass. Current
execution results and failures belong in the worker's report, with the tested snapshot.

`DrivingFixtureParityTests` executes every client-side section of the driving goldens,
including stateful approach/debounce, heading, retirement/rearming and malformed-fix cases.
All harness variants check event sequence/count exactly, distance within 0.0001 m and time
within 0.000001 seconds. `DrivingQARegressionTests` adds GPS gaps, out-and-back projection,
repeated final-fix callback ordering, explicit serialized null sensors, and an actual
`MAX_TRACE_FIXES` recording followed by overflow. Server-only geometry/eligibility sections
are outside the native client claim. Run these against the target's configured Swift language
mode; record stricter language-mode diagnostics separately from that execution result.

## Debug UI launch contract, version 1

Generalist owns the production implementation of this contract. The UI target owns
`FixtureApp.swift` and `OfflineSmokeTests.swift`. No production seam is implemented by the
harness itself. Register the files in the UI target; do not silently skip absent screens.

| Environment | Contract |
| --- | --- |
| `SKIPPER_UI_TESTING=1` | Debug only. Select fixture dependencies BEFORE auth, network, analytics, Maps traffic or location initialization. Release ignores test configuration. |
| `SKIPPER_UI_SCENARIO` | One of the scenario names below. Unknown/missing values while testing fail closed, with no live-service fallback. |
| `SKIPPER_UI_RUN_ID` | UUID identifying an isolated test storage namespace. Reject invalid values; never use an arbitrary incoming filesystem path. Same ID may relaunch the same state; a different ID is fresh. |
| `SKIPPER_UI_THEME` | `light`, `dark`, or `system`, using the real theme implementation. |

Mock transport, credentials, connectivity, clock, location and audio where appropriate.
Do not contact production, initialize native analytics, load remote map tiles, invoke real
Keychain migration or display permission prompts in these smoke scenarios. Render the real
app screens through injected services. Seed only the run's private directory; never erase
normal Documents/Keychain/preferences. Include fixtures as Debug resources through Generalist's
project configuration; do not depend on the runner's filesystem being accessible to the app.

| Scenario | Required initial state and observable identifiers |
| --- | --- |
| `offline-library` | Fresh synthetic cached account; confirmed offline; partial v5 fixture (`v5-partial-shared`). Show `screen.library` and button `library.drive.00000002-0000-4000-8000-000000000001`. Tap opens `screen.drive-detail`, `drive.missing-summary`, enabled `drive.start`. No attempt to decode the placeholder bytes in this smoke test. |
| `offline-empty` | Fresh synthetic account, offline, no saved manifests/files. Show `library.empty`; no `drive.start`. |
| `signed-out` | Explicit `{}` sign-out marker plus stale cached account and download fixture. Show `account.sign-in`; do not show the prior account's drive. This tests access, not destructive cleanup. |
| `migration-deferred` | Keychain temporarily unavailable, offline, retained downloads; identity unverified. Show `migration.retry`; do not claim sign-out or expose `account.sign-in`. No replacement anonymous identity. |

Identifiers describe real controls/screens, not localized text. Native service tests must
add assertions for zero real requests, no credentials/download deletion and preserved
one-shot mint state; UI element absence cannot prove those side effects did not occur.
Screenshots are retained in the XCTest result bundle for all smoke states/themes. A separate
manual pass must inspect layout, VoiceOver reading order, Dynamic Type, permissions, deep
links, planner sign-in continuity, downloads/repair, and driving surfaces.

Harness API usage was checked against current Apple documentation:
[launch environment](https://developer.apple.com/documentation/xcuiautomation/xcuiapplication/launchenvironment),
[element waiting](https://developer.apple.com/documentation/xcuiautomation/xcuielement/waitforexistence(timeout:)),
and [test attachments](https://developer.apple.com/documentation/xctest/adding-attachments-to-tests-activities-and-issues).

### Extended production-view scenarios

`contracts/ui-flows.json` defines five more Debug scenarios. The app owner bundles this
file alongside the migration resources; `PlannerContinuityTests` and
`RecoveryAndStartGateTests` exercise the production screens. Their first full-app execution
failed at the blockers recorded above; downstream flow acceptance remains unverified.

| Scenario | Service script and visible acceptance |
| --- | --- |
| `planner-account-retry` | Seed a fresh synthetic anonymous session, serve bootstrap, stream partial text then terminal route after 3 seconds, resolve proposal. Make reaches the account wall without a create request. OTP sign-in returns to that card; an explicit Make receives the first pre-commit failure. Explicit Retry returns the canonical fixture drive. |
| `planner-account-lost-ack` | Same flow, but the first create commits one drive then drops the acknowledgement. A retry with the same route and lowercase key returns that same drive; changed keys/routes fail closed. Tests take day/dusk screenshots. |
| `planner-reset-during-stream` | Reset after observing partial text, before the delayed terminal. Keep the empty planner after the terminal window; no proposal/create request may follow. |
| `offline-no-playable-clips` | Seed the existing partial-manifest tree, remove clip bytes only inside the isolated run, and retain its fresh cached identity. The shipped Library filters out drives with zero present clips: show `library.empty`, no drive row, no Start action and no playback screen. Direct detail zero-byte gating is a separate production ViewModel check. |
| `corrupt-credentials-recovery` | Seed malformed credential rows and retained downloads. Explicit recovery opens the real OTP form. New identity has an empty owner-scoped drive list; old downloads remain hidden before/after sign-in and same-run relaunch, without purge or anonymous mint. |

Add these identifiers to the corresponding real production elements:

| Surface | Identifiers |
| --- | --- |
| Planner | `screen.planner`, `planner.input`, `planner.send`, `planner.streaming` (partial text), `planner.proposal` (one containing card), `planner.start-fresh`, `planner.empty` |
| Proposal actions | `proposal.make`, `proposal.sign-in`, `proposal.retry` |
| OTP form | `auth.email`, `auth.send-code`, `auth.code`, `auth.verify` |
| Recovery/detail | `migration.recover`, `drive.title` (actual title text) |

Use `initialTab` from the fixture. The recovered flow stays on Library. Persist mock
Keychain mutations across launches with the same run ID. Before playback preparation,
inject fixture audio/location sources. Valid UI fixtures initialize Maps alone before mounting
the real map view; production API/auth/PostHog remain isolated. The partial
offline test opens playback preparation but does not press Let's roll or decode placeholder bytes.

The scripted transport records nonsecret `qa-receipt.json` inside its isolated run directory:
request/commit counts, distinct-key count, lowercase-UUID and unchanged-route booleans,
unexpected-request count, and HTTP-time local directory IDs. Settled canonical directory,
manifest identity and referenced-byte requirements live in `expected.persistence` and require
fresh filesystem readback after commit and same-run relaunch.
Never record cookies, auth payloads, full requests or real paths. Capture the first actual
create key and reject changed keys/routes on subsequent requests. This checks submitted keys;
the separate model tests must establish that a card mints its key before the account wall.
The QA runner retains/read-checks the receipt via the simulator app container, correlated by
run UUID in screenshot attachment names. Screenshots cannot prove zero requests or one debit.

Run day/dusk on the standard simulator, then the same production flows on the existing SE
with `simctl ui <device> content_size accessibility-extra-extra-extra-large`. Save and restore
that simulator's previous content-size setting. This tests system text scaling; do not inject
a replacement SwiftUI layout. Inspect retained screenshots for clipping and reachable controls.

`FeaturesQAFlowTests` supplies two independent production-model regressions: an old canceled
turn failing while a newer turn is still streaming, and explicit recovery followed by one
owner-scoped drive verification and offline Library access across a new vault/session/model.
The latter seeds two real fixture manifests sharing bytes and requires only the verified ID
to appear, while preserving both originals. Controlled continuations and recording HTTP
responses exercise the real models/clients; no production state is injected into private setters.

### Version policy root presentation

`contracts/version-policy-ui.json` and `VersionPolicyPresentationTests` define four scenarios.
The first three passed actual root presentation in the 16:02:59 frozen run above. The fourth
is registered in the 16:07:11 build but hits the proposal-map crash before its nudge precondition.
Controller tests alone do not establish presentation precedence.

| Scenario | Required observed flow |
| --- | --- |
| `version-force` | Update required and reachable Update button; no Later; underlying app actions inaccessible; swipe cannot dismiss the wall. |
| `version-recommended` | Update available → Later → usable Library; relaunch the same run/current bundle version and do not present the nudge again. |
| `version-force-delayed-sheet` | Settings is usable while policy is pending; open the real Sign In sheet and observe its email field; delayed forced wall replaces it and makes the old form inaccessible. |
| `version-recommended-delayed-planner` | Stream one real proposal, then type **Keep this draft** before the delayed nudge; tap Later and retain one unchanged card and the exact unsent draft. Exactly one plan/proposal, zero creates. Private key identity and active playback preservation require separate lifecycle/model assertions. |

Generalist's Debug seam bundles this JSON, selects `input.initialTab`, uses the supplied
synthetic session and ordinary responses, and serves `input.responses.version` only for
`GET /version`. `input.versionDelayMs` delays that response (12 seconds in the sheet case),
not migration or session startup; the delayed-planner case uses 25 seconds and
`initialTab: "planner"`. Keep same-run defaults and record `versionRequests` in
the existing nonsecret receipt: one per forced scenario, two for the recommended relaunch.
Zero unexpected requests and anonymous mint requests are expected. Never open the fixture's
`.invalid` store URL. Tests use the production bundle version, not a test-only controller.

Required IDs: `version.gate`, `version.update`, `version.later`, `account.sign-in`, `auth.email`,
and `screen.library`. Parent IDs must not replace child control IDs. Every new scenario keeps
screenshots; version response DTO compatibility is separately checked through actual APIClient
and the retained TypeScript schemas/version gate.

## Reusable simulator destinations and local dependencies

Discovery on 2026-09-12 found Xcode 26.5 (17F42), iOS 26.3/26.5 runtimes and these
existing iOS 26.5 destinations. Reuse them rather than creating duplicate simulators:

| Purpose | Simulator | UDID |
| --- | --- | --- |
| Standard | iPhone 17 | `5EBE6998-57A5-4150-908F-8E56739EC590` |
| Smallest supported layout | iPhone SE (3rd generation), named `Skipper-SE-tmp` | `9D737780-0400-43DC-AAD3-E72E14A420A2` |

No iOS 17 runtime was listed; deployment-target compilation is not minimum-runtime testing.
A paired physical iPhone was reported available, and one Apple Development signing identity
was present. A later device query could not locate that phone; initial pairing is not current
availability. No distribution identity was listed. These observations do not establish
provisioning, device-install permission, a usable shipped installation or archive export.
Keep physical-device identifiers and signing identity details out of shared evidence.

## Signing continuity evidence (2026-09-12)

The required legacy default Keychain group is `L24UJYJ5DK.fm.skipper.app`. This conclusion
uses signed artifact/build evidence, not the bundle ID or a development project setting:

| Evidence | Observed identity |
| --- | --- |
| EAS build `3eb43cc7-8509-4f71-9dab-7624e52701c0`, version 1.1.0 (25), commit `98a292db` | Retained Xcode log records `AppIdentifierPrefix=L24UJYJ5DK.`, distribution team `L24UJYJ5DK` (Manoa, Inc.), application identifier `L24UJYJ5DK.fm.skipper.app`, and no explicit `keychain-access-groups` in the entitlements passed to codesign. The [App Store record](app-store-submission.md) ties build 25 to the released version. EAS artifact downloads returned 403/404; this is build-log evidence, not direct inspection of build 25's final IPA. |
| Local signed 1.1.1 (26) IPA, `.scratch/releases/1.1.1-26/skipper-1.1.1-26.ipa` | Executable entitlements confirm the same application identifier/team, no explicit Keychain groups, and `get-task-allow=false`. Embedded App Store profile confirms application prefix/team `L24UJYJ5DK`; its wildcard `L24UJYJ5DK.*` is an allowed group pattern, not the app's actual claimed group. |
| Shipped source at `98a292db`, `apps/mobile/src/lib/auth.ts` | SecureStore writes use `WHEN_UNLOCKED_THIS_DEVICE_ONLY` and do not override `accessGroup`. |

Apple specifies that an omitted item access group defaults to the app's first Keychain
group, or its application identifier when no explicit group exists. Hence the group above
follows from the observed entitlement and source combination.
[Apple Keychain default-group rules](https://developer.apple.com/documentation/security/ksecattraccessgroup).
Changing the application prefix can orphan existing Keychain items even when bundle IDs
match. [Apple TN2311](https://developer.apple.com/library/archive/technotes/tn2311/_index.html).

Generalist owns signing configuration; inspect the actual native archive and exported IPA
against this identity before an in-place upgrade. No physical app/data was replaced during
this investigation. An installed-device readback and signed upgrade rehearsal remain owed.

## Integration and release checks

Root sequences full `bun run check` and native `bun run ios:check` integration checks.
The native script is owned by Generalist. Retain its actual command, destination, build
revision and `.xcresult` location in the execution report; never infer a pass from a missing
test target or skipped tests. Simulator boot/install/launch must not restart shared servers.

Before signed upgrade testing, preserve the existing installation and state; do not uninstall
it. Verify bundle ID, team/application identifier, access groups, URL scheme and associated
domains against the shipped signed app. Populate synthetic tester state through supported
flows, update in place, and exercise fresh offline, expired-cache, interruption/relaunch and
online cookie refresh cases. Confirm credits/drives against authorized tester evidence,
without collecting real rider rows or logging tokens. Keychain/device-only attributes require
signed-device validation even after mocked storage tests pass.

The signed-device Keychain pass must round-trip a synthetic native credential envelope
larger than 2 KB, including after process termination and relaunch. Record its UTF-8 byte
count, read/write status and equality without logging the envelope. Legacy JavaScript
chunking is not evidence of a 2 KB iOS Keychain limit. Verify device-only accessibility and
the actual signed access group independently of payload size. Locked/unavailable storage
must defer; corrupt storage must offer explicit sign-in recovery without automatically
minting an anonymous account or purging downloads. Confirm that sign-out markers at legacy
addresses still prevent rehydrating a previous account after relaunch or interrupted recovery.

Real driving evidence must name conditions, app/OS build, foreground location/When-In-Use
behavior, trigger timing, queue ordering, completion, audio route changes and observed
failures. A human must perform the physical driving; no agent can manufacture this evidence.
No CarPlay or background-GPS acceptance is added by this conversion.
