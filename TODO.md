# TODO — engineering backlog

> ⚠ **1.1 IS DEPLOYED TO PROD (2026-08-02) BUT NOT RELEASED TO RIDERS, AND IT DELETED ROAM.** The push
> already happened ([docs/guides/1-1-cutover-runbook.md](docs/guides/1-1-cutover-runbook.md)); **what is
> left is one executable guide,
> [docs/guides/1-1-submission-sweep.md](docs/guides/1-1-submission-sweep.md)** — the two builds, the
> on-device sweep, then the listing. Verified 2026-08-03: build `1.1.0 (20)` is uploaded and
> `processingState=VALID`, and the 1.1.0 record is `PREPARE_FOR_SUBMISSION` with **no build attached
> yet**. RISK-1's real drive is OFF the critical path (founder, 2026-08-03).
> The build truth is [docs/designs/drives-first-1-1.md](docs/designs/drives-first-1-1.md) (D1–D42,
> INV-1–INV-16) with verified file:line coordinates in
> [docs/designs/drives-first-1-1-build-notes.md](docs/designs/drives-first-1-1-build-notes.md).
> Items below that assume ROAM, the client capability channel, or per-drive-only offline are superseded
> by that spec — it wins.

Carry-forward **engineering** items (the near-term layer of the truth system — see `docs/README.md`;
product ideas and build-ready designs live in `docs/designs/`). Each item has enough context to action
without re-deriving the reasoning. **Delete items when done** — git history is the archive.

**Item format — operated by `/todo`.** `- [ ] #12 (mobile, low, device) headline…`: a stable `#id`,
then AREA (`api` · `mobile` · `studio` · `corpus` · `ops` · `admin` · `site` · `store`), then PRIORITY
(`high` · `med` · `low`), then optional tags — `paid` (spends real money), `founder` (founder-owned or
needs an explicit go), `device` (needs real hardware), `doing`, `blocked: <why or #id>`. Everything after
the closing paren is the item, unchanged: a headline clause first, then as much context as it takes.
⚠ **A section heading and its preamble are SHARED context for every item under it** — read the preamble
before acting on an item, and put a new item under the section whose preamble already applies to it.

**next-id: 75.** Ids are never reused, so this counter — not the highest id in the file — is what
survives deleting the newest item. `/todo` takes the max of the two.

> ♻ **Re-baselined 2026-08-03: 2006 → ~700 lines.** Every finished build log was deleted per the rule
> directly above. The traps that lived ONLY here were relocated FIRST, and each is named where it went:
> `apps/mobile/CLAUDE.md` (the expo-maps rejection), `docs/guides/gcp-cloud-run-deploy.md` (the
> `includedFiles` trigger filter + the budget id),
> [docs/decisions/planner-directions-not-taken.md](docs/decisions/planner-directions-not-taken.md) (the
> spatial-context measurement + the LLM-framework research),
> [docs/designs/chat-render-performance.md](docs/designs/chat-render-performance.md) (step 8's revisit
> trigger) and [docs/designs/poi-legibility-layer.md](docs/designs/poi-legibility-layer.md) (the cluster
> geometry measurements). Everything else deleted was a duplicate of a comment, a test, or a doc that
> already said it.

## Planner eval — TWO PAID RUNS 2026-08-04. Run 2 after the duration change: routing 0.96, 2/57 flagged

> ⚠ **RUN 2 (founder go, `$0.5433`, 14 scenarios / 57 turns + judge, raw at
> `apps/api/eval/.runs/2026-08-04T17-48-46-730Z-mem.json`) — read this before the run-1 notes below.**
> It measured the duration change ([planner-stops-asking-how-long](docs/decisions/planner-stops-asking-how-long.md)),
> and that change worked: `durations asserted as road fact` **10/54 → 2/57** with both survivors looking
> like detector false positives, flagged persona turns **6/54 → 0/57**, repeated phrases **17 → 12** with
> the read-back stems gone. Of run 2's two routing flags, **one was the instrument** (`wrap-up-long-conversation`
> #7, the flip run 1 predicted and refused to make unmeasured — now measured and flipped) and **one is a
> real regression, below.** So FINDING 3 from run 1 is closed and a new one is open.
> ⚠ Read the two survivors as detector NOISE, not as leaks: it flagged *"Two hours, or two stops?"* (him
> clarifying an ambiguous "actually two") and a line containing *"a minute ago"*.
> ⛔ **Do NOT tighten it.** Its own definition says it is coarse ON PURPOSE and that *"its value is the
> DELTA, not the count… tuning it until it could [tell those apart] would be fitting it to one run's
> wording."* The 10 → 2 delta is valid precisely BECAUSE the identical coarse detector ran on both arms.
> (Advice to tighten it was written here first and withdrawn on reading the definition — the same
> read-the-definition trap this file keeps recording.)

- [x] #1 (api, high) **✅ FIXED + VERIFIED ($0.1620 on the two scenarios that caught it — routing 1.00 on both, 0 flagged,
      durations 0, all gates PASS). Mechanism confirmed, not inferred: the route now lands on the YES turns
      and on neither read-back, the exact inversion of the bug, and the "already sitting right there in
      front of you" stamp is gone.** RUN 3 ($0.5280, routing 0.93, 4/57): THE FIX BELOW BROKE THE SPEND GATE. `change-it-up-shorter` and `duration-instead-of-a-destination` both PASSED run 2 and
      both failed run 3, with one shape: he DREW on the read-back turn, then answered the rider's *"yep"*
      with *"That one's already sitting right there in front of you"* and drew nothing. Cause: the clause
      read *"the next thing out of you is **the plan**"*, and in this prompt "the plan" means both the
      sentence he says AND the tool call he emits — so it authorised drawing BEFORE the yes, which is the
      half of the spend gate D11 asks the prompt to hold. All three persona flags share that root: having
      drawn early, his next line always had to be "already sitting right there", which the judge called the
      run's most-repeated construction — a new stamp manufactured by the bug. ⚠ Never reached a rider (56
      commits unpushed; the commit was on no remote). Reworded, not reverted — run 2 showed the either/or
      returns without something in this slot: *"say it back -- and saying it back is not drawing it. Nothing
      gets drawn until they answer."*
      ⚠ **The durable rule, and the reason this is worth keeping after the fix: near the read-back, say SAY
      or say DRAW — never "the plan", which in that prompt names both the sentence he speaks and the tool
      call he emits.** Full write-up:
      [planner-stops-asking-how-long](docs/decisions/planner-stops-asking-how-long.md).
- [x] #2 (api, med) **DECIDED, and it is doctrine now rather than a one-off: "don't explicitly ban anything the skipper
      can say" (founder, 2026-08-04).** He still reaches for the rejected *"Want me to draw that one up?"*
      occasionally and that is accepted — deleting the sample line fixed the STAMP (the four runs also
      produced "that the one?", "Shall I set it?", "Say the word?", "is that our drive?"), and a phrase ban
      would buy one dead sentence at the cost of the variety that is this character's only defence against
      sounding like a jukebox. **When a line grates, look for what is TEACHING it** — here, a sample line the
      read-back rule had already said should not exist. Recorded in the prompt module's own header so the
      next agent reaching for a ban reads it first. ⚠ It does NOT touch the behavioural rules (never answer
      WHAT, never guess a distance, no markdown, no either/or) or counter-examples that make them concrete;
      nothing existing was removed, and a sweep of current rules would be a separate call.
- [x] #3 (api, high) **✅ FIXED + VERIFIED same day (`--only deflect-plan-draw-chat`, $0.0968 — routing 1.00, 0/4, all
      three gates PASS). THE EITHER/OR WAS BACK, IN A NEW FLAVOUR, AND A ONE-SCENARIO VERIFICATION IS WHY
      NOBODY KNEW.** Fixed by TWO CLARIFICATIONS of existing rules, not a new rule (the lesson from the last
      round): *"Asking ABOUT a place is not asking to go BY it… it does not come back a few turns later as
      something you offer them"*, and *"you HAVE it the moment you have a start and a far end — do not go
      hunting for one more thing to ask."* Mechanism confirmed rather than just the score: turn 1 became
      *"Kings Beach down to South Lake Tahoe. Shall I set it?"*, turn 2 DREW with `via_anchor_ids: null` and
      `target_minutes: 120` recorded-but-unspoken, and the draw-ask came out different again so no new stamp
      replaced the old one. ⚠ Still only ONE scenario — the next full suite is what confirms it. Full
      rationale: [planner-stops-asking-how-long](docs/decisions/planner-stops-asking-how-long.md).
      The original finding, kept because the diagnosis is the reusable part:
      `deflect-plan-draw-chat #2`: the rider said *"Yeah, do it."* and no route came back, because the turn
      before offered *"Kings Beach down to South Lake Tahoe — and you want Emerald Bay on the way, or
      straight through?"* — an either/or, which the prompt bans by name with almost that exact sentence as
      its counter-example. The 2026-08-03 fix (one-way as the voiced default) was verified on
      `--only midpoint` alone, three turns; it did not generalise from "loop or straight" to "via or
      straight". ⚠ **Second defect in the same line: the via was never asked for.** The rider's only mention
      of Emerald Bay was *"What's the deal with Emerald Bay?"* — a place question, correctly deflected. The
      model read **asked ABOUT** as **asked FOR**, and the prompt never says what becomes of a place the
      rider only asked about, so a deflected name stays live and the model tries to be helpful with it.
      ⚠ **It may be the duration change's own doing** (hypothesis, not finding): with both ends named and
      the "how long" question gone, the model had nothing it was told to ask and filled the vacuum. If so
      the fix is NOT restoring the ask — it is saying that asked-about is not asked-for, and that a settled
      pair of ends goes straight to the read-back. Verify with `--only deflect-plan-draw-chat`, four turns,
      cents. **Do NOT re-run the whole suite for one beat, and do NOT verify the fix on one scenario again —
      that is the mistake being corrected here.**
- [ ] #4 (api, low, founder) **The judge's remaining persona complaint is CADENCE, not wording** — *"the sag is the sheer volume of
      bare readback-confirm turns ('that the one you want?' / 'it is.'), which are fine but flavorless and
      drag the middle of several chats."* The draw-ask STAMP is fixed (no single line dominates run 2, 0/57
      flagged), so this is the next layer down and a different problem. Worth an ear before another prompt
      edit; persona is advisory and scored 0.67.

### Run 1 — $0.4911, routing gate FAIL (0.93, 4/54 turns)

Founder go given explicitly. Full suite, 13 scenarios / 54 turns + judge, `--apply` with the judge on.
Raw turns are on disk (`apps/api/eval/.runs/2026-08-04T05-48-55-670Z-mem.json`, gitignored), so any NEW
metric can be back-applied to this run at zero further spend — do that before paying for another arm.

**Not a regression from the 2026-08-04 plan-route hardening**, and the reason is structural: `eval/run.ts`
calls `runPlannerTurn` DIRECTLY, not the HTTP handler, so it never touches `toPlannedRoute` /
`toResponse`. ⚠ **Which is itself worth knowing: the panel is BLIND to the whole translation layer** — the
off-roster drop, the degenerate-route refusal and the leak suppression are unmeasurable by it. If those
ever need measuring, the panel has to go through the route, not around it.

- [x] #5 (api, med) **FINDING 1 — 3 of the 4 routing failures were THE INSTRUMENT, not the model. ⚠ I FILED THIS AS A
      PROMPT DEFECT AND WAS ABOUT TO EDIT `planner-prompt.ts`; the correction is the finding.** Fixed in
      `74496d7` (scenarios only — the prompt was not touched and must not be).
      **What made it obvious:** `loop-needs-a-way-home` is the control and it passes all four turns clean
      — one question per turn, one plan read back, a draw on the yes. The beat works as written.
      Two scenarios (`deflect-plan-draw-chat`, `everything-in-one-breath`) were loops whose way home is
      never supplied anywhere in the transcript. Since no-same-road-loops the skipper *cannot* draw that,
      so the scripted next line landed as a NON-ANSWER to a direct question — which the prompt is explicit
      is not a yes — and the model correctly asked again (*"That 'do it' jumped my question, friend."*).
      `expect: 'draw'` was unachievable by construction; demanding a route scored the model for OBEYING the
      prompt. ⚠ **Third instance of this instrument bug in that file** — `loop-needs-a-way-home` and
      `wrap-up-long-conversation` both carry comments fixing it on their own turns and these two were
      missed. It also cost `deflect-plan-draw-chat` its actual subject: with no route on the board,
      `hold_no_repeat` had nothing to not-repeat, so the re-emit defect it exists for went untested.
      `wrap-up-long-conversation` #7 is the third: its own comment makes `hold` conditional on the skipper
      having asked an either/or that turn, so it is a flaky expectation rather than a clean defect.
      ⚠ **The lesson, since this file has now caused three false findings:** an eval expectation written
      before a product rule existed reads as a MODEL failure forever. When a routing failure looks like
      "the model refused to draw", check whether the transcript actually contains everything a draw needs
      before reaching for the prompt.

- [x] #6 (api, high) **⚠ THE ONE GENUINE ROUTING DEFECT, AND IT IS A DIFFERENT RULE: the model offers EITHER/OR
      questions, which the prompt forbids by name.** On `midpoint` #0 it said *"Straight run up, or did
      you want to come back around?"* — and `== Drawing it up ==` reads: *"do not hand them a choice in
      the same breath as the ask ('straight through, or back around?'), because there is no way to answer
      that with a yes, and a yes is the thing you are waiting for."* Nearly the quoted sentence, verbatim.
      **Why it matters more than it looks:** an either/or means no turn ever presents a plan a yes can
      land on, so the rider's yes arrives against an unanswered question and the draw slips a turn — which
      is exactly what `midpoint` #2 measured (read-back + *"Draw it up?"* on the turn that should have
      drawn). ⚠ `wrap-up-long-conversation`'s comment already named this as the upstream cause on its own
      turn (*"the real defect upstream is that he offers an either/or at all"*) and it was never chased.
      So it is now measured on two independent scenarios.
      ⚠ **THE DIAGNOSIS ABOVE WAS WRONG AND THE CORRECTION IS THE FINDING: it was never an ADHERENCE
      problem, it was a CONTRADICTION.** This item read "the rule exists, is unambiguous… it simply is not
      landing. Do not add a fourth rule." In fact the prompt **instructed the banned construction in two
      other places** — *"say what the choice actually is and let them take it — somewhere on the other side
      to come home by, or a straight run out"* and *"do they want it straight through instead, or a
      different way home?"* The model was obeying those. Strengthening the ban would have chased a rule the
      prompt taught against elsewhere, which is why the "adherence" framing would have burned a paid arm
      for nothing.
      ✅ **FIXED AND VERIFIED (founder call + one paid arm, 2026-08-03) — by a PRODUCT rule, not a wording
      tweak: a loop is now an EXPLICIT-ASK EXCEPTION and one-way is the voiced default.** Measured on
      `--only midpoint --no-judge`, **$0.0616**: routing **0.93 → 1.00, 0/3 flagged**, voice and discipline
      1.00, 0 durations asserted as road fact. Turn #0 went from *"Straight run up, or did you want to come
      back around?"* to *"Nice and simple — South Lake Tahoe up to Kings Beach, one way. Want me to draw
      that one up?"*, and #2 DREW on *"yes that"* where it used to re-ask — which confirms the mechanism
      rather than just the outcome: the either/or was what kept a yes from having anything to land on.
      Rationale + the Moab/Arches note:
      [docs/decisions/no-same-road-loops.md](docs/decisions/no-same-road-loops.md) §8.
- [x] #7 (api, med) **Re-measure `wrap-up-long-conversation` #7 — DONE in run 2, and it flipped to `draw`.** The turn
      before it asked one clean single-plan question, so *"yes draw it"* is an unambiguous yes and the model
      drawing was correct. Worth keeping the shape of this one: the flip was PREDICTED here, deliberately
      left unmade without evidence, and then made from what a run actually did. That is the only one of the
      four instrument bugs in that file caught before it wasted anyone's time.
- [x] #8 (api, med) **FINDING 3 — the read-back turn was both the persona sag AND the duration leak. CLOSED by the
      duration change** ([planner-stops-asking-how-long](docs/decisions/planner-stops-asking-how-long.md)),
      measured in run 2: persona flagged turns **6/54 → 0/57**, `durations asserted as road fact`
      **10 → 2** (both survivors likely detector false positives), within-chat repeated phrases **17 → 12**
      with the read-back STEMS gone — what is left is place-name pairs a read-back cannot avoid.
      ⚠ It was diagnosed here as "worth an ear before another prompt edit" and as "the standing state of
      that turn, not a new slip". Both readings were too pessimistic: the turn was carrying a number the
      model was never able to act on, and removing the QUESTION fixed the turn. The successor complaint
      (cadence, not wording) is filed under run 2 above.

✅ **Clean, and worth recording so nobody re-checks:** `voice` and `discipline` gates both PASS at 1.00,
0/54. No boat, no markdown, no id ever recited, no place fact handed over. **And the prompt cache is
healthy** — `cache_read` ~6.9k on every turn after the first of each scenario, `cache_write` only on the
first, so the roster prefix is intact and the `cache_read: 0` regression is not present.

## Planner vs. Anthropic's current docs — external pass 2026-08-04 (free, read-only)

Checked `apps/api/src/planner.ts` against `platform.claude.com/docs` (adaptive-thinking, effort,
structured-outputs, prompt-caching) rather than against memory, per CLAUDE.md's grounding rule. **Most of
the config is right and is confirmed below so nobody re-checks it.**

- [ ] #9 (api, med, paid) **⚠ TRAP — RAISING `effort` ON THE DRAW TURN WOULD BREAK THE PROMPT CACHE. Read this BEFORE acting
      on the either/or defect above.** The obvious fix to a routing beat the model keeps getting wrong is
      "raise effort just for that turn". It is a cost regression: *"**The resolved effort value is
      rendered into the prompt**, so changing it between requests invalidates cache breakpoints"* — and
      the docs' own worked example shows a `high` → `medium` switch taking `cache_read` from 3546 to
      **0**. On this path that means re-billing the whole ~6.9k roster prefix at full rate on the most
      expensive turn of the conversation, forever, anonymously (INV-11).
      ⚠ Two corollaries worth keeping: *"pick a thinking configuration and an effort level per
      conversation and keep them"*; and **`effort` must not become per-request** — the `effort?:` field on
      `PlannerModelArgs` is an eval seam that passes ONE value for a whole run, which is why it is safe
      there and would not be safe in the handler.
      ✅ **The cache-safe lever is PER-MESSAGE STEERING**, which the docs name explicitly: thinking is
      promptable from the user turn, and *"guidance appended to the newest user message leaves earlier
      cache breakpoints intact, where a configuration or effort change does not"*. The documented phrase
      to encourage it is *"This task involves multistep reasoning. Think carefully before responding."*
      ⚠ *"Steering effectiveness can be sensitive to exact wording"* — so measure, and expect to iterate
      on phrasing. A whole-run `--effort medium` arm is still the cheaper first measurement of whether
      depth is what the either/or defect is missing; only the PER-TURN version is the trap.
- [ ] #10 (api, low) **The `drawn` / wrap-up system blocks reset the SECOND cache breakpoint — and there is now a
      first-class API for exactly this.** `planner.ts` appends them as system blocks 3/4, after the
      breakpoint on block 2, on the reasoning that anything volatile ahead of the breakpoint re-bills the
      prefix. That reasoning is **correct but incomplete**: the prefix does survive, and the transcript
      tail does not. Render order is tools → system → messages, so changing system bytes changes the
      prefix of every message after them.
      ✅ **Confirmed in the paid run's own numbers, not argued.** The cached system prefix reads 6897
      tokens every turn. In `draw-then-pleasantry`, `cache_read` runs 6897 → 6988 → **6897** → 7133 →
      7161: the drop back to exactly the prefix figure lands on the first turn carrying `drawn`, with
      `cache_write` spiking to 236. `return-to-earlier-plan` — which draws **twice** — shows exactly
      **two** such drops. One reset per draw, every time.
      **The fix is documented and needs no beta header on this model:** send them as
      `{ role: 'system', content: … }` entries in `messages[]` instead of top-level `system` — *"Preserves
      the cached history prefix and is the prompt-injection-safe operator channel."* Available on Claude
      Opus 5 / Opus 4.8 / Fable 5 / Mythos 5; ⚠ **NOT on Sonnet 5**, so it is model-gated and an
      unsupported model 400s (`role 'system' is not supported on this model`).
      ⚠ Placement rules bite here: such a message *"must follow a `role: "user"` message… and must be
      either the last entry in `messages` or be followed by an `assistant` turn"* — our transcript always
      ends on the rider, so appending is legal, **but the tail cache breakpoint currently sits on that
      last rider turn and would need to move.** Cost saved is small in absolute terms (a few hundred
      tokens per draw); the reason to do it is that it is the sanctioned channel and it makes the second
      breakpoint actually hold.
- [ ] #11 (api, med) **`strict: true` on `PLAN_ROUTE_TOOL` — a real but PARTIAL win with a latency cost. Judgment call,
      not a slam dunk.** Strict tool use is **GA on Claude Opus 5 with no beta header**. What it would
      buy: **`say` becomes structurally required** — retiring `route_wordless` at the source rather than
      backstopping it server-side — and field types plus `additionalProperties: false` stop being
      promises. What it would NOT buy, so don't over-claim it: **`maxItems` is not enforced**,
      **`minimum`/`maximum` are not enforced** (so `target_minutes` 20–480 stays advisory), and
      `format: uuid` is a semantic hint rather than reliably grammar-enforced. It also does **nothing**
      for the roster check — a well-formed UUID that is not on the allowlist still passes, which is why
      the plan-time drop and INV-1 both still matter.
      ⚠ **The cost is on the latency-sensitive path:** *"The first time you use a specific schema, there
      is additional latency while the grammar compiles"*, cached **24 hours from last use** and
      invalidated by any schema-structure or tool-set change. On a rider-facing conversational route that
      is a periodic first-request stall, and `PLANNER_TIMEOUT_MS` has to absorb it.
      Also unstated in the docs: compatibility with `tool_choice: auto` + `disable_parallel_tool_use`.
      Nothing suggests a conflict, but it is inference — prove it on one call before shipping.
- [ ] #74 (api, low) **The cache TTL is the bare 5-minute default, and the pass above never checked it — it audited
      breakpoint PLACEMENT (#10) and legality, not DURATION.** `planner.ts` sends
      `cache_control: { type: 'ephemeral' }` with no `ttl`, so an entry expires 5 minutes after its last read.
      What it governs is the ~6.9k-token system prefix measured in #10 — and the part that makes this worth a
      look is that the prefix is **byte-identical for every rider in a region**, so it is a SHARED asset across
      conversations and riders, not a per-rider one.
      ⚠ **Within one conversation there is nothing to win and nothing broken.** A cache read REFRESHES the TTL
      and turns arrive seconds apart, so an active conversation already stays warm at 5 minutes. The only
      question is the GAP BETWEEN conversations: at the default, a quiet stretch means the next rider in that
      region pays a fresh 1.25× write of the whole prefix. `ttl: '1h'` costs 2× on write, 0.1× on read, and
      would collapse that to one write per hour per region.
      ⚠ **It can LOSE, which is why this is a query and not a change.** Break-even against N conversations per
      hour per region: `1.25N = 2 + 0.1N` → **N ≈ 1.7**. Below that you have swapped a 1.25× write for a 2× one
      and bought nothing. Pre-launch that is a live possibility, so do not "optimize" this on the argument alone.
      ✅ **The deciding number is ALREADY BEING LOGGED — no spend, no instrumentation, no model call.**
      `logPlanSpend` emits `cache_read` and `cache_write` per turn as queryable `jsonPayload` fields. Sum both
      over a window in Cloud Logging: writes dominating ⇒ adopt the 1h TTL; reads dominating ⇒ close this item
      and record the number so nobody re-derives it.
      ⚠ **Do not read every `cache_write` spike as TTL expiry.** #10 proves each DRAW resets the second
      breakpoint and spikes `cache_write` mid-conversation, and #9's effort-change trap does the same thing for
      a different reason. Filter to the FIRST turn of each conversation or the answer is noise.
      Related and SEPARATE: a `max_tokens: 0` pre-warm at Cloud Run instance boot is the documented way to kill
      the cold-start write — but that is **a new billed model call on an autoscaled service (INV-11 ⇒ founder)**,
      so only raise it if the query says writes dominate.

✅ **Confirmed CORRECT against current docs — do not re-audit these:**
  - `thinking: { type: 'adaptive', display: 'omitted' }` — right shape; `omitted` IS the Opus 5 default,
    so stating it is belt-and-braces, and it keeps reasoning off rider-facing text (INV-8).
  - **Thinking produced ZERO tokens on all 54 eval turns at `effort: 'low'`** ⚠ **— HISTORICAL as of
    2026-08-04: production now runs `medium`, so a fresh zero would be a finding, not a confirmation.**
    Kept because it is the baseline the change is measured against. It was EXPECTED at 'low' —
    *"Claude minimizes thinking. Skips thinking for simple tasks where speed matters most."* Picking two
    endpoints off a printed list is that task. `display: 'omitted'` does NOT suppress or unbill thinking
    and `thinking_tokens` is populated under it, so the 0 is a TRUE zero. ⚠ When streaming, that
    breakdown appears only on the final `message_delta` event — which is where this code reads it.
    ⚠ **This does NOT explain the 2026-08-03 tool-call-as-text leak.** That failure mode is documented
    against `thinking: {type: 'disabled'}`, which this code never sends; the docs are silent on whether
    adaptive-choosing-zero shares it. Treat it as an OPEN question, not a cause. The real explanation was
    already in the repo — `PLAN_ROUTE_TOOL`'s `say`-field-last note (leading the tool object with a long
    prose field measurably produced 2–3 leaks per replay vs 0 with ids first). ⚠ **Do NOT spend on an
    `--effort medium` arm to chase INV-8**; that question is answered. Effort is worth measuring for the
    either/or defect's sake only.
  - `tool_choice: { type: 'auto', disable_parallel_tool_use: true }` — documented as valid together.
  - **Two cache breakpoints is legal** (max 4 per request), and the ~6.9k prefix clears Opus 5's **512**-
    token minimum with room to spare — that minimum halved from Opus 4.8's 1024, so the code comment
    naming 512 is current.
  - **The 20-block cache lookback is not a hazard here.** A breakpoint walks back at most 20 content
    blocks; our turns add exactly 2 messages, so the tail breakpoint always finds the previous one.
    `MAX_PLAN_MESSAGES = 24` looks like it should trip this and does not — the window is the DISTANCE
    between breakpoints, not the transcript length.
  - **TS SDK `timeout` is milliseconds**, so `timeout: PLANNER_TIMEOUT_MS` (45_000) is 45s as intended —
    the units differ per SDK (Python/Ruby take seconds) and this one is right.
  - `maxRetries: 1` against the SDK default of 2, with the documented wall-clock consequence
    (`timeout × (maxRetries + 1)`) already written down in `limits.ts`.
  - ⚠ **`max_tokens` — THAT MOMENT ARRIVED: raised 2048 → 4096 on 2026-08-04** alongside
    `PLANNER_EFFORT` 'low' → 'medium' (explicit founder call, both in one change — the pairing is the
    whole point, and this bullet is what predicted it). The docs recommend ~64000 for streaming requests
    and warn that `max_tokens` caps *thinking plus text*; the old ~10× headroom was measured in a regime
    where thinking never engaged, so it was never really 10×. Visible `out` still peaks at 209, so the
    doubling is all thinking headroom. ⚠ **Shipped UNMEASURED** — the eval arm was offered and declined —
    so the watch item is real: filter `plan_spend` for `stop_reason: 'max_tokens'` (surfaces to the rider
    as `truncated` → the retry line) and for a `thinking` jump, which is the latency cost landing. Both
    fields are already logged; no instrumentation is owed.
  - **`fallbacks` is available and deliberately NOT adopted.** A refusal is answered in persona
    (`VOICE.refused`), and a fallback is a SECOND billed model call on an anonymous route — adopting it is
    a founder spend decision under INV-11, not a hardening default. Recorded so the omission reads as a
    choice.

## Virtualize the chat transcript (step 8) — NEEDS A FOUNDER GO, and not yet justified

The last un-taken step of [docs/designs/chat-render-performance.md](docs/designs/chat-render-performance.md),
which is otherwise BUILT (steps 1–7 landed and measured 2026-08-03). **The full argument — three
decisions wearing one number, plus the revisit trigger — lives in that doc's step-8 section.** Do not
re-derive it here; the short version is that a REAL DEVICE on a LONG conversation is the only evidence
that would justify it, and everything measured so far is simulator-only under ~8 turns.

## VALIDATE: four ops CLIs went from serial writes to bounded fan-out (2026-07-30)

The /simplify sweep converted four free ops CLIs from one-write-at-a-time to `mapLimit(…, 8, …)` — the
pool the paid CLIs already use. Typecheck and the studio tests pass, but **none of these can be exercised
without writing to the live corpus**, so they ship unvalidated by construction. dev and prod are ONE Neon
database; there is no staging to rehearse in.

- [ ] #12 (studio, high, founder) **Validate with a PREVIEW first, then one small `--apply`.** In order, cheapest first:
      - `discover-pois` (both the story and scenic upsert loops) — the biggest win, and the one that gates
        the rest of the pipeline. Region-scale: Tahoe ~459 story pins, Yosemite 837.
      - `backfill-poi-extent` (whole-region `pois` update) · `prune-corpus` (flags a subset) ·
        `sweep-orphans` (R2 deletes).
      What to check: the counts printed at the end match a preview run of the same region, and no poi is
      written twice or skipped. `upsertPoi` is a QID-keyed `onConflictDoUpdate`, so a re-run is idempotent
      and a partial failure is recoverable by re-running — that property is what made the change safe to
      attempt at all.
- [ ] #13 (studio, low) ⚠ **Know the one semantic change.** `mapLimit` FAILS FAST like the serial loops did, but on a throw
      the ~7 in-flight siblings settle unobserved rather than never starting. So a crashed run leaves a
      slightly larger, less predictable written prefix than before. Idempotent upserts make that
      recoverable; it is not a reason to panic if a run dies mid-way, but it IS why the counts should be
      eyeballed rather than assumed.
- [ ] #14 (studio, low, founder) `sweep-orphans` deletes R2 objects. Its preview LISTING is byte-identical to before (every key is
      logged before any delete now), so a `--apply`-less run is a safe first check.

## The version gate's store link is dead in the CURRENT window — closes with the 1.1 release

`apps/api/src/version-policy.ts` justifies its App Store link with "it resolves by construction at the
only moment it's used": the wall can only fire once a floor is raised, and a floor can only be raised once
there IS a published version. **That condition is not met right now.** Verified 2026-08-03:
`apps.apple.com/app/id6778946770` → **404**, iTunes lookup `resultCount: 0` (1.0.0 is
`DEVELOPER_REJECTED`).

The case that breaks the argument is a DEAD TESTFLIGHT CLIENT — build 16 calls `/roam/*`, which the 1.1
API 404s. And for a TestFlight tester the App Store was never the right destination anyway; TestFlight
updates its own.

**Founder call 2026-08-03: leave it — the 1.1 build is imminent and closes the window.**
⚠ `autoIncrement` burns a build number at QUEUE time, so never predict one; read it back.
- [ ] #15 (store, low, blocked: 1.1 listing live) **Delete this entry once the listing is live** (the argument becomes true again) — or act on it if
      the release slips and testers need a clean wall instead of bare 404s.

## `apps/api` — the one open item from the 2026-08-02 diligence pass

The pass read the whole surface (mount order, limits, credits, erasure, planner config, logging) and found
it in unusually good shape; everything it fixed is now pinned by a test that names it
(`test/regions-cache.test.ts`, `test/auth-cookie-cache.test.ts`, `test/drive-access.test.ts`,
`test/limiter-mounts.test.ts`), so the build log is deleted rather than duplicated here.

- [ ] #16 (api, med, founder) **The auth-DB path is uncapped on the `/drives` owner routes** — found by the 2026-08-03
      guard-ordering audit, NOT fixed (a new rider-facing cap is a founder call, CLAIM/STOP).
      `driveRoutes.use('*', withSession)` runs for every `/drives/*` route, but only `POST /` carries a
      limiter (`createDriveLimiter`). `GET /`, `GET /:id`, `POST /:id/assets/sign` and `DELETE /:id` have
      none — so an attacker-controlled resolve (mint an anonymous token, send it WITHOUT `sessionData`)
      reaches the auth DB on those routes, uncapped, and only THEN gets its 401 from `requireAccount`.
      ⚠ `withSession` cannot simply be moved below `requireAccount` to dodge this — `requireAccount` READS
      the session that `withSession` sets, so that order is required, not incidental. The options are a
      limiter on the `/drives` mount or accepting it; both are decisions, not refactors. Same class as the
      `/regions` cap that shipped 2026-08-03, on routes already behind a wall.
      ⚠ Everything ELSE the audit checked came back correct and deliberate — no second instance exists.
      Be generous with any number: caps key on client IP and CGNAT puts many riders behind one address.

## Production ops hardening — from the 2026-07-30 ship-readiness audit

None of this is a build; all of it is config. **What shipped (uptime check, alert policy, billing budget,
`--max-instances=3`, the `includedFiles` trigger filter) is recorded in
[docs/guides/gcp-cloud-run-deploy.md](docs/guides/gcp-cloud-run-deploy.md)** — it lives only in the GCP
console, which is exactly why the guide holds it.

- [ ] #17 (ops, high, blocked: on-device sweep) **⏸ DEFERRED (founder, 2026-08-03): there is NO test gate in front of production.** There is no
      `.github/` in this repo at all, and `cloudbuild.yaml` runs docker build → push → deploy with **no
      `bun run check` step** — so a push deploys prod at **100% traffic** with nothing having run the
      suite. Held until after the on-device verification pass, deliberately: the fix edits the release
      path, and editing the release path is the last thing you want to be doing on the way to a ship.
      **The fix when it lands: `bun run check` as step 0 in `cloudbuild.yaml`** — ⚠ *not* a GitHub Action.
      An Action cannot stop an independent Cloud Build trigger, so it would report a red check beside a
      deploy that already went out; only a step inside the build that deploys can gate it.
- [ ] #18 (ops, high, founder) **⚠ FIRST: confirm `hello@skipper.fm` actually delivers somewhere you read.** Founder-owned, ~5 min,
      and it BLOCKS the alerting below (there is no point routing pages to an address nobody reads).
      It is simultaneously the App Store support contact, the privacy contact, and the **NRS 603A
      designated request address with a 60-day statutory clock** — so this is the one item here with a
      legal edge, not just an ops one. The repo's own record says the skipper.fm catch-all does NOT
      forward to the founder's Gmail (verified for `review@`, never for `hello@`), and because the
      catch-all accepts everything, SMTP probing can NEVER prove an address is read. Only a real test
      message can. Send one from a non-Workspace account to `hello@` and confirm arrival.
      ⚠ The in-app "Report an issue" mailto now points at `hello@` too, so this address is the ONLY route
      a rider has to reach a human from inside the app.
- [ ] #19 (ops, med, blocked: #18) **Send yourself a test alert.** The notification channel reports enabled with an unset
      `verificationStatus`, which is not the same as a delivered message — until the item above closes, a
      page can fire into nothing.
- [ ] #20 (api, med) **`PLAN_RATE_HOUR`'s window is still not durable.** The window lives in an in-memory map that dies
      with the instance. `minScale: 1` now holds one instance warm, so the hour cap survives idle periods
      it previously did not — but this is mitigation, not a fix: the instance still recycles on deploy and
      on any Cloud Run-initiated replacement, and at `maxScale: 3` there are up to THREE independent maps,
      so the effective hourly ceiling is still the limit times the live instance count. A shared store is
      the real fix; `rate-limit.ts` puts it at M4.
- [ ] #21 (api, med, founder) **Re-accept RISK-4 deliberately, or re-price it** (founder, STOP rule — not a refactor).
      `PROPOSE_RATE` was set when `/propose` sat behind an account wall: the wall was the first-order
      guard, the limiter was defence-in-depth. After D14/D15 the limiter is the only guard on a billed
      Google Routes call reachable by any stranger, forever. The number was not changed and no change is
      being recommended — its PREMISE moved, and per CLAUDE.md that is a founder call. Same question
      applies to `PLAN_RATE_MINUTE`/`PLAN_RATE_HOUR`, which never had a wall in front of them.
- [ ] #22 (ops, low) **Cloud Run `--cpu` / `--memory` are still defaults** (`cloudbuild.yaml`). ⚠ The SCALING half of
      this item is DONE and should not be re-raised (`--max-instances=3`, service-level `maxScale: 3` /
      `minScale: 1`; `minScale: 1` also closed the cold-start-plus-Neon-wake — 4.2 s → 0.23 s, measured).
      What is left is only the resource shape, worth setting only if a real workload says the defaults are
      wrong.
- [ ] #23 (ops, high, founder) **Neon PITR / backup retention is unverified** and lives nowhere in git. It is the only thing
      between a mistaken migration and permanent loss of the append-only `credit_entries` ledger, which
      never refunds and has no second copy.
      ⚠ **FOUNDER-OWNED, ~2 min — it CANNOT be checked from this repo** (verified 2026-08-03): there is no
      `NEON_API_KEY` in either env file and no Neon CLI installed, so the control plane is unreachable
      from an agent session. Project endpoint is `ep-super-shape-aqvlhvto`, AWS `us-east-1`, db `neondb`.
      **Where:** Neon Console → **Settings → Instant restore**. It is ONE project-wide history window —
      not per-branch — and PITR restores only from ROOT branches.
      **What the answer means** (checked against Neon's docs 2026-08-03): **Free defaults to 6 HOURS**,
      capped at 1 GB of changes; paid plans default to 1 day; Launch/Scale raise to 7 days;
      Business/Enterprise 30. ⚠ **If this project is on Free, the real window is six hours** — a bad
      migration run in the evening and noticed the next morning is simply gone, and D4 now permits
      destructive migrations. Record the plan AND the window here once read.
- [ ] #24 (ops, high) **The corpus snapshot — the OTHER half of that net — is stale.** Last one is
      `packages/studio/.scratch/snapshot-2026-07-31/`, COMPLETE (458 narrations / 785 R2 objects, 0
      failed). ⚠ It **predates both the 1.1 production cutover (08-02) and migration 0043 (08-03)**, and
      its `drive_demand` rows are a table 1.1 removed — so it restores a schema that no longer exists.
      `snapshot-corpus` is READ-ONLY and spends nothing, so re-running it is free; the STOP rule wants a
      current one before any destructive step.

## Mobile technical diligence — validated against Expo's current docs (2026-08-02)

**Version currency is a genuine asset and needs no work**: SDK 57 is the current release, RN 0.86,
React 19.2. The gaps are all in the ENFORCEMENT layer. ⚠ The `react-native-maps` → `expo-maps` question is
**closed and its three capability blockers now live in `apps/mobile/CLAUDE.md`** — read them there before
re-proposing it.

- [ ] #25 (mobile, high, device) **Prove `react-native-maps` renders correctly on SDK 57, on a device.** There is an open Expo issue
      for this combination on iOS with Google Maps (expo/expo#43288) — but that issue is **SDK 55**, and we
      are on 57, so the risk may be entirely theoretical. This is a ten-minute device check, not a
      migration: open a drive, confirm the tinted basemap, the stop pins, the puck and camera-follow all
      render. If it works, write that down (with the date + SDK) and close the question. If it does NOT,
      the decision reopens — and the fallback already exists in code: no Google key → Apple Maps, and List
      mode is the offline/accessibility-complete equivalent.
- [ ] #26 (mobile, low, device) **`eslint-suppressions.json` — 13 left across 6 files, and ALL 13 ARE TRIAGED AND BENIGN.**
      **Nothing here is a bug**; each remaining report is a legitimate instance of a category the rule
      flags, which is the useful thing to know before anyone treats the file as a pile of latent defects.
      - **8 `set-state-in-effect`** — every one is an async load resolving (`void load()`), an
        event-driven reset (a new clip clears the scrubber's drag state; a live drive clears the GPS
        "searching" flag), a reconnect handler, or a form field seeded from the session. None loops.
      - **5 `refs`** — the Scrubber's lazily-built `PanResponder` read back in JSX (3), plus two refs read
        inside a `map`/`forEach` during render.
      ⚠ **The only mechanical fix left is the Scrubber's PanResponder**, which could become a lazy
      `useState` initialiser like the ones already converted. It is gesture code and cannot be typechecked
      into confidence — **do it WITH a device pass, not before one.**
      ⚠ `eslint-disable-next-line` means literally the NEXT LINE — a directive followed by a continuation
      comment disables nothing, silently. That cost eight of them before the error count failed to move.
      Also 5 warnings left deliberately unfixed (4 × missing `preview` dep, 1 × `anchorNames` useMemo) —
      all render-churn judgement calls in the planner and drive-detail screens.
- [ ] #27 (mobile, low, blocked: #26) **React Compiler — deliberately NOT yet.** Available via `experiments.reactCompiler` with Babel
      auto-configured on SDK 54+, still experimental and off by default. This codebase would benefit
      unusually much (it is dense with hand-rolled `useCallback`/`useMemo`/ref memoization). But it
      REQUIRES strict adherence to the Rules of React — which is precisely what the suppressions above say
      is not true today. Do it after the backlog and after the test gate, or not at all.
- [ ] #28 (mobile, low, device) ⚠ **A visual glance is owed on `b7e6614`** (the `useAnimatedValue` swap — semantically identical, but
      never visually verified): typing dots, skeletons and the stop-row stamp, next time the app is open.

## Corpus quality — what is left after the tail-collapse episode

The 2026-07-30 regeneration raised tail collapse 2% → 21%, and a `resynth-narration` pass took the corpus
to **6.5%** for $1.25 by re-rolling TTS on the same scripts. ⚠ **The durable lesson — solo tail collapse is
mostly STOCHASTIC IN THE SYNTH, not determined by the script** — and the five traps that each produced a
wrong conclusion live in [docs/guides/ops-scripts-sop.md](docs/guides/ops-scripts-sop.md) ("Judging a paid
run"). ⚠ Regeneration overwrites `narrations.script` in place with no history table: **not revertible,
only fixable forward.**

- [ ] #29 (corpus, med, paid, founder) **13 clips remain flagged** at median 5.6 dB (max 9.3). Cheapest next move is another `resynth`
      round on just those (~$0.50); a few are genuinely structural and want an ear, not another re-roll.
- [ ] #30 (corpus, med) **⚠ `audit-loudness` is SOLO-ONLY, and the blind half is the half with the history.** It inner-joins
      `pois`, so the **34 fused cluster tellings** (`poi_id` NULL) are never measured — and
      `resynth-narration` is poi-keyed, so it could not repair them even if they were. Fused clips are
      where tail collapse was WORST (35% at n=31 before the closer rule shipped, vs ~2% solo). Named in
      both headers + the SOP table; the real fix is subject-keyed measurement + resynth, which is a build,
      not a flag. ⚠ Read a clean `audit-loudness` run accordingly: it is a statement about the SOLO corpus
      only.
- [ ] #31 (corpus, low) **Standing regression test for any persona-prompt change** — `audit-loudness --json <path>` saves a
      run, `--baseline <path>` diffs a later one and exits 1 on any clip that collapsed and did not
      before. Free and read-only. Workflow: capture → change the prompt → regenerate the same places →
      diff. **Nothing runs it automatically** — a paid regeneration is founder-gated, so this is a tool an
      operator reaches for, not a gate in `check`. Use it on the next prompt change.

## The POI legibility layer — what remains

Phases 1–3 and fused generation are BUILT and RELEASED; the design and every measurement live in
[docs/designs/poi-legibility-layer.md](docs/designs/poi-legibility-layer.md) and
[docs/designs/fused-cluster-generation-spec.md](docs/designs/fused-cluster-generation-spec.md), which is
where the build log went. Corpus today: **37 fused tellings, all released** (32 cluster + 5 district).

- [ ] #32 (corpus, med, paid, founder) **Yosemite's 30 clusters** — still un-generatable (zero enriched members); needs a founder-gated
      `enrich-pois --region yosemite` run first. `generate-cluster-narrations.ts` is complete: narrate →
      fail-closed gate with excision retakes → TTS → loudnorm → R2 → upsert on `narrations_cluster_uq` →
      eval record keyed to the cluster. **`--limit 1 --apply` is the cheap path to ONE real clip to listen
      to** (well under $1) before committing all 31 (~$12–16). ⚠ A PREVIEW is not free either — it
      narrates and scores; only persistence is gated. ⚠ Per-clip cost RISES for fused (a fused well is 9
      sheets and the script runs to the 180 s ceiling, not the 90 s story aim).
- [ ] #33 (corpus, low) **Diversity advisory failed 16 of 31 fused clips (52%).** Naming five places pulls toward
      enumeration — the NAME-DENSITY tension §3.3 predicted. It never withheld a clip, but half a run is a
      signal. ⚠ Read the number correctly: **fused-vs-fused repetition is 0 of 31** (measured), so they are
      NOT repeating each other; the failures are the PER-stop rules. ⚠ And ⛔ **do not regenerate for
      monotony** — a $1.68 preview measured no net improvement (NRHP 5→3, total cross-clip findings
      14→14, one clip got WORSE), because the corpus is saturated enough that a rephrase mostly finds
      another worn groove.
- [ ] #34 (corpus, low, device) **`speakable_road_class` still has no consumer.** The silence bug turned out to be a threshold
      inconsistency, NOT a road-class problem — every silent stop was on a MAJOR road. So the column
      remains recorded-but-unused. It is now a question about CHOICE between two reachable stops (prefer
      the through-road one in `better()`?), not about reachability. Worth far less than it looked; decide
      on a real drive.
- [ ] #35 (corpus, low) **`buildDrive` reads anchors; delete pick-one.** Orphans ~169 satellite clips — `sweep-orphans.ts`
      already handles that.
- [ ] #36 (corpus, med) **The no-Wikidata-claim containment gap has a second confirmed instance.** `U.S. Route 50 in Nevada`
      was staged and would have gone live as a 70 s telling about a 300-mile highway, un-anchored, firing
      at one arbitrary point — it was EXCLUDED at pre-flight. It escapes `prune-corpus` because it carries
      no `length_km`, no `wikidata_types` and no `kind` (same shape as `Carson Range`). Worth a real fix
      when containment is next touched.

## When YOSEMITE ships: the metadata that goes stale (founder ask 2026-07-28)

Content is SERVER-SIDE, so a second region goes live with no app release. That is the whole problem: the
corpus changes underneath a listing that still says Tahoe-only, and nothing forces the two back into
agreement. Trigger this list the day Yosemite narrations are RELEASED (`released_at` non-null), not the
day generation finishes.

⚠ Do NOT pre-announce Yosemite in ASC before it serves. Guideline 2.3.7 wants keywords that "accurately
describe the app", and §10's reviewer notes say in capitals that coverage is Lake Tahoe ONLY —
pre-announcing contradicts the document written to reassure the reviewer. Under-promising is the safe
direction; the reverse is what gets rejected.

**Instantly, no review (the only same-day lever):**
- [ ] #37 (store, med, blocked: yosemite release) **Promotional text.** Currently closes "Starting in Lake Tahoe." This is the one field editable
      without a version submission, which is exactly why geography lives here.

**Next version submission (all version-scoped, so they ride one build):**
- [ ] #38 (store, high, blocked: yosemite release) ⚠ **Description — this becomes FACTUALLY FALSE, not merely dated.** `RIGHT NOW: LAKE TAHOE ONLY` and
      "the finished collection covers Lake Tahoe" both stop being true. Apple requires metadata be kept up
      to date, so this is an obligation rather than an improvement.
- [ ] #39 (store, high, blocked: yosemite release) ⚠ **§10 reviewer notes.** They tell the reviewer coverage is Tahoe only and give Tahoe City → South
      Lake Tahoe as the test drive. Leave them and the next reviewer is actively misled by our own
      instructions.
- [ ] #40 (store, med, blocked: yosemite release) **Keywords.** Add `Yosemite`. Currently 99/100, so something goes — `nearby` or `car` are the
      weakest. ⚠ Keep the subtitle/keywords geography coupling in mind (§5): between them they are the only
      indexed fields, so don't end up with no place name anywhere.
- [ ] #41 (store, med, blocked: yosemite release) **Screenshots.** The map frame is captioned "Starting in Lake Tahoe" and shows the Tahoe basin.
      Recapture per §9 (live GPS, never `?mode=sim` — it renders a SIMULATED badge).
- [ ] #42 (store, low, blocked: yosemite release) **App Preview.** The 28s video is an Emerald Bay postcard. Still honest, still fine; revisit only if
      Yosemite is the better hook.

Probably NO change needed: the **subtitle** is deliberately geography-free (`Scenic Drives & Local
History`), which is the entire reason it was written that way — it survives new regions untouched.

- [ ] #73 (mobile, med, blocked: yosemite release) **Every rider who onboarded before Yosemite is never told it exists** — onboarding
      asks "where are we driving?" exactly ONCE per install (`onboarded`, `src/lib/client-flags.ts`), and
      by definition they answered it when Tahoe was the only answer. Nothing re-asks, so they stay pinned
      to their cached region by `pickRegionId` and the ONLY way they discover a second one is noticing the
      chip on home is tappable. That is a discovery problem, not a bug — the app behaves correctly and the
      rider simply never finds out.
      ⚠ This section's preamble IS the reason it is worth solving: content is server-side, so the install
      base does not turn over when a region ships. Waiting for reinstalls means most riders never see it.
      ⚠ **Do NOT solve it by re-running onboarding** — clearing `onboarded` server-side or on a version
      check walks a rider who is mid-conversation back through a postcard they have already heard, and the
      flag is deliberately one-directional for exactly that reason (its own header, and `resetOnboarding`
      is developer-only). The shape that fits is a ONE-TIME, dismissible nudge on home the first launch
      after the region list GROWS — the client already caches the last region list (`region-cache.ts`), so
      "grew since last launch" is computable on device with no new endpoint. It would need a second field
      in that cache (the known region ids), which is the one design question here.
      ⚠ Whatever lands must not make the chip conditional or the composer gateable on it — see §18 of
      [home-cold-open-declutter](docs/designs/home-cold-open-declutter.md) for the kill switch that shape
      already produced once.

## LLM answer-discovery (GEO/AEO) — the one remaining half

Research + the two cheap builds landed 2026-07-28. Verdict, evidence and per-claim source-quality labels
live in [docs/designs/llm-discovery-marketing.md](docs/designs/llm-discovery-marketing.md) — read that,
not a summary. The expensive half (programmatic per-POI pages from our own corpus) is **dead on the
merits**: our corpus is downstream of Wikipedia, and we cannot out-cite our own supplier with a
CC BY-SA-encumbered restatement of it.

- [ ] #43 (site, low, founder) **E — off-domain presence: FOUNDER-OWNED, unstarted, free half only.** ⚠ The observed pass killed
      the Reddit plan *for this vertical*: the queries a rider actually asks return OTA/marketplace
      listings (Viator, TripAdvisor, even a Marriott white-label) — **zero Reddit threads, zero Autio,
      zero Skipper**. The cross-vertical "Reddit is ~40% of AI citations" stat is someone else's average.
      The high-return move here is becoming a marketplace supplier: business development, not engineering,
      and it collides with the free-app + credits model. Flagged, not recommended.

⚠ **Unresolved, and it undercuts the whole channel:** an LLM-sourced install is very likely **invisible to
every instrument we have** (doc §6). A channel you cannot attribute is one you cannot iterate on — so
treat the shipped moves as cheap insurance against being mis-resolved, NOT as a measurable channel.

## The conversation cannot survive an unmount — INTENDED, revisit later (founder call 2026-08-02)

**Not a bug, and not to be "fixed" opportunistically.** D10 makes the planner stateless: no
`conversations` table, no server copy, and INV-13 forbids persisting rider content on the client. So the
transcript is React state in `app/index.tsx` and it is the ONLY copy that exists anywhere.

What it costs today: an iOS background memory kill, a crash, or any navigation that unmounts home destroys
a conversation the rider may have spent several BILLED turns building, with no way back. The screen
already bends around this — the account wall and the route card render inline, never `<AccountGate>` and
never `router.replace`, purely so home stays mounted. That is a real constraint on every future change to
that screen, and the kind that gets violated by someone who doesn't know why.

- [ ] #44 (mobile, low, founder) Revisit whether a middle ground exists that does not weaken INV-13 or D10. Sketches worth an hour,
      none endorsed: rehydrate the last PROPOSAL (a typed route object, not prose — arguably not rider
      content at all) so a killed app returns to "here's the drive we landed on" instead of a blank
      composer; or keep the transcript in memory across a *navigation* unmount (a module-level ref that
      dies with the process) which costs nothing and covers the common case, leaving only the OS-kill case
      lost. ⚠ Both need a founder call BEFORE building — the first stores something new, and "it's only
      the route object" is exactly the argument that erodes an invariant.

## PostHog telemetry — Stages 2, 3, 4

Stage 1 is SHIPPED (2026-07-17): the pure-JS PostHog base SDK wired at the root layout, giving product
analytics + **JS-level** crash autocapture + expo-router screen tracking + the root `ErrorBoundary`.
**Stage 2's code + EAS config are SHIPPED too** (native plugin, `uploadNativeSymbols`, the Metro wrap,
the EAS-secret upload key); only the founder-owned rebuild + verify remain.

- [ ] #45 (mobile, med, founder) **Native rebuild** — `expo prebuild --clean` + a fresh EAS/TestFlight build (a JS-only OTA won't
      link the native module or run the upload build phase).
- [ ] #46 (mobile, med, founder, device) **Verify on a RELEASE build** (not the `expo run:ios` dev client, which skips the upload phase):
      force a native crash, confirm a SYMBOLICATED report lands in the Skipper project.
      **⚠ Verification landmines — each one silently produces a false "it's broken":**
      1. **Detach the debugger.** A native crash reporter installs a signal/Mach-exception handler; an
         attached debugger intercepts the fault FIRST, so nothing is ever written. Launch the TestFlight
         build standalone, from the phone.
      2. **Relaunch after crashing.** The report is written during the fault and uploaded on the NEXT
         launch — the dashboard stays empty until you reopen the app. Don't call it a failure at step 1.
      3. **Force a REAL native fault, not a JS `throw`.** A JS throw is caught by the Stage 1 path and
         proves nothing about the native module.
      4. **Confirm BOTH upload phases in the EAS build log** (dSYM/native symbols AND the Hermes source
         map) before you even install — a missing phase means the report lands unsymbolicated and the
         crash looks like it never arrived.
      5. **Plain launch smoke test on iOS 26 / arm64e first.** ⚠ UNVERIFIED — from a research pass citing a
         PostHog issue I could not confirm against source; treat it as "spend 30s ruling out a launch
         crash," not as established fact.
- [ ] #47 (mobile, low) **EAS Update OTA caveat:** native symbols are fixed at build time, so after each `eas update` run
      `posthog-cli hermes upload --directory dist`. Wire into a release script only if OTA channels are
      used.
- [ ] #48 (mobile, low) **Stage 3 — session replay (opt-in, deferred).** `npx expo install posthog-react-native-session-replay`
      (consolidating into `@posthog/react-native-plugin` — follow the current install doc), set
      `enableSessionReplay: true`, keep masking at defaults (all ON). ⚠ Do NOT enable on Android without
      re-checking the known new-arch replay crash ("Cannot get a dirty matrix!").
- [ ] #49 (mobile, med) **Stage 4 — the funnel ends at `drive_started`, and the drive is the product.** The contract covers
      acquisition end-to-end — `planner_ready` → `plan_turn_sent` → `proposal_shown` →
      `preview_clip_played` → `wall_shown` → `signup_completed` → `drive_created` → `drive_started` — and
      then stops. **There is no event for a stop firing, a clip playing on the road, a stop skipped for
      missing audio, or a drive reaching its end.** So the measured part is everything BEFORE the thing the
      app exists to do, and the unmeasured part is RISK-1's part.
      ⚠ The specific blind spot worth closing first is the **silent skip**. `useDrive`'s clip-load effect
      advances past a stop with no uri after 400 ms and deliberately shows NO note. That is correct — it is
      `clip-store`'s job to make it impossible — but it means a store regression is invisible from BOTH
      ends: the rider hears silence and never learns a stop was there, and no signal reaches us. A drive
      that plays 3 of 11 stops is indistinguishable from a quiet stretch of road.
      ⚠ INV-13 constrains the shape, not the existence: counts and closed unions only — no place name, no
      coordinate, no drive id, no url. `{ stops_total, stops_fired, stops_skipped_no_audio }` at drive end
      carries the whole signal and names nothing.

## Location: When-In-Use → background updates (NO "Always")

The pre-permission **explainer** shipped 2026-06-13
(`docs/decisions/location-permission-priming.md`). The **background-updates** escalation — screen-off /
phone-in-pocket triggering (foreground `watchPositionAsync` dies on lock, so the drive holds the screen
awake via `expo-keep-awake`; if it ever locks, audio plays on but GPS triggering silently stops) — is a
build-ready spec: [docs/designs/background-location-spec.md](docs/designs/background-location-spec.md).

- [ ] #50 (mobile, med, device, blocked: real-device drive) Build it — but ONLY after a real-device drive shows foreground + keep-awake triggering is
      insufficient locked/pocketed (the founder's empirical gate). ⚠ This path is **When-In-Use ONLY, NOT
      "Always"**: a source-level read of the installed expo-location proved `startLocationUpdatesAsync`
      needs only foreground permission (expo PR #33617), so the review scope is the standard nav-app one.
      Work: transport re-architecture (→ a `startLocationUpdatesAsync` TaskManager task; adds
      `expo-task-manager`), flip `isIosBackgroundLocationEnabled` (KEEP the Always strings false; never
      call `requestBackgroundPermissionsAsync`), a copy tweak, review notes, and a native rebuild. Full
      checklist + source proof + gotchas in the spec.

## TTS audio — the two open ear-gates

The loudness mechanism shipped 2026-06-11 and both surfaces are mastered to the same spec (−14 LUFS /
−1.0 dBTP, `AUDIO_LOUDNESS` in `@skipper/shared`). Spec + history:
`docs/decisions/audio-loudness-spec.md`.

- [ ] #51 (studio, high, founder, device) **Founder on-device A/B vs Spotify** of the −14 / −1.0 level (narration + music together), before
      the first paid full regen. If it still reads low, nudge `AUDIO_LOUDNESS.integratedLufs` (−13/−12) or
      the TP ceiling further toward 0 — one edit, re-master both surfaces.
- [ ] #52 (studio, low, blocked: no non-story audio exists) **Differentiate the style prompt by narration FORM — DEFERRED 2026-06-19, and still correctly
      deferred.** The per-REGISTER half already shipped (`ttsStyleFor(baseStyle, register)`), so the one
      host already modulates his read by place type. The FORM half has **no output to ear-test**: `wave`
      was CUT and `break` (`detours`) is stubbed, so no non-story form emits audio to judge. When one
      does: extend the suffix by form (scenic = "slow a touch, leave air"; break = "quick light aside, no
      ceremony"), keeping the universal base and its load-bearing anti-fade clause. One-line swap at the
      call site. ⚠ Never re-tune blind — only on a specific founder ear-complaint.
- [ ] #53 (mobile, low, blocked: #51) **In-app narration volume trim — DEFERRED pending the −14 ear-gate.** Founder ask: an in-app control
      for narration volume independent of device volume. Decision 2026-06-11: nail the global target
      first and see whether a per-listener trim is needed at all. If it IS built, the conclusions are
      already settled so they aren't re-litigated: mechanism is expo-audio's `AudioPlayer.volume` (a
      per-player gain touching nothing else); **lean ATTENUATION-ONLY** (default = unity; notches only go
      softer — streaming services normalize to target and dropped user loudness boosts, so "push above
      −14" fights the work we just did). A bidirectional version needs clips encoded ~1.5 dB hot, which
      couples the notch values to the loudnorm target; true >unity boost needs a real gain node
      (AVAudioEngine / react-native-audio-api) — overkill for v1.

## Drive music bed — CONFIRM-ON-DEVICE it plays under V2 drives

A 2026-06-19 static trace found the bed **fully wired and it SHOULD play** — `useDriveMusic` is
live-wired into `useDrive`, which is what the V2 player mounts; no feature flag; `useAudioPlaylist` is a
real export in the installed expo-audio; and the gating opens audible windows in EVERY mode (between
stops `activeSeq` goes null while `driving` stays true). The "activeSeq gating may be the bug" guess was
DISPROVEN, and the two-player session suspect was ruled out in expo-audio's Swift source.

- [ ] #54 (mobile, med, device) **Confirm by listening.** Start a sim drive and confirm the bed fades in between stops and ducks to
      silence under each narration. If it's SILENT, the only residual static-unprovable risk is whether the
      two simultaneous expo-audio objects (narration `AVPlayer` + music `AVQueuePlayer`) actually MIX
      on-device vs one stealing focus. (Non-ear proof if wanted: temporarily log
      `useAudioPlaylistStatus(playlist).playing` and watch it flip true between stops.)

## Offline — what is left (founder ask 2026-07-31)

> ⚠ **Direction SETTLED by 1.1** — the offline store is re-keyed by narration SUBJECT ID and filled from
> the `DriveManifest` (spec step 9). The REGION PACK is **cut** (D21).

**A downloaded drive is already offline-complete and well-hardened — do not rebuild it.** Connectivity
awareness, manifest migration, and `repairDownload` all shipped 2026-07-30/31. ⚠ **Three landmines are
documented in `connectivity.ts` and must not be undone** (never call `getNetworkStateAsync()`; the
listener is registered once and never removed; it is armed from `index.js` ABOVE `expo-router/entry`) —
read them there, they are at the code.

- [ ] #55 (mobile, high, device) **Verify on a real device.** None of the offline work has run on hardware. Two specifics: a COLD
      LAUNCH in airplane mode (the listener arms at import, but home's `load()` may still beat the first
      pushed event — if it reproduces, the bounded fix is a one-time race against a ~250 ms delay inside
      the FIRST `fetchJson` only; ⚠ never an await on `getNetworkStateAsync`), and a real Tahoe drive
      running off a saved DRIVE download.
- [ ] #56 (mobile, med) **Mid-session signal loss still costs ~24 s of dead air per stop** for a clip the phone does NOT
      hold (3 s skeleton → 12 s stall → one futile recovery → 12 s stall → `onClipDone`), and `sawFresh`
      never flips so the progress pill stays at 0 — no evidence anything was even attempted. Unchanged for
      a rider who did not save the drive; a saved drive sidesteps it entirely.
- [ ] #57 (mobile, low) **Leftovers sit until the rider removes them** — a drive deleted on another device, a previous
      account's, or one this build can't read. And a drive missing from the server list can't be tapped
      into, so the per-drive Remove is unreachable. A Settings "free up space" line is the honest fix.
      ⚠ Context: `sweepUnknownDownloads` was built and REMOVED deliberately — if it were ever wrong the
      rider loses every saved drive silently, possibly right before Tahoe. Nothing deletes downloads
      automatically now except the account-erasure path (`deleteAllDriveDownloads`).
- [ ] #58 (mobile, low) **Better Auth's transport is deliberately NOT covered** (`src/lib/auth.ts` has its own fetch), so
      sign-in / sign-up / password-reset / delete-account get no offline line and no timeout at all —
      offline they hang on RN's untimed fetch, then print the generic line. Named as a non-goal rather
      than left silent; the fix is a custom `fetch` passed into `createAuthClient`.
- [ ] #59 (mobile, low) **Offline downloads re-pull EVERY clip, not just the changed ones** (post-MVP). Staleness detection
      is DONE — each stop carries a `revisedAt` token, the manifest embeds it, and the drive screen
      compares a fresh fetch (`isDownloadStale`) → a "Fresh cut ready" chip + a "Pull the fresh copy"
      action (never forced). A per-clip diff only matters once drives are large or strangers hold many
      offline.

## Upstream-contribution drafts for the active poi_overrides (agent drafts, human submits)

The three drafts are WRITTEN — [docs/guides/upstream-wikipedia-corrections.md](docs/guides/upstream-wikipedia-corrections.md)
(2026-08-03), each re-verified as still LIVE. Posture: **agent drafts, human submits** (WP:BOT + COI norms
rule out autonomous editing). ⚠ The three are **not equally filable** — Emerald Bay/Palme is the easy one
(the article contradicts its own cited footnote), Pope Estate is wrong in TWO places (the infobox `built`
date is outside the override's reach), and Chambers Lodge is drafted as a QUESTION because our source is
not a Wikipedia RS. Read the guide before filing.

- [ ] #60 (corpus, med, founder) **Human: review + file the three drafts**, then set each row's `upstream_status` → `filed`
      (+ `upstream_url`) in the admin console. ⚠ Filing does NOT retire the local override — the fix has to
      land upstream AND propagate through a re-fetch; the pipeline's unmatched-`find` warning is the signal
      to retire, and `active = false` is how (never a delete).
- [ ] #61 (admin, low) **Fix one row's `reason` in the admin console:** the Emerald Bay row argues from Wikipedia's
      Vikingsholm article naming the wrong architect, but that article names **no architect at all** (0
      occurrences of "Palme", checked 2026-08-03). ⚠ Also `vikingsholm.com`, that row's `source_url`, did
      not respond on 2026-08-03 — do not cite a dead link.

## "Tell me more" (the b-side) — generation BUILT + ear-checked, storage DECIDED, NOTHING persists

**State in one line: the two questions that could have killed this are both answered, and the feature is
still unbuilt on purpose.** Content risk retired by ear; storage decided against the spec's own
recommendation ([bside-gets-its-own-table](docs/decisions/bside-gets-its-own-table.md)). What is left is a
schema, a player, and a founder-gated paid run — in that dependency order.

Spec: [docs/designs/tell-me-more-spec.md](docs/designs/tell-me-more-spec.md). Read §8.0 before §8 — the
numbered build order was deliberately INVERTED and the numbered phases are the old order.

**What exists today.** `narrateDeeperCut` takes the same `NarrationRequest` that produced the main telling
plus a B-SIDE block naming the main script as material already spent, and `generate-bside-narrations.ts`
ranks live story stops by unspoken sheet material and prints the result. **It persists nothing.**
- ⚠ **`--apply` means something DIFFERENT in this CLI than in every other studio CLI**: on a script-only
  run the model CALL is the spend, so `--apply` means "make the calls", *not* "write to the DB".
- ⚠ Exhaustion resolves through an **in-band sentinel** (`DEEPER_CUT_NONE`) rather than an empty return,
  because `runNarration` THROWS on empty output — a quality invariant for the main telling that a b-side
  must not weaken, since both share the call.

**The measurements that bound the feature** (read-only, 421 live story tellings): ~52% of curated
`fact_sheet` facts are never spoken by the shipped clip, median 4/poi. Eligibility by unspoken material:
**92%** hold ≥1 fact, **64%** ≥300 chars, **47%** ≥500, **32%** ≥900. ⚠ **The threshold IS the budget
dial** — 269 / 198 / 135 eligible stops respectively — so "how deep a b-side has to be to earn its place"
and "what the corpus run costs" are the same decision, not two.

**The ear check ($0.13, founder go 2026-08-03)** sampled ACROSS the range via `--spread`: a 2,978-char
stop and the **corpus-median 446-char stop** both produced genuine b-sides; the 82-char and 0-char stops
**declined**. So the gate fires rather than pads, and the median case works.

⚠ **A b-side is NOT a gap-filler and must not be promoted to one.** Only **1 of 8** stops on a real drive
carries usable leftover, ~90 s added to 39 minutes, coverage 23% → 26%. It is a PULL rung you tap.

Owed, in dependency order — **nothing below is started**:

- [ ] #62 (studio, med) **⚠ RE-AIMED 2026-08-04 (prompt sweep): THIS DOES NOT BLOCK A CORPUS RUN, AND THE PROMPT NEEDS NO
      TWEAK — the item was built on a misquote of its own prompt.** It claimed the B-SIDE block "explicitly
      asks it to avoid" an acknowledgment open, and asked whether to tighten *"do not open by acknowledging
      the request"* or delete it. The block does not say that. It says: *"Do not open by acknowledging the
      request **with a stock line**… **One warm beat that lands as "since you asked" is plenty**, and it
      should sound like YOU, not like a menu."* So the observed Riverside line — *"Since you're curious
      about the man who drew all this"* — is precisely what the prompt PERMITS, and the §2 charm freebie is
      already deliberate. There is no contradiction to resolve and nothing to pick between.
      **The real concern survives and is STRUCTURAL: at 200 clips a permitted beat becomes the stamp**, each
      instance individually fine. ⛔ Do NOT fix that by editing this clause — the repo already measured the
      answer on the same failure in a lower-input form: *"Assigned, not BANNED… structure beats prohibition"*
      ([scenic-stops-spec §11.8](docs/designs/scenic-stops-spec.md)). Scenic fixed opener/closer monotony by
      ASSIGNING shapes round-robin on the queue index with a co-prime offset, and the machinery is exported
      and reusable as-is: `openingAngleFor` / `closingAngleFor` in `pipeline/narrate.ts`, applied the way
      `generate-scenic-narrations.ts` applies them. So this becomes a b-side GENERATOR task (assign the
      opening shape at build time), it is free, the feature is unbuilt so nothing needs regenerating, and it
      no longer gates the prompt.
- [ ] #63 (studio, med) **Widen the source to sheet AND extract (§2 correction).** §2 says curated sheet *or* the extract
      fallback; it should be both — **~277 median chars in `facts.extract` beyond the sheet on 373 of 421
      pois** — and a b-side has no two-minute budget forcing it to choose. Free, and it raises the eligible
      pool.
- [ ] #64 (corpus, med) **The table — create it in the SAME change that first writes to it.** Anchored to a poi XOR a
      cluster (mirroring `narrations`), NOT to a `narrations.id`, and `narrations_poi_uq` is NOT loosened.
      It must carry `attribution` (CC BY-SA is a legal floor), `facts_hash` (it grounds on the same sheet,
      so it goes stale with the main clip), `released_at` and the subject XOR as a CHECK.
      ⚠ **Ship the XOR test WITH the table, not after.** The exactly-one-subject rule will then exist in
      two tables, and "two copies of the same set drifting" is this repo's most-repeated bug class — the
      mitigation is one test pinning BOTH tables' XOR. ⚠ An empty table with no writer is the "constant
      with no production reader" trap; that is why this is deliberately not built yet.
- [ ] #65 (corpus, low) **The `'bside'` value in `narrationFormEnum` is HOMELESS** (`packages/db/src/schema.ts`,
      `packages/shared/src/enums.ts`). It was reserved for the rejected same-table design and can no longer
      legally be held by any row. Either retire it as reserved vocabulary (the `'wave'` precedent) or make
      it the new table's own form marker. **Pick one** — a live enum value nothing can hold is exactly how
      the next agent re-derives the rejected design. ⚠ Also stale once decided: `schema.ts`'s
      attribution-CHECK comment offers an "exemption if a fact-grounded scenic/bside ever ships", which
      assumes a b-side is a `narrations` row.
- [ ] #66 (corpus, low) **Do fused clusters get b-sides at all?** The XOR makes it possible; nobody has decided. Decide
      DELIBERATELY — "a new gate is blind to some subject kind" is a documented failure pattern here, and
      solo-vs-cluster is the axis that keeps getting missed.
- [ ] #67 (mobile, low) **Player: design for a button that COMES AND GOES.** At a "real telling" threshold the affordance is
      present on roughly HALF the corpus, so §10's "thin stop → button absent" is the common case, not the
      edge case. Rides the shared soft-clip path with
      [replay-last-stop-spec](docs/designs/replay-last-stop-spec.md).
- [ ] #68 (corpus, med, paid, founder) **💸 The corpus run — an OPERATOR PAID RUN, explicit founder go, and the commitment point.**
      Order-of-magnitude only, basis stated so it can be re-derived: the 31-clip fused run cost $16.70
      end-to-end for ~2-minute clips ≈ $0.54/clip; measured b-sides run 60–85 s, so roughly half that.
      **~198 clips at the ≥500-char threshold lands near $50–100.** ⚠ That is an ESTIMATE, not a quote —
      retake counts drive it, and the `--max-cost` tally has historically under-counted because synthesis
      re-rolls retakes. ⚠ Do the prompt tweak and the source widening FIRST; regenerating into a known
      defect buys the same defect at full price.

## Unfiled — four open questions with no section of their own

Each surfaced on its own (three while testing the planner against the corpus, one a founder question on
2026-08-04) and none belongs to the b-side spec above, where they had previously come to rest. Every item
below carries its own full context.

- [ ] #69 (corpus, low) **Two released clips about the SAME park, 200 m apart.** `Audrey Harris Park` exists twice in `pois`
      under two Wikidata QIDs — **Q49473201** (39.466388, -119.805833) and **Q107614151** (39.464735,
      -119.804440). Both narrated, both RELEASED, both road-snapped, both scenic-tier filler that says out
      loud it has nothing to say (*"A park. That's all I've got for you, folks"*). Found while testing the
      planner against the corpus; it is the only duplicated name among the 729 released tellings, which is
      how it surfaced.
      ⚠ **The existing colocation detector cannot see it.** `pipeline/colocation.ts` flags two QIDs on a
      **byte-identical** coordinate — deliberately, because a radius rule floods on genuinely adjacent
      places (Harold's Club and Harrah's Reno are 60 m apart). These differ by ~200 m, so they slip
      through. Do NOT "fix" that by loosening it to a radius without re-reading why it is exact.
      ⚠ A park's trigger radius is 1000 m (`radiusForKind`), so both sit in range of the same pass. Whether
      a rider would actually hear both depends on drive-select's spatial dedup + variety rules — **check
      that before deciding how urgent this is**; if dedup already suppresses one, this is corpus hygiene
      rather than a rider-facing defect.
      Fix is a judgement call between: prune one QID (`prune-corpus`), or detect the class first — a sweep
      for same-NAME pois within a few hundred metres would find siblings this one implies exist. Start with
      the count.

- [ ] #70 (corpus, low, paid, founder) **Three famous Tahoe passes sit OUTSIDE the region, and that is a boundary question, not a bug.**
      `Carson Pass`, `Hope Valley` and `Luther Pass` were drafted by `curate-places` and correctly dropped:
      the model knows they are Tahoe-adjacent, but they fall SOUTH of the `lake-tahoe` bbox
      (`-120.40,38.80,-119.55,39.65`), so bbox-restricted Autocomplete could not find them and returned the
      nearest in-bbox STREET instead — "Carson Court" for Carson Pass, "Hope Court" for Hope Valley. The
      address guard then refused the substitute. **Every link in that chain behaved correctly**; do not
      "fix" it by loosening the guard, which re-opens the gated-forest-road bug (143-minute drive,
      `docs/decisions/undrivable-endpoint-anchors.md`).
      Distances south of the edge: Carson Pass ~0.106°, Hope Valley ~0.039°, Luther Pass ~0.015°.
      ⚠ Those were measured against RECALLED coordinates — fine for Carson Pass and Hope Valley, but
      Luther Pass is ~1.7 km out and Strawberry ~200 m IN, so both could flip on real coordinates. Re-check
      before acting on either.
      The fix is to move the southern edge to ~38.68, which pulls in the whole CA-88/89 corridor and needs
      a fresh `discover` → `enrich` → `curate` for that strip — **a paid, corpus-wide change**. Deliberately
      NOT done on the eve of the 1.1 submission sweep for a handful of endpoints.

- [ ] #71 (corpus, med) **`Secret Cove` and `Strawberry` cannot enter `places` AT ALL — the first hard evidence for
      decoupling the planner from Google Places.** Neither has a Google entity inside the region. Secret
      Cove returns exactly ONE in-bbox candidate region-wide: "Secret Harbor Drive", a street ~30 km from
      the actual cove. Strawberry returns its road, then two hits for "Strawberry Point" at −120.339 — some
      17 km west of the US-50 hamlet at −120.139, a DIFFERENT Strawberry.
      `places.place_id` is `notNull`, so there is no row to write: these are not Places-shaped destinations.
      ⚠ This is the concrete case the decoupling argument was missing — see
      [corpus-as-the-planners-world](docs/designs/corpus-as-the-planners-world.md) and
      [what-is-a-drive-endpoint](docs/designs/what-is-a-drive-endpoint.md). Wikidata knows what is NOTABLE,
      Google knows where people GO, and neither set contains the other. Resolve the class, not these two.

- [ ] #72 (mobile, med, founder) **Should a drive be fully downloaded BEFORE it can start, the way Shaka Guide does?** (founder,
      2026-08-04.) Shaka gates the whole tour behind a download; we stream and fill the offline store from
      the `DriveManifest` opportunistically. Their rule trades a wait at the trailhead for never dropping a
      word in a canyon — and canyons are exactly where our stops are, so the failure it prevents is the one
      we would actually hit. **Answer the question, don't just copy the rule**: what does a Tahoe drive's
      audio weigh, how long does that take on a phone at the last bar of LTE before US-50, and does the
      current opportunistic fill already win that race in practice? Nobody has measured it.
      ⚠ Cheap to get wrong in BOTH directions. A blocking download in front of "Let's roll" is a wall in
      front of the one moment the whole app exists for; but a stop that arrives silent because the bytes
      were still in flight is the failure a rider remembers. A middle reading — block only until the FIRST
      few stops are resident, keep filling behind them — probably beats either extreme and is closer to
      what the store already does.
      ⚠ Re-read `docs/designs/offline-region-packs.md` first: only a drive's OWN manifest is authoritative
      for that drive, which is why there is no region pack. Whatever lands here must not quietly reintroduce
      one. The store itself is `apps/mobile/src/lib/clip-store.ts` (keyed by narration SUBJECT id).
