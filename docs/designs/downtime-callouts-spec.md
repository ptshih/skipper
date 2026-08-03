# Downtime callouts — build spec / handoff

> **Status: SPEC ONLY — nothing built, nothing spent.** Designed 2026-06-09 (supersedes an earlier
> "fold callouts into scenic stops" sketch, §2). **Re-interrogated 2026-08-03 in a Skipper Hours
> session: the idea SURVIVED, one locked decision is OVERTURNED (duck-overlay → the music steps
> back), and the v3 deferral's stated reason does not hold up. Read §0 before anything else — it
> amends the body.** ✅ **Step 0 is DONE (§0.6): the quiet is MEASURED, and it overturns Finding 1 —
> the planned-gap path is abundant, not marginal (5 of 8 windows eligible at 45 mph; the Skipper is
> silent ~75% of a drive).** Still NOT greenlit — what is measured is that there is ROOM, not that a
> beat is welcome; that stays an ear question.

> **Schema-names note (updated 2026-06-19 for the V2 roam-first model):** identifiers below predate
> the V2 pivot that dropped the entire authored-tour storage (migration 0009) — `tours`,
> `tour_stops`, `segments`, `tracks`, and `tour_brackets` are ALL gone (see `packages/db/src/schema.ts`).
> Read every reference as its V2 equivalent. The DELIVERY concept (placeless, persona-only downtime
> beats, duck-overlaid) survives intact onto V2 — but **the placeless-framing storage this feature
> assumed no longer exists**:
> - `tour_stops` → the 1:1 `narrations` atom (one telling per `pois` row).
> - **`tour_brackets` (intro/outro frames) had NO surviving home.** The placeless `asides` table that
>   briefly carried intro/outro framing in early V2 was itself **DELETED in migration 0019**
>   (`0019_drop_asides.sql` — `DROP TABLE "asides" CASCADE`; see
>   [geometry-first-regions](../decisions/geometry-first-regions.md)). Placeless framing **returns in
>   v3 with guided tours** — there is no v2 substrate for it.
> - **`tour_callouts` therefore has no v2 storage either.** A callout is a placeless persona-only beat,
>   and the only table that ever fit that shape (`asides`) is gone. So **this whole feature is now
>   DEFERRED to v3/guided-tours** alongside the framing it rides — it cannot land on a deleted table,
>   and v2 deliberately keeps no placeless-content substrate (a v2 drive's `selection` is route-anchored
>   `narrations` only). The design below stands as the v3 build target; whoever revives it must FIRST
>   re-introduce a placeless-beat table (callouts' own, or the revived guided-tours framing table).
> - `personaForRegion` → `personaFromKey('skipper')` (persona keyed by `persona_key`, resolved in
>   code, decoupled from region).
> - **⚠ The PERSONA KIT is GONE** (2026-06-19, deleted with the frame that housed it —
>   [cut-intro-frame-and-persona-kit](../decisions/cut-intro-frame-and-persona-kit.md)). §7's
>   "**kit BANNED** (the persona kit's only home is the intro)" and the §8 kit-from-stops ban are moot:
>   there is no kit to ban, and no intro to house it. The rule they were approximating survives in a
>   simpler form the live prompt already enforces — the host invents **no backstory at all** — so a v3
>   callout inherits it for free rather than needing its own guard. `PersonaDef.kit` in §14's registry
>   list no longer exists either.
> - `finalizeTourReady` is GONE — readiness now derives from non-null `audio_url` on each `narrations`
>   row, not a batched status flip. "Optional / never gates ready" still holds: a callout simply never
>   blocks a drive becoming playable.

**Small persona-only audio beats the skipper drops into the quiet stretches so he feels
*present on this drive*, not like a jukebox that only fires at the curated stops.** A third
audio content type alongside route-anchored place narrations and the (v3) placeless intro/outro/clock
framing. (Both this feature and that framing are DEFERRED to v3/guided-tours — see the banner: their
v2 storage substrate, the `asides` table, was deleted in migration 0019.)

## 0. Skipper Hours amendment — 2026-08-03 (read before the rest)

A Skipper Hours session re-interrogated this spec against today's tree. **It survived**, but in an
amended shape: one locked decision is overturned, the stated reason for the v3 deferral does not
survive scrutiny, and three of the pressure test's load-bearing numbers cite config that no longer
exists. Nothing was built and nothing was spent. **This is still not greenlit.**

### 0.1 What the founder staged (the grin)

Two moments, both chosen, and they are what the feature is FOR:

- **CRAWL** — 89 southbound above Emerald Bay, six minutes at 6 mph, brake lights to the horizon.
  *"…We have been at this a while now, haven't we. Good news is the lake is not going anywhere.
  Bad news is neither are we."*
- **LONG-GAP** — US-50 east, open road, four minutes to the next stop.
  *"…Long quiet stretch coming up. My favorite kind, if I am honest."*

⚠ **`golden_hour` was offered and NOT taken.** It stays in the §3 mood enum, but it is a
*condition*, not a response — it would fire on a drive where nothing happened. Do not let it become
the lead example when someone builds the pool; the two beats above are the target.

### 0.2 DECISION OVERTURNED — duck-overlay is dead; the music STEPS BACK

§6.3 and §13's "Decisions locked this session" both specify **duck-overlay**: music continues at
reduced gain *under* the callout. **Overturned 2026-08-03 (founder).**

What overturned it: **the quiet stretch is not quiet.** `apps/mobile/src/lib/driveMusic.ts` runs a
curated instrumental through every driving leg, and CLAUDE.md states it outright — *the drive IS the
audio (curated soundtrack + narration)*. So a callout never fills a void; it talks over a song. The
bar was never "beats silence", it was **"beats the song he would be talking over."** The founder's
call: the charm is the **drop**, not the sentence. The music falls away (~1.5 s), he speaks into real
quiet, the music comes back.

⚠ **This makes the ramp load-bearing charm, not a mixing detail.** §6.3's "third gain state" framing
is wrong for this design — it is a *transition with timing*, and the timing is the feature.

⚠ **IMPLEMENTATION CONSTRAINT, verified in code, and it is a trap.** The obvious build — model the
drop as a new `segmentKind` — **would shuffle the song every time he speaks.** `driveMusic.ts:144`
rotates on `segmentKind === 'drive' && prevKind.current !== 'drive'`, and the audit #287 comment
directly above it establishes that a `rest → drive` transition rotates *by design* ("rests keep the
current song", then the drive rotates). Any new kind returning to `'drive'` inherits exactly that.
**The drop must be a gain envelope INSIDE the `'drive'` segment** — `segmentKind` never changes, only
volume moves. This is a sharper form of §11's existing rotation gotcha, and it applies to the
music-drop design that gotcha was not written for.

### 0.3 The v3 storage deferral is the WEAKEST part of this spec

The banner defers the whole feature to v3 because a callout is placeless and `asides` was dropped in
0019. That reason does not hold today:

- **Storage is break-freely** (founder, 2026-07-31 — CLAUDE.md): 1.0 will probably never be released,
  destructive migrations are allowed, and a `callouts` table is ~10 lines. This spec's deferral was
  written 2026-06-09 and predates that posture.
- **The geometry objection does not apply to this feature.** `geometry-first-regions` killed placeless
  content because such a row "could not be selected, ordered, or triggered by the same geometry the
  rest of the system runs on". But a callout is **deliberately not geometrically selected** — §2
  chose a runtime scheduler over studio-placed anchors on purpose. It never asked for the thing it
  was denied.

⚠ **What DOES still hold, so nobody over-corrects:** `asides` is gone (verified in
`packages/db/src/schema.ts`, 2026-08-03) — there is genuinely no placeless table today. And **1.1's
live planner is NOT a precedent for skipping storage**: it speaks pre-drive, over text, from a paid
model call in the request path, whereas a callout is mid-drive *audio* in Tahoe dead zones, where §8
pins selection as 100% on-device. Live generation cannot cross that constraint.

**Net: what stands between this and a build is charm, not schema.** Do not cite "there is no table"
as the reason again.

### 0.4 ⚠ Findings 1 and 2 are UN-RECHECKABLE — do not re-cite their numbers

§2's pressure test rests on `PACING.standard.minGapSec = 180`, `TARGET_SECONDS.story = 120` and
`QUEUE_LAG_WARN_SEC`, all cited from `packages/studio/src/config.ts`. **Every one of those citations
is now wrong**, but in three different ways — corrected 2026-08-03 after a first pass here
over-claimed that they had simply vanished:

- **The 180 s floor is ALIVE and MOVED** — `DRIVE_MIN_GAP_SEC = 180` now lives at
  `packages/engine/src/pacing.ts:15` (with `driveMaxStops = totalSec / 240`, capped 24), because the
  device must be able to re-pace a drive offline with the same math. So Finding 1's premise still
  stands; only its address changed.
- **`TARGET_SECONDS.story` is GONE as a constant** — clip length is now a per-call `targetSeconds` /
  `maxSeconds` pair on the narrate request (`packages/studio/src/pipeline/narrate.ts:106`). There is
  no single global "a story is 120 s" number to divide against any more.
- **`QUEUE_LAG_WARN_SEC` / `projectQueueLag` were REMOVED** 2026-06-19 — see the note at
  `packages/engine/src/pacing.ts:54`: it had no production caller, and `buildDrive`'s step-4 FIFO
  walk inlines the lag projection *because it also drops laggards mid-pass*, which the standalone
  helper could not.

⚠ So "a ~120 s clip against a 180 s floor leaves ~60 s of quiet" is no longer arithmetic you can
re-derive from two constants — the clip half is now per-call. **Re-measure (§0.6); do not inherit the
number.** ⚠ `SIM_MPH = 60` does still stand at `apps/mobile/src/lib/useDrive.ts:61`.

### 0.5 ⚠ Requirement A (§9) is mis-scoped — `packages/sim` already exists

§9 proposes building perturbations into the **mobile** `simulatedSource` (`apps/mobile/src/lib/gps.ts`)
as a prerequisite. That was written before — or without — `packages/sim`, which today is a headless,
deterministic, desk-runnable drive simulator:

- `packages/sim/src/run.ts` takes `--mph` / `--tick` / `--lead` (plus `--gpx` for the Xcode replay).
- `runDrive(polyline, stops, { mph, tickHz, leadSeconds })` returns a report that already knows every
  stop's **fire time** and already **detects audio overlaps**.
- The 1.1 submission sweep already trusts it: Pass A checks the in-app run against a `--mph=45`
  schedule from this exact script (`docs/guides/1-1-submission-sweep.md` §2).

So the first move is **not** a mobile change, and does not enter the 1.1 critical path.

### 0.6 ✅ MEASURED 2026-08-03 — and it OVERTURNS Finding 1

Built as `packages/sim/src/run.ts --gaps` (engine reports `SimReport.quietWindows` as raw fact; the
§7.1 eligibility policy lives in the CLI, where it belongs). $0, no spend, no mobile code. Run over
all three saved drives at 30 / 45 / 60 mph:

| drive (stops) | mph | quiet | longest | ✓ eligible |
| --- | --- | --- | --- | --- |
| Tahoe City → South Lake Tahoe (8) | 30 | 51:02 of 59:19 (**86%**) | 10:02 | **7 of 8** |
| | 45 | 31:22 of 39:33 (**79%**) | 6:15 | **5 of 8** |
| | 60 | 21:29 of 29:39 (**72%**) | 4:21 | **4 of 8** |
| South Lake Tahoe → Incline Village (8) | 30 | 45:49 of 54:13 (84%) | 11:09 | 7 of 8 |
| | 45 | 27:56 of 36:09 (77%) | 6:53 | 3 of 8 |
| | 60 | 18:57 of 27:07 (70%) | 4:45 | 2 of 8 |
| Emerald Bay → Vikingsholm (2) | 30 / 45 / 60 | 39% / 24% / 7% | 1:23 | **0 of 1** |

**⚠ Finding 1 is WRONG, and it was the argument the whole design rested on.** §2 says *"callouts
barely fire on dense corridors via planned gaps"* and that a ~120 s clip against a 180 s floor
"leaves ~60 s of quiet", concluding the emergent path would be the primary one. On the real flagship
drive the planned-gap path is **abundant**: gaps run 3:33–6:15 at 45 mph and five of eight clear the
two-sided gate outright. The emergent path (crawl, halt) is now a BONUS, not the load-bearing case,
and §2/§9's "the sim has negative quiet" framing describes a drive that does not exist.

**The headline nobody had measured: the Skipper is silent for roughly three quarters of a drive**
(narration coverage 21–28%). That is the real finding, and it is a product fact, not a callout fact.

Three things that fall out of the numbers:

- **Speed is the dominant variable, and it runs the helpful way.** Quiet shrinks as speed rises
  (clips are fixed length, the road isn't), so 30 mph gives 7 of 8 and 60 mph gives 4 of 8. A scenic
  drive — the product's whole subject — is the slow case.
- **Drive LENGTH gates the feature, not corridor density.** Emerald Bay → Vikingsholm scores 0 of 1
  at every speed: a 2-stop, 2–3 minute drive has no room and never will. Callouts are a property of
  longer drives, so any pool sizing should be per-drive-length, not per-region.
- ⚠ **The two long drives disagree at 45 mph (5 of 8 vs 3 of 8) while agreeing at 30 and 60.** Do not
  read a single speed as the answer; the gate sits near a cliff for mid-length gaps.

⚠ **Honest record: this was run to KILL the long-gap half, and it did the opposite.** §0.1 predicted
that half would die at the "beats silence" question; the founder took it anyway, over that objection.
The measurement vindicates the founder. What the numbers cannot say is whether a beat in a 6-minute
gap is *welcome* — that is still an ear question, and §0.2's music-steps-back design is still
unheard.

⚠ **Validity guard, deliberately built in:** `--gaps` REFUSES to gate when any selection item was
skipped. The simulator cannot place a CLUSTER subject, and a skipped clip merges its neighbours'
windows into one longer one — biasing the report toward "yes, build callouts". All three drives are
100% poi subjects today (checked), so this run is clean; the guard is there so the next one cannot
quietly lie. The window walk is **MUTATION-CHECKED** on the FIFO play schedule: differencing TRIGGER
times instead over-reports a queued gap ~2× (129 s vs 64 s on the fixture) and fails the test.

### 0.7 Alternatives considered (2026-08-03)

| | | |
|---|---|---|
| **A — measure the quiet** | **CHOSEN** | $0, headless, off the 1.1 critical path, can kill half the idea on evidence. |
| B — hear the bare gap on device | not chosen | Build the music-drop with no line and go listen. Faster to a real feeling, but edits `driveMusic` + `useDrive` while 1.1 is mid-submission, and a bad result is ambiguous — you would not know whether the idea failed or the drive simply had no good gap to try it in. That ambiguity is what A removes. |
| C — don't build it | not chosen | The honest case, recorded because it may still win: this is the third "fill the space between stops" idea on the shelf (with `skipper-opinions-spec.md`, `tell-me-more-spec.md`), none built; **RISK-1 stands — no drive has been driven end-to-end for real**; and nobody has yet heard a long empty leg *with the soundtrack*. Every competitor fails at dead air, but this product may not have dead air — it has music. |

**What would flip A → B:** the measurement comes back rich in qualifying windows **and** a real drive
shows the music-only legs land flat. **What would flip the whole thing to C:** the measurement shows
the gaps are not there, or the first real drive shows the soundtrack already does this job.

### 0.8 Spend gate

Nothing agreed in this session spends anything, and the gap measurement needs no founder go.
⚠ The first step that DOES spend is §4's TTS pool — an **operator paid run, which requires an
explicit founder "go" per run and is never inferred from a design conversation**. A future reader
must not read "the idea survived Skipper Hours" as authorization for that run.

## 0b. TL;DR for the next Claude (2026-06-09 — amended by §0 above)

- **Callouts = persona-only (NO facts) short clips, fired by a runtime scheduler during
  downtime, ducked OVER the soundtrack.** Persona-only is the whole safety story: they assert
  no facts, so they can't hallucinate and they sidestep the project's hardest invariant
  ("persona in DELIVERY, never FACTS") entirely. Mood/character/drive-state beats only —
  *"long quiet stretch… my favorite kind,"* *"that light right now, huh."*
- **Own placeless storage (a v3 callouts table — see the banner; the early-V2 `asides` table that
  would have held it was deleted in 0019), own scheduler (in `@skipper/engine`).** NOT a narration
  `form`, NOT placed by the studio pipeline. This keeps the `narrations` atom strict and the geofence
  engine homogeneous (the same reasoning that kept intro/outro framing placeless rather than a stop).
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

(V2 names; the banner maps the V1 originals.)

| | place `narrations` (story/scenic/break) | intro/outro framing (v3) | **callouts (v3)** |
|---|---|---|---|
| Anchor | route position (geofence) | placeless | **placeless** |
| Trigger | `TriggerEngine` proximity | lifecycle (start / end-anchor) | **runtime scheduler (downtime)** |
| Grounding | story=facts; scenic/break=persona | persona-only | **persona-only (no facts)** |
| Ready-gate | mandatory (non-null audio) | mandatory (non-null audio) | **OPTIONAL (never gates ready)** |
| Count | many | 0–2 | a **pool** (~12–15), few fire |
| Music | replaces (`'clip'` segment) | replaces | **ducks OVER (overlay)** |
| Selection | the one baked clip | the one baked clip | **runtime-picked from pool by drive-state** |

Callouts being **optional** is load-bearing: a drive is `ready` with zero callouts (readiness
derives from non-null `audio_url` on the selected items, not a batched status flip), and callouts
can be generated in a **separate pass even after a drive is playable**. The core pipeline is
untouched; callouts are pure enhancement.

## 2. Why this shape (decisions — do NOT re-derive)

A "fold callouts into scenic stops" alternative was considered and **rejected**. Scenic stops are
also persona-only, so the fold would have made callouts studio-placed geofenced anchors with a
pool — cheaper, but it can't do the thing that matters. The decisions:

- **Runtime scheduler over studio-placed anchors.** A fixed anchor is *condition*-aware at
  best (golden hour at a known point). The beats that most prove "he's alive" are **emergent** —
  *"you've been quiet a while," "we've been crawling through this for ten minutes," "take your
  time"* — and emergent downtime is unpredictable at generation time. For a charm-first toy where
  the persona IS the product, responsiveness beats cost-efficiency (polish-over-scale, on brand).
- **Separate placeless storage (a dedicated callouts table — to be created in v3; the early-V2
  `asides` table that would have held it was deleted in 0019) over overloading scenic stops.** Pool +
  duck + placeless + optional + scheduler-fired is genuinely a different beast; folding it into a place
  `narrations` row muddies what a stop means (route-anchored, grounded-or-scenic, ready-gated,
  homogeneous engine). Keep both abstractions sharp — the same reasoning that kept framing placeless.
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

## 3. Data model — a placeless callout (a NEW v3 table)

A callout is a placeless, region/persona-keyed beat with no poi and no facts, PLUS a `mood` tag.
**There is no v2 table to put it on** — the `asides` table that would have fit this shape was deleted
in migration 0019 ([geometry-first-regions](../decisions/geometry-first-regions.md)), and v2 keeps no
placeless-content substrate. So the v3 build creates a dedicated `callouts` table. Sketch:

```
callout(                          -- a NEW placeless table (v3); + a mood tag
  id              uuid pk,
  region_id       uuid → regions (cascade, nullable = a GLOBAL callout),
  persona_key     text,           -- resolved in code via personaFromKey('skipper')
  script          text,
  audio_url       text,           -- region-scoped R2 key: clips/callouts/<region>/<id>
  audio_duration_ms  int,
  mood            callout_mood,    -- the applicability tag the scheduler matches on
  variant         int default 0    -- so a beat rarely repeats
)
-- callout_mood pgEnum: generic | golden_hour | night | crawl | halt | long_gap
-- NO poi_id, NO lat/lng/trigger_radius (placeless); NO tour_id (v2 has no tours — region/persona scope).
-- attribution + facts_hash OMITTED (persona-only → nothing to attribute, nothing to go stale).
-- NOT a place `narrations` row; readiness derives from non-null audio_url, never gating a drive (optional).
```

> **v2/v3 note:** the region geometry-first model means a region is a BBOX, NOT a `region_id` FK target
> in the same sense everywhere; if callouts ship in v3, confirm the region key against the then-current
> `regions` schema ([geometry-first-regions](../decisions/geometry-first-regions.md)).

`mood` is how a drive-state signal selects a clip at fire time:
- `generic` — any downtime (the default pool, the bulk of it)
- `golden_hour` / `night` — *conditions* (function of position + clock; see §8)
- `crawl` — slow stop-and-go traffic
- `halt` — a brief full stop (red light)
- `long_gap` — a longer "settle in for a bit" beat for a wide void

## 4. Generation — `narrateCallouts()`

A new pipeline step (the v3 sibling of the intro/outro framing generators in
`packages/studio/src/pipeline/narrate.ts` — note that framing itself is currently DEFERRED to v3, since
its `asides` storage was deleted in 0019):
- **persona-only, no fact sheet**, notch-parameterized, from the persona's `PersonaDef`
  (the persona registry — `personaFromKey('skipper')`; persona is resolved in code, keyed by
  `persona_key`, decoupled from region).
- **quality-gated** like stops (warmer delivery, no-bow, no mini-recap) but scaled to ~1–2
  sentences (`TARGET ~12s`, shorter than a `scenic` at 20s).
- **kit BANNED** (the persona kit's only home is the intro — same guard as stops).
- **`mood`-tagged**, run through the existing diversity tracker so the pool isn't 12 variants of
  one beat. Over-provision: ~**12–15** per region/persona so the scheduler has variety + drive-state
  matches, and so cross-drive replays don't repeat for ~3 drives (§7.3).
- TTS → region-scoped R2 (`clips/callouts/<region>/<id>`), then insert the callout rows (the new v3
  placeless table of §3).
- **Separate pass:** can run after a drive is already playable (no batch co-commit; readiness is
  per-item non-null `audio_url`). A regen tool (extend `resynth-narration.ts`) can re-author the
  pool independently.

**Lint guard:** add a check that a callout script names *nothing factual* (mirrors the
kit-from-stops ban). A callout that asserts a fact is a bug — that's a story stop's job.

## 5. API / DTO / offline

- `@skipper/shared`: the drive detail grows `callouts: CalloutDTO[]` ( `{ id, script, mood, audio }` )
  alongside the place narrations (and, when v3 framing returns, the intro/outro frames).
- `apps/api`: `/sign` serves callout clips (region-scoped R2 keys), same presign path as
  narrations.
- **Offline (`apps/mobile/src/lib/offline.ts`):** add callout clips to the download manifest so a
  downloaded drive carries its whole pool — selection is 100% on-device (Tahoe dead zones; §8).

## 6. The player — the load-bearing new code

### 6.1 Reuse: callouts ride the existing queue (a non-route item on the FIFO)

`apps/mobile/src/lib/useDrive.ts` is a **queue + pump + single audio player**: `queue.current`
(FIFO of seqs), `pump()` (plays next if `!clipBusy`), the clip-load effect keyed on `activeSeq`,
lock-screen, stall/re-sign. (NOTE — stale-since-0019: this spec originally leaned on the intro/outro
**bracket sentinel seqs** `INTRO_SEQ`/`OUTRO_SEQ`/`frameKindForSeq` as the proof that a non-route item
can ride that queue. Those were REMOVED when `asides`/placeless framing was deleted — `useDrive` now
loads only route-anchored place narrations. A v3 build must re-introduce the sentinel-seq mechanism
itself, for callouts and revived framing alike.) **Callouts ride the queue as a non-route item:**
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
3. **Schema + migration (CHECKPOINT — live DB).** The NEW placeless callouts table (§3 — there is no
   v2 table to extend; the early-V2 `asides` table was deleted in 0019) + the `callout_mood` enum.
   Clean + destructive (no users; CLAUDE.md). Readiness stays per-item non-null `audio_url` — nothing
   to gate.
4. **Studio.** `narrateCallouts()` (persona-only pool, mood-tagged, diversity-tracked) + the
   no-fact lint guard + region-scoped R2 writes + a regen path in `resynth-narration.ts`. Separate pass.
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
- **Callouts are optional** — never add them to the ready-gate; a drive with zero callouts is
  valid and common (dense corridors).

## 12. Phase 2 (deferred) — fact-grounded spatial callouts

The *"look left, that's Cave Rock"* magic. Materially harder and out of v1 scope: it names real
things → it's **fact-grounded**, so it needs minor-POI anchors along the route (curated or OSM) +
the full attribution path + a **second geofence pass** (callouts become coordinate-bearing
triggerables, breaking the "engine consumes only the route-anchored place `narrations`" homogeneity).
Gate it behind v1 landing and the proven player. Do not let it leak into v1's persona-only scope.

## 13. Provenance

Designed 2026-06-09. Grounded against, and citing for re-check:
- `packages/engine/src/trigger.ts` — `TriggerEngine`, `GpsFix`, `DEFAULT_TRIGGER`
  (`leadSeconds 12`, `headingGateMps 2.2`, `headingConeDeg 90`), `effectiveRadiusM`.
- `apps/mobile/src/lib/useDrive.ts` — queue/pump/`clipBusy`, `handleFix`/`handleEnd`,
  `SIM_MPH=60`/`SIM_FAST_SCALE=8`, `DRIVE_INTERRUPTION_MODE` (`'doNotMix'` → `'duckOthers'` is Phase 0),
  `useDriveMusic` (`'clip'`/`'drive'` segments). (The `INTRO_SEQ`/`OUTRO_SEQ`/`frameKindForSeq` bracket
  sentinels this spec once cited were REMOVED with `asides` in 0019 — `useDrive` now queues only
  route-anchored place narrations; the sentinel-seq mechanism must be rebuilt in v3.)
- `apps/mobile/src/lib/gps.ts` — `simulatedSource`/`liveSource`/`FixSubscription`.
- `apps/mobile/src/lib/offline.ts` — `loadPlayback`/`resignPlayback`, the download manifest.
- `packages/studio/src/config.ts` — `PACING` (standard `minGapSec 180`/`maxNarratedStops 16`),
  `TARGET_SECONDS` (`story 120`/`scenic 20`), `QUEUE_LAG_WARN_SEC 45`, `TRIGGER_RADIUS_M 120`,
  design speed `13.4 m/s ≈ 30 mph`.
- `packages/studio/src/pipeline/narrate.ts` — `narrateIntro`/`narrateOutro` still exist as generators,
  but their `asides` storage was DELETED in 0019, so intro/outro framing has no v2 home and is itself
  DEFERRED to v3. Readiness derives from non-null `audio_url` per item (the V1 `finalizeTourReady`
  `db.batch` ready-gate is GONE).
- The persona registry (`personaFromKey`, `PersonaDef`, the kit). The placeless-framing precedent this
  spec leaned on was the early-V2 `asides` table, now DELETED ([geometry-first-regions](../decisions/geometry-first-regions.md));
  it returns in v3 with guided tours. See also [tour-data-model-zero-reuse](../decisions/tour-data-model-zero-reuse.md).

**Decisions locked this session:** runtime scheduler over the studio-placed "fold"; a dedicated
placeless callout table (now a v3 build — the early-V2 `asides` table that would have held it was
deleted in 0019); persona-only v1 (spatial = Phase 2); duck-overlay; stops-win-by-construction; the §7
tuned ruleset incl. the parked-car rule (Req B) and the sim perturbations (Req A). **The whole feature
is DEFERRED to v3/guided-tours** — see the banner.
