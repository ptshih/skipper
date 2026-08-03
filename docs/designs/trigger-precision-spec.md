# Trigger Precision — Build Spec

> **Status (2026-06-27):** PARTIALLY BUILT. Fixes triage cluster **1b** from the 2026-06-25 founder
> dogfood drive (build 11): clips that fire too early, too far in, or *after you've already passed* the
> point. **Step 3 (passed-point retire) ✅ BUILT** + **Step 1 (consume the anchor) ✅ BUILT** —
> `/roam` + `/drives` now trigger on `speakable ?? pin`, after the 1a OSM snap populated **750** Tahoe
> anchors (~99 genuine backcountry → no anchor → fall back to centroid). **Step 2 (conditional radius)
> ✅ MECHANISM BUILT 2026-06-27** — an anchored pin now gets a tight kind-independent floor while an
> anchorless pin keeps its kind floor (`triggerRadiusForKind`); only the **FINAL tuned numbers** wait on
> the on-device re-drive (it is NOT a blanket shrink — see below). Step 4 optional.
>
> ⚠ **Amended 2026-08-02: HALF THIS SPEC IS GONE.** Roam was removed in 1.1, taking `RoamEngine`,
> `packages/engine/src/roam.ts`, `GET /roam` and every roam-side constant (`floorM:600`,
> `headingConeDeg:120`, `leadSeconds:15`, the 4 h per-POI cooldown, `recedeMarginM:60`) with it. Read
> all of those as a dated record of what the numbers were compared against. **The remaining work is
> the DRIVE half and it is unchanged**: step 2's `ANCHORED_TRIGGER_RADIUS_M` is still a conservative
> 250 m, and steps 4 (stored approach heading) and 5 (background-GPS pause) are still open.
>
> ⚠ **Amended 2026-08-03: what step 2 is WAITING FOR changed.** It no longer needs a re-drive plus an
> analyst — it needs **one recorded trace**. `packages/sim/src/sweep.ts --trace` replays a real drive
> through the same pipeline the phone runs and reads the whole floor × lead curve, which a car cannot
> do (a trip samples one parameter value). The recorder that produces the trace is built and dev-gated
> (`@skipper/engine` trace.ts); nothing has been recorded yet, so the tool currently runs on synthetic
> input and says so in its own output. See [desk-drive-harness.md](desk-drive-harness.md).
>
> ⚠ **And the question itself was mis-stated here.** `effectiveRadiusM = max(floor, speed·lead)`, so
> at the baseline lead this constant is **dead weight above ~47 mph** — it only ever governed the
> low-speed case, which is exactly where Edgewood, Harrah's, Van Sickle and Zephyr Cove sit. The open
> question is "what should the floor be at town/approach speed", not "what should the floor be".

## Origin

Same dogfood drive, the timing complaints:
- *"Triggered after already driving past"* (Zephyr Cove) — fired **late**; you hear about a place once
  it's behind you. The worst failure mode.
- *"Triggered a bit too far in 50"* (Van Sickle, on Hwy 50) — fired deep into the point.
- *"Harrah's trigger really far on CA side"* — fired **too early**, from far away / the wrong approach.

## What already exists (the primitives are built — the defect is upstream of them)

The CLAUDE.md "in-car landmines" are largely **implemented** in `@skipper/engine` (there is no
`drive-core`; the trigger core is `packages/engine/src/`):

- **Speed-adaptive lead, not a fixed geofence:** `effectiveRadiusM(triggerRadiusM, speedMps, leadSeconds)
  = max(triggerRadiusM, speedMps·leadSeconds)` ([`trigger.ts:80-82`](../../packages/engine/src/trigger.ts)).
  `triggerRadiusM` is a **floor**. Drive `leadSeconds:12`, roam `leadSeconds:15`.
- **Heading gate:** drive `headingConeDeg:90` ([`trigger.ts:116-119`](../../packages/engine/src/trigger.ts)),
  roam `headingConeDeg:120` (`roam.ts:184-187`, deleted in 1.1); both gated above
  `~2.2 m/s` (≈5 mph) and **skipped when heading is unknown** (the iOS `-1` course sentinel).
- **Debounce / already-fired:** drive `fired:Set` (`trigger.ts:85`); roam cooldowns — per-POI `firedAt`
  (4 h), per-name `firedNameAt`, `minGapSec:75`, and cluster suppression (`roam.ts:155-204`, deleted in 1.1).

**The actual root cause is that the trigger center is the raw centroid `pois.lat/lng`** — the speakable
anchor is **never used by the trigger**:
- `/roam` selects `pois.lat/lng` and sets `radiusM: radiusForKind(kind)`
  ([`apps/api/src/index.ts:142-176`](../../apps/api/src/index.ts)).
- `/drives` candidates select `pois.lat/lng/kind` ([`apps/api/src/drives.ts:178-220`](../../apps/api/src/drives.ts)).
- `speakable_lat/lng` is consumed **only** by `sideOfApproach` for side-of-road *content*
  ([`packages/engine/src/geo.ts:169-174`](../../packages/engine/src/geo.ts)) — it never reaches
  `TriggerEngine`/`RoamEngine`.

Because the center is an un-snapped centroid, `radiusForKind` is deliberately **inflated to reach the
road**: roam `floorM:600`; kinds up to **1500 m** (mountain/peak), 1200 m (lake/point/bay)
([`geo.ts:33-41`](../../packages/engine/src/geo.ts)). `roam.ts` says as much — pins are un-snapped, "8/77
within 250 m of the road" silenced the basin, so the floor is roomy. **A big radius fires early and
imprecisely** (Harrah's), and an offset centroid means the radius+cone can still be satisfied *after* you
pass the real point (Zephyr Cove).

## The fix (in order of leverage)

### 1. Trigger on the road-snapped anchor, not the centroid — ✅ BUILT 2026-06-25
Both API loaders now coalesce `speakable ?? pin` as the trigger coordinate: the `/roam` output pin
([`apps/api/src/index.ts`](../../apps/api/src/index.ts)) and `NarrationRow.lat/lng` in BOTH `/drives`
corpus loaders ([`apps/api/src/drives.ts`](../../apps/api/src/drives.ts)) — so `candidateOf` →
`buildDrive` route-snaps from the road-adjacent anchor, and roam fires off it directly. Null anchors fall
back to the centroid (today's behavior). This is **the dominant lever** — every downstream number gets
honest once the center is on the road. No radius change here, so it's a pure improvement with no tuning:
an anchored POI now fires where you actually drive past it; the existing (large) floor just means it
fires a touch early, which is safe. Takes effect live on the next deploy.

### 2. Conditional radius — ✅ MECHANISM BUILT 2026-06-27 (FINAL NUMBERS deferred to the re-drive)
The floor was inflated to bridge centroid→road; with the center on the road it *can* drop. **But the 1a
run left ~99 POIs off-road (no anchor) — and an anchorless POI still triggers on its centroid, so
shrinking its floor would REGRESS it** (small radius + centroid = never fires). So this is **conditional
on anchor presence**, not a global `geo.ts` edit: a tight radius only when a POI has a road-snapped
anchor; keep the kind-aware floor when it doesn't.

**Built:** `triggerRadiusForKind(kind, anchored)` ([`geo.ts`](../../packages/engine/src/geo.ts)) returns
the tight `ANCHORED_TRIGGER_RADIUS_M` when `anchored`, else the existing `radiusForKind(kind)` floor.
Both trigger call sites now pass the anchor flag: roam ([`apps/api/src/index.ts`](../../apps/api/src/index.ts),
`speakableLat/Lng != null`) and the drive manifest (`NarrationRow.anchored`, set in `rowsToCorpus`,
consumed in `manifestClips` — [`apps/api/src/drives.ts`](../../apps/api/src/drives.ts)). The anchor-VALIDITY
path (`speakableAnchorMaxM`/`checkSpeakableAnchor`) is deliberately untouched — it keeps reading the
un-conditional `radiusForKind`, so the admin write boundary + corpus audit don't couple to the trigger
floor. Engine tests cover tight-when-anchored vs floor-when-not.

**Deferred:** the FINAL number — `ANCHORED_TRIGGER_RADIUS_M` is a **conservative 250 m start** and is
**not desk-tunable**. The re-drive tunes that single constant (and the roam `floorM` if needed) and
verifies against the exact POIs that failed (Edgewood, Harrah's, Van Sickle, Zephyr Cove). The
mechanism turns the next drive into a one-constant tuning pass, not an engineering pass.

### 3. Retire passed points (independent) — ✅ BUILT 2026-06-25
A "not approaching / distance increasing" guard so a point that's now behind you stops being eligible
**even when live heading is unknown** (`-1`) or below the 5 mph gate — the case the heading cone misses,
and the likely cause of "fired after passing." Both `TriggerEngine` and `RoamEngine` now track per-point
closest-approach distance (`minDistM`) and skip firing once distance grows past it by `recedeMarginM`
(40 m drives / 60 m roam, an option), re-arming when the point leaves range (out-and-back). **Roam fix:**
the min-gap governor used to `return []` early while a clip played; tracking moved inside the loop so a
point passed *during* a clip is retired, not narrated late when the gate reopens. Covered by tests in
`packages/engine/test/{trigger,roam}.test.ts`.

### 4. Use the stored approach heading for drives *(optional)*
`approachHeadingDeg` is already computed and persisted in `drives.selection` + the manifest
([`drive-select.ts:46-52`](../../packages/engine/src/drive-select.ts), `drives.ts:235-238`) but the live
`TriggerEngine` **ignores it** (uses live `fix.headingDeg`, `trigger.ts:116-117`). For drives, fall back
to "am I heading roughly along the stored approach bearing?" when live heading is noisy/unknown. (Roam
has no route → relies on live heading + step 3.)

### 5. Background-GPS pause *(flag only — out of scope)*
`apps/mobile/src/lib/gps.ts:345-349` notes the foreground `watchPositionAsync` can't set
`pausesUpdatesAutomatically` → iOS may pause GPS at a long stop/overlook, exactly when a stop should fire.
Only escalate to background updates if the on-device re-drive shows pausing; tracked, not built here.

## Sequencing

- **Step 3** ships independently (no 1a dependency) and addresses the most damaging "fired after passing."
- **Steps 1–2** ship after [1a](road-snapped-anchors-spec.md) populates anchors; they're a few-line
  consume + a retune.
- **Step 4** is a drive-only robustness add. **Step 5** is conditional on device evidence.

## Validation

Numbers (radii, lead seconds, retire margin) are **not** desk-tunable — they need a Tahoe re-drive on a
dev build, the same loop that produced this feedback. Verify against the exact POIs that failed
(Edgewood, Harrah's, Van Sickle, Zephyr Cove) before calling it done.

## Touchpoints

- `packages/engine/src/geo.ts` (`radiusForKind`), `trigger.ts` (passed-point retire, optional
  stored-heading gate), `apps/api/src/drives.ts` (coalesce anchor as center). ⚠ `roam.ts` and
  `apps/api/src/index.ts`'s pin loader were the other half of every step above and no longer exist.
- No schema change required (steps 1–4 reuse existing columns).
