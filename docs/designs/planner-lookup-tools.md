# Letting the planner look things up

> **Status:** 💡 **IDEA — not greenlit, nothing built (2026-08-04).** Sketches giving the live planner
> TOOLS it can call mid-turn instead of a bigger context block. ⚠ **One of the two tools proposed here
> was MEASURED AND KILLED during the sketch** — see *The corridor tool is dead*; the measurement is the
> most useful thing in this entry. Grew out of
> [what-is-a-drive-endpoint.md](what-is-a-drive-endpoint.md) (the planner's vocabulary is 103 curated
> endpoints while 729 released narrations sit in another table). Constrained by INV-11 (rider-triggered
> spend) and the "planner talks about WHERE, never WHAT" invariant.

## The problem it starts from

The planner's whole world is the curated endpoint roster — 103 rows. Measured against 40 places a Tahoe
visitor might plausibly name, 33 resolve. Of the seven that do not: three are genuinely outside the
region bbox (no corpus, correctly refused), one is an alias (*Squaw Valley* → Palisades Tahoe), and
three — **Sand Harbor, Rubicon, Vikingsholm** — are already in `pois`, **narrated and released**. We
have something to say about them and cannot route to them.

Two ways to close that: put more in the model's context, or let it ask.

| roster in the cached prefix | tokens | $/6-turn conversation |
| --- | --- | --- |
| today (103 endpoints) | ~1,500 | $0.013 |
| + 729 narrated POI names only | ~5,300 | $0.046 |
| + 729 narrated POIs with ids | ~12,700 | $0.112 |

A tool is paid for only when it fires: roughly **2¢ for a one-hop turn, ~5¢ at a three-hop cap**. So the
tool is cheaper than the fat prefix *unless the model reaches for it on most turns* — which is why the
hop cap has to be mechanical rather than a polite instruction in the prompt.

## What a tool loop breaks

⚠ **Today, one rider turn is exactly one model call, and every guard on this path is built on that.**
`PLANNER_MAX_TOKENS` bounds one call's output. The transcript caps bound one call's input. The rate
limiters price a request as one Opus turn. `logPlanSpend` fires once with that call's `usage`.

Add a loop and each of those quietly becomes a PER-HOP cap while the rider still makes one request — the
effective ceiling multiplies, and the cost line under-reports the turn it is supposed to police. That is
the "a paid run reports what it BILLED, not what it planned" failure with a new coat of paint.

So a loop is not a small change. It needs, minimally:

1. **`MAX_PLAN_TOOL_HOPS`** in `apps/api/src/limits.ts`, beside its siblings, because it is a SPEND
   control and not a UX knob. 2–3.
2. **A tally that sums every hop.** One `logPlanSpend` line per turn carrying the total, or one per hop
   with a turn id — but never just the last call's usage.
3. **A knowing decision about the rate limits.** A request now buys up to N turns. Either the numbers
   move or the multiplier is accepted on the record.
4. **Cancellation across the loop.** `signal` is threaded to one call today; a loop must abort between
   hops too, or a rider who leaves still buys the remaining ones.

## Tool 1 — `find_place` (SURVIVES)

The vocabulary fix, paid for only when someone names something off-list.

```
find_place({ name: string })
  → { known: false }
  | { known: true, narrated: boolean, routable: boolean,
      anchor_id?: string,        // present iff routable — the ONLY way a place enters a route
      nearest_routable?: { anchor_id: string, name: string } }
```

- **Pure DB, no vendor call.** The marginal cost of a hop is the MODEL, not the lookup.
- ⚠ **`anchor_id` is returned by the SERVER, never composed by the model.** INV-1 is untouched: the wire
  still accepts only curated endpoint ids and re-asserts `endpoint_eligible` at `hydrateAnchors`. The
  tool widens what the model KNOWS, not what it may route to.
- **`nearest_routable` is what turns a refusal into a redirect** — *"Sand Harbor, sure. I can run you up
  to the state park, same stretch of water"* instead of *"don't know that one"*. That single field is
  most of the felt value.
- ⚠ **Name matching is the hazard.** "Sand Harbor" matches both `Sand Harbor` (bay) and `Sand Harbor
  Beach State Recreation Area` (park). Resolution must be deterministic and must be allowed to answer
  AMBIGUOUS rather than pick — a tool that silently guesses between two rows is a worse liar than one
  that says it does not know.

## Tool 2 — a corridor pre-check (DEAD — measured 2026-08-04)

The idea was to let the model ask *"how much is there to say between A and B?"* before proposing, so it
could try another pairing instead of serving the 143-minute drive with two stories. **It does not work,
and the measurement is worth keeping so nobody rebuilds it.**

Released narrations within a buffer of the straight A→B line, against what the drives actually delivered:

| drive | 1 km | 2 km | 3 km | actually delivered |
| --- | --- | --- | --- | --- |
| Carson City → Spooner Lake | 3.06/km | **3.94/km** | 4.37/km | **2 stories** |
| Stateline → Emerald Bay | 1.44/km | 2.33/km | 3.22/km | 18 reachable |
| Tahoe City → South Lake Tahoe | 0.38/km | 0.62/km | 0.72/km | good |

**The worst drive scores best at every width**, so the tool would have actively steered the planner
toward the exact drive that prompted this work. A plain bbox count is no better — 65 for the bad drive
against 44 for the good one.

The reason is structural, not a tuning problem: **stop count is a function of the ROUTE, and the route is
not knowable without the billed Routes call.** Carson City is dense with corpus and the straight line is
short, so density reads high — while the real route ran 30 km up a fire road through empty forest, where
`nearestOnRoute` and the pacing rules find nothing. Any free pre-check is measuring the wrong geometry.

### What to do instead — the answer already exists, for free

`POST /drives/propose` **already** materializes the route, **already** runs the real
`selectStopsForRoute`, and **already** returns `estStopCount`. The card already printed **2 STORIES**.
The information was correct, on screen, before a credit was spent — and nothing reacted to it.

So the content-aware-routing goal does not need a tool, a loop, or a guess. It needs something to
*react* to a thin proposal that the real selection has already counted: the card saying so in the
skipper's voice, or the planner being handed the count on the next turn so it can offer a better
pairing. That is zero new model calls, zero new spend, and it uses the real selection rather than a
proxy for it. **It should be settled before anyone builds a tool loop, because it may be the whole
feature.**

## The streaming cost, which is not money

Text streams from the single call today, so a rider sees words almost at once. If a turn OPENS with a
tool call they get dead air until the hop returns — the SSE heartbeat holds the connection but shows
nothing. On a product whose whole promise is a man talking to you, that is felt. Worth measuring before
committing: if `find_place` typically fires on the turn where someone names an unfamiliar place, that is
also the turn they are most curious about.

## Open questions

- Should `find_place` be allowed to answer about places OUTSIDE the region bbox (Markleeville, Hope
  Valley)? Honest answer is "not my country yet" — but the tool could say that far more gracefully than
  silence.
- Does a tool result belong in the transcript the client re-sends? It must not (INV-13 — nothing is
  persisted), so a multi-hop turn's intermediate state is per-request only. Confirm that holds.
- Does giving the model 729 recognisable names — by prefix OR by tool — start it PROMISING stops the
  deterministic selection has not agreed to? The corridor tool's death removes the worst version of
  this, but `find_place` returning `narrated: true` still invites *"I'll tell you all about it"*.
  Returning judgments rather than names is the mitigation; it needs prompt work either way.
