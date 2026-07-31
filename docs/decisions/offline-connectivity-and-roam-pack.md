# Working without internet — the connectivity verdict and the roam offline pack

**Status:** BUILT 2026-07-30 (founder ask 2026-07-31 in `TODO.md`, surveyed before building). Three
steps shipped in order: connectivity awareness (`67f408b`), the roam offline pack + hardening
(`be27184`), and the saved-manifest migration seam. Unverified on a real device — see *Still open*.

## The problem, as surveyed rather than assumed

A downloaded DRIVE was already offline-complete and well-hardened, and was not the gap. The gap was
in three other places:

1. **The app had no idea whether it was online.** `expo-network` was a dependency imported only as a
   Metro lazy-bundling workaround. `errorMessage` collapsed every non-`ApiError` into one in-voice
   line, so "you're offline" was indistinguishable from a 500 — and the rider got a retry button that
   could not work. Worse, every dead-zone fallback in the app was keyed on a FAILED fetch, so each
   one first paid the full 15 s request timeout. A cold start in a dead zone was ~15 s of skeletons,
   then the saved drives; tap one, ~15 s more. It felt broken twice before it worked.
2. **Roam was 100% online-only** — the anonymous front door and the daily mode, on exactly the roads
   with no bars. The session could not start, nothing cached the pin set, and clips were streamed and
   never saved. Sim mode was no escape either: the manifest fetch sat below the sim branch
   unconditionally, so roam could not be QA'd without a live network at all.
3. **A `MANIFEST_VERSION` bump silently destroyed every saved download.** Already happened twice.

## Decisions

### The verdict is push-only, fails open, and self-heals

One app-wide answer (`apps/mobile/src/lib/connectivity.ts`), fed ONLY by `addNetworkStateListener`
events. `api.ts` throws `OfflineError` instead of attempting a request the device cannot carry, which
is what turns every existing fallback instant without any of them changing shape.

Everything rests on one asymmetry: **a false OFFLINE verdict is catastrophic** (every request
short-circuits and the app is bricked with signal in hand), while a false ONLINE verdict costs only
the timeout we already paid. So an `undefined` field is UNKNOWN rather than "no", and having never
observed an event reads as ONLINE — a missing or broken native module degrades to exactly the old
behaviour rather than to a dead app.

### ⚠ Three native landmines — do not undo these

Found by reading expo's native source, not its documentation. Each one would have shipped as a bug.

1. **`getNetworkStateAsync()` is never called.** In `expo-network/ios/NetworkModule.swift`, with no
   path in hand it spins up a TEMPORARY `NWPathMonitor` and blocks a global-queue thread on a
   semaphore for up to 5 seconds — and on TIMEOUT returns `isConnected: false`. It can both stall and
   FABRICATE an offline verdict. The first design used it to "confirm" a stale snapshot before
   short-circuiting; the source says that is precisely the one thing it must not do.
2. **The listener is registered once and never removed.** The module starts `NWPathMonitor` in
   `OnStartObserving` and CANCELS it in `OnStopObserving`, and a cancelled `NWPathMonitor` is final —
   restarting the same instance is a no-op. Losing the stream once loses it for the process. This is
   also why expo-network's own `useNetworkState()` hook must not be used in a component: mount /
   unmount IS an add/remove cycle.
3. **It is armed from `index.js`, above `expo-router/entry`.** expo-modules-core's
   `removeAllListeners` fires `stopObserving` whenever the prior listener count was ≥ 1 — NOT only
   when it reaches zero (`common/cpp/EventEmitter.cpp`; `removeListener` beside it checks correctly).
   `@better-auth/expo` registers and tears down its own network listener. Arming first and holding
   the count above zero is what stops someone else's teardown taking our stream with it.

Because none of that is guaranteed, an offline verdict is trusted for `OFFLINE_TRUST_MS` and then
PROBED: the next request goes through for real and re-arms the window, and any successful response
clears a stale verdict outright. ⚠ It is deliberately **not** a plain expiry — parked in a dead zone
no new events arrive, so a TTL would go stale and stay stale, switching the feature off exactly where
it earns its keep.

`signDriveAudio` is the ONE call that opts out of the pre-flight. It runs from `useDrive`'s mid-drive
stall watchdog, where a failed re-sign skips the stop and the skip is guarded on `!sawFresh` — so the
seconds that call spends waiting are a real second chance for a slow-but-alive clip to save the stop.
There the request timeout is the feature, not the cost.

### Offline is a NUDGE, never a block

The home CTAs were dimmed in the first cut and then un-dimmed. Three reasons: the tap now costs ~0 ms
and lands on an honest in-voice surface, so the problem the block solved was already gone; every
comparable call in this repo is a nudge ("never strand a rider mid-Tahoe", "Start anyway"); and with
the roam pack, **Ride Along genuinely works offline**, so dimming it would have been a lie — and
dimming the anonymous front door contradicts what roam is for. The one control still disabled offline
is Settings' *save the stories*, where the whole action IS the request.

### The roam pack is ONE artifact: pins AND audio

`apps/mobile/src/lib/roam-pack.ts`. ⚠ Pins and audio ship together, enforced by `playablePins`. A
cached pin whose bytes never landed would fire its trigger, buffer for `CLIP_STALL_MS` and skip in
silence — a rider watching a sheet spin, which is worse than an honest error. Only pins with audio on
disk are ever narrated from a pack.

- **No credential on disk, by TYPE.** The pack persists `Omit<RoamPin, 'url'>` and rebuilds `file://`
  at read time, so persisting a presigned URL is a compile error rather than a thing to remember.
  Because the reconstituted value is still a `RoamPin`, nothing in `useRoam`'s consumption path had
  to change.
- **Local bytes are preferred even ONLINE**, so a thin-signal stall on a story we already hold is
  impossible and the expired-presign stall class becomes a no-op.
- **Point + radius, not region.** `GET /roam` offers nothing else — no bbox, no region parameter,
  `radiusKm` capped at 100 server-side — and the client's region concept carries no coordinates.
- **⚠ A presigned URL lives ~1 h and they all expire at once**, so a ~138 MB pull on thin cellular
  can outlive its own credentials. The run re-fetches the manifest ONCE for the stragglers. Verified
  bytes are never re-pulled, so a canceled or partial save resumes.
- **The anchor is wherever the rider last rode**, which is why the Settings control needs no location
  permission of its own. The pack refuses to move that anchor once audio exists — a drive to another
  basin must not silently orphan the download.
- **Freshness is age-based only.** A roam pin carries no `revisedAt` (unlike `driveClip`), so there
  is no content diff available; `PACK_TTL_DAYS` is a soft nudge, never a block.

Sizing is why this was a checkbox and not a project: measured, the entire rider-reachable corpus is
238 clips / 293 min / ~138 MB. A few podcast episodes.

### A saved manifest MIGRATES; it does not silently vanish

The old gate was `version !== MANIFEST_VERSION → null`, and all seven callers read null as "never
downloaded". An app update therefore retired every saved drive: gone from the offline list,
error-walled in a dead zone, and the live player silently downgraded to streaming — while the audio
stayed on disk, unreachable and unswept, and included in iCloud backups. It had already happened
twice (v2→v3, v3→v4), so the leak is retroactive, not hypothetical.

Now: an additive change gets an entry in `MANIFEST_MIGRATIONS`, not a bump-and-wipe. The walk itself
(`migrateToVersion`) is pure and unit-tested, because it is what stands between an app update and a
rider's saved drives. Only a genuine shape break may invalidate — and even then the bytes stay
reclaimable, because `downloadDirState` reports "there is a download here I can't read" independently
of the version gate. That last part fixes the sharpest edge of the old behaviour: the only reclaim
affordance ("Remove download") was gated on `downloaded`, i.e. unreachable in exactly the case where
the rider needed it.

### REPAIR beats sweep — the expensive half survives

Follow-up 2026-07-31. An orphaned download is not one thing, and the classes differ in the only way
that matters — whether the data is recoverable:

| Class | Cause | Recoverable? |
|---|---|---|
| **A** un-migratable manifest | a version bump with no migration (the retroactive v2/v3 case) | yes — by shipping the migration later |
| **B** missing/corrupt manifest | a hard kill mid-download (`runDownload`'s catch sweeps; a SIGKILL doesn't run it) | yes — by repair |
| **C** drive deleted elsewhere | deleted on another device; this one never learns | no |
| **D** pack intra-dir orphans | a place leaves the corpus; its clip file stays | no |

For A and B, deleting throws away the EXPENSIVE half (hundreds of MB, minutes of transfer) to fix
the CHEAP half (a few KB of re-fetchable JSON). The clip files are named deterministically from the
seq, so a fresh manifest is all that is needed to adopt them again. `repairDownload` does exactly
that, and is **non-destructive** — it only ever writes a manifest, so a repair that turns out wrong
costs nothing, unlike a sweep. It is safe on older bytes too: `savedAt` is taken from the download's
mtime (a repaired copy must not read as freshly pulled, or the freshness TTL is silently reset), and
the existing content diff still flags a superseded cut and offers the re-pull afterwards.

Class D was a leak introduced by the pack itself: keeping already-verified bytes (so a canceled save
resumes) while rebuilding `clips` from the current pin set stranded files that nothing referenced —
invisible to the size readout, reclaimable only by removing the whole pack. Now swept after each
save.

### Sweeping what is no longer the rider's — BUILT; sweeping on unreadability — still NOT

Two objections were raised against a sweep, and they turned out to apply to **different triggers**.
Founder call 2026-07-31 — *"switching accounts and getting data deleted is acceptable"* — resolved
the one that blocked the safe trigger.

**BUILT: sweep on ownership evidence.** Two paths, because one of them has to work offline.

- `sweepUnknownDownloads(keep)` deletes any download the caller's drive list doesn't mention — a
  drive deleted on another device, or another account's. ⚠ Sound only because `GET /drives` has NO
  limit and NO pagination (`drives.ts` selects every non-deleted row for the user), so absence really
  is absence. ⚠ And only ever called after the fetch SUCCEEDED: the function cannot tell an empty
  list from a failed one, so calling it from a catch would wipe every saved drive in a dead zone.
  That guarantee lives at the call site (`app/index.tsx`), and is stated at both ends.
- `reconcileDownloadOwner(userId)` records which account the downloads belong to and deletes them all
  when it changes. This is what makes the accepted behaviour true OFFLINE, where no authoritative
  list exists — without it, a rider signing in as somebody else in a dead zone would still see and
  play the previous account's saved drives, because `listDownloadedDrives` reads every dir regardless
  of owner. It runs BEFORE anything reads the disk, and never sweeps on first sight of an owner
  (downloads predating the file have no recorded owner, and whoever holds the phone is their only
  claimant). ⚠ It deliberately does NOT touch the roam pack: roam is the anonymous front door and its
  clips aren't user-owned, so a pack is a property of the DEVICE — re-pulling ~138 MB on an account
  switch would be real cost for no ownership reason.

`driveIdsToSweep` (the set math both use, including the in-flight exclusion — sweeping a download
mid-write would break a good copy) is pure and unit-tested, because it decides deletions.

**NOT built: sweeping on unreadability.** The other objection stands and is unaffected by the
founder call, because it is not about ownership: **a sweep converts a recoverable mistake into an
unrecoverable one.** Ship a version bump without its migration → sweep at launch → hotfix the
migration a day later → the data is already gone, on rider hardware, with no undo. The migration
table is empty and there have been two bumps already. `repairDownload` covers that case
non-destructively instead, which is the better answer regardless.

## Deliberate non-goals

- **Better Auth's transport is NOT covered.** `authClient` has its own fetch (`src/lib/auth.ts`), so
  sign-in / sign-up / password-reset / update-user / delete-user get no `OfflineError`, no offline
  line, and no timeout at all — offline they hang on RN's untimed fetch and then print the generic
  line. Named here rather than left silent; wiring a custom `fetch` into `createAuthClient` is the
  fix when it is worth doing.
- **No automatic sweep of orphaned downloads.** Reclaiming tens of MB of rider-owned audio without
  asking is destructive under the post-1.0 posture, so it stays rider-initiated — and the two
  reasons above make deferring it the safer call rather than merely the politer one. Repair covers
  the recoverable classes without deleting anything.
- **Offline map tiles.** The player opens on List when offline instead; real offline tiles are not
  cheap and List is already the offline- and accessibility-complete equivalent.

## Still open

- **Device verification.** None of this has run on a real device. Specifically worth checking: a cold
  launch in airplane mode (the listener arms at import, but home's `load()` may still beat the first
  pushed event — if it reproduces, the bounded fix is a one-time race against a ~250 ms delay inside
  the FIRST `fetchJson` only, never an await on the native state call), and a real Tahoe drive on a
  saved pack.
- **Class-A/B leftovers are still only rider-reclaimable.** Repair fixes them non-destructively when
  online; offline, an un-repairable download sits there until the rider taps Remove. A Settings
  "free up space" line (consented, and it makes the problem visible) is the remaining option — an
  age gate via `Directory.info().modificationTime` would work but still deletes without consent, and
  carries the hotfix-foreclosure risk above.
- **A residual visibility window, now narrow.** `reconcileDownloadOwner` closes the account-switch
  case at the point of sign-in, but downloads that predate the owner file have no recorded owner and
  are claimed by whoever is signed in when it is first written. Stamping the owner into each manifest
  (additive — no version bump needed, given the migration seam) would close it completely.
- The mid-session dead-air cost (~24 s per encounter) is unchanged for a clip the pack does NOT hold.
