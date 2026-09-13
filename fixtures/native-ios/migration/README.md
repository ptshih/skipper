# Synthetic installed-state fixtures, version 1

Uses the envelope described in `../contracts/README.md` and a fixed clock. No fixture
contains live credentials or audio. `bytes` are nonempty synthetic placeholders for file
presence checks, NOT decodable audio; device decoding must use valid local audio separately.

- `credentials.json`: `input.rows` model generic-password Keychain rows. `accountUtf8`
  and `genericUtf8` are bytes, not String attributes. Read services in order `app:no-auth`,
  `app:auth`, `app`; errors defer rather than pretending a key is absent. Chunk markers use
  U+0001 and named `.0..n-1` keys. Large synthetic values use the installed writer's actual
  1800-character chunk size (ASCII avoids UTF-16 ambiguity). Every native auth write,
  including rotation and cached-session persistence, uses WhenUnlockedThisDeviceOnly.
  Cookie storage is JSON `name -> {value, expires}`, not a bare Cookie header. Drop expired
  cookies individually. Literal `{}` in either known key is an explicit sign-out marker:
  never revive an account from the other key. Only `session.expiresAt > now` permits cached
  offline identity; missing, invalid, equal, or expired timestamps do not.
- `manifests.json`: `input.files` is a virtual Documents tree. Each relative path maps to
  `text` or `bytes`. Materialize only inside a test-owned temporary directory. `manifest`
  repeats the JSON manifest for direct pure-helper input. `verifiedPlacedNames` simulates
  post-move destination verification; it must NEVER be interpreted as permission to mark
  a missing/zero-length file present. v4 tests preserve unresolved fused clips drive-local.
  Preserve savedAt and audioSeqs. URLs are absent or null on disk.
- `gc.json`: caller-level policy cases. `inspection != complete`, an active download, an
  empty keep-set, or unsafe inspection prohibits all GC. Complete inspection may reclaim
  recognized unreferenced files. Unknown filenames remain untouched. The pure orphan helper
  does not implement the caller's guard; testing the helper alone cannot prove safe GC.
- `preferences.json`: actual SecureStore keys and serialized values; public region cache
  is retained. A failed credential migration never invokes sign-out/deletion cleanup.

Interrupted native credential migration must write, read back and verify before deleting
known legacy keys. A rotated credential takes precedence over the old imported cookie.
The credential and fail-closed filesystem scenarios specify required native behavior; they
are NOT claims that the old Expo app already has a native migration coordinator.

Keychain accessibility, signing/access-group continuity and an actual installed-app update
require signed-device evidence beyond these in-memory rows. No v1-v3 manifest recovery is
promised; retain unknown originals for repair instead of deleting them.
