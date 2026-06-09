# Handoff: Build Phase 3 — offline tour download (Skipper phone player)

> A self-contained brief for the session that builds Phase 3. Pairs with
> `docs/gps-player-spec.md` (the full player spec). Read CLAUDE.md first — it governs
> workflow, invariants, and tooling.

You're working in the Skipper repo (`/Users/ptshih/code/skipper`) — an AI-narrated,
GPS-triggered driving audio tour, bun monorepo. Optimize for charm; the persona is the
product.

## Where this sits

M1 is the phone player (the whole bet). Already built: **Phase 1** (the `@skipper/drive-core`
trigger engine), **Phase 2** (the live GPS-driven player on a SIMULATED fix source —
`app/drive/[id].tsx` + `src/lib/useDrive.ts` + `src/lib/gps.ts` all exist; do NOT recreate
them), and the couch/sim **preview** player (`app/preview/[id].tsx`). Your job is **Phase 3:
download a complete tour to disk so it plays with ZERO network** — mandatory because Tahoe
has dead zones (offline-first is a hard product requirement, not a nice-to-have).

**NOT in scope** (later phases, don't do them): ducking the rider's music / `'duckOthers'`
(Phase 0, needs a dev build), real `expo-location` GPS (Phase 4), the real drive (Phase 5).

## Goal & acceptance

After signing a tour's audio, download every clip's BYTES to persistent storage + write a
manifest; gate "Start drive" on download-complete + verify-on-disk; the player prefers the
local `file://` and falls back to the presigned URL (re-signing if the 1h TTL lapsed).

**ACCEPTANCE (couch-testable, no car):** download a tour online, enable airplane mode, then
the full SIMULATED drive plays end-to-end from disk with zero network.

## The data + offline contract (current — verify line numbers, they drift)

- `GET /tours/:tourId` → `tourDetail` DTO: `{ tour, corridor{name,region,polyline}, host, stops[] }`.
- `POST /tours/:tourId/assets/sign` → `{ urls: [{ seq, url, contentType, durationMs }] }`,
  one presigned R2 GET per stop with audio. **Presign TTL = 1 hour.**
- **`contentType` is the clip's MIME** (e.g. `audio/mpeg`), derived server-side from the R2
  key. USE IT to pick the on-disk extension (`audio/mpeg`→`mp3`) — do NOT hardcode `.wav` or
  parse the presigned URL. This field exists specifically for you (added in commit `e12d14d`).
- Store at `Paths.document/tours/<tourId>/<seq>.<ext>` (persistent — NOT `Paths.cache`, which
  the OS can evict). Write `manifest.json`: tourId, a version/generatedAt, polyline, stops,
  and per-seq `{ file path, contentType }`.
- Gating is real: a non-preview tour needs a signed-in (free) account at prep time (the
  `/tours` + `/sign` tier check already enforce it — don't re-implement, just surface errors).

## Files

**READ:** `docs/gps-player-spec.md` (§4 the offline contract, §7 Phase 3, §8 the verified
SDK-56 API reference, §9 file map — all current as of this handoff). `app/preview/[id].tsx`
(REUSE its clip-load + stall-watchdog `CLIP_STALL_MS` + `resign()` re-sign pattern — for
offline, local `file://` is preferred and re-signing becomes the online fallback).
`src/lib/api.ts` (`getTour`, `signTourAudio`). `src/lib/useDrive.ts` + `app/drive/[id].tsx`
(the sim drive player you'll make local-first).

**CREATE:** `apps/mobile/src/lib/offline.ts` (download + manifest + verify-on-disk + a "is
this tour downloaded?" check). Wire a download step + progress UI that gates "Start drive",
and make the clip loaders (`player.replace({ uri })`) prefer the local file when present.

## Before you code (repo norm — CLAUDE.md): verify deps/APIs against docs, don't assume

- `expo-file-system` is NOT yet a dependency. Add it via `bunx expo install expo-file-system`
  and DECLARE it explicitly (mobile is on bun's isolated linker — undeclared phantom deps
  red-box; see the mobile-workspace memory). expo is pinned `~56.0.9`.
- The spec §8 documents the SDK-56 new OO API (`import { File, Directory, Paths } from
  'expo-file-system'`; `File.downloadFileAsync(url, dir)`; `Paths.document`; `file.exists`,
  `file.delete()`; legacy `createDownloadResumable` for progress). RE-VERIFY against
  <https://docs.expo.dev/versions/v56.0.0/sdk/filesystem/> before relying on it.
- `expo-audio` plays a local `file://` URI exactly like an https URL (confirmed in §8).
- Download with a concurrency cap (don't fire N requests at once). Handle partial-download
  failure: verify each file on disk (exists + nonzero) before marking the tour ready; a
  half-download must NOT let "Start drive" through.

## Verification

`bun run typecheck` and `bun run test` at root; `bun run check` in `apps/mobile`
(lint:tokens + typecheck + test) — all must pass. The CODE is writable + typecheckable solo,
but the runtime acceptance (airplane-mode plays from disk) needs a native EAS/`expo run:ios`
dev build, since expo-file-system + expo-audio are native modules (Expo Go can't run them).
If no dev build exists yet, build + typecheck + unit-test the logic and flag that the
on-device acceptance is pending a dev build.

## Workflow (CLAUDE.md)

bun everywhere; internal packages export `.ts` source. Use the `@/ui` primitives + theme
roles, never raw hex/font (lint:tokens enforces). Commit directly to `main` ONLY when the
human asks — do NOT create/switch branches without explicit confirmation (multiple agents
share this tree). Narrate progress; restate results in text.
