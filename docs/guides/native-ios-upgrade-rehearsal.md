# Legacy-to-native iOS upgrade rehearsal

**Status**: EXECUTED 2026-09-12 — 7/7 real-persistence simulator cases PASS. A partial-download library-label finding in this captured snapshot was routed to the feature owner; their later correction is outside this run. Distribution and physical-device acceptance are not established.

The original runtime snapshot and receipts remain authoritative. A 2026-09-12 read-only
comparison against QA's 16:19:59 snapshot found the critical Auth/SystemKeychain, preference,
and stored-data read/migration implementations unchanged. Shared-download cancellation,
startup scheduling, and UI deltas were assessed separately in the
[applicability audit](../../.scratch/ios-upgrade/applicability-audit-20260912/report.md).
No seven-case replay was needed; this is source-applicability reasoning, not a claim that
the current binary reran the original scenarios.

## Scope and isolation

The rehearsal starts from the released build-25 source revision `98a292db` in a detached
worktree at `.scratch/ios-upgrade/legacy`. It uses a new dedicated iPhone 17 Pro simulator,
`C852F155-32F3-42F5-9071-AD9BF1A7AD08`, on iOS 26.5. Both installations use `fm.skipper.app`.
The procedure replaces the application with `simctl install`, without uninstalling it,
and records the data-container path and hashes before and after replacement.

No real account, production endpoint, paid request, physical-device install, archive,
upload, or signing credential is involved. All state is synthetic. The loopback server
binds only `127.0.0.1:18765`, serves a synthetic drive and locally generated AAC tone,
rejects non-GET requests, and records only route counts. It never forwards requests or
logs cookies, headers, or request bodies.

This is an instrumented rebuild of shipped source, not the distributed build-25 binary.
The legacy entrypoint is replaced in the isolated worktree to call actual Expo
SecureStore, Better Auth's exported `storageAdapter`, `downloadDrive`, `loadPlayback`,
and the public region-cache writer. The storage implementation itself is unmodified.
Frozen Bun dependencies come from the retained lockfile. CocoaPods scaffolding is
regenerated locally, so its lockfile and build log are retained separately.

## Source and harness receipts

All scratch files are under `.scratch/ios-upgrade/`:

- `native-source-sha256.json` and `native-snapshot-time.txt` identify the native source
  snapshot taken before rehearsal patches. The copied sources remain in `native/apps/ios`.
- `native-scratch-patches.json`, adjacent `.patch` files, `patch-native.py`, and
  `native/apps/ios/Skipper/App/UpgradeReceipt.swift` describe the instrumentation.
- `legacy-source.patch`, `legacy/apps/mobile/upgrade-entry.js`, `prepare.py`, generated
  `Podfile.lock`, and frozen `bun.lock` identify the legacy harness and dependencies.
- `LegacyDerivedData` and `NativeDerivedData` are separate build directories.
- `legacy-build.log`, `native-build.log`, and `root-check.log` hold executed build/check output.
- `run.py` records each replacement, launch, receipt, and screenshot under `evidence/`.

The native snapshot calls `AppDependencies.live`, actual `SystemKeychainStore`, standard
`UserDefaults`, and ordinary `URL.documentsDirectory`. Networking is independently
replaced by an offline verdict and rejecting transport. External SDK startup is suppressed.
The ordinary production views and migration/auth/storage/preview/playback implementations
remain in use. No JSON-backed Keychain or isolated Application Support fixture is used.

The optional interrupted-migration hook pauses immediately after the actual native
Keychain write returns and before the vault verifies it. The runner terminates that
process and launches without the pause flag. This deterministic crash boundary tests
recovery from a completed durable write; it cannot reproduce every possible interruption.

The native receipt contains only synthetic-state booleans, preference values, process IDs,
local paths, file hashes, audio frame/sample-rate measurements, and playback progress.
It never emits credential bytes. Between independent cases, the legacy harness removes
only the two known native credential keys in this dedicated synthetic simulator.

## Documentation lookup

Context7 was unavailable in the exposed tools after the reported startup timeout.
The fallback consulted current [Expo SecureStore documentation](https://docs.expo.dev/versions/latest/sdk/securestore/)
and [Apple Keychain services documentation](https://developer.apple.com/documentation/security/keychain-services),
then inspected the retained installed Expo and Better Auth source for exact services,
Data-valued account/generic attributes, accessibility options, and chunk markers.

## Acceptance boundaries

Simulator file/Keychain continuity cannot prove distribution Keychain access groups,
App Store update delivery, device lock/biometric behavior, backup/restore, airplane-mode
radio behavior, real GPS, Bluetooth, audio focus, telephone interruptions, or lock-screen
Now Playing. Signed legacy prefix `L24UJYJ5DK` is documented independently in the
[native verification guide](native-ios-verification.md); these locally signed simulator builds
cannot establish the native distribution identity. The iOS 17 runtime is unavailable.

## Runtime cases

| Case | Seed and required observation |
| --- | --- |
| Fresh offline | Both credentials genuinely chunked by Better Auth; offline native account access, retained preferences/region/store, decoded local tone and advancing production preview. |
| Process relaunch | Terminate and relaunch native; different PID, same account access and identical store hashes. |
| Expired session cache | Past session expiry, valid cookie bytes retained; offline identity deferred and local account access withheld, with no mint or deletion. |
| Expired download | Age only `savedAt` in the actual downloaded manifest; report expiry while retaining playable bytes. |
| Signed-out markers | Expo writes literal `{}` for both credentials; native remains signed out offline and does not expose residual synthetic downloads. |
| Incomplete chunk and retry | Preserve a chunk written by Expo, remove its real Keychain row, observe native defer, then restore those exact bytes and invoke `SessionStore.retry`. |
| Partial download | Actual legacy downloader receives one real AAC clip and one persistent loopback failure; native must preserve the missing-stop distinction and play the available local clip. |
| Interrupted native migration | Terminate at the pause after real native Keychain write, relaunch normally, and recover without changing store bytes. |

The download-expiry case deliberately ages the manifest as a test input. The
incomplete-chunk repair is harness-driven restoration of exact synthetic bytes; it
establishes retry behavior, not an end-user UI capable of reconstructing missing credentials.

## Setup findings and corrections

`CODE_SIGNING_ALLOWED=NO` compiled both applications but the first legacy launch failed
before seeding with SecureStore error `-34018` (missing entitlement). Manually adding
restricted iOS entitlements to an ad-hoc signature then caused macOS AMFI to reject launch.
Neither attempt is upgrade evidence. The successful setup uses Xcode's normal simulator
signing: `CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- DEVELOPMENT_TEAM=L24UJYJ5DK`.
Both generated `Skipper.app-Simulated.xcent` files contain
`application-identifier=L24UJYJ5DK.fm.skipper.app`, with no explicit Keychain group override.
Those files are retained as `legacy-simulated.xcent` and `native-simulated.xcent`.
The separate `simulator.entitlements` file belongs to the **rejected** manual attempt and
is not used by the passing builds. No development/distribution certificate was used.

The first legacy receipt tried to find a file URL with `JSON.stringify(playback)`, which
omits JavaScript Map entries. That measurement was false even though `loadPlayback` had
resolved the download successfully. The final harness checks `playback.urls.values()` and
its size directly; all cases are rerun. Earlier receipts remain in `evidence-initial/`.

The simulator installer relocated the data-container UUID on application replacement.
Therefore `sameContainerPath` is accurately **false**. The runner does not uninstall or
copy data into the replacement container; the installer carries the actual Documents
contents forward. Manifest, region cache, and audio SHA-256 values are compared immediately
after install, before native first launch, and again after process relaunch.

## Repeating this captured harness

Use the retained snapshot and loopback server, not current shared sources, when repeating
these results. Source hashes before patches, hashes of the final compiled snapshot, all
patch inputs, and harness hashes are separate artifacts. `native-originals/` preserves the
exact original versions of patched files; `original-patch-input-verification.json` verifies
their hashes against the pre-patch snapshot.

Build the legacy retained workspace with scheme `Skipper`, configuration `Release`,
SDK `iphonesimulator`, the dedicated simulator destination, and `LegacyDerivedData`.
Set `EXPO_NO_DOTENV=1`, `EXPO_PUBLIC_API_URL=http://127.0.0.1:18765`, and `CI=1`.
Use the simulator signing settings above. The scratch-generated project bypasses PostHog
symbol/source-map upload scripts and permits loopback networking. Its custom entrypoint
never launches the shipped UI or its SDK initialization.

Build `native/apps/ios/Skipper.xcodeproj` with configuration `Debug`, the same destination,
`NativeDerivedData`, and the same simulator signing settings. Its scratch configuration
uses `https://api.invalid` and empty SDK keys. The injected transport cannot contact it.

Start the task-owned server with `bun .scratch/ios-upgrade/server.ts`, then run:

```sh
python3 .scratch/ios-upgrade/run.py fresh expired expired-download signedout incomplete interrupted partial
python3 .scratch/ios-upgrade/verify.py
```

The runner installs only on its hard-coded dedicated simulator. Every case has a legacy
seed screenshot, native first-launch screenshot, native relaunch screenshot, legacy
receipt, two native receipts, and a replacement/hash receipt. No coordinate taps are used.
The production `AppModel.startDrive` path is invoked by instrumentation and its presentation
state is recorded; that is not a claim of manually exercising the complete driving UI.

## Executed results

The final `verify.py` execution exited **0**, with all seven scenarios passing.
`verification-summary.json` and `final-verification.log` contain the machine-readable
outcome. The captured native source snapshot was taken at **2026-09-12 22:19:32 UTC**;
this does not claim to test subsequent shared-tree changes.

| Case | Observed native first launch and relaunch |
| --- | --- |
| Fresh | Actual chunked credentials import through SystemKeychainStore; signed in and local access granted on both processes. |
| Expired session | Deferred, not signed in; local access withheld on both processes while original bytes remain. |
| Expired download | `isDownloadExpired` true; fresh account retains local access and audio still decodes/plays. |
| Signed out | Both `{}` markers honored; signed out and local access withheld on both processes. |
| Incomplete chunk | Initial migration deferred with recovery available and no native envelope; exact original chunk restored, ordinary retry grants account/local access; next process remains signed in. |
| Interrupted | Process stopped after actual native Keychain write and terminated; next launch recovers the native record and plays local audio; another relaunch remains valid. |
| Partial download | Legacy actual transfer fails sequence 1 after retrying; one local clip remains. Native completeness stays false, available clip decodes/plays, and manifest missing-stop information survives. |

Across all cases, before/after-install and after-relaunch hashes of the manifest,
region cache, and AAC bytes matched. All four preferences retained their expected values
(`dark`, `1`, `list`, `1.1.0`), and the public region cache survived. Every native receipt
reports an offline verdict and **zero HTTP transport invocations**. Each case's first and
relaunch receipts have different process IDs. Valid/recovered account cases decode
**264,600 frames at 44,100 Hz** and advance the real production preview beyond 0.5 seconds;
measured first-launch positions in the final matrix are approximately **1.74–1.97 seconds**.
The production playback construction/presentation path also succeeds for those cases.

Visual review inspected the legacy seed, native first-launch, and native relaunch
screenshots through three contact sheets, plus full-size fresh and partial-library images.
The native fresh/recovered library shows the retained synthetic drive in dusk mode with
an offline banner. The expired-session screen shows “Account Temporarily Unavailable”
and preserves downloads. Immediate signed-out captures caught tab-transition animation;
the signed-out case was repeated with a settling delay for its final screenshots.

**UI finding in the captured snapshot:** the partial library card labels the drive “Downloaded” despite one
missing clip (`downloadComplete=false`, one resolved local clip, two expected clips).
The settled image is `evidence/partial/04-library-settled.png`; the feature owner was
notified through the orchestrator. The orchestrator reports that a later partial-badge
update postdates this snapshot; this rehearsal did not rebuild or assess that fix. This does not invalidate the storage distinction or
retention checks, but it prevents treating the rehearsal as complete UI acceptance.
A separate attempted deep link stopped at the system “Open in Skipper?” confirmation;
`05-system-deeplink-confirmation.png` is that dialog, not a drive-detail screenshot.

Verification performed:

- Legacy simulator Release build, native simulator Debug build, and subsequent harness
  rebuilds: PASS through normal Xcode simulator signing.
- Root `bun run check`: initial execution PASS. A final execution failed in 16 release-tool
  tests while other agents were changing those shared files; see `root-final-check.log`.
  These failures are outside the rehearsal-owned paths and were reported to the orchestrator.
- Isolated legacy workspace `bun run check`: PASS, including 454 tests.
- Final runtime assertion script: PASS for all seven cases.
- Documentation lint: PASS.

This rehearsal did not exercise v4 migration, device-locked Keychain, service fallback
rows requiring biometric authentication, real server refresh/cookie rotation, or the
complete driving UI. Those remain separate unit/integration/device acceptance work.
The only tracked file owned by this task is this guide; production and test sources,
shared simulator devices, the Git index, and other agents' edits were not changed.

Final settled signed-out evidence is `evidence/signedout/04-native-settled.png`, visually
inspected: My Drives shows the sign-in gate and no saved-drive cards. A scratch-only
`UpgradeScreenshotTests.testDismissSystemOpenConfirmation` dismissed the system dialog
by its accessibility label and passed; `Screenshot.xcresult` and `screenshot-test.log`
retain that execution. No coordinate tap or shared test-file edit was used.

Provenance digests (SHA-256 of the manifest files, whose entries hash each source file):

| Artifact | SHA-256 |
| --- | --- |
| `native-source-sha256.json` | `be07cd172ee2c1587bdcb4e75740158e3412908a3c486d80e7fdc7da38ad6409` |
| `native-compiled-source-sha256.json` | `502c2ce84c43c249fe9a2a8cc2dd72c74f2928c6f97da313f4e29bb8d3ac5829` |
| `native-scratch-patches.json` | `8975bcd24256a805b9b5ee8045994283b57ee19adb7e0928fb183531927f0b24` |

`harness-sha256.json` also captures the runner, verifier, seed, tone, and screenshot-only
test; `provenance-summary.json` records their manifest digests. The screenshot-only test
was added after the completed seven-case app-source snapshot and does not change the app.

The final verifier command is `python3 .scratch/ios-upgrade/verify.py`; its exit is **0**.
Its output has `pass: true` for `fresh`, `expired`, `expired-download`, `signedout`,
`incomplete`, `interrupted`, and `partial`; each reports identical store hashes, relocated
container path, a distinct relaunch process, and zero native transport calls. Full output
is `final-verification.log`, not a reconstructed fixture result.

The dedicated simulator and all evidence are retained intact for reproduction. No
physical-device or distribution continuity claim is made.
