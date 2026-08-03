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

### The two reference apps the founder pointed at (2026-08-03)

**Navan Edge** (business-travel assistant) and **Mindtrip** (consumer trip planner). Both are
assistant-first travel apps solving the identical cold-open problem, and they disagree in one
instructive way.

- ⚠ **THE INSIGHT NEITHER MY OPTIONS NOR THE FIRST RESEARCH PASS NAMED: Skipper's app home is built
  like a LANDING PAGE, and Skipper already has one.** Poster hero + kicker + display headline +
  a tagline explaining what the product is — that is `apps/site`'s job, done at skipper.fm where it
  converts strangers. In the app it re-sells someone who already installed. Navan's and Mindtrip's
  app homes carry no poster because their marketing lives on their marketing site. This is the
  strongest argument for D/H/I and it did not come from taste — it came from looking at two apps.
- **Navan: suggestions are ROWS, not chips** — thumbnail · short bold title · dim subtitle · chevron,
  uniform height. **The title is short ("Plan & book a trip") and the SUBTITLE carries the
  specificity.** That is the fix for note 2 that neither pills nor text links gave: nothing wraps,
  nothing shouts, the range stays legible. ⚠ And it is a PRESENTATION change only — those rows look
  like navigation but behave like starter prompts, which is exactly what `pickExample` already does
  (seeds both halves, no model call). Unlike option F it does **not** reopen the picker decision.
- **Navan: one saturated colour, on the send button.** Second independent confirmation of Airbnb's
  orb finding.
- **Mindtrip: the QUESTION is the hero, and the composer stays a hairline field.** "Where to today,
  Elsa?" is the biggest text on screen. ⚠ **So there are TWO valid answers to "what is the one loud
  thing" — the input (Airbnb, Navan) or the question (Mindtrip)** — and both work because in each
  case exactly one thing is loud. Skipper does not have to grow the composer; it has to stop three
  other things shouting over it. Note that `voice.plan.opening` is already the perfect hero line and
  currently renders at `body` 16pt *beneath* a `display` 30pt headline saying something else.
- **All three leave a third of the screen empty.** Skipper fills it with a divider, a kicker and an
  empty-state card. "Cluttered" is often just the absence of rest.
- ⚠ **What must NOT be copied from Mindtrip: browsable place cards.** Its empty state is real content
  ("Your Location", restaurant photos, heart/+ actions). Three reasons that is wrong here: it spoils
  the ANTICIPATE beat the planner manufactures by deflecting place questions; our place imagery is
  Wikipedia-sourced **CC BY-SA with an attribution obligation**; and a browsable grid of curated
  places **re-creates the endpoint picker 1.1 deleted** — that curated set is the planner's
  server-side allowlist, not a catalogue. Navan's warmth likewise comes from photography we cannot
  cheaply or safely reproduce; the enamel badge (DESIGN §9's deferred SVG set) is the on-brand
  substitute.
- ✅ **Navan resolves the sample-link constraint by accident:** it puts its footnote ("Built for
  business travelers") *under* the pinned composer — tiny, centred, dim. Because the composer is
  pinned, that slot is always visible without scrolling, so the sample link can sit there and be
  **both demoted and above the fold**, which is exactly what App Review needs.

⚠ Sourcing note: `mindtrip.ai` serves their MARKETING site at that URL — the in-app screen is not
publicly fetchable and was read from a founder-supplied screenshot. Navan likewise from a screenshot.
Treat both as observed, not documented.

### Widening the scope beyond travel (founder ask, 2026-08-03)

The sharpest source in the whole pass argues that the pattern Skipper half-adopted **is itself a
design failure**, and its top recommendation is something Skipper already owns and has buried.

- ⚠ **"A prompt box violates recognition by definition. The user is asked to recall what the product
  can do, in their own words, before they have seen what the product can do."** And on the convention
  as a whole: *"We called this minimalism. It isn't minimalism. It is the absence of design."*
  Leviim's alternatives in his own order: **worked examples** (show an actual answer, don't ask for a
  question) · **starting verbs** ("Create your first issue", not "Ask me anything") · **exposed
  limits** (name what it cannot do) · **action before speech**. He holds up Notion and Linear —
  2019-era products — as better designed than every 2023+ AI app.
- ★ **THIS INVERTS NOTE 3, and resolves it better than demoting does.** Recommendation #1 is a WORKED
  EXAMPLE, and **Skipper owns the perfect one while ranking it below three pills as a ghost text
  link**: `GET /sample`, one curated Tahoe clip, permission-free, one tap — the product's actual
  output. **For an audio product whose entire value is a voice, an empty state that asks you to type
  is backwards.** The fix for "too prominent" is therefore NOT to shrink it: it is to stop it being a
  fourth *text CTA* and make it the one piece of real *content* — a small playable card. Different
  object class, so it stops competing; and the rider hears the skipper before being asked to talk to
  him. This is the most on-doctrine idea in the pass ("the persona is the product").
- **Exposed limits, in persona.** Riders WILL hit the Tahoe-only corpus. Today it surfaces as "Not
  near Tahoe? Hear a quick sample" — a fallback offered before the boundary has been named. Naming it
  is warmer and more honest: *"I only know the roads around Lake Tahoe so far."* It also sets the
  sample up naturally instead of making it an apology.
- **Starting verbs sharpen option H.** Linear's "Create your first issue" and Navan's "Plan & book a
  trip" are VERBS; Skipper's asks are sentences. H's short titles should be verb-shaped ("Drive
  somewhere", "Take a loop", "Let me pick") with the literal utterance as the subtitle.
- **Notion gave its assistant a character deliberately** — it hired an animation studio to turn its AI
  "from a static drawing into a fluid, dynamic character". The best non-travel precedent for a product
  whose doctrine is *the persona is the product*; and Skipper's character is AUDIBLE, a stronger asset
  than Notion's.
- ★ **VOICE INPUT is the one real capability gap.** 2026 voice-first guidance is a persistent mic in
  the PRIMARY action bar, not a buried icon; Mindtrip's composer carries a waveform beside send.
  Skipper's composer is **typing-only** — in a car, for a persona you talk to, where `Composer.tsx`
  says it is "sized for a thumb in a parked car" and DESIGN §8 is *big thumbs, gloves, potholes*.
  ⚠ **Out of scope for a declutter pass** (a new capability needing a real evaluation of on-device iOS
  speech recognition), but recorded so it is not lost — it is the highest-value thing the widened
  research surfaced.

⚠ **Sourcing honesty on the one number here.** Leviim's "~70% of installs never return for a second
session, with the empty state the single biggest reason" is **self-reported data from his own Chrome
extension**, not industry research, and the causal attribution is his inference. Good argument, not
evidence. I also went looking for real click-through rates on suggested prompts and **found none** —
the analytics literature confirms such taps are tracked but publishes no rates. So **"do riders
actually tap the asks?" is an open question PostHog could answer**, not something the research
settles.

## 6. Nine options

Founder asked for a wider set (2026-08-03). They separate on **two axes**, and everything else is a
flavour of one of these:

1. **How much poster survives the cold open** — the hero is FOUR stacked blocks (kicker · headline ·
   trail · tagline). Keep all four / compress to one object / delete and let the skipper's voice carry
   the explainer.
2. **What the rider's entry point IS** — a live FIELD on home (A, B, D, E, G), a TAP-THROUGH to a
   dedicated surface (C), or a GUIDED CHOICE with typing as fallback (F).

| Option | Entry | Poster | Answers | Cost / risk |
| --- | --- | --- | --- | --- |
| **H · Assistant home** *(Navan)* | field, bottom | watermark only | **all three**, and note 2 by a route neither pills nor links gave | Medium. Needs one row component (or a restyled `StopList`) + three short titles authored. ⚠ Moves the amber. ⚠ The asks must be re-authored as title + subtitle. |
| **I · Question is hero** *(Mindtrip)* | field, bottom (quiet) | none | **all three**, and cheapest of the leaders | Low-med. Largely a swap of which line gets the `display` slot. ⚠ Sidesteps the amber problem entirely (no glow on the cold open). ⚠ Deletes the poster from the front door. |
| **A · Re-tier** | field, bottom | all four | notes 2+3 fully, 1 partly | Lowest — a `variant` swap + copy edit. ⚠ Collides with the in-flight agent's narrower version. |
| **G · One object** | field, bottom | compressed to one `Card framed` | note 1 cheaply; needs A for 2+3 | Low; reuses an existing primitive on a surface the system already permits it. ⚠ Ornament at small size fights DESIGN §2 — needs an eye. |
| **B · Input as hero** | **field, HERO** | headline only, shrunk | all three, structurally | Medium. Two layouts (composer falls back to a pinned footer once a transcript exists). ⚠ Moves the amber — founder call. |
| **C · Poster restored** | **tap-through** | all four | note 1 most decisively (home → 5 blocks) | High. Adds a hop before the rider's first word; fights 1.1's *prepare IS a conversation*. Does kill the keyboard-covers-hero problem `Composer.tsx` comments on. |
| **F · Guided first** | **guided choice** | headline only | all three; best for a first-timer with nothing to say | High + strategic. ⚠ **Reopens a settled 1.1 decision** — the pickers were deliberately deleted — and narrows the ask to three shapes when free text is the planner's whole point. |
| **D · Straight in** | field, bottom | **none** | all three; biggest reduction that keeps the conversation immediate | Medium. ⚠ Deletes the WPA poster from the front door — DESIGN.md's entire identity claim. The persona absorbs the explainer ("Narrated road trips, folks — you pick the road, I do the talking"), which is either the charming answer or the loss of the one poster-shaped screen. |
| **E · Poster once** | field, bottom | **first launch only** | note 1 for everyone past launch 1 | Low-med; one persisted flag, re-keying `collapsed` off `riderTurnCount`. ⚠ Makes the screen the founder reviews rarely the screen most riders see. |

### THE RECOMMENDATION

**I + H's suggestion rows + the worked example + §7's move.** (Moved from B, then B+E, as the
reference apps and the non-travel research landed; the earlier "hoist MY DRIVES above the planner"
clause is SUPERSEDED by the founder's §7 ruling and must not be re-proposed.) Six changes, in
dependency order:

1. **Promote the question.** `voice.plan.opening` takes the `display` slot; the headline, the trail
   and the tagline blocks are deleted (**I**). The poster survives as a sunburst watermark. This alone
   removes most of note 1, and the duplicate "I'll do the talking" goes with it.
2. **Re-shape the asks as rows** — short VERB title + the literal utterance as subtitle, uniform
   height, chevron (**H**). Presentation only: `pickExample` already seeds both halves with no model
   call, so this does not reopen the picker decision.
3. **Promote `GET /sample` from a ghost text link to a small playable card** — the WORKED EXAMPLE the
   research puts first. It answers note 3 better than demoting does (different object class, so it
   stops competing as a fourth text CTA), and it is the only way a newcomer experiences the product
   without first inventing a prompt. For an audio product, letting them hear the skipper should
   outrank asking them to type at him. Pair it with the limit named in persona ("I only know the roads
   around Lake Tahoe so far") rather than offered as an apology.
4. **Move MY DRIVES to `app/drives/index.tsx`, gated on `signedIn`** (§7, founder-decided). The entry
   point is the header-LEFT slot, which is already conditionally empty for signed-in riders — zero new
   chrome.
5. ✅ **Purge downloads on SIGN-OUT, not only on account deletion.** This is what makes step 4's
   premise — *drives belong to a specific user* — true on disk rather than only in the UI. Without it
   a signed-out rider's drive dirs sit on the phone unreachable by any screen and unreclaimed by any
   sweep (`sweepOrphanClips` keeps every drive dir regardless of owner), and the offline fallback
   still lists them to whoever signs in next. `deleteAllDriveDownloads()` already does exactly the
   right thing — including clearing the shared clip store, the half that is easy to get wrong, since
   every megabyte of audio lives in `clips/`, a SIBLING of `drives/`. **One new call site.**
   ⚠ Ship it in the SAME change as step 4: step 4 removes the last surface that made those files
   visible, so shipping 4 without 5 converts a visible leftover into an invisible one.
6. **Keep the offline inversion as a `signedIn` branch** (§7): offline + signed in renders the drives
   list inline on home exactly as today; offline + signed out gets the outage card alone, which is
   correct once 5 has run.

That combination answers all five notes and **needs no new colour decision** — I keeps the cold open
glow-free, so the one-amber invariant below is never touched. **E remains a cheap add-on** if the
founder wants the full poster on the very first launch for App Review's benefit.

⚠ **Not in the recommendation, deliberately:** voice input on the composer (a new capability, not a
restyle — see §5) and any fix for the cross-account offline exposure §7 raises, which is pre-existing
and wants its own decision.

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

## 7. Notes 4 & 5 — where MY DRIVES belongs

Founder, 2026-08-03: *"i wonder if the 'my drives' section should be moved somewhere else"* and
*"it also is only relevant for signed in users"*. Checked against the code; it is sharper than a
layout problem.

- ⚠ **On the anonymous cold open MY DRIVES is GUARANTEED dead weight.** The section renders
  **unconditionally** — there is no `signedIn` gate on it — and an anonymous session owns nothing
  (`drives.user_id` requires an account; the wall is `POST /drives`). So a first-time rider gets a
  divider, a kicker and an empty card that **can never populate**. It is the largest single block of
  pure clutter on the screen, aimed at exactly the audience seeing the app for the first time.
- ⚠ **But "hide it when signed out" would break a real state.** `load()` short-circuits for anonymous
  riders to `listDownloadedDrives()` — from disk. A rider who signed in, downloaded drives and later
  signed out still has content there, deliberately, as the offline-first fallback. The rule must key
  on **`drives.length === 0 && !signedIn`**, never on `!signedIn` alone.
### ✅ DECIDED (founder, 2026-08-03): move it off home onto its own signed-in-only screen

I had argued instead for reordering it in place (the in-car "resume" case costs an extra hop). That
is settled — the founder biases to the move. What the move actually needs:

- ✅ **The entry point already exists and is empty.**
  `headerLeft: () => (signedIn ? undefined : signInButton)` — the header-left slot is **already
  conditionally empty for exactly the signed-in riders who need a drives entry**. A `HeaderIconButton`
  there costs **zero new chrome**: signed out the slot says "Sign in", signed in it says "Drives".
I raised two hazards; the founder ruled on both (2026-08-03).

#### Ruling 1 — losing signed-out access is ACCEPTABLE: *"drives belong to a specific user"*

Gate on `signedIn`, not `signedIn || hasLocalDrives`. ✅ **The principle is right — and the on-disk
store does not currently implement it.** Verified:

- **Nothing reconciles downloaded drive dirs against the signed-in account.** `sweepOrphanClips` (the
  ONLY path allowed to remove a shared byte) reclaims CLIP bytes no drive dir **on disk** still needs
  — it keeps every drive dir regardless of who owns it. `deleteAllDriveDownloads()` has exactly one
  call site: the account-DELETION flow in `app/settings.tsx`. There is no Settings control to clear
  downloads.
- ⚠ So under ruling 1 a rider who merely SIGNS OUT leaves drive dirs on disk that **no UI can reach
  and no sweep reclaims** — invisible, unreclaimable, and chargeable to their storage.
- ⚠ **And it is already a cross-account exposure in one narrow path.** `load()`'s catch branch (the
  offline fallback) calls `listDownloadedDrives()`, which lists everything on disk. So account B,
  signed in on a device where account A downloaded drives, would see A's drives **when offline**.
  Pre-existing and NOT introduced by this change — but this change removes the last surface that made
  those files visible at all.
- ⚠ `app/settings.tsx`'s comment reasons about exactly this hazard for the deletion case and defers
  the list case to *"the ownership sweep"*. **I could not find a reconcile that plays that role** —
  worth a second pair of eyes before anyone relies on it existing.
- ✅ **The fix that makes ruling 1 true on disk: purge downloads on SIGN-OUT, not only on account
  deletion.** `deleteAllDriveDownloads()` already does exactly the right thing, including clearing
  the shared clip store (the half that is easy to get wrong — every megabyte of audio lives in
  `clips/`, a SIBLING of `drives/`). One new call site.

#### Ruling 2 — the offline break is real ("good point")

✅ **And ruling 1 mostly dissolves it.** `signedIn` is knowable offline (the token is in SecureStore),
so the rule is:

- **offline + signed in** → keep today's inversion exactly: render the drives list inline on home,
  composer absent. Nothing is lost.
- **offline + signed out** → the "can't plan out here" card ALONE, which under ruling 1 is now
  *correct* rather than a dead end: a signed-out rider has no drives to show, by definition.

So the offline inversion survives as a `signedIn` branch rather than needing a new mechanism — and it
stops being a dead end precisely because sign-out purges.
- **Two smaller things ride along.** The **credit-balance hint** lives in the MY DRIVES section head
  and needs a new home (the drives screen is the natural one). The new route is
  `app/drives/index.tsx`, which makes `/drives → /drives/[id]` a real hierarchy with a proper back
  affordance. ⚠ A new `app/*.tsx` breaks `typecheck` until `.expo/types/router.d.ts` regenerates —
  expected, not a real error.

## 8. Note 7 — two explicit home experiences, online and offline

Founder, 2026-08-03: *"i wonder if there should be 2 explicit home screen experiences, one for online
and one for offline"*. **Yes — and it is the natural conclusion of §7**, which otherwise leaves an
awkward exception (MY DRIVES leaves home… except offline, where it comes back inline). Two authored
experiences makes that not an exception: **the offline home simply IS the drives list.**

The two screens have genuinely different jobs, and the code already says so — the offline branch's
own comment is *"out here MY DRIVES is not the archive, it is the product — the only thing on the
phone that still works"*. Online home's job is **plan a drive**; offline home's job is **get me to my
saved drive**. Today the second is expressed as *absences* (composer removed, order flipped) — a
subtraction from the online screen rather than a designed one.

### ⚠ Two EXPERIENCES, not two ROUTES — and this is not a style preference

Both reasons are verified in the code, and the first costs money:

1. **`app/index.tsx` stays MOUNTED under a push, deliberately, and only unmount aborts an in-flight
   turn.** Its comment: *"A turn in flight is not aborted when the rider leaves (only unmount aborts
   it)"*. A `router.replace('/offline')` on a connectivity edge would unmount home, **killing a
   billed `/drives/plan` turn mid-flight and discarding the whole transcript** — for a rider whose
   only crime was driving through a tunnel.
2. **The connectivity verdict is event-driven and self-healing, not debounced.** It comes only from
   `addNetworkStateListener` events, and a stale OFFLINE verdict is deliberately re-probed rather than
   trusted. So it *can* flip. `connectivity.ts` states the stakes outright: *"a false OFFLINE verdict
   is CATASTROPHIC"*. Route churn on a flapping verdict is far worse than a layout swap.

So: **one mounted route, two explicitly authored components** (`HomeOnline` / `HomeOffline`) chosen by
`isOffline`. ⚠ **The planner state must be LIFTED above the branch** — today the conditional is only
in the returned JSX so state survives it, but splitting into two child components unmounts whichever
is not rendered, which reintroduces hazard 1 through the back door.

### What comparable apps do — and why Skipper is not shaped like them

Founder asked for prior art on apps carrying a full online experience plus a degraded offline one
(2026-08-03). ⚠ **This round of research was thinner than the earlier ones** — Google Design's offline
article turns out to be about LABELLING, not structure, and the podcast-app results were listicles.
What holds up:

- **Spotify: same screen, content GREYED OUT, plus a "You're Offline" message.** Undownloaded items
  stay visible but disabled; the terminology is "Downloaded".
- **Podcast apps (Pocket Casts et al.): no offline screen at all** — the library IS the product either
  way, so offline is unremarkable. Downloads are a first-class shelf, not a mode.
- **General 2026 guidance:** *"Loaded / loading / empty / error are four different screens, not a
  single spinner"*, and a hybrid rule — **banners for transient status, separate purpose-built screens
  for major offline workflows where the user must act on cached content.** That second half is exactly
  Skipper's offline case, so the literature supports the founder's instinct.
- **Google Design** is worth one thing only: pair the icon with the WORD — an offline pin plus
  "offline" for downloaded content, a cloud-off icon plus "no internet" for the state. Cheap and
  directly actionable on the offline home.

⚠ **THE REASON SPOTIFY IS THE CONTRAST CASE, NOT THE MODEL.** Spotify, Google Maps and podcast apps
all have a primary action with a **degraded form** — play cached music, show cached tiles, play a
downloaded episode. Greying out works there because most of the product still functions.
**Skipper's primary online action has NO degraded form:** planning a drive needs a model call AND a
billed Routes call, so it is binary, not degraded. A greyed-out composer would be a tease for
something that cannot happen at any fidelity.

✅ **And the codebase already made exactly that call, one control at a time:** *"⚠ The composer is
REPLACED, never greyed out — a disabled field reads as broken."* The founder's two-experiences
instinct extends a decision that is already in the tree from a single control to the whole screen.

The cleanest framing that falls out: **Skipper is two products in one app** — a PLANNER (online-only)
and a PLAYER (offline-capable). The offline home is not a degraded planner; it is **the player's front
door**.

### The transition rule — do not swap out from under work in progress

Even within one route, flipping to the archive screen mid-conversation would yank a rider's transcript
off screen. Rule: **swap only when there is nothing to lose** (`riderTurnCount === 0` and nothing in
flight); otherwise keep the online screen and show the offline notice inside it. `voice.offline.home`
("No signal out here — showing the drives you've saved") already exists for the first case.

### What each screen actually is

- **Online home** — the recommendation above: question as hero → suggestion rows → the sample card →
  composer. **No MY DRIVES** (§7).
- **Offline home** — the saved drives, first and large, because out here they are the product; the
  in-persona no-signal note; **no composer**; and ⚠ **no sample card** — `GET /sample` is a presigned
  R2 URL and needs the network, so that surface genuinely cannot exist offline.
- ⚠ **Offline + signed out is a third state, and it is empty by construction** (§7 ruling 1 + the
  sign-out purge): no drives, no planner. It gets the honest "can't plan out here" card alone — which
  is correct, not a dead end, precisely because the purge guarantees there is nothing to show.

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
