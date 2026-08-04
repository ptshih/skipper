---
name: wrap-up
description: Use to write the plain-English summary that closes a task — what changed, what it means, and a scannable Next line. Invoke on demand for "explain that in plain english", "summarize this", "what does that actually mean", "what should I do next", or when CLAUDE.md's close-in-plain-English rule needs the craft behind it.
---

# Wrap-up

CLAUDE.md says a wrap-up opens in plain English and ends with the next step. This
is how. The rule is short because it lives in the ceiling-capped file; the
reasoning is here.

## First: does this rule even apply?

**It keys on DESTINATION, not on producer.** Ask where the message lands.

| Lands on… | Write it how |
| --- | --- |
| A human reading the session | Full treatment — plain English, then detail, then `**Next:**` |
| An orchestrating agent (you are a subagent) | The opposite: dense, structured, precise. No prose warm-up, no `**Next:**` line |

A subagent's final report is **data**, not a message — the orchestrator consumes
it and relays what matters. Prose written to warm up a machine reader spends
tokens on framing that gets discarded, and softens the precision the orchestrator
actually needs. Give it the terse structured block.

The relay is where the rule lands. When you are the one writing to the human —
including when you are summarizing five subagents' findings — that message gets
the full treatment, however dense the reports feeding it were.

⚠ The same skill produces both. `/sim-qa` run in the main session is founder-facing;
the identical report produced by a subagent is data. Don't key on the skill.

## Who you are writing for

When it *is* founder-facing: the founder, reading on a phone, deciding **what to
do next** — not reviewing your diff. They already trust that the code compiles;
`bun run check` says that. What they cannot get from the tooling is *what is now
true that wasn't before*, and *whether the ball is in their court*.

## The shape

Three parts, in this order, always:

```
<2–5 sentences of plain English — what changed, what it means>

<technical detail: paths, symbols, test names, commands>

**Next:** <one scannable line — or a short list if there are genuinely several>
```

The order is the whole point. The summary is what gets read; the detail is what
gets clicked; the **Next** line is what gets acted on, and it sits at the bottom
because that is where the eye lands last and stops.

⚠ **When a skill already prescribes a structured report block — `/ship`,
`/investigate`, `/sim-qa`, `/docs-drift` all do — that block IS the middle
layer.** Keep it verbatim. Do not melt it into prose: a fielded block is already
scannable, which is the entire goal here. Wrap it, don't rewrite it. What those
blocks were missing was never structure — it was the sentence above and the ask
below.

## The Next line

It goes **last**, on its own line, with the literal `**Next:**` label every time.
Consistency is the feature — a scannable report is one where the reader's eye
knows in advance where to land.

- **One action, stated as an action.** "Run `bun run check` before you push" — not
  "verification is pending."
- **Name who acts.** If it needs the founder specifically (a paid-run go, a device
  pass, a decision), say so. If an agent could do it, say that instead.
- **Say "nothing" out loud.** `**Next:** nothing — this is done.` An absent Next
  line reads as a forgotten thought, not as a finished task.
- **Several steps → a short list, ordered.** Cap it at three. More than three
  means the work isn't as finished as the summary claims.
- **Never bury it.** A next step inside a paragraph has been buried, no matter how
  clearly the sentence is written. That is the specific failure this rule exists
  to stop.

## The one rule that does the most work above it

**Never let a path or a symbol name carry the explanation.**

A path like `apps/api/src/planner.ts` is an address, not a fact. `requireAccount`
is a label for an idea, not the idea. Both are useful — as the detail *beneath*
the summary, for clicking into. Neither tells a reader what is different now.

Test each sentence: if the reader didn't already know the codebase, does the
sentence still say something? If not, rewrite it in terms of what a person
experiences.

## Worked example

**Before** — accurate, and tells the founder nothing:

> Moved `requireAccount` off the `driveRoutes.use('*', …)` mount to per-route.
> `POST /drives/plan` and `POST /drives/propose` now resolve `accessTier` via
> `tierOf` without a session assertion. Added coverage in
> `apps/api/test/anchor-allowlist.test.ts`. Should be good to push when you get a
> chance, though I'd re-run the suite first.

**After** — same facts, reordered around the consequence, with the ask pulled out:

> Signed-out riders can plan a drive again. The account check had been sitting on
> the whole `/drives` group, so it was also walling off the two steps that are
> meant to be open — sketching a route and pricing it. It now sits on each route
> that genuinely needs an account, so the wall lands where it should: at "Make
> this drive."
>
> Detail: `requireAccount` moved off the `driveRoutes.use('*')` mount; coverage in
> `apps/api/test/anchor-allowlist.test.ts`.
>
> **Next:** you push when ready — a push deploys the API at 100% with no canary.

Nothing was deleted. The detail stopped pretending to be the summary, and the ask
stopped hiding at the end of a sentence about something else.

## Anti-patterns

- **Next step buried in prose.** The one this rule was written for. "…though I'd
  re-run the suite first" is an instruction wearing a clause's clothing.
- **Diff narration.** "Added a helper, updated two call sites, adjusted the test."
  That's what you did, not what changed. Nobody can act on it.
- **Jargon the reader didn't use first.** If the founder said "the preview," don't
  answer about "the unauthenticated `/drives/plan` path."
- **Burying the bad news in the detail.** Anything that failed, got skipped, or
  went unverified belongs in the plain-English part, in a full sentence. This is
  the same instinct as *"a run that did nothing must not settle GREEN"* — a
  wrap-up that reads clean while something is broken is the prose version of that
  bug.
- **Hedging into vagueness.** "Should be working now" is worse than either "I ran
  it, it passes" or "I couldn't verify this — here's what to check."
- **Length.** Three to six sentences before the detail. If it needs more, the task
  probably needs a `docs/` entry and the wrap-up should point at it.

## Checklist

- [ ] **Gate:** this message lands on a human. (If it lands on an orchestrator,
      stop here — ship the dense structured block instead.)
- [ ] First sentence states an outcome a non-engineer could repeat.
- [ ] No sentence's meaning depends on knowing a file path or symbol name.
- [ ] Anything unverified, skipped, or failed is stated plainly, not implied.
- [ ] Technical detail is present, between the summary and the Next line.
- [ ] A `**Next:**` line is the last thing in the message — including when it says
      "nothing."
