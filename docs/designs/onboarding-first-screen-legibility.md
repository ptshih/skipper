# Onboarding — the first screen is pretty but does not say what this is

> **Status:** ✅ **BUILT 2026-08-05 — §2, §3, §4 and §5 are all closed, and NOT by the option this
> doc recommended.** Landed in three passes: (1) CTA → **"Plan a drive"** and the tagline promoted
> `inkFaint` → `inkDim`; (2) the tagline REWRITTEN to name the activity and the payload — *"You drive,
> I'll tell you what you're passing."*; (3) **every player control deleted** (founder, 2026-08-05:
> *"i wonder if we should just get rid of all the player controls, and just have one 'secondary' cta
> above the primary 'plan a drive' cta that says 'Hear a Sample'"*), so the card is a poster and the
> two actions are stacked labelled buttons.
> ⚠ **§7's recommended option A was NOT what shipped**, and §7.1 below records why — the category
> descriptor it proposed was built, rendered, and rejected against a rewritten tagline.
> ⚠ **One finding is deliberately left open: nothing signals playback but the button's label** (§7.2).
> ⚠ **This retires `onboarding-taste-then-where.md` §8.4's quiet-CTA rule** — see that doc's status.
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
> ✅ **AND THEN SUPERSEDED.** The descriptor half never shipped as written — see §7.1.

## §7.1 · What actually shipped, and why the recommendation lost

Everything below was decided from **renders on two viewports** (iPhone 17 Pro Max, and an iPhone SE at
375×667), not from argument. That is the whole reason the recommendation changed.

**The descriptor was built and rejected.** A small-caps `NARRATED ROAD TRIPS` kicker between the
wordmark and the tagline (option A) was rendered on both phones. It fits; it even suits the WPA poster
idiom better than expected. It lost on two counts: against a tagline that *already* names the activity
it is a second explanatory line saying less, and a store-listing noun under the wordmark is exactly the
"landing page" register that got home's hero deleted on 2026-08-03.

**The tagline carried the category instead.** *"You pick the road, I'll do the talking"* was one word
away from working: "pick the road" implies a LIST to pick from (the same browse-expectation defect as
"Start exploring"), and "do the talking" never says about what. Neither clause said the rider was
DRIVING. **"You drive, I'll tell you what you're passing."** keeps the you-X-I'll-Y rhythm and the same
length — still one line at 375pt — while saying there is a car, it is moving, and he narrates what goes
past. ⚠ So the category never needed a *label*; it needed the sentence to stop gesturing.

**§4 and §5 closed as side effects, exactly as predicted.** With the player gone the postcard kicker
(`HEAR A SAMPLE`) became the label twice — the button now makes that offer by name — so it was deleted
rather than reworded, which is §4. And with the tagline naming the category, the place name no longer
reads as the app's subject, which is §5.

**The real fix was structural, and it was the founder's.** The diagnosis that unlocked it: *a photo
over a transport bar IS a media player*, so no copy above the picture could stop the screen reading as
an audio app for a pretty place. Deleting the scrubber, the ±15 discs and the play disc deleted the
idiom at its root. ⚠ An intermediate attempt — swapping `Scrubber` for `RouteTrack`, the app's own
dashed-trail-and-rig motif, driven by the clip's real position — was built and rendered and is worth
knowing about: it read *far* better than the media bar, but it was still a transport, and it silently
dropped the screen's only `accessibilityRole="adjustable"` (`RouteTrack` is `accessibilityElementsHidden`).
It was abandoned for the strip-out, not for that defect — but the defect is why it should not be
casually revived.

## §7.2 · The one finding left OPEN — playback has no signal but a word

With the transport gone, **nothing on the screen moves while the clip plays.** The secondary button's
label flips `Hear a sample` → `Stop the sample`, and that is the entire feedback surface.

⚠ **This is known and deliberate, not an oversight** — but it is a real gap on the one screen whose
whole purpose is being heard: a rider on silent, or with headphones not connected, taps and sees a
word change. Three candidates were sketched and none built: a hairline progress fill along the
poster's base; the rig creeping along that same base (drive metaphor, but reintroduces the motif just
removed); or nothing at all, trusting audio to be its own feedback.

⚠ **Do not "fix" this by putting the player back.** The register to stay inside is *ambient*, not
*transport* — something that shows time passing without offering a control to grab.

## §7.3 · Two audio defects the on-device testing found — both fixed 2026-08-05

Neither was visible to `tsc`, to `bun test`, or to a screenshot. Both were caught by *timing the clip
on a simulator*, which is the only method that can see either.

**1. THE TASTE COULD NOT BE REPLAYED ONCE IT FINISHED — and this one PREDATES the redesign.** It is on
`main` in the shipped build, on the first screen of a fresh install. `/sample` calls
`applyExclusiveBackgroundAudio()` **only in its mount effect**, and calls `releaseAudioSession()` when
the clip completes. That release is `setIsAudioActiveAsync(false)`, which in expo-audio's own words
*"will pause all audio playback and PREVENT NEW AUDIO FROM PLAYING"* — so after the taste ran once,
pressing play again did nothing at all until the app was relaunched. ⚠ `src/lib/audio-session.ts`
already documents this **exact defect shipping once before** (a silent drive after "Pull over",
founder 2026-08-04), which is why its header says every `apply*` turns the subsystem on FIRST rather
than assuming it is on. The screen was assuming. Fixed by re-activating on every play.

**2. "STOP" DID NOT REWIND, even though the label said it did.** The founder asked for stop-resets
(*"the sample should reset from the beginning (not resume)"*). The obvious implementation —
`player.pause()` then `player.seekTo(0)` on the stop path — **does not stick**: timed on device
(stop at ~15s, replay, still-playing check at 55s of a 64s clip) the clip resumed from 15s and ended
at 49s. ⚠ The seek belongs on the **play** side, where it can be awaited before playback starts:
`activate → seekTo(0) → play`, chained. Every play on this screen begins at 0, because there is no
resume concept here to preserve.

⚠ **The lesson worth keeping is the method, not the two fixes.** A label ("Stop the sample") and a
behaviour (resume) disagreed, and nothing in the type system, the tests, or a screenshot could tell
them apart — the only thing that could was playing the clip and looking at the clock. Any future
change to this screen's playback needs the same treatment.

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
