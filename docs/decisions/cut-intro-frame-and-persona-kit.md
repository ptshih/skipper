# Cut the intro/outro frame and the "cousin Ray" personal kit

> **Status:** DECIDED + DONE 2026-06-19 (founder), recorded here 2026-07-27. Two linked removals: the
> placeless intro/outro **frame** (its `asides` storage dropped in migration `0019`, commit `5ca12d3`)
> and the **persona kit** the frame housed (`8d48d1f` — `SKIPPER_FRAME_PROMPT`, `PersonaDef.kit`,
> `KitBeat`, and the kit diversity-lint, net −100 lines). This entry is **backfilled**: the calls were
> made and shipped in June, but the only durable record was a TODO item marked delete-when-done, so the
> rationale was one deletion away from being lost. Written while de-staling the specs that still assume
> both features exist.

## What was removed

**The frame** — a placeless intro/outro pair that bookended a drive: a "welcome aboard, here's the
region" opener and a warm sign-off, neither anchored to a POI. It went through two homes and lost both:
`tour_brackets` → `tour_frames` → the shared region-owned `asides` table, which migration `0019` then
dropped outright as part of geometry-first regions. Nothing placeless survives in v2 — between-story
texture is the PLACED `break` (Places-anchored) and `scenic` forms, which have real coordinates.

**The kit** — the host's small stock of personal-life running gags ("cousin Ray," the "Tuesday"
mechanic), modeled as `PersonaDef.kit: KitBeat[]` with a matching diversity-lint that watched for
overuse. The kit's *only* sanctioned home was the intro, and it was explicitly **banned from stops**.

## Why

1. **The kit outlived its only home.** Once the frame was deleted the kit had nowhere legal to appear:
   it was defined, then banned from every surface that still existed — the stop prompt re-stated the ban
   roughly eight times for zero upside. Dead weight that still cost prompt budget.
2. **It was actively leaking.** The founder flagged off-persona jokes in stops; a kit that is defined in
   the prompt and forbidden everywhere is an attractive nuisance — the model reaches for a backstory
   beat it was handed. Removing the definition removed the temptation. The replacement is a single
   generic rule: the host invents **no backstory** (`packages/studio/src/persona/skipper.ts`).
3. **The frame fought geometry-first regions.** A placeless row has no coordinates, so it could not be
   selected, ordered, or triggered by the same geometry the rest of the system runs on. Every design in
   the specs worked around that with sentinel sequence numbers (`INTRO_SEQ`/`OUTRO_SEQ`,
   `frameKindForSeq`) — machinery that existed solely to smuggle a placeless item through a
   route-anchored queue. All of it is gone; `useDrive` queues only route-anchored place narrations.
4. **It duplicated what the persona already does.** "Meeting the host" is delivered continuously by one
   consistent voice across every stop, not by a bookend.

## What this invalidated

Both features were load-bearing in a lot of *deferred* design work, which is why this entry exists. As
of 2026-07-27 nine specs referenced one or both as if live; each now carries a dated note pointing here:

| Spec | What was stale |
| --- | --- |
| `tour-structure-spec.md` | its own status line called §4's **persona kit** "still load-bearing"; §3 is the frame's original table design |
| `ask-the-skipper-spec.md` | §11 instructs inheriting "the personal-kit rules" verbatim; two "cousin Ray" lines in user-facing copy |
| `downtime-callouts-spec.md` | "kit BANNED (the persona kit's only home is the intro)" as a live guard |
| `drive-thesis-spec.md` | the plant→land arc rides the frame (already marked v3-deferred) |
| `scenic-stops-spec.md` | "intro/outro need no scenic anchor" (already reconciled inline) |
| `tell-me-more-spec.md` | `narrateIntro`/`narrateOutro` cited as live siblings of `narrateStop` |
| `skipper-opinions-spec.md` | "Kit stays banned outside the…"; `personaForRegion` + `PersonaDef.kit` |
| `free-roam-alpha-spec.md` | records the shipped "kit ban" lint as a live retake guard |
| `admin-ops-console-spec.md` | a kit-overuse heat strip reading `persona.kit.beats[].match` |

The specs' **bodies were deliberately left intact.** They are deferred designs, not instructions to
follow today; rewriting them would destroy the original reasoning while creating churn in documents
nobody is building from. A dated header note is the house pattern and is enough.

## If the intro comes back

It is a legitimate charm idea — "meet your skipper" is a real welcome beat, and the founder has flagged
it as a possible win rather than a mistake. But **spec it fresh**, don't revive these designs:

- There is no placeless storage. v3 guided tours would have to reintroduce a table, and the sentinel-seq
  mechanism to ride the player queue, from scratch.
- Do **not** bring the kit back with it. The kit is a separate call and it failed on its own merits
  (leakage, prompt cost). A welcome beat can be warm and in-voice without inventing a cousin.
- The current host is one voice at one fixed delivery; per-region hosts are the deferred region-skippers
  (M4). An intro that says "meet your skipper" implies an identity the v2 model does not yet vary.

Related: `cut-joke-notch.md` (same 2026-06-19 simplification pass — one delivery voice, variety returns
as different narrators), `geometry-first-regions.md` (why placeless lost its home).
