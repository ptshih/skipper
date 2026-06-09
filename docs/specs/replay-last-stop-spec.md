# "Replay the last stop" — build spec / handoff

**A one-tap way to re-hear the stop you just passed.** Surfaced by the GuideAlong UX study
(`docs/competitor-ux-studies.md`) — its #1 reviewed gap is *"difficulty replaying previous
commentaries,"* and Skipper is *more* exposed: the live drive has **no auto-advance**, so once a
clip finishes the player returns to ducked-quiet and the stop is simply gone.

> **Status: SPEC ONLY — nothing built.** Small, **player-only** feature (no backend / schema /
> generation / offline change). Decided 2026-06-09. Gated behind the proven phone player like the
> rest, but cheap enough to land alongside Phase 4/5.

## 0. TL;DR

- The need: *"wait — what did he just say?"* You zoned out, the kids were loud, or a conversation
  ran over the clip. The stop played and there's no way back to it.
- The existing **scrubber** (±15s + position bar — shipped) only covers the **currently-active**
  clip. The moment a clip finishes, `activeSeq` goes null, the clip unloads, and there's nothing to
  scrub. **Replay-last fills the gap *after* a clip ends; the scrubber covers *during*.** Two tools,
  two moments.
- The feature: one big **"Replay"** button on the drive screen that re-plays the **last completed
  clip**. Reuses the entire clip-load → duck → play → lock-screen path. Zero new audio.
- The one real rule: **a live GPS trigger preempts a replay** (a replay is soft/re-hearable; a live
  geo-triggered stop is time-sensitive — it must play as you pass the place).

## 1. The problem (precisely)

`apps/mobile/src/lib/useDrive.ts`: stops fire from `engine.update(fix)` in `handleFix`, queue, and
play through the FIFO `pump()`; on finish, `onClipDone` sets `activeSeq = null` and returns to
**ducked-quiet** — it *"never advances by a clip ending"* (the deliberate no-auto-advance design).
So a finished stop's clip is unloaded and unreachable. The scrubber (`seekToMs`/`seekBy`) operates on
the loaded clip only, so it can't reach a clip that already ended.

## 2. The feature

A single prominent **"Replay"** affordance on the drive screen (in-car safe: one big tap target,
glanceable, design-system `Button`/`Icon` — never a precise list-row tap while moving). Tapping it
re-plays the **last completed stop clip**. Available whenever a clip has finished (`canReplay`).

Plain UI chrome, not the skipper's voice — label it "Replay" / "Replay that." (A charming "one more
time—" persona pre-roll is a future flourish, §6.)

## 3. Behavior — and the one rule that matters

- **Invoked in ducked-quiet (the normal case):** enqueue `lastCompletedSeq` → `pump()` → it loads
  and plays exactly like a stop (ducks the music, re-claims lock-screen Now Playing via the existing
  clip-load effect). On finish, `onClipDone` returns to quiet. Clean — it's just the existing path,
  fed by a button instead of a trigger.
- **A live GPS trigger fires DURING a replay → the trigger WINS (preempt the replay).** This is the
  load-bearing rule, and it's the same "stops win" principle as the callouts spec: a replay is
  *re-hearable* content; a live geo-trigger is *time-sensitive* (you're physically passing the
  place). Standard pacing leaves ~60s gaps but a replayed story can be ~2 min, so a trigger landing
  mid-replay is *likely*, not an edge — preemption is required, not optional.
  - Implement: tag the active clip as a replay (`replayingSeq` ref). In `handleFix`, when
    `engine.update` returns events **and** `replayingSeq !== null`, cut the replay (treat like
    `onClipDone`) before queuing/pumping the live stop. A real stop is **never** preempted by
    anything; only a replay is.
  - (Simpler-but-worse fallback if preemption proves fiddly: queue the trigger behind the replay —
    but then the live stop plays *late*, after you've passed the place. Don't ship that.)
- **A clip is currently playing when the button would show:** don't offer replay-last *during* a
  live clip — the scrubber (seek-to-0) already covers "restart this one." Replay-last targets the
  last **completed** clip and is a between-stops action. (So `canReplay` = `activeSeq === null &&
  lastCompletedSeq != null`.)
- **Music:** a replay ducks/replaces the soundtrack exactly as the original stop did — it *is* a
  stop clip. No special music handling (unlike callouts' duck-overlay).

## 4. Architecture (what's new — all in `useDrive` + the drive screen)

- **`lastCompletedSeq` ref** — set in `onClipDone` to the seq that just finished, but **only for
  clips that actually played** (guard on `sawFresh`, so a *skipped/failed* stop — the stall path —
  never becomes the replay target). Brackets included (a rider may want the intro again); the label
  stays generic.
- **`replayLast()` action** on the `useDrive` return + **`canReplay: boolean`** — `replayLast()`
  pushes `lastCompletedSeq` and pumps; guarded by `canReplay`.
- **`replayingSeq` ref** — marks the active clip as a replay so `handleFix` knows it's preemptible
  (and so the lock-screen title / view-model can say "Replay: <name>" if desired). Cleared on finish
  or preempt.
- **Reuses, unchanged:** the queue/`pump`, the clip-load/`replace`/play effect, the stall watchdog +
  re-sign, ducking, `setActiveForLockScreen`, `firedSeqs`. **No new tables, no API, no generation, no
  offline change** — the clip's bytes are already local/presigned.
- The stop is already in `firedSeqs` (debounced); a replay must **not** re-mark it fired or alter
  trigger state — it's a pure playback action.

## 5. UI / affordance

- A "Replay" `Button` on the drive screen, visible/enabled when `canReplay` (i.e., in the
  between-stops quiet). Big, single-tap, semantic-token styled (`@/ui`, an `Icon` like `replay`/
  `undo`), respecting the half-second-glance rule.
- **Lock-screen note:** between stops the player **relinquishes** Now Playing (`setActiveForLockScreen(false)`
  when `activeSeq === null`). The clip-load effect **re-claims** it when the replay starts, so Now
  Playing returns automatically. Exposing replay as the lock-screen **"previous track"** control is a
  nice-to-have (§6) — it needs the transport handler wired, since the lock screen is dormant in the gap.

## 6. Scope — v1 vs. later

- **v1:** replay the **last** completed stop, **live drive only**, drive-screen button. (The
  **preview** player already has a timeline you can drag back through, so replay-last is redundant
  there — scope to `useDrive`.)
- **Later (v2+):**
  - **Replay any passed stop** — make the *passed* rows in the existing drive-screen stop list
    (`DriveStopView` / `firedSeqs`) tappable-to-replay. Generalizes the feature nearly for free, but
    list-row taps are less driving-safe → frame it as a *parked / passenger* affordance, not a
    while-moving one.
  - **Lock-screen "previous track"** wired to replay-last.
  - **A persona "one more time—" pre-roll** before the replayed clip (charming, but needs a generated
    snippet — overkill for v1).
  - **Voice "hey skipper, say that again"** → this is the natural front door once **Ask the Skipper**
    exists (`docs/ask-the-skipper-spec.md`); replay-last is the hands-on-button version that ships first.

## 7. Edge cases

- **No clip has finished yet** (drive just started / only the intro is mid-play) → `canReplay` false,
  button hidden.
- **Skipped/failed stop** (audio never loaded — the stall path) → never becomes `lastCompletedSeq`
  (the `sawFresh` guard), so you can't "replay" silence.
- **Replay invoked twice / mid-replay** → just restart (`replace` reloads); harmless.
- **Pause/resume during a replay** → same as any clip (the existing `paused` path).
- **Drive ends while a replay is playing** → the outro/`finishDrive` path already drains the queue;
  a replay is just another clip in it.

## 8. Provenance

- Surfaced by `docs/competitor-ux-studies.md` (GuideAlong: *"difficulty replaying previous
  commentaries"*).
- Built on `apps/mobile/src/lib/useDrive.ts` — `onClipDone`/`pump`/`clipBusy`/`queue`/`handleFix`/
  `activeSeq`/`firedSeqs`/`sawFresh`/the clip-load effect/`setActiveForLockScreen`; complements the
  shipped scrubber (`seekToMs`/`seekBy`, the ±15s + position bar).
- Preemption rule mirrors the "stops win by construction" principle in `docs/downtime-callouts-spec.md`.
- Future voice front-door: `docs/ask-the-skipper-spec.md`.

**Decisions locked:** player-only (no backend); replay the last *completed* clip via the existing
clip path; a live GPS trigger **preempts** a replay (only replays are preemptible); offered in the
between-stops quiet (the scrubber covers the active clip); v1 = last stop + live drive, with
tap-any-passed-row and a voice front-door deferred.
