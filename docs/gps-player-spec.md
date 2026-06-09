# M1 GPS Phone Player — Build Spec / Handoff

> Self-contained handoff for the **live, on-device, GPS-triggered phone player** — the
> M1 MVP bet. Grounded against the live repo (`packages/drive-core/src/{trigger,simulate,geo,preview}.ts`,
> `apps/mobile/app/preview/[id].tsx`, `apps/api/src/index.ts`, `packages/shared/src/schemas.ts`,
> `packages/db/src/schema.ts`) and against Expo SDK 56 / RN 0.85 docs (verified, not from memory —
> see §8). Written 2026-06-08. **Symbol names are stable; line numbers drift** (the preview player is
> under active edit) — grep the symbol, don't trust the line.

---

## 0. TL;DR for the next Claude

**The bet:** a rider mounts their phone, starts a downloaded tour, and as they drive the real
roads the Skipper's clips fire at the right places (speed-adaptive lead time), ducking their
music, with lock-screen Now Playing — all offline. CLAUDE.md calls this "the whole bet."

**The one seam:** `TriggerEngine.update(fix)` in `@skipper/drive-core` is a pure, tested function —
feed it one `GpsFix {lat,lng,speedMps,headingDeg}` per tick, it returns the stop(s) that should fire.
Today the **simulated** drive (`generateDrive`) manufactures that fix stream. **Real GPS is the same
stream from a different source** (`expo-location.watchPositionAsync`). No change to the trigger logic.

**What's already done (don't redo):** the trigger core + sim + geo are an importable, RN-safe leaf
(`@skipper/drive-core`); `apps/mobile` is in the bun workspace; the preview player already has the
audio session, lock-screen Now Playing, clip loading, and seek machinery. See §3.

**Where to start:** **Phase 0** (audio-session spike) then **Phase 2** (build the player driving the
*simulated* source — no GPS, couch-testable). §7 is the phase plan. **Build Phase 2 against the sim
source first; swapping in real GPS is Phase 4.** That de-risks everything without a car.

**Scope is LOCKED (do not widen without asking the founder): FOREGROUND-ONLY** — phone on, screen on,
in a mount. No background/screen-off driving, no `expo-task-manager`, no background-location
permission. See §2.

---

## 1. Status — what's done vs. what's ahead

| Phase | What | Status |
|---|---|---|
| **1** | Trigger core importable in mobile, no drift | ✅ **Done** — extracted to `@skipper/drive-core`, mobile in the workspace, `app/preview` imports it (commits `e97c453`, `5025827`) |
| **0** | Audio-session spike: duck music **and** keep lock-screen Now Playing | ❌ not started — riskiest unknown; needs a dev build |
| **2** | GPS-driven player core, fed by the **simulated** fix source | ✅ **Done** — `src/lib/useDrive.ts` + `app/drive/[id].tsx` + `src/lib/gps.ts`; intro/outro bracket playback added (`ecc78a0`) |
| **3** | Offline download (clips → disk) | ✅ **Done** — `src/lib/offline.ts`: download to `Paths.document` + offline-first players (`03a52c6`). On-device airplane-mode acceptance pending a dev build |
| **4** | Real `expo-location` fix source | ❌ not started |
| **5** | Drive it once for real | ❌ not started |

Everything ships through the **phone** (mount / Bluetooth). CarPlay is deferred past the MVP
(see CLAUDE.md "Deferred"). A native EAS/`expo run:ios` dev build is required for any of Phases 0/4/5.

---

## 2. Locked decisions (and the open ones)

**LOCKED:**
- **Foreground-only.** `watchPositionAsync` only runs in the foreground; keep the screen on with
  `expo-keep-awake`. Needs only When-In-Use permission — no background-location entitlement, no
  `expo-task-manager`. (Founder-confirmed 2026-06-08.)
- **Re-snap on device.** The API ships RAW POI coords + the polyline (not the persisted trigger
  point — see §4). The player runs `snapStopsToRoute(corridor.polyline, stops)` at load and drops
  `offRouteM > 700`. Do **not** extend the API; the polyline is already in the tour JSON and the
  route-progress UI needs it anyway.
- **Offline I/O = the new `expo-file-system` `File/Directory/Paths` API → `Paths.document`** (persistent,
  not the evictable cache). Escalate to the legacy `createDownloadResumable` only if you need pause/resume
  progress over flaky pre-drive connections.
- **One swappable `GpsFix` source.** The player consumes a `GpsFixSource` that emits `GpsFix`; the
  simulated source (reusing `generateDrive`) and the live `expo-location` source are interchangeable.
  This makes the on-device **drive simulator** (an M1 deliverable) and the real drive share one code path.

**OPEN (decide as you build; none block Phase 0/2):**
- Heading at low speed: `coords.heading` is null below ~5 mph — derive from consecutive fixes, or
  just let the heading gate skip (it already skips below `headingGateMps`).
- Out-of-order / overlapping fires: GPS can fire stops out of route order, skip one you blew past, or
  fire two close stops together. Policy: a small FIFO queue, play sequentially, drop a stale one if
  you've passed it. `simulate.ts` already computes `Overlap` — reuse its logic.
- Product: the "taste tier" (one great stop auto-playing vs. the full drive) — NOT decided (see the
  `preview-try-without-driving` memory). Out of scope for the mechanics here.

---

## 3. The architecture — the seam + what's reusable

### 3.1 The trigger core (`@skipper/drive-core`, reusable AS-IS — do not modify)

Import everything from `@skipper/drive-core` (the barrel re-exports `geo`/`trigger`/`simulate`/`preview`).

`trigger.ts`:
- `class TriggerEngine` — `new TriggerEngine(stops: TourStopRef[], opts?: Partial<TriggerOptions>)`;
  `update(fix: GpsFix): TriggerEvent[]` (the stops that fired this tick, usually 0 or 1);
  `hasFired(seq)`, `get firedCount()`. **Stateful** — one instance per drive; on restart, make a NEW one
  (it has no reset).
- `GpsFix = { lat, lng, speedMps, headingDeg, tSec, alongM }`. Only `lat/lng/speedMps/headingDeg` matter
  to the fire decision; `tSec` = seconds since drive start (for reported lead), `alongM` = UI only (use 0).
- `TourStopRef = { seq, lat, lng, triggerRadiusM, durationMs?, name?, stopType? }`.
- `TriggerEvent = { seq, tSec, alongM, distanceM, speedMps, leadSec }`.
- Fire logic: skip if already fired → distance ≤ `effectiveRadiusM(triggerRadiusM, speed, leadSeconds)`
  (`= max(triggerRadiusM, speed*leadSeconds)`) → **heading gate** only above `headingGateMps` (2.2 m/s ≈
  5 mph), within a `headingConeDeg` (90°) forward cone → fire.
- `DEFAULT_TRIGGER = { leadSeconds: 12, headingGateMps: 2.2, headingConeDeg: 90 }` → ~322 m lead at 60 mph.
- `snapStopsToRoute(polyline, stops): SnappedStop[]` — moves each stop to its nearest on-route vertex
  (its trigger point) + records `offRouteM`. **Off-route filtering lives in the caller**, not the engine:
  drop `offRouteM > 700` (`DEFAULT_MAX_OFF_ROUTE_M`) before constructing the engine.

`simulate.ts`:
- `generateDrive(polyline, { mph?, tickHz? }): GpsFix[]` — the synthetic fix stream (constant-speed walk
  along the polyline at `tickHz` Hz, default 4 Hz, 60 mph). **This is what the simulated source replays.**
- `runDrive(polyline, stops, opts): SimReport` — the full snap→filter→engine→loop the player mirrors.

`geo.ts`: `haversineMeters`, `bearingDeg`, `angularDiffDeg`, `nearestOnRoute`, `cumulativeMeters`,
`MPH_TO_MPS`. All `[lng, lat]` axis order.

**Tests:** `packages/drive-core/test/*.test.ts` (21 tests) lock the trigger behavior — run `bun test`
in the package after any change near it.

### 3.2 The load-time setup the player writes

```ts
import { TriggerEngine, snapStopsToRoute, type GpsFix } from '@skipper/drive-core'

const snapped = snapStopsToRoute(
  corridor.polyline,
  stops.map(s => ({ seq: s.seq, lat: s.lat, lng: s.lng, triggerRadiusM: s.triggerRadiusM, durationMs: s.audioDurationMs })),
)
const triggerable = snapped.filter(s => s.offRouteM <= 700) // drop honestly-untriggerable off-route stops
const engine = new TriggerEngine(triggerable, { leadSeconds: 12 })
```

### 3.3 The fix → engine adapter (the load-bearing new code)

```ts
// expo-location LocationObject → GpsFix
const fix: GpsFix = {
  lat: loc.coords.latitude,
  lng: loc.coords.longitude,
  speedMps: loc.coords.speed ?? 0,       // null/-1 when stationary → 0 (heading gate then skips, fail-open)
  headingDeg: loc.coords.heading ?? 0,    // null below ~5 mph; derive from consecutive fixes if you need it
  tSec: (loc.timestamp - startMs) / 1000, // startMs captured when the drive begins
  alongM: 0,
}
for (const ev of engine.update(fix)) enqueueClip(ev.seq) // fire each (usually 0–1)
```

### 3.4 The swappable source

```ts
type GpsFixSource = (onFix: (f: GpsFix) => void) => () => void // subscribe → returns unsubscribe
// simulatedSource(polyline, { mph }) — replays generateDrive(...) on a timer (NO GPS; Phase 2)
// liveSource() — watchPositionAsync → GpsFix (Phase 4)
```
Build Phase 2 against `simulatedSource`; Phase 4 only adds `liveSource` and flips which one the screen uses.

### 3.5 The preview player — reuse vs. change (`apps/mobile/app/preview/[id].tsx`)

The preview screen is the couch/sim cousin: it walks a **compressed `buildPreviewTimeline`** on a
`setTimeout` clock. **REUSE its machinery, build a new screen/hook for the GPS clock** (don't bolt GPS
onto the preview timeline). Grep these symbols (lines drift):

**Reusable as-is:**
- **Audio session** — `setAudioModeAsync({ playsInSilentMode, shouldPlayInBackground: true, interruptionMode })`.
  ⚠️ The preview uses `interruptionMode: 'doNotMix'` ("the preview audio IS the content"). The **real drive
  must use `'duckOthers'`** to duck the rider's music — that's the Phase 0 spike (does duck + lock-screen
  coexist?).
- **Lock-screen Now Playing** — `player.setActiveForLockScreen(true, { title, artist: 'Skipper', albumTitle })`
  on clip load; `setActiveForLockScreen(false)` on done/unmount. Background play via `shouldPlayInBackground`
  + the `expo-audio` plugin in `app.json` (already wired) + Android `FOREGROUND_SERVICE_MEDIA_PLAYBACK`.
- **Clip load/play** — `player.replace({ uri })` then `player.play()`; `useAudioPlayerStatus` for state;
  the stall **watchdog** (`CLIP_STALL_MS`) + **re-sign** (`resign()`) for expired presigned URLs (the user
  added these — keep the pattern; for offline you'll prefer local `file://` and re-signing becomes the
  online fallback).
- **Seek/scrub**, **route dot** (`RouteTrack`), **stop list** (`StopRow`), the `voice` microcopy.

**Must CHANGE for the GPS player:**
- **The clock.** Replace the `setTimeout(previewMs)` segment driver with `engine.update(fix)` fed by the
  `GpsFixSource`. No `buildPreviewTimeline`, no compressed gaps.
- **No `didJustFinish` → next-stop advance.** In the preview, a finished clip auto-advances. In the GPS
  player a finished clip returns to **ducked-quiet and waits for the next GPS trigger** — the next stop
  fires from position, never from a clip ending. Reusing the preview's auto-advance verbatim = premature jumps.
- **Linear `idx++` → a fire-queue.** GPS fires by proximity/heading and can go out of order. Queue fired
  seqs, play sequentially, drop a stale one. (§2 open question.)
- **`'doNotMix'` → `'duckOthers'`** (pending Phase 0).
- **Stream → download-then-play** (Phase 3).

---

## 4. The data + offline contract

**Per-stop fields the player gets** (`GET /tours/:tourId`, `tourStopView` DTO,
`packages/shared/src/schemas.ts`): `seq, stopType, name, lat, lng, triggerRadiusM, approachHeadingDeg,
poiContentId, audioDurationMs`. **`lat/lng` are RAW POI coords** (`pois.lat/lng`, 400–650 m off the road) —
the API does **not** return the persisted `triggerLat/triggerLng` (they exist in `tour_stops`,
`schema.ts:~224`, but aren't exposed). → the player **re-snaps** (see §3.2). The corridor `polyline`
(`[lng,lat][]`) comes inline in the same tour fetch.

**Audio** comes separately: `POST /tours/:tourId/assets/sign` → `{ urls: [{ seq, url, contentType, durationMs }] }`
(one presigned R2 GET per stop with audio). **Presign TTL = 1 hour** (`apps/api/src/storage.ts`).
`contentType` is the clip's MIME (e.g. `audio/mpeg`), derived server-side from the R2 key — use it to
pick the on-disk extension; do NOT hardcode the format.

**To drive ONE tour fully offline you must persist:**
1. the tour JSON (polyline + stops) — for snapping + UI with zero network;
2. every clip's BYTES (not the URL — it expires) downloaded while online.
Network to prep: `1× GET /tours` + `1× POST /sign` + `N` audio GETs.

**Offline storage:** `Paths.document/tours/<tourId>/<seq>.<ext>` (persistent), where `<ext>` comes from
each clip's `contentType` in the sign response (`audio/mpeg` → `mp3`) — never hardcoded. Write a
**manifest** (`manifest.json`: tourId, a version/generatedAt, polyline, stops, per-seq file path +
contentType). At playback prefer the local `file://` if present, else the presigned URL (re-sign if the
1 h TTL lapsed). Note: clips are now **32k MP3** (~12× smaller than the old LINEAR16 WAVs — a few MB/tour),
but still budget storage + download time + a progress UI that gates "Start drive". Gating is real: a
non-preview tour needs a signed-in (free) account at prep time (the `/tours` + `/sign` tier check).

---

## 5. In-car landmines (from CLAUDE.md + the research — do not relearn these the hard way)

- **Continuous FOREGROUND GPS, `distanceInterval: 0`, `accuracy: BestForNavigation`.** A 350 m geofence is
  crossed in ~13 s at 60 mph; OS background/throttled GPS misses it. Do speed-adaptive lead in JS;
  `trigger_radius_m` is a FLOOR, not the rule.
- **Foreground watch DIES on background/screen-lock.** Hold the screen on with `expo-keep-awake`
  (`useKeepAwake`) while driving. If the rider backgrounds the app, GPS stops — that's the foreground-only
  boundary (documented; acceptable for the phone-in-mount MVP).
- **Download BYTES, not URLs** (presigned URLs die in 1 h) — write to `Paths.document`, never the evictable
  `Paths.cache`.
- **Don't auto-advance on clip end.** The next stop fires from GPS, not from `didJustFinish` (§3.5).
- **Verify the Android `watchPositionAsync` teardown.** Known bug: the subscription may keep capturing after
  `.remove()` (oven of expo issues #35925/#35926) — confirm GPS actually stops on unmount or you leak
  battery all session.
- **Battery.** Continuous BestForNavigation GPS + screen-kept-awake + background audio is the heaviest load;
  plan for the phone on power in the mount; consider downshifting accuracy when `speed ≈ 0`.
- **Mobile is in the workspace on bun's ISOLATED linker** — every dep the player uses must be **declared**
  in `apps/mobile/package.json` (a phantom/transitive import red-boxes "Object is not a function"). Add deps
  with `bunx expo install …`, not by hand. (See the `mobile-workspace-isolated-linker` memory.)
- **Adding a new `app/*.tsx` route (e.g. `app/drive/[id].tsx`) breaks `bun run typecheck`** until the
  gitignored `.expo/types/router.d.ts` (typed-routes union) regenerates — run `bunx expo customize
  tsconfig.json` (or `bunx expo start` once) to regenerate it. Not a real type error. (See the
  `expo-router-typegen-on-new-route` memory.)

---

## 6. Verification strategy (how to know it works without a car until Phase 5)

1. **Phase 2 against `simulatedSource`** — the whole trigger→play→duck→lock-screen loop runs on the iOS
   Simulator with NO GPS. This proves the entire bet minus real positioning.
2. **`@skipper/drive-core` tests** (`bun test`) — the trigger math is behavior-locked; don't regress it.
3. **`bun run check`** in `apps/mobile` (lint:tokens + typecheck + test) on every UI change.
4. **`bunx expo export`** — headless Metro bundle; catches resolution/import breakage without a device.
5. **Phase 4 walk/bike test** — `liveSource` fires stops from real device GPS at low speed.
6. **Phase 5 real drive** — EAS dev build, phone mounted on power, drive `emerald-bay-run`, tune
   `leadSeconds`/cone/accuracy from the trace.

---

## 7. The phased plan

### Phase 0 — audio-session spike (~½ day, needs a dev build)
Prove `setAudioModeAsync({ shouldPlayInBackground: true, interruptionMode: 'duckOthers' })` **ducks** the
rider's Spotify/Apple Music **and** keeps **lock-screen Now Playing** working, surviving screen-lock. The
preview chose `'doNotMix'` to get lock-screen controls — resolving that tension is the riskiest assumption.
→ **Accept:** narration ducks background music; Now Playing shows the stop; both survive lock. If they
can't coexist, document the workaround before Phase 2.

### Phase 2 — GPS-driven player, simulated source (~2 days)
New `useDrive` hook / driving screen. Load tour + sign audio (reuse §3.5). Snap+filter stops, build one
`TriggerEngine` (§3.2). Implement `GpsFixSource` + `simulatedSource(polyline, {mph})` reusing
`generateDrive`. Each fix → `engine.update` → enqueue+play fired clips (reuse clip-load + lock-screen),
ducking between stops; a finished clip returns to quiet and waits. Fire-queue, not `idx++`. Route dot
follows the GPS position along the polyline.
→ **Accept:** the simulated source runs end-to-end on the sim — stops fire at the right place/lead, once
each, debounce holds, lock-screen updates per stop, music ducks. **This is the bet, minus real GPS.**

### Phase 3 — offline download (~1½ days)
Add `expo-file-system` (declare it). After sign, download all `N` clips to
`Paths.document/tours/<tourId>/<seq>.<ext>` — `<ext>` from each clip's `contentType` in the sign response,
NOT hardcoded (concurrency-capped) + write the manifest (§4). Gate "Start drive"
on download-complete + verify-on-disk. Player prefers local `file://`, else presigned (re-sign if expired).
→ **Accept:** airplane-mode after download → the full simulated drive plays from disk, zero network.

### Phase 4 — real `expo-location` source (~1½ days)
`bunx expo install expo-location expo-keep-awake`. Config plugin: `locationWhenInUsePermission`
(→ `NSLocationWhenInUseUsageDescription`); no background-location. `liveSource`:
`watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 0 })` → map
`LocationObject` → `GpsFix` (§3.3). `useKeepAwake()` while driving. Carefully `.remove()` on teardown
(§5 Android bug). Same `engine.update` path — sim and live sources interchangeable.
→ **Accept:** a walk/bike test fires stops from real device GPS.

### Phase 5 — drive it once for real
EAS dev build; phone mounted on power; drive `emerald-bay-run` offline; tune `leadSeconds`/cone/accuracy.

---

## 8. Expo SDK 56 API reference (verified against docs — cite these, don't assume)

Pins (`apps/mobile/package.json`): `expo ~56.0.9`, `react-native 0.85.3`, `expo-audio ~56.0.11`,
`newArchEnabled: true`. **Need to add: `expo-location`, `expo-keep-awake`, and declare `expo-file-system`.**

- **expo-location** — `watchPositionAsync(options, callback, errorHandler) → Promise<LocationSubscription>`
  (`.remove()` to stop). **Foreground only.** `LocationOptions`: `accuracy` (`Accuracy.BestForNavigation = 6`
  for automotive), **`distanceInterval: 0`** (pure time-driven stream — gating on distance reintroduces the
  geofence miss), `timeInterval` (ms, Android). `LocationObject.coords`: `latitude, longitude, accuracy,
  speed` (m/s, nullable), `heading` (deg, null below ~5 mph). Permission:
  `requestForegroundPermissionsAsync()` (When-In-Use; enough). Config-plugin key:
  `locationWhenInUsePermission` → `NSLocationWhenInUseUsageDescription`. (Do NOT set
  `isIosBackgroundLocationEnabled` / `isAndroidBackgroundLocationEnabled` — foreground-only.)
  Docs: https://docs.expo.dev/versions/v56.0.0/sdk/location/
- **expo-keep-awake** — `useKeepAwake(tag?)` hook (screen stays on while mounted) or
  `activateKeepAwakeAsync`/`deactivateKeepAwake`. No plugin/Info.plist/manifest needed.
  Docs: https://docs.expo.dev/versions/latest/sdk/keep-awake/
- **expo-audio** — `setAudioModeAsync({ shouldPlayInBackground: true, playsInSilentMode: true,
  interruptionMode: 'duckOthers' })`. `'duckOthers'` = other apps lower volume but keep playing ("duck, don't
  stop"), cross-platform (the deprecated `interruptionModeAndroid` is gone). `enableBackgroundPlayback: true`
  plugin option (already set) adds iOS `UIBackgroundModes: ['audio']`; Android `FOREGROUND_SERVICE` +
  `FOREGROUND_SERVICE_MEDIA_PLAYBACK` are already in `app.json`. `useAudioPlayer`/`createAudioPlayer` play a
  local `file://` URI the same as an https URL. Docs: https://docs.expo.dev/versions/v56.0.0/sdk/audio/
- **expo-file-system** (new OO API) — `import { File, Directory, Paths } from 'expo-file-system'`;
  `await File.downloadFileAsync(url, new Directory(Paths.document, 'tours', tourId))` → read `out.uri`;
  `file.exists`, `file.delete()`. **`Paths.document` = persistent; `Paths.cache` = OS-evictable (wrong for
  offline).** Legacy (`expo-file-system/legacy`): `createDownloadResumable(...)` for pause/resume progress.
  Docs: https://docs.expo.dev/versions/latest/sdk/filesystem/

---

## 9. File map

- `packages/drive-core/src/trigger.ts` — `TriggerEngine`, `GpsFix`, `TourStopRef`, `TriggerEvent`,
  `snapStopsToRoute`, `effectiveRadiusM`, `DEFAULT_TRIGGER`. **Reuse; don't modify.**
- `packages/drive-core/src/simulate.ts` — `generateDrive` (the sim source), `runDrive`, `DEFAULT_MAX_OFF_ROUTE_M`.
- `packages/drive-core/src/geo.ts` — geometry helpers.
- `packages/drive-core/test/*.test.ts` — the behavior lock (21 tests).
- `apps/mobile/app/preview/[id].tsx` — the couch/sim player to REUSE machinery from (audio session,
  lock-screen, clip load/stall/re-sign, seek). Build the GPS player as a sibling screen/hook.
- `apps/mobile/src/lib/api.ts` — `getTour`, `signTourAudio`.
- `apps/mobile/src/ui/` — `RouteTrack`, `StopRow`, `NowCard`, `Scrubber`, `voice` (use these, follow DESIGN.md).
- `apps/api/src/index.ts` — `GET /tours/:tourId` (polyline + stops), `POST /tours/:tourId/assets/sign`.
- `packages/shared/src/schemas.ts` — `tourStopView`, `tourDetail`, `signedClip` DTOs.
- New code you'll add: `apps/mobile/src/lib/gps.ts` (the `GpsFixSource` + `liveSource`/`simulatedSource`
  + the `LocationObject→GpsFix` adapter), `apps/mobile/src/lib/offline.ts` (download + manifest), and the
  driving screen/hook (e.g. `apps/mobile/app/drive/[id].tsx` + `useDrive`).

---

## 10. Provenance

Synthesized 2026-06-08 from a 4-agent research workflow (sim core, preview player, tour data/offline, Expo
SDK 56 APIs) + the founder-locked scope (foreground-only). The prerequisite refactor (drive-core leaf +
workspace merge + geo dedup) is committed (`e97c453`, `5025827`); this spec covers everything after it.
Related memory: `drive-simulator-and-triggering`, `preview-try-without-driving`,
`mobile-workspace-isolated-linker`, `carplay-deferred-phone-first-mvp`. Sibling spec (different feature):
`docs/ask-the-skipper-spec.md`.
