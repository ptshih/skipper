# Does the onboarding gate still earn its place?

> **Status:** ✅ **ANSWERED AND EXECUTED 2026-08-05 — NO. The gate, the screen and the sample are all
> DELETED.** Asked as an open question hours earlier; the founder's follow-up (*"do we even really need
> a sample for the reviewer anymore?"*) resolved it, and then: *"lets completely delete the sample and
> the onboarding screen, don't leave any orphans."*
>
> **What was removed:** the `/sample` screen and its first-run redirect; `src/lib/client-flags.ts` (the
> `onboarded` flag) and the Settings → Developer reset it fed; `GET /sample`, `sampleLimiter`,
> `SAMPLE_RATE` and `SAMPLE_NARRATION_QID`; the `sample` DTO and `Sample` type; `getSample`,
> `listRegions` (orphaned by the screen — it had no other caller), `postcards.ts`, `Sunburst`, the
> `sample_played` analytics event, and every string that dressed them.
>
> **What deliberately survived:** the Emerald Bay artwork
> (`apps/mobile/assets/brand/postcard-emerald-bay.jpg`), kept with no reader for **TODO #74** — reusing
> region postcards on home. And the drive player's account gate, whose "take the sample ride" escape now
> routes HOME; ⚠ whatever that button points at must stay reachable ANONYMOUSLY, which is the invariant
> an earlier version broke by looping riders back into the same 401.
>
> ⚠ **The deciding metric was never read.** §4 pre-committed to first-run `sample_played`, and the call
> was made on the superseded-argument finding (§2) instead. That is a legitimate basis — the argument
> was structurally void, not merely weak — but it is not the evidence the doc asked for, and the event
> is now deleted, so it can never be read. Recorded so nobody later assumes it was.

## §1 · Why this is being asked now, and why that is not a mood

`onboarding-taste-then-where.md` §6 pre-registered this exact moment. Its Alternative C — *don't build
it, fix both problems in place* — closes:

> *"The honest case for this is strong: the cold open was redesigned on 2026-08-03 for exactly this
> job… putting a flow in front of it means the product has two front doors — the second of which was
> designed to be the first. **If onboarding ever starts feeling like ceremony, this is the version to
> fall back to.**"*

The trigger condition was written down in advance by the person who built the thing. "We have been
churning" is that condition being met, not a passing feeling.

⚠ **The churn is itself evidence.** In two days the screen went three surfaces → one, gained and lost a
badge, had its kicker rewritten three times, gained and lost a region question, went autoplay → tap,
gained a full player and then had every control deleted, had its CTA renamed and its tagline rewritten,
and grew trail art. Surfaces that cannot settle are usually ones nothing depends on: the job is
contested because it is not load-bearing.

## §2 · THE FINDING — the reviewer argument is superseded

The screen's founding justification (`app/sample.tsx` header, and §1 of the taste doc) is that the
corpus is Tahoe-only, so a first-timer or an Apple reviewer outside coverage can talk to the skipper
and never reach a road he has stories for. The canned clip was *the only way out of that wall*.

**That is no longer true.** `POST /drives/propose` is the **open anonymous front door**, and its own
header in `apps/api/src/drives.ts` states what it returns:

> *"the route a rider planned in conversation, its stop count, and **ONE presigned clip drawn from that
> route's own release-filtered selection**"* — cheap; no persist, no credit, no account.

So the reviewer path today is: open the app → talk to the skipper → get a route → press play and hear a
real stop **from the drive they just planned**. No account, no credit, no GPS, no location permission.

⚠ **AND IT IS THE BETTER TASTE**, on three counts. It demonstrates the PRODUCT (plan a drive → hear what
you would hear) rather than merely proving a voice exists; it arrives INSIDE the funnel it is selling
instead of in front of it; and it is grounded in a route the listener CHOSE, which is far more
convincing than a postcard of a lake they did not pick.

⚠ `previewClipFor`'s own comment already names the pair — *"this preview clip and `GET /sample` play
BEFORE a drive exists — before the wall, before a credit… They are the taste that sells the thing."*
**Two tastes have existed side by side since step 8a**, and the screen justified by there being only one
was never revisited.

## §3 · What the gate still does that nothing else does

Stated as strongly as it can be, because §2 does not empty it completely:

1. **The null-clip path.** `previewClipFor` returns **null** on an empty selection (a genuine 200 with
   `estStopCount === 0` — a quiet road) or on a presign failure, degrading deliberately to "no taste."
   A reviewer who plans a quiet route hears nothing.
2. **The rider who never engages.** Someone who opens the app and types nothing reaches no clip at all.
   The gate guarantees the voice is offered before anything is asked of them.
3. **"Hear it before you type at it."** For an audio product, letting a newcomer HEAR the thing
   outranks asking them to write — the empty-state argument that moved the taste to the front in the
   first place, and it is not refuted by §2.

⚠ **But notice the shape of all three: they argue for the SAMPLE BEING REACHABLE, not for a
full-screen gate in front of every rider on every install.** A prominent sample card on the cold open
satisfies all three — which is exactly what `ListenRow` was until it was deleted on 2026-08-04
*because* the taste moved here.

## §4 · The evidence nobody has read

`onboarding-taste-then-where.md` §6 pre-committed to the deciding number:

> *"if the taste screen measures as a step riders skip past — if `sample_played` on first run comes in
> low — then the audio was never the blocker and C is the cheaper truth."*

**It has still never been read.** `sample_played` fires with `{ completed }`, once per load, from
`app/sample.tsx`. ⚠ Whatever else this document argues, that number is the cheapest input available and
it costs one dashboard query. A decision made without it is a decision made on taste.

## §5 · What deleting the gate would cost, and what must survive

**Must survive:**
- **`GET /sample` itself.** One built, free, anonymous endpoint; it is the insurance for §3.1–3.2 and
  costs nothing to keep. ⚠ But the taste doc records that `/sample` has **exactly one entrance — the
  redirect**, so removing the gate ORPHANS the endpoint unless something else reaches it.
- **The category line.** `voice.tagline` ("You drive, I'll tell you what you're passing.") has exactly
  one reader: this screen. ⚠ It was already reader-less for a day once, when home's masthead was
  deleted on 2026-08-03. Deleting the gate orphans it a second time — so it would need to move to home,
  which is arguably where the product's one-line description belongs anyway.

**Genuinely lost, or needing a new home:** the poster treatment, the trail illustration
(`Ridgeline` + `RouteTrack` with the rig driving as the clip plays), and the stop-resets-to-zero
behaviour. None is wasted work — all of it is reusable on a home-hosted sample card — but none of it
transfers for free.

**Not lost:** both audio fixes from 2026-08-05 (§7.3 of the legibility doc). The
replay-after-completion bug was a defect in `/sample`'s session handling that would follow the clip
wherever it lives.

## §6 · Options

**A. Write it up and decide on the number.** (RECOMMENDED — and this document is its first half.) Read
first-run `sample_played`, then choose. *Downside:* it defers, and the 1.1 sweep is the live priority.

**B. Fall back to Alternative C now.** Delete the redirect and the `onboarded` flag; move the taste onto
home's cold open as a real card; keep `GET /sample` reachable from there. One front door again.
*Downside:* it re-adds what was deliberately deleted on 2026-08-04, and deciding it in the same breath
as the diagnosis is how the last two days of churn started.

**C. Keep the gate, stop touching it.** It is now genuinely good. Freeze it, close the legibility doc,
return to the sweep. *Downside:* leaves two front doors, the second of which was designed to be the
first — and leaves §2's finding recorded but unacted on.

**Which I'd pick: A**, then most likely **B**. §2 removes the last *structural* reason for the gate, so
what remains is a taste question — and on taste, home already does the teaching job better (a stranger
learns more from "Where are we headed?" plus five concrete example asks than from a poster and a play
button). **What would change my mind:** a high first-run `sample_played` with high `completed`. That
would mean strangers really do stand still for a minute of audio before typing, which is the one thing
neither the cold open nor the preview clip can prove on its own.

## §7 · Spend and blast radius

**No spend, on any option.** `GET /sample` and `POST /drives/propose` are both anonymous and free
(`/propose` bills Google Routes, but it bills that today regardless — this changes no cap in
`apps/api/src/limits.ts`). Every option is client-side plus, at most, deleting one route and one client
flag. ⚠ Option B touches `app/index.tsx`'s redirect and `src/lib/client-flags.ts`, both of which carry
load-bearing comments about the flag never being user-keyed and never being read live — read those
before removing anything.
