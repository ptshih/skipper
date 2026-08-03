# The home cold open — four CTAs and no primary

> **Status:** DESIGN PASS, 2026-08-03. **Not greenlit; nothing here is built by this doc.** Captured
> from three founder notes taken live against the shipped 1.1 home screen, measured on device
> (iPhone 17 Pro Max, dusk) at `5148063`. ⚠ **A second agent was mid-edit in
> `ExampleAsks.tsx`/`FilterChip.tsx`/`index.tsx` while this was written**, working note 2 by a
> different route (chip kept, `label` → `body` + `wrap`) — so read this as the COMPOSITION argument
> the element-level fix does not reach, and reconcile before either lands. **The founder called the
> first pass "directionally better" and asked for outside research; §5–§6 are that second pass** — and
> the research produced one finding that argues AGAINST the first proposal, recorded as such rather
> than dropped. Visual mock of all three options: the published artifact (Trailhead 89 palette, real
> strings). Line numbers drift; the code wins.

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

## 5. What the outside research says

Two categories solve this exact problem — a blank input a user must fill — and they solve it
*differently*. Skipper currently sits between them. Sources at the foot of this doc.

- **Airbnb: the input IS the hero.** Their homepage `h1` is **28px/700 and sits BENEATH the search
  bar**, letting photography carry hierarchy; the search pill is **64px**, the largest element on the
  page. ⚠ **This is the exact inverse of Skipper today** — our display headline is 30pt Zilla Slab at
  the top and the input is 45pt at the bottom.
- **Airbnb: one hot colour, spent on the ACTION.** Rausch `#ff385c` is used scarcely (pages are "90%
  white + ink with one or two Rausch moments"); the 48×48 search orb is "the hottest single colour
  moment on the homepage". ⚠ Trailhead 89 has the identical rule (§8, one amber) — **but we spend
  ours on an ornament** (the parked rig's glow) and render the primary action in amber at 0.45
  opacity.
- **Airbnb: three tiers.** primary = filled · secondary = outlined · tertiary = plain text; their
  category chips are 14px/500, sentence case. **Our asks are drawn at SECONDARY tier when they are
  tertiary content** — that mis-tiering is note 2 in one sentence.
- **Chip guidance is explicit that a sentence is not a chip:** labels should be concise, and long
  labels "force the text to wrap". Two of our three asks wrap — the documented symptom.
  `FilterChip`'s own header already says it is built for "the short noun".
- **The AI-assistant convention we HALF-adopted.** Every major assistant ships an empty state of *a
  centred text field, a placeholder, and 4–6 suggested prompts* (ChatGPT, Claude, Gemini, Copilot,
  Cursor, Perplexity, Grok, Le Chat). **Skipper took the chips and left the centred field**, pinning
  the input to the bottom under a travel poster — so it carries the convention's clutter cost without
  its clarity benefit. ⚠ The same source calls that convention one that "solidified in 2023 without a
  real design phase" — a reason to adapt it, not to copy it onto a product whose doctrine is charm
  over scale.

### ⚠ The counter-finding — it argues against §"Proposed changes" above

2026 design literature **favours chips/buttons over plain text lists** for suggested prompts,
because chips carry better affordance signalling; and the empty state should offer **3–5 specific,
realistic prompts that demonstrate the RANGE** of the feature. Our three already do exactly that
(A→B · loop · open-ended). **So the first proposal's "dissolve the pills into text links" overshoots**
— keep three, keep them obviously tappable, demote the TIER and the type, not the affordance.
Recorded because it corrects this doc's own earlier recommendation.

## 6. Three options

| Option | What moves | Answers | Cost / risk |
| --- | --- | --- | --- |
| **A · Re-tier** | Nothing structural — type scale, colour, one fill | Notes 2 and 3 fully; note 1 only partly (block count unchanged) | Lowest; mostly a `variant` swap + the tagline edit. Collides with the in-flight agent's narrower version. |
| **B · Input as hero** *(recommended)* | Composer rises above the fold and grows; headline shrinks; the one amber moves to the send disc; tagline drops below MY DRIVES | All three, structurally — there is exactly one thing to do and it is the biggest element | Medium. Cold open and conversation become two layouts (the composer must fall back to a pinned footer once a transcript exists). ⚠ Moving the amber needs a founder call. |
| **C · Poster restored** | The conversation leaves home for a pushed full-screen surface; asks live inside it | Note 1 most decisively — home drops to five blocks | Highest, and adds a navigation hop before the rider's first word, which fights 1.1's thesis that *prepare is a conversation*. Kills the keyboard-covers-the-hero problem `Composer.tsx` already comments on. |

### ⚠ Option B moves the one amber, and that is an invariant, not a style

`index.tsx`'s hero comment records that `RouteTrack glow` is the screen's ONE amber (DESIGN §8) and
**must be gone before** a route card's amber MIN badge or the TypingDots appear — which is precisely
why `collapsed` is keyed to the first rider turn. If the glow moves to the send disc that ordering
argument has to be re-derived, because **the send disc does not disappear on the first turn**. Worth
doing; not worth doing quietly.

### The compact mode that already exists

`collapsed` drops the headline, the trail and the tagline (the hero comment claims ≈180pt) but is
keyed to `riderTurnCount > 0` — so the layout is loudest during the one moment the rider has least to
look at, and tidies itself only *after* they act. Option B effectively makes the cold open look like
the collapsed state from the start. ⚠ Re-keying it to first SCROLL instead does **not** obviously
preserve the amber ordering above, since a rider can send a turn without scrolling.

## Sources

- [Airbnb design-system breakdown](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/airbnb/DESIGN.md)
  — Rausch allocation, the 64px search pill + 48×48 orb, the three button tiers.
- [How Airbnb Designs Their UI (2026)](https://superdesign.dev/blog/airbnb-design-system) — the
  mobile collapse-to-overlay pattern, 48px minimum targets.
- [The death of the empty state in AI products](https://uxdesign.cc/the-death-of-the-empty-state-in-ai-products-2026-e11439fbb688)
  — the centred-field + 4–6 chips convention, and that it solidified without a design phase.
- [Designing AI chat interfaces](https://www.setproduct.com/blog/ai-chat-interface-ui-design) ·
  [Conversational UI patterns 2026](https://www.aiuxdesign.guide/patterns/conversational-ui) ·
  [Chatbot UX design](https://www.parallelhq.com/blog/chatbot-ux-design) — starter-prompt
  discoverability, the 3–5 range rule, the chips-beat-text affordance finding.
- [Chip UI design — Mobbin](https://mobbin.com/glossary/chip) ·
  [Chips — Material Design 3](https://m3.material.io/components/chips/guidelines) — concise labels;
  long labels force wrapping.

⚠ Airbnb's internals here come from a published third-party breakdown, not first-party docs. The
M3 chips page is JS-rendered and did not fetch; its guidance is quoted via the Mobbin summary and
search results, so re-check it before treating the wording as authoritative.

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
