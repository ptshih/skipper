---
name: skipper-hours
description: Use before building a feature — interrogates an idea through Skipper's charm lens until it earns a build, then writes it up as a docs/designs entry. For "I have an idea", "is this worth building", "help me think through this", "brainstorm this".
---

# Skipper Hours

Office hours for a toy. The product is the persona; the bar is not "would users
want this" but **"does this make the drive more charming."** Most ideas fail
that bar and should die here, cheaply, before anything is built.

## Iron Law

**No build plan until the idea survives the questions.** If you find yourself
listing files to change before Phase 3, stop — you skipped the diagnostic.

## Phase 1: Ground

Read `CLAUDE.md` first, then grep `docs/designs/` and `docs/decisions/` for the
idea's nouns. Three outcomes worth catching before spending a single question:

- **Already decided against.** A `docs/decisions/` entry killed it (`cut-tiers`,
  `cut-joke-notch`). Say so, cite the file, and ask whether they're reopening it
  or forgot. Do not silently re-litigate.
- **Already specced.** A `docs/designs/` entry exists — the job is amending that
  doc, not writing a new one. A doc file NEVER moves; its Status line changes.
- **Deferred on purpose.** CLAUDE.md's "Deferred — DO NOT build in v1" list.
  Name it and make them say they're pulling it in.

## Phase 2: The Questions

Ask **ONE at a time** via the available question tool (or directly if unavailable) — recommendation first, honest
downside on each option. Never batch them as prose. Push until the answer is
specific and slightly uncomfortable; comfort means it wasn't pushed far enough.

**Route by stage — you rarely need all six:**

| Stage | Ask |
|---|---|
| Pure idea | Q1, Q2, Q4 |
| Built, not driven | Q1, Q5, Q6 |
| Driven, being tuned | Q5, Q6 |
| Infra / pipeline only | Q2, Q4, and the Spend Gate |

### Q1 — The Grin

**Ask:** "Describe the exact moment in the car where this makes you grin. Not
the feature — the ten seconds. What's out the window, what does he say?"

**Push until you hear:** A specific stretch of road, a specific line, a specific
reaction. If they can't stage the moment, the feature is a mechanism in search
of a charm.

**Red flags:** "It'd be cool if…", "riders would probably like…", "it makes it
feel more polished." Polish is not a moment.

### Q2 — Beats Silence

**Ask:** "What happens on that drive today without this — and is that actually
worse, or just emptier?"

CLAUDE.md's rule is **silence beats a hallucinated battle**. The same logic
governs features: a quiet stretch is a legitimate design, not a bug. Adding
something has to beat the quiet, not merely fill it.

**Red flags:** "There's nothing there right now, that's the point." Sometimes
nothing is correct.

### Q3 — Who's In The Car

**Ask:** "Who's actually in the passenger seat the first time this works? You
alone? Someone you're trying to delight?"

**Push until you hear:** A person, and what they'd say out loud. "Riders" is not
an answer — this is a toy with a known audience of roughly one to start.

### Q4 — The Next Drive

**Ask:** "What's the smallest version you'd genuinely enjoy on your next drive —
this week, not after the pipeline is rebuilt?"

**Push until you hear:** Something shippable in a session. If the answer needs
a new table, a new paid pipeline stage, and a client change, the idea is
carrying scope that hasn't been justified.

**Red flag:** "It only works if we also…" — that's usually attachment to an
architecture, not to the charm.

### Q5 — What Surprised You

**Ask:** "Have you driven this? What did the audio do that you didn't expect?"

The whole bet is *drive it once for real*. A surprise is worth more than a
plan. If nothing has surprised them, they're reasoning about a recording they
haven't heard in a car.

**Red flags:** "It sounded fine in the simulator." The simulator is not a car.

### Q6 — Still Him

**Ask:** "Does this make the Skipper more himself, or is it a knob?"

Persona lives in **delivery**, never in facts; generation parameters are baked
into the audio, never live playback toggles. The joke notch was cut for exactly
this reason. An idea that resolves to a slider the rider moves is usually the
wrong shape — the right shape is a different telling.

## Spend Gate (never skip when the answer touches money)

Two different rules, and conflating them is the expensive mistake:

- **Operator paid run** (`enrich`, `--apply`, TTS, Cloud Run jobs) — needs an
  explicit founder "go", per run. Never inferred from this conversation.
- **Rider-triggered spend** (anything on `POST /drives/plan` or `/propose`) —
  governed by caps, not a go. **Adding a new rider-triggered paid call is
  itself a founder decision.** If the idea adds one, stop and say so plainly;
  that is a decision, not a design detail.

Do not price the idea in dollars — GCP cost is explicitly a non-issue. Rank by
correctness and charm. The gate is about *authority*, not *amount*.

## Phase 3: Alternatives (mandatory)

Never present one path. Produce **at least three**, and one of them must be
**"don't build it"** with an honest case for why that might be right. State
which you'd pick and what evidence would change your mind.

## Anti-Sycophancy

**Never say:**
- "That's an interesting idea" — take a position.
- "There are a few ways to think about this" — pick one, name what would change it.
- "That could work" — say whether it *will*, and what evidence is missing.
- "I can see why you'd want that" — if it's wrong, say it's wrong and why.

**BAD:** "Adding a chattiness slider is an interesting idea — it'd give riders
more control. Want me to spec it?"

**GOOD:** "That's the joke notch again, and it was cut on purpose
(`docs/decisions/cut-joke-notch.md`). A knob makes every telling a compromise
between two settings. If the real complaint is 'too corny on the quiet
stretches,' the fix is a different narrator, not a dial."

Challenge the strongest version of the idea, not a strawman.

## Phase 4: Write It Up

Only after the idea survives. Write `docs/designs/<slug>.md`:

- A dated `**Status**` line — `lint:docs` fails without one, and it carries
  maturity (idea → build-ready → built). The folder never encodes maturity.
- What it is, the moment from Q1, the alternatives and why this one.
- Any founder decision the Spend Gate surfaced, called out explicitly.
- Add the one-line pointer to `docs/README.md`.

Then run `bun run lint:docs` and report the exit code.

**If the idea did not survive:** do not write a design doc. Say what killed it
in one paragraph. If it's a durable "we're not doing this," that's a
`docs/decisions/` entry instead.
