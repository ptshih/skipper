# Cut the mid-drive concierge — the Skipper will not find you a coffee

> **Status:** DECIDED 2026-08-03 (skipper-hours session). **Not built, and deliberately not building.** No
> code changed by this decision except one charm beat it explicitly demotes to a copy edit (below). Scopes
> a boundary CLAUDE.md already implies but never stated: the live Skipper answers WHERE, and a *utility*
> ask is not WHERE just because its answer happens to be a place.
>
> ⚠ **AMENDED 2026-08-05 — the decision is UNCHANGED; its verbatim quotes are not.** The pause-control
> strings this record cites were relabelled (the hold suspends the TOUR, not the audio), and the one
> string that survived into code was itself rewritten. Dated addendum in place.

## What was proposed

A live, mid-drive ask surface: the rider says "Skipper, I need a coffee" / "anywhere worth stopping?" /
"get us off this road for a bit", and he answers with a break, a food stop, or a detour. The pitch is
strong and it will come back — he is *right there*, he already talks, and a break is the most obvious
thing a rider wants mid-drive that the app cannot currently give them.

## What was decided

**The utility half is cut.** He does not find, recommend, rank, or route to break stops, food, coffee, or
detours — not by voice, not by tap, not pre-drive and not mid-drive.

**The tease half survives, unchanged and already specced.** The deliberately-vague, refuses-to-name-names
bit ("there is something good down every one of these side roads; not my job to find it for you") is
existing designed content in [`../designs/skipper-opinions-spec.md`](../designs/skipper-opinions-spec.md)
§3.4, where it is taste-tier callout content deferred to v3. This decision does not touch it. Note the
inversion that makes it work: that spec keeps the bit *because* it refuses to be useful. The moment it
starts naming places it becomes the feature cut here.

## Why

1. **The invariants forbid exactly the data that makes a recommendation good.** CLAUDE.md's break-stop
   rule bars baking volatile data (hours, rating, popularity) into a frozen clip, and Places ToS is the
   other half of that. So a Skipper recommendation is *permanently, structurally* worse than the phone
   already in the cupholder — not worse-for-now, worse-by-construction. There is no version of the
   pipeline that fixes this, because the ban is the point.

2. **Charm does not launder a utility miss, and the asymmetry is the whole argument.** For narration,
   "less complete than Wikipedia but delightful" IS the product — nobody grades a story on coverage. A
   utility ask is graded on whether it worked. A charming wrong coffee shop is just a wrong coffee shop,
   and it spends the one currency the persona is banked on: the rider's belief that when he says
   something, it is true. The project already pays real costs to protect that belief (the fail-closed
   grounding gate, "silence beats a hallucinated battle", the planner's whole deflection register). A
   feature whose best case is "about as good as Maps" and whose median case withdraws trust is a bad
   trade at any build cost.

3. **The delivery surface is the most expensive unbuilt thing in the repo.** Mid-drive input does not
   exist: `apps/mobile/app/drives/[id]/` has no ask affordance, and the PTT / mic / iOS
   `allowsRecording` session-bracket plumbing designed in
   [`../designs/ask-the-skipper-spec.md`](../designs/ask-the-skipper-spec.md) §3.1–3.4 is entirely on
   paper. That spec names the session bracket as its single most likely runtime failure. Building it for
   a feature that loses to a free incumbent inverts the cost/charm ratio the whole roadmap is ranked on.

4. **It adds a rider-triggered paid call, which is a founder decision on its own.** Any mid-drive ask
   spends model tokens (and, for a detour, a billed Google Routes call) on every tap, anonymously,
   forever, with no `--apply` and no human in the loop — the second STOP-list rule. This decision
   declines that expansion rather than deferring it, so nobody has to re-litigate the cap design for a
   feature that fails on charm grounds first.

5. **A rerouting version breaks the artifact the rider bought.** "The route is the rails" — a drive's
   route is materialized and frozen at `POST /drives`, and the selection frozen against it cost a
   non-refundable credit. A mid-drive reroute either invalidates that selection or silently does not
   reroute, and the honest version of the second one is a feature that cannot do what its own pitch
   promises.

## What this is NOT

**Not a ruling on [`ask-the-skipper-spec.md`](../designs/ask-the-skipper-spec.md).** That spec is grounded
*place-facts* Q&A ("who built that castle?"), it stays deferred on its own terms, and its status is
unchanged by this entry. The two look alike from outside (both are "talk to him mid-drive") and fail for
opposite reasons: place-facts Q&A is deferred because it is *expensive to do safely*, and the concierge is
cut because it is *cheap to do badly and impossible to do well*.

**Not a ban on break stops.** `places.break_eligible` (curated, admin-side) and the stubbed `detours`
table stay exactly as they are. A break the *pipeline* selects and bakes at generation time is a designed,
grounded stop and is unaffected. What is cut is the rider asking for one live.

**Not "the Skipper never helps mid-drive."** He already handles the drive itself, in voice, today.

## The one thing that survived into code

The session's narrow survivor — "he does not recommend, he PERMITS" — turned out to be **80% already
built**, which is itself the argument against it as a feature. `apps/mobile/src/ui/voice.ts` already
speaks the pause control in persona (`pause: 'Hold here'`, `resume: 'Roll on again'`) and already carries
~30 player strings in his voice. The only genuinely absent beat was a warm line *while* a clip is held, so
it shipped as what it is — **one string plus one conditional, into the existing `card.body` slot** — not a
feature, not an ask surface, and explicitly not a precedent for one.

⚠ The reason it could not be *audio* is worth keeping: a pause line is **placeless** (no poi, no cluster),
and `narrations_subject_xor` requires exactly one subject. The `asides` table that once held placeless
audio was deleted in migration `0019` — the same wall that defers the callout system to v3. Placeless
spoken lines have no home in v2; the only escape is bundling pre-baked clips as app assets, as
`ask-the-skipper-spec.md` §3.6 proposes for its offline error copy. That was not worth a TTS run and a
rotation policy for a beat heard three times a drive.

### ⚠ ADDENDUM 2026-08-05 — the strings quoted above were relabelled; the decision is unchanged

The verdict, the five objections and the "he does not recommend, he PERMITS" survivor all stand. **The
verbatim quotes are stale**, so anyone grepping for them will not find them. Corrected here rather than
in place, per the append-only rule. The cause is a player-logic pass, not a reversal:
`docs/designs/download-before-start.md` §12.2.

**What pausing actually does.** Holding a live drive calls `sub?.remove()` (`gps.ts`), which RELEASES
the GPS watch. So while held the car keeps moving, no fix is processed, and a stop rolled past never
enters the trigger engine at all — not fired, not skipped, invisible even to `stop_skipped`, whose
reasons are all about AUDIO. **It suspends the TOUR, not the audio.** The category names this out
loud: Shaka Guide ships the identical behaviour as a **"Tour Switch"**, described to riders as
stopping the app from using their GPS. The mechanism is right and was NOT changed — only the copy,
which had been promising a held clip.

**The strings today** (`apps/mobile/src/ui/voice.ts`):

| | was | now |
|---|---|---|
| `cta.pause` | `'Hold here'` | **`'Hold the drive'`** |
| `cta.resume` | `'Roll on again'` | unchanged — resuming restores everything the hold released |
| `player.paused` | — | **`'ON HOLD'`** (the NOW card must stop saying "NOW PLAYING" for a held DRIVE) |
| `player.pausedBody` | `'Take your time. Nothing out here is going anywhere.'` | **`'Take your time. I’m not watching the road while we’re held, so anything we pass goes by unsaid.'`** |

⚠ **The survivor string itself was rewritten, and this is the part worth reading.** Its second sentence
was warm and FALSE in the way that costs a rider a stop — landscape permanence was the joke, and it
rested on a claim the released GPS watch contradicts. The warmth stays in front; then he says the trade
plainly. The shape this record describes is unchanged: still one string plus one conditional into the
existing `card.body` slot (`play.tsx`), still not a feature and still not an ask surface.

⚠ **This reinforces the cut rather than eroding it.** The line says nothing about WHERE the rider
stopped or why — he has no eyes and no live data — and `voice.ts` cites this record by name at the
string so the next person to warm it up finds the reason first. ⚠ `cta.pause`/`cta.resume` are
VoiceOver-only (the icon-forward transport drops the visible label) AND are the transport's DEFAULTS,
inherited by the drive-detail mini-preview, where there is no watch to release — which is why the
label stays short and the explanation lives on the card.

## What would reopen this

A live-fetch path that legitimately serves fresh Places data **at drive time, as text or UI rather than
baked audio** would defeat objection 1, since the volatile-data ban is specifically about what gets frozen
into a clip. That is a real door and it is left open on purpose. It would still owe objections 3 and 4 —
the input surface and the founder call on a new rider-triggered paid call — and it would want RISK-1
(drive it once for real) closed first, so that the thing being made more useful has been proven charming.
