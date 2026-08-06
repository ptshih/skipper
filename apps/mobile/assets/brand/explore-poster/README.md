# Home-hero poster exploration — how the composition was arrived at

Spec: [`../../../../../docs/designs/home-hero-poster.md`](../../../../../docs/designs/home-hero-poster.md).
Sibling of [`../explore/`](../explore/README.md), which did the same job for the app icon — same rule
here: **only the generator and this README are committed**; every image regenerates.

```sh
brew install librsvg                  # rsvg-convert
python3 -m pip install pillow
# the in-situ mocks need REAL screenshots, not mockups:
xcrun simctl io booted screenshot coldopen.png        # home, day
xcrun simctl io booted screenshot coldopen-dusk.png   # home, dusk (Settings › Appearance › Dusk)
python3 gen.py --dusk
```

`gen.py` writes `out/` plus `sheet-day*.png` / `sheet-dusk*.png` contact sheets.

## The one test that mattered

**The in-situ mock, not the bare poster.** `ui_overlay()` takes a real screenshot and knocks out only the
flat base paper, leaving the actual cards, text, chip and composer opaque — so a candidate is judged
underneath the real UI. Every round changed its mind after looking at the in-situ sheet, and never once
after looking at the bare one. Judge a background against what covers it.

## What the exploration actually proved

The durable bits; the rest is taste.

- **The cold open cannot host a full-bleed poster.** Measured: the five ask cards are OPAQUE and own
  y 820–2065 — **43% of the screen** — and the only free paper is y 2065–2570, about **17%**. A full-bleed
  candidate is not dimmed, it is HIDDEN, and what survives lands behind the headline. The `Z_` constants in
  `gen.py` are these measurements; re-measure them if the cold open changes.

- **A compressed SCENE reads as STRIPES.** A full Emerald Bay composition squeezed into the free strip
  resolved into four horizontal bars — cream, tan, teal, green — and the flat teal water plane was the
  loudest. **At this size the eye reads a silhouette, not a scene.** Ridge planes in three values of one
  family survive; a full-width water plane does not.

- **Day/dusk is a palette swap, not two artworks** — every shape is flat and token-coloured. A cream
  poster at dusk would be the bright rectangle dusk exists to prevent; this one isn't, because `tan`
  resolves to `#3A4A3E` there.

- **⚠ The road ink must not flip by theme.** Stroking it `paper` drew dark-on-dark at dusk (`paper` is
  `#14201B`, the night background) and the road vanished from the render. The road sits on a dark plane in
  *both* moods — this is exactly the case `theme.ts`'s `onPhoto` pair was written for.

## Dead ends, so they don't get re-tried

- **Transparent holes.** Round 1 painted sky only to the horizon and left everything below the waterline
  unfilled; PIL renders that pure black, which reads as a design choice in a contact sheet rather than the
  bug it is. `base_paper()` is always first now.
- **Absolute pixel geometry.** Ridge heights hand-tuned at a full-bleed horizon silently collapse to bumps
  when the horizon drops, so low-horizon variants were being judged on art that had lost its mountains.
  Everything is a fraction of the scene, or an explicit absolute y.
- **A symmetrical bay** — the two headlands meeting in the middle make a **goblet**, not Emerald Bay. The
  real bay opens right into the main lake.
- **The lake drawn behind a ridge** for depth: clipped to its crown, it reads as a **blue hill**. Small,
  shaped and fully visible beats big and occluded.
- **Straight switchback legs** for the road — reads as a **lightning bolt**. A road bends; it does not
  zigzag at 60°. Curvature is the knob, never angle.
- **A car drawn as body + cabin + wheels** at poster scale merges into an **orange blob**. Fewer parts,
  more size.
- **Wheels filled `pineDeep` on a `pineDeep` field** read as **holes bitten out of the car**. They must
  land inside the cream road stroke, where dark contrasts.
- **A rig scaled to the screen instead of to the road** — 106px of car on a 26px road is a bar, not a
  vehicle.
- **Placing the rig at `car_t=0.34`** — that is exactly the steep bend, so it rotates broadside and reads
  as an orange **cross**. It needs a flat stretch, and the flat stretches MOVE when the wiggle changes.
  Take its heading from points i±2; adjacent points make the rotation jitter.
- **An un-enveloped sine wiggle.** `sin` was still at 0.95 when t=1, so `road_end` controlled nothing and
  every terminus landed against the canvas edge. Multiply by `sin(pi*t)`.
- **A treeline in the same ink as the plane it stands on** is invisible by construction. Rendered for
  three rounds before anyone noticed there were no trees.
- **Full-bleed low-opacity ridges** (`G-ridges-wash`) tint the whole paper a muddy grey-green and cost the
  background its warmth.
