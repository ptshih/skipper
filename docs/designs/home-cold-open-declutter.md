# The home cold open — four CTAs and no primary

> **Status:** DESIGN PASS, 2026-08-03. **Not greenlit; nothing here is built by this doc.** Captured
> from three founder notes taken live against the shipped 1.1 home screen, measured on device
> (iPhone 17 Pro Max, dusk) at `5148063`. ⚠ **A second agent was mid-edit in
> `ExampleAsks.tsx`/`FilterChip.tsx`/`index.tsx` while this was written**, working note 2 by a
> different route (chip kept, `label` → `body` + `wrap`) — so read this as the COMPOSITION argument
> the element-level fix does not reach, and reconcile before either lands. Visual before/after mock:
> the published artifact (Trailhead 89 palette, real strings). Line numbers drift; the code wins.

## The three notes

Verbatim, in the order they arrived:

1. *"i don't really like the current mobile home screen... it feels cluttered"*
2. *"i feel like the suggested 'prompts' should be more subtle"*
3. *"the 'not near tahoe' cta also feels too prominent now that the chat is the main CTA"*

## The diagnosis — one inversion, three symptoms

**The composer is the primary action and is styled as the quietest element on the screen.**
`Input` renders a transparent field with an `inkFaint` placeholder behind a hairline `rule` border,
and `Composer`'s send disc sits at `opacity: 0.45` until the rider types (correct behaviour —
`canSend` gates a paid turn — but it means the resting state of the primary action is a dimmed disc
beside an empty outline).

Three *secondary* things are simultaneously drawn at button weight:

- **the example asks** — `FilterChip`, a 1.5pt pine keyline pill, `variant="label"` (Lora 600 ·
  12.5 · UPPERCASE);
- **the sample link** — `Button variant="ghost"`, which despite the name renders
  `variant="heading"` (Lora **700** · 17pt) in `accent`, centered. `ghost` removes only the
  *background*; it is not a quiet tier in this system;
- **the hero** — `display` (Zilla Slab 700 · 30) plus `RouteTrack glow`, the screen's one amber.

Four elements claim the same tier, so none of them leads. Every one of the three notes is a symptom
of that, which is why fixing only the chips would move the complaint rather than close it.

### Note 1 in detail — the clutter is textual before it is visual

Thirteen distinct blocks render before the rider does anything, and **four of them are separate
invitations to speak**:

| # | Element | String |
| --- | --- | --- |
| 1 | `voice.greeting` (hero) | "Hop in. I'll do the talking." |
| 2 | `voice.tagline` | "Narrated road trips — you pick the road, **I'll do the talking**. One corny guide the whole way." |
| 3 | `voice.plan.opening` | "Well now — where are we headed? A rough idea is plenty; I'll take it from there." |
| 4 | `voice.plan.composerPlaceholder` | "Tell me where to" |

⚠ **1 and 2 repeat "I'll do the talking" verbatim**, roughly 150pt apart — and `voice.ts` already
carries a comment asserting the kicker is "deliberately NOT repeating the tagline", so the intent
was there and the echo landed anyway between two *other* strings. 3 and 4 then ask the same question
twice more.

### Note 2 in detail — a selector primitive doing a prose job

`FilterChip`'s own header says what it is for: a segmented selector carrying "the short noun".
Handed a whole sentence, two of the three asks wrap to a second line, so the row renders as three
near-full-width outlined all-caps slabs. The all-caps half is the load-bearing defect: DESIGN §5
assigns `label` to "kickers, badges, section labels", and uppercase destroys word shape — which is
precisely the thing that lets a rider scan three sentences and pick one.

⚠ **Not a hit-target defect.** The pills measure 35pt visually, under §8's 48pt floor, but
`FilterChip` carries `hitSlop={12}` — a ~59pt target. The a11y frame reports the visual box only.
Recorded because measuring the screenshot suggests a violation that is not there.

## Proposed changes

| Element | Today | Proposed | Why |
| --- | --- | --- | --- |
| Example asks | `FilterChip` · pine keyline · `label` 12.5 UPPER | Sentence case · `dim` 13.5 in `accent` · leading caret · **one hairline rule binding all three** | Link tier, not button tier. The rule is the part that removes clutter: it turns three floating objects into one group hanging off the skipper's question. |
| Sample link | `Button variant="ghost"` · Lora 700 · 17pt · centered | `dim` 13.5, left-aligned; `accent` on the action clause only | It is a fallback, not a peer of the primary path. |
| Composer | transparent field · hairline `rule` border | `surfaceRaised` fill · `accent` border | The one **positive** move — lowering everything else still leaves the primary action passive. |
| `voice.tagline` | "…you pick the road, I'll do the talking. One corny guide…" | "Narrated road trips. You pick the road; one corny guide the whole way." | Kills the verbatim echo; keeps the only line that says what the product *is*. Its comment already flags wording as "a quick founder tweak". |

⚠ **Subtle means demoted a tier, never invisible.** `ExampleAsks`' header is right that this row is
the onboarding affordance on a screen whose only other move is an empty field. Pine `accent` is a
text role clearing 4.5:1 in both themes (DESIGN §4), so the caret + pine keeps the tap affordance
while dropping the shout.

## The constraint that bounds note 3

**Demote the sample link, but keep it above the fold.** Per
[sample-ride-postcard.md](../decisions/sample-ride-postcard.md) that clip is the only thing an App
Review tester in Cupertino — 200 miles outside the only curated corpus — can hear in one
permission-free tap, and `index.tsx` already comments that the conversation made it *more*
load-bearing, not less (the curated endpoints are Tahoe-only and there is an account at the end).
Moving it below MY DRIVES trades a review risk for a layout win. Quieter, same place.

## The bigger move, listed separately because it is behaviour

The screen **already has a compact mode**: `collapsed` drops the headline, the trail and the
tagline — the hero comment claims ≈180pt — but it is keyed to `riderTurnCount > 0`. So the layout is
at its loudest during the one moment the rider has the least to look at, and tidies itself only
*after* they have acted. Collapsing on first scroll instead would reclaim that space when it counts.

⚠ **`collapsed` is load-bearing beyond spacing** and must not be re-keyed casually: its comment
records that `RouteTrack glow` is the screen's ONE amber (DESIGN §8) and has to be gone before a
route card's amber MIN badge or the TypingDots appear. Any new trigger has to preserve that
ordering — collapsing on scroll does not obviously guarantee it, since a rider can send a turn
without scrolling. Unresolved here on purpose.

## Not done, and why

- **No code was changed.** Every implementation file for this proposal
  (`ExampleAsks.tsx`, `FilterChip.tsx`, `app/index.tsx`) had uncommitted work from another agent at
  the time of writing; a `Write` was rejected mid-pass because the file moved. The shared-tree rule
  says leave a mixed file to its owner.
- **Drive detail and the player were not reviewed.** Both sit behind `requireAccount` — the wall is
  `POST /drives` — so reaching them needs an account and a non-refundable credit. This pass covers
  the anonymous cold open only.
- **Daylight was not photographed.** The mock renders both palettes from the DESIGN §4 table, but
  only dusk was measured on device.
