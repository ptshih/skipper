# Autio deep dive — the roam-shaped incumbent, six years in

> **Status:** reference doc (researched 2026-06-11; adversarially verified — 101-agent
> deep-research run: 19 sources, 94 claims extracted, 25 verified 3-vote, 20 confirmed /
> 5 killed). Read with [competitor-ux-studies.md](competitor-ux-studies.md) (the 2026-06-09
> four-comp teardown) — **this doc CORRECTS one of its findings** (triggering, below).
> Live-page facts are as-of 2026-06-10/11 and can drift.

Autio (ex-HearHere, co-founded by Kevin Costner) is the closest real-world comp to Skipper's
free-roam mode: open the app, drive, location-pinned stories fire. This dive went deeper than
the four-comp teardown on mechanics, content ops, business health, and review sentiment —
because roam makes Autio our most direct competitor, not just a model to read.

## The headline read

Autio is **alive, shipping (iOS v13.0.0, March 2026), and plateaued**: ~29 employees on $10.7M
of disclosed seed money (none since the March 2023 iHeartMedia-led round), 230K registered
users (2023, company-claimed), the same $35.99/yr price for three+ years, and an Android app
**frozen since November 2024** (3.2★, ~16K installs vs iOS 4.8★/4.3K ratings). Costner's halo
plus iHeart's national airwaves bought a niche subscription business, not a breakout. The
category is viable; nobody has cracked distribution — Detour died beloved, Autio plateaued
promoted.

## Corrections to our standing research

- **"Notification-gated, not true autoplay" was HALF right.** The verified 2025-26 model is
  **bimodal by design**: session START from the background is notification-gated ("Autio uses
  your location to notify you of nearby audio stories"), but once playing, **foreground
  continuation is real autoplay** ("will continue playing nearby stories as your location
  changes" — autio.com/faqs). Three flat "no autoplay" claim framings were refuted in
  verification (1-2 votes each); treat any "Autio has no autoplay" statement as wrong. The
  marketing ("automatically play at the perfect time") oversells the background case only.
- **Their only density control is the MAP ZOOM.** Autoplay is scoped to stories visible in the
  current map viewport (support FAQ, verified verbatim) — zoom in for fewer fires, out for
  more. No frequency setting exists. (Skipper's explicit Chattiness knob is ahead of the
  incumbent here, not catching up.)

## Verified findings (high confidence unless noted)

**Mechanics**
- **Offline = manual per-story download, listen-later.** Users must anticipate dead zones and
  download individual stories ahead ("be sure to download the stories you want to listen
  to... before your trip" — support). No route/region bulk pack, no auto-prefetch, and no
  source confirms triggered autoplay works offline at all. **Skipper's whole-tour offline
  bundle (and the planned roam region pack) is a genuine differentiator, not parity.**
- **CarPlay is supported and chronically buggy** — CarPlay-specific fixes appear in release
  notes three consecutive years (May 2024, Sep 2024, Aug 2025); reviews: interface "pretty
  poor," no map, queued stories "sometimes load, sometimes start over and sometimes just
  fail." Even the incumbent treats CarPlay as a defect surface — Skipper's defer-CarPlay
  posture validated.
- **No "ask"/interactive feature surfaced in any 2025-26 material.** Ask-the-Skipper's lane is
  uncontested.
- **Repeat handling on daily-driven roads: no source addresses it at all.** The roam pass-2
  history/cooldown work has no incumbent answer to copy OR beat — open field.

**Content operation**
- Catalog: 1,500 stories (Aug 2020 launch, CA/OR/WA only) → 10,000+ (Mar 2023) → 20,000+ on
  the App Store today (autio.com says 25,000+). All counts company-claimed, never audited —
  and they say nothing about per-region density (the claims trying to pin density were
  refuted; the inference rests on review complaints: "there are not too many stories around
  my area"). 2–3 min stories, weekly releases, celebrity narrators still headlined.
- **Nothing found on AI/TTS use** — but doubling a catalog 2023→2025 at ~29 employees implies
  heavy leverage somewhere (open question).

**Sentiment (the 4.8★ is real but prompt-driven)**
- An mwm.ai analysis of 295 WRITTEN App Store reviews scores **3.7/5** (medium confidence,
  single aggregator): top complaints = GPS accuracy, CarPlay, stability, notification spam
  ("30 notifications in 3-4 hours"), regional coverage.
- The two most instructive verbatims (verified live on the Play listing):
  - *Trigger/ducking (Dec 2023, 28 helpful):* "notifications didn't work for 2 months...
    Audio plays while other media is playing, you have to manually pause your music...
    I uninstalled." **Playing OVER the rider's music is a literal uninstall reason —
    Skipper's duckOthers posture is the right call.**
  - *Persona thesis, stated in the negative by a churner (Dec 2024, 13 helpful):* "Two [of 3
    stories] were not even related to the area... they pronounced the city incorrectly again
    and again. The general tone... is like an NPR broadcast. Just droning on and on." —
    curation density, LOCAL pronunciation, and delivery tone, all in one review. This is the
    "persona lives in delivery" bet, confirmed by the incumbent's churn.

**Business**
- $10.7M total disclosed: $1.6M pre-seed (2021), $3.2M seed (2022), $5.9M SECOND seed (Mar
  2023, iHeartMedia-led, with a multiplatform marketing partnership). No rounds since.
  Pricing stable since 2023 ($35.99/yr; 14-day $14.99 and 30-day $29.99 trip passes added) —
  **trip-length passes are a tacit admission that usage is episodic**, the category's core
  retention problem (relevant to our one-time-purchase instinct).
- Android effectively abandoned (last update Nov 2024, ships sharing features not trigger
  fixes; the account's only package). Validates iOS-first — and shows the cost of a token
  cross-platform presence: a public 3.2★ storefront.

## Structural vs execution failures (the strategic partition)

**Structural (inherent to their model — Skipper's opening):**
1. **Points-as-primary, national-broad** — 20k+ scattered pins guarantee "nothing for miles"
   somewhere and mistargeted stories everywhere; the catalog count became the product's
   marketing message instead of its experience. Regional-deep + density-bar-gated is the
   inverse bet (and roam keeps it: secondary mode, gated regions).
2. **The coverage race** — breadth spend yields a thin layer everywhere, depth nowhere.
3. **Rented celebrity voices** — no local ear (mispronunciations), no persona (the "NPR
   drone"), and unfixable at 25k-story scale: re-recording a catalog is the one thing a
   generation pipeline does for free and a voice-actor library cannot.

**Execution (avoidable — table stakes Skipper must simply not fumble):**
- Background trigger reliability (notifications broken for months for one reviewer).
- Ducking (play-over-music = uninstall).
- Notification spam (we have no notifications at all — keep it that way until there's a
  reason).
- CarPlay quality (deferred anyway).

## What this changes for us

- The three Autio borrows in TODO.md hold; the duck borrow is UPGRADED from "most-cited
  complaint" to "verbatim uninstall reason."
- Roam pass 2 (history/mute) and the offline roam pack attack surfaces the incumbent has
  **no answer for at all** (repeat handling: unaddressed; offline: listen-later only).
- The Chattiness knob and explicit-session model are already ahead of the incumbent's
  zoom-as-density and notification-spam posture.
- Category read for [roam-first-region-expansion](../ideas/roam-first-region-expansion.md):
  ambient location audio sustains a real niche business six years in — but distribution, not
  product, is the binding constraint (Detour + Autio agree). A cheap roam region is only
  cheap to BUILD; telling anyone remains the expensive part.

## Open questions (worth a follow-up someday)

1. AI/TTS in their pipeline? (Catalog doubling at 29 heads says leverage exists somewhere.)
2. Actual per-region density distribution vs the headline count.
3. Post-2023 business reality: revenue, churn, bridge rounds, tourism-board/B2B deals (a 2026
   Visit Santa Barbara profile hints; unverified).
4. Whether CarPlay does true background autoplay or stays notification-dependent.

## Verification notes & key sources

5 of 25 verified claims were killed, including every one-sided "no autoplay" framing and an
appealing-but-wrong "500K downloads, outside top-30 Travel" stat (0-3) — no reliable
download/ranking data survived. Richest complaint verbatims come from the near-abandoned
Android surface (62 ratings) and may overstate the iOS experience.

Primary: autio.com/faqs, /about; support.autio.com FAQ; App Store id1300494609 (v13.0.0);
Play Store autio.audio.travel.guide.stories. Secondary: TechCrunch 2023-03-29 (funding);
Inside Radio (iHeart round); mwm.ai review analysis; PitchBook/Tracxn (headcount);
GlobeNewswire 2020-08-05 (launch).
