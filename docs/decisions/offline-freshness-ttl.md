# Offline-download freshness TTL (soft, time-based)

**Status:** ✅ **BUILT 2026-06-19.** `OFFLINE_TTL_DAYS = 30` + `isDownloadExpired` in
`apps/mobile/src/lib/offline.ts` (pure date math in offline-util's `isPastTtl`/`daysSinceIso`,
unit-tested); the drive-detail screen shows a "Saved a while back" chip + a
"Refresh the download" ⋯ action when a saved copy is past the TTL. SOFT (never blocks playback).
No manifest-version bump (reuses the existing `savedAt`). Founder ask 2026-06-16.

## Why

Offline downloads never auto-refresh — the device keeps its saved bytes indefinitely. The existing
content-diff (`isDownloadStale` + the "Fresh cut ready" chip) only catches drift **if** the rider
re-opens the detail screen **while online**. A drive downloaded once and never re-opened — or held in
a dead zone — can carry stale facts (a `facts_hash` move), a superseded clip (`patch-clip` /
`resynth`), or a baked Places break-name forever. The TTL is the **time-based safety net independent
of the content-diff**: it fires even when the device never got to compare.

## Decision: SOFT, not hard

The download stays **playable** past the TTL; expiry only surfaces a more-insistent nudge (a warm
chip + a ⋯ re-pull) than the content-diff chip. This honors the never-strand-a-rider-in-a-dead-zone
posture (CLAUDE.md): a rider mid-Tahoe with an "expired" copy must still hear their drive. Go HARD
(refuse offline play past TTL) only if licensing / Places-ToS ever demands a guaranteed-fresh ceiling
— not the case today.

## Mechanics

- **30 days** is a starting value, ear/usage-tunable like the facts TTL — one constant in `offline.ts`.
- `isDownloadExpired(driveId)` reads ONLY the saved manifest's `savedAt` (zero network), so it works
  in a dead zone (unlike `isDownloadStale`, which needs a freshly-fetched manifest). The drive screen
  computes it in the focus effect alongside `isDriveDownloaded`, so it's offline-safe by construction.
  The date math is the pure `isPastTtl(savedAt, now, ttlDays)` in `offline-util.ts` (unit-tested;
  strict `>` so the exact boundary isn't expired, fail-open on an unparseable timestamp).
- **No manifest reshape / version bump:** `OfflineManifest.savedAt` is already stamped at download
  time, so the TTL reuses it. (A future change that needs a distinct `downloadedAt` would bump
  `MANIFEST_VERSION` and treat a pre-field download as expired — same pattern as the v2→v3 migration.)
- A fresh pull (full or partial) re-stamps `savedAt`, clearing the expired state.

## Not in scope

The **per-clip diff** (re-pull only the changed clips instead of the whole drive) stays post-MVP —
a re-pull still re-downloads every clip. See TODO "Offline downloads: full re-pull only".
