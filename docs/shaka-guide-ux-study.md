# Shaka Guide — UX teardown (the comp we define ourselves against)

A UX study of **shakaguide.com** + real user reviews (Tripadvisor / App Store / blog teardowns —
where the truth lives, vs. marketing copy), read through Skipper's lens. Shaka Guide is *the*
reference comp — it's literally the "what we're not" in CLAUDE.md ("if the model just reads a fixed
script, you've rebuilt Shaka Guide with extra steps").

> **Reference doc, not a spec.** Studied 2026-06-09. No screens captured — this is the *flow* and
> *reception* (site + reviews), not the literal in-app UI.

## The headline: Skipper is already architected against Shaka's top complaints

Almost point-for-point, what real Shaka users complain about is the exact seam Skipper's design
attacks. This is the strongest external validation of the charm roadmap to date:

| Shaka user complaint | Skipper's answer (decided/built) |
|---|---|
| **"stretches of *dead air* between stops that could've been filled with stories"** | the **downtime-callouts** feature — `docs/downtime-callouts-spec.md` |
| Tours run **one way only** — can't reverse if you're lodged elsewhere | every tour is an **independent peer tour** (S→N and N→S separate drives) — `tour-model-simplified` |
| **"manually running buttons… many steps to the next stop, gets confusing"** | GPS-triggered **FIFO auto-play**, zero manual stepping (the in-car "half-second glance" rule) |
| **No try-before-buy** — you pay ~$20 *blind* | the **anonymous couch-preview funnel** (every tour previewable; the wall is the live drive/offline) |
| **Low music quality** (Android reviews) | the **loudness-matched CC-BY soundtrack** rotation (`driveMusic.ts`) |

A real user's *number-one* gripe — "dead air that could've been filled" — is the precise pain the
callouts spec fills. We didn't reverse-engineer that; it fell out of the persona-first design. Worth
remembering when prioritizing: callouts target a felt, *reviewed* complaint, not a hunch.

## CONSIDER (learn from / don't dismiss)

- **The practical/logistics layer is what users love MOST** — parking, fees, bathrooms, food,
  *closing times*. It's the most-praised thing in every review, and it's **utility, not charm.**
  - *Our risk:* charm-purism starving the genuinely useful layer.
  - *Our answer (already in the architecture):* the **live break-stop Places fetch** — volatile data
    fetched fresh at tour-load, never baked into a frozen clip (dodges staleness + Places ToS). The
    action item is to make sure we actually *surface* that practical info, not just the joke. This is
    the one place this study says to **respect Shaka, not differentiate.**
- **Offline-first is table stakes and loved** — we have it (Phase 3, `offline.ts`). Keep it sacred.
- **Families are enthralled by "stories + music"** — validation of both the sound-design investment
  *and* the carful/multiplayer idea (future-feature #3). Kids are a real audience for this category.
- **Discovery via map + category browse** works at their scale. Distinguish a *discovery* map
  (browsing tours — maybe worth it later) from the *in-drive* map (deferred with CarPlay). Don't
  conflate the two deferrals.
- **One-time purchase + bundles, no subscription** — their monetization, and reviews don't resent
  it. Matches our competitive-research takeaway (one-time over subscription early). A data point for
  when we monetize (pairs with the Tip-the-Skipper/IAP work).

## IGNORE (conflicts with our bets — don't copy)

- **Breadth as the product** (85–102 tours, every park/island). Shaka's value *is* coverage. We
  optimize for **charm, not scale** — one region with personality beats 100 read scripts. Don't
  enter the breadth race.
- **Pre-recorded fixed scripts / "professional narration."** The thing we exist *not* to be. Our
  zero-reuse, persona-owned, reactive narration (callouts, opinions, the through-line) is the whole
  differentiator. Their production model is the anti-pattern, by definition.
- **Being a navigation app** (turn-by-turn, "directions to stops"). We ride *alongside* the rider's
  own nav as audio on frozen rails — we don't route. (Do nail "where to start," already on the mobile
  roadmap.)
- **"Side quests" / recommended detours with directions.** The sharpest philosophical fork: Shaka
  *routes you* to detours (utility); our #4 skipper deliberately *won't name names* (the vagueness is
  the bit — `docs/skipper-opinions-spec.md` §3.4). Keep the charm version — eyes open that we trade a
  sliver of utility for character.
- **Buy-blind, no preview.** Their funnel is the opposite of ours and a known conversion weakness for
  the category. The preview-first funnel is the deliberate improvement — don't regress toward theirs.

## The one honest watch-out

Shaka's **4.9★ / 77k reviews / 1M+ downloads** proves the *category* and sets the bar — and it's
earned largely on **utility + reliability**, not charm. Our bet is that *charm* wins a niche they
can't serve, which is right for a toy. But the reviews are a standing reminder: **"actually useful on
a real trip" is the floor.** The practical layer (logistics, offline reliability, dead-simple in-car
UI) is the price of admission *before* charm gets to be the differentiator. Don't let the persona
work crowd out the boring stuff that earns the 5 stars.

## Sources

- https://www.shakaguide.com/ — site, positioning, nav, pricing/bundles, "how it works"
- https://www.tripadvisor.com/ShowUserReviews-g29218-d27434627-r946337709-Shaka_Guide_Kauai_Audio_Tour-Kauai_Hawaii.html — the "frustrating" one-way / confusing-buttons critique
- https://apps.apple.com/us/app/shaka-guide-gps-audio-tours/id1585055145 — App Store listing (4.9★ / 77.4k)
- https://bigislanditineraries.com/shaka-guide-big-island/ — teardown: dead-air complaint + practical-info praise
- https://wanderlog.com/place/details/892664/shaka-guide-apps — reviews roundup
