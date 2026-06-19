# Downtime callouts — build spec / handoff

> **Schema-names note (2026-06-13):** identifiers below predate the 2026-06-12 segments/tracks refactor — read `tour_stops`→`segments`+`tracks` and `tour_brackets`→`tour_frames`.

**Small persona-only audio beats the skipper drops into the quiet stretches so he feels
*present on this drive*, not like a jukebox that only fires at the curated stops.** A third
audio content type alongside route-anchored `tour_stops` and lifecycle `tour_brackets`.

> **Status: SPEC ONLY — nothing built.** This is a future-feature design, gated behind the
> proven phone player (M1 Phase 4/5) like the rest of the charm roadmap. Decided in a design
> session 2026-06-09; supersedes an earlier "fold callouts into scenic stops" sketch (see §2).

## 0. TL;DR for the next Claude

- **Callouts = persona-only (NO facts) short clips, fired by a runtime scheduler during
  downtime, ducked OVER the soundtrack.** Persona-only is the whole safety story: they assert
  no facts, so they can't hallucinate and they sidestep the project's hardest invariant
  ("persona in DELIVERY, never FACTS") entirely. Mood/character/drive-state beats only —
  *"long quiet stretch… my favorite kind,"* *"that light right now, huh."*
- **Own table (`tour_callouts`), own scheduler (in `@skipper/engine`).** NOT a `stopType`,
  NOT placed by the studio pipeline. This keeps `tour_stops` strict and the geofence engine
  homogeneous (same reasoning that put intro/outro in their own `tour_brackets` table).
- **The playback path already exists.** `useDrive` is a queue + pump + single audio player, and
  the intro/outro brackets already prove that a non-route item rides that queue under a sentinel
  seq. Callouts reuse it verbatim. **The only genuinely new code is (1) a pure
  `CalloutScheduler` and (2) a read-only ETA lookahead on `TriggerEngine`.** Both couch-testable.
- **Where to start:** §6 (the scheduler) is the load-bearing work; §7 is the tuned ruleset;
  §9 (the sim perturbations) is what makes the whole thing testable without a car. Build the
  scheduler against the simulator first — but **read §9 first**, because the current 60 mph sim
  has *zero* quiet to fire into (Finding 2).
- **v1 is persona-only and placeless.** Fact-grounded spatial *"look left, that's Cave Rock"*
  callouts are a separate, harder **Phase 2** (§12) — they need minor-POI anchors, attribution,
  and a second geofence pass. Do not conflate them.

## 1. The three audio content types (where callouts fit)

| | `tour_stops` (story/scenic/break) | `tour_brackets` (intro/outro) | **`tour_callouts`** |
|---|---|---|---|
| Anchor | route position (geofence) | placeless | **placeless** |
| Trigger | `TriggerEngine` proximity | lifecycle (start / end-anchor) | **runtime scheduler (downtime)** |
| Grounding | story=facts; scenic/break=persona | persona-only | **persona-only (no facts)** |
| Ready-gate | mandatory (non-null audio) | mandatory (co-commit in batch) | **OPTIONAL (never gates ready)** |
| Count | many | 0–2 | a **pool** (~12–15), few fire |
| Music | replaces (`'clip'` segment) | replaces | **ducks OVER (overlay)** |
| Selection | the one baked clip | the one baked clip | **runtime-picked from pool by drive-state** |

Callouts being **optional** is load-bearing: a tour is `ready` with zero callouts, they do NOT
co-commit in `finalizeTourReady`, and they can be generated in a **separate pass even after a
tour is ready**. The core pipeline is untouched; callouts are pure enhancement.

## 2. Why this shape (decisions — do NOT re-derive)

A "fold callouts into scenic stops" alternative was considered and **rejected**. Scenic stops are
also persona-only, so the fold would have made callouts studio-placed geofenced anchors with a
pool — cheaper, but it can't do the thing that matters. The decisions:

- **Runtime scheduler over studio-placed anchors.** A fixed anchor is *condition*-aware at
  best (golden hour at a known point). The beats that most prove "he's alive" are **emergent** —
  *"you've been quiet a while," "we've been crawling through this for ten minutes," "take your
  time"* — and emergent downtime is unpredictable at generation time. For a charm-first toy where
  the persona IS the product, responsiveness beats cost-efficiency (polish-over-scale, on brand).
- **Separate `tour_callouts` table over overloading scenic stops.** Pool + duck + placeless +
  optional + scheduler-fired is genuinely a different beast; folding it into a `tour_stop`
  muddies what a stop means (route-anchored, grounded-or-scenic, ready-gated, homogeneous engine).
  Keep both abstractions sharp — the `tour_brackets`/Option-B precedent.
- **The cost is accepted with eyes open.** The pressure test (§ below) found this is the more
  complex path and that on dense corridors callouts fire *mostly on the emergent path*. That is
  the deliberate trade.

### What the pressure test established (carry these as constraints, not warnings)

Grounded in `packages/studio/src/config.ts`:
- `PACING.standard.minGapSec = 180`, `TARGET_SECONDS.story = 120` → the config's own comment:
  *"a ~120s clip with a 180s floor leaves ~60s of quiet."* The studio pipeline **deliberately
  densifies to kill silence** (it lowered the floor from 240s to admit more grounded POIs).
- **Finding 1 — callouts barely fire on dense corridors via *planned* gaps.** ~60s standard gaps
  are below any sane floor. Where a grounded POI exists, a real story stop beats a persona-only
  callout. So callouts add value on POI-*sparse* transit legs and, primarily, on **emergent**
  downtime. On `emerald-bay-run` (dense), expect the scheduler to fire almost entirely on
  emergent events. **This is why the scheduler exists; it is not a bug.**
- **Finding 2 → Requirement A (§9).** The 60 mph sim has *negative* quiet (a 180s design gap at
  30 mph becomes ~90s at 60 mph, below the 120s clip → the player backs up). The sim must run at
  ~30 mph and be able to inject downtime, or the feature is untestable until real Tahoe traffic.
- **Finding 3 → Requirement B (§7.2).** Emergent downtime is now the primary path, so the
  parked-empty-car case is central, not an edge.

## 3. Data model — `tour_callouts`

```
tour_callouts(
  id              uuid pk,
  tour_id         uuid → tours (cascade),
  script          text,
  audio_url       text,            -- tour-scoped R2 key: clips/<tourId>/callouts/<id>
  audio_duration_ms  int,
  mood            callout_mood,    -- the applicability tag the scheduler matches on
  reviewed        bool default false
)
-- callout_mood pgEnum: generic | golden_hour | night | crawl | halt | long_gap
-- NO poi_id, NO lat/lng/trigger_radius (placeless).
-- attribution + facts_hash OMITTED (persona-only → nothing to attribute, nothing to go stale).
-- NOT referenced by tour_stops; NOT in the finalizeTourReady batch (optional).
```

`mood` is how a drive-state signal selects a clip at fire time:
- `generic` — any downtime (the default pool, the bulk of it)
- `golden_hour` / `night` — *conditions* (function of position + clock; see §8)
- `crawl` — slow stop-and-go traffic
- `halt` — a brief full stop (red light)
- `long_gap` — a longer "settle in for a bit" beat for a wide void

## 4. Generation — `narrateCallouts()`

A new pipeline step (alongside `narrateIntro`/`narrateOutro` in `packages/studio/src/pipeline/narrate.ts`):
- **persona-only, no fact sheet**, notch-parameterized, from the region's `PersonaDef`
  (the per-region persona registry — `personaForRegion`).
- **quality-gated** like stops (warmer delivery, no-bow, no mini-recap) but scaled to ~1–2
  sentences (`TARGET ~12s`, shorter than a `scenic` at 20s).
- **kit BANNED** (the persona kit's only home is the intro — same guard as stops).
- **`mood`-tagged**, run through the existing diversity tracker so the pool isn't 12 variants of
  one beat. Over-provision: ~**12–15** per tour so the scheduler has variety + drive-state
  matches, and so cross-drive replays don't repeat for ~3 drives (§7.3).
- TTS → tour-scoped R2 (`clips/<tourId>/callouts/<id>`), then insert `tour_callouts` rows.
- **Separate pass:** can run after a tour is already `ready` (no batch co-commit). A regen tool
  (extend `resynth-tour.ts`) can re-author the pool independently.

**Lint guard:** add a check that a callout script names *nothing factual* (mirrors the
kit-from-stops ban). A callout that asserts a fact is a bug — that's a story stop's job.

## 5. API / DTO / offline

- `@skipper/shared`: tour detail grows `callouts: CalloutDTO[]` ( `{ id, script, mood, audio }` )
  alongside `intro`/`outro`/`stops[]`.
- `apps/api`: `/sign` serves callout clips (tour-scoped R2 keys), same presign path as stops/brackets.
- **Offline (`apps/mobile/src/lib/offline.ts`):** add callout clips to the download manifest so a
  downloaded tour carries its whole pool — selection is 100% on-device (Tahoe dead zones; §8).

## 6. The player — the load-bearing new code

### 6.1 Reuse: callouts ride the existing queue (like brackets)

`apps/mobile/src/lib/useDrive.ts` is a **queue + pump + single audio player**: `queue.current`
(FIFO of seqs), `pump()` (plays next if `!clipBusy`), the clip-load effect keyed on `activeSeq`,
lock-screen, stall/re-sign. Brackets already flow through it under sentinel seqs
(`INTRO_SEQ`/`OUTRO_SEQ`, `frameKindForSeq`). **Callouts do the same:**
- A **sentinel seq range** for callouts (e.g. a `CALLOUT_SEQ_BASE` block in `engine`,
  parallel to the bracket sentinels) + a `calloutForSeq(seq)` lookup.
- The `urls` map (from `loadPlayback`) carries callout clips under those seqs.
- Enqueue a callout = push its sentinel seq + `pump()`. Everything downstream is free.

### 6.2 New: the pure scheduler (in `@skipper/engine`)

```ts
// engine — pure, no I/O, unit-testable with synthetic fix streams (like TriggerEngine).
class CalloutScheduler {
  constructor(callouts: CalloutRef[], opts?: Partial<CalloutOptions>)
  /** Called each fix while in ducked-quiet. Returns a callout to fire, or null. */
  consider(s: {
    secSinceLastAudio: number
    etaToNextStopSec: number | null   // null = no stops left (use end-anchor ETA, §7.1)
    motion: 'moving' | 'crawl' | 'stopped'
    secStopped: number                // 0 unless motion==='stopped'
    nearLastStopM: number | null      // distance to the last-FIRED stop's trigger point
    driveState: { goldenHour: boolean; night: boolean }
    tSec: number
  }): CalloutRef | null
}
```

### 6.3 Wiring it into `useDrive`

- `TriggerEngine` gains a **read-only** `etaToNextStopSec(fix)` (the `update()` firing logic is
  UNCHANGED — `trigger.ts` is "do not modify" for the engine; this is purely additive):
  distance from the current fix to the next un-fired stop's trigger point, minus its
  `effectiveRadiusM`, over the sanitized speed. Treat the **outro/end-anchor as a pseudo-stop**
  when no real stops remain (so a callout never steps on the sign-off — §7.1).
- The scheduler ticks **from `handleFix`** — which already runs on every fix, including between
  stops. After `engine.update(fix)` returns no events AND we're in ducked-quiet
  (`!clipBusy.current && queue.current.length === 0 && driving && !paused`), call
  `scheduler.consider(...)`; if it returns a callout, push its seq + `pump()`.
- **Music duck-overlay (decided):** `useDriveMusic` gains a **third state** — music stays active
  at reduced gain *under* the callout — gated on `isCalloutSeq(activeSeq)`. A full stop still
  flips to `'clip'` (music replaced); a callout ducks. **A callout does NOT advance the song
  rotation** (it is not a `'clip'`), so the same track plays straight through it.
- **Preemption: stops win by construction.** The scheduler only fires in gaps with margin and
  **never enqueues a callout when a stop is queued or imminent** (§7.1). If a stop fires
  mid-callout anyway (GPS jitter), it queues behind the short (~12s) callout and plays a few
  seconds late — accepted for v1. No fade-out preemption.

## 7. The scheduler ruleset (tuned)

Numbers flagged **[P]** are *principled* (derived from config/physics — trust onto the first
drive) or **[E]** *ear-tune* (a first-drive starting point you'll move once you hear it).

### 7.1 Normal downtime gate (the moving case)

Fire a `generic` (or condition-matched) callout only when ALL hold:
- `secSinceLastAudio ≥ FLOOR` — **[E] 75s** (let silence breathe).
- `etaToNextStopSec ≥ FLOOR + calloutDur + margin` — **[P] ≈ 95s** (`75 + 12 + 8`). The two-sided
  gate auto-**centers** the callout in the void and protects both the just-finished payoff and the
  next stop. Net effect: callouts only fire where stop spacing ≳ **4.75 min** — which is exactly
  the sparse stretches (Finding 1).
- `etaToNextStopSec` counts the **outro/end-anchor as a pseudo-stop** when stops are exhausted.
- **Budget — rate-based, not flat [E]:** ≥ **4 min** between callouts + a soft per-drive cap.
  Rate-based prevents front-loading the whole budget into the first long gap.

### 7.2 The parked / rider-presence rule (Requirement B)

Sanitize speed first (the iOS `-1` landmine — `expo/expo#5401`, sim AND device). Motion bands:
- **stopped:** `< 0.5 m/s` (~1 mph)
- **crawl:** `0.5 – 2.2 m/s` — upper bound **[P]** reuses `headingGateMps = 2.2` from `DEFAULT_TRIGGER`
- **moving:** `≥ 2.2 m/s`

| State | Callouts? | Why |
|---|---|---|
| moving | normal §7.1 gate | — |
| **crawl** | **allowed** (`crawl` mood eligible) | a *moving* car can't be abandoned → rider present |
| stopped `< 90s`, **away** from last stop | one `halt` beat OK | red lights run ≤120s → present |
| stopped `< 90s`, **within ~175m** of last-fired stop | **silent** | pulled over *at the view* → got out |
| stopped `≥ 90s` (anywhere) | **silent** | overlook / gas / jam all default to silence |
| motion resumes after a sustained stop | `RESUME_GRACE` then re-arm | don't blurt the instant you roll |

- `BRIEF_HALT = 90s` **[E]** (bias short — a missed light-beat is just silence; talking to an
  empty car is the embarrassing failure), `RESUME_GRACE = 25s` **[E]**.
- `AT_STOP_RADIUS ≈ 175m` **[P-ish]** (`TRIGGER_RADIUS_M = 120` + slack for the lot past the
  trigger point); measured against the **last-fired** stop (the one they're likely visiting).
- **Free assist:** if the rider pockets the phone, the screen locks → foreground GPS dies
  (keep-awake is scoped to `driving`; spec §5 of the GPS spec) → no fixes → **silent by
  construction.** So the rule only has to guard ONE case — *phone left on the mount while they
  walk to the overlook* — which `AT_STOP_RADIUS` catches exactly. Optional belt-and-suspenders:
  `AppState` backgrounded + stopped → force silent.

### 7.3 Variety

- **Within a drive:** each callout fires at most once (debounce, like stops).
- **Across drives:** persist a per-tour played-callout set locally; prefer unplayed. Pool of
  ~12–15 → ~3 replays before he repeats himself (ties to the logbook "doesn't repeat himself"
  charm note).

## 8. Drive-state signals (device-local, OFFLINE-safe)

Hard constraint: the whole tour is downloaded and driven in dead zones → selection is 100%
on-device, no network, no per-callout server call.
- **golden_hour / night:** device clock + a **pure solar-elevation calc** from the route's
  lat/lng + date (no API). Golden hour ≈ within ~60 min of sunrise/sunset; night ≈ sun below
  horizon. Bundle the formula in `engine`.
- **motion / secStopped:** from the **sanitized** `GpsFix.speedMps`.
- **elapsed / ETA:** `tSec` deltas + the §6.3 lookahead.
- **Deferred:** weather, traffic feeds, anything mic-based (network / privacy).

## 9. Requirement A — the simulator must manufacture downtime

Without this the emergent path (the *primary* path, §2) is untestable until you're physically
stuck in Tahoe traffic. Extend `simulatedSource` in `apps/mobile/src/lib/gps.ts`:

```ts
simulatedSource(polyline, {
  baseMph: 30,            // was effectively 60 (SIM_MPH); 30 matches the studio pipeline's design
  timeScale: 1,          // 8× fast-replay still correct: tSec is drive-time, dwells read right
  perturbations: [
    { atM,        kind: 'stop',  durationSec },   // emits speed≈0 fixes, tSec advancing
    { fromM, toM, kind: 'crawl', mph },           // overrides base speed over a route span
  ],
})
```
- `kind: 'stop'` holds the position and emits near-zero-speed fixes for `durationSec` of
  drive-time → drives the §7.2 parked rule. `kind: 'crawl'` overrides the base speed over
  `[fromM, toM]` → drives the crawl band. Pure, deterministic; composes with fast `timeScale`.
- **Also flip the `useDrive` default `SIM_MPH` from 60 → ~30.** Beyond callouts this fixes a
  latent correctness gap (at 60 mph the sequential player backs up, violating the `QUEUE_LAG`
  invariant the studio pipeline enforces at 30 mph).

**Ship three canned scenarios — they double as the emergent-path acceptance tests:**
1. 45s `stop` on open road → expect **one `halt` beat**.
2. 300s `stop` at a viewpoint stop's coord → expect **silence** (the empty-car guard).
3. 6 mph `crawl` for 1.5 km → expect **`crawl`-mood callouts**.

If those pass in the sim, the emergent path is verified before you're ever in a car.

## 10. Build phases (file-level)

1. **Scheduler core (engine, couch-safe, fully testable).**
   `CalloutScheduler` + `etaToNextStopSec(fix)` on `TriggerEngine` + the solar-elevation util +
   `CALLOUT_SEQ_BASE`/`calloutForSeq`/`isCalloutSeq`. Unit tests for §7's gates incl. the §9
   scenarios. No app changes yet.
2. **Sim perturbations (engine/`gps.ts`).** `baseMph` + `perturbations` + `SIM_MPH→30`.
   Wire the three acceptance scenarios into the sim screen for manual exercise.
3. **Schema + migration (CHECKPOINT — live DB).** `tour_callouts` + `callout_mood` enum. Clean +
   destructive (no users; CLAUDE.md). NOT added to `finalizeTourReady`.
4. **Studio.** `narrateCallouts()` (persona-only pool, mood-tagged, diversity-tracked) + the
   no-fact lint guard + tour-scoped R2 writes + a regen path in `resynth-tour.ts`. Separate pass.
5. **API/DTO + offline.** `CalloutDTO`, `/sign` for callout clips, offline manifest entries.
6. **Player wiring (`useDrive` + `useDriveMusic`).** Tick the scheduler from `handleFix`; the
   music third-state (duck, no rotation advance); lock-screen handling for the short clip (likely
   skip claiming Now Playing for a ~12s beat to avoid flicker).
7. **Tune by ear (CHECKPOINT — needs the §9 sim at 30 mph, then a real drive).** Move the **[E]**
   knobs: `FLOOR`, `BRIEF_HALT`, budget spacing, pool size, whether the `halt` beat earns its keep.

## 11. Gotchas

- **The 60 mph sim has no quiet** — §9 is a prerequisite, not a nicety.
- **iOS `-1` speed/heading** — sanitize before the motion bands or a parked car reads as moving.
- **Music rotation** — a naive callout counts as a `'clip'` and shuffles the track every time;
  it must NOT advance the rotation.
- **Screen-lock kills GPS** → silent by construction (use it; it's why §7.2 only guards the
  phone-on-mount case).
- **Don't let a callout step on the outro** — the §6.3 lookahead must treat the end-anchor as a
  pseudo-stop.
- **Callouts are optional** — never add them to the ready-gate; a tour with zero callouts is
  valid and common (dense corridors).

## 12. Phase 2 (deferred) — fact-grounded spatial callouts

The *"look left, that's Cave Rock"* magic. Materially harder and out of v1 scope: it names real
things → it's **fact-grounded**, so it needs minor-POI anchors along the route (curated or OSM) +
the full attribution path + a **second geofence pass** (callouts become coordinate-bearing
triggerables, breaking the "engine consumes only `tour_stops`" homogeneity). Gate it behind v1
landing and the proven player. Do not let it leak into v1's persona-only scope.

## 13. Provenance

Designed 2026-06-09. Grounded against, and citing for re-check:
- `packages/engine/src/trigger.ts` — `TriggerEngine`, `GpsFix`, `DEFAULT_TRIGGER`
  (`leadSeconds 12`, `headingGateMps 2.2`, `headingConeDeg 90`), `effectiveRadiusM`.
- `apps/mobile/src/lib/useDrive.ts` — queue/pump/`clipBusy`, `handleFix`/`handleEnd`,
  `INTRO_SEQ`/`OUTRO_SEQ`/`frameKindForSeq`, `SIM_MPH=60`/`SIM_FAST_SCALE=8`,
  `DRIVE_INTERRUPTION_MODE` (`'doNotMix'` → `'duckOthers'` is Phase 0), `useDriveMusic`
  (`'clip'`/`'drive'` segments).
- `apps/mobile/src/lib/gps.ts` — `simulatedSource`/`liveSource`/`FixSubscription`.
- `apps/mobile/src/lib/offline.ts` — `loadPlayback`/`resignPlayback`, the download manifest.
- `packages/studio/src/config.ts` — `PACING` (standard `minGapSec 180`/`maxNarratedStops 16`),
  `TARGET_SECONDS` (`story 120`/`scenic 20`), `QUEUE_LAG_WARN_SEC 45`, `TRIGGER_RADIUS_M 120`,
  design speed `13.4 m/s ≈ 30 mph`.
- `packages/studio/src/pipeline/narrate.ts` — `narrateIntro`/`narrateOutro`/`persistBracket`,
  the `finalizeTourReady` `db.batch` ready-gate.
- The per-region persona registry (`personaForRegion`, `PersonaDef`, the kit) and the
  `tour_brackets` Option-B precedent (docs/specs/tour-structure-spec.md; the tour-structure handoff doc has since been deleted).

**Decisions locked this session:** runtime scheduler over the studio-placed "fold"; separate
`tour_callouts` table; persona-only v1 (spatial = Phase 2); duck-overlay; stops-win-by-construction;
the §7 tuned ruleset incl. the parked-car rule (Req B) and the sim perturbations (Req A).
