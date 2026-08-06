# The home hero — a WPA poster behind the cold open

> **Status:** ✅ **BUILT + VERIFIED ON DEVICE 2026-08-06** (simulator, iPhone 17 Pro Max, iOS 26.5,
> BOTH themes). Eight founder calls settle placement, medium, the collision, delivery, subject,
> content, art and implementation (§1). Seven render rounds produced the composition; the generator is
> `apps/mobile/assets/brand/explore-poster/gen.py` (committed; output gitignored, mirroring the icon
> exploration next door). What shipped and the three guards around it: §4a. Root `bun run check` and
> `apps/mobile` `bun run check` both EXIT 0; two of the new assertions are mutation-checked.
>
> 💸 **The art costs nothing.** It is programmatic flat SVG in theme colours — no image model, no
> illustrator, no paid run. The spend gate this document opened with is **withdrawn**, §6.
>
> ⚠ **ONE OPEN QUESTION, founder's eye:** at dusk the LAKE is the loudest thing on the screen.
> `water` resolves to `lakeTealNight`, which the palette lifts for use as a small accent — the exact
> trap §4a avoided for the ridge planes (`accent` → `pineGlow`), now showing up on a large fill. It may
> read as a moonlit lake and be right. If not, the fix is a `posterWater` role, not a tweak to `water`.
>
> ⚠ **This is round 3 on the home cold open in four days.** Round 1 was 1.1's cold open; round 2 was
> [home-cold-open-declutter](home-cold-open-declutter.md), BUILT 2026-08-03, whose §13 answered this
> same complaint with the `Ridgeline`. That doc's §17 and §18 win over its body and are prerequisites.

## 1. What was decided

A **full-bleed background on the home cold open** that **hides once the conversation starts**, so it
never sits behind a growing transcript.

Founder calls, 2026-08-06, in order:

1. **Placement** — hero background on home, decorative, hidden on the first turn.
2. **Medium** — **WPA poster art in the Trailhead 89 palette, NOT a photograph.** Consistent with the
   deleted postcard (*"framed WPA art of Emerald Bay"*, `54b5e86e`) and with the design language being a
   1938 park poster. A photo is the visual language of every competitor (Shaka, GuideAlong, Autio).
3. **The collision** — **the poster REPLACES `Ridgeline`** (`app/index.tsx:1265`). One signature move per
   screen (DESIGN §2); a good poster already contains a ridge. Sequencing condition in §5.
4. ~~Served per-region so a new region needs no build~~ — **REVERSED by call 5.** Recorded, not deleted:
   the reasoning was sound and would apply again the moment the art depicts a specific place.
5. **ONE STATIC background for every region** — no per-region art at all. **This is the call that
   collapsed the design**, and the reason is worth keeping: the per-region axis was a *consequence* of the
   art being representational. Non-representational art doesn't need to change per region, because every
   region we would ever ship has ridges and a road. The region is already named in text on the chip
   directly above it, so the picture never had to do that job. No columns, no DTO field, no cache, no
   delivery problem.
6. **Content: a small lake, and the rig on a road through the mountains.** ⚠ This un-blocks an idea that
   was already designed and refused for a reason that no longer applies: §13's **S2** wanted the
   `RouteTrack` trail with the car token on home and called it *"the strongest Skipper signal in the
   system"*, rejected because it **spends a row**. In a background it spends none. DESIGN §1 makes the
   car *"the one moving thing on the route"*, and the app **icon is a switchback S with a dashed centre
   line** — so a switchback road with a dashed centre line IS the brand mark, not a generic squiggle.
7. **The drive must ARRIVE, not stop** (founder: *"the drive should end with something, not just
   stop"*), **and the road carries a little more zig.** ⚠ The terminus is not a new invention either —
   `../../apps/mobile/assets/brand/explore/gen5.py` ends the icon's switchback S with an **amber head
   dot on the stroke**, so "the road ends at a marker" is already the icon's grammar. Four termini were
   drawn and all read: a **cabin with a lit window**, a **carved ranger signpost** (DESIGN.md names
   those as a source reference), a **fire lookout**, and the icon's **marker dot**. Recommended: the
   cabin — it is the only one that answers *arrive at what?* with somewhere you'd want to be.
   ⚠ **Amber budget:** if the rig is amber, an amber-windowed cabin is a second warm object. A pale
   variant exists for exactly that call; DESIGN §8 permits one amber **glow**, and both of these are
   flat fills.
8. **Chosen art: the cabin terminus at the middle zig level** (`D1` — `wiggle 0.13`, `bends 2.6`), and
   **`react-native-svg` over a bundled PNG.** §3.6 is the comparison and the measured reasons.

## 2. The moment

Stated plainly rather than dressed up: **this one is not in the car.** The founder's framing was "purely
decorative," and the six-question lens has no in-the-car moment to extract from a launch screen.

Not disqualifying, because the design language already claims this ground — DESIGN.md's opening line is
that the interface *"should make you smile **before** the skipper says a word."* The moment is: you open
the app, and before typing anything there's a little rig winding a mountain road past a lake. Then you
start talking and it gets out of the way.

## 3. The constraints that shape the build

Each was found by rendering, not by arguing.

### 3.1 ⚠ MEASURED — the cold open cannot host a full-bleed poster

An **occlusion** fact, measured off a real 1320×2868 screenshot (iPhone 17 Pro Max):

| Band | y (of 2868) | Share | What is there |
|---|---|---|---|
| header + chip | 0–820 | 29% | masthead, region chip, headline, subtitle — **text sits here** |
| the ask cards | 820–2065 | **43%** | five **opaque** `paperRaised` cards — nothing behind them is visible |
| free paper | 2065–2570 | **17%** | the only genuinely open ground |
| composer | 2570–2868 | 10% | input + send |

**A full-bleed poster is not dimmed, it is HIDDEN.** The round-1 `A-fullbleed` variant put tan mountains
behind *"Where are we headed?"* and its subtitle; it stayed in the sheet as evidence, not as a candidate.

The chosen composition therefore lives in the free strip, and the winner **starts 160px higher than the
card line** — the one deliberate intrusion, because three elements would not otherwise fit.

### 3.2 ⚠ A compressed SCENE reads as STRIPES; a silhouette survives

Round 2 squeezed a full Emerald Bay composition (sky / far ridge / lake / headlands / foreground) into the
free strip and it resolved into four horizontal bars — cream, tan, teal, green — with the flat teal water
plane the loudest. **At this size the eye reads a SILHOUETTE, not a scene.** Layered ridge planes in three
values of one family survive the compression; a full-width water plane does not.

Hence the lake is a small **shaped body**, never a band. Round 6 also proved the inverse failure: drawn
*behind* a ridge for depth, it was clipped to its crown and read as a **blue hill**. It has to be small,
shaped, and fully visible.

### 3.3 The elements do not all fit — the strip is 505px

Rounds 5–7 each failed by crowding. Three ridge planes **and** a lake **and** a road **and** a car do not
fit in 505px; something always collapsed (the road shrank to a thread; the lake became a dome). What
resolved it: **make the road the hero**, place elements by **absolute y**, and steal 160px from the card
line. Ridges are backdrop, not subject.

⚠ Also learned the hard way, and each cost a round:

- A road drawn as long **straight switchback legs reads as a lightning bolt**. A road bends; it does not
  zigzag at 60°. Curvature is the knob, never angle.
- A car drawn as body + cabin + wheels at poster scale **merges into an orange blob**. Fewer parts, more
  size.
- **Wheels filled `pineDeep` on a `pineDeep` field read as HOLES BITTEN OUT of the car.** They have to
  land inside the cream road stroke, where dark actually contrasts.
- **A rig 106px long on a 26px road is not a car, it is a bar.** Scale the rig to the road, not to the
  screen.
- ⚠ **`car_t` is not a free parameter.** At 0.34 the rig sits exactly on the steep bend, rotates
  broadside and reads as an orange **cross**. It needs a flat stretch (0.60 today), and the flat
  stretches move whenever the road's wiggle changes. Take the heading from points i±2, not from adjacent
  points, or the rotation jitters.
- ⚠ **A sine wiggle that is not enveloped does not end where you tell it to.** `sin` was still at 0.95
  at t=1, so `road_end` was a lie and every terminus got shoved against the canvas edge. Multiply by
  `sin(pi*t)` so the wiggle vanishes at both ends.

### 3.4 ⚠ The road ink MUST NOT flip by theme — and this is `onPhoto`'s first real reader

The dusk render came back with **no road**: it was stroked in `paper`, which in dusk resolves to
`#14201B` — the night *background* — so it drew dark-on-dark and vanished.

The road lies on a dark plane in **both** themes, so it needs a light ink that does not flip. That is
exactly the argument behind `theme.ts`'s `photoScrim` / `photoScrimFade` / `onPhoto` pair — *"a picture is
exactly as bright at dusk as it is at noon"* — which has had **zero production readers** since the
postcard was deleted, its only remaining mentions being in `theme.test.ts`.

**So this supersedes the earlier note that the poster leaves those tokens orphaned.** The road and the rig
want a non-flipping light ink; `onPhoto` is either it, or the sibling of it. Decide at build time — but do
not reach for `paper`.

### 3.5 ⚠ Day and dusk are a PALETTE SWAP, not two pieces of art

The whole composition is flat shapes in token colours, so dusk is the same geometry with the palette
swapped — verified against a real dusk screenshot, and it is **not** the bright rectangle a cream poster
would have been, because `tan` in dusk resolves to `#3A4A3E`, a muted pine.

**This retires the earlier "two assets per poster, doubling the art cost" claim** — true of a raster
image, false of vector geometry driven by theme roles.

### 3.6 ✅ RESOLVED — `react-native-svg`, and why not a PNG

`Ridgeline`'s own comment read *"There is no gradient dependency in this app (and no SVG)"*, and
`react-native-svg` was **not installed, not even transitively**. Three ridge planes alone *are* drawable
with rotated Views (a straight-edge variant was rendered and reads fine) — **but a winding road, a shaped
lake and a car are not.** So call 6 forced the choice, and it was made on measured facts:

| | `react-native-svg` | two bundled PNGs |
|---|---|---|
| bundle cost | 3 KB of path data | **41 KB per theme** (~82 KB) — flat colour compresses well |
| day/dusk | palette swap, one source | two artworks to keep in step |
| token discipline | reads roles; `lint:tokens` governs it | baked hex **no lint can see inside** |
| 375×667 → 440×956 | re-lays-out from real dimensions | scale or crop only |
| animation later | possible | never |
| new dependency | **yes** | no |

**Size is a wash and must not decide it** — the instinct that a full-screen PNG is heavy is wrong here.

**What decided it was the device range.** `../research/fitting-one-screen-across-iphone-sizes.md` §1:
every iPhone in portrait is the same size class, so *"any per-device behaviour must read ACTUAL
dimensions."* This composition is positioned against absolute y measured on a Pro Max; on an SE the card
stack eats proportionally more of a much shorter screen. A component can respond; a raster cannot.

**Second: token fidelity.** `lint:tokens` fails the build on a raw colour in `app/` or `src/ui/`. A PNG is
41 KB of raw hex outside that guarantee, so a palette change would silently desync the art.

⚠ **The dependency is the tame kind.** `react-native-svg` is in Expo SDK 57's own
`bundledNativeModules.json` at **15.15.4** — one of 123 modules Expo pins per SDK — so `expo install`
picks the vetted version, `expo-doctor` checks it, and SDK upgrades carry it. It is also small beside
`react-native-maps`, which this app already ships.

⚠ **The honest alternative was never the PNG.** If the priority is "no new native dependency", the right
answer is **ridges only via rotated Views** (§4 B), which beats the PNG on device fit, token fidelity and
animation — and costs the road, cabin and rig instead. The PNG is the weakest of the three.

## 4. Alternatives

**A — The chosen composition** (ridge planes + small lake + switchback road + the rig). Highest charm per
pixel; adds *zero blocks and zero CTAs*, the test §13 set for itself; extends the design language and
re-uses two motifs the system already owns (the car token, the icon's dashed switchback).

**B — Ridges only, no road or lake.** Rendered as the control (`Q5`/`P8`). Buildable with rotated Views
today, no new dependency, day/dusk free. Genuinely handsome and genuinely plainer. **This is the fallback
if §3.6 lands on "no new dependency".**

**C — Topographic watermark, no scene.** Nested contour rings, full bleed, immune to the occlusion problem
entirely because it has no subject to occlude. Quietest option; closest to the Ridgeline it replaces.

**D — Don't build it.** Home's decoration was redone three days ago and §13 was written from the same
complaint in the founder's own words. **Why it loses:** `Ridgeline` is 472×56 — a hairline at ~6% of screen
height, visible in the real screenshot only if you hunt for it. It cannot answer "the home screen looks
stale". §17 also records that it was itself a mid-build substitution for a Sunburst that was never visible
(clipped by `overflow: 'hidden'`, not too faint), so the slot has been improvised twice and never designed.

## 4a. What shipped, and the three guards around it

- **`src/ui/HomePoster.tsx`** — the artwork, drawn in its own 1320×803 `viewBox` (the free strip below
  the ask cards). `viewBox` does every bit of scaling, so nothing in the component is device-specific,
  and a `maxHeight` read off `useWindowDimensions` keeps it from eating a short screen (§3.6).
- **`ConversationScreen` gained a `backdrop` slot** — behind everything, pinned to the **screen's**
  bottom edge (§5.1 is the bug that taught the difference).
  ⚠ **The footer's fill is dropped while a backdrop is present** (founder, 2026-08-06: *"i thought the
  graphic would cover all the way to the bottom"*), so the artwork runs to the screen edge and the
  composer floats on it. That fill is normally load-bearing — without it the transcript scrolls behind
  the composer at full opacity — and it is safe to drop **here and nowhere else** for one reason: a
  backdrop is only ever passed on the cold open, where the transcript is empty by definition. The
  moment the rider speaks, the backdrop goes and the fill returns.
  ⚠ **Follow-up, not yet done:** the composer's SEND button is styled for paper and now sits on the
  near plane, where it loses most of its contrast. Same class as the road-ink bug — a control that
  cannot know what is under it. It wants `onPhoto`/`onAmber` treatment or an opaque disc.
- **`Ridgeline` is DELETED**, in the same commit, per §5's condition. `Sunburst` went the same way the
  day before; git is the archive for both.
- **Three new roles** — `posterFar` / `posterMid` / `posterNear` — plus the tokens behind them. ⚠ They
  are their own roles rather than reused UI ones because the UI palette answers a different question:
  `accent` at dusk is `pineGlow`, deliberately *lifted* so an active glyph reads at night, which is
  exactly wrong for a full-width plane that should recede.

**Three things now fail a test that previously could only be caught by eye:**

1. `theme.test.ts` asserts **`onPhoto` on `posterNear` clears 4.5:1** in both themes (measured 10.50 /
   11.24) — the road-vanishes-at-dusk bug. **Mutation-checked**: colouring the dusk near-plane cream
   fails it.
2. `theme.test.ts` asserts **`amberToken` on `posterNear` clears the 3:1 non-text bar** (3.82 / 5.86) —
   the rig staying visible on the plane it drives across.
3. `home-source.test.ts` asserts the poster is handed to the **shell's `backdrop` slot**, not rendered
   inline — rendered as an ordinary child it would scroll away with the cards, which looks fine until
   someone scrolls. **Mutation-checked**: removing the prop fails it.

## 5. The smallest version, and the sequencing condition

1. **Settle §3.6** — dependency or asset. Everything else follows from it.
2. **Ship the one static background**, day + dusk, hidden the moment the transcript is non-empty. No
   schema, no DTO, no cache, no per-region anything (call 5).
3. ⚠ **Keep `Ridgeline` in the tree until the poster is on a device in both themes.** A full-bleed poster
   and a hairline stroke cannot coexist, but deleting the working motif before the replacement is proven
   leaves home with neither. Remove it in the **same commit** that lands the poster, never before.

⚠ **Two things the desk pass cannot tell you**, and the first one bit immediately. (a) Everything is
judged on **one** screen size; the free strip is smaller on an SE and the composition is positioned
against absolute y, so it still needs a real check on a small device. (b) The number of ask cards is not
fixed — fewer cards means more free paper, and the art must not look broken when the strip grows.

### 5.1 ⚠ What only the device caught — anchor the artwork to the SCREEN, not the viewport

The first build looked correct in every desk render and was **wrong on the simulator**: the poster had
lost its cabin and its lake, and an empty green field sat under the road.

The backdrop had been anchored to the bottom of the **scroll viewport** — i.e. stopping at the footer —
which is a reasonable-sounding thing to do and rides the whole composition ~300px higher than it was
drawn. Its top third slid under the ask cards, taking the two elements that live up there, while the
plane fill designed to hide *behind the composer* was left exposed.

**The artwork is drawn in the full 1320×2868 screen space and expects to lose its bottom strip to the
footer.** So it anchors to the screen's bottom edge and lets the footer paint over it. Both facts are now
in `ConversationScreen`'s `backdrop` doc comment, because the wrong choice is the intuitive one.

## 6. 💸 Spend gate — the art turned out to be free

**Withdrawn.** This document opened by flagging the art as an operator paid run needing an explicit go.
That was wrong once the medium was chosen: the posters are **programmatic flat SVG in token colours**,
rendered by `gen.py` through `rsvg-convert` — the same free, deterministic pipeline that produced the app
icon. No image model, no commission, no `--apply`. **Nothing in this work has spent a cent.**

**Rider-triggered spend: ZERO**, and structurally so. A static background adds no endpoint, no model call
and no Routes call. It does not touch `apps/api/src/limits.ts`.

## 7. Related

- [home-cold-open-declutter.md](home-cold-open-declutter.md) — round 2. **Read §17 and §18 first.**
  §13's S2 (the parked rig) is the ancestor of call 6.
- [../decisions/sample-ride-postcard.md](../decisions/sample-ride-postcard.md) — the *audio* "postcard".
  ⚠ Different artifact, same word; the screen that dressed it was deleted 2026-08-05 (`a4421873`).
- [onboarding-gate-reconsidered.md](onboarding-gate-reconsidered.md) — the comparison that killed the
  front-door postcard. This doc deliberately does not re-open it: a decorative background makes no claim
  about the product the way a canned taste clip did.
- [drive-complete-moment.md](drive-complete-moment.md) + [passport-logbook.md](passport-logbook.md) — the
  *other* home a per-region image could have had (an earned souvenir, NPS-passport model). Not this
  feature; recorded so the two are not conflated later.
