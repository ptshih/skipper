# The planner stops asking how long they want to be out

> **Status:** ✅ **DECIDED + BUILT + MEASURED 2026-08-04 (founder).** Prompt-only; no wire, schema, client
> or migration change. `target_minutes` SURVIVES on the tool and is still recorded whenever a rider offers
> a time — what is gone is the QUESTION and the recital.
> **It worked, on the full paid suite ($0.5433, 14 scenarios / 57 turns + judge):**
> `durations asserted as road fact` **10/54 → 2/57**, and both survivors look like detector false positives
> (*"Two hours, or two stops?"* is him clarifying an ambiguous "actually two", and the other hit is a line
> about his own identity). Flagged persona turns **6/54 → 0/57**; distinct within-chat repeated phrases
> **17 → 12**, and the read-back STEMS are gone from that list — what remains is place-name pairs, which a
> read-back cannot avoid. ⚠ The record-but-do-not-recite split is confirmed working: one drawn route
> carried `target_minutes: 120` picked up from *"actually two"* and never said back.
> ⚠ **It also surfaced a real regression elsewhere — see the last section.**

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

**Measured:** it worked as intended. No single draw-ask dominates the run any more (the judge saw
*"that the one you want?"*, *"is that our drive?"*, *"that the one you want?"* and others), and flagged
persona turns went to zero. The judge's remaining complaint is CADENCE, not wording: *"the sag is the sheer
volume of bare readback-confirm turns… fine but flavorless, and they drag the middle of several chats."*
That is a different problem from the stamp and wants a different fix.

## What this change appears to have COST — found, fixed, and verified the same day

The full run flagged `deflect-plan-draw-chat #2`: the rider said *"Yeah, do it."* to a plan and **no route
came back.** The cause is on the turn before, where the skipper said:

> *"Kings Beach down to South Lake Tahoe — and you want Emerald Bay on the way, or straight through?"*

That is an **either/or**, the construction `== Drawing it up ==` bans by name and whose counter-example is
almost this sentence — *"do not hand them a choice in the same breath as the ask ('straight through, or
back around?'), because there is no way to answer that with a yes, and a yes is the thing you are waiting
for."* The yes then had nothing to land on, exactly as that rule predicts.

Two things make it worth chasing rather than filing:

1. **The either/or was supposedly fixed on 2026-08-03** by making one-way the voiced default — but that was
   verified on `--only midpoint`, three turns, one scenario. It has come back in a **new flavour**: not
   "loop or straight" but "**via or straight**". A one-scenario verification did not generalise.
2. **The via was never asked for.** The rider's only mention of Emerald Bay was *"What's the deal with
   Emerald Bay?"* on turn 0 — a place question, which the skipper correctly deflected. The prompt says a
   pass-through rides along *"only if they actually asked for it. You never add one to be helpful."* The
   model read **asked ABOUT** as **asked FOR**. That gap is real and specific: the prompt never says what
   becomes of a place the rider only asked about, and a deflected name stays live in the conversation.

⚠ **And it may have been this change's own doing** — stated as a hypothesis then, and STILL a hypothesis
now: with both ends named and the duration question gone, the model had nothing left it was told to ask, so
it filled the vacuum with an either/or about the one loose name on the table. What is proven is only that
the fix works without restoring the ask; the vacuum itself was never isolated and is not worth paying to
isolate.

✅ **FIXED AND VERIFIED (2026-08-04, `--only deflect-plan-draw-chat`, $0.0968): routing 1.00, 0/4 flagged,
all three gates PASS.** Two clarifications of rules that already existed — deliberately NOT a new rule, the
lesson from the last either/or round:

1. On the pass-through rule: *"Asking ABOUT a place is not asking to go BY it. When they wonder what
   somewhere is like, that is road talk: it gets the road-talk answer and then it is finished. It does not
   join the plan, and it does not come back a few turns later as something you offer them."*
2. On the read-back: *"And you HAVE it the moment you have a start and a far end. Do not go hunting for one
   more thing to ask: not a stop to add, not a shape to choose between, not a number."*

**The mechanism was checked, not just the score.** Turn 1 went from *"…and you want Emerald Bay on the way,
or straight through?"* to *"Kings Beach down to South Lake Tahoe. Shall I set it?"* — no either/or, no
invented via, straight to a read-back a yes can land on. Turn 2 then DREW, with `via_anchor_ids: null` (the
manufactured stop is gone) and `target_minutes: 120` still recorded from *"Couple of hours"* and still never
said back. The chit-chat turn held without re-emitting, so the defect this scenario originally existed for
stays fixed. And the draw-ask came out different again (*"Shall I set it?"*), so no new stamp took its place.

⚠ Verified on ONE scenario, which is the same narrowness that let the previous either/or fix look complete.
The difference is that this one is a clarification of an existing rule rather than a behavioural default, so
it has less room to be true in one scenario and false in another — but the next full suite is what confirms
it, not this arm.
