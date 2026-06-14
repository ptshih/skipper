# TODO — engineering backlog

Carry-forward **engineering** items (the near-term layer of the truth system — see
`docs/README.md`; product ideas live in `docs/ideas/`, build-ready designs in `docs/specs/`).
Each item has enough context to action without re-deriving the reasoning. **Delete items
when done** — git history is the archive.

## Admin local-dev resilience — guard against "just errors out"

The admin in local dev (vite `:5173` client + Hono admin-api `:8788`, `bun run dev:admin`)
sometimes just errors out; add guards so a transient/dev-only failure degrades VISIBLY instead of
a blank or cryptic crash. **Capture the actual error next time it happens to scope this** (the
browser console + the failing request).

**Shipped:** a top-level React `ErrorBoundary` (catches post-mount render crashes) + a plain-DOM
boot-error fallback — `src/components/ErrorBoundary.tsx`, wired in `main.tsx` — that catches a
PRE-mount fatal too (incl. the dual-React `ReactCurrentDispatcher` crash an error boundary can't
catch) via a `window` error guard, and shows the error + the exact dual-React fix + Reload instead
of a blank screen. Remaining:

- [ ] **API-down / env-missing** — if the admin-api (`:8788`) is down or `DATABASE_URL` is unset,
      surface a clear "admin-api unreachable" state instead of silent failed fetches / 500s (a
      `/health` probe on boot + a banner).
- [ ] **dev:server crash visibility** — `bun --watch server/index.ts` can exit on a bad import/env
      and leave the vite proxy 502-ing with no signal; a supervisor/auto-restart, or at least a
      client message distinguishing "api crashed" from "api booting".

## Location: When-In-Use → Always/background (deferred half of permission priming)

The pre-permission **explainer** shipped 2026-06-13 in front of the existing *When-In-Use*
prompt (drive + roam; `LocationPrime` + the `'locationPrime'` phase; decision:
`docs/decisions/location-permission-priming.md`). The founder chose to **phase** the tier change:
the Always/background escalation is this deferred item. WHY it matters — foreground location dies
on screen-lock, so the drive keeps the screen awake (`expo-keep-awake`); if the screen ever locks,
audio keeps playing but GPS triggering silently stops (the skipper goes quiet at the next stop).
Always fixes that (screen-off / phone-in-pocket triggering). Native + App Store review work, so
its own pass.

- [ ] Config plugin (`apps/mobile/app.json`): `expo-location` → `isIosBackgroundLocationEnabled: true`
      + `locationAlwaysAndWhenInUsePermission` (skipper-voiced string); add `location` to iOS
      `UIBackgroundModes` (today: `audio` only).
- [ ] `gps.ts liveSource`: `allowsBackgroundLocationUpdates: true` on the watch; reconsider whether
      `expo-keep-awake` can drop once background triggering is reliable.
- [ ] Request **sequence**: foreground first, THEN `requestBackgroundPermissionsAsync()` (you cannot
      ask for Always cold). Extend the `LocationPrime` copy to prime the Always reason (it's already
      worded to survive this). Reuse the `'locationPrime'` phase.
- [ ] Handle the **"Allow Once" silent-fail**: a same-session background request returns denied with
      NO prompt → route to Settings (the existing reduced/denied gate pattern).
- [ ] Needs a native rebuild (dev build / EAS) + **App Store Review notes** stating background
      location is used solely to trigger GPS-anchored audio during an active drive. Gated behind the
      phone-player bet being proven. Sources cited in the decision doc.

## Roam build pass 2 — LOCKED by the founder 2026-06-11 (the "companion grows up" pass)

> ⚠ **Chattiness toggles (quiet/normal/talkative) are not very useful** (founder feedback
> 2026-06-11). The min-gap governor knob is too coarse and blunt in practice. Before
> building anything that assumes the quiet/normal/talkative axis (e.g. wave suppression
> on quiet), reconsider whether to replace it with auto-adaptation or drop it entirely.

Three items locked from the 2026-06-11 brainstorm (full capture: `docs/ideas/free-roam-mode.md`
§Alpha learnings). Order within the pass is free; all three are founder-facing on his daily drive.

- [ ] **Waves: narrate the scenic tier.** ~126 swept scenic pins sit unnarrated (`pois` story/scenic
      tiers — `sweep-roam-pois.ts`). Schema first: `roam_clips` has NO `form` column and a
      `roam_clips_poi_uq` unique index on poiId (one telling per place) — the schema comment
      already names the move: a clean DESTRUCTIVE migration adding `form` ('story'|'wave';
      'bside' later) + uniqueness on (poiId, form). Then the 10–20s WAVE form in
      `generate-roam.ts` (grammar: one-liner, self-contained, no laterality/volatile; no "ask
      me about it" tease until B-sides exist). Engine + manifest: waves suppressed on quiet
      chattiness, story-over-wave priority on simultaneous candidates. Prompt work is the real
      cost — a wave must sound like HIM, not a gazetteer caption. ⚠ The --apply generation run is
      a PAID run (~$3–5 + TTS) — needs an explicit founder go, never inferred from this lock.
- [ ] **The sonic cue.** ~1s entry motif before every encounter (the duck gets a reason; the
      startle dies) + a soft exit/resolve note as the duck releases. Client-side bundled assets
      (`apps/mobile`), played around the clip in `useRoam`. Sound design taste-gate: founder ear
      on the motif BEFORE wiring (charm shortlist already names sound design).
- [ ] **Persistent encounter history + per-pin mute.** Local store (poiId, lastPlayedAt, count,
      muted) — survives sessions (today's cooldown is session-scoped, `RoamEngine` 4h). Feed the
      engine's cooldown from it; "Don't tell me this one again" action on the encounter sheet
      writes `muted`. Unlocks later: deep-cuts rotation targeting, the corpus meter, revisit
      preambles, mute-as-curation-telemetry. Keep it client-side (toy lens: no server surveillance).

## Generation resumability — SHELVED 2026-06-10 (low ROI)

The cost *guardrail* shipped 2026-06-09 (`pipeline/spend.ts` usage tally + the `--max-cost`
pre-TTS abort + the hard-capped regen loop). The remaining ROBUSTNESS half — resuming a
crashed run instead of re-paying narration + TTS — was evaluated 2026-06-10 and **shelved as
low ROI**: the pipeline already retries transients (`pipeline/http.ts` 4× backoff on every
external call incl. TTS; the eval loop is budgeted + `allSettled` + never-gates; per-stop
failures are non-fatal), so only ~5% of failures are hard crashes, each wasting only
~$0.20–0.35 (narration ~$0.04–0.15, TTS ~$0.20–0.30). A durable checkpoint (DB table +
journal + resume branches in the demo-sensitive `generate.ts`) plus its correctness landmines
(stale-narration, truncated-clip reuse) isn't worth that. **Revisit ONLY if** crash/stage
logging later shows hard crashes are common.

Refs: 2026-06-10 ROI validation (this session); `pipeline/generate.ts` (all in-memory until
the atomic ready-gate), `pipeline/http.ts` (the retry that already covers most failures).

## Generation pipeline: overlap independent phases (perf, output-neutral)

The big parallel wins (first-pass narration + the regen passes) already shipped (B + A-simple,
commits `be83c7e` / `5283fe6`). Of the three follow-on overlaps surfaced 2026-06-10, one shipped
and two were evaluated-and-SKIPPED 2026-06-13 (verified against the post-corpus/segments-refactor
code — the original framing had gone stale):

- ✅ **bracket-narration ‖ eval-panel** — SHIPPED 2026-06-13. The intro/outro Opus calls are now
      kicked off right after first-pass narration (`lap('narration')`) and awaited just before TTS,
      so they run under the eval panel's wall-clock. Byte-identical output (brackets thread zero
      cross-stop state); a detached `.catch` guard keeps a panel throw from orphaning the pending
      promise, while the mandatory-abort still fires at the await. `lap('bracketNarration')` now
      reads ~0 (honest — it overlapped). Refs: `pipeline/generate.ts` (the `bracketsPromise`).
- ⛔ **geology ‖ scout** — SKIPPED (output-neutrality risk > tiny win). They touch DISJOINT stop
      sets (scenic vs story) but BOTH hit Macrostrat (the scout's `geologyAt` tool + the scenic
      geology phase). Overlapping STACKS that load; a throttle that exhausts the retry budget drops
      a scenic stop's geology → DIFFERENT output, breaking the output-neutral contract. And geology
      is the FAST phase (4 concurrent coord lookups) vs the slow Opus scouts, so the saved
      wall-clock is small. Revisit only if Macrostrat headroom is confirmed (or geology is cached).
- ⛔ **places ‖ discovery** — SKIPPED (premise stale). Post-corpus-refactor, "discovery" is a cheap
      DB corpus SELECT (`loadCandidatePoisInBox`), not the live WDQS fetch this item assumed — so
      there's little to overlap. Worse, the empty-corpus check throws "at $0 before any paid call",
      and Places IS a paid Google API; firing it concurrently would forfeit that guard. Not worth it.

## MAYBE — API read-retry to mask Neon cold-start blips (judgment call, not committed)

Logged as a MAYBE, not a decision. The API's neon-http reads (`loadTourGated`, `GET /tours`,
the queries inside the `/tours/:id` + `/sign` `Promise.all`s) are bare `db.select` — a transient
blip (Neon serverless wakes a compute on the first query after idle) throws → `onError` → a 500
for a real user. The generator already retries its reads (`8189bd5`); the API doesn't.

Shape if built: a small `withRetry<T>(fn)` that retries a transient throw then RE-THROWS (a read
can't fail open — empty rows would silently 404 a real tour / blank the catalog; after a bounded
effort a 500 is the honest answer). Distinct from `session.ts`'s `resolveSessionSafely`, which
retries-then-fails-OPEN-to-null (a missing session legitimately means anonymous) — `retry.ts`
could host the shared core. Budget must be SHORTER/FEWER than the generator's (this is on the
USER's latency path): ~2–3 attempts, ~100–150 ms base. Composes with the `Promise.all` fan-out
(`a94cf8c`) — wrap each arm's thunk, concurrency preserved.

Why only a MAYBE: it adds latency to the FAILURE path (a genuinely-down Neon now waits ~300–450 ms
before 500-ing instead of failing instantly). Favorable for THIS traffic profile (idle, cold-start
prone) — the common case is a single blip masked into a slightly-slower success — but a smaller,
less clear-cut win than the fail-open session fix (`aa0f113`, product-critical) or the read fan-out
(`a94cf8c`, pure latency). Revisit if request logs ever show cold-start 500s actually happening.

## TTS audio QA: clip loudness normalization

Measured 2026-06-10 (ffmpeg volumedetect over all 30 live clips, founder-ear-confirmed):
Gemini-TTS takes are non-deterministic in LEVEL. The first defect — **tail collapse (the
"mumble")** — shipped its fix 2026-06-11: every ship path (generate, generate-roam,
resynth-tour, patch-clip) now measures tail(12s)-vs-body after each synth and re-synths
once on a ≥3 dB drop, keeping the better take; a still-collapsed shipped take fails that
stop's tts eval row (`pipeline/tail.ts` + `synthesizeWithTailRetake` in `pipeline/tts.ts`;
graceful skip when ffmpeg is absent; the skipper-gen Dockerfile installs ffmpeg so cloud
Job runs measure too).

The second defect — **clip-to-clip level spread + overall quiet-vs-Spotify** — shipped its
mechanism 2026-06-11: `synthesizeWithTailRetake` now loudness-normalizes the WINNING take via
an ffmpeg two-pass LINEAR loudnorm (MP3→MP3 32k re-encode) to `LOUDNORM_TARGET_LUFS = −14` /
`LOUDNORM_TRUE_PEAK_DB = −1.5` (`pipeline/loudnorm.ts` + the constants in `models.ts`). Linear
gain lands every clip at the SAME integrated level (kills the 7.2 dB spread) without touching
speech dynamics or reintroducing tail collapse; −14 LUFS = Spotify's target, so it also closes
the quiet gap. ffmpeg-optional (graceful null → ships un-normalized, no regression); runs even
on short break clips the tail probe skips. Verified locally: a −48 LUFS tone → −14.45 LUFS,
TP −10.3 dBTP (no clip).

REMAINING — **founder ear-gate on the −14 target.** The number is a single tunable constant.
Before the first paid full regen, A/B the smoke clips on-device against a Spotify reference; the
old founder-ear measure ("music at −13 still reads 20% quiet") suggests real playback ≠ authored
LUFS, so −14 may want to nudge to −13/−12. One-line change in `models.ts`, no other code.

REMAINING — **drive music level (separate task).** The 17 bundled tracks (`apps/mobile`
`licenses.ts`) are NOT in this pipeline — match them with a one-time offline re-encode (or a
player-side gain) to the SAME target once −14 is locked by the ear-gate above.

Refs: `packages/generator/src/pipeline/loudnorm.ts`, `pipeline/tts.ts`, `pipeline/tail.ts`,
`models.ts` (the LOUDNORM_* constants), `docs/decisions/audio-compression-spike.md`.

## In-app narration volume trim — DEFERRED pending the −14 ear-gate (founder feedback 2026-06-11)

Founder ask: an in-app control to make NARRATION slightly louder/quieter, INDEPENDENT of device
volume and other apps. **Decision 2026-06-11: don't build it yet** — nail the global −14 LUFS target
at the ear-gate first and see whether a per-listener trim is even needed once levels are consistent.

Design conclusions if/when it IS built (so this isn't re-litigated):
- Mechanism is simple + standard: expo-audio's narration `AudioPlayer.volume` (0..1) is a per-player
  gain that touches NOTHING else (device volume, the rider's music, the `driveMusic.ts` bed all
  stay put). Persist a notch setting (sim-mode pattern) → set `player.volume` in `useDrive`+`useRoam`.
- **Lean toward ATTENUATION-ONLY** (default = unity = the matched −14 level; notches only go softer,
  e.g. a sleeping passenger). It has no encode coupling and doesn't fight loudness normalization —
  streaming (Spotify/Apple/YouTube) deliberately normalizes-to-target and DROPPED user loudness
  boosts, so a "push above −14" control works against the −14 work we just did. "Louder overall" is
  then a global-target call at the ear-gate, not a per-listener boost.
- The bidirectional version (Softer/Normal/Louder) is a WORKAROUND: `player.volume` clamps at 1.0
  (attenuates, can't amplify past source), so "Louder" needs clips encoded ~1.5 dB hotter than the
  playback default — which couples the notch values to the loudnorm target. Only worth it if a real
  "skipper a touch louder than my quiet-music device volume" need shows up. True >unity boost would
  need a real gain node (AVAudioEngine / Web Audio / react-native-audio-api) — overkill for v1.
Refs: `useDrive.ts` / `useRoam.ts` (the narration player), `models.ts` (LOUDNORM_* target).

## Offline downloads: full re-pull only (no per-clip diff)

DONE (2026-06-10): a re-cut clip (patch-clip / resynth-tour / a regen) is now DETECTABLE +
recoverable on-device. Each stop/bracket carries a `revisedAt` content token (the DB
`updated_at`, which every re-synth path already bumps, surfaced on the tour-detail DTO); the
offline manifest embeds the detail, and the tour screen compares a fresh fetch against the
saved copy (`isDownloadStale`, zero extra network) → a "Fresh cut ready" chip + a "Pull the
fresh copy" ⋯ action. NEVER forced; offline play keeps using the saved bytes until the rider
re-pulls. Manifest bumped to v2 (a v1 download lacks tokens → re-downloads).

REMAINING (post-MVP): the re-pull re-downloads EVERY clip, not just the changed ones. A
per-clip diff (download only the stale clips, merge into the existing manifest) is the
optimization — only matters once tours are large or strangers hold many offline tours.

Refs: `apps/mobile/src/lib/offline.ts` (manifest + `isDownloadStale`),
`apps/mobile/app/tours/[id]/index.tsx` (chip + ⋯ action), `packages/shared/src/schemas.ts`
(`tourStopView`/`tourBracketView` `revisedAt`), `apps/api/src/index.ts` (detail route).

## Upstream-contribution drafts for the active poi_overrides (agent drafts, human submits)

The fact-overrides loop's "contribute back" half is designed but UNBUILT: we correct upstream
source errors locally (`poi_overrides`), and the right thing is to also fix the SOURCE. Posture
(from the decision doc): **agent drafts, human submits** — Wikipedia's bot policy (WP:BOT) + COI
norms rule out autonomous editing, so an agent reads the `not_filed` rows (each already carries the
correction + an authoritative `source_url`) and drafts the talk-page post / edit; a human reviews
and files it, then sets `upstream_status` → `filed` (+ `upstream_url`).

Three ACTIVE fact_edits are draftable (all `upstream_status = not_filed`):
- **Lennart Palme** — Vikingsholm's architect (Emerald Bay State Park, wikipedia `1985884`); the
  article says "Leonard." Source: vikingsholm.com + Wikipedia's own Vikingsholm article.
- **Pope Estate builder/decade** (wikipedia `39007559`) — the article credits Lloyd Tevis / 1880s;
  correct is George Tallant (Crocker Bank) 1894, with the Tevis family buying it in 1899. Source:
  taylortallac.org history.
- **Chambers Lodge 1863** (wikipedia `32308786`) — the article says "first established in 1854";
  John McKinney established Hunter's Retreat at the site in 1863. Source: donsnotes.com + others.

NOT this list: the Tahoe Keys row is RETIRED (`active = false`, 2026-06-10) — Wikipedia already
removed the dated construction sentence, so there's nothing left to file.

- [ ] Draft a per-row talk-page correction (claim → correction → authoritative source, in
      Wikipedia's neutral register) for the 3 active rows; surface for human review + filing.

Refs: `docs/decisions/fact-overrides-and-veracity.md` ("Contribute back" + the discipline line),
`packages/db/seed/poi-overrides.ts` (the rows + reasons + source_urls),
`poi_overrides.upstream_status` / `upstream_url` (the workflow columns).

## Autio competitive borrows (small in-car/UX wins)

From a 2026-06-10 teardown of Autio (formerly HearHere — the closest real-world comp:
curated, celebrity-narrated, GPS-triggered road-trip audio; 4.8★, ~70% renewal). Their
ceiling is coverage gaps + multi-narrator inconsistency — both things our generation +
single-Charon model already answer, so the moat (persona continuity, in-car quality) is NOT
a feature to copy. These three borrows are small and serve that moat. NOT borrowing:
subscription-first pricing, celebrity narrator roster, national free-roam pin-map,
over-broad trigger radius (all anti-charm or anti-doctrine).

- [ ] **Pause+resume music in roam — DEVICE-VERIFY (built 2026-06-11).** Founder feedback: BOTH
      players pause+resume the rider's audio, never duck. The TOUR player was already `doNotMix`
      (its own bed fades to silence under narration), so this was a ROAM-only change, now IN CODE
      (`useRoam.ts`): opens `mixWithOthers` (rider's audio untouched through the quiet), takes
      exclusive `doNotMix` only on the sawFresh edge (real audio), hands focus back (`mixWithOthers`)
      on clip-end / hold / teardown. Taking focus on sawFresh (not clip-load) means a silent
      pre-buffer / dead-zone skip never strands the rider's music paused. ⚠ REMAINING: the RESUME is
      device-only — expo-audio has no session-deactivate, so we rely on iOS resuming Spotify/podcasts
      when we flip back to `mixWithOthers` (grounded in SDK 56 docs, but the actual resume is
      unverified). Run runbook §6 (resume after a 60s encounter, re-pause on the next, dead-zone skip
      never interrupts) before relying on it. Refs: `useRoam.ts`, `docs/guides/device-verification-runbook.md` §6.
- [ ] **Heard/unheard stop-progress affordance on the drive screen.** Autio grays out
      played map pins so you can glance at what's coming. Cheap, in-car-safe charm: a
      "stop N of M" / dimmed-completed-stops indicator on the drive screen. Costs almost
      nothing, reads at 60 mph.
- [ ] **Upfront permission-explainer screens before Location-Always.** Autio runs a short
      onboarding that *explains* why it needs Location-Always + Notifications before firing
      the OS prompt, cutting denial. We hit this exact wall on the real-drive device pass —
      a 1–2 screen explainer before the system dialog. (Note: no `UIBackgroundModes:['audio']`
      yet — locked-screen live audio is still unverified; see the runbook.)

Refs: `apps/mobile/src/lib/useDrive.ts` (the duck flip), the drive screen
(`apps/mobile/app/tours/[id]/play.tsx`), `docs/guides/device-verification-runbook.md` (duck +
lock-screen landmines). Validated-already (no action): our anonymous couch preview = Autio's
tap-a-pin preview; the M3 notch/interests-as-setting = their interest-ordered queue.
