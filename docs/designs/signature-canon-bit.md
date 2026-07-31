# The signature canon bit — a beat riders learn to wait for

> **Status:** idea, DEFERRED by founder call 2026-06-10 (not scheduled; revisit with
> region-skippers, M4-ish). Grounded in the verified skipper-craft research
> (`docs/research/jungle-cruise-skipper-craft.md` §5.3) and a design session the same day.

## The charm rationale

The backside-of-water lesson: audiences come to *demand* a known beat — "if you don't do
the backside of water, guests will get off the boat and tell you you forgot" (Kevin Lively).
The Skipper has a kit (intro-only) but no repeatable beat a rider could learn to anticipate.
Anticipation-then-payoff is the core charm mechanism the research surfaced that the persona
doesn't yet use.

## Candidates considered (2026-06-10)

- **(a) The Colossal Build-Up** — once per tour, full eighth-wonder ceremony at a curated
  mundane-real moment → deadpan literal payoff. Shape canon, payoff per-tour.
- **(b) The Favorite Spot** — once per tour, an unremarkable verified spot is "my favorite
  spot on this whole drive. No reason. Just is." Varies per telling.
- **(c) The Sign-Off** — a fixed catchphrase closing every outro; the one literally-fixed
  line in a zero-reuse system. Zero-risk, trivial to build (bracket prompt only).
- **(d) The Lake Check-In** — Tahoe-region: each shoreline return gets a one-line deadpan
  status report on the lake. **The founder's lean**, because it is the only candidate a
  FIRST-TIME rider can learn within a single drive (v1 reality: most riders ride one tour
  once), it tracks a real repeated experience of the drive (the lake vanishing and
  reappearing), and it generalizes into region-skippers (each region host checks on its
  region's constant: Yosemite the walls, Moab the rocks).

## The load-bearing design constraint (why naive (d) must never ship)

A human skipper repeating a bit reads as intentional; an AI narrator repeating a
near-verbatim line reads as a GLITCH — fatal to charm, and exactly what the diversity/motif
machinery exists to kill. The buildable version is therefore **the shape, not the
sentence**: a three-beat ESCALATION per telling (establish sincere → confirm shorter/deadpan
→ third beat subverts: mock-concern, proud tag, or the one skipped check he apologizes
for), with wordings varying per telling (zero-reuse roulette intact — only the habit is
canon). Escalation makes intent unmistakable.

## Mechanics sketch (when revived)

`canon` entry on the `PersonaDef` (single-sourced like the kit — generate + lint read the
same definition); placement data-driven onto 2–3 lakeside stops via a region lake-anchor
distance check; phrasing rules never assert sight-line ("she's still out there" survives a
tree line — the Sugar-Pine-Point geometry-miscue class can't bite); a NARROW motif/lint
exemption keyed to the canon entry only; notch OFF keeps the beat but plays it sincere.
~Half-day build, no schema change, bakes into narration at generation time.

## Promotion gate

Explicit founder build-greenlight (idea → spec cadence). Natural revival points: the
region-skippers build (the canon field belongs on `PersonaDef` anyway) or post-MVP charm
work once the phone-player bet is proven. The cheap pre-build de-risk: draft the three
beats as scripts and synth them (~$0.15) for an ear test before any machinery exists.
