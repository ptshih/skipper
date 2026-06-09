# "Tip the skipper" — an end-of-tour tip jar

> **Status:** idea, pre-spec — post-MVP, gated behind the proven phone player (M1); pairs with the
> Stripe/IAP billing work. Captured 2026-06-08; extracted from CLAUDE.md 2026-06-09.

At the drive-complete beat (the `voice.driveComplete` screen, AFTER the payoff — never before, never
blocking — see [drive-complete-moment.md](drive-complete-moment.md)), an optional, low-pressure "tip
your skipper," in character, because a corny tour guide works for tips. Charm-forward monetization
(delight, not extraction) — the toy-lens + competitive read both point to voluntary/one-time over
subscription.

What it stresses:

- **Payment rails we don't have yet.** `user.tier` is a manual flag (no Stripe/IAP). On
  iOS a tip for digital content MUST go through Apple IAP (≈30% cut) — it can't route to
  Stripe; model it as a consumable IAP "tip" product. Lands WITH the same billing
  integration the paid tier needs, not before.
- **A tip is not a toll.** Never gate content behind it — the freemium wall is the
  playback `AccountGate`; tipping rides on TOP of a tour already enjoyed, fully skippable.
  Ask warm, ask once.
- **Charm hook (optional).** A tip can ink a passport-stamp / postcard, or unlock one
  bonus aside ("since you're feeling generous, one more for the road…") — reward the
  gesture; don't make it the point.
- **Sequencing:** post-MVP, gated behind the proven phone player; pairs with the
  Stripe/IAP work.
