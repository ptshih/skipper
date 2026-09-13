# Native iOS symbols through EAS

**Status** — 2026-09-12: independent Astra adapter/integration review cleared; local checks and exact
Node 22.19.0 compatibility passed. No real EAS workflow or PostHog upload/readback has run; the
production secret's read permission remains unverified. Operational standby: await full native QA,
the immutable source commit and final release archive before explicitly authorized cloud execution.

The native release pipeline can use an isolated macOS EAS job to upload dSYMs without bringing the
PostHog secret onto this computer. `scripts/ios-symbols-eas.ts` prepares the job locally, executes it
only when explicitly called, and verifies its actual EAS artifact. The approved integration is
`--symbols-eas` within the same archive/export/inspection/delivery pipeline. There is no standalone
resume or artifact-reuse command.

## API and release integration

The module exports these operations; `CommandRunner` matches the release owner's existing injectable
runner `(command: string[], options?: { cwd?, env?, logPath? }) => Promise<{ exitCode, stdout, stderr }>`.
Default commands use argument arrays, never a shell. They capture output without printing it or
writing raw command logs because errors can contain credentials or signed download URLs.

```ts
const archiveSha256 = await hashArchive(archivePath)
const ipaSha256 = await hashFile(ipaPath)
const prepared = await prepareEasSymbols({
  sourceCommit,
  version,
  buildNumber,
  bundleId: 'fm.skipper.app',
  archivePath,
  ipaPath,
  expectedArchiveSha256: archiveSha256,
  expectedIpaSha256: ipaSha256,
  easProjectId,
  posthogProjectId,
  stagingDirectory, // New, absolute, separate directory; never the repository.
  runner,
})
// The caller preserves prepared.manifest and prepared.manifestSha256 in its release record.
await executeEasSymbols(prepared, { receiptPath, runner })
const proof = await verifyEasSymbolsReceipt(receiptPath, prepared.manifest, {
  runner,
  cwd: prepared.stagingDirectory,
})
// Immediately before Apple delivery, compare hashArchive/hashFile with the same original hashes.
```

`PrepareEasSymbolsOptions`, `PreparedEasSymbols`, `SymbolsManifest`, `SymbolsReceipt`,
`EasSymbolsReceiptRecord`, `VerifyEasSymbolsOptions`, and `AuthenticatedSymbolsVerification` are
exported. `posthogHost` optionally selects the official US or EU host; US is the default. IDs and
release fields are nonsecret and strictly validated. The PostHog token is not an argument.

The release owner supplies the exact source commit from its verified source snapshot. An xcarchive
cannot independently establish which Git commit produced it. This adapter binds the supplied commit
to the inspected archive/IPA hashes; the surrounding pipeline owns source provenance, signing,
entitlements, and delivery checks. It must not construct its expected identity from an untrusted
receipt. Preparation checks the archive metadata, archived app metadata, exported app metadata, and
app executable architecture UUIDs agree, then requires an app dSYM for every app architecture.

## Deterministic archive identity

`hashFile(ipaPath)` is SHA-256 of the exact IPA bytes. `hashArchive(xcarchivePath)` exports the
`sha256-canonical-tree-v1` convention, including every entry under the archive root:

- Directory: `{ path, type: "directory" }`.
- Regular file: `{ path, type: "file", size, executable, sha256 }`, where `executable` is
  `stat.mode & 0o111` and `sha256` hashes the exact file bytes.
- Symlink: `{ path, type: "symlink", target }`, where `target` is the literal link text. Links must
  be relative, resolve successfully, and remain inside the archive. Special files are rejected.

Paths are relative, use `/`, and entries sort by JavaScript string order on `path`. The final digest
is SHA-256 of canonical JSON `{ convention: "sha256-canonical-tree-v1", entries }`: recursively sorted
object keys, preserved array order, no whitespace/newline. Root name, timestamps, owner/group IDs,
and non-executable permission bits are excluded. Empty directories and executable bits are included.
The helper is the source of truth; release code should import it rather than copy this algorithm.

`manifestSha256` hashes the same canonical encoding of the complete manifest. The manifest binds
source/version/build/bundle, archive hash, IPA hash, dSYM ZIP hash, both project identities and host,
pinned CLI version, worker/Python source hashes, each ZIP file's path/size/hash, and every UUID's
architecture, DWARF path, nonempty thin-slice size and SHA-256. Universal binary hashes are not used
as individual architecture identities.

## What leaves the computer

Preparation creates exactly nine files: `.easignore`, `.eas/workflows/symbols.yml`, `app.json`,
`eas.json`, `package.json`, `manifest.json`, `symbols.zip`, `worker.ts`, and `archive.py`. `app.json`
contains only public existing project identity. The private, dependency-free package has no app
runtime. The symbols archive contains dSYM `Contents/Info.plist` and `Contents/Resources/DWARF/*` only.
Source files, the IPA, xcarchive, repository, signing material, `.env`, and credentials are not staged.
DWARF itself can contain compiler source paths and debug metadata.
Standard Apple relocation maps under `Contents/Resources/Relocations/<arch>/<binary>.yml` are
accepted as ordinary source files but excluded from the stage. The generated-bundle regression
prepares a real dual-architecture `dsymutil` bundle, including its `aarch64`/`x86_64` relocation maps,
and verifies that only Info.plist and DWARF files enter the ZIP. A relocation symlink still fails.

`.easignore` is an explicit allowlist. Before submission the adapter also enumerates the stage,
rejects additional files and links, compares all prepared bytes, regenerates configuration, and
checks the worker against this reviewed source. The ZIP reader validates all entries and hashes
before extraction, rejecting traversal, absolute paths, backslashes, duplicates/case collisions,
links, special files, encryption, and excessive entry counts or expanded size. It extracts only
into a newly created directory. The remote worker repeats the ZIP and thin-slice checks before
any PostHog call.

`executeEasSymbols` invokes pinned EAS CLI with `EAS_NO_VCS=1`, absolute `EAS_PROJECT_ROOT` equal to
the stage, and `workflow:run symbols.yml --non-interactive --wait --json`. It supplies no `--ref`,
external download input, `-F` value, app build, or client runtime. Only the local minimal stage is
uploaded. This follows the [tagged EAS run implementation](https://github.com/expo/eas-cli/blob/v24.3.0/packages/eas-cli/src/commands/workflow/run.ts).

## Remote upload and proof

The custom job runs on `macos-medium` with environment `production`, `eas/checkout`, and pinned Node
for the standalone worker. It uses the existing `POSTHOG_CLI_API_KEY` EAS secret and public
`POSTHOG_CLI_PROJECT_ID` (legacy `POSTHOG_CLI_ENV_ID` also accepted). It checks the project and host;
it never pulls or prints the secret. The configuration follows [EAS workflow syntax](https://docs.expo.dev/eas/workflows/syntax/)
and [EAS environment visibility](https://docs.expo.dev/eas/environment-variables/).

The uploader pins `@posthog/cli@0.9.1` and invokes:

```sh
npx --yes @posthog/cli@0.9.1 --dry-run=false dsym upload --directory symbols \
  --release-name fm.skipper.app --release-version VERSION --build NUMBER
```

It omits conflict/force/no-fail/source options. `RUST_LOG=info` ensures processing and warning evidence
is available. The parser requires the exact expected UUID set/count, completion message, intended
release name/version/build, and no warning/error, empty/skipped processing, or release-less fallback.
A conservative 99 MiB limit per thin slice leaves room below the CLI's 100 MiB upload skip threshold.
These checks address the tagged [dSYM uploader](https://github.com/PostHog/posthog/blob/posthog-cli/v0.9.1/cli/src/dsym/upload.rs)
and [symbol API's filtering/fallback](https://github.com/PostHog/posthog/blob/posthog-cli/v0.9.1/cli/src/api/symbol_sets.rs).

For every expected UUID, it then runs `symbol-sets download --ref UPPERCASE_UUID --output readback`.
It checks `readback/UUID/dwarf` is an ordinary file, verifies UUID/architecture with `dwarfdump`, and
compares the thin DWARF bytes' SHA-256 and nonzero size with the local manifest. `lipo` failures fail
closed. A missing read permission, missing file, wrong architecture, or different bytes prevents a
receipt. This matches the tagged [slice encoding](https://github.com/PostHog/posthog/blob/posthog-cli/v0.9.1/cli/src/dsym/mod.rs)
and [download implementation](https://github.com/PostHog/posthog/blob/posthog-cli/v0.9.1/cli/src/download.rs).

There are deliberately two different validation results:

- `validateSymbolsReceipt(receipt, expectedManifest)` performs **offline structural validation**.
  It checks all bindings, re-parses the selected upload evidence, and requires every expected
  readback. A caller could author such JSON; this operation never authenticates a cloud run.
- `verifyEasSymbolsReceipt(path, expectedManifest, options)` performs a fresh authenticated
  `workflow:view` with pinned EAS CLI. It requires the exact project, manifest-bound workflow name,
  successful run and symbols job, no run/job errors, and one named receipt artifact. It downloads
  that artifact using only the URL returned by EAS, validates its bounded JSON or tar.gz contents,
  and compares artifact ID/hash and all receipt bytes with the saved record. Only this returns
  `verification: "authenticated-eas-artifact"`. Test runners/fetchers are injection seams, not proof.

The authenticated proof trusts EAS project access and the reviewed staged worker. It is not an
independent cryptographic attestation against a malicious EAS project administrator. Release
association is established by the pinned upload path's intended release and rejection of its
release-less fallback; there is no invented release ID or independent association API claim.

## Records, failures, and remaining verification

The EAS job uploads `receipt.json` through `eas/upload_artifact` with `type: other`. On failure it
produces only a nonsecret failure record. An `always()` cleanup removes temporary remote symbols,
thin files, readbacks, archive and manifest; EAS workspace destruction handles a forcibly killed VM.
Local original symbols, stage, and release records are retained for investigation. A failed remote
upload may already have stored some symbols; no release success or rollback is inferred.

The local record preserves actual run/job/artifact IDs, artifact hash, manifest and receipt. When
EAS returns a run ID with a failed/canceled/aborted wait, `<receiptPath>.run.json` preserves it without
signed URLs. Exit 0 alone cannot qualify; 11, 12, and 13 are failures, cancellation, and interrupted
waiting respectively. An existing receipt/run record prevents a duplicate execution at that path.
Failures that return no run ID cannot be assigned one; inspect the EAS dashboard before retrying.

Local coverage is `bun test ./scripts/test/ios-symbols-eas.test.ts`, including actual ZIP handling,
stage allowlist and identity rejection, skipped/failed upload evidence, wrong-byte/read-permission
readbacks, EAS failure statuses, forged local receipts, and local clang/dsymutil/lipo slice hashing.
Cloud interactions in these tests are injected. Root `bun run check` remains required.
QA's retained `late-nudge-root-check.log` recorded two failures at Bun's default five-second limit
during real Python fixture preparation, before the injected EAS response. The three wait-status
cases now have explicit, bounded 15-second timeouts with all validation and assertions retained.
Later passing runs do not erase that recorded failure.

Exact Node **22.19.0** local compatibility is now verified with the checksum-matched official
macOS arm64 runtime: the frozen standalone worker imported, its runner executed the Python
archive helper, and its actual `--cleanup` entry ran only on synthetic scratch files. The
isolated npx import also passed offline. The earlier exit-1/empty-output failure remains
unreproduced and retained. See the [local compatibility report](../../.scratch/ios-upgrade/node22-compat-20260912/report.md)
for exact commands, hashes, and receipts. This involved no EAS/PostHog/token operations;
real cloud workflow execution and readback remain unverified.

Context7 was unavailable in this session; implementation used the official vendor documents and
exact tagged source linked above. Independent code review and local checks are complete. The next
action, after full native QA, the immutable source commit and final archive are ready, is explicitly
authorized real EAS execution with actual PostHog readback and fresh EAS verification. No local test
proves the EAS token's read scope or a successful production symbol upload.
