# Onboarding — the first screen is pretty but does not say what this is

> **Status:** 🔨 **PARTLY BUILT 2026-08-05 — §3 and the styling half of §2 shipped; the CATEGORY
> DESCRIPTOR (§2) and §4–§5 are still OPEN.** The founder took option A in two halves (*"i agree with
> rename the CTA + inkFaint, lets do that first"*): the CTA is now **"Plan a drive"**
> (`voice.region.setupCta`) and the tagline renders `inkDim` rather than `inkFaint`
> (`app/sample.tsx`). ⚠ **The screen still never states the category** — the largest finding here is
> the one NOT yet fixed, and a legible tagline that says nothing about driving can easily read as
> though it were. Do not close this doc on the strength of the two edits above.
> Prompted by the founder: *"i feel like the onboarding page is pretty but still a bit confusing as
> the first screen a brand new user sees."* Read on a booted simulator (iPhone 17 Pro Max, iOS 26.5)
> against `apps/mobile/app/sample.tsx` as it stood at `d5fd80f`.
> ⚠ This does **not** supersede [onboarding-taste-then-where.md](onboarding-taste-then-where.md) — that
> doc is BUILT and its structural calls (one screen, no autoplay, no region question, no location ask)
> are **not** re-litigated here and should not be reopened by anything below. What this adds is a
> narrower claim: the screen those calls produced never states the CATEGORY, and one specific deletion
> is why. §7 lists options; the founder has picked none of them.

## §1 · What a stranger actually learns, in order

Everything on the screen, read top to bottom by someone who has never heard of this app:

1. **SKIPPER** — a name.
2. *"You pick the road, I'll do the talking."* — a promise, in persona, with no noun for what "it" is.
3. A WPA poster of a lake, captioned **HEAR A SAMPLE** / **Emerald Bay State Park**.
4. A scrubber reading `0:00 / 1:04`, a ◀15 / ▶ / 15▶ transport, an ⓘ.
5. **Start exploring**, in a quiet outline button.

**The word "drive" does not appear. Neither does "car", "road trip", "tour", or "as you go".** The only
concrete noun on the screen is a state park. On that evidence the app could be a travel podcast, a
national-parks guide, an audio-postcard toy, or a meditation app — all four are consistent with what is
rendered. The product — *narration that plays while you drive a route you chose* — is not stated, shown,
or implied anywhere on the first screen a rider ever sees.

⚠ **This is a legibility failure, not an aesthetic one, and the screen's own quality is what hides it.**
The postcard is genuinely good, so the screen reads as finished; the reviewer's eye goes to the artwork
and never audits the sentence. That is the whole reason it survived four days of iteration.

## §2 · The category line was deleted, and half the argument for deleting it was deleted too

This is the finding that matters, because it is traceable rather than a matter of taste.

`src/ui/voice.ts` `tagline` opened **"Narrated road trips. You pick the road, I'll do the talking."**
The descriptor was cut on 2026-08-04 (founder). The comment recording the trade is honest about it being
a trade, and names what made it survivable:

> *"What makes that survivable is everything around it — a postcard, an **'A TASTE' badge**, a transport
> bar and a 64-second clip are all on the same screen, so 'audio about places' is shown three ways
> before the sentence has to say it."*

⚠ **The "A TASTE" badge was deleted the same day** (`voice.ts`, `badge`; and `app/sample.tsx`'s comment
at the postcard, which costs it ~28pt). So one of the three supporting signals no longer exists, and the
justification for cutting the descriptor is now standing on two legs, both of which are *media chrome*
(a picture and a transport bar) rather than anything that says what the media is FOR.

⚠ **The same comment block already concedes the point**, in the paragraph immediately below:

> *"Onboarding is the one screen where the argument does NOT apply: the rider has not decided anything
> yet, and **the postcard alone never says what the app DOES**."*

That sentence was written to justify *keeping the tagline on this screen at all* (it had gone reader-less
when home's masthead was deleted on 2026-08-03) — but it is equally an argument that the tagline has to
carry a descriptor here, which is the exact clause that was then removed from it.

⚠ **AND THE ONE EXPLANATORY LINE IS STYLED AS A TERTIARY HINT.** The tagline renders
`variant="dim" color="inkFaint"` — and `inkFaint` is documented in `src/theme/theme.ts:29` as
*"tertiary hints"*, the faintest text role the system has. The single sentence carrying the most
explanatory load on the app's first screen is set in the role reserved for the least important text on
any screen. Whatever that line ends up saying, this is worth re-deciding on its own.

**Cheapest possible correction, for scale:** restoring two words to a string. That is the entire fix for
the largest of the four problems here.

## §3 · "Start exploring" mis-promises the screen directly behind it

Tapping it lands on home's cold open, which reads **"Where are we headed?"** over five concrete example
asks and a composer. Verified on device: home is markedly more legible than onboarding — a stranger
learns more about the product in the first second there than in the whole of the screen in front of it.

"Explore" sets a **browse** expectation — a map, a catalogue, a list of places to poke at. What arrives
is a **conversation** that immediately asks the rider a question. The mismatch is small but it lands at
the worst moment: it is the rider's first act in the app, and the label describes something the app does
not do.

⚠ **The button is also the ONLY exit** (home REDIRECTS here, so `canGoBack` is false — `app/sample.tsx`
states this and it must not become a `router.back()`). So this label is load-bearing traffic-wise, not
decoration: every rider reads it, and every rider presses it.

⚠ **Do not solve this by gating or hiding it.** Its permanent availability is what replaced the deleted
"Skip the sample" control (onboarding-taste-then-where §8.4), and the quiet-`secondary`-until-heard
promotion is the mitigation that made the one-screen merge survivable. **Only the words are in question.**

## §4 · "HEAR A SAMPLE" has no referent on a first screen

The kicker was added deliberately, and its own comment states the job well: *"This answers the question a
newcomer actually has in front of an image and a play disc: what happens if I press it."* True — it
fixed a real gap, and it should not be reverted to nothing.

But **"sample" is a word that presupposes the product it is a sample of.** On screen five of a funnel it
is precise; on screen one there is nothing for it to be a sample *of*. It is a sample of what he says as
you drive past that place — and "as you drive past" is the half that is missing, which is the same gap
§1 and §2 describe arriving in a third place.

⚠ The kicker was rewritten twice inside a week (`POSTCARD FROM LAKE TAHOE` → `HEAR A SAMPLE`, with the
`A TASTE` badge cut in between). A third rewrite should be worth more than a synonym; if it changes, it
should be the change that adds the drive.

## §5 · The place name is the loudest type on the screen

`Emerald Bay State Park` is set `variant="display"` — the heavy slab — on the artwork, and it is the
largest text rendered, above the wordmark itself. Landing it there was right for the reason its comment
gives (*"ON the picture, at poster weight, it IS the picture's title"*), and the postcard reads far
better for it.

The side effect is that the biggest thing on the app's first screen is **a place the app is not about**.
A first-timer can reasonably conclude Skipper is a guide *to Emerald Bay*. With the corpus Tahoe-only
that is nearly true today, which is exactly why it is a hazard rather than a harmless one: it will read
as accurate right up until it is wrong, on installed apps, the day region 2 releases.

⚠ **Lowest-priority of the four, and possibly a non-issue** — if §2 lands, the descriptor above the card
frames the picture as an example rather than as the subject, and this may resolve itself with no change
to the postcard at all. Listed so a future reader does not "fix" the type hierarchy first and lose the
postcard for nothing.

## §6 · What is NOT wrong — do not reopen these

Recorded so this document cannot be mined for permission to redo settled work:

- **No autoplay.** Correct, and for a mechanical reason (exclusive `doNotMix` focus stops a stranger's
  podcast as the app's opening move). onboarding-taste-then-where §1.
- **One screen, not three.** The merge deleted a whole end card and a separate `/region-setup`. §8.4.
- **The quiet CTA that promotes to primary once the clip is heard.** This is the mitigation that makes
  a play disc and a forward CTA coexist. §8.4 — *"do not collapse that into one constant variant."*
- **No region question, and no location ask.** §8.1 and §8.3, both founder calls, both with the app-
  installed-base kill-switch reasoning behind them.
- **The postcard artwork and the matte.** It is the best-looking thing in the app and it is doing its
  job; nothing below asks for less picture.

**Every problem in §2–§5 is a copy problem.** No layout rearrangement, no new surface, no wire change,
no new component is required by any of them.

## §7 · Options

**A. Say the category, name the next step.** (CHOSEN 2026-08-05, and SPLIT IN TWO.) Restore a
descriptor near the wordmark — "Narrated road trips" or similar — and rename the CTA to what actually
comes next ("Plan a drive"). Fixes §2 and §3, the two that carry the most weight, for two string edits
and no layout risk. *Downside:* leaves §4 and §5 standing.

> ✅ **SHIPPED (2026-08-05):** the CTA rename (§3) and the `inkFaint` → `inkDim` promotion. The colour
> role is precedent-backed rather than hand-picked — `inkDim` is what home's own subhead
> (`voice.plan.openingHint`) already uses for the identical job one screen later. The type SIZE stayed
> `dim` (13.5pt) deliberately, to leave the SE line budget the descriptor will need.
>
> ⏳ **STILL OPEN — the descriptor itself**, which is the largest finding in this document. ⚠ The two
> shipped edits make the tagline *legible*; they do not make it *informative*. A reader who sees a
> darker tagline and a clearer button may conclude §2 is handled — it is not, and §2 is the reason the
> screen was confusing in the first place. The open question is only what the line should say and
> whether it is a third line or a restored clause, not whether it is needed.

**B. A + a how-it-works beat.** Add a short three-beat under the card ("Say where you're driving → I'll
ride along and talk"). Most explicit reading. *Downside:* costs ~40–60pt on the screen whose entire
design fight was fitting on an SE, and it is the one addition here that would read as a landing page
rather than as him — which is precisely the charge that got home's hero deleted on 2026-08-03.

**C. A + reframe the sample as a drive moment.** Kicker becomes something naming the drive, plus a thin
caption tying the clip to driving past. Fixes §4 as well. *Downside:* a third kicker rewrite in a week,
and more type on artwork that is currently carrying exactly the right amount.

**D. Do nothing.** Defensible on one argument, and it should be stated fairly: home is one tap away and
home is legible, so the rider who presses the button learns everything within a second. **What that
argument ignores** is that the rider who does NOT press the button — who closes the app on screen one
because it never said what it was — is not in any funnel we can see.

**Which I'd pick: A**, and I would do the `inkFaint` role with it rather than after.
**What would change my mind:** if `sample_played` on first run is already high, the screen is holding
attention fine and the honest read is that only the CTA label (§3) is broken — a one-string change.
⚠ That number exists (`sample_played`, `{ completed }`, one per load) but **was not read for this
document**, and it is the single cheapest input to the decision.

## §8 · Space budget — measured, not assumed

- On a 17 Pro Max (956pt tall) the CTA's bottom edge sits at roughly **669pt**, leaving **~250pt of
  empty parchment** below it. One or two more lines of type cost nothing on a current phone.
- **The SE is the binding constraint, not the Pro Max**, and it is why every ~28–40pt deletion in the
  build log was worth arguing about. But the screen is `scroll` on purpose — a rejected pure flex-to-fit
  layout shrank the postcard to ZERO on a 375×667 — so a line that overflows an SE scrolls rather than
  breaking, and `COMPACT_SCREEN_H` already steps the spacing down there.
- ⚠ The precedent for "copy grew the layout and pushed the primary CTA into the home indicator" is real
  and recent (`endTitle`, cut for exactly that, ~39pt). **Anything added here gets checked on a 667pt
  viewport before it ships**, which is a simulator pass, not a typecheck.

## §9 · Spend and blast radius

**None.** Every option is a string in `src/ui/voice.ts` plus at most a `color`/`variant` prop in
`app/sample.tsx`. No new endpoint, no wire change, no model call, no Routes call — `GET /sample` is
already anonymous and free, and onboarding adds no rider-triggered spend (onboarding-taste-then-where
§7). Nothing here needs a founder go on the spend axis; it needs one on the copy.
