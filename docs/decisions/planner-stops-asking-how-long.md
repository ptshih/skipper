# The planner stops asking how long they want to be out

> **Status:** ✅ **DECIDED + BUILT 2026-08-04 (founder).** Prompt-only; no wire, schema, client or
> migration change. `target_minutes` SURVIVES on the tool and is still recorded whenever a rider offers a
> time — what is gone is the QUESTION and the recital. ⚠ Unmeasured: this wants one paid eval arm, and the
> number it exists to move is `durations asserted as road fact`.

## The call

Founder, 2026-08-04: *"for the drive planner, i think we should stop asking the user 'how long'."*

## Why it was never a real question

**The skipper cannot act on a duration, by construction.** D9 hands the model anchor NAMES and no
coordinates, and the prompt forbids it any distance or drive time — *"you never work it out yourself, not
even loosely, not even as a guess with a shrug in front of it."* So *"I've got about two hours"* cannot
tell it which of its places is two hours away. The number arrives, and there is nothing it can do with it.

**The repo had already discovered this twice and stopped short of the conclusion:**

1. [drives-first-1-1.md](../designs/drives-first-1-1.md)'s redraw dead end — *"because the prompt forbids
   the model any distances at all, re-emitting the same two ends with a smaller `target_minutes` was the
   ONLY compliant emission it had for 'shorter'. **D9 compliance was what manufactured the dead end.**"*
   The fix then was to teach the arithmetic (*"a shorter drive means a nearer far end… until they pick
   which end moves, there is nothing new to draw"*). Correct, and it treated the symptom.
2. [post-1-1-slate.md](../designs/post-1-1-slate.md) §1.5 — *"Nothing downstream consumes a duration
   target: `driveProposeRequest` has no duration field, and the real number only exists **after** the
   billed Routes call."* Its proposal was to make the ask actionable by precomputing a pairwise minutes
   table into the cached prefix. That is the OTHER path out of the same problem.

Confirmed again here, in code: the client's `toProposeRequest` **drops** `targetMinutes` before
`/propose`, so it never reaches Google Routes; neither `buildDrive` nor stop selection reads it; and
`eval/checks.ts` excludes it from drive identity because two routes differing only in duration key
identically. Its only surviving consumer is `durationDrift` on the client.

## What the ask was costing

- **A turn.** One question per turn is a hard rule (*"two questions in the same breath is a form, not a
  conversation"*), so the duration ask was a whole exchange spent on a number nothing consumes.
- **Five separate rules** across the prompt, in the file that has no eval gate in front of it.
- **A measured leak.** The 2026-08-04 paid run scored `durations asserted as road fact` at **10 of 54
  turns**, and the quoted lines were the SAME turns carrying the persona sag (`persona` 0.64 advisory, 6/54
  flagged, *every* flagged turn a draw/read-back — *"Tahoe City out to Incline Village, straight through,
  about an hour."* → judge: *"Flat confirm, no voice"*). The read-back was the leak's only real home,
  because a duration restated inside a plan reads as a fact about the road no matter whose number it was.

## What changed (all in `apps/api/src/planner-prompt.ts`)

1. `== Your one job ==` — the plan is start, end, midpoints. Duration removed from the set.
2. The deflection sample that pivoted to *"How long do you want to be out?"* now pivots to a WHERE
   question (*"So where am I taking you?"*).
3. `== Drawing it up ==` — duration removed from "one plan you can say out loud".
4. The old *"How long they want is THEIRS, never yours"* rule is replaced by the ban, which keeps the
   provenance clause: if they offer a time, take it, never argue with it, keep it out of the saying-back,
   and never introduce one they did not give you.
5. The worked example's read-back no longer recites *"and a couple of hours of it"* — the rider still
   volunteers the time, which is what really happens.
6. The `target_minutes` tool description now says plainly that he never asks and no longer says it back,
   but records it every time it is offered, because **that field is the only place it survives.**

## What deliberately SURVIVES

- **`target_minutes` on the tool, and `durationDrift` on the client.** The drift notice was built on device
  2026-08-03 after watching the skipper agree to "two hours" while the card printed 54 MIN above the CTA.
  That gap is real and this change does not reopen it — a volunteered time is still recorded, so the notice
  still fires. ⚠ This is why the prompt distinguishes what he SAYS from what he RECORDS; collapsing the two
  would silently kill the notice.
- **The "shorter means a nearer far end" rule** and its example. Riders still ask for a shorter drive
  unprompted, and that rule is what stops him re-emitting the same two ends with a new number on them.
- **The map's-arithmetic deflection** for *"how long will it take?"* — unchanged.

## ⚠ The middle option that does NOT exist — do not re-propose it

The obvious refinement is *"ask only when they have not named a far end, where the duration is the only
signal for how far to reach."* It was recommended, chosen, half-written, and then withdrawn: **it rests on
a capability the prompt denies.** With no map, the model cannot pick a far end that is an hour out in the
one-end case any more than in the two-end case — it would have to guess a distance, which is the exact leak
the whole no-map section exists to prevent. Making that branch real means building slate §1.5 first.
A new scenario, `duration-instead-of-a-destination`, pins the correct behaviour instead: given a start and
a duration and no far end, he asks WHERE — and must neither re-ask the duration nor reach for a place that
"feels" an hour away.

Slate §1.5 is not dead, but its headline justification is: *"I've got about ninety minutes then gets
arithmetic"* is no longer a thing he is asked for. If it is ever built, it should be justified by what it
lets him ANSWER, not by a question he no longer asks.

## Shipped alongside, same commit, same turn

The founder also rejected the draw-ask line — *"I don't like 'Want me to draw that up?'"* — and the cause
turned out to be a **self-contradiction rather than a bad line.** The read-back rule says: *"You get no
sample line for this turn, and that is on purpose. Every time it has been shown one, the demonstration
became the stamp."* The worked example then showed one anyway, and it was the only draw-ask in the file.
The paid run measured the predicted result: **17 distinct within-chat repeated phrases, all read-back
stems**, and 1 turn judged CANNED.

So the line changed (*"That the drive?"* — shorter, and it drops the drawing-up idiom that
`== How you talk ==` warns against narrating), and the example now says explicitly that those four words
are the one part not to carry out of it. ⚠ **Swapping one fixed line for another only moves the stamp** —
the note is the actual fix, and if the jukebox persists, the next move is removing the ask from the example
rather than choosing a third sentence.
