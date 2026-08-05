# M1 GPS Phone Player — Build Spec / Handoff

> **Status (2026-08-05) — the STREAMING and RE-SIGN parts of this spec are SUPERSEDED; the trigger,
> GPS-source and in-car parts stand.** A live drive's audio is now played ONLY from disk: the download
> starts automatically at CREATE, survives navigation, and GATES Start. `POST /drives/:id/assets/sign`
> — the endpoint §4 and §9 below were written around — is **deleted**, with the client `signDriveAudio` /
> `resignPlayback` and the `signedDriveAudio` → `signedStopClip` → `signedClip` DTO chain. Read every
> "prefer local, else the presigned URL / re-sign if the TTL lapsed" line below as historical.
> ⚠ **This is a DRIVE rule, not an app-wide one** — `GET /sample` and the anonymous route-preview clip
> play BEFORE a drive exists and deliberately still stream, still on the 12 s `PRE_START_STALL_MS`,
> while a drive clip now takes ONE pass on the short `LOCAL_CLIP_STALL_MS`. ⚠ `?mode` is retired too:
> the GPS clock is a persisted `simMode` SETTING, default FALSE everywhere, so §1's `__DEV__`-only
> simulator button is gone. See [`download-before-start.md`](./download-before-start.md).

> **Status update (2026-07-16):** the couch PREVIEW clock (§3.5, `?mode=preview`) is **CUT** — deleted along with `packages/engine/src/preview.ts` / `buildPreviewTimeline` and the preview branches in `useDrive` (mode is `sim | live` now). Auditioning a drive is the native per-stop mini-preview on the drive-detail page; read §3.5 as historical. See [`../decisions/detail-page-mini-preview.md`](../decisions/detail-page-mini-preview.md).

> **Schema-names note (2026-06-13):** identifiers below predate later refactors — read `corridors`→`tours` (merged; `corridor.polyline`→`tour.polyline`) and `poiContentId`→dropped (`poi_content` is gone; narration lives on a `tracks` row). **(V2 2026-06-18):** the segments/tracks model was further collapsed — read `tracks`→`narrations`, `tours`→user-owned `drives`, and the `/tours*` routes → `/drives*`; hand-authored tours are deferred.
>
> **(V2 API/DTO + screen drift — 2026-06-19, read before §3/§4/§9):** the data contract this spec describes is the dissolved V1 surface. Map it forward:
> - **Endpoints:** `GET /tours/:tourId` → `GET /drives/:id` (under `withSession` + a PER-ROUTE `requireAccount`, [`apps/api/src/drives.ts`](../../apps/api/src/drives.ts)). ⚠ **`POST /tours/:tourId/assets/sign` maps to NOTHING.** Its V2 successor `POST /drives/:id/assets/sign` existed until 2026-08-05 and was deleted when drive audio became disk-only — the manifest itself carries each clip's presigned `url`, and that url is what the DOWNLOAD fetches. There is no second call and no re-sign.
> - **DTO:** the `tourStopView` stop array + inline `corridor.polyline` → a **`drives.selection` jsonb manifest** of `DriveSelectionItem`s (`kind: 'narration'` entries only — the `DriveSelection` type in [`packages/db/src/schema.ts`](../../packages/db/src/schema.ts)); `poiContentId` is gone (a selection item carries `poiId`/`narrationId` and resolves content live). The drive's `polyline` is the top-level `drives.polyline` column.
> - **Screens:** `app/preview/[id].tsx` / `app/tour/[id].tsx` no longer exist — the live player screens are **`app/drives/[id]/index.tsx`** (detail) + **`app/drives/[id]/play.tsx`** (the driving player). Read every `preview/[id].tsx` reference below as the `drives/[id]/` equivalent.
> - **Engine-function correction:** this spec calls **`generateDrive` in `@skipper/engine`** "the simulated drive" — but `generateDrive` ([`packages/engine/src/simulate.ts`](../../packages/engine/src/simulate.ts)) only produces the synthetic **GPS-fix stream** for the simulator. The DRIVE *assembler* (pick + order the reused shared narrations along an A→B route) is **`buildDrive`** ([`packages/engine/src/drive-select.ts`](../../packages/engine/src/drive-select.ts)). Where the prose below says `generateDrive` builds a drive, read `buildDrive`; `generateDrive` is only the sim fix source the simulated player replays.
> - **Intro/outro bracket playback is GONE (migration `0019`, 2026-06-19).** The placeless `asides` table was deleted and with it the player's intro/outro framing — the `intro`/`outro`/`aside` `driveClipForm` members, the `DriveSelectionItem` aside variant, the `INTRO_SEQ`/`OUTRO_SEQ` sentinels, `frameKindForSeq`/`activeFrame`/`frameTitle`, and the preview-timeline frames (it never fired in v2; returns in v3 with guided tours — see [`../decisions/geometry-first-regions.md`](../decisions/geometry-first-regions.md)). So §1's "intro/outro bracket playback added" status line and any bracket/frame discussion below describe a removed V1 path; the V2 player plays only the `narration` selection items. Break/scenic between-story texture is now the PLACED `break` (Places-anchored) + `scenic` forms, not a placeless aside.

> **Status (2026-06-19):** mostly built + the **M1 on-device drive pass has since landed** (real-device
> GPS triggering verified; see the device-verification runbook + the `first-tour-live-west-shore` baton).
> Phase 2 (GPS player on the simulated source) and Phase 3 (offline download) ✅ shipped; Phase 4 (real
> `expo-location` source) code-built, reviewed, and device-verified. The remaining historical TODO from
> the 2026-06-09 status — the Phase-0 duck flip + a polished Phase 5 real drive — is folded into the live
> V2 `drives/[id]/play.tsx` player. The phases/§3/§4/§9 below are kept as the build record; read them
> through the V2 API/DTO/screen map in the banner above.
>
> **Audio mode RESOLVED (2026-06-19):** the "Phase-0 duck flip" is settled — the drive uses `'doNotMix'`
> (exclusive focus) BY DESIGN, NOT `'duckOthers'`; the drive IS the audio (curated soundtrack + narration),
> so the body's `duck`/`duckOthers` references below are historical. See
> [`../decisions/drive-audio-exclusive-focus.md`](../decisions/drive-audio-exclusive-focus.md).

> Self-contained handoff for the **live, on-device, GPS-triggered phone player** — the
> M1 MVP bet. Grounded against the live repo (`packages/engine/src/{trigger,simulate,geo,preview}.ts`,
> `apps/mobile/app/preview/[id].tsx`, `apps/api/src/index.ts`, `packages/shared/src/schemas.ts`,
> `packages/db/src/schema.ts`) and against Expo SDK 56 / RN 0.85 docs (verified, not from memory —
> see §8). Written 2026-06-08. **Symbol names are stable; line numbers drift** (the preview player is
> under active edit) — grep the symbol, don't trust the line.

---

## 0. TL;DR for the next Claude

**The bet:** a rider mounts their phone, starts a downloaded tour, and as they drive the real
roads the Skipper's clips fire at the right places (speed-adaptive lead time), ducking their
music, with lock-screen Now Playing — all offline. CLAUDE.md calls this "the whole bet."

**The one seam:** `TriggerEngine.update(fix)` in `@skipper/engine` is a pure, tested function —
feed it one `GpsFix {lat,lng,speedMps,headingDeg}` per tick, it returns the stop(s) that should fire.
Today the **simulated** drive (`generateDrive`) manufactures that fix stream. **Real GPS is the same
stream from a different source** (`expo-location.watchPositionAsync`). No change to the trigger logic.

**What's already done (don't redo):** the trigger core + sim + geo are an importable, RN-safe leaf
(`@skipper/engine`); `apps/mobile` is in the bun workspace; the preview player already has the
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
| **1** | Trigger core importable in mobile, no drift | ✅ **Done** — extracted to `@skipper/engine`, mobile in the workspace, `app/preview` imports it (commits `e97c453`, `5025827`) |
| **0** | Audio-session spike: duck music **and** keep lock-screen Now Playing | ❌ not started — riskiest unknown; needs a dev build |
| **2** | GPS-driven player core, fed by the **simulated** fix source | ✅ **Done** — `src/lib/useDrive.ts` + `app/drive/[id].tsx` + `src/lib/gps.ts`; intro/outro bracket playback added (`ecc78a0`) |
| **3** | Offline download (clips → disk) | ✅ **Done** — `src/lib/offline.ts`: download to `Paths.document` + offline-first players (`03a52c6`). On-device airplane-mode acceptance pending a dev build |
| **4** | Real `expo-location` fix source | 🔨 **Code built + review-fixed** (`a0610b4`, fixes `2dd86f5`) — `liveSource` (monotonic projection, onEnd at route end, onError, accuracy/-1 gate) + permission gate (+ AppState recovery) + `mode:'sim'\|'live'` seam + no-GPS watchdog + `useKeepAwake`; `bun run check` + `expo export` green. The tour CTA ("Start the drive") now routes to **live** (`?mode=live`); the on-device **simulator** is a `__DEV__`-only secondary button (hidden in production). On-device acceptance (bike test, teardown verify, duck flip) PENDING a dev build. Deferred low-sev review items: #9 pause/resume watch leak, #11 tSec across pause, #13 mode-param typo→sim. |
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

### 3.1 The trigger core (`@skipper/engine`, reusable AS-IS — do not modify)

Import everything from `@skipper/engine` (the barrel re-exports `geo`/`trigger`/`simulate`/`preview`).

`trigger.ts`:
- `class TriggerEngine` — `new TriggerEngine(stops: DriveStopRef[], opts?: Partial<TriggerOptions>)`;
  `update(fix: GpsFix): TriggerEvent[]` (the stops that fired this tick, usually 0 or 1);
  `hasFired(seq)`, `get firedCount()`. **Stateful** — one instance per drive; on restart, make a NEW one
  (it has no reset).
- `GpsFix = { lat, lng, speedMps, headingDeg, tSec, alongM }`. Only `lat/lng/speedMps/headingDeg` matter
  to the fire decision; `tSec` = seconds since drive start (for reported lead), `alongM` = UI only (use 0).
- `DriveStopRef = { seq, lat, lng, triggerRadiusM, durationMs?, name?, stopType? }`.
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

**Tests:** `packages/engine/test/*.test.ts` (21 tests) lock the trigger behavior — run `bun test`
in the package after any change near it.

### 3.2 The load-time setup the player writes

```ts
import { TriggerEngine, snapStopsToRoute, type GpsFix } from '@skipper/engine'

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
// ⚠️ iOS returns -1 (NOT null) for invalid speed/heading (CLLocation; expo/expo#5401, sim AND device).
// The docs TYPE these `number | null` but the RUNTIME yields -1 — so `?? 0` is NOT enough; sanitize.
const sane = (v: number | null | undefined) => (v != null && v >= 0 ? v : 0)
const fix: GpsFix = {
  lat: loc.coords.latitude,
  lng: loc.coords.longitude,
  speedMps: sane(loc.coords.speed),       // -1/null when stationary → 0 (heading gate then skips, fail-open)
  headingDeg: sane(loc.coords.heading),   // -1/null below ~5 mph; derive from consecutive fixes if you need it
  tSec: (loc.timestamp - startMs) / 1000, // loc.timestamp = ms since epoch; startMs captured at the FIRST fix
  alongM: projectAlongM(loc.coords.longitude, loc.coords.latitude),
  // ^ a live fix has NO intrinsic along-route distance. DON'T use a plain `nearestOnRoute` nearest-VERTEX
  //   scan: on an out-and-back route it snaps return-leg fixes to nearby outbound vertices → the dot jumps
  //   backward AND alongM never reaches the end (breaking end-of-route detection below). Use a MONOTONIC
  //   forward cursor instead (gps.ts `projectAlongM`) — also bounds the per-fix work to a forward window.
}
// Real GPS settles slowly: the first fixes can carry accuracy 1000 m+, and a wild fix landing near a stop
// will false-fire it. Gate on horizontal accuracy BEFORE feeding the engine (MAX_FIX_ACCURACY_M ≈ 50).
// ⚠️ iOS reports accuracy = -1 (NOT null) when invalid — the SAME sentinel as speed/heading — so reject
// `acc < 0` too, else the worst fixes slip through `acc > MAX`:
if (loc.coords.accuracy != null && (loc.coords.accuracy < 0 || loc.coords.accuracy > MAX_FIX_ACCURACY_M))
  return // drop this fix
// End-of-route: live GPS has no fix-stream end like the sim, so call onEnd() once `alongM` reaches the
// final vertex — that's what queues the outro + finishes the drive. And `.catch` the watchPositionAsync
// promise → onError() (Location Services off / revoked / native error) so the drive surfaces instead of hanging.
for (const ev of engine.update(fix)) enqueueClip(ev.seq) // fire each (usually 0–1)
```

### 3.4 The swappable source

```ts
// The SHIPPED seam (apps/mobile/src/lib/gps.ts) is RICHER than this spec's original sketch — it returns a
// FixSubscription (not a bare unsubscribe) and takes an onEnd. liveSource() must implement the SAME shape:
type GpsFixSource = (onFix: (f: GpsFix) => void, onEnd?: () => void) => FixSubscription
interface FixSubscription { stop(): void; pause(): void; resume(): void }
// simulatedSource(polyline, { mph, tickHz, timeScale }) — replays generateDrive on a timer (NO GPS) ✅ built
// liveSource() — watchPositionAsync → GpsFix (Phase 4), mapping to the SAME FixSubscription:
//   stop()  → sub.remove() + set a `stopped` guard (the #35925/#35926 leak — see §5)
//   pause() → sub.remove();   resume() → re-acquire the watch
//   onEnd   → never fires (live is an infinite stream; finite-source only)
```
Build Phase 2 against `simulatedSource`; Phase 4 adds `liveSource` and flips which one the screen uses.
**⚠️ Today `useDrive` HARDWIRES `simulatedSource`** (direct import + construct, ~`gps.ts` line 30/367) — so
Phase 4 must first add the seam: thread a `source` (or `mode: 'sim' | 'live'`) param through the hook/screen.
The on-device drive *simulator* keeps `simulatedSource`; the real drive picks `liveSource()`. Same engine path.

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

**Audio** came separately in V1: `POST /tours/:tourId/assets/sign` → `{ urls: [{ seq, url, contentType, durationMs }] }`
(one presigned R2 GET per stop with audio). **Presign TTL = 1 hour** (`apps/api/src/storage.ts`).
`contentType` is the clip's MIME (e.g. `audio/mp4`), derived server-side from the R2 key — use it to
pick the on-disk extension; do NOT hardcode the format.

**To drive ONE tour fully offline you must persist:**
1. the tour JSON (polyline + stops) — for snapping + UI with zero network;
2. every clip's BYTES (not the URL — it expires) downloaded while online.
Network to prep: `1× GET /tours` + `1× POST /sign` + `N` audio GETs.

**Offline storage:** `Paths.document/tours/<tourId>/<seq>.<ext>` (persistent), where `<ext>` comes from
each clip's `contentType` in the sign response (`audio/mp4` → `m4a`) — never hardcoded. Write a
**manifest** (`manifest.json`: tourId, a version/generatedAt, polyline, stops, per-seq file path +
contentType). At playback prefer the local `file://` if present, else the presigned URL (re-sign if the
1 h TTL lapsed). Note: clips are now **AAC-LC `.m4a` (`audio/mp4`)** (an order of magnitude smaller than the old LINEAR16 WAVs — a few MB/tour),
but still budget storage + download time + a progress UI that gates "Start drive". Gating is real: a
non-preview tour needs a signed-in (free) account at prep time (the `/tours` + `/sign` tier check).

> **⚠ V2 CORRECTION (2026-08-05) — the audio half of this section changed shape.** Three claims above are
> now false, and they fail in the same direction: each assumes a live drive can still reach the network.
> - **There is no sign call.** `POST /drives/:id/assets/sign` is deleted. `GET /drives/:id` returns a
>   `DriveManifest` whose every `DriveClip` already carries `url` + `contentType`
>   (`packages/shared/src/schemas.ts`). Prep is `1× GET /drives/:id` + `N` audio GETs — no `POST /sign`.
> - **"Prefer the local `file://`, else the presigned URL, re-sign if the TTL lapsed" is gone.** A drive's
>   audio is only ever played from disk, so there is no online branch left to fall back to and nothing to
>   re-sign. The presigned url is used ONLY by the download and never has to outlive the transfer.
> - **The progress UI is no longer a budgeting note — it IS the gate.** The download starts automatically
>   at CREATE and Start renders disabled with progress beside it until the local copy is complete. §7
>   Phase 3's throwaway "gate Start drive on download-complete" turned out to be the real design.
>
> ⚠ UNCHANGED: the 1 h TTL, the account gate, and the format-is-DATA rule (`contentType` still picks the
> on-disk extension). ⚠ And this is a DRIVE rule, not an app rule — `GET /sample` and the anonymous
> route-preview clip play before a drive exists and still stream. Full record, including the two accepted
> regressions (the mini-preview can only play what is on disk; an OLD undownloaded drive auditions
> nothing until saved): [`download-before-start.md`](./download-before-start.md) §10 N1/N2.

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
- **`watchPositionAsync` teardown is BROKEN — verify on YOUR target platform.** The subscription can keep
  capturing after `.remove()` (expo/expo #35925 + #35926, Apr–Jun 2025, still open; reported on Android AND
  iOS — not Android-only). Two-layer defense: (1) hold a `stopped` guard in `liveSource` and ignore `onFix`
  after `stop()`, so even a leaked native watch can't fire a stop or pollute the route dot; (2) the leaked
  NATIVE watch still drains battery — confirm GPS actually stops on unmount during the Phase 4 test, or you
  bleed battery all session. The JS guard fixes correctness; only the verified teardown fixes the battery.
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
2. **`@skipper/engine` tests** (`bun test`) — the trigger math is behavior-locked; don't regress it.
3. **`bun run check`** in `apps/mobile` (lint:tokens + typecheck + test) on every UI change.
4. **`bunx expo export`** — headless Metro bundle; catches resolution/import breakage without a device.
5. **Phase 4 bike test (>5 mph)** — `liveSource` fires stops from real device GPS. A *walking* test is below
   `headingGateMps` so it skips the heading cone (validates wiring + distance, not the cone — see §7 Phase 4).
   Smoke-test wiring first on the iOS Simulator via *Features → Location → Freeway Drive*.
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

### Phase 4 — real `expo-location` source (~1½–2 days, needs a dev build)
1. **Deps (declared — isolated linker):** `bunx expo install expo-location expo-keep-awake`. Config plugin in
   `app.json`: `["expo-location", { "locationWhenInUsePermission": "Skipper uses your location to play each
   stop as you reach it." }]` → `NSLocationWhenInUseUsageDescription`. Set NO background keys
   (`isIosBackgroundLocationEnabled`/`isAndroidBackgroundLocationEnabled` stay off — foreground-only; on
   Android you do NOT need `FOREGROUND_SERVICE_LOCATION` because the watch only runs foregrounded).
   `expo-keep-awake` needs no plugin. No new `app/*` route → no typegen step.
2. **Permission gate (new UX):** `requestForegroundPermissionsAsync()` before the watch. Gate "Start drive"
   on `granted`; on denied with `canAskAgain === false`, deep-link to Settings (`Linking.openSettings()`).
   Pairs with the existing account-gate pattern.
3. **`liveSource()` in `gps.ts`** — implement the SAME `FixSubscription` the sim source returns (§3.4):
   `watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 0, timeInterval: 500 })`
   (`timeInterval` is Android-only — pins cadence near the 4 Hz sim; iOS streams continuously at
   `distanceInterval: 0`). Map `LocationObject → GpsFix` via the **sanitized** adapter (§3.3): sanitize the
   iOS `-1`, gate on `coords.accuracy`, capture `startMs` at the first fix for `tSec`. `stop()` →
   `sub.remove()` + `stopped` guard (§5); `pause/resume` → remove / re-watch; `onEnd` unused.
4. **Swap the source (new seam):** `useDrive` HARDWIRES `simulatedSource` today — thread a `source` (or
   `mode: 'sim' | 'live'`) param through the hook/screen so the driving screen picks `liveSource()`. The
   on-device drive *simulator* keeps `simulatedSource`; same `engine.update` path for both.
5. **`useKeepAwake()`** while the drive screen is mounted.
→ **Accept:** a **bike** test (>5 mph) fires stops from real device GPS at the right place/lead, once each,
   and GPS verifiably STOPS on unmount (battery). ⚠️ A **walking** test (~3 mph) sits BELOW `headingGateMps`
   (2.2 m/s ≈ 5 mph) so the heading cone is SKIPPED — it validates wiring + distance triggering but NOT the
   cone (which only exercises at driving speed: bike partially, Phase 5 fully). Smoke-test the wiring first on
   the iOS Simulator via *Features → Location → Freeway Drive* before going outside.

### Phase 5 — drive it once for real
EAS dev build; phone mounted on power; drive `emerald-bay-run` offline; tune `leadSeconds`/cone/accuracy.

---

## 8. Expo SDK 56 API reference (verified against docs — cite these, don't assume)

Pins (`apps/mobile/package.json`): `expo ~56.0.9`, `react-native 0.85.3`, `expo-audio ~56.0.11`,
`newArchEnabled: true`. **Added for Phase 4 (`bunx expo install`): `expo-location ~56.0.16`,
`expo-keep-awake ~56.0.3`** (+ the `expo-location` config plugin in `app.json` with
`locationWhenInUsePermission`, both background keys `false`). `expo-file-system ~56.0.7` already declared.

- **expo-location** (re-verified 2026-06-09) — `watchPositionAsync(options, callback, errorHandler?) →
  Promise<LocationSubscription>` (await it, THEN `.remove()` to stop). **Foreground only.** `LocationOptions`:
  `accuracy` (enum is exported as **`Accuracy`**, `Accuracy.BestForNavigation = 6` for automotive — `import *
  as Location` makes `Location.Accuracy.BestForNavigation` resolve), **`distanceInterval: 0`** (pure
  time-driven stream — gating on distance reintroduces the geofence miss), `timeInterval` (ms, **Android
  only**), `mayShowUserSettingsDialog` (Android). `LocationObject`: `coords`, `timestamp` (ms since epoch),
  `mocked?` (Android — flags injected fixes, handy in dev). `LocationObject.coords`: `latitude, longitude`
  (always present), `accuracy, altitude, altitudeAccuracy, heading, speed` (all typed `number | null`).
  **⚠️ The TYPE lies about speed/heading: on iOS the RUNTIME returns `-1` (not null) when invalid/stationary
  (CLLocation; expo/expo#5401, sim AND device) — sanitize `-1` AND `null`, don't just `?? 0` (§3.3).**
  Permission: `requestForegroundPermissionsAsync()` → `{ granted, status, canAskAgain, ios?, android? }`
  (When-In-Use; enough). Config-plugin key: `locationWhenInUsePermission` → `NSLocationWhenInUseUsageDescription`.
  (Do NOT set `isIosBackgroundLocationEnabled` / `isAndroidBackgroundLocationEnabled` — foreground-only.)
  **Teardown bug:** `.remove()` may not stop updates — #35925/#35926, both platforms (§5).
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

- `packages/engine/src/trigger.ts` — `TriggerEngine`, `GpsFix`, `DriveStopRef`, `TriggerEvent`,
  `snapStopsToRoute`, `effectiveRadiusM`, `DEFAULT_TRIGGER`. **Reuse; don't modify.**
- `packages/engine/src/simulate.ts` — `generateDrive` (the sim source), `runDrive`, `DEFAULT_MAX_OFF_ROUTE_M`.
- `packages/engine/src/geo.ts` — geometry helpers.
- `packages/engine/test/*.test.ts` — the behavior lock (21 tests).
- `apps/mobile/app/preview/[id].tsx` — the couch/sim player to REUSE machinery from (audio session,
  lock-screen, clip load/stall/re-sign, seek). Build the GPS player as a sibling screen/hook.
- `apps/mobile/src/lib/api.ts` — `getTour`, `signTourAudio`.
- `apps/mobile/src/ui/` — `RouteTrack`, `StopRow`, `NowCard`, `Scrubber`, `voice` (use these, follow DESIGN.md).
- `apps/api/src/index.ts` — `GET /tours/:tourId` (polyline + stops), `POST /tours/:tourId/assets/sign`.
  ⚠ V2: the drive routes live in `apps/api/src/drives.ts`, and the sign route has **no successor** —
  `GET /drives/:id` alone carries the presigned clip urls (see the §4 correction).
- `packages/shared/src/schemas.ts` — `tourStopView`, `tourDetail` DTOs. ⚠ V2: read those as `driveClip` /
  `driveManifest`. The `signedDriveAudio` → `signedStopClip` → `signedClip` chain this line used to name
  was deleted 2026-08-05 with the sign route.
- New code you'll add: `apps/mobile/src/lib/gps.ts` (the `GpsFixSource` + `liveSource`/`simulatedSource`
  + the `LocationObject→GpsFix` adapter), `apps/mobile/src/lib/offline.ts` (download + manifest), and the
  driving screen/hook (e.g. `apps/mobile/app/drive/[id].tsx` + `useDrive`).

---

## 10. Provenance

Synthesized 2026-06-08 from a 4-agent research workflow (sim core, preview player, tour data/offline, Expo
SDK 56 APIs) + the founder-locked scope (foreground-only). The prerequisite refactor (engine leaf +
workspace merge + geo dedup) is committed (`e97c453`, `5025827`); this spec covers everything after it.
**Re-grounded 2026-06-09 (Phase 4 pass):** Phases 2–3 are now ✅ built (§1); re-verified expo-location
against live SDK 56 docs + issue tracker and corrected the §3.3 adapter (iOS `-1` sanitize + accuracy gate),
the §3.4 source signature (the shipped `FixSubscription` + the hardwired-`simulatedSource` seam gap), the §5
teardown landmine (both platforms, not Android-only), §7 Phase 4 (permission gate, source-swap, walk-vs-bike
cone caveat), and the §8 location reference. Sources: expo/expo#5401 (iOS speed=-1), #35925/#35926 (teardown).
**Phase 4 code built 2026-06-09:** `expo install expo-location@56.0.16 expo-keep-awake@56.0.3` + `app.json`
plugin; `liveSource` + `ensureDrivePermission` (`gps.ts`); `mode:'sim'|'live'` seam + permission gate +
`useKeepAwake` (`useDrive.ts`); `?mode=live` route param + location gate (`drive/[id].tsx`); voice copy.
`bun run check` (41 tests) + `expo export` green. NOT device-verified — bike test / teardown / duck flip pending.
**Phase 4 code-reviewed + fixed 2026-06-09 (`2dd86f5`):** a 4-angle review of `a0610b4` found 13 issues;
the high+moderate set is fixed (live drive now reaches 'done' via onEnd-at-route-end; monotonic projection;
iOS accuracy=-1 gate; watch-reject onError; start() guards; AppState Settings recovery; no-GPS watchdog;
keep-awake pause/race). §3.3/§8/§1 above re-synced to the fixed code. Deferred low-sev: #9/#11/#13 (see §1).
Related memory: `drive-simulator-and-triggering`, `preview-try-without-driving`,
`mobile-workspace-isolated-linker`, `carplay-deferred-phone-first-mvp`. Sibling spec (different feature):
`docs/designs/ask-the-skipper-spec.md`.
