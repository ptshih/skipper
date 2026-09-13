# Native iOS releases

**Status**: Execution in progress, 2026-09-12. Independent review cleared the core pipeline, symbols integration, and XCTest evidence retention. The first native source retry passed root checks and all 339 native tests, then archived successfully. A retained-archive diagnostic proved manual distribution export with the existing team credentials; its first inspection exposed two checker false positives, now being corrected and independently reviewed. That diagnostic uses older source and is ineligible for delivery. The latest accepted source still requires a complete release run; cloud symbols and Apple delivery remain unverified. The shipped Expo baseline remains recorded in [release batches](../designs/release-batches.md).

The native pipeline builds the tracked `apps/ios/Skipper.xcodeproj` with Xcode, exports an IPA, inspects it, and verifies Apple processing. The existing app identity stays `fm.skipper.app`, team `L24UJYJ5DK`, ASC app `6778946770`, and default Keychain group `L24UJYJ5DK.fm.skipper.app`. Native iOS requires iOS 17; the API remains compatible with older installed clients.

## Source and configuration

Real execution requires `--source-commit` with a full committed SHA. The orchestrator coordinates the explicit-path commit after app acceptance; the release script never commits the shared workspace. Dirty work belonging to other agents stays in that workspace.

The script creates a private detached checkout of the requested commit. Its project marketing version and default export plist come from that checkout. It installs dependencies with `bun install --frozen-lockfile`, generates production and simulator configuration there, and runs its own root and native checks before archiving. A build-number or marketing-version override is recorded and passed explicitly to Xcode.

Before entering the checkout, the script captures the four public `SKIPPER_*` client values using the configuration owner's rules:

- Ignored `.scratch/ios/client-config.json` stores native local settings.
- `SKIPPER_IOS_CONFIG_PATH` selects an alternative JSON path, resolved against the caller repository.
- Explicit `SKIPPER_*` environment values take precedence, including empty values that must fail validation.
- Captured values are passed into the checkout; it never reopens a caller-relative mutable configuration file.

Generated Release configuration and the selected export plist are copied into a private read-only directory before checks. Xcode receives that frozen configuration through `-xcconfig` and exports using the exact validated plist bytes. Snapshot hashes cover all committed files, generated configuration, and frozen export options. Checks and archive/export transitions reject changed inputs. The shared workspace's `.scratch/ios/Release.xcconfig` is never a build input.

ASC key paths are made absolute before checkout creation. SDK and private credential values are excluded from logs and receipts. Distribution credentials remain external to the source checkout.

### Existing local distribution signing

When automatic export selects cloud signing that the API key cannot access, reuse the team's existing distribution certificate/private key and App Store profile. [Expo supports downloading existing EAS credentials](https://docs.expo.dev/app-signing/syncing-credentials/); [Apple supports local or manual signing](https://developer.apple.com/help/account/certificates/cloud-managed-certificates). Verify certificate validity, private-key correspondence, profile certificate membership, team, app ID and expiry before installing. Preserve existing identities and the default keychain, keep private files outside tracked source, and never expose passwords in command arguments or logs.

The existing `--export-options /absolute/path/to/local-export.plist` option supports manual export without changing the Xcode project. Keep all default export options, change `signingStyle` to `manual`, set `signingCertificate` to the installed certificate SHA-1, and set `provisioningProfiles` to a dictionary mapping `fm.skipper.app` to its App Store profile UUID. Xcode's installed `xcodebuild -help` documents both selectors. The pipeline validates and freezes those exact plist bytes before checks; export still only writes a local IPA for subsequent inspection. Do not embed expiring credential selectors or private credential material in application source.

On 2026-09-12, the diagnostic manual export used the already managed `L24UJYJ5DK` EAS distribution identity and its matching App Store profile. Automatic export still requested a cloud-managed certificate; manual export succeeded with local credentials. Its receipt is `.scratch/signing-recovery/manual-export-probe-01/probe-evidence.json`. The copied and original archive hashes matched before export and remained unchanged afterward. These old-source artifacts never qualify as the latest release's archive, IPA or symbols evidence.

## Commands

Use macOS with the project's verified Xcode installation, iOS SDK/simulator, Bun, and Apple command-line tools. The pinned PostHog CLI is installed with repository dependencies.

Preview does not read credentials, run checks, write artifacts, archive, or upload:

```bash
bun scripts/ios-release.ts --dry-run --source-commit <full-commit-sha>
```

A preparation-only invocation archives, exports and inspects without Apple delivery; it may still attempt local symbol upload when its credentials are present:

```bash
dotenvx run -f .env.development -- bun scripts/ios-release.ts --source-commit <full-commit-sha>
```

The output defaults to `.scratch/releases/<version>-<build>/`. It must be empty so a failed export cannot accidentally reuse an earlier IPA. `--output-dir` selects a different directory.

`--version <x.y.z>` overrides the checkout marketing version. `--build-number <integer>` overrides the next number only after a complete fresh ASC lookup proves it is unused. Missing credentials or failed/truncated enumeration cannot be bypassed with an override. Build values must be whole positive safe integers; decimal, exponent, suffix, and overflow values are rejected.

`--skip-preconditions` and `--skip-posthog` are prepare-only diagnostics. Their receipts record missing checks/symbols. Neither flag is accepted together with `--upload`.

After app acceptance and the immutable commit, use one complete invocation for archive, symbols and Apple delivery. A separate `--skip-posthog` signing probe is only needed to diagnose the environment; ordinary delivery does not require building twice. Archive or signing failure stops before any cloud symbols workflow.

```bash
bun run ios:release --source-commit <full-commit-sha> --version 1.2.0 --symbols-eas --eas-project-id dd556bd3-5c16-430e-8b1f-cfdeb410f26d --posthog-project-id 517151 --upload
```

`--symbols-eas` starts the macOS EAS symbols workflow during this execution, using the same inspected archive and IPA. Its project IDs may instead come from `SKIPPER_EAS_PROJECT_ID` and `POSTHOG_CLI_PROJECT_ID`. The PostHog region comes from frozen client configuration. The existing EAS production environment supplies its cloud-only PostHog token. Omitting `--upload` still runs the requested symbols workflow but stops before Apple delivery. Apple upload requires `--symbols-eas`; neither a local CLI success nor a caller-supplied status qualifies as symbol proof.

Authenticated metadata readback on 2026-09-12 used `npx --yes eas-cli@24.3.0 whoami`, `project:info`, and `env:list production --scope project --format short`. The project commands ran from the existing linked `apps/mobile` directory for metadata lookup only. They confirmed user `ptshih` has Owner access to `manoa-inc`, project `@manoa-inc/skipper` has the UUID above, and production `POSTHOG_CLI_PROJECT_ID` is the public value `517151`. `POSTHOG_CLI_API_KEY` was listed with its value masked. Neither sensitive/file-content flags nor token extraction were used. This proves current account/project access and variable presence; it does not establish the token's PostHog upload/readback scope or Apple signing permissions. The release itself receives the public IDs explicitly and has no legacy app configuration dependency.

Standalone IPA inspection checks signing, configuration, and runtime markers but cannot prove dSYM coverage without the matching archive:

```bash
bun scripts/ios-release.ts --inspect-only /absolute/path/to/skipper.ipa
```

ASC queries are read-only:

```bash
dotenvx run -f .env.development -- bun .claude/skills/testflight/asc-builds.ts --latest-build
dotenvx run -f .env.development -- bun .claude/skills/testflight/asc-builds.ts --wait --version 1.2.0 --build 27
```

## Artifact checks

The inspector unpacks the IPA privately and verifies:

- Deep code signature validity and actual signed application/team identifiers. An empty signed entitlement dictionary cannot borrow identity from the provisioning profile.
- Exact signed `webcredentials:skipper.fm`. Substring matches and profile wildcards do not establish actual app claims. The profile may authorize domains with either an array or Apple's scalar `"*"`; only the profile authorization check normalizes this shape. [Apple TN3125](https://developer.apple.com/documentation/technotes/tn3125-inside-code-signing-provisioning-profiles) distinguishes the profile allowlist from the signed entitlements.
- The first signed Keychain group equals `L24UJYJ5DK.fm.skipper.app`. When the groups entitlement is legitimately omitted, the default derives only from the signed application identifier. Profile permissions are checked separately against the signed claims.
- Production distribution entitlements, bundle/version/build, minimum iOS version, canonical production API URL, SDK keys, and the bundled PostHog host against frozen configuration. Development ATS exceptions are rejected.
- Presence of the app's privacy manifest. The broader manifest declaration audit remains part of native release acceptance.
- Known React Native, Hermes, and Expo filenames, dynamic dependencies, and symbol markers in every embedded Mach-O, including innocently named frameworks and extensions. RCT symbol prefixes use case-sensitive token boundaries so Apple's `ArcToPoint` APIs do not match. `otool`/`nm` failure aborts inspection. Receipts report the binaries and marker results; this scan does not claim proof about stripped or obfuscated code.
- Every main executable architecture UUID has matching archive dSYM coverage.

Export options must request App Store distribution for the expected team and export locally. Apple-managed version changes are forbidden. Export never uploads directly. Only the subsequently inspected IPA is passed to `altool`; its hash is rechecked before validation and upload.

## Symbols and completion

The native PostHog CLI can exit successfully after finding no bundles, skipping processing failures, or skipping oversized payloads. Conflicting existing content and release-association fallback also cannot establish correct symbolication. Therefore CLI exit zero is recorded as **pending verification**, never `uploaded`.

A complete symbol receipt binds the source commit, version/build, archive and IPA hashes, every expected architecture UUID, matching downloaded thin-DWARF content hashes, and release association. Missing read scope or missing content leaves release acceptance incomplete. `scripts/ios-symbols-eas.ts` prepares an allowlisted local stage containing symbols and the macOS worker; it never sends the application source tree or a bearer download URL to the job.

The release pipeline verifies that the prepared manifest names its exact source, configuration region, project IDs, and artifact hashes. After the workflow returns, it independently calls the authenticated EAS verifier again to read current workflow status and fetch its receipt artifact. Offline receipt validation alone is insufficient. It rehashes both archive and IPA after preparation, after verification, and before Apple validation/upload. The release record retains the manifest hash, receipt path, and workflow/job/artifact identifiers.

`--symbols-receipt` resume is deliberately unsupported. A new archive/export produces different bytes even for the same source commit, so an old receipt cannot authorize a rebuilt artifact. Symbols preparation, execution, verification, and Apple delivery use the retained artifacts within one invocation.

Apple validation/upload success proves ingestion only. The upload step invokes `altool` with `--output-format json` and extracts the Apple delivery UUID by validating structured JSON `details.delivery-uuid` against strict UUID format using the exported `UUID_REGEX` constant (`/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/`) and reconciling with plaintext `stderr` output. Any malformed JSON-looking stdout fails closed even if stderr contains a UUID. Conflicting, malformed, or missing receipt claims fail closed, and an unextracted or 'unknown' receipt is never accepted as verified. If receipt verification fails after an upload has succeeded, the pipeline persists `uploadedAt`, the ASC readiness outcome, and the explicit receipt failure with `shipped=false` (`UPLOADED — RELEASE VERIFICATION INCOMPLETE`) to the release record before rethrowing, ensuring the record is never lost and the upload is never retried; if ASC readiness polling also fails, the sanitized ASC diagnostic is retained in the release record and rethrown error without leaking tokens or secrets. The ASC verifier must find the exact marketing version and build, `processingState=VALID`, `internalBuildState=IN_BETA_TESTING`, and answered export compliance. Missing, processing, invalid, failed, or expired builds are not ready. Numeric enumeration follows trusted ASC pagination until completion or fails at its safety limit; it never treats a truncated list as a known maximum.

`SHIPPED TO TESTFLIGHT` requires the delivery receipt, ASC readiness, passed checks, and verified symbols together. An uploaded but incompletely verified artifact is labeled accordingly; it is never mislabeled as not uploaded or complete.

## Records and validation

Each output directory contains the archive, exported IPA, `ipa-sha256.txt`, `snapshot.json`, `inspection.json`, and `release-record.md`, plus logs for local commands actually executed. EAS mode also retains `symbols-stage/manifest.json` and `symbols-receipt.json` with authenticated workflow references. Archive hashing uses the adapter's exported `ARCHIVE_HASH_CONVENTION`: canonical sorted paths, directory entries, file byte hashes/sizes/executable bits, and safe symlink targets, excluding timestamps, ownership and absolute paths. Snapshot configuration values are hashed, not printed. Historical Expo/EAS release evidence stays historical.

Before checkout cleanup, the release retains newly produced `.scratch/ios/Test-<timestamp>.xcresult` directories from its `ios:check` invocation under `native-test-results/`. This happens on success and failure. `native-check-evidence.json` records the actual command exit code (or null if the runner did not return), retained relative paths and content hashes, source/configuration identity, and retention failures. A failed check remains failed even if a bundle was retained; a failure before result creation records an empty list. Pre-existing bundles, surrounding scratch files, links and special files are excluded. Unsafe or incomplete copies stop the release. Later release records include the retained paths; the failed-check receipt remains available even when archive preparation never starts.

Relevant regression checks are:

```bash
bun test ./scripts/test/ios-release.test.ts
bun run typecheck:scripts
bun run check
```

Executed evidence on 2026-09-12: release suite **74/74** (347 assertions), root script suite **278/278** (806 assertions), and the full root check passed. Logs are `.scratch/ios/release-xcresult-tests.log` and `.scratch/ios/release-xcresult-root-check.log`. Independent code review found no remaining high/medium issue in the reviewed release scope. These are local fixture/check results, not proof of actual Xcode result retention, Apple signing capability, remote symbols, or TestFlight availability.

Tests use temporary Git repositories, a local file dependency, generated configuration, real ZIP/plist parsing, and the actual inspector with simulated signing/tool boundaries. Release integration tests simulate the EAS boundary and prove exact artifact binding, fresh verification ordering, mutation rejection, and delivery gating. The separately owned adapter tests cover remote evidence parsing. Tests never archive, upload, or contact Apple, EAS, or PostHog. Explicit Bun test paths avoid the filename-filter subprocess-output issue documented in the guard tests.
