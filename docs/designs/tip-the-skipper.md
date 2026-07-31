# "Tip the skipper" — an end-of-tour tip jar

> **Status:** idea, pre-spec — post-MVP, gated behind the proven phone player (M1); rides on the V2
> consumable drive-credit IAP layer. The credit RAILS are the append-only `credit_entries` ledger
> ([../decisions/credit-ledger.md](../decisions/credit-ledger.md)) — provider-agnostic (Apple IAP /
> Google Play), free slice BUILT, purchase plumbing DEFERRED; a tip would be a second consumable
> product on those same rails. Captured 2026-06-08; extracted from CLAUDE.md 2026-06-09.

At the drive-complete beat (the `voice.driveComplete` screen, AFTER the payoff — never before, never
blocking — see [drive-complete-moment.md](drive-complete-moment.md)), an optional, low-pressure "tip
your skipper," in character, because a corny tour guide works for tips. Charm-forward monetization
(delight, not extraction) — the toy-lens + competitive read both point to voluntary/one-time over
subscription.

What it stresses:

- **Payment rails ride on the V2 drive-credit IAP work.** `user.tier` is still a manual flag (no
  billing wired yet). On iOS a tip for digital content MUST go through Apple IAP (≈30% cut) — model it
  as a consumable IAP "tip" product on the SAME consumable-IAP layer the V2 drive-credit pack
  introduces. Those rails are the provider-agnostic `credit_entries` ledger
  ([../decisions/credit-ledger.md](../decisions/credit-ledger.md)): a verified purchase writes a
  `grant`, a refund a `reverse`, idempotency-keyed per `<provider>:<txnId>` — the free slice is BUILT,
  the purchase plumbing (Apple IAP / Google Play verify + clawback) is DEFERRED. A tip need not move
  "drives" credits; it's the second consumable product wired onto the same purchase/verify seam, not a
  separate Stripe integration (Stripe is explicitly the wrong rail here — the stores own the money).
- **A tip is not a toll.** Never gate content behind it — the freemium wall is the
  playback `AccountGate`; tipping rides on TOP of a tour already enjoyed, fully skippable.
  Ask warm, ask once.
- **Charm hook (optional).** A tip can ink a passport-stamp / postcard, or unlock one
  bonus aside ("since you're feeling generous, one more for the road…") — reward the
  gesture; don't make it the point.
- **Sequencing:** post-MVP, gated behind the proven phone player; follows the V2 drive-credit
  consumable-IAP layer (reuse those rails — the credit pack lands the ledger's purchase plumbing first).
