# The desk-drive harness — making a drive re-runnable

> **Status:** ✅ **BUILT 2026-08-03 — all five parts (§4.1–4.5) are in and green.** Written the same
> day as a proposal; kept as the reasoning behind what shipped, with the outcomes folded in below.
> What is NOT done is the only thing that needs a car: **recording an actual trace.** Until then the
> sweep runs on synthetic input and says so in its own output. Prompted by the founder's
> constraint: *"I'm limited in my ability to go out and actually drive."* Companion to
> [../guides/1-1-submission-sweep.md](../guides/1-1-submission-sweep.md), whose §0 documents what the
> two desk passes can and cannot prove today; this is how that ceiling gets raised.
> ⚠ It argues directly with a comment at `packages/engine/src/geo.ts:54` — read §3 before dismissing
> either one.

## 1. The diagnosis: the seam is in the wrong place

`GpsFixSource` (`apps/mobile/src/lib/gps.ts`) is the swap point between a simulated drive and a real
one. It sits **above** `liveSource`, so choosing the simulator replaces the entire live path — not just
the radio.

What a simulated drive **does** exercise, and it is a lot: the real `TriggerEngine`, the real fire-queue
(`decidePump`), the real clip store, the real audio session and focus handover, the lock screen, the
offline store, the whole UI.

What it **could not reach** — the diagnosis that motivated all of this — because `simulatedSource`
returns finished `GpsFix` objects. ✅ Every row is now reachable from a desk via `replaySource` /
`driveTrace`; the table is kept because it is the argument for why:

| Skipped on every desk drive | What it guards |
|---|---|
| `accuracyOk` / `accuracyCeilingM` | the speed-aware accuracy gate — the field-confirmed **zero-fire** failure |
| `saneNonNeg` | the iOS `-1` speed sentinel |
| the RAW-course pass-through | the heading gate; `gps.ts:228` documents a real zero-fire bug found *only* on a road |
| `projectForwardIndex` | monotonic projection + off-route rejection (the "App Review in Cupertino fires the outro in seconds" bug) |
| `reachedRouteEnd` | the three-clause end predicate |
| watch lifecycle | `.remove()` leaks (expo/expo #35925/#35926), pause/resume re-acquisition, permission, reduced accuracy |

Each of those pure functions was unit-tested **in isolation, one `describe` each**, while their
*composition* — fed an actual stream — was tested nowhere. And the fixes a simulated drive emits are perfect:
exactly on the polyline, exact speed, exact bearing, `alongM` computed by the generator rather than
recovered by the projection cursor. They contain none of the error the code above exists to survive.

✅ **The dev-settings copy used to claim otherwise, and it was fixed in the same pass.** It read
*"Simulated GPS replays a **recorded** Tahoe drive through the **real engine**"* — but there was no
recorded drive anywhere in the repo, and `simulatedSource` never touched the live mapping pipeline.
Copy that invites over-trusting a desk pass is worse than no copy.

## 2. The reframe: the limitation isn't "desk", it's "synthetic"

A desk drive is weak because its input is *invented*, not because it happens indoors. Change the input
and almost the whole gap closes. That reframes every item below as one question: **where do realistic
fixes come from, and what can we do with them once they're re-runnable?**

## 3. The argument this picks with the codebase

`packages/engine/src/geo.ts:54`, on `ANCHORED_TRIGGER_RADIUS_M = 250`:

> *"CONSERVATIVE start — the final number is **NOT desk-tunable**; it's pinned on the next on-device
> Tahoe re-drive against the POIs that failed (Edgewood, Harrah's, Van Sickle, Zephyr Cove)."*

**That comment is right about today and wrong as a permanent rule.** The radius exists to absorb GPS
error and approach geometry; tuning it against noiseless synthetic fixes is meaningless, because the
synthetic drive contains neither. So "not desk-tunable" is a correct statement about *synthetic* input.

A **recorded** trace is a different category: it is field data, replayed. It carries the real multipath,
the real approach angle and the real speed at those exact four POIs. Sweeping the radius against it is
not desk-guessing — it is re-analysing a drive that already happened.

And the sweep needs no refactor at all. `TriggerEngine` already takes `Partial<TriggerOptions>`, and
`triggerRadiusM` is **per-stop data** on `DriveStopRef` (the sim CLI computes it via
`triggerRadiusForKind` and passes it in), so varying it is a loop, not an edit.

⚠ **This inverts the ordering, and that is the most actionable thing in this document.** One drive
yields *one sample* of one radius. One drive **with a recorder running** yields the whole curve, plus a
permanent regression fixture. So the recorder has to exist **before** the next drive, or that drive is
spent at the old exchange rate. The roam drives that produced the eight TestFlight fixes are already
unrecoverable for exactly this reason.

## 4. The capabilities, ranked

### 4.1 Move the seam down — split `liveSource` into *watch* + *mapper*

Extract `liveSource`'s `onLocation` body into a mapper built from `(polyline, onFix, onEnd)` and
consuming a structurally-typed location object. Then `liveSource` = expo-location watch → mapper, and a
new `replaySource(polyline, trace)` = timer → **the same mapper**.

Payoff: every desk drive runs the accuracy gate, the sentinel sanitize, the projection cursor and the
end predicate — the whole table in §1 — against inputs you control. It also makes that composition
testable under `bun test`, which it currently is not.

Cost: small, but it is safety-critical GPS code, so it wants review rather than speed. Unlocks 4.2–4.5.

### 4.2 The black box — *drive once, replay forever*

Record the raw fix stream during any live drive (lat, lng, accuracy, speed, course, timestamp) and let
it be exported off the phone. `expo-file-system` is already a dependency; export can go through the
system share sheet.

This is **the highest-value item under the stated constraint**, and the only one with a deadline: a
trace not recorded is gone. Every drive you *do* manage then becomes a permanent fixture with real
noise baked in, replayable forever, by anyone, in CI.

⚠ **Local-only, and this is not a detail.** A raw GPS trace is precise location data about the founder.
INV-13 keeps coordinates out of analytics events deliberately; a recorder that uploads would walk
straight around that. Write to app storage, export by explicit user action, never to a server. If it is
ever opened past admins, it is new personal data and `purgeUserData` has to chase it.

### 4.3 Fault injection — synthesize what the road does

With 4.1 in place, a trace is just data, so it can be *degraded* on purpose. Each of these maps to a
branch the code claims to handle and which no desk pass reaches today:

- canyon multipath (accuracy 80–150 m, lateral jitter) — the case `accuracyCeilingM`'s speed-aware
  loosening exists for
- tunnel / dead zone (no fixes for N seconds) — the stall ladder and the windowed-cursor fallback
- cold start (first fixes at ~1000 m accuracy) — the unsettled-fix rejection
- the iOS sentinels (`speed = -1`, `course = -1`, `accuracy = -1`)
- position jumps and out-of-order timestamps
- reduced (approximate) accuracy — `isReducedAccuracy`

### 4.4 Assertions instead of eyeballs

The sim CLI already prints the expected schedule; `useDrive` already emits `stop_fired`,
`stop_skipped{reason}` and `drive_completed` (`d79df36`). Close the loop: have a replay run produce a
machine-readable outcome and diff it against the CLI's prediction. A 40-minute sitting collapses into a
pass/fail, and — combined with 4.1 — desk drives can run headless in `bun test` by the hundred, costing
no founder time whatsoever. That is also the honest answer to the open TODO item that says `useDrive`'s
remaining confidence needs "a device pass or jest-expo + RNTL".

### 4.5 Parameter sweeps — the thing driving genuinely cannot do

Per §3: with one recorded trace, sweep `triggerRadiusM` and `leadSeconds` across a range and read off
which values fire each stop at the right moment. This is strictly *better* than driving, because a car
samples one parameter value per trip. It is what finally closes `trigger-precision-spec.md` step 2,
parked since June.

## 5. What still cannot be done at a desk

Be honest about the floor. No harness reproduces: a *novel* RF environment (a trace only replays roads
you have already driven), thermal and battery behaviour over a real hour, Bluetooth/CarPlay handover,
an incoming call mid-clip, or the plain question of whether the timing *feels* right at 55 mph with a
windscreen in front of you. The recorder narrows this to "roads never driven" — which is a coverage
problem, not a fidelity one, and it shrinks with every trip.

## 5b. What shipped, and what it found

| Part | Where | Outcome |
|---|---|---|
| 4.1 seam | `@skipper/engine/fix-mapper.ts`, `apps/mobile/src/lib/gps-source.ts` | `createFixMapper` extracted from `liveSource`; `replaySource`/`replayHeadless` run the identical mapping. Both critical guards mutation-verified. |
| 4.2 black box | `@skipper/engine/trace.ts`, `apps/mobile/src/lib/trace-export.ts` | Records pre-gate, keeps the iOS sentinels verbatim, caps by stopping (never a ring), flushes at `teardownSource`. Dev-only, local-only, share-sheet export. |
| 4.3 fault injection | `apps/mobile/src/lib/gps-fault.ts` | Six seeded, deterministic degradations + `degrade()`. |
| 4.4 headless drive | `@skipper/engine/harness.ts` | `driveTrace` — a whole drive asserted in milliseconds. |
| 4.5 sweep | `packages/sim/src/sweep.ts` | Grid over floor × lead, per-stop thresholds, `--trace` for real input. |

⚠ **§3's argument was settled by MOVING code, not by winning it.** The mapper, the trace format and
the harness all live in `@skipper/engine` now, because `packages/sim` and `bun test` must run the code
the phone runs — a mapper only the phone could execute is exactly the drift the engine exists to
prevent. `--trace` was a deliberate refusal until that move; it works now for that reason alone.

**Three findings the harness produced before anyone drove anywhere:**

1. **A GPS dropout that SPANS a stop loses it, silently and permanently.** No fix lands inside the
   radius, so the passed-point retire drops it. Correct (with no GPS you cannot know you passed it)
   but not harmless, and none of `StopSkipReason`'s five members names it — so it lands in
   `drive_completed`'s unattributed remainder, which cannot separate a dead zone from a stop that was
   never near the road. Naming it needs a sixth reason, not a new event.
2. **`ANCHORED_TRIGGER_RADIUS_M` is dead weight above ~47 mph** at the baseline lead, because
   `effectiveRadiusM = max(floor, speed·lead)`. The parked question is therefore not "what should the
   floor be" but **"what should it be at town/approach speed"** — which is where those four failing
   POIs (Edgewood, Harrah's, Van Sickle, Zephyr Cove) actually are.
3. **An iOS `-1` speed inside a canyon collapses the accuracy ceiling to its floor and the fixes get
   rejected** — neither fault does that alone. Realistic, since iOS drops course and speed exactly
   where fix quality drops, and it means a composed run's rejection count is not a canyon result.

## 6. Open decisions

- **How far to go now** — 4.1 alone materially improves every future desk pass; 4.1 + 4.2 is the
  compounding one; 4.4 is what removes founder time from the loop permanently.
- ✅ **DECIDED 2026-08-03 (founder): the recorder gates on `isAdmin`, not `__DEV__`.** Under `__DEV__`
  only an Xcode-launched build records, so the TestFlight drives actually worth capturing would have
  banked nothing — the one loss that cannot be undone. `isAdmin` is the same server-set role that
  already gates the Developer screen the traces are read from, so it widens nothing a non-admin can
  reach, and traces stay local-only. **Still open:** whether to ever gather traces from ordinary
  riders. That would reach roads nobody here has driven — genuinely valuable, and a much larger
  consent/retention question that is founder's alone.
- **Fix the `voice.ts:390` copy now**, independent of everything else — it currently describes a
  feature that does not exist.
