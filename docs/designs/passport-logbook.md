# "Passport + logbook" — a souvenir/collection layer

> **Status:** idea, pre-spec — post-MVP, gated behind the proven phone player (M1). Stamps + the
> single-skipper logbook work pre-breadth; the "cast of skippers" collection only blooms at M4.
> Captured 2026-06-08/09; extracted from CLAUDE.md 2026-06-09.

A keepsake system for completed drives, charm-first: memory-keeping, NEVER achievement/conquest (a
lifestyle toy must not grow FOMO or a grind). Comp-anchored from a brainstorm —
**NPS national-park passport is the model to COPY** (dated, presence-required,
warm "I was there"); **Jeep Badge of Honor** supplies the real-geo-collection +
tangible-trophy DNA but its conquest/difficulty framing is dropped; **Foursquare
is the warning label** (extrinsic badges rot without intrinsic meaning — and
don't conflate COMPETITION (mayor/leaderboard) with COLLECTION (stamps); Skipper
is collection, no leaderboards); **Pokémon GO's** regional-exclusive is the
travel motivator to keep, its completionism the grind to refuse; **Untappd** =
witty/behavioral badges ("I noticed what you DID," not just "you were here");
**Strava** = keep the personal year-in-review (Wrapped), drop the leaderboard;
**Duolingo** = streak WARMTH without the guilt-owl coercion. The unfair advantage
over every comp: a CHARACTER hands you the souvenir and writes on it — generative
and addressed to YOUR drive, not a static unlock.

- **Two surfaces over ONE event stream (completed drives) — keep them SEPARATE:**
  1. **Stamps (the rider's passport).** One per completed drive, NPS-style:
     dated, presence-required, inked with a skipper line about that specific
     drive. The sentimental ledger. Awarded at the drive-complete payoff beat;
     a "Tip the skipper" tip inks a special stamp (this is the "passport-stamp"
     [tip-the-skipper.md](tip-the-skipper.md) and
     [drive-complete-moment.md](drive-complete-moment.md) reference).
  2. **The skipper's "logbook" (drive statistics).** SEPARATE from stamps — the
     skipper reads your cumulative stats back in character. A fractal of the core
     invariant: the stats are the FACTS, the skipper is the DELIVERY ("persona
     lives in delivery, never in facts," aimed at the profile layer). Works from
     drive ONE with a single skipper (no breadth dependency — this is why it
     beats a "collect the cast" framing). Vocab: drives, hours "stuck with me,"
     corridors, night/golden-hour drives, repeat drives, avg joke notch.
     Absence-shaped stats ("12 days since your last drive") are the guilt-owl —
     spend SPARINGLY; persona is the antidote ("figured you'd defected to Shaka
     Guide"). Delivery: MARQUEE = annual recap (Wrapped, deadpan); AMBIENT = a
     milestone trips mid-drive and he just mentions it ("that's your 50th stop
     with me") — Untappd's behavioral badge as spoken narration, not a popup.
- **Architecture.** Lives on the USER, not the tour — respects the no-`createdBy`
  invariant via a user-side table (the precedent now exists: the shipped `drives` table is
  user-owned on a NOT-NULL `user_id` FK and references shared narrations; the same seam carries
  this collection). ONE source of truth = a completed-drive event stream (stamps are the rows;
  stats are the rollup). Needs player telemetry not yet emitted: a drive-completed / payoff-reached
  event (+ listening time, time-of-day). Host/portrait art resolves in code via the `PersonaDef`
  registry (`personaFromKey`; there is no `personas` table — see
  [region-skippers.md](region-skippers.md)), so the collection just records met + counts.
- **Open forks (left for revisit).** (a) completion = proof-of-EXPERIENCE
  (finished + heard the payoff) vs proof-of-traversal (dot passed the geofence) →
  leaning experience; (b) meeting a skipper = relationship model (present from
  drive 1, deepens via familiarity = a real count) vs trophy model (earn the
  portrait by finishing the region) → leaning relationship; (c) stats framed as
  "his logbook ABOUT you" vs "your analytics dashboard" → leaning his logbook
  (warm, on-persona). Framing motto: "two ledgers of the same drives — yours
  sentimental, his statistical."
- **Companion threads flagged the SAME session (not yet captured elsewhere):**
  (1) the skipper aware of the DRIVE not just the dots — golden-hour, weather,
  you've-gone-quiet, sat-still-25-min — which is what powers the behavioral
  "I noticed" stamps; (2) callbacks / running gags across a single drive (a
  per-tour continuity layer threading the per-stop clips). Both are
  companions/prerequisites to the charm here. (The "skipper's opinions" and
  "downtime callouts" specs in `docs/designs/` have since given thread (1) a partial home.)
- **Sequencing:** post-MVP, gated behind the proven phone player like the rest.
  Stamps + single-skipper logbook work pre-breadth; the "cast of skippers"
  collection only blooms at M4 (multiple regions). Pairs with the Stripe/IAP work
  (via Tip-the-skipper) and the region expansion.
