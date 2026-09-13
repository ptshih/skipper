# Frozen legacy oracles — test only

These four pure TypeScript modules preserve the shipped iOS 1.1.0 build 25 source
at `98a292db08950b7db3be08e2a0e5ec971038e20e`. Two are byte-for-byte copies; two
only relocate their shared type import to the retained schema source because this
test directory is outside the mobile workspace's package resolution scope.
[provenance.json](provenance.json) records original paths, Git blobs, source and
frozen SHA-256 hashes, exact import substitutions, and capture HEAD.

The only executable consumer is `scripts/test/native-ios-fixtures.test.ts`.
There are no Expo, React Native, filesystem, network or other runtime imports.
The two shared DTO imports are type-only; public schema compatibility checks still
execute the current retained `packages/shared` schemas. The native app's Debug
resource phase copies three named JSON fixtures, not these modules. The full
fixture directory is also a resource of the XCTest bundle, never the released app.

| Module | Fixture behavior |
| --- | --- |
| `planner-util.ts` | Fragmented SSE framing and say-delta parsing |
| `planner-transcript.ts` | Transcript filtering and wire conversion |
| `anon-session-util.ts` | Anonymous-session mint decision |
| `offline-util.ts` | v4-to-v5 migration, revision tokens, missing clips, start gates and GC candidate names |

Keep whole modules to retain source logic, internal dependencies and their
explanatory comments. Do not modernize them to match Swift or regenerate expected
fixture values from them. A deliberate new baseline requires separately reviewed
provenance and expectations; the validator checks these frozen content hashes.
Do not import these oracles from application code or add them to shipping resources.

Their limits remain unchanged: pure predicates do not establish Keychain IO,
atomic migrations, downloader cancellation, whole-sweep guards or paid-request
idempotency. Actual native service/UI tests supply that evidence. `apps/mobile`
does not need to exist for this retained test dependency graph to run.
