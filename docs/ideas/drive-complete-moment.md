# The drive-complete payoff as a designed _moment_, not a screen

> **Status:** idea, pre-spec — post-MVP, gated behind the proven phone player (M1). Captured
> 2026-06-08/09; extracted from CLAUDE.md 2026-06-09. Build BEFORE the tip jar and the passport-stamp
> animation — both want this surface.

Today `voice.driveComplete` is one string on a plain screen; this beat is the emotional
climax of the whole drive (the road's-end exhale), and the design language is
mature on static visuals but bare on the two axes a _moment_ lives in — **motion
and sound**. Design it as a beat: the trip total ticking up on the odometer (Space
Mono is already the "stamped clock"), the stops you passed collected and **inked as
passport stamps** (`StopRow` already models the `passed` state; the DESIGN §9 stamp
animation lands here first), an **engine-off sigh** + soft haptic to close the
loop, optionally a shareable **postcard** of the route.

What it stresses:

- **It's the stage, not a feature.** It's the container several deferred ideas plug
  into — the **tip jar** ([tip-the-skipper.md](tip-the-skipper.md)) rides on TOP of it (after the
  payoff, never before/blocking), the region skipper's sign-off lands here, the §9 passport-stamp
  earns its first home. Build the moment; then hang the others on it.
- **Earns the under-built axes.** This is the highest-value place to spend the first
  real **sound + haptic** design and a JS-driven `Animated` flourish — one signature
  move (the stamps inking, or the odometer rolling), per DESIGN §2, not six.
- **Celebration, never a wall.** Fully skippable, glanceable, no gate — it's a
  thank-you, not a toll. Respect the half-second glance rule even at the climax.
- **Voice stays DELIVERY, never FACTS.** A warm in-character send-off + the _actual_
  stops passed — never an invented "remember when we saw…" the drive didn't include.
- **Sequencing:** post-MVP, gated behind the proven phone player; build BEFORE the
  tip jar and the §9 passport-stamp animation (both want this surface) — reuses
  `StopRow` `passed`, the Space Mono numerals, and the existing `voice.driveComplete`
  copy, so it's mostly motion + sound on pieces that already exist.
